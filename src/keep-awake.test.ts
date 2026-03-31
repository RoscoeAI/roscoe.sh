import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExistsSync, mockSpawn } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: mockExistsSync,
}));

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}));

import {
  isRoscoeKeepAwakeSupported,
  resetRoscoeKeepAwakeForTests,
  setRoscoeKeepAwakeEnabled,
} from "./keep-awake.js";

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", {
    value,
    configurable: true,
  });
}

function createChild() {
  const handlers: Record<string, Array<() => void>> = {};
  const child = {
    on: vi.fn((event: string, handler: () => void) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
      return child;
    }),
    unref: vi.fn(),
    kill: vi.fn(),
    emit(event: string) {
      for (const handler of handlers[event] ?? []) {
        handler();
      }
    },
  } as const;
  return child;
}

let originalPlatform: NodeJS.Platform;

describe("keep-awake", () => {
  beforeEach(() => {
    originalPlatform = process.platform;
    setPlatform("darwin");
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    resetRoscoeKeepAwakeForTests();
  });

  afterEach(() => {
    resetRoscoeKeepAwakeForTests();
    setPlatform(originalPlatform);
    vi.unstubAllEnvs();
  });

  it("reports support only on macOS outside test mode with caffeinate present", () => {
    expect(isRoscoeKeepAwakeSupported()).toBe(true);

    vi.stubEnv("NODE_ENV", "test");
    expect(isRoscoeKeepAwakeSupported()).toBe(false);

    vi.stubEnv("NODE_ENV", "production");
    setPlatform("linux");
    expect(isRoscoeKeepAwakeSupported()).toBe(false);
  });

  it("starts caffeinate once and stops it when disabled", () => {
    const child = createChild();
    mockSpawn.mockReturnValue(child);

    setRoscoeKeepAwakeEnabled(true);
    setRoscoeKeepAwakeEnabled(true);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith("/usr/bin/caffeinate", ["-dimsu", "-w", String(process.pid)], {
      stdio: "ignore",
    });
    expect(child.unref).toHaveBeenCalled();

    setRoscoeKeepAwakeEnabled(false);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("clears the tracked process after exit or error so it can restart", () => {
    const firstChild = createChild();
    const secondChild = createChild();
    const thirdChild = createChild();
    mockSpawn
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild)
      .mockReturnValueOnce(thirdChild);

    setRoscoeKeepAwakeEnabled(true);
    firstChild.emit("exit");
    setRoscoeKeepAwakeEnabled(true);
    secondChild.emit("error");
    setRoscoeKeepAwakeEnabled(true);

    expect(mockSpawn).toHaveBeenCalledTimes(3);
  });

  it("ignores exit notifications from stale child processes", () => {
    const firstChild = createChild();
    const secondChild = createChild();
    mockSpawn
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);

    setRoscoeKeepAwakeEnabled(true);
    setRoscoeKeepAwakeEnabled(false);
    setRoscoeKeepAwakeEnabled(true);
    firstChild.emit("exit");
    setRoscoeKeepAwakeEnabled(true);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it("does nothing when keep-awake is unsupported", () => {
    mockExistsSync.mockReturnValue(false);

    setRoscoeKeepAwakeEnabled(true);

    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
