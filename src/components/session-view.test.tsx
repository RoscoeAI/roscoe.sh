import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  exit: vi.fn(),
  startSession: vi.fn(),
  switchSession: vi.fn(),
  interruptActiveLane: vi.fn(),
  saveProjectContext: vi.fn(),
  parseSessionSpec: vi.fn(),
  createWorktree: vi.fn(),
  executeSuggestion: vi.fn(async () => {}),
  generateSuggestion: vi.fn(async () => ({ text: "Generated", confidence: 88 })),
  injectText: vi.fn(),
  prepareWorkerTurn: vi.fn(),
  updateManagedRuntime: vi.fn(),
  updateManagedResponderRuntime: vi.fn(),
  cancelGeneration: vi.fn(),
  persistSessionState: vi.fn(),
  meetsThreshold: vi.fn(() => false),
  getConfidenceThreshold: vi.fn(() => 70),
  sendQuestion: vi.fn(async () => ({ ok: true, accepted: true, detail: "SMS sent" })),
  lastSuggestionBarProps: null as Record<string, any> | null,
  lastRuntimePanelProps: null as Record<string, any> | null,
  notificationStatus: {
    phoneNumber: "6122030386",
    providerReady: true,
  },
  terminalSize: {
    columns: 160,
    rows: 40,
  },
  activeProjectContext: {
    runtimeDefaults: {
      workerGovernanceMode: "roscoe-arbiter",
      verificationCadence: "batched",
      responderApprovalMode: "auto",
      responderByProtocol: {
        claude: { model: "claude-opus-4-6", reasoningEffort: "max" },
        codex: { model: "gpt-5.4", reasoningEffort: "high" },
      },
    },
  } as Record<string, any>,
  partialDispatcher: { kind: "partial-dispatcher" },
  selectableProviders: ["claude", "codex"],
  runtimePanelApplies: [] as Array<(draft: any) => void>,
  buildQueuedPreviewState: vi.fn(() => ({ mode: "queued", message: "queued preview" })),
  buildReadyPreviewState: vi.fn(() => ({ mode: "ready", message: "ready preview", link: "https://preview.example" })),
  state: {
    autoMode: false,
    sessions: new Map<string, any>(),
    activeSessionId: null as string | null,
  },
}));

vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof import("ink")>("ink");
  return {
    ...actual,
    useApp: () => ({ exit: mocks.exit }),
  };
});

vi.mock("../app.js", () => ({
  useAppContext: () => ({
    state: mocks.state,
    dispatch: mocks.dispatch,
    service: {
      notifications: {
        getStatus: () => mocks.notificationStatus,
        sendQuestion: mocks.sendQuestion,
      },
      cancelGeneration: mocks.cancelGeneration,
      persistSessionState: mocks.persistSessionState,
      executeSuggestion: mocks.executeSuggestion,
      generateSuggestion: mocks.generateSuggestion,
      injectText: mocks.injectText,
      prepareWorkerTurn: mocks.prepareWorkerTurn,
      updateManagedRuntime: mocks.updateManagedRuntime,
      updateManagedResponderRuntime: mocks.updateManagedResponderRuntime,
      generator: {
        getConfidenceThreshold: mocks.getConfidenceThreshold,
        meetsThreshold: mocks.meetsThreshold,
      },
    },
  }),
}));

vi.mock("../hooks/use-event-bridge.js", () => ({
  createPartialDispatcher: () => mocks.partialDispatcher,
}));

vi.mock("../hooks/use-sessions.js", () => ({
  useSessions: () => ({
    startSession: mocks.startSession,
    switchSession: mocks.switchSession,
  }),
}));

vi.mock("../hooks/use-terminal-size.js", () => ({
  useTerminalSize: () => mocks.terminalSize,
}));

vi.mock("./session-list.js", () => ({
  SessionList: ({ sessions, width }: { sessions: Map<string, unknown>; width: number }) => <Text>{`SESSION LIST ${sessions.size} width ${width}`}</Text>,
}));

vi.mock("./session-output.js", () => ({
  SessionOutput: ({ sessionLabel }: { sessionLabel?: string }) => <Text>{`SESSION OUTPUT ${sessionLabel ?? "none"}`}</Text>,
}));

vi.mock("./session-status-pane.js", () => ({
  SessionStatusPane: ({ session }: { session: { status: string } }) => <Text>{`STATUS PANE ${session.status}`}</Text>,
}));

vi.mock("./suggestion-bar.js", () => ({
  SuggestionBar: (props: { phase: { kind: string }; sessionStatus: string; sessionSummary: string | null }) => {
    mocks.lastSuggestionBarProps = props;
    return <Text>{`SUGGESTION ${props.phase.kind} ${props.sessionStatus} ${props.sessionSummary ?? "none"}`}</Text>;
  },
}));

vi.mock("./status-bar.js", () => ({
  StatusBar: ({ sessionStatus, suggestionPhaseKind, previewMode, runtimeEditorOpen }: { sessionStatus?: string; suggestionPhaseKind?: string; previewMode: string; runtimeEditorOpen: boolean }) => (
    <Text>{`STATUS BAR ${sessionStatus ?? "none"} ${suggestionPhaseKind ?? "none"} ${previewMode} ${runtimeEditorOpen ? "editor-open" : "editor-closed"}`}</Text>
  ),
}));

