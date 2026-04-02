import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput, StatusMessage, Select } from "@inkjs/ui";
import { renderMd } from "../render-md.js";
import { useOnboarding, QAPair, SKIP_OPTION } from "../hooks/use-onboarding.js";
import { useAppContext } from "../app.js";
import { resolve, dirname, basename } from "path";
import { homedir } from "os";
import { readdirSync } from "fs";
import { KeyHints, Panel, Pill } from "./chrome.js";
import {
  listProfiles,
  loadProfile,
  loadProjectContext,
  loadRoscoeSettings,
  OnboardingMode,
  ProjectRuntimeDefaults,
  ResponderApprovalMode,
  TokenEfficiencyMode,
  VerificationCadence,
  resolveProjectRoot,
  WorkerGovernanceMode,
} from "../config.js";
import { filterProfilesBySelectableProviders, getSelectableProviderIds } from "../provider-registry.js";
import { detectProtocol, getProviderAdapter, LLMProtocol, RuntimeControlSettings } from "../llm-runtime.js";
import {
  applyRuntimeSettings,
  formatTokenEfficiencyLabel,
  formatVerificationCadenceLabel,
  formatResponderApprovalLabel,
  formatWorkerGovernanceLabel,
  getAcceleratedWorkerRuntime,
  getDefaultProfileName,
  getDefaultOnboardingRuntime,
  getDefaultWorkerRuntime,
  getExecutionModeLabel,
  getGuildProvider,
  getResponderProvider,
  getTokenEfficiencyMode,
  getVerificationCadence,
  getResponderApprovalMode,
  getTopModel,
  getWorkerGovernanceMode,
  mergeRuntimeSettings,
  recommendOnboardingRuntime,
} from "../runtime-defaults.js";
import { inspectWorkspaceForOnboarding } from "../workspace-intake.js";
import {
  RuntimeEditorPanel,
  RuntimeEditorDraft,
  RuntimeSummaryPills,
} from "./runtime-controls.js";
import { ChecklistSelect } from "./checklist-select.js";
import { ProjectSecretRequest } from "../project-secrets.js";

interface OnboardingScreenProps {
  dir?: string;
  debug?: boolean;
  initialProfileName?: string;
  initialRuntimeOverrides?: RuntimeControlSettings;
  initialMode?: OnboardingMode;
  initialRefineThemes?: string[];
}

type SetupStep = "directory" | "themes" | "runtime";

const REFINE_THEME_OPTIONS = [
  "project-story",
  "primary-users",
  "definition-of-done",
  "acceptance-checks",
  "delivery-pillars",
  "coverage-mechanism",
  "non-goals",
  "constraints",
  "architecture-principles",
  "autonomy-rules",
  "quality-bar",
  "risk-boundaries",
  "ui-direction",
];

const HEARTBEAT_FRAMES = ["·", "•", "∙", "•"];

function getSetupOrder(mode: OnboardingMode, hasPresetDirectory: boolean): SetupStep[] {
  if (mode === "refine") {
    return hasPresetDirectory
      ? ["themes", "runtime"]
      : ["directory", "themes", "runtime"];
  }

  return hasPresetDirectory
    ? ["runtime"]
    : ["directory", "runtime"];
}

export function getPreviousOnboardingStep(
  step: SetupStep,
  hasPresetDirectory: boolean,
  mode: OnboardingMode = "onboard",
): SetupStep | "back" {
  const order = getSetupOrder(mode, hasPresetDirectory);
  const index = order.indexOf(step);
  if (index <= 0) return "back";
  return order[index - 1];
}

export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

/** List subdirectories matching the current input for autocomplete */
export function getDirSuggestions(input: string): string[] {
  if (!input) return [];
  try {
    const expanded = expandTilde(input);
    let parent: string;
    let prefix: string;
    if (input.endsWith("/")) {
      parent = expanded;
      prefix = "";
    } else {
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
  } catch {
    return [];
  }
}

/** Directory input with tab-completion */
function DirInput({ onSubmit }: { onSubmit: (value: string) => void }) {
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

  return (
    <TextInput
      key={inputKey}
      defaultValue={value}
      placeholder="~/path/to/project"
      suggestions={suggestions}
      onChange={setValue}
      onSubmit={onSubmit}
    />
  );
}

function CompletedQA({ qa, index }: { qa: QAPair; index: number }) {
  return (
    <Box>
      <Text dimColor>
        <Text bold>Q{index + 1}:</Text> {qa.theme ? `[${qa.theme}] ` : ""}{qa.question} <Text color="cyan">{qa.answer}</Text>
      </Text>
    </Box>
  );
}

function SecretInput({
  request,
  onSubmit,
  onSkip,
}: {
  request: ProjectSecretRequest;
  onSubmit: (value: string) => void;
  onSkip: () => void;
}) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setValue("");
      }
      return;
    }

    if (input.toLowerCase() === "s" && !key.ctrl && !key.shift) {
      onSkip();
      return;
    }

    if (key.ctrl && input.toLowerCase() === "u") {
      setValue("");
      return;
    }

    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }

    if (!input || key.tab || key.escape || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      return;
    }

    setValue((current) => current + input);
  }, { isActive: true });

  const maskedValue = value.length > 0
    ? `${"•".repeat(Math.min(value.length, 32))}${value.length > 32 ? "…" : ""} (${value.length} chars)`
    : "Paste the secret value here";

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <Text color="yellow">Secret input: </Text>
        <Text>{maskedValue}</Text>
      </Box>
      <Text dimColor>
        Env var: <Text color="cyan">{request.key}</Text> · Save to <Text color="magenta">{request.targetFile}</Text>
      </Text>
      <KeyHints
        items={[
          { keyLabel: "Enter", description: "save secret securely" },
          { keyLabel: "s", description: "skip for now" },
          { keyLabel: "Ctrl+U", description: "clear pasted value" },
        ]}
      />
    </Box>
  );
}

