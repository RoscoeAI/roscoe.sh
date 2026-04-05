import { ChildProcess, spawn } from "child_process";
import { basename } from "path";
import { createInterface } from "readline";
import { coerceText } from "./text-coercion.js";

export type LLMProtocol = "claude" | "codex" | "qwen" | "gemini" | "kimi";
export type RuntimeExecutionMode = "safe" | "accelerated";
export type RuntimeTuningMode = "manual" | "auto";

export interface RuntimeUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface RuntimeRateLimitStatus {
  source: LLMProtocol;
  windowLabel: string | null;
  status: string | null;
  resetsAt: string | null;
}

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
  env?: NodeJS.ProcessEnv;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface SessionLineHandlers {
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolActivity?: (toolName: string) => void;
  onSessionId?: (sessionId: string) => void;
  onUsage?: (usage: RuntimeUsageSnapshot) => void;
  onRateLimit?: (rateLimit: RuntimeRateLimitStatus) => void;
  onTurnComplete?: () => void;
}

export interface OneShotLineResult {
  appendText?: string;
  replaceText?: string;
}

export interface ProviderAdapter {
  id: LLMProtocol;
  label: string;
  defaultProfileName: string;
  topModel: string;
  knownModels: string[];
  reasoningOptions: string[];
  defaultWorkerRuntime: RuntimeControlSettings;
  acceleratedWorkerRuntime: RuntimeControlSettings;
  defaultOnboardingRuntime: RuntimeControlSettings;
  defaultReasoningEffort: string;
  onboardingReasoningEffort: string;
  frontendReasoningEffort: string;
  efficientFrontendReasoningEffort: string;
  deepReasoningEffort: string;
  efficientDeepReasoningEffort: string;
  generalReasoningEffort: string;
  efficientGeneralReasoningEffort: string;
  buildTurnCommand: (profile: HeadlessProfile, prompt: string, sessionId?: string | null) => SpawnSpec;
  parseSessionLine: (
    parsed: Record<string, unknown>,
    handlers: SessionLineHandlers,
    streamState?: Record<string, unknown>,
  ) => void;
  parseOneShotLine: (parsed: Record<string, unknown>) => OneShotLineResult;
  summarizeRuntimeFlags: (runtime: RuntimeControlSettings | null | undefined) => string[];
  applyManagedArgs: (args: string[], settings: unknown) => string[];
}

interface ClaudeStreamState {
  sawTextDelta?: boolean;
  sawThinkingDelta?: boolean;
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

function buildCodexTurnCommand(
  profile: HeadlessProfile,
  prompt: string,
  sessionId?: string | null,
): SpawnSpec {
  const env = { ...(profile.env ?? {}), ...process.env };
  const runtime = profile.runtime;
  const globalArgs: string[] = [];
  const execArgs = ["--json", "--skip-git-repo-check"];
  const { topLevelArgs, execLevelArgs } = partitionCodexProfileArgs(profile.args);

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
        ...topLevelArgs,
        "exec",
        ...execArgs,
        ...execLevelArgs,
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
      ...topLevelArgs,
      "exec",
      ...execArgs,
      ...execLevelArgs,
      prompt,
    ],
    env,
  };
}

