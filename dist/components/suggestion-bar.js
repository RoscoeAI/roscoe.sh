import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useMemo } from "react";
import { Box, Text } from "ink";
import { TextInput, Spinner, Badge } from "@inkjs/ui";
import { renderMd } from "../render-md.js";
import { KeyHints, Panel, Pill } from "./chrome.js";
function confidenceColor(confidence) {
    if (confidence >= 80)
        return "green";
    if (confidence >= 60)
        return "yellow";
    return "red";
}
function GeneratingView({ partial }) {
    const rendered = useMemo(() => {
        if (!partial)
            return "";
        // Show the tail of partial text, rendered as markdown
        const tail = partial.length > 500 ? partial.slice(-500) : partial;
        return renderMd(tail);
    }, [partial]);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Spinner, { label: "Thinking..." }), rendered && (_jsxs(Box, { marginTop: 0, paddingLeft: 1, flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "Draft in progress" }), _jsx(Text, { dimColor: true, children: rendered })] }))] }));
}
export function SuggestionBar({ phase, toolActivity, onSubmitEdit, onSubmitManual, }) {
    const [editResetKey, setEditResetKey] = useState(0);
    const [manualResetKey, setManualResetKey] = useState(0);
    return (_jsxs(Panel, { title: "Command Deck", subtitle: "Approve, reshape, or override the next message", rightLabel: toolActivity ? `tool ${toolActivity}` : phase.kind, accentColor: phase.kind === "ready" ? "yellow" : "gray", children: [phase.kind === "idle" && (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsx(Box, { gap: 1, children: toolActivity ? (_jsxs(_Fragment, { children: [_jsx(Spinner, { label: "" }), _jsx(Text, { color: "cyan", children: toolActivity })] })) : (_jsx(Text, { dimColor: true, children: "Session working..." })) }), _jsx(KeyHints, { items: [{ keyLabel: "m", description: "type a message" }] })] })), phase.kind === "generating" && (_jsx(GeneratingView, { partial: phase.partial })), phase.kind === "ready" && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "Recommended reply" }), _jsx(Text, { bold: true, children: phase.result.text }), _jsxs(Box, { gap: 1, marginTop: 1, children: [_jsxs(Badge, { color: confidenceColor(phase.result.confidence), children: [phase.result.confidence, "/100"] }), _jsx(Pill, { label: phase.result.confidence >= 80 ? "high confidence" : "review", color: confidenceColor(phase.result.confidence) }), phase.result.reasoning && (_jsxs(Text, { dimColor: true, children: ["Why: ", phase.result.reasoning] }))] }), _jsx(Box, { marginTop: 1, children: _jsx(KeyHints, { items: [
                                { keyLabel: "a", description: "approve" },
                                { keyLabel: "e", description: "edit" },
                                { keyLabel: "r", description: "reject" },
                                { keyLabel: "m", description: "manual" },
                            ] }) })] })), phase.kind === "editing" && (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { dimColor: true, children: ["Original: ", phase.original] }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: "yellow", children: "Edit: " }), _jsx(TextInput, { defaultValue: phase.original, onSubmit: (val) => {
                                    onSubmitEdit(val || phase.original);
                                    setEditResetKey((k) => k + 1);
                                } }, editResetKey)] })] })), phase.kind === "manual-input" && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "Manual override" }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: "yellow", children: "Your message: " }), _jsx(TextInput, { placeholder: "Type your message...", onSubmit: (val) => {
                                    if (val.trim()) {
                                        onSubmitManual(val.trim());
                                        setManualResetKey((k) => k + 1);
                                    }
                                } }, manualResetKey)] })] })), phase.kind === "error" && (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: "red", children: ["Error: ", phase.message.length > 100 ? phase.message.slice(0, 100) + "..." : phase.message] }), _jsx(Box, { marginTop: 1, children: _jsx(KeyHints, { items: [
                                { keyLabel: "r", description: "retry" },
                                { keyLabel: "m", description: "manual" },
                            ] }) })] })), phase.kind === "auto-sent" && (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: "green", children: ["Auto-sent (", phase.confidence, "/100):"] }), _jsx(Text, { dimColor: true, children: phase.text.length > 60 ? `"${phase.text.slice(0, 60)}..."` : `"${phase.text}"` })] }))] }));
}
