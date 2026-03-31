import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";

// Create a class that properly extends EventEmitter for the mock
class MockSessionMonitor extends EventEmitter {
  startTurn = vi.fn();
  sendFollowUp = vi.fn();
  setProfile = vi.fn();
  restoreSessionId = vi.fn();
  getSessionId = vi.fn(() => "sess-1");
  kill = vi.fn();
  id: string;
  constructor(id: string) {
    super();
    this.id = id;
  }
}

let mockMonitorInstance: MockSessionMonitor;

vi.mock("./session-monitor.js", () => ({
  SessionMonitor: vi.fn().mockImplementation(function(id: string) {
    mockMonitorInstance = new MockSessionMonitor(id);
    return mockMonitorInstance;
  }),
}));

vi.mock("./config.js", () => ({
  loadProjectContext: vi.fn(() => null),
  listProjectHistory: vi.fn(() => []),
  registerProject: vi.fn(),
  saveProjectHistory: vi.fn(),
  saveProjectContext: vi.fn(),
  getProjectMemoryDir: vi.fn((directory: string) => `${directory}/.roscoe`),
  resolveProjectRoot: vi.fn((directory: string) => directory),
  normalizeProjectContext: vi.fn((value: any) => ({
    name: value.name ?? "project",
    directory: value.directory ?? "/tmp",
    goals: value.goals ?? [],
    milestones: value.milestones ?? [],
    techStack: value.techStack ?? [],
    notes: value.notes ?? "",
    intentBrief: {
      projectStory: value.notes || "Deliver the project goals without drifting scope.",
      primaryUsers: [],
      definitionOfDone: value.goals ?? [],
      acceptanceChecks: [],
      successSignals: value.milestones ?? [],
      deliveryPillars: {
        frontend: [],
        backend: [],
        unitComponentTests: [],
        e2eTests: [],
      },
      coverageMechanism: [],
      deploymentContract: {
        mode: "defer",
        summary: "Deployment is not locked yet. Roscoe should define or infer the deploy path later before mutating environments.",
        artifactType: "",
        platforms: [],
        environments: [],
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
      architecturePrinciples: [
        "Favor shared components and shared domain modules over duplicated feature-specific implementations.",
        "Keep material writes, external integrations, and background or queued work behind explicit service seams with consistent audit logging.",
      ],
      autonomyRules: [],
      qualityBar: [],
      riskBoundaries: [],
      uiDirection: "",
      ...(value.intentBrief ?? {}),
    },
    interviewAnswers: value.interviewAnswers ?? [],
    ...(value.runtimeDefaults ? { runtimeDefaults: value.runtimeDefaults } : {}),
  })),
}));

vi.mock("./debug-log.js", () => ({
  dbg: vi.fn(),
  enableDebug: vi.fn(),
}));

vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
}));

import { Onboarder } from "./onboarder.js";
import { SessionMonitor } from "./session-monitor.js";

function seedInterviewCoverage(onboarder: Onboarder) {
  onboarder.sendInput("Ship a clean operator workflow", {
    question: "What is the product vision Roscoe should optimize for?",
    theme: "project-story",
  });
  onboarder.sendInput("Operations teams", {
    question: "Who are the primary users Roscoe should optimize for?",
    theme: "primary-users",
  });
  onboarder.sendInput("The main flow works", {
    question: "What is the definition of done Roscoe should defend?",
    theme: "definition-of-done",
  });
  onboarder.sendInput("The demo path works", {
    question: "What proof should Roscoe require before calling this done?",
    theme: "acceptance-checks",
  });
  onboarder.sendInput("Frontend and backend outcomes must be proven by unit/component and e2e coverage", {
    question: "How should Roscoe define the delivery pillars across frontend, backend, unit/component tests, and e2e tests?",
    theme: "delivery-pillars",
  });
  onboarder.sendInput("Avoid scope creep", {
    question: "What are the non goals Roscoe should hold the line on?",
    theme: "non-goals",
  });
  onboarder.sendInput("Ask before changing scope", {
    question: "What autonomy rules should Roscoe follow when Guild sessions hit ambiguity?",
    theme: "autonomy-rules",
  });
  onboarder.sendInput("Require tests and a demo path", {
    question: "What quality bar should Roscoe enforce before Guild work is considered done?",
    theme: "quality-bar",
  });
  onboarder.sendInput("Use Vitest and Playwright runs as the canonical validation path, with previews or demos when that answers the next decision faster", {
    question: "How should Roscoe validate progress in this repo?",
    theme: "coverage-mechanism",
  });
  onboarder.sendInput("Avoid regressions", {
    question: "What risks Roscoe should avoid without explicit approval?",
    theme: "risk-boundaries",
  });
}

