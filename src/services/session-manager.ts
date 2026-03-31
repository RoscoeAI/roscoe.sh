import { resolve } from "path";
import { homedir } from "os";
import {
  getProjectContractFingerprint,
  loadLaneSession,
  loadProfile,
  loadProjectContext,
  loadRoscoeSettings,
  resolveProjectRoot,
  saveLaneSession,
} from "../config.js";
import { SessionMonitor } from "../session-monitor.js";
import { ConversationTracker } from "../conversation-tracker.js";
import {
  ResponseGenerator,
  SuggestionResult,
  BrowserAction,
  OrchestratorAction,
  SessionInfo,
} from "../response-generator.js";
import { InputInjector } from "../input-injector.js";
import { BrowserAgent } from "../browser-agent.js";
import { Orchestrator } from "../orchestrator.js";
import { ManagedSession, SessionStartOpts, ParsedSessionSpec, SessionStartResult, SessionState } from "../types.js";
import { detectProtocol, LLMProtocol, startOneShotRun, summarizeRuntime, RuntimeControlSettings, RuntimeUsageSnapshot } from "../llm-runtime.js";
import { NotificationService } from "../notification-service.js";
import type { SmsInterventionRequest } from "../notification-service.js";
import {
  applyRuntimeSettings,
  getDefaultProfileName,
  getLockedProjectProvider,
  getResponderProvider,
  getResponderProfileForProject,
  getRuntimeTuningMode,
  getWorkerProfileForProject,
  mergeRuntimeSettings,
  recommendWorkerRuntime,
} from "../runtime-defaults.js";
import {
  getRestoreRecoveryPlan,
  hasBoundedFutureWorkSignal,
  inferAwaitingInput,
  inferTerminalParkedState,
} from "../session-transcript.js";
import { recoverPreviewState } from "../session-preview.js";
import { applyProjectEnvToProfile } from "../project-secrets.js";

export class SessionManagerService {
  generator: ResponseGenerator;
  injector: InputInjector;
  browserAgent: BrowserAgent | null = null;
  orchestrator: Orchestrator | null = null;
  notifications: NotificationService;

  constructor(threshold = 70) {
    this.generator = new ResponseGenerator(threshold);
    this.injector = new InputInjector();
    this.notifications = new NotificationService();
  }

