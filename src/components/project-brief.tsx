import React from "react";
import { Box, Text } from "ink";
import { Select } from "@inkjs/ui";
import { getProjectContextPath, ProjectContext, ProjectHistoryRecord } from "../config.js";
import { Panel, Pill } from "./chrome.js";
import { getLockedProjectProvider, getRuntimeTuningMode } from "../runtime-defaults.js";

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

function formatRuntimeSummary(context: ProjectContext): { provider: string; tuning: string; baseline: string } | null {
  const provider = getLockedProjectProvider(context);
  if (!provider) return null;

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
  const runtime = formatRuntimeSummary(context);
  const memoryPath = getProjectContextPath(context.directory);
  const latestHistory = history[0];
  const recentAnswers = (context.interviewAnswers ?? []).slice(-4);

  return (
    <Box flexDirection="column" gap={1}>
      <Panel
        title={title}
        subtitle={subtitle}
        accentColor="cyan"
        rightLabel={history.length > 0 ? `${history.length} history run${history.length === 1 ? "" : "s"}` : "legacy memory only"}
      >
        <Box gap={1} flexWrap="wrap">
          <Pill label={context.name} color="cyan" />
          {runtime && <Pill label={`${runtime.provider} locked`} color="cyan" />}
          {runtime && <Pill label={runtime.tuning} color={runtime.tuning === "auto-manage" ? "green" : "yellow"} />}
          {runtime && <Pill label={runtime.baseline} color="magenta" />}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>Project story</Text>
          <Text dimColor>{ellipsize(context.intentBrief?.projectStory || context.notes || context.goals.join(" "))}</Text>
        </Box>

        <BriefSection label="Definition of done" items={context.intentBrief?.definitionOfDone ?? []} />
        <BriefSection label="Delivery pillars" items={[
          ...(context.intentBrief?.deliveryPillars.frontend?.[0] ? [`Frontend: ${context.intentBrief.deliveryPillars.frontend[0]}`] : []),
          ...(context.intentBrief?.deliveryPillars.backend?.[0] ? [`Backend: ${context.intentBrief.deliveryPillars.backend[0]}`] : []),
          ...(context.intentBrief?.deliveryPillars.unitComponentTests?.[0] ? [`Unit/component: ${context.intentBrief.deliveryPillars.unitComponentTests[0]}`] : []),
          ...(context.intentBrief?.deliveryPillars.e2eTests?.[0] ? [`E2E: ${context.intentBrief.deliveryPillars.e2eTests[0]}`] : []),
        ]} />
        <BriefSection label="Coverage mechanism" items={context.intentBrief?.coverageMechanism ?? []} />
        <BriefSection label="Constraints" items={context.intentBrief?.constraints ?? []} />
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
        </Box>
      </Panel>

      <Panel title="Actions" subtitle="Choose what Roscoe should do next" accentColor="yellow">
        <Select options={actionItems} onChange={onAction} />
      </Panel>
    </Box>
  );
}