function buildReadyBrief(overrides: Record<string, any> = {}) {
  const overrideIntent = overrides.intentBrief ?? {};
  return {
    name: "TestProject",
    directory: "/tmp",
    goals: ["goal1"],
    milestones: ["m1"],
    techStack: ["TypeScript"],
    notes: "",
    ...overrides,
    intentBrief: {
      projectStory: "Ship safely",
      primaryUsers: ["operators"],
      definitionOfDone: ["The frontend and backend operator workflow behave correctly"],
      acceptanceChecks: ["Vitest unit/component and Playwright e2e runs prove the full workflow end to end"],
      successSignals: ["operators can finish the task"],
      entrySurfaceContract: {
        summary: "The root route should show the real operator entry point.",
        defaultRoute: "/",
        expectedExperience: "Operators land on a truthful entry surface instead of a scaffold placeholder.",
        allowedShellStates: ["Auth gate is acceptable only if it clearly explains the prerequisite."],
      },
      localRunContract: {
        summary: "Local dev boot should explain prerequisites and let operators reach the intended entry path.",
        startCommand: "pnpm dev",
        firstRoute: "http://localhost:3000",
        prerequisites: ["database running"],
        seedRequirements: ["seed demo tenant"],
        expectedBlockedStates: ["sign in required"],
        operatorSteps: ["Run pnpm dev", "Open the root route and confirm the truthful entry surface"],
      },
      acceptanceLedger: [
        {
          label: "Local operator happy path works",
          status: "open",
          evidence: ["Vitest and Playwright prove the main flow", "Preview or demo confirms the entry path"],
          notes: "Still needs proof.",
        },
      ],
      deliveryPillars: {
        frontend: ["Frontend operator flow is complete and stable"],
        backend: ["Backend workflow API is correct and stable"],
        unitComponentTests: ["Vitest unit/component tests cover changed frontend/backend logic, regressions, and edge cases at a reasonable level for the current slice"],
        e2eTests: ["Playwright e2e tests cover workflow success and failure modes at the right stage of hardening"],
      },
      coverageMechanism: ["Vitest plus Playwright runs provide the canonical validation path for this repo"],
      deploymentContract: {
        mode: "defer",
        summary: "Deployment is intentionally deferred until the local path is proven.",
        artifactType: "web app",
        platforms: [],
        environments: [],
        buildSteps: ["pnpm build"],
        deploySteps: [],
        previewStrategy: ["Use local preview until deployment is explicitly chosen."],
        presenceStrategy: ["Defer hosted proof until the operator explicitly chooses the first non-local environment."],
        proofTargets: ["The first preview or staging URL will be chosen later in conversation."],
        healthChecks: ["Local happy path works"],
        rollback: ["No deploy target chosen yet."],
        requiredSecrets: [],
      },
      nonGoals: ["avoid scope creep"],
      constraints: ["maintain compatibility"],
      architecturePrinciples: ["Preserve shared workflow modules and keep audit logging consistent across material writes"],
      autonomyRules: ["ask before changing scope"],
      qualityBar: ["Do not call done until Vitest and Playwright provide reasonable, risk-based proof on the frontend and backend outcomes"],
      riskBoundaries: ["avoid regressions"],
      uiDirection: "",
      ...overrideIntent,
    },
  };
}

