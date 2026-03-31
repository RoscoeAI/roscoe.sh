import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import {
  buildInitialPrompt,
  createPartialDispatcher,
  getWorkerExitRecoveryDecision,
  handleGeneratedSuggestion,
  shouldQueueSuggestionForSession,
  stripMarkdown,
  useEventBridge,
} from "./use-event-bridge.js";
import { ManagedSession, SessionState } from "../types.js";
import * as config from "../config.js";
import { ProjectContext } from "../config.js";
import { HeadlessProfile } from "../llm-runtime.js";
import { EventEmitter } from "events";

const defaultProfile: HeadlessProfile = {
  name: "claude-code",
  command: "claude",
  args: [],
  protocol: "claude",
};

function makeManagedSession(overrides: Partial<ManagedSession> = {}): ManagedSession {
  return {
    id: "test-1",
    monitor: {} as any,
    responderMonitor: {} as any,
    profile: defaultProfile,
    responderProfile: defaultProfile,
    tracker: {} as any,
    awaitingInput: true,
    responderHistoryCursor: 0,
    profileName: "claude-code",
    projectName: "myproject",
    projectDir: "/tmp/myproject",
    worktreePath: "/tmp/myproject",
    worktreeName: "main",
    _paused: false,
    lastResponderPrompt: null,
    lastResponderCommand: null,
    lastResponderStrategy: null,
    lastResponderRuntimeSummary: null,
    lastResponderRationale: null,
    lastWorkerRuntimeSummary: null,
    lastWorkerRuntimeStrategy: null,
    lastWorkerRuntimeRationale: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "lane-1",
    profileName: "claude-code",
    projectName: "myproject",
    worktreeName: "main",
    startedAt: "2026-03-29T00:00:00.000Z",
    status: "waiting",
    outputLines: [],
    suggestion: { kind: "idle" },
    managed: makeManagedSession({
      tracker: {
        getContextForGeneration: () => "Remote turn exists",
      } as any,
    }),
    summary: null,
    currentToolUse: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    rateLimitStatus: null,
    timeline: [
      {
        id: "remote-1",
        kind: "remote-turn",
        timestamp: 1,
        provider: "claude-code",
        text: "Here is the latest result.",
      },
    ],
    viewMode: "transcript",
    scrollOffset: 0,
    followLive: true,
    preview: {
      mode: "off",
      message: null,
      link: null,
    },
    ...overrides,
  };
}

class FakeMonitor extends EventEmitter {
  private sessionId: string | null;

  constructor(sessionId: string | null = "worker-1") {
    super();
    this.sessionId = sessionId;
  }

  startTurn = vi.fn((prompt: string) => {
    this.sessionId = this.sessionId ?? "worker-1";
    return prompt;
  });

  sendFollowUp = vi.fn((prompt: string) => prompt);

  getSessionId = vi.fn(() => this.sessionId);

  kill = vi.fn();
}

function createService(overrides: Record<string, unknown> = {}) {
  return {
    generateSuggestion: vi.fn().mockResolvedValue({
      text: "Continue with the next slice.",
      confidence: 88,
      reasoning: "The next step is obvious.",
    }),
    executeSuggestion: vi.fn().mockResolvedValue(undefined),
    maybeNotifyIntervention: vi.fn().mockResolvedValue(undefined),
    maybeNotifyProgress: vi.fn().mockResolvedValue(undefined),
    generateSummary: vi.fn().mockResolvedValue("summary"),
    prepareWorkerTurn: vi.fn(),
    injectText: vi.fn(),
    generator: {
      meetsThreshold: vi.fn().mockReturnValue(false),
    },
    orchestrator: {
      unregisterWorker: vi.fn(),
    },
    ...overrides,
  };
}

function createBridgeSession(overrides: Partial<SessionState> = {}): SessionState {
  const tracker = {
    addOutput: vi.fn(),
    markTurnComplete: vi.fn(),
    recordUserInput: vi.fn(),
    getContextForGeneration: vi.fn(() => "Fresh remote turn"),
  };
  const managed = makeManagedSession({
    monitor: new FakeMonitor() as any,
    responderMonitor: new FakeMonitor("responder-1") as any,
    tracker: tracker as any,
    awaitingInput: true,
    restoreRecovery: null,
  });

  return makeSession({
    managed,
    preview: { mode: "off", message: null, link: null },
    ...overrides,
  });
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
}

