import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

interface CommandTextInputProps {
  value?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
}

function renderWithCursor(value: string, cursor: number): React.ReactNode {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, safeCursor);
  const current = safeCursor < value.length ? value[safeCursor] : " ";
  const after = safeCursor < value.length ? value.slice(safeCursor + 1) : "";

  return (
    <Text>
      {before}
      <Text inverse>{current}</Text>
      {after}
    </Text>
  );
}

export function CommandTextInput({ value = "", placeholder, onSubmit }: CommandTextInputProps) {
  const [state, setState] = useState({ text: value, cursor: value.length });
  const previousValueRef = useRef(value);

  useEffect(() => {
    if (previousValueRef.current === value) {
      return;
    }
    previousValueRef.current = value;
    setState({ text: value, cursor: value.length });
  }, [value]);

  useInput((input, key) => {
    if (key.ctrl || key.meta || key.escape) {
      return;
    }

    if (key.return) {
      onSubmit(state.text);
      return;
    }

    if (key.leftArrow) {
      setState((current) => ({ ...current, cursor: Math.max(0, current.cursor - 1) }));
      return;
    }

    if (key.rightArrow) {
      setState((current) => ({ ...current, cursor: Math.min(current.text.length, current.cursor + 1) }));
      return;
    }

    if (key.home) {
      setState((current) => ({ ...current, cursor: 0 }));
      return;
    }

    if (key.end) {
      setState((current) => ({ ...current, cursor: current.text.length }));
      return;
    }

    if (key.backspace || key.delete) {
      setState((current) => {
        if (current.cursor === 0) {
          return current;
        }
        return {
          text: current.text.slice(0, current.cursor - 1) + current.text.slice(current.cursor),
          cursor: Math.max(0, current.cursor - 1),
        };
      });
      return;
    }

    if (!input) return;

    setState((current) => ({
      text: current.text.slice(0, current.cursor) + input + current.text.slice(current.cursor),
      cursor: current.cursor + input.length,
    }));
  });

  const display = useMemo(() => {
    if (!state.text && placeholder) {
      return (
        <Text dimColor>
          {placeholder}
          <Text inverse> </Text>
        </Text>
      );
    }
    return renderWithCursor(state.text, state.cursor);
  }, [placeholder, state.cursor, state.text]);

  return (
    <Box borderStyle="round" borderColor="magenta" paddingX={1}>
      {display}
    </Box>
  );
}
