import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { CloseLanePane } from "./close-lane-pane.js";

describe("CloseLanePane", () => {
  it("explains that the current lane will be saved and closed", () => {
    const { lastFrame } = render(
      <CloseLanePane laneCount={2} hasInFlightWork={true} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Close Lane");
    expect(frame).toContain("Stop only the current lane?");
    expect(frame).toContain("1 lane will stay open");
    expect(frame).toContain("save this lane");
    expect(frame).toContain("interrupted now");
    expect(frame).toContain("[Enter]");
    expect(frame).toContain("close lane");
  });

  it("sends the user back to dispatch when closing the last lane", () => {
    const { lastFrame } = render(
      <CloseLanePane laneCount={1} hasInFlightWork={false} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("returns to dispatch");
    expect(frame).toContain("Nothing is actively running");
    expect(frame).toContain("[Esc]");
    expect(frame).toContain("keep lane");
  });

  it("pluralizes the remaining lane count when more than one lane stays open", () => {
    const { lastFrame } = render(
      <CloseLanePane laneCount={3} hasInFlightWork={false} />,
    );

    expect(lastFrame()!).toContain("2 lanes will stay open");
  });
});
