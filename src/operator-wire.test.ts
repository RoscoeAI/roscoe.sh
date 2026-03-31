import { describe, expect, it, vi } from "vitest";
import {
  deliverQueuedOperatorMessages,
  processInboundOperatorReplies,
  type InboundOperatorReply,
} from "./operator-wire.js";
import type { SessionState, AppAction, PendingOperatorMessage } from "./types.js";
import type { SessionManagerService } from "./services/session-manager.js";

function createService() {
  return {
    executeSuggestion: vi.fn(async () => {}),
    injectText: vi.fn(),
    prepareWorkerTurn: vi.fn(),
    injectOperatorGuidance: vi.fn(),
    notifications: {
      sendOperatorMessage: vi.fn(async () => {}),
    },
  } as unknown as SessionManagerService & {
    executeSuggestion: ReturnType<typeof vi.fn>;
    injectText: ReturnType<typeof vi.fn>;
    prepareWorkerTurn: ReturnType<typeof vi.fn>;
    injectOperatorGuidance: ReturnType<typeof vi.fn>;
    notifications: {
      sendOperatorMessage: ReturnType<typeof vi.fn>;
    };
  };
}

function createSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "lane-1",
    profileName: "codex",
    projectName: "AppSicle",
    worktreeName: "main",
    startedAt: new Date().toISOString(),
    status: "waiting",
    outputLines: [],
    suggestion: { kind: "idle" },
    managed: {
      awaitingInput: true,
      _paused: false,
      monitor: {
        startTurn: vi.fn(),
      },
    } as unknown as SessionState["managed"],
    summary: "Latest summary",
    currentToolUse: null,
    currentToolDetail: null,
    usage: {} as SessionState["usage"],
    rateLimitStatus: null,
    timeline: [],
    preview: { mode: "off", message: null, link: null },
    pendingOperatorMessages: [],
    viewMode: "transcript",
    scrollOffset: 0,
    followLive: true,
    ...overrides,
  };
}

function collectDispatches() {
  const actions: AppAction[] = [];
  const dispatch = vi.fn((action: AppAction) => {
    actions.push(action);
  });
  return { dispatch, actions };
}

