import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useReducer, createContext, useContext, useMemo } from "react";
import { Box } from "ink";
import { ThemeProvider, defaultTheme, extendTheme } from "@inkjs/ui";
import { SessionManagerService } from "./services/session-manager.js";
import { HomeScreen } from "./components/home-screen.js";
import { SessionSetup } from "./components/session-setup.js";
import { SessionView } from "./components/session-view.js";
import { OnboardingScreen } from "./components/onboarding-screen.js";
// ── Reducer ────────────────────────────────────────────────
const MAX_OUTPUT_LINES = 500;
const MAX_TIMELINE_ENTRIES = 300;
let entryCounter = 0;
function createEntryId(prefix, session) {
    entryCounter += 1;
    return `${prefix}-${session.id}-${Date.now()}-${entryCounter}`;
}
function appendTimelineEntry(session, entry) {
    return {
        ...session,
        timeline: [...session.timeline, entry].slice(-MAX_TIMELINE_ENTRIES),
    };
}
function mapLastLocalSuggestion(session, mapFn) {
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
function commitLocalResponse(session, delivery, text, keepSuggestion = false) {
    const timeline = [...session.timeline];
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
        const entry = timeline[i];
        if (entry.kind !== "local-suggestion")
            continue;
        const sentEntry = {
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
        }
        else {
            timeline[i] = sentEntry;
        }
        return {
            ...session,
            timeline: timeline.slice(-MAX_TIMELINE_ENTRIES),
            scrollOffset: session.followLive ? 0 : session.scrollOffset,
        };
    }
    if (!text)
        return session;
    return appendTimelineEntry(session, {
        id: createEntryId("local", session),
        kind: "local-sent",
        timestamp: Date.now(),
        text,
        delivery,
    });
}
export function appReducer(state, action) {
    switch (action.type) {
        case "SET_SCREEN":
            if (state.screen === action.screen)
                return state;
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
            sessions.set(action.session.id, action.session);
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
            return { ...state, sessions, activeSessionId };
        }
        case "SET_ACTIVE":
            return { ...state, activeSessionId: action.id };
        case "UPDATE_SESSION_STATUS": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, { ...session, status: action.status });
            return { ...state, sessions };
        }
        case "APPEND_OUTPUT": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
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
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, { ...session, outputLines: action.lines.slice(-MAX_OUTPUT_LINES) });
            return { ...state, sessions };
        }
        case "START_GENERATING": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
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
            if (!session)
                return state;
            if (session.suggestion.kind !== "generating")
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, {
                ...session,
                suggestion: { kind: "generating", partial: action.partial },
            });
            return { ...state, sessions };
        }
        case "SUGGESTION_READY": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            let nextSession = {
                ...session,
                status: "waiting",
                suggestion: { kind: "ready", result: action.result },
            };
            nextSession = appendTimelineEntry(nextSession, {
                id: createEntryId("suggestion", session),
                kind: "local-suggestion",
                timestamp: Date.now(),
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
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            let nextSession = {
                ...session,
                status: "waiting",
                suggestion: { kind: "error", message: action.message },
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
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, commitLocalResponse({
                ...session,
                status: "active",
                suggestion: { kind: "idle" },
            }, "approved"));
            return { ...state, sessions };
        }
        case "SUBMIT_TEXT": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, commitLocalResponse({
                ...session,
                status: "active",
                suggestion: { kind: "idle" },
            }, action.delivery, action.text, action.delivery === "manual"));
            return { ...state, sessions };
        }
        case "CLEAR_AUTO_SENT": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            if (session.suggestion.kind !== "auto-sent")
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, {
                ...session,
                suggestion: { kind: "idle" },
            });
            return { ...state, sessions };
        }
        case "START_EDIT": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            if (session.suggestion.kind !== "ready")
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, {
                ...session,
                suggestion: { kind: "editing", original: session.suggestion.result.text },
            });
            return { ...state, sessions };
        }
        case "REJECT_SUGGESTION": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, mapLastLocalSuggestion({
                ...session,
                suggestion: { kind: "idle" },
            }, (entry) => ({ ...entry, state: "dismissed" })));
            return { ...state, sessions };
        }
        case "START_MANUAL": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            let nextSession = {
                ...session,
                suggestion: { kind: "manual-input" },
            };
            if (session.suggestion.kind === "ready") {
                nextSession = mapLastLocalSuggestion(nextSession, (entry) => ({ ...entry, state: "dismissed" }));
            }
            sessions.set(action.id, nextSession);
            return { ...state, sessions };
        }
        case "SET_AUTO_MODE":
            return { ...state, autoMode: action.enabled };
        case "PAUSE_SESSION": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, { ...session, status: "paused" });
            return { ...state, sessions };
        }
        case "RESUME_SESSION": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, {
                ...session,
                status: "active",
                suggestion: { kind: "idle" },
            });
            return { ...state, sessions };
        }
        case "SET_SUMMARY": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, { ...session, summary: action.summary });
            return { ...state, sessions };
        }
        case "SET_TOOL_ACTIVITY": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, { ...session, currentToolUse: action.toolName });
            return { ...state, sessions };
        }
        case "AUTO_SENT": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, commitLocalResponse({
                ...session,
                status: "active",
                suggestion: { kind: "auto-sent", text: action.text, confidence: action.confidence },
            }, "auto", action.text));
            return { ...state, sessions };
        }
        case "APPEND_TIMELINE_ENTRY": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, appendTimelineEntry(session, action.entry));
            return { ...state, sessions };
        }
        case "SET_LOCAL_SUGGESTION_STATE": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, mapLastLocalSuggestion(session, (entry) => ({ ...entry, state: action.state })));
            return { ...state, sessions };
        }
        case "COMMIT_LOCAL_RESPONSE": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, commitLocalResponse(session, action.delivery, action.text, action.keepSuggestion));
            return { ...state, sessions };
        }
        case "SYNC_MANAGED_SESSION": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, {
                ...session,
                profileName: action.managed.profileName,
                managed: action.managed,
            });
            return { ...state, sessions };
        }
        case "SET_SESSION_VIEW_MODE": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, { ...session, viewMode: action.viewMode });
            return { ...state, sessions };
        }
        case "SCROLL_SESSION_VIEW": {
            const session = state.sessions.get(action.id);
            if (!session)
                return state;
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
            if (!session)
                return state;
            const sessions = new Map(state.sessions);
            sessions.set(action.id, {
                ...session,
                scrollOffset: 0,
                followLive: true,
            });
            return { ...state, sessions };
        }
        default:
            return state;
    }
}
const AppContext = createContext(null);
export function useAppContext() {
    return useContext(AppContext);
}
// ── App Component ──────────────────────────────────────────
export default function App({ initialScreen = "home", startSpecs, onboardDir, debug, initialAutoMode = false, startRuntimeOverrides, onboardingProfileName, onboardingRuntimeOverrides, }) {
    const [state, dispatch] = useReducer(appReducer, {
        screen: initialScreen,
        previousScreen: null,
        sessions: new Map(),
        activeSessionId: null,
        autoMode: initialAutoMode,
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
    const contextValue = useMemo(() => ({ service, dispatch, state }), [service, state]);
    const theme = useMemo(() => extendTheme(defaultTheme, {
        components: {
            Select: {
                styles: {
                    focusIndicator: () => ({ color: "cyan" }),
                    label: ({ isFocused }) => ({
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
    }), []);
    return (_jsx(AppContext.Provider, { value: contextValue, children: _jsx(ThemeProvider, { theme: theme, children: _jsxs(Box, { flexDirection: "column", width: "100%", children: [state.screen === "home" && _jsx(HomeScreen, {}), state.screen === "session-setup" && _jsx(SessionSetup, { preselectedProjectDir: state.sessionSetupProjectDir ?? undefined }), state.screen === "session-view" && _jsx(SessionView, { startSpecs: startSpecs, startRuntimeOverrides: startRuntimeOverrides }), state.screen === "onboarding" && (_jsx(OnboardingScreen, { dir: state.onboardingRequest?.dir ?? onboardDir, debug: debug, initialProfileName: state.onboardingRequest?.initialProfileName ?? onboardingProfileName, initialRuntimeOverrides: state.onboardingRequest?.initialRuntimeOverrides ?? onboardingRuntimeOverrides, initialMode: state.onboardingRequest?.mode ?? "onboard", initialRefineThemes: state.onboardingRequest?.refineThemes ?? [] }))] }) }) }));
}
