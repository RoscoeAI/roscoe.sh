import { ChildProcess, spawn } from "child_process";
import { createServer } from "net";
import { resolve } from "path";
import { dbg } from "./debug-log.js";
import { detectProtocol, HeadlessProfile } from "./llm-runtime.js";

const OPENCODE_SERVER_HOST = "127.0.0.1";
const OPENCODE_SERVER_START_TIMEOUT_MS = 15_000;
const OPENCODE_HEALTH_POLL_INTERVAL_MS = 200;
const LIVE_SERVER_MANAGERS = new Set<OpenCodeServerManager>();
let processHooksInstalled = false;

interface OpenCodeServerRecord {
  key: string;
  url: string;
  proc: ChildProcess;
  ready: Promise<string>;
  lastError: string | null;
  closed: boolean;
}

interface OpenCodeServerManagerDeps {
  spawnProcess?: typeof spawn;
  fetchImpl?: typeof fetch;
  allocatePort?: () => Promise<number>;
}

function isOpenCodeProtocol(profile: HeadlessProfile): boolean {
  // The Local provider moved off opencode proxying and now runs in-process
  // via `LocalGuildSwarm` / `LocalGuildWorker`. Only OpenRouter still needs
  // an `opencode serve` warm server to attach to.
  const protocol = detectProtocol(profile);
  return protocol === "openrouter";
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, OPENCODE_SERVER_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port || !Number.isFinite(port)) {
          reject(new Error("Unable to allocate an OpenCode attach port"));
          return;
        }
        resolvePort(port);
      });
    });
  });
}

export class OpenCodeServerManager {
  private readonly spawnProcess: typeof spawn;
  private readonly fetchImpl: typeof fetch;
  private readonly allocatePort: () => Promise<number>;
  private readonly servers = new Map<string, OpenCodeServerRecord>();
  // In-flight start promises keyed the same way as `servers`. Critical for
  // swarm launches: when N workers call ensureServer concurrently for the
  // same (protocol, cwd, command, OPENCODE_CONFIG) key, we must hand each
  // caller the SAME start promise so all N share one `opencode serve`
  // instead of each racing to spawn their own.
  private readonly pendingStarts = new Map<string, Promise<string>>();

  constructor(deps: OpenCodeServerManagerDeps = {}) {
    this.spawnProcess = deps.spawnProcess ?? spawn;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.allocatePort = deps.allocatePort ?? allocateLoopbackPort;
    LIVE_SERVER_MANAGERS.add(this);
    this.installProcessHooks();
  }

  async prepareProfile(profile: HeadlessProfile, cwd: string): Promise<HeadlessProfile> {
    if (!isOpenCodeProtocol(profile)) {
      return profile;
    }
    const url = await this.ensureServer(profile, cwd);
    return {
      ...profile,
      attachUrl: url,
    };
  }

  async disposeAll(): Promise<void> {
    const records = Array.from(this.servers.values());
    this.servers.clear();
    this.pendingStarts.clear();
    LIVE_SERVER_MANAGERS.delete(this);
    await Promise.all(records.map(async (record) => {
      record.closed = true;
      try {
        record.proc.kill("SIGTERM");
      } catch {
        // Ignore stale child processes.
      }
    }));
  }

  private async ensureServer(profile: HeadlessProfile, cwd: string): Promise<string> {
    const key = this.buildKey(profile, cwd);

    // Concurrent callers collapse onto the same in-flight start.
    const pending = this.pendingStarts.get(key);
    if (pending) {
      return pending;
    }

    const existing = this.servers.get(key);
    if (existing) {
      try {
        await existing.ready;
        if (await this.isHealthy(existing.url)) {
          return existing.url;
        }
      } catch {
        // Restart the server below.
      }
      this.disposeRecord(key, existing);
    }

    const startPromise = this.startAndRegister(profile, cwd, key);
    this.pendingStarts.set(key, startPromise);
    try {
      return await startPromise;
    } finally {
      // Only clear the in-flight tracker if it still points at this promise —
      // disposeAll or a later restart may have replaced it.
      if (this.pendingStarts.get(key) === startPromise) {
        this.pendingStarts.delete(key);
      }
    }
  }