describe("operator-wire", () => {
  it("sends a status reply for a single live lane", async () => {
    const session = createSession({ status: "blocked" });
    const sessions = new Map([[session.id, session]]);
    const service = createService();
    const { dispatch, actions } = collectDispatches();

    await processInboundOperatorReplies({
      replies: [{
        id: "reply-1",
        body: "status",
        answerText: "status",
        from: "+15551234567",
        receivedAt: Date.now(),
        via: "sms",
      }],
      sessions,
      dispatch,
      service,
      provider: "Roscoe",
      toolName: "sms",
      sourceLabel: "SMS",
    });

    expect(actions.some((action) => action.type === "APPEND_TIMELINE_ENTRY")).toBe(true);
    expect(service.notifications.sendOperatorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Roscoe status for AppSicle: waiting.'),
    );
  });

  it("approves a pending Roscoe draft from operator input", async () => {
    const suggestionResult = {
      text: "Ship it",
      confidence: 92,
      reasoning: "clear next step",
    };
    const session = createSession({
      suggestion: {
        kind: "ready",
        result: suggestionResult,
      },
    });
    const sessions = new Map([[session.id, session]]);
    const service = createService();
    const { dispatch, actions } = collectDispatches();

    await processInboundOperatorReplies({
      replies: [{
        id: "reply-2",
        body: "approve",
        answerText: "approve",
        from: "+15551234567",
        receivedAt: Date.now(),
        via: "sms",
      }],
      sessions,
      dispatch,
      service,
      provider: "Roscoe",
      toolName: "sms",
      sourceLabel: "SMS",
    });

    expect(service.executeSuggestion).toHaveBeenCalledWith(session.managed, suggestionResult);
    expect(actions.some((action) => action.type === "APPROVE_SUGGESTION")).toBe(true);
    expect(service.notifications.sendOperatorMessage).toHaveBeenCalledWith(
      "Approved and sent Roscoe's pending draft to AppSicle.",
    );
  });

  it("reports when approve, hold, or resume are requested in the wrong state", async () => {
    const service = createService();

    const run = async (session: SessionState, answerText: string) => {
      const { dispatch, actions } = collectDispatches();
      await processInboundOperatorReplies({
        replies: [{
          id: `reply-${answerText}-${session.id}`,
          body: answerText,
          answerText,
          from: "+15551234567",
          receivedAt: Date.now(),
          via: "sms",
        }],
        sessions: new Map([[session.id, session]]),
        dispatch,
        service,
        provider: "Roscoe",
        toolName: "sms",
        sourceLabel: "SMS",
      });
      return actions;
    };

    const approveActions = await run(createSession({ id: "lane-approve", projectName: "AppSicle" }), "approve");
    const holdActions = await run(createSession({ id: "lane-hold", projectName: "Nanobots" }), "hold");
    const holdingActions = await run(createSession({ id: "lane-holding", projectName: "Roscoe", status: "parked" }), "hold");
    const resumeActions = await run(createSession({ id: "lane-resume", projectName: "K12", status: "waiting" }), "resume");

    expect(approveActions.some((action) => action.type === "APPEND_TIMELINE_ENTRY")).toBe(true);
    expect(holdActions.some((action) => action.type === "APPEND_TIMELINE_ENTRY")).toBe(true);
    expect(holdingActions.some((action) => action.type === "APPEND_TIMELINE_ENTRY")).toBe(true);
    expect(resumeActions.some((action) => action.type === "APPEND_TIMELINE_ENTRY")).toBe(true);
    expect(service.notifications.sendOperatorMessage).toHaveBeenNthCalledWith(
      1,
      "Roscoe has no pending draft waiting for approval on AppSicle.",
    );
    expect(service.notifications.sendOperatorMessage).toHaveBeenNthCalledWith(
      2,
      "Roscoe has no pending draft to hold on Nanobots.",
    );
    expect(service.notifications.sendOperatorMessage).toHaveBeenNthCalledWith(
      3,
      "Roscoe is already holding.",
    );
    expect(service.notifications.sendOperatorMessage).toHaveBeenNthCalledWith(
      4,
      "K12 is not paused right now.",
    );
  });

  it("holds a pending suggestion when asked", async () => {
    const session = createSession({
      suggestion: {
        kind: "ready",
        result: {
          text: "Ship it",
          confidence: 92,
          reasoning: "clear next step",
        },
      },
    });
    const sessions = new Map([[session.id, session]]);
    const service = createService();
    const { dispatch, actions } = collectDispatches();

    await processInboundOperatorReplies({
      replies: [{
        id: "reply-3",
        body: "hold",
        answerText: "hold",
        from: "+15551234567",
        receivedAt: Date.now(),
        via: "sms",
      }],
      sessions,
      dispatch,
      service,
      provider: "Roscoe",
      toolName: "sms",
      sourceLabel: "SMS",
    });

    expect(actions.some((action) => action.type === "REJECT_SUGGESTION")).toBe(true);
    expect(service.notifications.sendOperatorMessage).toHaveBeenCalledWith(
      "Held Roscoe's pending draft for AppSicle.",
    );
  });

  it("resumes a blocked lane by injecting the blocker-aware resume prompt when awaiting input", async () => {
    const session = createSession({ status: "blocked" });
    const sessions = new Map([[session.id, session]]);
    const service = createService();
    const { dispatch, actions } = collectDispatches();

    await processInboundOperatorReplies({
      replies: [{
        id: "reply-4",
        body: "resume",
        answerText: "resume",
        from: "+15551234567",
        receivedAt: Date.now(),
        via: "sms",
      }],
      sessions,
      dispatch,
      service,
      provider: "Roscoe",
      toolName: "sms",
      sourceLabel: "SMS",
    });

    expect(service.injectText).toHaveBeenCalledWith(
      session.managed,
      expect.stringContaining("First verify whether the blocker is actually cleared"),
    );
    expect(actions.some((action) => action.type === "RESUME_SESSION")).toBe(true);
    expect(service.notifications.sendOperatorMessage).toHaveBeenCalledWith("Resumed AppSicle.");
  });

  it("resumes a paused lane by starting a new worker turn when not awaiting input", async () => {
    const startTurn = vi.fn();
    const session = createSession({
      status: "paused",
      managed: {
        awaitingInput: false,
        _paused: true,
        monitor: {
          startTurn,
        },
      } as unknown as SessionState["managed"],
    });
    const sessions = new Map([[session.id, session]]);
    const service = createService();
    const { dispatch } = collectDispatches();

    await processInboundOperatorReplies({
      replies: [{
        id: "reply-4b",
        body: "resume",
        answerText: "resume",
        from: "+15551234567",
        receivedAt: Date.now(),
        via: "sms",
      }],
      sessions,
      dispatch,
      service,
      provider: "Roscoe",
      toolName: "sms",
      sourceLabel: "SMS",
    });

    expect(service.prepareWorkerTurn).toHaveBeenCalled();
    expect(startTurn).toHaveBeenCalled();
    expect(service.notifications.sendOperatorMessage).toHaveBeenCalledWith("Resumed AppSicle.");
  });

  it("sends help or ambiguity responses without touching a lane", async () => {
    const sessions = new Map([
      ["lane-1", createSession({ id: "lane-1", projectName: "AppSicle", worktreeName: "main" })],
      ["lane-2", createSession({ id: "lane-2", projectName: "Nanobots", worktreeName: "main" })],
    ]);
    const service = createService();
    const { dispatch, actions } = collectDispatches();

    await processInboundOperatorReplies({
      replies: [{
        id: "reply-help",
        body: "help",
        answerText: "help",
        from: "+15551234567",
        receivedAt: Date.now(),
        via: "sms",
      }, {
        id: "reply-ambiguous",
        body: "status",
        answerText: "status",
        from: "+15551234567",
        receivedAt: Date.now(),
        via: "sms",
      }],
      sessions,
      dispatch,
      service,
      provider: "Roscoe",
      toolName: "sms",
      sourceLabel: "SMS",
    });

    expect(actions).toEqual([]);
    expect(service.notifications.sendOperatorMessage).toHaveBeenCalledTimes(2);
  });

  it("ignores replies that target a lane id no longer present", async () => {
    const sessions = new Map<string, SessionState>();
    const service = createService();
    const { dispatch, actions } = collectDispatches();

    await processInboundOperatorReplies({
      replies: [{
        id: "reply-missing",
        body: "keep going",
        answerText: "keep going",
        from: "+15551234567",
        receivedAt: Date.now(),
        matchedSessionId: "gone-lane",
        via: "hosted-sms",
      }],
      sessions,
      dispatch,
      service,
      provider: "Roscoe",
      toolName: "hosted-sms",
      sourceLabel: "Hosted SMS",
    });

    expect(actions).toEqual([]);
    expect(service.notifications.sendOperatorMessage).not.toHaveBeenCalled();
  });

  it("queues freeform operator guidance while the Guild lane is busy", async () => {
    const session = createSession({
      managed: {
        awaitingInput: false,
        _paused: false,
        monitor: {
          startTurn: vi.fn(),
        },
      } as unknown as SessionState["managed"],
    });
    const sessions = new Map([[session.id, session]]);
    const service = createService();
    const { dispatch, actions } = collectDispatches();

    await processInboundOperatorReplies({
      replies: [{
        id: "reply-5",
        body: "keep pushing on deploy",
        answerText: "keep pushing on deploy",
        from: "+15551234567",
        receivedAt: Date.now(),
        via: "hosted-sms",
      }],
      sessions,
      dispatch,
      service,
      provider: "Roscoe",
      toolName: "hosted-sms",
      sourceLabel: "Hosted SMS",
    });

    const queueAction = actions.find((action) => action.type === "QUEUE_OPERATOR_MESSAGE") as Extract<AppAction, { type: "QUEUE_OPERATOR_MESSAGE" }> | undefined;
    expect(queueAction?.message.via).toBe("hosted-sms");
    expect(queueAction?.message.text).toBe("keep pushing on deploy");
    expect(service.notifications.sendOperatorMessage).toHaveBeenCalledWith(
      "Queued your note for AppSicle. Guild is still busy, so Roscoe will inject it at the next clean handoff.",
    );
  });

  it("delivers freeform operator guidance immediately when the lane is ready for input", async () => {
    const session = createSession();
    const sessions = new Map([[session.id, session]]);
    const service = createService();
    const { dispatch, actions } = collectDispatches();

    await processInboundOperatorReplies({
      replies: [{
        id: "reply-6",
        body: "focus on deployment",
        answerText: "focus on deployment",
        from: "+15551234567",
        receivedAt: Date.now(),
        via: "sms",
      }],
      sessions,
      dispatch,
      service,
      provider: "Roscoe",
      toolName: "sms",
      sourceLabel: "SMS",
    });

    expect(service.injectOperatorGuidance).toHaveBeenCalledWith(session.managed, "focus on deployment", "sms");
    expect(actions.some((action) => action.type === "SUBMIT_TEXT")).toBe(true);
    expect(service.notifications.sendOperatorMessage).toHaveBeenCalledWith("Delivered your note to AppSicle.");
  });

  it("delivers queued operator messages once the lane becomes ready", () => {
    const pendingMessage: PendingOperatorMessage = {
      id: "pending-1",
      text: "resume with deploy work",
      via: "sms",
      from: "+15551234567",
      receivedAt: Date.now(),
    };
    const session = createSession({
      pendingOperatorMessages: [pendingMessage],
    });
    const sessions = new Map([[session.id, session]]);
    const service = createService();
    const { dispatch, actions } = collectDispatches();

    deliverQueuedOperatorMessages(
      sessions,
      dispatch,
      service,
      "Roscoe",
      "sms",
      "SMS",
    );

    expect(service.injectOperatorGuidance).toHaveBeenCalledWith(session.managed, pendingMessage.text, "sms");
    expect(actions.some((action) => action.type === "SHIFT_OPERATOR_MESSAGE")).toBe(true);
    expect(service.notifications.sendOperatorMessage).toHaveBeenCalledWith("Delivered your queued note to AppSicle.");
  });

  it("skips queued delivery when there is nothing pending or the lane is not ready", () => {
    const service = createService();
    const { dispatch } = collectDispatches();
    const readyButEmpty = createSession({ id: "lane-empty" });
    const busyWithPending = createSession({
      id: "lane-busy",
      suggestion: { kind: "editing", original: "draft" },
      pendingOperatorMessages: [{
        id: "pending-2",
        text: "do the next thing",
        via: "sms",
        from: "+15551234567",
        receivedAt: Date.now(),
      }],
    });

    deliverQueuedOperatorMessages(
      new Map([
        [readyButEmpty.id, readyButEmpty],
        [busyWithPending.id, busyWithPending],
      ]),
      dispatch,
      service,
      "Roscoe",
      "sms",
      "SMS",
    );

    expect(service.injectOperatorGuidance).not.toHaveBeenCalled();
    expect(service.notifications.sendOperatorMessage).not.toHaveBeenCalled();
  });
});
