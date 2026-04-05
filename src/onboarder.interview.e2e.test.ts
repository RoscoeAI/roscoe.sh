import { once } from "events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { Onboarder } from "./onboarder.js";
import { HeadlessProfile } from "./llm-runtime.js";
import { parseQuestion, parseSecretRequest } from "./hooks/use-onboarding.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, "..", "test", "fixtures", "mock-llm-cli.mjs");

type MockProvider = "claude" | "codex";

interface MockCall {
  provider: MockProvider;
  promptIncludes?: string;
  promptIncludesAll?: string[];
  resumeId?: string;
  sessionId?: string;
  text?: string | string[];
  resultText?: string;
  thinking?: string;
  toolActivity?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
  chunkDelayMs?: number;
}

interface MockEnv {
  claudeCommand: string;
  codexCommand: string;
  logPath: string;
  projectDir: string;
  restore: () => void;
}

describe.sequential("onboarder interview e2e", () => {
  afterEach(() => {
    delete process.env.HOME;
  });

  it.each(["claude", "codex"] as const)(
    "requires a comprehensive Roscoe intake before onboarding completes with %s",
    async (provider) => {
      const env = createMockEnv(buildInterviewScenario(provider));
      const previousHome = process.env.HOME;
      process.env.HOME = env.projectDir;

      try {
        const profile = makeProfile(
          provider,
          provider === "claude" ? env.claudeCommand : env.codexCommand,
        );
        const onboarder = new Onboarder(env.projectDir, false, profile);

        let currentOutput = "";
        onboarder.on("output", (chunk: string) => {
          currentOutput += chunk;
        });

        let turnDone = once(onboarder, "turn-complete");
        onboarder.start();
        await turnDone;
        expect(parseQuestion(currentOutput)?.theme).toBe("project-story");

        currentOutput = "";
        turnDone = once(onboarder, "turn-complete");
        onboarder.sendInput("Ship a clean operator workflow", {
          question: "What is the product vision Roscoe should optimize for?",
          theme: "project-story",
        });
        await turnDone;
        expect(parseQuestion(currentOutput)?.theme).toBe("primary-users");

        currentOutput = "";
        turnDone = once(onboarder, "turn-complete");
        onboarder.sendInput("Operations teams managing production incidents", {
          question: "Who are the primary users Roscoe should optimize for?",
          theme: "primary-users",
        });
        await turnDone;
        expect(parseQuestion(currentOutput)?.theme).toBe("definition-of-done");

        currentOutput = "";
        turnDone = once(onboarder, "turn-complete");
        onboarder.sendInput("Done means the operator can complete the incident workflow without backup tooling", {
          question: "What is the definition of done Roscoe should defend?",
          theme: "definition-of-done",
        });
        await turnDone;
        expect(parseQuestion(currentOutput)?.theme).toBe("acceptance-checks");

        currentOutput = "";
        const continued = once(onboarder, "continue-interview");
        turnDone = once(onboarder, "turn-complete");
        onboarder.sendInput("Proof means the full operator path works in demo conditions with no dead ends", {
          question: "What proof should Roscoe require before calling this done?",
          theme: "acceptance-checks",
        });
        const [report] = await continued as [{
          missingThemes: string[];
          missingFields: string[];
          interviewCount: number;
        }];
        expect(report.missingThemes).toContain("delivery pillars");
        expect(report.missingFields).toContain("at least 8 interview answers");
        await turnDone;
        expect(parseQuestion(currentOutput)?.theme).toBe("delivery-pillars");

        currentOutput = "";
        turnDone = once(onboarder, "turn-complete");
        onboarder.sendInput(
          "Frontend outcomes | Backend outcomes | Vitest | Playwright\n\nAll four pillars must move together before Roscoe can claim completion.",
          {
            question: "How should Roscoe define the delivery pillars across frontend, backend, unit/component tests, and e2e tests?",
            theme: "delivery-pillars",
            selectionMode: "multi",
          },
          {
            mode: "multi",
            selectedOptions: [
              "Frontend outcomes",
              "Backend outcomes",
              "Vitest unit/component proof",
              "Playwright e2e proof",
            ],
            freeText: "All four pillars must move together before Roscoe can claim completion.",
          },
        );
        await turnDone;
        expect(parseQuestion(currentOutput)?.theme).toBe("non-goals");

        currentOutput = "";
        turnDone = once(onboarder, "turn-complete");
        onboarder.sendInput("Do not turn this into a reporting suite or redesign adjacent admin surfaces", {
          question: "What are the non goals Roscoe should hold the line on?",
          theme: "non-goals",
        });
        await turnDone;
        expect(parseQuestion(currentOutput)?.theme).toBe("autonomy-rules");

        currentOutput = "";
        turnDone = once(onboarder, "turn-complete");
        onboarder.sendInput("Roscoe can push implementation details but must ask before changing scope or workflows", {
          question: "What autonomy rules should Roscoe follow when Guild sessions hit ambiguity?",
          theme: "autonomy-rules",
        });
        await turnDone;
        expect(parseQuestion(currentOutput)?.theme).toBe("quality-bar");

        currentOutput = "";
        turnDone = once(onboarder, "turn-complete");
        onboarder.sendInput("Require Vitest and Playwright to show 100% coverage with edge cases proving the frontend and backend outcomes", {
          question: "What quality bar should Roscoe enforce before Guild work is considered done?",
          theme: "quality-bar",
        });
        await turnDone;
        expect(parseQuestion(currentOutput)?.theme).toBe("coverage-mechanism");

        currentOutput = "";
        turnDone = once(onboarder, "turn-complete");
        onboarder.sendInput("Use Vitest and Playwright coverage reports so Roscoe always has a measurable percent gate", {
          question: "How will Roscoe measure coverage percent in this repo?",
          theme: "coverage-mechanism",
        });
        await turnDone;
        expect(parseQuestion(currentOutput)?.theme).toBe("risk-boundaries");

        currentOutput = "";
        const completed = once(onboarder, "onboarding-complete");
        onboarder.sendInput("Avoid unsafe data mutations, hidden regressions, and claiming completion without proof", {
          question: "What risks Roscoe should avoid without explicit approval?",
          theme: "risk-boundaries",
        });
        const [context] = await completed as [{
          name: string;
          intentBrief: {
            definitionOfDone: string[];
            acceptanceChecks: string[];
            deliveryPillars: {
              frontend: string[];
              backend: string[];
              unitComponentTests: string[];
              e2eTests: string[];
            };
            coverageMechanism: string[];
            deploymentContract?: {
              summary: string;
            };
            nonGoals: string[];
            autonomyRules: string[];
            qualityBar: string[];
            riskBoundaries: string[];
          };
          interviewAnswers: Array<{ theme?: string }>;
        }];

        expect(context.name).toBe("Intent Project");
        expect(context.intentBrief.definitionOfDone).toHaveLength(1);
        expect(context.intentBrief.acceptanceChecks).toHaveLength(1);
        expect(context.intentBrief.deliveryPillars.frontend).toHaveLength(1);
        expect(context.intentBrief.deliveryPillars.backend).toHaveLength(1);
        expect(context.intentBrief.deliveryPillars.unitComponentTests).toHaveLength(1);
        expect(context.intentBrief.deliveryPillars.e2eTests).toHaveLength(1);
        expect(context.intentBrief.coverageMechanism).toHaveLength(1);
        expect(context.intentBrief.deploymentContract?.summary).toBeTruthy();
        expect(context.intentBrief.nonGoals).toHaveLength(1);
        expect(context.intentBrief.autonomyRules).toHaveLength(1);
        expect(context.intentBrief.qualityBar).toHaveLength(1);
        expect(context.intentBrief.riskBoundaries).toHaveLength(1);
        expect(context.interviewAnswers).toHaveLength(10);

        const briefPath = join(env.projectDir, ".roscoe", "project.json");
        expect(existsSync(briefPath)).toBe(true);
        const saved = JSON.parse(readFileSync(briefPath, "utf-8"));
        expect(saved.intentBrief.acceptanceChecks[0]).toContain("Vitest");
        expect(saved.intentBrief.coverageMechanism[0]).toContain("measurable percent");
        expect(saved.intentBrief.deploymentContract.summary).toBeTruthy();
        expect(saved.interviewAnswers).toHaveLength(10);

        const invocations = readInvocationLog(env.logPath);
        expect(invocations.some((entry) => entry.prompt.includes("You attempted to finalize Roscoe's project brief too early"))).toBe(true);
      } finally {
        env.restore();
        process.env.HOME = previousHome;
      }
    },
    30000,
  );

  it.each(["claude", "codex"] as const)(
    "refines a saved project brief with %s without rerunning full onboarding",
    async (provider) => {
      const env = createMockEnv(buildRefineScenario(provider));
      const previousHome = process.env.HOME;
      process.env.HOME = env.projectDir;

      const projectDir = env.projectDir;
      mkdirSync(join(projectDir, ".roscoe", "history"), { recursive: true });
      writeFileSync(
        join(projectDir, ".roscoe", "project.json"),
        JSON.stringify({
          name: "Refine Project",
          directory: projectDir,
          goals: ["Ship the operator workflow"],
          milestones: ["v1"],
          techStack: ["TypeScript"],
          notes: "Existing brief",
          intentBrief: {
            projectStory: "Ship a clean operator workflow",
            primaryUsers: ["Operations teams"],
            definitionOfDone: ["Operators can complete the incident workflow"],
            acceptanceChecks: ["The full operator path works"],
            successSignals: ["Operators stay in the product"],
            deliveryPillars: {
              frontend: ["Operator UI completes the workflow"],
              backend: ["Workflow API persists state correctly"],
              unitComponentTests: ["Vitest coverage reaches 100%"],
              e2eTests: ["Playwright coverage reaches 100%"],
            },
            coverageMechanism: ["Vitest and Playwright coverage reports"],
            nonGoals: ["No adjacent reporting work"],
            constraints: ["Keep the locked provider"],
            autonomyRules: ["Ask before changing scope"],
            qualityBar: ["100% coverage with edge cases"],
            riskBoundaries: ["Avoid hidden regressions"],
            uiDirection: "Operator control room",
          },
          interviewAnswers: [
            {
              question: "What is the product vision Roscoe should optimize for?",
              answer: "Ship a clean operator workflow",
              theme: "project-story",
            },
          ],
          runtimeDefaults: {
            lockedProvider: provider,
            workerByProtocol: {
              [provider]: {
                tuningMode: "auto",
                model: provider === "codex" ? "gpt-5.4" : "claude-opus-4-6",
                reasoningEffort: provider === "codex" ? "xhigh" : "max",
              },
            },
            onboarding: {
              profileName: provider === "codex" ? "codex" : "claude-code",
              runtime: {
                tuningMode: "auto",
                model: provider === "codex" ? "gpt-5.4" : "claude-opus-4-6",
                reasoningEffort: provider === "codex" ? "xhigh" : "max",
              },
            },
          },
        }, null, 2),
      );
      writeFileSync(
        join(projectDir, ".roscoe", "history", "legacy.json"),
        JSON.stringify({
          id: "legacy",
          mode: "onboard",
          createdAt: "2026-03-24T12:00:00.000Z",
          directory: projectDir,
          projectName: "Refine Project",
          runtime: {
            profileName: provider === "codex" ? "codex" : "claude-code",
            protocol: provider,
            summary: provider,
            settings: {},
          },
          rawTranscript: "Earlier Roscoe onboarding transcript.",
          questions: [],
          answers: [],
          briefSnapshot: {
            name: "Refine Project",
            directory: projectDir,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Existing brief",
          },
        }, null, 2),
      );

      try {
        const profile = makeProfile(
          provider,
          provider === "claude" ? env.claudeCommand : env.codexCommand,
        );
        const onboarder = new Onboarder(
          projectDir,
          false,
          profile,
          undefined,
          {
            mode: "refine",
            refineThemes: ["definition-of-done", "delivery-pillars"],
          },
        );

        let currentOutput = "";
        onboarder.on("output", (chunk: string) => {
          currentOutput += chunk;
        });

        const firstTurn = once(onboarder, "turn-complete");
        onboarder.start();
        await firstTurn;
        expect(parseQuestion(currentOutput)?.selectionMode).toBe("multi");

        currentOutput = "";
        const completed = once(onboarder, "onboarding-complete");
        onboarder.sendInput(
          "Definition of done | Delivery pillars\n\nAdd proof that screenshots/videos are part of the evidence flow when required.",
          {
            question: "Which saved themes need to change together before Roscoe updates the brief?",
            theme: "definition-of-done",
            selectionMode: "multi",
          },
          {
            mode: "multi",
            selectedOptions: ["Definition of done", "Delivery pillars"],
            freeText: "Add proof that screenshots/videos are part of the evidence flow when required.",
          },
        );
        const [context] = await completed as [{ intentBrief: { definitionOfDone: string[]; deliveryPillars: { e2eTests: string[] } }; interviewAnswers: Array<{ mode?: string }> }];
        expect(context.intentBrief.definitionOfDone[0]).toContain("screenshot");
        expect(context.intentBrief.deliveryPillars.e2eTests[0]).toContain("screenshot");
        expect(context.interviewAnswers.at(-1)).toMatchObject({
          mode: "multi",
        });

        const historyDirEntries = readdirSync(join(projectDir, ".roscoe", "history"));
        expect(historyDirEntries.length).toBeGreaterThan(1);
      } finally {
        env.restore();
        process.env.HOME = previousHome;
      }
    },
    30000,
  );

  it.each(["claude", "codex"] as const)(
    "collects a secret securely during refinement with %s",
    async (provider) => {
      const env = createMockEnv(buildSecretRefineScenario(provider));
      const previousHome = process.env.HOME;
      process.env.HOME = env.projectDir;

      try {
        const profile = makeProfile(
          provider,
          provider === "claude" ? env.claudeCommand : env.codexCommand,
        );
        const onboarder = new Onboarder(env.projectDir, false, profile, undefined, {
          mode: "refine",
          refineThemes: ["delivery-pillars"],
          seedContext: {
            name: "Secret Project",
            directory: env.projectDir,
            goals: ["Ship previews safely"],
            milestones: ["v1"],
            techStack: ["TypeScript"],
            notes: "Need a deployment token for preview infrastructure.",
            intentBrief: {
              projectStory: "Ship previews safely",
              primaryUsers: ["operators"],
              definitionOfDone: ["Previews can be created and validated."],
              acceptanceChecks: ["The preview flow can be executed safely."],
              successSignals: ["Operators can verify builds."],
              deliveryPillars: {
                frontend: ["Preview UI is understandable."],
                backend: ["Preview API calls work safely."],
                unitComponentTests: ["Vitest covers the changed preview logic, regressions, and important failure modes at a reasonable level."],
                e2eTests: ["Playwright covers the preview workflow and critical failure modes at the right stage."],
              },
              coverageMechanism: ["Vitest and Playwright"],
              nonGoals: ["No production rollout work."],
              constraints: ["Keep secrets local."],
              architecturePrinciples: ["Keep deployment credentials behind explicit env seams."],
              autonomyRules: ["Ask before broadening scope."],
              qualityBar: ["Use reasonable, risk-based proof of changed preview behavior, regressions, and failure modes before calling the slice done."],
              riskBoundaries: ["Do not leak secrets into logs or committed files."],
              uiDirection: "",
            },
            interviewAnswers: [],
          },
          seedHistory: [],
        });

        let currentOutput = "";
        onboarder.on("output", (chunk: string) => {
          currentOutput += chunk;
        });

        const turnDone = once(onboarder, "turn-complete");
        onboarder.start();
        await turnDone;

        const request = parseSecretRequest(currentOutput);
        expect(request?.key).toBe("CF_API_TOKEN");

        const completed = once(onboarder, "onboarding-complete");
        onboarder.sendSecretInput(request!, "provided", "top-secret-token");
        await completed;

        const envFile = join(env.projectDir, ".env.local");
        expect(existsSync(envFile)).toBe(true);
        expect(readFileSync(envFile, "utf-8")).toContain('CF_API_TOKEN="top-secret-token"');

        const invocations = readInvocationLog(env.logPath);
        expect(invocations.some((entry) => entry.prompt.includes("The user securely provided CF_API_TOKEN."))).toBe(true);
        expect(invocations.some((entry) => entry.prompt.includes("top-secret-token"))).toBe(false);
      } finally {
        env.restore();
        process.env.HOME = previousHome;
      }
    },
    30000,
  );
});