vi.mock("./exit-warning-pane.js", () => ({
  ExitWarningPane: () => <Text>EXIT WARNING</Text>,
}));

vi.mock("./close-lane-pane.js", () => ({
  CloseLanePane: () => <Text>CLOSE LANE</Text>,
}));

vi.mock("../services/session-manager.js", () => ({
  parseSessionSpec: mocks.parseSessionSpec,
}));

vi.mock("../worktree-manager.js", () => ({
  WorktreeManager: class {
    constructor(_projectDir: string) {}

    create(taskName: string) {
      return mocks.createWorktree(taskName);
    }
  },
}));

vi.mock("../llm-runtime.js", () => ({
  detectProtocol: (profile: { name?: string }) => (profile.name?.includes("codex") ? "codex" : "claude"),
}));

vi.mock("../config.js", () => ({
  getProjectContractFingerprint: (context: { fingerprint?: string } | null) => context?.fingerprint ?? "same",
  loadRoscoeSettings: () => ({
    notifications: { enabled: false, phoneNumber: "", provider: "twilio" },
    providers: {
      claude: { enabled: true, brief: false, ide: false, chrome: false },
      codex: { enabled: true, webSearch: false },
      gemini: { enabled: false },
    },
  }),
  loadProfile: (name: string) => ({ name, runtime: { model: name } }),
  loadProjectContext: () => mocks.activeProjectContext,
  normalizeProjectContext: (context: unknown) => context,
  saveProjectContext: mocks.saveProjectContext,
}));

vi.mock("../provider-registry.js", () => ({
  getSelectableProviderIds: () => mocks.selectableProviders,
}));

vi.mock("../runtime-defaults.js", () => ({
  buildConfiguredRuntime: (provider: string, executionMode: string, tuningMode: string, model: string, reasoningEffort: string) => ({
    provider,
    executionMode,
    tuningMode,
    model,
    reasoningEffort,
  }),
  getResponderProvider: () => "claude",
  getTokenEfficiencyMode: () => "save-tokens",
}));

vi.mock("./runtime-controls.js", () => ({
  RuntimeEditorPanel: (props: { protocol: string; onApply: (draft: any) => void }) => {
    mocks.lastRuntimePanelProps = props;
    const { protocol, onApply } = props;
    mocks.runtimePanelApplies.push(onApply);
    return <Text>{`RUNTIME EDITOR ${protocol}`}</Text>;
  },
}));

vi.mock("../session-preview.js", () => ({
  buildQueuedPreviewState: (session: unknown) => mocks.buildQueuedPreviewState(session),
  buildReadyPreviewState: (session: unknown) => mocks.buildReadyPreviewState(session),
  getPreviewState: (preview: { mode?: string; message?: string; link?: string } | null | undefined) => preview ?? { mode: "off" },
}));

vi.mock("../session-interrupt.js", () => ({
  interruptActiveLane: mocks.interruptActiveLane,
}));

vi.mock("../session-transcript.js", () => ({
  isPauseAcknowledgementText: (text: string) => text.trim() === "Paused.",
}));

vi.mock("../session-control.js", () => ({
  getResumePrompt: () => "resume from parked state",
}));

import {
  deriveSmsQuestion,
  getActiveLaneSummary,
  getClosedPersistStatus,
  normalizeInlineText,
  SessionView,
} from "./session-view.js";

function delay(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: "lane-1",
    projectName: "appsicle",
    worktreeName: "main",
    status: "active",
    summary: "lane summary",
    contractFingerprint: "same",
    currentToolUse: null,
    currentToolDetail: null,
    viewMode: "transcript",
    followLive: true,
    preview: { mode: "off" },
    timeline: [
      { kind: "remote-turn", text: "Are you ready for the next approval?" },
    ],
    suggestion: { kind: "idle" },
    managed: {
      projectDir: "/tmp/appsicle",
      profile: { name: "claude-code", runtime: { model: "claude-opus-4-6" } },
      awaitingInput: true,
      tracker: {
        getLastAssistantMessage: () => "Are you ready for the next approval?",
      },
      monitor: {
        kill: vi.fn(),
        startTurn: vi.fn(),
      },
      responderMonitor: {
        kill: vi.fn(),
        restoreSessionId: vi.fn(),
      },
      responderHistoryCursor: 0,
      _paused: false,
    },
    ...overrides,
  };
}

function mountSession(session: Record<string, any>) {
  mocks.state.sessions = new Map([[session.id, session]]);
  mocks.state.activeSessionId = session.id;
  return render(<SessionView />);
}

