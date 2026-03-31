import React from "react";
import { Box, Text } from "ink";
import { KeyHints, Panel } from "./chrome.js";

interface CloseLanePaneProps {
  laneCount: number;
  hasInFlightWork: boolean;
}

export function CloseLanePane({ laneCount, hasInFlightWork }: CloseLanePaneProps) {
  const remainingLaneCount = Math.max(0, laneCount - 1);
  const destinationLabel = remainingLaneCount > 0
    ? `${remainingLaneCount} lane${remainingLaneCount === 1 ? "" : "s"} will stay open`
    : "returns to dispatch";

  return (
    <Panel
      title="Close Lane"
      subtitle="Stop only the current lane?"
      rightLabel={destinationLabel}
      accentColor="yellow"
      minHeight={8}
      flexShrink={0}
    >
      <Box flexDirection="column" gap={1}>
        <Text color="yellow">
          Roscoe will save this lane’s transcript, provider thread IDs, hidden responder thread, and runtime state before closing it.
        </Text>
        <Text dimColor>
          {hasInFlightWork
            ? "Any in-flight Guild turn, active tool run, or Roscoe draft on this lane will be interrupted now. You can resume this lane later from Dispatch."
            : "Nothing is actively running on this lane right now. You can reopen it later from Dispatch and continue from the saved lane state."}
        </Text>
        <KeyHints
          items={[
            { keyLabel: "Enter", description: "close lane" },
            { keyLabel: "Esc", description: "keep lane" },
          ]}
        />
      </Box>
    </Panel>
  );
}
