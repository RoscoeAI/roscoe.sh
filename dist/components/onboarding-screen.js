import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput, StatusMessage, Select } from "@inkjs/ui";
import { renderMd } from "../render-md.js";
import { useOnboarding, SKIP_OPTION } from "../hooks/use-onboarding.js";
import { useAppContext } from "../app.js";
import { resolve, dirname, basename } from "path";
import { homedir } from "os";
import { readdirSync } from "fs";
import { KeyHints, Panel, Pill } from "./chrome.js";
import { listProfiles, loadProfile, loadProjectContext } from "../config.js";
import { detectProtocol } from "../llm-runtime.js";
import { applyRuntimeSettings, getAcceleratedWorkerRuntime, getDefaultOnboardingRuntime, getDefaultWorkerRuntime, getLockedProjectProvider, getTopModel, mergeRuntimeSettings, recommendOnboardingRuntime, } from "../runtime-defaults.js";
import { RuntimeEditorPanel, RuntimeSummaryPills, getReasoningOptions, } from "./runtime-controls.js";
import { ChecklistSelect } from "./checklist-select.js";
const REFINE_THEME_OPTIONS = [
    "project-story",
    "primary-users",
    "definition-of-done",
    "acceptance-checks",
    "delivery-pillars",
    "coverage-mechanism",
    "non-goals",
    "constraints",
    "autonomy-rules",
    "quality-bar",
    "risk-boundaries",
    "ui-direction",
];
const HEARTBEAT_FRAMES = ["·", "•", "∙", "•"];
function getSetupOrder(mode, hasPresetDirectory) {
    if (mode === "refine") {
        return hasPresetDirectory
            ? ["themes", "model", "effort", "tuning", "execution"]
            : ["directory", "themes", "model", "effort", "tuning", "execution"];
    }
    return hasPresetDirectory
        ? ["profile", "model", "effort", "tuning", "execution"]
        : ["directory", "profile", "model", "effort", "tuning", "execution"];
}
export function getPreviousOnboardingStep(step, hasPresetDirectory, mode = "onboard") {
    const order = getSetupOrder(mode, hasPresetDirectory);
    const index = order.indexOf(step);
    if (index <= 0)
        return "back";
    return order[index - 1];
}
function expandTilde(p) {
    if (p === "~")
        return homedir();
    if (p.startsWith("~/"))
        return resolve(homedir(), p.slice(2));
    return p;
}
/** List subdirectories matching the current input for autocomplete */
function getDirSuggestions(input) {
    if (!input)
        return [];
    try {
        const expanded = expandTilde(input);
        let parent;
        let prefix;
        if (input.endsWith("/")) {
            parent = expanded;
            prefix = "";
        }
        else {
            parent = dirname(expanded);
            prefix = basename(expanded).toLowerCase();
        }
        const entries = readdirSync(parent, { withFileTypes: true });
        const dirs = entries
            .filter((e) => e.isDirectory() && !e.name.startsWith("."))
            .filter((e) => !prefix || e.name.toLowerCase().startsWith(prefix))
            .slice(0, 10)
            .map((e) => {
            if (input.startsWith("~/")) {
                const rel = resolve(parent, e.name).slice(homedir().length);
                return "~" + rel + "/";
            }
            return resolve(parent, e.name) + "/";
        });
        return dirs;
    }
    catch {
        return [];
    }
}
/** Directory input with tab-completion */
function DirInput({ onSubmit }) {
    const [value, setValue] = useState("");
    const [inputKey, setInputKey] = useState(0);
    const suggestions = useMemo(() => getDirSuggestions(value), [value]);
    const currentSuggestion = suggestions.find((s) => s.startsWith(value));
    useInput((_input, key) => {
        if (key.tab && currentSuggestion) {
            setValue(currentSuggestion);
            setInputKey((k) => k + 1);
        }
    });
    return (_jsx(TextInput, { defaultValue: value, placeholder: "~/path/to/project", suggestions: suggestions, onChange: setValue, onSubmit: onSubmit }, inputKey));
}
function CompletedQA({ qa, index }) {
    return (_jsx(Box, { children: _jsxs(Text, { dimColor: true, children: [_jsxs(Text, { bold: true, children: ["Q", index + 1, ":"] }), " ", qa.theme ? `[${qa.theme}] ` : "", qa.question, " ", _jsx(Text, { color: "cyan", children: qa.answer })] }) }));
}
/** Build Select options: Claude's options + permanent "Other" and "Skip" */
function buildOptions(questionOptions) {
    // Dedupe: remove any "Other" variant Claude already included
    const filtered = questionOptions.filter((o) => !o.toLowerCase().startsWith("other") && !o.toLowerCase().startsWith("skip"));
    return [
        ...filtered.map((o) => ({ label: o, value: o })),
        { label: "Other (I'll explain)", value: "Other (I'll explain)" },
        { label: SKIP_OPTION, value: SKIP_OPTION },
    ];
}
export function OnboardingScreen({ dir, debug, initialProfileName, initialRuntimeOverrides, initialMode = "onboard", initialRefineThemes = [], }) {
    const { dispatch } = useAppContext();
    const { state: s, start, sendInput, updateRuntime } = useOnboarding();
    const profiles = listProfiles();
    const resolvedDir = dir ? resolve(expandTilde(dir)) : "";
    const savedProjectContext = resolvedDir ? loadProjectContext(resolvedDir) : null;
    const lockedProvider = getLockedProjectProvider(savedProjectContext);
    const defaultProfileName = profiles.includes("claude-code")
        ? "claude-code"
        : profiles.includes("codex")
            ? "codex"
            : profiles[0] ?? "claude-code";
    const initialSelectedProfileName = initialProfileName
        ?? savedProjectContext?.runtimeDefaults?.onboarding?.profileName
        ?? (lockedProvider === "codex" ? "codex" : defaultProfileName);
    const initialSetupOrder = getSetupOrder(initialMode, Boolean(dir));
    const [step, setStep] = useState(initialSetupOrder[0]);
    const [selectedDir, setSelectedDir] = useState(resolvedDir);
    const [selectedProfileName, setSelectedProfileName] = useState(initialSelectedProfileName);
    const initialProtocol = detectProtocol(loadProfile(initialSelectedProfileName));
    const initialRuntime = mergeRuntimeSettings(getDefaultOnboardingRuntime(initialProtocol), initialRuntimeOverrides);
    const [selectedModel, setSelectedModel] = useState(initialRuntime.model ?? getTopModel(initialProtocol));
    const [selectedEffort, setSelectedEffort] = useState(initialRuntime.reasoningEffort ?? (initialProtocol === "claude" ? "max" : "xhigh"));
    const [selectedTuningMode, setSelectedTuningMode] = useState(initialRuntime.tuningMode === "manual" ? "manual" : "auto");
    const [selectedExecutionMode, setSelectedExecutionMode] = useState(initialRuntime.executionMode === "accelerated" ? "accelerated" : "safe");
    const [selectedRefineThemes, setSelectedRefineThemes] = useState(initialRefineThemes);
    const [started, setStarted] = useState(false);
    const [freeTextMode, setFreeTextMode] = useState(false);
    const [freeTextKey, setFreeTextKey] = useState(0);
    const [modelInputKey, setModelInputKey] = useState(0);
    const [runtimeEditorOpen, setRuntimeEditorOpen] = useState(false);
    const [pendingStructuredAnswer, setPendingStructuredAnswer] = useState(null);
    const [heartbeat, setHeartbeat] = useState(0);
    const selectedProtocol = useMemo(() => detectProtocol(loadProfile(selectedProfileName)), [selectedProfileName]);
    const profileItems = profiles.map((profileName) => ({ label: profileName, value: profileName }));
    const effortItems = getReasoningOptions(selectedProtocol).map((value) => ({ label: value, value }));
    const tuningItems = [
        { label: "Auto-manage model and reasoning inside this provider", value: "auto" },
        { label: "Manual pin on the chosen model and reasoning effort", value: "manual" },
    ];
    const executionItems = [
        { label: "Safe autonomous", value: "safe" },
        { label: "Accelerated / unsafe", value: "accelerated" },
    ];
    const previousSetupStep = getPreviousOnboardingStep(step, Boolean(dir), initialMode);
    useEffect(() => {
        if (!started || (s.status !== "initializing" && s.status !== "running"))
            return;
        const timer = setInterval(() => {
            setHeartbeat((current) => current + 1);
        }, 160);
        return () => clearInterval(timer);
    }, [started, s.status]);
    const buildRuntimePackage = (executionMode = selectedExecutionMode, overrides) => {
        const protocol = selectedProtocol;
        const baseProfile = loadProfile(selectedProfileName);
        const tuningMode = overrides?.tuningMode === "manual" || overrides?.tuningMode === "auto"
            ? overrides.tuningMode
            : selectedTuningMode;
        const model = overrides?.model ?? selectedModel;
        const reasoningEffort = overrides?.reasoningEffort ?? selectedEffort;
        const onboardingRuntime = mergeRuntimeSettings(executionMode === "accelerated"
            ? getAcceleratedWorkerRuntime(protocol)
            : getDefaultOnboardingRuntime(protocol), {
            tuningMode,
            model,
            reasoningEffort,
            executionMode,
        });
        const baselineProfile = applyRuntimeSettings(baseProfile, onboardingRuntime);
        const onboardingPlan = recommendOnboardingRuntime(baselineProfile);
        const resolvedProfile = onboardingPlan.profile;
        const workerByProtocol = {
            claude: getDefaultWorkerRuntime("claude"),
            codex: getDefaultWorkerRuntime("codex"),
        };
        workerByProtocol[protocol] = mergeRuntimeSettings(executionMode === "accelerated"
            ? getAcceleratedWorkerRuntime(protocol)
            : getDefaultWorkerRuntime(protocol), {
            tuningMode,
            model,
            reasoningEffort,
            executionMode,
        });
        const runtimeDefaults = {
            lockedProvider: protocol,
            workerByProtocol,
            onboarding: {
                profileName: selectedProfileName,
                runtime: onboardingRuntime,
            },
        };
        return {
            resolvedProfile,
            runtimeDefaults,
            onboardingPlan,
        };
    };
    useInput((_input, key) => {
        if (runtimeEditorOpen && key.escape) {
            setRuntimeEditorOpen(false);
            return;
        }
        if (started && !runtimeEditorOpen && (s.status === "initializing" || s.status === "running" || s.status === "interviewing") && _input === "u") {
            setRuntimeEditorOpen(true);
            return;
        }
        if (!key.escape)
            return;
        if (!started) {
            if (previousSetupStep === "back") {
                dispatch({ type: "GO_BACK" });
                return;
            }
            setStep(previousSetupStep);
            return;
        }
        if (s.status === "interviewing" && freeTextMode) {
            setFreeTextMode(false);
            setPendingStructuredAnswer(null);
        }
    }, { isActive: true });
    // Auto-navigate home after onboarding completes
    useEffect(() => {
        if (s.status === "complete") {
            const timer = setTimeout(() => {
                dispatch({ type: "GO_BACK" });
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [s.status, dispatch]);
    const handleDirSubmit = (value) => {
        const resolved = resolve(expandTilde(value.trim()));
        if (!resolved)
            return;
        setSelectedDir(resolved);
        setStep(initialMode === "refine" ? "themes" : "profile");
    };
    const handleProfileSelect = (profileName) => {
        setSelectedProfileName(profileName);
        const protocol = detectProtocol(loadProfile(profileName));
        const defaults = mergeRuntimeSettings(getDefaultOnboardingRuntime(protocol));
        setSelectedModel(initialRuntimeOverrides?.model ?? defaults.model ?? getTopModel(protocol));
        setSelectedEffort(initialRuntimeOverrides?.reasoningEffort ?? defaults.reasoningEffort ?? (protocol === "claude" ? "max" : "xhigh"));
        setSelectedTuningMode(initialRuntimeOverrides?.tuningMode === "manual" ? "manual" : defaults.tuningMode === "manual" ? "manual" : "auto");
        setSelectedExecutionMode(initialRuntimeOverrides?.executionMode === "accelerated" ? "accelerated" : "safe");
        setModelInputKey((current) => current + 1);
        setStep("model");
    };
    const handleModelSubmit = (value) => {
        const protocol = selectedProtocol;
        const trimmed = value.trim();
        setSelectedModel(trimmed || getTopModel(protocol));
        setStep("effort");
    };
    const startConfiguredOnboarding = (executionMode) => {
        const { resolvedProfile, runtimeDefaults } = buildRuntimePackage(executionMode);
        setSelectedExecutionMode(executionMode);
        setStarted(true);
        start(selectedDir, debug, resolvedProfile, runtimeDefaults, initialMode, selectedRefineThemes);
    };
    const applyRuntimeEdit = (draft) => {
        setSelectedModel(draft.model);
        setSelectedEffort(draft.reasoningEffort);
        setSelectedTuningMode(draft.tuningMode);
        const { resolvedProfile, runtimeDefaults } = buildRuntimePackage(selectedExecutionMode, draft);
        updateRuntime(resolvedProfile, runtimeDefaults);
        setRuntimeEditorOpen(false);
    };
    const handleSelect = (value) => {
        if (value.toLowerCase().startsWith("other")) {
            setPendingStructuredAnswer({ mode: "single", selectedOptions: [] });
            setFreeTextMode(true);
            return;
        }
        setFreeTextMode(false);
        sendInput({
            text: value,
            mode: "single",
            selectedOptions: value === SKIP_OPTION ? [value] : [value],
        });
    };
    const handleFreeText = (value) => {
        const trimmed = value.trim();
        if (!trimmed && !pendingStructuredAnswer)
            return;
        const selectedOptions = pendingStructuredAnswer?.selectedOptions ?? [];
        const mode = pendingStructuredAnswer?.mode ?? "single";
        const formatted = [
            selectedOptions.length > 0 ? selectedOptions.join(" | ") : "",
            trimmed,
        ].filter(Boolean).join("\n\n");
        setFreeTextMode(false);
        setFreeTextKey((k) => k + 1);
        setPendingStructuredAnswer(null);
        sendInput({
            text: formatted || trimmed,
            mode,
            ...(selectedOptions.length > 0 ? { selectedOptions } : {}),
            ...(trimmed ? { freeText: trimmed } : {}),
        });
    };
    const runtimePackage = useMemo(() => buildRuntimePackage(selectedExecutionMode), [selectedExecutionMode, selectedExecutionMode, selectedEffort, selectedModel, selectedProfileName, selectedProtocol, selectedTuningMode]);
    const savedBaselineRuntime = useMemo(() => mergeRuntimeSettings(selectedExecutionMode === "accelerated"
        ? getAcceleratedWorkerRuntime(selectedProtocol)
        : getDefaultOnboardingRuntime(selectedProtocol), {
        tuningMode: selectedTuningMode,
        model: selectedModel,
        reasoningEffort: selectedEffort,
        executionMode: selectedExecutionMode,
    }), [selectedExecutionMode, selectedEffort, selectedModel, selectedProtocol, selectedTuningMode]);
    const setupOrder = getSetupOrder(initialMode, Boolean(dir));
    const stepPosition = Math.max(1, setupOrder.indexOf(step) + 1);
    const handleMultiSelectSubmit = (values) => {
        const uniqueValues = Array.from(new Set(values));
        if (uniqueValues.includes(SKIP_OPTION)) {
            sendInput({
                text: SKIP_OPTION,
                mode: "multi",
                selectedOptions: [SKIP_OPTION],
            });
            return;
        }
        const selectedOptions = uniqueValues.filter((value) => !value.toLowerCase().startsWith("other"));
        const wantsFreeText = uniqueValues.some((value) => value.toLowerCase().startsWith("other"));
        if (wantsFreeText) {
            setPendingStructuredAnswer({ mode: "multi", selectedOptions });
            setFreeTextMode(true);
            return;
        }
        sendInput({
            text: selectedOptions.join(" | "),
            mode: "multi",
            selectedOptions,
        });
    };
    // ── Directory input ──
    if (!started) {
        return (_jsxs(Box, { flexDirection: "column", padding: 1, gap: 1, children: [_jsxs(Panel, { title: initialMode === "refine" ? "Refine Roscoe" : "Train Roscoe", subtitle: initialMode === "refine"
                        ? "Keep the locked provider, choose the themes to revisit, and let Roscoe refine the saved understanding without rerunning the full intake"
                        : "Choose the locked provider for this project, then let Roscoe explore the repo and run an intent interview before saving project defaults", accentColor: "cyan", rightLabel: `Step ${stepPosition}/${setupOrder.length}`, children: [_jsxs(Box, { gap: 1, flexWrap: "wrap", children: [_jsx(Pill, { label: selectedDir ? basename(selectedDir) : "directory", color: selectedDir ? "cyan" : "gray" }), initialMode === "refine" && (_jsx(Pill, { label: selectedRefineThemes.length > 0 ? `${selectedRefineThemes.length} themes` : "themes", color: selectedRefineThemes.length > 0 ? "yellow" : "gray" })), _jsx(RuntimeSummaryPills, { protocol: selectedProtocol, runtime: runtimePackage.resolvedProfile.runtime })] }), selectedTuningMode === "auto" && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsxs(Text, { dimColor: true, children: ["Current onboarding turn: ", _jsx(Text, { color: "cyan", children: runtimePackage.onboardingPlan.summary })] }), _jsxs(Text, { dimColor: true, children: ["Saved baseline for future turns: ", _jsxs(Text, { color: "magenta", children: [selectedModel, " / ", selectedEffort] })] }), _jsx(Text, { dimColor: true, children: runtimePackage.onboardingPlan.rationale })] })), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { dimColor: true, children: ["Onboarding locks the project to ", _jsx(Text, { color: "cyan", children: selectedProtocol }), ". Later you can still retune model and reasoning inside that provider or let Roscoe auto-manage them."] }) }), _jsx(Box, { marginTop: 1, children: _jsx(KeyHints, { items: [
                                    { keyLabel: "Tab", description: "accept directory suggestion" },
                                    { keyLabel: "Enter", description: "confirm current step" },
                                    { keyLabel: "Esc", description: previousSetupStep === "back" ? "back to previous screen" : "back one step" },
                                ] }) })] }), step === "directory" && (_jsx(Panel, { title: "Project Directory", subtitle: "Point the orchestrator at the repo root", accentColor: "yellow", children: _jsxs(Box, { children: [_jsx(Text, { color: "yellow", children: "Project directory: " }), _jsx(DirInput, { onSubmit: handleDirSubmit })] }) })), step === "themes" && (_jsx(Panel, { title: "Refine Themes", subtitle: "Choose the saved understanding Roscoe should revisit before updating the brief", accentColor: "yellow", children: _jsx(ChecklistSelect, { options: REFINE_THEME_OPTIONS, onSubmit: (values) => {
                            setSelectedRefineThemes(values);
                            setStep("model");
                        } }) })), step === "profile" && initialMode === "onboard" && (_jsxs(Panel, { title: "Roscoe Runtime", subtitle: "Choose the provider Roscoe will use. This provider becomes the project lock after onboarding.", accentColor: "yellow", children: [_jsx(Select, { options: profileItems, onChange: handleProfileSelect }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: "Model and reasoning stay editable later. Switching Claude \u2194 Codex after onboarding is not allowed for a trained project." }) })] })), step === "model" && (_jsx(Panel, { title: "Model", subtitle: "Best model is prefilled; submit to keep or replace with a custom model id", accentColor: "yellow", children: _jsxs(Box, { children: [_jsx(Text, { color: "yellow", children: "Model: " }), _jsx(TextInput, { defaultValue: selectedModel, onSubmit: handleModelSubmit }, modelInputKey)] }) })), step === "effort" && (_jsx(Panel, { title: "Reasoning Effort", subtitle: "Tune depth for the onboarding run and save it as the project default", accentColor: "yellow", children: _jsx(Select, { options: effortItems, onChange: (value) => {
                            setSelectedEffort(value);
                            setStep("tuning");
                        } }) })), step === "tuning" && (_jsx(Panel, { title: "Runtime Management", subtitle: "Auto lets Roscoe retune model and reasoning inside the locked provider. Manual pins the chosen settings until you change them.", accentColor: "yellow", children: _jsx(Select, { options: tuningItems, onChange: (value) => {
                            setSelectedTuningMode(value);
                            setStep("execution");
                        } }) })), step === "execution" && (_jsx(Panel, { title: "Execution Mode", subtitle: "Safe autonomous uses provider-safe defaults that keep the agent moving; accelerated relaxes permissions for faster iteration", accentColor: selectedExecutionMode === "accelerated" ? "red" : "green", children: _jsx(Select, { options: executionItems, onChange: (value) => {
                            startConfiguredOnboarding(value);
                        } }) }))] }));
    }
    // ── Working (analysis with streaming text) ──
    if (s.status === "initializing" || s.status === "running") {
        return (_jsxs(Box, { flexDirection: "column", padding: 1, gap: 1, children: [_jsxs(Panel, { title: initialMode === "refine" ? "Roscoe Refinement" : "Roscoe Onboarding", subtitle: initialMode === "refine"
                        ? "Loading the saved brief, then tightening only the chosen themes inside the locked provider"
                        : "Exploring the codebase first, then preparing the intent interview inside the locked provider", accentColor: "cyan", rightLabel: s.toolActivity ? `tool ${s.toolActivity}` : s.status, children: [_jsx(RuntimeSummaryPills, { protocol: selectedProtocol, runtime: runtimePackage.resolvedProfile.runtime }), selectedTuningMode === "auto" && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsxs(Text, { dimColor: true, children: ["Current onboarding turn: ", _jsx(Text, { color: "cyan", children: runtimePackage.onboardingPlan.summary })] }), _jsxs(Text, { dimColor: true, children: ["Saved baseline: ", _jsxs(Text, { color: "magenta", children: [selectedModel, " / ", selectedEffort] })] }), _jsx(Text, { dimColor: true, children: runtimePackage.onboardingPlan.rationale })] })), _jsx(Box, { marginTop: 1, children: _jsx(KeyHints, { items: [{ keyLabel: "u", description: "retune runtime" }, { keyLabel: "Ctrl+C", description: "stop the process" }] }) }), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { dimColor: true, children: ["Provider stays on ", _jsx(Text, { color: "cyan", children: selectedProtocol }), ". Only model and reasoning can change from here."] }) })] }), runtimeEditorOpen && (_jsx(RuntimeEditorPanel, { protocol: selectedProtocol, runtime: savedBaselineRuntime, scopeLabel: "Changes apply to Roscoe's next onboarding turn and the saved project default for this provider.", onApply: applyRuntimeEdit })), s.qaHistory.length > 0 && (_jsx(Panel, { title: "Interview Trail", subtitle: "Decisions already captured", children: s.qaHistory.map((qa, i) => (_jsx(CompletedQA, { qa: qa, index: i }, i))) })), s.thinkingText && (_jsx(Panel, { title: "Roscoe Read", subtitle: "Live exploration and planning notes", accentColor: "magenta", children: _jsx(Text, { dimColor: true, italic: true, wrap: "wrap", children: s.thinkingText.split("\n").slice(-10).join("\n") }) })), s.streamingText && (_jsx(Panel, { title: "Live Analysis", subtitle: "Repo-grounded intake before the interview", accentColor: "gray", children: _jsx(Text, { wrap: "wrap", children: renderMd(s.streamingText) }) })), _jsxs(Text, { color: "cyan", children: [HEARTBEAT_FRAMES[heartbeat % HEARTBEAT_FRAMES.length], " ", s.toolActivity
                            ? `Using ${s.toolActivity}...`
                            : s.status === "initializing"
                                ? "Starting Roscoe..."
                                : initialMode === "refine"
                                    ? "Refining the saved project understanding..."
                                    : "Exploring the repo..."] })] }));
    }
    // ── Interview (multiple choice) ──
    if (s.status === "interviewing") {
        const options = s.question ? buildOptions(s.question.options) : [];
        return (_jsxs(Box, { flexDirection: "column", padding: 1, gap: 1, children: [_jsxs(Panel, { title: "Roscoe Intent Interview", subtitle: initialMode === "refine"
                        ? "Targeted follow-up questions to update the saved brief inside the locked provider"
                        : "Codebase-grounded questions to pin down intent and definition of done inside the locked provider", accentColor: "cyan", rightLabel: `Q${s.qaHistory.length + 1}`, children: [_jsx(RuntimeSummaryPills, { protocol: selectedProtocol, runtime: runtimePackage.resolvedProfile.runtime }), selectedTuningMode === "auto" && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsxs(Text, { dimColor: true, children: ["Current interview turn: ", _jsx(Text, { color: "cyan", children: runtimePackage.onboardingPlan.summary })] }), _jsxs(Text, { dimColor: true, children: ["Saved baseline: ", _jsxs(Text, { color: "magenta", children: [selectedModel, " / ", selectedEffort] })] })] })), _jsx(Box, { marginTop: 1, children: _jsx(KeyHints, { items: [{ keyLabel: "u", description: "retune runtime" }, { keyLabel: "Enter", description: "submit selection or free text" }] }) }), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { dimColor: true, children: ["Roscoe may retune model and reasoning inside ", _jsx(Text, { color: "cyan", children: selectedProtocol }), ", but this project will not switch providers after onboarding."] }) })] }), runtimeEditorOpen && (_jsx(RuntimeEditorPanel, { protocol: selectedProtocol, runtime: savedBaselineRuntime, scopeLabel: "Changes apply to Roscoe's next interview turn and the saved project default for this provider.", onApply: applyRuntimeEdit })), s.qaHistory.length > 0 && (_jsx(Panel, { title: "Interview Trail", subtitle: "Context already locked in", children: s.qaHistory.map((qa, i) => (_jsx(CompletedQA, { qa: qa, index: i }, i))) })), s.streamingText && (_jsx(Panel, { title: "Current Read", subtitle: "What Roscoe has learned from the repo and your answers so far", children: _jsx(Text, { wrap: "wrap", children: renderMd(s.streamingText) }) })), s.question && !freeTextMode && s.question.selectionMode === "single" && (_jsxs(Panel, { title: `Question ${s.qaHistory.length + 1}`, subtitle: s.question.purpose ?? "Pick the closest answer or choose Other", accentColor: "yellow", children: [_jsxs(Box, { marginBottom: 1, children: [s.question.theme && (_jsxs(Text, { dimColor: true, children: ["[", s.question.theme, "]"] })), _jsx(Text, { bold: true, children: s.question.text })] }), _jsx(Select, { options: options, visibleOptionCount: options.length, onChange: handleSelect })] })), s.question && !freeTextMode && s.question.selectionMode === "multi" && (_jsxs(Panel, { title: `Question ${s.qaHistory.length + 1}`, subtitle: s.question.purpose ?? "Choose all answers that apply", accentColor: "yellow", children: [_jsxs(Box, { marginBottom: 1, flexDirection: "column", children: [s.question.theme && (_jsxs(Text, { dimColor: true, children: ["[", s.question.theme, "]"] })), _jsx(Text, { bold: true, children: s.question.text })] }), _jsx(ChecklistSelect, { options: buildOptions(s.question.options).map((option) => option.value), exclusiveValue: SKIP_OPTION, onSubmit: handleMultiSelectSubmit })] })), freeTextMode && (_jsxs(Panel, { title: `Question ${s.qaHistory.length + 1}`, subtitle: s.question?.purpose ?? "Free-form answer", accentColor: "yellow", children: [_jsxs(Box, { marginBottom: 1, children: [s.question?.theme && (_jsxs(Text, { dimColor: true, children: ["[", s.question.theme, "]"] })), _jsx(Text, { bold: true, children: s.question?.text ?? "" })] }), pendingStructuredAnswer?.selectedOptions?.length ? (_jsx(Box, { marginBottom: 1, children: _jsxs(Text, { dimColor: true, children: ["Selected options: ", pendingStructuredAnswer.selectedOptions.join(" | ")] }) })) : null, _jsxs(Box, { children: [_jsx(Text, { color: "yellow", children: "Your answer: " }), _jsx(TextInput, { placeholder: "Type your answer...", onSubmit: handleFreeText }, freeTextKey)] })] })), !s.question && !freeTextMode && (_jsx(Panel, { title: "Reply", subtitle: "Fallback text input", accentColor: "yellow", children: _jsxs(Box, { children: [_jsx(Text, { color: "yellow", children: "Your input: " }), _jsx(TextInput, { placeholder: "Type your response...", onSubmit: (v) => {
                                    if (v.trim()) {
                                        setFreeTextKey((k) => k + 1);
                                        sendInput(v.trim());
                                    }
                                } }, freeTextKey)] }) }))] }));
    }
    // ── Complete — show briefly then return home ──
    if (s.status === "complete") {
        return (_jsxs(Box, { flexDirection: "column", padding: 1, gap: 1, children: [s.qaHistory.length > 0 && (_jsx(Panel, { title: "Interview Trail", subtitle: "Captured decisions", children: s.qaHistory.map((qa, i) => (_jsx(CompletedQA, { qa: qa, index: i }, i))) })), _jsx(Panel, { title: "Onboarding Complete", subtitle: "Project memory has been written", accentColor: "green", children: _jsxs(Box, { gap: 1, children: [s.projectContext && _jsx(Pill, { label: s.projectContext.name, color: "green" }), _jsx(Text, { children: s.projectContext
                                    ? `Roscoe is trained on "${s.projectContext.name}" and ready to guide Guild sessions. Returning to home...`
                                    : "Project registered. Returning to home..." })] }) })] }));
    }
    // ── Error ──
    return (_jsx(Box, { flexDirection: "column", padding: 1, children: _jsx(StatusMessage, { variant: "error", children: s.error ?? "Unknown error" }) }));
}
