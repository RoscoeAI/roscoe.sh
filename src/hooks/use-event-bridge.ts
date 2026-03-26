import { useEffect, useRef } from "react";
import { AppAction, SessionState, ManagedSession } from "../types.js";
import { SessionManagerService } from "../services/session-manager.js";
import { loadProjectContext, ProjectContext } from "../config.js";
import { getLockedProjectProvider, getRuntimeTuningMode } from "../runtime-defaults.js";

/** Build an initial prompt for auto-starting a session */
export function buildInitialPrompt(managed: ManagedSession, context: ProjectContext | null): string {
  const parts = [`You are a Guild coding agent working on the "${managed.projectName}" project.`];

  const lockedProvider = getLockedProjectProvider(context);
  if (lockedProvider) {
    parts.push(`Worker provider is locked to ${lockedProvider}; do not attempt to switch providers for this project.`);
  }
  parts.push(`Runtime tuning mode: ${getRuntimeTuningMode(managed.profile.runtime)}.`);

  if (context) {
    if (context.techStack?.length) {
      parts.push(`Tech stack: ${context.techStack.join(", ")}.`);
    }
    if (context.goals?.length) {
      parts.push(`Project goals: ${context.goals.join("; ")}.`);
    }
    if (context.notes) {
      parts.push(context.notes);
    }
    if (context.intentBrief?.projectStory) {
      parts.push(`Project story: ${context.intentBrief.projectStory}.`);
    }
    if (context.intentBrief?.definitionOfDone?.length) {
      parts.push(`Definition of done: ${context.intentBrief.definitionOfDone.join("; ")}.`);
    }
    if (context.intentBrief?.acceptanceChecks?.length) {
      parts.push(`Acceptance checks: ${context.intentBrief.acceptanceChecks.join("; ")}.`);
    }
    if (context.intentBrief?.deliveryPillars?.frontend?.length) {
      parts.push(`Frontend pillar: ${context.intentBrief.deliveryPillars.frontend.join("; ")}.`);
    }
    if (context.intentBrief?.deliveryPillars?.backend?.length) {
      parts.push(`Backend pillar: ${context.intentBrief.deliveryPillars.backend.join("; ")}.`);
    }
    if (context.intentBrief?.deliveryPillars?.unitComponentTests?.length) {
      parts.push(`Unit/component test pillar: ${context.intentBrief.deliveryPillars.unitComponentTests.join("; ")}.`);
    }
    if (context.intentBrief?.deliveryPillars?.e2eTests?.length) {
      parts.push(`E2E test pillar: ${context.intentBrief.deliveryPillars.e2eTests.join("; ")}.`);
    }
    if (context.intentBrief?.coverageMechanism?.length) {
      parts.push(`Coverage mechanism: ${context.intentBrief.coverageMechanism.join("; ")}.`);
    }
    if (context.intentBrief?.nonGoals?.length) {
      parts.push(`Do not drift into these non-goals: ${context.intentBrief.nonGoals.join("; ")}.`);
    }
    if (context.intentBrief?.autonomyRules?.length) {
      parts.push(`Autonomy rules: ${context.intentBrief.autonomyRules.join("; ")}.`);
    }
    if (context.intentBrief?.qualityBar?.length) {
      parts.push(`Quality bar: ${context.intentBrief.qualityBar.join("; ")}.`);
    }
    if (context.intentBrief?.riskBoundaries?.length) {
      parts.push(`Risk boundaries: ${context.intentBrief.riskBoundaries.join("; ")}.`);
    }
  }

  if (managed.worktreeName !== "main") {
    parts.push(`You are working on the task/branch: "${managed.worktreeName}".`);
    parts.push("Work tests-first: identify or author the unit/component and e2e proofs that define done for this task before widening implementation.");
    parts.push("If the repo lacks adequate test or coverage machinery for this task, establish the measurable proof path first using the repo's native tooling.");
    parts.push("Only then implement the minimum frontend/backend changes needed to make those proofs pass.");
  } else {
    parts.push("Review the codebase and await further instructions. When execution begins, default to a tests-first proof plan.");
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

export function useEventBridge(
  sessions: Map<string, SessionState>,
  dispatch: React.Dispatch<AppAction>,
  service: SessionManagerService,
  autoMode: boolean,
) {
  const autoModeRef = useRef(autoMode);
  autoModeRef.current = autoMode;

  const wiredRef = useRef(new Set<string>());

  useEffect(() => {
    for (const [id, session] of sessions) {
      if (wiredRef.current.has(id)) continue;
      wiredRef.current.add(id);

      const managed = session.managed;
      const { monitor, tracker } = managed;

      // Simple fullText accumulator — re-derive lines on each flush
      let fullText = "";
      let turnText = "";
      let thinkingText = "";
      let lastToolActivity: string | null = null;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flushOutput = () => {
        const lines = fullText.split("\n")
          .filter((l) => l.trim());
        dispatch({ type: "SET_OUTPUT", id, lines });
        flushTimer = null;
      };

      const onText = (chunk: string) => {
        tracker.addOutput(chunk);
        fullText += chunk;
        turnText += chunk;
        if (!flushTimer) {
          flushTimer = setTimeout(flushOutput, 50);
        }
      };

      let lastSummaryTime = 0;
      const SUMMARY_COOLDOWN = 30_000;

      const onTurnComplete = async () => {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        flushOutput();

        tracker.markTurnComplete();
        const completedTurn = turnText.trim();
        if (completedTurn) {
          dispatch({
            type: "APPEND_TIMELINE_ENTRY",
            id,
            entry: {
              id: createEntryId("remote", id),
              kind: "remote-turn",
              timestamp: Date.now(),
              provider: managed.profileName,
              text: completedTurn,
              activity: lastToolActivity,
              note: summarizeThinking(thinkingText),
            },
          });
        }
        turnText = "";
        thinkingText = "";
        lastToolActivity = null;
        managed.awaitingInput = true;

        dispatch({ type: "UPDATE_SESSION_STATUS", id, status: "waiting" });
        dispatch({ type: "SET_TOOL_ACTIVITY", id, toolName: null });

        const context = tracker.getContextForGeneration();
        if (!context.trim()) {
          dispatch({ type: "START_MANUAL", id });
          return;
        }

        dispatch({ type: "START_GENERATING", id });

        try {
          const result = await service.generateSuggestion(managed, createPartialDispatcher(dispatch, id));
          dispatch({ type: "SUGGESTION_READY", id, result });

          if (
            autoModeRef.current &&
            service.generator.meetsThreshold(result)
          ) {
            await service.executeSuggestion(managed, result);
            dispatch({ type: "SYNC_MANAGED_SESSION", id, managed });
            dispatch({ type: "AUTO_SENT", id, text: result.text, confidence: result.confidence });
            setTimeout(() => {
              dispatch({ type: "CLEAR_AUTO_SENT", id });
            }, 2000);
          }
        } catch (err) {
          dispatch({
            type: "SUGGESTION_ERROR",
            id,
            message: err instanceof Error ? err.message : String(err),
          });
        }

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
        if (managed._paused) return; // intentional pause — don't remove
        if (code !== 0) {
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
          dispatch({ type: "UPDATE_SESSION_STATUS", id, status: "exited" });
          setTimeout(() => {
            dispatch({ type: "REMOVE_SESSION", id });
            if (service.orchestrator) {
              service.orchestrator.unregisterWorker(id);
            }
          }, 2000);
        }
      };

      const onToolActivity = (toolName: string) => {
        if (toolName !== lastToolActivity) {
          lastToolActivity = toolName;
          dispatch({
            type: "APPEND_TIMELINE_ENTRY",
            id,
            entry: {
              id: createEntryId("tool", id),
              kind: "tool-activity",
              timestamp: Date.now(),
              provider: managed.profileName,
              toolName,
              text: `Using ${toolName}`,
            },
          });
        }
        dispatch({ type: "SET_TOOL_ACTIVITY", id, toolName });
      };

      const onThinking = (chunk: string) => {
        thinkingText += chunk;
      };

      monitor.on("text", onText);
      monitor.on("thinking", onThinking);
      monitor.on("turn-complete", onTurnComplete);
      monitor.on("exit", onExit);
      monitor.on("tool-activity", onToolActivity);

      // Auto-start: spawn the configured headless LLM with an initial prompt.
      if (!monitor.getSessionId()) {
        const projectContext = loadProjectContext(managed.projectDir);
        const initialPrompt = buildInitialPrompt(managed, projectContext);
        service.prepareWorkerTurn(managed, initialPrompt);
        dispatch({ type: "SYNC_MANAGED_SESSION", id, managed });
        managed.tracker.recordUserInput(initialPrompt);
        monitor.startTurn(initialPrompt);
        managed.awaitingInput = false;
      }
    }

    for (const id of wiredRef.current) {
      if (!sessions.has(id)) {
        wiredRef.current.delete(id);
      }
    }
  }, [sessions, dispatch, service]);
}