describe("SessionView", () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.exit.mockReset();
    mocks.startSession.mockReset();
    mocks.switchSession.mockReset();
    mocks.interruptActiveLane.mockReset();
    mocks.saveProjectContext.mockReset();
    mocks.parseSessionSpec.mockReset();
    mocks.createWorktree.mockReset();
    mocks.executeSuggestion.mockClear();
    mocks.generateSuggestion.mockClear();
    mocks.injectText.mockClear();
    mocks.prepareWorkerTurn.mockClear();
    mocks.updateManagedRuntime.mockClear();
    mocks.updateManagedResponderRuntime.mockClear();
    mocks.cancelGeneration.mockClear();
    mocks.persistSessionState.mockClear();
    mocks.meetsThreshold.mockReset();
    mocks.meetsThreshold.mockReturnValue(false);
    mocks.getConfidenceThreshold.mockReset();
    mocks.getConfidenceThreshold.mockReturnValue(70);
    mocks.sendQuestion.mockReset();
    mocks.sendQuestion.mockResolvedValue({ ok: true, accepted: true, detail: "SMS sent" });
    mocks.lastSuggestionBarProps = null;
    mocks.lastRuntimePanelProps = null;
    mocks.notificationStatus = { phoneNumber: "6122030386", providerReady: true };
    mocks.terminalSize = { columns: 160, rows: 40 };
    mocks.runtimePanelApplies.length = 0;
    mocks.buildQueuedPreviewState.mockReset();
    mocks.buildQueuedPreviewState.mockReturnValue({ mode: "queued", message: "queued preview" });
    mocks.buildReadyPreviewState.mockReset();
    mocks.buildReadyPreviewState.mockReturnValue({ mode: "ready", message: "ready preview", link: "https://preview.example" });
    mocks.activeProjectContext = {
      runtimeDefaults: {
        workerGovernanceMode: "roscoe-arbiter",
        verificationCadence: "batched",
        responderApprovalMode: "auto",
        responderByProtocol: {
          claude: { model: "claude-opus-4-6", reasoningEffort: "max" },
        },
      },
    };
    mocks.state = {
      autoMode: false,
      sessions: new Map(),
      activeSessionId: null,
    };
  });

  it("normalizes inline text and derives blocked-lane summaries from substantive remote turns", () => {
    expect(normalizeInlineText("   ")).toBe("");
    expect(normalizeInlineText("hello   world")).toBe("hello world");
    expect(normalizeInlineText("x".repeat(260), 90)).toMatch(/\.\.\.$/);
    expect(deriveSmsQuestion(makeSession({
      timeline: [{ kind: "remote-turn", text: ` ${"x".repeat(260)} ` }],
      managed: {
        ...makeSession().managed,
        tracker: {
          getLastAssistantMessage: () => null,
        },
      },
    } as any))).toMatch(/\.\.\.$/);

    expect(getActiveLaneSummary(null)).toBeNull();
    expect(getActiveLaneSummary(makeSession({
      status: "blocked",
      summary: "fallback summary",
      timeline: [
        { kind: "remote-turn", text: "Paused." },
        { kind: "remote-turn", text: "   " },
        { kind: "remote-turn", text: "Blocker unchanged: preview url is still missing and the lane cannot continue yet." },
      ],
    } as any))).toContain("Blocker unchanged");
    expect(getActiveLaneSummary(makeSession({
      status: "blocked",
      summary: "fallback summary",
      timeline: [
        { kind: "remote-turn", text: "Paused." },
      ],
    } as any))).toBe("fallback summary");
    expect(getActiveLaneSummary(makeSession({
      status: "blocked",
      summary: "fallback summary",
      timeline: [
        { kind: "remote-turn", text: "Paused." },
        { kind: "remote-turn", text: "   " },
      ],
    } as any))).toBe("fallback summary");
    expect(getClosedPersistStatus(makeSession({ status: "blocked" } as any))).toBe("blocked");
    expect(getClosedPersistStatus(makeSession({
      status: "active",
      suggestion: { kind: "ready", result: { text: "Ship it", confidence: 91 } },
    } as any))).toBe("review");
    expect(getClosedPersistStatus(makeSession({ status: "active" } as any))).toBe("waiting");
  });

  it("shows the runtime editor and can hide the status pane", async () => {
    const app = mountSession(makeSession());

    expect(app.lastFrame()).toContain("STATUS PANE active");
    app.stdin.write("u");
    await delay();
    expect(app.lastFrame()).toContain("RUNTIME EDITOR claude");

    app.stdin.write("\u001B");
    await delay();
    expect(app.lastFrame()).not.toContain("RUNTIME EDITOR");

    app.stdin.write("s");
    await delay();
    expect(app.lastFrame()).not.toContain("STATUS PANE active");
  });

  it("adapts the lane rail width to smaller terminals", () => {
    mocks.terminalSize = { columns: 90, rows: 40 };
    const app = mountSession(makeSession());
    expect(app.lastFrame()).toContain("SESSION LIST 1 width 30");
  });

  it("applies runtime edits across lanes in the same project and persists the updated context", async () => {
    const laneOne = makeSession();
    const laneTwo = makeSession({
      id: "lane-2",
      managed: {
        ...makeSession().managed,
        projectDir: "/tmp/appsicle",
        profile: { name: "codex", runtime: { model: "gpt-5.4" } },
        responderMonitor: {
          kill: vi.fn(),
          restoreSessionId: vi.fn(),
        },
      },
    });
    const foreignLane = makeSession({
      id: "lane-3",
      projectName: "nanobots",
      managed: {
        ...makeSession().managed,
        projectDir: "/tmp/nanobots",
        responderMonitor: {
          kill: vi.fn(),
          restoreSessionId: vi.fn(),
        },
      },
    });
    mocks.state.sessions = new Map([
      [laneOne.id, laneOne],
      [laneTwo.id, laneTwo],
      [foreignLane.id, foreignLane],
    ]);
    mocks.state.activeSessionId = laneOne.id;

    const app = render(<SessionView />);
    app.stdin.write("u");
    await delay();

    expect(mocks.runtimePanelApplies.length).toBeGreaterThan(0);
    mocks.runtimePanelApplies.at(-1)?.({
      workerProvider: "codex",
      responderProvider: "codex",
      workerExecutionMode: "accelerated",
      workerModel: "gpt-5.4",
      workerReasoningEffort: "xhigh",
      responderModel: "gpt-5.4",
      responderReasoningEffort: "high",
      workerTuningMode: "auto",
      workerGovernanceMode: "guild-direct",
      verificationCadence: "proof-first",
      tokenEfficiencyMode: "balanced",
      responderApprovalMode: "manual",
    });
    await delay();

    expect(mocks.updateManagedRuntime).toHaveBeenCalledTimes(2);
    expect(mocks.updateManagedResponderRuntime).toHaveBeenCalledTimes(2);
    expect(mocks.prepareWorkerTurn).toHaveBeenCalledTimes(2);
    expect(laneOne.managed.responderMonitor.restoreSessionId).toHaveBeenCalledWith(null);
    expect(laneTwo.managed.responderMonitor.restoreSessionId).toHaveBeenCalledWith(null);
    expect(foreignLane.managed.responderMonitor.restoreSessionId).not.toHaveBeenCalled();
    expect(mocks.saveProjectContext).toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_AUTO_MODE", enabled: false });
  });

  it("applies runtime edits without auto-tuning when no project context is loaded", async () => {
    mocks.activeProjectContext = null;
    const session = makeSession();
    const app = mountSession(session);

    app.stdin.write("u");
    await delay();

    expect(mocks.lastRuntimePanelProps).toEqual(expect.objectContaining({
      responderRuntime: undefined,
      workerGovernanceMode: "roscoe-arbiter",
      verificationCadence: "batched",
      responderApprovalMode: "manual",
    }));

    mocks.runtimePanelApplies.at(-1)?.({
      workerProvider: "claude",
      responderProvider: "codex",
      workerExecutionMode: "safe",
      workerModel: "claude-opus-4-6",
      workerReasoningEffort: "high",
      responderModel: "gpt-5.4",
      responderReasoningEffort: "high",
      workerTuningMode: "manual",
      workerGovernanceMode: "roscoe-arbiter",
      verificationCadence: "batched",
      tokenEfficiencyMode: "save-tokens",
      responderApprovalMode: "manual",
    });
    await delay();

    expect(mocks.prepareWorkerTurn).not.toHaveBeenCalled();
    expect(mocks.saveProjectContext).not.toHaveBeenCalled();
  });

  it("reopens lanes when the saved contract fingerprint changes", async () => {
    const session = makeSession({
      contractFingerprint: "stale",
      managed: {
        ...makeSession().managed,
        projectDir: "/tmp/appsicle",
      },
    });
    mocks.activeProjectContext = {
      fingerprint: "fresh",
      runtimeDefaults: {
        workerGovernanceMode: "roscoe-arbiter",
      },
    };

    mountSession(session);
    await delay();

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "INVALIDATE_SESSION_CONTRACT",
      id: "lane-1",
      contractFingerprint: "fresh",
      reason: "Saved project contract changed. Roscoe cleared stale parked/review guidance so this lane can be reassessed under the updated brief.",
    });
  });

  it("dispatches home, preview, manual, edit, reject, and interrupt actions", async () => {
    const app = mountSession(makeSession({
      suggestion: { kind: "ready", result: { text: "Ship it", confidence: 91 } },
      managed: {
        ...makeSession().managed,
        awaitingInput: false,
      },
    }));

    app.stdin.write("b");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "QUEUE_PREVIEW_BREAK",
      id: "lane-1",
    }));

    app.stdin.write("m");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "START_MANUAL", id: "lane-1" });

    app.stdin.write("e");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "START_EDIT", id: "lane-1" });

    app.stdin.write("r");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "REJECT_SUGGESTION", id: "lane-1" });

    app.stdin.write("x");
    await delay();
    expect(mocks.interruptActiveLane).toHaveBeenCalled();

    app.stdin.write("h");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_SCREEN", screen: "home" });
  });

  it("approves a ready suggestion and syncs managed state", async () => {
    const session = makeSession({
      suggestion: { kind: "ready", result: { text: "Continue", confidence: 85 } },
    });
    const app = mountSession(session);

    app.stdin.write("a");
    await delay();

    expect(mocks.executeSuggestion).toHaveBeenCalledWith(session.managed, { text: "Continue", confidence: 85 });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SYNC_MANAGED_SESSION", id: "lane-1", managed: session.managed });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "APPROVE_SUGGESTION", id: "lane-1" });
  });

  it("ignores approval and retry when the lane is not in the matching suggestion state", async () => {
    const app = mountSession(makeSession({
      suggestion: { kind: "idle" },
    }));

    app.stdin.write("a");
    app.stdin.write("r");
    await delay(50);

    expect(mocks.executeSuggestion).not.toHaveBeenCalled();
    expect(mocks.generateSuggestion).not.toHaveBeenCalled();
  });

  it("retries an error suggestion and auto-sends when the threshold is met", async () => {
    mocks.state.autoMode = true;
    mocks.meetsThreshold.mockReturnValue(true);
    mocks.generateSuggestion.mockResolvedValue({ text: "Recovered", confidence: 92 });
    const session = makeSession({
      status: "review",
      suggestion: { kind: "error", message: "boom" },
      managed: {
        ...makeSession().managed,
        awaitingInput: false,
      },
    });
    const app = mountSession(session);

    app.stdin.write("r");
    await delay(50);

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "START_GENERATING", id: "lane-1" });
    expect(mocks.generateSuggestion).toHaveBeenCalledWith(session.managed, mocks.partialDispatcher, expect.any(Function));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SUGGESTION_READY", id: "lane-1", result: { text: "Recovered", confidence: 92 } });
    expect(mocks.executeSuggestion).toHaveBeenCalledWith(session.managed, { text: "Recovered", confidence: 92 });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "AUTO_SENT", id: "lane-1", text: "Recovered", confidence: 92 });
  });

  it("auto-sends recovered suggestions with blank text without scheduling clear-auto-sent", async () => {
    const realSetTimeout = global.setTimeout;
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    mocks.state.autoMode = true;
    mocks.meetsThreshold.mockReturnValue(true);
    mocks.generateSuggestion.mockResolvedValue({ text: "   ", confidence: 92 });
    const session = makeSession({
      status: "review",
      suggestion: { kind: "error", message: "boom" },
      managed: {
        ...makeSession().managed,
        awaitingInput: false,
      },
    });
    const app = mountSession(session);

    app.stdin.write("r");
    await delay(50);

    expect(mocks.executeSuggestion).toHaveBeenCalledWith(session.managed, { text: "   ", confidence: 92 });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "AUTO_SENT", id: "lane-1", text: "   ", confidence: 92 });
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 2000);
    setTimeoutSpy.mockImplementation(realSetTimeout);
    setTimeoutSpy.mockRestore();
  });

  it("captures suggestion retry errors without auto-sending", async () => {
    mocks.generateSuggestion.mockRejectedValueOnce(new Error("responder offline"));
    const session = makeSession({
      status: "review",
      suggestion: { kind: "error", message: "boom" },
      managed: {
        ...makeSession().managed,
        awaitingInput: false,
      },
    });
    const app = mountSession(session);

    app.stdin.write("r");
    await delay(50);

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "SUGGESTION_ERROR",
      id: "lane-1",
      message: "responder offline",
    });
    expect(mocks.executeSuggestion).not.toHaveBeenCalled();
  });

  it("texts the latest Guild question when q is pressed", async () => {
    const app = mountSession(makeSession());

    app.stdin.write("q");
    await delay(50);

    expect(mocks.sendQuestion).toHaveBeenCalledWith(expect.anything(), "Are you ready for the next approval?");
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPEND_TIMELINE_ENTRY",
      id: "lane-1",
    }));
  });

  it("does nothing when q is pressed without an active lane", async () => {
    mocks.state.sessions = new Map();
    mocks.state.activeSessionId = null;
    const app = render(<SessionView />);

    app.stdin.write("q");
    await delay(20);

    expect(mocks.sendQuestion).not.toHaveBeenCalled();
  });

  it("records SMS errors when texting is not available, no clear question exists, or send fails", async () => {
    let app = mountSession(makeSession({
      managed: {
        ...makeSession().managed,
        awaitingInput: false,
      },
    }));

    app.stdin.write("q");
    await delay(50);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPEND_TIMELINE_ENTRY",
      id: "lane-1",
      entry: expect.objectContaining({
        kind: "error",
        text: "Text me is only available while the Guild lane is waiting for your input.",
      }),
    }));
    app.unmount();

    mocks.dispatch.mockClear();
    app = mountSession(makeSession({
      timeline: [],
      managed: {
        ...makeSession().managed,
        tracker: {
          getLastAssistantMessage: () => "",
        },
      },
    }));
    app.stdin.write("q");
    await delay(50);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPEND_TIMELINE_ENTRY",
      id: "lane-1",
      entry: expect.objectContaining({
        kind: "error",
        text: "Roscoe could not find a clear question to text from the latest Guild turn.",
      }),
    }));
    app.unmount();

    mocks.dispatch.mockClear();
    mocks.sendQuestion.mockRejectedValueOnce(new Error("Twilio unavailable"));
    app = mountSession(makeSession());
    app.stdin.write("q");
    await delay(50);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPEND_TIMELINE_ENTRY",
      id: "lane-1",
      entry: expect.objectContaining({
        kind: "error",
        text: "Twilio unavailable",
      }),
    }));
    app.unmount();

    mocks.dispatch.mockClear();
    mocks.sendQuestion.mockRejectedValueOnce("provider offline");
    app = mountSession(makeSession());
    app.stdin.write("q");
    await delay(50);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPEND_TIMELINE_ENTRY",
      id: "lane-1",
      entry: expect.objectContaining({
        kind: "error",
        text: "Roscoe could not send the SMS question.",
      }),
    }));
    app.unmount();

    mocks.dispatch.mockClear();
    mocks.sendQuestion.mockResolvedValueOnce({
      ok: false,
      accepted: false,
      detail: "SMS rejected by provider",
    });
    app = mountSession(makeSession());
    app.stdin.write("q");
    await delay(50);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPEND_TIMELINE_ENTRY",
      id: "lane-1",
      entry: expect.objectContaining({
        kind: "error",
        text: "SMS rejected by provider",
      }),
    }));
  });

  it("pauses an active lane and resumes a blocked lane", async () => {
    const activeSession = makeSession({
      status: "active",
      managed: {
        ...makeSession().managed,
        awaitingInput: false,
      },
    });
    let app = mountSession(activeSession);

    app.stdin.write("p");
    await delay();
    expect(mocks.cancelGeneration).toHaveBeenCalled();
    expect(activeSession.managed.monitor.kill).toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "PAUSE_SESSION", id: "lane-1" });
    app.unmount();

    const blockedSession = makeSession({
      status: "blocked",
      managed: {
        ...makeSession().managed,
        awaitingInput: true,
      },
    });
    app = mountSession(blockedSession);

    app.stdin.write("p");
    await delay();
    expect(mocks.injectText).toHaveBeenCalledWith(blockedSession.managed, "resume from parked state");
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "RESUME_SESSION", id: "lane-1" });
  });

  it("resumes a parked lane by starting a new worker turn when the Guild is not awaiting input", async () => {
    const parkedSession = makeSession({
      status: "parked",
      managed: {
        ...makeSession().managed,
        awaitingInput: false,
        monitor: {
          kill: vi.fn(),
          startTurn: vi.fn(),
        },
      },
    });
    const app = mountSession(parkedSession);

    app.stdin.write("p");
    await delay();

    expect(mocks.prepareWorkerTurn).toHaveBeenCalledWith(parkedSession.managed, "resume from parked state");
    expect(parkedSession.managed.monitor.startTurn).toHaveBeenCalledWith("resume from parked state");
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "RESUME_SESSION", id: "lane-1" });
  });

  it("cycles lanes, direct-switches by number, toggles preview states, and handles scroll shortcuts", async () => {
    const laneOne = makeSession();
    const laneTwo = makeSession({ id: "lane-2", projectName: "nanobots", worktreeName: "feature" });
    mocks.state.sessions = new Map([
      [laneOne.id, laneOne],
      [laneTwo.id, laneTwo],
    ]);
    mocks.state.activeSessionId = laneOne.id;

    let app = render(<SessionView />);

    app.stdin.write("\t");
    await delay();
    expect(mocks.switchSession).toHaveBeenCalledWith("lane-2");

    app.stdin.write("\u001B1");
    await delay();
    expect(mocks.switchSession).toHaveBeenCalledWith("lane-1");

    app.stdin.write("2");
    await delay();
    expect(mocks.switchSession).toHaveBeenCalledWith("lane-2");

    app.stdin.write("b");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ACTIVATE_PREVIEW_BREAK",
      id: "lane-1",
    }));

    app.unmount();
    mocks.dispatch.mockClear();
    mocks.state.sessions.set("lane-1", {
      ...laneOne,
      preview: { mode: "ready", message: "ready preview" },
    });
    app = render(<SessionView />);
    app.stdin.write("b");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "CLEAR_PREVIEW_BREAK", id: "lane-1" });

    app.unmount();
    mocks.dispatch.mockClear();
    mocks.state.sessions.set("lane-1", {
      ...laneOne,
      preview: { mode: "ready", message: "ready preview" },
    });
    app = render(<SessionView />);
    app.stdin.write("c");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "START_MANUAL", id: "lane-1" });

    app.stdin.write("\u001B[A");
    app.stdin.write("\u001B[B");
    app.stdin.write("\u001B[5~");
    app.stdin.write("\u001B[6~");
    app.stdin.write("\u001B[H");
    app.stdin.write("g");
    app.stdin.write("G");
    app.stdin.write("l");
    await delay();

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SCROLL_SESSION_VIEW", id: "lane-1", delta: 1 });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SCROLL_SESSION_VIEW", id: "lane-1", delta: -1 });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "RETURN_TO_LIVE", id: "lane-1" });
  });

  it("ignores tab switching when only one lane is open and toggles raw back to transcript", async () => {
    const rawSession = makeSession({ viewMode: "raw" });
    const app = mountSession(rawSession);

    app.stdin.write("\t");
    await delay();
    expect(mocks.switchSession).not.toHaveBeenCalled();

    app.stdin.write("v");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "SET_SESSION_VIEW_MODE",
      id: "lane-1",
      viewMode: "transcript",
    });
  });

  it("handles preview toggles, close-lane shortcut, and meta-number switching edge cases", async () => {
    const laneOne = makeSession({
      managed: {
        ...makeSession().managed,
        awaitingInput: true,
      },
    });
    const laneTwo = makeSession({ id: "lane-2" });
    mocks.state.sessions = new Map([
      [laneOne.id, laneOne],
      [laneTwo.id, laneTwo],
    ]);
    mocks.state.activeSessionId = laneOne.id;

    const app = render(<SessionView />);

    app.stdin.write("b");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ACTIVATE_PREVIEW_BREAK",
      id: "lane-1",
    }));

    app.unmount();
    mocks.dispatch.mockClear();
    mocks.state.sessions = new Map([
      ["lane-1", {
        ...laneOne,
        preview: { mode: "ready", message: "ready preview", link: "https://preview.example" },
      }],
      ["lane-2", laneTwo],
    ]);
    mocks.state.activeSessionId = "lane-1";

    const readyApp = render(<SessionView />);

    readyApp.stdin.write("c");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "CLEAR_PREVIEW_BREAK", id: "lane-1" });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "START_MANUAL", id: "lane-1" });

    readyApp.stdin.write("\u001B9");
    await delay();
    expect(mocks.switchSession).not.toHaveBeenCalledWith(undefined);

    readyApp.stdin.write("\u001B2");
    await delay();
    expect(mocks.switchSession).toHaveBeenCalledWith("lane-2");

    readyApp.unmount();
    mocks.state.sessions = new Map([
      ["lane-1", laneOne],
      ["lane-2", laneTwo],
    ]);
    mocks.state.activeSessionId = "lane-1";
    const closeApp = render(<SessionView />);
    closeApp.stdin.write("c");
    await delay();
    expect(closeApp.lastFrame()).toContain("CLOSE LANE");
  });

  it("toggles raw transcript mode and forwards manual/edit submissions from the suggestion bar", async () => {
    const session = makeSession({
      viewMode: "transcript",
      status: "review",
      suggestion: { kind: "ready", result: { text: "Ship it", confidence: 91 } },
    });
    const app = mountSession(session);

    app.stdin.write("v");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "SET_SESSION_VIEW_MODE",
      id: "lane-1",
      viewMode: "raw",
    });

    expect(mocks.lastSuggestionBarProps?.onSubmitManual).toBeTypeOf("function");
    mocks.lastSuggestionBarProps?.onSubmitManual("manual steer");
    expect(mocks.injectText).toHaveBeenCalledWith(session.managed, "manual steer");
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SYNC_MANAGED_SESSION", id: "lane-1", managed: session.managed });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SUBMIT_TEXT", id: "lane-1", text: "manual steer", delivery: "manual" });

    mocks.lastSuggestionBarProps?.onSubmitEdit("edited steer");
    expect(mocks.injectText).toHaveBeenCalledWith(session.managed, "edited steer");
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SUBMIT_TEXT", id: "lane-1", text: "edited steer", delivery: "edited" });
  });

  it("cancels text entry, closes modal panes on escape, and opens the exit warning when idle", async () => {
    let app = mountSession(makeSession({
      suggestion: { kind: "manual-input" },
    }));
    app.stdin.write("\u001B");
    await delay();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "CANCEL_TEXT_ENTRY", id: "lane-1" });
    app.unmount();

    mocks.dispatch.mockClear();
    app = mountSession(makeSession());
    app.stdin.write("u");
    await delay();
    app.stdin.write("\u001B");
    await delay();
    expect(app.lastFrame()).not.toContain("RUNTIME EDITOR");

    app.stdin.write("c");
    await delay();
    expect(app.lastFrame()).toContain("CLOSE LANE");
    app.stdin.write("\u001B");
    await delay();
    expect(app.lastFrame()).not.toContain("CLOSE LANE");

    app.stdin.write("\u001B");
    await delay();
    expect(app.lastFrame()).toContain("EXIT WARNING");
    app.stdin.write("\u001B");
    await delay();
    expect(app.lastFrame()).not.toContain("EXIT WARNING");
  });

  it("opens the exit warning on Ctrl+C", async () => {
    const app = mountSession(makeSession());
    app.stdin.write("\u0003");
    await delay();
    expect(app.lastFrame()).toContain("EXIT WARNING");
  });

  it("ignores preview and pause shortcuts while editing or after exit", async () => {
    let app = mountSession(makeSession({
      status: "active",
      suggestion: { kind: "editing" },
      managed: {
        ...makeSession().managed,
        awaitingInput: false,
      },
    }));

    app.stdin.write("b");
    app.stdin.write("p");
    await delay();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "QUEUE_PREVIEW_BREAK" }));
    expect(mocks.dispatch).not.toHaveBeenCalledWith({ type: "PAUSE_SESSION", id: "lane-1" });
    app.unmount();

    mocks.dispatch.mockClear();
    app = mountSession(makeSession({
      status: "exited",
      managed: {
        ...makeSession().managed,
        awaitingInput: false,
      },
    }));
    app.stdin.write("p");
    await delay();
    expect(mocks.dispatch).not.toHaveBeenCalledWith({ type: "PAUSE_SESSION", id: "lane-1" });
  });

  it("returns early while confirmation panes or runtime editor are open", async () => {
    const app = mountSession(makeSession());

    app.stdin.write("u");
    await delay();
    app.stdin.write("a");
    await delay();
    expect(mocks.executeSuggestion).not.toHaveBeenCalled();

    app.stdin.write("\u001B");
    await delay();
    app.stdin.write("c");
    await delay();
    app.stdin.write("a");
    await delay();
    expect(mocks.executeSuggestion).not.toHaveBeenCalled();

    app.stdin.write("\u001B");
    await delay();
    app.stdin.write("\u001B");
    await delay();
    app.stdin.write("a");
    await delay();
    expect(mocks.executeSuggestion).not.toHaveBeenCalled();
  });

  it("opens close-lane confirmation and persists/removes the lane", async () => {
    const session = makeSession({
      status: "waiting",
      suggestion: { kind: "idle" },
    });
    const app = mountSession(session);

    app.stdin.write("c");
    await delay();
    expect(app.lastFrame()).toContain("CLOSE LANE");

    app.stdin.write("\r");
    await delay();
    expect(mocks.persistSessionState).toHaveBeenCalled();
    expect(session.managed.monitor.kill).toHaveBeenCalled();
    expect(session.managed.responderMonitor.kill).toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "REMOVE_SESSION", id: "lane-1" });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_SCREEN", screen: "home" });
  });

  it("persists generating lanes as waiting after cancelling generation during close", async () => {
    const session = makeSession({
      status: "active",
      suggestion: { kind: "generating" },
    });
    const app = mountSession(session);

    app.stdin.write("c");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.cancelGeneration).toHaveBeenCalled();
    expect(mocks.persistSessionState).toHaveBeenCalledWith(expect.objectContaining({
      id: "lane-1",
      status: "waiting",
      currentToolUse: null,
      currentToolDetail: null,
    }));
  });

  it("opens exit confirmation and exits after confirm", async () => {
    const app = mountSession(makeSession());

    app.stdin.write("\u001B");
    await delay();
    expect(app.lastFrame()).toContain("EXIT WARNING");

    app.stdin.write("\r");
    await delay();
    expect(mocks.cancelGeneration).toHaveBeenCalled();
    expect(mocks.persistSessionState).toHaveBeenCalled();
    expect(mocks.exit).toHaveBeenCalled();
  });

  it("starts sessions from CLI specs and renders the empty-lanes end state", async () => {
    mocks.parseSessionSpec.mockReturnValue({
      profileName: "codex",
      projectDir: "/tmp/nanobots",
      taskName: "feature-a",
    });
    mocks.createWorktree.mockResolvedValue({
      path: "/tmp/nanobots/.worktrees/feature-a",
    });
    mocks.state.sessions = new Map();
    mocks.state.activeSessionId = null;

    const app = render(<SessionView startSpecs={["nanobots:feature-a"]} />);
    await delay(50);

    expect(mocks.startSession).toHaveBeenCalledWith(expect.objectContaining({
      profileName: "codex",
      projectDir: "/tmp/nanobots",
      worktreePath: "/tmp/nanobots/.worktrees/feature-a",
      worktreeName: "feature-a",
      projectName: "nanobots",
    }));

    expect(app.lastFrame()).toContain("All lanes have ended. Press Ctrl+C to exit.");
  });

  it("falls back to process.cwd when a CLI spec omits projectDir", async () => {
    const cwd = process.cwd();
    mocks.parseSessionSpec.mockReturnValue({
      profileName: "claude-code",
      projectDir: "",
      taskName: "",
    });
    mocks.state.sessions = new Map();
    mocks.state.activeSessionId = null;

    render(<SessionView startSpecs={["appsicle"]} />);
    await delay(50);

    expect(mocks.startSession).toHaveBeenCalledWith(expect.objectContaining({
      projectDir: cwd,
      worktreePath: cwd,
      worktreeName: "main",
      projectName: expect.any(String),
    }));
  });

  it("passes runtime overrides from CLI specs into startSession", async () => {
    mocks.parseSessionSpec.mockReturnValue({
      profileName: "codex",
      projectDir: "/tmp/nanobots",
      taskName: "",
    });
    mocks.state.sessions = new Map();
    mocks.state.activeSessionId = null;

    render(<SessionView startSpecs={["nanobots"]} startRuntimeOverrides={{ codex: { model: "gpt-5.4", executionMode: "accelerated" } as any }} />);
    await delay(50);

    expect(mocks.startSession).toHaveBeenCalledWith(expect.objectContaining({
      runtimeOverrides: expect.objectContaining({
        model: "gpt-5.4",
        executionMode: "accelerated",
      }),
    }));
  });

  it("skips malformed CLI specs and falls back to the project directory when no task is requested", async () => {
    mocks.parseSessionSpec
      .mockImplementationOnce(() => {
        throw new Error("bad spec");
      })
      .mockReturnValueOnce({
        profileName: "claude-code",
        projectDir: "/tmp/appsicle",
        taskName: "",
      });
    mocks.state.sessions = new Map();
    mocks.state.activeSessionId = null;

    render(<SessionView startSpecs={["bad-spec", "appsicle"]} />);
    await delay(50);

    expect(mocks.startSession).toHaveBeenCalledTimes(1);
    expect(mocks.startSession).toHaveBeenCalledWith(expect.objectContaining({
      profileName: "claude-code",
      projectDir: "/tmp/appsicle",
      worktreePath: "/tmp/appsicle",
      worktreeName: "main",
      projectName: "appsicle",
    }));
    expect(mocks.createWorktree).not.toHaveBeenCalled();
  });
});
