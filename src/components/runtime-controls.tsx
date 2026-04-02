import React, { useState } from "react";
import { Box, Text } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import { getProviderAdapter, LLMProtocol, RuntimeControlSettings, RuntimeExecutionMode, RuntimeTuningMode } from "../llm-runtime.js";
import { ResponderApprovalMode, TokenEfficiencyMode, VerificationCadence, WorkerGovernanceMode } from "../config.js";
import {
  formatTokenEfficiencyLabel,
  formatVerificationCadenceLabel,
  formatResponderApprovalLabel,
  formatWorkerGovernanceLabel,
  getExecutionModeLabel,
  getRuntimeTuningMode,
  getTopModel,
} from "../runtime-defaults.js";
import { KeyHints, Panel, Pill } from "./chrome.js";

export interface RuntimeEditorDraft {
  workerProvider: LLMProtocol;
  workerTuningMode: RuntimeTuningMode;
  workerExecutionMode: RuntimeExecutionMode;
  workerModel: string;
  workerReasoningEffort: string;
  responderProvider: LLMProtocol;
  responderModel: string;
  responderReasoningEffort: string;
  workerGovernanceMode: WorkerGovernanceMode;
  verificationCadence: VerificationCadence;
  tokenEfficiencyMode: TokenEfficiencyMode;
  responderApprovalMode: ResponderApprovalMode;
}

type RuntimeEditorStep =
  | "guild-provider"
  | "guild-mode"
  | "guild-model"
  | "guild-effort"
  | "roscoe-provider"
  | "roscoe-model"
  | "roscoe-effort"
  | "execution"
  | "governance"
  | "verification"
  | "efficiency"
  | "approval";

function getStepLabel(step: RuntimeEditorStep): string {
  return step === "guild-provider"
    ? "Guild provider"
    : step === "guild-mode"
    ? "Guild runtime"
    : step === "guild-model"
      ? "Guild model"
      : step === "guild-effort"
        ? "Guild reasoning"
        : step === "roscoe-provider"
          ? "Roscoe provider"
          : step === "roscoe-model"
          ? "Roscoe model"
          : step === "roscoe-effort"
            ? "Roscoe reasoning"
            : step === "execution"
              ? "Execution mode"
            : step === "governance"
              ? "Guild check-ins"
              : step === "verification"
                ? "Verification cadence"
                : step === "efficiency"
                  ? "Token efficiency"
                  : "Roscoe approval";
}

function getStepHelp(step: RuntimeEditorStep): string {
  return step === "guild-provider"
    ? "Choose which provider Guild lanes should use for this project."
    : step === "guild-mode"
    ? "Decide whether Roscoe chooses the Guild worker's runtime dynamically or you pin it manually."
    : step === "guild-model"
      ? "Choose the pinned Guild model."
      : step === "guild-effort"
        ? "Choose the pinned Guild reasoning level."
        : step === "roscoe-provider"
          ? "Choose which provider Roscoe should use for drafting replies."
          : step === "roscoe-model"
          ? "Choose Roscoe's preferred responder model."
          : step === "roscoe-effort"
            ? "Choose Roscoe's preferred responder reasoning level."
            : step === "execution"
              ? "Choose whether Guild and Roscoe use safe defaults or accelerated filesystem/network access."
            : step === "governance"
              ? "Choose when Guild must stop and check in with Roscoe."
              : step === "verification"
                ? "Choose when Guild and Roscoe rerun the heavy repo-wide proof stack."
                : step === "efficiency"
                  ? "Choose whether Roscoe stays balanced or deliberately lighter on token use."
                  : "Choose whether Roscoe auto-sends or always stops and asks you first.";
}

