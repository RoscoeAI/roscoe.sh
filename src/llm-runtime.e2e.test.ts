import { once } from "events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseGenerator } from "./response-generator.js";
import { SessionMonitor } from "./session-monitor.js";
import { HeadlessProfile } from "./llm-runtime.js";
import { parseQuestion } from "./hooks/use-onboarding.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, "..", "test", "fixtures", "mock-llm-cli.mjs");

type MockProvider = "claude" | "codex" | "gemini";

interface MockCall {
  provider: MockProvider;
  promptIncludes?: string;
  promptIncludesAll?: string[];
  promptExcludesAll?: string[];
  resumeId?: string;
  sessionId?: string;
  text?: string | string[];
  resultText?: string;
  thinking?: string;
  toolActivity?: string;
  toolParameters?: Record<string, unknown>;
  stderr?: string;
  exitCode?: number;
}

interface MockEnv {
  claudeCommand: string;
  codexCommand: string;
  geminiCommand: string;
  logPath: string;
  projectDir: string;
  restore: () => void;
}

describe.sequential("provider e2e", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("monitors a Claude-style session across resumed turns", async () => {
    const env = createMockEnv([
      {
        provider: "claude",
        promptIncludes: "hello claude",
        sessionId: "claude-session-1",
        toolActivity: "Read",
        thinking: "Inspecting files",
        text: ["First turn ", "complete"],
      },
      {
        provider: "claude",
        promptIncludes: "follow up",
        resumeId: "claude-session-1",
        sessionId: "claude-session-1",
        text: "Second turn complete",
      },
    ]);

    try {
      const monitor = new SessionMonitor(
        "worker-claude",
        makeProfile("claude", env.claudeCommand),
        env.projectDir,
      );

      const textChunks: string[] = [];
      const thinkingChunks: string[] = [];
      const tools: string[] = [];

      monitor.on("text", (chunk) => {
        textChunks.push(chunk);
      });
      monitor.on("thinking", (chunk) => {
        thinkingChunks.push(chunk);
      });
      monitor.on("tool-activity", (toolName) => {
        tools.push(toolName);
      });

      const firstTurn = once(monitor, "turn-complete");
      monitor.startTurn("hello claude");
      await firstTurn;

      expect(monitor.getSessionId()).toBe("claude-session-1");
      expect(textChunks.join("")).toContain("First turn complete");
      expect(thinkingChunks.join("")).toContain("Inspecting files");
      expect(tools).toEqual(["Read"]);

      monitor.clearTextBuffer();

      const secondTurn = once(monitor, "turn-complete");
      monitor.sendFollowUp("follow up");
      await secondTurn;

      expect(monitor.getTextBuffer()).toBe("Second turn complete");

      const calls = readInvocationLog(env.logPath);
      expect(calls).toHaveLength(2);
      expect(calls[1].resumeId).toBe("claude-session-1");
    } finally {
      env.restore();
    }
  });

  it("monitors a Codex-style session across resumed turns", async () => {
    const env = createMockEnv([
      {
        provider: "codex",
        promptIncludes: "hello codex",
        sessionId: "codex-thread-1",
        toolActivity: "shell",
        text: "First codex turn",
      },
      {
        provider: "codex",
        promptIncludes: "continue codex",
        resumeId: "codex-thread-1",
        sessionId: "codex-thread-1",
        text: "Second codex turn",
      },
    ]);

    try {
      const monitor = new SessionMonitor(
        "worker-codex",
        makeProfile("codex", env.codexCommand),
        env.projectDir,
      );

      const tools: string[] = [];
      const textChunks: string[] = [];
      monitor.on("tool-activity", (toolName) => {
        tools.push(toolName);
      });
      monitor.on("text", (chunk) => {
        textChunks.push(chunk);
      });

      const firstTurn = once(monitor, "turn-complete");
      monitor.startTurn("hello codex");
      await firstTurn;

      expect(monitor.getSessionId()).toBe("codex-thread-1");
      expect(textChunks.join("")).toContain("First codex turn");
      expect(tools).toEqual(["shell"]);

      monitor.clearTextBuffer();

      const secondTurn = once(monitor, "turn-complete");
      monitor.sendFollowUp("continue codex");
      await secondTurn;

      expect(monitor.getTextBuffer()).toBe("Second codex turn");

      const calls = readInvocationLog(env.logPath);
      expect(calls).toHaveLength(2);
      expect(calls[1].resumeId).toBe("codex-thread-1");
    } finally {
      env.restore();
    }
  });

  it("monitors a Gemini-style session across resumed turns", async () => {
    const env = createMockEnv([
      {
        provider: "gemini",
        promptIncludes: "hello gemini",
        sessionId: "gemini-session-1",
        toolActivity: "list_directory",
        toolParameters: { dir_path: "." },
        text: ["First gemini ", "turn"],
      },
      {
        provider: "gemini",
        promptIncludes: "continue gemini",
        resumeId: "gemini-session-1",
        sessionId: "gemini-session-1",
        text: "Second gemini turn",
      },
    ]);

    try {
      const monitor = new SessionMonitor(
        "worker-gemini",
        makeProfile("gemini", env.geminiCommand),
        env.projectDir,
      );

      const tools: string[] = [];
      const textChunks: string[] = [];
      monitor.on("tool-activity", (toolName) => {
        tools.push(toolName);
      });
      monitor.on("text", (chunk) => {
        textChunks.push(chunk);
      });

      const firstTurn = once(monitor, "turn-complete");
      monitor.startTurn("hello gemini");
      await firstTurn;

      expect(monitor.getSessionId()).toBe("gemini-session-1");
      expect(textChunks.join("")).toContain("First gemini turn");
      expect(tools).toEqual(["list_directory"]);

      monitor.clearTextBuffer();

      const secondTurn = once(monitor, "turn-complete");
      monitor.sendFollowUp("continue gemini");
      await secondTurn;

      expect(monitor.getTextBuffer()).toBe("Second gemini turn");

      const calls = readInvocationLog(env.logPath);
      expect(calls).toHaveLength(2);
      expect(calls[1].resumeId).toBe("gemini-session-1");
    } finally {
      env.restore();
    }
  });

  it.each([
    {
      provider: "claude" as const,
      call: {
        provider: "claude" as const,
        promptIncludesAll: [
          "This is the persistent hidden Roscoe responder thread",
          "Respond in this EXACT JSON format",
          "User: hello",
        ],
        sessionId: "claude-roscoe-1",
        text: [
          '{"message":"Ship it","confidence":88,',
          '"reasoning":"clear next step","browserActions":[{"type":"snapshot","params":{},"description":"inspect"}]}',
        ],
      },
    },
    {
      provider: "codex" as const,
      call: {
        provider: "codex" as const,
        promptIncludesAll: [
          "This is the persistent hidden Roscoe responder thread",
          "Respond in this EXACT JSON format",
          "User: hello",
        ],
        sessionId: "codex-roscoe-1",
        text: '{"message":"Ship it","confidence":88,"reasoning":"clear next step","browserActions":[{"type":"snapshot","params":{},"description":"inspect"}]}',
      },
    },
    {
      provider: "gemini" as const,
      call: {
        provider: "gemini" as const,
        promptIncludesAll: [
          "This is the persistent hidden Roscoe responder thread",
          "Respond in this EXACT JSON format",
          "User: hello",
        ],
        sessionId: "gemini-roscoe-1",
        text: ['{"message":"Ship it","confidence":88,"reasoning":"clear next step","browserActions":[{"type":"snapshot","params":{},"description":"inspect"}]}'],
      },
    },
  ])("generates suggestions through the %s runtime", async ({ provider, call }) => {
    const env = createMockEnv([call]);

    try {
      const generator = new ResponseGenerator();
      const partials: string[] = [];
      const profile = makeProfile(
        provider,
        provider === "claude" ? env.claudeCommand : provider === "codex" ? env.codexCommand : env.geminiCommand,
      );
      const responderMonitor = new SessionMonitor(
        `responder-${provider}`,
        profile,
        env.projectDir,
      );

      const result = await generator.generateSuggestion(
        "User: hello\n\nLLM: hi",
        provider,
        {
          profile,
          profileName: provider,
          projectName: "demo",
          projectDir: env.projectDir,
          worktreePath: env.projectDir,
          worktreeName: "main",
          responderMonitor,
          responderHistory: [
            { role: "assistant", content: "hi", timestamp: 1 },
          ],
          responderHistoryCursor: 0,
        },
        (partial) => {
          partials.push(partial);
        },
      );

      expect(result.text).toBe("Ship it");
      expect(result.confidence).toBe(88);
      expect(result.reasoning).toBe("clear next step");
      expect(result.browserActions?.[0]?.type).toBe("snapshot");
      expect(partials.length).toBeGreaterThan(0);
    } finally {
      env.restore();
    }
  }, 15_000);

  it.each(["claude", "codex", "gemini"] as const)("onboards a project with %s", async (provider) => {
    const env = createMockEnv(buildOnboardingScenario(provider));

    const previousHome = process.env.HOME;
    process.env.HOME = env.projectDir;
    vi.resetModules();

    try {
      const { Onboarder } = await import("./onboarder.js");

      const profile = makeProfile(
        provider,
        provider === "claude" ? env.claudeCommand : provider === "codex" ? env.codexCommand : env.geminiCommand,
      );
      const onboarder = new Onboarder(env.projectDir, false, profile);

      let output = "";
      onboarder.on("output", (chunk: string) => {
        output += chunk;
      });

      const interview = [
        {
          question: "What product story should Roscoe optimize for?",
          theme: "project-story",
          answer: "Ship a clean operator workflow",
        },
        {
          question: "Who are the primary users Roscoe should optimize for?",
          theme: "primary-users",
          answer: "Operations teams",
        },
        {
          question: "What is the definition of done Roscoe should defend?",
          theme: "definition-of-done",
          answer: "The operator can finish the core workflow inside the product",
        },
        {
          question: "What proof should Roscoe require before calling this done?",
          theme: "acceptance-checks",
          answer: "A full demo path works end to end",
        },
        {
          question: "How should Roscoe define the delivery pillars across frontend, backend, unit/component tests, and e2e tests?",
          theme: "delivery-pillars",
          answer: "Frontend and backend outcomes must be proven by Vitest unit/component and Playwright e2e coverage",
        },
        {
          question: "What non goals should Roscoe hold the line on?",
          theme: "non-goals",
          answer: "Do not expand into reporting or redesign adjacent surfaces",
        },
        {
          question: "What autonomy rules should Roscoe follow when Guild sessions hit ambiguity?",
          theme: "autonomy-rules",
          answer: "Ask before changing scope or workflow semantics",
        },
        {
          question: "What quality bar should Roscoe enforce before Guild work is considered done?",
          theme: "quality-bar",
          answer: "Do not call done until Vitest and Playwright show 100% coverage with edge cases proving the frontend and backend outcomes",
        },
        {
          question: "How will Roscoe measure coverage percent in this repo?",
          theme: "coverage-mechanism",
          answer: "Vitest and Playwright coverage reports provide the measurable percent gate",
        },
        {
          question: "What risks should Roscoe avoid without explicit approval?",
          theme: "risk-boundaries",
          answer: "Avoid hidden regressions and unsafe data mutations",
        },
      ] as const;

      const firstTurn = once(onboarder, "turn-complete");
      onboarder.start();
      await firstTurn;
      expect(parseQuestion(output)?.theme).toBe(interview[0].theme);

      for (let i = 0; i < interview.length - 1; i += 1) {
        output = "";
        const turnDone = once(onboarder, "turn-complete");
        onboarder.sendInput(interview[i].answer, {
          question: interview[i].question,
          theme: interview[i].theme,
        });
        await turnDone;
        expect(parseQuestion(output)?.theme).toBe(interview[i + 1].theme);
      }

      output = "";
      const completed = once(onboarder, "onboarding-complete");
      const finalStep = interview[interview.length - 1];
      onboarder.sendInput(finalStep.answer, {
        question: finalStep.question,
        theme: finalStep.theme,
      });
      const [context] = await completed as [{ name: string; directory: string }];
      expect(context.name).toBe("Demo Project");
      expect(context.directory).toBe(env.projectDir);

      const briefPath = join(env.projectDir, ".roscoe", "project.json");
      expect(existsSync(briefPath)).toBe(true);
      expect(JSON.parse(readFileSync(briefPath, "utf-8")).name).toBe("Demo Project");

      const registryPath = join(env.projectDir, ".roscoe", "projects.json");
      expect(existsSync(registryPath)).toBe(true);
    } finally {
      env.restore();
      process.env.HOME = previousHome;
      vi.resetModules();
    }
  });
});

