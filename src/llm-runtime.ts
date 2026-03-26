import { ChildProcess, spawn } from "child_process";
import { basename } from "path";
import { createInterface } from "readline";

export type LLMProtocol = "claude" | "codex";
export type RuntimeExecutionMode = "safe" | "accelerated";
export type RuntimeTuningMode = "manual" | "auto";

export interface RuntimeControlSettings {
  executionMode?: RuntimeExecutionMode;
  tuningMode?: RuntimeTuningMode;
  model?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  dangerouslySkipPermissions?: boolean;
  bypassApprovalsAndSandbox?: boolean;
}

export interface HeadlessProfile {
  name: string;
  command: string;
  args: string[];
  protocol?: LLMProtocol;
  runtime?: RuntimeControlSettings;
}

interface SpawnSpec {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

interface SessionLineHandlers {
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolActivity?: (toolName: string) => void;
  onSessionId?: (sessionId: string) => void;
  onTurnComplete?: () => void;
}

interface OneShotLineResult {
  appendText?: string;
  replaceText?: string;
}

interface OneShotRunOptions {
  cwd?: string;
  onText?: (accumulated: string) => void;
  timeoutMs?: number;
}

export interface OneShotRunHandle {
  proc: ChildProcess;
  result: Promise<string>;
}

export function detectProtocol(profile: Pick<HeadlessProfile, "command" | "name" | "protocol">): LLMProtocol {
  if (profile.protocol) return profile.protocol;

  const hint = `${basename(profile.command)} ${profile.name}`.toLowerCase();
  if (hint.includes("codex")) return "codex";
  return "claude";
}

export function buildTurnCommand(
  profile: HeadlessProfile,
  prompt: string,
  sessionId?: string | null,
): SpawnSpec {
  const protocol = detectProtocol(profile);
  const env = { ...process.env };
  const runtime = profile.runtime;

  if (protocol === "codex") {
    const globalArgs: string[] = [];
    const execArgs = ["--json", "--skip-git-repo-check"];

    if (runtime?.model) {
      globalArgs.push("-m", runtime.model);
    }

    if (runtime?.reasoningEffort) {
      globalArgs.push("-c", `model_reasoning_effort="${runtime.reasoningEffort}"`);
    }

    if (runtime?.bypassApprovalsAndSandbox) {
      globalArgs.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      if (runtime?.sandboxMode) {
        globalArgs.push("-s", runtime.sandboxMode);
      }
      if (runtime?.approvalPolicy) {
        globalArgs.push("-a", runtime.approvalPolicy);
      }
    }

    if (sessionId) {
      return {
        command: profile.command,
        args: [
          ...globalArgs,
          "exec",
          ...execArgs,
          ...profile.args,
          "resume",
          sessionId,
          prompt,
        ],
        env,
      };
    }

    return {
      command: profile.command,
      args: [
        ...globalArgs,
        "exec",
        ...execArgs,
        ...profile.args,
        prompt,
      ],
      env,
    };
  }

  delete env.CLAUDECODE;

  const args = [
    ...(runtime?.model ? ["--model", runtime.model] : []),
    ...(runtime?.reasoningEffort ? ["--effort", runtime.reasoningEffort] : []),
    ...(runtime?.dangerouslySkipPermissions
      ? ["--dangerously-skip-permissions"]
      : runtime?.permissionMode
        ? ["--permission-mode", runtime.permissionMode]
        : []),
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    ...profile.args,
  ];

  if (sessionId) {
    args.push("--resume", sessionId);
  }

  return {
    command: profile.command,
    args,
    env,
  };
}

function shellQuote(value: string): string {
  if (!/[\s"'\\]/.test(value)) return value;
  return JSON.stringify(value);
}

export function buildCommandPreview(
  profile: HeadlessProfile,
  sessionId?: string | null,
): string {
  const spec = buildTurnCommand(profile, "<prompt>", sessionId);
  return [spec.command, ...spec.args].map(shellQuote).join(" ");
}

export function summarizeRuntime(profile: HeadlessProfile): string {
  const protocol = detectProtocol(profile);
  const runtime = profile.runtime;
  const parts: string[] = [protocol];

  if (runtime?.model) parts.push(runtime.model);
  if (runtime?.reasoningEffort) parts.push(runtime.reasoningEffort);

  if (protocol === "claude") {
    if (runtime?.dangerouslySkipPermissions) {
      parts.push("dangerous");
    } else if (runtime?.permissionMode) {
      parts.push(runtime.permissionMode);
    }
  } else {
    if (runtime?.sandboxMode) parts.push(runtime.sandboxMode);
    if (runtime?.approvalPolicy) parts.push(runtime.approvalPolicy);
  }

  return parts.join(" · ");
}

export function parseSessionStreamLine(
  profile: HeadlessProfile,
  line: string,
  handlers: SessionLineHandlers,
): void {
  if (!line.trim()) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }

  if (detectProtocol(profile) === "codex") {
    parseCodexSessionLine(parsed, handlers);
    return;
  }

  parseClaudeSessionLine(parsed, handlers);
}

export function parseOneShotStreamLine(
  profile: HeadlessProfile,
  line: string,
): OneShotLineResult {
  if (!line.trim()) return {};

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {};
  }

  if (detectProtocol(profile) === "codex") {
    const item = parsed.item as Record<string, unknown> | undefined;
    if (
      parsed.type === "item.completed" &&
      item?.type === "agent_message" &&
      typeof item.text === "string"
    ) {
      return { replaceText: item.text };
    }
    return {};
  }

  if (parsed.type === "stream_event") {
    const event = parsed.event as Record<string, unknown> | undefined;
    const delta = event?.delta as Record<string, unknown> | undefined;
    if (event?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
      return { appendText: delta.text };
    }
    return {};
  }

  if (parsed.type === "result" && typeof parsed.result === "string") {
    return { replaceText: parsed.result };
  }

  return {};
}

export function startOneShotRun(
  profile: HeadlessProfile,
  prompt: string,
  options: OneShotRunOptions = {},
): OneShotRunHandle {
  const spec = buildTurnCommand(profile, prompt);
  const proc = spawn(spec.command, spec.args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: spec.env as Record<string, string>,
  });

