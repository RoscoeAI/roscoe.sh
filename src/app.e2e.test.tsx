import React from "react";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import App from "./app.js";
import * as config from "./config.js";
import { HeadlessProfile } from "./llm-runtime.js";
import { ResponseGenerator } from "./response-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, "..", "test", "fixtures", "mock-llm-cli.mjs");

type MockProvider = "claude" | "codex";

interface MockEnv {
  claudeCommand: string;
  codexCommand: string;
  logPath: string;
  projectDir: string;
  restore: () => void;
}

describe.sequential("Ink app e2e", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["claude", "codex"] as const)("runs the full mocked session loop with %s", async (provider) => {
    const env = createMockEnv([
      {
        provider,
        promptIncludes: "You are a Guild coding agent",
        sessionId: `${provider}-tui-1`,
        text: provider === "claude"
          ? ["Initial plan\n", "- inspect repo\n"]
          : "Initial plan\n- inspect repo\n",
      },
      {
        provider,
        promptIncludes: "Respond in this EXACT JSON format",
        text: '{"message":"Continue with tests","confidence":92,"reasoning":"high signal"}',
      },
      {
        provider,
        promptIncludes: "Summarize what this AI coding session just accomplished",
        text: "Mapped the repo",
      },
      {
        provider,
        promptIncludes: "Continue with tests",
        resumeId: `${provider}-tui-1`,
        sessionId: `${provider}-tui-1`,
        text: provider === "claude" ? ["Follow-up ", "completed"] : "Follow-up completed",
      },
      {
        provider,
        promptIncludes: "Respond in this EXACT JSON format",
        text: '{"message":"Manual review remaining","confidence":61,"reasoning":"verify before sending"}',
      },
    ]);

    vi.spyOn(ResponseGenerator.prototype, "readClaudeTranscript").mockReturnValue([]);
    vi.spyOn(ResponseGenerator.prototype, "readCodexTranscript").mockReturnValue([]);

    const profile = makeProfile(
      provider,
      provider === "claude" ? env.claudeCommand : env.codexCommand,
    );

    vi.spyOn(config, "loadProfile").mockImplementation((name: string) => {
      if (name !== provider) {
        throw new Error(`Unexpected profile ${name}`);
      }
      return profile;
    });
    vi.spyOn(config, "loadProjectContext").mockReturnValue({
      name: "Demo Project",
      directory: env.projectDir,
      goals: ["Ship a clean UX"],
      milestones: ["First release"],
      techStack: ["TypeScript", "Ink"],
      notes: "Keep the flow keyboard-first.",
    });

    const app = render(
      <App
        initialScreen="session-view"
        startSpecs={[`${provider}@${env.projectDir}`]}
        startRuntimeOverrides={{
          [provider]: provider === "claude"
            ? {
                model: "claude-opus-4-6",
                reasoningEffort: "high",
                permissionMode: "auto",
              }
            : {
                model: "gpt-5.4",
                reasoningEffort: "xhigh",
                sandboxMode: "workspace-write",
                approvalPolicy: "never",
              },
        }}
      />,
    );

    try {
      await waitForFrame(app.lastFrame, (frame) =>
        frame.includes("Prompt:") &&
        frame.includes("Continue with tests") &&
        frame.includes("92/100"),
      );

      expect(app.lastFrame()).toContain("auto-deep-analysis");
      expect(app.lastFrame()).toContain(provider === "claude" ? "claude-opus-4-6" : "gpt-5.4");

      await delay(50);
      app.stdin.write("a");

      await waitForInvocationCount(env.logPath, 4);
      await waitForFrame(app.lastFrame, (frame) => frame.includes("Follow-up completed"));
      await waitForFrame(app.lastFrame, (frame) => frame.includes("Manual review remaining"));

      const calls = readInvocationLog(env.logPath);
      expect(calls.some((call) => call.resumeId === `${provider}-tui-1`)).toBe(true);
      const workerCall = calls.find((call) => call.provider === provider && call.resumeId === null)!;
      expect(workerCall.args).toEqual(
        expect.arrayContaining(
          provider === "claude"
            ? ["--model", "claude-opus-4-6", "--effort", "max"]
            : ["-m", "gpt-5.4", "-c", 'model_reasoning_effort="xhigh"', "-s", "workspace-write", "-a", "never"],
        ),
      );
    } finally {
      app.unmount();
      env.restore();
    }
  }, 15000);
});

function createMockEnv(calls: Array<Record<string, unknown>>): MockEnv {
  const root = mkdtempSync(join(tmpdir(), "roscoe-app-e2e-"));
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

function readInvocationLog(logPath: string): Array<{ provider: string; resumeId: string | null; args: string[] }> {
  const raw = readFileSync(logPath, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as { provider: string; resumeId: string | null; args: string[] });
}

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const frame = lastFrame();
    if (frame && predicate(frame)) return;
    await delay(25);
  }

  throw new Error(`Timed out waiting for frame.\nLast frame:\n${lastFrame() ?? "(empty)"}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForInvocationCount(logPath: string, expected: number, timeoutMs = 5000): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (readInvocationLog(logPath).length >= expected) return;
    await delay(25);
  }

  throw new Error(`Timed out waiting for ${expected} invocations.\nCurrent log:\n${readFileSync(logPath, "utf-8")}`);
}
