import React from "react";
import { Box, Text } from "ink";
import { KeyHints, Pill } from "./chrome.js";
import { PreviewMode, SessionStatus, SuggestionPhase } from "../types.js";

interface StatusBarProps {
  projectName: string;
  worktreeName: string;
  autoMode: boolean;
  sessionCount: number;
  sessionStatus?: SessionStatus;
  suggestionPhaseKind?: SuggestionPhase["kind"];
  previewMode?: PreviewMode;
  canInterruptActiveTurn?: boolean;
  viewMode: "transcript" | "raw";
  followLive: boolean;
  runtimeEditorOpen?: boolean;
  statusPaneVisible?: boolean;
  exitConfirmOpen?: boolean;
  closeLaneConfirmOpen?: boolean;
}

export function StatusBar({
  projectName,
  worktreeName,
  autoMode,
  sessionCount,
  sessionStatus,
  suggestionPhaseKind,
  previewMode = "off",
  canInterruptActiveTurn: _canInterruptActiveTurn = false,
  viewMode,
  followLive,
  runtimeEditorOpen = false,
  statusPaneVisible = true,
  exitConfirmOpen = false,
  closeLaneConfirmOpen = false,
}: StatusBarProps) {
  const label = projectName ? `${projectName}:${worktreeName}` : "";
  const showingTextEntryHint = suggestionPhaseKind === "editing" || suggestionPhaseKind === "manual-input";
  const showingJumpHints = !followLive;
  const hintItems = exitConfirmOpen ? [
    { keyLabel: "Enter", description: "exit now" },
    { keyLabel: "Esc", description: "keep running" },
  ] : closeLaneConfirmOpen ? [
    { keyLabel: "Enter", description: "close lane" },
    { keyLabel: "Esc", description: "keep lane" },
  ] : [
    ...(sessionCount > 1 ? [{ keyLabel: "Tab", description: "switch lanes" }] : []),
    ...(showingTextEntryHint || runtimeEditorOpen ? [{ keyLabel: "Esc", description: "cancel" }] : []),
    ...(!runtimeEditorOpen && !showingTextEntryHint ? [{ keyLabel: "h", description: "dispatch" }] : []),
    ...(!runtimeEditorOpen && !showingTextEntryHint && previewMode !== "ready" ? [{ keyLabel: "c", description: "close lane" }] : []),
    ...(!runtimeEditorOpen && !showingTextEntryHint
      ? previewMode === "ready"
        ? [
            { keyLabel: "c", description: "continue" },
            { keyLabel: "b", description: "clear preview" },
          ]
        : [
            { keyLabel: "b", description: previewMode === "queued" ? "clear preview" : "preview" },
          ]
      : []),
    { keyLabel: "s", description: statusPaneVisible ? "hide status" : "show status" },
    { keyLabel: "u", description: runtimeEditorOpen ? "close runtime" : "runtime" },
    { keyLabel: "v", description: "toggle view" },
    { keyLabel: "↑ ↓", description: "scroll" },
    ...(showingJumpHints
      ? [
          { keyLabel: "g", description: "jump top" },
          { keyLabel: "G/End/l", description: "jump live" },
        ]
      : []),
    { keyLabel: "p", description: sessionStatus === "paused" || sessionStatus === "blocked" || sessionStatus === "parked" ? "resume" : "pause" },
    { keyLabel: "Ctrl+C", description: "exit" },
  ];

  return (
    <Box paddingX={1} justifyContent="space-between" gap={2}>
      <Box gap={1} flexWrap="wrap">
        {label && <Text bold color="cyan">{label}</Text>}
        <Pill label={autoMode ? "AUTO" : "MANUAL"} color={autoMode ? "green" : "gray"} />
        {previewMode !== "off" && (
          <Pill label={previewMode === "ready" ? "PREVIEW READY" : "PREVIEW QUEUED"} color={previewMode === "ready" ? "magenta" : "cyan"} />
        )}
        {sessionStatus === "paused" && (
          <Pill label="PAUSED" color="yellow" />
        )}
        {sessionStatus === "blocked" && (
          <Pill label="BLOCKED" color="yellow" />
        )}
        {sessionStatus === "review" && (
          <Pill label="REVIEW" color="magenta" />
        )}
        {sessionStatus === "parked" && (
          <Pill label="PARKED" color="blue" />
        )}
        <Pill label={viewMode} color={viewMode === "transcript" ? "cyan" : "gray"} />
        <Pill label={followLive ? "LIVE" : "SCROLLED"} color={followLive ? "green" : "yellow"} />
        <Text dimColor>{sessionCount} lane{sessionCount !== 1 ? "s" : ""}</Text>
      </Box>
      <KeyHints items={hintItems} />
    </Box>
  );
}