  startSession(opts: SessionStartOpts): SessionStartResult {
    const { profileName, projectDir, worktreePath, worktreeName, projectName, runtimeOverrides } = opts;
    const canonicalProjectDir = resolveProjectRoot(projectDir);
    const canonicalWorktreePath = resolveProjectRoot(worktreePath);
    const projectContext = loadProjectContext(canonicalProjectDir);
    const requestedProfile = loadProfile(profileName);
    const requestedProtocol = detectProtocol(requestedProfile);
    const lockedProvider = getLockedProjectProvider(projectContext);
    const effectiveProfileName = lockedProvider && requestedProtocol !== lockedProvider
      ? getDefaultProfileName(lockedProvider)
      : profileName;
    const baseProfile = effectiveProfileName === profileName
      ? requestedProfile
      : loadProfile(effectiveProfileName);
    const profile = applyProjectEnvToProfile(
      getWorkerProfileForProject(baseProfile, projectContext, runtimeOverrides),
      canonicalWorktreePath,
    );
    const responderProvider = getResponderProvider(projectContext) ?? detectProtocol(baseProfile);
    const responderBaseProfile = responderProvider === detectProtocol(baseProfile)
      ? baseProfile
      : loadProfile(getDefaultProfileName(responderProvider));
    const responderProfile = applyProjectEnvToProfile(
      getResponderProfileForProject(responderBaseProfile, projectContext),
      canonicalWorktreePath,
    );
    const id = `${effectiveProfileName}-${projectName}-${worktreeName}-${Date.now()}`;

    // SessionMonitor now takes a HeadlessProfile — just name, command, args
    const monitor = new SessionMonitor(
      id,
      profile,
      canonicalWorktreePath,
    );
    const responderMonitor = new SessionMonitor(
      `${id}-responder`,
      responderProfile,
      canonicalWorktreePath,
    );
    const tracker = new ConversationTracker();
    const behaviorSettings = loadRoscoeSettings().behavior;
    const autoHealMetadata = behaviorSettings.autoHealMetadata;
    const parkAtMilestonesForReview = behaviorSettings.parkAtMilestonesForReview;
    const restoredLane = loadLaneSession(canonicalProjectDir, canonicalWorktreePath, worktreeName, effectiveProfileName);
    const restoredTimeline = restoredLane?.timeline ?? [];
    const shouldRestoreNativeSessions = !autoHealMetadata || restoredLane?.status !== "exited";
    const restoredPreview = restoredLane
      ? recoverPreviewState(restoredLane.preview, {
          timeline: restoredTimeline,
          outputLines: restoredLane.outputLines ?? [],
          summary: restoredLane.summary ?? null,
        })
      : undefined;
    const restoreRecovery = autoHealMetadata && restoredLane?.status === "exited"
      ? {
          mode: "restage-roscoe" as const,
          note: "Roscoe reopened this lane from saved history because the previous native worker session had already ended.",
        }
      : getRestoreRecoveryPlan(
          restoredTimeline,
          restoredLane?.providerSessionId ?? null,
          restoredLane?.currentToolUse ?? null,
        );
    if (restoredLane?.trackerHistory?.length) {
      tracker.restoreHistory(restoredLane.trackerHistory);
    }
    if (shouldRestoreNativeSessions && restoredLane?.providerSessionId) {
      monitor.restoreSessionId(restoredLane.providerSessionId);
    }
    if (
      shouldRestoreNativeSessions
      && restoredLane?.responderSessionId
      && restoredLane.responderProtocol === detectProtocol(responderProfile)
    ) {
      responderMonitor.restoreSessionId(restoredLane.responderSessionId);
    }

    const deploymentContract = projectContext?.intentBrief?.deploymentContract;
    const isDeferredWebDeployment = deploymentContract?.mode === "defer"
      && /\bweb app\b|\bsite\b|\bfrontend\b|\bembed\b|\bbuilder\b/i.test(deploymentContract?.artifactType ?? "");
    const shouldReopenPrematureParkedLane = autoHealMetadata
      && !parkAtMilestonesForReview
      && restoredLane?.status === "parked"
      && (
        hasBoundedFutureWorkSignal(restoredTimeline)
        || isDeferredWebDeployment
      );
    const effectiveRestoreRecovery = shouldReopenPrematureParkedLane
      ? {
          mode: "restage-roscoe" as const,
          note: "Roscoe reopened this parked lane because milestone parking is off and the saved contract still points to remaining work.",
        }
      : restoreRecovery;

    const managed: ManagedSession = {
      id,
      monitor,
      responderMonitor,
      profile,
      responderProfile,
      tracker,
      awaitingInput: inferAwaitingInput(restoredTimeline, null),
      responderHistoryCursor: restoredLane?.responderHistoryCursor ?? 0,
      profileName: effectiveProfileName,
      projectName,
      projectDir: canonicalProjectDir,
      worktreePath: canonicalWorktreePath,
      worktreeName,
      _paused: false,
      runtimeOverrides,
      lastResponderPrompt: null,
      lastResponderCommand: null,
      lastResponderStrategy: getRuntimeTuningMode(responderProfile.runtime) === "manual" ? "manual-pinned" : "auto-managed",
      lastResponderRuntimeSummary: summarizeRuntime(responderProfile),
      lastResponderRationale: getRuntimeTuningMode(responderProfile.runtime) === "manual"
        ? "Pinned to the configured Roscoe model and reasoning within the locked provider."
        : "Roscoe can retune its own model and reasoning within the locked provider before the next reply.",
      lastWorkerRuntimeSummary: summarizeRuntime(profile),
      lastWorkerRuntimeStrategy: getRuntimeTuningMode(profile.runtime) === "manual" ? "manual-pinned" : "auto-managed",
      lastWorkerRuntimeRationale: getRuntimeTuningMode(profile.runtime) === "manual"
        ? "Pinned to the configured model and reasoning effort within the locked provider."
        : "Roscoe can retune model and reasoning within the locked provider before the next Guild turn.",
      restoreRecovery: effectiveRestoreRecovery,
    };
    managed.awaitingInput = effectiveRestoreRecovery?.mode === "restage-roscoe"
      ? true
      : inferAwaitingInput(restoredTimeline, null);
    const healedParkedStatus = autoHealMetadata
      && restoredLane
      && !restoredLane.currentToolUse
      && inferTerminalParkedState(restoredTimeline, restoredLane.summary);
    const staleSavedParkedStatus = autoHealMetadata
      && restoredLane?.status === "parked"
      && !healedParkedStatus;

    if (this.orchestrator) {
      this.orchestrator.registerWorker(id, monitor, effectiveProfileName);
    }

    return {
      managed,
      restoredState: restoredLane
        ? {
            providerSessionId: shouldRestoreNativeSessions ? restoredLane.providerSessionId : null,
            responderSessionId: shouldRestoreNativeSessions ? restoredLane.responderSessionId : null,
            trackerHistory: restoredLane.trackerHistory,
            responderHistoryCursor: restoredLane.responderHistoryCursor,
            timeline: restoredLane.timeline,
            preview: restoredPreview,
            outputLines: restoredLane.outputLines,
            summary: restoredLane.summary,
            currentToolUse: null,
            currentToolDetail: null,
            status: shouldReopenPrematureParkedLane
              ? "waiting"
              : healedParkedStatus
              ? "parked"
              : staleSavedParkedStatus
                ? "waiting"
              : autoHealMetadata && restoredLane.status === "exited"
                ? "waiting"
                : restoredLane.status,
            startedAt: restoredLane.startedAt,
            usage: restoredLane.usage,
            rateLimitStatus: restoredLane.rateLimitStatus,
            pendingOperatorMessages: restoredLane.pendingOperatorMessages ?? [],
            contractFingerprint: restoredLane.contractFingerprint ?? getProjectContractFingerprint(projectContext),
          }
        : null,
    };
  }