  private async startAndRegister(
    profile: HeadlessProfile,
    cwd: string,
    key: string,
  ): Promise<string> {
    const record = await this.startServer(profile, cwd);
    this.servers.set(key, record);
    try {
      return await record.ready;
    } catch (error) {
      this.disposeRecord(key, record);
      throw error;
    }
  }

  private installProcessHooks(): void {
    if (processHooksInstalled) {
      return;
    }
    processHooksInstalled = true;
    const disposeAllManagers = () => {
      for (const manager of LIVE_SERVER_MANAGERS) {
        void manager.disposeAll();
      }
    };
    process.once("exit", disposeAllManagers);
    process.once("SIGINT", () => {
      disposeAllManagers();
      process.exit(130);
    });
    process.once("SIGTERM", () => {
      disposeAllManagers();
      process.exit(143);
    });
  }

  private buildKey(profile: HeadlessProfile, cwd: string): string {
    return [
      detectProtocol(profile),
      resolve(cwd),
      profile.command,
      profile.env?.OPENCODE_CONFIG ?? "",
    ].join("::");
  }

  private async startServer(profile: HeadlessProfile, cwd: string): Promise<OpenCodeServerRecord> {
    const port = await this.allocatePort();
    const url = `http://${OPENCODE_SERVER_HOST}:${port}`;
    const env = {
      ...(profile.env ?? {}),
      ...process.env,
    };
    const args = [
      "serve",
      "--hostname",
      OPENCODE_SERVER_HOST,
      "--port",
      String(port),
    ];
    const proc = this.spawnProcess(profile.command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: env as Record<string, string>,
      detached: false,
    });

    const record: OpenCodeServerRecord = {
      key: this.buildKey(profile, cwd),
      url,
      proc,
      ready: Promise.resolve(url),
      lastError: null,
      closed: false,
    };

    let stderrText = "";
    let finalized = false;
    const ready = new Promise<string>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => {
        finalized = true;
        record.lastError = stderrText.trim() || `Timed out waiting for OpenCode server at ${url}`;
        rejectReady(new Error(record.lastError));
      }, OPENCODE_SERVER_START_TIMEOUT_MS);

      const finishError = (message: string) => {
        if (finalized) return;
        finalized = true;
        clearTimeout(timeout);
        record.lastError = message;
        rejectReady(new Error(message));
      };

      proc.once("error", (error) => {
        finishError(error.message);
      });

      proc.once("close", (code) => {
        record.closed = true;
        if (finalized) return;
        finishError(stderrText.trim().split("\n")[0] || `OpenCode server exited with code ${code}`);
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrText += text;
        if (text.trim()) {
          dbg("opencode:server:stderr", text.trim());
        }
      });

      void this.waitForHealthy(url)
        .then(() => {
          if (finalized) return;
          finalized = true;
          clearTimeout(timeout);
          resolveReady(url);
        })
        .catch((error) => {
          finishError(error instanceof Error ? error.message : String(error));
        });
    });

    record.ready = ready;
    return record;
  }

  private async waitForHealthy(url: string): Promise<void> {
    const deadline = Date.now() + OPENCODE_SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.isHealthy(url)) {
        return;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, OPENCODE_HEALTH_POLL_INTERVAL_MS));
    }
    throw new Error(`Timed out waiting for OpenCode server health at ${url}`);
  }

  private async isHealthy(url: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(new URL("/global/health", url), {
        method: "GET",
      });
      if (!response.ok) {
        return false;
      }
      const payload = await response.json() as { healthy?: boolean };
      return payload.healthy === true;
    } catch {
      return false;
    }
  }

  private disposeRecord(key: string, record: OpenCodeServerRecord): void {
    this.servers.delete(key);
    record.closed = true;
    try {
      record.proc.kill("SIGTERM");
    } catch {
      // Ignore stale child processes.
    }
  }
}