function buildInterviewScenario(provider: MockProvider): MockCall[] {
  const sessionId = `${provider}-intent-1`;
  return [
    {
      provider,
      promptIncludes: "PHASE 1: Explore the codebase FIRST",
      sessionId,
      text: [
        "Roscoe read the repo and found a live operator workflow with several ambiguous product edges.\n\n",
        "---QUESTION---\n",
        '{"question":"What is the product vision Roscoe should optimize for?","options":["Ship a clean operator workflow","Maximize platform breadth","Optimize for internal demos only","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"project-story","purpose":"Roscoe needs the product outcome before it can judge Guild decisions."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's codebase-grounded intent interview",
        "product vision Roscoe should optimize for",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "That sharpens the product direction.\n\n",
        "---QUESTION---\n",
        '{"question":"Who are the primary users Roscoe should optimize for?","options":["Operations teams","End customers","Internal developers","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"primary-users","purpose":"User identity decides which tradeoffs Roscoe should favor."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's codebase-grounded intent interview",
        "primary users",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "That makes the operator lens explicit.\n\n",
        "---QUESTION---\n",
        '{"question":"What is the definition of done Roscoe should defend?","options":["Main incident workflow is complete","UI feels polished enough","Analytics coverage is broad","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"definition-of-done","purpose":"Roscoe needs the end-state, not just a list of tasks."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's codebase-grounded intent interview",
        "definition of done",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "That defines the end state, but Roscoe still needs proof.\n\n",
        "---QUESTION---\n",
        '{"question":"What proof should Roscoe require before calling this done?","options":["A full demo path works end to end","Unit tests alone are enough","A visual pass is enough","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"acceptance-checks","purpose":"Roscoe must know what evidence turns done from a claim into a fact."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's codebase-grounded intent interview",
        "proof should Roscoe require",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "Attempting a brief too early.\n\n",
        "---BRIEF---\n",
        '{"name":"Intent Project","directory":"/ignored","goals":["Ship the operator workflow"],"milestones":["v1"],"techStack":["TypeScript"],"notes":"Early attempt","intentBrief":{"projectStory":"Ship a clean operator workflow","primaryUsers":["Operations teams"],"definitionOfDone":["Operators can complete the incident workflow"],"acceptanceChecks":["The full demo path works"],"successSignals":["Operators stay in the product"],"deliveryPillars":{"frontend":[],"backend":[],"unitComponentTests":[],"e2eTests":[]},"coverageMechanism":[],"nonGoals":[],"constraints":["Maintain API compatibility"],"autonomyRules":[],"qualityBar":[],"riskBoundaries":[],"uiDirection":""}}',
        "\n---END_BRIEF---",
      ],
    },
    {
      provider,
      promptIncludes: "You attempted to finalize Roscoe's project brief too early",
      resumeId: sessionId,
      sessionId,
      text: [
        "Roscoe still needs the four delivery pillars.\n\n",
        "---QUESTION---\n",
        '{"question":"How should Roscoe define the delivery pillars across frontend, backend, unit/component tests, and e2e tests?","options":["Frontend outcomes","Backend outcomes","Vitest unit/component proof","Playwright e2e proof","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"delivery-pillars","purpose":"Roscoe needs the four-pillar proof chain before it can direct Guild work safely.","selectionMode":"multi"}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's codebase-grounded intent interview",
        "delivery pillars across frontend",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "That locks the four delivery pillars.\n\n",
        "---QUESTION---\n",
        '{"question":"What are the non goals Roscoe should hold the line on?","options":["Avoid adjacent reporting work","Expand scope into every admin surface","Rewrite the backend now","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"non-goals","purpose":"Roscoe needs explicit scope boundaries before it can direct Guild work safely."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's codebase-grounded intent interview",
        "non goals Roscoe should hold the line on",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "That sets the scope edge.\n\n",
        "---QUESTION---\n",
        '{"question":"What autonomy rules should Roscoe follow when Guild sessions hit ambiguity?","options":["Ask before changing scope","Decide everything autonomously","Pause only for production outages","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"autonomy-rules","purpose":"Roscoe needs to know when to act and when to escalate."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's codebase-grounded intent interview",
        "autonomy rules should Roscoe follow",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "That sets Roscoe's guardrails.\n\n",
        "---QUESTION---\n",
        '{"question":"What quality bar should Roscoe enforce before Guild work is considered done?","options":["100% Vitest and Playwright coverage with edge cases proving frontend/backend outcomes","Code compiles","Visual polish only","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"quality-bar","purpose":"Roscoe needs a repeatable standard for completeness."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's codebase-grounded intent interview",
        "quality bar should Roscoe enforce",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "That sharpens Roscoe's completion bar.\n\n",
        "---QUESTION---\n",
        '{"question":"How will Roscoe measure coverage percent in this repo?","options":["Vitest and Playwright coverage reports","Add a repo-native coverage tool if missing","Manual spot checks only","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"coverage-mechanism","purpose":"Roscoe needs a measurable coverage percentage before it can call work done."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's codebase-grounded intent interview",
        "measure coverage percent",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "That gives Roscoe a measurable gate.\n\n",
        "---QUESTION---\n",
        '{"question":"What risks Roscoe should avoid without explicit approval?","options":["Unsafe data mutations and hidden regressions","Minor copy changes","Routine refactors","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"risk-boundaries","purpose":"Roscoe must know which mistakes are unacceptable."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's codebase-grounded intent interview",
        "risks Roscoe should avoid",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "Roscoe now has a complete intent map.\n\n",
        "---BRIEF---\n",
        '{"name":"Intent Project","directory":"/ignored","goals":["Ship the operator workflow"],"milestones":["v1 launch"],"techStack":["TypeScript"],"notes":"Roscoe should keep the scope narrow and operator-focused.","intentBrief":{"projectStory":"Ship a clean operator workflow","primaryUsers":["Operations teams"],"definitionOfDone":["The frontend operator flow and backend workflow logic must complete without leaving the product"],"acceptanceChecks":["Vitest unit/component and Playwright e2e runs prove the full operator path with no dead ends"],"successSignals":["Operators can finish the core flow inside the product"],"deliveryPillars":{"frontend":["Frontend operator flow completes the incident workflow cleanly"],"backend":["Backend workflow APIs validate and persist the incident workflow correctly"],"unitComponentTests":["Vitest unit/component coverage reaches 100% across frontend/backend logic and edge cases"],"e2eTests":["Playwright e2e coverage reaches 100% across operator success and failure modes"]},"coverageMechanism":["Vitest plus Playwright coverage reports give Roscoe a measurable percent gate"],"nonGoals":["Do not expand into adjacent reporting or redesign every admin surface"],"constraints":["Maintain API compatibility while tightening the operator flow"],"autonomyRules":["Ask before changing scope or workflow semantics"],"qualityBar":["Do not call done until Vitest and Playwright show 100% coverage with edge cases proving the frontend and backend outcomes"],"riskBoundaries":["Avoid unsafe data mutations, hidden regressions, and premature completion claims"],"uiDirection":""}}',
        "\n---END_BRIEF---",
      ],
    },
  ];
}

