import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PassThrough } from "stream";

const { mockSpawn, mockExecFileSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecFileSync: vi.fn(() => "/usr/local/bin/claude\n"),
}));

vi.mock("child_process", () => ({
  spawn: mockSpawn as any,
  execFileSync: mockExecFileSync as any,
}));

vi.mock("./debug-log.js", () => ({
  dbg: vi.fn(),
}));

import {
  SessionMonitor,
  truncateDetail,
  pickStringField,
  pickStringArrayField,
  sanitizeAgentTask,
  looksLikeTestCommand,
  summarizeAgentTask,
  formatToolDetail,
} from "./session-monitor.js";

function createMockProc() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = { end: vi.fn() };
  (stdout as any).removeAllListeners = vi.fn(stdout.removeAllListeners.bind(stdout));
  (stderr as any).removeAllListeners = vi.fn(stderr.removeAllListeners.bind(stderr));
  const proc = {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    pid: 1234,
  };
  return proc;
}

describe("SessionMonitor", () => {
  let monitor: SessionMonitor;
  let mockProc: ReturnType<typeof createMockProc>;
  let processKillSpy: ReturnType<typeof vi.spyOn>;
  let platformSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    mockProc = createMockProc();
    mockSpawn.mockReturnValue(mockProc);
    processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    monitor = new SessionMonitor("test-1", {
      name: "claude",
      command: "claude",
      args: ["--permission-mode", "auto"],
    });
  });

  afterEach(() => {
    platformSpy?.mockRestore();
    platformSpy = null;
  });

  describe("helpers", () => {
    it("truncates long detail and keeps empty strings clean", () => {
      expect(truncateDetail("   ")).toBe("");
      expect(truncateDetail("short")).toBe("short");
      expect(truncateDetail("x".repeat(100), 30)).toMatch(/\.\.\.$/);
    });

    it("picks string fields and string arrays from candidate objects", () => {
      expect(pickStringField({ one: "", two: "value" }, ["one", "two"])).toBe("value");
      expect(pickStringField({ one: 1 }, ["one", "two"])).toBeNull();
      expect(pickStringArrayField({ items: ["a", "", 7, "b"] }, ["items"])).toEqual(["a", "b"]);
      expect(pickStringArrayField({ items: "bad" }, ["items"])).toEqual([]);
    });

    it("sanitizes agent task text and recognizes test commands", () => {
      expect(sanitizeAgentTask('"Run the tests..."')).toBe("Run the tests");
      expect(looksLikeTestCommand("pnpm vitest run")).toBe(true);
      expect(looksLikeTestCommand("echo hello")).toBe(false);
    });

    it("summarizes test, check, general, and empty agent tasks", () => {
      expect(summarizeAgentTask("")).toBe("agent · working");
      expect(summarizeAgentTask("Run pnpm test src/app.test.ts")).toContain("tests · pnpm test");
      expect(summarizeAgentTask("Verify lint and typecheck pass")).toContain("checks · Verify lint and typecheck pass");
      expect(summarizeAgentTask("Please update the landing page copy.")).toContain("agent · Please update the landing page copy");
    });

    it("formats raw fallback tool details for common tools", () => {
      expect(formatToolDetail("bash", '{"command":"pnpm test"}')).toBe("bash · pnpm test");
      expect(formatToolDetail("read", '{"file_path":"/tmp/file.ts"}')).toBe("read · /tmp/file.ts");
      expect(formatToolDetail("glob", '{"pattern":"src/**/*.ts"}')).toBe("glob · src/**/*.ts");
      expect(formatToolDetail("write", '{"path":"/tmp/file.ts"}')).toBe("edit · /tmp/file.ts");
      expect(formatToolDetail("agent", '{"task":"Run integration tests."}')).toContain("tests · integration");
    });

    it("formats parsed tool details for plan, browser, and string fallbacks", () => {
      expect(formatToolDetail("TodoWrite", JSON.stringify({ todos: ["one", "two"] }))).toBe("plan · 2 items");
      expect(formatToolDetail("mcp__chrome_devtools__navigate", JSON.stringify({ url: "https://roscoe.sh" }))).toBe("browser · https://roscoe.sh");
      expect(formatToolDetail("grep", JSON.stringify({ pattern: "lane", path: "/tmp/file.ts" }))).toBe("grep · lane @ /tmp/file.ts");
      expect(formatToolDetail("custom", JSON.stringify({ label: "ship it" }))).toBe("custom · ship it");
      expect(formatToolDetail("agent", JSON.stringify({ request: "Please run tests." }))).toContain("tests ·");
    });

    it("returns null when tool detail cannot be derived", () => {
      expect(formatToolDetail("bash", "")).toBeNull();
      expect(formatToolDetail("custom", JSON.stringify({ id: "1" }))).toBeNull();
    });
  });

  describe("constructor", () => {
    it("resolves command via which", () => {
      expect(mockExecFileSync).toHaveBeenCalledWith("which", ["claude"], { encoding: "utf-8" });
    });

    it("uses where.exe on Windows and takes the first resolved path", () => {
      platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      mockExecFileSync.mockReset();
      mockExecFileSync.mockReturnValueOnce("C:\\Users\\tim\\AppData\\Local\\Programs\\Claude\\claude.cmd\r\nC:\\fallback\\claude.cmd\r\n");

      const windowsMonitor = new SessionMonitor("win", { name: "claude", command: "claude", args: [] });

      expect(windowsMonitor.id).toBe("win");
      expect(mockExecFileSync).toHaveBeenCalledWith("where.exe", ["claude"], { encoding: "utf-8" });
      windowsMonitor.startTurn("hello");
      expect(mockSpawn).toHaveBeenLastCalledWith(
        "C:\\Users\\tim\\AppData\\Local\\Programs\\Claude\\claude.cmd",
        expect.any(Array),
        expect.any(Object),
      );
    });

    it("uses command directly if starts with /", () => {
      const m = new SessionMonitor("t", { name: "test", command: "/usr/bin/claude", args: [] });
      // Should not call which for absolute paths (it's called once for the first monitor)
      expect(m.id).toBe("t");
    });

    it("falls back to the raw command when which fails", () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error("missing");
      });

      const m = new SessionMonitor("t2", { name: "mystery", command: "missing-cli", args: [] });
      expect(m.id).toBe("t2");
      m.startTurn("hello");
      expect(mockSpawn).toHaveBeenLastCalledWith(
        "missing-cli",
        expect.any(Array),
        expect.any(Object),
      );
    });
  });

  describe("startTurn", () => {
    it("spawns process with correct args", () => {
      monitor.startTurn("hello world");
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["-p", "hello world", "--output-format", "stream-json"]),
        expect.objectContaining({
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        }),
      );
    });

    it("closes stdin immediately", () => {
      monitor.startTurn("hello");
      expect(mockProc.stdin.end).toHaveBeenCalled();
    });

    it("includes --resume when sessionId is set", () => {
      // Simulate a completed first turn by feeding a result line
      monitor.startTurn("first");
      const resultLine = JSON.stringify({ type: "result", session_id: "sess-abc", stop_reason: "end_turn" });
      mockProc.stdout.write(resultLine + "\n");

      // Now start another turn
      mockSpawn.mockReturnValue(createMockProc());
      monitor.startTurn("second");
      expect(mockSpawn).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.arrayContaining(["--resume", "sess-abc"]),
        expect.any(Object),
      );
    });

    it("replaces any existing subprocess before starting a new turn", () => {
      const firstProc = createMockProc();
      const secondProc = createMockProc();
      mockSpawn
        .mockReturnValueOnce(firstProc)
        .mockReturnValueOnce(secondProc);

      monitor.startTurn("first");
      monitor.startTurn("second");

      expect(firstProc.removeAllListeners).toHaveBeenCalled();
      expect((firstProc.stdout as any).removeAllListeners).toHaveBeenCalled();
      expect((firstProc.stderr as any).removeAllListeners).toHaveBeenCalled();
      if (process.platform === "win32") {
        expect(firstProc.kill).toHaveBeenCalledWith("SIGTERM");
      } else {
        expect(processKillSpy).toHaveBeenCalledWith(-1234, "SIGTERM");
      }
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });
  });

  describe("NDJSON parsing", () => {
    it("emits text on content_block_delta with text_delta", () => {
      return new Promise<void>((resolve) => {
        monitor.startTurn("test");
        monitor.on("text", (chunk: string) => {
          expect(chunk).toBe("hello");
          resolve();
        });
        const line = JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hello" },
          },
        });
        mockProc.stdout.write(line + "\n");
      });
    });

    it("emits thinking on content_block_delta with thinking_delta", () => {
      return new Promise<void>((resolve) => {
        monitor.startTurn("test");
        monitor.on("thinking", (chunk: string) => {
          expect(chunk).toBe("hmm");
          resolve();
        });
        const line = JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "thinking_delta", thinking: "hmm" },
          },
        });
        mockProc.stdout.write(line + "\n");
      });
    });

    it("emits tool-activity on content_block_start with tool_use", () => {
      return new Promise<void>((resolve) => {
        monitor.startTurn("test");
        monitor.on("tool-activity", (toolName: string) => {
          expect(toolName).toBe("Read");
          resolve();
        });
        const line = JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "Read" },
          },
        });
        mockProc.stdout.write(line + "\n");
      });
    });

    it("emits compact tool detail from Claude input_json deltas", () => {
      return new Promise<void>((resolve) => {
        const events: Array<{ toolName: string; detail?: string | null }> = [];
        monitor.startTurn("test");
        monitor.on("tool-activity", (toolName: string, detail?: string | null) => {
          events.push({ toolName, detail });
          if (events.length === 2) {
            expect(events[0]).toEqual({ toolName: "Bash", detail: null });
            expect(events[1]).toEqual({
              toolName: "Bash",
              detail: 'bash · rg -n "tool-use" src',
            });
            resolve();
          }
        });
        mockProc.stdout.write(JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", name: "Bash", input: {} },
          },
        }) + "\n");
        mockProc.stdout.write(JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "input_json_delta",
              partial_json: '{"command":"rg -n \\"tool-use\\" src"}',
            },
          },
        }) + "\n");
      });
    });

    it("stops tracking Claude tool deltas after the content block stops", async () => {
      const events: Array<{ toolName: string; detail?: string | null }> = [];
      monitor.startTurn("test");
      monitor.on("tool-activity", (toolName: string, detail?: string | null) => {
        events.push({ toolName, detail });
      });
      mockProc.stdout.write(JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", name: "Bash", input: {} },
        },
      }) + "\n");
      mockProc.stdout.write(JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_stop",
          index: 0,
        },
      }) + "\n");
      mockProc.stdout.write(JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: '{"command":"pnpm test"}',
          },
        },
      }) + "\n");

      await Promise.resolve();
      expect(events).toEqual([{ toolName: "Bash", detail: null }]);
    });

    it("classifies agent test tasks into compact test detail", () => {
      return new Promise<void>((resolve) => {
        const events: Array<{ toolName: string; detail?: string | null }> = [];
        monitor.startTurn("test");
        monitor.on("tool-activity", (toolName: string, detail?: string | null) => {
          events.push({ toolName, detail });
          if (events.length === 2) {
            expect(events[0]).toEqual({ toolName: "Agent", detail: null });
            expect(events[1]).toEqual({
              toolName: "Agent",
              detail: "tests · chat-interface",
            });
            resolve();
          }
        });
        mockProc.stdout.write(JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", name: "Agent", input: {} },
          },
        }) + "\n");
        mockProc.stdout.write(JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "input_json_delta",
              partial_json: '{"prompt":"Run chat-interface tests."}',
            },
          },
        }) + "\n");
      });
    });

    it("emits result and turn-complete on result event", () => {
      return new Promise<void>((resolve) => {
        monitor.startTurn("test");
        let gotResult = false;
        monitor.on("result", (sid: string) => {
          expect(sid).toBe("session-123");
          gotResult = true;
        });
        monitor.on("turn-complete", () => {
          expect(gotResult).toBe(true);
          resolve();
        });
        const line = JSON.stringify({
          type: "result",
          session_id: "session-123",
          stop_reason: "end_turn",
        });
        mockProc.stdout.write(line + "\n");
      });
    });

    it("keeps parsing an in-flight turn with its original protocol after the profile changes", () => {
      return new Promise<void>((resolve) => {
        const codexMonitor = new SessionMonitor("test-codex", {
          name: "codex",
          command: "codex",
          args: [],
          protocol: "codex",
        });
        const codexProc = createMockProc();
        mockSpawn.mockReturnValueOnce(codexProc);

        let sawText = false;
        let sawResult = false;

        codexMonitor.on("text", (chunk: string) => {
          expect(chunk).toBe("still parsed as codex");
          sawText = true;
        });
        codexMonitor.on("result", (sid: string) => {
          expect(sid).toBe("codex-thread-1");
          sawResult = true;
        });
        codexMonitor.on("turn-complete", () => {
          expect(sawText).toBe(true);
          expect(sawResult).toBe(true);
          resolve();
        });

        codexMonitor.startTurn("test");
        codexMonitor.setProfile({
          name: "claude",
          command: "claude",
          args: [],
          protocol: "claude",
        });

        codexProc.stdout.write(JSON.stringify({
          type: "thread.started",
          thread_id: "codex-thread-1",
        }) + "\n");
        codexProc.stdout.write(JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_0",
            type: "agent_message",
            text: "still parsed as codex",
          },
        }) + "\n");
        codexProc.stdout.write(JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 2,
            output_tokens: 3,
          },
        }) + "\n");
      });
    });

    it("parses the newer Claude assistant message format for text, session, usage, and turn completion", () => {
      return new Promise<void>((resolve) => {
        monitor.startTurn("test");
        let sawText = false;
        let sawResult = false;
        let sawUsage = false;
        monitor.on("text", (chunk: string) => {
          expect(chunk).toContain("---BRIEF---");
          sawText = true;
        });
        monitor.on("result", (sid: string) => {
          expect(sid).toBe("session-456");
          sawResult = true;
        });
        monitor.on("usage", (usage) => {
          expect(usage).toEqual({
            inputTokens: 8,
            outputTokens: 21,
            cachedInputTokens: 5,
            cacheCreationInputTokens: 13,
          });
          sawUsage = true;
        });
        monitor.on("turn-complete", () => {
          expect(sawText).toBe(true);
          expect(sawResult).toBe(true);
          expect(sawUsage).toBe(true);
          resolve();
        });
        const line = JSON.stringify({
          type: "assistant",
          sessionId: "session-456",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "All set.\n---BRIEF---\n{}\n---END_BRIEF---",
              },
            ],
            stop_reason: "end_turn",
            usage: {
              input_tokens: 8,
              output_tokens: 21,
              cache_read_input_tokens: 5,
              cache_creation_input_tokens: 13,
            },
          },
        });
        mockProc.stdout.write(line + "\n");
      });
    });

    it("does not duplicate Claude text when both stream deltas and finalized assistant text arrive", () => {
      return new Promise<void>((resolve) => {
        monitor.startTurn("test");
        const chunks: string[] = [];
        monitor.on("text", (chunk: string) => {
          chunks.push(chunk);
        });
        monitor.on("turn-complete", () => {
          expect(chunks.join("")).toBe("{\"message\":\"ok\"}");
          resolve();
        });

        mockProc.stdout.write(JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "{\"message\":\"ok\"}" },
          },
        }) + "\n");
        mockProc.stdout.write(JSON.stringify({
          type: "assistant",
          sessionId: "session-dup",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "{\"message\":\"ok\"}" },
            ],
            stop_reason: "end_turn",
          },
        }) + "\n");
      });
    });

    it("emits Claude tool activity from the newer assistant message format", () => {
      return new Promise<void>((resolve) => {
        monitor.startTurn("test");
        monitor.on("tool-activity", (toolName: string, detail?: string | null) => {
          expect(toolName).toBe("Read");
          expect(detail).toBe("read · /tmp/CLAUDE.md");
          resolve();
        });
        const line = JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                name: "Read",
                input: {
                  file_path: "/tmp/CLAUDE.md",
                },
              },
            ],
            stop_reason: "tool_use",
          },
        });
        mockProc.stdout.write(line + "\n");
      });
    });

    it("emits usage from a Claude result event", () => {
      return new Promise<void>((resolve) => {
        monitor.startTurn("test");
        monitor.on("usage", (usage) => {
          expect(usage).toEqual({
            inputTokens: 3,
            outputTokens: 4,
            cachedInputTokens: 2,
            cacheCreationInputTokens: 5,
          });
          resolve();
        });
        const line = JSON.stringify({
          type: "result",
          session_id: "session-123",
          stop_reason: "end_turn",
          usage: {
            input_tokens: 3,
            output_tokens: 4,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: 5,
          },
        });
        mockProc.stdout.write(line + "\n");
      });
    });

    it("emits a Claude rate-limit event", () => {
      return new Promise<void>((resolve) => {
        monitor.startTurn("test");
        monitor.on("rate-limit", (rateLimit) => {
          expect(rateLimit).toMatchObject({
            source: "claude",
            windowLabel: "5h",
            status: "allowed",
            resetsAt: "2026-03-26T22:00:00.000Z",
          });
          resolve();
        });
        const line = JSON.stringify({
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed",
            rateLimitType: "five_hour",
            resetsAt: 1774562400,
          },
        });
        mockProc.stdout.write(line + "\n");
      });
    });

    it("ignores malformed JSON lines", () => {
      monitor.startTurn("test");
      // Should not throw
      mockProc.stdout.write("not valid json\n");
    });

    it("ignores empty lines", () => {
      monitor.startTurn("test");
      mockProc.stdout.write("\n");
      mockProc.stdout.write("  \n");
    });

    it("emits codex, qwen, and gemini tool activity details from metadata lines", () => {
      const codexMonitor = new SessionMonitor("codex-tool", {
        name: "codex",
        command: "codex",
        args: [],
        protocol: "codex",
      });
      const codexProc = createMockProc();
      mockSpawn.mockReturnValueOnce(codexProc);

      const qwenMonitor = new SessionMonitor("qwen-tool", {
        name: "qwen",
        command: "qwen",
        args: [],
        protocol: "qwen",
      });
      const qwenProc = createMockProc();
      mockSpawn.mockReturnValueOnce(qwenProc);

      const geminiMonitor = new SessionMonitor("gemini-tool", {
        name: "gemini",
        command: "gemini",
        args: [],
        protocol: "gemini",
      });
      const geminiProc = createMockProc();
      mockSpawn.mockReturnValueOnce(geminiProc);

      const events: Array<{ tool: string; detail: string | null | undefined }> = [];
      codexMonitor.on("tool-activity", (toolName, detail) => {
        events.push({ tool: toolName, detail });
      });
      qwenMonitor.on("tool-activity", (toolName, detail) => {
        events.push({ tool: toolName, detail });
      });
      geminiMonitor.on("tool-activity", (toolName, detail) => {
        events.push({ tool: toolName, detail });
      });

      codexMonitor.startTurn("codex");
      qwenMonitor.startTurn("qwen");
      geminiMonitor.startTurn("gemini");

      codexProc.stdout.write(JSON.stringify({
        type: "item.started",
        item: {
          type: "shell",
          command: "pnpm test",
        },
      }) + "\n");
      qwenProc.stdout.write(JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            name: "shell",
            input: {
              command: "pnpm typecheck",
            },
          },
        },
      }) + "\n");
      geminiProc.stdout.write(JSON.stringify({
        type: "tool_use",
        tool_name: "shell",
        parameters: {
          command: "pnpm lint",
        },
      }) + "\n");

      expect(events).toEqual([
        { tool: "shell", detail: "bash · pnpm test" },
        { tool: "shell", detail: "bash · pnpm typecheck" },
        { tool: "shell", detail: "bash · pnpm lint" },
      ]);
    });
  });

  describe("sendFollowUp", () => {
    it("throws when no session ID", () => {
      expect(() => monitor.sendFollowUp("text")).toThrow("No session ID");
    });

    it("works when session ID is set", () => {
      monitor.startTurn("first");
      const line = JSON.stringify({ type: "result", session_id: "s1", stop_reason: "end_turn" });
      mockProc.stdout.write(line + "\n");

      mockSpawn.mockReturnValue(createMockProc());
      monitor.sendFollowUp("follow up");
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  describe("Codex usage parsing", () => {
    it("emits usage from turn.completed", () => {
      const codexMonitor = new SessionMonitor("codex-1", {
        name: "codex",
        command: "codex",
        args: [],
        protocol: "codex",
      });
      mockSpawn.mockReturnValue(createMockProc());

      return new Promise<void>((resolve) => {
        codexMonitor.startTurn("test");
        codexMonitor.on("usage", (usage) => {
          expect(usage).toEqual({
            inputTokens: 10,
            outputTokens: 4,
            cachedInputTokens: 2,
            cacheCreationInputTokens: 0,
          });
          resolve();
        });
        const line = JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            cached_input_tokens: 2,
          },
        });
        const currentProc = mockSpawn.mock.results.at(-1)?.value;
        currentProc.stdout.write(line + "\n");
      });
    });
  });

  describe("getters and state", () => {
    it("getSessionId returns null initially", () => {
      expect(monitor.getSessionId()).toBeNull();
    });

    it("restoreSessionId seeds resume state for a relaunched lane", () => {
      monitor.restoreSessionId("sess-restored");
      expect(monitor.getSessionId()).toBe("sess-restored");
    });

    it("getTextBuffer accumulates text", () => {
      monitor.startTurn("test");
      const line1 = JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello " } },
      });
      const line2 = JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
      });
      mockProc.stdout.write(line1 + "\n");
      mockProc.stdout.write(line2 + "\n");
      expect(monitor.getTextBuffer()).toBe("hello world");
    });

    it("clearTextBuffer resets buffer", () => {
      monitor.startTurn("test");
      const line = JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "data" } },
      });
      mockProc.stdout.write(line + "\n");
      monitor.clearTextBuffer();
      expect(monitor.getTextBuffer()).toBe("");
    });

    it("tracks the last prompt and command preview for the active turn", () => {
      monitor.startTurn("inspect lane");
      expect(monitor.getLastPrompt()).toBe("inspect lane");
      expect(monitor.getLastCommandPreview()).toContain("claude");
      expect(monitor.getLastCommandPreview()).toContain("<prompt>");
    });

    it("re-resolves commands when the profile changes", () => {
      monitor.setProfile({
        name: "gemini",
        command: "gemini",
        args: [],
        protocol: "gemini",
      });
      expect(mockExecFileSync).toHaveBeenCalledWith("which", ["gemini"], { encoding: "utf-8" });
    });
  });

  describe("kill", () => {
    it("kills the spawned process group when possible", () => {
      monitor.startTurn("test");
      monitor.kill();
      if (process.platform === "win32") {
        expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
      } else {
        expect(processKillSpy).toHaveBeenCalledWith(-1234, "SIGTERM");
        expect(mockProc.kill).not.toHaveBeenCalled();
      }
    });

    it("does not throw when no process is running", () => {
      expect(() => monitor.kill()).not.toThrow();
    });
  });

  describe("process lifecycle", () => {
    it("emits exit and clears the active process on close", () => {
      const exits: number[] = [];
      monitor.on("exit", (code) => exits.push(code));
      monitor.startTurn("test");

      const closeHandler = mockProc.on.mock.calls.find(([event]) => event === "close")?.[1];
      expect(closeHandler).toBeTypeOf("function");
      closeHandler?.(2);

      expect(exits).toEqual([2]);
      expect(monitor.kill()).toBeUndefined();
    });
  });
});
