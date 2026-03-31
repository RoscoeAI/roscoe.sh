import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

class MockSessionMonitor extends EventEmitter {
  startTurn = vi.fn();
  sendFollowUp = vi.fn();
  setProfile = vi.fn();
  getSessionId = vi.fn(() => "sess-coverage");
  kill = vi.fn();
  id: string;

  constructor(id: string) {
    super();
    this.id = id;
  }
}

let mockMonitorInstance: MockSessionMonitor | undefined;

const workspaceAssessmentState = {
  mode: "existing" as "existing" | "greenfield",
  summary: "Existing repo with established structure.",
};

const deploymentAssessmentState = {
  summary: "Preserve the current deploy flow.",
};

vi.mock("./session-monitor.js", () => ({
  SessionMonitor: vi.fn().mockImplementation(function(id: string) {
    mockMonitorInstance = new MockSessionMonitor(id);
    return mockMonitorInstance;
  }),
}));

vi.mock("./workspace-intake.js", () => ({
  inspectWorkspaceForOnboarding: vi.fn(() => ({ ...workspaceAssessmentState })),
}));

vi.mock("./deployment-contract.js", () => ({
  inferDeploymentAssessment: vi.fn(() => ({ ...deploymentAssessmentState })),
}));

vi.mock("./project-secrets.js", () => ({
  applyProjectEnvToProfile: vi.fn((profile: any) => profile),
  saveProjectSecretRecord: vi.fn(),
  writeProjectSecretValue: vi.fn(),
}));