function buildRefineScenario(provider: MockProvider): MockCall[] {
  const sessionId = `${provider}-refine-1`;
  return [
    {
      provider,
      promptIncludes: "You are Roscoe's refinement strategist",
      sessionId,
      text: [
        "Roscoe loaded the saved brief and the latest onboarding history.\n\n",
        "---QUESTION---\n",
        '{"question":"Which saved themes need to change together before Roscoe updates the brief?","options":["Definition of done","Delivery pillars","Acceptance checks","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"definition-of-done","purpose":"Roscoe should only touch the parts of the brief that truly need refinement.","selectionMode":"multi"}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's targeted refinement of the saved project brief",
        "Which saved themes need to change together before Roscoe updates the brief?",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "Roscoe has enough to update the saved brief.\n\n",
        "---BRIEF---\n",
        '{"name":"Refine Project","directory":"/ignored","goals":["Ship the operator workflow"],"milestones":["v1"],"techStack":["TypeScript"],"notes":"Existing brief","intentBrief":{"projectStory":"Ship a clean operator workflow","primaryUsers":["Operations teams"],"definitionOfDone":["Operators can complete the incident workflow, including screenshot/video evidence capture when required"],"acceptanceChecks":["The full operator path works and proves the frontend and backend outcomes"],"successSignals":["Operators stay in the product"],"deliveryPillars":{"frontend":["Operator UI completes the workflow"],"backend":["Workflow API persists state correctly"],"unitComponentTests":["Vitest reaches 100% coverage and proves the frontend and backend outcomes across unit and component edge cases"],"e2eTests":["Playwright reaches 100% coverage, proves the full end-to-end frontend/backend workflow, and verifies screenshot/video evidence capture when required"]},"coverageMechanism":["Vitest and Playwright coverage reports with measurable percent gates"],"nonGoals":["No adjacent reporting work"],"constraints":["Keep the locked provider"],"autonomyRules":["Ask before changing scope"],"qualityBar":["100% coverage with edge cases proving the frontend and backend outcomes"],"riskBoundaries":["Avoid hidden regressions"],"uiDirection":"Operator control room"}}',
        "\n---END_BRIEF---",
      ],
    },
  ];
}

