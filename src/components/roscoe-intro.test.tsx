import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { RoscoeIntro, buildPulseRail, buildRoscoeWordmark } from "./roscoe-intro.js";

describe("RoscoeIntro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a stamped wordmark as the name reveals", () => {
    const partial = buildRoscoeWordmark(2).join("\n");
    const full = buildRoscoeWordmark(7).join("\n");
    const spinning = buildRoscoeWordmark(1, 2).join("\n");

    expect(partial).toContain("RRRR");
    expect(partial).toContain("OOO");
    expect(partial).not.toContain("......");
    expect(full).toContain("SSSS");
    expect(full).toContain("CCCC");
    expect(full).toContain("EEEEE");
    expect(full).not.toContain(".");
    expect(spinning).toContain("|====|");
  });

  it("animates telegraph pulse rails", () => {
    expect(buildPulseRail(12, 0)).toContain("o");
    expect(buildPulseRail(12, 6)).not.toBe(buildPulseRail(12, 0));
    expect(buildPulseRail(2, 0).length).toBeGreaterThanOrEqual(6);
  });

  it("reveals Roscoe and waits for any key to continue", async () => {
    const onDone = vi.fn();
    const app = render(<RoscoeIntro onDone={onDone} />);

    expect(app.lastFrame()).toContain("[___|_[]_|___]");
    expect(app.lastFrame()).toContain("======");

    await vi.advanceTimersByTimeAsync(2600);
    expect(app.lastFrame()).toContain("EEEEE");

    await vi.advanceTimersByTimeAsync(2500);
    expect(app.lastFrame()).toContain("Autopilot for Claude & Codex CLIs");

    await vi.advanceTimersByTimeAsync(900);
    expect(app.lastFrame()).toContain("Press any key to begin.");
    expect(onDone).not.toHaveBeenCalled();

    app.stdin.write("x");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ignores ctrl/meta shortcuts and only finishes once", async () => {
    const onDone = vi.fn();
    const app = render(<RoscoeIntro onDone={onDone} />);

    app.stdin.write("\u0003");
    expect(onDone).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    app.stdin.write("\u001B[A");
    expect(onDone).toHaveBeenCalledTimes(1);

    app.stdin.write("x");
    expect(onDone).toHaveBeenCalledTimes(1);

    app.unmount();
  });

  it("cleans up the animation interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const app = render(<RoscoeIntro onDone={vi.fn()} />);

    app.unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