function getCurrentValueLabel(
  step: RuntimeEditorStep,
  draft: RuntimeEditorDraft,
): string {
  return step === "guild-provider"
    ? `Guild provider: ${draft.workerProvider}`
    : step === "guild-mode"
    ? (draft.workerTuningMode === "auto" ? "Guild runtime is dynamic" : "Guild runtime is pinned manually")
    : step === "guild-model"
      ? `Guild model: ${draft.workerModel}`
      : step === "guild-effort"
        ? `Guild reasoning: ${draft.workerReasoningEffort}`
        : step === "roscoe-provider"
          ? `Roscoe provider: ${draft.responderProvider}`
          : step === "roscoe-model"
          ? `Roscoe model: ${draft.responderModel}`
          : step === "roscoe-effort"
            ? `Roscoe reasoning: ${draft.responderReasoningEffort}`
            : step === "execution"
              ? `Execution mode: ${draft.workerExecutionMode}`
            : step === "governance"
              ? `Guild check-ins: ${formatWorkerGovernanceLabel(draft.workerGovernanceMode)}`
              : step === "verification"
                ? `Proof cadence: ${formatVerificationCadenceLabel(draft.verificationCadence)}`
                : step === "efficiency"
                  ? `Token use: ${formatTokenEfficiencyLabel(draft.tokenEfficiencyMode)}`
                  : `Roscoe approval: ${formatResponderApprovalLabel(draft.responderApprovalMode)}`;
}

export function getReasoningOptions(protocol: LLMProtocol): string[] {
  return getProviderAdapter(protocol).reasoningOptions;
}

function getRuntimeIdentity(protocol: LLMProtocol, runtime: RuntimeControlSettings | null | undefined): string {
  const model = runtime?.model ?? getTopModel(protocol);
  const effort = runtime?.reasoningEffort ?? getReasoningOptions(protocol)[getReasoningOptions(protocol).length - 1];
  return `${model}/${effort}`;
}

function getVisibleOptionCount(options: Array<{ label: string; value: string }>): number {
  return Math.max(1, Math.min(options.length, 4));
}

export function createRuntimeEditorDraft(
  protocol: LLMProtocol,
  workerRuntime: RuntimeControlSettings | null | undefined,
  responderProvider: LLMProtocol,
  responderRuntime: RuntimeControlSettings | null | undefined,
  workerGovernanceMode: WorkerGovernanceMode = "roscoe-arbiter",
  verificationCadence: VerificationCadence = "batched",
  tokenEfficiencyMode: TokenEfficiencyMode = "save-tokens",
  responderApprovalMode: ResponderApprovalMode = "auto",
): RuntimeEditorDraft {
  return {
    workerProvider: protocol,
    workerTuningMode: getRuntimeTuningMode(workerRuntime),
    workerExecutionMode: getExecutionModeLabel(workerRuntime) as RuntimeExecutionMode,
    workerModel: workerRuntime?.model ?? getTopModel(protocol),
    workerReasoningEffort: workerRuntime?.reasoningEffort ?? getReasoningOptions(protocol)[getReasoningOptions(protocol).length - 1],
    responderProvider,
    responderModel: responderRuntime?.model ?? workerRuntime?.model ?? getTopModel(protocol),
    responderReasoningEffort: responderRuntime?.reasoningEffort ?? workerRuntime?.reasoningEffort ?? getReasoningOptions(protocol)[getReasoningOptions(protocol).length - 1],
    workerGovernanceMode,
    verificationCadence,
    tokenEfficiencyMode,
    responderApprovalMode,
  };
}

