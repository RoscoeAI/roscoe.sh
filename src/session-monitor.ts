import { EventEmitter } from "events";
import { spawn, ChildProcess, execFileSync } from "child_process";
import { createInterface, Interface } from "readline";
import { dbg } from "./debug-log.js";
import {
  detectProtocol,
  HeadlessProfile,
  RuntimeRateLimitStatus,
  RuntimeUsageSnapshot,
  buildCommandPreview,
  buildTurnCommand,
  parseSessionStreamLine,
} from "./llm-runtime.js";

export interface SessionEvents {
  text: (chunk: string) => void;
  thinking: (chunk: string) => void;
  "turn-complete": () => void;
  "tool-activity": (toolName: string, detail?: string | null) => void;
  usage: (usage: RuntimeUsageSnapshot) => void;
  "rate-limit": (rateLimit: RuntimeRateLimitStatus) => void;
  result: (sessionId: string) => void;
  exit: (code: number) => void;
}

interface ClaudeToolBlock {
  name: string;
  inputJson: string;
  lastDetail: string | null;
}

export function truncateDetail(value: string, max = 72): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(24, max - 3)).trimEnd()}...`;
}

export function pickStringField(
  value: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return null;
}

export function pickStringArrayField(
  value: Record<string, unknown>,
  keys: string[],
): string[] {
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  }
  return [];
}

export function sanitizeAgentTask(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\.+$/g, "")
    .trim();
}

export function looksLikeTestCommand(value: string): boolean {
  return /\b(npm|pnpm|yarn|bun|npx|vitest|jest|playwright|cypress)\b/i.test(value);
}

export function summarizeAgentTask(task: string): string {
  const normalized = sanitizeAgentTask(task);
  if (!normalized) return "agent · working";

  const isTestTask = /\b(test|tests|testing|spec|specs|vitest|jest|playwright|cypress|coverage|e2e|integration|unit)\b/i.test(normalized);
  if (isTestTask) {
    if (looksLikeTestCommand(normalized)) {
      return `tests · ${truncateDetail(normalized.replace(/^(please\s+)?(run|rerun|execute)\s+/i, ""), 56)}`;
    }

    const focus = normalized
      .replace(/^(please\s+)?(run|rerun|execute|check|verify|prove)\s+/i, "")
      .replace(/\btests?\b/ig, "")
      .replace(/\bspecs?\b/ig, "")
      .replace(/\bfor\b/ig, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[,:-]\s*/, "");

    return `tests · ${truncateDetail(focus || normalized, 48)}`;
  }

  if (/\b(lint|typecheck|type-check|build|compile|verify|validation)\b/i.test(normalized)) {
    return `checks · ${truncateDetail(normalized.replace(/^(please\s+)?(run|rerun|execute)\s+/i, ""), 56)}`;
  }

  return `agent · ${truncateDetail(normalized, 56)}`;
}

export function formatToolDetail(toolName: string, inputJson: string): string | null {
  const normalizedTool = toolName.trim().toLowerCase();
  const raw = inputJson.replace(/\s+/g, " ").trim();
  const rawField = (key: string) => {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)`));
    return match?.[1]?.trim() || null;
  };

  const fallbackFromRaw = () => {
    if (normalizedTool === "bash" || normalizedTool === "command_execution" || normalizedTool === "shell") {
      const cmd = rawField("command") ?? rawField("cmd");
      return cmd ? `bash · ${truncateDetail(cmd)}` : null;
    }
    if (normalizedTool === "read") {
      const path = rawField("file_path") ?? rawField("path");
      return path ? `read · ${truncateDetail(path)}` : null;
    }
    if (normalizedTool === "grep" || normalizedTool === "glob" || normalizedTool === "file_search") {
      const query = rawField("pattern") ?? rawField("query");
      return query ? `${normalizedTool} · ${truncateDetail(query)}` : null;
    }
    if (normalizedTool === "write" || normalizedTool === "edit" || normalizedTool === "multiedit") {
      const path = rawField("file_path") ?? rawField("path");
      return path ? `edit · ${truncateDetail(path)}` : null;
    }
    if (normalizedTool === "agent") {
      const task = rawField("task")
        ?? rawField("prompt")
        ?? rawField("instruction")
        ?? rawField("instructions")
        ?? rawField("message")
        ?? rawField("goal")
        ?? rawField("description");
      return task ? summarizeAgentTask(task) : null;
    }
    return null;
  };

  if (!raw) return null;

  let parsed: Record<string, unknown> | null = null;
  try {
    const candidate = JSON.parse(raw);
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      parsed = candidate as Record<string, unknown>;
    }
  } catch {
    return fallbackFromRaw();
  }

  if (!parsed) return fallbackFromRaw();

  if (normalizedTool === "bash" || normalizedTool === "command_execution" || normalizedTool === "shell") {
    const command = pickStringField(parsed, ["command", "cmd", "shell_command"]);
    if (command) return `bash · ${truncateDetail(command)}`;
  }

  if (normalizedTool === "read") {
    const path = pickStringField(parsed, ["file_path", "path"]);
    const paths = pickStringArrayField(parsed, ["paths"]);
    if (path) return `read · ${truncateDetail(path)}`;
    if (paths.length === 1) return `read · ${truncateDetail(paths[0])}`;
    if (paths.length > 1) return `read · ${paths.length} files`;
  }

  if (normalizedTool === "grep" || normalizedTool === "file_search") {
    const query = pickStringField(parsed, ["pattern", "query"]);
    const path = pickStringField(parsed, ["path", "file_path"]);
    if (query && path) return `grep · ${truncateDetail(query, 40)} @ ${truncateDetail(path, 24)}`;
    if (query) return `grep · ${truncateDetail(query)}`;
  }

  if (normalizedTool === "glob") {
    const pattern = pickStringField(parsed, ["pattern", "glob"]);
    if (pattern) return `glob · ${truncateDetail(pattern)}`;
  }

  if (normalizedTool === "write" || normalizedTool === "edit" || normalizedTool === "multiedit") {
    const path = pickStringField(parsed, ["file_path", "path"]);
    if (path) return `edit · ${truncateDetail(path)}`;
  }

  if (normalizedTool === "todowrite" || normalizedTool === "plan" || normalizedTool === "task") {
    const todos = pickStringArrayField(parsed, ["todos", "items"]);
    if (todos.length > 0) return `plan · ${todos.length} item${todos.length === 1 ? "" : "s"}`;
    return "plan · update";
  }

  if (normalizedTool === "agent") {
    const task = pickStringField(parsed, ["task", "prompt", "instruction", "instructions", "message", "goal", "description", "request"]);
    const tasks = pickStringArrayField(parsed, ["tasks"]);
    if (task) return summarizeAgentTask(task);
    if (tasks.length > 0) return summarizeAgentTask(tasks[0]);
  }

  if (normalizedTool.startsWith("browser") || normalizedTool.startsWith("mcp__chrome_devtools__")) {
    const url = pickStringField(parsed, ["url"]);
    const action = pickStringField(parsed, ["action", "text", "selector"]);
    if (url) return `browser · ${truncateDetail(url, 48)}`;
    if (action) return `browser · ${truncateDetail(action, 48)}`;
  }

  const firstString = Object.entries(parsed)
    .find(([key, value]) => key !== "id" && key !== "type" && typeof value === "string" && value.trim())?.[1] as string | undefined;
  if (firstString) {
    if (normalizedTool === "agent") {
      return summarizeAgentTask(firstString);
    }
    return `${toolName.toLowerCase()} · ${truncateDetail(firstString, 52)}`;
  }

  return null;
}

