import { PassThrough } from "stream";
import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: mockSpawn as any,
}));

import {
  buildCommandPreview,
  buildTurnCommand,
  detectProtocol,
  getProviderAdapter,
  HeadlessProfile,
  isLLMProtocol,
  listProviderAdapters,
  parseOneShotStreamLine,
  parseSessionStreamLine,
  startOneShotRun,
  summarizeRuntime,
} from "./llm-runtime.js";

function createMockProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: { end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    killed?: boolean;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = { end: vi.fn() };
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    return true;
  });
  return proc;
}

beforeEach(() => {
  mockSpawn.mockReset();
});

describe("buildTurnCommand", () => {
  it("places Codex global approval and sandbox flags before exec", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
      runtime: {
        model: "gpt-5.4",
        reasoningEffort: "xhigh",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      },
    };

    const command = buildTurnCommand(profile, "hello");
    expect(command.args.slice(0, 8)).toEqual([
      "-m",
      "gpt-5.4",
      "-c",
      'model_reasoning_effort="xhigh"',
      "-s",
      "workspace-write",
      "-a",
      "never",
    ]);
    expect(command.args[8]).toBe("exec");
  });

  it("places Codex exec options before resume and keeps approval/sandbox global", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
      runtime: {
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      },
    };

    const command = buildTurnCommand(profile, "follow up", "thread-1");
    expect(command.args.slice(0, 4)).toEqual(["-s", "workspace-write", "-a", "never"]);
    expect(command.args.slice(4, 8)).toEqual(["exec", "--json", "--skip-git-repo-check", "resume"]);
    expect(command.args.slice(-2)).toEqual(["thread-1", "follow up"]);
  });

  it("places Codex top-level provider flags before exec", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: ["--search"],
      protocol: "codex",
      runtime: {
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      },
    };

    const command = buildTurnCommand(profile, "hello");
    expect(command.args.slice(0, 5)).toEqual([
      "-s",
      "workspace-write",
      "-a",
      "never",
      "--search",
    ]);
    expect(command.args[5]).toBe("exec");
    expect(command.args.indexOf("--search")).toBeLessThan(command.args.indexOf("exec"));
  });

  it("keeps Codex top-level provider flags before exec on resumed turns", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: ["--search"],
      protocol: "codex",
      runtime: {
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      },
    };

    const command = buildTurnCommand(profile, "follow up", "thread-1");
    expect(command.args.slice(0, 5)).toEqual([
      "-s",
      "workspace-write",
      "-a",
      "never",
      "--search",
    ]);
    expect(command.args.slice(5, 9)).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "resume",
    ]);
    expect(command.args.slice(-2)).toEqual(["thread-1", "follow up"]);
  });

  it("uses the Codex bypass flag when requested", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
      runtime: {
        model: "gpt-5.4",
        reasoningEffort: "xhigh",
        bypassApprovalsAndSandbox: true,
      },
    };

    const command = buildTurnCommand(profile, "hello");
    expect(command.args.slice(0, 5)).toEqual([
      "-m",
      "gpt-5.4",
      "-c",
      'model_reasoning_effort="xhigh"',
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
    expect(command.args[5]).toBe("exec");
  });

  it("merges profile env into the spawned command without overriding explicit process env", () => {
    const profile: HeadlessProfile = {
      name: "claude-code",
      command: "claude",
      args: [],
      protocol: "claude",
      env: {
        TEST_SECRET_FROM_PROFILE: "profile-value",
      },
    };

    const previous = process.env.TEST_SECRET_FROM_PROFILE;
    const previousShellOnly = process.env.TEST_SECRET_FROM_SHELL;
    process.env.TEST_SECRET_FROM_SHELL = "shell-value";
    process.env.TEST_SECRET_FROM_PROFILE = "shell-wins";

    try {
      const command = buildTurnCommand(profile, "hello");
      expect(command.env.TEST_SECRET_FROM_SHELL).toBe("shell-value");
      expect(command.env.TEST_SECRET_FROM_PROFILE).toBe("shell-wins");
    } finally {
      if (previous === undefined) delete process.env.TEST_SECRET_FROM_PROFILE;
      else process.env.TEST_SECRET_FROM_PROFILE = previous;
      if (previousShellOnly === undefined) delete process.env.TEST_SECRET_FROM_SHELL;
      else process.env.TEST_SECRET_FROM_SHELL = previousShellOnly;
    }
  });

  it("builds Gemini turns with stream-json, yolo approval, sandbox in safe mode, and resume support", () => {
    const profile: HeadlessProfile = {
      name: "gemini",
      command: "gemini",
      args: [],
      protocol: "gemini",
      runtime: {
        model: "gemini-3-flash-preview",
        executionMode: "safe",
      },
    };

    const command = buildTurnCommand(profile, "hello", "gemini-session-1");
    expect(command.args).toEqual([
      "-m",
      "gemini-3-flash-preview",
      "--sandbox",
      "--approval-mode",
      "yolo",
      "--resume",
      "gemini-session-1",
      "-p",
      "hello",
      "--output-format",
      "stream-json",
    ]);
  });

  it("builds accelerated Claude and Gemini turns with their provider-specific safety flags", () => {
    const claudeCommand = buildTurnCommand({
      name: "claude-code",
      command: "claude",
      args: ["--brief"],
      protocol: "claude",
      runtime: {
        model: "claude-opus-4-6",
        reasoningEffort: "max",
        dangerouslySkipPermissions: true,
      },
    }, "hello");
    expect(claudeCommand.args).toEqual([
      "--model",
      "claude-opus-4-6",
      "--effort",
      "max",
      "--dangerously-skip-permissions",
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--brief",
    ]);

    const geminiCommand = buildTurnCommand({
      name: "gemini",
      command: "gemini",
      args: ["--raw-output"],
      protocol: "gemini",
      runtime: {
        model: "gemini-3-flash-preview",
        executionMode: "accelerated",
      },
    }, "ship it");
    expect(geminiCommand.args).toEqual([
      "-m",
      "gemini-3-flash-preview",
      "--approval-mode",
      "yolo",
      "-p",
      "ship it",
      "--output-format",
      "stream-json",
      "--raw-output",
    ]);
  });
});

