import React from "react";
import { Box, Text } from "ink";
import { KeyHints, Pill } from "./chrome.js";

interface StatusBarProps {
  projectName: string;
  worktreeName: string;
  autoMode: boolean;
  sessionCount: number;
  viewMode: "transcript" | "raw";
  followLive: boolean;
  runtimeEditorOpen?: boolean;
}

export function StatusBar({
  projectName,
  worktreeName,
  autoMode,
  sessionCount,
  viewMode,
  followLive,
  runtimeEditorOpen = false,
}: StatusBarProps) {
  const label = projectName ? `${projectName}:${worktreeName}` : "";

  return (
    <Box paddingX={1} justifyContent="space-between" gap={2}>
      <Box gap={1} flexWrap="wrap">
        {label && <Text bold color="cyan">{label}</Text>}
        <Pill label={autoMode ? "AUTO" : "MANUAL"} color={autoMode ? "green" : "gray"} />
        <Pill label={viewMode} color={viewMode === "transcript" ? "cyan" : "gray"} />
        <Pill label={followLive ? "LIVE" : "SCROLLED"} color={followLive ? "green" : "yellow"} />
        <Text dimColor>{sessionCount} session{sessionCount !== 1 ? "s" : ""}</Text>
      </Box>
      <KeyHints
        items={[
          { keyLabel: "Tab", description: "switch" },
          { keyLabel: "m", description: "manual" },
          { keyLabel: "q", description: "text question" },
          { keyLabel: "u", description: runtimeEditorOpen ? "close runtime" : "runtime" },
          { keyLabel: "v", description: "toggle view" },
          { keyLabel: "↑ ↓", description: "scroll" },
          { keyLabel: "End/l", description: "live" },
          { keyLabel: "p", description: "pause" },
          { keyLabel: "Ctrl+C", description: "exit" },
        ]}
      />
    </Box>
  );
}
