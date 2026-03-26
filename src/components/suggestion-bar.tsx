import React, { useState, useMemo } from "react";
import { Box, Text } from "ink";
import { TextInput, Spinner, Badge } from "@inkjs/ui";
import { SuggestionPhase } from "../types.js";
import { renderMd } from "../render-md.js";
import { KeyHints, Panel, Pill } from "./chrome.js";

function confidenceColor(confidence: number): string {
  if (confidence >= 80) return "green";
  if (confidence >= 60) return "yellow";
  return "red";
}

interface SuggestionBarProps {
  phase: SuggestionPhase;
  toolActivity?: string | null;
  onSubmitEdit: (text: string) => void;
  onSubmitManual: (text: string) => void;
}

function GeneratingView({ partial }: { partial?: string }) {
  const rendered = useMemo(() => {
    if (!partial) return "";
    // Show the tail of partial text, rendered as markdown
    const tail = partial.length > 500 ? partial.slice(-500) : partial;
    return renderMd(tail);
  }, [partial]);

  return (
    <Box flexDirection="column">
      <Spinner label="Thinking..." />
      {rendered && (
        <Box marginTop={0} paddingLeft={1} flexDirection="column">
          <Text dimColor>Draft in progress</Text>
          <Text dimColor>{rendered}</Text>
        </Box>
      )}
    </Box>
  );
}

export function SuggestionBar({
  phase,
  toolActivity,
  onSubmitEdit,
  onSubmitManual,
}: SuggestionBarProps) {
  const [editResetKey, setEditResetKey] = useState(0);
  const [manualResetKey, setManualResetKey] = useState(0);

  return (
    <Panel
      title="Command Deck"
      subtitle="Approve, reshape, or override the next message"
      rightLabel={toolActivity ? `tool ${toolActivity}` : phase.kind}
      accentColor={phase.kind === "ready" ? "yellow" : "gray"}
    >
      {phase.kind === "idle" && (
        <Box flexDirection="column" gap={1}>
          <Box gap={1}>
            {toolActivity ? (
              <>
                <Spinner label="" />
                <Text color="cyan">{toolActivity}</Text>
              </>
            ) : (
              <Text dimColor>Session working...</Text>
            )}
          </Box>
          <KeyHints items={[{ keyLabel: "m", description: "type a message" }]} />
        </Box>
      )}

      {phase.kind === "generating" && (
        <GeneratingView partial={phase.partial} />
      )}

      {phase.kind === "ready" && (
        <Box flexDirection="column">
          <Text dimColor>Recommended reply</Text>
          <Text bold>{phase.result.text}</Text>
          <Box gap={1} marginTop={1}>
            <Badge color={confidenceColor(phase.result.confidence)}>
              {phase.result.confidence}/100
            </Badge>
            <Pill label={phase.result.confidence >= 80 ? "high confidence" : "review"} color={confidenceColor(phase.result.confidence)} />
            {phase.result.reasoning && (
              <Text dimColor>Why: {phase.result.reasoning}</Text>
            )}
          </Box>
          <Box marginTop={1}>
            <KeyHints
              items={[
                { keyLabel: "a", description: "approve" },
                { keyLabel: "e", description: "edit" },
                { keyLabel: "r", description: "reject" },
                { keyLabel: "m", description: "manual" },
              ]}
            />
          </Box>
        </Box>
      )}

      {phase.kind === "editing" && (
        <Box flexDirection="column">
          <Text dimColor>Original: {phase.original}</Text>
          <Box marginTop={1}>
            <Text color="yellow">Edit: </Text>
            <TextInput
              key={editResetKey}
              defaultValue={phase.original}
              onSubmit={(val) => {
                onSubmitEdit(val || phase.original);
                setEditResetKey((k) => k + 1);
              }}
            />
          </Box>
        </Box>
      )}

      {phase.kind === "manual-input" && (
        <Box flexDirection="column">
          <Text dimColor>Manual override</Text>
          <Box marginTop={1}>
            <Text color="yellow">Your message: </Text>
            <TextInput
              key={manualResetKey}
              placeholder="Type your message..."
              onSubmit={(val) => {
                if (val.trim()) {
                  onSubmitManual(val.trim());
                  setManualResetKey((k) => k + 1);
                }
              }}
            />
          </Box>
        </Box>
      )}

      {phase.kind === "error" && (
        <Box flexDirection="column">
          <Text color="red">
            Error: {phase.message.length > 100 ? phase.message.slice(0, 100) + "..." : phase.message}
          </Text>
          <Box marginTop={1}>
            <KeyHints
              items={[
                { keyLabel: "r", description: "retry" },
                { keyLabel: "m", description: "manual" },
              ]}
            />
          </Box>
        </Box>
      )}

      {phase.kind === "auto-sent" && (
        <Box flexDirection="column">
          <Text color="green">
            Auto-sent ({phase.confidence}/100):
          </Text>
          <Text dimColor>
            {phase.text.length > 60 ? `"${phase.text.slice(0, 60)}..."` : `"${phase.text}"`}
          </Text>
        </Box>
      )}
    </Panel>
  );
}