describe("provider adapters", () => {
  it("treats Gemini as a first-class protocol value", () => {
    expect(isLLMProtocol("gemini")).toBe(true);
    expect(detectProtocol({ name: "gemini", command: "gemini" })).toBe("gemini");
    expect(getProviderAdapter("gemini").defaultProfileName).toBe("gemini");
  });

  it("defaults unknown commands to claude and exposes provider summaries", () => {
    expect(detectProtocol({ name: "mystery", command: "llm" })).toBe("claude");
    expect(listProviderAdapters().map((adapter) => adapter.id)).toEqual(["claude", "codex", "gemini"]);

    expect(summarizeRuntime({
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
      runtime: {
        model: "gpt-5.4",
        reasoningEffort: "high",
        bypassApprovalsAndSandbox: true,
      },
    })).toBe("codex · gpt-5.4 · high · bypass");

    expect(buildCommandPreview({
      name: "codex",
      command: "codex",
      args: ["--search"],
      protocol: "codex",
      runtime: {
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      },
    }, "thread-1")).toContain("resume thread-1 <prompt>");
  });

  it("applies managed provider args without duplicating existing flags", () => {
    expect(getProviderAdapter("claude").applyManagedArgs(["--brief"], {
      brief: true,
      ide: true,
      chrome: true,
    })).toEqual(["--brief", "--ide", "--chrome"]);

    expect(getProviderAdapter("codex").applyManagedArgs([], {
      webSearch: true,
    })).toEqual(["--search"]);

    expect(getProviderAdapter("codex").applyManagedArgs(["--search"], {
      webSearch: true,
    })).toEqual(["--search"]);

    expect(getProviderAdapter("gemini").applyManagedArgs(["--raw-output"], {
      ignored: true,
    })).toEqual(["--raw-output"]);
  });

  it("summarizes runtime for Claude danger mode", () => {
    expect(summarizeRuntime({
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
      runtime: {
        dangerouslySkipPermissions: true,
      },
    })).toBe("claude · dangerous");
  });
});

