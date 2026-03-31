import { describe, expect, it } from "vitest";
import {
  compactRedundantParkedConversation,
  getInterruptedExitRecoveryPlan,
  getRestoreRecoveryPlan,
  getRestoredSuggestionPhase,
  hasTerminalParkedExchange,
  hasBoundedFutureWorkSignal,
  inferAwaitingInput,
  inferTerminalParkedState,
  isParkedAcknowledgementText,
  isParkedDecisionText,
  isPauseAcknowledgementText,
  sortTranscriptEntries,
} from "./session-transcript.js";

describe("isPauseAcknowledgementText", () => {
  it("recognizes a bare pause acknowledgement", () => {
    expect(isPauseAcknowledgementText("Paused.")).toBe(true);
    expect(isPauseAcknowledgementText("paused")).toBe(true);
  });

  it("recognizes a blocked-state pause acknowledgement with a short status prefix", () => {
    expect(isPauseAcknowledgementText("Still down. Paused.")).toBe(true);
    expect(isPauseAcknowledgementText("Still blocked. Paused.")).toBe(true);
  });

  it("recognizes a staged-command pause acknowledgement without re-opening the lane", () => {
    expect(
      isPauseAcknowledgementText(
        "Still down. Paused. Staged command ready: E2E_BASE_URL=http://127.0.0.1:6100 ...",
      ),
    ).toBe(true);
  });

  it("does not treat unrelated paused wording as a pause acknowledgement", () => {
    expect(isPauseAcknowledgementText("Paused the dev server and reran the tests.")).toBe(false);
    expect(isPauseAcknowledgementText("Not paused anymore.")).toBe(false);
  });

  it("handles blocked and waiting prefixes plus nullish input safely", () => {
    expect(isPauseAcknowledgementText("Blocked on review. Paused.")).toBe(true);
    expect(isPauseAcknowledgementText("Waiting on CI. Paused.")).toBe(true);
    expect(isPauseAcknowledgementText(null)).toBe(false);
    expect(isPauseAcknowledgementText(undefined)).toBe(false);
  });
});

describe("isParkedDecisionText", () => {
  it("recognizes parked conclusions", () => {
    expect(isParkedDecisionText("Parked.")).toBe(true);
    expect(isParkedDecisionText("This lane is parked.")).toBe(true);
    expect(isParkedDecisionText("Lane is parked cleanly. Nothing else to send.")).toBe(true);
  });

  it("does not treat unrelated text as parked", () => {
    expect(isParkedDecisionText("Parking lot notes updated.")).toBe(false);
    expect(isParkedDecisionText("No new work yet.")).toBe(false);
  });
});

describe("hasTerminalParkedExchange", () => {
  it("recognizes a parked Roscoe handoff echoed back by Guild", () => {
    expect(hasTerminalParkedExchange([
      {
        id: "l1",
        kind: "local-sent",
        timestamp: 1,
        text: "Parked.",
        delivery: "auto",
      },
      {
        id: "r1",
        kind: "remote-turn",
        timestamp: 2,
        provider: "codex",
        text: "Parked.",
      },
    ])).toBe(true);
  });

  it("does not mark a parked exchange as terminal when a pending suggestion exists", () => {
    expect(hasTerminalParkedExchange([
      {
        id: "l1",
        kind: "local-sent",
        timestamp: 1,
        text: "Parked.",
        delivery: "auto",
      },
      {
        id: "pending",
        kind: "local-suggestion",
        timestamp: 2,
        text: "Reopen this lane.",
        confidence: 72,
        reasoning: "new work exists",
        state: "pending",
      },
      {
        id: "r1",
        kind: "remote-turn",
        timestamp: 3,
        provider: "codex",
        text: "Parked.",
      },
    ])).toBe(false);
  });
});

describe("isParkedAcknowledgementText", () => {
  it("recognizes parked acknowledgements that are not just a bare parked decision", () => {
    expect(isParkedAcknowledgementText("Acknowledged. Waiting for the next lane delta.")).toBe(true);
    expect(isParkedAcknowledgementText("Understood. No-op. Lane remains parked at `a539c3a` with CI green.")).toBe(true);
    expect(isParkedAcknowledgementText("Nothing to direct. Lane parked.")).toBe(true);
  });

  it("returns false for nullish parked text inputs", () => {
    expect(isParkedAcknowledgementText(null)).toBe(false);
    expect(isParkedDecisionText(undefined)).toBe(false);
  });
});

