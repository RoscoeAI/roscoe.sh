import { resolve } from "path";
import { homedir } from "os";
import { loadProfile, loadProjectContext } from "../config.js";
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
import { ManagedSession, SessionStartOpts, ParsedSessionSpec } from "../types.js";
import { detectProtocol, startOneShotRun, summarizeRuntime, RuntimeControlSettings } from "../llm-runtime.js";
import { NotificationService } from "../notification-service.js";
import {
  applyRuntimeSettings,
  getLockedProjectProvider,
  getRuntimeTuningMode,
  getWorkerProfileForProject,
  mergeRuntimeSettings,
  recommendWorkerRuntime,
} from "../runtime-defaults.js";

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

  startSession(opts: SessionStartOpts): ManagedSession {
    const { profileName, projectDir, worktreePath, worktreeName, projectName, runtimeOverrides } = opts;
    const projectContext = loadProjectContext(projectDir);
    const requestedProfile = loadProfile(profileName);
    const requestedProtocol = detectProtocol(requestedProfile);
    const lockedProvider = getLockedProjectProvider(projectContext);
    const effectiveProfileName = lockedProvider && requestedProtocol !== lockedProvider
      ? projectContext?.runtimeDefaults?.onboarding?.profileName ?? profileName
      : profileName;
    const baseProfile = effectiveProfileName === profileName
      ? requestedProfile
      : loadProfile(effectiveProfileName);
    const profile = getWorkerProfileForProject(baseProfile, projectContext, runtimeOverrides);
    const id = `${effectiveProfileName}-${projectName}-${worktreeName}-${Date.now()}`;

    // SessionMonitor now takes a HeadlessProfile — just name, command, args
    const monitor = new SessionMonitor(
      id,
      profile,
      worktreePath,
    );
    const tracker = new ConversationTracker();

    const managed: ManagedSession = {
      id,
      monitor,
      profile,
      tracker,
      awaitingInput: true, // Start in waiting state — needs initial prompt
      profileName: effectiveProfileName,
      projectName,
      projectDir,
      worktreePath,
      worktreeName,
      _paused: false,
      runtimeOverrides,
      lastResponderPrompt: null,
      lastResponderCommand: null,
      lastResponderStrategy: null,
      lastResponderRuntimeSummary: null,
      lastResponderRationale: null,
      lastWorkerRuntimeSummary: summarizeRuntime(profile),
      lastWorkerRuntimeStrategy: getRuntimeTuningMode(profile.runtime) === "manual" ? "manual-pinned" : "auto-managed",
      lastWorkerRuntimeRationale: getRuntimeTuningMode(profile.runtime) === "manual"
        ? "Pinned to the configured model and reasoning effort within the locked provider."
        : "Roscoe can retune model and reasoning within the locked provider before the next Guild turn.",
    };

    if (this.orchestrator) {
      this.orchestrator.registerWorker(id, monitor, effectiveProfileName);
    }

    return managed;
  }

  async generateSuggestion(
    managed: ManagedSession,
    onPartial?: (text: string) => void,
  ): Promise<SuggestionResult> {
    const context = managed.tracker.getContextForGeneration();
    const sessionInfo: SessionInfo = {
      profile: managed.profile,
      profileName: managed.profileName,
      projectName: managed.projectName,
      projectDir: managed.projectDir,
      worktreePath: managed.worktreePath,
      worktreeName: managed.worktreeName,
    };

    return this.generator.generateSuggestion(
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
    );
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

  injectText(managed: ManagedSession, text: string): void {
    this.prepareWorkerTurn(managed, text);
    managed.tracker.recordUserInput(text);
    this.injector.inject(managed.monitor, text);
    managed.awaitingInput = false;
  }

  updateManagedRuntime(
    managed: ManagedSession,
    runtime: RuntimeControlSettings,
  ): ManagedSession {
    const nextProfile = applyRuntimeSettings(managed.profile, runtime);
    const tuningMode = getRuntimeTuningMode(nextProfile.runtime);
    managed.profile = nextProfile;
    managed.runtimeOverrides = mergeRuntimeSettings(managed.runtimeOverrides, runtime);
    managed.monitor.setProfile(nextProfile);
    managed.lastWorkerRuntimeSummary = summarizeRuntime(nextProfile);
    managed.lastWorkerRuntimeStrategy = tuningMode === "manual" ? "manual-pinned" : "auto-managed";
    managed.lastWorkerRuntimeRationale = tuningMode === "manual"
      ? "Pinned to the configured model and reasoning effort within the locked provider."
      : "Roscoe can retune model and reasoning within the locked provider before the next Guild turn.";
    return managed;
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