function buildClaudeTurnCommand(
  profile: HeadlessProfile,
  prompt: string,
  sessionId?: string | null,
): SpawnSpec {
  const env = { ...(profile.env ?? {}), ...process.env };
  const runtime = profile.runtime;
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

function buildGeminiTurnCommand(
  profile: HeadlessProfile,
  prompt: string,
  sessionId?: string | null,
): SpawnSpec {
  const env = { ...(profile.env ?? {}), ...process.env };
  const runtime = profile.runtime;
  const args = [
    ...(runtime?.model ? ["-m", runtime.model] : []),
    ...(runtime?.executionMode !== "accelerated" ? ["--sandbox"] : []),
    "--approval-mode",
    "yolo",
    ...(sessionId ? ["--resume", sessionId] : []),
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    ...profile.args,
  ];

  return {
    command: profile.command,
    args,
    env,
  };
}

function buildQwenTurnCommand(
  profile: HeadlessProfile,
  prompt: string,
  sessionId?: string | null,
): SpawnSpec {
  const env = { ...(profile.env ?? {}), ...process.env };
  const runtime = profile.runtime;
  const args = [
    ...(shouldPassExplicitModel(runtime?.model) ? ["-m", runtime!.model!] : []),
    ...(runtime?.executionMode !== "accelerated" ? ["--sandbox"] : []),
    "--approval-mode",
    "yolo",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    ...(sessionId ? ["--resume", sessionId] : []),
    ...profile.args,
    prompt,
  ];

  return {
    command: profile.command,
    args,
    env,
  };
}

function buildKimiTurnCommand(
  profile: HeadlessProfile,
  prompt: string,
  sessionId?: string | null,
): SpawnSpec {
  const env = { ...(profile.env ?? {}), ...process.env };
  const runtime = profile.runtime;
  const args = [
    ...(shouldPassExplicitModel(runtime?.model) ? ["-m", runtime!.model!] : []),
    ...(runtime?.executionMode !== "accelerated" ? ["--plan"] : []),
    ...(runtime?.reasoningEffort === "low"
      ? ["--no-thinking"]
      : runtime?.reasoningEffort && runtime.reasoningEffort !== "medium"
        ? ["--thinking"]
        : []),
    "--print",
    "--output-format",
    "stream-json",
    ...(sessionId ? ["--resume", sessionId] : []),
    "-p",
    prompt,
    ...profile.args,
  ];

  return {
    command: profile.command,
    args,
    env,
  };
}

function parseClaudeSessionLine(
  parsed: Record<string, unknown>,
  handlers: SessionLineHandlers,
  streamState?: ClaudeStreamState,
): void {
  const type = parsed.type as string | undefined;

  if (type === "assistant") {
    const message = parsed.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];

    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const block = item as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        if (!streamState?.sawTextDelta) {
          handlers.onText?.(block.text);
        }
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        if (!streamState?.sawThinkingDelta) {
          handlers.onThinking?.(block.thinking);
        }
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        handlers.onToolActivity?.(block.name);
      }
    }

    if (typeof parsed.sessionId === "string") {
      handlers.onSessionId?.(parsed.sessionId);
    } else if (typeof parsed.session_id === "string") {
      handlers.onSessionId?.(parsed.session_id);
    }

    const usage = normalizeRuntimeUsage(message?.usage);
    if (usage) {
      handlers.onUsage?.(usage);
    }

    if (message?.stop_reason === "end_turn") {
      handlers.onTurnComplete?.();
    }
    return;
  }

  if (type === "stream_event") {
    const event = parsed.event as Record<string, unknown> | undefined;
    const eventType = event?.type as string | undefined;

    if (eventType === "content_block_delta") {
      const delta = event?.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        if (streamState) streamState.sawTextDelta = true;
        handlers.onText?.(delta.text);
      } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        if (streamState) streamState.sawThinkingDelta = true;
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

  if (type === "rate_limit_event") {
    const info = parsed.rate_limit_info as Record<string, unknown> | undefined;
    if (info) {
      handlers.onRateLimit?.({
        source: "claude",
        windowLabel: formatRateLimitWindow(info.rateLimitType),
        status: typeof info.status === "string" ? info.status : null,
        resetsAt: normalizeRateLimitReset(info.resetsAt),
      });
    }
    return;
  }

  if (type === "result") {
    if (typeof parsed.session_id === "string") {
      handlers.onSessionId?.(parsed.session_id);
    }
    const usage = normalizeRuntimeUsage(parsed.usage);
    if (usage) {
      handlers.onUsage?.(usage);
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
    const usage = normalizeRuntimeUsage(parsed.usage);
    if (usage) {
      handlers.onUsage?.(usage);
    }
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

function parseClaudeOneShotLine(parsed: Record<string, unknown>): OneShotLineResult {
  if (parsed.type === "assistant") {
    const message = parsed.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    const text = content
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("");
    if (text) {
      return { replaceText: text };
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

function parseCodexOneShotLine(parsed: Record<string, unknown>): OneShotLineResult {
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

function parseGeminiSessionLine(
  parsed: Record<string, unknown>,
  handlers: SessionLineHandlers,
  streamState?: ClaudeStreamState,
): void {
  const type = parsed.type as string | undefined;

  if (type === "init" && typeof parsed.session_id === "string") {
    handlers.onSessionId?.(parsed.session_id);
    return;
  }

  if (type === "message") {
    if (parsed.role !== "assistant" || typeof parsed.content !== "string") {
      return;
    }

    if (parsed.delta === true) {
      if (streamState) streamState.sawTextDelta = true;
      handlers.onText?.(parsed.content);
      return;
    }

    if (!streamState?.sawTextDelta) {
      handlers.onText?.(parsed.content);
    }
    return;
  }

  if (type === "tool_use" && typeof parsed.tool_name === "string") {
    handlers.onToolActivity?.(parsed.tool_name);
    return;
  }

  if (type === "result") {
    const usage = normalizeRuntimeUsage(parsed.stats);
    if (usage) {
      handlers.onUsage?.(usage);
    }
    handlers.onTurnComplete?.();
  }
}

function parseGeminiOneShotLine(parsed: Record<string, unknown>): OneShotLineResult {
  if (
    parsed.type === "message"
    && parsed.role === "assistant"
    && typeof parsed.content === "string"
  ) {
    return parsed.delta === true
      ? { appendText: parsed.content }
      : { replaceText: parsed.content };
  }

  return {};
}

function parseQwenSessionLine(
  parsed: Record<string, unknown>,
  handlers: SessionLineHandlers,
  streamState?: ClaudeStreamState,
): void {
  const type = parsed.type as string | undefined;

  if (type === "system" && parsed.subtype === "init" && typeof parsed.session_id === "string") {
    handlers.onSessionId?.(parsed.session_id);
    return;
  }

  if (type === "assistant") {
    const message = parsed.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];

    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const block = item as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        if (!streamState?.sawTextDelta) {
          handlers.onText?.(block.text);
        }
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        if (!streamState?.sawThinkingDelta) {
          handlers.onThinking?.(block.thinking);
        }
      }
    }

    const usage = normalizeRuntimeUsage(message?.usage);
    if (usage) {
      handlers.onUsage?.(usage);
    }

    if (message?.stop_reason === "end_turn") {
      handlers.onTurnComplete?.();
    }
    return;
  }

  if (type === "stream_event") {
    const event = parsed.event as Record<string, unknown> | undefined;
    const eventType = event?.type as string | undefined;

    if (eventType === "content_block_delta") {
      const delta = event?.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        if (streamState) streamState.sawTextDelta = true;
        handlers.onText?.(delta.text);
      } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        if (streamState) streamState.sawThinkingDelta = true;
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
    const usage = normalizeRuntimeUsage(parsed.usage);
    if (usage) {
      handlers.onUsage?.(usage);
    }
    handlers.onTurnComplete?.();
  }
}

function parseQwenOneShotLine(parsed: Record<string, unknown>): OneShotLineResult {
  if (parsed.type === "assistant") {
    const message = parsed.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    const text = content
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("");
    if (text) {
      return { replaceText: text };
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

function parseKimiSessionLine(
  parsed: Record<string, unknown>,
  handlers: SessionLineHandlers,
): void {
  if (parsed.role === "assistant") {
    const content = Array.isArray(parsed.content) ? parsed.content : [];
    let sawText = false;

    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const block = item as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        sawText = true;
        handlers.onText?.(block.text);
      } else if ((block.type === "think" || block.type === "thinking") && typeof block.think === "string") {
        handlers.onThinking?.(block.think);
      } else if ((block.type === "think" || block.type === "thinking") && typeof block.thinking === "string") {
        handlers.onThinking?.(block.thinking);
      }
    }

    const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
    if (toolCalls.length === 0 && sawText) {
      handlers.onTurnComplete?.();
    }
  }
}

function parseKimiOneShotLine(parsed: Record<string, unknown>): OneShotLineResult {
  if (parsed.role === "assistant") {
    const content = Array.isArray(parsed.content) ? parsed.content : [];
    const text = content
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("");
    if (text) {
      return { replaceText: text };
    }
  }

  return {};
}

function summarizeClaudeRuntimeFlags(runtime: RuntimeControlSettings | null | undefined): string[] {
  if (runtime?.dangerouslySkipPermissions) {
    return ["dangerous"];
  }
  return runtime?.permissionMode ? [runtime.permissionMode] : [];
}

function summarizeCodexRuntimeFlags(runtime: RuntimeControlSettings | null | undefined): string[] {
  if (runtime?.bypassApprovalsAndSandbox) {
    return ["bypass"];
  }
  const parts: string[] = [];
  if (runtime?.sandboxMode) parts.push(runtime.sandboxMode);
  if (runtime?.approvalPolicy) parts.push(runtime.approvalPolicy);
  return parts;
}

function summarizeKimiRuntimeFlags(runtime: RuntimeControlSettings | null | undefined): string[] {
  const parts: string[] = [];
  if (runtime?.executionMode !== "accelerated") parts.push("plan");
  if (runtime?.reasoningEffort === "low") {
    parts.push("no-thinking");
  } else if (runtime?.reasoningEffort && runtime.reasoningEffort !== "medium") {
    parts.push("thinking");
  }
  return parts;
}

export function shouldPassExplicitModel(model: string | undefined): model is string {
  return typeof model === "string" && model.trim().length > 0 && model.trim().toLowerCase() !== "default";
}

function appendUniqueArg(args: string[], value: string): string[] {
  return args.includes(value) ? args : [...args, value];
}

function partitionCodexProfileArgs(args: string[]): { topLevelArgs: string[]; execLevelArgs: string[] } {
  const topLevelArgs: string[] = [];
  const execLevelArgs: string[] = [];

  for (const arg of args) {
    if (arg === "--search") {
      topLevelArgs.push(arg);
      continue;
    }
    execLevelArgs.push(arg);
  }

  return { topLevelArgs, execLevelArgs };
}

function applyClaudeManagedArgs(args: string[], settings: unknown): string[] {
  const typed = settings && typeof settings === "object"
    ? settings as Record<string, unknown>
    : {};
  let nextArgs = [...args];
  if (typed.brief === true) nextArgs = appendUniqueArg(nextArgs, "--brief");
  if (typed.ide === true) nextArgs = appendUniqueArg(nextArgs, "--ide");
  if (typed.chrome === true) nextArgs = appendUniqueArg(nextArgs, "--chrome");
  return nextArgs;
}

function applyCodexManagedArgs(args: string[], settings: unknown): string[] {
  const typed = settings && typeof settings === "object"
    ? settings as Record<string, unknown>
    : {};
  return typed.webSearch === true ? appendUniqueArg(args, "--search") : [...args];
}

const CLAUDE_ADAPTER: ProviderAdapter = {
  id: "claude",
  label: "Claude",
  defaultProfileName: "claude-code",
  topModel: "claude-opus-4-6",
  knownModels: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-sonnet-4"],
  reasoningOptions: ["low", "medium", "high", "max"],
  defaultWorkerRuntime: {
    executionMode: "safe",
    tuningMode: "auto",
    model: "claude-opus-4-6",
    reasoningEffort: "high",
    permissionMode: "auto",
  },
  acceleratedWorkerRuntime: {
    executionMode: "accelerated",
    tuningMode: "auto",
    model: "claude-opus-4-6",
    reasoningEffort: "high",
    dangerouslySkipPermissions: true,
  },
  defaultOnboardingRuntime: {
    executionMode: "safe",
    tuningMode: "auto",
    model: "claude-opus-4-6",
    reasoningEffort: "max",
    permissionMode: "auto",
  },
  defaultReasoningEffort: "high",
  onboardingReasoningEffort: "max",
  frontendReasoningEffort: "medium",
  efficientFrontendReasoningEffort: "low",
  deepReasoningEffort: "max",
  efficientDeepReasoningEffort: "high",
  generalReasoningEffort: "high",
  efficientGeneralReasoningEffort: "medium",
  buildTurnCommand: buildClaudeTurnCommand,
  parseSessionLine: (parsed, handlers, streamState) => parseClaudeSessionLine(parsed, handlers, streamState as ClaudeStreamState | undefined),
  parseOneShotLine: parseClaudeOneShotLine,
  summarizeRuntimeFlags: summarizeClaudeRuntimeFlags,
  applyManagedArgs: applyClaudeManagedArgs,
};

const CODEX_ADAPTER: ProviderAdapter = {
  id: "codex",
  label: "Codex",
  defaultProfileName: "codex",
  topModel: "gpt-5.4",
  knownModels: ["gpt-5.4", "gpt-5.4-mini"],
  reasoningOptions: ["low", "medium", "high", "xhigh"],
  defaultWorkerRuntime: {
    executionMode: "safe",
    tuningMode: "auto",
    model: "gpt-5.4",
    reasoningEffort: "xhigh",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
  },
  acceleratedWorkerRuntime: {
    executionMode: "accelerated",
    tuningMode: "auto",
    model: "gpt-5.4",
    reasoningEffort: "xhigh",
    bypassApprovalsAndSandbox: true,
  },
  defaultOnboardingRuntime: {
    executionMode: "safe",
    tuningMode: "auto",
    model: "gpt-5.4",
    reasoningEffort: "xhigh",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
  },
  defaultReasoningEffort: "xhigh",
  onboardingReasoningEffort: "xhigh",
  frontendReasoningEffort: "medium",
  efficientFrontendReasoningEffort: "low",
  deepReasoningEffort: "xhigh",
  efficientDeepReasoningEffort: "high",
  generalReasoningEffort: "xhigh",
  efficientGeneralReasoningEffort: "medium",
  buildTurnCommand: buildCodexTurnCommand,
  parseSessionLine: parseCodexSessionLine,
  parseOneShotLine: parseCodexOneShotLine,
  summarizeRuntimeFlags: summarizeCodexRuntimeFlags,
  applyManagedArgs: applyCodexManagedArgs,
};

const QWEN_ADAPTER: ProviderAdapter = {
  id: "qwen",
  label: "Qwen",
  defaultProfileName: "qwen",
  topModel: "default",
  knownModels: ["default"],
  reasoningOptions: ["low", "medium", "high"],
  defaultWorkerRuntime: {
    executionMode: "safe",
    tuningMode: "auto",
    reasoningEffort: "high",
  },
  acceleratedWorkerRuntime: {
    executionMode: "accelerated",
    tuningMode: "auto",
    reasoningEffort: "high",
  },
  defaultOnboardingRuntime: {
    executionMode: "safe",
    tuningMode: "auto",
    reasoningEffort: "high",
  },
  defaultReasoningEffort: "high",
  onboardingReasoningEffort: "high",
  frontendReasoningEffort: "medium",
  efficientFrontendReasoningEffort: "low",
  deepReasoningEffort: "high",
  efficientDeepReasoningEffort: "high",
  generalReasoningEffort: "high",
  efficientGeneralReasoningEffort: "medium",
  buildTurnCommand: buildQwenTurnCommand,
  parseSessionLine: (parsed, handlers, streamState) => parseQwenSessionLine(parsed, handlers, streamState as ClaudeStreamState | undefined),
  parseOneShotLine: parseQwenOneShotLine,
  summarizeRuntimeFlags: (runtime) => runtime?.executionMode !== "accelerated" ? ["sandbox"] : [],
  applyManagedArgs: (args) => [...args],
};

const GEMINI_ADAPTER: ProviderAdapter = {
  id: "gemini",
  label: "Gemini",
  defaultProfileName: "gemini",
  topModel: "gemini-3-flash-preview",
  knownModels: ["gemini-3-flash-preview", "gemini-3-pro", "gemini-2.5-pro"],
  reasoningOptions: ["low", "medium", "high"],
  defaultWorkerRuntime: {
    executionMode: "safe",
    tuningMode: "auto",
    model: "gemini-3-flash-preview",
    reasoningEffort: "high",
  },
  acceleratedWorkerRuntime: {
    executionMode: "accelerated",
    tuningMode: "auto",
    model: "gemini-3-flash-preview",
    reasoningEffort: "high",
  },
  defaultOnboardingRuntime: {
    executionMode: "safe",
    tuningMode: "auto",
    model: "gemini-3-flash-preview",
    reasoningEffort: "high",
  },
  defaultReasoningEffort: "high",
  onboardingReasoningEffort: "high",
  frontendReasoningEffort: "medium",
  efficientFrontendReasoningEffort: "low",
  deepReasoningEffort: "high",
  efficientDeepReasoningEffort: "high",
  generalReasoningEffort: "high",
  efficientGeneralReasoningEffort: "medium",
  buildTurnCommand: buildGeminiTurnCommand,
  parseSessionLine: parseGeminiSessionLine,
  parseOneShotLine: parseGeminiOneShotLine,
  summarizeRuntimeFlags: () => [],
  applyManagedArgs: (args) => [...args],
};

const KIMI_ADAPTER: ProviderAdapter = {
  id: "kimi",
  label: "Kimi",
  defaultProfileName: "kimi",
  topModel: "default",
  knownModels: ["default"],
  reasoningOptions: ["low", "medium", "high"],
  defaultWorkerRuntime: {
    executionMode: "safe",
    tuningMode: "auto",
    reasoningEffort: "high",
  },
  acceleratedWorkerRuntime: {
    executionMode: "accelerated",
    tuningMode: "auto",
    reasoningEffort: "high",
  },
  defaultOnboardingRuntime: {
    executionMode: "safe",
    tuningMode: "auto",
    reasoningEffort: "high",
  },
  defaultReasoningEffort: "high",
  onboardingReasoningEffort: "high",
  frontendReasoningEffort: "medium",
  efficientFrontendReasoningEffort: "low",
  deepReasoningEffort: "high",
  efficientDeepReasoningEffort: "high",
  generalReasoningEffort: "high",
  efficientGeneralReasoningEffort: "medium",
  buildTurnCommand: buildKimiTurnCommand,
  parseSessionLine: parseKimiSessionLine,
  parseOneShotLine: parseKimiOneShotLine,
  summarizeRuntimeFlags: summarizeKimiRuntimeFlags,
  applyManagedArgs: (args) => [...args],
};

const PROVIDER_ADAPTERS: Record<LLMProtocol, ProviderAdapter> = {
  claude: CLAUDE_ADAPTER,
  codex: CODEX_ADAPTER,
  qwen: QWEN_ADAPTER,
  kimi: KIMI_ADAPTER,
  gemini: GEMINI_ADAPTER,
};

export function isLLMProtocol(value: unknown): value is LLMProtocol {
  return value === "claude" || value === "codex" || value === "qwen" || value === "gemini" || value === "kimi";
}

export function getProviderAdapter(protocol: LLMProtocol): ProviderAdapter {
  return PROVIDER_ADAPTERS[protocol];
}

export function getKnownModels(protocol: LLMProtocol): string[] {
  return [...getProviderAdapter(protocol).knownModels];
}

export function listProviderAdapters(): ProviderAdapter[] {
  return Object.values(PROVIDER_ADAPTERS);
}

export function detectProtocol(profile: Pick<HeadlessProfile, "command" | "name" | "protocol">): LLMProtocol {
  if (profile.protocol && isLLMProtocol(profile.protocol)) return profile.protocol;

  const hint = `${basename(profile.command)} ${profile.name}`.toLowerCase();
  if (hint.includes("codex")) return "codex";
  if (hint.includes("qwen")) return "qwen";
  if (hint.includes("kimi")) return "kimi";
  if (hint.includes("gemini")) return "gemini";
  return "claude";
}

export function buildTurnCommand(
  profile: HeadlessProfile,
  prompt: string,
  sessionId?: string | null,
): SpawnSpec {
  return getProviderAdapter(detectProtocol(profile)).buildTurnCommand(profile, prompt, sessionId);
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
  const adapter = getProviderAdapter(protocol);
  const parts: string[] = [protocol];

  if (shouldPassExplicitModel(runtime?.model)) parts.push(runtime.model);
  if (runtime?.reasoningEffort) parts.push(runtime.reasoningEffort);

  parts.push(...adapter.summarizeRuntimeFlags(runtime));

  return parts.join(" · ");
}

export function parseSessionStreamLine(
  profile: HeadlessProfile,
  line: string,
  handlers: SessionLineHandlers,
  streamState?: Record<string, unknown>,
): void {
  if (!line.trim()) return;

  if (detectProtocol(profile) === "kimi") {
    const sessionMatch = line.match(/To resume this session:\s*kimi\s+-r\s+([A-Za-z0-9-]+)/i);
    if (sessionMatch?.[1]) {
      handlers.onSessionId?.(sessionMatch[1]);
      return;
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }

  getProviderAdapter(detectProtocol(profile)).parseSessionLine(parsed, handlers, streamState);
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

  const event = getProviderAdapter(detectProtocol(profile)).parseOneShotLine(parsed);
  return {
    ...(event.appendText !== undefined ? { appendText: coerceText(event.appendText) } : {}),
    ...(event.replaceText !== undefined ? { replaceText: coerceText(event.replaceText) } : {}),
  };
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

function normalizeTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function normalizeRuntimeUsage(value: unknown): RuntimeUsageSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const typed = value as Record<string, unknown>;
  const usage: RuntimeUsageSnapshot = {
    inputTokens: normalizeTokenCount(typed.input_tokens),
    outputTokens: normalizeTokenCount(typed.output_tokens),
    cachedInputTokens: normalizeTokenCount(typed.cached_input_tokens ?? typed.cache_read_input_tokens),
    cacheCreationInputTokens: normalizeTokenCount(typed.cache_creation_input_tokens),
  };

  if (
    usage.inputTokens === 0
    && usage.outputTokens === 0
    && usage.cachedInputTokens === 0
    && usage.cacheCreationInputTokens === 0
  ) {
    return null;
  }

  return usage;
}

function formatRateLimitWindow(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  switch (value) {
    case "five_hour":
      return "5h";
    case "one_hour":
      return "1h";
    case "weekly":
      return "weekly";
    case "daily":
      return "daily";
    case "monthly":
      return "monthly";
    default:
      return value;
  }
}

function normalizeRateLimitReset(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toISOString();
}
