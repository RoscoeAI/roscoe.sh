import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

import { appendFileSync, mkdirSync } from "fs";

describe("debug-log", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(appendFileSync).mockClear();
    vi.mocked(mkdirSync).mockClear();
  });

  it("isDebug returns false by default", async () => {
    const { isDebug } = await import("./debug-log.js");
    expect(isDebug()).toBe(false);
  });

  it("enableDebug sets isDebug to true", async () => {
    const { enableDebug, isDebug } = await import("./debug-log.js");
    enableDebug();
    expect(isDebug()).toBe(true);
  });

  it("enableDebug creates log directory and writes session header", async () => {
    const { enableDebug } = await import("./debug-log.js");
    enableDebug();
    expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining("debug.log"),
      expect.stringContaining("--- session"),
    );
  });

  it("dbg does nothing when not enabled", async () => {
    const { dbg } = await import("./debug-log.js");
    dbg("test", "message");
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it("dbg writes formatted log line when enabled", async () => {
    const { enableDebug, dbg } = await import("./debug-log.js");
    enableDebug();
    vi.mocked(appendFileSync).mockClear();
    dbg("proc", "spawned", "claude");
    expect(appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[proc\] spawned claude\n/),
    );
  });

  it("dbg serializes non-string args as JSON", async () => {
    const { enableDebug, dbg } = await import("./debug-log.js");
    enableDebug();
    vi.mocked(appendFileSync).mockClear();
    dbg("test", { key: "value" });
    expect(appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('{"key":"value"}'),
    );
  });
});