describe("inferTerminalParkedState", () => {
  it("treats a parked summary as a terminal parked state on restore", () => {
    expect(inferTerminalParkedState([], "Parked.")).toBe(true);
  });

  it("treats a parked acknowledgement tail as a terminal parked state", () => {
    expect(inferTerminalParkedState([
      {
        id: "r1",
        kind: "remote-turn",
        timestamp: 1,
        provider: "codex",
        text: "Acknowledged. Waiting for the next lane delta.",
      },
    ])).toBe(true);
  });

  it("does not let a stale parked summary override a newer substantive turn", () => {
    expect(inferTerminalParkedState([
      {
        id: "local-1",
        kind: "local-sent",
        timestamp: 1,
        text: "Parked.",
        delivery: "auto",
      },
      {
        id: "remote-1",
        kind: "remote-turn",
        timestamp: 2,
        provider: "codex",
        text: "I’m tightening the Fly adapter around the one missing readiness guarantee and then I’ll report back.",
      },
    ], "Parked.")).toBe(false);
  });
});

describe("compactRedundantParkedConversation", () => {
  it("collapses repeated parked echo loops down to the latest pair", () => {
    const entries = compactRedundantParkedConversation([
      {
        id: "l1",
        kind: "local-sent",
        timestamp: 1,
        text: "Parked.",
        delivery: "auto",
      },
      {
        id: "r1",
        kind: "remote-turn",
        timestamp: 2,
        provider: "codex",
        text: "Parked.",
      },
      {
        id: "l2",
        kind: "local-sent",
        timestamp: 3,
        text: "Parked.",
        delivery: "auto",
      },
      {
        id: "r2",
        kind: "remote-turn",
        timestamp: 4,
        provider: "codex",
        text: "Parked.",
      },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: "l2" });
    expect(entries[1]).toMatchObject({ id: "r2" });
  });

  it("preserves non-parked entries around a compacted parked run", () => {
    const entries = compactRedundantParkedConversation([
      { id: "start", kind: "remote-turn", timestamp: 1, provider: "codex", text: "Working." },
      { id: "l1", kind: "local-sent", timestamp: 2, text: "Parked.", delivery: "auto" },
      { id: "r1", kind: "remote-turn", timestamp: 3, provider: "codex", text: "Parked." },
      { id: "l2", kind: "local-sent", timestamp: 4, text: "Parked.", delivery: "auto" },
      { id: "r2", kind: "remote-turn", timestamp: 5, provider: "codex", text: "Parked." },
      { id: "end", kind: "remote-turn", timestamp: 6, provider: "codex", text: "Next slice reopened." },
    ] as any);

    expect(entries.map((entry) => entry.id)).toEqual(["start", "l2", "r2", "end"]);
  });
});

