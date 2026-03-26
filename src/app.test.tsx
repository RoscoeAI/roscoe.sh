import { describe, it, expect } from "vitest";
import { appReducer } from "./app.js";
import { AppState, SessionState, AppAction } from "./types.js";

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    screen: "home",
    previousScreen: null,
    sessions: new Map(),
    activeSessionId: null,
    autoMode: false,
    onboardingRequest: null,
    sessionSetupProjectDir: null,
    ...overrides,
  };
}

function makeSession(id: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    id,
    profileName: "test",
    projectName: "proj",
    worktreeName: "main",
    status: "active",
    outputLines: [],
    suggestion: { kind: "idle" },
    managed: {} as any,
    summary: null,
    currentToolUse: null,
    timeline: [],
    viewMode: "transcript",
    scrollOffset: 0,
    followLive: true,
    ...overrides,
  };
}

function stateWithSession(id: string, sessionOverrides: Partial<SessionState> = {}): AppState {
  const session = makeSession(id, sessionOverrides);
  const sessions = new Map([[id, session]]);
  return makeState({ sessions, activeSessionId: id });
}

describe("appReducer", () => {
  describe("SET_SCREEN", () => {
    it("changes screen and remembers the previous screen", () => {
      const result = appReducer(makeState(), { type: "SET_SCREEN", screen: "session-view" });
      expect(result.screen).toBe("session-view");
      expect(result.previousScreen).toBe("home");
    });

    it("does nothing when setting the same screen", () => {
      const state = makeState();
      const result = appReducer(state, { type: "SET_SCREEN", screen: "home" });
      expect(result).toBe(state);
    });
  });

  describe("GO_BACK", () => {
    it("returns to the previous screen when available", () => {
      const state = makeState({ screen: "onboarding", previousScreen: "session-setup" });
      const result = appReducer(state, { type: "GO_BACK" });
      expect(result.screen).toBe("session-setup");
      expect(result.previousScreen).toBeNull();
    });

    it("falls back to home when there is no previous screen", () => {
      const state = makeState({ screen: "onboarding", previousScreen: null });
      const result = appReducer(state, { type: "GO_BACK" });
      expect(result.screen).toBe("home");
    });
  });

  describe("ADD_SESSION", () => {
    it("adds session and sets it active if no active session", () => {
      const session = makeSession("s1");
      const result = appReducer(makeState(), { type: "ADD_SESSION", session });
      expect(result.sessions.has("s1")).toBe(true);
      expect(result.activeSessionId).toBe("s1");
    });

    it("does not change active session if one already exists", () => {
      const state = stateWithSession("existing");
      const newSession = makeSession("s2");
      const result = appReducer(state, { type: "ADD_SESSION", session: newSession });
      expect(result.activeSessionId).toBe("existing");
    });
  });

  describe("REMOVE_SESSION", () => {
    it("removes session from map", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "REMOVE_SESSION", id: "s1" });
      expect(result.sessions.has("s1")).toBe(false);
    });

    it("selects next session when active is removed", () => {
      const sessions = new Map([
        ["s1", makeSession("s1")],
        ["s2", makeSession("s2")],
      ]);
      const state = makeState({ sessions, activeSessionId: "s1" });
      const result = appReducer(state, { type: "REMOVE_SESSION", id: "s1" });
      expect(result.activeSessionId).toBe("s2");
    });

    it("sets activeSessionId to null when last session removed", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "REMOVE_SESSION", id: "s1" });
      expect(result.activeSessionId).toBeNull();
    });
  });

  describe("SET_ACTIVE", () => {
    it("sets active session id", () => {
      const result = appReducer(makeState(), { type: "SET_ACTIVE", id: "s1" });
      expect(result.activeSessionId).toBe("s1");
    });
  });

  describe("UPDATE_SESSION_STATUS", () => {
    it("updates session status", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "UPDATE_SESSION_STATUS", id: "s1", status: "waiting" });
      expect(result.sessions.get("s1")!.status).toBe("waiting");
    });

    it("returns unchanged state for unknown session", () => {
      const state = makeState();
      const result = appReducer(state, { type: "UPDATE_SESSION_STATUS", id: "unknown", status: "waiting" });
      expect(result).toBe(state);
    });
  });

  describe("APPEND_OUTPUT", () => {
    it("appends lines to output", () => {
      const state = stateWithSession("s1", { outputLines: ["line1"] });
      const result = appReducer(state, { type: "APPEND_OUTPUT", id: "s1", lines: ["line2", "line3"] });
      expect(result.sessions.get("s1")!.outputLines).toEqual(["line1", "line2", "line3"]);
    });

    it("replaces last line when replaceLastLine is true", () => {
      const state = stateWithSession("s1", { outputLines: ["line1", "old"] });
      const result = appReducer(state, { type: "APPEND_OUTPUT", id: "s1", lines: ["new"], replaceLastLine: true });
      expect(result.sessions.get("s1")!.outputLines).toEqual(["line1", "new"]);
    });

    it("caps output at 500 lines", () => {
      const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
      const state = stateWithSession("s1", { outputLines: lines });
      const result = appReducer(state, { type: "APPEND_OUTPUT", id: "s1", lines: ["overflow"] });
      expect(result.sessions.get("s1")!.outputLines).toHaveLength(500);
    });
  });

  describe("SET_OUTPUT", () => {
    it("replaces all output lines", () => {
      const state = stateWithSession("s1", { outputLines: ["old"] });
      const result = appReducer(state, { type: "SET_OUTPUT", id: "s1", lines: ["new1", "new2"] });
      expect(result.sessions.get("s1")!.outputLines).toEqual(["new1", "new2"]);
    });

    it("caps at 500 lines", () => {
      const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "SET_OUTPUT", id: "s1", lines });
      expect(result.sessions.get("s1")!.outputLines).toHaveLength(500);
    });
  });

  describe("START_GENERATING", () => {
    it("sets status to generating and suggestion to generating", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "START_GENERATING", id: "s1" });
      expect(result.sessions.get("s1")!.status).toBe("generating");
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("generating");
    });
  });

  describe("SUGGESTION_READY", () => {
    it("sets status to waiting and stores result", () => {
      const state = stateWithSession("s1", { status: "generating" });
      const result = appReducer(state, {
        type: "SUGGESTION_READY",
        id: "s1",
        result: { text: "do it", confidence: 85, reasoning: "clear" },
      });
      expect(result.sessions.get("s1")!.status).toBe("waiting");
      const suggestion = result.sessions.get("s1")!.suggestion;
      expect(suggestion.kind).toBe("ready");
      if (suggestion.kind === "ready") {
        expect(suggestion.result.text).toBe("do it");
        expect(suggestion.result.confidence).toBe(85);
      }
      expect(result.sessions.get("s1")!.timeline).toHaveLength(1);
      expect(result.sessions.get("s1")!.timeline[0]).toMatchObject({
        kind: "local-suggestion",
        text: "do it",
        confidence: 85,
      });
    });
  });

  describe("SUGGESTION_ERROR", () => {
    it("sets status to waiting with error message", () => {
      const state = stateWithSession("s1", { status: "generating" });
      const result = appReducer(state, { type: "SUGGESTION_ERROR", id: "s1", message: "timeout" });
      expect(result.sessions.get("s1")!.status).toBe("waiting");
      const suggestion = result.sessions.get("s1")!.suggestion;
      expect(suggestion.kind).toBe("error");
      if (suggestion.kind === "error") {
        expect(suggestion.message).toBe("timeout");
      }
      expect(result.sessions.get("s1")!.timeline.at(-1)).toMatchObject({
        kind: "error",
        text: "timeout",
      });
    });
  });

  describe("APPROVE_SUGGESTION / SUBMIT_TEXT", () => {
    it("resets to active/idle on approve", () => {
      const state = stateWithSession("s1", {
        status: "waiting",
        suggestion: { kind: "ready", result: { text: "x", confidence: 90, reasoning: "clear" } },
        timeline: [{
          id: "t1",
          kind: "local-suggestion",
          timestamp: 1,
          text: "x",
          confidence: 90,
          reasoning: "clear",
          state: "pending",
        }],
      });
      const result = appReducer(state, { type: "APPROVE_SUGGESTION", id: "s1" });
      expect(result.sessions.get("s1")!.status).toBe("active");
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("idle");
      expect(result.sessions.get("s1")!.timeline[0]).toMatchObject({
        kind: "local-sent",
        delivery: "approved",
        confidence: 90,
      });
    });

    it("resets to active/idle on submit text", () => {
      const state = stateWithSession("s1", { suggestion: { kind: "manual-input" } });
      const result = appReducer(state, { type: "SUBMIT_TEXT", id: "s1", text: "manual", delivery: "manual" });
      expect(result.sessions.get("s1")!.status).toBe("active");
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("idle");
      expect(result.sessions.get("s1")!.timeline.at(-1)).toMatchObject({
        kind: "local-sent",
        text: "manual",
        delivery: "manual",
      });
    });
  });

  describe("START_EDIT", () => {
    it("transitions from ready to editing with original text", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "ready", result: { text: "original", confidence: 80, reasoning: "" } },
      });
      const result = appReducer(state, { type: "START_EDIT", id: "s1" });
      const suggestion = result.sessions.get("s1")!.suggestion;
      expect(suggestion.kind).toBe("editing");
      if (suggestion.kind === "editing") {
        expect(suggestion.original).toBe("original");
      }
    });

    it("does nothing if suggestion is not ready", () => {
      const state = stateWithSession("s1", { suggestion: { kind: "idle" } });
      const result = appReducer(state, { type: "START_EDIT", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("idle");
    });
  });

  describe("REJECT_SUGGESTION", () => {
    it("resets suggestion to idle", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "ready", result: { text: "x", confidence: 90, reasoning: "" } },
      });
      const result = appReducer(state, { type: "REJECT_SUGGESTION", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("idle");
    });
  });

  describe("START_MANUAL", () => {
    it("sets suggestion to manual-input", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "START_MANUAL", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("manual-input");
    });
  });

  describe("SET_AUTO_MODE", () => {
    it("enables auto mode", () => {
      const result = appReducer(makeState(), { type: "SET_AUTO_MODE", enabled: true });
      expect(result.autoMode).toBe(true);
    });

    it("disables auto mode", () => {
      const result = appReducer(makeState({ autoMode: true }), { type: "SET_AUTO_MODE", enabled: false });
      expect(result.autoMode).toBe(false);
    });
  });

  describe("PAUSE_SESSION", () => {
    it("sets status to paused", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "PAUSE_SESSION", id: "s1" });
      expect(result.sessions.get("s1")!.status).toBe("paused");
    });
  });

  describe("RESUME_SESSION", () => {
    it("sets status to active and resets suggestion", () => {
      const state = stateWithSession("s1", { status: "paused" });
      const result = appReducer(state, { type: "RESUME_SESSION", id: "s1" });
      expect(result.sessions.get("s1")!.status).toBe("active");
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("idle");
    });
  });

  describe("SET_SUMMARY", () => {
    it("sets session summary", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "SET_SUMMARY", id: "s1", summary: "Fixed the bug" });
      expect(result.sessions.get("s1")!.summary).toBe("Fixed the bug");
    });
  });

  describe("SET_TOOL_ACTIVITY", () => {
    it("sets current tool use", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "SET_TOOL_ACTIVITY", id: "s1", toolName: "Read" });
      expect(result.sessions.get("s1")!.currentToolUse).toBe("Read");
    });

    it("clears tool use with null", () => {
      const state = stateWithSession("s1", { currentToolUse: "Write" });
      const result = appReducer(state, { type: "SET_TOOL_ACTIVITY", id: "s1", toolName: null });
      expect(result.sessions.get("s1")!.currentToolUse).toBeNull();
    });
  });

  describe("timeline and viewport actions", () => {
    it("appends remote turns to the timeline", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, {
        type: "APPEND_TIMELINE_ENTRY",
        id: "s1",
        entry: {
          id: "r1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "claude",
          text: "Implemented the fix",
        },
      });
      expect(result.sessions.get("s1")!.timeline).toHaveLength(1);
      expect(result.sessions.get("s1")!.timeline[0]).toMatchObject({
        kind: "remote-turn",
        text: "Implemented the fix",
      });
    });

    it("changes session view mode", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, {
        type: "SET_SESSION_VIEW_MODE",
        id: "s1",
        viewMode: "raw",
      });
      expect(result.sessions.get("s1")!.viewMode).toBe("raw");
    });

    it("tracks scroll offset away from live", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, {
        type: "SCROLL_SESSION_VIEW",
        id: "s1",
        delta: 8,
      });
      expect(result.sessions.get("s1")!.scrollOffset).toBe(8);
      expect(result.sessions.get("s1")!.followLive).toBe(false);
    });

    it("returns to live", () => {
      const state = stateWithSession("s1", { scrollOffset: 5, followLive: false });
      const result = appReducer(state, {
        type: "RETURN_TO_LIVE",
        id: "s1",
      });
      expect(result.sessions.get("s1")!.scrollOffset).toBe(0);
      expect(result.sessions.get("s1")!.followLive).toBe(true);
    });
  });

  describe("UPDATE_PARTIAL", () => {
    it("updates partial text during generating phase", () => {
      const state = stateWithSession("s1", {
        status: "generating",
        suggestion: { kind: "generating" },
      });
      const result = appReducer(state, {
        type: "UPDATE_PARTIAL",
        id: "s1",
        partial: "partial text so far",
      });
      const suggestion = result.sessions.get("s1")!.suggestion;
      expect(suggestion.kind).toBe("generating");
      if (suggestion.kind === "generating") {
        expect(suggestion.partial).toBe("partial text so far");
      }
    });

    it("ignores update if suggestion is not in generating phase", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "ready", result: { text: "x", confidence: 90, reasoning: "" } },
      });
      const result = appReducer(state, {
        type: "UPDATE_PARTIAL",
        id: "s1",
        partial: "stale partial",
      });
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("ready");
    });

    it("ignores update for unknown session", () => {
      const state = makeState();
      const result = appReducer(state, {
        type: "UPDATE_PARTIAL",
        id: "unknown",
        partial: "text",
      });
      expect(result).toBe(state);
    });
  });

  describe("default case", () => {
    it("returns state unchanged for unknown action", () => {
      const state = makeState();
      const result = appReducer(state, { type: "UNKNOWN" } as any);
      expect(result).toBe(state);
    });
  });
});