  async generateSuggestion(
    managed: ManagedSession,
    onPartial?: (text: string) => void,
    onUsage?: (usage: RuntimeUsageSnapshot) => void,
  ): Promise<SuggestionResult> {
    const context = managed.tracker.getContextForGeneration();
    const sessionInfo: SessionInfo = {
      profile: managed.profile,
      profileName: managed.profileName,
      projectName: managed.projectName,
      projectDir: managed.projectDir,
      worktreePath: managed.worktreePath,
      worktreeName: managed.worktreeName,
      responderMonitor: managed.responderMonitor,
      responderHistory: managed.tracker.getHistory(),
      responderHistoryCursor: managed.responderHistoryCursor,
    };

    const result = await this.generator.generateSuggestion(
      context,
      managed.profileName,
      sessionInfo,
      onPartial,
      (trace) => {
        managed.lastResponderPrompt = trace.prompt;
        managed.lastResponderCommand = trace.commandPreview;
        managed.lastResponderStrategy = trace.strategy;
        managed.lastResponderRuntimeSummary = trace.runtimeSummary;
        managed.lastResponderRationale = trace.rationale;
      },
      onUsage,
    );
    managed.responderHistoryCursor = managed.tracker.getHistory().length;
    return result;
  }

  cancelGeneration(): void {
    this.generator.cancelGeneration();
  }

  async executeSuggestion(
    managed: ManagedSession,
    result: SuggestionResult,
  ): Promise<void> {
    if (!managed.awaitingInput) {
      return;
    }

    // Mark the session as no longer awaiting input before injecting so
    // duplicate auto-send paths cannot replay the same suggestion twice.
    managed.awaitingInput = false;

    if (result.browserActions?.length) {
      await this.executeBrowserActions(result.browserActions);
    }

    if (result.orchestratorActions?.length) {
      await this.executeOrchestratorActions(result.orchestratorActions);
    }

    if (result.text.trim()) {
      this.prepareWorkerTurn(managed, result.text);
      managed.tracker.recordUserInput(result.text);
      this.injector.inject(managed.monitor, result.text);
    }
  }

