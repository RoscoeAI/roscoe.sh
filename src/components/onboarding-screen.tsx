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
import { listProfiles, loadProfile, loadProjectContext, OnboardingMode, ProjectRuntimeDefaults } from "../config.js";
import { detectProtocol, RuntimeControlSettings } from "../llm-runtime.js";
import {
  applyRuntimeSettings,
  getAcceleratedWorkerRuntime,
  getDefaultOnboardingRuntime,
  getDefaultWorkerRuntime,
  getLockedProjectProvider,
  getTopModel,
  mergeRuntimeSettings,
  recommendOnboardingRuntime,
} from "../runtime-defaults.js";
import {
  RuntimeEditorPanel,
  RuntimeSummaryPills,
  getReasoningOptions,
} from "./runtime-controls.js";
import { ChecklistSelect } from "./checklist-select.js";

interface OnboardingScreenProps {
  dir?: string;
  debug?: boolean;
  initialProfileName?: string;
  initialRuntimeOverrides?: RuntimeControlSettings;
  initialMode?: OnboardingMode;
  initialRefineThemes?: string[];
}

type SetupStep = "directory" | "themes" | "profile" | "model" | "effort" | "tuning" | "execution";

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

function getSetupOrder(mode: OnboardingMode, hasPresetDirectory: boolean): SetupStep[] {
  if (mode === "refine") {
    return hasPresetDirectory
      ? ["themes", "model", "effort", "tuning", "execution"]
      : ["directory", "themes", "model", "effort", "tuning", "execution"];
  }

  return hasPresetDirectory
    ? ["profile", "model", "effort", "tuning", "execution"]
    : ["directory", "profile", "model", "effort", "tuning", "execution"];
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

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

/** List subdirectories matching the current input for autocomplete */
function getDirSuggestions(input: string): string[] {
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

export function OnboardingScreen({
  dir,
  debug,
  initialProfileName,
  initialRuntimeOverrides,
  initialMode = "onboard",
  initialRefineThemes = [],
}: OnboardingScreenProps) {
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
  const [step, setStep] = useState<SetupStep>(initialSetupOrder[0]);
  const [selectedDir, setSelectedDir] = useState(resolvedDir);
  const [selectedProfileName, setSelectedProfileName] = useState(initialSelectedProfileName);
  const initialProtocol = detectProtocol(loadProfile(initialSelectedProfileName));
  const initialRuntime = mergeRuntimeSettings(
    getDefaultOnboardingRuntime(initialProtocol),
    initialRuntimeOverrides,
  );
  const [selectedModel, setSelectedModel] = useState(initialRuntime.model ?? getTopModel(initialProtocol));
  const [selectedEffort, setSelectedEffort] = useState(initialRuntime.reasoningEffort ?? (initialProtocol === "claude" ? "max" : "xhigh"));
  const [selectedTuningMode, setSelectedTuningMode] = useState<"manual" | "auto">(initialRuntime.tuningMode === "manual" ? "manual" : "auto");
  const [selectedExecutionMode, setSelectedExecutionMode] = useState<"safe" | "accelerated">(initialRuntime.executionMode === "accelerated" ? "accelerated" : "safe");
  const [selectedRefineThemes, setSelectedRefineThemes] = useState<string[]>(initialRefineThemes);

  const [started, setStarted] = useState(false);
  const [freeTextMode, setFreeTextMode] = useState(false);
  const [freeTextKey, setFreeTextKey] = useState(0);
  const [modelInputKey, setModelInputKey] = useState(0);
  const [runtimeEditorOpen, setRuntimeEditorOpen] = useState(false);
  const [pendingStructuredAnswer, setPendingStructuredAnswer] = useState<{
    mode: "single" | "multi";
    selectedOptions: string[];
  } | null>(null);
  const [heartbeat, setHeartbeat] = useState(0);

  const selectedProtocol = useMemo(
    () => detectProtocol(loadProfile(selectedProfileName)),
    [selectedProfileName],
  );
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
    if (!started || (s.status !== "initializing" && s.status !== "running")) return;
    const timer = setInterval(() => {
      setHeartbeat((current) => current + 1);
    }, 160);
    return () => clearInterval(timer);
  }, [started, s.status]);

  const buildRuntimePackage = (
    executionMode: "safe" | "accelerated" = selectedExecutionMode,
    overrides?: Partial<RuntimeControlSettings>,
  ) => {
    const protocol = selectedProtocol;
    const baseProfile = loadProfile(selectedProfileName);
    const tuningMode = overrides?.tuningMode === "manual" || overrides?.tuningMode === "auto"
      ? overrides.tuningMode
      : selectedTuningMode;
    const model = overrides?.model ?? selectedModel;
    const reasoningEffort = overrides?.reasoningEffort ?? selectedEffort;
    const onboardingRuntime = mergeRuntimeSettings(
      executionMode === "accelerated"
        ? getAcceleratedWorkerRuntime(protocol)
        : getDefaultOnboardingRuntime(protocol),
      {
        tuningMode,
        model,
        reasoningEffort,
        executionMode,
      },
    );
    const baselineProfile = applyRuntimeSettings(baseProfile, onboardingRuntime);
    const onboardingPlan = recommendOnboardingRuntime(baselineProfile);
    const resolvedProfile = onboardingPlan.profile;
    const workerByProtocol: ProjectRuntimeDefaults["workerByProtocol"] = {
      claude: getDefaultWorkerRuntime("claude"),
      codex: getDefaultWorkerRuntime("codex"),
    };
    workerByProtocol[protocol] = mergeRuntimeSettings(
      executionMode === "accelerated"
        ? getAcceleratedWorkerRuntime(protocol)
        : getDefaultWorkerRuntime(protocol),
      {
        tuningMode,
        model,
        reasoningEffort,
        executionMode,
      },
    );

    const runtimeDefaults: ProjectRuntimeDefaults = {
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

    if (!key.escape) return;

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

  const handleDirSubmit = (value: string) => {
    const resolved = resolve(expandTilde(value.trim()));
    if (!resolved) return;
    setSelectedDir(resolved);
    setStep(initialMode === "refine" ? "themes" : "profile");
  };

  const handleProfileSelect = (profileName: string) => {
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

  const handleModelSubmit = (value: string) => {
    const protocol = selectedProtocol;
    const trimmed = value.trim();
    setSelectedModel(trimmed || getTopModel(protocol));
    setStep("effort");
  };

  const startConfiguredOnboarding = (executionMode: "safe" | "accelerated") => {
    const { resolvedProfile, runtimeDefaults } = buildRuntimePackage(executionMode);

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

  const applyRuntimeEdit = (draft: { tuningMode: "manual" | "auto"; model: string; reasoningEffort: string }) => {
    setSelectedModel(draft.model);
    setSelectedEffort(draft.reasoningEffort);
    setSelectedTuningMode(draft.tuningMode);
    const { resolvedProfile, runtimeDefaults } = buildRuntimePackage(selectedExecutionMode, draft);
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
    [selectedExecutionMode, selectedExecutionMode, selectedEffort, selectedModel, selectedProfileName, selectedProtocol, selectedTuningMode],
  );
  const savedBaselineRuntime = useMemo(
    () => mergeRuntimeSettings(
      selectedExecutionMode === "accelerated"
        ? getAcceleratedWorkerRuntime(selectedProtocol)
        : getDefaultOnboardingRuntime(selectedProtocol),
      {
        tuningMode: selectedTuningMode,
        model: selectedModel,
        reasoningEffort: selectedEffort,
        executionMode: selectedExecutionMode,
      },
    ),
    [selectedExecutionMode, selectedEffort, selectedModel, selectedProtocol, selectedTuningMode],
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
  if (!started) {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Panel
          title={initialMode === "refine" ? "Refine Roscoe" : "Train Roscoe"}
          subtitle={
            initialMode === "refine"
              ? "Keep the locked provider, choose the themes to revisit, and let Roscoe refine the saved understanding without rerunning the full intake"
              : "Choose the locked provider for this project, then let Roscoe explore the repo and run an intent interview before saving project defaults"
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
              protocol={selectedProtocol}
              runtime={runtimePackage.resolvedProfile.runtime}
            />
          </Box>
          {selectedTuningMode === "auto" && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                Current onboarding turn: <Text color="cyan">{runtimePackage.onboardingPlan.summary}</Text>
              </Text>
              <Text dimColor>
                Saved baseline for future turns: <Text color="magenta">{selectedModel} / {selectedEffort}</Text>
              </Text>
              <Text dimColor>{runtimePackage.onboardingPlan.rationale}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              Onboarding locks the project to <Text color="cyan">{selectedProtocol}</Text>. Later you can still retune model and reasoning inside that provider or let Roscoe auto-manage them.
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
            <Box>
              <Text color="yellow">Project directory: </Text>
              <DirInput onSubmit={handleDirSubmit} />
            </Box>
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
                setStep("model");
              }}
            />
          </Panel>
        )}

        {step === "profile" && initialMode === "onboard" && (
          <Panel title="Roscoe Runtime" subtitle="Choose the provider Roscoe will use. This provider becomes the project lock after onboarding." accentColor="yellow">
            <Select options={profileItems} onChange={handleProfileSelect} />
            <Box marginTop={1}>
              <Text dimColor>
                Model and reasoning stay editable later. Switching Claude ↔ Codex after onboarding is not allowed for a trained project.
              </Text>
            </Box>
          </Panel>
        )}

        {step === "model" && (
          <Panel title="Model" subtitle="Best model is prefilled; submit to keep or replace with a custom model id" accentColor="yellow">
            <Box>
              <Text color="yellow">Model: </Text>
              <TextInput
                key={modelInputKey}
                defaultValue={selectedModel}
                onSubmit={handleModelSubmit}
              />
            </Box>
          </Panel>
        )}

        {step === "effort" && (
          <Panel title="Reasoning Effort" subtitle="Tune depth for the onboarding run and save it as the project default" accentColor="yellow">
            <Select
              options={effortItems}
              onChange={(value) => {
                setSelectedEffort(value);
                setStep("tuning");
              }}
            />
          </Panel>
        )}

        {step === "tuning" && (
          <Panel
            title="Runtime Management"
            subtitle="Auto lets Roscoe retune model and reasoning inside the locked provider. Manual pins the chosen settings until you change them."
            accentColor="yellow"
          >
            <Select
              options={tuningItems}
              onChange={(value) => {
                setSelectedTuningMode(value as "manual" | "auto");
                setStep("execution");
              }}
            />
          </Panel>
        )}

        {step === "execution" && (
          <Panel
            title="Execution Mode"
            subtitle="Safe autonomous uses provider-safe defaults that keep the agent moving; accelerated relaxes permissions for faster iteration"
            accentColor={selectedExecutionMode === "accelerated" ? "red" : "green"}
          >
            <Select
              options={executionItems}
              onChange={(value) => {
                startConfiguredOnboarding(value as "safe" | "accelerated");
              }}
            />
          </Panel>
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
              ? "Loading the saved brief, then tightening only the chosen themes inside the locked provider"
              : "Exploring the codebase first, then preparing the intent interview inside the locked provider"
          }
          accentColor="cyan"
          rightLabel={s.toolActivity ? `tool ${s.toolActivity}` : s.status}
        >
          <RuntimeSummaryPills
            protocol={selectedProtocol}
            runtime={runtimePackage.resolvedProfile.runtime}
          />
          {selectedTuningMode === "auto" && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                Current onboarding turn: <Text color="cyan">{runtimePackage.onboardingPlan.summary}</Text>
              </Text>
              <Text dimColor>
                Saved baseline: <Text color="magenta">{selectedModel} / {selectedEffort}</Text>
              </Text>
              <Text dimColor>{runtimePackage.onboardingPlan.rationale}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <KeyHints items={[{ keyLabel: "u", description: "retune runtime" }, { keyLabel: "Ctrl+C", description: "stop the process" }]} />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Provider stays on <Text color="cyan">{selectedProtocol}</Text>. Only model and reasoning can change from here.
            </Text>
          </Box>
        </Panel>

        {runtimeEditorOpen && (
          <RuntimeEditorPanel
            protocol={selectedProtocol}
            runtime={savedBaselineRuntime}
            scopeLabel="Changes apply to Roscoe's next onboarding turn and the saved project default for this provider."
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
          <Panel title="Live Analysis" subtitle="Repo-grounded intake before the interview" accentColor="gray">
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
                : "Exploring the repo..."}
        </Text>
      </Box>
    );
  }

  // ── Interview (multiple choice) ──
  if (s.status === "interviewing") {
    const options = s.question ? buildOptions(s.question.options) : [];

    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Panel
          title="Roscoe Intent Interview"
          subtitle={
            initialMode === "refine"
              ? "Targeted follow-up questions to update the saved brief inside the locked provider"
              : "Codebase-grounded questions to pin down intent and definition of done inside the locked provider"
          }
          accentColor="cyan"
          rightLabel={`Q${s.qaHistory.length + 1}`}
        >
          <RuntimeSummaryPills
            protocol={selectedProtocol}
            runtime={runtimePackage.resolvedProfile.runtime}
          />
          {selectedTuningMode === "auto" && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                Current interview turn: <Text color="cyan">{runtimePackage.onboardingPlan.summary}</Text>
              </Text>
              <Text dimColor>
                Saved baseline: <Text color="magenta">{selectedModel} / {selectedEffort}</Text>
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <KeyHints items={[{ keyLabel: "u", description: "retune runtime" }, { keyLabel: "Enter", description: "submit selection or free text" }]} />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Roscoe may retune model and reasoning inside <Text color="cyan">{selectedProtocol}</Text>, but this project will not switch providers after onboarding.
            </Text>
          </Box>
        </Panel>

        {runtimeEditorOpen && (
          <RuntimeEditorPanel
            protocol={selectedProtocol}
            runtime={savedBaselineRuntime}
            scopeLabel="Changes apply to Roscoe's next interview turn and the saved project default for this provider."
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

        {/* Current question with Select */}
        {s.question && !freeTextMode && s.question.selectionMode === "single" && (
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

        {s.question && !freeTextMode && s.question.selectionMode === "multi" && (
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
        {freeTextMode && (
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
        {!s.question && !freeTextMode && (
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
          <Box gap={1}>
            {s.projectContext && <Pill label={s.projectContext.name} color="green" />}
            <Text>
              {s.projectContext
                ? `Roscoe is trained on "${s.projectContext.name}" and ready to guide Guild sessions. Returning to home...`
                : "Project registered. Returning to home..."}
            </Text>
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