function BridgeHarness({
  sessions,
  dispatch,
  service,
  autoMode,
}: {
  sessions: Map<string, SessionState>;
  dispatch: React.Dispatch<any>;
  service: any;
  autoMode: boolean;
}) {
  useEventBridge(sessions, dispatch, service, autoMode);
  return React.createElement(Text, null, "bridge");
}

describe("buildInitialPrompt", () => {
  it("includes project name", () => {
    const prompt = buildInitialPrompt(makeManagedSession(), null);
    expect(prompt).toContain("myproject");
  });

  it("includes tech stack when context provided", () => {
    const ctx: ProjectContext = {
      name: "proj",
      directory: "/tmp",
      goals: ["ship v1"],
      milestones: [],
      techStack: ["React", "TypeScript"],
      notes: "",
      runtimeDefaults: {
        verificationCadence: "batched",
      },
      intentBrief: {
        projectStory: "Ship safely",
        primaryUsers: ["operators"],
        definitionOfDone: ["Frontend and backend workflows meet the operator outcome"],
        acceptanceChecks: ["Measured coverage proves the full workflow"],
        successSignals: ["operators can finish the task"],
        deliveryPillars: {
          frontend: ["Frontend flow is complete"],
          backend: ["Backend API flow is complete"],
          unitComponentTests: ["Unit/component tests prove changed frontend/backend behavior with reasonable coverage across regressions and edge cases"],
          e2eTests: ["E2E tests prove the full workflow with risk-based coverage across success and failure modes"],
        },
        coverageMechanism: ["Vitest and Playwright runs provide the canonical validation path for this repo"],
        nonGoals: [],
        constraints: [],
        architecturePrinciples: ["Reuse shared workflow modules and keep audit logging consistent across material writes"],
        autonomyRules: [],
        qualityBar: ["Do not call done without reasonable, risk-based proof on changed behavior and important failure modes"],
        riskBoundaries: [],
        uiDirection: "",
      },
    };
    const prompt = buildInitialPrompt(makeManagedSession(), ctx);
    expect(prompt).toContain("React, TypeScript");
    expect(prompt).toContain("ship v1");
    expect(prompt).toContain("Frontend pillar");
    expect(prompt).toContain("Coverage mechanism");
    expect(prompt).toContain("Architecture principles");
    expect(prompt).toContain("Verification cadence: batch the heavy proof stack");
  });

  it("includes task/branch for non-main worktrees", () => {
    const managed = makeManagedSession({ worktreeName: "fix-auth" });
    const prompt = buildInitialPrompt(managed, {
      name: "proj",
      directory: "/tmp",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "",
      runtimeDefaults: {
        verificationCadence: "batched",
      },
    });
    expect(prompt).toContain("fix-auth");
    expect(prompt).toContain("Work in thin vertical slices");
    expect(prompt).toContain("Use risk-based verification");
    expect(prompt).toContain("Do not mechanically rerun the full repo-wide proof stack");
    expect(prompt).toContain("agent or sub-agent delegation");
  });

  it("tells main worktree to await instructions", () => {
    const prompt = buildInitialPrompt(makeManagedSession(), null);
    expect(prompt).toContain("await further instructions");
    expect(prompt).toContain("thin slices, narrow proof, and progressive hardening");
  });

  it("includes the richer project contract when provided", () => {
    const managed = makeManagedSession({
      worktreeName: "preview-adapter",
      profile: {
        ...defaultProfile,
        runtime: {
          tuningMode: "manual",
        },
      },
    });
    const ctx: ProjectContext = {
      name: "proj",
      directory: "/tmp",
      goals: ["ship hosted preview", "match K12 semantics"],
      milestones: [],
      techStack: ["React", "TypeScript", "Fly"],
      notes: "Preserve the current contract surface.",
      runtimeDefaults: {
        guildProvider: "codex",
        responderProvider: "claude",
        workerGovernanceMode: "guild-autonomous",
        verificationCadence: "prove-each-slice",
        tokenEfficiencyMode: "balanced",
      },
      intentBrief: {
        projectStory: "Hosted preview should be truthful from the first route.",
        primaryUsers: ["operators"],
        definitionOfDone: ["Hosted preview is routable and honest"],
        acceptanceChecks: ["Health checks and preview runner both pass"],
        successSignals: ["operators can verify live proof quickly"],
        entrySurfaceContract: {
          summary: "Default route should explain preview readiness.",
          defaultRoute: "/",
          expectedExperience: "User lands on a truthful hosted preview status page.",
          allowedShellStates: ["loading"],
        },
        localRunContract: {
          summary: "Local dev should mirror hosted preview boot flow.",
          startCommand: "pnpm dev",
          firstRoute: "http://localhost:3000",
          prerequisites: ["Postgres running", "Fly token set"],
          seedRequirements: ["Seed demo tenant"],
          expectedBlockedStates: ["Preview image not yet published"],
          operatorSteps: ["Open / and verify truthful hosted preview status"],
        },
        acceptanceLedgerMode: "inferred",
        acceptanceLedger: [
          { label: "Preview runner proves health", status: "open", evidence: [], notes: "" },
        ],
        deliveryPillars: {
          frontend: ["Route clearly explains preview state"],
          backend: ["Runner exposes health and reset endpoints"],
          unitComponentTests: ["Adapter tests cover healthy and stalled boot"],
          e2eTests: ["Hosted preview can be opened and verified end to end"],
        },
        coverageMechanism: ["Vitest plus targeted live preview checks"],
        deploymentContract: {
          artifactType: "web-app",
          mode: "planned-greenfield",
          summary: "Hosted proof is required before this can be called complete.",
          platforms: ["Fly.io", "GitHub Actions"],
          environments: ["preview", "production"],
          buildSteps: ["pnpm build", "docker build preview-runner"],
          deploySteps: ["fly deploy preview-runner"],
          previewStrategy: ["Deploy preview runner before production cutover"],
          presenceStrategy: ["Keep stage.appsicle.ai truthful as slices land"],
          proofTargets: ["stage.appsicle.ai", "preview URL from Fly"],
          healthChecks: ["GET /health returns ready true"],
          rollback: ["Redeploy previous Fly image"],
          requiredSecrets: ["FLY_API_TOKEN", "PREVIEW_RUNNER_IMAGE"],
        },
        nonGoals: ["Do not publish production domain yet"],
        constraints: [],
        architecturePrinciples: ["Keep adapter surface aligned with K12"],
        autonomyRules: ["Continue when the next slice is obvious"],
        qualityBar: ["Do not claim done without hosted proof"],
        riskBoundaries: ["Do not silently swallow preview boot failures"],
        uiDirection: "",
      },
    };

    const prompt = buildInitialPrompt(managed, ctx);

    expect(prompt).toContain("Worker provider is locked to codex");
    expect(prompt).toContain("Roscoe is responding from the claude provider while you execute on codex.");
    expect(prompt).toContain("Runtime tuning mode: manual.");
    expect(prompt).toContain("Governance mode: Guild autonomous.");
    expect(prompt).toContain("Entry surface contract: Default route should explain preview readiness.");
    expect(prompt).toContain("Local prerequisites: Postgres running; Fly token set.");
    expect(prompt).toContain("Seed requirements: Seed demo tenant.");
    expect(prompt).toContain("Honest blocked states: Preview image not yet published.");
    expect(prompt).toContain("Acceptance ledger is inferred from an older brief");
    expect(prompt).toContain("Acceptance ledger: Preview runner proves health [open].");
    expect(prompt).toContain("Deployment platforms: Fly.io; GitHub Actions.");
    expect(prompt).toContain("Hosted presence strategy: Keep stage.appsicle.ai truthful as slices land.");
    expect(prompt).toContain("Hosted proof targets: stage.appsicle.ai; preview URL from Fly.");
    expect(prompt).toContain("Deployment secrets expected in local env files: FLY_API_TOKEN; PREVIEW_RUNNER_IMAGE.");
    expect(prompt).toContain("Do not drift into these non-goals: Do not publish production domain yet.");
    expect(prompt).toContain("Autonomy rules: Continue when the next slice is obvious.");
    expect(prompt).toContain("Quality bar: Do not claim done without hosted proof.");
    expect(prompt).toContain("Risk boundaries: Do not silently swallow preview boot failures.");
    expect(prompt).toContain("Verification cadence: prove each slice.");
    expect(prompt).not.toContain("Token efficiency mode: Roscoe stays lighter by default");
  });
});