  async generateSummary(managed: ManagedSession): Promise<string> {
    const lastOutput = managed.tracker.getLastAssistantMessage() || "";
    const truncated = lastOutput.slice(-3000);
    const summaryPrompt = `Summarize what this AI coding session just accomplished in ONE sentence (max 80 chars). Be specific about the action. No meta-commentary.\n\nOutput:\n${truncated}`;

    try {
      const run = startOneShotRun(managed.profile, summaryPrompt, {
        cwd: managed.worktreePath,
        timeoutMs: 15_000,
      });
      const text = await run.result;
      return text.trim().slice(0, 120);
    } catch {
      return "(summary unavailable)";
    }
  }

  async maybeNotifyProgress(managed: ManagedSession, summary: string): Promise<void> {
    try {
      await this.notifications.maybeSendProgressUpdate(managed, summary);
    } catch {
      // Notification delivery is best-effort and should never block Roscoe.
    }
  }

  async maybeNotifyIntervention(managed: ManagedSession, request: SmsInterventionRequest): Promise<void> {
    try {
      await this.notifications.maybeSendInterventionRequest(managed, request);
    } catch {
      // Notification delivery is best-effort and should never block Roscoe.
    }
  }

  injectOperatorGuidance(managed: ManagedSession, text: string, _source: "terminal" | "sms" = "terminal"): void {
    this.prepareWorkerTurn(managed, text);
    managed.tracker.recordUserInput(text);
    this.injector.inject(managed.monitor, text);
    managed.awaitingInput = false;
  }

  injectText(managed: ManagedSession, text: string): void {
    this.injectOperatorGuidance(managed, text, "terminal");
  }

  updateManagedRuntime(
    managed: ManagedSession,
    runtime: RuntimeControlSettings,
    provider: LLMProtocol = detectProtocol(managed.profile),
  ): ManagedSession {
    const currentProtocol = detectProtocol(managed.profile);
    const providerChanged = provider !== currentProtocol;
    const baseProfile = provider === currentProtocol
      ? managed.profile
      : loadProfile(getDefaultProfileName(provider));
    const nextProfile = {
      ...baseProfile,
      runtime: { ...runtime },
    };
    const tuningMode = getRuntimeTuningMode(nextProfile.runtime);
    managed.profile = nextProfile;
    managed.profileName = provider === currentProtocol ? managed.profileName : getDefaultProfileName(provider);
    managed.runtimeOverrides = { ...runtime };
    managed.monitor.setProfile(nextProfile);
    if (providerChanged) {
      managed.monitor.restoreSessionId(null);
    }
    managed.lastWorkerRuntimeSummary = summarizeRuntime(nextProfile);
    managed.lastWorkerRuntimeStrategy = tuningMode === "manual" ? "manual-pinned" : "auto-managed";
    managed.lastWorkerRuntimeRationale = tuningMode === "manual"
      ? "Pinned to the configured model and reasoning effort within the locked provider."
      : "Roscoe can retune model and reasoning within the locked provider before the next Guild turn.";
    return managed;
  }

  updateManagedResponderRuntime(
    managed: ManagedSession,
    runtime: RuntimeControlSettings,
    provider: LLMProtocol = detectProtocol(managed.profile),
  ): ManagedSession {
    const baseProfile = loadProfile(getDefaultProfileName(provider));
    const nextProfile = {
      ...baseProfile,
      runtime: { ...runtime },
    };
    const tuningMode = getRuntimeTuningMode(nextProfile.runtime);
    managed.responderProfile = nextProfile;
    managed.responderMonitor.setProfile(nextProfile);
    managed.responderMonitor.restoreSessionId(null);
    managed.responderHistoryCursor = 0;
    managed.lastResponderRuntimeSummary = summarizeRuntime(nextProfile);
    managed.lastResponderStrategy = tuningMode === "manual" ? "manual-pinned" : "auto-managed";
    managed.lastResponderRationale = tuningMode === "manual"
      ? "Pinned to the configured Roscoe model and reasoning within the locked provider."
      : "Roscoe can retune its own model and reasoning within the locked provider before the next reply.";
    return managed;
  }

