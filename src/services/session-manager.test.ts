import { describe, it, expect, vi, beforeEach } from "vitest";
import { homedir } from "os";
import { resolve } from "path";
import { EventEmitter } from "events";

const { mockStartOneShotRun } = vi.hoisted(() => ({
  mockStartOneShotRun: vi.fn(() => ({
    proc: {} as any,
    result: Promise.resolve("Test summary"),
  })),
}));

// Create a proper mock class
class MockSessionMonitor extends EventEmitter {
  startTurn = vi.fn();
  sendFollowUp = vi.fn();
  getSessionId = vi.fn<() => string | null>(() => null);
  restoreSessionId = vi.fn(function(this: MockSessionMonitor, sessionId: string | null) {
    this.getSessionId = vi.fn(() => sessionId);
  });
  kill = vi.fn();
  setProfile = vi.fn();
  id: string;
  constructor(id: string) {
    super();
    this.id = id;
  }
}

// Mock modules before importing
vi.mock("../config.js", () => ({
  loadProfile: vi.fn(() => ({ name: "test", command: "claude", args: [] })),
  loadProjectContext: vi.fn(() => null),
  loadRoscoeSettings: vi.fn(() => ({
    notifications: { enabled: false, phoneNumber: "", provider: "twilio" },
    providers: {
      claude: { enabled: true, brief: false, ide: false, chrome: false },
      codex: { enabled: true, webSearch: false },
      gemini: { enabled: false },
    },
    behavior: { autoHealMetadata: true },
  })),
  loadLaneSession: vi.fn(() => null),
  resolveProjectRoot: vi.fn((dir: string) => dir),
  saveLaneSession: vi.fn(),
  getProjectContractFingerprint: vi.fn(() => "fingerprint-1"),
}));
vi.mock("../session-monitor.js", () => ({
  SessionMonitor: vi.fn().mockImplementation(function(id: string) {
    return new MockSessionMonitor(id);
  }),
}));
vi.mock("../llm-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm-runtime.js")>();
  return {
    ...actual,
    startOneShotRun: mockStartOneShotRun,
  };
});

import { expandTilde, parseSessionSpec, SessionManagerService } from "./session-manager.js";
import { SessionMonitor } from "../session-monitor.js";
import {
  loadProfile,
  loadProjectContext,
  loadRoscoeSettings,
  loadLaneSession,
  resolveProjectRoot,
  saveLaneSession,
  getProjectContractFingerprint,
} from "../config.js";
import { startOneShotRun } from "../llm-runtime.js";

// ── Pure helpers ────────────────────────────────────────────

