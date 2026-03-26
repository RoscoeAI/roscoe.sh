import React from "react";
import { Box, Text } from "ink";
import { SessionState, SessionStatus } from "../types.js";
import { Panel, Pill } from "./chrome.js";
import { summarizeRuntime } from "../llm-runtime.js";
import { wrapBlock } from "../text-layout.js";
import { getRuntimeTuningMode } from "../runtime-defaults.js";

const statusIndicator: Record<SessionStatus, { char: string; color: string }> = {
  active: { char: "●", color: "green" },
  idle: { char: "●", color: "gray" },
  waiting: { char: "◆", color: "yellow" },
  generating: { char: "⟳", color: "cyan" },
  paused: { char: "‖", color: "gray" },
  exited: { char: "✕", color: "red" },
};

interface SessionListProps {
  sessions: Map<string, SessionState>;
  activeSessionId: string | null;
  width?: number;
}

function formatWorktreeLabel(name: string): string {
  return name === "main" ? "main repo" : `worktree - ${name}`;
}

function compactRuntimeSummary(session: SessionState, width: number): string {
  const runtime = session.managed.profile?.runtime;
  const protocol = session.managed.profile?.protocol ?? session.profileName;
  const model = runtime?.model ?? protocol;
  const effort = runtime?.reasoningEffort;
  const mode = runtime?.executionMode === "accelerated"
    ? "accelerated"
    : runtime?.sandboxMode === "danger-full-access" || runtime?.dangerouslySkipPermissions
      ? "accelerated"
      : "safe";
  const tuning = getRuntimeTuningMode(runtime) === "manual" ? "manual" : "auto";

  if (width < 28) {
    return `${model}${effort ? `/${effort}` : ""} · ${tuning}`;
  }

  if (width < 34) {
    return `${model}${effort ? `/${effort}` : ""} · ${tuning} · ${mode}`;
  }

  return session.managed.profile
    ? `${summarizeRuntime(session.managed.profile)} · ${tuning}`
    : `${model}${effort ? `/${effort}` : ""} · ${tuning} · ${mode}`;
}

export function SessionList({ sessions, activeSessionId, width = 36 }: SessionListProps) {
  const entries = Array.from(sessions.values());
  const contentWidth = Math.max(20, width - 6);

  return (
    <Panel
      title="Session Stack"
      subtitle="Shift focus with Tab or Alt+1..9"
      rightLabel={`${entries.length} live`}
      accentColor="cyan"
      width={width}
    >
      {entries.length === 0 && (
        <Text dimColor italic>
          No sessions
        </Text>
      )}
      {entries.map((session, idx) => {
        const isActive = session.id === activeSessionId;
        const indicator = statusIndicator[session.status];
        const prefix = isActive ? "▸" : " ";
        const transcriptCount = session.timeline.filter((entry) =>
          entry.kind === "remote-turn" || entry.kind === "local-sent",
        ).length;
        const runtimeSummary = compactRuntimeSummary(session, contentWidth);
        const worktreeLines = wrapBlock(
          `[${formatWorktreeLabel(session.worktreeName)}] ${session.profileName}`,
          contentWidth,
        ).slice(0, 2);
        const runtimeLines = wrapBlock(
          `${runtimeSummary} · ${transcriptCount} turns${session.currentToolUse ? ` · ${session.currentToolUse}` : ""}`,
          contentWidth,
        ).slice(0, 1);
        const summaryLines = contentWidth >= 34 && session.summary
          ? wrapBlock(session.summary, contentWidth).slice(0, 1)
          : [];

        return (
          <Box key={session.id} flexDirection="column">
            <Box gap={1} flexWrap="wrap">
              <Text color={isActive ? "cyan" : "gray"} bold={isActive}>{prefix}</Text>
              <Text dimColor>{idx + 1}</Text>
              <Text color={indicator.color}>{indicator.char}</Text>
              <Text bold={isActive} color={isActive ? "white" : undefined}>
                {session.projectName}
              </Text>
              <Pill label={session.status} color={indicator.color} />
              {isActive && <Pill label={session.viewMode} color={session.viewMode === "transcript" ? "cyan" : "gray"} />}
            </Box>
            <Box paddingLeft={2} flexDirection="column">
              {worktreeLines.map((line, lineIndex) => (
                <Text key={`${session.id}-worktree-${lineIndex}`} dimColor>{line}</Text>
              ))}
              {runtimeLines.map((line, lineIndex) => (
                <Text key={`${session.id}-runtime-${lineIndex}`} dimColor>{line}</Text>
              ))}
              {summaryLines.map((line, lineIndex) => (
                <Text key={`${session.id}-summary-${lineIndex}`} color="yellow">{line}</Text>
              ))}
            </Box>
          </Box>
        );
      })}
    </Panel>
  );
}
