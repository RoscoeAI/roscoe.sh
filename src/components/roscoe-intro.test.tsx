import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { RoscoeIntro, buildMillFrames, buildRoscoeWordmark } from "./roscoe-intro.js";

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
    const branding = buildRoscoeWordmark(1, 2).join("\n");

    expect(partial).toContain("RRRR");
    expect(partial).toContain("OOO");
    expect(full).toContain("SSSS");
    expect(full).toContain("CCCC");
    expect(full).toContain("EEEEE");
    expect(branding).toContain("||||");
  });

  it("builds 8 mill frames at 80x24 with moving wheel buckets", () => {
    const frames = buildMillFrames();

    expect(frames).toHaveLength(8);
    expect(frames[0]).toHaveLength(24);
    expect(frames[0][0]).toContain("≈≈≈≈");
    expect(frames[0][4]).toContain("[=======]");
    expect(frames[0][8]).toContain("[ ]");
    expect(frames[0][23].length).toBe(80);
    expect(frames[0].join("\n")).not.toBe(frames[1].join("\n"));
    expect(frames[0].join("\n")).toContain("U");
    expect(frames[1].join("\n")).toContain("V");
  });

  it("reveals Roscoe beneath the mill scene and waits for any key to continue", async () => {
    const onDone = vi.fn();
    const app = render(<RoscoeIntro onDone={onDone} />);

    expect(app.lastFrame()).toContain("[=======]");
    expect(app.lastFrame()).toContain("XXXXXXXXXXXX");

    await vi.advanceTimersByTimeAsync(3000);
    expect(app.lastFrame()).toContain("EEEEE");

    await vi.advanceTimersByTimeAsync(2600);
    expect(app.lastFrame()).toContain("Autopilot for Claude & Codex CLIs");

    await vi.advanceTimersByTimeAsync(1200);
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