describe("Onboarder", () => {
  let onboarder: Onboarder;

  beforeEach(() => {
    // Re-apply mockImplementation since mockReset clears it
    vi.mocked(SessionMonitor).mockImplementation(function(id: string) {
      mockMonitorInstance = new MockSessionMonitor(id);
      return mockMonitorInstance as any;
    });
    vi.mocked(existsSync).mockImplementation(() => false);
    vi.mocked(readFileSync).mockReturnValue("");
    onboarder = new Onboarder("/tmp/test-project");
  });

  describe("start", () => {
    it("creates a SessionMonitor and starts a turn", () => {
      onboarder.start();
      expect(mockMonitorInstance.startTurn).toHaveBeenCalledWith(expect.stringContaining("Roscoe's onboarding strategist"));
      expect(mockMonitorInstance.startTurn).toHaveBeenCalledWith(expect.stringContaining("architecture principles"));
      expect(mockMonitorInstance.startTurn).toHaveBeenCalledWith(expect.stringContaining("Deployment is a first-class project contract"));
      expect(mockMonitorInstance.startTurn).toHaveBeenCalledWith(expect.stringContaining("hosted proof surface"));
    });

    it("treats an empty workspace as a greenfield vision-first intake", () => {
      onboarder.start();
      expect(mockMonitorInstance.startTurn).toHaveBeenCalledWith(
        expect.stringContaining("vision-first build from an empty or scaffold-only workspace"),
      );
    });

    it("returns the session via getSession", () => {
      onboarder.start();
      expect(onboarder.getSession()).toBeTruthy();
    });

    it("resumes from a saved onboarding checkpoint when available", () => {
      vi.mocked(existsSync).mockImplementation((path) => String(path).includes("onboarding-checkpoint.json"));
      vi.mocked(readFileSync).mockReturnValueOnce(
        JSON.stringify({
          version: 1,
          mode: "onboard",
          protocol: "claude",
          profileName: "orchestrator",
          projectDir: "/tmp/test-project",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          sessionId: "ckpt-session-1",
          workspaceMode: "existing",
          questionHistory: [{
            question: "What is the project story?",
            options: ["A", "B"],
            theme: "project-story",
          }],
          interviewAnswers: [{
            question: "What is the project story?",
            answer: "A focused operator workflow.",
            theme: "project-story",
          }],
          sessionInterviewAnswers: [{
            question: "What is the project story?",
            answer: "A focused operator workflow.",
            theme: "project-story",
          }],
          rawTranscript: "A checkpoint transcript",
          outputBuffer: "Interrupted output",
          completed: false,
        }),
      );

      onboarder.start();

      expect(mockMonitorInstance.restoreSessionId).toHaveBeenCalledWith("ckpt-session-1");
      expect(mockMonitorInstance.startTurn).toHaveBeenCalledWith(
        expect.stringContaining("previous onboarding turn was interrupted"),
      );
      expect(mockMonitorInstance.startTurn).not.toHaveBeenCalledWith(
        expect.stringContaining("vision-first build from an empty or scaffold-only workspace"),
      );
    });

    it("persists checkpoint state on answer submit", () => {
      onboarder.start();
      vi.mocked(writeFileSync).mockClear();
      onboarder.sendInput("Option A", { question: "Priority?", theme: "definition-of-done" });
      expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
    });
  });

  describe("event forwarding", () => {
    it("forwards text events as output", () => {
      return new Promise<void>((resolve) => {
        onboarder.start();
        onboarder.on("output", (chunk: string) => {
          expect(chunk).toBe("hello");
          resolve();
        });
        mockMonitorInstance.emit("text", "hello");
      });
    });

    it("forwards thinking events", () => {
      return new Promise<void>((resolve) => {
        onboarder.start();
        onboarder.on("thinking", (chunk: string) => {
          expect(chunk).toBe("hmm");
          resolve();
        });
        mockMonitorInstance.emit("thinking", "hmm");
      });
    });

    it("forwards tool-activity events", () => {
      return new Promise<void>((resolve) => {
        onboarder.start();
        onboarder.on("tool-activity", (tool: string) => {
          expect(tool).toBe("Read");
          resolve();
        });
        mockMonitorInstance.emit("tool-activity", "Read");
      });
    });

    it("emits turn-complete when no brief found", () => {
      return new Promise<void>((resolve) => {
        onboarder.start();
        onboarder.on("turn-complete", () => {
          resolve();
        });
        mockMonitorInstance.emit("text", "Here's my analysis...");
        mockMonitorInstance.emit("turn-complete");
      });
    });
  });

  describe("sendInput", () => {
    it("calls sendFollowUp with formatted prompt", () => {
      onboarder.start();
      onboarder.sendInput("Option A", { question: "Priority?", theme: "definition-of-done" });
      expect(mockMonitorInstance.sendFollowUp).toHaveBeenCalledWith(
        expect.stringContaining("Priority?"),
      );
      expect(mockMonitorInstance.sendFollowUp).toHaveBeenCalledWith(
        expect.stringContaining("Option A"),
      );
    });

    it("stores provided secrets without echoing raw values back into the transcript prompt", () => {
      onboarder.start();
      onboarder.sendSecretInput({
        key: "CF_API_TOKEN",
        label: "Cloudflare token",
        purpose: "Needed for previews",
        instructions: ["Open dashboard"],
        links: [{ label: "Docs", url: "https://example.com" }],
        required: true,
        targetFile: ".env.local",
      }, "provided", "super-secret-value");

      expect(mockMonitorInstance.setProfile).toHaveBeenCalled();
      expect(mockMonitorInstance.sendFollowUp).toHaveBeenCalledWith(
        expect.stringContaining("The user securely provided CF_API_TOKEN."),
      );
      expect(mockMonitorInstance.sendFollowUp).not.toHaveBeenCalledWith(
        expect.stringContaining("super-secret-value"),
      );
      expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
    });
  });

  describe("checkForProjectBrief", () => {
    it("emits onboarding-complete when ---BRIEF--- block found", () => {
      return new Promise<void>((resolve) => {
        onboarder.start();
        seedInterviewCoverage(onboarder);
        onboarder.on("onboarding-complete", (brief: any) => {
          expect(brief.name).toBe("TestProject");
          expect(brief.intentBrief).toBeTruthy();
          resolve();
        });
        const briefJson = JSON.stringify(buildReadyBrief());
        mockMonitorInstance.emit("text", `Analysis complete.\n---BRIEF---\n${briefJson}\n---END_BRIEF---`);
        mockMonitorInstance.emit("turn-complete");
      });
    });

    it("keeps interviewing for a greenfield UI brief that never defines the local first-run path", () => {
      onboarder.start();
      seedInterviewCoverage(onboarder);

      const briefJson = JSON.stringify(buildReadyBrief({
        techStack: ["React", "TypeScript"],
        notes: "Greenfield web app.",
        intentBrief: {
          uiDirection: "Clean web app",
          localRunContract: {
            summary: "",
            startCommand: "",
            firstRoute: "",
            prerequisites: [],
            seedRequirements: [],
            expectedBlockedStates: [],
            operatorSteps: [],
          },
        },
      }));

      mockMonitorInstance.emit("text", `Analysis complete.\n---BRIEF---\n${briefJson}\n---END_BRIEF---`);
      mockMonitorInstance.emit("turn-complete");

      expect(mockMonitorInstance.sendFollowUp).toHaveBeenLastCalledWith(
        expect.stringContaining("local first-run contract and prerequisite handling for the greenfield UI"),
      );
    });

    it("persists the brief on clean exit even if turn-complete never arrived", () => {
      return new Promise<void>((resolve) => {
        onboarder.start();
        seedInterviewCoverage(onboarder);
        onboarder.on("onboarding-complete", (brief: any) => {
          expect(brief.name).toBe("TestProject");
          resolve();
        });
        const briefJson = JSON.stringify(buildReadyBrief());
        mockMonitorInstance.emit("text", `Analysis complete.\n---BRIEF---\n${briefJson}\n---END_BRIEF---`);
        mockMonitorInstance.emit("exit", 0);
      });
    });

    it("persists runtime defaults into the saved brief", () => {
      return new Promise<void>((resolve) => {
        onboarder = new Onboarder("/tmp/test-project", false, undefined, {
          workerByProtocol: {
            claude: {
              model: "claude-opus-4-6",
              reasoningEffort: "high",
            },
          },
        });
        onboarder.start();
        seedInterviewCoverage(onboarder);
        onboarder.on("onboarding-complete", (brief: any) => {
          expect(brief.runtimeDefaults).toMatchObject({
            workerByProtocol: {
              claude: {
                model: "claude-opus-4-6",
              },
            },
          });
          expect(brief.interviewAnswers).toHaveLength(10);
          expect(brief.interviewAnswers[0]).toMatchObject({
            theme: "project-story",
          });
          resolve();
        });
        const briefJson = JSON.stringify(buildReadyBrief());
        mockMonitorInstance.emit("text", `Analysis complete.\n---BRIEF---\n${briefJson}\n---END_BRIEF---`);
        mockMonitorInstance.emit("turn-complete");
      });
    });

    it("persists captured interview answers into the saved brief", () => {
      return new Promise<void>((resolve) => {
        onboarder.start();
        seedInterviewCoverage(onboarder);
        onboarder.sendInput("Move fast", { question: "How aggressive should Roscoe be?", theme: "autonomy-rules" });
        onboarder.on("onboarding-complete", (brief: any) => {
          expect(brief.interviewAnswers).toContainEqual({
            question: "How aggressive should Roscoe be?",
            answer: "Move fast",
            theme: "autonomy-rules",
          });
          resolve();
        });
        const briefJson = JSON.stringify(buildReadyBrief());
        mockMonitorInstance.emit("text", `Analysis complete.\n---BRIEF---\n${briefJson}\n---END_BRIEF---`);
        mockMonitorInstance.emit("turn-complete");
      });
    });

    it("does not emit onboarding-complete for malformed brief JSON", () => {
      return new Promise<void>((resolve) => {
        onboarder.start();
        let completed = false;
        onboarder.on("onboarding-complete", () => {
          completed = true;
        });
        onboarder.on("turn-complete", () => {
          expect(completed).toBe(false);
          resolve();
        });
        mockMonitorInstance.emit("text", "---BRIEF---\nnot valid json\n---END_BRIEF---");
        mockMonitorInstance.emit("turn-complete");
      });
    });
  });

  describe("getProjectDir", () => {
    it("returns the project directory", () => {
      expect(onboarder.getProjectDir()).toBe("/tmp/test-project");
    });
  });
});
