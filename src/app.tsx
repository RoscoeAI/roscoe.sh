import React, { useReducer, createContext, useContext, useEffect, useMemo } from "react";
import { Box } from "ink";
import { ThemeProvider, defaultTheme, extendTheme } from "@inkjs/ui";
import { SessionManagerService } from "./services/session-manager.js";
import {
  AppState,
  AppAction,
  Screen,
  SessionState,
  TranscriptEntry,
  LocalSuggestionEntry,
  LocalSentEntry,
  SuggestionReturnPhase,
} from "./types.js";
import { LLMProtocol, RuntimeControlSettings, RuntimeUsageSnapshot } from "./llm-runtime.js";
import { HomeScreen } from "./components/home-screen.js";
import { SessionSetup } from "./components/session-setup.js";
import { SessionView } from "./components/session-view.js";
import { OnboardingScreen } from "./components/onboarding-screen.js";
import { BackgroundLanesPane } from "./components/background-lanes-pane.js";
import { useEventBridge } from "./hooks/use-event-bridge.js";
import { useHostedRelayWire } from "./hooks/use-hosted-relay-wire.js";
import { useSmsWire } from "./hooks/use-sms-wire.js";
import { inferRoscoeDecision, normalizeRoscoeDraftMessage } from "./roscoe-draft.js";
import { isParkedDecisionText, sortTranscriptEntries } from "./session-transcript.js";
import { getPreviewState } from "./session-preview.js";
import { loadRoscoeSettings } from "./config.js";
import { setRoscoeKeepAwakeEnabled } from "./keep-awake.js";
import { dbg, enableDebug } from "./debug-log.js";

// ── Reducer ────────────────────────────────────────────────

const MAX_OUTPUT_LINES = 500;
const MAX_TIMELINE_ENTRIES = 300;
let entryCounter = 0;

function createEntryId(prefix: string, session: SessionState): string {
  entryCounter += 1;
  return `${prefix}-${session.id}-${Date.now()}-${entryCounter}`;
}

function appendTimelineEntry(session: SessionState, entry: TranscriptEntry): SessionState {
  return {
    ...session,
    timeline: sortTranscriptEntries([...session.timeline, entry]).slice(-MAX_TIMELINE_ENTRIES),
  };
}

function setPreviewState(
  session: SessionState,
  preview: SessionState["preview"],
  appendNote = false,
): SessionState {
  const nextSession: SessionState = {
    ...session,
    preview: getPreviewState(preview),
  };

  if (!appendNote || !preview || preview.mode === "off" || !preview.message) {
    return nextSession;
  }

  return appendTimelineEntry(nextSession, {
    id: createEntryId(`preview-${preview.mode}`, session),
    kind: "preview",
    timestamp: Date.now(),
    state: preview.mode,
    text: preview.message,
    link: preview.link ?? null,
  });
}

function clearPreviewUnlessQueued(preview: SessionState["preview"]): SessionState["preview"] {
  const current = getPreviewState(preview);
  return current.mode === "queued" ? current : getPreviewState(undefined);
}

function emptyUsage(): RuntimeUsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

function addUsage(current: RuntimeUsageSnapshot | undefined, next: RuntimeUsageSnapshot): RuntimeUsageSnapshot {
  const base = current ?? emptyUsage();
  return {
    inputTokens: base.inputTokens + next.inputTokens,
    outputTokens: base.outputTokens + next.outputTokens,
    cachedInputTokens: base.cachedInputTokens + next.cachedInputTokens,
    cacheCreationInputTokens: base.cacheCreationInputTokens + next.cacheCreationInputTokens,
  };
}

function dropPendingLocalSuggestions(session: SessionState): SessionState {
  const nextTimeline = session.timeline.filter((entry) => !(entry.kind === "local-suggestion" && entry.state === "pending"));
  return nextTimeline.length === session.timeline.length
    ? session
    : { ...session, timeline: nextTimeline };
}

