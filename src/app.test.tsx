import { describe, it, expect } from "vitest";
import { appReducer, formatLaneScopeLabel, getBackgroundLaneSessions, getRunningLaneTurnSignal } from "./app.js";
import { AppState, SessionState, AppAction } from "./types.js";

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    screen: "home",
    previousScreen: null,
    sessions: new Map(),
    activeSessionId: null,
    autoMode: false,
    autoModeConfigured: false,
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
    pendingOperatorMessages: [],
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

  describe("navigation actions", () => {
    it("opens session setup and remembers the current screen", () => {
      const state = makeState({ screen: "home" });
      const result = appReducer(state, {
        type: "OPEN_SESSION_SETUP",
        projectDir: "/tmp/appsicle",
      });

      expect(result.screen).toBe("session-setup");
      expect(result.previousScreen).toBe("home");
      expect(result.sessionSetupProjectDir).toBe("/tmp/appsicle");
    });

    it("opens onboarding and stores the onboarding request", () => {
      const result = appReducer(makeState({ screen: "home" }), {
        type: "OPEN_ONBOARDING",
        request: { dir: "/tmp/appsicle", mode: "refine", refineThemes: ["definition-of-done"] },
      });

      expect(result.screen).toBe("onboarding");
      expect(result.onboardingRequest).toMatchObject({
        dir: "/tmp/appsicle",
        mode: "refine",
      });
    });

    it("opens setup/onboarding with null request payloads when no project or onboarding request is provided", () => {
      const sessionSetup = appReducer(makeState({ screen: "session-view" }), {
        type: "OPEN_SESSION_SETUP",
      });
      expect(sessionSetup.screen).toBe("session-setup");
      expect(sessionSetup.sessionSetupProjectDir).toBeNull();

      const onboarding = appReducer(makeState({ screen: "home" }), {
        type: "OPEN_ONBOARDING",
      });
      expect(onboarding.screen).toBe("onboarding");
      expect(onboarding.onboardingRequest).toBeNull();
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

    it("initializes pending operator messages to an empty queue", () => {
      const session = makeSession("s1");
      const result = appReducer(makeState(), { type: "ADD_SESSION", session });
      expect(result.sessions.get("s1")!.pendingOperatorMessages).toEqual([]);
    });

    it("preserves existing pending operator messages and contract fingerprints", () => {
      const session = makeSession("s1", {
        pendingOperatorMessages: [
          { id: "sms-1", text: "keep going", via: "sms", from: "+15551234567", receivedAt: 1 },
        ],
        contractFingerprint: "fingerprint-1",
      });
      const result = appReducer(makeState(), { type: "ADD_SESSION", session });
      expect(result.sessions.get("s1")!.pendingOperatorMessages).toHaveLength(1);
      expect(result.sessions.get("s1")!.contractFingerprint).toBe("fingerprint-1");
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

    it("keeps the current active lane when removing a different lane", () => {
      const sessions = new Map([
        ["s1", makeSession("s1")],
        ["s2", makeSession("s2")],
      ]);
      const state = makeState({ sessions, activeSessionId: "s1" });
      const result = appReducer(state, { type: "REMOVE_SESSION", id: "s2" });
      expect(result.activeSessionId).toBe("s1");
    });

    it("returns to dispatch when the last lane is removed from session view", () => {
      const state = makeState({
        screen: "session-view",
        previousScreen: "home",
        sessions: new Map([["s1", makeSession("s1")]]),
        activeSessionId: "s1",
        sessionSetupProjectDir: "/tmp/proj",
      });

      const result = appReducer(state, { type: "REMOVE_SESSION", id: "s1" });
      expect(result.activeSessionId).toBeNull();
      expect(result.screen).toBe("home");
      expect(result.previousScreen).toBeNull();
      expect(result.sessionSetupProjectDir).toBeNull();
    });
  });

  describe("SET_ACTIVE", () => {
    it("sets active session id", () => {
      const result = appReducer(makeState(), { type: "SET_ACTIVE", id: "s1" });
      expect(result.activeSessionId).toBe("s1");
    });
  });

  describe("preview break actions", () => {
    it("queues a preview break and records the queue note", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, {
        type: "QUEUE_PREVIEW_BREAK",
        id: "s1",
        message: "Preview queued. Roscoe will stop at the next clean handoff.",
      });

      const session = result.sessions.get("s1")!;
      expect(session.preview).toMatchObject({ mode: "queued" });
      expect(session.timeline.at(-1)).toMatchObject({
        kind: "preview",
        state: "queued",
      });
    });

    it("activates a preview break and clears it on continue", () => {
      const queued = appReducer(stateWithSession("s1"), {
        type: "ACTIVATE_PREVIEW_BREAK",
        id: "s1",
        message: "Preview ready. Open http://localhost:3000.",
        link: "http://localhost:3000",
      });

      const activatedSession = queued.sessions.get("s1")!;
      expect(activatedSession.preview).toMatchObject({
        mode: "ready",
        link: "http://localhost:3000",
      });
      expect(activatedSession.timeline.at(-1)).toMatchObject({
        kind: "preview",
        state: "ready",
      });

      const cleared = appReducer(queued, { type: "CLEAR_PREVIEW_BREAK", id: "s1" });
      expect(cleared.sessions.get("s1")!.preview).toMatchObject({ mode: "off" });
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

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "APPEND_OUTPUT", id: "missing", lines: ["x"] })).toBe(state);
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

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "SET_OUTPUT", id: "missing", lines: ["x"] })).toBe(state);
    });
  });

  describe("START_GENERATING", () => {
    it("sets status to generating and suggestion to generating", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "START_GENERATING", id: "s1" });
      expect(result.sessions.get("s1")!.status).toBe("generating");
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("generating");
    });

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "START_GENERATING", id: "missing" })).toBe(state);
    });
  });

  describe("SUGGESTION_READY", () => {
    it("sets status to review and stores result", () => {
      const state = stateWithSession("s1", { status: "generating" });
      const result = appReducer(state, {
        type: "SUGGESTION_READY",
        id: "s1",
        result: { text: "do it", confidence: 85, reasoning: "clear" },
      });
      expect(result.sessions.get("s1")!.status).toBe("review");
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

    it("replaces older pending suggestions instead of stacking them", () => {
      const state = stateWithSession("s1", {
        status: "generating",
        timeline: [
          {
            id: "old-pending",
            kind: "local-suggestion",
            timestamp: 1,
            text: "",
            confidence: 99,
            reasoning: "stay silent",
            state: "pending",
          },
        ],
      });
      const result = appReducer(state, {
        type: "SUGGESTION_READY",
        id: "s1",
        result: { text: "", confidence: 98, reasoning: "still blocked" },
      });
      expect(result.sessions.get("s1")!.timeline).toHaveLength(1);
      expect(result.sessions.get("s1")!.timeline[0]).toMatchObject({
        kind: "local-suggestion",
        confidence: 98,
        reasoning: "still blocked",
        state: "pending",
      });
    });

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, {
        type: "SUGGESTION_READY",
        id: "missing",
        result: { text: "do it", confidence: 90, reasoning: "clear" },
      })).toBe(state);
    });
  });

  describe("INVALIDATE_SESSION_CONTRACT", () => {
    it("clears stale review drafts when the saved contract changes", () => {
      const state = stateWithSession("s1", {
        status: "review",
        managed: { awaitingInput: false } as any,
        contractFingerprint: "old",
        suggestion: {
          kind: "ready",
          result: { text: "park it", confidence: 90, reasoning: "looks done" },
        },
        timeline: [{
          id: "suggestion-1",
          kind: "local-suggestion",
          timestamp: 1,
          text: "park it",
          confidence: 90,
          reasoning: "looks done",
          state: "pending",
        }],
      });

      const result = appReducer(state, {
        type: "INVALIDATE_SESSION_CONTRACT",
        id: "s1",
        contractFingerprint: "new",
        reason: "Saved project contract changed.",
      });

      const session = result.sessions.get("s1")!;
      expect(session.contractFingerprint).toBe("new");
      expect(session.status).toBe("waiting");
      expect(session.suggestion.kind).toBe("idle");
      expect(session.managed.awaitingInput).toBe(true);
      expect(session.timeline.find((entry) => entry.kind === "local-suggestion" && entry.state === "pending")).toBeUndefined();
      expect(session.timeline.at(-1)).toMatchObject({
        kind: "tool-activity",
        toolName: "contract",
      });
    });
  });

  describe("SUGGESTION_ERROR", () => {
    it("sets status to review with error message", () => {
      const state = stateWithSession("s1", { status: "generating" });
      const result = appReducer(state, { type: "SUGGESTION_ERROR", id: "s1", message: "timeout" });
      expect(result.sessions.get("s1")!.status).toBe("review");
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

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "SUGGESTION_ERROR", id: "missing", message: "timeout" })).toBe(state);
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

    it("keeps a queued preview armed while sending more lane instructions", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "manual-input" },
        preview: {
          mode: "queued",
          message: "Preview queued.",
          link: null,
        },
      });
      const result = appReducer(state, { type: "SUBMIT_TEXT", id: "s1", text: "one more step", delivery: "manual" });
      expect(result.sessions.get("s1")!.preview).toMatchObject({
        mode: "queued",
      });
    });

    it("preserves scroll offset when approving while not following live and ignores unknown sessions", () => {
      const state = stateWithSession("s1", {
        followLive: false,
        scrollOffset: 7,
        suggestion: { kind: "ready", result: { text: "x", confidence: 90, reasoning: "clear" } },
        timeline: [{
          id: "t1",
          kind: "remote-turn",
          timestamp: 0,
          provider: "codex",
          text: "context",
        }, {
          id: "t2",
          kind: "local-suggestion",
          timestamp: 1,
          text: "x",
          confidence: 90,
          reasoning: "clear",
          state: "pending",
        }],
      });

      const approved = appReducer(state, { type: "APPROVE_SUGGESTION", id: "s1" });
      expect(approved.sessions.get("s1")!.scrollOffset).toBe(7);

      const empty = makeState();
      expect(appReducer(empty, { type: "APPROVE_SUGGESTION", id: "missing" })).toBe(empty);
      expect(appReducer(empty, {
        type: "SUBMIT_TEXT",
        id: "missing",
        text: "manual",
        delivery: "manual",
      })).toBe(empty);
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
        expect(suggestion.previous?.kind).toBe("ready");
      }
    });

    it("does nothing if suggestion is not ready", () => {
      const state = stateWithSession("s1", { suggestion: { kind: "idle" } });
      const result = appReducer(state, { type: "START_EDIT", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("idle");
    });

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "START_EDIT", id: "missing" })).toBe(state);
    });
  });

  describe("REJECT_SUGGESTION", () => {
    it("resets suggestion to idle and returns the lane to waiting", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "ready", result: { text: "x", confidence: 90, reasoning: "" } },
        status: "review",
      });
      const result = appReducer(state, { type: "REJECT_SUGGESTION", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("idle");
      expect(result.sessions.get("s1")!.status).toBe("waiting");
    });

    it("dismisses the latest pending local suggestion in the timeline", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "ready", result: { text: "x", confidence: 90, reasoning: "" } },
        status: "review",
        timeline: [{
          id: "pending-1",
          kind: "local-suggestion",
          timestamp: 1,
          text: "x",
          confidence: 90,
          reasoning: "",
          state: "pending",
        }],
      });

      const result = appReducer(state, { type: "REJECT_SUGGESTION", id: "s1" });
      expect(result.sessions.get("s1")!.timeline[0]).toMatchObject({
        kind: "local-suggestion",
        state: "dismissed",
      });
    });

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "REJECT_SUGGESTION", id: "missing" })).toBe(state);
    });
  });

  describe("START_MANUAL", () => {
    it("sets suggestion to manual-input", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "START_MANUAL", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("manual-input");
    });

    it("remembers the previous ready suggestion so Esc can restore it", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "ready", result: { text: "Ship it", confidence: 91, reasoning: "done" } },
      });
      const result = appReducer(state, { type: "START_MANUAL", id: "s1" });
      const suggestion = result.sessions.get("s1")!.suggestion;
      expect(suggestion.kind).toBe("manual-input");
      if (suggestion.kind === "manual-input") {
        expect(suggestion.previous).toEqual({
          kind: "ready",
          result: { text: "Ship it", confidence: 91, reasoning: "done" },
        });
      }
    });

    it("falls back to an idle return phase when manual input starts from a non-restorable suggestion", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "editing", original: "x", previous: undefined },
      });
      const result = appReducer(state, { type: "START_MANUAL", id: "s1" });
      const suggestion = result.sessions.get("s1")!.suggestion;
      expect(suggestion.kind).toBe("manual-input");
      if (suggestion.kind === "manual-input") {
        expect(suggestion.previous).toEqual({ kind: "idle" });
      }
    });

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "START_MANUAL", id: "missing" })).toBe(state);
    });
  });

  describe("CANCEL_TEXT_ENTRY", () => {
    it("restores a ready suggestion after cancelling edit mode", () => {
      const state = stateWithSession("s1", {
        suggestion: {
          kind: "editing",
          original: "Tighten the failing tests.",
          previous: {
            kind: "ready",
            result: { text: "Tighten the failing tests.", confidence: 87, reasoning: "clear blocker" },
          },
        },
      });
      const result = appReducer(state, { type: "CANCEL_TEXT_ENTRY", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion).toEqual({
        kind: "ready",
        result: { text: "Tighten the failing tests.", confidence: 87, reasoning: "clear blocker" },
      });
    });

    it("restores an error after cancelling manual mode", () => {
      const state = stateWithSession("s1", {
        suggestion: {
          kind: "manual-input",
          previous: { kind: "error", message: "Roscoe sidecar timed out." },
        },
      });
      const result = appReducer(state, { type: "CANCEL_TEXT_ENTRY", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion).toEqual({
        kind: "error",
        message: "Roscoe sidecar timed out.",
      });
    });

    it("falls back to idle when there is nothing to restore", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "manual-input" },
      });
      const result = appReducer(state, { type: "CANCEL_TEXT_ENTRY", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion).toEqual({ kind: "idle" });
    });

    it("rebuilds the ready suggestion from the latest timeline draft when no previous state exists", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "manual-input" },
        timeline: [{
          id: "pending-1",
          kind: "local-suggestion",
          timestamp: 1,
          text: "  Keep going.  ",
          confidence: 92,
          reasoning: "clear next step",
          state: "pending",
        }],
      });

      const result = appReducer(state, { type: "CANCEL_TEXT_ENTRY", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion).toEqual({
        kind: "ready",
        result: {
          text: "  Keep going.  ",
          confidence: 92,
          reasoning: "clear next step",
        },
      });
    });

    it("returns unchanged state for unknown sessions and non-editable suggestions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "CANCEL_TEXT_ENTRY", id: "missing" })).toBe(state);

      const idleState = stateWithSession("s1", {
        suggestion: { kind: "idle" },
      });
      expect(appReducer(idleState, { type: "CANCEL_TEXT_ENTRY", id: "s1" })).toBe(idleState);
    });
  });

  describe("SET_AUTO_MODE", () => {
    it("enables auto mode", () => {
      const result = appReducer(makeState(), { type: "SET_AUTO_MODE", enabled: true });
      expect(result.autoMode).toBe(true);
      expect(result.autoModeConfigured).toBe(true);
    });

    it("disables auto mode", () => {
      const result = appReducer(makeState({ autoMode: true, autoModeConfigured: true }), { type: "SET_AUTO_MODE", enabled: false });
      expect(result.autoMode).toBe(false);
      expect(result.autoModeConfigured).toBe(true);
    });
  });

  describe("AUTO_SENT", () => {
    it("keeps an empty auto-hold in parked state", () => {
      const state = stateWithSession("s1", {
        status: "waiting",
        suggestion: { kind: "ready", result: { text: "", confidence: 99, reasoning: "blocked" } },
        timeline: [{
          id: "t1",
          kind: "local-suggestion",
          timestamp: 1,
          text: "",
          confidence: 99,
          reasoning: "blocked",
          state: "pending",
        }],
      });
      const result = appReducer(state, { type: "AUTO_SENT", id: "s1", text: "", confidence: 99 });
      expect(result.sessions.get("s1")!.status).toBe("parked");
      expect(result.sessions.get("s1")!.suggestion).toEqual({ kind: "auto-sent", text: "", confidence: 99 });
      expect(result.sessions.get("s1")!.timeline.at(-1)).toMatchObject({
        kind: "local-sent",
        delivery: "auto",
        text: "",
      });
    });

    it("keeps a queued preview armed across a non-empty auto-send", () => {
      const state = stateWithSession("s1", {
        status: "waiting",
        preview: {
          mode: "queued",
          message: "Preview queued.",
          link: null,
        },
        suggestion: { kind: "ready", result: { text: "Run the focused proof.", confidence: 96, reasoning: "clear next step" } },
        timeline: [{
          id: "t1",
          kind: "local-suggestion",
          timestamp: 1,
          text: "Run the focused proof.",
          confidence: 96,
          reasoning: "clear next step",
          state: "pending",
        }],
      });
      const result = appReducer(state, { type: "AUTO_SENT", id: "s1", text: "Run the focused proof.", confidence: 96 });
      expect(result.sessions.get("s1")!.preview).toMatchObject({
        mode: "queued",
      });
    });

    it("parks the lane when Roscoe auto-sends a parked conclusion", () => {
      const state = stateWithSession("s1", {
        status: "waiting",
        suggestion: { kind: "ready", result: { text: "Parked.", confidence: 97, reasoning: "no delta" } },
        timeline: [{
          id: "t1",
          kind: "local-suggestion",
          timestamp: 1,
          text: "Parked.",
          confidence: 97,
          reasoning: "no delta",
          state: "pending",
        }],
      });

      const result = appReducer(state, { type: "AUTO_SENT", id: "s1", text: "Parked.", confidence: 97 });
      expect(result.sessions.get("s1")!.status).toBe("parked");
    });
  });

  describe("CLEAR_AUTO_SENT", () => {
    it("clears auto-sent suggestions back to idle", () => {
      const state = stateWithSession("s1", {
        suggestion: { kind: "auto-sent", text: "continue", confidence: 92 },
      });

      const result = appReducer(state, { type: "CLEAR_AUTO_SENT", id: "s1" });
      expect(result.sessions.get("s1")!.suggestion).toEqual({ kind: "idle" });
    });

    it("does nothing if the suggestion is not auto-sent", () => {
      const state = stateWithSession("s1", { suggestion: { kind: "idle" } });
      expect(appReducer(state, { type: "CLEAR_AUTO_SENT", id: "s1" })).toBe(state);
    });

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "CLEAR_AUTO_SENT", id: "missing" })).toBe(state);
    });
  });

  describe("PAUSE_SESSION", () => {
    it("sets status to paused", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "PAUSE_SESSION", id: "s1" });
      expect(result.sessions.get("s1")!.status).toBe("paused");
    });

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "PAUSE_SESSION", id: "missing" })).toBe(state);
    });
  });

  describe("RESUME_SESSION", () => {
    it("sets status to active and resets suggestion", () => {
      const state = stateWithSession("s1", { status: "paused" });
      const result = appReducer(state, { type: "RESUME_SESSION", id: "s1" });
      expect(result.sessions.get("s1")!.status).toBe("active");
      expect(result.sessions.get("s1")!.suggestion.kind).toBe("idle");
    });

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "RESUME_SESSION", id: "missing" })).toBe(state);
    });
  });

  describe("BLOCK_SESSION", () => {
    it("sets the lane status to blocked", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "BLOCK_SESSION", id: "s1" });
      expect(result.sessions.get("s1")!.status).toBe("blocked");
    });

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "BLOCK_SESSION", id: "missing" })).toBe(state);
    });
  });

  describe("SET_SUMMARY", () => {
    it("sets session summary", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, { type: "SET_SUMMARY", id: "s1", summary: "Fixed the bug" });
      expect(result.sessions.get("s1")!.summary).toBe("Fixed the bug");
    });

    it("returns unchanged state for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, { type: "SET_SUMMARY", id: "missing", summary: "x" })).toBe(state);
    });
  });

  describe("session metrics", () => {
    it("accumulates usage totals", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, {
        type: "ADD_SESSION_USAGE",
        id: "s1",
        usage: {
          inputTokens: 10,
          outputTokens: 3,
          cachedInputTokens: 2,
          cacheCreationInputTokens: 1,
        },
      });
      expect(result.sessions.get("s1")!.usage).toEqual({
        inputTokens: 10,
        outputTokens: 3,
        cachedInputTokens: 2,
        cacheCreationInputTokens: 1,
      });
    });

    it("stores the latest rate-limit status", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, {
        type: "SET_SESSION_RATE_LIMIT",
        id: "s1",
        rateLimitStatus: {
          source: "claude",
          windowLabel: "5h",
          status: "allowed",
          resetsAt: "2026-03-26T22:00:00.000Z",
        },
      });
      expect(result.sessions.get("s1")!.rateLimitStatus).toMatchObject({
        source: "claude",
        windowLabel: "5h",
      });
    });

    it("starts usage totals from zero when the session has no prior usage snapshot", () => {
      const state = stateWithSession("s1", { usage: undefined as any });
      const result = appReducer(state, {
        type: "ADD_SESSION_USAGE",
        id: "s1",
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          cachedInputTokens: 1,
          cacheCreationInputTokens: 3,
        },
      });

      expect(result.sessions.get("s1")!.usage).toEqual({
        inputTokens: 4,
        outputTokens: 2,
        cachedInputTokens: 1,
        cacheCreationInputTokens: 3,
      });
    });

    it("returns unchanged state for unknown usage/rate-limit sessions", () => {
      const state = makeState();
      expect(appReducer(state, {
        type: "ADD_SESSION_USAGE",
        id: "missing",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      })).toBe(state);
      expect(appReducer(state, {
        type: "SET_SESSION_RATE_LIMIT",
        id: "missing",
        rateLimitStatus: null,
      })).toBe(state);
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

    it("preserves the previous detail when the same tool reports again without a new detail", () => {
      const state = stateWithSession("s1", {
        currentToolUse: "Read",
        currentToolDetail: "line 12",
      } as any);
      const result = appReducer(state, { type: "SET_TOOL_ACTIVITY", id: "s1", toolName: "Read" });
      expect(result.sessions.get("s1")!.currentToolDetail).toBe("line 12");
    });

    it("stores an explicit tool detail when one is provided", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, {
        type: "SET_TOOL_ACTIVITY",
        id: "s1",
        toolName: "Read",
        detail: "src/app.tsx",
      });
      expect(result.sessions.get("s1")!.currentToolDetail).toBe("src/app.tsx");
    });

    it("drops detail to null when a tool changes without a new detail and ignores unknown sessions", () => {
      const state = stateWithSession("s1", {
        currentToolUse: "Read",
        currentToolDetail: "line 12",
      } as any);
      const changed = appReducer(state, { type: "SET_TOOL_ACTIVITY", id: "s1", toolName: "Write" });
      expect(changed.sessions.get("s1")!.currentToolDetail).toBeNull();

      const sameToolNoDetail = appReducer(stateWithSession("s2", {
        currentToolUse: "Read",
        currentToolDetail: null,
      } as any), { type: "SET_TOOL_ACTIVITY", id: "s2", toolName: "Read" });
      expect(sameToolNoDetail.sessions.get("s2")!.currentToolDetail).toBeNull();

      const empty = makeState();
      expect(appReducer(empty, { type: "SET_TOOL_ACTIVITY", id: "missing", toolName: "Read" })).toBe(empty);
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

    it("updates the latest local suggestion state", () => {
      const state = stateWithSession("s1", {
        timeline: [{
          id: "pending-1",
          kind: "local-suggestion",
          timestamp: 1,
          text: "Keep going",
          confidence: 91,
          reasoning: "clear",
          state: "pending",
        }],
      });

      const result = appReducer(state, {
        type: "SET_LOCAL_SUGGESTION_STATE",
        id: "s1",
        state: "dismissed",
      });

      expect(result.sessions.get("s1")!.timeline[0]).toMatchObject({
        kind: "local-suggestion",
        state: "dismissed",
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

    it("queues and shifts pending operator messages", () => {
      const state = stateWithSession("s1");
      const queued = appReducer(state, {
        type: "QUEUE_OPERATOR_MESSAGE",
        id: "s1",
        message: {
          id: "sms-1",
          text: "Please keep going",
          via: "sms",
          from: "+15551234567",
          receivedAt: 123,
        },
      });
      expect(queued.sessions.get("s1")!.pendingOperatorMessages).toHaveLength(1);

      const shifted = appReducer(queued, {
        type: "SHIFT_OPERATOR_MESSAGE",
        id: "s1",
        messageId: "sms-1",
      });
      expect(shifted.sessions.get("s1")!.pendingOperatorMessages).toEqual([]);
    });

    it("does not queue duplicate operator messages and safely ignores empty shifts", () => {
      const state = stateWithSession("s1", {
        pendingOperatorMessages: [
          {
            id: "sms-1",
            text: "Please keep going",
            via: "sms",
            from: "+15551234567",
            receivedAt: 123,
          },
        ],
      });

      const duplicate = appReducer(state, {
        type: "QUEUE_OPERATOR_MESSAGE",
        id: "s1",
        message: {
          id: "sms-1",
          text: "Please keep going",
          via: "sms",
          from: "+15551234567",
          receivedAt: 123,
        },
      });
      expect(duplicate).toBe(state);

      const ignored = appReducer(stateWithSession("s2"), {
        type: "SHIFT_OPERATOR_MESSAGE",
        id: "s2",
      });
      expect(ignored.sessions.get("s2")!.pendingOperatorMessages).toEqual([]);
    });

    it("shifts the oldest operator message when no id is provided", () => {
      const state = stateWithSession("s1", {
        pendingOperatorMessages: [
          { id: "sms-1", text: "first", via: "sms", from: "+15551230001", receivedAt: 1 },
          { id: "sms-2", text: "second", via: "sms", from: "+15551230002", receivedAt: 2 },
        ],
      });

      const result = appReducer(state, {
        type: "SHIFT_OPERATOR_MESSAGE",
        id: "s1",
      });

      expect(result.sessions.get("s1")!.pendingOperatorMessages).toEqual([
        expect.objectContaining({ id: "sms-2" }),
      ]);
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

    it("keeps scroll offset clamped to zero", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, {
        type: "SCROLL_SESSION_VIEW",
        id: "s1",
        delta: -5,
      });
      expect(result.sessions.get("s1")!.scrollOffset).toBe(0);
      expect(result.sessions.get("s1")!.followLive).toBe(true);
    });

    it("returns unchanged state for unknown session timeline actions", () => {
      const state = makeState();
      expect(appReducer(state, {
        type: "APPEND_TIMELINE_ENTRY",
        id: "missing",
        entry: {
          id: "e1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "codex",
          text: "hello",
        },
      })).toBe(state);
      expect(appReducer(state, {
        type: "SET_LOCAL_SUGGESTION_STATE",
        id: "missing",
        state: "dismissed",
      })).toBe(state);
      expect(appReducer(state, {
        type: "SET_SESSION_VIEW_MODE",
        id: "missing",
        viewMode: "raw",
      })).toBe(state);
      expect(appReducer(state, {
        type: "SCROLL_SESSION_VIEW",
        id: "missing",
        delta: 1,
      })).toBe(state);
      expect(appReducer(state, {
        type: "RETURN_TO_LIVE",
        id: "missing",
      })).toBe(state);
      expect(appReducer(state, {
        type: "QUEUE_OPERATOR_MESSAGE",
        id: "missing",
        message: { id: "x", text: "msg", via: "sms", from: "+1", receivedAt: 1 },
      })).toBe(state);
      expect(appReducer(state, {
        type: "SHIFT_OPERATOR_MESSAGE",
        id: "missing",
      })).toBe(state);
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

  describe("preview break guard rails", () => {
    it("does not queue or activate duplicate preview states and ignores clearing an inactive preview", () => {
      const queuedState = stateWithSession("s1", {
        preview: { mode: "queued", message: "Preview queued.", link: null },
      });
      expect(appReducer(queuedState, {
        type: "QUEUE_PREVIEW_BREAK",
        id: "s1",
        message: "Preview queued.",
      })).toBe(queuedState);

      const readyState = stateWithSession("s1", {
        preview: { mode: "ready", message: "Open preview", link: "http://localhost:3000" },
      });
      expect(appReducer(readyState, {
        type: "ACTIVATE_PREVIEW_BREAK",
        id: "s1",
        message: "Open preview",
        link: "http://localhost:3000",
      })).toBe(readyState);

      const offState = stateWithSession("s1", {
        preview: { mode: "off", message: null, link: null },
      });
      expect(appReducer(offState, { type: "CLEAR_PREVIEW_BREAK", id: "s1" })).toBe(offState);
    });
  });

  describe("sync and response commit helpers", () => {
    it("commits a manual response while keeping the dismissed suggestion in the timeline", () => {
      const state = stateWithSession("s1", {
        timeline: [{
          id: "suggestion-1",
          kind: "local-suggestion",
          timestamp: 1,
          text: "Ship it",
          confidence: 91,
          reasoning: "done",
          state: "pending",
        }],
      });

      const result = appReducer(state, {
        type: "COMMIT_LOCAL_RESPONSE",
        id: "s1",
        delivery: "manual",
        text: "Hold this lane",
        keepSuggestion: true,
      });

      expect(result.sessions.get("s1")!.timeline).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "local-suggestion", state: "dismissed" }),
          expect.objectContaining({ kind: "local-sent", delivery: "manual", text: "Hold this lane" }),
        ]),
      );
    });

    it("safely ignores local suggestion state changes when no suggestion exists", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, {
        type: "SET_LOCAL_SUGGESTION_STATE",
        id: "s1",
        state: "dismissed",
      });

      expect(result).not.toBe(state);
      expect(result.sessions.get("s1")).toBe(state.sessions.get("s1"));
    });

    it("does not append a manual response when there is no draft and no text", () => {
      const state = stateWithSession("s1");
      const result = appReducer(state, {
        type: "COMMIT_LOCAL_RESPONSE",
        id: "s1",
        delivery: "manual",
      });

      expect(result).not.toBe(state);
      expect(result.sessions.get("s1")).toBe(state.sessions.get("s1"));
    });

    it("syncs managed session details while preserving preview state and pending operator messages", () => {
      const state = stateWithSession("s1", {
        preview: { mode: "queued", message: "Preview queued.", link: null },
        pendingOperatorMessages: [
          { id: "sms-1", text: "keep going", via: "sms", from: "+15551234567", receivedAt: 123 },
        ],
      });

      const result = appReducer(state, {
        type: "SYNC_MANAGED_SESSION",
        id: "s1",
        managed: { profileName: "codex", tracker: {}, awaitingInput: true } as any,
      });

      expect(result.sessions.get("s1")!.profileName).toBe("codex");
      expect(result.sessions.get("s1")!.preview).toMatchObject({ mode: "queued" });
      expect(result.sessions.get("s1")!.pendingOperatorMessages).toHaveLength(1);
    });

    it("syncs managed session details even when the pending operator queue is absent", () => {
      const state = stateWithSession("s1", {
        pendingOperatorMessages: undefined as any,
      });

      const result = appReducer(state, {
        type: "SYNC_MANAGED_SESSION",
        id: "s1",
        managed: { profileName: "gemini", tracker: {}, awaitingInput: false } as any,
      });

      expect(result.sessions.get("s1")!.pendingOperatorMessages).toEqual([]);
    });

    it("returns unchanged state for unknown session sync/commit actions", () => {
      const state = makeState();
      expect(appReducer(state, {
        type: "COMMIT_LOCAL_RESPONSE",
        id: "missing",
        delivery: "manual",
        text: "hello",
      })).toBe(state);
      expect(appReducer(state, {
        type: "SYNC_MANAGED_SESSION",
        id: "missing",
        managed: { profileName: "codex", tracker: {}, awaitingInput: true } as any,
      })).toBe(state);
    });
  });

  describe("contract invalidation guard rails", () => {
    it("does nothing when the fingerprint is unchanged and preserves blocked status when invalidating", () => {
      const unchanged = stateWithSession("s1", {
        contractFingerprint: "same",
      });
      expect(appReducer(unchanged, {
        type: "INVALIDATE_SESSION_CONTRACT",
        id: "s1",
        contractFingerprint: "same",
        reason: "same",
      })).toBe(unchanged);

      const blocked = stateWithSession("s1", {
        status: "blocked",
        contractFingerprint: "old",
        suggestion: { kind: "error", message: "timeout" },
      });
      const result = appReducer(blocked, {
        type: "INVALIDATE_SESSION_CONTRACT",
        id: "s1",
        contractFingerprint: "new",
        reason: "changed",
      });
      expect(result.sessions.get("s1")!.status).toBe("blocked");
    });

    it("reopens parked and auto-sent lanes when the contract changes", () => {
      const state = stateWithSession("s1", {
        status: "parked",
        contractFingerprint: "old",
        managed: { awaitingInput: false } as any,
        suggestion: { kind: "auto-sent", text: "Parked.", confidence: 97 },
        timeline: [{
          id: "pending-1",
          kind: "local-suggestion",
          timestamp: 1,
          text: "Parked.",
          confidence: 97,
          reasoning: "no delta",
          state: "pending",
        }],
      });

      const result = appReducer(state, {
        type: "INVALIDATE_SESSION_CONTRACT",
        id: "s1",
        contractFingerprint: "new",
        reason: "updated",
      });

      expect(result.sessions.get("s1")!.status).toBe("waiting");
      expect(result.sessions.get("s1")!.managed.awaitingInput).toBe(true);
      expect(result.sessions.get("s1")!.timeline.at(-1)).toMatchObject({
        kind: "tool-activity",
        toolName: "contract",
        text: "updated",
      });
    });

    it("ignores invalidation for unknown sessions", () => {
      const state = makeState();
      expect(appReducer(state, {
        type: "INVALIDATE_SESSION_CONTRACT",
        id: "missing",
        contractFingerprint: "new",
        reason: "updated",
      })).toBe(state);
    });
  });
});