describe("shouldQueueSuggestionForSession", () => {
  it("returns true for a waiting lane that needs a fresh Roscoe draft", () => {
    expect(shouldQueueSuggestionForSession(makeSession())).toBe(true);
  });

  it("returns false when a stale pending local suggestion is still present", () => {
    const session = makeSession({
      timeline: [
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "claude-code",
          text: "Here is the latest result.",
        },
        {
          id: "suggestion-1",
          kind: "local-suggestion",
          timestamp: 2,
          text: "park it",
          confidence: 90,
          reasoning: "looks done",
          state: "pending",
        },
      ],
    });
    expect(shouldQueueSuggestionForSession(session)).toBe(false);
  });

  it("returns false for parked or blocked lanes", () => {
    expect(shouldQueueSuggestionForSession(makeSession({ status: "parked" }))).toBe(false);
    expect(shouldQueueSuggestionForSession(makeSession({ status: "blocked" }))).toBe(false);
  });

  it("returns false when the latest remote turn is already a parked decision", () => {
    const session = makeSession({
      summary: "Earlier work summary",
      timeline: [
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "claude-code",
          text: "Parked.",
        },
      ],
    });

    expect(shouldQueueSuggestionForSession(session)).toBe(false);
  });

  it("returns false for a parked echo loop even if the saved lane status is stale", () => {
    expect(shouldQueueSuggestionForSession(makeSession({
      status: "generating",
      timeline: [
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
      ],
    }))).toBe(false);
  });
});