describe("parseOneShotStreamLine", () => {
  it("parses newer Claude assistant messages as full replacement text", () => {
    const profile: HeadlessProfile = {
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    };

    const result = parseOneShotStreamLine(
      profile,
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "{\"message\":\"ok\"" },
            { type: "text", text: ",\"confidence\":1}" },
          ],
        },
      }),
    );

    expect(result).toEqual({
      replaceText: "{\"message\":\"ok\",\"confidence\":1}",
    });
  });

  it("handles empty or non-json one-shot lines and Claude text deltas", () => {
    const claudeProfile: HeadlessProfile = {
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    };

    expect(parseOneShotStreamLine(claudeProfile, "")).toEqual({});
    expect(parseOneShotStreamLine(claudeProfile, "not-json")).toEqual({});
    expect(parseOneShotStreamLine(
      claudeProfile,
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "partial" },
        },
      }),
    )).toEqual({ appendText: "partial" });
    expect(parseOneShotStreamLine(
      claudeProfile,
      JSON.stringify({ type: "result", result: "final text" }),
    )).toEqual({ replaceText: "final text" });
    expect(parseOneShotStreamLine(
      claudeProfile,
      JSON.stringify({
        type: "assistant",
        message: { content: "not-an-array" },
      }),
    )).toEqual({});
  });

  it("parses Gemini assistant stream deltas as append text", () => {
    const profile: HeadlessProfile = {
      name: "gemini",
      command: "gemini",
      args: [],
      protocol: "gemini",
    };

    const result = parseOneShotStreamLine(
      profile,
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: "Hello from Gemini",
        delta: true,
      }),
    );

    expect(result).toEqual({
      appendText: "Hello from Gemini",
    });
  });

  it("parses non-delta Gemini assistant text as a replacement", () => {
    const profile: HeadlessProfile = {
      name: "gemini",
      command: "gemini",
      args: [],
      protocol: "gemini",
    };

    expect(parseOneShotStreamLine(
      profile,
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: "Full Gemini response",
      }),
    )).toEqual({
      replaceText: "Full Gemini response",
    });
  });

  it("ignores unsupported one-shot payloads across providers", () => {
    const claudeProfile: HeadlessProfile = {
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    };
    const codexProfile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
    };

    expect(parseOneShotStreamLine(
      claudeProfile,
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read" }] },
      }),
    )).toEqual({});

    expect(parseOneShotStreamLine(
      codexProfile,
      JSON.stringify({
        type: "item.completed",
        item: { type: "tool_result", text: "ignored" },
      }),
    )).toEqual({});
  });

  it("parses Codex one-shot agent messages and ignores unsupported Gemini payloads", () => {
    const codexProfile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
    };
    const geminiProfile: HeadlessProfile = {
      name: "gemini",
      command: "gemini",
      args: [],
      protocol: "gemini",
    };

    expect(parseOneShotStreamLine(
      codexProfile,
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Codex says hi" },
      }),
    )).toEqual({ replaceText: "Codex says hi" });

    expect(parseOneShotStreamLine(
      geminiProfile,
      JSON.stringify({ type: "tool_use", tool_name: "read_file" }),
    )).toEqual({});
  });
});

