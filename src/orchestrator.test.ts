import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "./orchestrator.js";
import { InputInjector } from "./input-injector.js";

function makeMockMonitor(sessionId: string | null = "sess-1") {
  return {
    getSessionId: vi.fn(() => sessionId),
    startTurn: vi.fn(),
    sendFollowUp: vi.fn(),
    on: vi.fn(),
    kill: vi.fn(),
  } as any;
}

describe("Orchestrator", () => {
  let orch: Orchestrator;
  let injectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    orch = new Orchestrator();
    injectSpy = vi.spyOn(InputInjector.prototype, "inject");
  });

  describe("registerWorker / unregisterWorker", () => {
    it("registers a worker", () => {
      const monitor = makeMockMonitor();
      orch.registerWorker("w1", monitor, "claude");
      expect(orch.getWorkerIds()).toEqual(["w1"]);
    });

    it("unregisters a worker", () => {
      orch.registerWorker("w1", makeMockMonitor(), "claude");
      orch.unregisterWorker("w1");
      expect(orch.getWorkerIds()).toEqual([]);
    });

    it("getWorker returns registered worker", () => {
      const monitor = makeMockMonitor();
      orch.registerWorker("w1", monitor, "claude");
      const worker = orch.getWorker("w1");
      expect(worker).toBeDefined();
      expect(worker!.id).toBe("w1");
      expect(worker!.profileName).toBe("claude");
    });

    it("getWorker returns undefined for unknown id", () => {
      expect(orch.getWorker("nonexistent")).toBeUndefined();
    });
  });

  describe("sendPlan", () => {
    it("injects task description to worker", () => {
      const monitor = makeMockMonitor("sess-1");
      orch.registerWorker("w1", monitor, "claude");
      orch.sendPlan("w1", "implement feature X");
      expect(monitor.sendFollowUp).toHaveBeenCalledWith("implement feature X");
    });

    it("throws for unknown worker", () => {
      expect(() => orch.sendPlan("unknown", "task")).toThrow("Worker unknown not found");
    });
  });

  describe("sendReview", () => {
    it("injects review instructions to worker", () => {
      const monitor = makeMockMonitor("sess-1");
      orch.registerWorker("w1", monitor, "claude");
      orch.sendReview("w1", "check error handling");
      expect(monitor.sendFollowUp).toHaveBeenCalledWith("check error handling");
    });

    it("throws for unknown worker", () => {
      expect(() => orch.sendReview("bad", "review")).toThrow("Worker bad not found");
    });
  });

  describe("sendInput", () => {
    it("injects text to worker", () => {
      const monitor = makeMockMonitor("sess-1");
      orch.registerWorker("w1", monitor, "claude");
      orch.sendInput("w1", "hello");
      expect(monitor.sendFollowUp).toHaveBeenCalledWith("hello");
    });

    it("throws for unknown worker", () => {
      expect(() => orch.sendInput("bad", "text")).toThrow("Worker bad not found");
    });
  });

  describe("broadcastToWorkers", () => {
    it("sends text to all workers", () => {
      const m1 = makeMockMonitor("s1");
      const m2 = makeMockMonitor("s2");
      orch.registerWorker("w1", m1, "claude");
      orch.registerWorker("w2", m2, "codex");
      orch.broadcastToWorkers("attention all workers");
      expect(m1.sendFollowUp).toHaveBeenCalledWith("attention all workers");
      expect(m2.sendFollowUp).toHaveBeenCalledWith("attention all workers");
    });

    it("does nothing with no workers", () => {
      expect(() => orch.broadcastToWorkers("hello")).not.toThrow();
    });
  });

  describe("browser sharing", () => {
    it("stores the browser agent when set", () => {
      const browser = {
        open: vi.fn(),
        screenshot: vi.fn(),
        getContextSummary: vi.fn(),
      } as any;

      expect(() => orch.setBrowser(browser)).not.toThrow();
    });

    it("shares a screenshot with a worker after optionally opening a URL", async () => {
      const monitor = makeMockMonitor("sess-1");
      const browser = {
        open: vi.fn(async () => ({ url: "https://roscoe.sh", title: "Roscoe" })),
        screenshot: vi.fn(async () => "/tmp/screenshots/app.png"),
      } as any;

      orch.registerWorker("w1", monitor, "claude");
      orch.setBrowser(browser);

      const path = await orch.screenshotAndShare("w1", "https://roscoe.sh");

      expect(browser.open).toHaveBeenCalledWith("https://roscoe.sh");
      expect(browser.screenshot).toHaveBeenCalled();
      expect(path).toBe("/tmp/screenshots/app.png");
      expect(injectSpy).toHaveBeenCalledWith(
        monitor,
        "Here's a screenshot of the current app state: /tmp/screenshots/app.png",
      );
    });

    it("shares a screenshot without opening a URL when none is provided", async () => {
      const monitor = makeMockMonitor("sess-1");
      const browser = {
        open: vi.fn(),
        screenshot: vi.fn(async () => "/tmp/screenshots/only.png"),
      } as any;

      orch.registerWorker("w1", monitor, "claude");
      orch.setBrowser(browser);

      await orch.screenshotAndShare("w1");

      expect(browser.open).not.toHaveBeenCalled();
      expect(injectSpy).toHaveBeenCalledWith(
        monitor,
        "Here's a screenshot of the current app state: /tmp/screenshots/only.png",
      );
    });

    it("throws when trying to share a screenshot before a browser is set", async () => {
      await expect(orch.screenshotAndShare("w1")).rejects.toThrow(
        "Browser agent not initialized",
      );
    });

    it("throws when screenshot sharing targets an unknown worker", async () => {
      const browser = {
        open: vi.fn(),
        screenshot: vi.fn(async () => "/tmp/screenshots/ghost.png"),
      } as any;

      orch.setBrowser(browser);

      await expect(orch.screenshotAndShare("missing")).rejects.toThrow(
        "Worker missing not found",
      );
    });

    it("shares a browser snapshot summary with a worker", async () => {
      const monitor = makeMockMonitor("sess-1");
      const browser = {
        getContextSummary: vi.fn(async () => "Page: Dashboard\nInteractive elements:\n  btn-1 [button] Deploy"),
      } as any;

      orch.registerWorker("w1", monitor, "claude");
      orch.setBrowser(browser);

      await orch.snapshotAndShare("w1");

      expect(browser.getContextSummary).toHaveBeenCalled();
      expect(injectSpy).toHaveBeenCalledWith(
        monitor,
        "Current browser state:\nPage: Dashboard\nInteractive elements:\n  btn-1 [button] Deploy",
      );
    });

    it("throws when snapshot sharing is attempted without a browser", async () => {
      await expect(orch.snapshotAndShare("w1")).rejects.toThrow(
        "Browser agent not initialized",
      );
    });

    it("throws when snapshot sharing targets an unknown worker", async () => {
      const browser = {
        getContextSummary: vi.fn(async () => "Page: Missing"),
      } as any;

      orch.setBrowser(browser);

      await expect(orch.snapshotAndShare("missing")).rejects.toThrow(
        "Worker missing not found",
      );
    });
  });
});
