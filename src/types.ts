import { SessionMonitor } from "./session-monitor.js";
import { ConversationTracker } from "./conversation-tracker.js";
import { SuggestionResult } from "./response-generator.js";
import { HeadlessProfile, RuntimeControlSettings } from "./llm-runtime.js";
import { OnboardingMode } from "./config.js";
import type { Message } from "./conversation-tracker.js";

// ── Session Types ──────────────────────────────────────────

export interface ManagedSession {
  id: string;
  monitor: SessionMonitor;
  profile: HeadlessProfile;
  tracker: ConversationTracker;
  awaitingInput: boolean;
  profileName: string;
  projectName: string;
  projectDir: string;
  worktreePath: string;
  worktreeName: string;
  _paused: boolean;
  runtimeOverrides?: RuntimeControlSettings;
  lastResponderPrompt: string | null;
  lastResponderCommand: string | null;
  lastResponderStrategy: string | null;
  lastResponderRuntimeSummary: string | null;
  lastResponderRationale: string | null;
  lastWorkerRuntimeSummary: string | null;
  lastWorkerRuntimeStrategy: string | null;
  lastWorkerRuntimeRationale: string | null;
}

export interface SessionStartOpts {
  profileName: string;
  projectDir: string;
  worktreePath: string;
  worktreeName: string;
  projectName: string;
  runtimeOverrides?: RuntimeControlSettings;
}

export interface RestoredLaneState {
  providerSessionId: string | null;
  trackerHistory: Message[];
  timeline: TranscriptEntry[];
  outputLines: string[];
  summary: string | null;
  currentToolUse: string | null;
}

export interface SessionStartResult {
  managed: ManagedSession;
  restoredState: RestoredLaneState | null;
}

// ── Screen / State Types ───────────────────────────────────

export type Screen = "home" | "session-setup" | "session-view" | "onboarding";

export type SessionStatus = "active" | "waiting" | "idle" | "generating" | "paused" | "exited";
export type SessionViewMode = "transcript" | "raw";
export type LocalResponseDelivery = "approved" | "edited" | "manual" | "auto";

interface TranscriptEntryBase {
  id: string;
  timestamp: number;
}

export interface RemoteTurnEntry extends TranscriptEntryBase {
  kind: "remote-turn";
  provider: string;
  text: string;
  activity?: string | null;
  note?: string | null;
}

export interface LocalSuggestionEntry extends TranscriptEntryBase {
  kind: "local-suggestion";
  text: string;
  confidence: number;
  reasoning: string;
  state: "pending" | "dismissed";
}

export interface LocalSentEntry extends TranscriptEntryBase {
  kind: "local-sent";
  text: string;
  delivery: LocalResponseDelivery;
  confidence?: number;
  reasoning?: string;
}

export interface ToolActivityEntry extends TranscriptEntryBase {
  kind: "tool-activity";
  provider: string;
  toolName: string;
  text: string;
}

export interface ErrorEntry extends TranscriptEntryBase {
  kind: "error";
  text: string;
  source: "sidecar" | "session";
}

export type TranscriptEntry =
  | RemoteTurnEntry
  | LocalSuggestionEntry
  | LocalSentEntry
  | ToolActivityEntry
  | ErrorEntry;

export type SuggestionPhase =
  | { kind: "idle" }
  | { kind: "generating"; partial?: string }
  | { kind: "ready"; result: SuggestionResult }
  | { kind: "editing"; original: string }
  | { kind: "manual-input" }
  | { kind: "error"; message: string }
  | { kind: "auto-sent"; text: string; confidence: number };

export interface SessionState {
  id: string;
  profileName: string;
  projectName: string;
  worktreeName: string;
  status: SessionStatus;
  outputLines: string[];
  suggestion: SuggestionPhase;
  managed: ManagedSession;
  summary: string | null;
  currentToolUse: string | null;
  timeline: TranscriptEntry[];
  viewMode: SessionViewMode;
  scrollOffset: number;
  followLive: boolean;
}

export interface AppState {
  screen: Screen;
  previousScreen: Screen | null;
  sessions: Map<string, SessionState>;
  activeSessionId: string | null;
  autoMode: boolean;
  onboardingRequest: OnboardingRequest | null;
  sessionSetupProjectDir: string | null;
}

export interface OnboardingRequest {
  dir?: string;
  initialProfileName?: string;
  initialRuntimeOverrides?: RuntimeControlSettings;
  mode?: OnboardingMode;
  refineThemes?: string[];
}

// ── Actions ────────────────────────────────────────────────

export type AppAction =
  | { type: "SET_SCREEN"; screen: Screen }
  | { type: "OPEN_SESSION_SETUP"; projectDir?: string | null }
  | { type: "OPEN_ONBOARDING"; request?: OnboardingRequest | null }
  | { type: "GO_BACK" }
  | { type: "ADD_SESSION"; session: SessionState }
  | { type: "REMOVE_SESSION"; id: string }
  | { type: "SET_ACTIVE"; id: string }
  | { type: "UPDATE_SESSION_STATUS"; id: string; status: SessionStatus }
  | { type: "APPEND_OUTPUT"; id: string; lines: string[]; replaceLastLine?: boolean }
  | { type: "SET_OUTPUT"; id: string; lines: string[] }
  | { type: "START_GENERATING"; id: string }
  | { type: "SUGGESTION_READY"; id: string; result: SuggestionResult }
  | { type: "SUGGESTION_ERROR"; id: string; message: string }
  | { type: "APPROVE_SUGGESTION"; id: string }
  | { type: "START_EDIT"; id: string }
  | { type: "REJECT_SUGGESTION"; id: string }
  | { type: "START_MANUAL"; id: string }
  | { type: "SUBMIT_TEXT"; id: string; text: string; delivery: Extract<LocalResponseDelivery, "edited" | "manual"> }
  | { type: "SET_AUTO_MODE"; enabled: boolean }
  | { type: "PAUSE_SESSION"; id: string }
  | { type: "RESUME_SESSION"; id: string }
  | { type: "SET_SUMMARY"; id: string; summary: string }
  | { type: "SET_TOOL_ACTIVITY"; id: string; toolName: string | null }
  | { type: "AUTO_SENT"; id: string; text: string; confidence: number }
  | { type: "CLEAR_AUTO_SENT"; id: string }
  | { type: "UPDATE_PARTIAL"; id: string; partial: string }
  | { type: "APPEND_TIMELINE_ENTRY"; id: string; entry: TranscriptEntry }
  | { type: "SET_LOCAL_SUGGESTION_STATE"; id: string; state: LocalSuggestionEntry["state"] }
  | { type: "COMMIT_LOCAL_RESPONSE"; id: string; delivery: LocalResponseDelivery; text?: string; keepSuggestion?: boolean }
  | { type: "SYNC_MANAGED_SESSION"; id: string; managed: ManagedSession }
  | { type: "SET_SESSION_VIEW_MODE"; id: string; viewMode: SessionViewMode }
  | { type: "SCROLL_SESSION_VIEW"; id: string; delta: number }
  | { type: "RETURN_TO_LIVE"; id: string };

// ── Parsed Session Spec ────────────────────────────────────

export interface ParsedSessionSpec {
  profileName: string;
  projectDir: string | null;
  taskName: string | null;
}
