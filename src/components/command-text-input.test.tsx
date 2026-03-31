import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { CommandTextInput } from "./command-text-input.js";

function delay(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("CommandTextInput", () => {
  it("renders the placeholder when empty", () => {
    const app = render(
      <CommandTextInput
        placeholder="Type a message"
        onSubmit={vi.fn()}
      />,
    );

    try {
      expect(app.lastFrame()).toContain("Type a message");
    } finally {
      app.unmount();
    }
  });

  it("renders the provided value", () => {
    const app = render(
      <CommandTextInput
        value="abc"
        onSubmit={vi.fn()}
      />,
    );

    try {
      expect(app.lastFrame()).toContain("abc");
    } finally {
      app.unmount();
    }
  });

  it("supports typing, cursor movement, and submit", async () => {
    const onSubmit = vi.fn();
    const app = render(
      <CommandTextInput
        value="ab"
        onSubmit={onSubmit}
      />,
    );

    try {
      app.stdin.write("\u001B[D");
      await delay();
      app.stdin.write("Z");
      await delay();
      expect(app.lastFrame()).toContain("aZb");
      app.stdin.write("\r");
      await delay();

      expect(onSubmit).toHaveBeenCalledWith("aZb");
    } finally {
      app.unmount();
    }
  });

  it("supports home, end, and backspace/delete editing", async () => {
    const onSubmit = vi.fn();
    const app = render(
      <CommandTextInput
        value="abcd"
        onSubmit={onSubmit}
      />,
    );

    try {
      app.stdin.write("\u001B[H");
      await delay();
      app.stdin.write("\u007F");
      await delay();
      expect(app.lastFrame()).toContain("abcd");

      app.stdin.write("\u001B[F");
      await delay();
      app.stdin.write("\u007F");
      await delay();
      expect(app.lastFrame()).toContain("abc");

      app.stdin.write("\u001B[D");
      await delay();
      app.stdin.write("\u001B[3~");
      await delay();
      expect(app.lastFrame()).toContain("ac");

      app.stdin.write("\r");
      await delay();
      expect(onSubmit).toHaveBeenCalledWith("ac");
    } finally {
      app.unmount();
    }
  });

  it("ignores ctrl/meta/escape keypresses", async () => {
    const onSubmit = vi.fn();
    const app = render(
      <CommandTextInput
        value="abc"
        onSubmit={onSubmit}
      />,
    );

    try {
      app.stdin.write("\u001B");
      await delay();
      app.stdin.write("\u0003");
      await delay();
      expect(app.lastFrame()).toContain("abc");
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      app.unmount();
    }
  });

  it("syncs to external value changes and clamps right-arrow movement at the end", async () => {
    const onSubmit = vi.fn();
    const app = render(
      <CommandTextInput
        value="abc"
        onSubmit={onSubmit}
      />,
    );

    try {
      app.rerender(
        <CommandTextInput
          value="xy"
          onSubmit={onSubmit}
        />,
      );
      await delay();
      expect(app.lastFrame()).toContain("xy");

      app.stdin.write("\u001B[C");
      await delay();
      app.stdin.write("\u001B[C");
      await delay();
      app.stdin.write("\u001B[C");
      await delay();
      app.stdin.write("Z");
      await delay();

      expect(app.lastFrame()).toContain("xyZ");
      app.stdin.write("\r");
      await delay();
      expect(onSubmit).toHaveBeenLastCalledWith("xyZ");
    } finally {
      app.unmount();
    }
  });
});