describe("stripMarkdown", () => {
  it("removes bold markers", () => {
    expect(stripMarkdown("**bold text**")).toBe("bold text");
  });

  it("removes italic markers", () => {
    expect(stripMarkdown("*italic*")).toBe("italic");
  });

  it("removes inline code backticks", () => {
    expect(stripMarkdown("`code`")).toBe("code");
  });

  it("removes heading markers", () => {
    expect(stripMarkdown("## Heading")).toBe("Heading");
    expect(stripMarkdown("### Sub")).toBe("Sub");
  });

  it("removes blockquote markers", () => {
    expect(stripMarkdown("> quoted")).toBe("quoted");
  });

  it("normalizes list markers to dash", () => {
    expect(stripMarkdown("* item")).toBe("- item");
    expect(stripMarkdown("+ item")).toBe("- item");
    expect(stripMarkdown("- item")).toBe("- item");
  });
});

describe("createPartialDispatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches immediately, throttles tiny updates, and sends larger jumps", () => {
    const dispatch = vi.fn();
    const pushPartial = createPartialDispatcher(dispatch, "lane-1");

    pushPartial("initial");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "UPDATE_PARTIAL",
      id: "lane-1",
      partial: "initial",
    });

    vi.setSystemTime(new Date("2026-03-29T00:00:00.040Z"));
    pushPartial("tiny");
    expect(dispatch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-03-29T00:00:00.041Z"));
    pushPartial("this partial grew enough to force a flush");
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "UPDATE_PARTIAL",
      id: "lane-1",
      partial: "this partial grew enough to force a flush",
    });

    vi.setSystemTime(new Date("2026-03-29T00:00:00.200Z"));
    pushPartial("late update");
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "UPDATE_PARTIAL",
      id: "lane-1",
      partial: "late update",
    });
  });
});

