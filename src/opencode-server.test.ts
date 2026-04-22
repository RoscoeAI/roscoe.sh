import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { OpenCodeServerManager } from "./opencode-server.js";

function createMockProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 4321;
  return proc;
}

describe("OpenCodeServerManager", () => {
  it("leaves non-OpenCode profiles unchanged", async () => {
    const manager = new OpenCodeServerManager();
    const profile = {
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude" as const,
    };

    await expect(manager.prepareProfile(profile, "/tmp/project")).resolves.toEqual(profile);
  });

  it("starts and reuses a warm server per worktree/provider", async () => {
    const mockSpawn = vi.fn(() => createMockProc() as any);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ healthy: true }),
    })) as unknown as typeof fetch;
    const manager = new OpenCodeServerManager({
      spawnProcess: mockSpawn as any,
      fetchImpl,
      allocatePort: async () => 4096,
    });

    // Local now runs in-process; only OpenRouter still needs the warm
    // `opencode serve` attach server.
    const baseProfile = {
      name: "openrouter",
      command: "opencode",
      args: [],
      protocol: "openrouter" as const,
      env: {
        OPENCODE_CONFIG: "/tmp/opencode.json",
      },
    };

    const first = await manager.prepareProfile(baseProfile, "/tmp/project");
    const second = await manager.prepareProfile(baseProfile, "/tmp/project");

    expect(first.attachUrl).toBe("http://127.0.0.1:4096");
    expect(second.attachUrl).toBe("http://127.0.0.1:4096");
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      "opencode",
      ["serve", "--hostname", "127.0.0.1", "--port", "4096"],
      expect.objectContaining({
        cwd: "/tmp/project",
        detached: false,
      }),
    );
  });

  it("shares one warm server across a swarm that calls prepareProfile concurrently", async () => {
    // Simulates the 16-worker launch race: N callers invoke prepareProfile
    // at the same tick before any server has finished booting. Each must
    // collapse onto the same in-flight start and reuse the resulting URL.
    let portCounter = 5000;
    const mockSpawn = vi.fn(() => createMockProc() as any);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ healthy: true }),
    })) as unknown as typeof fetch;
    const manager = new OpenCodeServerManager({
      spawnProcess: mockSpawn as any,
      fetchImpl,
      allocatePort: async () => {
        portCounter += 1;
        return portCounter;
      },
    });

    const baseProfile = {
      name: "openrouter",
      command: "opencode",
      args: [],
      protocol: "openrouter" as const,
      env: {
        OPENCODE_CONFIG: "/tmp/opencode.json",
      },
    };

    const calls = Array.from({ length: 16 }, () =>
      manager.prepareProfile(baseProfile, "/tmp/project"),
    );
    const resolved = await Promise.all(calls);

    const urls = new Set(resolved.map((p) => p.attachUrl));
    expect(urls.size).toBe(1);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});