export function RuntimeSummaryPills({
  protocol,
  responderProvider,
  runtime,
  responderRuntime,
  workerGovernanceMode,
  verificationCadence,
  tokenEfficiencyMode,
  responderApprovalMode,
}: {
  protocol: LLMProtocol;
  responderProvider?: LLMProtocol;
  runtime: RuntimeControlSettings | null | undefined;
  responderRuntime?: RuntimeControlSettings | null | undefined;
  workerGovernanceMode?: WorkerGovernanceMode;
  verificationCadence?: VerificationCadence;
  tokenEfficiencyMode?: TokenEfficiencyMode;
  responderApprovalMode?: ResponderApprovalMode;
}) {
  const executionMode = getExecutionModeLabel(runtime);
  const guildMode = getRuntimeTuningMode(runtime);

  return (
    <Box gap={1} flexWrap="wrap">
      <Pill label={`${protocol} locked`} color="cyan" />
      <Pill label={guildMode === "auto" ? "Guild dynamic" : "Guild pinned"} color={guildMode === "auto" ? "green" : "yellow"} />
      <Pill label={`Guild ${getRuntimeIdentity(protocol, runtime)}`} color="yellow" />
      <Pill label={`Roscoe ${getRuntimeIdentity(responderProvider ?? protocol, responderRuntime ?? runtime)}`} color="magenta" />
      <Pill label={executionMode} color={executionMode === "accelerated" ? "red" : "green"} />
      {workerGovernanceMode && (
        <Pill
          label={formatWorkerGovernanceLabel(workerGovernanceMode)}
          color={workerGovernanceMode === "roscoe-arbiter" ? "cyan" : "yellow"}
        />
      )}
      {verificationCadence && (
        <Pill
          label={formatVerificationCadenceLabel(verificationCadence)}
          color={verificationCadence === "batched" ? "green" : "yellow"}
        />
      )}
      {tokenEfficiencyMode && (
        <Pill
          label={formatTokenEfficiencyLabel(tokenEfficiencyMode)}
          color={tokenEfficiencyMode === "save-tokens" ? "yellow" : "green"}
        />
      )}
      {responderApprovalMode && (
        <Pill
          label={formatResponderApprovalLabel(responderApprovalMode)}
          color={responderApprovalMode === "auto" ? "green" : "yellow"}
        />
      )}
    </Box>
  );
}

