import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Box, Text } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import { getRuntimeTuningMode, getTopModel } from "../runtime-defaults.js";
import { KeyHints, Panel, Pill } from "./chrome.js";
export function getReasoningOptions(protocol) {
    return protocol === "claude"
        ? ["low", "medium", "high", "max"]
        : ["low", "medium", "high", "xhigh"];
}
export function createRuntimeEditorDraft(protocol, runtime) {
    return {
        tuningMode: getRuntimeTuningMode(runtime),
        model: runtime?.model ?? getTopModel(protocol),
        reasoningEffort: runtime?.reasoningEffort ?? getReasoningOptions(protocol)[getReasoningOptions(protocol).length - 1],
    };
}
export function RuntimeSummaryPills({ protocol, runtime, }) {
    const tuningMode = getRuntimeTuningMode(runtime);
    const executionMode = runtime?.executionMode === "accelerated" ? "accelerated" : "safe";
    const model = runtime?.model ?? getTopModel(protocol);
    const effort = runtime?.reasoningEffort ?? getReasoningOptions(protocol)[getReasoningOptions(protocol).length - 1];
    return (_jsxs(Box, { gap: 1, flexWrap: "wrap", children: [_jsx(Pill, { label: `${protocol} locked`, color: "cyan" }), _jsx(Pill, { label: tuningMode === "auto" ? "auto-manage" : "manual", color: tuningMode === "auto" ? "green" : "yellow" }), _jsx(Pill, { label: model, color: "yellow" }), _jsx(Pill, { label: effort, color: "magenta" }), _jsx(Pill, { label: executionMode, color: executionMode === "accelerated" ? "red" : "green" })] }));
}
export function RuntimeEditorPanel({ protocol, runtime, scopeLabel, onApply, accentColor = "cyan", }) {
    const initialDraft = createRuntimeEditorDraft(protocol, runtime);
    const [draft, setDraft] = useState(initialDraft);
    const [step, setStep] = useState("mode");
    const [modelInputKey, setModelInputKey] = useState(0);
    const modeOptions = [
        { label: "Auto-manage model and reasoning inside this provider", value: "auto" },
        { label: "Manual pin on the chosen model and reasoning effort", value: "manual" },
    ];
    const effortOptions = getReasoningOptions(protocol).map((value) => ({ label: value, value }));
    return (_jsxs(Panel, { title: "Runtime Controls", subtitle: `Provider stays on ${protocol}. ${scopeLabel}`, accentColor: accentColor, rightLabel: `Step ${step === "mode" ? 1 : step === "model" ? 2 : 3}/3`, children: [_jsx(RuntimeSummaryPills, { protocol: protocol, runtime: draft }), _jsx(Box, { marginTop: 1, children: _jsx(KeyHints, { items: [{ keyLabel: "Enter", description: "confirm" }, { keyLabel: "Esc", description: "cancel" }] }) }), step === "mode" && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { color: "yellow", bold: true, children: "Runtime management:" }), _jsx(Select, { options: modeOptions, onChange: (value) => {
                            setDraft((current) => ({ ...current, tuningMode: value }));
                            setStep("model");
                            setModelInputKey((current) => current + 1);
                        } })] })), step === "model" && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { color: "yellow", bold: true, children: "Model:" }), _jsxs(Box, { children: [_jsx(Text, { color: "yellow", children: "Model: " }), _jsx(TextInput, { defaultValue: draft.model, onSubmit: (value) => {
                                    setDraft((current) => ({
                                        ...current,
                                        model: value.trim() || current.model || getTopModel(protocol),
                                    }));
                                    setStep("effort");
                                } }, modelInputKey)] })] })), step === "effort" && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { color: "yellow", bold: true, children: "Reasoning effort:" }), _jsx(Select, { options: effortOptions, onChange: (value) => {
                            const nextDraft = { ...draft, reasoningEffort: value };
                            setDraft(nextDraft);
                            onApply(nextDraft);
                        } })] })), _jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: draft.tuningMode === "auto"
                        ? "Roscoe may retune effort and step back up to the top in-provider model when the work gets heavier."
                        : "Roscoe will hold this provider, model, and reasoning effort steady until you change them again." }) }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: scopeLabel }) }), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { dimColor: true, children: [_jsx(Text, { color: "cyan", children: "Esc" }), " returns without changing the runtime."] }) })] }));
}