describe("parseSessionStreamLine", () => {
  it("parses Gemini session init, tool activity, assistant text, and completion", () => {
    const profile: HeadlessProfile = {
      name: "gemini",
      command: "gemini",
      args: [],
      protocol: "gemini",
    };

    const seen: {
      sessionId?: string;
      toolName?: string;
      text?: string;
      usage?: unknown;
      completed?: boolean;
    } = {};

    parseSessionStreamLine(
      profile,
      JSON.stringify({ type: "init", session_id: "gemini-session-1" }),
      {
        onSessionId: (sessionId) => { seen.sessionId = sessionId; },
      },
      {},
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({ type: "tool_use", tool_name: "list_directory", parameters: { dir_path: "." } }),
      {
        onToolActivity: (toolName) => { seen.toolName = toolName; },
      },
      {},
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({ type: "message", role: "assistant", content: "done", delta: true }),
      {
        onText: (text) => { seen.text = text; },
      },
      {},
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "result",
        status: "success",
        stats: {
          input_tokens: 10,
          output_tokens: 2,
        },
      }),
      {
        onUsage: (usage) => { seen.usage = usage; },
        onTurnComplete: () => { seen.completed = true; },
      },
      {},
    );

    expect(seen.sessionId).toBe("gemini-session-1");
    expect(seen.toolName).toBe("list_directory");
    expect(seen.text).toBe("done");
    expect(seen.usage).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    expect(seen.completed).toBe(true);
  });

  it("parses Claude rate limits, tool activity, finalized text, and result usage", () => {
    const profile: HeadlessProfile = {
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    };

    const seen: Record<string, unknown> = {};

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "assistant",
        sessionId: "claude-thread-1",
        message: {
          content: [
            { type: "text", text: "Assistant text" },
            { type: "tool_use", name: "Read" },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 4,
          },
          stop_reason: "end_turn",
        },
      }),
      {
        onText: (text) => { seen.text = text; },
        onToolActivity: (tool) => { seen.tool = tool; },
        onSessionId: (sid) => { seen.sid = sid; },
        onUsage: (usage) => { seen.usage = usage; },
        onTurnComplete: () => { seen.done = true; },
      },
      {},
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: {
          rateLimitType: "daily",
          status: "allowed",
          resetsAt: 1_700_000_000,
        },
      }),
      {
        onRateLimit: (rateLimit) => { seen.rateLimit = rateLimit; },
      },
      {},
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "result",
        session_id: "claude-thread-2",
        usage: {
          input_tokens: 20,
          output_tokens: 5,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
        stop_reason: "end_turn",
      }),
      {
        onSessionId: (sid) => { seen.resultSid = sid; },
        onUsage: (usage) => { seen.resultUsage = usage; },
        onTurnComplete: () => { seen.resultDone = true; },
      },
      {},
    );

    expect(seen).toMatchObject({
      text: "Assistant text",
      tool: "Read",
      sid: "claude-thread-1",
      done: true,
      rateLimit: {
        source: "claude",
        windowLabel: "daily",
        status: "allowed",
      },
      resultSid: "claude-thread-2",
      resultDone: true,
    });
    expect((seen.rateLimit as any).resetsAt).toMatch(/T/);
    expect(seen.resultUsage).toEqual({
      inputTokens: 20,
      outputTokens: 5,
      cachedInputTokens: 2,
      cacheCreationInputTokens: 1,
    });
  });

  it("ignores zero-usage Claude payloads and handles empty or valid reset strings", () => {
    const profile: HeadlessProfile = {
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    };
    const seen: Record<string, unknown> = {};

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "ready" }],
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      {
        onText: (text) => { seen.text = text; },
        onUsage: (usage) => { seen.usage = usage; },
      },
      {},
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: {
          rateLimitType: "",
          resetsAt: "",
        },
      }),
      {
        onRateLimit: (rateLimit) => { seen.emptyRateLimit = rateLimit; },
      },
      {},
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: {
          rateLimitType: "monthly",
          status: "allowed",
          resetsAt: "2026-03-30T12:34:56Z",
        },
      }),
      {
        onRateLimit: (rateLimit) => { seen.monthlyRateLimit = rateLimit; },
      },
      {},
    );

    expect(seen.text).toBe("ready");
    expect(seen.usage).toBeUndefined();
    expect(seen.emptyRateLimit).toEqual({
      source: "claude",
      windowLabel: null,
      status: null,
      resetsAt: null,
    });
    expect(seen.monthlyRateLimit).toEqual({
      source: "claude",
      windowLabel: "monthly",
      status: "allowed",
      resetsAt: "2026-03-30T12:34:56.000Z",
    });
  });

  it("parses Codex tool-start and completed agent messages", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
    };
    const seen: Record<string, unknown> = {};

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "item.started",
        item: { type: "shell" },
      }),
      {
        onToolActivity: (toolName) => { seen.tool = toolName; },
      },
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Ship it" },
      }),
      {
        onText: (text) => { seen.text = text; },
      },
    );

    expect(seen).toEqual({
      tool: "shell",
      text: "Ship it",
    });
  });

  it("parses Codex session ids, usage, and ignores malformed items", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
    };
    const seen: Record<string, unknown> = {};

    parseSessionStreamLine(
      profile,
      JSON.stringify({ type: "thread.started", thread_id: "thread-42" }),
      {
        onSessionId: (sessionId) => { seen.sessionId = sessionId; },
      },
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 4, output_tokens: 2 },
      }),
      {
        onUsage: (usage) => { seen.usage = usage; },
        onTurnComplete: () => { seen.done = true; },
      },
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({ type: "item.completed", item: {} }),
      {
        onText: () => { seen.unexpected = true; },
      },
    );

    expect(seen).toEqual({
      sessionId: "thread-42",
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      done: true,
    });
  });

  it("handles fallback Claude rate-limit windows and reset strings", () => {
    const profile: HeadlessProfile = {
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    };

    const seen: Record<string, unknown> = {};

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: {
          rateLimitType: "custom_window",
          status: "blocked",
          resetsAt: "not-a-date",
        },
      }),
      {
        onRateLimit: (rateLimit) => { seen.rateLimit = rateLimit; },
      },
      {},
    );

    expect(seen.rateLimit).toEqual({
      source: "claude",
      windowLabel: "custom_window",
      status: "blocked",
      resetsAt: "not-a-date",
    });
  });

  it("does not duplicate finalized Gemini text after deltas and still completes without usage", () => {
    const profile: HeadlessProfile = {
      name: "gemini",
      command: "gemini",
      args: [],
      protocol: "gemini",
    };

    const seen: Record<string, unknown> = {};
    const streamState = { sawTextDelta: false, sawThinkingDelta: false };

    parseSessionStreamLine(
      profile,
      JSON.stringify({ type: "message", role: "assistant", content: "delta", delta: true }),
      {
        onText: (text) => { seen.delta = text; },
      },
      streamState,
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({ type: "message", role: "assistant", content: "final" }),
      {
        onText: (text) => { seen.final = text; },
      },
      streamState,
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({ type: "result", status: "success" }),
      {
        onTurnComplete: () => { seen.done = true; },
      },
      streamState,
    );

    expect(seen).toEqual({
      delta: "delta",
      done: true,
    });
  });

  it("parses Claude thinking, legacy session_id fields, and tool-start events", () => {
    const profile: HeadlessProfile = {
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    };
    const seen: Record<string, unknown> = {};

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "assistant",
        session_id: "legacy-session",
        message: {
          content: [{ type: "thinking", thinking: "plan quietly" }],
        },
      }),
      {
        onSessionId: (value) => { seen.sessionId = value; },
        onThinking: (value) => { seen.thinking = value; },
      },
      {},
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: { type: "tool_use", name: "Edit" },
        },
      }),
      {
        onToolActivity: (value) => { seen.tool = value; },
      },
      {},
    );

    expect(seen).toEqual({
      sessionId: "legacy-session",
      thinking: "plan quietly",
      tool: "Edit",
    });
  });

  it("parses full Gemini assistant text only when no delta was seen and ignores non-assistant messages", () => {
    const profile: HeadlessProfile = {
      name: "gemini",
      command: "gemini",
      args: [],
      protocol: "gemini",
    };
    const seen: Record<string, unknown> = {};

    parseSessionStreamLine(
      profile,
      JSON.stringify({ type: "message", role: "user", content: "ignore me" }),
      {
        onText: (value) => { seen.user = value; },
      },
      {},
    );

    parseSessionStreamLine(
      profile,
      JSON.stringify({ type: "message", role: "assistant", content: "final text" }),
      {
        onText: (value) => { seen.assistant = value; },
      },
      {},
    );

    expect(seen).toEqual({
      assistant: "final text",
    });
  });

  it("ignores malformed Codex and Claude session events without crashing", () => {
    const codexProfile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
    };
    const claudeProfile: HeadlessProfile = {
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    };
    const seen: Record<string, unknown> = {};

    parseSessionStreamLine(
      codexProfile,
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      {
        onUsage: (usage) => { seen.codexUsage = usage; },
        onTurnComplete: () => { seen.codexDone = true; },
      },
    );

    parseSessionStreamLine(
      codexProfile,
      JSON.stringify({
        type: "item.started",
        item: { type: 42 },
      }),
      {
        onToolActivity: (tool) => { seen.codexTool = tool; },
      },
    );

    parseSessionStreamLine(
      claudeProfile,
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: { type: "text", text: "ignore me" },
        },
      }),
      {
        onToolActivity: (tool) => { seen.claudeTool = tool; },
      },
      {},
    );

    expect(seen).toEqual({
      codexDone: true,
    });
  });

  it("ignores blank and invalid session stream lines", () => {
    const profile: HeadlessProfile = {
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    };
    const seen: Record<string, unknown> = {};

    parseSessionStreamLine(profile, "", {
      onText: () => { seen.blank = true; },
    });
    parseSessionStreamLine(profile, "not-json", {
      onText: () => { seen.invalid = true; },
    });

    expect(seen).toEqual({});
  });
});

