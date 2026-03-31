import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { Text } from "ink";
import { Divider, KeyHints, Panel, Pill } from "./chrome.js";

describe("chrome components", () => {
  it("renders a panel with subtitle, right label, and body content", () => {
    const app = render(
      <Panel title="Roscoe" subtitle="Dispatch" rightLabel="ready">
        <Text>body</Text>
      </Panel>,
    );

    try {
      const frame = app.lastFrame();
      expect(frame).toContain("Roscoe");
      expect(frame).toContain("Dispatch");
      expect(frame).toContain("ready");
      expect(frame).toContain("body");
    } finally {
      app.unmount();
    }
  });

  it("renders key hints, pills, and both divider variants", () => {
    const app = render(
      <>
        <KeyHints items={[{ keyLabel: "h", description: "dispatch" }]} />
        <Pill label="active" color="green" />
        <Divider />
        <Divider label="Lane" />
      </>,
    );

    try {
      const frame = app.lastFrame();
      expect(frame).toContain("[h]");
      expect(frame).toContain("dispatch");
      expect(frame).toContain("[active]");
      expect(frame).toContain("Lane");
    } finally {
      app.unmount();
    }
  });

  it("renders a panel without subtitle or right label and respects body flex grow", () => {
    const app = render(
      <Panel title="Bare" bodyFlexGrow>
        <Text>content</Text>
      </Panel>,
    );

    try {
      const frame = app.lastFrame();
      expect(frame).toContain("Bare");
      expect(frame).toContain("content");
    } finally {
      app.unmount();
    }
  });
});