vi.mock("./config.js", () => ({
  loadProjectContext: vi.fn(() => null),
  listProjectHistory: vi.fn(() => []),
  registerProject: vi.fn(),
  saveProjectHistory: vi.fn(),
  saveProjectContext: vi.fn(),
  normalizeProjectContext: vi.fn((value: any) => ({
    name: value.name ?? "project",
    directory: value.directory ?? "/tmp",
    goals: value.goals ?? [],
    milestones: value.milestones ?? [],
    techStack: value.techStack ?? [],
    notes: value.notes ?? "",
    intentBrief: {
      projectStory: "Ship safely",
      primaryUsers: ["operators"],
      definitionOfDone: ["Default definition of done"],
      acceptanceChecks: ["Default acceptance checks"],
      successSignals: ["Default success signal"],
      entrySurfaceContract: {
        summary: "Default entry surface",
        defaultRoute: "/",
        expectedExperience: "A truthful first screen",
        allowedShellStates: [],
      },
      localRunContract: {
        summary: "Default local run",
        startCommand: "pnpm dev",
        firstRoute: "http://localhost:3000",
        prerequisites: ["database"],
        seedRequirements: [],
        expectedBlockedStates: [],
        operatorSteps: ["Run pnpm dev"],
      },
      acceptanceLedger: [
        {
          label: "Default ledger",
          status: "open",
          evidence: ["demo works"],
          notes: "still open",
        },
      ],
      deliveryPillars: {
        frontend: ["Frontend outcome"],
        backend: ["Backend outcome"],
        unitComponentTests: ["Unit/component proof"],
        e2eTests: ["E2E proof"],
      },
      coverageMechanism: ["Vitest and Playwright"],
      deploymentContract: {
        mode: "defer",
        summary: "Deferred deploy",
        artifactType: "web app",
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
      nonGoals: ["avoid scope creep"],
      constraints: ["maintain compatibility"],
      architecturePrinciples: ["Keep shared modules shared"],
      autonomyRules: ["ask before changing scope"],
      qualityBar: ["Tests should prove the important paths"],
      riskBoundaries: ["avoid regressions"],
      uiDirection: "Calm, legible UI",
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

import { Onboarder } from "./onboarder.js";
import { enableDebug } from "./debug-log.js";
import {
  listProjectHistory,
  loadProjectContext,
  registerProject,
  saveProjectContext,
  saveProjectHistory,
} from "./config.js";
import { inspectWorkspaceForOnboarding } from "./workspace-intake.js";
import { inferDeploymentAssessment } from "./deployment-contract.js";
import {
  applyProjectEnvToProfile,
  saveProjectSecretRecord,
  writeProjectSecretValue,
} from "./project-secrets.js";
import { SessionMonitor } from "./session-monitor.js";

function makeReadyBrief(overrides: Record<string, any> = {}) {
  const overrideIntent = overrides.intentBrief ?? {};
  return {
    name: "CoverageProject",
    directory: "/tmp/coverage-project",
    goals: ["Deliver the web flow"],
    milestones: ["m1"],
    techStack: ["React", "TypeScript"],
    notes: "Operator-facing web app.",
    ...overrides,
    intentBrief: {
      projectStory: "Ship a truthful operator web app.",
      primaryUsers: ["operators"],
      definitionOfDone: ["The main operator flow is complete."],
      acceptanceChecks: ["Vitest and Playwright prove the workflow."],
      successSignals: ["operators can finish the task"],
      entrySurfaceContract: {
        summary: "The root route is truthful.",
        defaultRoute: "/",
        expectedExperience: "Operators land on the real entry surface.",
        allowedShellStates: [],
      },
      localRunContract: {
        summary: "Local boot is honest.",
        startCommand: "pnpm dev",
        firstRoute: "http://localhost:3000",
        prerequisites: ["database"],
        seedRequirements: ["seed tenant"],
        expectedBlockedStates: ["auth gate"],
        operatorSteps: ["Run pnpm dev", "Open the app"],
      },
      acceptanceLedger: [
        {
          label: "Operator happy path works",
          status: "open",
          evidence: ["Vitest and Playwright prove the path"],
          notes: "Still needs proof.",
        },
      ],
      deliveryPillars: {
        frontend: ["Frontend operator path is complete"],
        backend: ["Backend APIs correctly support that path"],
        unitComponentTests: ["Vitest unit/component tests cover changed logic, regressions, and failure modes at a reasonable level"],
        e2eTests: ["Playwright end-to-end tests prove the operator flow and failure handling"],
      },
      coverageMechanism: ["Vitest, Playwright, and manual preview checks provide the repo-grounded validation path"],
      deploymentContract: {
        mode: "defer",
        summary: "Deployment is deferred until the local path is proven.",
        artifactType: "web app",
        platforms: [],
        environments: [],
        buildSteps: ["pnpm build"],
        deploySteps: [],
        previewStrategy: ["Use local preview for now."],
        presenceStrategy: ["Hosted proof is deferred until deploy is explicit."],
        proofTargets: ["Future preview URL"],
        healthChecks: ["Local path works"],
        rollback: ["No live deploy yet."],
        requiredSecrets: [],
      },
      nonGoals: ["avoid scope creep"],
      constraints: ["keep the repo stable"],
      architecturePrinciples: ["Preserve shared workflow modules and explicit service seams"],
      autonomyRules: ["Ask before widening scope"],
      qualityBar: ["Do not call it done until the changed behavior is proven with reasonable, risk-based validation"],
      riskBoundaries: ["Avoid regressions without explicit approval"],
      uiDirection: "Simple, calm, and legible",
      ...overrideIntent,
    },
  };
}

function seedCoverageAnswers(onboarder: Onboarder) {
  onboarder.sendInput("Ship safely", { question: "What is the project story?", theme: "project-story" });
  onboarder.sendInput("Operators", { question: "Who are the primary users?", theme: "primary-users" });
  onboarder.sendInput("Flow works", { question: "What is the definition of done?", theme: "definition-of-done" });
  onboarder.sendInput("Proof of completion", { question: "What proof should Roscoe require?", theme: "acceptance-checks" });
  onboarder.sendInput("Delivery pillars", { question: "How should frontend, backend, unit tests, and e2e tests work together?", theme: "delivery-pillars" });
  onboarder.sendInput("Use Vitest and Playwright", { question: "How should Roscoe validate progress?", theme: "coverage-mechanism" });
  onboarder.sendInput("No scope creep", { question: "What are the non-goals?", theme: "non-goals" });
  onboarder.sendInput("Ask before changing scope", { question: "What autonomy rules apply?", theme: "autonomy-rules" });
  onboarder.sendInput("High quality", { question: "What quality bar applies?", theme: "quality-bar" });
  onboarder.sendInput("Avoid regressions", { question: "What risks should Roscoe avoid?", theme: "risk-boundaries" });
}

describe("Onboarder coverage", () => {
  beforeEach(() => {
    workspaceAssessmentState.mode = "existing";
    workspaceAssessmentState.summary = "Existing repo with established structure.";
    deploymentAssessmentState.summary = "Preserve the current deploy flow.";
    mockMonitorInstance = undefined;
    vi.clearAllMocks();
    vi.mocked(SessionMonitor).mockImplementation(function(id: string) {
      mockMonitorInstance = new MockSessionMonitor(id);
      return mockMonitorInstance as any;
    });
  });

  it("builds the existing-repo onboarding prompt and enables debug when requested", () => {
    const onboarder = new Onboarder("/tmp/test-project", true);
    onboarder.start();

    expect(enableDebug).toHaveBeenCalled();
    expect(inspectWorkspaceForOnboarding).toHaveBeenCalledWith("/tmp/test-project");
    expect(inferDeploymentAssessment).toHaveBeenCalledWith("/tmp/test-project");
    expect(mockMonitorInstance!.startTurn).toHaveBeenCalledWith(
      expect.stringContaining("WORKSPACE ASSESSMENT:\nExisting repo with established structure."),
    );
    expect(mockMonitorInstance!.startTurn).toHaveBeenCalledWith(
      expect.not.stringContaining("vision-first build from an empty or scaffold-only workspace"),
    );
  });

  it("builds a refine prompt with saved answers and history, including empty fallbacks", () => {
    const seedContext = makeReadyBrief({
      interviewAnswers: [
        {
          question: "What is the saved direction?",
          answer: "Keep delivery honest",
          theme: "quality-bar",
        },
      ],
    });
    const seedHistory = [
      {
        id: "history-1",
        mode: "refine",
        createdAt: "2026-03-30T01:02:03.000Z",
        directory: "/tmp/test-project",
        projectName: "CoverageProject",
        runtime: { profileName: "orchestrator", protocol: "claude", summary: "claude", settings: {} },
        rawTranscript: "A very long transcript excerpt that should appear in the prompt.",
        questions: [],
        answers: [],
        briefSnapshot: makeReadyBrief(),
      },
    ] as any;
    vi.mocked(loadProjectContext).mockReturnValue(seedContext as any);
    vi.mocked(listProjectHistory).mockReturnValue(seedHistory);

    const onboarder = new Onboarder("/tmp/test-project", false, undefined, undefined, {
      mode: "refine",
      refineThemes: ["deployment-contract", "quality-bar"],
      seedContext,
      seedHistory,
    });
    onboarder.start();

    const prompt = vi.mocked(mockMonitorInstance!.startTurn).mock.calls.at(-1)?.[0] ?? "";
    expect(prompt).toContain("Requested refinement themes: deployment-contract, quality-bar");
    expect(prompt).toContain("What is the saved direction?");
    expect(prompt).toContain("History 1 (refine @ 2026-03-30T01:02:03.000Z)");
  });

  it("normalizes additional interview themes from question wording and uses the refine follow-up prompt", () => {
    const onboarder = new Onboarder("/tmp/test-project", false, undefined, undefined, {
      mode: "refine",
      seedContext: makeReadyBrief(),
      seedHistory: [],
    });
    onboarder.start();

    onboarder.sendInput("deployment", { question: "Which deployment path matters most?" });
    onboarder.sendInput("signals", { question: "What success signals matter?" });
    onboarder.sendInput("constraints", { question: "What constraints apply?" });
    onboarder.sendInput("principles", { question: "Which architecture principles must hold?" });
    onboarder.sendInput("ui", { question: "What UI direction should Roscoe preserve?" });

    expect((onboarder as any).interviewAnswers.map((answer: any) => answer.theme)).toEqual([
      "deployment-contract",
      "success-signals",
      "constraints",
      "architecture-principles",
      "ui-direction",
    ]);
    expect(mockMonitorInstance!.sendFollowUp).toHaveBeenLastCalledWith(
      expect.stringContaining("Continue Roscoe's targeted refinement of the saved project brief."),
    );
  });

  it("returns early when methods are called before a session exists", () => {
    const onboarder = new Onboarder("/tmp/test-project");
    expect(() => (onboarder as any).wireEvents()).not.toThrow();
    expect(() => onboarder.sendInput("noop")).not.toThrow();
    expect(() => onboarder.sendSecretInput({
      key: "CF_API_TOKEN",
      label: "Cloudflare token",
      purpose: "Needed for preview infra",
      instructions: ["Open dashboard"],
      links: [],
      required: true,
      targetFile: ".env.local",
    }, "skipped")).not.toThrow();
    expect(() => (onboarder as any).requestMoreInterview({
      ok: false,
      missingThemes: ["project story"],
      missingFields: ["quality bar"],
      interviewCount: 0,
      doneVettingCount: 0,
    })).not.toThrow();
    expect(writeProjectSecretValue).not.toHaveBeenCalled();
  });

  it("records skipped or incomplete secret submissions without mutating the runtime", () => {
    const onboarder = new Onboarder("/tmp/test-project");
    onboarder.start();

    const request = {
      key: "CF_API_TOKEN",
      label: "Cloudflare token",
      purpose: "Needed for preview infra",
      instructions: ["Open dashboard"],
      links: [],
      required: true,
      targetFile: ".env.local" as const,
    };

    onboarder.sendSecretInput(request, "skipped");
    onboarder.sendSecretInput(request, "provided");

    expect(saveProjectSecretRecord).toHaveBeenNthCalledWith(1, "/tmp/test-project", request, "skipped");
    expect(saveProjectSecretRecord).toHaveBeenNthCalledWith(2, "/tmp/test-project", request, "skipped");
    expect(mockMonitorInstance!.setProfile).not.toHaveBeenCalled();
    expect(writeProjectSecretValue).not.toHaveBeenCalled();
  });

  it("updates the runtime profile and runtime defaults both before and after session start", () => {
    const onboarder = new Onboarder("/tmp/test-project");
    const nextProfile = {
      name: "codex",
      command: "codex",
      args: ["exec"],
      protocol: "codex",
    } as any;

    onboarder.updateRuntime(nextProfile);
    expect((onboarder as any).profile).toBe(nextProfile);
    expect(mockMonitorInstance).toBeUndefined();

    onboarder.start();
    const runtimeDefaults = {
      workerByProtocol: {
        codex: {
          model: "gpt-5.4",
        },
      },
    } as any;
    onboarder.updateRuntime(nextProfile, runtimeDefaults);

    expect((onboarder as any).projectRuntimeDefaults).toEqual(runtimeDefaults);
    expect(mockMonitorInstance!.setProfile).toHaveBeenCalledWith(nextProfile);
  });

  it("continues the interview, emits continue-interview, and ignores the next successful exit", () => {
    const onboarder = new Onboarder("/tmp/test-project");
    onboarder.start();

    const continued = vi.fn();
    const exitSpy = vi.fn();
    onboarder.on("continue-interview", continued);
    onboarder.on("exit", exitSpy);

    mockMonitorInstance!.emit("text", `---BRIEF---\n${JSON.stringify({
      name: "TooSoon",
      directory: "/tmp/test-project",
      intentBrief: {
        projectStory: "",
        primaryUsers: [],
        definitionOfDone: [],
        acceptanceChecks: [],
        successSignals: [],
        acceptanceLedger: [],
        deliveryPillars: { frontend: [], backend: [], unitComponentTests: [], e2eTests: [] },
        coverageMechanism: [],
        deploymentContract: {
          mode: "defer",
          summary: "",
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
        architecturePrinciples: [],
        autonomyRules: [],
        qualityBar: [],
        riskBoundaries: [],
        uiDirection: "",
      },
    })}\n---END_BRIEF---`);
    mockMonitorInstance!.emit("turn-complete");

    expect(continued).toHaveBeenCalled();
    expect(mockMonitorInstance!.sendFollowUp).toHaveBeenLastCalledWith(
      expect.stringContaining("Missing interview themes:"),
    );

    mockMonitorInstance!.emit("exit", 0);
    expect(exitSpy).not.toHaveBeenCalled();

    mockMonitorInstance!.emit("exit", 2);
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("emits exit on a clean run with no brief when the session ends", () => {
    const onboarder = new Onboarder("/tmp/test-project");
    onboarder.start();
    const exitSpy = vi.fn();
    onboarder.on("exit", exitSpy);

    mockMonitorInstance!.emit("text", "No brief yet.");
    mockMonitorInstance!.emit("exit", 0);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("parses question blocks once, keeps selection metadata, and saves them in history", () => {
    const onboarder = new Onboarder("/tmp/test-project");
    onboarder.start();
    seedCoverageAnswers(onboarder);

    const questionBlock = [
      "---QUESTION---",
      JSON.stringify({
        question: "Which proof bundle matters most next?",
        options: ["Unit tests", "Playwright", "Other (I'll explain)"],
        theme: "coverage-mechanism",
        purpose: "Need the next proof target",
        selectionMode: "multi",
      }),
      "---END_QUESTION---",
    ].join("\n");

    mockMonitorInstance!.emit("text", questionBlock);
    mockMonitorInstance!.emit("turn-complete");
    mockMonitorInstance!.emit("turn-complete");

    mockMonitorInstance!.emit("text", `\n---BRIEF---\n${JSON.stringify(makeReadyBrief())}\n---END_BRIEF---`);
    mockMonitorInstance!.emit("turn-complete");

    expect(saveProjectHistory).toHaveBeenCalledWith(expect.objectContaining({
      questions: [
        expect.objectContaining({
          question: "Which proof bundle matters most next?",
          selectionMode: "multi",
          purpose: "Need the next proof target",
        }),
      ],
    }));
    expect(saveProjectContext).toHaveBeenCalled();
    expect(registerProject).toHaveBeenCalledWith("CoverageProject", "/tmp/test-project");
  });

  it("audits sparse greenfield briefs and reports missing contracts, proof, and vetting", () => {
    const onboarder = new Onboarder("/tmp/test-project");
    (onboarder as any).workspaceAssessment = {
      mode: "greenfield",
      summary: "Empty workspace",
    };
    (onboarder as any).interviewAnswers = [];

    const sparseBrief = {
      name: "SparseProject",
      directory: "/tmp/test-project",
      goals: ["Build a web app"],
      milestones: [],
      techStack: ["React"],
      notes: "Web UI",
      intentBrief: {
        projectStory: "",
        primaryUsers: [],
        definitionOfDone: [],
        acceptanceChecks: [],
        successSignals: [],
        acceptanceLedger: [],
        entrySurfaceContract: {
          summary: "",
          defaultRoute: "",
          expectedExperience: "",
          allowedShellStates: [],
        },
        localRunContract: {
          summary: "",
          startCommand: "",
          firstRoute: "",
          prerequisites: [],
          seedRequirements: [],
          expectedBlockedStates: [],
          operatorSteps: [],
        },
        deliveryPillars: { frontend: [], backend: [], unitComponentTests: [], e2eTests: [] },
        coverageMechanism: [],
        deploymentContract: {
          mode: "inferred-existing",
          summary: "",
          artifactType: "web app",
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
        architecturePrinciples: [],
        autonomyRules: [],
        qualityBar: [],
        riskBoundaries: [],
        uiDirection: "",
      },
    } as any;

    const report = (onboarder as any).auditInterviewReadiness(sparseBrief);

    expect(report.ok).toBe(false);
    expect(report.missingThemes).toContain("project story");
    expect(report.missingFields).toEqual(expect.arrayContaining([
      "project story",
      "primary users",
      "definition of done",
      "acceptance checks",
      "success signals",
      "acceptance ledger",
      "delivery pillars: frontend outcome",
      "delivery pillars: backend outcome",
      "delivery pillars: unit/component test proof",
      "delivery pillars: e2e test proof",
      "validation or coverage mechanism for this repo",
      "deployment contract",
      "non goals",
      "constraints",
      "architecture principles",
      "autonomy rules",
      "quality bar",
      "risk boundaries",
      "ui direction",
      "entry surface contract for the greenfield UI",
      "local first-run contract and prerequisite handling for the greenfield UI",
      "hosted proof path for the web presence",
      "at least 8 interview answers",
      "two definition-of-done vetting passes",
      "delivery pillars that tie frontend/backend outcomes to unit/component and e2e proof",
      "reasonable, risk-based verification standard",
      "repo-grounded validation mechanism",
    ]));
  });

  it("treats intent-less briefs as missing proof plans and validation mechanisms", () => {
    const onboarder = new Onboarder("/tmp/test-project", false, undefined, undefined, { mode: "refine" });
    (onboarder as any).interviewAnswers = [];

    const report = (onboarder as any).auditInterviewReadiness({
      name: "Bare",
      directory: "/tmp/test-project",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "",
      intentBrief: undefined,
    });

    expect(report.ok).toBe(false);
    expect(report.missingFields).toContain("delivery pillars that tie frontend/backend outcomes to unit/component and e2e proof");
    expect(report.missingFields).toContain("reasonable, risk-based verification standard");
    expect(report.missingFields).toContain("repo-grounded validation mechanism");
  });

  it("persists brief snapshots after a provided secret rewires the profile env", () => {
    const onboarder = new Onboarder("/tmp/test-project");
    onboarder.start();
    seedCoverageAnswers(onboarder);

    onboarder.sendSecretInput({
      key: "CF_API_TOKEN",
      label: "Cloudflare token",
      purpose: "Needed for preview infra",
      instructions: ["Open dashboard"],
      links: [],
      required: true,
      targetFile: ".env.local",
    }, "provided", "secret-value");

    mockMonitorInstance!.emit("text", `\n---BRIEF---\n${JSON.stringify(makeReadyBrief())}\n---END_BRIEF---`);
    mockMonitorInstance!.emit("turn-complete");

    expect(writeProjectSecretValue).toHaveBeenCalledWith("/tmp/test-project", "CF_API_TOKEN", "secret-value", ".env.local");
    expect(saveProjectSecretRecord).toHaveBeenCalledWith("/tmp/test-project", expect.objectContaining({ key: "CF_API_TOKEN" }), "provided");
    expect(applyProjectEnvToProfile).toHaveBeenCalled();
  });
});
