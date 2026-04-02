import { useEffect, useRef } from "react";
import { AppAction, SessionState, ManagedSession } from "../types.js";
import { SessionManagerService } from "../services/session-manager.js";
import { loadProjectContext, loadRoscoeSettings, ProjectContext } from "../config.js";
import { LLMProtocol } from "../llm-runtime.js";
import {
  getExecutionModeLabel,
  getResponderProvider,
  getVerificationCadence,
  getLockedProjectProvider,
  getRuntimeTuningMode,
  getTokenEfficiencyMode,
  getWorkerGovernanceMode,
} from "../runtime-defaults.js";
import {
  getInterruptedExitRecoveryPlan,
  getLastConversationEntry,
  inferTerminalParkedState,
  isParkedDecisionText,
  isPauseAcknowledgementText,
} from "../session-transcript.js";
import { buildReadyPreviewState, getPreviewState } from "../session-preview.js";
import type { HostAction } from "../response-generator.js";
import { inferRoscoeDecision } from "../roscoe-draft.js";

const RESUME_ACTIVITY_NAME = "resume";
const RESUME_PENDING_DETAIL = "Resuming interrupted Guild turn...";
const RESUME_STILL_WAITING_DETAIL = "Still waiting on resumed worker...";
const RESUME_RESPONDING_DETAIL = "Resumed worker is responding...";
const RESUME_WATCHDOG_MS = 15_000;
const WAITING_LANE_RECHECK_MS = 15_000;
const MAX_OUTPUT_BUFFER_CHARS = 200_000;
const MAX_OUTPUT_BUFFER_LINES = 600;
const MAX_TURN_TEXT_CHARS = 120_000;
const MAX_THINKING_TEXT_CHARS = 24_000;
const TRUNCATION_NOTICE = "\n[Roscoe truncated older buffered output to keep memory stable.]";
const COMPACT_PROMPT_TEXT_CHARS = 180;

