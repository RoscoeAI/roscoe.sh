import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExecFile = vi.fn<(cmd: string, args: string[], opts: unknown, cb: Function) => void>();
const mockExistsSync = vi.fn<(path: string) => boolean>(() => true);
const mockMkdirSync = vi.fn<(path: string, options?: { recursive?: boolean }) => void>();

vi.mock("child_process", () => ({
  execFile: (...args: [string, string[], unknown, Function]) => mockExecFile(...args),
}));

vi.mock("fs", () => ({
  existsSync: (...args: [string]) => mockExistsSync(...args),
  mkdirSync: (...args: [string, { recursive?: boolean }?]) => mockMkdirSync(...args),
}));

import { BrowserAgent } from "./browser-agent.js";

describe("BrowserAgent", () => {
  let agent: BrowserAgent;

  beforeEach(() => {
    agent = new BrowserAgent("test-session");
    mockExecFile.mockReset();
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReset();
  });

  afterEach(() => {
    delete process.env.TEST_PASSWORD;
  });

  function mockExecSuccess(stdout: string) {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, stdout, "");
      },
    );
  }

  function mockExecError(message: string) {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error(message), "", "stderr output");
      },
    );
  }

  describe("constructor", () => {
    it("generates session ID if not provided", () => {
      const a = new BrowserAgent();
      expect(a.getSessionId()).toMatch(/^roscoe-\d+$/);
    });

    it("uses provided session ID", () => {
      expect(agent.getSessionId()).toBe("test-session");
    });

    it("creates the screenshot directory when it is missing", () => {
      mockExistsSync.mockReturnValueOnce(false);
      const missing = new BrowserAgent("missing-dir");
      expect(missing.getScreenshotDir()).toContain("screenshots");
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("screenshots"), { recursive: true });
    });
  });

  describe("open", () => {
    it("calls agent-browser open with URL and session", async () => {
      mockExecSuccess(JSON.stringify({ url: "https://example.com", title: "Example" }));
      const result = await agent.open("https://example.com");
      expect(result.url).toBe("https://example.com");
      expect(result.title).toBe("Example");
      expect(mockExecFile).toHaveBeenCalledWith(
        "agent-browser",
        ["open", "https://example.com", "--json", "--session", "test-session"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("rejects on error", async () => {
      mockExecError("connection refused");
      await expect(agent.open("https://bad.url")).rejects.toThrow("agent-browser open failed");
    });

    it("throws when agent-browser returns malformed JSON", async () => {
      mockExecSuccess("not json");
      await expect(agent.open("https://example.com")).rejects.toThrow("Failed to parse agent-browser output");
    });
  });

  describe("screenshot", () => {
    it("generates filename and returns path", async () => {
      mockExecSuccess("");
      const path = await agent.screenshot();
      expect(path).toMatch(/screenshot-\d+\.png$/);
    });

    it("uses custom filename when provided", async () => {
      mockExecSuccess("");
      const path = await agent.screenshot("custom.png");
      expect(path).toContain("custom.png");
    });
  });

  describe("snapshot", () => {
    it("returns parsed element list", async () => {
      const elements = [
        { ref: "e1", role: "button", name: "Submit" },
        { ref: "e2", role: "textbox", name: "Email" },
      ];
      mockExecSuccess(JSON.stringify(elements));
      const result = await agent.snapshot();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Submit");
    });
  });

  describe("interact", () => {
    it("sends action, ref, and optional value", async () => {
      mockExecSuccess("ok");
      await agent.interact("click", "e1");
      expect(mockExecFile).toHaveBeenCalledWith(
        "agent-browser",
        ["click", "e1", "--json", "--session", "test-session"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("includes value when provided", async () => {
      mockExecSuccess("ok");
      await agent.interact("fill", "e2", "test@example.com");
      expect(mockExecFile).toHaveBeenCalledWith(
        "agent-browser",
        ["fill", "e2", "test@example.com", "--json", "--session", "test-session"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe("wrapper helpers", () => {
    it("delegates click and fill through interact", async () => {
      mockExecSuccess("ok");
      const interactSpy = vi.spyOn(agent, "interact");

      await agent.click("submit");
      await agent.fill("email", "tim@example.com");

      expect(interactSpy).toHaveBeenNthCalledWith(1, "click", "submit");
      expect(interactSpy).toHaveBeenNthCalledWith(2, "fill", "email", "tim@example.com");
    });

    it("parses evaluate and getState responses", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb: Function) => {
          if (args[0] === "evaluate" && args[1] === "2 + 2") {
            cb(null, JSON.stringify(4), "");
            return;
          }
          cb(null, JSON.stringify({ url: "https://example.com", title: "Example" }), "");
        },
      );

      await expect(agent.evaluate("2 + 2")).resolves.toBe(4);
      await expect(agent.getState()).resolves.toMatchObject({
        url: "https://example.com",
        title: "Example",
      });
    });
  });

  describe("login", () => {
    it("opens URL and executes auth steps", async () => {
      mockExecSuccess(JSON.stringify({ url: "https://app.com", title: "App" }));
      const profile = {
        name: "test-auth",
        url: "https://app.com/login",
        steps: [
          { action: "fill" as const, ref: "email", value: "user@test.com" },
          { action: "click" as const, ref: "submit" },
        ],
      };
      await agent.login(profile);
      // open + fill + click = at least 3 exec calls
      expect(mockExecFile).toHaveBeenCalledTimes(3);
    });

    it("interpolates env vars in step values", async () => {
      mockExecSuccess(JSON.stringify({ url: "https://app.com", title: "App" }));
      process.env.TEST_PASSWORD = "secret123";
      const profile = {
        name: "test-auth",
        url: "https://app.com",
        steps: [
          { action: "fill" as const, ref: "password", value: "${TEST_PASSWORD}" },
        ],
      };
      await agent.login(profile);
      expect(mockExecFile).toHaveBeenCalledWith(
        "agent-browser",
        expect.arrayContaining(["fill", "password", "secret123"]),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("handles navigate and wait steps, including the default wait duration", async () => {
      vi.useFakeTimers();
      mockExecSuccess(JSON.stringify({ url: "https://app.com", title: "App" }));
      const openSpy = vi.spyOn(agent, "open");
      const fillSpy = vi.spyOn(agent, "fill");
      const clickSpy = vi.spyOn(agent, "click");

      const promise = agent.login({
        name: "branchy-auth",
        url: "https://app.com",
        steps: [
          { action: "navigate", value: "https://app.com/login" },
          { action: "fill", ref: "email", value: "person@example.com" },
          { action: "fill", value: "ignored because ref is missing" },
          { action: "click", ref: "submit" },
          { action: "click" },
          { action: "wait" },
          { action: "wait", value: "250" },
        ],
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(openSpy).toHaveBeenNthCalledWith(1, "https://app.com");
      expect(openSpy).toHaveBeenNthCalledWith(2, "https://app.com/login");
      expect(fillSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  describe("getContextSummary", () => {
    it("returns page state and elements summary", async () => {
      // First call: getState via evaluate
      // Second call: snapshot
      let callCount = 0;
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, cb: Function) => {
          callCount++;
          if (args[0] === "evaluate") {
            cb(null, JSON.stringify({ url: "https://example.com", title: "Example" }), "");
          } else if (args[0] === "snapshot") {
            cb(null, JSON.stringify([
              { ref: "e1", role: "button", name: "Click me" },
            ]), "");
          } else {
            cb(null, "", "");
          }
        },
      );
      const summary = await agent.getContextSummary();
      expect(summary).toContain("Example");
      expect(summary).toContain("Click me");
    });

    it("falls back gracefully when state or snapshot reads fail", async () => {
      vi.spyOn(agent, "getState").mockRejectedValueOnce(new Error("boom"));
      vi.spyOn(agent, "snapshot").mockRejectedValueOnce(new Error("no snapshot"));

      await expect(agent.getContextSummary()).resolves.toContain("Page: (could not read state)");
    });

    it("truncates long snapshot lists in the context summary", async () => {
      vi.spyOn(agent, "getState").mockResolvedValueOnce({
        url: "https://example.com",
        title: "Example",
      });
      vi.spyOn(agent, "snapshot").mockResolvedValueOnce(
        Array.from({ length: 22 }, (_, index) => ({
          ref: `el-${index + 1}`,
          role: "button",
          name: `Button ${index + 1}`,
        })),
      );

      const summary = await agent.getContextSummary();
      expect(summary).toContain("Interactive elements:");
      expect(summary).toContain("el-20 [button] Button 20");
      expect(summary).toContain("... and 2 more");
    });
  });

  describe("getScreenshotDir", () => {
    it("returns screenshot directory path", () => {
      expect(agent.getScreenshotDir()).toContain("screenshots");
    });
  });
});