function buildSecretRefineScenario(provider: MockProvider): MockCall[] {
  const sessionId = `${provider}-secret-refine-1`;
  return [
    {
      provider,
      promptIncludes: "You are Roscoe's refinement strategist",
      sessionId,
      text: [
        "Roscoe found one immediate delivery blocker.\n\n",
        "---SECRET---\n",
        '{"key":"CF_API_TOKEN","label":"Cloudflare API token","purpose":"Needed to create preview infrastructure for this project.","instructions":["Open Cloudflare and go to API Tokens.","Create a token with the minimum preview permissions.","Copy the token and paste it here securely."],"links":[{"label":"Cloudflare API tokens","url":"https://dash.cloudflare.com/profile/api-tokens"}],"required":true,"targetFile":".env.local"}',
        "\n---END_SECRET---",
      ],
    },
    {
      provider,
      promptIncludesAll: [
        "Continue Roscoe's targeted refinement of the saved project brief",
        "The user securely provided CF_API_TOKEN.",
      ],
      resumeId: sessionId,
      sessionId,
      text: [
        "Roscoe has what it needs.\n\n",
        "---BRIEF---\n",
        '{"name":"Secret Project","directory":"/ignored","goals":["Ship previews safely"],"milestones":["v1"],"techStack":["TypeScript"],"notes":"Need a deployment token for preview infrastructure.","intentBrief":{"projectStory":"Ship previews safely","primaryUsers":["operators"],"definitionOfDone":["Previews can be created and validated."],"acceptanceChecks":["The preview flow can be executed safely."],"successSignals":["Operators can verify builds."],"deliveryPillars":{"frontend":["Preview UI is understandable."],"backend":["Preview API calls work safely."],"unitComponentTests":["Vitest covers the changed preview logic, regressions, and important failure modes at a reasonable level."],"e2eTests":["Playwright covers the preview workflow and critical failure modes at the right stage."]},"coverageMechanism":["Vitest and Playwright"],"nonGoals":["No production rollout work."],"constraints":["Keep secrets local."],"architecturePrinciples":["Keep deployment credentials behind explicit env seams."],"autonomyRules":["Ask before broadening scope."],"qualityBar":["Use reasonable, risk-based proof of changed preview behavior, regressions, and failure modes before calling the slice done."],"riskBoundaries":["Do not leak secrets into logs or committed files."],"uiDirection":""}}',
        "\n---END_BRIEF---",
      ],
    },
  ];
}