  persistSessionState(session: SessionState): void {
    const managed = session.managed;
    saveLaneSession({
      laneKey: "",
      projectDir: managed.projectDir,
      projectName: managed.projectName,
      worktreePath: managed.worktreePath,
      worktreeName: managed.worktreeName,
      profileName: managed.profileName,
      protocol: detectProtocol(managed.profile),
      providerSessionId: managed.monitor.getSessionId(),
      responderProtocol: detectProtocol(managed.responderProfile),
      responderSessionId: managed.responderMonitor.getSessionId(),
      trackerHistory: managed.tracker.getHistory(),
      responderHistoryCursor: managed.responderHistoryCursor,
      timeline: session.timeline,
      preview: session.preview,
      outputLines: session.outputLines,
      summary: session.summary,
      currentToolUse: session.currentToolUse,
      currentToolDetail: session.currentToolDetail ?? null,
      status: session.status,
      startedAt: session.startedAt,
      usage: session.usage,
      rateLimitStatus: session.rateLimitStatus,
      pendingOperatorMessages: session.pendingOperatorMessages ?? [],
      contractFingerprint: session.contractFingerprint ?? getProjectContractFingerprint(loadProjectContext(managed.projectDir)),
      savedAt: new Date().toISOString(),
    });
  }

  prepareWorkerTurn(
    managed: ManagedSession,
    upcomingPrompt = "",
  ): ManagedSession {
    const projectContext = loadProjectContext(managed.projectDir);
    const conversationContext = [
      managed.tracker.getContextForGeneration(),
      upcomingPrompt,
    ].filter(Boolean).join("\n\n");
    const plan = recommendWorkerRuntime(managed.profile, conversationContext, projectContext);
    managed.profile = plan.profile;
    managed.runtimeOverrides = mergeRuntimeSettings(managed.runtimeOverrides, plan.profile.runtime);
    managed.monitor.setProfile(plan.profile);
    managed.lastWorkerRuntimeSummary = plan.summary;
    managed.lastWorkerRuntimeStrategy = plan.strategy;
    managed.lastWorkerRuntimeRationale = plan.rationale;
    return managed;
  }

  private async executeBrowserActions(actions: BrowserAction[]): Promise<void> {
    if (!this.browserAgent) return;

    for (const action of actions) {
      try {
        switch (action.type) {
          case "screenshot":
            await this.browserAgent.screenshot();
            break;
          case "navigate":
            if (action.params.url) await this.browserAgent.open(action.params.url);
            break;
          case "snapshot":
            await this.browserAgent.getContextSummary();
            break;
          case "interact":
            if (action.params.action && action.params.ref) {
              await this.browserAgent.interact(
                action.params.action,
                action.params.ref,
                action.params.value,
              );
            }
            break;
        }
      } catch {
        // best-effort browser actions
      }
    }
  }

  private async executeOrchestratorActions(
    actions: OrchestratorAction[],
  ): Promise<void> {
    if (!this.orchestrator) return;

    for (const action of actions) {
      try {
        switch (action.type) {
          case "plan":
            this.orchestrator.sendPlan(action.workerId, action.text);
            break;
          case "review":
            this.orchestrator.sendReview(action.workerId, action.text);
            break;
          case "input":
            this.orchestrator.sendInput(action.workerId, action.text);
            break;
        }
      } catch {
        // best-effort orchestrator actions
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

export function parseSessionSpec(spec: string): ParsedSessionSpec {
  const atIdx = spec.indexOf("@");
  if (atIdx === -1) {
    return { profileName: spec, projectDir: null, taskName: null };
  }

  const profileName = spec.slice(0, atIdx);
  const rest = spec.slice(atIdx + 1);

  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) {
    return { profileName, projectDir: resolve(expandTilde(rest)), taskName: null };
  }

  return {
    profileName,
    projectDir: resolve(expandTilde(rest.slice(0, colonIdx))),
    taskName: rest.slice(colonIdx + 1),
  };
}
