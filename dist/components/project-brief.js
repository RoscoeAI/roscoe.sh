import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { Select } from "@inkjs/ui";
import { getProjectContextPath } from "../config.js";
import { Panel, Pill } from "./chrome.js";
import { getLockedProjectProvider, getRuntimeTuningMode } from "../runtime-defaults.js";
function ellipsize(text, max = 180) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= max)
        return clean;
    return `${clean.slice(0, Math.max(40, max - 3)).trimEnd()}...`;
}
function summarizeItems(items, max = 2) {
    if (items.length <= max)
        return items;
    return [...items.slice(0, max), `+${items.length - max} more`];
}
function formatRuntimeSummary(context) {
    const provider = getLockedProjectProvider(context);
    if (!provider)
        return null;
    const runtime = context.runtimeDefaults?.workerByProtocol?.[provider] ?? context.runtimeDefaults?.onboarding?.runtime;
    const model = runtime?.model ?? "default";
    const effort = runtime?.reasoningEffort ?? "default";
    const tuning = getRuntimeTuningMode(runtime) === "auto" ? "auto-manage" : "manual";
    return {
        provider,
        tuning,
        baseline: `${model} / ${effort}`,
    };
}
function BriefSection({ label, items }) {
    if (items.length === 0)
        return null;
    return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { color: "yellow", bold: true, children: label }), summarizeItems(items).map((item, index) => (_jsx(Text, { dimColor: true, children: item }, `${label}-${index}`)))] }));
}
export function ProjectBriefView({ context, history, actionItems, onAction, title = "Project Brief", subtitle = "Saved Roscoe understanding before you launch or refine", }) {
    const runtime = formatRuntimeSummary(context);
    const memoryPath = getProjectContextPath(context.directory);
    const latestHistory = history[0];
    const recentAnswers = (context.interviewAnswers ?? []).slice(-4);
    return (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsxs(Panel, { title: title, subtitle: subtitle, accentColor: "cyan", rightLabel: history.length > 0 ? `${history.length} history run${history.length === 1 ? "" : "s"}` : "legacy memory only", children: [_jsxs(Box, { gap: 1, flexWrap: "wrap", children: [_jsx(Pill, { label: context.name, color: "cyan" }), runtime && _jsx(Pill, { label: `${runtime.provider} locked`, color: "cyan" }), runtime && _jsx(Pill, { label: runtime.tuning, color: runtime.tuning === "auto-manage" ? "green" : "yellow" }), runtime && _jsx(Pill, { label: runtime.baseline, color: "magenta" })] }), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { color: "yellow", bold: true, children: "Project story" }), _jsx(Text, { dimColor: true, children: ellipsize(context.intentBrief?.projectStory || context.notes || context.goals.join(" ")) })] }), _jsx(BriefSection, { label: "Definition of done", items: context.intentBrief?.definitionOfDone ?? [] }), _jsx(BriefSection, { label: "Delivery pillars", items: [
                            ...(context.intentBrief?.deliveryPillars.frontend?.[0] ? [`Frontend: ${context.intentBrief.deliveryPillars.frontend[0]}`] : []),
                            ...(context.intentBrief?.deliveryPillars.backend?.[0] ? [`Backend: ${context.intentBrief.deliveryPillars.backend[0]}`] : []),
                            ...(context.intentBrief?.deliveryPillars.unitComponentTests?.[0] ? [`Unit/component: ${context.intentBrief.deliveryPillars.unitComponentTests[0]}`] : []),
                            ...(context.intentBrief?.deliveryPillars.e2eTests?.[0] ? [`E2E: ${context.intentBrief.deliveryPillars.e2eTests[0]}`] : []),
                        ] }), _jsx(BriefSection, { label: "Coverage mechanism", items: context.intentBrief?.coverageMechanism ?? [] }), _jsx(BriefSection, { label: "Constraints", items: context.intentBrief?.constraints ?? [] }), _jsx(BriefSection, { label: "Autonomy rules", items: context.intentBrief?.autonomyRules ?? [] }), _jsx(BriefSection, { label: "Quality bar", items: context.intentBrief?.qualityBar ?? [] }), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { color: "yellow", bold: true, children: "Interview trail" }), recentAnswers.length === 0 ? (_jsx(Text, { dimColor: true, children: "No saved interview answers." })) : (recentAnswers.map((answer, index) => (_jsxs(Text, { dimColor: true, children: ["Q", (context.interviewAnswers?.length ?? 0) - recentAnswers.length + index + 1, answer.theme ? ` [${answer.theme}]` : "", ": ", ellipsize(answer.answer, 120)] }, `${answer.question}-${index}`)))), (context.interviewAnswers?.length ?? 0) > recentAnswers.length && (_jsxs(Text, { dimColor: true, children: ["+", (context.interviewAnswers?.length ?? 0) - recentAnswers.length, " earlier answers"] }))] }), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsxs(Text, { dimColor: true, children: ["Memory path: ", memoryPath] }), _jsx(Text, { dimColor: true, children: latestHistory
                                    ? `Latest saved history: ${latestHistory.mode} @ ${latestHistory.createdAt.slice(0, 19).replace("T", " ")}`
                                    : "No raw onboarding/refine history has been saved for this project yet." })] })] }), _jsx(Panel, { title: "Actions", subtitle: "Choose what Roscoe should do next", accentColor: "yellow", children: _jsx(Select, { options: actionItems, onChange: onAction }) })] }));
}
