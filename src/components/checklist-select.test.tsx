import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { ChecklistSelect } from "./checklist-select.js";

function delay(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ChecklistSelect", () => {
  it("submits the focused option when nothing is explicitly selected", async () => {
    const onSubmit = vi.fn();
    const app = render(
      <ChecklistSelect
        options={["one", "two", "three"]}
        onSubmit={onSubmit}
      />,
    );

    try {
      expect(app.lastFrame()).toContain("› [ ] one");

      app.stdin.write("\r");
      await delay();

      expect(onSubmit).toHaveBeenCalledWith(["one"]);
    } finally {
      app.unmount();
    }
  });

  it("renders every option and the keyboard hints", () => {
    const app = render(
      <ChecklistSelect
        options={["alpha", "beta", "skip"]}
        exclusiveValue="skip"
        onSubmit={vi.fn()}
      />,
    );

    try {
      const frame = app.lastFrame();
      expect(frame).toContain("[ ] alpha");
      expect(frame).toContain("[ ] beta");
      expect(frame).toContain("[ ] skip");
      expect(frame).toContain("Space");
      expect(frame).toContain("Enter");
    } finally {
      app.unmount();
    }
  });

  it("wraps cursor movement, toggles selections, and submits the chosen values", async () => {
    const onSubmit = vi.fn();
    const app = render(
      <ChecklistSelect
        options={["alpha", "beta", "gamma"]}
        onSubmit={onSubmit}
      />,
    );

    try {
      app.stdin.write("\u001B[A");
      await delay();
      expect(app.lastFrame()).toContain("› [ ] gamma");

      app.stdin.write(" ");
      await delay();
      expect(app.lastFrame()).toContain("[x] gamma");

      app.stdin.write("\u001B[B");
      await delay();
      expect(app.lastFrame()).toContain("› [ ] alpha");

      app.stdin.write(" ");
      await delay();
      expect(app.lastFrame()).toContain("[x] alpha");

      app.stdin.write("\r");
      await delay();

      expect(onSubmit).toHaveBeenCalledWith(["gamma", "alpha"]);
    } finally {
      app.unmount();
    }
  });

  it("enforces the exclusive option and allows deselecting it", async () => {
    const onSubmit = vi.fn();
    const app = render(
      <ChecklistSelect
        options={["alpha", "beta", "skip"]}
        exclusiveValue="skip"
        onSubmit={onSubmit}
      />,
    );

    try {
      app.stdin.write(" ");
      await delay();
      expect(app.lastFrame()).toContain("[x] alpha");

      app.stdin.write("\u001B[B");
      await delay();
      app.stdin.write("\u001B[B");
      await delay();
      expect(app.lastFrame()).toContain("› [ ] skip");

      app.stdin.write(" ");
      await delay();
      expect(app.lastFrame()).toContain("[x] skip");
      expect(app.lastFrame()).not.toContain("[x] alpha");

      app.stdin.write(" ");
      await delay();
      expect(app.lastFrame()).toContain("› [ ] skip");

      app.stdin.write("\r");
      await delay();

      expect(onSubmit).toHaveBeenCalledWith(["skip"]);
    } finally {
      app.unmount();
    }
  });
});
