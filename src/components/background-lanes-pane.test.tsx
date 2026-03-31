import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { BackgroundLanesPane } from "./background-lanes-pane.js";

describe("BackgroundLanesPane", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the running lane count with plural lanes", () => {
    const { lastFrame } = render(<BackgroundLanesPane laneCount={2} />);
    const frame = lastFrame()!;

    expect(frame).toContain("2 lanes running");
  });

  it("renders the singular lane label", () => {
    const { lastFrame } = render(<BackgroundLanesPane laneCount={1} />);
    const frame = lastFrame()!;

    expect(frame).toContain("1 lane running");
  });

  it("lists the other running lane names", () => {
    const { lastFrame } = render(<BackgroundLanesPane laneCount={1} laneNames={["appsicle"]} />);
    const frame = lastFrame()!;

    expect(frame).toContain("1 lane running");
    expect(frame).toContain("(appsicle)");
  });

  it("summarizes more than two running lane names", () => {
    const { lastFrame } = render(
      <BackgroundLanesPane laneCount={4} laneNames={["appsicle", "nanobots", "roscoe-web", "k12"]} />,
    );
    const frame = lastFrame()!;

    expect(frame).toContain("4 lanes running");
    expect(frame).toContain("appsicle, nanobots +2");
  });

  it("pulses when the turn signal changes and then settles back to idle", async () => {
    vi.useFakeTimers();
    const app = render(<BackgroundLanesPane laneCount={1} laneNames={["appsicle"]} turnSignal="turn-1" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(app.lastFrame()).toContain("(appsicle)");

    await act(async () => {
      app.rerender(<BackgroundLanesPane laneCount={1} laneNames={["appsicle"]} turnSignal="turn-2" />);
      await Promise.resolve();
    });
    expect(app.lastFrame()).toContain("turn change (appsicle)");

    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(app.lastFrame()).toContain("(appsicle)");
  });

  it("clears any active pulse when the turn signal disappears", async () => {
    vi.useFakeTimers();
    const app = render(<BackgroundLanesPane laneCount={2} turnSignal="turn-1" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      app.rerender(<BackgroundLanesPane laneCount={2} turnSignal="turn-2" />);
      await Promise.resolve();
    });
    expect(app.lastFrame()).toContain("turn change");

    await act(async () => {
      app.rerender(<BackgroundLanesPane laneCount={2} turnSignal={null} />);
      await Promise.resolve();
    });
    expect(app.lastFrame()).toContain("lanes");
    expect(app.lastFrame()).not.toContain("turn change");
  });
});