  proc.stdin?.end();

  let accumulated = "";
  let stderrText = "";
  let timedOut = false;

  const rl = createInterface({ input: proc.stdout! });
  rl.on("line", (line) => {
    const event = parseOneShotStreamLine(profile, line);

    if (event.appendText) {
      accumulated += event.appendText;
      options.onText?.(accumulated);
      return;
    }

    if (event.replaceText && !accumulated) {
      accumulated = event.replaceText;
      options.onText?.(accumulated);
    }
  });

  const result = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, options.timeoutMs ?? 30_000);

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      rl.close();

      const cancelled = proc.killed && !timedOut;
      if (timedOut) {
        reject(new Error("LLM timed out"));
        return;
      }

      if (cancelled) {
        reject(new Error("LLM run was cancelled"));
        return;
      }

      if (code !== 0) {
        const message = stderrText.trim().split("\n")[0] || `LLM process failed (exit code ${code})`;
        reject(new Error(message));
        return;
      }

      if (!accumulated.trim()) {
        reject(new Error("LLM produced no output"));
        return;
      }

      resolve(accumulated.trim());
    });
  });

  return { proc, result };
}

function parseClaudeSessionLine(
  parsed: Record<string, unknown>,
  handlers: SessionLineHandlers,
): void {
  const type = parsed.type as string | undefined;

  if (type === "stream_event") {
    const event = parsed.event as Record<string, unknown> | undefined;
    const eventType = event?.type as string | undefined;

    if (eventType === "content_block_delta") {
      const delta = event?.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        handlers.onText?.(delta.text);
      } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        handlers.onThinking?.(delta.thinking);
      }
      return;
    }

    if (eventType === "content_block_start") {
      const block = event?.content_block as Record<string, unknown> | undefined;
      if (block?.type === "tool_use" && typeof block.name === "string") {
        handlers.onToolActivity?.(block.name);
      }
    }
    return;
  }

  if (type === "result") {
    if (typeof parsed.session_id === "string") {
      handlers.onSessionId?.(parsed.session_id);
    }
    if (parsed.stop_reason === "end_turn") {
      handlers.onTurnComplete?.();
    }
  }
}

function parseCodexSessionLine(
  parsed: Record<string, unknown>,
  handlers: SessionLineHandlers,
): void {
  const type = parsed.type as string | undefined;

  if (type === "thread.started" && typeof parsed.thread_id === "string") {
    handlers.onSessionId?.(parsed.thread_id);
    return;
  }

  if (type === "turn.completed") {
    handlers.onTurnComplete?.();
    return;
  }

  if (!type?.startsWith("item.")) return;

  const item = parsed.item as Record<string, unknown> | undefined;
  if (!item || typeof item.type !== "string") return;

  if (item.type === "agent_message" && type === "item.completed" && typeof item.text === "string") {
    handlers.onText?.(item.text);
    return;
  }

  if (type === "item.started") {
    handlers.onToolActivity?.(item.type);
  }
}