function getReturnSuggestionPhase(session: SessionState): SuggestionReturnPhase {
  const lastSuggestion = [...session.timeline].reverse().find((entry) => entry.kind === "local-suggestion");
  if (!lastSuggestion || lastSuggestion.state === "dismissed") {
    return { kind: "idle" };
  }
  if (inferRoscoeDecision({ message: lastSuggestion.text, reasoning: lastSuggestion.reasoning }) === "noop") {
    return { kind: "idle" };
  }

  return {
    kind: "ready",
    result: {
      decision: lastSuggestion.decision,
      text: normalizeRoscoeDraftMessage(lastSuggestion.text),
      confidence: lastSuggestion.confidence,
      reasoning: lastSuggestion.reasoning,
    },
  };
}

function mapLastLocalSuggestion(
  session: SessionState,
  mapFn: (entry: LocalSuggestionEntry) => LocalSuggestionEntry,
): SessionState {
  const timeline = [...session.timeline];

  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const entry = timeline[i];
    if (entry.kind === "local-suggestion") {
      timeline[i] = mapFn(entry);
      return { ...session, timeline };
    }
  }

  return session;
}

function commitLocalResponse(
  session: SessionState,
  delivery: LocalSentEntry["delivery"],
  text?: string,
  keepSuggestion = false,
): SessionState {
  const timeline = [...session.timeline];

  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const entry = timeline[i];
    if (entry.kind !== "local-suggestion") continue;

    const sentEntry: LocalSentEntry = {
      id: keepSuggestion ? createEntryId(`local-${delivery}`, session) : entry.id,
      kind: "local-sent",
      timestamp: Date.now(),
      text: text ?? entry.text,
      delivery,
      confidence: delivery === "manual" ? undefined : entry.confidence,
      reasoning: delivery === "manual" ? undefined : entry.reasoning,
    };

    if (keepSuggestion) {
      timeline[i] = { ...entry, state: "dismissed" };
      timeline.push(sentEntry);
    } else {
      timeline[i] = sentEntry;
    }

    return {
      ...session,
      timeline: sortTranscriptEntries(timeline).slice(-MAX_TIMELINE_ENTRIES),
      scrollOffset: session.followLive ? 0 : session.scrollOffset,
    };
  }

  if (!text) return session;

  return appendTimelineEntry(session, {
    id: createEntryId("local", session),
    kind: "local-sent",
    timestamp: Date.now(),
    text,
    delivery,
  });
}

function isConversationTurnEntry(entry: TranscriptEntry): boolean {
  return entry.kind === "remote-turn" || entry.kind === "local-suggestion" || entry.kind === "local-sent";
}

export function formatLaneScopeLabel(session: Pick<SessionState, "projectName" | "worktreeName">): string {
  return session.worktreeName === "main"
    ? session.projectName
    : `${session.projectName}/${session.worktreeName}`;
}

export function getRunningLaneTurnSignal(sessions: Map<string, SessionState>): string | null {
  const signals = Array.from(sessions.values())
    .filter((session) => session.status !== "exited")
    .map((session) => {
      const latestTurn = [...session.timeline].reverse().find(isConversationTurnEntry);
      return latestTurn ? `${session.id}:${latestTurn.id}` : null;
    })
    .filter((value): value is string => Boolean(value));

  return signals.length > 0 ? signals.sort().join("|") : null;
}