describe("handleGeneratedSuggestion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-sends resumed suggestions when AUTO mode is enabled and the draft clears threshold", async () => {
    const dispatch = vi.fn();
    const executeSuggestion = vi.fn().mockResolvedValue(undefined);
    const service = {
      executeSuggestion,
      maybeNotifyIntervention: vi.fn().mockResolvedValue(undefined),
      generator: {
        meetsThreshold: vi.fn().mockReturnValue(true),
      },
    };
    const managed = { awaitingInput: true } as any;
    const result = {
      text: "Keep the fix narrow and rerun coverage.",
      confidence: 94,
      reasoning: "The transcript already points to the next proof step.",
    };

    await handleGeneratedSuggestion(dispatch, service as any, managed, "lane-1", result, true);

    expect(service.generator.meetsThreshold).toHaveBeenCalledWith(result);
    expect(executeSuggestion).toHaveBeenCalledWith(managed, result);
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "SUGGESTION_READY", id: "lane-1", result });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "AUTO_SENT", id: "lane-1", text: result.text, confidence: 94 });
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "SYNC_MANAGED_SESSION", id: "lane-1", managed });

    vi.runAllTimers();
    expect(dispatch).toHaveBeenLastCalledWith({ type: "CLEAR_AUTO_SENT", id: "lane-1" });
  });

  it("leaves resumed suggestions in review when AUTO mode is off", async () => {
    const dispatch = vi.fn();
    const executeSuggestion = vi.fn().mockResolvedValue(undefined);
    const service = {
      executeSuggestion,
      maybeNotifyIntervention: vi.fn().mockResolvedValue(undefined),
      generator: {
        meetsThreshold: vi.fn().mockReturnValue(true),
      },
    };
    const result = {
      text: "Do the next proof step.",
      confidence: 95,
      reasoning: "The path is clear.",
    };

    await handleGeneratedSuggestion(dispatch, service as any, {} as any, "lane-2", result, false);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "SUGGESTION_READY", id: "lane-2", result });
    expect(executeSuggestion).not.toHaveBeenCalled();
    expect(service.maybeNotifyIntervention).toHaveBeenCalledWith(expect.anything(), {
      kind: "needs-review",
      detail: expect.stringContaining("Roscoe drafted the next Guild message"),
    });
  });

  it("holds a generated suggestion when a preview break is armed", async () => {
    const dispatch = vi.fn();
    const executeSuggestion = vi.fn().mockResolvedValue(undefined);
    const service = {
      executeSuggestion,
      maybeNotifyIntervention: vi.fn().mockResolvedValue(undefined),
      generator: {
        meetsThreshold: vi.fn().mockReturnValue(true),
      },
    };
    const onHoldForPreview = vi.fn();
    const result = {
      text: "Ask the worker to keep going.",
      confidence: 93,
      reasoning: "The next step is clear.",
    };

    await handleGeneratedSuggestion(dispatch, service as any, {} as any, "lane-3", result, true, {
      shouldHoldForPreview: () => true,
      onHoldForPreview,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "SUGGESTION_READY", id: "lane-3", result });
    expect(onHoldForPreview).toHaveBeenCalledTimes(1);
    expect(executeSuggestion).not.toHaveBeenCalled();
  });

  it("uses the empty-text intervention detail when Roscoe has nothing to send yet", async () => {
    const dispatch = vi.fn();
    const maybeNotifyIntervention = vi.fn().mockResolvedValue(undefined);
    const service = {
      executeSuggestion: vi.fn().mockResolvedValue(undefined),
      maybeNotifyIntervention,
      generator: {
        meetsThreshold: vi.fn().mockReturnValue(false),
      },
    };

    await handleGeneratedSuggestion(
      dispatch,
      service as any,
      {} as any,
      "lane-4",
      {
        text: "   ",
        confidence: 30,
        reasoning: "Still needs clarification.",
      },
      true,
    );

    expect(maybeNotifyIntervention).toHaveBeenCalledWith(expect.anything(), {
      kind: "needs-review",
      detail: "Roscoe is holding the next Guild turn and wants your direction before sending anything.",
    });
    expect(service.executeSuggestion).not.toHaveBeenCalled();
  });
});

describe("getWorkerExitRecoveryDecision", () => {
  it("recovers a nonzero worker exit into restage mode when auto-heal is enabled and Roscoe had already handed off", () => {
    const managed = makeManagedSession({ awaitingInput: false });
    const session = makeSession({
      timeline: [
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "codex",
          text: "I am implementing the media evidence slice now.",
        },
        {
          id: "local-1",
          kind: "local-sent",
          timestamp: 2,
          text: "Implement the media evidence slice and report back with proof.",
          delivery: "auto",
        },
      ],
    });

    const result = getWorkerExitRecoveryDecision(
      managed,
      session,
      null,
      "Bash",
      2,
      true,
    );

    expect(result.appendError).toBe(true);
    expect(result.removeLane).toBe(false);
    expect(result.recovery).toMatchObject({
      mode: "restage-roscoe",
    });
  });

  it("treats the same nonzero exit as terminal when auto-heal is disabled", () => {
    const managed = makeManagedSession({ awaitingInput: false });
    const session = makeSession({
      timeline: [
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "codex",
          text: "I am implementing the media evidence slice now.",
        },
        {
          id: "local-1",
          kind: "local-sent",
          timestamp: 2,
          text: "Implement the media evidence slice and report back with proof.",
          delivery: "auto",
        },
      ],
    });

    const result = getWorkerExitRecoveryDecision(
      managed,
      session,
      null,
      "Bash",
      2,
      false,
    );

    expect(result.recovery).toBeNull();
    expect(result.appendError).toBe(true);
    expect(result.removeLane).toBe(true);
  });

  it("keeps paused lanes from being removed on exit", () => {
    const managed = makeManagedSession({ _paused: true, awaitingInput: false });
    const session = makeSession();

    const result = getWorkerExitRecoveryDecision(
      managed,
      session,
      null,
      null,
      2,
      true,
    );

    expect(result.recovery).toBeNull();
    expect(result.appendError).toBe(false);
    expect(result.removeLane).toBe(false);
  });
});