describe("startOneShotRun", () => {
  it("streams accumulated text and resolves the final output", async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc as any);

    const updates: string[] = [];
    const handle = startOneShotRun({
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    }, "hello", {
      onText: (text) => updates.push(text),
      timeoutMs: 500,
    });

    proc.stdout.write(JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hello" },
      },
    }) + "\n");
    proc.stdout.end();
    proc.emit("close", 0);

    await expect(handle.result).resolves.toBe("hello");
    expect(updates).toEqual(["hello"]);
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it("resolves from replaceText events when no incremental text was accumulated", async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc as any);

    const updates: string[] = [];
    const handle = startOneShotRun({
      name: "gemini",
      command: "gemini",
      args: [],
      protocol: "gemini",
    }, "hello", {
      onText: (text) => updates.push(text),
      timeoutMs: 500,
    });

    proc.stdout.write(JSON.stringify({
      type: "message",
      role: "assistant",
      content: "final answer",
    }) + "\n");
    proc.stdout.end();
    proc.emit("close", 0);

    await expect(handle.result).resolves.toBe("final answer");
    expect(updates).toEqual(["final answer"]);
  });

  it("ignores replacement text after incremental text has already started streaming", async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc as any);

    const updates: string[] = [];
    const handle = startOneShotRun({
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    }, "hello", {
      onText: (text) => updates.push(text),
      timeoutMs: 500,
    });

    proc.stdout.write(JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "partial" },
      },
    }) + "\n");
    proc.stdout.write(JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "final replacement" }],
      },
    }) + "\n");
    proc.stdout.end();
    proc.emit("close", 0);

    await expect(handle.result).resolves.toBe("partial");
    expect(updates).toEqual(["partial"]);
  });

  it("rejects when the run exits successfully without any output", async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc as any);

    const handle = startOneShotRun({
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
    }, "hello", { timeoutMs: 500 });

    proc.stdout.end();
    proc.emit("close", 0);

    await expect(handle.result).rejects.toThrow("LLM produced no output");
  });

  it("surfaces the first stderr line when the process fails", async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc as any);

    const handle = startOneShotRun({
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
    }, "hello", { timeoutMs: 500 });

    proc.stderr.write("boom failed\nextra detail");
    proc.stdout.end();
    proc.emit("close", 2);

    await expect(handle.result).rejects.toThrow("boom failed");
  });

  it("falls back to the exit-code message when stderr is empty", async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc as any);

    const handle = startOneShotRun({
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
    }, "hello", { timeoutMs: 500 });

    proc.stdout.end();
    proc.emit("close", 7);

    await expect(handle.result).rejects.toThrow("LLM process failed (exit code 7)");
  });

  it("treats a killed run as cancelled when it was not a timeout", async () => {
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc as any);

    const handle = startOneShotRun({
      name: "gemini",
      command: "gemini",
      args: [],
      protocol: "gemini",
    }, "hello", { timeoutMs: 500 });

    (proc.kill as () => boolean)();
    proc.stdout.end();
    proc.emit("close", 0);

    await expect(handle.result).rejects.toThrow("LLM run was cancelled");
  });

  it("rejects with a timeout when the deadline elapses before close", async () => {
    vi.useFakeTimers();
    const proc = createMockProc();
    mockSpawn.mockReturnValue(proc as any);

    const handle = startOneShotRun({
      name: "claude",
      command: "claude",
      args: [],
      protocol: "claude",
    }, "hello", { timeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(25);
    proc.stdout.end();
    proc.emit("close", 0);

    await expect(handle.result).rejects.toThrow("LLM timed out");
    expect(proc.kill).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
