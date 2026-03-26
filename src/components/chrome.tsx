import React from "react";
import { Box, Text } from "ink";

interface PanelProps extends Omit<React.ComponentProps<typeof Box>, "children"> {
  title: string;
  subtitle?: string;
  accentColor?: string;
  rightLabel?: string;
  children: React.ReactNode;
}

export function Panel({
  title,
  subtitle,
  accentColor = "cyan",
  rightLabel,
  children,
  ...boxProps
}: PanelProps) {
  return (
    <Box
      {...boxProps}
      flexDirection="column"
      borderStyle="round"
      borderColor={accentColor}
      paddingX={1}
      overflow="hidden"
    >
      <Box justifyContent="space-between" gap={1} flexWrap="wrap">
        <Text bold color={accentColor}>
          {title}
        </Text>
        {rightLabel ? <Text dimColor>{rightLabel}</Text> : <Text dimColor> </Text>}
      </Box>
      {subtitle && (
        <Text dimColor wrap="wrap">{subtitle}</Text>
      )}
      <Box marginTop={subtitle ? 1 : 0} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}

interface KeyHintsProps {
  items: Array<{ keyLabel: string; description: string }>;
}

export function KeyHints({ items }: KeyHintsProps) {
  return (
    <Box gap={2} flexWrap="wrap">
      {items.map((item) => (
        <Box key={`${item.keyLabel}-${item.description}`} gap={1}>
          <Text color="cyan">[{item.keyLabel}]</Text>
          <Text dimColor>{item.description}</Text>
        </Box>
      ))}
    </Box>
  );
}

interface PillProps {
  label: string;
  color?: string;
}

export function Pill({ label, color = "gray" }: PillProps) {
  return (
    <Text color={color}>
      [{label}]
    </Text>
  );
}

export function Divider({ label }: { label?: string }) {
  if (!label) {
    return <Text dimColor>────────────────────────────────────────────────────────</Text>;
  }

  return (
    <Box gap={1}>
      <Text dimColor>──</Text>
      <Text dimColor>{label}</Text>
      <Text dimColor>────────────────────────────────────────────────────</Text>
    </Box>
  );
}
