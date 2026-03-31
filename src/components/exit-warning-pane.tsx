import React from "react";
import { Box, Text } from "ink";
import { KeyHints, Panel } from "./chrome.js";

interface ExitWarningPaneProps {
  sessionCount: number;
  hasInFlightWork: boolean;
}

export function ExitWarningPane({ sessionCount, hasInFlightWork }: ExitWarningPaneProps) {
  const laneLabel = sessionCount === 1 ? "lane" : "lanes";

  return (
    <Panel
      title="Exit Warning"
      subtitle="Stop Roscoe and close the TUI?"
      rightLabel={hasInFlightWork ? "in-flight work will stop" : "safe to resume later"}
      accentColor="yellow"
      minHeight={8}
      flexShrink={0}
    >
      <Box flexDirection="column" gap={1}>
        <Text color="yellow">
          Roscoe will save the transcript, provider thread IDs, hidden responder thread, and runtime state for the current {laneLabel}.
        </Text>
        <Text dimColor>
          {hasInFlightWork
            ? "The current in-flight Guild turn and any active tool run will be interrupted now. When you relaunch and choose Continue, Roscoe should not need to rebuild project understanding from scratch, but the interrupted step may need to be redriven."
            : "When you relaunch and choose Continue, Roscoe resumes from the saved lane state without reseeding the whole project understanding."}
        </Text>
        <KeyHints
          items={[
            { keyLabel: "Enter", description: "exit now" },
            { keyLabel: "Esc", description: "keep running" },
          ]}
        />
      </Box>
    </Panel>
  );
}
