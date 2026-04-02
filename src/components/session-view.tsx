import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { useAppContext } from "../app.js";
import { createPartialDispatcher } from "../hooks/use-event-bridge.js";
import { useSessions } from "../hooks/use-sessions.js";
import { useTerminalSize } from "../hooks/use-terminal-size.js";
import { SessionList } from "./session-list.js";
import { SessionOutput } from "./session-output.js";
import { SessionStatusPane } from "./session-status-pane.js";
import { SuggestionBar } from "./suggestion-bar.js";
import { StatusBar } from "./status-bar.js";
import { ExitWarningPane } from "./exit-warning-pane.js";
import { CloseLanePane } from "./close-lane-pane.js";
import { parseSessionSpec } from "../services/session-manager.js";
import { WorktreeManager } from "../worktree-manager.js";
import { basename } from "path";
import { detectProtocol, LLMProtocol, RuntimeControlSettings } from "../llm-runtime.js";
import {
  getProjectContractFingerprint,
  loadRoscoeSettings,
  loadProfile,
  loadProjectContext,
  normalizeProjectContext,
  ResponderApprovalMode,
  saveProjectContext,
  VerificationCadence,
  WorkerGovernanceMode,
} from "../config.js";
import { getSelectableProviderIds } from "../provider-registry.js";
import {
  buildConfiguredRuntime,
  getResponderProvider,
  getTokenEfficiencyMode,
} from "../runtime-defaults.js";
import { RuntimeEditorDraft, RuntimeEditorPanel } from "./runtime-controls.js";
import { SessionState, SessionStatus, TranscriptEntry } from "../types.js";
import { buildQueuedPreviewState, buildReadyPreviewState, getPreviewState } from "../session-preview.js";
import { interruptActiveLane } from "../session-interrupt.js";
import { isPauseAcknowledgementText } from "../session-transcript.js";
import { getResumePrompt } from "../session-control.js";

let smsEntryCounter = 0;

export function createSmsEntry(
  prefix: string,
  sessionId: string,
  entry: any,
): TranscriptEntry {
  smsEntryCounter += 1;
  return {
    id: `${prefix}-${sessionId}-${Date.now()}-${smsEntryCounter}`,
    timestamp: Date.now(),
    ...entry,
  } as TranscriptEntry;
}

export function deriveSmsQuestion(session: SessionStateLike): string | null {
  const latestRemote = [...session.timeline].reverse().find((entry) => entry.kind === "remote-turn");
  const source = latestRemote?.text ?? session.managed.tracker.getLastAssistantMessage() ?? "";
  const normalized = source.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const sentenceMatches = normalized.match(/[^?!.]+[?]/g) ?? [];
  const lastQuestion = sentenceMatches[sentenceMatches.length - 1]?.trim();
  if (lastQuestion) return lastQuestion;

  return normalized.length > 220 ? `${normalized.slice(0, 217).trimEnd()}...` : normalized;
}

type SessionStateLike = {
  id: string;
  timeline: TranscriptEntry[];
  managed: {
    tracker: {
      getLastAssistantMessage(): string | null;
    };
  };
};

