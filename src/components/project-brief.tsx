import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select } from "@inkjs/ui";
import { getProjectContextPath, ProjectContext, ProjectHistoryRecord } from "../config.js";
import { KeyHints, Panel, Pill } from "./chrome.js";
import {
  getExecutionModeLabel,
  formatTokenEfficiencyLabel,
  formatVerificationCadenceLabel,
  formatResponderApprovalLabel,
  formatWorkerGovernanceLabel,
  getGuildProvider,
  getResponderApprovalMode,
  getResponderProvider,
  getRuntimeTuningMode,
  getTokenEfficiencyMode,
  getVerificationCadence,
  getWorkerGovernanceMode,
} from "../runtime-defaults.js";

interface BriefAction {
  label: string;
  value: string;
}

interface ProjectBriefViewProps {
  context: ProjectContext;
  history: ProjectHistoryRecord[];
  actionItems: BriefAction[];
  onAction: (value: string) => void;
  title?: string;
  subtitle?: string;
}

function ellipsize(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(40, max - 3)).trimEnd()}...`;
}

function summarizeItems(items: string[], max = 2): string[] {
  if (items.length <= max) return items;
  return [...items.slice(0, max), `+${items.length - max} more`];
}

function formatRuntimeSummary(context: ProjectContext): {
  guildProvider: string;
  responderProvider: string;
  tuning: string;
  guildBaseline: string;
  responderBaseline: string;
  execution: string;
  governance: string;
  verification: string;
  tokenEfficiency: string;
  approval: string;
} | null {
  const guildProvider = getGuildProvider(context);
  const responderProvider = getResponderProvider(context);
  if (!guildProvider || !responderProvider) return null;

  const workerRuntime = context.runtimeDefaults?.workerByProtocol?.[guildProvider] ?? context.runtimeDefaults?.onboarding?.runtime;
  const responderRuntime = context.runtimeDefaults?.responderByProtocol?.[responderProvider] ?? workerRuntime;
  const workerModel = workerRuntime?.model ?? "default";
  const workerEffort = workerRuntime?.reasoningEffort ?? "default";
  const responderModel = responderRuntime?.model ?? workerModel;
  const responderEffort = responderRuntime?.reasoningEffort ?? workerEffort;
  const tuning = getRuntimeTuningMode(workerRuntime) === "auto" ? "auto-manage" : "manual";
  const execution = getExecutionModeLabel(workerRuntime);

  return {
    guildProvider,
    responderProvider,
    tuning,
    guildBaseline: `${workerModel} / ${workerEffort}`,
    responderBaseline: `${responderModel} / ${responderEffort}`,
    execution,
    governance: formatWorkerGovernanceLabel(getWorkerGovernanceMode(context)),
    verification: formatVerificationCadenceLabel(getVerificationCadence(context)),
    tokenEfficiency: formatTokenEfficiencyLabel(getTokenEfficiencyMode(context)),
    approval: formatResponderApprovalLabel(getResponderApprovalMode(context) ?? "auto"),
  };
}

function BriefSection({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>{label}</Text>
      {summarizeItems(items).map((item, index) => (
        <Text key={`${label}-${index}`} dimColor>{item}</Text>
      ))}
    </Box>
  );
}

export function ProjectBriefView({
  context,
  history,
  actionItems,
  onAction,
  title = "Project Brief",
  subtitle = "Saved Roscoe understanding before you launch or refine",
}: ProjectBriefViewProps) {
  const [expanded, setExpanded] = useState(false);
  const runtime = formatRuntimeSummary(context);
  const memoryPath = getProjectContextPath(context.directory);
  const latestHistory = history[0];
  const recentAnswers = (context.interviewAnswers ?? []).slice(-4);
  const definitionOfDone = context.intentBrief?.definitionOfDone ?? [];

  useInput((input, key) => {
    if (key.ctrl || key.meta || key.escape || key.return) return;
    if (input.toLowerCase() === "x") {
      setExpanded((current) => !current);
    }
  });

  const rightLabel = [
    expanded ? "expanded" : "summary",
    history.length > 0 ? `${history.length} history run${history.length === 1 ? "" : "s"}` : "legacy memory only",
  ].join(" · ");

  return (
    <Box flexDirection="column" gap={1}>
      <Panel
        title={title}
        subtitle={subtitle}
        accentColor="cyan"
        rightLabel={rightLabel}
      >
        <Box gap={1} flexWrap="wrap">
          <Pill label={context.name} color="cyan" />
          {runtime && <Pill label={`Guild ${runtime.guildProvider}`} color="cyan" />}
          {runtime && <Pill label={`Roscoe ${runtime.responderProvider}`} color="magenta" />}
          {runtime && <Pill label={runtime.tuning} color={runtime.tuning === "auto-manage" ? "green" : "yellow"} />}
          {runtime && <Pill label={`Guild ${runtime.guildBaseline}`} color="yellow" />}
          {runtime && <Pill label={`Roscoe ${runtime.responderBaseline}`} color="magenta" />}
          {runtime && <Pill label={runtime.execution} color={runtime.execution === "accelerated" ? "red" : "green"} />}
          {runtime && <Pill label={runtime.governance} color="cyan" />}
          {runtime && <Pill label={runtime.verification} color={runtime.verification === "batch proofs" ? "green" : "yellow"} />}
          {runtime && <Pill label={runtime.tokenEfficiency} color={runtime.tokenEfficiency === "save tokens" ? "yellow" : "green"} />}
          {runtime && <Pill label={runtime.approval} color="green" />}
        </Box>

        <Box marginTop={1}>
          <KeyHints items={[{ keyLabel: "x", description: expanded ? "show less" : "show full brief" }]} />
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>Project story</Text>
          <Text dimColor>{ellipsize(context.intentBrief?.projectStory || context.notes || context.goals.join(" "))}</Text>
        </Box>

        <BriefSection label="Definition of done" items={definitionOfDone} />

        {!expanded && (
          <Text dimColor>Press <Text color="cyan">x</Text> to inspect delivery pillars, architecture, constraints, interview trail, and saved memory details.</Text>
        )}

        {expanded && (
          <>
            <BriefSection label="Delivery pillars" items={[
              ...(context.intentBrief?.deliveryPillars.frontend?.[0] ? [`Frontend: ${context.intentBrief.deliveryPillars.frontend[0]}`] : []),
              ...(context.intentBrief?.deliveryPillars.backend?.[0] ? [`Backend: ${context.intentBrief.deliveryPillars.backend[0]}`] : []),
              ...(context.intentBrief?.deliveryPillars.unitComponentTests?.[0] ? [`Unit/component: ${context.intentBrief.deliveryPillars.unitComponentTests[0]}`] : []),
              ...(context.intentBrief?.deliveryPillars.e2eTests?.[0] ? [`E2E: ${context.intentBrief.deliveryPillars.e2eTests[0]}`] : []),
            ]} />
            <BriefSection label="Coverage mechanism" items={context.intentBrief?.coverageMechanism ?? []} />
            <BriefSection label="Entry surface contract" items={[
              ...(context.intentBrief?.entrySurfaceContract?.summary ? [context.intentBrief.entrySurfaceContract.summary] : []),
              ...(context.intentBrief?.entrySurfaceContract?.defaultRoute ? [`Default route: ${context.intentBrief.entrySurfaceContract.defaultRoute}`] : []),
              ...(context.intentBrief?.entrySurfaceContract?.expectedExperience ? [`Expected first experience: ${context.intentBrief.entrySurfaceContract.expectedExperience}`] : []),
              ...(context.intentBrief?.entrySurfaceContract?.allowedShellStates?.length ? [`Allowed shell states: ${context.intentBrief.entrySurfaceContract.allowedShellStates.join(", ")}`] : []),
            ]} />
            <BriefSection label="Local first-run contract" items={[
              ...(context.intentBrief?.localRunContract?.summary ? [context.intentBrief.localRunContract.summary] : []),
              ...(context.intentBrief?.localRunContract?.startCommand ? [`Start: ${context.intentBrief.localRunContract.startCommand}`] : []),
              ...(context.intentBrief?.localRunContract?.firstRoute ? [`First route: ${context.intentBrief.localRunContract.firstRoute}`] : []),
              ...(context.intentBrief?.localRunContract?.prerequisites?.length ? [`Prereqs: ${context.intentBrief.localRunContract.prerequisites.join(", ")}`] : []),
              ...(context.intentBrief?.localRunContract?.seedRequirements?.length ? [`Seeds: ${context.intentBrief.localRunContract.seedRequirements.join(", ")}`] : []),
              ...(context.intentBrief?.localRunContract?.expectedBlockedStates?.length ? [`Blocked states: ${context.intentBrief.localRunContract.expectedBlockedStates.join(", ")}`] : []),
              ...(context.intentBrief?.localRunContract?.operatorSteps?.length ? [`Operator path: ${context.intentBrief.localRunContract.operatorSteps[0]}`] : []),
            ]} />
            <BriefSection label={`Acceptance ledger${context.intentBrief?.acceptanceLedgerMode === "inferred" ? " (inferred)" : ""}`} items={(context.intentBrief?.acceptanceLedger ?? []).map((item) => {
              const evidence = item.evidence.length > 0 ? ` -> ${item.evidence.join(", ")}` : "";
              const notes = item.notes ? ` (${item.notes})` : "";
              return `[${item.status}] ${item.label}${evidence}${notes}`;
            })} />
            <BriefSection label="Deployment contract" items={[
              ...(context.intentBrief?.deploymentContract?.summary ? [context.intentBrief.deploymentContract.summary] : []),
              ...(context.intentBrief?.deploymentContract?.artifactType ? [`Artifact: ${context.intentBrief.deploymentContract.artifactType}`] : []),
              ...(context.intentBrief?.deploymentContract?.platforms?.length ? [`Platforms: ${context.intentBrief.deploymentContract.platforms.join(", ")}`] : []),
              ...(context.intentBrief?.deploymentContract?.environments?.length ? [`Environments: ${context.intentBrief.deploymentContract.environments.join(", ")}`] : []),
              ...(context.intentBrief?.deploymentContract?.buildSteps?.length ? [`Build: ${context.intentBrief.deploymentContract.buildSteps[0]}`] : []),
              ...(context.intentBrief?.deploymentContract?.deploySteps?.length ? [`Deploy: ${context.intentBrief.deploymentContract.deploySteps[0]}`] : []),
              ...(context.intentBrief?.deploymentContract?.previewStrategy?.length ? [`Preview: ${context.intentBrief.deploymentContract.previewStrategy[0]}`] : []),
              ...(context.intentBrief?.deploymentContract?.healthChecks?.length ? [`Health check: ${context.intentBrief.deploymentContract.healthChecks[0]}`] : []),
              ...(context.intentBrief?.deploymentContract?.rollback?.length ? [`Rollback: ${context.intentBrief.deploymentContract.rollback[0]}`] : []),
              ...(context.intentBrief?.deploymentContract?.requiredSecrets?.length ? [`Secrets: ${context.intentBrief.deploymentContract.requiredSecrets.join(", ")}`] : []),
            ]} />
            <BriefSection label="Constraints" items={context.intentBrief?.constraints ?? []} />
            <BriefSection label="Architecture principles" items={context.intentBrief?.architecturePrinciples ?? []} />
            <BriefSection label="Autonomy rules" items={context.intentBrief?.autonomyRules ?? []} />
            <BriefSection label="Quality bar" items={context.intentBrief?.qualityBar ?? []} />

            <Box marginTop={1} flexDirection="column">
              <Text color="yellow" bold>Interview trail</Text>
              {recentAnswers.length === 0 ? (
                <Text dimColor>No saved interview answers.</Text>
              ) : (
                recentAnswers.map((answer, index) => (
                  <Text key={`${answer.question}-${index}`} dimColor>
                    Q{(context.interviewAnswers?.length ?? 0) - recentAnswers.length + index + 1}
                    {answer.theme ? ` [${answer.theme}]` : ""}: {ellipsize(answer.answer, 120)}
                  </Text>
                ))
              )}
              {(context.interviewAnswers?.length ?? 0) > recentAnswers.length && (
                <Text dimColor>+{(context.interviewAnswers?.length ?? 0) - recentAnswers.length} earlier answers</Text>
              )}
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text dimColor>Memory path: {memoryPath}</Text>
              <Text dimColor>
                {latestHistory
                  ? `Latest saved history: ${latestHistory.mode} @ ${latestHistory.createdAt.slice(0, 19).replace("T", " ")}`
                  : "No raw onboarding/refine history has been saved for this project yet."}
              </Text>
              <Text dimColor>Adjust later from any live Guild lane with <Text color="cyan">u</Text>.</Text>
            </Box>
          </>
        )}
      </Panel>

      <Panel title="Actions" subtitle="Choose what Roscoe should do next" accentColor="yellow">
        <Select options={actionItems} onChange={onAction} />
      </Panel>
    </Box>
  );
}