export function RuntimeEditorPanel({
  protocol,
  responderProvider = protocol,
  allowedProviders,
  runtime,
  responderRuntime,
  workerGovernanceMode = "roscoe-arbiter",
  verificationCadence = "batched",
  tokenEfficiencyMode = "save-tokens",
  responderApprovalMode = "auto",
  onApply,
  accentColor = "cyan",
}: {
  protocol: LLMProtocol;
  responderProvider?: LLMProtocol;
  allowedProviders?: LLMProtocol[];
  runtime: RuntimeControlSettings | null | undefined;
  responderRuntime?: RuntimeControlSettings | null | undefined;
  workerGovernanceMode?: WorkerGovernanceMode;
  verificationCadence?: VerificationCadence;
  tokenEfficiencyMode?: TokenEfficiencyMode;
  responderApprovalMode?: ResponderApprovalMode;
  onApply: (draft: RuntimeEditorDraft) => void;
  accentColor?: string;
}) {
  const initialDraft = createRuntimeEditorDraft(
    protocol,
    runtime,
    responderProvider,
    responderRuntime,
    workerGovernanceMode,
    verificationCadence,
    tokenEfficiencyMode,
    responderApprovalMode,
  );
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState<RuntimeEditorStep>("guild-provider");
  const [guildModelInputKey, setGuildModelInputKey] = useState(0);
  const [roscoeModelInputKey, setRoscoeModelInputKey] = useState(0);
  const providerOrder = Array.from(new Set([...(allowedProviders ?? ["claude", "codex", "gemini"]), protocol, responderProvider]));
  const providerOptions = providerOrder.map((provider) => ({
    label: getProviderAdapter(provider).label,
    value: provider,
  }));
  const guildEffortOptions = getReasoningOptions(draft.workerProvider).map((value) => ({ label: value, value }));
  const roscoeEffortOptions = getReasoningOptions(draft.responderProvider).map((value) => ({ label: value, value }));

  const guildModeOptions = [
    { label: "Allow Roscoe to manage the Guild model and reasoning dynamically", value: "auto" },
    { label: "Pin the Guild model and reasoning manually", value: "manual" },
  ];
  const effortOptions = getReasoningOptions(protocol).map((value) => ({ label: value, value }));
  const governanceOptions = [
    { label: "Roscoe arbiter — Guild checks in before material changes", value: "roscoe-arbiter" },
    { label: "Guild direct — Guild acts directly inside the brief", value: "guild-autonomous" },
  ];
  const executionOptions = [
    { label: "Safe autonomous — keep provider-safe filesystem/network defaults", value: "safe" },
    { label: "Accelerated / unsafe — allow broader filesystem/network access", value: "accelerated" },
  ];
  const verificationOptions = [
    {
      label: "Batch full proof runs — use narrow checks while editing and rerun coverage/e2e after a meaningful chunk",
      value: "batched",
    },
    {
      label: "Prove each slice — rerun the canonical coverage/e2e proof after every focused slice",
      value: "prove-each-slice",
    },
  ];
  const approvalOptions = [
    { label: "Roscoe decides for me when confidence is high", value: "auto" },
    { label: "Roscoe always asks me before replying", value: "manual" },
  ];
  const efficiencyOptions = [
    { label: "Balanced — let Roscoe use normal depth for drafting", value: "balanced" },
    { label: "Efficient (default) — keep Roscoe lighter unless the transcript clearly needs more depth", value: "save-tokens" },
  ];

  return (
    <Panel
      title="Runtime & Governance"
      subtitle="Edit the live knobs for this project."
      accentColor={accentColor}
    >
      <Box>
        <KeyHints items={[{ keyLabel: "Enter", description: "choose" }, { keyLabel: "Esc", description: "close" }]} />
      </Box>
      <Box flexDirection="column">
        <Text dimColor>Editable here: Guild and Roscoe provider/runtime, execution, check-ins, proof cadence, token use, and approval.</Text>
        <Text dimColor>Guild and Roscoe model/reasoning stay visible in the header and can be pinned here.</Text>
      </Box>
      <Box flexDirection="column">
        <Text color="yellow" bold>Editable now: {getStepLabel(step)}</Text>
        <Text dimColor>{getStepHelp(step)}</Text>
        <Text dimColor>Current: {getCurrentValueLabel(step, draft)}</Text>
      </Box>

      {step === "guild-provider" && (
        <Box flexDirection="column">
          <Select
            options={providerOptions}
            visibleOptionCount={getVisibleOptionCount(providerOptions)}
            onChange={(value) => {
              const nextProvider = value as LLMProtocol;
              const nextModel = getTopModel(nextProvider);
              const nextEffortOptions = getReasoningOptions(nextProvider);
              setDraft((current) => ({
                ...current,
                workerProvider: nextProvider,
                workerModel: nextModel,
                workerReasoningEffort: nextEffortOptions[nextEffortOptions.length - 1],
              }));
              setStep("guild-mode");
            }}
          />
        </Box>
      )}

      {step === "guild-mode" && (
        <Box flexDirection="column">
          <Select
            options={guildModeOptions}
            visibleOptionCount={getVisibleOptionCount(guildModeOptions)}
            onChange={(value) => {
              const nextMode = value as RuntimeTuningMode;
              setDraft((current) => ({ ...current, workerTuningMode: nextMode }));
              if (nextMode === "manual") {
                setStep("guild-model");
                setGuildModelInputKey((current) => current + 1);
                return;
              }
              setStep("guild-effort");
            }}
          />
        </Box>
      )}

      {step === "guild-model" && (
        <Box flexDirection="column">
          <Box>
            <Text color="yellow">Guild model: </Text>
            <TextInput
              key={guildModelInputKey}
              defaultValue={draft.workerModel}
              onSubmit={(value) => {
                setDraft((current) => ({
                  ...current,
                  workerModel: value.trim() || current.workerModel || getTopModel(current.workerProvider),
                }));
                setStep("guild-effort");
              }}
            />
          </Box>
        </Box>
      )}

      {step === "guild-effort" && (
        <Box flexDirection="column">
          <Select
            options={guildEffortOptions}
            visibleOptionCount={getVisibleOptionCount(guildEffortOptions)}
            onChange={(value) => {
              setDraft((current) => ({
                ...current,
                workerReasoningEffort: value,
                workerTuningMode: "manual",
              }));
              setStep("roscoe-provider");
            }}
          />
        </Box>
      )}

      {step === "roscoe-provider" && (
        <Box flexDirection="column">
          <Select
            options={providerOptions}
            visibleOptionCount={getVisibleOptionCount(providerOptions)}
            onChange={(value) => {
              const nextProvider = value as LLMProtocol;
              const nextModel = getTopModel(nextProvider);
              const nextEffortOptions = getReasoningOptions(nextProvider);
              setDraft((current) => ({
                ...current,
                responderProvider: nextProvider,
                responderModel: nextModel,
                responderReasoningEffort: nextEffortOptions[nextEffortOptions.length - 1],
              }));
              setStep("roscoe-model");
              setRoscoeModelInputKey((current) => current + 1);
            }}
          />
        </Box>
      )}

      {step === "roscoe-model" && (
        <Box flexDirection="column">
          <Box>
            <Text color="yellow">Roscoe model: </Text>
            <TextInput
              key={roscoeModelInputKey}
              defaultValue={draft.responderModel}
              onSubmit={(value) => {
                setDraft((current) => ({
                  ...current,
                  responderModel: value.trim() || current.responderModel || getTopModel(current.responderProvider),
                }));
                setStep("roscoe-effort");
              }}
            />
          </Box>
        </Box>
      )}

      {step === "roscoe-effort" && (
        <Box flexDirection="column">
          <Select
            options={roscoeEffortOptions}
            visibleOptionCount={getVisibleOptionCount(roscoeEffortOptions)}
            onChange={(value) => {
              setDraft((current) => ({ ...current, responderReasoningEffort: value }));
              setStep("execution");
            }}
          />
        </Box>
      )}

      {step === "execution" && (
        <Box flexDirection="column">
          <Select
            options={executionOptions}
            visibleOptionCount={getVisibleOptionCount(executionOptions)}
            onChange={(value) => {
              setDraft((current) => ({ ...current, workerExecutionMode: value as RuntimeExecutionMode }));
              setStep("governance");
            }}
          />
        </Box>
      )}

      {step === "governance" && (
        <Box flexDirection="column">
          <Select
            options={governanceOptions}
            visibleOptionCount={getVisibleOptionCount(governanceOptions)}
            onChange={(value) => {
              setDraft((current) => ({ ...current, workerGovernanceMode: value as WorkerGovernanceMode }));
              setStep("verification");
            }}
          />
        </Box>
      )}

      {step === "verification" && (
        <Box flexDirection="column">
          <Select
            options={verificationOptions}
            visibleOptionCount={getVisibleOptionCount(verificationOptions)}
            onChange={(value) => {
              setDraft((current) => ({ ...current, verificationCadence: value as VerificationCadence }));
              setStep("efficiency");
            }}
          />
        </Box>
      )}

      {step === "efficiency" && (
        <Box flexDirection="column">
          <Select
            options={efficiencyOptions}
            visibleOptionCount={getVisibleOptionCount(efficiencyOptions)}
            onChange={(value) => {
              setDraft((current) => ({ ...current, tokenEfficiencyMode: value as TokenEfficiencyMode }));
              setStep("approval");
            }}
          />
        </Box>
      )}

      {step === "approval" && (
        <Box flexDirection="column">
          <Select
            options={approvalOptions}
            visibleOptionCount={getVisibleOptionCount(approvalOptions)}
            onChange={(value) => {
              const nextDraft = {
                ...draft,
                responderApprovalMode: value as ResponderApprovalMode,
              };
              setDraft(nextDraft);
              onApply(nextDraft);
            }}
          />
        </Box>
      )}
    </Panel>
  );
}