describe("useEventBridge", () => {
  beforeEach(() => {
    vi.spyOn(config, "loadProjectContext").mockReturnValue(null);
    vi.spyOn(config, "loadRoscoeSettings").mockReturnValue({
      notifications: {
        enabled: false,
        phoneNumber: "",
        consentAcknowledged: false,
        consentProofUrls: [],
        provider: "twilio",
        deliveryMode: "unconfigured",
        hostedTestVerifiedPhone: "",
        hostedRelayClientId: "",
        hostedRelayAccessToken: "",
        hostedRelayAccessTokenExpiresAt: "",
        hostedRelayRefreshToken: "",
        hostedRelayLinkedPhone: "",
        hostedRelayLinkedEmail: "",
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: true },
      },
      behavior: {
        autoHealMetadata: true,
        preventSleepWhileRunning: true,
        parkAtMilestonesForReview: false,
      },
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("auto-starts a worker turn when the lane has no native session yet", async () => {
    const session = createBridgeSession();
    const monitor = new FakeMonitor(null);
    session.managed.monitor = monitor as any;
    const tracker = session.managed.tracker as any;
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();

    expect(service.prepareWorkerTurn).toHaveBeenCalledTimes(1);
    expect(monitor.startTurn).toHaveBeenCalledTimes(1);
    expect(tracker.recordUserInput).toHaveBeenCalledTimes(1);
    expect(session.managed.awaitingInput).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({ type: "SYNC_MANAGED_SESSION", id: session.id, managed: session.managed });
  });

  it("queues a Roscoe suggestion on mount when a worker is waiting with fresh remote output", async () => {
    const session = createBridgeSession();
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();
    await flushEffects();

    expect(service.generateSuggestion).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "START_GENERATING", id: session.id });
  });

  it("re-blocks a lane on mount when the last remote turn is a pause acknowledgement", async () => {
    const session = createBridgeSession({
      timeline: [{
        id: "remote-pause",
        kind: "remote-turn",
        timestamp: 10,
        provider: "codex",
        text: "Paused.",
      }],
    });
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();

    expect(session.managed._paused).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "BLOCK_SESSION", id: session.id });
    expect(service.generateSuggestion).not.toHaveBeenCalled();
  });

  it("moves a lane into manual input when a turn completes with no follow-up context", async () => {
    const session = createBridgeSession();
    (session.managed.tracker as any).getContextForGeneration = vi.fn(() => "   ");
    const monitor = session.managed.monitor as unknown as FakeMonitor;
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();

    monitor.emit("text", "Need human direction.");
    monitor.emit("turn-complete");
    await flushEffects();

    expect(dispatch).toHaveBeenCalledWith({ type: "START_MANUAL", id: session.id });
    expect(service.maybeNotifyIntervention).toHaveBeenCalledWith(session.managed, {
      kind: "manual-input",
      detail: "Guild is waiting for your next instruction. Reply here with what Roscoe should send next.",
    });
  });

  it("blocks a lane when the worker explicitly acknowledges pause on turn complete", async () => {
    const session = createBridgeSession();
    (session.managed.tracker as any).getContextForGeneration = vi.fn(() => "stale");
    const monitor = session.managed.monitor as unknown as FakeMonitor;
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();

    monitor.emit("text", "Still down. Paused.");
    monitor.emit("turn-complete");
    await flushEffects();

    expect(session.managed._paused).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "BLOCK_SESSION", id: session.id });
    expect(service.maybeNotifyIntervention).toHaveBeenCalledWith(session.managed, {
      kind: "paused",
      detail: "Still down. Paused.",
    });
  });

  it("parks a lane when a terminal parked exchange is inferred on turn complete", async () => {
    const session = createBridgeSession({
      timeline: [{
        id: "local-park",
        kind: "local-sent",
        timestamp: 1,
        text: "Parked.",
        delivery: "auto",
      }],
    });
    const monitor = session.managed.monitor as unknown as FakeMonitor;
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();

    monitor.emit("text", "Parked.");
    monitor.emit("turn-complete");
    await flushEffects();

    expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_SESSION_STATUS", id: session.id, status: "parked" });
    expect(service.generateSuggestion).not.toHaveBeenCalled();
  });

  it("forwards usage, rate-limit, and result events from the worker monitor", async () => {
    const session = createBridgeSession();
    const monitor = session.managed.monitor as unknown as FakeMonitor;
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();

    monitor.emit("usage", {
      inputTokens: 11,
      outputTokens: 7,
      cachedInputTokens: 3,
      cacheCreationInputTokens: 1,
    });
    monitor.emit("rate-limit", {
      source: "claude",
      windowLabel: "5h",
      status: "allowed",
      resetsAt: "2026-03-30T20:00:00.000Z",
    });
    monitor.emit("result");

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION_USAGE",
      id: session.id,
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        cachedInputTokens: 3,
        cacheCreationInputTokens: 1,
      },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_SESSION_RATE_LIMIT",
      id: session.id,
      rateLimitStatus: {
        source: "claude",
        windowLabel: "5h",
        status: "allowed",
        resetsAt: "2026-03-30T20:00:00.000Z",
      },
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "SYNC_MANAGED_SESSION", id: session.id, managed: session.managed });
  });

  it("updates detail for repeated tool activity without appending a second tool entry", async () => {
    const session = createBridgeSession();
    const monitor = session.managed.monitor as unknown as FakeMonitor;
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();

    monitor.emit("tool-activity", "bash", "running tests");
    monitor.emit("tool-activity", "bash", "still running tests");

    const toolEntries = dispatch.mock.calls.filter(([action]) => action.type === "APPEND_TIMELINE_ENTRY" && action.entry?.kind === "tool-activity");
    expect(toolEntries).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_TOOL_ACTIVITY",
      id: session.id,
      toolName: "bash",
      detail: "still running tests",
    });
  });

  it("records summarized thinking notes on completed remote turns", async () => {
    const session = createBridgeSession();
    const monitor = session.managed.monitor as unknown as FakeMonitor;
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();

    monitor.emit("thinking", "### Inspecting **state** and _next steps_ in detail.");
    monitor.emit("text", "Worker replied with a concrete update.");
    monitor.emit("turn-complete");
    await flushEffects();

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPEND_TIMELINE_ENTRY",
      id: session.id,
      entry: expect.objectContaining({
        kind: "remote-turn",
        note: "Inspecting state and _next steps_ in detail.",
      }),
    }));
  });

  it("activates a preview break instead of sending when Roscoe drafts into a queued preview hold", async () => {
    const session = createBridgeSession({
      outputLines: ["Preview ready at https://preview.example.com"],
      timeline: [
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "claude-code",
          text: "Preview ready at https://preview.example.com",
        },
      ],
    });
    const dispatch = vi.fn();
    let resolveSuggestion: ((value: { text: string; confidence: number; reasoning: string; }) => void) | null = null;
    const service = createService({
      generateSuggestion: vi.fn().mockImplementation(
        () => new Promise((resolve) => {
          resolveSuggestion = resolve;
        }),
      ),
    });

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();
    session.preview = {
      mode: "queued",
      message: "Preview queued",
      link: null,
    } as any;
    resolveSuggestion?.({
      text: "Ship it.",
      confidence: 95,
      reasoning: "Preview looks ready.",
    });
    await flushEffects();

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ACTIVATE_PREVIEW_BREAK",
      id: session.id,
    }));
    expect(service.executeSuggestion).not.toHaveBeenCalled();
  });

  it("reports Roscoe generation failures that occur while auto-queueing a suggestion", async () => {
    const session = createBridgeSession();
    const dispatch = vi.fn();
    const service = createService({
      generateSuggestion: vi.fn().mockRejectedValue(new Error("sidecar blew up")),
    });

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();
    await flushEffects();

    expect(service.maybeNotifyIntervention).toHaveBeenCalledWith(session.managed, {
      kind: "error",
      detail: "sidecar blew up",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SUGGESTION_ERROR",
      id: session.id,
      message: "sidecar blew up",
    });
  });

  it("rewires a lane cleanly after it is removed and later re-added", async () => {
    const session = createBridgeSession();
    const dispatch = vi.fn();
    const service = createService();
    const app = render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();
    await flushEffects();

    expect(service.generateSuggestion).toHaveBeenCalledTimes(1);

    app.rerender(React.createElement(BridgeHarness, { sessions: new Map(), dispatch, service, autoMode: true }));
    await flushEffects();

    const readdedSession = createBridgeSession();
    readdedSession.id = session.id;
    app.rerender(React.createElement(BridgeHarness, { sessions: new Map([[readdedSession.id, readdedSession]]), dispatch, service, autoMode: true }));
    await flushEffects();
    await flushEffects();

    expect(service.generateSuggestion).toHaveBeenCalledTimes(2);
  });

  it("recovers a resume-worker restore plan, updates watchdog status, and injects the resume prompt", async () => {
    vi.useFakeTimers();
    const session = createBridgeSession();
    const monitor = session.managed.monitor as unknown as FakeMonitor;
    session.managed.awaitingInput = false;
    session.managed.restoreRecovery = {
      mode: "resume-worker",
      prompt: "Resume from the interrupted handoff.",
      note: "Roscoe resumed the worker.",
    };
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();

    expect(service.injectText).toHaveBeenCalledWith(session.managed, "Resume from the interrupted handoff.");
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TOOL_ACTIVITY", id: session.id, toolName: "resume", detail: "Resuming interrupted Guild turn..." });

    session.currentToolUse = "resume";
    session.currentToolDetail = "Resuming interrupted Guild turn...";
    await vi.advanceTimersByTimeAsync(15_000);
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TOOL_ACTIVITY", id: session.id, toolName: "resume", detail: "Still waiting on resumed worker..." });

    monitor.emit("text", "resumed output");
    await flushEffects();
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TOOL_ACTIVITY", id: session.id, toolName: "resume", detail: "Resumed worker is responding..." });
  });

  it("restages Roscoe after restore when the worker session cannot be resumed", async () => {
    const session = createBridgeSession();
    (session.managed.monitor as unknown as FakeMonitor).getSessionId = vi.fn(() => null);
    session.managed.restoreRecovery = {
      mode: "restage-roscoe",
      note: "Roscoe is restaging this lane.",
    };
    const dispatch = vi.fn();
    const service = createService();

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();
    await flushEffects();

    expect(session.managed.awaitingInput).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TOOL_ACTIVITY", id: session.id, toolName: null });
    expect(service.generateSuggestion).toHaveBeenCalled();
  });

  it("marks a lane exited and removes it after a terminal worker exit", async () => {
    vi.useFakeTimers();
    const session = createBridgeSession({
      timeline: [{
        id: "remote-1",
        kind: "remote-turn",
        timestamp: 1,
        provider: "codex",
        text: "Worker was still exploring.",
      }],
    });
    session.managed.awaitingInput = false;
    const monitor = session.managed.monitor as unknown as FakeMonitor;
    const dispatch = vi.fn();
    const service = createService();
    vi.mocked(config.loadRoscoeSettings).mockReturnValue({
      behavior: { autoHealMetadata: false },
    } as any);

    render(React.createElement(BridgeHarness, { sessions: new Map([[session.id, session]]), dispatch, service, autoMode: true }));
    await flushEffects();

    monitor.emit("exit", 2);
    await flushEffects();
    expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_SESSION_STATUS", id: session.id, status: "exited" });

    await vi.advanceTimersByTimeAsync(2000);
    expect(dispatch).toHaveBeenCalledWith({ type: "REMOVE_SESSION", id: session.id });
    expect(service.orchestrator.unregisterWorker).toHaveBeenCalledWith(session.id);
  });
});
