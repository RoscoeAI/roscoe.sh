import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { SessionList } from "./session-list.js";
import { SessionState } from "../types.js";

function makeSession(id: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    id,
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

describe("SessionList", () => {
  it("shows empty state when no lanes", () => {
    const { lastFrame } = render(
      <SessionList sessions={new Map()} activeSessionId={null} />,
    );
    expect(lastFrame()).toContain("No lanes");
  });

  it("renders lane entries", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        profileName: "claude",
        projectName: "myapp",
        summary: "Mapped the next backend dependency and queued the export fix",
      })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" width={80} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("myapp");
    expect(frame).toContain("main repo");
    expect(frame).toContain("Mapped the next backend");
    expect(frame).toContain("One live lane.");
    expect(frame).toContain("Press h for");
    expect(frame).toContain("dispatch.");
  });

  it("shows worktree name for non-main branches", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", { worktreeName: "feat-auth" })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" width={80} />,
    );
    expect(lastFrame()).toContain("worktree feat-auth");
  });

  it("shows a single concise status line instead of runtime metadata", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        projectName: "operator-console",
        worktreeName: "stripe-check",
        summary: "Pinned the failing test to the shell-only path and reran the proof",
      })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" width={28} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("stripe-check");
    expect(frame).toContain("Pinned the failing");
    expect(frame).not.toContain("gpt-5.4");
    expect(frame).not.toContain("auto");
  });

  it("shows live tool activity when a lane is actively working", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        summary: "Old summary",
        currentToolUse: "command_execution",
      })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Guild");
    expect(frame).toContain("running shell commands");
    expect(frame).not.toContain("Old summary");
  });

  it("shows switch guidance only when there are multiple lanes", () => {
    const sessions = new Map([
      ["s1", makeSession("s1")],
      ["s2", makeSession("s2", { projectName: "api" })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Tab");
    expect(frame).toContain("Press h for dispatch");
  });

  it("shows the latest blocker detail instead of a stale summary for blocked lanes", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        status: "blocked",
        summary: "Built derived-state roundtrip contract tests with 100% coverage",
        timeline: [
          { id: "r1", kind: "remote-turn", timestamp: 1, provider: "claude", text: "Still down. The blocker is unchanged — sandbox denies `npm run dev` and no server is reachable on 127.0.0.1:6100." },
        ],
      })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Still down. The blocker is");
    expect(frame).not.toContain("Built derived-state");
  });

  it("falls back to a sensible latest update when there is no summary yet", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        timeline: [
          { id: "sug-1", kind: "local-suggestion", timestamp: 1, text: "reply", confidence: 92, reasoning: "clear", state: "pending" },
        ],
      })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" />,
    );
    expect(lastFrame()).toContain("Roscoe draft ready for review");
  });

  it("shows sensible fallback statuses for paused, review, parked, and exited lanes", () => {
    const sessions = new Map([
      ["paused", makeSession("paused", { status: "paused" })],
      ["review", makeSession("review", { status: "review" })],
      ["parked", makeSession("parked", { status: "parked" })],
      ["exited", makeSession("exited", { status: "exited" })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="paused" />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Paused");
    expect(frame).toContain("Needs review");
    expect(frame).toContain("Parked cleanly");
    expect(frame).toContain("Ended");
  });

  it("shows dynamic fallback states for generating, ready, editing, awaiting input, and just-started lanes", () => {
    const sessions = new Map([
      ["gen", makeSession("gen", { suggestion: { kind: "generating" } })],
      ["ready", makeSession("ready", { suggestion: { kind: "ready", text: "draft", confidence: 90, reasoning: "clear" } as any })],
      ["editing", makeSession("editing", { suggestion: { kind: "editing", text: "reply" } as any })],
      ["awaiting", makeSession("awaiting", { managed: { awaitingInput: true } as any })],
      ["fresh", makeSession("fresh", { managed: { awaitingInput: false } as any })],
    ]);

    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="gen" />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Roscoe drafting a reply");
    expect(frame).toContain("Roscoe draft ready for review");
    expect(frame).toContain("Reply in progress");
    expect(frame).toContain("Waiting for the next turn");
    expect(frame).toContain("Just started");
  });

  it("uses the latest timeline entry when there is no summary or live tool activity", () => {
    const sessions = new Map([
      ["error", makeSession("error", {
        id: "error",
        timeline: [
          { id: "err-1", kind: "error", timestamp: 1, text: "Build failed" },
        ] as any,
      })],
      ["remote-activity", makeSession("remote-activity", {
        id: "remote-activity",
        timeline: [
          { id: "remote-1", kind: "remote-turn", timestamp: 1, provider: "codex", text: "Working", activity: "bash · pnpm test" },
        ] as any,
      })],
      ["remote-basic", makeSession("remote-basic", {
        id: "remote-basic",
        timeline: [
          { id: "remote-2", kind: "remote-turn", timestamp: 1, provider: "codex", text: "Done" },
        ] as any,
      })],
      ["local-sent", makeSession("local-sent", {
        id: "local-sent",
        timeline: [
          { id: "sent-1", kind: "local-sent", timestamp: 1, text: "Ship it", delivery: "manual" },
        ] as any,
      })],
      ["tool", makeSession("tool", {
        id: "tool",
        timeline: [
          { id: "tool-1", kind: "tool-activity", timestamp: 1, provider: "roscoe", toolName: "bash", text: "pnpm test" },
        ] as any,
      })],
    ]);

    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="error" />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Build failed");
    expect(frame).toContain("Codex · bash · pnpm test");
    expect(frame).toContain("Codex replied");
    expect(frame).toContain("You sent the reply");
    expect(frame).toContain("Guild · pnpm test");
  });

  it("falls back to the blocked summary when all remote turns are terse pause acknowledgements", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        status: "blocked",
        summary: "Blocked waiting for environment",
        timeline: [
          { id: "r1", kind: "remote-turn", timestamp: 1, provider: "claude", text: "Paused." },
          { id: "r2", kind: "remote-turn", timestamp: 2, provider: "claude", text: "Still down. Paused." },
        ],
      })],
    ]);

    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Blocked waiting for");
  });
});
