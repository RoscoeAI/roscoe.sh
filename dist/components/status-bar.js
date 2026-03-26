import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { KeyHints, Pill } from "./chrome.js";
export function StatusBar({ projectName, worktreeName, autoMode, sessionCount, viewMode, followLive, runtimeEditorOpen = false, }) {
    const label = projectName ? `${projectName}:${worktreeName}` : "";
    return (_jsxs(Box, { paddingX: 1, justifyContent: "space-between", gap: 2, children: [_jsxs(Box, { gap: 1, flexWrap: "wrap", children: [label && _jsx(Text, { bold: true, color: "cyan", children: label }), _jsx(Pill, { label: autoMode ? "AUTO" : "MANUAL", color: autoMode ? "green" : "gray" }), _jsx(Pill, { label: viewMode, color: viewMode === "transcript" ? "cyan" : "gray" }), _jsx(Pill, { label: followLive ? "LIVE" : "SCROLLED", color: followLive ? "green" : "yellow" }), _jsxs(Text, { dimColor: true, children: [sessionCount, " session", sessionCount !== 1 ? "s" : ""] })] }), _jsx(KeyHints, { items: [
                    { keyLabel: "Tab", description: "switch" },
                    { keyLabel: "m", description: "manual" },
                    { keyLabel: "q", description: "text question" },
                    { keyLabel: "u", description: runtimeEditorOpen ? "close runtime" : "runtime" },
                    { keyLabel: "v", description: "toggle view" },
                    { keyLabel: "↑ ↓", description: "scroll" },
                    { keyLabel: "End/l", description: "live" },
                    { keyLabel: "p", description: "pause" },
                    { keyLabel: "Ctrl+C", description: "exit" },
                ] })] }));
}
