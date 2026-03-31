import React from "react";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
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
        promptIncludesAll: [
          "This is the persistent hidden Roscoe responder thread",
          "Respond in this EXACT JSON format",
          "Initial plan",
        ],
        promptExcludesAll: [
          "=== Incremental Lane Delta ===",
        ],
        sessionId: `${provider}-roscoe-tui-1`,
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
        promptIncludesAll: [
          "Continue as Roscoe for this same Guild lane.",
          "=== Incremental Lane Delta ===",
          "Follow-up completed",
          "Respond in this EXACT JSON format",
        ],
        resumeId: `${provider}-roscoe-tui-1`,
        sessionId: `${provider}-roscoe-tui-1`,
        text: '{"message":"Manual review remaining","confidence":61,"reasoning":"verify before sending"}',
      },
      {
        provider,
        promptIncludes: "Summarize what this AI coding session just accomplished",
        text: "Finished follow-up",
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
        frame.includes("Command Deck") &&
        frame.includes("Roscoe draft to the Guild") &&
        frame.includes("Continue with tests") &&
        frame.includes("92/100") &&
        frame.includes("approval required"),
      );

      expect(app.lastFrame()).toContain("[MANUAL]");

      await delay(50);
      app.stdin.write("a");

      await waitForInvocationMatch(
        env.logPath,
        (calls) => calls.some((call) => call.resumeId === `${provider}-tui-1`),
      );
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

  it.each(["claude", "codex"] as const)("resumes the same native conversation after relaunch with %s", async (provider) => {
    const env = createMockEnv([
      {
        provider,
        promptIncludes: "You are a Guild coding agent",
        sessionId: `${provider}-persist-1`,
        text: provider === "claude" ? ["Initial plan\n"] : "Initial plan\n",
      },
      {
        provider,
        promptIncludesAll: [
          "This is the persistent hidden Roscoe responder thread",
          "Respond in this EXACT JSON format",
          "Initial plan",
        ],
        promptExcludesAll: [
          "=== Incremental Lane Delta ===",
        ],
        sessionId: `${provider}-roscoe-persist-1`,
        text: '{"message":"Continue with the saved lane","confidence":88,"reasoning":"existing thread already has context"}',
      },
      {
        provider,
        promptIncludes: "Summarize what this AI coding session just accomplished",
        text: "Mapped the repo",
      },
      {
        provider,
        promptIncludes: "Continue with the saved lane",
        resumeId: `${provider}-persist-1`,
        sessionId: `${provider}-persist-1`,
        text: provider === "claude" ? ["Resumed okay\n"] : "Resumed okay\n",
      },
      {
        provider,
        promptIncludesAll: [
          "Continue as Roscoe for this same Guild lane.",
          "=== Incremental Lane Delta ===",
          "Resumed okay",
          "Respond in this EXACT JSON format",
        ],
        resumeId: `${provider}-roscoe-persist-1`,
        sessionId: `${provider}-roscoe-persist-1`,
        text: '{"message":"Manual review remaining","confidence":61,"reasoning":"verify before sending"}',
      },
      {
        provider,
        promptIncludes: "Summarize what this AI coding session just accomplished",
        text: "Resumed okay",
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

    const firstApp = render(
      <App
        initialScreen="session-view"
        startSpecs={[`${provider}@${env.projectDir}`]}
      />,
    );

    try {
      await waitForFrame(firstApp.lastFrame, (frame) => frame.includes("Continue with the saved lane"));
      firstApp.unmount();

      const secondApp = render(
        <App
          initialScreen="session-view"
          startSpecs={[`${provider}@${env.projectDir}`]}
        />,
      );

      try {
        await waitForFrame(secondApp.lastFrame, (frame) => frame.includes("Continue with the saved lane"));
        await delay(50);
        secondApp.stdin.write("a");
        await waitForInvocationMatch(
          env.logPath,
          (calls) => calls.some((call) => call.resumeId === `${provider}-persist-1`),
        );

        const calls = readInvocationLog(env.logPath);
        expect(calls.some((call) => call.resumeId === `${provider}-persist-1`)).toBe(true);
      } finally {
        secondApp.unmount();
      }
    } finally {
      env.restore();
    }
  }, 15000);

  it.each(["claude", "codex"] as const)("restages an interrupted Guild turn after relaunch with %s", async (provider) => {
    const env = createMockEnv([
      {
        provider,
        promptIncludesAll: [
          "Roscoe restarted this lane while your previous turn was interrupted",
          "Last stable Roscoe handoff",
          "Keep the scope narrow and rerun only the targeted proof.",
        ],
        resumeId: `${provider}-interrupted-1`,
        sessionId: `${provider}-interrupted-1`,
        text: provider === "claude" ? ["Picked back up cleanly\n"] : "Picked back up cleanly\n",
      },
      {
        provider,
        promptIncludesAll: [
          "Continue as Roscoe for this same Guild lane.",
          "=== Incremental Lane Delta ===",
          "Picked back up cleanly",
          "Respond in this EXACT JSON format",
        ],
        resumeId: `${provider}-roscoe-interrupted-1`,
        sessionId: `${provider}-roscoe-interrupted-1`,
        text: '{"message":"Recovered after restart","confidence":83,"reasoning":"the interrupted worker lane resumed cleanly"}',
      },
      {
        provider,
        promptIncludes: "Summarize what this AI coding session just accomplished",
        text: "Recovered lane",
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
    vi.spyOn(config, "loadLaneSession").mockReturnValue({
      laneKey: "lane",
      projectDir: env.projectDir,
      projectName: "Demo Project",
      worktreePath: env.projectDir,
      worktreeName: "main",
      profileName: provider,
      protocol: provider,
      providerSessionId: `${provider}-interrupted-1`,
      responderProtocol: provider,
      responderSessionId: `${provider}-roscoe-interrupted-1`,
      trackerHistory: [
        { role: "assistant", content: "Initial plan", timestamp: 1 },
        { role: "user", content: "Keep the scope narrow and rerun only the targeted proof.", timestamp: 2 },
      ],
      responderHistoryCursor: 2,
      timeline: [
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 10,
          provider,
          text: "Initial plan",
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
      summary: "Mapped the repo",
      currentToolUse: "Bash",
      currentToolDetail: "bash · npm run test -- targeted",
      startedAt: "2026-03-27T00:00:00.000Z",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      rateLimitStatus: null,
      savedAt: "2026-03-27T00:00:00.000Z",
    } as any);

    const app = render(
      <App
        initialScreen="session-view"
        startSpecs={[`${provider}@${env.projectDir}`]}
      />,
    );

    try {
      await waitForInvocationMatch(
        env.logPath,
        (calls) => calls.some((call) => call.resumeId === `${provider}-interrupted-1`),
      );
      await waitForFrame(app.lastFrame, (frame) => frame.includes("Recovered after restart"));

      const calls = readInvocationLog(env.logPath);
      const resumedWorkerCall = calls.find((call) => call.resumeId === `${provider}-interrupted-1`);
      expect(resumedWorkerCall).toBeTruthy();
      expect(resumedWorkerCall?.prompt).toContain("Roscoe restarted this lane while your previous turn was interrupted");
      expect(app.lastFrame()).not.toContain("running shell commands now");
    } finally {
      app.unmount();
      env.restore();
    }
  }, 15000);

  it.each(["claude", "codex"] as const)("recovers a clean worker exit without leaving stale tool activity after relaunch with %s", async (provider) => {
    const env = createMockEnv([
      {
        provider,
        promptIncludesAll: [
          "Roscoe restarted this lane while your previous turn was interrupted",
          "Last stable Roscoe handoff",
          "Run the focused chat-interface proof and stop at preview.",
        ],
        resumeId: `${provider}-clean-exit-1`,
        sessionId: `${provider}-clean-exit-1`,
        toolActivity: provider === "claude" ? "Bash" : "bash",
        skipCompletion: true,
      },
      {
        provider,
        promptIncludesAll: [
          "The Guild turn exited before reporting back",
          "Last stable Roscoe handoff",
          "Run the focused chat-interface proof and stop at preview.",
        ],
        resumeId: `${provider}-clean-exit-1`,
        sessionId: `${provider}-clean-exit-1`,
        text: provider === "claude"
          ? ["Focused proof completed cleanly.\n", "npm run dev\n"]
          : "Focused proof completed cleanly.\nnpm run dev\n",
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
    vi.spyOn(config, "loadLaneSession").mockReturnValue({
      laneKey: "lane",
      projectDir: env.projectDir,
      projectName: "Demo Project",
      worktreePath: env.projectDir,
      worktreeName: "main",
      profileName: provider,
      protocol: provider,
      providerSessionId: `${provider}-clean-exit-1`,
      responderProtocol: provider,
      responderSessionId: `${provider}-roscoe-clean-exit-1`,
      trackerHistory: [
        { role: "assistant", content: "Initial plan", timestamp: 1 },
        { role: "user", content: "Run the focused chat-interface proof and stop at preview.", timestamp: 2 },
      ],
      responderHistoryCursor: 2,
      timeline: [
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 10,
          provider,
          text: "Initial plan",
        },
        {
          id: "local-1",
          kind: "local-sent",
          timestamp: 11,
          text: "Run the focused chat-interface proof and stop at preview.",
          delivery: "auto",
        },
      ],
      preview: {
        mode: "queued",
        message: "Preview queued. Roscoe will stop this lane at the next clean handoff and hold there until you continue.",
        link: null,
      },
      outputLines: ["running focused proof"],
      summary: "Mapped the repo",
      currentToolUse: "Bash",
      currentToolDetail: "bash · node ./node_modules/vitest/vitest.mjs run tests/proof/chat-interface.contract.test.tsx",
      startedAt: "2026-03-27T00:00:00.000Z",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      rateLimitStatus: null,
      savedAt: "2026-03-27T00:00:00.000Z",
    } as any);

    const app = render(
      <App
        initialScreen="session-view"
        startSpecs={[`${provider}@${env.projectDir}`]}
      />,
    );

    try {
      await waitForInvocationMatch(
        env.logPath,
        (calls) => calls.filter((call) => call.resumeId === `${provider}-clean-exit-1`).length >= 2,
      );
      await waitForFrame(app.lastFrame, (frame) => frame.includes("Preview ready."));

      const calls = readInvocationLog(env.logPath);
      expect(calls.filter((call) => call.resumeId === `${provider}-clean-exit-1`)).toHaveLength(2);
      expect(app.lastFrame()).not.toContain("running shell commands now");
      expect(app.lastFrame()).not.toContain("Working now");
    } finally {
      app.unmount();
      env.restore();
    }
  }, 15000);

  it.each(["claude", "codex"] as const)("restores a lost queued preview from a paused lane without redrafting on relaunch with %s", async (provider) => {
    const env = createMockEnv([]);

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
    vi.spyOn(config, "loadLaneSession").mockReturnValue({
      laneKey: "lane",
      projectDir: env.projectDir,
      projectName: "Demo Project",
      worktreePath: env.projectDir,
      worktreeName: "main",
      profileName: provider,
      protocol: provider,
      providerSessionId: `${provider}-paused-preview-1`,
      responderProtocol: provider,
      responderSessionId: `${provider}-roscoe-paused-preview-1`,
      trackerHistory: [
        { role: "assistant", content: "Ran the focused proof and stopped.", timestamp: 1 },
      ],
      responderHistoryCursor: 1,
      timeline: [
        {
          id: "preview-1",
          kind: "preview",
          timestamp: 10,
          state: "queued",
          text: "Preview queued. Roscoe will stop this lane at the next clean handoff and hold there until you continue.",
          link: null,
        },
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 11,
          provider,
          text: "Paused.",
        },
      ],
      preview: {
        mode: "off",
        message: null,
        link: null,
      },
      outputLines: ["Paused."],
      summary: "Waiting on preview.",
      currentToolUse: null,
      currentToolDetail: null,
      startedAt: "2026-03-27T00:00:00.000Z",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      rateLimitStatus: null,
      savedAt: "2026-03-27T00:00:00.000Z",
    } as any);

    const app = render(
      <App
        initialScreen="session-view"
        startSpecs={[`${provider}@${env.projectDir}`]}
      />,
    );

    try {
      await waitForFrame(app.lastFrame, (frame) =>
        frame.includes("Preview ready.")
        && frame.includes("Preview Break")
        && !frame.includes("Thinking...")
        && !frame.includes("Working now")
      );

      await delay(150);
      expect(readInvocationLog(env.logPath)).toHaveLength(0);
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

function readInvocationLog(logPath: string): Array<{ provider: string; resumeId: string | null; args: string[]; prompt: string }> {
  if (!existsSync(logPath)) return [];
  const raw = readFileSync(logPath, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as { provider: string; resumeId: string | null; args: string[]; prompt: string });
}

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 10000,
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

async function waitForInvocationMatch(
  logPath: string,
  predicate: (calls: Array<{ provider: string; resumeId: string | null; args: string[]; prompt: string }>) => boolean,
  timeoutMs = 10000,
): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const calls = readInvocationLog(logPath);
    if (predicate(calls)) return;
    await delay(25);
  }

  throw new Error(`Timed out waiting for invocation match.\nCurrent log:\n${existsSync(logPath) ? readFileSync(logPath, "utf-8") : "(missing)"}`);
}