describe("expandTilde", () => {
  it("expands ~ alone to homedir", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("expands ~/path to homedir + path", () => {
    expect(expandTilde("~/projects")).toBe(resolve(homedir(), "projects"));
  });

  it("returns non-tilde paths unchanged", () => {
    expect(expandTilde("/usr/local")).toBe("/usr/local");
  });

  it("returns relative paths unchanged", () => {
    expect(expandTilde("relative/path")).toBe("relative/path");
  });
});

describe("parseSessionSpec", () => {
  it("parses profile-only spec", () => {
    const result = parseSessionSpec("claude-code");
    expect(result).toEqual({
      profileName: "claude-code",
      projectDir: null,
      taskName: null,
    });
  });

  it("parses profile@dir spec", () => {
    const result = parseSessionSpec("claude-code@/tmp/project");
    expect(result).toEqual({
      profileName: "claude-code",
      projectDir: resolve("/tmp/project"),
      taskName: null,
    });
  });

  it("parses profile@dir:task spec", () => {
    const result = parseSessionSpec("claude-code@/tmp/project:fix-bug");
    expect(result).toEqual({
      profileName: "claude-code",
      projectDir: resolve("/tmp/project"),
      taskName: "fix-bug",
    });
  });

  it("expands tilde in directory", () => {
    const result = parseSessionSpec("claude-code@~/projects/foo");
    expect(result.projectDir).toBe(resolve(homedir(), "projects/foo"));
  });

  it("handles empty task name after colon", () => {
    const result = parseSessionSpec("claude-code@/tmp/project:");
    expect(result.taskName).toBe("");
  });

  it("handles @ in profile name (uses first @)", () => {
    const result = parseSessionSpec("profile@/path@with-at");
    expect(result.profileName).toBe("profile");
  });
});

// ── SessionManagerService ───────────────────────────────────

describe("SessionManagerService", () => {
  let svc: SessionManagerService;

  beforeEach(() => {
    // Re-apply mock implementations after mockReset
    vi.mocked(loadProfile).mockReturnValue({ name: "test", command: "claude", args: [] });
    vi.mocked(loadProjectContext).mockReturnValue(null);
    vi.mocked(loadRoscoeSettings).mockReturnValue({
      notifications: { enabled: false, phoneNumber: "", provider: "twilio" },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: { autoHealMetadata: true },
    } as any);
    vi.mocked(loadLaneSession).mockReturnValue(null);
    vi.mocked(resolveProjectRoot).mockImplementation((dir: string) => dir);
    vi.mocked(getProjectContractFingerprint).mockReturnValue("fingerprint-1");
    vi.mocked(SessionMonitor).mockImplementation(function(id: string) {
      return new MockSessionMonitor(id) as any;
    });
    vi.mocked(startOneShotRun).mockImplementation(() => ({
      proc: {} as any,
      result: Promise.resolve("Test summary"),
    }));
    svc = new SessionManagerService();
  });

  describe("startSession", () => {
    it("creates a managed session with correct id format", () => {
      const { managed, restoredState } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });
      expect(managed.id).toMatch(/^claude-code-proj-main-\d+$/);
      expect(managed.profileName).toBe("claude-code");
      expect(managed.projectName).toBe("proj");
      expect(managed.awaitingInput).toBe(true);
    });

    it("passes resolved runtime settings through to the worker monitor", () => {
      vi.mocked(loadProfile).mockReturnValue({
        name: "codex",
        command: "codex",
        args: [],
        protocol: "codex",
      } as any);
      vi.mocked(loadProjectContext).mockReturnValue({
        name: "proj",
        directory: "/tmp/proj",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {
          workerByProtocol: {
            codex: {
              model: "gpt-5.4",
              reasoningEffort: "xhigh",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
            },
          },
        },
      });

      svc.startSession({
        profileName: "codex",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(vi.mocked(SessionMonitor)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          runtime: expect.objectContaining({
            model: "gpt-5.4",
            reasoningEffort: "xhigh",
          }),
        }),
        "/tmp/proj",
      );
    });

    it("locks a project to the onboarded provider even if a different profile is requested", () => {
      vi.mocked(loadProfile).mockImplementation((name: string) => {
        if (name === "claude-code") {
          return { name, command: "claude", args: [], protocol: "claude" } as any;
        }
        return { name: "codex", command: "codex", args: [], protocol: "codex" } as any;
      });
      vi.mocked(loadProjectContext).mockReturnValue({
        name: "proj",
        directory: "/tmp/proj",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {
          lockedProvider: "codex",
          onboarding: {
            profileName: "codex",
            runtime: {
              tuningMode: "auto",
              model: "gpt-5.4",
              reasoningEffort: "xhigh",
            },
          },
        },
      });

      const { managed, restoredState } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(managed.profileName).toBe("codex");
      expect(managed.profile.protocol).toBe("codex");
    });

    it("repoints nested project roots before loading and launching a session", () => {
      vi.mocked(resolveProjectRoot).mockImplementation((dir: string) => dir === "/tmp/proj/cli" ? "/tmp/proj" : dir);

      const { managed } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj/cli",
        worktreePath: "/tmp/proj/cli",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(loadProjectContext).toHaveBeenCalledWith("/tmp/proj");
      expect(loadLaneSession).toHaveBeenCalledWith("/tmp/proj", "/tmp/proj", "main", "claude-code");
      expect(vi.mocked(SessionMonitor)).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        "/tmp/proj",
      );
      expect(managed.projectDir).toBe("/tmp/proj");
      expect(managed.worktreePath).toBe("/tmp/proj");
    });

    it("registers the worker with the orchestrator when one is attached", () => {
      const orchestrator = {
        registerWorker: vi.fn(),
      };
      svc.orchestrator = orchestrator as any;

      const { managed } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(orchestrator.registerWorker).toHaveBeenCalledWith(
        managed.id,
        managed.monitor,
        "claude-code",
      );
    });
  });

  describe("runtime edits", () => {
    it("keeps the current worker session id when retuning within the same provider", () => {
      vi.mocked(loadProfile).mockReturnValue({
        name: "codex",
        command: "codex",
        args: [],
        protocol: "codex",
      } as any);

      const { managed } = svc.startSession({
        profileName: "codex",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });
      const monitor = managed.monitor as unknown as MockSessionMonitor;
      monitor.restoreSessionId("codex-session-1");

      svc.updateManagedRuntime(managed, {
        executionMode: "safe",
        tuningMode: "auto",
        model: "gpt-5.4",
        reasoningEffort: "high",
      }, "codex");

      expect(managed.profile.protocol).toBe("codex");
      expect(managed.profileName).toBe("codex");
      expect(managed.lastWorkerRuntimeStrategy).toBe("auto-managed");
      expect(managed.lastWorkerRuntimeRationale).toContain("retune");
      expect(monitor.getSessionId()).toBe("codex-session-1");
    });

    it("switches the live worker provider cleanly and clears the old provider session id", () => {
      vi.mocked(loadProfile).mockImplementation((name: string) => {
        if (name === "codex") {
          return { name, command: "codex", args: [], protocol: "codex" } as any;
        }
        return { name: "claude-code", command: "claude", args: [], protocol: "claude" } as any;
      });

      const { managed } = svc.startSession({
        profileName: "codex",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });
      const monitor = managed.monitor as unknown as MockSessionMonitor;
      monitor.restoreSessionId("codex-session-1");

      svc.updateManagedRuntime(managed, {
        executionMode: "safe",
        tuningMode: "manual",
        model: "claude-opus-4-6",
        reasoningEffort: "high",
        permissionMode: "auto",
      }, "claude");

      expect(managed.profile.protocol).toBe("claude");
      expect(managed.profileName).toBe("claude-code");
      expect(managed.lastWorkerRuntimeSummary).toContain("claude");
      expect(monitor.setProfile).toHaveBeenCalledWith(expect.objectContaining({
        protocol: "claude",
        runtime: expect.objectContaining({
          model: "claude-opus-4-6",
          reasoningEffort: "high",
          executionMode: "safe",
        }),
      }));
      expect(monitor.getSessionId()).toBeNull();
    });

    it("replaces responder runtime instead of carrying stale accelerated flags forward", () => {
      vi.mocked(loadProfile).mockImplementation((name: string) => {
        if (name === "codex") {
          return { name, command: "codex", args: [], protocol: "codex" } as any;
        }
        return { name: "claude-code", command: "claude", args: [], protocol: "claude" } as any;
      });

      const managed = {
        profile: {
          name: "codex",
          command: "codex",
          args: [],
          protocol: "codex",
        },
        profileName: "codex",
        responderMonitor: new MockSessionMonitor("responder-1"),
      } as any;

      svc.updateManagedResponderRuntime(managed, {
        executionMode: "safe",
        tuningMode: "manual",
        model: "gpt-5.4",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      }, "codex");

      expect(managed.lastResponderRuntimeSummary).toContain("codex");
      expect(managed.lastResponderRuntimeSummary).not.toContain("bypass");
    });

    it("records auto-managed responder guidance when retuning Roscoe within the same provider", () => {
      vi.mocked(loadProfile).mockReturnValue({
        name: "claude-code",
        command: "claude",
        args: [],
        protocol: "claude",
      } as any);

      const managed = {
        profile: {
          name: "claude-code",
          command: "claude",
          args: [],
          protocol: "claude",
        },
        profileName: "claude-code",
        responderMonitor: new MockSessionMonitor("responder-1"),
      } as any;

      svc.updateManagedResponderRuntime(managed, {
        executionMode: "safe",
        tuningMode: "auto",
        model: "claude-opus-4-6",
        reasoningEffort: "max",
      }, "claude");

      expect(managed.lastResponderStrategy).toBe("auto-managed");
      expect(managed.lastResponderRationale).toContain("retune");
      expect(managed.responderMonitor.getSessionId()).toBeNull();
    });
  });

  describe("generateSummary", () => {
    it("returns summary from the shared one-shot runner", async () => {
      const { managed } = svc.startSession({
        profileName: "test",
        projectDir: "/tmp",
        worktreePath: "/tmp",
        worktreeName: "main",
        projectName: "test",
      });
      managed.tracker.addOutput("Did some work");
      managed.tracker.markTurnComplete();
      const summary = await svc.generateSummary(managed);
      expect(summary).toBe("Test summary");
    });

    it("returns fallback on error", async () => {
      vi.mocked(startOneShotRun).mockImplementation(() => ({
        proc: {} as any,
        result: Promise.reject(new Error("fail")),
      }));
      const { managed } = svc.startSession({
        profileName: "test",
        projectDir: "/tmp",
        worktreePath: "/tmp",
        worktreeName: "main",
        projectName: "test",
      });
      const summary = await svc.generateSummary(managed);
      expect(summary).toBe("(summary unavailable)");
    });
  });

  describe("cancelGeneration", () => {
    it("delegates cancellation to the shared response generator", () => {
      const cancelSpy = vi.spyOn(svc.generator, "cancelGeneration").mockImplementation(() => {});
      svc.cancelGeneration();
      expect(cancelSpy).toHaveBeenCalled();
    });
  });

  describe("injectText", () => {
    it("records user input and sets awaitingInput to false", () => {
      const { managed } = svc.startSession({
        profileName: "test",
        projectDir: "/tmp",
        worktreePath: "/tmp",
        worktreeName: "main",
        projectName: "test",
      });
      svc.injectText(managed, "hello");
      expect(managed.awaitingInput).toBe(false);
      expect(managed.tracker.getHistory()).toHaveLength(1);
      expect(managed.tracker.getHistory()[0].content).toBe("hello");
    });

    it("uses the same provider-neutral guidance path for SMS steering", () => {
      const { managed } = svc.startSession({
        profileName: "test",
        projectDir: "/tmp",
        worktreePath: "/tmp",
        worktreeName: "main",
        projectName: "test",
      });
      svc.injectOperatorGuidance(managed, "resume once the preview is ready", "sms");
      expect(managed.awaitingInput).toBe(false);
      expect(managed.tracker.getHistory()[0].content).toBe("resume once the preview is ready");
    });
  });

  describe("executeSuggestion", () => {
    it("ignores suggestions once the lane is no longer awaiting input", async () => {
      const { managed } = svc.startSession({
        profileName: "test",
        projectDir: "/tmp",
        worktreePath: "/tmp",
        worktreeName: "main",
        projectName: "test",
      });
      managed.awaitingInput = false;

      await svc.executeSuggestion(managed, {
        text: "continue",
        confidence: 90,
        reasoning: "clear next step",
      });

      expect(managed.monitor.sendFollowUp).not.toHaveBeenCalled();
      expect(managed.monitor.startTurn).not.toHaveBeenCalled();
      expect(managed.tracker.getHistory()).toHaveLength(0);
    });

    it("injects a suggestion only once while awaiting input", async () => {
      const { managed } = svc.startSession({
        profileName: "test",
        projectDir: "/tmp",
        worktreePath: "/tmp",
        worktreeName: "main",
        projectName: "test",
      });
      managed.awaitingInput = true;
      managed.monitor.getSessionId = vi.fn(() => "session-1");

      await svc.executeSuggestion(managed, {
        text: "continue",
        confidence: 90,
        reasoning: "clear next step",
      });
      await svc.executeSuggestion(managed, {
        text: "continue",
        confidence: 90,
        reasoning: "clear next step",
      });

      expect(managed.monitor.sendFollowUp).toHaveBeenCalledTimes(1);
      expect(managed.monitor.sendFollowUp).toHaveBeenCalledWith("continue");
      expect(managed.awaitingInput).toBe(false);
    });

    it("executes browser and orchestrator actions before injecting the next worker turn", async () => {
      const browserAgent = {
        screenshot: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        getContextSummary: vi.fn().mockResolvedValue("snapshot"),
        interact: vi.fn().mockResolvedValue(undefined),
      };
      svc.browserAgent = browserAgent as any;
      const orchestrator = {
        registerWorker: vi.fn(),
        sendPlan: vi.fn(),
        sendReview: vi.fn(),
        sendInput: vi.fn(),
      };
      svc.orchestrator = orchestrator as any;

      const { managed } = svc.startSession({
        profileName: "test",
        projectDir: "/tmp",
        worktreePath: "/tmp",
        worktreeName: "main",
        projectName: "test",
      });
      managed.awaitingInput = true;
      managed.monitor.getSessionId = vi.fn(() => "session-1");

      await svc.executeSuggestion(managed, {
        text: "continue",
        confidence: 90,
        reasoning: "clear next step",
        browserActions: [
          { type: "screenshot", params: {}, description: "capture" },
          { type: "navigate", params: { url: "https://example.com" }, description: "open" },
          { type: "snapshot", params: {}, description: "snapshot" },
          { type: "interact", params: { action: "click", ref: "button-1", value: "go" }, description: "click" },
        ],
        orchestratorActions: [
          { type: "plan", workerId: "worker-1", text: "plan next step" },
          { type: "review", workerId: "worker-1", text: "review diff" },
          { type: "input", workerId: "worker-1", text: "resume work" },
        ],
      });

      expect(browserAgent.screenshot).toHaveBeenCalled();
      expect(browserAgent.open).toHaveBeenCalledWith("https://example.com");
      expect(browserAgent.getContextSummary).toHaveBeenCalled();
      expect(browserAgent.interact).toHaveBeenCalledWith("click", "button-1", "go");
      expect(orchestrator.sendPlan).toHaveBeenCalledWith("worker-1", "plan next step");
      expect(orchestrator.sendReview).toHaveBeenCalledWith("worker-1", "review diff");
      expect(orchestrator.sendInput).toHaveBeenCalledWith("worker-1", "resume work");
      expect(managed.monitor.sendFollowUp).toHaveBeenCalledWith("continue");
    });

    it("skips optional browser and orchestrator actions when helpers are unavailable", async () => {
      const { managed } = svc.startSession({
        profileName: "test",
        projectDir: "/tmp",
        worktreePath: "/tmp",
        worktreeName: "main",
        projectName: "test",
      });
      managed.awaitingInput = true;

      await svc.executeSuggestion(managed, {
        text: "",
        confidence: 88,
        reasoning: "best effort",
        browserActions: [
          { type: "navigate", params: { url: "https://example.com" }, description: "open" },
        ],
        orchestratorActions: [
          { type: "plan", workerId: "worker-1", text: "plan next step" },
        ],
      });

      expect(managed.awaitingInput).toBe(false);
      expect(managed.monitor.sendFollowUp).not.toHaveBeenCalled();
    });

    it("ignores browser actions that are missing required params", async () => {
      const browserAgent = {
        screenshot: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        getContextSummary: vi.fn().mockResolvedValue("snapshot"),
        interact: vi.fn().mockResolvedValue(undefined),
      };
      svc.browserAgent = browserAgent as any;

      const { managed } = svc.startSession({
        profileName: "test",
        projectDir: "/tmp",
        worktreePath: "/tmp",
        worktreeName: "main",
        projectName: "test",
      });
      managed.awaitingInput = true;

      await svc.executeSuggestion(managed, {
        text: "",
        confidence: 88,
        reasoning: "best effort",
        browserActions: [
          { type: "navigate", params: {}, description: "missing url" },
          { type: "interact", params: { action: "click" }, description: "missing ref" },
        ],
      });

      expect(browserAgent.open).not.toHaveBeenCalled();
      expect(browserAgent.interact).not.toHaveBeenCalled();
      expect(managed.monitor.sendFollowUp).not.toHaveBeenCalled();
    });

    it("swallows best-effort browser and orchestrator action failures", async () => {
      const browserAgent = {
        screenshot: vi.fn().mockRejectedValue(new Error("screenshot failed")),
        open: vi.fn().mockRejectedValue(new Error("open failed")),
        getContextSummary: vi.fn().mockRejectedValue(new Error("snapshot failed")),
        interact: vi.fn().mockRejectedValue(new Error("interact failed")),
      };
      svc.browserAgent = browserAgent as any;
      const orchestrator = {
        registerWorker: vi.fn(),
        sendPlan: vi.fn(() => {
          throw new Error("plan failed");
        }),
        sendReview: vi.fn(() => {
          throw new Error("review failed");
        }),
        sendInput: vi.fn(() => {
          throw new Error("input failed");
        }),
      };
      svc.orchestrator = orchestrator as any;

      const { managed } = svc.startSession({
        profileName: "test",
        projectDir: "/tmp",
        worktreePath: "/tmp",
        worktreeName: "main",
        projectName: "test",
      });
      managed.awaitingInput = true;
      managed.monitor.getSessionId = vi.fn(() => "session-1");

      await expect(svc.executeSuggestion(managed, {
        text: "continue",
        confidence: 90,
        reasoning: "clear next step",
        browserActions: [
          { type: "screenshot", params: {}, description: "capture" },
          { type: "navigate", params: { url: "https://example.com" }, description: "open" },
          { type: "snapshot", params: {}, description: "snapshot" },
          { type: "interact", params: { action: "click", ref: "button-1", value: "go" }, description: "click" },
        ],
        orchestratorActions: [
          { type: "plan", workerId: "worker-1", text: "plan next step" },
          { type: "review", workerId: "worker-1", text: "review diff" },
          { type: "input", workerId: "worker-1", text: "resume work" },
        ],
      })).resolves.toBeUndefined();

      expect(managed.monitor.sendFollowUp).toHaveBeenCalledWith("continue");
    });
  });

  describe("lane persistence", () => {
    it("uses a distinct responder provider when the project runtime locks Roscoe to another provider", () => {
      vi.mocked(loadProfile).mockImplementation((name: string) => {
        if (name === "claude-code") {
          return { name, command: "claude", args: [], protocol: "claude" } as any;
        }
        return { name: "codex", command: "codex", args: [], protocol: "codex" } as any;
      });
      vi.mocked(loadProjectContext).mockReturnValue({
        name: "proj",
        directory: "/tmp/proj",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {
          responderProvider: "codex",
          workerByProtocol: {
            claude: {
              tuningMode: "manual",
              model: "claude-opus-4-6",
              reasoningEffort: "max",
            },
          },
          responderByProtocol: {
            codex: {
              tuningMode: "manual",
              model: "gpt-5.4",
              reasoningEffort: "high",
            },
          },
        },
      } as any);

      const { managed } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(managed.profile.protocol).toBe("claude");
      expect(managed.responderProfile.protocol).toBe("codex");
      expect(managed.lastWorkerRuntimeStrategy).toBe("manual-pinned");
      expect(managed.lastResponderStrategy).toBe("manual-pinned");
    });

    it("restores tracker history and provider session id from saved lane state", () => {
      vi.mocked(loadLaneSession).mockReturnValue({
        laneKey: "lane",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "claude-code",
        protocol: "claude",
        providerSessionId: "sess-123",
        trackerHistory: [{ role: "assistant", content: "Previous reply", timestamp: 1 }],
        timeline: [],
        outputLines: ["Previous reply"],
        summary: "Old summary",
        currentToolUse: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      } as any);

      const { managed, restoredState } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(managed.tracker.getHistory()[0]?.content).toBe("Previous reply");
      expect(managed.monitor.getSessionId()).toBe("sess-123");
      expect(restoredState?.summary).toBe("Old summary");
    });

    it("does not restore a responder session id when the saved responder protocol no longer matches", () => {
      vi.mocked(loadProfile).mockReturnValue({
        name: "codex",
        command: "codex",
        args: [],
        protocol: "codex",
      } as any);
      vi.mocked(loadLaneSession).mockReturnValue({
        laneKey: "lane",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "codex",
        protocol: "codex",
        providerSessionId: "sess-123",
        responderProtocol: "claude",
        responderSessionId: "responder-123",
        trackerHistory: [],
        outputLines: [],
        timeline: [],
        summary: "Old summary",
        currentToolUse: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      } as any);

      const { managed } = svc.startSession({
        profileName: "codex",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(managed.monitor.getSessionId()).toBe("sess-123");
      expect(managed.responderMonitor.getSessionId()).toBeNull();
    });

    it("recovers a lost queued preview as ready when the saved lane already reached a paused handoff", () => {
      vi.mocked(loadLaneSession).mockReturnValue({
        laneKey: "lane",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "claude-code",
        protocol: "claude",
        providerSessionId: "sess-123",
        trackerHistory: [{ role: "assistant", content: "Previous reply", timestamp: 1 }],
        timeline: [
          {
            id: "preview-1",
            kind: "preview",
            timestamp: 9,
            state: "queued",
            text: "Preview queued. Roscoe will stop this lane at the next clean handoff and hold there until you continue.",
            link: null,
          },
          {
            id: "remote-1",
            kind: "remote-turn",
            timestamp: 10,
            provider: "claude-code",
            text: "Paused.",
          },
        ],
        preview: {
          mode: "off",
          message: null,
          link: null,
        },
        outputLines: ["Paused."],
        summary: "Waiting on the next follow-up.",
        currentToolUse: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      } as any);

      const { restoredState } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(restoredState?.preview).toMatchObject({
        mode: "ready",
      });
    });

    it("builds a continuation plan for a restored in-flight Guild lane instead of preserving stale tool state", () => {
      vi.mocked(loadLaneSession).mockReturnValue({
        laneKey: "lane",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "claude-code",
        protocol: "claude",
        providerSessionId: "sess-123",
        trackerHistory: [{ role: "assistant", content: "Previous reply", timestamp: 1 }],
        timeline: [
          {
            id: "remote-1",
            kind: "remote-turn",
            timestamp: 10,
            provider: "claude-code",
            text: "I fixed the thread panel and I am running the targeted proof now.",
          },
          {
            id: "local-1",
            kind: "local-sent",
            timestamp: 11,
            text: "Keep the scope narrow and rerun only the targeted proof.",
            delivery: "auto",
          },
        ],
        outputLines: ["running targeted proof"],
        summary: "Old summary",
        currentToolUse: "command_execution",
        savedAt: "2026-03-26T00:00:00.000Z",
      } as any);

      const { managed, restoredState } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(managed.awaitingInput).toBe(false);
      expect(managed.restoreRecovery).toMatchObject({
        mode: "resume-worker",
      });
      expect(restoredState?.currentToolUse).toBeNull();
      expect(restoredState?.currentToolDetail).toBeNull();
    });

    it("still restages an interrupted Guild turn after relaunch even when no tool event was persisted yet", () => {
      vi.mocked(loadLaneSession).mockReturnValue({
        laneKey: "lane",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "claude-code",
        protocol: "claude",
        providerSessionId: "sess-999",
        trackerHistory: [
          { role: "assistant", content: "Previous reply", timestamp: 1 },
          { role: "user", content: "Keep the scope narrow and rerun only the targeted proof.", timestamp: 2 },
        ],
        timeline: [
          {
            id: "remote-1",
            kind: "remote-turn",
            timestamp: 10,
            provider: "claude-code",
            text: "I fixed the thread panel and I am running the targeted proof now.",
          },
          {
            id: "local-1",
            kind: "local-sent",
            timestamp: 11,
            text: "Keep the scope narrow and rerun only the targeted proof.",
            delivery: "auto",
          },
        ],
        outputLines: ["running targeted proof"],
        summary: "Old summary",
        currentToolUse: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      } as any);

      const { managed, restoredState } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(managed.restoreRecovery).toMatchObject({
        mode: "resume-worker",
      });
      expect(restoredState?.currentToolUse).toBeNull();
    });

    it("auto-heals exited saved lanes by reopening them from history instead of restoring dead native sessions", () => {
      vi.mocked(loadLaneSession).mockReturnValue({
        laneKey: "lane",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "claude-code",
        protocol: "claude",
        providerSessionId: "dead-worker-session",
        responderProtocol: "claude",
        responderSessionId: "dead-responder-session",
        trackerHistory: [
          { role: "assistant", content: "Previous reply", timestamp: 1 },
          { role: "user", content: "Keep moving from the last stable handoff.", timestamp: 2 },
        ],
        responderHistoryCursor: 4,
        timeline: [
          {
            id: "remote-1",
            kind: "remote-turn",
            timestamp: 10,
            provider: "claude-code",
            text: "I narrowed the blocker to the local dev server boot path.",
          },
          {
            id: "local-1",
            kind: "local-sent",
            timestamp: 11,
            text: "Resume from the last stable state and verify the local boot path.",
            delivery: "auto",
          },
        ],
        outputLines: ["worker exited"],
        summary: "Exited lane summary",
        currentToolUse: "command_execution",
        status: "exited",
        startedAt: "2026-03-26T00:00:00.000Z",
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        rateLimitStatus: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      } as any);

      const { managed, restoredState } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(managed.awaitingInput).toBe(true);
      expect(managed.restoreRecovery).toMatchObject({
        mode: "restage-roscoe",
      });
      expect((managed.monitor as unknown as MockSessionMonitor).getSessionId()).toBeNull();
      expect((managed.responderMonitor as unknown as MockSessionMonitor).getSessionId()).toBeNull();
      expect(restoredState?.providerSessionId).toBeNull();
      expect(restoredState?.responderSessionId).toBeNull();
      expect(restoredState?.status).toBe("waiting");
      expect(restoredState?.currentToolUse).toBeNull();
      expect(restoredState?.currentToolDetail).toBeNull();
    });

    it("restores a stale waiting lane as parked when the summary and parked tail both say it is parked", () => {
      vi.mocked(loadLaneSession).mockReturnValue({
        laneKey: "lane",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "codex",
        protocol: "codex",
        providerSessionId: null,
        responderProtocol: "claude",
        responderSessionId: null,
        trackerHistory: [],
        responderHistoryCursor: 0,
        timeline: [
          {
            id: "local-1",
            kind: "local-sent",
            timestamp: 1,
            text: "Nothing to direct. Lane parked.",
            delivery: "auto",
          },
          {
            id: "remote-1",
            kind: "remote-turn",
            timestamp: 2,
            provider: "codex",
            text: "Acknowledged. Waiting for the next lane delta.",
          },
          {
            id: "tool-1",
            kind: "tool-activity",
            timestamp: 3,
            provider: "roscoe",
            toolName: "contract",
            text: "Saved project contract changed. Roscoe cleared stale parked/review guidance so this lane can be reassessed under the updated brief.",
          },
        ],
        outputLines: [],
        summary: "Parked.",
        currentToolUse: null,
        status: "waiting",
        startedAt: "2026-03-26T00:00:00.000Z",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        rateLimitStatus: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      } as any);

      const { restoredState } = svc.startSession({
        profileName: "codex",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(restoredState?.status).toBe("parked");
    });

    it("reopens a parked lane when milestone parking is off and the saved contract still points to future web deployment work", () => {
      vi.mocked(loadProjectContext).mockReturnValue({
        name: "proj",
        directory: "/tmp/proj",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        intentBrief: {
          projectStory: "Ship the app",
          primaryUsers: [],
          definitionOfDone: [],
          acceptanceChecks: [],
          successSignals: [],
          deliveryPillars: {
            frontend: [],
            backend: [],
            unitComponentTests: [],
            e2eTests: [],
          },
          coverageMechanism: [],
          deploymentContract: {
            mode: "defer",
            summary: "Wire live deployment later through explicit conversation.",
            artifactType: "web app",
            platforms: ["Fly.io"],
            environments: ["local", "preview", "production"],
            buildSteps: [],
            deploySteps: [],
            previewStrategy: [],
            presenceStrategy: [],
            proofTargets: [],
            healthChecks: [],
            rollback: [],
            requiredSecrets: [],
          },
          nonGoals: [],
          constraints: [],
          architecturePrinciples: [],
          autonomyRules: [],
          qualityBar: [],
          riskBoundaries: [],
          uiDirection: "",
        },
      } as any);
      vi.mocked(loadLaneSession).mockReturnValue({
        laneKey: "lane",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "codex",
        protocol: "codex",
        providerSessionId: null,
        responderProtocol: "claude",
        responderSessionId: null,
        trackerHistory: [],
        responderHistoryCursor: 0,
        timeline: [
          {
            id: "local-1",
            kind: "local-sent",
            timestamp: 1,
            text: "Parked. Open the deployment thread in the next lane.",
            delivery: "auto",
          },
          {
            id: "remote-1",
            kind: "remote-turn",
            timestamp: 2,
            provider: "codex",
            text: "Acknowledged. Waiting for the next lane delta.",
          },
        ],
        outputLines: [],
        summary: "Parked.",
        currentToolUse: null,
        status: "parked",
        startedAt: "2026-03-26T00:00:00.000Z",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        rateLimitStatus: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      } as any);

      const { managed, restoredState } = svc.startSession({
        profileName: "codex",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(restoredState?.status).toBe("waiting");
      expect(managed.restoreRecovery).toMatchObject({
        mode: "restage-roscoe",
      });
    });

    it("reopens a stale parked lane when a newer Guild turn clearly resumed substantive work", () => {
      vi.mocked(loadLaneSession).mockReturnValue({
        laneKey: "lane",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "codex",
        protocol: "codex",
        providerSessionId: "provider-session",
        responderProtocol: "claude",
        responderSessionId: "responder-session",
        trackerHistory: [],
        responderHistoryCursor: 0,
        timeline: [
          {
            id: "local-1",
            kind: "local-sent",
            timestamp: 1,
            text: "Parked.",
            delivery: "auto",
          },
          {
            id: "remote-1",
            kind: "remote-turn",
            timestamp: 2,
            provider: "codex",
            text: "I’m tightening the Fly adapter around the one missing readiness guarantee and then I’ll report back.",
          },
        ],
        outputLines: [],
        summary: "Parked.",
        currentToolUse: null,
        status: "parked",
        startedAt: "2026-03-26T00:00:00.000Z",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        rateLimitStatus: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      } as any);

      const { restoredState } = svc.startSession({
        profileName: "codex",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect(restoredState?.status).toBe("waiting");
    });

    it("can leave exited lane metadata untouched when Roscoe auto-heal is disabled", () => {
      vi.mocked(loadRoscoeSettings).mockReturnValue({
        notifications: { enabled: false, phoneNumber: "", provider: "twilio" },
        providers: {
          claude: { enabled: true, brief: false, ide: false, chrome: false },
          codex: { enabled: true, webSearch: false },
          gemini: { enabled: false },
        },
        behavior: { autoHealMetadata: false },
      } as any);
      vi.mocked(loadLaneSession).mockReturnValue({
        laneKey: "lane",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "claude-code",
        protocol: "claude",
        providerSessionId: "dead-worker-session",
        responderProtocol: "claude",
        responderSessionId: "dead-responder-session",
        trackerHistory: [],
        responderHistoryCursor: 0,
        timeline: [],
        outputLines: [],
        summary: null,
        currentToolUse: null,
        status: "exited",
        startedAt: "2026-03-26T00:00:00.000Z",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        rateLimitStatus: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      } as any);

      const { managed, restoredState } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });

      expect((managed.monitor as unknown as MockSessionMonitor).getSessionId()).toBe("dead-worker-session");
      expect((managed.responderMonitor as unknown as MockSessionMonitor).getSessionId()).toBe("dead-responder-session");
      expect(restoredState?.providerSessionId).toBe("dead-worker-session");
      expect(restoredState?.status).toBe("exited");
    });

    it("persists session snapshots for relaunch continuity", () => {
      const { managed } = svc.startSession({
        profileName: "claude-code",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        projectName: "proj",
      });
      managed.tracker.recordUserInput("Continue from here");
      managed.monitor.getSessionId = vi.fn(() => "sess-456");

      svc.persistSessionState({
        id: managed.id,
        profileName: managed.profileName,
        projectName: managed.projectName,
        worktreeName: managed.worktreeName,
        startedAt: "2026-03-26T00:00:00.000Z",
        status: "waiting",
        outputLines: ["line"],
        suggestion: { kind: "idle" },
        managed,
        summary: "Summary",
        currentToolUse: "Read",
        usage: {
          inputTokens: 12,
          outputTokens: 3,
          cachedInputTokens: 1,
          cacheCreationInputTokens: 0,
        },
        rateLimitStatus: null,
        timeline: [],
        viewMode: "transcript",
        scrollOffset: 0,
        followLive: true,
      });

      expect(saveLaneSession).toHaveBeenCalledWith(expect.objectContaining({
        providerSessionId: "sess-456",
        summary: "Summary",
        currentToolUse: "Read",
      }));
    });
  });
});
