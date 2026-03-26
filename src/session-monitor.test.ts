import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { SessionMonitor } from "./session-monitor.js";

function createMockProc() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = { end: vi.fn() };
  const proc = {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(),
    on: vi.fn(),
    pid: 1234,
  };
  return proc;
}

describe("SessionMonitor", () => {
  let monitor: SessionMonitor;
  let mockProc: ReturnType<typeof createMockProc>;

  beforeEach(() => {
    mockProc = createMockProc();
    mockSpawn.mockReturnValue(mockProc);
    monitor = new SessionMonitor("test-1", {
      name: "claude",
      command: "claude",
      args: ["--permission-mode", "auto"],
    });
  });

  describe("constructor", () => {
    it("resolves command via which", () => {
      expect(mockExecFileSync).toHaveBeenCalledWith("which", ["claude"], { encoding: "utf-8" });
    });

    it("uses command directly if starts with /", () => {
      const m = new SessionMonitor("t", { name: "test", command: "/usr/bin/claude", args: [] });
      // Should not call which for absolute paths (it's called once for the first monitor)
      expect(m.id).toBe("t");
    });
  });

  describe("startTurn", () => {
    it("spawns process with correct args", () => {
      monitor.startTurn("hello world");
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["-p", "hello world", "--output-format", "stream-json"]),
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
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

  describe("getters and state", () => {
    it("getSessionId returns null initially", () => {
      expect(monitor.getSessionId()).toBeNull();
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
  });

  describe("kill", () => {
    it("kills the spawned process", () => {
      monitor.startTurn("test");
      monitor.kill();
      expect(mockProc.kill).toHaveBeenCalled();
    });

    it("does not throw when no process is running", () => {
      expect(() => monitor.kill()).not.toThrow();
    });
  });
});
