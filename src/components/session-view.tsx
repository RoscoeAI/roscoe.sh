import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { useAppContext } from "../app.js";
import { useEventBridge, createPartialDispatcher } from "../hooks/use-event-bridge.js";
import { useSessions } from "../hooks/use-sessions.js";
import { useTerminalSize } from "../hooks/use-terminal-size.js";
import { SessionList } from "./session-list.js";
import { SessionOutput } from "./session-output.js";
import { SuggestionBar } from "./suggestion-bar.js";
import { StatusBar } from "./status-bar.js";
import { parseSessionSpec } from "../services/session-manager.js";
import { WorktreeManager } from "../worktree-manager.js";
import { basename } from "path";
import { detectProtocol, RuntimeControlSettings } from "../llm-runtime.js";
import { loadProfile, loadProjectContext, normalizeProjectContext, saveProjectContext } from "../config.js";
import { mergeRuntimeSettings } from "../runtime-defaults.js";
import { RuntimeEditorPanel } from "./runtime-controls.js";
import { TranscriptEntry } from "../types.js";

let smsEntryCounter = 0;

function createSmsEntry(
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

function deriveSmsQuestion(session: SessionStateLike): string | null {
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

interface SessionViewProps {
  startSpecs?: string[];
  startRuntimeOverrides?: Partial<Record<"claude" | "codex", RuntimeControlSettings>>;
}

export function SessionView({ startSpecs, startRuntimeOverrides }: SessionViewProps) {
  const { state, dispatch, service } = useAppContext();
  const { exit } = useApp();
  const { startSession, switchSession } = useSessions(dispatch, service);
  const { columns, rows } = useTerminalSize();
  const [runtimeEditorOpen, setRuntimeEditorOpen] = useState(false);
  const sessionsRef = useRef(state.sessions);

  useEffect(() => {
    sessionsRef.current = state.sessions;
  }, [state.sessions]);

  useEffect(() => {
    for (const session of state.sessions.values()) {
      service.persistSessionState(session);
    }
  }, [service, state.sessions]);

  // Wire up event bridge
  useEventBridge(state.sessions, dispatch, service, state.autoMode);

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
    const interval = setInterval(() => {
      if (!service.notifications.hasPendingQuestions()) {
        return;
      }
      void service.notifications.readIncomingReplies()
        .then((replies) => {
          for (const reply of replies) {
            const targetId = reply.matchedSessionId;
            if (!targetId) continue;
            const session = sessionsRef.current.get(targetId);
            if (!session) continue;

            dispatch({
              type: "APPEND_TIMELINE_ENTRY",
              id: targetId,
              entry: createSmsEntry("sms-reply", targetId, {
                kind: "tool-activity",
                provider: "twilio",
                toolName: "sms",
                text: `SMS reply${reply.token ? ` ${reply.token}` : ""}: ${reply.answerText}`,
              }),
            });

            if (!session.managed.awaitingInput) {
              dispatch({
                type: "APPEND_TIMELINE_ENTRY",
                id: targetId,
                entry: createSmsEntry("sms-hold", targetId, {
                  kind: "tool-activity",
                  provider: "twilio",
                  toolName: "sms",
                  text: "Roscoe received the SMS reply, but the Guild lane was still busy, so it was not injected automatically.",
                }),
              });
              continue;
            }

            service.injectText(session.managed, reply.answerText);
            dispatch({ type: "SYNC_MANAGED_SESSION", id: targetId, managed: session.managed });
            dispatch({ type: "SUBMIT_TEXT", id: targetId, text: reply.answerText, delivery: "manual" });
          }
        })
        .catch(() => {
          // Best-effort inbox polling; don't interrupt the session view.
        });
    }, 5000);

    return () => clearInterval(interval);
  }, [dispatch, service]);

  const activeSession = state.activeSessionId
    ? state.sessions.get(state.activeSessionId)
    : null;
  const railWidth = columns >= 180 ? 54 : columns >= 150 ? 48 : columns >= 125 ? 42 : columns >= 100 ? 36 : 30;
  const pageDelta = Math.max(6, Math.floor(rows * 0.35));

  const applyRuntimeEdit = (draft: { tuningMode: "manual" | "auto"; model: string; reasoningEffort: string }) => {
    if (!activeSession) return;

    const protocol = detectProtocol(activeSession.managed.profile);
    const runtimePatch: RuntimeControlSettings = {
      tuningMode: draft.tuningMode,
      model: draft.model,
      reasoningEffort: draft.reasoningEffort,
    };

    for (const session of state.sessions.values()) {
      if (session.managed.projectDir !== activeSession.managed.projectDir) continue;
      if (detectProtocol(session.managed.profile) !== protocol) continue;

      service.updateManagedRuntime(session.managed, runtimePatch);
      if (draft.tuningMode === "auto") {
        service.prepareWorkerTurn(session.managed);
      }
      dispatch({ type: "SYNC_MANAGED_SESSION", id: session.id, managed: session.managed });
    }

    const projectContext = loadProjectContext(activeSession.managed.projectDir);
    if (projectContext) {
      const nextContext = normalizeProjectContext({
        ...projectContext,
        runtimeDefaults: {
          ...(projectContext.runtimeDefaults ?? {}),
          lockedProvider: protocol,
          workerByProtocol: {
            ...(projectContext.runtimeDefaults?.workerByProtocol ?? {}),
            [protocol]: mergeRuntimeSettings(
              projectContext.runtimeDefaults?.workerByProtocol?.[protocol],
              runtimePatch,
            ),
          },
        },
      });
      saveProjectContext(nextContext);
    }

    setRuntimeEditorOpen(false);
  };

  // Keyboard shortcuts
  useInput((input, key) => {
    if (runtimeEditorOpen && key.escape) {
      setRuntimeEditorOpen(false);
      return;
    }

    // Guard: don't switch sessions during text input
    const inTextInput = activeSession &&
      (activeSession.suggestion.kind === "editing" || activeSession.suggestion.kind === "manual-input");

    if (runtimeEditorOpen) {
      return;
    }

    const approveSuggestion = async () => {
      if (!activeSession || activeSession.suggestion.kind !== "ready") return;
      await service.executeSuggestion(
        activeSession.managed,
        activeSession.suggestion.result,
      );
      dispatch({ type: "SYNC_MANAGED_SESSION", id: activeSession.id, managed: activeSession.managed });
      dispatch({ type: "APPROVE_SUGGESTION", id: activeSession.id });
    };

    const retrySuggestion = async () => {
      if (!activeSession || activeSession.suggestion.kind !== "error") return;
      const id = activeSession.id;
      dispatch({ type: "START_GENERATING", id });
      try {
        const result = await service.generateSuggestion(activeSession.managed, createPartialDispatcher(dispatch, id));
        dispatch({ type: "SUGGESTION_READY", id, result });
        if (state.autoMode && service.generator.meetsThreshold(result)) {
          await service.executeSuggestion(activeSession.managed, result);
          dispatch({ type: "SYNC_MANAGED_SESSION", id, managed: activeSession.managed });
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
    };

    const textQuestion = async () => {
      if (!activeSession) return;
      if (!activeSession.managed.awaitingInput) {
        dispatch({
          type: "APPEND_TIMELINE_ENTRY",
          id: activeSession.id,
          entry: createSmsEntry("sms-error", activeSession.id, {
            kind: "error",
            text: "Roscoe can only text a question while the Guild lane is waiting for input.",
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

    if (!inTextInput) {
      if (input === "u") {
        setRuntimeEditorOpen(true);
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

      if (input === "q") {
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

      if (key.end || input === "l") {
        dispatch({ type: "RETURN_TO_LIVE", id: activeSession.id });
        return;
      }

      const phase = activeSession.suggestion.kind;

      if (input === "m" && (phase === "idle" || phase === "ready" || phase === "error")) {
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
        if (activeSession.status === "paused") {
          // Resume
          const managed = activeSession.managed;
          managed._paused = false;
          if (managed.awaitingInput) {
            dispatch({ type: "RESUME_SESSION", id: activeSession.id });
            dispatch({ type: "START_MANUAL", id: activeSession.id });
          } else {
            service.prepareWorkerTurn(managed, "Continue your work from where you left off.");
            dispatch({ type: "SYNC_MANAGED_SESSION", id: activeSession.id, managed });
            managed.monitor.startTurn("Continue your work from where you left off.");
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

    // Ctrl+C to exit
    if (input === "c" && key.ctrl) {
      // Kill all sessions
      for (const session of state.sessions.values()) {
        session.managed.monitor.kill();
      }
      exit();
    }
  });

  // If all sessions exited
  if (state.sessions.size === 0 && startSpecs && startSpecs.length > 0) {
    return (
      <Box padding={1}>
        <Text color="yellow">All sessions have ended. Press Ctrl+C to exit.</Text>
      </Box>
    );
  }

  const currentProject = activeSession?.projectName ?? "";
  const currentWorktree = activeSession?.worktreeName ?? "main";
  const sessionLabel = activeSession
    ? `${activeSession.projectName}:${activeSession.worktreeName}`
    : undefined;

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
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
      {activeSession && runtimeEditorOpen && (
        <RuntimeEditorPanel
          protocol={detectProtocol(activeSession.managed.profile)}
          runtime={activeSession.managed.profile.runtime}
          scopeLabel="Changes apply to every Guild lane on this project/provider and take effect on the next turn."
          onApply={applyRuntimeEdit}
        />
      )}

      {/* Suggestion bar */}
      {activeSession && (
        <SuggestionBar
          phase={activeSession.suggestion}
          toolActivity={activeSession.currentToolUse}
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

      {/* Status bar */}
      <StatusBar
        projectName={currentProject}
        worktreeName={currentWorktree}
        autoMode={state.autoMode}
        sessionCount={state.sessions.size}
        viewMode={activeSession?.viewMode ?? "transcript"}
        followLive={activeSession?.followLive ?? true}
        runtimeEditorOpen={runtimeEditorOpen}
      />
    </Box>
  );
}
