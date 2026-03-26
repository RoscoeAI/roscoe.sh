import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "./orchestrator.js";

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

  beforeEach(() => {
    orch = new Orchestrator();
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
});
