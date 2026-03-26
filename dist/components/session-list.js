import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { Panel, Pill } from "./chrome.js";
import { summarizeRuntime } from "../llm-runtime.js";
import { wrapBlock } from "../text-layout.js";
import { getRuntimeTuningMode } from "../runtime-defaults.js";
const statusIndicator = {
    active: { char: "●", color: "green" },
    idle: { char: "●", color: "gray" },
    waiting: { char: "◆", color: "yellow" },
    generating: { char: "⟳", color: "cyan" },
    paused: { char: "‖", color: "gray" },
    exited: { char: "✕", color: "red" },
};
function formatWorktreeLabel(name) {
    return name === "main" ? "main repo" : `worktree - ${name}`;
}
function compactRuntimeSummary(session, width) {
    const runtime = session.managed.profile?.runtime;
    const protocol = session.managed.profile?.protocol ?? session.profileName;
    const model = runtime?.model ?? protocol;
    const effort = runtime?.reasoningEffort;
    const mode = runtime?.executionMode === "accelerated"
        ? "accelerated"
        : runtime?.sandboxMode === "danger-full-access" || runtime?.dangerouslySkipPermissions
            ? "accelerated"
            : "safe";
    const tuning = getRuntimeTuningMode(runtime) === "manual" ? "manual" : "auto";
    if (width < 28) {
        return `${model}${effort ? `/${effort}` : ""} · ${tuning}`;
    }
    if (width < 34) {
        return `${model}${effort ? `/${effort}` : ""} · ${tuning} · ${mode}`;
    }
    return session.managed.profile
        ? `${summarizeRuntime(session.managed.profile)} · ${tuning}`
        : `${model}${effort ? `/${effort}` : ""} · ${tuning} · ${mode}`;
}
export function SessionList({ sessions, activeSessionId, width = 36 }) {
    const entries = Array.from(sessions.values());
    const contentWidth = Math.max(20, width - 6);
    return (_jsxs(Panel, { title: "Session Stack", subtitle: "Shift focus with Tab or Alt+1..9", rightLabel: `${entries.length} live`, accentColor: "cyan", width: width, children: [entries.length === 0 && (_jsx(Text, { dimColor: true, italic: true, children: "No sessions" })), entries.map((session, idx) => {
                const isActive = session.id === activeSessionId;
                const indicator = statusIndicator[session.status];
                const prefix = isActive ? "▸" : " ";
                const transcriptCount = session.timeline.filter((entry) => entry.kind === "remote-turn" || entry.kind === "local-sent").length;
                const runtimeSummary = compactRuntimeSummary(session, contentWidth);
                const worktreeLines = wrapBlock(`[${formatWorktreeLabel(session.worktreeName)}] ${session.profileName}`, contentWidth).slice(0, 2);
                const runtimeLines = wrapBlock(`${runtimeSummary} · ${transcriptCount} turns${session.currentToolUse ? ` · ${session.currentToolUse}` : ""}`, contentWidth).slice(0, 1);
                const summaryLines = contentWidth >= 34 && session.summary
                    ? wrapBlock(session.summary, contentWidth).slice(0, 1)
                    : [];
                return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { gap: 1, flexWrap: "wrap", children: [_jsx(Text, { color: isActive ? "cyan" : "gray", bold: isActive, children: prefix }), _jsx(Text, { dimColor: true, children: idx + 1 }), _jsx(Text, { color: indicator.color, children: indicator.char }), _jsx(Text, { bold: isActive, color: isActive ? "white" : undefined, children: session.projectName }), _jsx(Pill, { label: session.status, color: indicator.color }), isActive && _jsx(Pill, { label: session.viewMode, color: session.viewMode === "transcript" ? "cyan" : "gray" })] }), _jsxs(Box, { paddingLeft: 2, flexDirection: "column", children: [worktreeLines.map((line, lineIndex) => (_jsx(Text, { dimColor: true, children: line }, `${session.id}-worktree-${lineIndex}`))), runtimeLines.map((line, lineIndex) => (_jsx(Text, { dimColor: true, children: line }, `${session.id}-runtime-${lineIndex}`))), summaryLines.map((line, lineIndex) => (_jsx(Text, { color: "yellow", children: line }, `${session.id}-summary-${lineIndex}`)))] })] }, session.id));
            })] }));
}