export function getBackgroundLaneSessions(
  sessions: Map<string, SessionState>,
  activeSessionId: string | null,
): SessionState[] {
  const running = Array.from(sessions.values()).filter((session) => session.status !== "exited");
  if (running.length <= 1) {
    return running;
  }

  if (!activeSessionId) {
    return running;
  }

  const others = running.filter((session) => session.id !== activeSessionId);
  return others.length > 0 ? others : running;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_SCREEN":
      if (state.screen === action.screen) return state;
      return { ...state, previousScreen: state.screen, screen: action.screen };

    case "OPEN_SESSION_SETUP":
      return {
        ...state,
        previousScreen: state.screen,
        screen: "session-setup",
        sessionSetupProjectDir: action.projectDir ?? null,
      };

    case "OPEN_ONBOARDING":
      return {
        ...state,
        previousScreen: state.screen,
        screen: "onboarding",
        onboardingRequest: action.request ?? null,
      };

    case "GO_BACK":
      return {
        ...state,
        screen: state.previousScreen ?? "home",
        previousScreen: null,
      };

    case "ADD_SESSION": {
      const sessions = new Map(state.sessions);
      sessions.set(action.session.id, {
        ...action.session,
        pendingOperatorMessages: action.session.pendingOperatorMessages ?? [],
        contractFingerprint: action.session.contractFingerprint ?? null,
      });
      return {
        ...state,
        sessions,
        activeSessionId: state.activeSessionId ?? action.session.id,
      };
    }

    case "REMOVE_SESSION": {
      const sessions = new Map(state.sessions);
      sessions.delete(action.id);
      let activeSessionId = state.activeSessionId;
      if (activeSessionId === action.id) {
        const ids = Array.from(sessions.keys());
        activeSessionId = ids.length > 0 ? ids[0] : null;
      }
      if (sessions.size === 0 && state.screen === "session-view") {
        return {
          ...state,
          sessions,
          activeSessionId,
          screen: "home",
          previousScreen: null,
          sessionSetupProjectDir: null,
        };
      }
      return { ...state, sessions, activeSessionId };
    }

    case "SET_ACTIVE":
      return { ...state, activeSessionId: action.id };

    case "UPDATE_SESSION_STATUS": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, { ...session, status: action.status });
      return { ...state, sessions };
    }

    case "APPEND_OUTPUT": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      const base = action.replaceLastLine
        ? session.outputLines.slice(0, -1)
        : session.outputLines;
      const outputLines = [...base, ...action.lines].slice(-MAX_OUTPUT_LINES);
      sessions.set(action.id, { ...session, outputLines });
      return { ...state, sessions };
    }

    case "SET_OUTPUT": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, { ...session, outputLines: action.lines.slice(-MAX_OUTPUT_LINES) });
      return { ...state, sessions };
    }

    case "START_GENERATING": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        status: "generating",
        suggestion: { kind: "generating" },
      });
      return { ...state, sessions };
    }

    case "UPDATE_PARTIAL": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      if (session.suggestion.kind !== "generating") return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        suggestion: { kind: "generating", partial: action.partial },
      });
      return { ...state, sessions };
    }

    case "SUGGESTION_READY": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      let nextSession: SessionState = {
        ...dropPendingLocalSuggestions(session),
        status: "review",
        suggestion: { kind: "ready", result: action.result },
        preview: getPreviewState(session.preview),
      };
      nextSession = appendTimelineEntry(nextSession, {
        id: createEntryId("suggestion", session),
        kind: "local-suggestion",
        timestamp: Date.now(),
        decision: action.result.decision,
        text: action.result.text,
        confidence: action.result.confidence,
        reasoning: action.result.reasoning,
        state: "pending",
      });
      sessions.set(action.id, nextSession);
      return { ...state, sessions };
    }

    case "SUGGESTION_ERROR": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      let nextSession: SessionState = {
        ...session,
        status: "review",
        suggestion: { kind: "error", message: action.message },
        preview: getPreviewState(session.preview),
      };
      nextSession = appendTimelineEntry(nextSession, {
        id: createEntryId("error", session),
        kind: "error",
        timestamp: Date.now(),
        text: action.message,
        source: "sidecar",
      });
      sessions.set(action.id, nextSession);
      return { ...state, sessions };
    }

    case "APPROVE_SUGGESTION": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, commitLocalResponse({
        ...session,
        status: "active",
        preview: clearPreviewUnlessQueued(session.preview),
        suggestion: { kind: "idle" },
      }, "approved", action.text));
      return { ...state, sessions };
    }

    case "SUBMIT_TEXT": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, commitLocalResponse({
        ...session,
        status: "active",
        preview: clearPreviewUnlessQueued(session.preview),
        suggestion: { kind: "idle" },
      }, action.delivery, action.text, action.delivery === "manual"));
      return { ...state, sessions };
    }

    case "CLEAR_AUTO_SENT": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      if (session.suggestion.kind !== "auto-sent") return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        suggestion: { kind: "idle" },
      });
      return { ...state, sessions };
    }

    case "START_EDIT": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      if (session.suggestion.kind !== "ready") return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        suggestion: {
          kind: "editing",
          original: session.suggestion.result.text,
          previous: session.suggestion,
        },
      });
      return { ...state, sessions };
    }

    case "REJECT_SUGGESTION": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, mapLastLocalSuggestion({
        ...session,
        status: "waiting",
        suggestion: { kind: "idle" },
      }, (entry) => ({ ...entry, state: "dismissed" })));
      return { ...state, sessions };
    }

    case "START_MANUAL": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      const previous = session.suggestion.kind === "ready" || session.suggestion.kind === "error" || session.suggestion.kind === "idle"
        ? session.suggestion
        : ({ kind: "idle" } as SuggestionReturnPhase);
      const nextSession: SessionState = {
        ...session,
        status: "review",
        suggestion: { kind: "manual-input", previous },
      };
      sessions.set(action.id, nextSession);
      return { ...state, sessions };
    }

    case "CANCEL_TEXT_ENTRY": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      if (session.suggestion.kind !== "editing" && session.suggestion.kind !== "manual-input") return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        suggestion: session.suggestion.previous ?? getReturnSuggestionPhase(session),
      });
      return { ...state, sessions };
    }

    case "SET_AUTO_MODE":
      return { ...state, autoMode: action.enabled, autoModeConfigured: true };

    case "PAUSE_SESSION": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, { ...session, status: "paused" });
      return { ...state, sessions };
    }

    case "BLOCK_SESSION": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, { ...session, status: "blocked" });
      return { ...state, sessions };
    }

    case "RESUME_SESSION": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        status: "active",
        preview: getPreviewState(undefined),
        suggestion: { kind: "idle" },
      });
      return { ...state, sessions };
    }

    case "SET_SUMMARY": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, { ...session, summary: action.summary });
      return { ...state, sessions };
    }

    case "SET_TOOL_ACTIVITY": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        currentToolUse: action.toolName,
        currentToolDetail: action.toolName === null
          ? null
          : action.detail !== undefined
            ? action.detail
            : action.toolName === session.currentToolUse
              ? session.currentToolDetail ?? null
              : null,
      });
      return { ...state, sessions };
    }

    case "ADD_SESSION_USAGE": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        usage: addUsage(session.usage, action.usage),
      });
      return { ...state, sessions };
    }

    case "SET_SESSION_RATE_LIMIT": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        rateLimitStatus: action.rateLimitStatus,
      });
      return { ...state, sessions };
    }

    case "AUTO_SENT": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      const isHold = !action.text.trim() || isParkedDecisionText(action.text);
      const currentPreview = getPreviewState(session.preview);
      sessions.set(action.id, commitLocalResponse({
        ...session,
        status: isHold ? "parked" : "active",
        preview: isHold || currentPreview.mode === "queued"
          ? currentPreview
          : getPreviewState(undefined),
        suggestion: { kind: "auto-sent", text: action.text, confidence: action.confidence },
      }, "auto", action.text));
      return { ...state, sessions };
    }

    case "APPEND_TIMELINE_ENTRY": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, appendTimelineEntry(session, action.entry));
      return { ...state, sessions };
    }

    case "SET_LOCAL_SUGGESTION_STATE": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, mapLastLocalSuggestion(session, (entry) => ({ ...entry, state: action.state })));
      return { ...state, sessions };
    }

    case "COMMIT_LOCAL_RESPONSE": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, commitLocalResponse(session, action.delivery, action.text, action.keepSuggestion));
      return { ...state, sessions };
    }

    case "SYNC_MANAGED_SESSION": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        profileName: action.managed.profileName,
        managed: action.managed,
        preview: getPreviewState(session.preview),
        pendingOperatorMessages: session.pendingOperatorMessages ?? [],
      });
      return { ...state, sessions };
    }

    case "QUEUE_OPERATOR_MESSAGE": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const pending = session.pendingOperatorMessages ?? [];
      if (pending.some((message) => message.id === action.message.id)) {
        return state;
      }
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        pendingOperatorMessages: [...pending, action.message],
      });
      return { ...state, sessions };
    }

    case "SHIFT_OPERATOR_MESSAGE": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const pending = session.pendingOperatorMessages ?? [];
      if (pending.length === 0) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        pendingOperatorMessages: action.messageId
          ? pending.filter((message) => message.id !== action.messageId)
          : pending.slice(1),
      });
      return { ...state, sessions };
    }

    case "SET_SESSION_VIEW_MODE": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, { ...session, viewMode: action.viewMode });
      return { ...state, sessions };
    }

    case "SCROLL_SESSION_VIEW": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      const scrollOffset = Math.max(0, session.scrollOffset + action.delta);
      sessions.set(action.id, {
        ...session,
        scrollOffset,
        followLive: scrollOffset === 0,
      });
      return { ...state, sessions };
    }

    case "RETURN_TO_LIVE": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(action.id, {
        ...session,
        scrollOffset: 0,
        followLive: true,
      });
      return { ...state, sessions };
    }

    case "QUEUE_PREVIEW_BREAK": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const current = getPreviewState(session.preview);
      if (current.mode === "queued" && current.message === action.message && current.link === (action.link ?? null)) {
        return state;
      }
      const sessions = new Map(state.sessions);
      sessions.set(action.id, setPreviewState(session, {
        mode: "queued",
        message: action.message,
        link: action.link ?? null,
      }, true));
      return { ...state, sessions };
    }

    case "ACTIVATE_PREVIEW_BREAK": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      const current = getPreviewState(session.preview);
      if (current.mode === "ready" && current.message === action.message && current.link === (action.link ?? null)) {
        return state;
      }
      const sessions = new Map(state.sessions);
      sessions.set(action.id, setPreviewState(session, {
        mode: "ready",
        message: action.message,
        link: action.link ?? null,
      }, true));
      return { ...state, sessions };
    }

    case "CLEAR_PREVIEW_BREAK": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      if (getPreviewState(session.preview).mode === "off") {
        return state;
      }
      const sessions = new Map(state.sessions);
      sessions.set(action.id, setPreviewState(session, undefined));
      return { ...state, sessions };
    }

    case "INVALIDATE_SESSION_CONTRACT": {
      const session = state.sessions.get(action.id);
      if (!session) return state;
      if (session.contractFingerprint === action.contractFingerprint) {
        return state;
      }

      const sessions = new Map(state.sessions);
      let nextSession: SessionState = {
        ...session,
        contractFingerprint: action.contractFingerprint,
      };

      const shouldClearDraft =
        session.suggestion.kind === "ready"
        || session.suggestion.kind === "error"
        || session.suggestion.kind === "auto-sent"
        || session.status === "review"
        || session.status === "parked";

      if (shouldClearDraft) {
        nextSession = dropPendingLocalSuggestions({
          ...nextSession,
          managed: {
            ...nextSession.managed,
            awaitingInput: true,
          },
          status: session.status === "blocked" ? "blocked" : "waiting",
          suggestion: { kind: "idle" },
        });
      }

      nextSession = appendTimelineEntry(nextSession, {
        id: createEntryId("contract", session),
        kind: "tool-activity",
        timestamp: Date.now(),
        provider: "roscoe",
        toolName: "contract",
        text: action.reason,
      });
      sessions.set(action.id, nextSession);
      return { ...state, sessions };
    }

    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────

