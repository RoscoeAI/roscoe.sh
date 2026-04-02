import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  statSync: vi.fn(() => ({ isDirectory: () => false, mtimeMs: 1 })),
}));

vi.mock("child_process", () => ({
  execFileSync: vi.fn(() => {
    throw new Error("not a git repo");
  }),
}));

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import {
  getProjectByName,
  loadProfile,
  listProfiles,
  loadProjectContext,
  normalizeIntentBrief,
  normalizeProjectContext,
  registerProject,
  listRegisteredProjects,
  loadAuthProfile,
  listAuthProfiles,
  saveProjectContext,
  saveProjectHistory,
  listProjectHistory,
  loadRoscoeSettings,
  saveRoscoeSettings,
  saveLaneSession,
  loadLaneSession,
  listLaneSessions,
  resetConfigCachesForTests,
  getProjectContractFingerprint,
  updateProjectLastActive,
  ensureHostedRelayClientId,
} from "./config.js";

describe("config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConfigCachesForTests();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, mtimeMs: 1 } as any);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not a git repo");
    });
  });

  describe("loadProfile", () => {
    it("reads and parses profile JSON", () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ name: "claude-code", command: "claude", args: ["--verbose"] }),
      );
      const profile = loadProfile("claude-code");
      expect(profile.name).toBe("claude-code");
      expect(profile.command).toBe("claude");
      expect(profile.args).toEqual(["--verbose"]);
    });

    it("throws on invalid JSON", () => {
      vi.mocked(readFileSync).mockReturnValue("not json");
      expect(() => loadProfile("bad")).toThrow();
    });
  });

  describe("listProfiles", () => {
    it("returns profile names without .json extension", () => {
      vi.mocked(readdirSync).mockReturnValue(["claude-code.json", "codex.json", "readme.md"] as any);
      const profiles = listProfiles();
      expect(profiles).toEqual(["claude-code", "codex"]);
    });

    it("returns empty array when no profiles", () => {
      vi.mocked(readdirSync).mockReturnValue([] as any);
      expect(listProfiles()).toEqual([]);
    });
  });

  describe("loadAuthProfile", () => {
    it("reads and parses auth profile JSON", () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ name: "github", url: "https://github.com", steps: [] }),
      );
      const profile = loadAuthProfile("github");
      expect(profile.name).toBe("github");
      expect(profile.url).toBe("https://github.com");
    });
  });

  describe("listAuthProfiles", () => {
    it("returns empty when auth dir does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(listAuthProfiles()).toEqual([]);
    });

    it("filters for .json files", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(["github.json", "notes.txt"] as any);
      expect(listAuthProfiles()).toEqual(["github"]);
    });
  });

  describe("loadProjectContext", () => {
    it("returns parsed project context", () => {
      const ctx = { name: "proj", directory: "/tmp", goals: [], milestones: [], techStack: [], notes: "" };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(ctx));
      const result = loadProjectContext("/tmp/project");
      expect(result!.name).toBe("proj");
      expect(result!.intentBrief).toBeTruthy();
    });

    it("returns null when file does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(loadProjectContext("/tmp/project")).toBeNull();
    });

    it("returns null when the resolved project file disappears before it can be read", () => {
      let projectPathChecks = 0;
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const filePath = String(path);
        if (filePath.includes("/tmp/project/.roscoe/project.json")) {
          projectPathChecks += 1;
          return projectPathChecks === 1;
        }
        return true;
      });

      expect(loadProjectContext("/tmp/project")).toBeNull();
    });

    it("falls back to legacy .llm-responder memory when .roscoe is missing", () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const filePath = String(path);
        if (filePath.includes("/tmp/project/.roscoe/project.json")) return false;
        if (filePath.includes("/tmp/project/.llm-responder/project.json")) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "legacy-proj",
        directory: "/tmp/project",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
      }));

      const result = loadProjectContext("/tmp/project");
      expect(result!.name).toBe("legacy-proj");
    });

    it("normalizes interview answers and intent fields", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp",
        goals: ["Ship"],
        milestones: ["v1"],
        techStack: ["TypeScript"],
        notes: "Keep it tight",
        interviewAnswers: [{ question: "Who is this for?", answer: "Operators", theme: "users" }],
        intentBrief: {
          projectStory: "Give operators a fast console",
          definitionOfDone: ["main flow complete"],
          acceptanceChecks: ["demo flow completes cleanly"],
          deliveryPillars: {
            frontend: ["Operator UI completes the main workflow"],
            backend: ["API persists the workflow state correctly"],
            unitComponentTests: ["Vitest covers changed frontend/backend logic, regressions, and edge cases at a reasonable level"],
            e2eTests: ["Playwright covers the full workflow and failure modes at the right stage of hardening"],
          },
          coverageMechanism: ["Vitest + Playwright runs provide the canonical validation path"],
        },
      }));
      const result = loadProjectContext("/tmp/project");
      expect(result!.interviewAnswers).toEqual([
        { question: "Who is this for?", answer: "Operators", theme: "users" },
      ]);
      expect(result!.intentBrief!.projectStory).toContain("operators");
      expect(result!.intentBrief!.definitionOfDone).toEqual(["main flow complete"]);
      expect(result!.intentBrief!.acceptanceChecks).toEqual(["demo flow completes cleanly"]);
      expect(result!.intentBrief!.deliveryPillars.frontend[0]).toContain("Operator UI");
      expect(result!.intentBrief!.coverageMechanism[0]).toContain("canonical validation path");
      expect(result!.intentBrief!.deploymentContract?.summary).toBeTruthy();
      expect(result!.intentBrief!.architecturePrinciples?.length).toBeGreaterThan(0);
      expect(result!.intentBrief!.successSignals).toEqual(["v1"]);
      expect(result!.intentBrief!.acceptanceLedger?.length).toBeGreaterThan(0);
      expect(result!.intentBrief!.acceptanceLedgerMode).toBe("inferred");
    });

    it("backfills newer entry and local run contracts in place for older briefs", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "appsicle",
        directory: "/tmp/appsicle",
        goals: ["Ship the builder"],
        milestones: ["Milestone 1"],
        techStack: ["TanStack Start", "React 18", "TypeScript"],
        notes: "Clean greenfield build. pnpm dev boots the app locally.",
        intentBrief: {
          projectStory: "Build an embeddable builder app",
          definitionOfDone: ["A Creator can describe an app and get working generated code back"],
          acceptanceChecks: ["Manual walkthrough of the operator and creator experience"],
          successSignals: ["Creators can boot it locally"],
          deliveryPillars: {
            frontend: ["Builder UI exists"],
            backend: ["API exists"],
            unitComponentTests: ["Vitest covers changes"],
            e2eTests: ["E2E covers the main flow"],
          },
          coverageMechanism: ["Build-and-boot validation: confirm pnpm dev boots clean"],
        },
      }));

      const result = loadProjectContext("/tmp/appsicle");
      expect(result?.intentBrief?.entrySurfaceContract?.defaultRoute).toBe("/");
      expect(result?.intentBrief?.localRunContract?.startCommand).toBe("pnpm dev");
      expect(result?.intentBrief?.acceptanceLedger?.length).toBeGreaterThan(0);
      expect(result?.intentBrief?.acceptanceLedgerMode).toBe("inferred");
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/appsicle/.roscoe/project.json"),
        expect.stringContaining("\"entrySurfaceContract\""),
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/appsicle/.roscoe/project.json"),
        expect.stringContaining("\"localRunContract\""),
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/appsicle/.roscoe/project.json"),
        expect.stringContaining("\"acceptanceLedger\""),
      );
    });

    it("keeps a default-shaped acceptance ledger inferred unless explicitly promoted", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp/proj",
        goals: ["Ship v1"],
        milestones: ["Demo passes"],
        techStack: [],
        notes: "",
        intentBrief: {
          projectStory: "Story",
          definitionOfDone: ["Ship v1"],
          acceptanceChecks: ["Demo passes"],
          acceptanceLedger: [
            { label: "Ship v1", status: "open", evidence: [], notes: "" },
            { label: "Demo passes", status: "open", evidence: [], notes: "" },
          ],
        },
      }));

      const result = loadProjectContext("/tmp/proj");
      expect(result?.intentBrief?.acceptanceLedgerMode).toBe("inferred");
    });

    it("treats a materially edited acceptance ledger as explicit", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp/proj",
        goals: ["Ship v1"],
        milestones: ["Demo passes"],
        techStack: [],
        notes: "",
        intentBrief: {
          projectStory: "Story",
          definitionOfDone: ["Ship v1"],
          acceptanceChecks: ["Demo passes"],
          acceptanceLedger: [
            { label: "Ship v1", status: "proven", evidence: ["CI green"], notes: "Validated." },
          ],
        },
      }));

      const result = loadProjectContext("/tmp/proj");
      expect(result?.intentBrief?.acceptanceLedgerMode).toBe("explicit");
      expect(result?.intentBrief?.acceptanceLedger?.[0]).toMatchObject({
        status: "proven",
        evidence: ["CI green"],
        notes: "Validated.",
      });
    });

    it("derives local run prerequisites and seed requirements from project narrative keywords", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "appsicle",
        directory: "/tmp/appsicle",
        goals: ["Ship the builder"],
        milestones: ["Milestone 1"],
        techStack: ["TanStack Start", "React 18", "TypeScript"],
        notes: "Run pnpm dev. Sign in first. Seed a demo tenant/operator. Postgres + Prisma are required.",
        intentBrief: {
          projectStory: "Build an embeddable builder app",
          definitionOfDone: ["A Creator can describe an app and get working generated code back"],
          acceptanceChecks: ["Manual walkthrough of the operator and creator experience"],
          successSignals: ["Creators can boot it locally"],
          deliveryPillars: {
            frontend: ["Builder UI exists"],
            backend: ["API exists"],
            unitComponentTests: ["Vitest covers changes"],
            e2eTests: ["E2E covers the main flow"],
          },
          coverageMechanism: ["Boot pnpm dev, visit localhost, verify auth + tenant flow."],
        },
      }));

      const result = loadProjectContext("/tmp/appsicle");
      expect(result?.intentBrief?.localRunContract?.prerequisites).toEqual(expect.arrayContaining([
        expect.stringContaining("Authentication requirements"),
        expect.stringContaining("Database prerequisites"),
      ]));
      expect(result?.intentBrief?.localRunContract?.seedRequirements).toEqual(expect.arrayContaining([
        expect.stringContaining("tenant or operator bootstrap"),
        expect.stringContaining("Required seed data or demo entities"),
      ]));
    });

    it("extracts the first URL into a derived local run contract", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "appsicle",
        directory: "/tmp/appsicle",
        goals: ["Ship the builder"],
        milestones: ["Milestone 1"],
        techStack: ["TanStack Start", "React 18", "TypeScript"],
        notes: "Run pnpm dev and open https://stage.appsicle.ai/preview to validate the truthful first path.",
        intentBrief: {
          projectStory: "Build an embeddable builder app",
          definitionOfDone: ["A Creator can describe an app and get working generated code back"],
          acceptanceChecks: ["Hosted preview responds with the right truth"],
          successSignals: ["Creators can open the preview"],
          deliveryPillars: {
            frontend: ["Builder UI exists"],
            backend: ["API exists"],
            unitComponentTests: ["Vitest covers changes"],
            e2eTests: ["E2E covers the main flow"],
          },
          coverageMechanism: ["Run pnpm dev and verify https://stage.appsicle.ai/preview."],
        },
      }));

      const result = loadProjectContext("/tmp/appsicle");
      expect(result?.intentBrief?.localRunContract?.firstRoute).toBe("https://stage.appsicle.ai/preview");
      expect(result?.intentBrief?.localRunContract?.operatorSteps).toContain(
        "Open `https://stage.appsicle.ai/preview` and verify the truthful default experience.",
      );
    });

    it("truncates overly long derived entry-surface expectations", () => {
      const longAcceptanceCheck = `Preview route must tell the whole story ${"exactly ".repeat(40)}without drifting into placeholder copy or vague staging language.`;
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "appsicle",
        directory: "/tmp/appsicle",
        goals: ["Ship the builder"],
        milestones: ["Milestone 1"],
        techStack: ["TanStack Start", "React 18", "TypeScript"],
        notes: "Local and hosted preview should both be truthful.",
        intentBrief: {
          projectStory: "Build an embeddable builder app",
          definitionOfDone: ["A Creator can describe an app and get working generated code back"],
          acceptanceChecks: [longAcceptanceCheck],
          successSignals: ["Creators can open the preview"],
          deliveryPillars: {
            frontend: ["Builder UI exists"],
            backend: ["API exists"],
            unitComponentTests: ["Vitest covers changes"],
            e2eTests: ["E2E covers the main flow"],
          },
          coverageMechanism: ["Run pnpm dev and verify the preview route."],
        },
      }));

      const result = loadProjectContext("/tmp/appsicle");
      expect(result?.intentBrief?.entrySurfaceContract?.expectedExperience.endsWith("…")).toBe(true);
      expect(result?.intentBrief?.entrySurfaceContract?.expectedExperience.length).toBeLessThanOrEqual(220);
    });

    it("drops empty structured entry and local run contracts", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp/proj",
        goals: ["Ship"],
        milestones: ["v1"],
        techStack: [],
        notes: "",
        intentBrief: {
          projectStory: "Story",
          definitionOfDone: ["Ship"],
          acceptanceChecks: ["v1"],
          successSignals: ["v1"],
          entrySurfaceContract: {
            summary: "   ",
            defaultRoute: " ",
            expectedExperience: "",
            allowedShellStates: [],
          },
          localRunContract: {
            summary: " ",
            startCommand: " ",
            firstRoute: "",
            prerequisites: [],
            seedRequirements: [],
            expectedBlockedStates: [],
            operatorSteps: [],
          },
        },
      }));

      const result = loadProjectContext("/tmp/proj");
      expect(result?.intentBrief?.entrySurfaceContract).toBeUndefined();
      expect(result?.intentBrief?.localRunContract).toBeUndefined();
    });

    it("repairs older migrated UI contracts that incorrectly use a test command as the start command", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "appsicle",
        directory: "/tmp/appsicle",
        goals: ["Ship the builder"],
        milestones: ["Milestone 1"],
        techStack: ["TanStack Start", "React 18", "TypeScript"],
        notes: "Clean greenfield build.",
        intentBrief: {
          projectStory: "Build an embeddable builder app",
          definitionOfDone: ["A Creator can describe an app and get working generated code back"],
          acceptanceChecks: ["Manual walkthrough of the operator and creator experience"],
          successSignals: ["Creators can boot it locally"],
          entrySurfaceContract: {
            summary: "Truthful first screen",
            defaultRoute: "/",
            expectedExperience: "Root route is honest",
            allowedShellStates: [],
          },
          localRunContract: {
            summary: "Local boot should be honest",
            startCommand: "pnpm test:unit",
            firstRoute: "http://localhost:3000",
            prerequisites: [],
            seedRequirements: [],
            expectedBlockedStates: [],
            operatorSteps: ["Run `pnpm test:unit`."],
          },
          deliveryPillars: {
            frontend: ["Builder UI exists"],
            backend: ["API exists"],
            unitComponentTests: ["Vitest covers changes"],
            e2eTests: ["E2E covers the main flow"],
          },
          coverageMechanism: ["Build-and-boot validation"],
        },
      }));

      const result = loadProjectContext("/tmp/appsicle");
      expect(result?.intentBrief?.localRunContract?.startCommand).toBe("pnpm dev");
      expect(result?.intentBrief?.localRunContract?.operatorSteps[0]).toBe("Run `pnpm dev`.");
      expect(result?.intentBrief?.acceptanceLedgerMode).toBe("inferred");
    });

    it("keeps structured multi-select interview answers", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        interviewAnswers: [
          {
            question: "Which constraints apply?",
            answer: "Kubernetes | Vercel AI SDK",
            theme: "constraints",
            mode: "multi",
            selectedOptions: ["Kubernetes", "Vercel AI SDK"],
            freeText: "Keep the provider lock in place.",
          },
        ],
      }));

      const result = loadProjectContext("/tmp/project");
      expect(result!.interviewAnswers).toEqual([
        {
          question: "Which constraints apply?",
          answer: "Kubernetes | Vercel AI SDK",
          theme: "constraints",
          mode: "multi",
          selectedOptions: ["Kubernetes", "Vercel AI SDK"],
          freeText: "Keep the provider lock in place.",
        },
      ]);
    });

    it("normalizes saved governance and approval defaults", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {
          lockedProvider: "codex",
          workerGovernanceMode: "roscoe-arbiter",
          verificationCadence: "prove-each-slice",
          responderApprovalMode: "manual",
          workerByProtocol: {
            codex: {
              executionMode: "accelerated",
              bypassApprovalsAndSandbox: true,
            },
          },
        },
      }));

      const result = loadProjectContext("/tmp/project");
      expect(result?.runtimeDefaults).toMatchObject({
        lockedProvider: "codex",
        workerGovernanceMode: "roscoe-arbiter",
        verificationCadence: "prove-each-slice",
        responderApprovalMode: "manual",
      });
      expect(result?.runtimeDefaults?.workerByProtocol?.codex).toMatchObject({
        executionMode: "accelerated",
        bypassApprovalsAndSandbox: true,
      });
    });

    it("accepts gemini as a first-class runtime provider in saved defaults", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {
          guildProvider: "gemini",
          responderProvider: "claude",
          workerByProtocol: {
            gemini: {
              model: "gemini-2.5-pro",
              reasoningEffort: "high",
            },
          },
        },
      }));

      const result = loadProjectContext("/tmp/project");
      expect(result?.runtimeDefaults?.guildProvider).toBe("gemini");
      expect(result?.runtimeDefaults?.workerByProtocol?.gemini).toMatchObject({
        model: "gemini-2.5-pro",
        reasoningEffort: "high",
      });
    });

    it("normalizes richer runtime defaults and falls back guild/responder providers from the locked provider", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {
          lockedProvider: "claude",
          workerByProtocol: {
            claude: {
              permissionMode: "acceptEdits",
              sandboxMode: "workspace-write",
              approvalPolicy: "manual",
              dangerouslySkipPermissions: true,
            },
          },
          responderByProtocol: {
            gemini: {
              executionMode: "safe",
              tuningMode: "manual",
            },
          },
          onboarding: {
            profileName: "starter",
            runtime: {
              executionMode: "accelerated",
            },
          },
          tokenEfficiencyMode: "save-tokens",
        },
      }));

      const result = loadProjectContext("/tmp/project");
      expect(result?.runtimeDefaults).toMatchObject({
        lockedProvider: "claude",
        guildProvider: "claude",
        responderProvider: "claude",
        tokenEfficiencyMode: "save-tokens",
        onboarding: {
          profileName: "starter",
          runtime: {
            executionMode: "accelerated",
          },
        },
      });
      expect(result?.runtimeDefaults?.workerByProtocol?.claude).toMatchObject({
        permissionMode: "acceptEdits",
        sandboxMode: "workspace-write",
        approvalPolicy: "manual",
        dangerouslySkipPermissions: true,
      });
      expect(result?.runtimeDefaults?.responderByProtocol?.gemini).toMatchObject({
        executionMode: "safe",
        tuningMode: "manual",
      });
    });

    it("drops empty runtime default containers that do not produce valid nested settings", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {
          workerByProtocol: {
            codex: "invalid",
          },
          responderByProtocol: {
            claude: "invalid",
          },
          onboarding: {
            profileName: "   ",
            runtime: null,
          },
        },
      }));

      const result = loadProjectContext("/tmp/project");
      expect(result?.runtimeDefaults).toBeUndefined();
    });

    it("falls back acceptance ledgers with only malformed items to the inferred default ledger", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: "proj",
        directory: "/tmp/proj",
        goals: ["Ship v1"],
        milestones: ["Demo passes"],
        techStack: [],
        notes: "",
        intentBrief: {
          projectStory: "Story",
          definitionOfDone: ["Ship v1"],
          acceptanceChecks: ["Demo passes"],
          acceptanceLedger: [null, { label: "   ", status: "proven", evidence: ["bad"] }],
        },
      }));

      const result = loadProjectContext("/tmp/proj");
      expect(result?.intentBrief?.acceptanceLedgerMode).toBe("inferred");
      expect(result?.intentBrief?.acceptanceLedger).toEqual([
        { label: "Ship v1", status: "open", evidence: [], notes: "" },
        { label: "Demo passes", status: "open", evidence: [], notes: "" },
      ]);
    });

    it("keeps explicit non-UI local run contracts unchanged and derives non-UI local workflow commands without fake routes", () => {
      const explicit = normalizeIntentBrief(
        {
          name: "svc",
          directory: "/tmp/svc",
          goals: ["Ship"],
          milestones: ["Runbook complete"],
          techStack: ["Node"],
          notes: "Server process only.",
        },
        {
          projectStory: "Run a backend worker",
          definitionOfDone: ["Ship"],
          acceptanceChecks: ["Runbook complete"],
          localRunContract: {
            summary: "Backend run path",
            startCommand: "pnpm test:integration",
            firstRoute: "",
            prerequisites: [],
            seedRequirements: [],
            expectedBlockedStates: [],
            operatorSteps: ["Run `pnpm test:integration`."],
          },
        },
      );
      expect(explicit.localRunContract?.startCommand).toBe("pnpm test:integration");
      expect(explicit.localRunContract?.firstRoute).toBe("");

      const derived = normalizeIntentBrief(
        {
          name: "svc",
          directory: "/tmp/svc",
          goals: ["Ship"],
          milestones: ["Runbook complete"],
          techStack: ["Node"],
          notes: "Run npm run migrate and confirm localhost health once the service is up.",
        },
        {
          projectStory: "Run a backend worker",
          definitionOfDone: ["Ship"],
          acceptanceChecks: ["Runbook complete"],
          successSignals: ["localhost responds cleanly"],
          coverageMechanism: ["Run npm run migrate before the final verification sweep."],
        },
      );

      expect(derived.entrySurfaceContract).toBeUndefined();
      expect(derived.localRunContract).toMatchObject({
        startCommand: "npm run migrate",
        firstRoute: "",
        operatorSteps: ["Run `npm run migrate`."],
      });
    });

    it("derives the default UI entry expectation fallback and repairs empty UI start routes to localhost", () => {
      const uiBrief = normalizeIntentBrief(
        {
          name: "appsicle",
          directory: "/tmp/appsicle",
          goals: [],
          milestones: [],
          techStack: ["React"],
          notes: "",
        },
        {
          projectStory: "",
          definitionOfDone: [],
          acceptanceChecks: [],
          successSignals: [],
          localRunContract: {
            summary: "Launch locally",
            startCommand: "pnpm test:unit",
            firstRoute: "",
            prerequisites: [],
            seedRequirements: [],
            expectedBlockedStates: [],
            operatorSteps: [],
          },
        },
      );

      expect(uiBrief.entrySurfaceContract?.expectedExperience).toBe(
        "The default first screen should honestly reflect what works locally and what remains blocked.",
      );
      expect(uiBrief.localRunContract).toMatchObject({
        startCommand: "pnpm dev",
        firstRoute: "http://localhost:3000",
        operatorSteps: [
          "Run `pnpm dev`.",
          "Open `http://localhost:3000` and verify the truthful default experience.",
        ],
      });
    });
  });

  describe("saveProjectContext", () => {
    it("writes normalized governance and approval defaults", () => {
      saveProjectContext({
        name: "proj",
        directory: "/tmp/proj",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {
          lockedProvider: "codex",
          workerGovernanceMode: "roscoe-arbiter",
          verificationCadence: "batched",
          responderApprovalMode: "auto",
          workerByProtocol: {
            codex: {
              executionMode: "accelerated",
              bypassApprovalsAndSandbox: true,
            },
          },
        },
      });

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/proj/.roscoe/project.json"),
        expect.stringContaining("\"workerGovernanceMode\": \"roscoe-arbiter\""),
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/proj/.roscoe/project.json"),
        expect.stringContaining("\"verificationCadence\": \"batched\""),
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/proj/.roscoe/project.json"),
        expect.stringContaining("\"responderApprovalMode\": \"auto\""),
      );
    });
  });

  describe("getProjectContractFingerprint", () => {
    it("changes when the intent contract changes", () => {
      const base = {
        name: "proj",
        directory: "/tmp/proj",
        goals: ["Ship"],
        milestones: ["v1"],
        techStack: ["TypeScript"],
        notes: "Keep it tight",
        intentBrief: {
          projectStory: "Story",
          primaryUsers: ["operators"],
          definitionOfDone: ["done"],
          acceptanceChecks: ["proof"],
          successSignals: ["signal"],
          deliveryPillars: {
            frontend: ["frontend"],
            backend: ["backend"],
            unitComponentTests: ["unit"],
            e2eTests: ["e2e"],
          },
          coverageMechanism: ["vitest"],
          nonGoals: ["none"],
          constraints: ["constraint"],
          architecturePrinciples: ["shared"],
          autonomyRules: ["ask"],
          qualityBar: ["quality"],
          riskBoundaries: ["risk"],
          uiDirection: "clear",
        },
      };

      const first = getProjectContractFingerprint(base as any);
      const second = getProjectContractFingerprint({
        ...base,
        intentBrief: {
          ...base.intentBrief,
          localRunContract: {
            summary: "Local path",
            startCommand: "pnpm dev",
            firstRoute: "http://localhost:3000",
            prerequisites: ["auth"],
            seedRequirements: [],
            expectedBlockedStates: ["sign in"],
            operatorSteps: ["run it"],
          },
        },
      } as any);

      expect(first).not.toBe(second);
    });
  });

  describe("registerProject", () => {
    it("adds new project to registry", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ projects: [] }));
      registerProject("myproj", "/tmp/myproj");
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("myproj"),
      );
    });

    it("updates existing project by directory", () => {
      const existing = {
        projects: [
          { name: "old-name", directory: "/tmp/myproj", onboardedAt: "2024-01-01", lastActive: "2024-01-01" },
        ],
      };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(existing));
      registerProject("new-name", "/tmp/myproj");
      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
      expect(written.projects).toHaveLength(1);
      expect(written.projects[0].name).toBe("new-name");
    });

    it("canonicalizes nested git directories to the repo root", () => {
      vi.mocked(execFileSync).mockReturnValue("/tmp/myproj\n" as never);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ projects: [] }));

      registerProject("myproj", "/tmp/myproj/cli");

      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
      expect(written.projects[0].directory).toBe("/tmp/myproj");
    });

    it("creates registry dir if it does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error("no file"); });
      registerProject("proj", "/tmp");
      expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
    });

    it("migrates nested canonical storage by copying legacy and primary memory contents once", () => {
      vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options?: { cwd?: string }) => {
        if (command === "git" && args.join(" ") === "rev-parse --show-toplevel" && options?.cwd === "/tmp/proj/nested") {
          return "/tmp/proj\n";
        }
        throw new Error("not a git repo");
      }) as any);

      const directoryEntries: Record<string, string[]> = {
        "/tmp/proj/nested/.llm-responder": ["legacy.txt", "nested"],
        "/tmp/proj/nested/.llm-responder/nested": ["legacy-child.txt"],
        "/tmp/proj/nested/.roscoe": ["current.txt"],
        "/tmp/proj/.roscoe": [],
      };
      const directorySet = new Set(Object.keys(directoryEntries));
      const fileSet = new Set([
        "/tmp/proj/nested/.llm-responder/legacy.txt",
        "/tmp/proj/nested/.llm-responder/nested/legacy-child.txt",
        "/tmp/proj/nested/.roscoe/current.txt",
      ]);

      vi.mocked(existsSync).mockImplementation((path: any) => {
        const filePath = String(path);
        return directorySet.has(filePath) || fileSet.has(filePath);
      });
      vi.mocked(readdirSync).mockImplementation((path: any) => directoryEntries[String(path)] as any);
      vi.mocked(statSync).mockImplementation((path: any) => ({
        isDirectory: () => directorySet.has(String(path)),
        mtimeMs: 1,
      }) as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ projects: [] }));

      registerProject("proj", "/tmp/proj/nested");
      registerProject("proj", "/tmp/proj/nested");

      expect(vi.mocked(readdirSync)).toHaveBeenCalledWith("/tmp/proj/nested/.llm-responder");
      expect(vi.mocked(readdirSync)).toHaveBeenCalledWith("/tmp/proj/nested/.roscoe");
      expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
    });
  });

  describe("lane sessions", () => {
    it("writes lane session snapshots under the project memory directory", () => {
      saveLaneSession({
        laneKey: "unused",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "codex",
        protocol: "codex",
        providerSessionId: "thread-1",
        responderProtocol: "codex",
        responderSessionId: "responder-1",
        trackerHistory: [{ role: "assistant", content: "hello", timestamp: 1 }],
        responderHistoryCursor: 1,
        timeline: [],
        outputLines: ["hello"],
        summary: "summary",
        currentToolUse: null,
        startedAt: "2026-03-26T00:00:00.000Z",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        rateLimitStatus: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      });

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/proj/.roscoe/sessions.json"),
        expect.stringContaining("\"providerSessionId\": \"thread-1\""),
      );
    });

    it("loads a saved lane session by lane identity", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::main::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "thread-1",
            responderProtocol: "codex",
            responderSessionId: "responder-1",
            trackerHistory: [{ role: "assistant", content: "hello", timestamp: 1 }],
            responderHistoryCursor: 1,
            timeline: [],
            preview: {
              mode: "ready",
              message: "Preview ready.",
              link: "https://preview.example.com",
            },
            outputLines: ["hello"],
            summary: "summary",
            currentToolUse: null,
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const record = loadLaneSession("/tmp/proj", "/tmp/proj", "main", "codex");
      expect(record?.providerSessionId).toBe("thread-1");
      expect(record?.trackerHistory[0]?.content).toBe("hello");
      expect(record?.preview).toEqual({
        mode: "ready",
        message: "Preview ready.",
        link: "https://preview.example.com",
      });
    });

    it("normalizes queued preview, rate limits, and pending operator messages when loading a lane", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::main::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "thread-1",
            responderProtocol: "codex",
            responderSessionId: "responder-1",
            trackerHistory: [],
            responderHistoryCursor: 0,
            timeline: [],
            preview: {
              mode: "queued",
              message: "Preview booting.",
            },
            outputLines: [],
            summary: "summary",
            currentToolUse: null,
            currentToolDetail: null,
            rateLimitStatus: {
              source: "codex",
              windowLabel: 5,
              status: "allowed",
              resetsAt: "soon",
            },
            pendingOperatorMessages: [
              {
                id: "sms-1",
                text: "status",
                via: "hosted-sms",
                from: "+15551234567",
                receivedAt: 123,
                token: "R1",
              },
              {
                text: "missing id",
              },
            ],
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const record = loadLaneSession("/tmp/proj", "/tmp/proj", "main", "codex");
      expect(record?.preview).toEqual({
        mode: "queued",
        message: "Preview booting.",
        link: null,
      });
      expect(record?.rateLimitStatus).toEqual({
        source: "codex",
        windowLabel: null,
        status: "allowed",
        resetsAt: "soon",
      });
      expect(record?.pendingOperatorMessages).toEqual([
        {
          id: "sms-1",
          text: "status",
          via: "hosted-sms",
          from: "+15551234567",
          receivedAt: 123,
          token: "R1",
        },
      ]);
    });

    it("drops invalid preview and rate-limit shapes when loading a lane", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::main::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "thread-1",
            responderProtocol: "codex",
            responderSessionId: "responder-1",
            trackerHistory: [],
            responderHistoryCursor: 0,
            timeline: [],
            preview: {
              mode: "idle",
            },
            outputLines: [],
            summary: "summary",
            currentToolUse: null,
            rateLimitStatus: {
              source: "mystery",
              windowLabel: "daily",
            },
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const record = loadLaneSession("/tmp/proj", "/tmp/proj", "main", "codex");
      expect(record?.preview).toBeUndefined();
      expect(record?.rateLimitStatus).toBeNull();
    });

    it("drops superseded pending suggestions when loading a saved lane", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::main::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "thread-1",
            responderProtocol: "codex",
            responderSessionId: "responder-1",
            trackerHistory: [],
            responderHistoryCursor: 0,
            timeline: [
              {
                id: "old",
                kind: "local-suggestion",
                timestamp: 1,
                text: "",
                confidence: 99,
                reasoning: "stay silent",
                state: "pending",
              },
              {
                id: "new",
                kind: "local-suggestion",
                timestamp: 2,
                text: "",
                confidence: 98,
                reasoning: "still blocked",
                state: "pending",
              },
            ],
            outputLines: [],
            summary: null,
            currentToolUse: null,
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const record = loadLaneSession("/tmp/proj", "/tmp/proj", "main", "codex");
      expect(record?.timeline).toHaveLength(1);
      expect(record?.timeline[0]).toMatchObject({
        id: "new",
        kind: "local-suggestion",
        state: "pending",
      });
    });

    it("dismisses persisted no-op pending suggestions when loading a saved lane", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::main::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "thread-1",
            responderProtocol: "codex",
            responderSessionId: "responder-1",
            trackerHistory: [],
            responderHistoryCursor: 0,
            timeline: [
              {
                id: "noop",
                kind: "local-suggestion",
                timestamp: 1,
                text: "",
                confidence: 20,
                reasoning: "Fourth consecutive no-activity delta; the NEXT.md triage direction was already sent clearly, Guild has not responded, and repeated CI polls are not producing new information — Roscoe should hold silently until a Guild turn or CI completion surfaces.",
                state: "pending",
              },
            ],
            outputLines: [],
            summary: null,
            currentToolUse: null,
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const record = loadLaneSession("/tmp/proj", "/tmp/proj", "main", "codex");
      expect(record?.timeline).toHaveLength(1);
      expect(record?.timeline[0]).toMatchObject({
        id: "noop",
        kind: "local-suggestion",
        state: "dismissed",
      });
    });

    it("normalizes transcript entries by deriving local-sent draft fields and dropping invalid entry shapes", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::main::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "thread-1",
            responderProtocol: "codex",
            responderSessionId: "responder-1",
            trackerHistory: [],
            responderHistoryCursor: 0,
            timeline: [
              {
                id: "remote-1",
                kind: "remote-turn",
                timestamp: 1,
                provider: "codex",
                text: "done",
                activity: "coding",
              },
              {
                id: "sent-1",
                kind: "local-sent",
                timestamp: 2,
                text: JSON.stringify({
                  message: "Ship it",
                  confidence: 87,
                  reasoning: "clear next step",
                }),
                delivery: "auto",
              },
              {
                id: "tool-1",
                kind: "tool-activity",
                timestamp: 3,
                provider: "codex",
                toolName: "Bash",
                text: "pnpm test",
              },
              {
                id: "preview-1",
                kind: "preview",
                timestamp: 4,
                state: "ready",
                text: "Preview ready",
              },
              {
                id: "error-1",
                kind: "error",
                timestamp: 5,
                text: "Sidecar produced no output",
                source: "sidecar",
              },
              {
                id: "bad-1",
                kind: "local-sent",
                timestamp: 6,
                text: 123,
                delivery: "auto",
              },
              {
                id: "bad-2",
                kind: "mystery",
                timestamp: 7,
              },
            ],
            outputLines: [],
            summary: null,
            currentToolUse: null,
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const record = loadLaneSession("/tmp/proj", "/tmp/proj", "main", "codex");
      expect(record?.timeline).toEqual([
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "codex",
          text: "done",
          activity: "coding",
          note: null,
        },
        {
          id: "sent-1",
          kind: "local-sent",
          timestamp: 2,
          text: "Ship it",
          delivery: "auto",
          confidence: 87,
          reasoning: "clear next step",
        },
        {
          id: "tool-1",
          kind: "tool-activity",
          timestamp: 3,
          provider: "codex",
          toolName: "Bash",
          text: "pnpm test",
        },
        {
          id: "preview-1",
          kind: "preview",
          timestamp: 4,
          state: "ready",
          text: "Preview ready",
          link: null,
        },
        {
          id: "error-1",
          kind: "error",
          timestamp: 5,
          text: "Sidecar produced no output",
          source: "sidecar",
        },
      ]);
    });

    it("normalizes tracker timestamps, malformed transcript shells, explicit draft metadata, and preview links", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::main::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "thread-1",
            responderProtocol: "codex",
            responderSessionId: "responder-1",
            trackerHistory: [
              { role: "assistant", content: "ok" },
            ],
            responderHistoryCursor: 0,
            timeline: [
              7,
              { id: "bad-shell", kind: "remote-turn", timestamp: "1" },
              { id: "bad-remote", kind: "remote-turn", timestamp: 1, provider: 123, text: "bad" },
              { id: "remote-1", kind: "remote-turn", timestamp: 2, provider: "codex", text: "done", note: "carry on" },
              { id: "sent-1", kind: "local-sent", timestamp: 3, text: "Ship it", delivery: "approved", confidence: 91, reasoning: "clear" },
              { id: "preview-1", kind: "preview", timestamp: 4, state: "ready", text: "Preview ready", link: "https://preview.example.com" },
            ],
            outputLines: [],
            summary: null,
            currentToolUse: null,
            startedAt: "2026-03-26T00:00:00.000Z",
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const record = loadLaneSession("/tmp/proj", "/tmp/proj", "main", "codex");
      expect(record?.trackerHistory).toEqual([
        { role: "assistant", content: "ok", timestamp: 0 },
      ]);
      expect(record?.startedAt).toBe("2026-03-26T00:00:00.000Z");
      expect(record?.timeline).toEqual([
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 2,
          provider: "codex",
          text: "done",
          activity: null,
          note: "carry on",
        },
        {
          id: "sent-1",
          kind: "local-sent",
          timestamp: 3,
          text: "Ship it",
          delivery: "approved",
          confidence: 91,
          reasoning: "clear",
        },
        {
          id: "preview-1",
          kind: "preview",
          timestamp: 4,
          state: "ready",
          text: "Preview ready",
          link: "https://preview.example.com",
        },
      ]);
    });

    it("drops malformed transcript entry variants and normalizes timestamps, usage, and message history defaults", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::main::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "thread-1",
            responderProtocol: "codex",
            responderSessionId: "responder-1",
            trackerHistory: [
              { role: "assistant", content: "ok", timestamp: 12.9 },
              { role: "tool", content: "bad" },
            ],
            responderHistoryCursor: 0,
            timeline: [
              { id: "bad-suggestion", kind: "local-suggestion", timestamp: 1, text: "x", confidence: 80, reasoning: "why", state: "queued" },
              { id: "bad-send", kind: "local-sent", timestamp: 2, text: "x", delivery: "queued" },
              { id: "bad-tool", kind: "tool-activity", timestamp: 3, toolName: "Bash", text: "pnpm test" },
              { id: "bad-preview", kind: "preview", timestamp: 4, state: "ready", text: 123 },
              { id: "bad-error", kind: "error", timestamp: 5, text: "oops", source: "unknown" },
              { id: "bad-default", kind: "mystery", timestamp: 6 },
            ],
            preview: {
              mode: "queued",
              message: 123,
            },
            outputLines: [],
            summary: "summary",
            currentToolUse: null,
            startedAt: "",
            usage: {
              inputTokens: 12.8,
              outputTokens: -1,
              cachedInputTokens: "bad",
              cacheCreationInputTokens: 7.2,
            },
            pendingOperatorMessages: [
              null,
              {
                id: "sms-1",
                text: "status",
              },
            ],
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const record = loadLaneSession("/tmp/proj", "/tmp/proj", "main", "codex");
      expect(record?.trackerHistory).toEqual([
        { role: "assistant", content: "ok", timestamp: 12.9 },
      ]);
      expect(record?.timeline).toEqual([]);
      expect(record?.preview).toEqual({
        mode: "queued",
        message: null,
        link: null,
      });
      expect(record?.startedAt).toBe(new Date(0).toISOString());
      expect(record?.usage).toEqual({
        inputTokens: 12,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 7,
      });
      expect(record?.pendingOperatorMessages).toEqual([
        {
          id: "sms-1",
          text: "status",
          via: "sms",
          from: null,
          receivedAt: expect.any(Number),
        },
      ]);
    });

    it("drops malformed lane session shells that are missing required identity fields", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      expect(loadLaneSession("/tmp/proj", "/tmp/proj", "main", "codex")).toBeNull();
      expect(listLaneSessions("/tmp/proj")).toEqual([]);
    });

    it("returns an empty session list when the sessions payload is not an array", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: {
          bad: true,
        },
      }));

      expect(listLaneSessions("/tmp/proj")).toEqual([]);
    });

    it("lists legacy lane sessions from .llm-responder when needed", () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const filePath = String(path);
        if (filePath.includes("/tmp/proj/.roscoe/sessions.json")) return false;
        if (filePath.includes("/tmp/proj/.llm-responder/sessions.json")) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "legacy",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "claude-code",
            protocol: "claude",
            providerSessionId: "sess-9",
            responderProtocol: "claude",
            responderSessionId: "resp-9",
            trackerHistory: [],
            responderHistoryCursor: 0,
            timeline: [],
            outputLines: [],
            summary: null,
            currentToolUse: null,
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const sessions = listLaneSessions("/tmp/proj");
      expect(sessions).toHaveLength(1);
      expect(sessions[0].providerSessionId).toBe("sess-9");
    });

    it("dedupes duplicate lane snapshots after canonicalizing nested roots", () => {
      vi.mocked(execFileSync).mockImplementation(((command: string, args: string[], options?: { cwd?: string }) => {
        if (command === "git" && args.join(" ") === "rev-parse --show-toplevel" && options?.cwd === "/tmp/proj/cli") {
          return "/tmp/proj\n";
        }
        throw new Error("not a git repo");
      }) as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj/cli::/tmp/proj/cli::main::codex",
            projectDir: "/tmp/proj/cli",
            projectName: "proj",
            worktreePath: "/tmp/proj/cli",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "sess-old",
            responderProtocol: "codex",
            responderSessionId: "resp-old",
            trackerHistory: [],
            responderHistoryCursor: 0,
            timeline: [],
            outputLines: [],
            summary: null,
            currentToolUse: null,
            savedAt: "2026-03-26T00:00:00.000Z",
          },
          {
            laneKey: "/tmp/proj/cli::/tmp/proj/cli::main::codex",
            projectDir: "/tmp/proj/cli",
            projectName: "proj",
            worktreePath: "/tmp/proj/cli",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "sess-new",
            responderProtocol: "codex",
            responderSessionId: "resp-new",
            trackerHistory: [],
            responderHistoryCursor: 0,
            timeline: [],
            outputLines: [],
            summary: null,
            currentToolUse: null,
            savedAt: "2026-03-26T01:00:00.000Z",
          },
        ],
      }));

      const sessions = listLaneSessions("/tmp/proj/cli");

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        laneKey: "/tmp/proj::/tmp/proj::main::codex",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj",
        providerSessionId: "sess-new",
      });
    });

    it("reuses the cached lane sessions snapshot when the sessions file timestamp is unchanged", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::main::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "main",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "thread-1",
            responderProtocol: "codex",
            responderSessionId: "responder-1",
            trackerHistory: [],
            responderHistoryCursor: 0,
            timeline: [],
            outputLines: [],
            summary: null,
            currentToolUse: null,
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      const first = listLaneSessions("/tmp/proj");
      const second = listLaneSessions("/tmp/proj");

      expect(first).toHaveLength(1);
      expect(second).toBe(first);
      expect(readFileSync).toHaveBeenCalledTimes(1);
    });

    it("returns an empty list when the sessions file cannot be parsed", () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("bad json");
      });

      expect(listLaneSessions("/tmp/proj")).toEqual([]);
    });

    it("drops the lane session cache if the post-write stat fails", () => {
      vi.mocked(statSync)
        .mockReturnValueOnce({ isDirectory: () => false, mtimeMs: 1 } as any)
        .mockImplementationOnce(() => {
          throw new Error("stat failed");
        });

      saveLaneSession({
        laneKey: "unused",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "codex",
        protocol: "codex",
        providerSessionId: "thread-1",
        responderProtocol: "codex",
        responderSessionId: "responder-1",
        trackerHistory: [],
        responderHistoryCursor: 0,
        timeline: [],
        outputLines: [],
        summary: "summary",
        currentToolUse: null,
        startedAt: "2026-03-26T00:00:00.000Z",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        rateLimitStatus: null,
        savedAt: "2026-03-26T00:00:00.000Z",
      });

      expect(listLaneSessions("/tmp/proj")).toEqual([]);
    });

    it("sorts saved lane snapshots by newest savedAt after merging with existing sessions", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        sessions: [
          {
            laneKey: "/tmp/proj::/tmp/proj::other::codex",
            projectDir: "/tmp/proj",
            projectName: "proj",
            worktreePath: "/tmp/proj",
            worktreeName: "other",
            profileName: "codex",
            protocol: "codex",
            providerSessionId: "older",
            responderProtocol: "codex",
            responderSessionId: "older",
            trackerHistory: [],
            responderHistoryCursor: 0,
            timeline: [],
            outputLines: [],
            summary: null,
            currentToolUse: null,
            savedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      }));

      saveLaneSession({
        laneKey: "unused",
        projectDir: "/tmp/proj",
        projectName: "proj",
        worktreePath: "/tmp/proj",
        worktreeName: "main",
        profileName: "codex",
        protocol: "codex",
        providerSessionId: "newer",
        responderProtocol: "codex",
        responderSessionId: "newer",
        trackerHistory: [],
        responderHistoryCursor: 0,
        timeline: [],
        outputLines: [],
        summary: "summary",
        currentToolUse: null,
        startedAt: "2026-03-26T00:00:00.000Z",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        rateLimitStatus: null,
        savedAt: "2026-03-26T01:00:00.000Z",
      });

      const written = JSON.parse(String(vi.mocked(writeFileSync).mock.calls.at(-1)?.[1] ?? "{}"));
      expect(written.sessions.map((entry: any) => entry.providerSessionId)).toEqual(["newer", "older"]);
    });
  });

  describe("listRegisteredProjects", () => {
    it("returns projects from registry", () => {
      const registry = {
        projects: [
          { name: "proj1", directory: "/tmp/a", onboardedAt: "2024-01-01", lastActive: "2024-01-01" },
        ],
      };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(registry));
      const projects = listRegisteredProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe("proj1");
    });

    it("returns empty array when no registry file", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(listRegisteredProjects()).toEqual([]);
    });

    it("filters ephemeral e2e projects and sorts by lastActive", () => {
      const registry = {
        projects: [
          { name: "intent", directory: "/var/folders/x/roscoe-onboard-e2e-abc/project", onboardedAt: "2024-01-01", lastActive: "2024-01-03" },
          { name: "real-a", directory: "/tmp/a", onboardedAt: "2024-01-01", lastActive: "2024-01-02" },
          { name: "real-b", directory: "/tmp/b", onboardedAt: "2024-01-01", lastActive: "2024-01-04" },
        ],
      };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(registry));
      const projects = listRegisteredProjects();
      expect(projects.map((project) => project.name)).toEqual(["real-b", "real-a"]);
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.stringContaining("roscoe-onboard-e2e"),
      );
    });

    it("returns empty when the registry payload is invalid JSON", () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("bad json");
      });

      expect(listRegisteredProjects()).toEqual([]);
    });
  });

  describe("registry helpers", () => {
    it("looks up a project by name", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        projects: [
          { name: "appsicle", directory: "/tmp/appsicle", onboardedAt: "2024-01-01", lastActive: "2024-01-02" },
        ],
      }));

      expect(getProjectByName("appsicle")).toMatchObject({
        directory: "/tmp/appsicle",
      });
      expect(getProjectByName("missing")).toBeUndefined();
    });

    it("updates the last-active timestamp for an existing project and ignores unknown directories", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        projects: [
          { name: "appsicle", directory: "/tmp/appsicle", onboardedAt: "2024-01-01", lastActive: "2024-01-02" },
        ],
      }));

      updateProjectLastActive("/tmp/appsicle");
      expect(writeFileSync).toHaveBeenCalledTimes(1);

      vi.mocked(writeFileSync).mockClear();
      updateProjectLastActive("/tmp/missing");
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it("drops malformed registry entries before returning matches", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        projects: [
          null,
          { name: "", directory: 123 },
          { name: "appsicle", directory: "/tmp/appsicle", onboardedAt: "2024-01-01", lastActive: "2024-01-02" },
        ],
      }));

      expect(getProjectByName("appsicle")).toMatchObject({
        directory: "/tmp/appsicle",
      });
      expect(listRegisteredProjects()).toHaveLength(1);
    });
  });

  describe("project history", () => {
    it("writes timestamped history files under the project history directory", () => {
      saveProjectHistory({
        id: "2026-03-25T12-00-00-onboard",
        mode: "onboard",
        createdAt: "2026-03-25T12:00:00.000Z",
        directory: "/tmp/proj",
        projectName: "proj",
        runtime: {
          profileName: "codex",
          protocol: "codex",
          summary: "codex · gpt-5.4 · xhigh",
          settings: { model: "gpt-5.4", reasoningEffort: "xhigh" },
        },
        rawTranscript: "raw turn transcript",
        questions: [
          {
            question: "Which constraints apply?",
            options: ["A", "B"],
            selectionMode: "multi",
          },
        ],
        answers: [
          {
            question: "Which constraints apply?",
            answer: "A | B",
            mode: "multi",
            selectedOptions: ["A", "B"],
          },
        ],
        briefSnapshot: {
          name: "proj",
          directory: "/tmp/proj",
          goals: [],
          milestones: [],
          techStack: [],
          notes: "",
        },
      });

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/proj/.roscoe/history/2026-03-25T12-00-00-onboard.json"),
        expect.stringContaining("\"rawTranscript\": \"raw turn transcript\""),
      );
    });

    it("loads history records from disk", () => {
      vi.mocked(readdirSync).mockReturnValue(["2026-03-25T12-00-00-onboard.json"] as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        id: "2026-03-25T12-00-00-onboard",
        mode: "onboard",
        createdAt: "2026-03-25T12:00:00.000Z",
        directory: "/tmp/proj",
        projectName: "proj",
        runtime: {
          profileName: "codex",
          protocol: "codex",
          summary: "codex · gpt-5.4 · xhigh",
          settings: { model: "gpt-5.4", reasoningEffort: "xhigh" },
        },
        rawTranscript: "raw turn transcript",
        questions: [{ question: "q", options: ["A"], selectionMode: "single" }],
        answers: [{ question: "q", answer: "A", mode: "single", selectedOptions: ["A"] }],
        briefSnapshot: {
          name: "proj",
          directory: "/tmp/proj",
          goals: [],
          milestones: [],
          techStack: [],
          notes: "",
        },
      }));

      const history = listProjectHistory("/tmp/proj");
      expect(history).toHaveLength(1);
      expect(history[0].answers[0]).toMatchObject({
        mode: "single",
        selectedOptions: ["A"],
      });
      expect(history[0].questions[0].selectionMode).toBe("single");
    });

    it("drops malformed history records and sorts the remaining entries by createdAt", () => {
      vi.mocked(readdirSync).mockReturnValue([
        "bad.json",
        "older.json",
        "newer.json",
      ] as any);
      vi.mocked(readFileSync)
        .mockImplementationOnce(() => "{bad json")
        .mockImplementationOnce(() => JSON.stringify({
          id: "older",
          mode: "onboard",
          createdAt: "2026-03-24T12:00:00.000Z",
          directory: "/tmp/proj",
          projectName: "proj",
          runtime: {
            profileName: "codex",
            protocol: "codex",
            summary: "codex",
            settings: {},
          },
          rawTranscript: "older",
          questions: [],
          answers: [],
          briefSnapshot: {
            name: "proj",
            directory: "/tmp/proj",
            goals: [],
            milestones: [],
            techStack: [],
            notes: "",
          },
        }))
        .mockImplementationOnce(() => JSON.stringify({
          id: "newer",
          mode: "refine",
          createdAt: "2026-03-25T12:00:00.000Z",
          directory: "/tmp/proj",
          projectName: "proj",
          runtime: {
            profileName: "claude-code",
            protocol: "claude",
            summary: "claude",
            settings: {},
          },
          rawTranscript: "newer",
          questions: [],
          answers: [],
          briefSnapshot: {
            name: "proj",
            directory: "/tmp/proj",
            goals: [],
            milestones: [],
            techStack: [],
            notes: "",
          },
        }));

      const history = listProjectHistory("/tmp/proj");
      expect(history.map((record) => record.id)).toEqual(["newer", "older"]);
    });

    it("drops history records with invalid top-level or runtime payloads", () => {
      vi.mocked(readdirSync).mockReturnValue([
        "missing-fields.json",
        "bad-runtime.json",
      ] as any);
      vi.mocked(readFileSync)
        .mockImplementationOnce(() => JSON.stringify({
          id: "missing-fields",
          mode: "onboard",
          createdAt: "2026-03-25T12:00:00.000Z",
          directory: "/tmp/proj",
          projectName: "proj",
        }))
        .mockImplementationOnce(() => JSON.stringify({
          id: "bad-runtime",
          mode: "onboard",
          createdAt: "2026-03-25T12:00:00.000Z",
          directory: "/tmp/proj",
          projectName: "proj",
          runtime: {
            profileName: "gemini",
            protocol: "gemini",
            summary: "gemini",
            settings: {},
          },
          rawTranscript: "raw turn transcript",
          questions: [],
          answers: [],
          briefSnapshot: {
            name: "proj",
            directory: "/tmp/proj",
            goals: [],
            milestones: [],
            techStack: [],
            notes: "",
          },
        }));

      expect(listProjectHistory("/tmp/proj")).toEqual([]);
    });

    it("returns an empty history list when the history directory disappears after resolution", () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const filePath = String(path);
        if (filePath.includes("/tmp/proj/.roscoe/history")) return false;
        return true;
      });

      expect(listProjectHistory("/tmp/proj")).toEqual([]);
    });

    it("normalizes malformed question and answer items inside otherwise valid history records", () => {
      vi.mocked(readdirSync).mockReturnValue(["normalized.json"] as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        id: "normalized",
        mode: "onboard",
        createdAt: "2026-03-25T12:00:00.000Z",
        directory: "/tmp/proj",
        projectName: "proj",
        runtime: {
          profileName: "codex",
          protocol: "codex",
          summary: "codex",
          settings: {},
        },
        rawTranscript: "raw turn transcript",
        questions: [null, { question: "Which?", options: ["A", 7], selectionMode: "multi" }],
        answers: [null, { question: "Which?", answer: "A", theme: "constraints" }],
        briefSnapshot: {
          name: "proj",
          directory: "/tmp/proj",
          goals: [],
          milestones: [],
          techStack: [],
          notes: "",
        },
      }));

      const history = listProjectHistory("/tmp/proj");
      expect(history[0].questions).toEqual([
        { question: "Which?", options: ["A"], selectionMode: "multi" },
      ]);
      expect(history[0].answers).toEqual([
        { question: "Which?", answer: "A", theme: "constraints" },
      ]);
    });

    it("drops primitive history records and backfills a missing brief snapshot", () => {
      vi.mocked(readdirSync).mockReturnValue(["primitive.json", "minimal.json"] as any);
      vi.mocked(readFileSync)
        .mockImplementationOnce(() => "7")
        .mockImplementationOnce(() => JSON.stringify({
          id: "minimal",
          mode: "refine",
          createdAt: "2026-03-25T12:00:00.000Z",
          directory: "/tmp/proj",
          projectName: "proj",
          runtime: {
            profileName: "codex",
            protocol: "codex",
            summary: "codex",
            settings: {},
          },
          rawTranscript: "ok",
          questions: [],
          answers: [],
        }));

      const history = listProjectHistory("/tmp/proj");
      expect(history).toHaveLength(1);
      expect(history[0].briefSnapshot).toMatchObject({
        name: "project",
        directory: "",
      });
    });
  });

  describe("roscoe settings", () => {
    it("returns defaults when no settings file exists", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(loadRoscoeSettings()).toEqual({
        notifications: {
          enabled: false,
          phoneNumber: "",
          consentAcknowledged: false,
          consentProofUrls: [],
          provider: "twilio",
          deliveryMode: "unconfigured",
          hostedRelayClientId: "",
          hostedRelayAccessToken: "",
          hostedRelayAccessTokenExpiresAt: "",
          hostedRelayRefreshToken: "",
          hostedRelayLinkedPhone: "",
          hostedRelayLinkedEmail: "",
          hostedTestVerifiedPhone: "",
        },
        providers: {
          claude: {
            enabled: true,
            brief: false,
            ide: false,
            chrome: false,
          },
          codex: {
            enabled: true,
            webSearch: false,
          },
          gemini: {
            enabled: true,
          },
        },
        behavior: {
          autoHealMetadata: true,
          preventSleepWhileRunning: true,
          parkAtMilestonesForReview: false,
        },
      });
    });

    it("falls back to legacy settings path", () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const filePath = String(path);
        if (filePath.endsWith("/.roscoe/settings.json")) return false;
        if (filePath.endsWith("/.llm-responder/settings.json")) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        notifications: {
          enabled: true,
          phoneNumber: "+15551234567",
          consentAcknowledged: false,
          consentProofUrls: [],
          provider: "twilio",
          deliveryMode: "unconfigured",
          hostedTestVerifiedPhone: "",
        },
      }));

      expect(loadRoscoeSettings().notifications).toMatchObject({
        enabled: true,
        phoneNumber: "+15551234567",
        provider: "twilio",
      });
      expect(loadRoscoeSettings().behavior).toMatchObject({
        autoHealMetadata: true,
        preventSleepWhileRunning: true,
        parkAtMilestonesForReview: false,
      });
    });

    it("writes settings under .roscoe", () => {
      saveRoscoeSettings({
        notifications: {
          enabled: true,
          phoneNumber: "+15551234567",
          consentAcknowledged: true,
          consentProofUrls: ["https://example.com/opt-in"],
          provider: "twilio",
          deliveryMode: "unconfigured",
          hostedRelayClientId: "relay-test-client",
          hostedRelayAccessToken: "",
          hostedRelayAccessTokenExpiresAt: "",
          hostedRelayRefreshToken: "",
          hostedRelayLinkedPhone: "",
          hostedRelayLinkedEmail: "",
          hostedTestVerifiedPhone: "",
        },
        providers: {
          claude: {
            enabled: true,
            brief: false,
            ide: false,
            chrome: false,
          },
          codex: {
            enabled: true,
            webSearch: true,
          },
          gemini: {
            enabled: false,
          },
        },
        behavior: {
          autoHealMetadata: true,
          preventSleepWhileRunning: true,
          parkAtMilestonesForReview: false,
        },
      });

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/.roscoe/settings.json"),
        expect.stringContaining("+15551234567"),
      );
    });

    it("creates the roscoe settings directory when saving settings and the home folder is empty", () => {
      vi.mocked(existsSync).mockImplementation((path: any) => !String(path).endsWith("/.roscoe"));

      saveRoscoeSettings({
        notifications: {
          enabled: false,
          phoneNumber: "",
          consentAcknowledged: false,
          consentProofUrls: [],
          provider: "twilio",
          deliveryMode: "unconfigured",
          hostedRelayClientId: "",
          hostedRelayAccessToken: "",
          hostedRelayAccessTokenExpiresAt: "",
          hostedRelayRefreshToken: "",
          hostedRelayLinkedPhone: "",
          hostedRelayLinkedEmail: "",
          hostedTestVerifiedPhone: "",
        },
        providers: {
          claude: { enabled: true, brief: false, ide: false, chrome: false },
          codex: { enabled: true, webSearch: false },
          gemini: { enabled: true },
        },
        behavior: {
          autoHealMetadata: true,
          preventSleepWhileRunning: true,
          parkAtMilestonesForReview: false,
        },
      });

      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(expect.stringContaining("/.roscoe"), { recursive: true });
    });

    it("falls back to defaults when the settings file is unreadable", () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("bad json");
      });

      expect(loadRoscoeSettings()).toMatchObject({
        notifications: expect.objectContaining({
          enabled: false,
          deliveryMode: "unconfigured",
        }),
        behavior: expect.objectContaining({
          autoHealMetadata: true,
          preventSleepWhileRunning: true,
          parkAtMilestonesForReview: false,
        }),
      });
    });

    it("normalizes invalid notification/provider settings back to safe defaults", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        notifications: {
          enabled: "yes",
          phoneNumber: 123,
          consentAcknowledged: "sure",
          consentProofUrls: ["https://example.com/opt-in", "", 5],
          provider: "email",
          deliveryMode: "mystery",
          hostedRelayClientId: 99,
          hostedRelayAccessToken: 100,
          hostedRelayAccessTokenExpiresAt: 101,
          hostedRelayRefreshToken: 102,
          hostedRelayLinkedPhone: 103,
          hostedRelayLinkedEmail: 104,
        },
        providers: {
          claude: {
            enabled: "true",
            brief: 1,
            ide: true,
            chrome: null,
          },
          codex: {
            enabled: true,
            webSearch: "yes",
          },
          gemini: {
            enabled: "false",
          },
        },
        behavior: {
          autoHealMetadata: 0,
          preventSleepWhileRunning: 1,
          parkAtMilestonesForReview: "sometimes",
        },
      }));

      expect(loadRoscoeSettings()).toEqual({
        notifications: {
          enabled: false,
          phoneNumber: "",
          consentAcknowledged: false,
          consentProofUrls: ["https://example.com/opt-in"],
          provider: "twilio",
          deliveryMode: "unconfigured",
          hostedRelayClientId: "",
          hostedRelayAccessToken: "",
          hostedRelayAccessTokenExpiresAt: "",
          hostedRelayRefreshToken: "",
          hostedRelayLinkedPhone: "",
          hostedRelayLinkedEmail: "",
          hostedTestVerifiedPhone: "",
        },
        providers: {
          claude: {
            enabled: true,
            brief: false,
            ide: true,
            chrome: false,
          },
          codex: {
            enabled: true,
            webSearch: false,
          },
          gemini: {
            enabled: true,
          },
        },
        behavior: {
          autoHealMetadata: true,
          preventSleepWhileRunning: true,
          parkAtMilestonesForReview: false,
        },
      });
    });

    it("preserves hosted relay auth fields and roscoe-hosted delivery mode", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        notifications: {
          enabled: true,
          phoneNumber: "+15551234567",
          consentAcknowledged: true,
          consentProofUrls: [],
          provider: "twilio",
          deliveryMode: "roscoe-hosted",
          hostedRelayClientId: "relay-client-1",
          hostedRelayAccessToken: "access-token",
          hostedRelayAccessTokenExpiresAt: "2026-03-30T12:00:00.000Z",
          hostedRelayRefreshToken: "refresh-token",
          hostedRelayLinkedPhone: "+15551234567",
          hostedRelayLinkedEmail: "tim@example.com",
          hostedTestVerifiedPhone: "+15551234567",
        },
      }));

      expect(loadRoscoeSettings().notifications).toMatchObject({
        deliveryMode: "roscoe-hosted",
        hostedRelayClientId: "relay-client-1",
        hostedRelayAccessToken: "access-token",
        hostedRelayAccessTokenExpiresAt: "2026-03-30T12:00:00.000Z",
        hostedRelayRefreshToken: "refresh-token",
        hostedRelayLinkedPhone: "+15551234567",
        hostedRelayLinkedEmail: "tim@example.com",
        hostedTestVerifiedPhone: "+15551234567",
      });
    });

    it("creates and then reuses a hosted relay client id", () => {
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify({ notifications: {} }));

      const first = ensureHostedRelayClientId();
      expect(first).toMatch(/^relay-/);
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/.roscoe/settings.json"),
        expect.stringContaining(first),
      );

      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify({
        notifications: {
          hostedRelayClientId: first,
        },
      }));
      expect(ensureHostedRelayClientId()).toBe(first);
    });
  });

  describe("misc helpers", () => {
    it("returns null contract fingerprints for missing contexts", () => {
      expect(getProjectContractFingerprint(null)).toBeNull();
    });

    it("normalizes a sparse project context into stable defaults", () => {
      expect(normalizeProjectContext({
        name: "",
        directory: "/tmp/project",
        goals: ["Ship"],
        milestones: [],
        techStack: [],
        notes: undefined as any,
      })).toMatchObject({
        name: "project",
        directory: "/tmp/project",
        goals: ["Ship"],
        notes: "",
      });
    });
  });
});
