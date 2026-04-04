import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { SuggestionBar } from "./suggestion-bar.js";
import { SuggestionPhase } from "../types.js";

const noop = vi.fn();
const defaultProps = {
  autoMode: false,
  autoSendThreshold: 70,
  onSubmitEdit: noop,
  onSubmitManual: noop,
};

describe("SuggestionBar", () => {
  it("shows monitoring message in idle phase", () => {
    const { lastFrame } = render(
      <SuggestionBar phase={{ kind: "idle" }} {...defaultProps} />,
    );
    expect(lastFrame()).toContain("Lane working...");
  });

  it("shows an explicit blocked hold state instead of a fake working message", () => {
    const { lastFrame } = render(
      <SuggestionBar
        phase={{ kind: "idle" }}
        sessionStatus="blocked"
        sessionSummary="Still down. Paused."
        {...defaultProps}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Lane Blocked");
    expect(frame).toContain("Guild reported a blocker");
    expect(frame).toContain("Still down. Paused.");
    expect(frame).toContain("This is a blocker hold, not preview mode.");
    expect(frame).toContain("[p]");
    expect(frame).toContain("resume");
    expect(frame).toContain("[m]");
    expect(frame).toContain("type a message");
    expect(frame).not.toContain("Lane working...");
  });

  it("explains safe-mode permission blockers in the blocked hold state", () => {
    const { lastFrame } = render(
      <SuggestionBar
        phase={{ kind: "idle" }}
        sessionStatus="blocked"
        sessionSummary="Blocker unchanged: 127.0.0.1:6100 is not reachable. The sandbox permission gate continues to deny `npm run dev`."
        {...defaultProps}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("safe mode");
    expect(frame).toContain("Guild execution");
    expect(frame).toContain("to accelerated");
    expect(frame).toContain("broader than Git");
  });

  it("shows an explicit parked state for clean Roscoe holds", () => {
    const { lastFrame } = render(
      <SuggestionBar
        phase={{ kind: "idle" }}
        sessionStatus="parked"
        sessionSummary="Lane is parked. Both sides confirmed, nothing to send."
        {...defaultProps}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Lane Parked");
    expect(frame).toContain("clean parking state");
    expect(frame).toContain("nothing to send");
    expect(frame).toContain("[p]");
  });

  it("shows an explicit waiting state after a dismissed review draft", () => {
    const { lastFrame } = render(
      <SuggestionBar
        phase={{ kind: "idle" }}
        sessionStatus="waiting"
        sessionSummary="Committed fixes and verified coverage, tests, and build on `e008b1a`."
        {...defaultProps}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Lane Waiting");
    expect(frame).toContain("not running anything");
    expect(frame).toContain("Committed fixes and verified coverage");
    expect(frame).toContain("Nothing is currently running.");
    expect(frame).toContain("[m]");
    expect(frame).toContain("[h]");
    expect(frame).not.toContain("[p]");
    expect(frame).not.toContain("Lane working...");
  });

  it("shows a parked panel when a stale waiting status still carries a parked summary", () => {
    const { lastFrame } = render(
      <SuggestionBar
        phase={{ kind: "idle" }}
        sessionStatus="waiting"
        sessionSummary="Parked."
        {...defaultProps}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Lane Parked");
    expect(frame).toContain("clean parking state");
    expect(frame).not.toContain("Lane Waiting");
  });

  it("does not show the waiting hold copy when live tool activity has already resumed", () => {
    const { lastFrame } = render(
      <SuggestionBar
        phase={{ kind: "idle" }}
        sessionStatus="waiting"
        sessionSummary="Committed fixes and verified coverage, tests, and build on `e008b1a`."
        toolActivity="Bash"
        toolActivityDetail='bash · /bin/zsh -lc "pwd && rg --files ..."'
        canInterruptActiveTurn={true}
        {...defaultProps}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("Lane Waiting");
    expect(frame).not.toContain("Nothing is currently running.");
    expect(frame).toContain('bash · /bin/zsh -lc "pwd && rg --files ..."');
    expect(frame).toContain("[x]");
    expect(frame).toContain("[b]");
  });

  it("shows detailed resume status in idle phase when a lane is being restored", () => {
    const { lastFrame } = render(
      <SuggestionBar
        phase={{ kind: "idle" }}
        toolActivity="resume"
        toolActivityDetail="Resuming interrupted Guild turn..."
        {...defaultProps}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Resuming interrupted Guild turn...");
    expect(frame).not.toContain("Lane working...");
  });

  it("shows an interrupt hint while a lane is actively working", () => {
    const { lastFrame } = render(
      <SuggestionBar
        phase={{ kind: "idle" }}
        toolActivity="Agent"
        toolActivityDetail="tests · chat-interface"
        canInterruptActiveTurn={true}
        {...defaultProps}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("[x]");
    expect(frame).toContain("interrupt");
    expect(frame).toContain("[b]");
    expect(frame).toContain("preview");
  });

  it("shows spinner in generating phase", () => {
    const { lastFrame } = render(
      <SuggestionBar phase={{ kind: "generating" }} {...defaultProps} />,
    );
    expect(lastFrame()).toContain("Thinking...");
  });

  it("shows partial text alongside spinner when available", () => {
    const { lastFrame } = render(
      <SuggestionBar phase={{ kind: "generating", partial: '{"message": "working on it' }} {...defaultProps} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Thinking...");
    expect(frame).toContain('"message": "working on it');
  });

  it("shows suggestion text and confidence in ready phase", () => {
    const phase: SuggestionPhase = {
      kind: "ready",
      result: { text: "Do the thing", confidence: 85, reasoning: "clear context" },
    };
    const { lastFrame } = render(
      <SuggestionBar phase={phase} {...defaultProps} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Do the thing");
    expect(frame).toContain("85/100");
    expect(frame).toContain("approval required");
    expect(frame).toContain("[a] send");
  });

  it("renders parsed hold decisions instead of raw JSON", () => {
    const phase: SuggestionPhase = {
      kind: "ready",
      result: {
        text: '{"message":"","confidence":99,"reasoning":"Wait for writability.","orchestratorActions":[]}',
        confidence: 99,
        reasoning: "Wait for writability.",
      },
    };
    const { lastFrame } = render(
      <SuggestionBar phase={phase} {...defaultProps} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Roscoe recommends holding the Guild reply for now.");
    expect(frame).not.toContain('{"message":');
  });

  it("shows auto-send language instead of approval controls in auto mode", () => {
    const phase: SuggestionPhase = {
      kind: "ready",
      result: { text: "Ship the patch.", confidence: 85, reasoning: "clear next step" },
    };
    const { lastFrame } = render(
      <SuggestionBar phase={phase} {...defaultProps} autoMode={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("AUTO is on. Roscoe will send this to the Guild unless you override it.");
    expect(frame).toContain("auto send");
    expect(frame).not.toContain("approval required");
    expect(frame).not.toContain("[a] send");
    expect(frame).toContain("[r] hold");
  });

  it("shows auto-hold language for empty drafts in auto mode", () => {
    const phase: SuggestionPhase = {
      kind: "ready",
      result: { text: "", confidence: 99, reasoning: "Stay silent." },
    };
    const { lastFrame } = render(
      <SuggestionBar phase={phase} {...defaultProps} autoMode={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("AUTO is on. Roscoe is holding the Guild reply unless you override it.");
    expect(frame).toContain("auto hold");
    expect(frame).not.toContain("[a] send");
    expect(frame).toContain("[m] manual override");
  });

  it("still requires review in auto mode below the send threshold", () => {
    const phase: SuggestionPhase = {
      kind: "ready",
      result: { text: "Maybe do it.", confidence: 69, reasoning: "not quite certain" },
    };
    const { lastFrame } = render(
      <SuggestionBar phase={phase} {...defaultProps} autoMode={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("still needs review");
    expect(frame).toContain("needs review");
    expect(frame).toContain("[a] send");
  });

  it("still requires review in auto mode when Roscoe explicitly marks the draft needs-review", () => {
    const phase: SuggestionPhase = {
      kind: "ready",
      result: {
        decision: "needs-review",
        text: "Guild pushed `aa29d5a` to `test` — I've reviewed the diff and this is the summary for the developer.",
        confidence: 90,
        reasoning: "This is a developer-facing summary, not a message to auto-send back to the Guild.",
      },
    };
    const { lastFrame } = render(
      <SuggestionBar phase={phase} {...defaultProps} autoMode={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("marked this draft for review before anything is sent");
    expect(frame).toContain("review draft");
    expect(frame).not.toContain("Roscoe will send this to the Guild unless you override it.");
    expect(frame).toContain("[a] send");
  });

  it("shows a persistent blocked state for empty auto-holds", () => {
    const phase: SuggestionPhase = {
      kind: "auto-sent",
      text: "",
      confidence: 99,
    };
    const { lastFrame } = render(
      <SuggestionBar phase={phase} {...defaultProps} autoMode={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Nothing was sent to the Guild");
    expect(frame).toContain("Roscoe auto-held the Guild reply.");
    expect(frame).toContain("waiting on you");
    expect(frame).toContain("[m] manual override");
  });

  it("shows error message in error phase", () => {
    const phase: SuggestionPhase = { kind: "error", message: "API timeout" };
    const { lastFrame } = render(
      <SuggestionBar phase={phase} {...defaultProps} />,
    );
    expect(lastFrame()).toContain("API timeout");
    expect(lastFrame()).toContain("[m]");
  });

  it("shows manual input prompt in manual-input phase", () => {
    const { lastFrame } = render(
      <SuggestionBar phase={{ kind: "manual-input" }} {...defaultProps} />,
    );
    expect(lastFrame()).toContain("Message to Guild");
    expect(lastFrame()).toContain("[Esc]");
  });

  it("falls back to the original draft when editing submits an empty value", async () => {
    const onSubmitEdit = vi.fn();
    const app = render(
      <SuggestionBar
        phase={{ kind: "editing", original: "Keep going." }}
        {...defaultProps}
        onSubmitEdit={onSubmitEdit}
      />,
    );

    try {
      app.stdin.write("\r");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onSubmitEdit).toHaveBeenCalledWith("Keep going.");
    } finally {
      app.unmount();
    }
  });

  it("shows preview handoff controls while a preview break is active", () => {
    const { lastFrame } = render(
      <SuggestionBar
        phase={{ kind: "idle" }}
        preview={{
          mode: "ready",
          message: "Preview ready. Open http://localhost:3000, inspect the app, then continue.",
          link: "http://localhost:3000",
        }}
        {...defaultProps}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Preview Break");
    expect(frame).toContain("Preview ready. Open http://localhost:3000");
    expect(frame).toContain("http://localhost:3000");
    expect(frame).toContain("[c] continue");
    expect(frame).toContain("[b] clear preview");
    expect(frame).not.toContain("Lane working...");
  });

  it("shows a force-preview escape hatch while a preview break is queued", () => {
    const { lastFrame } = render(
      <SuggestionBar
        phase={{ kind: "idle" }}
        preview={{
          mode: "queued",
          message: "Preview queued. Roscoe will stop this lane at the next clean handoff and hold there until you continue.",
          link: null,
        }}
        canInterruptActiveTurn={true}
        {...defaultProps}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("[x]");
    expect(frame).toContain("force preview");
    expect(frame).toContain("[b] clear preview");
  });
});