/** Build Select options: Claude's options + permanent "Other" and "Skip" */
function buildOptions(questionOptions: string[]) {
  // Dedupe: remove any "Other" variant Claude already included
  const filtered = questionOptions.filter(
    (o) => !o.toLowerCase().startsWith("other") && !o.toLowerCase().startsWith("skip"),
  );
  return [
    ...filtered.map((o) => ({ label: o, value: o })),
    { label: "Other (I'll explain)", value: "Other (I'll explain)" },
    { label: SKIP_OPTION, value: SKIP_OPTION },
  ];
}

interface SubmittedProjectDir {
  enteredDir: string;
  suggestedDir: string;
  needsConfirmation: boolean;
}

export function inspectSubmittedProjectDir(value: string): SubmittedProjectDir | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const enteredDir = resolve(expandTilde(trimmed));
  const suggestedDir = resolveProjectRoot(enteredDir);
  return {
    enteredDir,
    suggestedDir,
    needsConfirmation: suggestedDir !== enteredDir,
  };
}

export function OnboardingScreen({
  dir,
  debug,
  initialProfileName,
  initialRuntimeOverrides,
  initialMode = "onboard",
  initialRefineThemes = [],
}: OnboardingScreenProps) {
  const { dispatch } = useAppContext();
  const { state: s, start, sendInput, sendSecretInput, skipSecretInput, updateRuntime } = useOnboarding();
  const roscoeSettings = loadRoscoeSettings();
  const allProfiles = listProfiles();
  const resolvedDir = dir ? resolveProjectRoot(resolve(expandTilde(dir))) : "";
  const savedProjectContext = resolvedDir ? loadProjectContext(resolvedDir) : null;
  const savedGuildProvider = getGuildProvider(savedProjectContext);
  const savedResponderProvider = getResponderProvider(savedProjectContext);
  const configuredProfiles = filterProfilesBySelectableProviders(
    allProfiles,
    roscoeSettings,
    [
      ...(savedGuildProvider ? [savedGuildProvider] : []),
      ...(savedResponderProvider ? [savedResponderProvider] : []),
    ],
  );
  const profiles = configuredProfiles.length > 0 ? configuredProfiles : allProfiles;
  const allowedProviders = getSelectableProviderIds(
    roscoeSettings,
    [
      ...(savedGuildProvider ? [savedGuildProvider] : []),
      ...(savedResponderProvider ? [savedResponderProvider] : []),
    ],
  );
  const defaultProfileName = profiles[0] ?? getDefaultProfileName("claude");
  const initialSelectedProfileName = initialProfileName
    ?? savedProjectContext?.runtimeDefaults?.onboarding?.profileName
    ?? (savedResponderProvider ? getDefaultProfileName(savedResponderProvider) : defaultProfileName);
  const initialSetupOrder = getSetupOrder(initialMode, Boolean(dir));
  const [step, setStep] = useState<SetupStep>(initialSetupOrder[0]);
  const [selectedDir, setSelectedDir] = useState(resolvedDir);
  const [selectedProfileName, setSelectedProfileName] = useState(initialSelectedProfileName);
  const initialResponderProvider = detectProtocol(loadProfile(initialSelectedProfileName));
  const initialGuildProvider = savedGuildProvider ?? initialResponderProvider;
  const savedGuildRuntime = savedProjectContext?.runtimeDefaults?.workerByProtocol?.[initialGuildProvider] ?? null;
  const initialGuildRuntime = mergeRuntimeSettings(
    savedGuildRuntime?.executionMode === "safe"
      ? getDefaultWorkerRuntime(initialGuildProvider)
      : getAcceleratedWorkerRuntime(initialGuildProvider),
    savedGuildRuntime,
  );
  const initialResponderRuntime = mergeRuntimeSettings(
    getDefaultOnboardingRuntime(initialResponderProvider),
    savedProjectContext?.runtimeDefaults?.responderByProtocol?.[initialResponderProvider],
    savedProjectContext?.runtimeDefaults?.onboarding?.runtime,
    initialRuntimeOverrides,
  );
  const [selectedGuildProvider, setSelectedGuildProvider] = useState(initialGuildProvider);
  const [selectedModel, setSelectedModel] = useState(initialGuildRuntime.model ?? getTopModel(initialGuildProvider));
  const [selectedEffort, setSelectedEffort] = useState(
    initialGuildRuntime.reasoningEffort ?? getProviderAdapter(initialGuildProvider).defaultReasoningEffort,
  );
  const [selectedResponderModel, setSelectedResponderModel] = useState(initialResponderRuntime.model ?? getTopModel(initialResponderProvider));
  const [selectedResponderEffort, setSelectedResponderEffort] = useState(
    initialResponderRuntime.reasoningEffort ?? getProviderAdapter(initialResponderProvider).onboardingReasoningEffort,
  );
  const [selectedTuningMode, setSelectedTuningMode] = useState<"manual" | "auto">(initialGuildRuntime.tuningMode === "manual" ? "manual" : "auto");
  const [selectedExecutionMode, setSelectedExecutionMode] = useState<"safe" | "accelerated">(getExecutionModeLabel(initialGuildRuntime) as "safe" | "accelerated");
  const [selectedWorkerGovernanceMode, setSelectedWorkerGovernanceMode] = useState<WorkerGovernanceMode>(
    savedProjectContext ? getWorkerGovernanceMode(savedProjectContext) : "roscoe-arbiter",
  );
  const [selectedVerificationCadence, setSelectedVerificationCadence] = useState<VerificationCadence>(
    getVerificationCadence(savedProjectContext),
  );
  const [selectedTokenEfficiencyMode, setSelectedTokenEfficiencyMode] = useState<TokenEfficiencyMode>(
    getTokenEfficiencyMode(savedProjectContext),
  );
  const [selectedResponderApprovalMode, setSelectedResponderApprovalMode] = useState<ResponderApprovalMode>(
    getResponderApprovalMode(savedProjectContext) ?? "auto",
  );
  const [selectedRefineThemes, setSelectedRefineThemes] = useState<string[]>(initialRefineThemes);
  const workspaceAssessment = useMemo(
    () => selectedDir ? inspectWorkspaceForOnboarding(selectedDir) : null,
    [selectedDir],
  );

  const [started, setStarted] = useState(false);
  const [freeTextMode, setFreeTextMode] = useState(false);
  const [freeTextKey, setFreeTextKey] = useState(0);
  const [runtimeEditorOpen, setRuntimeEditorOpen] = useState(false);
  const [pendingStructuredAnswer, setPendingStructuredAnswer] = useState<{
    mode: "single" | "multi";
    selectedOptions: string[];
  } | null>(null);
  const [pendingDirConfirmation, setPendingDirConfirmation] = useState<SubmittedProjectDir | null>(null);
  const [heartbeat, setHeartbeat] = useState(0);

  const selectedResponderProtocol = useMemo(
    () => detectProtocol(loadProfile(selectedProfileName)),
    [selectedProfileName],
  );
  const previousSetupStep = getPreviousOnboardingStep(step, Boolean(dir), initialMode);

  useEffect(() => {
    if (!started || (s.status !== "initializing" && s.status !== "running")) return;
    const timer = setInterval(() => {
      setHeartbeat((current) => current + 1);
    }, 160);
    return () => clearInterval(timer);
  }, [started, s.status]);

  const buildRuntimePackage = (
    executionMode: "safe" | "accelerated" = selectedExecutionMode,
    overrides?: Partial<RuntimeControlSettings> & {
      guildProvider?: LLMProtocol;
      responderProfileName?: string;
      workerTuningMode?: "manual" | "auto";
      workerModel?: string;
      workerReasoningEffort?: string;
      responderModel?: string;
      responderReasoningEffort?: string;
      workerGovernanceMode?: WorkerGovernanceMode;
      verificationCadence?: VerificationCadence;
      tokenEfficiencyMode?: TokenEfficiencyMode;
      responderApprovalMode?: ResponderApprovalMode;
    },
  ) => {
    const guildProvider = overrides?.guildProvider ?? selectedGuildProvider;
    const responderProfileName = overrides?.responderProfileName ?? selectedProfileName;
    const responderProtocol = detectProtocol(loadProfile(responderProfileName));
    const baseProfile = loadProfile(responderProfileName);
    const tuningMode = overrides?.workerTuningMode === "manual" || overrides?.workerTuningMode === "auto"
      ? overrides.workerTuningMode
      : selectedTuningMode;
    const model = overrides?.workerModel ?? selectedModel;
    const reasoningEffort = overrides?.workerReasoningEffort ?? selectedEffort;
    const responderModel = overrides?.responderModel ?? selectedResponderModel;
    const responderReasoningEffort = overrides?.responderReasoningEffort ?? selectedResponderEffort;
    const workerGovernanceMode = overrides?.workerGovernanceMode ?? selectedWorkerGovernanceMode;
    const verificationCadence = overrides?.verificationCadence ?? selectedVerificationCadence;
    const tokenEfficiencyMode = overrides?.tokenEfficiencyMode ?? selectedTokenEfficiencyMode;
    const responderApprovalMode = overrides?.responderApprovalMode ?? selectedResponderApprovalMode;
    const onboardingRuntime = mergeRuntimeSettings(
      executionMode === "accelerated"
        ? getAcceleratedWorkerRuntime(responderProtocol)
        : getDefaultOnboardingRuntime(responderProtocol),
      savedProjectContext?.runtimeDefaults?.onboarding?.runtime,
      initialRuntimeOverrides,
      { executionMode },
      responderModel ? { model: responderModel } : undefined,
      responderReasoningEffort ? { reasoningEffort: responderReasoningEffort } : undefined,
    );
    const baselineProfile = applyRuntimeSettings(baseProfile, onboardingRuntime);
    const onboardingPlan = recommendOnboardingRuntime(baselineProfile);
    const resolvedProfile = onboardingPlan.profile;
    const workerByProtocol: ProjectRuntimeDefaults["workerByProtocol"] = {
      claude: getDefaultWorkerRuntime("claude"),
      codex: getDefaultWorkerRuntime("codex"),
    };
    workerByProtocol[guildProvider] = mergeRuntimeSettings(
      executionMode === "accelerated"
        ? getAcceleratedWorkerRuntime(guildProvider)
        : getDefaultWorkerRuntime(guildProvider),
      {
        tuningMode,
        model,
        reasoningEffort,
        executionMode,
      },
    );

    const runtimeDefaults: ProjectRuntimeDefaults = {
      lockedProvider: guildProvider,
      guildProvider,
      responderProvider: responderProtocol,
      workerByProtocol,
      responderByProtocol: {
        [responderProtocol]: mergeRuntimeSettings(
          executionMode === "accelerated"
            ? getAcceleratedWorkerRuntime(responderProtocol)
            : getDefaultWorkerRuntime(responderProtocol),
          {
            tuningMode: "manual",
            model: responderModel,
            reasoningEffort: responderReasoningEffort,
          },
        ),
      },
      onboarding: {
        profileName: responderProfileName,
        runtime: onboardingRuntime,
      },
      workerGovernanceMode,
      verificationCadence,
      tokenEfficiencyMode,
      responderApprovalMode,
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

    if (!key.escape) return;

    if (!started) {
      if (step === "directory" && pendingDirConfirmation) {
        setPendingDirConfirmation(null);
        return;
      }

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

  const acceptDirectory = (directory: string) => {
    setPendingDirConfirmation(null);
    setSelectedDir(directory);
    setStep(initialMode === "refine" ? "themes" : "runtime");
  };

  const handleDirSubmit = (value: string) => {
    const submitted = inspectSubmittedProjectDir(value);
    if (!submitted) return;

    if (submitted.needsConfirmation) {
      setPendingDirConfirmation(submitted);
      return;
    }

    acceptDirectory(submitted.suggestedDir);
  };

  const startConfiguredOnboarding = (
    executionMode: "safe" | "accelerated",
    overrides?: Partial<RuntimeControlSettings> & {
      guildProvider?: LLMProtocol;
      responderProfileName?: string;
      workerTuningMode?: "manual" | "auto";
      workerModel?: string;
      workerReasoningEffort?: string;
      responderModel?: string;
      responderReasoningEffort?: string;
      workerGovernanceMode?: WorkerGovernanceMode;
      verificationCadence?: VerificationCadence;
      tokenEfficiencyMode?: TokenEfficiencyMode;
      responderApprovalMode?: ResponderApprovalMode;
    },
  ) => {
    const { resolvedProfile, runtimeDefaults } = buildRuntimePackage(executionMode, overrides);

    setSelectedExecutionMode(executionMode);
    setStarted(true);
    start(
      selectedDir,
      debug,
      resolvedProfile,
      runtimeDefaults,
      initialMode,
      selectedRefineThemes,
    );
  };

  const applySetupRuntimeEdit = (draft: RuntimeEditorDraft) => {
    const nextResponderProfileName = getDefaultProfileName(draft.responderProvider);
    setSelectedGuildProvider(draft.workerProvider);
    setSelectedProfileName(nextResponderProfileName);
    setSelectedExecutionMode(draft.workerExecutionMode);
    setSelectedModel(draft.workerModel);
    setSelectedEffort(draft.workerReasoningEffort);
    setSelectedResponderModel(draft.responderModel);
    setSelectedResponderEffort(draft.responderReasoningEffort);
    setSelectedTuningMode(draft.workerTuningMode);
    setSelectedWorkerGovernanceMode(draft.workerGovernanceMode);
    setSelectedVerificationCadence(draft.verificationCadence);
    setSelectedTokenEfficiencyMode(draft.tokenEfficiencyMode);
    setSelectedResponderApprovalMode(draft.responderApprovalMode);
    startConfiguredOnboarding(draft.workerExecutionMode, {
      guildProvider: draft.workerProvider,
      responderProfileName: nextResponderProfileName,
      workerTuningMode: draft.workerTuningMode,
      workerModel: draft.workerModel,
      workerReasoningEffort: draft.workerReasoningEffort,
      responderModel: draft.responderModel,
      responderReasoningEffort: draft.responderReasoningEffort,
      workerGovernanceMode: draft.workerGovernanceMode,
      verificationCadence: draft.verificationCadence,
      tokenEfficiencyMode: draft.tokenEfficiencyMode,
      responderApprovalMode: draft.responderApprovalMode,
    });
  };

  const applyRuntimeEdit = (draft: RuntimeEditorDraft) => {
    const nextResponderProfileName = getDefaultProfileName(draft.responderProvider);
    setSelectedGuildProvider(draft.workerProvider);
    setSelectedProfileName(nextResponderProfileName);
    setSelectedExecutionMode(draft.workerExecutionMode);
    setSelectedModel(draft.workerModel);
    setSelectedEffort(draft.workerReasoningEffort);
    setSelectedResponderModel(draft.responderModel);
    setSelectedResponderEffort(draft.responderReasoningEffort);
    setSelectedTuningMode(draft.workerTuningMode);
    setSelectedWorkerGovernanceMode(draft.workerGovernanceMode);
    setSelectedVerificationCadence(draft.verificationCadence);
    setSelectedTokenEfficiencyMode(draft.tokenEfficiencyMode);
    setSelectedResponderApprovalMode(draft.responderApprovalMode);
    const { resolvedProfile, runtimeDefaults } = buildRuntimePackage(draft.workerExecutionMode, {
      ...draft,
      guildProvider: draft.workerProvider,
      responderProfileName: nextResponderProfileName,
    });
    updateRuntime(resolvedProfile, runtimeDefaults);
    setRuntimeEditorOpen(false);
  };

  const handleSelect = (value: string) => {
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

  const handleFreeText = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed && !pendingStructuredAnswer) return;

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

  const runtimePackage = useMemo(
    () => buildRuntimePackage(selectedExecutionMode),
    [
      selectedExecutionMode,
      selectedEffort,
      selectedGuildProvider,
      selectedModel,
      selectedProfileName,
      selectedResponderApprovalMode,
      selectedResponderEffort,
      selectedResponderModel,
      selectedTokenEfficiencyMode,
      selectedTuningMode,
      selectedVerificationCadence,
      selectedWorkerGovernanceMode,
    ],
  );
  const savedBaselineRuntime = useMemo(
    () => mergeRuntimeSettings(
      selectedExecutionMode === "accelerated"
        ? getAcceleratedWorkerRuntime(selectedGuildProvider)
        : getDefaultWorkerRuntime(selectedGuildProvider),
      {
        tuningMode: selectedTuningMode,
        model: selectedModel,
        reasoningEffort: selectedEffort,
        executionMode: selectedExecutionMode,
      },
    ),
    [selectedExecutionMode, selectedEffort, selectedGuildProvider, selectedModel, selectedTuningMode],
  );
  const savedResponderRuntime = useMemo(
    () => mergeRuntimeSettings(
      selectedExecutionMode === "accelerated"
        ? getAcceleratedWorkerRuntime(selectedResponderProtocol)
        : getDefaultWorkerRuntime(selectedResponderProtocol),
      {
        tuningMode: "manual",
        model: selectedResponderModel,
        reasoningEffort: selectedResponderEffort,
      },
    ),
    [selectedExecutionMode, selectedResponderEffort, selectedResponderModel, selectedResponderProtocol],
  );
  const setupOrder = getSetupOrder(initialMode, Boolean(dir));
  const stepPosition = Math.max(1, setupOrder.indexOf(step) + 1);

  const handleMultiSelectSubmit = (values: string[]) => {
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
  if (!started && s.status === "idle") {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Panel
          title={initialMode === "refine" ? "Refine Roscoe" : "Train Roscoe"}
          subtitle={
            initialMode === "refine"
              ? "Choose the themes to revisit, then run the shared Runtime & Governance wizard before Roscoe refines the saved understanding"
              : "Choose the project, run the shared Runtime & Governance wizard, then let Roscoe explore the repo and run an intent interview before saving project defaults"
          }
          accentColor="cyan"
          rightLabel={`Step ${stepPosition}/${setupOrder.length}`}
        >
          <Box gap={1} flexWrap="wrap">
            <Pill label={selectedDir ? basename(selectedDir) : "directory"} color={selectedDir ? "cyan" : "gray"} />
            {initialMode === "refine" && (
              <Pill label={selectedRefineThemes.length > 0 ? `${selectedRefineThemes.length} themes` : "themes"} color={selectedRefineThemes.length > 0 ? "yellow" : "gray"} />
            )}
            <RuntimeSummaryPills
              protocol={selectedGuildProvider}
              responderProvider={selectedResponderProtocol}
              runtime={savedBaselineRuntime}
              responderRuntime={runtimePackage.runtimeDefaults.responderByProtocol?.[selectedResponderProtocol]}
              workerGovernanceMode={selectedWorkerGovernanceMode}
              verificationCadence={selectedVerificationCadence}
              tokenEfficiencyMode={selectedTokenEfficiencyMode}
              responderApprovalMode={selectedResponderApprovalMode}
            />
          </Box>
          {selectedTuningMode === "auto" && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                Current onboarding turn: <Text color="cyan">{runtimePackage.onboardingPlan.summary}</Text>
              </Text>
              <Text dimColor>
                Saved Guild baseline: <Text color="yellow">{selectedModel} / {selectedEffort}</Text>
              </Text>
              <Text dimColor>
                Saved Roscoe baseline: <Text color="magenta">{selectedResponderModel} / {selectedResponderEffort}</Text>
              </Text>
              <Text dimColor>{runtimePackage.onboardingPlan.rationale}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              Roscoe will onboard and draft on <Text color="magenta">{selectedResponderProtocol}</Text>. Future Guild lanes will launch on <Text color="cyan">{selectedGuildProvider}</Text>. The same shared wizard is available later with <Text color="cyan">u</Text>.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Execution controls file and network access. Guild check-in mode controls whether workers stop for Roscoe before material changes. Verification cadence controls when the heavy proof stack reruns. Token efficiency controls how hard Roscoe leans on reasoning depth by default. Roscoe approval controls whether Roscoe asks you before replying.
            </Text>
          </Box>
          <Box marginTop={1}>
            <KeyHints
              items={[
                { keyLabel: "Tab", description: "accept directory suggestion" },
                { keyLabel: "Enter", description: "confirm current step" },
                { keyLabel: "Esc", description: previousSetupStep === "back" ? "back to previous screen" : "back one step" },
              ]}
            />
          </Box>
        </Panel>

        {step === "directory" && (
          <Panel title="Project Directory" subtitle="Point the orchestrator at the repo root" accentColor="yellow">
            {pendingDirConfirmation ? (
              <Box flexDirection="column">
                <Text color="yellow" bold>Repo root detected for this path:</Text>
                <Text dimColor>Entered: {pendingDirConfirmation.enteredDir}</Text>
                <Text dimColor>Repo root: {pendingDirConfirmation.suggestedDir}</Text>
                <Box marginTop={1}>
                  <Select
                    options={[
                      { label: `Use repo root  ${pendingDirConfirmation.suggestedDir}`, value: "root" },
                      { label: `Keep entered directory  ${pendingDirConfirmation.enteredDir}`, value: "entered" },
                    ]}
                    onChange={(value) => {
                      acceptDirectory(
                        value === "root"
                          ? pendingDirConfirmation.suggestedDir
                          : pendingDirConfirmation.enteredDir,
                      );
                    }}
                  />
                </Box>
              </Box>
            ) : (
              <Box>
                <Text color="yellow">Project directory: </Text>
                <DirInput onSubmit={handleDirSubmit} />
              </Box>
            )}
          </Panel>
        )}

        {step === "themes" && (
          <Panel
            title="Refine Themes"
            subtitle="Choose the saved understanding Roscoe should revisit before updating the brief"
            accentColor="yellow"
          >
            <ChecklistSelect
              options={REFINE_THEME_OPTIONS}
              onSubmit={(values) => {
                setSelectedRefineThemes(values);
                setStep("runtime");
              }}
            />
          </Panel>
        )}

        {step === "runtime" && (
          <RuntimeEditorPanel
            protocol={selectedGuildProvider}
            responderProvider={selectedResponderProtocol}
            allowedProviders={allowedProviders}
            runtime={savedBaselineRuntime}
            responderRuntime={savedResponderRuntime}
            workerGovernanceMode={selectedWorkerGovernanceMode}
            verificationCadence={selectedVerificationCadence}
            tokenEfficiencyMode={selectedTokenEfficiencyMode}
            responderApprovalMode={selectedResponderApprovalMode}
            onApply={applySetupRuntimeEdit}
            accentColor="yellow"
          />
        )}
      </Box>
    );
  }

  // ── Working (analysis with streaming text) ──
  if (s.status === "initializing" || s.status === "running") {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Panel
          title={initialMode === "refine" ? "Roscoe Refinement" : "Roscoe Onboarding"}
          subtitle={
            initialMode === "refine"
              ? "Loading the saved brief, then tightening only the chosen themes with the saved Guild and Roscoe defaults"
              : workspaceAssessment?.mode === "greenfield"
                ? "Assessing the greenfield workspace first, then preparing a vision-and-architecture interview with the saved Guild and Roscoe defaults"
                : "Exploring the codebase first, then preparing the intent interview with the saved Guild and Roscoe defaults"
          }
          accentColor="cyan"
          rightLabel={s.toolActivity ? `tool ${s.toolActivity}` : s.status}
        >
            <RuntimeSummaryPills
              protocol={selectedGuildProvider}
              responderProvider={selectedResponderProtocol}
              runtime={savedBaselineRuntime}
              responderRuntime={runtimePackage.runtimeDefaults.responderByProtocol?.[selectedResponderProtocol]}
              workerGovernanceMode={selectedWorkerGovernanceMode}
              verificationCadence={selectedVerificationCadence}
              tokenEfficiencyMode={selectedTokenEfficiencyMode}
              responderApprovalMode={selectedResponderApprovalMode}
            />
          {selectedTuningMode === "auto" && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                Current onboarding turn: <Text color="cyan">{runtimePackage.onboardingPlan.summary}</Text>
              </Text>
              <Text dimColor>
                Saved Guild baseline: <Text color="yellow">{selectedModel} / {selectedEffort}</Text>
              </Text>
              <Text dimColor>{runtimePackage.onboardingPlan.rationale}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <KeyHints items={[{ keyLabel: "u", description: "retune runtime" }, { keyLabel: "Ctrl+C", description: "stop the process" }]} />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Roscoe is onboarding on <Text color="magenta">{selectedResponderProtocol}</Text>. Future Guild lanes are set to <Text color="cyan">{selectedGuildProvider}</Text>.
            </Text>
          </Box>
          {initialMode !== "refine" && workspaceAssessment && (
            <Box marginTop={1}>
              <Text dimColor>Workspace assessment: {workspaceAssessment.summary}</Text>
            </Box>
          )}
        </Panel>

        {runtimeEditorOpen && (
          <RuntimeEditorPanel
            protocol={selectedGuildProvider}
            responderProvider={selectedResponderProtocol}
            allowedProviders={allowedProviders}
            runtime={savedBaselineRuntime}
            responderRuntime={savedResponderRuntime}
            workerGovernanceMode={selectedWorkerGovernanceMode}
            verificationCadence={selectedVerificationCadence}
            tokenEfficiencyMode={selectedTokenEfficiencyMode}
            responderApprovalMode={selectedResponderApprovalMode}
            onApply={applyRuntimeEdit}
          />
        )}

        {/* Q&A history from prior rounds */}
        {s.qaHistory.length > 0 && (
          <Panel title="Interview Trail" subtitle="Decisions already captured">
            {s.qaHistory.map((qa, i) => (
              <CompletedQA key={i} qa={qa} index={i} />
            ))}
          </Panel>
        )}

        {/* Thinking / reasoning */}
        {s.thinkingText && (
          <Panel
            title="Roscoe Read"
            subtitle="Live exploration and planning notes"
            accentColor="magenta"
          >
            <Text dimColor italic wrap="wrap">
              {s.thinkingText.split("\n").slice(-10).join("\n")}
            </Text>
          </Panel>
        )}

        {/* Streaming analysis text with markdown */}
        {s.streamingText && (
          <Panel
            title="Live Analysis"
            subtitle={
              initialMode === "refine"
                ? "Saved-brief refinement before the interview"
                : workspaceAssessment?.mode === "greenfield"
                  ? "Vision and scaffold intake before the interview"
                  : "Repo-grounded intake before the interview"
            }
            accentColor="gray"
          >
            <Text wrap="wrap">{renderMd(s.streamingText)}</Text>
          </Panel>
        )}

        <Text color="cyan">
          {HEARTBEAT_FRAMES[heartbeat % HEARTBEAT_FRAMES.length]}{" "}
          {s.toolActivity
            ? `Using ${s.toolActivity}...`
            : s.status === "initializing"
              ? "Starting Roscoe..."
              : initialMode === "refine"
                ? "Refining the saved project understanding..."
                : workspaceAssessment?.mode === "greenfield"
                  ? "Assessing the greenfield workspace..."
                  : "Exploring the repo..."}
        </Text>
      </Box>
    );
  }

  // ── Interview (multiple choice) ──
  if (s.status === "interviewing") {
    const options = s.question ? buildOptions(s.question.options) : [];
    const currentSecretRequest = s.secretRequest;

    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Panel
          title="Roscoe Intent Interview"
          subtitle={
            initialMode === "refine"
              ? "Targeted follow-up questions to update the saved brief with the saved Guild and Roscoe defaults"
              : workspaceAssessment?.mode === "greenfield"
                ? "Vision- and architecture-grounded questions to define the project contract before the build starts"
                : "Codebase-grounded questions to pin down intent and definition of done with the saved Guild and Roscoe defaults"
          }
          accentColor="cyan"
          rightLabel={`Q${s.qaHistory.length + 1}`}
        >
          <RuntimeSummaryPills
            protocol={selectedGuildProvider}
            responderProvider={selectedResponderProtocol}
            runtime={savedBaselineRuntime}
            responderRuntime={runtimePackage.runtimeDefaults.responderByProtocol?.[selectedResponderProtocol]}
            workerGovernanceMode={selectedWorkerGovernanceMode}
            verificationCadence={selectedVerificationCadence}
            tokenEfficiencyMode={selectedTokenEfficiencyMode}
            responderApprovalMode={selectedResponderApprovalMode}
          />
          {selectedTuningMode === "auto" && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                Current interview turn: <Text color="cyan">{runtimePackage.onboardingPlan.summary}</Text>
              </Text>
              <Text dimColor>
                Saved Guild baseline: <Text color="yellow">{selectedModel} / {selectedEffort}</Text>
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <KeyHints items={[{ keyLabel: "u", description: "retune runtime" }, { keyLabel: "Enter", description: "submit selection or free text" }]} />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Roscoe is interviewing on <Text color="magenta">{selectedResponderProtocol}</Text>. Future Guild lanes are set to <Text color="cyan">{selectedGuildProvider}</Text>.
            </Text>
          </Box>
        </Panel>

        {runtimeEditorOpen && (
          <RuntimeEditorPanel
            protocol={selectedGuildProvider}
            responderProvider={selectedResponderProtocol}
            allowedProviders={allowedProviders}
            runtime={savedBaselineRuntime}
            responderRuntime={savedResponderRuntime}
            workerGovernanceMode={selectedWorkerGovernanceMode}
            verificationCadence={selectedVerificationCadence}
            tokenEfficiencyMode={selectedTokenEfficiencyMode}
            responderApprovalMode={selectedResponderApprovalMode}
            onApply={applyRuntimeEdit}
          />
        )}

        {/* Completed Q&A pairs */}
        {s.qaHistory.length > 0 && (
          <Panel title="Interview Trail" subtitle="Context already locked in">
            {s.qaHistory.map((qa, i) => (
              <CompletedQA key={i} qa={qa} index={i} />
            ))}
          </Panel>
        )}

        {/* Analysis summary with markdown */}
        {s.streamingText && (
          <Panel title="Current Read" subtitle="What Roscoe has learned from the repo and your answers so far">
            <Text wrap="wrap">{renderMd(s.streamingText)}</Text>
          </Panel>
        )}

        {currentSecretRequest && (
          <Panel
            title={`Secure Secret ${s.qaHistory.length + 1}`}
            subtitle={currentSecretRequest.purpose}
            accentColor="yellow"
          >
            <Box marginBottom={1} flexDirection="column">
              <Text bold>{currentSecretRequest.label}</Text>
              <Text dimColor>
                Roscoe needs <Text color="cyan">{currentSecretRequest.key}</Text> and will save it to <Text color="magenta">{currentSecretRequest.targetFile}</Text>.
                {currentSecretRequest.required ? " This is marked as required." : " This can be skipped for now."}
              </Text>
            </Box>

            {currentSecretRequest.instructions.length > 0 && (
              <Box marginBottom={1} flexDirection="column">
                <Text color="yellow">How to get it</Text>
                {currentSecretRequest.instructions.map((instruction, index) => (
                  <Text key={`${currentSecretRequest.key}-instruction-${index}`} dimColor>{index + 1}. {instruction}</Text>
                ))}
              </Box>
            )}

            {currentSecretRequest.links.length > 0 && (
              <Box marginBottom={1} flexDirection="column">
                <Text color="yellow">Official links</Text>
                {currentSecretRequest.links.map((link, index) => (
                  <Text key={`${currentSecretRequest.key}-link-${index}`} dimColor>
                    {link.label}: {link.url}
                  </Text>
                ))}
              </Box>
            )}

            <SecretInput
              request={currentSecretRequest}
              onSubmit={(value) => sendSecretInput(currentSecretRequest, value)}
              onSkip={() => skipSecretInput(currentSecretRequest)}
            />
          </Panel>
        )}

        {/* Current question with Select */}
        {s.question && !s.secretRequest && !freeTextMode && s.question.selectionMode === "single" && (
          <Panel
            title={`Question ${s.qaHistory.length + 1}`}
            subtitle={s.question.purpose ?? "Pick the closest answer or choose Other"}
            accentColor="yellow"
          >
            <Box marginBottom={1}>
              {s.question.theme && (
                <Text dimColor>[{s.question.theme}]</Text>
              )}
              <Text bold>{s.question.text}</Text>
            </Box>
            <Select
              options={options}
              visibleOptionCount={options.length}
              onChange={handleSelect}
            />
          </Panel>
        )}

        {s.question && !s.secretRequest && !freeTextMode && s.question.selectionMode === "multi" && (
          <Panel
            title={`Question ${s.qaHistory.length + 1}`}
            subtitle={s.question.purpose ?? "Choose all answers that apply"}
            accentColor="yellow"
          >
            <Box marginBottom={1} flexDirection="column">
              {s.question.theme && (
                <Text dimColor>[{s.question.theme}]</Text>
              )}
              <Text bold>{s.question.text}</Text>
            </Box>
            <ChecklistSelect
              options={buildOptions(s.question.options).map((option) => option.value)}
              exclusiveValue={SKIP_OPTION}
              onSubmit={handleMultiSelectSubmit}
            />
          </Panel>
        )}

        {/* Free text input for "Other" */}
        {freeTextMode && !s.secretRequest && (
          <Panel
            title={`Question ${s.qaHistory.length + 1}`}
            subtitle={s.question?.purpose ?? "Free-form answer"}
            accentColor="yellow"
          >
            <Box marginBottom={1}>
              {s.question?.theme && (
                <Text dimColor>[{s.question.theme}]</Text>
              )}
              <Text bold>{s.question?.text ?? ""}</Text>
            </Box>
            {pendingStructuredAnswer?.selectedOptions?.length ? (
              <Box marginBottom={1}>
                <Text dimColor>Selected options: {pendingStructuredAnswer.selectedOptions.join(" | ")}</Text>
              </Box>
            ) : null}
            <Box>
              <Text color="yellow">Your answer: </Text>
              <TextInput
                key={freeTextKey}
                placeholder="Type your answer..."
                onSubmit={handleFreeText}
              />
            </Box>
          </Panel>
        )}

        {/* No question parsed — fallback to text input */}
        {!s.question && !s.secretRequest && !freeTextMode && (
          <Panel title="Reply" subtitle="Fallback text input" accentColor="yellow">
            <Box>
              <Text color="yellow">Your input: </Text>
              <TextInput
                key={freeTextKey}
                placeholder="Type your response..."
                onSubmit={(v) => {
                  if (v.trim()) {
                    setFreeTextKey((k) => k + 1);
                    sendInput(v.trim());
                  }
                }}
              />
            </Box>
          </Panel>
        )}
      </Box>
    );
  }

  // ── Complete — show briefly then return home ──
  if (s.status === "complete") {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        {s.qaHistory.length > 0 && (
          <Panel title="Interview Trail" subtitle="Captured decisions">
            {s.qaHistory.map((qa, i) => (
              <CompletedQA key={i} qa={qa} index={i} />
            ))}
          </Panel>
        )}
        <Panel title="Onboarding Complete" subtitle="Project memory has been written" accentColor="green">
          <Box gap={1} flexWrap="wrap">
            {s.projectContext && <Pill label={s.projectContext.name} color="green" />}
            {s.projectContext && <Pill label={formatWorkerGovernanceLabel(getWorkerGovernanceMode(s.projectContext))} color="cyan" />}
            {s.projectContext && <Pill label={formatResponderApprovalLabel(getResponderApprovalMode(s.projectContext) ?? "auto")} color="green" />}
            <Text>
              {s.projectContext
                ? `Roscoe is trained on "${s.projectContext.name}" and ready to guide Guild sessions. Returning to home...`
                : "Project registered. Returning to home..."}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Later, start a Guild lane and press <Text color="cyan">u</Text> to adjust runtime, Guild check-ins, or when Roscoe asks you.</Text>
          </Box>
        </Panel>
      </Box>
    );
  }

  // ── Error ──
  return (
    <Box flexDirection="column" padding={1}>
      <StatusMessage variant="error">
        {s.error ?? "Unknown error"}
      </StatusMessage>
    </Box>
  );
}