function createMockEnv(calls: MockCall[]): MockEnv {
  const root = mkdtempSync(join(tmpdir(), "roscoe-e2e-"));
  const scenarioPath = join(root, "scenario.json");
  const statePath = join(root, "state.json");
  const logPath = join(root, "invocations.jsonl");
  const projectDir = join(root, "project");
  mkdirSync(projectDir, { recursive: true });

  writeFileSync(scenarioPath, JSON.stringify({ calls }, null, 2));
  writeFileSync(statePath, JSON.stringify({ index: 0 }));

  return {
    claudeCommand: createWrapper(root, "claude", scenarioPath, statePath, logPath),
    codexCommand: createWrapper(root, "codex", scenarioPath, statePath, logPath),
    geminiCommand: createWrapper(root, "gemini", scenarioPath, statePath, logPath),
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

function buildOnboardingScenario(provider: MockProvider): MockCall[] {
  const sessionId = `${provider}-onboard-1`;
  return [
    {
      provider,
      promptIncludes: "PHASE 1: Explore the codebase FIRST",
      sessionId,
      text: [
        "Roscoe inspected the repo and found an operator-facing workflow with product scope decisions still open.\n\n",
        "---QUESTION---\n",
        '{"question":"What product story should Roscoe optimize for?","options":["Ship a clean operator workflow","Broaden the platform surface","Favor internal demos","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"project-story","purpose":"Roscoe needs the core mission before it can guide Guild tradeoffs."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludes: "Continue Roscoe's codebase-grounded intent interview",
      resumeId: sessionId,
      sessionId,
      text: [
        "That sharpens the mission.\n\n",
        "---QUESTION---\n",
        '{"question":"Who are the primary users Roscoe should optimize for?","options":["Operations teams","End customers","Internal developers","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"primary-users","purpose":"User identity determines which compromises Roscoe should accept."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludes: "Continue Roscoe's codebase-grounded intent interview",
      resumeId: sessionId,
      sessionId,
      text: [
        "That makes the audience explicit.\n\n",
        "---QUESTION---\n",
        '{"question":"What is the definition of done Roscoe should defend?","options":["The core workflow works end to end","Visual polish alone","Wider feature breadth","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"definition-of-done","purpose":"Roscoe needs the end-state, not just a list of tasks."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludes: "Continue Roscoe's codebase-grounded intent interview",
      resumeId: sessionId,
      sessionId,
      text: [
        "That defines the outcome, but Roscoe still needs proof.\n\n",
        "---QUESTION---\n",
        '{"question":"What proof should Roscoe require before calling this done?","options":["A full demo path works end to end","Unit tests alone are enough","A visual review is enough","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"acceptance-checks","purpose":"Roscoe needs evidence that the work is truly complete."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludes: "Continue Roscoe's codebase-grounded intent interview",
      resumeId: sessionId,
      sessionId,
      text: [
        "That makes the completion proof concrete.\n\n",
        "---QUESTION---\n",
        '{"question":"How should Roscoe define the delivery pillars across frontend, backend, unit/component tests, and e2e tests?","options":["Frontend/backend outcomes must be proven by Vitest unit/component and Playwright e2e coverage","Frontend alone is enough","Backend alone is enough","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"delivery-pillars","purpose":"Roscoe needs the four-pillar proof chain before it can trust a completion claim."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludes: "Continue Roscoe's codebase-grounded intent interview",
      resumeId: sessionId,
      sessionId,
      text: [
        "That locks the four delivery pillars.\n\n",
        "---QUESTION---\n",
        '{"question":"What non goals should Roscoe hold the line on?","options":["Avoid adjacent reporting work","Expand into every admin surface","Rewrite the stack","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"non-goals","purpose":"Roscoe needs explicit scope boundaries before it can steer Guild work."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludes: "Continue Roscoe's codebase-grounded intent interview",
      resumeId: sessionId,
      sessionId,
      text: [
        "That sets the scope edge.\n\n",
        "---QUESTION---\n",
        '{"question":"What autonomy rules should Roscoe follow when Guild sessions hit ambiguity?","options":["Ask before changing scope","Decide everything autonomously","Pause only for production incidents","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"autonomy-rules","purpose":"Roscoe needs clear escalation boundaries."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludes: "Continue Roscoe's codebase-grounded intent interview",
      resumeId: sessionId,
      sessionId,
      text: [
        "That sets Roscoe's operating guardrails.\n\n",
        "---QUESTION---\n",
        '{"question":"What quality bar should Roscoe enforce before Guild work is considered done?","options":["100% Vitest and Playwright coverage with edge cases proving frontend/backend outcomes","Compile cleanly","Ship after visual polish","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"quality-bar","purpose":"Roscoe needs a repeatable standard for completion."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludes: "Continue Roscoe's codebase-grounded intent interview",
      resumeId: sessionId,
      sessionId,
      text: [
        "That sharpens the completion bar.\n\n",
        "---QUESTION---\n",
        '{"question":"How will Roscoe measure coverage percent in this repo?","options":["Vitest and Playwright coverage reports","Add a repo-native coverage tool if missing","Manual spot checks only","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"coverage-mechanism","purpose":"Roscoe needs a measurable coverage percentage before it can call work done."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludes: "Continue Roscoe's codebase-grounded intent interview",
      resumeId: sessionId,
      sessionId,
      text: [
        "That gives Roscoe a measurable gate.\n\n",
        "---QUESTION---\n",
        '{"question":"What risks should Roscoe avoid without explicit approval?","options":["Hidden regressions and unsafe data mutations","Minor copy edits","Routine refactors","Other (I\'ll explain)","Skip — use your best judgment and check in on critical decisions"],"theme":"risk-boundaries","purpose":"Roscoe must know which failures are unacceptable."}',
        "\n---END_QUESTION---",
      ],
    },
    {
      provider,
      promptIncludes: "Continue Roscoe's codebase-grounded intent interview",
      resumeId: sessionId,
      sessionId,
      text: [
        "Roscoe now has a grounded intent map.\n\n",
        "---BRIEF---\n",
        '{"name":"Demo Project","directory":"/ignored","goals":["Ship the operator workflow"],"milestones":["v1"],"techStack":["TypeScript"],"notes":"Roscoe should keep the scope narrow and operator-focused.","intentBrief":{"projectStory":"Ship a clean operator workflow","primaryUsers":["Operations teams"],"definitionOfDone":["The frontend operator flow and backend workflow logic behave correctly inside the product"],"acceptanceChecks":["Vitest unit/component and Playwright e2e runs prove the full workflow end to end"],"successSignals":["Operators stay inside the product for the core flow"],"deliveryPillars":{"frontend":["Frontend operator flow completes cleanly for the core incident journey"],"backend":["Backend workflow API validates and persists the incident journey correctly"],"unitComponentTests":["Vitest unit/component coverage reaches 100% across frontend/backend logic and edge cases"],"e2eTests":["Playwright e2e coverage reaches 100% across workflow success and failure modes"]},"coverageMechanism":["Vitest plus Playwright coverage reports provide the measurable percent gate for this repo"],"nonGoals":["Do not expand into reporting or redesign adjacent surfaces"],"constraints":["Maintain compatibility with the current flow"],"autonomyRules":["Ask before changing scope or workflow semantics"],"qualityBar":["Do not call done until Vitest and Playwright show 100% coverage with edge cases proving the frontend and backend outcomes"],"riskBoundaries":["Avoid hidden regressions and unsafe data mutations"],"uiDirection":""}}',
        "\n---END_BRIEF---",
      ],
    },
  ];
}

function makeProfile(provider: MockProvider, command: string): HeadlessProfile {
  return {
    name: provider,
    command,
    args: [],
    protocol: provider,
  };
}

function readInvocationLog(logPath: string): Array<{ resumeId: string | null }> {
  const raw = readFileSync(logPath, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as { resumeId: string | null });
}