function createMockEnv(calls: MockCall[]): MockEnv {
  const root = mkdtempSync(join(tmpdir(), "roscoe-onboard-e2e-"));
  const scenarioPath = join(root, "scenario.json");
  const statePath = join(root, "state.json");
  const logPath = join(root, "invocations.jsonl");
  const projectDir = join(root, "project");
  mkdirSync(projectDir, { recursive: true });

  writeFileSync(scenarioPath, JSON.stringify({ calls }, null, 2));
  writeFileSync(statePath, JSON.stringify({ used: [] }));

  return {
    claudeCommand: createWrapper(root, "claude", scenarioPath, statePath, logPath),
    codexCommand: createWrapper(root, "codex", scenarioPath, statePath, logPath),
    logPath,
    projectDir,
    restore: () => {},
  };
}

function createWrapper(
  root: string,
  provider: MockProvider,
  scenarioPath: string,
  statePath: string,
  logPath: string,
): string {
  const wrapperPath = join(root, provider);
  writeFileSync(
    wrapperPath,
    [
      "#!/bin/sh",
      `export MOCK_LLM_SCENARIO_FILE="${scenarioPath}"`,
      `export MOCK_LLM_STATE_FILE="${statePath}"`,
      `export MOCK_LLM_LOG_FILE="${logPath}"`,
      `exec "${process.execPath}" "${FIXTURE_PATH}" "${provider}" "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

function makeProfile(provider: MockProvider, command: string): HeadlessProfile {
  return {
    name: provider,
    command,
    args: [],
    protocol: provider,
  };
}

function readInvocationLog(logPath: string): Array<{ prompt: string }> {
  const raw = readFileSync(logPath, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as { prompt: string });
}