export class SessionMonitor extends EventEmitter {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private sessionId: string | null = null;
  private textBuffer = "";
  private lastPrompt: string | null = null;
  private lastCommandPreview: string | null = null;
  private resolvedCommand: string;
  private cwd: string;
  private profile: HeadlessProfile;
  private activeClaudeTools = new Map<number, ClaudeToolBlock>();

  constructor(
    public readonly id: string,
    profile: HeadlessProfile,
    cwd?: string,
  ) {
    super();
    this.profile = profile;
    this.cwd = cwd || process.cwd();
    this.resolvedCommand = this.resolveCommand(profile.command);
  }

  private resolveCommand(command: string): string {
    if (command.startsWith("/")) return command;
    try {
      const locator = process.platform === "win32" ? "where.exe" : "which";
      return execFileSync(locator, [command], { encoding: "utf-8" }).trim().split(/\r?\n/)[0]?.trim() || command;
    } catch {
      return command;
    }
  }

  private cloneProfile(profile: HeadlessProfile): HeadlessProfile {
    return {
      ...profile,
      args: [...profile.args],
      runtime: profile.runtime ? { ...profile.runtime } : undefined,
      env: profile.env ? { ...profile.env } : undefined,
    };
  }

  private closeReadline(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  private cleanupProcess(proc: ChildProcess): void {
    this.closeReadline();
    proc.removeAllListeners();
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();
    if (this.proc === proc) {
      this.proc = null;
    }
  }

  private replaceActiveProcess(): void {
    const current = this.proc;
    if (!current) return;
    this.cleanupProcess(current);
    this.killProcessTree(current);
    this.activeClaudeTools.clear();
  }

  private killProcessTree(proc: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
    const pid = typeof proc.pid === "number" ? proc.pid : null;
    if (pid && process.platform !== "win32") {
      try {
        process.kill(-pid, signal);
        return;
      } catch {
        // Fall back to the direct child below.
      }
    }
    proc.kill(signal);
  }

  /**
   * Start a new turn with the given prompt.
   */
  startTurn(prompt: string): void {
    this.lastPrompt = prompt;
    this.lastCommandPreview = buildCommandPreview(
      { ...this.profile, command: this.resolvedCommand },
      this.sessionId,
    );
    const spec = buildTurnCommand(
      { ...this.profile, command: this.resolvedCommand },
      prompt,
      this.sessionId,
    );
    this.spawnProcess(spec.args, spec.env);
  }

  private spawnProcess(args: string[], env: NodeJS.ProcessEnv): void {
    // A monitor owns at most one live subprocess at a time.
    this.replaceActiveProcess();
    const runProfile = this.cloneProfile(this.profile);
    const runStreamState = { sawTextDelta: false, sawThinkingDelta: false };

    dbg("proc", `spawn ${this.resolvedCommand} ${args.slice(0, 4).join(" ")}... (cwd: ${this.cwd})`);

    const proc = spawn(this.resolvedCommand, args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: env as Record<string, string>,
      detached: process.platform !== "win32",
    });
    this.proc = proc;

    // The headless CLIs receive the prompt via argv, not stdin.
    proc.stdin!.end();

    const rl = createInterface({ input: proc.stdout! });
    this.rl = rl;
    rl.on("line", (line) => this.handleLine(line, runProfile, runStreamState));

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) dbg("llm:stderr", text);
    });

    // Capture proc reference in closure to avoid race with next spawnProcess call
    proc.on("close", (code) => {
      dbg("proc", `closed with code ${code}`);
      this.cleanupProcess(proc);
      this.emit("exit", code ?? 0);
    });
  }

  private handleLine(
    line: string,
    profile: HeadlessProfile,
    streamState: { sawTextDelta: boolean; sawThinkingDelta: boolean },
  ): void {
    if (!line.trim()) return;
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    if (parsed) {
      this.handleToolActivityMetadata(parsed, profile);
    }

    parseSessionStreamLine(profile, line, {
      onText: (text) => {
        this.textBuffer += text;
        this.emit("text", text);
      },
      onThinking: (text) => {
        this.emit("thinking", text);
      },
      onSessionId: (sid) => {
        this.sessionId = sid;
        this.emit("result", sid);
      },
      onUsage: (usage) => {
        this.emit("usage", usage);
      },
      onRateLimit: (rateLimit) => {
        this.emit("rate-limit", rateLimit);
      },
      onTurnComplete: () => {
        this.activeClaudeTools.clear();
        dbg("event", "turn-complete");
        this.emit("turn-complete");
      },
    }, streamState);
  }

  private handleToolActivityMetadata(parsed: Record<string, unknown>, profile: HeadlessProfile): void {
    const protocol = detectProtocol(profile);

    if (protocol === "claude" || protocol === "qwen") {
      if (parsed.type === "assistant") {
        if (protocol === "qwen") return;
        const message = parsed.message as Record<string, unknown> | undefined;
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const item of content) {
          if (!item || typeof item !== "object") continue;
          const block = item as Record<string, unknown>;
          if (block.type !== "tool_use" || typeof block.name !== "string") continue;
          const input = block.input
            && typeof block.input === "object"
            && !Array.isArray(block.input)
            ? JSON.stringify(block.input)
            : "";
          const detail = formatToolDetail(block.name, input);
          dbg("event", `tool-use: ${block.name}${detail ? ` (${detail})` : ""}`);
          this.emit("tool-activity", block.name, detail);
        }
        return;
      }

      const type = typeof parsed.type === "string" ? parsed.type : null;
      if (type !== "stream_event") return;

      const event = parsed.event as Record<string, unknown> | undefined;
      const eventType = typeof event?.type === "string" ? event.type : null;
      const index = typeof event?.index === "number" ? event.index : null;

      if (eventType === "content_block_start") {
        const block = event?.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use" && typeof block.name === "string") {
          const hasInitialInput = block.input
            && typeof block.input === "object"
            && !Array.isArray(block.input)
            && Object.keys(block.input as Record<string, unknown>).length > 0;
          const initialInput = hasInitialInput
            ? JSON.stringify(block.input)
            : "";
          const detail = formatToolDetail(block.name, initialInput);
          if (index !== null) {
            this.activeClaudeTools.set(index, {
              name: block.name,
              inputJson: initialInput,
              lastDetail: detail,
            });
          }
          dbg("event", `tool-use: ${block.name}${detail ? ` (${detail})` : ""}`);
          this.emit("tool-activity", block.name, detail);
        }
        return;
      }

      if (eventType === "content_block_delta") {
        const delta = event?.delta as Record<string, unknown> | undefined;
        if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string" && index !== null) {
          const active = this.activeClaudeTools.get(index);
          if (!active) return;
          active.inputJson += delta.partial_json;
          const detail = formatToolDetail(active.name, active.inputJson);
          if (detail && detail !== active.lastDetail) {
            active.lastDetail = detail;
            dbg("event", `tool-detail: ${active.name} => ${detail}`);
            this.emit("tool-activity", active.name, detail);
          }
        }
        return;
      }

      if (eventType === "content_block_stop" && index !== null) {
        this.activeClaudeTools.delete(index);
      }
      return;
    }

    if (protocol === "codex") {
      const type = typeof parsed.type === "string" ? parsed.type : null;
      if (type !== "item.started") return;
      const item = parsed.item as Record<string, unknown> | undefined;
      if (!item || typeof item.type !== "string") return;
      const detail = formatToolDetail(item.type, JSON.stringify(item));
      dbg("event", `tool-use: ${item.type}${detail ? ` (${detail})` : ""}`);
      this.emit("tool-activity", item.type, detail);
      return;
    }

    if (protocol === "gemini" && parsed.type === "tool_use" && typeof parsed.tool_name === "string") {
      const parameters = parsed.parameters
        && typeof parsed.parameters === "object"
        && !Array.isArray(parsed.parameters)
        ? JSON.stringify(parsed.parameters)
        : "";
      const detail = formatToolDetail(parsed.tool_name, parameters);
      dbg("event", `tool-use: ${parsed.tool_name}${detail ? ` (${detail})` : ""}`);
      this.emit("tool-activity", parsed.tool_name, detail);
      return;
    }

    if (protocol === "kimi" && parsed.role === "assistant" && Array.isArray(parsed.tool_calls)) {
      for (const call of parsed.tool_calls) {
        if (!call || typeof call !== "object") continue;
        const typedCall = call as Record<string, unknown>;
        const fn = typedCall.function && typeof typedCall.function === "object"
          ? typedCall.function as Record<string, unknown>
          : null;
        const name = typeof fn?.name === "string" ? fn.name : null;
        if (!name) continue;
        const argumentsJson = typeof fn?.arguments === "string" ? fn.arguments : "";
        const detail = formatToolDetail(name, argumentsJson);
        dbg("event", `tool-use: ${name}${detail ? ` (${detail})` : ""}`);
        this.emit("tool-activity", name, detail);
      }
      return;
    }
  }

  /**
   * Send a follow-up message in the same conversation.
   */
  sendFollowUp(text: string): void {
    if (!this.sessionId) {
      throw new Error("No session ID — cannot send follow-up before first turn completes");
    }
    // startTurn already handles --resume when sessionId is set
    this.startTurn(text);
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  restoreSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  getTextBuffer(): string {
    return this.textBuffer;
  }

  getLastPrompt(): string | null {
    return this.lastPrompt;
  }

  getLastCommandPreview(): string | null {
    return this.lastCommandPreview;
  }

  setProfile(profile: HeadlessProfile): void {
    this.profile = profile;
    this.resolvedCommand = this.resolveCommand(profile.command);
  }

  clearTextBuffer(): void {
    this.textBuffer = "";
  }

  kill(): void {
    const proc = this.proc;
    if (!proc) return;
    this.killProcessTree(proc);
  }
}
