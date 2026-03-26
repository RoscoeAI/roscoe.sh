import { execFile } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface BrowserState {
  url: string;
  title: string;
  consoleErrors?: string[];
}

export interface ElementSnapshot {
  ref: string;
  role: string;
  name: string;
  description?: string;
}

export interface AuthProfile {
  name: string;
  url: string;
  steps: AuthStep[];
}

export interface AuthStep {
  action: "fill" | "click" | "wait" | "navigate";
  ref?: string;
  value?: string;
}

/**
 * Wraps the `agent-browser` CLI for programmatic browser automation.
 * All commands use --json for machine-readable output and --session for persistence.
 */
export class BrowserAgent {
  private sessionId: string;
  private screenshotDir: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId || `roscoe-${Date.now()}`;
    this.screenshotDir = join(__dirname, "..", "screenshots");
    if (!existsSync(this.screenshotDir)) {
      mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  private exec(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        "agent-browser",
        [...args, "--session", this.sessionId],
        {
          timeout: 30000,
          maxBuffer: 5 * 1024 * 1024,
          env: process.env,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `agent-browser ${args[0]} failed: ${error.message}\n${stderr}`,
              ),
            );
            return;
          }
          resolve(stdout.trim());
        },
      );
    });
  }

  private parseJson<T>(raw: string): T {
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Failed to parse agent-browser output: ${raw.slice(0, 200)}`);
    }
  }

  async open(url: string): Promise<BrowserState> {
    const raw = await this.exec(["open", url, "--json"]);
    return this.parseJson<BrowserState>(raw);
  }

  async screenshot(filename?: string): Promise<string> {
    const name = filename || `screenshot-${Date.now()}.png`;
    const path = join(this.screenshotDir, name);
    await this.exec(["screenshot", path]);
    return path;
  }

  async snapshot(): Promise<ElementSnapshot[]> {
    const raw = await this.exec(["snapshot", "-i", "--json"]);
    return this.parseJson<ElementSnapshot[]>(raw);
  }

  async interact(
    action: string,
    ref: string,
    value?: string,
  ): Promise<string> {
    const args = [action, ref];
    if (value !== undefined) {
      args.push(value);
    }
    args.push("--json");
    return await this.exec(args);
  }

  async click(ref: string): Promise<void> {
    await this.interact("click", ref);
  }

  async fill(ref: string, value: string): Promise<void> {
    await this.interact("fill", ref, value);
  }

  async evaluate(script: string): Promise<unknown> {
    const raw = await this.exec(["evaluate", script, "--json"]);
    return this.parseJson<unknown>(raw);
  }

  async getState(): Promise<BrowserState> {
    const raw = await this.exec(["evaluate", "JSON.stringify({ url: location.href, title: document.title })", "--json"]);
    return this.parseJson<BrowserState>(raw);
  }

  /**
   * Execute a login flow defined by an auth profile.
   * Env vars in step values (${VAR}) are interpolated.
   */
  async login(profile: AuthProfile): Promise<void> {
    await this.open(profile.url);

    for (const step of profile.steps) {
      const value = step.value ? interpolateEnv(step.value) : undefined;

      switch (step.action) {
        case "navigate":
          if (value) await this.open(value);
          break;
        case "fill":
          if (step.ref && value) await this.fill(step.ref, value);
          break;
        case "click":
          if (step.ref) await this.click(step.ref);
          break;
        case "wait":
          await new Promise((r) => setTimeout(r, parseInt(value || "1000", 10)));
          break;
      }
    }
  }

  /**
   * Get a compact summary of the current page state for LLM context.
   */
  async getContextSummary(): Promise<string> {
    const parts: string[] = [];

    try {
      const state = await this.getState();
      parts.push(`Page: ${state.title} (${state.url})`);
    } catch {
      parts.push("Page: (could not read state)");
    }

    try {
      const elements = await this.snapshot();
      if (elements.length > 0) {
        parts.push("Interactive elements:");
        for (const el of elements.slice(0, 20)) {
          parts.push(`  ${el.ref} [${el.role}] ${el.name}`);
        }
        if (elements.length > 20) {
          parts.push(`  ... and ${elements.length - 20} more`);
        }
      }
    } catch {
      // snapshot is best-effort
    }

    return parts.join("\n");
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getScreenshotDir(): string {
    return this.screenshotDir;
  }
}

/**
 * Interpolate ${VAR} patterns with environment variables.
 */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, varName) => {
    return process.env[varName] || "";
  });
}
