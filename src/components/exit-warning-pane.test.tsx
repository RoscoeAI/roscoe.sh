import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ExitWarningPane } from "./exit-warning-pane.js";

describe("ExitWarningPane", () => {
  it("explains resume behavior while work is still in flight", () => {
    const { lastFrame } = render(
      <ExitWarningPane sessionCount={2} hasInFlightWork={true} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Exit Warning");
    expect(frame).toContain("provider thread IDs");
    expect(frame).toContain("in-flight Guild turn");
    expect(frame).toContain("interrupted");
    expect(frame).toContain("Continue");
    expect(frame).toContain("[Enter]");
    expect(frame).toContain("[Esc]");
  });

  it("shows the lighter resume note when no work is in flight", () => {
    const { lastFrame } = render(
      <ExitWarningPane sessionCount={1} hasInFlightWork={false} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("safe to resume later");
    expect(frame).toContain("without");
    expect(frame).toContain("reseeding the whole project understanding");
  });
});
