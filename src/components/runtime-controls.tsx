import React, { useState } from "react";
import { Box, Text } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import { LLMProtocol, RuntimeControlSettings, RuntimeTuningMode } from "../llm-runtime.js";
import { getRuntimeTuningMode, getTopModel } from "../runtime-defaults.js";
import { KeyHints, Panel, Pill } from "./chrome.js";

export interface RuntimeEditorDraft {
  tuningMode: RuntimeTuningMode;
  model: string;
  reasoningEffort: string;
}

type RuntimeEditorStep = "mode" | "model" | "effort";

export function getReasoningOptions(protocol: LLMProtocol): string[] {
  return protocol === "claude"
    ? ["low", "medium", "high", "max"]
    : ["low", "medium", "high", "xhigh"];
}

export function createRuntimeEditorDraft(
  protocol: LLMProtocol,
  runtime: RuntimeControlSettings | null | undefined,
): RuntimeEditorDraft {
  return {
    tuningMode: getRuntimeTuningMode(runtime),
    model: runtime?.model ?? getTopModel(protocol),
    reasoningEffort: runtime?.reasoningEffort ?? getReasoningOptions(protocol)[getReasoningOptions(protocol).length - 1],
  };
}

export function RuntimeSummaryPills({
  protocol,
  runtime,
}: {
  protocol: LLMProtocol;
  runtime: RuntimeControlSettings | null | undefined;
}) {
  const tuningMode = getRuntimeTuningMode(runtime);
  const executionMode = runtime?.executionMode === "accelerated" ? "accelerated" : "safe";
  const model = runtime?.model ?? getTopModel(protocol);
  const effort = runtime?.reasoningEffort ?? getReasoningOptions(protocol)[getReasoningOptions(protocol).length - 1];

  return (
    <Box gap={1} flexWrap="wrap">
      <Pill label={`${protocol} locked`} color="cyan" />
      <Pill label={tuningMode === "auto" ? "auto-manage" : "manual"} color={tuningMode === "auto" ? "green" : "yellow"} />
      <Pill label={model} color="yellow" />
      <Pill label={effort} color="magenta" />
      <Pill label={executionMode} color={executionMode === "accelerated" ? "red" : "green"} />
    </Box>
  );
}

export function RuntimeEditorPanel({
  protocol,
  runtime,
  scopeLabel,
  onApply,
  accentColor = "cyan",
}: {
  protocol: LLMProtocol;
  runtime: RuntimeControlSettings | null | undefined;
  scopeLabel: string;
  onApply: (draft: RuntimeEditorDraft) => void;
  accentColor?: string;
}) {
  const initialDraft = createRuntimeEditorDraft(protocol, runtime);
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState<RuntimeEditorStep>("mode");
  const [modelInputKey, setModelInputKey] = useState(0);

  const modeOptions = [
    { label: "Auto-manage model and reasoning inside this provider", value: "auto" },
    { label: "Manual pin on the chosen model and reasoning effort", value: "manual" },
  ];
  const effortOptions = getReasoningOptions(protocol).map((value) => ({ label: value, value }));

  return (
    <Panel
      title="Runtime Controls"
      subtitle={`Provider stays on ${protocol}. ${scopeLabel}`}
      accentColor={accentColor}
      rightLabel={`Step ${step === "mode" ? 1 : step === "model" ? 2 : 3}/3`}
    >
      <RuntimeSummaryPills protocol={protocol} runtime={draft} />
      <Box marginTop={1}>
        <KeyHints items={[{ keyLabel: "Enter", description: "confirm" }, { keyLabel: "Esc", description: "cancel" }]} />
      </Box>

      {step === "mode" && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>Runtime management:</Text>
          <Select
            options={modeOptions}
            onChange={(value) => {
              setDraft((current) => ({ ...current, tuningMode: value as RuntimeTuningMode }));
              setStep("model");
              setModelInputKey((current) => current + 1);
            }}
          />
        </Box>
      )}

      {step === "model" && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>Model:</Text>
          <Box>
            <Text color="yellow">Model: </Text>
            <TextInput
              key={modelInputKey}
              defaultValue={draft.model}
              onSubmit={(value) => {
                setDraft((current) => ({
                  ...current,
                  model: value.trim() || current.model || getTopModel(protocol),
                }));
                setStep("effort");
              }}
            />
          </Box>
        </Box>
      )}

      {step === "effort" && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>Reasoning effort:</Text>
          <Select
            options={effortOptions}
            onChange={(value) => {
              const nextDraft = { ...draft, reasoningEffort: value };
              setDraft(nextDraft);
              onApply(nextDraft);
            }}
          />
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {draft.tuningMode === "auto"
            ? "Roscoe may retune effort and step back up to the top in-provider model when the work gets heavier."
            : "Roscoe will hold this provider, model, and reasoning effort steady until you change them again."}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{scopeLabel}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          <Text color="cyan">Esc</Text> returns without changing the runtime.
        </Text>
      </Box>
    </Panel>
  );
}