function clipPromptText(text: string, maxChars = COMPACT_PROMPT_TEXT_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function summarizePromptValues(values: string[], limit: number, maxChars = COMPACT_PROMPT_TEXT_CHARS): string {
  const cleaned = values
    .map((value) => clipPromptText(value, maxChars))
    .filter((value) => value.length > 0);
  if (cleaned.length === 0) return "";
  const head = cleaned.slice(0, limit).join("; ");
  const remaining = cleaned.length - limit;
  return remaining > 0 ? `${head}; +${remaining} more` : head;
}

function hasPendingLocalSuggestion(session: SessionState): boolean {
  return session.timeline.some((entry) => entry.kind === "local-suggestion" && entry.state === "pending");
}

function getLastLocalSuggestion(session: SessionState): Extract<SessionState["timeline"][number], { kind: "local-suggestion" }> | null {
  for (let index = session.timeline.length - 1; index >= 0; index -= 1) {
    const entry = session.timeline[index];
    if (entry.kind === "local-suggestion") {
      return entry;
    }
  }
  return null;
}

function hasOpenAcceptanceLedgerWork(context: ProjectContext | null): boolean {
  return Boolean(context?.intentBrief?.acceptanceLedger?.some((item) => item.status !== "proven"));
}

function shouldAutonomouslyResumeWaitingLane(
  session: SessionState,
  projectContext: ProjectContext | null,
): boolean {
  if (session.status !== "waiting") return false;
  if (session.suggestion.kind !== "idle") return false;
  if (session.managed._paused) return false;
  if (session.currentToolUse) return false;
  if (getPreviewState(session.preview).mode !== "off") return false;
  if (hasPendingLocalSuggestion(session)) return false;
  if (inferTerminalParkedState(session.timeline, session.summary)) return false;
  if (!hasOpenAcceptanceLedgerWork(projectContext)) return false;

  const lastSuggestion = getLastLocalSuggestion(session);
  if (!lastSuggestion || lastSuggestion.state !== "dismissed") return false;
  if (inferRoscoeDecision({ message: lastSuggestion.text, reasoning: lastSuggestion.reasoning }) !== "noop") return false;

  return Boolean(session.managed.tracker.getContextForGeneration().trim());
}

function resetResponderForAutonomousRecheck(managed: ManagedSession): void {
  managed.responderMonitor.restoreSessionId(null);
  managed.responderHistoryCursor = 0;
  managed.lastResponderPrompt = null;
  managed.lastResponderCommand = null;
  managed.lastResponderRationale = "Roscoe cleared a stale no-op responder thread and is reseeding it from the current lane state.";
}

export function shouldQueueSuggestionForSession(session: SessionState): boolean {
  if (!session.managed.awaitingInput) return false;
  if (session.suggestion.kind !== "idle") return false;
  if (session.status === "paused" || session.status === "blocked" || session.status === "parked") return false;
  if (session.currentToolUse) return false;
  if (getPreviewState(session.preview).mode !== "off") return false;
  if (hasPendingLocalSuggestion(session)) return false;
  if (inferTerminalParkedState(session.timeline, session.summary)) return false;
  const lastConversationEntry = getLastConversationEntry(session.timeline);
  if (lastConversationEntry?.kind !== "remote-turn") return false;
  if (isParkedDecisionText(lastConversationEntry.text)) return false;
  return Boolean(session.managed.tracker.getContextForGeneration().trim());
}

export function getWorkerExitRecoveryDecision(
  managed: ManagedSession,
  session: SessionState,
  providerSessionId: string | null,
  currentToolUse: string | null,
  code: number,
  autoHealMetadata: boolean,
) {
  if (managed._paused) {
    return {
      recovery: null,
      appendError: false,
      removeLane: false,
    };
  }

  const canRecoverInterruptedTurn = !managed.awaitingInput && (code === 0 || autoHealMetadata);
  const recovery = canRecoverInterruptedTurn
    ? getInterruptedExitRecoveryPlan(
        session.timeline,
        providerSessionId,
        currentToolUse,
      )
    : null;

  if (recovery) {
    return {
      recovery,
      appendError: code !== 0,
      removeLane: false,
    };
  }

  return {
    recovery: null,
    appendError: code !== 0,
    removeLane: code !== 0,
  };
}

/** Build an initial prompt for auto-starting a session */
export function buildInitialPrompt(managed: ManagedSession, context: ProjectContext | null): string {
  const parts = [`You are a Guild coding agent working on the "${managed.projectName}" project.`];
  const compactMode = Boolean(context && getTokenEfficiencyMode(context) === "save-tokens");

  const lockedProvider = getLockedProjectProvider(context);
  if (lockedProvider) {
    parts.push(`Worker provider is locked to ${lockedProvider}; do not attempt to switch providers for this project.`);
  }
  const responderProvider = getResponderProvider(context);
  if (responderProvider && responderProvider !== lockedProvider) {
    parts.push(`Roscoe is responding from the ${responderProvider} provider while you execute on ${lockedProvider}.`);
  }
  parts.push(`Runtime tuning mode: ${getRuntimeTuningMode(managed.profile.runtime)}.`);
  parts.push(
    getExecutionModeLabel(managed.profile.runtime) === "accelerated"
      ? "Access mode: accelerated filesystem + network access is enabled for this lane."
      : "Access mode: safe sandboxed execution is enabled for this lane.",
  );
  parts.push("Keep check-ins terse: prefer concrete execution, short status updates, and no large JSON or long proof recaps unless Roscoe explicitly asks.");
  if (context) {
    const governanceMode = getWorkerGovernanceMode(context);
    if (governanceMode === "roscoe-arbiter") {
      parts.push("Governance mode: Roscoe arbiter. Keep your configured access, but before material code changes, destructive commands, dependency changes, migrations, or claiming completion, report the exact next move to Roscoe and wait for Roscoe's direction.");
      parts.push("Do not ask the user directly unless Roscoe explicitly tells you to. If a permission or sandbox problem blocks the next move, report the exact failing check once and wait.");
    } else {
      parts.push("Governance mode: Guild autonomous. Work directly inside the saved brief and only check in with Roscoe when the brief is ambiguous, a risk boundary is crossed, or you are blocked.");
    }
  }

  if (context) {
    if (context.techStack?.length) {
      parts.push(`Tech stack: ${compactMode ? summarizePromptValues(context.techStack, 4, 60) : context.techStack.join(", ")}.`);
    }
    if (context.goals?.length) {
      parts.push(`Project goals: ${compactMode ? summarizePromptValues(context.goals, 3, 120) : context.goals.join("; ")}.`);
    }
    if (context.notes) {
      parts.push(compactMode ? clipPromptText(context.notes) : context.notes);
    }
    if (context.intentBrief?.projectStory) {
      parts.push(`Project story: ${compactMode ? clipPromptText(context.intentBrief.projectStory) : context.intentBrief.projectStory}.`);
    }
    if (context.intentBrief?.definitionOfDone?.length) {
      parts.push(`Definition of done: ${compactMode ? summarizePromptValues(context.intentBrief.definitionOfDone, 3, 120) : context.intentBrief.definitionOfDone.join("; ")}.`);
    }
    if (context.intentBrief?.acceptanceChecks?.length) {
      parts.push(`Acceptance checks: ${compactMode ? summarizePromptValues(context.intentBrief.acceptanceChecks, 3, 120) : context.intentBrief.acceptanceChecks.join("; ")}.`);
    }
    if (context.intentBrief?.entrySurfaceContract?.summary) {
      parts.push(`Entry surface contract: ${context.intentBrief.entrySurfaceContract.summary}.`);
    }
    if (context.intentBrief?.entrySurfaceContract?.defaultRoute) {
      parts.push(`Default entry route: ${context.intentBrief.entrySurfaceContract.defaultRoute}.`);
    }
    if (context.intentBrief?.entrySurfaceContract?.expectedExperience) {
      parts.push(`Expected first experience: ${context.intentBrief.entrySurfaceContract.expectedExperience}.`);
    }
    if (context.intentBrief?.localRunContract?.summary) {
      parts.push(`Local first-run contract: ${context.intentBrief.localRunContract.summary}.`);
    }
    if (context.intentBrief?.localRunContract?.startCommand) {
      parts.push(`Canonical local start command: ${context.intentBrief.localRunContract.startCommand}.`);
    }
    if (context.intentBrief?.localRunContract?.firstRoute) {
      parts.push(`First local route: ${context.intentBrief.localRunContract.firstRoute}.`);
    }
    if (context.intentBrief?.localRunContract?.prerequisites?.length) {
      parts.push(`Local prerequisites: ${context.intentBrief.localRunContract.prerequisites.join("; ")}.`);
    }
    if (context.intentBrief?.localRunContract?.seedRequirements?.length) {
      parts.push(`Seed requirements: ${context.intentBrief.localRunContract.seedRequirements.join("; ")}.`);
    }
    if (context.intentBrief?.localRunContract?.expectedBlockedStates?.length) {
      parts.push(`Honest blocked states: ${context.intentBrief.localRunContract.expectedBlockedStates.join("; ")}.`);
    }
    if (context.intentBrief?.acceptanceLedger?.length) {
      if (context.intentBrief.acceptanceLedgerMode === "inferred") {
        parts.push("Acceptance ledger is inferred from an older brief; unresolved items are advisory until refined or proven.");
      }
      const ledgerItems = compactMode
        ? context.intentBrief.acceptanceLedger
          .filter((item) => item.status !== "proven")
          .map((item) => `${clipPromptText(item.label, 120)} [${item.status}]`)
        : context.intentBrief.acceptanceLedger.map((item) => `${item.label} [${item.status}]`);
      parts.push(`Acceptance ledger: ${compactMode ? summarizePromptValues(ledgerItems, 5, 140) : ledgerItems.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deliveryPillars?.frontend?.length) {
      parts.push(`Frontend pillar: ${context.intentBrief.deliveryPillars.frontend.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deliveryPillars?.backend?.length) {
      parts.push(`Backend pillar: ${context.intentBrief.deliveryPillars.backend.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deliveryPillars?.unitComponentTests?.length) {
      parts.push(`Unit/component test pillar: ${context.intentBrief.deliveryPillars.unitComponentTests.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deliveryPillars?.e2eTests?.length) {
      parts.push(`E2E test pillar: ${context.intentBrief.deliveryPillars.e2eTests.join("; ")}.`);
    }
    if (context.intentBrief?.coverageMechanism?.length) {
      parts.push(`Coverage mechanism: ${compactMode ? summarizePromptValues(context.intentBrief.coverageMechanism, 2, 120) : context.intentBrief.coverageMechanism.join("; ")}.`);
    }
    if (context.intentBrief?.deploymentContract?.summary) {
      parts.push(`Deployment contract: ${context.intentBrief.deploymentContract.summary}.`);
    }
    if (!compactMode && context.intentBrief?.deploymentContract?.platforms?.length) {
      parts.push(`Deployment platforms: ${context.intentBrief.deploymentContract.platforms.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deploymentContract?.environments?.length) {
      parts.push(`Deployment environments: ${context.intentBrief.deploymentContract.environments.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deploymentContract?.buildSteps?.length) {
      parts.push(`Canonical build path: ${context.intentBrief.deploymentContract.buildSteps.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deploymentContract?.deploySteps?.length) {
      parts.push(`Canonical deploy path: ${context.intentBrief.deploymentContract.deploySteps.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deploymentContract?.previewStrategy?.length) {
      parts.push(`Preview/deploy strategy: ${context.intentBrief.deploymentContract.previewStrategy.join("; ")}.`);
    }
    if (context.intentBrief?.deploymentContract?.presenceStrategy?.length) {
      parts.push(`Hosted presence strategy: ${compactMode ? summarizePromptValues(context.intentBrief.deploymentContract.presenceStrategy, 2, 120) : context.intentBrief.deploymentContract.presenceStrategy.join("; ")}.`);
    }
    if (context.intentBrief?.deploymentContract?.proofTargets?.length) {
      parts.push(`Hosted proof targets: ${compactMode ? summarizePromptValues(context.intentBrief.deploymentContract.proofTargets, 2, 120) : context.intentBrief.deploymentContract.proofTargets.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deploymentContract?.healthChecks?.length) {
      parts.push(`Deployment health checks: ${context.intentBrief.deploymentContract.healthChecks.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deploymentContract?.rollback?.length) {
      parts.push(`Rollback path: ${context.intentBrief.deploymentContract.rollback.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.deploymentContract?.requiredSecrets?.length) {
      parts.push(`Deployment secrets expected in local env files: ${context.intentBrief.deploymentContract.requiredSecrets.join("; ")}.`);
    }
    if (context.intentBrief?.nonGoals?.length) {
      parts.push(`Do not drift into these non-goals: ${compactMode ? summarizePromptValues(context.intentBrief.nonGoals, 3, 120) : context.intentBrief.nonGoals.join("; ")}.`);
    }
    if (!compactMode && context.intentBrief?.architecturePrinciples?.length) {
      parts.push(`Architecture principles: ${context.intentBrief.architecturePrinciples.join("; ")}.`);
    }
    if (context.intentBrief?.autonomyRules?.length) {
      parts.push(`Autonomy rules: ${compactMode ? summarizePromptValues(context.intentBrief.autonomyRules, 3, 120) : context.intentBrief.autonomyRules.join("; ")}.`);
    }
    if (context.intentBrief?.qualityBar?.length) {
      parts.push(`Quality bar: ${compactMode ? summarizePromptValues(context.intentBrief.qualityBar, 3, 120) : context.intentBrief.qualityBar.join("; ")}.`);
    }
    if (context.intentBrief?.riskBoundaries?.length) {
      parts.push(`Risk boundaries: ${compactMode ? summarizePromptValues(context.intentBrief.riskBoundaries, 3, 120) : context.intentBrief.riskBoundaries.join("; ")}.`);
    }
    if (getVerificationCadence(context) === "batched") {
      parts.push("Verification cadence: batch the heavy proof stack. Use narrow local checks while a coherent slice is in flight, and only rerun the full coverage/e2e commands after a meaningful chunk, before handoff, or when a fresh global run is needed to find the next blocker.");
    } else {
      parts.push("Verification cadence: prove each slice. Once a focused slice is ready, rerun the canonical coverage/e2e proof commands before moving on.");
    }
    parts.push(compactMode
      ? "Token efficiency mode: save tokens. Use this compact contract and do not restate it back unless the detail is required for the next concrete step."
      : "Token efficiency mode: balanced. Use broader context when it materially improves the next move.");
    if (context.intentBrief?.deploymentContract) {
      parts.push("If the developer reports that the deployed environment is still broken after green CI, treat that as a contradiction. Do not close the lane yet: inspect the live rollout, recent pod/server logs, and the exact failing request or callback path before claiming the fix is real.");
    }
  }

  if (managed.worktreeName !== "main") {
    parts.push(`You are working on the task/branch: "${managed.worktreeName}".`);
    parts.push("Work in thin vertical slices: get the next meaningful behavior or bug fix into shape, and use the smallest honest proof needed for that slice before widening scope.");
    parts.push("Use risk-based verification: target changed behavior, regressions, and important failure modes first, then broaden coverage and hardening as the slice stabilizes or risk rises.");
    parts.push("If the repo lacks adequate test or validation machinery for this task, add just enough repo-native proof to keep the slice honest without stalling early iteration on blanket coverage work.");
    parts.push("Do not treat a shell route, placeholder page, sign-in wall, tenant-not-found state, or preview-unavailable panel as a finished user-facing milestone unless Roscoe's saved brief explicitly says that shell-only state is the intended checkpoint. If local use still depends on seed data, auth, or external infrastructure, surface that prerequisite clearly.");
    parts.push("If the saved deployment contract expects a hosted web presence, do not treat local-only proof as permanently sufficient. Keep the preview, stage, or production proof surface truthful and operator-openable as the repo evolves, unless Roscoe explicitly deferred that hosted path.");
    if (context && getVerificationCadence(context) === "batched") {
      parts.push("Do not mechanically rerun the full repo-wide proof stack after every micro-edit. Finish a coherent slice first, then run the expensive verification only when it will materially update the next decision.");
    }
    parts.push("Previews are optional; keep moving until Roscoe asks for a preview break or a live artifact would answer the next decision faster than more code or tests.");
    parts.push("If your runtime supports native agent or sub-agent delegation, use it for bounded parallel subtasks such as focused code search, targeted tests, or disjoint file changes. Keep ownership clear and summarize results back to Roscoe.");
    parts.push("Then keep implementation and proof moving together until the slice is ready for broader validation or handoff.");
  } else {
    parts.push("Review the codebase and await further instructions. When execution begins, favor thin slices, narrow proof, and progressive hardening instead of exhaustive upfront test work.");
    if (context && getVerificationCadence(context) === "batched") {
      parts.push("When implementation starts, prefer batching the heavy proof stack until there is a meaningful slice to verify.");
    }
    parts.push("If your runtime supports native agent or sub-agent delegation, you may use it for bounded parallel subtasks when it shortens the feedback loop without obscuring ownership.");
  }

  return parts.join(" ");
}

/** Strip basic markdown formatting for terminal display */
export function stripMarkdown(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^[-*+]\s+/, "- ");
}

/** Throttled dispatcher for streaming partial text into the generating phase */
export function createPartialDispatcher(
  dispatch: React.Dispatch<AppAction>,
  id: string,
): (partial: string) => void {
  let lastTime = 0;
  let lastLen = 0;
  return (partial: string) => {
    const now = Date.now();
    if (now - lastTime > 80 || partial.length - lastLen > 20) {
      dispatch({ type: "UPDATE_PARTIAL", id, partial });
      lastTime = now;
      lastLen = partial.length;
    }
  };
}

function createEntryId(prefix: string, sessionId: string): string {
  bridgeEntryCounter += 1;
  return `${prefix}-${sessionId}-${Date.now()}-${bridgeEntryCounter}`;
}

let bridgeEntryCounter = 0;

function summarizeThinking(text: string): string | null {
  const normalized = stripMarkdown(text).replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function trimBufferedOutput(value: string): string {
  if (!value) return "";
  let next = value;
  if (next.length > MAX_OUTPUT_BUFFER_CHARS) {
    next = `${TRUNCATION_NOTICE}\n${next.slice(-MAX_OUTPUT_BUFFER_CHARS)}`;
  }

  const lines = next.split("\n");
  if (lines.length > MAX_OUTPUT_BUFFER_LINES) {
    next = [TRUNCATION_NOTICE, ...lines.slice(-MAX_OUTPUT_BUFFER_LINES)].join("\n");
  }

  return next;
}

function appendCappedChunk(current: string, chunk: string, maxChars: number): string {
  if (!chunk) return current;
  const combined = current + chunk;
  if (combined.length <= maxChars) return combined;
  return `${TRUNCATION_NOTICE}\n${combined.slice(-(maxChars - TRUNCATION_NOTICE.length - 1))}`;
}

export async function handleGeneratedSuggestion(
  dispatch: React.Dispatch<AppAction>,
  service: Pick<SessionManagerService, "executeSuggestion" | "generator" | "maybeNotifyIntervention">,
  managed: ManagedSession,
  id: string,
  result: {
    decision?: "message" | "restart-worker" | "noop" | "host-actions-only" | "needs-review";
    text: string;
    confidence: number;
    reasoning: string;
    hostActions?: HostAction[];
  },
  autoMode: boolean,
  options?: {
    shouldHoldForPreview?: () => boolean;
    onHoldForPreview?: () => void;
  },
): Promise<void> {
  const decision = inferRoscoeDecision(result);

  if (decision === "noop") {
    dispatch({ type: "REJECT_SUGGESTION", id });
    dispatch({ type: "SYNC_MANAGED_SESSION", id, managed });
    return;
  }

  if (decision === "host-actions-only") {
    const sentText = await service.executeSuggestion(managed, result);
    dispatch({ type: "AUTO_SENT", id, text: sentText, confidence: result.confidence });
    dispatch({ type: "SYNC_MANAGED_SESSION", id, managed });

    if (sentText.trim()) {
      setTimeout(() => {
        dispatch({ type: "CLEAR_AUTO_SENT", id });
      }, 2000);
    }
    return;
  }

  dispatch({ type: "SUGGESTION_READY", id, result });

  if (options?.shouldHoldForPreview?.()) {
    options.onHoldForPreview?.();
    return;
  }

  if (decision === "needs-review") {
    await service.maybeNotifyIntervention(managed, {
      kind: "needs-review",
      detail: result.text.trim()
        ? `Roscoe drafted the next Guild message and wants review before it is sent: ${result.text}`
        : "Roscoe is holding the next Guild turn and wants your direction before sending anything.",
    });
    return;
  }

  if (!autoMode || !service.generator.meetsThreshold(result)) {
    await service.maybeNotifyIntervention(managed, {
      kind: "needs-review",
      detail: result.text.trim()
        ? `Roscoe drafted the next Guild message and wants review before it is sent: ${result.text}`
        : "Roscoe is holding the next Guild turn and wants your direction before sending anything.",
    });
    return;
  }

  const sentText = await service.executeSuggestion(managed, result);
  dispatch({ type: "AUTO_SENT", id, text: sentText, confidence: result.confidence });
  dispatch({ type: "SYNC_MANAGED_SESSION", id, managed });

  if (sentText.trim()) {
    setTimeout(() => {
      dispatch({ type: "CLEAR_AUTO_SENT", id });
    }, 2000);
  }
}

export function useEventBridge(
  sessions: Map<string, SessionState>,
  dispatch: React.Dispatch<AppAction>,
  service: SessionManagerService,
  autoMode: boolean,
) {
  const autoModeRef = useRef(autoMode);
  autoModeRef.current = autoMode;

  const wiredRef = useRef(new Set<string>());
  const sessionsRef = useRef(sessions);
  const queueSuggestionRef = useRef(new Map<string, (seedSession: SessionState) => Promise<void>>());
  const inFlightSuggestionRef = useRef(new Set<string>());
  const waitingRecheckTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => () => {
    for (const timer of waitingRecheckTimersRef.current.values()) {
      clearTimeout(timer);
    }
    waitingRecheckTimersRef.current.clear();
  }, []);

  useEffect(() => {
    for (const [id, session] of sessions) {
      if (wiredRef.current.has(id)) continue;
      wiredRef.current.add(id);

      const managed = session.managed;
      const { monitor, tracker } = managed;

      // Keep only a rolling slice of raw output so long-running lanes do not
      // retain the full session transcript in memory forever.
      let fullText = "";
      let turnText = "";
      let thinkingText = "";
      let lastToolActivity: string | null = null;
      let lastToolDetail: string | null = null;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let resumeWatchdog: ReturnType<typeof setTimeout> | null = null;

      const clearResumeWatchdog = () => {
        if (resumeWatchdog) {
          clearTimeout(resumeWatchdog);
          resumeWatchdog = null;
        }
      };

      const armResumeWatchdog = () => {
        clearResumeWatchdog();
        resumeWatchdog = setTimeout(() => {
          const liveSession = sessionsRef.current.get(id);
          if (liveSession?.currentToolUse === RESUME_ACTIVITY_NAME) {
            dispatch({
              type: "SET_TOOL_ACTIVITY",
              id,
              toolName: RESUME_ACTIVITY_NAME,
              detail: RESUME_STILL_WAITING_DETAIL,
            });
          }
        }, RESUME_WATCHDOG_MS);
      };

      const flushOutput = () => {
        fullText = trimBufferedOutput(fullText);
        const lines = fullText.split("\n")
          .filter((l) => l.trim());
        dispatch({ type: "SET_OUTPUT", id, lines });
        flushTimer = null;
      };

      const onText = (chunk: string) => {
        if (lastToolActivity === RESUME_ACTIVITY_NAME) {
          clearResumeWatchdog();
          lastToolDetail = RESUME_RESPONDING_DETAIL;
          dispatch({
            type: "SET_TOOL_ACTIVITY",
            id,
            toolName: RESUME_ACTIVITY_NAME,
            detail: RESUME_RESPONDING_DETAIL,
          });
        }
        tracker.addOutput(chunk);
        fullText = trimBufferedOutput(fullText + chunk);
        turnText = appendCappedChunk(turnText, chunk, MAX_TURN_TEXT_CHARS);
        if (!flushTimer) {
          flushTimer = setTimeout(flushOutput, 50);
        }
      };

      let lastSummaryTime = 0;
      const SUMMARY_COOLDOWN = 30_000;

      const queueRoscoeSuggestion = (seedSession: SessionState) => {
        dispatch({ type: "START_GENERATING", id });
        return service.generateSuggestion(
          managed,
          createPartialDispatcher(dispatch, id),
          (usage) => dispatch({ type: "ADD_SESSION_USAGE", id, usage }),
          () => sessionsRef.current.get(id) ?? seedSession,
        )
          .then((result) => handleGeneratedSuggestion(dispatch, service, managed, id, result, autoModeRef.current, {
            shouldHoldForPreview: () => getPreviewState((sessionsRef.current.get(id) ?? seedSession).preview).mode !== "off",
            onHoldForPreview: () => {
              const latestSession = sessionsRef.current.get(id) ?? seedSession;
              const readyPreview = buildReadyPreviewState({
                timeline: latestSession.timeline,
                outputLines: latestSession.outputLines,
                summary: latestSession.summary,
              });
              dispatch({
                type: "ACTIVATE_PREVIEW_BREAK",
                id,
                message: readyPreview.message ?? "Preview ready.",
                ...(readyPreview.link ? { link: readyPreview.link } : {}),
              });
            },
          }))
          .catch((err) => {
            void service.maybeNotifyIntervention(managed, {
              kind: "error",
              detail: err instanceof Error ? err.message : String(err),
            });
            dispatch({
              type: "SUGGESTION_ERROR",
              id,
              message: err instanceof Error ? err.message : String(err),
            });
          });
      };

      const runQueuedSuggestion = (seedSession: SessionState) => {
        if (inFlightSuggestionRef.current.has(id)) {
          return Promise.resolve();
        }
        inFlightSuggestionRef.current.add(id);
        return queueRoscoeSuggestion(seedSession).finally(() => {
          inFlightSuggestionRef.current.delete(id);
        });
      };

      queueSuggestionRef.current.set(id, runQueuedSuggestion);

      const applyRecoveryPlan = (seedSession: SessionState, recovery: NonNullable<ManagedSession["restoreRecovery"]>) => {
        if (recovery.mode === "resume-worker" && monitor.getSessionId()) {
          lastToolActivity = RESUME_ACTIVITY_NAME;
          lastToolDetail = RESUME_PENDING_DETAIL;
          dispatch({
            type: "APPEND_TIMELINE_ENTRY",
            id,
            entry: {
              id: createEntryId("restore", id),
              kind: "tool-activity",
              timestamp: Date.now(),
              provider: "roscoe",
              toolName: "resume",
              text: recovery.note,
            },
          });
          dispatch({
            type: "SET_TOOL_ACTIVITY",
            id,
            toolName: RESUME_ACTIVITY_NAME,
            detail: RESUME_PENDING_DETAIL,
          });
          armResumeWatchdog();
          service.injectText(managed, recovery.prompt);
          dispatch({ type: "SYNC_MANAGED_SESSION", id, managed });
          return;
        }

        clearResumeWatchdog();
        dispatch({
          type: "APPEND_TIMELINE_ENTRY",
          id,
          entry: {
            id: createEntryId("restore", id),
            kind: "tool-activity",
            timestamp: Date.now(),
            provider: "roscoe",
            toolName: "resume",
            text: recovery.note,
          },
        });
        dispatch({ type: "SET_TOOL_ACTIVITY", id, toolName: null });
        managed.awaitingInput = true;
        dispatch({ type: "SYNC_MANAGED_SESSION", id, managed });
        void runQueuedSuggestion(seedSession);
      };

      const onTurnComplete = async () => {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        clearResumeWatchdog();
        flushOutput();

        tracker.markTurnComplete();
        const completedTurn = turnText.trim();
        const turnEntry = completedTurn
          ? {
              id: createEntryId("remote", id),
              kind: "remote-turn" as const,
              timestamp: Date.now(),
              provider: managed.profileName,
              text: completedTurn,
              activity: lastToolActivity,
              note: summarizeThinking(thinkingText),
            }
          : null;
        if (completedTurn) {
          dispatch({
            type: "APPEND_TIMELINE_ENTRY",
            id,
            entry: turnEntry!,
          });
        }
        turnText = "";
        thinkingText = "";
        lastToolActivity = null;
        lastToolDetail = null;
        managed.awaitingInput = true;

        dispatch({ type: "UPDATE_SESSION_STATUS", id, status: "waiting" });
        dispatch({ type: "SET_TOOL_ACTIVITY", id, toolName: null });

        const liveSession = sessionsRef.current.get(id) ?? session;
        const previewState = getPreviewState(liveSession.preview);
        const nextTimeline = turnEntry ? [...liveSession.timeline, turnEntry] : liveSession.timeline;
        if (previewState.mode === "queued") {
          const readyPreview = buildReadyPreviewState({
            timeline: nextTimeline,
            outputLines: fullText.split("\n").filter((line) => line.trim()),
            summary: liveSession.summary,
          });
          dispatch({
            type: "ACTIVATE_PREVIEW_BREAK",
            id,
            message: readyPreview.message ?? "Preview ready.",
            ...(readyPreview.link ? { link: readyPreview.link } : {}),
          });

          const now = Date.now();
          if (now - lastSummaryTime > SUMMARY_COOLDOWN) {
            lastSummaryTime = now;
            service.generateSummary(managed).then((summary) => {
              dispatch({ type: "SET_SUMMARY", id, summary });
              void service.maybeNotifyProgress(managed, summary);
            });
          }
          return;
        }

        if (completedTurn && isPauseAcknowledgementText(completedTurn)) {
          managed._paused = true;
          dispatch({ type: "BLOCK_SESSION", id });
          void service.maybeNotifyIntervention(managed, {
            kind: "paused",
            detail: completedTurn,
          });
          return;
        }

        if (inferTerminalParkedState(nextTimeline, liveSession.summary)) {
          dispatch({ type: "UPDATE_SESSION_STATUS", id, status: "parked" });
          return;
        }

        const context = tracker.getContextForGeneration();
        if (!context.trim()) {
          dispatch({ type: "START_MANUAL", id });
          void service.maybeNotifyIntervention(managed, {
            kind: "manual-input",
            detail: "Guild is waiting for your next instruction. Reply here with what Roscoe should send next.",
          });
          return;
        }
        await runQueuedSuggestion(liveSession);

        // Generate summary (with cooldown to avoid excessive LLM calls)
        const now = Date.now();
        if (now - lastSummaryTime > SUMMARY_COOLDOWN) {
          lastSummaryTime = now;
          service.generateSummary(managed).then((summary) => {
            dispatch({ type: "SET_SUMMARY", id, summary });
            void service.maybeNotifyProgress(managed, summary);
          });
        }
      };

      const onExit = (code: number) => {
        clearResumeWatchdog();
        const liveSession = sessionsRef.current.get(id) ?? session;
        const autoHealMetadata = loadRoscoeSettings().behavior.autoHealMetadata;
        const exitDecision = getWorkerExitRecoveryDecision(
          managed,
          liveSession,
          monitor.getSessionId(),
          liveSession.currentToolUse ?? lastToolActivity,
          code,
          autoHealMetadata,
        );
        if (exitDecision.appendError) {
          dispatch({
            type: "APPEND_TIMELINE_ENTRY",
            id,
            entry: {
              id: createEntryId("session-error", id),
              kind: "error",
              timestamp: Date.now(),
              text: `${managed.profileName} exited with code ${code}`,
              source: "session",
            },
          });
        }
        if (exitDecision.recovery) {
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          flushOutput();
          applyRecoveryPlan(liveSession, exitDecision.recovery);
          return;
        }
        if (exitDecision.removeLane) {
          dispatch({ type: "UPDATE_SESSION_STATUS", id, status: "exited" });
          setTimeout(() => {
            dispatch({ type: "REMOVE_SESSION", id });
            if (service.orchestrator) {
              service.orchestrator.unregisterWorker(id);
            }
          }, 2000);
        }
      };

      const onToolActivity = (toolName: string, detail?: string | null) => {
        if (lastToolActivity === RESUME_ACTIVITY_NAME && toolName !== RESUME_ACTIVITY_NAME) {
          clearResumeWatchdog();
        }
        if (toolName !== lastToolActivity) {
          lastToolActivity = toolName;
          lastToolDetail = detail ?? null;
          dispatch({
            type: "APPEND_TIMELINE_ENTRY",
            id,
            entry: {
              id: createEntryId("tool", id),
              kind: "tool-activity",
              timestamp: Date.now(),
              provider: managed.profileName,
              toolName,
              text: detail ?? `Using ${toolName}`,
            },
          });
        } else if (detail) {
          lastToolDetail = detail;
        }
        dispatch({ type: "SET_TOOL_ACTIVITY", id, toolName, ...(detail !== undefined ? { detail } : {}) });
      };

      const onThinking = (chunk: string) => {
        thinkingText = appendCappedChunk(thinkingText, chunk, MAX_THINKING_TEXT_CHARS);
      };

      const onUsage = (usage: {
        inputTokens: number;
        outputTokens: number;
        cachedInputTokens: number;
        cacheCreationInputTokens: number;
      }) => {
        dispatch({ type: "ADD_SESSION_USAGE", id, usage });
      };

      const onRateLimit = (rateLimitStatus: {
        source: LLMProtocol;
        windowLabel: string | null;
        status: string | null;
        resetsAt: string | null;
      }) => {
        dispatch({ type: "SET_SESSION_RATE_LIMIT", id, rateLimitStatus });
      };

      const onResult = () => {
        dispatch({ type: "SYNC_MANAGED_SESSION", id, managed });
      };

      monitor.on("text", onText);
      monitor.on("thinking", onThinking);
      monitor.on("usage", onUsage);
      monitor.on("rate-limit", onRateLimit);
      monitor.on("turn-complete", onTurnComplete);
      monitor.on("exit", onExit);
      monitor.on("tool-activity", onToolActivity);
      monitor.on("result", onResult);

      const restoreRecovery = managed.restoreRecovery ?? null;

      if (restoreRecovery?.mode === "resume-worker" && monitor.getSessionId()) {
        managed.restoreRecovery = null;
        applyRecoveryPlan(session, restoreRecovery);
      } else if (restoreRecovery?.mode === "restage-roscoe") {
        managed.restoreRecovery = null;
        applyRecoveryPlan(session, restoreRecovery);
      } else if (!monitor.getSessionId()) {
        // Auto-start: spawn the configured headless LLM with an initial prompt.
        const projectContext = loadProjectContext(managed.projectDir);
        const initialPrompt = buildInitialPrompt(managed, projectContext);
        service.prepareWorkerTurn(managed, initialPrompt);
        dispatch({ type: "SYNC_MANAGED_SESSION", id, managed });
        managed.tracker.recordUserInput(initialPrompt);
        monitor.startTurn(initialPrompt);
        managed.awaitingInput = false;
      } else if (
        managed.awaitingInput
        && session.suggestion.kind === "idle"
        && session.status !== "paused"
        && session.status !== "blocked"
        && session.status !== "parked"
      ) {
        const previewState = getPreviewState(session.preview);
        const lastConversationEntry = getLastConversationEntry(session.timeline);
        if (lastConversationEntry?.kind === "remote-turn" && isPauseAcknowledgementText(lastConversationEntry.text)) {
          managed._paused = true;
          dispatch({ type: "BLOCK_SESSION", id });
        } else if (
          previewState.mode === "off"
          && lastConversationEntry?.kind === "remote-turn"
          && managed.tracker.getContextForGeneration().trim()
        ) {
          void runQueuedSuggestion(session);
        }
      }
    }

    for (const id of wiredRef.current) {
      if (!sessions.has(id)) {
        wiredRef.current.delete(id);
        queueSuggestionRef.current.delete(id);
        inFlightSuggestionRef.current.delete(id);
        const recheckTimer = waitingRecheckTimersRef.current.get(id);
        if (recheckTimer) {
          clearTimeout(recheckTimer);
          waitingRecheckTimersRef.current.delete(id);
        }
      }
    }
  }, [sessions, dispatch, service]);

  useEffect(() => {
    for (const [id, session] of sessions) {
      const runQueuedSuggestion = queueSuggestionRef.current.get(id);
      if (!runQueuedSuggestion) continue;
      if (!shouldQueueSuggestionForSession(session)) continue;
      const lastConversationEntry = getLastConversationEntry(session.timeline);
      if (lastConversationEntry?.kind === "remote-turn" && isPauseAcknowledgementText(lastConversationEntry.text)) {
        session.managed._paused = true;
        dispatch({ type: "BLOCK_SESSION", id });
        continue;
      }
      void runQueuedSuggestion(session);
    }
  }, [sessions, dispatch]);

  useEffect(() => {
    for (const [id, session] of sessions) {
      const runQueuedSuggestion = queueSuggestionRef.current.get(id);
      if (!runQueuedSuggestion) continue;

      const projectContext = loadProjectContext(session.managed.projectDir);
      const shouldRecheck = shouldAutonomouslyResumeWaitingLane(session, projectContext);
      const existingTimer = waitingRecheckTimersRef.current.get(id);

      if (!shouldRecheck) {
        if (existingTimer) {
          clearTimeout(existingTimer);
          waitingRecheckTimersRef.current.delete(id);
        }
        continue;
      }

      if (existingTimer) {
        continue;
      }

      const timer = setTimeout(() => {
        waitingRecheckTimersRef.current.delete(id);
        const latestSession = sessionsRef.current.get(id);
        if (!latestSession) return;

        const latestProjectContext = loadProjectContext(latestSession.managed.projectDir);
        if (!shouldAutonomouslyResumeWaitingLane(latestSession, latestProjectContext)) {
          return;
        }

        resetResponderForAutonomousRecheck(latestSession.managed);
        dispatch({ type: "SYNC_MANAGED_SESSION", id, managed: latestSession.managed });
        void runQueuedSuggestion(latestSession);
      }, WAITING_LANE_RECHECK_MS);

      waitingRecheckTimersRef.current.set(id, timer);
    }

    for (const [id, timer] of waitingRecheckTimersRef.current) {
      const session = sessions.get(id);
      const runQueuedSuggestion = queueSuggestionRef.current.get(id);
      const projectContext = session ? loadProjectContext(session.managed.projectDir) : null;
      if (!session || !runQueuedSuggestion || !shouldAutonomouslyResumeWaitingLane(session, projectContext)) {
        clearTimeout(timer);
        waitingRecheckTimersRef.current.delete(id);
      }
    }
  }, [sessions, dispatch]);
}
