import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  addWrappedLines,
  alignLine,
  buildHistoricalTranscriptLines,
  buildLiveTranscriptLines,
  buildRawLines,
  compactPendingSuggestions,
  confidenceColor,
  countTranscriptMessages,
  deliveryColor,
  looksLikeMarkdown,
  prefersWideBubble,
  SessionOutput,
  wrapTranscriptBody,
} from "./session-output.js";
import { SessionState } from "../types.js";

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "s1",
    profileName: "claude",
    projectName: "proj",
    worktreeName: "main",
    startedAt: "2026-03-26T00:00:00.000Z",
    status: "active",
    outputLines: [],
    suggestion: { kind: "idle" },
    managed: {} as any,
    summary: null,
    currentToolUse: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    rateLimitStatus: null,
    timeline: [],
    viewMode: "transcript",
    scrollOffset: 0,
    followLive: true,
    ...overrides,
  };
}

describe("SessionOutput", () => {
  it("covers helper palette and alignment branches", () => {
    expect(confidenceColor()).toBe("gray");
    expect(confidenceColor(88)).toBe("green");
    expect(confidenceColor(65)).toBe("yellow");
    expect(confidenceColor(40)).toBe("red");

    expect(deliveryColor("auto")).toBe("green");
    expect(deliveryColor("approved")).toBe("green");
    expect(deliveryColor("edited")).toBe("yellow");
    expect(deliveryColor("manual")).toBe("magenta");
    expect(deliveryColor("hold")).toBe("gray");

    expect(alignLine("abc", 7, "left")).toBe("abc");
    expect(alignLine("abc", 7, "right")).toBe("    abc");
    expect(alignLine("abc", 7, "center")).toBe("  abc");
  });

  it("wraps helper text, truncates overflow, and identifies markdown-heavy transcript bodies", () => {
    const wrapped: Array<{ id: string; text: string }> = [];
    addWrappedLines(wrapped as any, "w", "This is a fairly long line that should overflow.", 14, {}, "", 1);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].text.endsWith("...")).toBe(true);

    expect(looksLikeMarkdown("## Heading\n- bullet")).toBe(true);
    expect(looksLikeMarkdown("plain text only")).toBe(false);
    expect(prefersWideBubble("```ts\nconst x = 1;\n```")).toBe(true);
    expect(prefersWideBubble("plain paragraph")).toBe(false);

    expect(wrapTranscriptBody("line one\n\n", 18)).toEqual(["line one"]);
    const markdownBody = wrapTranscriptBody("| A | B |\n| --- | --- |\n| 1 | 2 |", 40).join("\n");
    expect(markdownBody).toContain("┌");
  });

  it("compacts only the latest pending draft and counts messages after compaction", () => {
    const entries = [
      {
        id: "pending-1",
        kind: "local-suggestion" as const,
        timestamp: 1,
        text: "older",
        confidence: 80,
        reasoning: "older",
        state: "pending" as const,
      },
      {
        id: "sent-1",
        kind: "local-sent" as const,
        timestamp: 2,
        text: "sent",
        delivery: "auto" as const,
      },
      {
        id: "pending-2",
        kind: "local-suggestion" as const,
        timestamp: 3,
        text: "newer",
        confidence: 90,
        reasoning: "newer",
        state: "pending" as const,
      },
    ];

    const compacted = compactPendingSuggestions(entries as any);
    expect(compacted).toHaveLength(2);
    expect(compacted.some((entry) => entry.id === "pending-1")).toBe(false);
    expect(compacted.some((entry) => entry.id === "pending-2")).toBe(true);
    expect(countTranscriptMessages(entries as any)).toBe(2);
  });

  it("renders helper transcript lines for preview, errors, manual sends, and dismissed drafts", () => {
    const session = makeSession({
      worktreeName: "feature",
      timeline: [],
    });
    const lines = buildHistoricalTranscriptLines([
      {
        id: "remote-note",
        kind: "remote-turn",
        timestamp: 1,
        provider: "codex",
        activity: "bash",
        text: "Implemented the adapter.",
        note: "Need one last validation pass.",
      },
      {
        id: "draft-dismissed",
        kind: "local-suggestion",
        timestamp: 2,
        text: "Hold for now",
        confidence: 55,
        reasoning: "Need one more proof point.",
        state: "dismissed",
      },
      {
        id: "manual-empty",
        kind: "local-sent",
        timestamp: 3,
        text: "",
        delivery: "manual",
      },
      {
        id: "preview-queued",
        kind: "preview",
        timestamp: 4,
        state: "queued",
        text: "Build queued for verification.",
      },
      {
        id: "guild-tool",
        kind: "tool-activity",
        timestamp: 5,
        provider: "codex",
        toolName: "bash",
        text: "npm test",
      },
      {
        id: "guild-error",
        kind: "error",
        timestamp: 6,
        source: "guild",
        text: "Worker exited with code 2.",
      },
      {
        id: "sidecar-error",
        kind: "error",
        timestamp: 7,
        source: "sidecar",
        text: "Sidecar timed out after 30s",
      },
    ] as any, 64, session);
    const text = lines.map((line) => line.text).join("\n");

    expect(text).toContain("Guild · feature · bash");
    expect(text).toContain("Thinking: Need one last validation pass.");
    expect(text).toContain("Roscoe draft · 55/100 · dismissed");
    expect(text).toContain("You · manual");
    expect(text).toContain("No Guild message was sent.");
    expect(text).toContain("Preview queued · Build queued for verification.");
    expect(text).toContain("Guild tool · npm test");
    expect(text).toContain("Guild error · Worker exited with code 2.");
    expect(text).toContain("Roscoe error · Roscoe sidecar timed out after 30s in an");
    expect(text).toContain("earlier run before the timeout was raised.");
  });

  it("renders helper live transcript lines across generating, manual, and active-worker states", () => {
    const generating = buildLiveTranscriptLines(makeSession({
      suggestion: { kind: "generating" } as any,
      managed: { awaitingInput: true } as any,
    }), 60, 1);
    expect(generating.map((line) => line.text).join("\n")).toContain("Thinking");

    const manual = buildLiveTranscriptLines(makeSession({
      suggestion: { kind: "manual-input", draft: "reply" } as any,
      managed: { awaitingInput: true } as any,
    }), 60, 0);
    expect(manual.map((line) => line.text).join("\n")).toContain("On deck to reply.");

    const working = buildLiveTranscriptLines(makeSession({
      status: "active",
      currentToolUse: "command_execution",
      currentToolDetail: null,
      suggestion: { kind: "idle" },
      managed: { awaitingInput: false } as any,
    }), 60, 2);
    expect(working.map((line) => line.text).join("\n")).toContain("Running shell commands now");
  });

  it("builds raw lines with tabs, blanks, and wrapped content", () => {
    const lines = buildRawLines(["\talpha", "", "beta beta beta beta"], 10);
    const text = lines.map((line) => line.text).join("\n");
    expect(text).toContain("alpha");
    expect(text).toContain("\n\n");
    expect(text).toContain("beta beta");
  });

  it("shows waiting message when there is no active session", () => {
    const { lastFrame } = render(<SessionOutput session={null} />);
    expect(lastFrame()).toContain("Waiting for output...");
  });

  it("renders transcript rows with remote and local labels", () => {
    const session = makeSession({
      status: "waiting",
      managed: {
        awaitingInput: true,
        profile: {
          name: "claude-code",
          command: "claude",
          args: [],
          protocol: "claude",
          runtime: {
            tuningMode: "auto",
            model: "claude-opus-4-6",
            reasoningEffort: "high",
            permissionMode: "auto",
          },
        },
        monitor: {
          getLastCommandPreview: () => 'claude --model claude-opus-4-6 -p "<prompt>"',
          getLastPrompt: () => "Investigate the failing webhook tests and keep the fix narrow.",
        },
        lastResponderCommand: 'claude --model claude-opus-4-6 --effort medium -p "<prompt>"',
        lastResponderPrompt: "Suggest the best next message to send back to the worker.",
        lastResponderStrategy: "auto-frontend",
        lastResponderRuntimeSummary: "claude · claude-opus-4-6 · medium · auto",
        lastResponderRationale: "Lower reasoning keeps UI and iteration loops moving faster.",
        lastWorkerRuntimeSummary: "claude · claude-opus-4-6 · high · auto",
        lastWorkerRuntimeStrategy: "auto-managed",
        lastWorkerRuntimeRationale: "Roscoe can retune model and reasoning within the locked provider before the next Guild turn.",
      } as any,
      timeline: [
        {
          id: "r1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "claude",
          text: "Implemented the fix.",
        },
        {
          id: "l1",
          kind: "local-sent",
          timestamp: 2,
          text: "Run one final pass.",
          delivery: "approved",
          confidence: 88,
          reasoning: "The worker says the feature is complete.",
        },
      ],
    });
    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Guild · claude");
    expect(frame).toContain("Roscoe · approved · 88/100");
    expect(frame).toContain("Implemented the fix.");
    expect(frame).toContain("Run one final pass.");
    expect(frame).toContain("Why: The worker says the feature is");
    expect(frame).toContain("complete.");
    expect(frame).not.toContain("GUILD PROJ CLI");
    expect(frame).not.toContain("ROSCOE CLI");
    expect(frame).not.toContain("Provider: locked to claude");
  });

  it("renders tool and error events as left-aligned system notes", () => {
    const session = makeSession({
      status: "waiting",
      managed: {
        awaitingInput: true,
        profile: {
          name: "claude-code",
          command: "claude",
          args: [],
          protocol: "claude",
          runtime: {
            tuningMode: "auto",
            model: "claude-opus-4-6",
            reasoningEffort: "high",
            permissionMode: "auto",
          },
        },
        monitor: {
          getLastCommandPreview: () => 'claude --model claude-opus-4-6 -p "<prompt>"',
          getLastPrompt: () => "Investigate the failing webhook tests and keep the fix narrow.",
        },
        lastResponderCommand: 'claude --model claude-opus-4-6 --effort medium -p "<prompt>"',
        lastResponderPrompt: "Suggest the best next message to send back to the worker.",
        lastResponderStrategy: "auto-frontend",
        lastResponderRuntimeSummary: "claude · claude-opus-4-6 · medium · auto",
        lastResponderRationale: "Lower reasoning keeps UI and iteration loops moving faster.",
        lastWorkerRuntimeSummary: "claude · claude-opus-4-6 · high · auto",
        lastWorkerRuntimeStrategy: "auto-managed",
        lastWorkerRuntimeRationale: "Roscoe can retune model and reasoning within the locked provider before the next Guild turn.",
      } as any,
      timeline: [
        {
          id: "t1",
          kind: "tool-activity",
          timestamp: 3,
          provider: "twilio",
          toolName: "sms",
          text: "Sent the latest question to the operator for confirmation.",
        },
        {
          id: "e1",
          kind: "error",
          timestamp: 4,
          text: "Roscoe sidecar timed out after 60s before it produced a reply.",
          source: "sidecar",
        },
      ],
    });
    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Roscoe action");
    expect(frame).toContain("Sent the latest question");
    expect(frame).toContain("Roscoe error");
    const toolLine = frame.split("\n").find((line) => line.includes("Roscoe action"));
    expect(toolLine).toMatch(/^\s*│\s*• Roscoe action/);
  });

  it("renders preview notes in the transcript", () => {
    const session = makeSession({
      timeline: [
        {
          id: "p1",
          kind: "preview",
          timestamp: 5,
          state: "ready",
          text: "Preview ready. Open http://localhost:3000 and inspect the current app state.",
          link: "http://localhost:3000",
        },
      ],
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Preview ready");
    expect(frame).toContain("http://localhost:3000");
  });

  it("renders markdown tables inside transcript bubbles", () => {
    const session = makeSession({
      status: "waiting",
      managed: {
        awaitingInput: true,
      } as any,
      timeline: [
        {
          id: "r1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "claude",
          text: "| File | Lines |\n|---|---|\n| src/app.tsx | 120 |",
        },
      ],
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Guild");
    expect(frame).toContain("┌");
    expect(frame).toContain("src/app.tsx");
    expect(frame).not.toContain("|---|---|");
  });

  it("lets wide markdown tables use the full transcript pane width", () => {
    const session = makeSession({
      status: "waiting",
      managed: {
        awaitingInput: true,
      } as any,
      timeline: [
        {
          id: "r-wide",
          kind: "remote-turn",
          timestamp: 1,
          provider: "claude",
          text: [
            "## Operator Flow vs. Existing E2E Coverage",
            "",
            "| Flow Stage | Proof Test | E2E Test | Status |",
            "| --- | --- | --- | --- |",
            "| Authenticated entry | -- | control-room-authenticated-entry | Covered |",
          ].join("\n"),
        },
      ],
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Operator Flow vs. Existing E2E Coverage");
    expect(frame).toContain("Authenticated entry");
    expect(frame).toContain("control-room-authenticated-entry");
    expect(frame).toMatch(/╭─{60,}╮/);
  });

  it("humanizes the live Guild activity bubble instead of showing the raw tool id", () => {
    const session = makeSession({
      status: "active",
      currentToolUse: "command_execution",
      managed: {
        awaitingInput: false,
      } as any,
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Running shell commands now");
    expect(frame).not.toContain("command_execution");
  });

  it("shows detailed live Guild command previews when available", () => {
    const session = makeSession({
      status: "active",
      currentToolUse: "Bash",
      currentToolDetail: 'bash · rg -n "tool-use" src',
      managed: {
        awaitingInput: false,
      } as any,
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain('bash · rg -n "tool-use" src');
    expect(frame).not.toContain("Running shell commands now");
  });

  it("shows resume guidance instead of the generic working placeholder after relaunch", () => {
    const session = makeSession({
      status: "active",
      currentToolUse: "resume",
      currentToolDetail: "Resuming interrupted Guild turn...",
      managed: {
        awaitingInput: false,
      } as any,
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Resuming interrupted Guild turn...");
    expect(frame).not.toContain("Working now");
  });

  it("shows compact test activity notes instead of repeating the generic agent label", () => {
    const session = makeSession({
      timeline: [
        {
          id: "tool-1",
          kind: "tool-activity",
          timestamp: 1,
          provider: "claude",
          toolName: "Agent",
          text: "tests · chat-interface",
        },
      ],
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Guild tool · tests · chat-interface");
    expect(frame).not.toContain("Guild tool · delegating work");
    expect(frame).not.toContain("Using Agent");
  });

  it("labels Roscoe-triggered interruption notes as Roscoe actions", () => {
    const session = makeSession({
      timeline: [
        {
          id: "interrupt-1",
          kind: "tool-activity",
          timestamp: 1,
          provider: "roscoe",
          toolName: "interrupt",
          text: "Roscoe interrupted the current Guild turn and handed control back to you.",
        },
      ],
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Roscoe action · Roscoe interrupted the current Guild turn");
    expect(frame).not.toContain("Guild tool · Roscoe interrupted");
  });

  it("renders raw mode with wrapped raw line counts", () => {
    const session = makeSession({
      viewMode: "raw",
      outputLines: ["| severity | issue |", "| high | width handling |"],
    });
    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("raw");
    expect(frame).toContain("2 lines");
    expect(frame).toContain("| severity | issue |");
  });

  it("renders saved raw JSON drafts as parsed hold decisions", () => {
    const session = makeSession({
      managed: {
        profile: {
          name: "codex",
          command: "codex",
          args: [],
          protocol: "codex",
          runtime: {
            tuningMode: "auto",
            model: "gpt-5.4",
            reasoningEffort: "high",
            sandboxMode: "danger-full-access",
            approvalPolicy: "never",
          },
        },
        monitor: {
          getLastCommandPreview: () => 'codex exec "<prompt>"',
          getLastPrompt: () => '{"message":"","confidence":99,"reasoning":"Wait for writability.","orchestratorActions":[]}',
        },
        lastResponderCommand: 'codex exec --json "<prompt>"',
        lastResponderPrompt: "Suggest the best next message to send back to the worker.",
        lastResponderStrategy: "auto",
        lastResponderRuntimeSummary: "codex · gpt-5.4 · high · auto",
        lastResponderRationale: "Use the stronger responder when needed.",
        lastWorkerRuntimeSummary: "codex · gpt-5.4 · high · auto",
        lastWorkerRuntimeStrategy: "auto-managed",
        lastWorkerRuntimeRationale: "Roscoe can retune inside the locked provider.",
      } as any,
      timeline: [
        {
          id: "l1",
          kind: "local-suggestion",
          timestamp: 1,
          text: '{"message":"","confidence":99,"reasoning":"Wait for writability.","orchestratorActions":[]}',
          confidence: 99,
          reasoning: "Wait for writability.",
          state: "pending",
        },
        {
          id: "e1",
          kind: "error",
          timestamp: 2,
          text: "Sidecar timed out after 30s",
          source: "sidecar",
        },
      ],
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("Roscoe hold · 99/100");
    expect(frame).toContain("Roscoe recommends holding the Guild reply for now.");
    expect(frame).toContain("Roscoe sidecar timed out after 30s in an earlier run");
    expect(frame).not.toContain('{"message":');
    expect(frame).not.toContain("Sidecar timed out after 30s");
  });

  it("shows only the latest pending hold suggestion in the transcript", () => {
    const session = makeSession({
      timeline: [
        {
          id: "old",
          kind: "local-suggestion",
          timestamp: 1,
          text: "",
          confidence: 99,
          reasoning: "old hold",
          state: "pending",
        },
        {
          id: "new",
          kind: "local-suggestion",
          timestamp: 2,
          text: "",
          confidence: 98,
          reasoning: "latest hold",
          state: "pending",
        },
      ],
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("latest hold");
    expect(frame).not.toContain("old hold");
    expect((frame.match(/Roscoe hold/g) ?? [])).toHaveLength(1);
  });

  it("shows a history hint when a resumed live transcript has earlier conversation above", () => {
    const session = makeSession({
      timeline: Array.from({ length: 40 }, (_, index) => ({
        id: `r${index}`,
        kind: "remote-turn" as const,
        timestamp: index + 1,
        provider: "codex",
        text: `Guild turn ${index + 1}: tighten the proof path without widening scope.`,
      })),
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame).toContain("history above");
    expect(frame).toContain("Press ↑ to review the prior conversation.");
  });

  it("renders transcript bubbles in timestamp order when persisted entries were appended out of order", () => {
    const session = makeSession({
      status: "active",
      managed: {
        awaitingInput: false,
      } as any,
      timeline: [
        {
          id: "roscoe-1",
          kind: "local-sent",
          timestamp: 30,
          text: "Keep the fix narrow and rerun the targeted spec.",
          delivery: "auto",
          confidence: 94,
          reasoning: "The next proof step is already isolated.",
        },
        {
          id: "guild-1",
          kind: "remote-turn",
          timestamp: 20,
          provider: "codex",
          text: "I ran the targeted spec and isolated the next blocker.",
          activity: "command_execution",
        },
      ],
    });

    const { lastFrame } = render(<SessionOutput session={session} sessionLabel="proj:main" />);
    const frame = lastFrame()!;
    expect(frame.indexOf("I ran the targeted spec and isolated the next blocker."))
      .toBeLessThan(frame.indexOf("Keep the fix narrow and rerun the targeted spec."));
  });
});