describe("additional transcript helpers", () => {
  it("sorts entries by timestamp while preserving insertion order for ties", () => {
    const sorted = sortTranscriptEntries([
      { id: "b", kind: "remote-turn", timestamp: 2, provider: "codex", text: "second" },
      { id: "a", kind: "remote-turn", timestamp: 1, provider: "codex", text: "first" },
      { id: "c", kind: "local-sent", timestamp: 2, text: "third", delivery: "auto" },
    ] as any);

    expect(sorted.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("detects bounded future work from recent conversation text", () => {
    expect(hasBoundedFutureWorkSignal([
      { id: "r1", kind: "remote-turn", timestamp: 1, provider: "codex", text: "Remaining work: the next slice is the deployment thread." },
    ] as any)).toBe(true);
    expect(hasBoundedFutureWorkSignal([
      { id: "r2", kind: "remote-turn", timestamp: 1, provider: "codex", text: "Feature complete and verified." },
    ] as any)).toBe(false);
  });

  it("infers awaiting input from the last conversation state", () => {
    expect(inferAwaitingInput([], null)).toBe(true);
    expect(inferAwaitingInput([
      { id: "remote", kind: "remote-turn", timestamp: 1, provider: "codex", text: "Need a response." },
    ] as any, null)).toBe(true);
    expect(inferAwaitingInput([
      { id: "pending", kind: "local-suggestion", timestamp: 2, text: "reply", confidence: 80, reasoning: "ready", state: "pending" },
    ] as any, null)).toBe(true);
    expect(inferAwaitingInput([
      { id: "sent", kind: "local-sent", timestamp: 3, text: "sent", delivery: "auto" },
    ] as any, null)).toBe(false);
    expect(inferAwaitingInput([
      { id: "remote", kind: "remote-turn", timestamp: 4, provider: "codex", text: "Need a response." },
    ] as any, "bash")).toBe(false);
  });

  it("builds restore recovery plans for both restage and resume flows", () => {
    const restage = getRestoreRecoveryPlan([
      { id: "sent", kind: "local-sent", timestamp: 1, text: "Tighten the readiness check and report back.", delivery: "auto" },
    ] as any, null, null);
    expect(restage).toEqual({
      mode: "restage-roscoe",
      note: "Roscoe restored this lane after restart and is restaging the interrupted Guild turn from the last stable handoff.",
    });

    const resume = getRestoreRecoveryPlan([
      { id: "sent", kind: "local-sent", timestamp: 1, text: "Tighten the readiness check and report back.", delivery: "auto" },
    ] as any, "provider-session", "command_execution");
    expect(resume?.mode).toBe("resume-worker");
    if (resume?.mode === "resume-worker") {
      expect(resume.prompt).toContain("during command execution");
      expect(resume.prompt).toContain("Last stable Roscoe handoff: Tighten the readiness check and report back.");
      expect(resume.note).toContain("command execution");
    }
  });

  it("returns no restore recovery plan when the last entry was not a Roscoe handoff and truncates long handoffs", () => {
    expect(getRestoreRecoveryPlan([
      { id: "remote", kind: "remote-turn", timestamp: 1, provider: "codex", text: "Need input." },
    ] as any, "provider-session", null)).toBeNull();

    const resume = getRestoreRecoveryPlan([
      { id: "sent", kind: "local-sent", timestamp: 1, text: "A".repeat(400), delivery: "auto" },
    ] as any, "provider-session", null);
    expect(resume?.mode).toBe("resume-worker");
    if (resume?.mode === "resume-worker") {
      expect(resume.prompt).toContain("Last stable Roscoe handoff:");
      expect(resume.prompt).toContain("...");
    }
  });

  it("builds interrupted-exit recovery plans for both restage and resume flows", () => {
    const restage = getInterruptedExitRecoveryPlan([
      { id: "sent", kind: "local-sent", timestamp: 1, text: "Ship the next proof slice.", delivery: "auto" },
    ] as any, null, null);
    expect(restage).toEqual({
      mode: "restage-roscoe",
      note: "Roscoe detected that the Guild turn exited before reporting back and is restaging from the last stable handoff.",
    });

    const resume = getInterruptedExitRecoveryPlan([
      { id: "sent", kind: "local-sent", timestamp: 1, text: "Ship the next proof slice.", delivery: "auto" },
    ] as any, "provider-session", "resume");
    expect(resume?.mode).toBe("resume-worker");
    if (resume?.mode === "resume-worker") {
      expect(resume.prompt).toContain("The Guild turn exited before reporting back during resume.");
      expect(resume.note).toContain("during resume");
    }
  });

  it("returns no interrupted-exit recovery plan when the last entry was not a Roscoe handoff", () => {
    expect(getInterruptedExitRecoveryPlan([
      { id: "remote", kind: "remote-turn", timestamp: 1, provider: "codex", text: "Still running." },
    ] as any, "provider-session", "bash")).toBeNull();
  });

  it("restores pending suggestions and falls back to idle when none remain", () => {
    expect(getRestoredSuggestionPhase([
      { id: "pending", kind: "local-suggestion", timestamp: 1, text: "Review this", confidence: 91, reasoning: "clear", state: "pending" },
    ] as any)).toEqual({
      kind: "ready",
      result: {
        text: "Review this",
        confidence: 91,
        reasoning: "clear",
      },
    });

    expect(getRestoredSuggestionPhase([
      { id: "dismissed", kind: "local-suggestion", timestamp: 1, text: "Dismissed", confidence: 40, reasoning: "nope", state: "dismissed" },
    ] as any)).toEqual({ kind: "idle" });
  });
});