describe("background lane helpers", () => {
  it("formats main and worktree lane scopes", () => {
    expect(formatLaneScopeLabel(makeSession("s1", { projectName: "appsicle", worktreeName: "main" }))).toBe("appsicle");
    expect(formatLaneScopeLabel(makeSession("s2", { projectName: "nanobots", worktreeName: "auth" }))).toBe("nanobots/auth");
  });

  it("returns other running lanes when an active lane exists", () => {
    const appsicle = makeSession("appsicle", { projectName: "appsicle", worktreeName: "main" });
    const nanobots = makeSession("nanobots", { projectName: "nanobots", worktreeName: "main" });
    const sessions = new Map([
      ["appsicle", appsicle],
      ["nanobots", nanobots],
    ]);

    const result = getBackgroundLaneSessions(sessions, "nanobots");
    expect(result.map((session) => session.id)).toEqual(["appsicle"]);
  });

  it("keeps the only running lane when there is no alternate lane to show", () => {
    const appsicle = makeSession("appsicle", { projectName: "appsicle", worktreeName: "main" });
    const sessions = new Map([["appsicle", appsicle]]);

    const result = getBackgroundLaneSessions(sessions, "appsicle");
    expect(result.map((session) => session.id)).toEqual(["appsicle"]);
  });

  it("returns all running lanes when there is no active lane and filters exited lanes", () => {
    const appsicle = makeSession("appsicle", { status: "active" });
    const nanobots = makeSession("nanobots", { status: "paused" });
    const exited = makeSession("old", { status: "exited" });
    const sessions = new Map([
      ["appsicle", appsicle],
      ["nanobots", nanobots],
      ["old", exited],
    ]);

    const result = getBackgroundLaneSessions(sessions, null);
    expect(result.map((session) => session.id)).toEqual(["appsicle", "nanobots"]);
  });
});

describe("getRunningLaneTurnSignal", () => {
  it("returns the latest conversation-turn marker for each running lane", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        timeline: [
          { id: "tool-1", kind: "tool-activity", timestamp: 1, provider: "codex", toolName: "Read", text: "Using Read" },
          { id: "turn-1", kind: "remote-turn", timestamp: 2, provider: "codex", text: "done" },
        ],
      })],
      ["s2", makeSession("s2", {
        timeline: [
          { id: "local-1", kind: "local-sent", timestamp: 3, text: "keep going", delivery: "manual" },
        ],
      })],
    ]);

    expect(getRunningLaneTurnSignal(sessions)).toBe("s1:turn-1|s2:local-1");
  });

  it("ignores exited lanes and lanes with only tool chatter", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        status: "exited",
        timeline: [
          { id: "turn-1", kind: "remote-turn", timestamp: 2, provider: "codex", text: "done" },
        ],
      })],
      ["s2", makeSession("s2", {
        timeline: [
          { id: "tool-1", kind: "tool-activity", timestamp: 1, provider: "codex", toolName: "Read", text: "Using Read" },
        ],
      })],
    ]);

    expect(getRunningLaneTurnSignal(sessions)).toBeNull();
  });
});
