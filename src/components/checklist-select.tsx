import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

interface ChecklistSelectProps {
  options: string[];
  onSubmit: (selected: string[]) => void;
  exclusiveValue?: string;
}

export function ChecklistSelect({
  options,
  onSubmit,
  exclusiveValue,
}: ChecklistSelectProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const cappedCursor = Math.max(0, Math.min(cursor, Math.max(0, options.length - 1)));
  const focusedValue = options[cappedCursor];
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((current) => (current - 1 + options.length) % options.length);
      return;
    }

    if (key.downArrow) {
      setCursor((current) => (current + 1) % options.length);
      return;
    }

    if (input === " ") {
      setSelected((current) => {
        const next = new Set(current);
        const isActive = next.has(focusedValue);

        if (isActive) {
          next.delete(focusedValue);
          return Array.from(next);
        }

        if (exclusiveValue && focusedValue === exclusiveValue) {
          return [focusedValue];
        }

        if (exclusiveValue) {
          next.delete(exclusiveValue);
        }

        next.add(focusedValue);
        return Array.from(next);
      });
      return;
    }

    if (key.return) {
      if (selected.length > 0) {
        onSubmit(selected);
        return;
      }

      onSubmit(focusedValue ? [focusedValue] : []);
    }
  }, { isActive: options.length > 0 });

  return (
    <Box flexDirection="column">
      {options.map((option, index) => {
        const focused = index === cappedCursor;
        const checked = selectedSet.has(option);
        return (
          <Box key={`${option}-${index}`}>
            <Text color={focused ? "cyan" : undefined}>
              {focused ? "›" : " "} {checked ? "[x]" : "[ ]"} {option}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>
          <Text color="cyan">↑/↓</Text> move <Text color="cyan">Space</Text> toggle <Text color="cyan">Enter</Text> submit
        </Text>
      </Box>
    </Box>
  );
}