interface AppContextValue {
  service: SessionManagerService;
  dispatch: React.Dispatch<AppAction>;
  state: AppState;
}

const AppContext = createContext<AppContextValue>(null!);

export function useAppContext(): AppContextValue {
  return useContext(AppContext);
}

// ── Props ──────────────────────────────────────────────────

export interface AppProps {
  initialScreen?: Screen;
  startSpecs?: string[];
  onboardDir?: string;
  debug?: boolean;
  initialAutoMode?: boolean;
  startRuntimeOverrides?: Partial<Record<LLMProtocol, RuntimeControlSettings>>;
  onboardingProfileName?: string;
  onboardingRuntimeOverrides?: RuntimeControlSettings;
}

// ── App Component ──────────────────────────────────────────

export default function App({
  initialScreen = "home",
  startSpecs,
  onboardDir,
  debug,
  initialAutoMode = false,
  startRuntimeOverrides,
  onboardingProfileName,
  onboardingRuntimeOverrides,
}: AppProps) {
  const [state, dispatch] = useReducer(appReducer, {
    screen: initialScreen,
    previousScreen: null,
    sessions: new Map(),
    activeSessionId: null,
    autoMode: initialAutoMode,
    autoModeConfigured: initialAutoMode,
    onboardingRequest: onboardDir || onboardingProfileName || onboardingRuntimeOverrides
      ? {
          ...(onboardDir ? { dir: onboardDir } : {}),
          ...(onboardingProfileName ? { initialProfileName: onboardingProfileName } : {}),
          ...(onboardingRuntimeOverrides ? { initialRuntimeOverrides: onboardingRuntimeOverrides } : {}),
          mode: "onboard",
        }
      : null,
    sessionSetupProjectDir: null,
  });

  const service = useMemo(() => new SessionManagerService(), []);
  const backgroundLaneSessions = useMemo(
    () => getBackgroundLaneSessions(state.sessions, state.activeSessionId),
    [state.sessions, state.activeSessionId],
  );
  const runningLaneCount = useMemo(
    () => backgroundLaneSessions.length,
    [backgroundLaneSessions],
  );
  const runningLaneNames = useMemo(
    () => backgroundLaneSessions.map((session) => formatLaneScopeLabel(session)),
    [backgroundLaneSessions],
  );
  const runningLaneTurnSignal = useMemo(
    () => getRunningLaneTurnSignal(new Map(backgroundLaneSessions.map((session) => [session.id, session]))),
    [backgroundLaneSessions],
  );
  const showBackgroundLanesPane = state.screen !== "session-view" && runningLaneCount > 0;

  useEventBridge(state.sessions, dispatch, service, state.autoMode);
  useHostedRelayWire(state.sessions, dispatch, service);
  useSmsWire(state.sessions, dispatch, service);

  useEffect(() => {
    if (!debug) return;
    enableDebug();
    dbg("app", `screen=${state.screen} active=${state.activeSessionId ?? "none"}`);
  }, [debug, state.activeSessionId, state.screen]);

  useEffect(() => {
    setRoscoeKeepAwakeEnabled(loadRoscoeSettings().behavior.preventSleepWhileRunning);
  }, []);

  useEffect(() => {
    for (const session of state.sessions.values()) {
      service.persistSessionState(session);
    }
  }, [service, state.sessions]);

  const contextValue = useMemo(
    () => ({ service, dispatch, state }),
    [service, state],
  );

  const theme = useMemo(
    () =>
      extendTheme(defaultTheme, {
        components: {
          Select: {
            styles: {
              focusIndicator: () => ({ color: "cyan" }),
              label: ({ isFocused }: { isFocused: boolean }) => ({
                bold: isFocused,
                color: isFocused ? "cyan" : undefined,
              }),
            },
          },
          Spinner: {
            styles: {
              frame: () => ({ color: "cyan" }),
            },
          },
        },
      }),
    [],
  );

  return (
    <AppContext.Provider value={contextValue}>
      <ThemeProvider theme={theme}>
        <Box flexDirection="column" width="100%">
          {showBackgroundLanesPane && (
            <Box paddingX={1} paddingTop={1} justifyContent="flex-end">
              <BackgroundLanesPane
                laneCount={runningLaneCount}
                laneNames={runningLaneNames}
                turnSignal={runningLaneTurnSignal}
              />
            </Box>
          )}
          {state.screen === "home" && <HomeScreen />}
          {state.screen === "session-setup" && (
            <SessionSetup
              preselectedProjectDir={state.sessionSetupProjectDir ?? undefined}
              openedFromSessionView={state.previousScreen === "session-view"}
            />
          )}
          {state.screen === "session-view" && <SessionView startSpecs={startSpecs} startRuntimeOverrides={startRuntimeOverrides} />}
          {state.screen === "onboarding" && (
            <OnboardingScreen
              dir={state.onboardingRequest?.dir ?? onboardDir}
              debug={debug}
              initialProfileName={state.onboardingRequest?.initialProfileName ?? onboardingProfileName}
              initialRuntimeOverrides={state.onboardingRequest?.initialRuntimeOverrides ?? onboardingRuntimeOverrides}
              initialMode={state.onboardingRequest?.mode ?? "onboard"}
              initialRefineThemes={state.onboardingRequest?.refineThemes ?? []}
            />
          )}
        </Box>
      </ThemeProvider>
    </AppContext.Provider>
  );
}
