import React from "react";
import { Box, Text } from "ink";
import { SessionState, SessionStatus } from "../types.js";
import { Panel, Pill } from "./chrome.js";
import { wrapBlock } from "../text-layout.js";
import { getToolActivityStatusLabel } from "../session-activity.js";
import { isPauseAcknowledgementText } from "../session-transcript.js";

const statusIndicator: Record<SessionStatus, { char: string; color: string }> = {
  active: { char: "●", color: "green" },
  idle: { char: "●", color: "gray" },
  waiting: { char: "◆", color: "yellow" },
  generating: { char: "⟳", color: "cyan" },
  paused: { char: "‖", color: "gray" },
  blocked: { char: "■", color: "yellow" },
  review: { char: "?", color: "magenta" },
  parked: { char: "□", color: "blue" },
  exited: { char: "✕", color: "red" },
};

interface SessionListProps {
  sessions: Map<string, SessionState>;
  activeSessionId: string | null;
  width?: number;
}

function formatWorktreeLabel(name: string): string {
  return name === "main" ? "main repo" : `worktree ${name}`;
}

function formatProviderLabel(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Guild";
}

function normalizeInlineText(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(60, maxLength - 3)).trimEnd()}...`;
}

function getLatestBlockedReason(session: SessionState): string | null {
  for (let index = session.timeline.length - 1; index >= 0; index -= 1) {
    const entry = session.timeline[index];
    if (entry.kind !== "remote-turn") continue;
    const text = normalizeInlineText(entry.text, 160);
    if (!text) continue;
    if (!isPauseAcknowledgementText(entry.text) || text.length > 40) {
      return text;
    }
  }
  return null;
}

function getLatestStatusLine(session: SessionState): { text: string; color: string } {
  const liveToolLabel = getToolActivityStatusLabel(session.currentToolUse, session.currentToolDetail);
  if (liveToolLabel) {
    return { text: liveToolLabel, color: "cyan" };
  }

  const summary = session.summary?.trim();

  if (session.status === "blocked") {
    return { text: getLatestBlockedReason(session) ?? summary ?? "Blocked on prerequisite", color: "yellow" };
  }
  if (summary) {
    return { text: summary, color: "yellow" };
  }

  const latestEntry = session.timeline.at(-1);
  if (latestEntry) {
    switch (latestEntry.kind) {
      case "error":
        return { text: latestEntry.text, color: "red" };
      case "remote-turn":
        return {
          text: latestEntry.activity
            ? `${formatProviderLabel(latestEntry.provider)} · ${latestEntry.activity}`
            : `${formatProviderLabel(latestEntry.provider)} replied`,
          color: "green",
        };
      case "local-suggestion":
        return { text: "Roscoe draft ready for review", color: "magenta" };
      case "local-sent":
        return { text: "You sent the reply", color: "green" };
      case "tool-activity":
        return {
          text: getToolActivityStatusLabel(latestEntry.toolName, latestEntry.text) ?? latestEntry.text,
          color: "cyan",
        };
    }
  }

  if (session.status === "paused") {
    return { text: "Paused", color: "gray" };
  }
  if (session.status === "review") {
    return { text: summary || "Needs review", color: "magenta" };
  }
  if (session.status === "parked") {
    return { text: summary || "Parked cleanly", color: "blue" };
  }
  if (session.status === "exited") {
    return { text: "Ended", color: "red" };
  }
  if (session.suggestion.kind === "generating") {
    return { text: "Roscoe drafting a reply", color: "magenta" };
  }
  if (session.suggestion.kind === "ready") {
    return { text: "Roscoe draft ready for review", color: "magenta" };
  }
  if (session.suggestion.kind === "manual-input" || session.suggestion.kind === "editing") {
    return { text: "Reply in progress", color: "yellow" };
  }
  if (session.managed.awaitingInput) {
    return { text: "Waiting for the next turn", color: "gray" };
  }

  return { text: "Just started", color: "gray" };
}

export function SessionList({ sessions, activeSessionId, width = 36 }: SessionListProps) {
  const entries = Array.from(sessions.values());
  const contentWidth = Math.max(20, width - 6);
  const subtitle = entries.length > 1
    ? "Shift focus with Tab or Alt+1..9. Press h for dispatch."
    : entries.length === 1
      ? "One live lane. Press h for dispatch."
      : "No live lanes yet. Press h for dispatch.";

  return (
    <Panel
      title="Lane Stack"
      subtitle={subtitle}
      rightLabel={`${entries.length} live`}
      accentColor="cyan"
      width={width}
    >
      {entries.length === 0 && (
        <Text dimColor italic>
          No lanes
        </Text>
      )}
      {entries.map((session, idx) => {
        const isActive = session.id === activeSessionId;
        const indicator = statusIndicator[session.status];
        const prefix = isActive ? "▸" : " ";
        const statusLine = getLatestStatusLine(session);
        const wrappedStatusLine = wrapBlock(statusLine.text, contentWidth).slice(0, 1);

        return (
          <Box key={session.id} flexDirection="column">
            <Box gap={1} flexWrap="wrap">
              <Text color={isActive ? "cyan" : "gray"} bold={isActive}>{prefix}</Text>
              <Text dimColor>{idx + 1}</Text>
              <Text color={indicator.color}>{indicator.char}</Text>
              <Text bold={isActive} color={isActive ? "white" : undefined}>
                {session.projectName}
              </Text>
              <Text dimColor>[{formatWorktreeLabel(session.worktreeName)}]</Text>
              <Pill label={session.status} color={indicator.color} />
              {isActive && <Pill label={session.viewMode} color={session.viewMode === "transcript" ? "cyan" : "gray"} />}
            </Box>
            <Box paddingLeft={2} flexDirection="column">
              {wrappedStatusLine.map((line, lineIndex) => (
                <Text key={`${session.id}-status-${lineIndex}`} color={statusLine.color}>{line}</Text>
              ))}
            </Box>
          </Box>
        );
      })}
    </Panel>
  );
}
