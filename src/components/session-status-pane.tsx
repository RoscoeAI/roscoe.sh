import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { SessionState } from "../types.js";
import { Pill } from "./chrome.js";
import { getToolActivityStatusLabel } from "../session-activity.js";
import { detectProtocol, getProviderAdapter, isLLMProtocol, LLMProtocol, RuntimeControlSettings } from "../llm-runtime.js";
import {
  formatResponderApprovalLabel,
  formatTokenEfficiencyLabel,
  formatVerificationCadenceLabel,
  formatWorkerGovernanceLabel,
  getExecutionModeLabel,
  getGuildProvider,
  getProjectResponderRuntime,
  getProjectWorkerRuntime,
  getResponderApprovalMode,
  getResponderProvider,
  getRuntimeTuningMode,
  getTopModel,
  getTokenEfficiencyMode,
  getVerificationCadence,
  getWorkerGovernanceMode,
} from "../runtime-defaults.js";
import { ProjectContext, TokenEfficiencyMode } from "../config.js";

interface SessionStatusPaneProps {
  session: SessionState;
  projectContext?: ProjectContext | null;
  tokenEfficiencyMode?: TokenEfficiencyMode;
}

interface RuntimeIdentity {
  provider: LLMProtocol;
  identity: string;
}

function formatElapsed(startedAt: string, nowMs: number): string {
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs) || startMs <= 0) return "just started";

  const totalSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatStartedAt(startedAt: string): string {
  const timestamp = Date.parse(startedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatCompactCount(value: number): string {
  const absolute = Math.abs(value);
  const format = (scaled: number, suffix: string) =>
    `${scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1)).toString()}${suffix}`;

  if (absolute >= 1_000_000_000) return format(value / 1_000_000_000, "b");
  if (absolute >= 1_000_000) return format(value / 1_000_000, "m");
  if (absolute >= 1_000) return format(value / 1_000, "k");
  return value.toLocaleString("en-US");
}

function formatTokenSummary(session: SessionState): string {
  const parts = [
    `tok ${formatCompactCount(session.usage.inputTokens)}/${formatCompactCount(session.usage.outputTokens)}`,
  ];

  if (session.usage.cachedInputTokens > 0) {
    parts.push(`cache ${formatCompactCount(session.usage.cachedInputTokens)}`);
  }

  if (session.usage.cacheCreationInputTokens > 0) {
    parts.push(`cache+ ${formatCompactCount(session.usage.cacheCreationInputTokens)}`);
  }

  return parts.join(" · ");
}

function formatRateLimit(session: SessionState): { label: string; color: string } {
  if (session.rateLimitStatus) {
    const labelParts = [
      session.rateLimitStatus.windowLabel ?? "limit",
      session.rateLimitStatus.status ?? "unknown",
    ];
    if (session.rateLimitStatus.resetsAt) {
      labelParts.push(formatStartedAt(session.rateLimitStatus.resetsAt));
    }
    return {
      label: labelParts.join(" · "),
      color: session.rateLimitStatus.status === "allowed" ? "green" : "yellow",
    };
  }

  const source = session.managed.profile.protocol ?? session.profileName;
  if (source === "codex") {
    return { label: "limits n/a", color: "gray" };
  }

  return { label: "limits pending", color: "yellow" };
}

function getOnDeckLabel(session: SessionState): string {
  if (session.status === "paused") return "paused";
  if (session.status === "blocked") return "blocked";
  if (session.status === "review") return "needs review";
  if (session.status === "parked") return "parked";
  if (session.status === "exited") return "ended";
  if (session.suggestion.kind === "generating") return "Roscoe drafting";
  if (session.suggestion.kind === "ready") return "you reviewing";
  if (session.suggestion.kind === "manual-input" || session.suggestion.kind === "editing") return "you replying";
  if (session.managed.awaitingInput) return "Roscoe deciding";
  if (session.currentToolUse) return getToolActivityStatusLabel(session.currentToolUse) ?? "Guild working";
  return "Guild working";
}

function formatRuntimeIdentity(
  summary: string | null | undefined,
  fallbackProvider: LLMProtocol,
  fallbackRuntime: RuntimeControlSettings | null | undefined,
): RuntimeIdentity {
  const parts = summary?.split(" · ").map((part) => part.trim()).filter(Boolean) ?? [];
  const provider = isLLMProtocol(parts[0])
    ? parts[0]
    : fallbackProvider;

  if (parts.length >= 3) {
    return {
      provider,
      identity: `${parts[1]}/${parts[2]}`,
    };
  }

  const model = fallbackRuntime?.model ?? getTopModel(provider);
  const reasoningOptions = getProviderAdapter(provider).reasoningOptions;
  const effort = fallbackRuntime?.reasoningEffort ?? reasoningOptions[reasoningOptions.length - 1];
  return {
    provider,
    identity: `${model}/${effort}`,
  };
}

function formatCompactApprovalLabel(label: string | null): string | null {
  if (!label) return null;
  return label === "auto when confident" ? "auto-send" : label;
}

export function SessionStatusPane({ session, projectContext = null, tokenEfficiencyMode }: SessionStatusPaneProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const elapsed = useMemo(() => formatElapsed(session.startedAt, nowMs), [nowMs, session.startedAt]);
  const guildTurns = session.timeline.filter((entry) => entry.kind === "remote-turn").length;
  const conversationMessages = session.timeline.filter((entry) =>
    entry.kind === "remote-turn" || entry.kind === "local-suggestion" || entry.kind === "local-sent",
  ).length;
  const onDeckLabel = getOnDeckLabel(session);
  const tokenSummary = formatTokenSummary(session);
  const limitStatus = formatRateLimit(session);
  const guildProvider = getGuildProvider(projectContext) ?? detectProtocol(session.managed.profile);
  const responderProvider = getResponderProvider(projectContext) ?? guildProvider;
  const savedWorkerRuntime = getProjectWorkerRuntime(projectContext, guildProvider) ?? session.managed.profile.runtime;
  const savedResponderRuntime = getProjectResponderRuntime(projectContext, responderProvider) ?? savedWorkerRuntime;
  const guildRuntime = formatRuntimeIdentity(
    session.managed.lastWorkerRuntimeSummary,
    guildProvider,
    session.managed.profile.runtime ?? savedWorkerRuntime,
  );
  const responderRuntime = formatRuntimeIdentity(
    session.managed.lastResponderRuntimeSummary,
    responderProvider,
    savedResponderRuntime,
  );
  const executionLabel = getExecutionModeLabel(savedWorkerRuntime);
  const governanceLabel = projectContext ? formatWorkerGovernanceLabel(getWorkerGovernanceMode(projectContext)) : null;
  const verificationLabel = projectContext ? formatVerificationCadenceLabel(getVerificationCadence(projectContext)) : null;
  const approvalLabel = projectContext ? formatResponderApprovalLabel(getResponderApprovalMode(projectContext) ?? "auto") : null;
  const effectiveTokenEfficiencyMode = tokenEfficiencyMode ?? (projectContext ? getTokenEfficiencyMode(projectContext) : undefined);
  const policyLine = [
    getRuntimeTuningMode(savedWorkerRuntime) === "auto" ? "Guild auto" : "Guild pinned",
    executionLabel,
    governanceLabel,
    verificationLabel,
    effectiveTokenEfficiencyMode ? formatTokenEfficiencyLabel(effectiveTokenEfficiencyMode) : null,
    formatCompactApprovalLabel(approvalLabel),
  ].filter(Boolean).join(" · ");

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between" gap={2}>
        <Box gap={1} flexWrap="wrap" flexGrow={1}>
          <Text bold color="cyan">Status</Text>
          <Pill label={elapsed} color="cyan" />
          <Pill label={`${guildTurns} turns`} color="yellow" />
          <Pill label={`${conversationMessages} msgs`} color="magenta" />
          <Pill label={`Guild ${guildRuntime.provider}:${guildRuntime.identity}`} color="cyan" />
          <Pill label={`Roscoe ${responderRuntime.provider}:${responderRuntime.identity}`} color="magenta" />
          <Text dimColor>{tokenSummary}</Text>
        </Box>
        <Text dimColor>s hide</Text>
      </Box>
      <Box gap={1} flexWrap="wrap">
        {policyLine ? <Text dimColor>{policyLine}</Text> : null}
        <Pill label={onDeckLabel} color="green" />
        <Pill label={limitStatus.label} color={limitStatus.color} />
      </Box>
    </Box>
  );
}