export function normalizeInlineText(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(80, maxLength - 3)).trimEnd()}...`;
}

export function getActiveLaneSummary(session: SessionState | null): string | null {
  if (!session) return null;
  if (session.status !== "blocked") {
    return session.summary;
  }

  for (let index = session.timeline.length - 1; index >= 0; index -= 1) {
    const entry = session.timeline[index];
    if (entry.kind !== "remote-turn") continue;
    const text = normalizeInlineText(entry.text);
    if (!text) continue;
    if (!isPauseAcknowledgementText(entry.text) || text.length > 40) {
      return text;
    }
  }

  return session.summary;
}

export function getClosedPersistStatus(session: SessionState): SessionStatus {
  if (session.status === "blocked" || session.status === "paused" || session.status === "parked" || session.status === "review" || session.status === "waiting") {
    return session.status;
  }

  if (session.suggestion.kind === "ready") {
    return "review";
  }

  return "waiting";
}

interface SessionViewProps {
  startSpecs?: string[];
  startRuntimeOverrides?: Partial<Record<LLMProtocol, RuntimeControlSettings>>;
}

export function SessionView({ startSpecs, startRuntimeOverrides }: SessionViewProps) {
  const { state, dispatch, service } = useAppContext();
  const { exit } = useApp();
  const { startSession, switchSession } = useSessions(dispatch, service);
  const { columns, rows } = useTerminalSize();
  const [runtimeEditorOpen, setRuntimeEditorOpen] = useState(false);
  const [statusPaneVisible, setStatusPaneVisible] = useState(true);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [closeLaneConfirmOpen, setCloseLaneConfirmOpen] = useState(false);

  // Start sessions from CLI specs on mount
  useEffect(() => {
    if (!startSpecs || startSpecs.length === 0) return;

    const startAll = async () => {
      for (const spec of startSpecs) {
        try {
          const parsed = parseSessionSpec(spec);
          const projectDir = parsed.projectDir || process.cwd();
          const projectName = basename(projectDir);
          const provider = detectProtocol(loadProfile(parsed.profileName));

          let worktreePath = projectDir;
          let worktreeName = "main";

          if (parsed.taskName) {
            const wm = new WorktreeManager(projectDir);
            const wt = await wm.create(parsed.taskName);
            worktreePath = wt.path;
            worktreeName = parsed.taskName;
          }

          startSession({
            profileName: parsed.profileName,
            projectDir,
            worktreePath,
            worktreeName,
            projectName,
            runtimeOverrides: startRuntimeOverrides?.[provider],
          });
        } catch {
          // skip failed specs
        }
      }
    };

    startAll();
  }, []); // only on mount

  useEffect(() => {
    for (const session of state.sessions.values()) {
      const liveProjectContext = loadProjectContext(session.managed.projectDir);
      const liveFingerprint = getProjectContractFingerprint(liveProjectContext);
      if (liveFingerprint !== session.contractFingerprint) {
        dispatch({
          type: "INVALIDATE_SESSION_CONTRACT",
          id: session.id,
          contractFingerprint: liveFingerprint,
          reason: "Saved project contract changed. Roscoe cleared stale parked/review guidance so this lane can be reassessed under the updated brief.",
        });
        continue;
      }
    }
  }, [state.sessions, dispatch, service]);

  const activeSession = state.activeSessionId
    ? state.sessions.get(state.activeSessionId)
    : null;
  const activeProjectContext = activeSession
    ? loadProjectContext(activeSession.managed.projectDir)
    : null;
  const notificationStatus = service.notifications.getStatus();
  const canTextQuestion = Boolean(
    activeSession
    && activeSession.managed.awaitingInput
    && notificationStatus.phoneNumber
    && notificationStatus.providerReady,
  );
  const railWidth = columns >= 180 ? 54 : columns >= 150 ? 48 : columns >= 125 ? 42 : columns >= 100 ? 36 : 30;
  const pageDelta = Math.max(6, Math.floor(rows * 0.35));
  const activePreview = getPreviewState(activeSession?.preview);
  const canInterruptActiveTurn = Boolean(
    activeSession
    && (activeSession.currentToolUse
      || activeSession.suggestion.kind === "generating"
      || (activeSession.status === "active" && !activeSession.managed.awaitingInput)),
  );
  const hasInFlightWork = Array.from(state.sessions.values()).some((session) =>
    session.status === "active"
    || session.status === "generating"
    || !session.managed.awaitingInput
    || Boolean(session.currentToolUse)
    || session.suggestion.kind === "generating",
  );

  const confirmExit = () => {
    service.cancelGeneration();
    for (const session of state.sessions.values()) {
      service.persistSessionState(session);
      session.managed.monitor.kill();
      session.managed.responderMonitor.kill();
    }
    exit();
  };

  const closeActiveLane = () => {
    if (!activeSession) return;

    if (activeSession.suggestion.kind === "generating") {
      service.cancelGeneration();
    }

    const persistedSession: SessionState = {
      ...activeSession,
      status: getClosedPersistStatus(activeSession),
      currentToolUse: null,
      currentToolDetail: null,
    };
    service.persistSessionState(persistedSession);
    activeSession.managed.monitor.kill();
    activeSession.managed.responderMonitor.kill();
    dispatch({ type: "REMOVE_SESSION", id: activeSession.id });
    if (state.sessions.size === 1) {
      dispatch({ type: "SET_SCREEN", screen: "home" });
    }
  };

  const applyRuntimeEdit = (draft: RuntimeEditorDraft) => {
    if (!activeSession) return;

    const workerRuntimePatch: RuntimeControlSettings = buildConfiguredRuntime(
      draft.workerProvider,
      draft.workerExecutionMode,
      draft.workerTuningMode,
      draft.workerModel,
      draft.workerReasoningEffort,
    );
    const responderRuntimePatch: RuntimeControlSettings = buildConfiguredRuntime(
      draft.responderProvider,
      draft.workerExecutionMode,
      "manual",
      draft.responderModel,
      draft.responderReasoningEffort,
    );

    for (const session of state.sessions.values()) {
      if (session.managed.projectDir !== activeSession.managed.projectDir) continue;

      service.updateManagedRuntime(session.managed, workerRuntimePatch, draft.workerProvider);
      service.updateManagedResponderRuntime(session.managed, responderRuntimePatch, draft.responderProvider);
      if (draft.workerTuningMode === "auto") {
        service.prepareWorkerTurn(session.managed);
      }
      session.managed.responderMonitor.restoreSessionId(null);
      session.managed.responderHistoryCursor = 0;
      dispatch({ type: "SYNC_MANAGED_SESSION", id: session.id, managed: session.managed });
    }

    const projectContext = loadProjectContext(activeSession.managed.projectDir);
    if (projectContext) {
      const nextContext = normalizeProjectContext({
        ...projectContext,
        runtimeDefaults: {
          ...(projectContext.runtimeDefaults ?? {}),
          guildProvider: draft.workerProvider,
          responderProvider: draft.responderProvider,
          workerGovernanceMode: draft.workerGovernanceMode,
          verificationCadence: draft.verificationCadence,
          tokenEfficiencyMode: draft.tokenEfficiencyMode,
          responderApprovalMode: draft.responderApprovalMode,
          workerByProtocol: {
            ...(projectContext.runtimeDefaults?.workerByProtocol ?? {}),
            [draft.workerProvider]: workerRuntimePatch,
          },
          responderByProtocol: {
            ...(projectContext.runtimeDefaults?.responderByProtocol ?? {}),
            [draft.responderProvider]: responderRuntimePatch,
          },
        },
      });
      saveProjectContext(nextContext);
    }

    dispatch({ type: "SET_AUTO_MODE", enabled: draft.responderApprovalMode === "auto" });

    setRuntimeEditorOpen(false);
  };

  // Keyboard shortcuts
  useInput((input, key) => {
    if (exitConfirmOpen) {
      if (key.return || input === "\r" || (input === "c" && key.ctrl)) {
        confirmExit();
        return;
      }

      if (key.escape) {
        setExitConfirmOpen(false);
        return;
      }

      return;
    }

    if (closeLaneConfirmOpen) {
      if (key.return || input === "\r") {
        closeActiveLane();
        setCloseLaneConfirmOpen(false);
        return;
      }

      if (key.escape) {
        setCloseLaneConfirmOpen(false);
        return;
      }

      return;
    }

    if (input === "c" && key.ctrl) {
      setExitConfirmOpen(true);
      return;
    }

    if (runtimeEditorOpen && key.escape) {
      setRuntimeEditorOpen(false);
      return;
    }

    // Guard: don't switch sessions during text input
    const inTextInput = activeSession &&
      (activeSession.suggestion.kind === "editing" || activeSession.suggestion.kind === "manual-input");

    if (key.escape && activeSession && inTextInput) {
      dispatch({ type: "CANCEL_TEXT_ENTRY", id: activeSession.id });
      return;
    }

    if (key.escape && !runtimeEditorOpen && !inTextInput && state.sessions.size > 0) {
      setExitConfirmOpen(true);
      return;
    }

    if (inTextInput) {
      return;
    }

    if (runtimeEditorOpen) {
      return;
    }

    const approveSuggestion = async () => {
      if (!activeSession || activeSession.suggestion.kind !== "ready") return;
      const sentText = await service.executeSuggestion(
        activeSession.managed,
        activeSession.suggestion.result,
      );
      dispatch({ type: "SYNC_MANAGED_SESSION", id: activeSession.id, managed: activeSession.managed });
      dispatch({ type: "APPROVE_SUGGESTION", id: activeSession.id, text: sentText });
    };

    const retrySuggestion = async () => {
      if (!activeSession || activeSession.suggestion.kind !== "error") return;
      const id = activeSession.id;
      dispatch({ type: "START_GENERATING", id });
      try {
        const result = await service.generateSuggestion(
          activeSession.managed,
          createPartialDispatcher(dispatch, id),
          (usage) => dispatch({ type: "ADD_SESSION_USAGE", id, usage }),
          () => state.sessions.get(id) ?? activeSession,
        );
        dispatch({ type: "SUGGESTION_READY", id, result });
        if (state.autoMode && service.generator.meetsThreshold(result)) {
          const sentText = await service.executeSuggestion(activeSession.managed, result);
          dispatch({ type: "SYNC_MANAGED_SESSION", id, managed: activeSession.managed });
          dispatch({ type: "AUTO_SENT", id, text: sentText, confidence: result.confidence });
          if (sentText.trim()) {
            setTimeout(() => {
              dispatch({ type: "CLEAR_AUTO_SENT", id });
            }, 2000);
          }
        }
      } catch (err) {
        dispatch({
          type: "SUGGESTION_ERROR",
          id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const textQuestion = async () => {
      if (!activeSession) return;
      if (!activeSession.managed.awaitingInput) {
        dispatch({
          type: "APPEND_TIMELINE_ENTRY",
          id: activeSession.id,
          entry: createSmsEntry("sms-error", activeSession.id, {
            kind: "error",
            text: "Text me is only available while the Guild lane is waiting for your input.",
            source: "sidecar",
          }),
        });
        return;
      }

      const question = deriveSmsQuestion(activeSession);
      if (!question) {
        dispatch({
          type: "APPEND_TIMELINE_ENTRY",
          id: activeSession.id,
          entry: createSmsEntry("sms-error", activeSession.id, {
            kind: "error",
            text: "Roscoe could not find a clear question to text from the latest Guild turn.",
            source: "sidecar",
          }),
        });
        return;
      }

      try {
        const result = await service.notifications.sendQuestion(activeSession.managed, question);
        dispatch({
          type: "APPEND_TIMELINE_ENTRY",
          id: activeSession.id,
          entry: createSmsEntry("sms-question", activeSession.id, {
            kind: result.ok || result.accepted ? "tool-activity" : "error",
            ...(result.ok || result.accepted
              ? {
                provider: "twilio",
                toolName: "sms",
                text: `${result.detail} Ask: ${question}`,
              }
              : {
                text: result.detail,
                source: "sidecar",
              }),
          } as TranscriptEntry),
        });
      } catch (error) {
        dispatch({
          type: "APPEND_TIMELINE_ENTRY",
          id: activeSession.id,
          entry: createSmsEntry("sms-error", activeSession.id, {
            kind: "error",
            text: error instanceof Error ? error.message : "Roscoe could not send the SMS question.",
            source: "sidecar",
          }),
        });
      }
    };

    // Tab / Shift+Tab to cycle sessions
    if (key.tab && !inTextInput) {
      const ids = Array.from(state.sessions.keys());
      if (ids.length > 1 && state.activeSessionId) {
        const currentIdx = ids.indexOf(state.activeSessionId);
        const nextIdx = key.shift
          ? (currentIdx - 1 + ids.length) % ids.length
          : (currentIdx + 1) % ids.length;
        switchSession(ids[nextIdx]);
      }
      return;
    }

    // Direct 1-9 or Alt+1-9 to switch sessions
    if (!inTextInput && (/^[1-9]$/).test(input || "")) {
      const num = parseInt(input, 10);
      const ids = Array.from(state.sessions.keys());
      if (ids[num - 1]) {
        switchSession(ids[num - 1]);
        return;
      }
    }

    if (key.meta) {
      const num = parseInt(input, 10);
      if (num >= 1 && num <= 9) {
        const ids = Array.from(state.sessions.keys());
        if (ids[num - 1]) {
          switchSession(ids[num - 1]);
        }
      }
    }

    if (!activeSession) return;
    const previewState = getPreviewState(activeSession.preview);

    if (!inTextInput) {
      if (input === "b") {
        if (previewState.mode === "queued" || previewState.mode === "ready") {
          dispatch({ type: "CLEAR_PREVIEW_BREAK", id: activeSession.id });
          return;
        }

        const nextPreview = activeSession.managed.awaitingInput
          ? buildReadyPreviewState(activeSession)
          : buildQueuedPreviewState(activeSession);
        if (nextPreview.mode === "ready") {
          dispatch({
            type: "ACTIVATE_PREVIEW_BREAK",
            id: activeSession.id,
            message: nextPreview.message ?? "",
            ...(nextPreview.link ? { link: nextPreview.link } : {}),
          });
        } else {
          dispatch({
            type: "QUEUE_PREVIEW_BREAK",
            id: activeSession.id,
            message: nextPreview.message ?? "",
            ...(nextPreview.link ? { link: nextPreview.link } : {}),
          });
        }
        return;
      }

      if (input === "c" && previewState.mode === "ready") {
        dispatch({ type: "CLEAR_PREVIEW_BREAK", id: activeSession.id });
        dispatch({ type: "START_MANUAL", id: activeSession.id });
        return;
      }

      if (input === "n" || input === "h") {
        dispatch({ type: "SET_SCREEN", screen: "home" });
        return;
      }

      if (input === "c" && previewState.mode !== "ready") {
        setCloseLaneConfirmOpen(true);
        return;
      }

      if (input === "x" && canInterruptActiveTurn) {
        interruptActiveLane(dispatch, service, activeSession);
        return;
      }

      if (input === "u") {
        setRuntimeEditorOpen(true);
        return;
      }

      if (input === "s") {
        setStatusPaneVisible((current) => !current);
        return;
      }

      if (input === "v") {
        dispatch({
          type: "SET_SESSION_VIEW_MODE",
          id: activeSession.id,
          viewMode: activeSession.viewMode === "transcript" ? "raw" : "transcript",
        });
        return;
      }

      if (input === "q" && notificationStatus.phoneNumber && notificationStatus.providerReady) {
        void textQuestion();
        return;
      }

      if (key.upArrow) {
        dispatch({ type: "SCROLL_SESSION_VIEW", id: activeSession.id, delta: 1 });
        return;
      }

      if (key.downArrow) {
        dispatch({ type: "SCROLL_SESSION_VIEW", id: activeSession.id, delta: -1 });
        return;
      }

      if (key.pageUp) {
        dispatch({ type: "SCROLL_SESSION_VIEW", id: activeSession.id, delta: pageDelta });
        return;
      }

      if (key.pageDown) {
        dispatch({ type: "SCROLL_SESSION_VIEW", id: activeSession.id, delta: -pageDelta });
        return;
      }

      if (key.home) {
        dispatch({ type: "SCROLL_SESSION_VIEW", id: activeSession.id, delta: 100000 });
        return;
      }

      if (input === "g") {
        dispatch({ type: "SCROLL_SESSION_VIEW", id: activeSession.id, delta: 100000 });
        return;
      }

      if (input === "G") {
        dispatch({ type: "RETURN_TO_LIVE", id: activeSession.id });
        return;
      }

      if (key.end || input === "l") {
        dispatch({ type: "RETURN_TO_LIVE", id: activeSession.id });
        return;
      }

      const phase = activeSession.suggestion.kind;

      if (input === "m" && (phase === "idle" || phase === "ready" || phase === "error" || phase === "auto-sent")) {
        dispatch({ type: "START_MANUAL", id: activeSession.id });
        return;
      }

      if (phase === "ready") {
        if (input === "a") {
          void approveSuggestion();
          return;
        }

        if (input === "e") {
          dispatch({ type: "START_EDIT", id: activeSession.id });
          return;
        }

        if (input === "r") {
          dispatch({ type: "REJECT_SUGGESTION", id: activeSession.id });
          return;
        }
      }

      if (input === "r" && phase === "error") {
        void retrySuggestion();
        return;
      }
    }

    // p to pause/resume (guard: not during text input)
    if (input === "p" && !key.meta && !key.ctrl) {
      const phase = activeSession.suggestion.kind;
      if (phase !== "editing" && phase !== "manual-input") {
        if (activeSession.status === "paused" || activeSession.status === "blocked" || activeSession.status === "parked") {
          // Resume
          const managed = activeSession.managed;
          managed._paused = false;
          const resumePrompt = getResumePrompt(activeSession);
          if (managed.awaitingInput) {
            service.injectText(managed, resumePrompt);
            dispatch({ type: "SYNC_MANAGED_SESSION", id: activeSession.id, managed });
            dispatch({ type: "RESUME_SESSION", id: activeSession.id });
          } else {
            service.prepareWorkerTurn(managed, resumePrompt);
            dispatch({ type: "SYNC_MANAGED_SESSION", id: activeSession.id, managed });
            managed.monitor.startTurn(resumePrompt);
            dispatch({ type: "RESUME_SESSION", id: activeSession.id });
          }
        } else if (activeSession.status !== "exited") {
          activeSession.managed._paused = true;
          service.cancelGeneration();
          activeSession.managed.monitor.kill();
          dispatch({ type: "PAUSE_SESSION", id: activeSession.id });
        }
      }
    }

  });

  // If all sessions exited
  if (state.sessions.size === 0 && startSpecs && startSpecs.length > 0) {
    return (
      <Box padding={1}>
        <Text color="yellow">All lanes have ended. Press Ctrl+C to exit.</Text>
      </Box>
    );
  }

  const currentProject = activeSession?.projectName ?? "";
  const currentWorktree = activeSession?.worktreeName ?? "main";
  const sessionLabel = activeSession
    ? `${activeSession.projectName}:${activeSession.worktreeName}`
    : undefined;
  const activeLaneSummary = getActiveLaneSummary(activeSession ?? null);
  const selectableProviders = getSelectableProviderIds(
    loadRoscoeSettings(),
    activeSession
      ? [
          detectProtocol(activeSession.managed.profile),
          getResponderProvider(activeProjectContext) ?? detectProtocol(activeSession.managed.profile),
        ]
      : [],
  );

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      {activeSession && statusPaneVisible && (
        <SessionStatusPane
          session={activeSession}
          projectContext={activeProjectContext}
        />
      )}

      {/* Main content: session list + output */}
      <Box flexGrow={1}>
        <SessionList
          sessions={state.sessions}
          activeSessionId={state.activeSessionId}
          width={railWidth}
        />
        <SessionOutput
          session={activeSession ?? null}
          sessionLabel={sessionLabel}
        />
      </Box>

      {/* Suggestion bar */}
      {activeSession && runtimeEditorOpen && !exitConfirmOpen && (
        <RuntimeEditorPanel
          protocol={detectProtocol(activeSession.managed.profile)}
          responderProvider={getResponderProvider(activeProjectContext) ?? detectProtocol(activeSession.managed.profile)}
          allowedProviders={selectableProviders}
          runtime={activeSession.managed.profile.runtime}
          responderRuntime={activeProjectContext?.runtimeDefaults?.responderByProtocol?.[getResponderProvider(activeProjectContext) ?? detectProtocol(activeSession.managed.profile)]}
          workerGovernanceMode={activeProjectContext?.runtimeDefaults?.workerGovernanceMode ?? "roscoe-arbiter"}
          verificationCadence={activeProjectContext?.runtimeDefaults?.verificationCadence ?? "batched"}
          tokenEfficiencyMode={getTokenEfficiencyMode(activeProjectContext)}
          responderApprovalMode={activeProjectContext?.runtimeDefaults?.responderApprovalMode ?? (state.autoMode ? "auto" : "manual")}
          onApply={applyRuntimeEdit}
        />
      )}

      {/* Suggestion bar */}
      {activeSession && !runtimeEditorOpen && !exitConfirmOpen && !closeLaneConfirmOpen && (
        <SuggestionBar
          phase={activeSession.suggestion}
          sessionStatus={activeSession.status}
          sessionSummary={activeLaneSummary}
          preview={activePreview}
          autoMode={state.autoMode}
          autoSendThreshold={service.generator.getConfidenceThreshold()}
          toolActivity={activeSession.currentToolUse}
          toolActivityDetail={activeSession.currentToolDetail ?? null}
          canInterruptActiveTurn={canInterruptActiveTurn}
          onSubmitEdit={(text) => {
            service.injectText(activeSession.managed, text);
            dispatch({ type: "SYNC_MANAGED_SESSION", id: activeSession.id, managed: activeSession.managed });
            dispatch({ type: "SUBMIT_TEXT", id: activeSession.id, text, delivery: "edited" });
          }}
          onSubmitManual={(text) => {
            service.injectText(activeSession.managed, text);
            dispatch({ type: "SYNC_MANAGED_SESSION", id: activeSession.id, managed: activeSession.managed });
            dispatch({ type: "SUBMIT_TEXT", id: activeSession.id, text, delivery: "manual" });
          }}
        />
      )}

      {exitConfirmOpen && (
        <ExitWarningPane
          sessionCount={state.sessions.size}
          hasInFlightWork={hasInFlightWork}
        />
      )}

      {closeLaneConfirmOpen && (
        <CloseLanePane
          laneCount={state.sessions.size}
          hasInFlightWork={Boolean(
            activeSession
            && (
              activeSession.status === "active"
              || activeSession.status === "generating"
              || activeSession.currentToolUse
              || activeSession.suggestion.kind === "generating"
              || !activeSession.managed.awaitingInput
            ),
          )}
        />
      )}

      {/* Status bar */}
      <StatusBar
        projectName={currentProject}
        worktreeName={currentWorktree}
        autoMode={state.autoMode}
        sessionCount={state.sessions.size}
        sessionStatus={activeSession?.status}
        suggestionPhaseKind={activeSession?.suggestion.kind}
        previewMode={activePreview.mode}
        canInterruptActiveTurn={canInterruptActiveTurn}
        viewMode={activeSession?.viewMode ?? "transcript"}
        followLive={activeSession?.followLive ?? true}
        runtimeEditorOpen={runtimeEditorOpen}
        statusPaneVisible={statusPaneVisible}
        exitConfirmOpen={exitConfirmOpen}
        closeLaneConfirmOpen={closeLaneConfirmOpen}
      />
    </Box>
  );
}
