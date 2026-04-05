import { resolve } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
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
  HostAction,
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
  normalizeRestoredTimeline,
} from "../session-transcript.js";
import { recoverPreviewState } from "../session-preview.js";
import { applyProjectEnvToProfile } from "../project-secrets.js";
import { looksLikeRoscoeStructuredDraft } from "../roscoe-draft.js";

const HOST_GIT_TIMEOUT_MS = 300_000;
const HOST_GIT_MAX_BUFFER = 1024 * 1024;
const HOST_GH_TIMEOUT_MS = 120_000;
const HOST_GH_MAX_BUFFER = 1024 * 1024;
const HOST_KUBECTL_TIMEOUT_MS = 120_000;
const HOST_KUBECTL_MAX_BUFFER = 1024 * 1024;
const ALLOWED_HOST_GIT_SUBCOMMANDS = new Set(["add", "commit", "push", "status", "diff", "log", "rev-parse", "show"]);
const DISALLOWED_HOST_GIT_FLAGS = [
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--force",
  "--force-with-lease",
  "--mirror",
  "--all",
  "--delete",
  "--amend",
];
const ALLOWED_HOST_GH_TOP_LEVEL = new Set(["run"]);
const ALLOWED_HOST_GH_RUN_SUBCOMMANDS = new Set(["list", "view"]);
const DISALLOWED_HOST_GH_FLAGS = [
  "-R",
  "--repo",
  "--hostname",
  "--jq",
  "--template",
  "--paginate",
  "--web",
  "--browser",
];
const ALLOWED_HOST_KUBECTL_GLOBAL_FLAGS = new Set(["--context", "-n", "--namespace", "--request-timeout"]);
const ALLOWED_HOST_KUBECTL_FLAGS = new Set([
  ...ALLOWED_HOST_KUBECTL_GLOBAL_FLAGS,
  "-o",
  "--output",
  "-l",
  "--selector",
  "--tail",
  "--since",
  "--since-time",
  "-c",
  "--container",
  "--all-containers",
  "--timestamps",
  "--ignore-errors",
  "--all-namespaces",
]);
const HOST_KUBECTL_FLAGS_WITH_VALUE = new Set([
  "--context",
  "-n",
  "--namespace",
  "--request-timeout",
  "-o",
  "--output",
  "-l",
  "--selector",
  "--tail",
  "--since",
  "--since-time",
  "-c",
  "--container",
]);
const ALLOWED_HOST_KUBECTL_SUBCOMMANDS = new Set(["config", "get", "describe", "logs", "rollout"]);
const DISALLOWED_HOST_KUBECTL_FLAGS = new Set(["--kubeconfig", "-f", "--filename", "-k", "--server", "--token", "--as", "--as-group", "--raw"]);

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
    const restoredTimeline = normalizeRestoredTimeline(restoredLane?.timeline ?? []);
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
    if (restoredLane && JSON.stringify(restoredTimeline) !== JSON.stringify(restoredLane.timeline ?? [])) {
      try {
        saveLaneSession({
          ...restoredLane,
          timeline: restoredTimeline,
          savedAt: restoredLane.savedAt,
        });
      } catch {
        // best-effort self-heal on restore
      }
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
            timeline: restoredTimeline,
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
    sessionStateResolver?: () => SessionState | null,
  ): Promise<SuggestionResult> {
    const context = managed.tracker.getContextForGeneration();
    const sessionInfo: SessionInfo = {
      profile: managed.profile,
      responderProfile: managed.responderProfile,
      profileName: managed.profileName,
      projectName: managed.projectName,
      projectDir: managed.projectDir,
      worktreePath: managed.worktreePath,
      worktreeName: managed.worktreeName,
      responderMonitor: managed.responderMonitor,
      responderHistory: managed.tracker.getHistory(),
      responderHistoryCursor: managed.responderHistoryCursor,
    };
    if (sessionStateResolver) {
      sessionInfo.onResponderStateReset = () => {
        managed.responderHistoryCursor = sessionInfo.responderHistoryCursor ?? 0;
        const latestSession = sessionStateResolver();
        if (!latestSession) {
          return;
        }
        try {
          this.persistSessionState({
            ...latestSession,
            managed,
          });
        } catch {
          // Self-heal persistence is best-effort and must not block responder recovery.
        }
      };
    }

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
  ): Promise<string> {
    if (!managed.awaitingInput) {
      return "";
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

    const hostReport = result.hostActions?.length
      ? await this.executeHostActions(managed, result.hostActions)
      : null;
    const finalText = this.composeSuggestionText(result.text, hostReport);

    if (looksLikeRoscoeStructuredDraft(finalText)) {
      managed.awaitingInput = true;
      return "";
    }

    if (finalText.trim()) {
      if (result.decision === "restart-worker") {
        managed.monitor.restoreSessionId(null);
      }
      this.prepareWorkerTurn(managed, finalText);
      managed.tracker.recordUserInput(finalText);
      this.injector.inject(managed.monitor, finalText);
    }
    return finalText;
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

  private composeSuggestionText(
    suggestedText: string,
    hostReport: { text: string; hadFailure: boolean } | null,
  ): string {
    const trimmedSuggestion = hostReport?.hadFailure
      ? suggestedText.trim()
      : this.sanitizeSuccessfulHostFollowUp(suggestedText);
    if (!hostReport) {
      return suggestedText;
    }

    if (hostReport.hadFailure) {
      const failureGuide = "A host-side command failed. Continue from the real output above instead of assuming the local bridge step succeeded.";
      return [hostReport.text, failureGuide, trimmedSuggestion].filter(Boolean).join("\n\n");
    }

    return [hostReport.text, trimmedSuggestion].filter(Boolean).join("\n\n");
  }

  private sanitizeSuccessfulHostFollowUp(text: string): string {
    let next = text.trim();
    if (!next) {
      return next;
    }

    const stalePatterns = [
      /\b[^.\n]*waiting on [^.\n]*approval[^.\n]*\.?/gi,
      /\b[^.\n]*can't get [^.\n]* approved[^.\n]*\.?/gi,
      /\b[^.\n]*hostactions didn't execute[^.\n]*\.?/gi,
      /\b[^.\n]*commit is staged and ready[^.\n]*\.?/gi,
      /\b[^.\n]*hasn't landed[^.\n]*\.?/gi,
      /\b[^.\n]*ready to land[^.\n]*\.?/gi,
      /\b[^.\n]*needs [^.\n]* approval[^.\n]*\.?/gi,
    ];
    for (const pattern of stalePatterns) {
      next = next.replace(pattern, "");
    }

    next = next
      .replace(/\bOnce pushed,\s*/gi, "")
      .replace(/\bOnce approved,\s*/gi, "")
      .replace(/\bOnce committed and pushed,\s*/gi, "")
      .replace(/\bOnce that lands,\s*/gi, "")
      .replace(/\bIf CI reports a failure on [^.\n]*, I'll relay it immediately\.?/gi, "");

    next = next
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
      .map((paragraph) => paragraph.replace(/^[a-z]/, (char) => char.toUpperCase()))
      .filter(Boolean)
      .join("\n\n");

    return next;
  }

  private async executeHostActions(
    managed: ManagedSession,
    actions: HostAction[],
  ): Promise<{ text: string; hadFailure: boolean }> {
    const outcomes: Array<{ type: HostAction["type"]; command: string; summary: string; ok: boolean }> = [];

    for (const action of actions) {
      if (action?.type === "git") {
        outcomes.push({ type: "git", ...(await this.executeHostGitAction(managed, action)) });
        continue;
      }
      if (action?.type === "gh") {
        outcomes.push({ type: "gh", ...(await this.executeHostGhAction(managed, action)) });
        continue;
      }
      if (action?.type === "kubectl") {
        outcomes.push({ type: "kubectl", ...(await this.executeHostKubectlAction(managed, action)) });
        continue;
      }
      else {
        outcomes.push({
          type: "git",
          command: "unsupported",
          summary: "failed: Roscoe only allows host-side git, gh run, and read-only kubectl actions in this path.",
          ok: false,
        });
      }
    }

    const hadFailure = outcomes.some((outcome) => !outcome.ok);
    const hasGit = outcomes.some((outcome) => outcome.type === "git");
    const hasGh = outcomes.some((outcome) => outcome.type === "gh");
    const hasKubectl = outcomes.some((outcome) => outcome.type === "kubectl");
    const header = hadFailure
      ? this.buildHostActionHeader({ hasGit, hasGh, hasKubectl, success: false })
      : this.buildHostActionHeader({ hasGit, hasGh, hasKubectl, success: true });
    const lines = outcomes.map((outcome) => `- \`${outcome.command}\`: ${outcome.summary}`);
    return {
      text: [header, ...lines].join("\n"),
      hadFailure,
    };
  }

  private async executeHostGitAction(
    managed: ManagedSession,
    action: HostAction,
  ): Promise<{ command: string; summary: string; ok: boolean }> {
    try {
      const args = this.validateHostGitArgs(Array.isArray(action.args) ? action.args : []);
      const command = `git ${args.join(" ")}`;
      const { stdout, stderr } = await this.runHostGitCommand(managed.worktreePath, args);
      return {
        command,
        summary: this.summarizeHostGitOutput(args[0]!, stdout, stderr, true),
        ok: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rawArgs = Array.isArray(action.args) ? action.args.filter((arg): arg is string => typeof arg === "string") : [];
      return {
        command: `git ${rawArgs.join(" ")}`.trim() || "git",
        summary: this.summarizeHostGitOutput(rawArgs[0] ?? "git", "", message, false),
        ok: false,
      };
    }
  }

  private async executeHostGhAction(
    managed: ManagedSession,
    action: HostAction,
  ): Promise<{ command: string; summary: string; ok: boolean }> {
    try {
      const args = this.validateHostGhArgs(Array.isArray(action.args) ? action.args : []);
      const command = `gh ${args.join(" ")}`;
      const { stdout, stderr } = await this.runHostGhCommand(managed.worktreePath, args);
      return {
        command,
        summary: this.summarizeHostGhOutput(args, stdout, stderr, true),
        ok: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rawArgs = Array.isArray(action.args) ? action.args.filter((arg): arg is string => typeof arg === "string") : [];
      return {
        command: `gh ${rawArgs.join(" ")}`.trim() || "gh",
        summary: this.summarizeHostGhOutput(rawArgs, "", message, false),
        ok: false,
      };
    }
  }

  private async executeHostKubectlAction(
    managed: ManagedSession,
    action: HostAction,
  ): Promise<{ command: string; summary: string; ok: boolean }> {
    try {
      const args = this.validateHostKubectlArgs(Array.isArray(action.args) ? action.args : []);
      const command = `kubectl ${args.join(" ")}`;
      const { stdout, stderr } = await this.runHostKubectlCommand(managed.worktreePath, args);
      return {
        command,
        summary: this.summarizeHostKubectlOutput(args, stdout, stderr, true),
        ok: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rawArgs = Array.isArray(action.args) ? action.args.filter((arg): arg is string => typeof arg === "string") : [];
      return {
        command: `kubectl ${rawArgs.join(" ")}`.trim() || "kubectl",
        summary: this.summarizeHostKubectlOutput(rawArgs, "", message, false),
        ok: false,
      };
    }
  }

  private validateHostGitArgs(args: string[]): string[] {
    const normalized = args
      .filter((arg): arg is string => typeof arg === "string")
      .map((arg) => arg.trim())
      .filter(Boolean);

    if (normalized.length === 0) {
      throw new Error("host git action is missing args");
    }

    const subcommand = normalized[0];
    if (!subcommand || subcommand.startsWith("-") || !ALLOWED_HOST_GIT_SUBCOMMANDS.has(subcommand)) {
      throw new Error(`host git action "${subcommand ?? ""}" is not allowed`);
    }

    const hasDisallowedFlag = normalized.slice(1).some((arg) =>
      DISALLOWED_HOST_GIT_FLAGS.includes(arg) || /^--force(?:=.*)?$/i.test(arg),
    );
    if (hasDisallowedFlag) {
      throw new Error("host git action includes a disallowed flag");
    }

    return normalized;
  }

  private validateHostGhArgs(args: string[]): string[] {
    const normalized = args
      .filter((arg): arg is string => typeof arg === "string")
      .map((arg) => arg.trim())
      .filter(Boolean);

    if (normalized.length < 2) {
      throw new Error("host gh action is missing args");
    }

    const [topLevel, subcommand] = normalized;
    if (!topLevel || !ALLOWED_HOST_GH_TOP_LEVEL.has(topLevel)) {
      throw new Error(`host gh action "${topLevel ?? ""}" is not allowed`);
    }
    if (!subcommand || !ALLOWED_HOST_GH_RUN_SUBCOMMANDS.has(subcommand)) {
      throw new Error(`host gh run action "${subcommand ?? ""}" is not allowed`);
    }

    const hasDisallowedFlag = normalized.slice(2).some((arg) =>
      DISALLOWED_HOST_GH_FLAGS.includes(arg),
    );
    if (hasDisallowedFlag) {
      throw new Error("host gh action includes a disallowed flag");
    }

    return normalized;
  }

  private validateHostKubectlArgs(args: string[]): string[] {
    const normalized = args
      .filter((arg): arg is string => typeof arg === "string")
      .map((arg) => arg.trim())
      .filter(Boolean);

    if (normalized.length === 0) {
      throw new Error("host kubectl action is missing args");
    }

    let index = 0;
    while (index < normalized.length && normalized[index]!.startsWith("-")) {
      const flag = normalized[index]!;
      if (!ALLOWED_HOST_KUBECTL_GLOBAL_FLAGS.has(flag)) {
        throw new Error(`host kubectl flag "${flag}" is not allowed`);
      }
      index += HOST_KUBECTL_FLAGS_WITH_VALUE.has(flag) ? 2 : 1;
    }

    const subcommand = normalized[index];
    if (!subcommand || !ALLOWED_HOST_KUBECTL_SUBCOMMANDS.has(subcommand)) {
      throw new Error(`host kubectl action "${subcommand ?? ""}" is not allowed`);
    }

    const hasDisallowedFlag = normalized.some((arg) => DISALLOWED_HOST_KUBECTL_FLAGS.has(arg));
    if (hasDisallowedFlag) {
      throw new Error("host kubectl action includes a disallowed flag");
    }

    for (let cursor = index + 1; cursor < normalized.length; cursor += 1) {
      const token = normalized[cursor]!;
      if (!token.startsWith("-")) {
        continue;
      }
      if (!ALLOWED_HOST_KUBECTL_FLAGS.has(token)) {
        throw new Error(`host kubectl flag "${token}" is not allowed`);
      }
      if (HOST_KUBECTL_FLAGS_WITH_VALUE.has(token)) {
        cursor += 1;
      }
    }

    switch (subcommand) {
      case "config":
        if (normalized[index + 1] !== "current-context") {
          throw new Error("host kubectl config action is limited to current-context");
        }
        break;
      case "get":
      case "describe":
      case "logs":
        if (!normalized.slice(index + 1).some((token) => !token.startsWith("-"))) {
          throw new Error(`host kubectl ${subcommand} action is missing a target`);
        }
        break;
      case "rollout":
        if (normalized[index + 1] !== "status") {
          throw new Error('host kubectl rollout action is limited to "status"');
        }
        if (!normalized.slice(index + 2).some((token) => !token.startsWith("-"))) {
          throw new Error("host kubectl rollout status action is missing a target");
        }
        break;
      default:
        throw new Error(`host kubectl action "${subcommand}" is not allowed`);
    }

    return normalized;
  }

  private runHostGitCommand(
    cwd: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        {
          cwd,
          env: process.env,
          timeout: HOST_GIT_TIMEOUT_MS,
          maxBuffer: HOST_GIT_MAX_BUFFER,
        },
        (error, stdout, stderr) => {
          if (error) {
            const summary = [stderr, stdout, error.message]
              .map((value) => value?.trim())
              .find(Boolean) ?? "git command failed";
            reject(new Error(summary));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    });
  }

  private runHostGhCommand(
    cwd: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile(
        "gh",
        args,
        {
          cwd,
          env: process.env,
          timeout: HOST_GH_TIMEOUT_MS,
          maxBuffer: HOST_GH_MAX_BUFFER,
        },
        (error, stdout, stderr) => {
          if (error) {
            const summary = [stderr, stdout, error.message]
              .map((value) => value?.trim())
              .find(Boolean) ?? "gh command failed";
            reject(new Error(summary));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    });
  }

  private runHostKubectlCommand(
    cwd: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile(
        "kubectl",
        args,
        {
          cwd,
          env: process.env,
          timeout: HOST_KUBECTL_TIMEOUT_MS,
          maxBuffer: HOST_KUBECTL_MAX_BUFFER,
        },
        (error, stdout, stderr) => {
          if (error) {
            const summary = [stderr, stdout, error.message]
              .map((value) => value?.trim())
              .find(Boolean) ?? "kubectl command failed";
            reject(new Error(summary));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    });
  }

  private summarizeHostGitOutput(
    subcommand: string,
    stdout: string,
    stderr: string,
    ok: boolean,
  ): string {
    const firstLine = [stdout, stderr]
      .flatMap((value) => value.split("\n"))
      .map((line) => line.trim())
      .find(Boolean);

    if (!ok) {
      return firstLine ? `failed: ${firstLine}` : "failed";
    }

    switch (subcommand) {
      case "add":
        return firstLine ?? "staged successfully";
      case "commit":
        return firstLine ?? "commit created";
      case "push":
        return firstLine ?? "push completed";
      default:
        return firstLine ?? "completed successfully";
    }
  }

  private summarizeHostGhOutput(
    args: string[],
    stdout: string,
    stderr: string,
    ok: boolean,
  ): string {
    const firstLine = [stdout, stderr]
      .flatMap((value) => value.split("\n"))
      .map((line) => line.trim())
      .find(Boolean);

    if (!ok) {
      return firstLine ? `failed: ${firstLine}` : "failed";
    }

    if (args[0] === "run" && args[1] === "list") {
      return firstLine ?? "hosted runs listed";
    }

    if (args[0] === "run" && args[1] === "view") {
      const jsonText = stdout.trim();
      if (jsonText.startsWith("{")) {
        try {
          const parsed = JSON.parse(jsonText) as { status?: string; conclusion?: string; url?: string };
          const summary = [parsed.status, parsed.conclusion, parsed.url].filter(Boolean);
          if (summary.length > 0) {
            return summary.join(" · ");
          }
        } catch {
          // fall back to first line
        }
      }
      return firstLine ?? "hosted run details loaded";
    }

    return firstLine ?? "completed successfully";
  }

  private summarizeHostKubectlOutput(
    args: string[],
    stdout: string,
    stderr: string,
    ok: boolean,
  ): string {
    const lines = [stdout, stderr]
      .flatMap((value) => value.split("\n"))
      .map((line) => line.trim())
      .filter(Boolean);
    const preview = lines.slice(0, 3).join(" | ");

    if (!ok) {
      return preview ? `failed: ${preview}` : "failed";
    }

    const normalized = args.filter(Boolean);
    const subcommand = normalized.find((arg) => !arg.startsWith("-")) ?? "kubectl";
    if (subcommand === "logs") {
      return preview || "recent logs loaded";
    }
    if (subcommand === "rollout") {
      return preview || "rollout status loaded";
    }
    if (subcommand === "config") {
      return preview || "current context loaded";
    }
    return preview || "completed successfully";
  }

  private buildHostActionHeader({
    hasGit,
    hasGh,
    hasKubectl,
    success,
  }: {
    hasGit: boolean;
    hasGh: boolean;
    hasKubectl: boolean;
    success: boolean;
  }): string {
    const verb = success ? "ran" : "attempted";
    if (hasGit && hasGh && hasKubectl) {
      return `Roscoe ${verb} host-side Git, GitHub CLI, and Kubernetes debug steps to cross local runtime boundaries the lane could not complete natively.`;
    }
    if (hasGit && hasGh) {
      return `Roscoe ${verb} host-side Git and GitHub CLI steps to cross local runtime boundaries the lane could not complete natively.`;
    }
    if (hasGit && hasKubectl) {
      return `Roscoe ${verb} host-side Git and Kubernetes debug steps to cross local runtime boundaries the lane could not complete natively.`;
    }
    if (hasGh && hasKubectl) {
      return `Roscoe ${verb} host-side GitHub CLI and Kubernetes debug checks against the deployed environment.`;
    }
    if (hasKubectl) {
      return `Roscoe ${verb} host-side Kubernetes debug checks against the deployed environment.`;
    }
    if (hasGh) {
      return `Roscoe ${verb} host-side GitHub CLI checks to verify hosted CI from the local machine.`;
    }
    return `Roscoe ${verb} host-side Git to cross the shared worktree/.git boundary.`;
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
