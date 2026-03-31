import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";

const HEARTBEAT_FRAMES = ["·", "•", "∙", "•"];
const ACTIVITY_FRAMES = ["*", "+", "*", "+"];

interface BackgroundLanesPaneProps {
  laneCount: number;
  laneNames?: string[];
  turnSignal?: string | null;
}

function summarizeLaneNames(laneNames: string[]): string {
  if (laneNames.length === 0) return "";
  if (laneNames.length <= 2) return laneNames.join(", ");
  return `${laneNames.slice(0, 2).join(", ")} +${laneNames.length - 2}`;
}

export function BackgroundLanesPane({ laneCount, laneNames = [], turnSignal = null }: BackgroundLanesPaneProps) {
  const [heartbeat, setHeartbeat] = useState(0);
  const [pulseActive, setPulseActive] = useState(false);
  const previousTurnSignal = useRef<string | null>(null);
  const laneLabel = laneCount === 1 ? "lane" : "lanes";
  const laneSummary = summarizeLaneNames(laneNames);

  useEffect(() => {
    const timer = setInterval(() => {
      setHeartbeat((current) => current + 1);
    }, 260);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!turnSignal) {
      previousTurnSignal.current = turnSignal;
      setPulseActive(false);
      return;
    }

    if (previousTurnSignal.current && previousTurnSignal.current !== turnSignal) {
      setPulseActive(true);
      previousTurnSignal.current = turnSignal;
      const timer = setTimeout(() => {
        setPulseActive(false);
      }, 1600);
      return () => clearTimeout(timer);
    }

    previousTurnSignal.current = turnSignal;
  }, [turnSignal]);

  const accentColor = pulseActive ? "yellow" : "red";
  const idleSuffix = HEARTBEAT_FRAMES[heartbeat % HEARTBEAT_FRAMES.length];
  const pulseSuffix = ACTIVITY_FRAMES[heartbeat % ACTIVITY_FRAMES.length];
  const statusText = pulseActive
    ? laneSummary
      ? `turn change (${laneSummary}) ${pulseSuffix}`
      : `turn change ${pulseSuffix}`
    : laneSummary
      ? `(${laneSummary}) ${idleSuffix}`
      : `${laneLabel} ${idleSuffix}`;

  return (
    <Box
      borderStyle="round"
      borderColor={accentColor}
      paddingX={1}
      flexDirection="column"
      minWidth={22}
    >
      <Text color={accentColor} bold>{laneCount} {laneLabel} running</Text>
      <Text color={accentColor} bold>
        {statusText}
      </Text>
    </Box>
  );
}
