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
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
  chunkDelayMs?: number;
}

interface ProjectSpec {
  label: string;
  projectName: string;
  appName: string;
  provider: MockProvider;
  directory: string;
  sessionId: string;
}

interface MockEnv {
  root: string;
  logPath: string;
  claudeCommand: string;
  codexCommand: string;
  projects: Record<string, ProjectSpec>;
  restore: () => void;
}

describe.sequential("multi-session Ink e2e", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drives four concurrent conversations through errors, low confidence, and human intervention until all apps are working", async () => {
    const env = createMultiSessionEnv();
    const claudeProfile = makeProfile("claude", env.claudeCommand);
    const codexProfile = makeProfile("codex", env.codexCommand);

    vi.spyOn(ResponseGenerator.prototype, "readClaudeTranscript").mockReturnValue([]);
    vi.spyOn(ResponseGenerator.prototype, "readCodexTranscript").mockReturnValue([]);

    vi.spyOn(config, "loadProfile").mockImplementation((name: string) => {
      if (name === "claude") return claudeProfile;
      if (name === "codex") return codexProfile;
      throw new Error(`Unexpected profile ${name}`);
    });

    const startSpecs = [
      `claude@${env.projects.pulse.directory}`,
      `claude@${env.projects.orbit.directory}`,
      `codex@${env.projects.atlas.directory}`,
      `codex@${env.projects.relay.directory}`,
    ];

    const app = render(
      <App
        initialScreen="session-view"
        startSpecs={startSpecs}
        initialAutoMode={true}
      />,
    );

    try {
      await waitForFrame(app.lastFrame, (frame) =>
        frame.includes("pulse") &&
        frame.includes("Command Deck") &&
        frame.includes("Roscoe draft to the Guild"),
      );
      expect(app.lastFrame()).toContain("[AUTO]");

      await retryError(app, "orbit", "Transient sidecar timeout");
      await manualInput(
        app,
        "atlas",
        "Decide whether history should stay linear",
        "Implement branch-aware version history with restore previews and keep backlink updates rename-safe.",
      );
      await approveSuggestion(
        app,
        env.logPath,
        "pulse",
        "Finish collaborative filters before polishing",
      );
      await manualInput(
        app,
        "orbit",
        "Tighten role filters",
        "Lock down role filters for admin and manager saved views, then finish anomaly drill-down and export parity.",
      );
      await retryError(app, "relay", "Mock schema resolver crashed");
      await approveSuggestion(
        app,
        env.logPath,
        "relay",
        "Add secrets masking",
      );
      await approveSuggestion(
        app,
        env.logPath,
        "orbit",
        "Run a production sanity pass",
      );

      await waitForInvocationCount(env.logPath, 46, 60000);

      await assertSessionSuggestion(
        app,
        "pulse",
        "Ask for a final demo checklist and release-note pass.",
      );
      await assertSessionSuggestion(
        app,
        "orbit",
        "Ask for release notes and an operator handoff checklist.",
      );
      await assertSessionSuggestion(
        app,
        "atlas",
        "Ask whether to add onboarding docs for power users.",
      );
      await assertSessionSuggestion(
        app,
        "relay",
        "Ask for a launch checklist and docs review.",
      );

      const invocations = readInvocationLog(env.logPath);
      expect(invocations).toHaveLength(46);
      expect(invocations.some((entry) => entry.noMatch)).toBe(false);
      expect(invocations.filter((entry) => entry.provider === "claude").length).toBeGreaterThan(0);
      expect(invocations.filter((entry) => entry.provider === "codex").length).toBeGreaterThan(0);
      expect(invocations.filter((entry) => entry.resumeId !== null).length).toBeGreaterThanOrEqual(16);
      expect(invocations.some((entry) => entry.matchedIndex === 10)).toBe(true);
      expect(invocations.some((entry) => entry.matchedIndex === 22)).toBe(true);
      expect(invocations.some((entry) => entry.matchedIndex === 33)).toBe(true);
      expect(invocations.some((entry) => entry.matchedIndex === 45)).toBe(true);
    } finally {
      app.unmount();
      env.restore();
    }
  }, 70000);
});

function createMultiSessionEnv(): MockEnv {
  const root = mkdtempSync(join(tmpdir(), "roscoe-multi-e2e-"));
  const scenarioPath = join(root, "scenario.json");
  const statePath = join(root, "state.json");
  const logPath = join(root, "invocations.jsonl");
  const projectsDir = join(root, "projects");
  mkdirSync(projectsDir, { recursive: true });

  const projects: Record<string, ProjectSpec> = {
    pulse: createProject(root, projectsDir, "pulse", "Pulse Kanban", "claude", "pulse-session"),
    orbit: createProject(root, projectsDir, "orbit", "Orbit Metrics", "claude", "orbit-session"),
    atlas: createProject(root, projectsDir, "atlas", "Atlas Wiki", "codex", "atlas-session"),
    relay: createProject(root, projectsDir, "relay", "Relay Playground", "codex", "relay-session"),
  };

  const calls = buildScenario(projects);
  writeFileSync(scenarioPath, JSON.stringify({ calls }, null, 2));
  writeFileSync(statePath, JSON.stringify({ used: [] }));

  return {
    root,
    logPath,
    claudeCommand: createWrapper(root, "claude", scenarioPath, statePath, logPath),
    codexCommand: createWrapper(root, "codex", scenarioPath, statePath, logPath),
    projects,
    restore: () => {},
  };
}

function createProject(
  root: string,
  projectsDir: string,
  label: string,
  appName: string,
  provider: MockProvider,
  sessionId: string,
): ProjectSpec {
  const directory = join(projectsDir, label);
  mkdirSync(join(directory, ".roscoe"), { recursive: true });
  writeFileSync(
    join(directory, ".roscoe", "project.json"),
    JSON.stringify({
      name: label,
      directory,
      goals: [`Ship ${appName}`, "Keep the workflow keyboard-first", "Leave a demoable operator surface"],
      milestones: ["Scaffold core flows", "Stabilize edge cases", "Verify launch-ready state"],
      techStack: ["TypeScript", "Ink", provider === "claude" ? "React" : "Node"],
      notes: `${appName} should feel production-ready and survive real operator usage.`,
    }, null, 2),
  );

  return {
    label,
    projectName: label,
    appName,
    provider,
    directory,
    sessionId,
  };
}

function buildScenario(projects: Record<string, ProjectSpec>): MockCall[] {
  const pulse = projects.pulse;
  const orbit = projects.orbit;
  const atlas = projects.atlas;
  const relay = projects.relay;

  return [
    initialWorkerCall(pulse, [
      "Pulse Kanban scaffold is up.",
      "- Board lanes render from seeded data.",
      "- Drag handles and persistence shell are in place.",
      "- Need keyboard movement, offline queue, and PWA verification.",
    ], 20),
    summaryCall(pulse, "Pulse Kanban scaffold is up.", "Bootstrapped kanban shell"),
    responderSeedSuggestionCall(pulse, "Need keyboard movement, offline queue, and PWA verification.", "Wire keyboard moves, hard-refresh persistence, and the offline queue before visual polish.", 94, "clear implementation path"),
    followUpWorkerCall(pulse, "Wire keyboard moves, hard-refresh persistence, and the offline queue before visual polish.", [
      "Pulse Kanban now moves cards with drag and keyboard.",
      "- Board state persists after hard refresh.",
      "- Need collaborative filters and share modal stability.",
    ], 20),
    responderResumeSuggestionCall(pulse, "Need collaborative filters and share modal stability.", "Finish collaborative filters and stabilize the share modal before touching aesthetics.", 91, "the blockers are explicit"),
    followUpWorkerCall(pulse, "Finish collaborative filters and stabilize the share modal before touching aesthetics.", [
      "Pulse Kanban collaborative filters partially work.",
      "- Share modal opens, but invite tokens are not synced with filter state.",
      "- Need a decision on whether to finish filters or polish sharing first.",
    ], 25),
    responderResumeSuggestionCall(pulse, "Need a decision on whether to finish filters or polish sharing first.", "Finish collaborative filters before polishing the share modal.", 63, "both paths are viable but filters unblock more"),
    followUpWorkerCall(pulse, "Finish collaborative filters before polishing the share modal.", [
      "Pulse Kanban collaboration flow is solid.",
      "- Invite tokens sync with filters.",
      "- Offline queue still drops one mutation after reconnect.",
    ], 25),
    responderResumeSuggestionCall(pulse, "Offline queue still drops one mutation after reconnect.", "Close the reconnect bug in the offline queue and verify the installable PWA path.", 88, "the last functional gap is isolated"),
    followUpWorkerCall(pulse, "Close the reconnect bug in the offline queue and verify the installable PWA path.", [
      "Pulse Kanban is working.",
      "- Drag and keyboard moves persist.",
      "- Offline queue flushes cleanly after reconnect.",
      "- PWA install path and regression tests pass.",
    ], 30),
    responderResumeSuggestionCall(pulse, "Pulse Kanban is working.", "Ask for a final demo checklist and release-note pass.", 52, "implementation is done; only handoff work remains"),

    initialWorkerCall(orbit, [
      "Orbit Metrics shell renders KPI cards and chart regions.",
      "- CSV export, role gating, and anomaly drill-down are still empty.",
    ], 10),
    summaryCall(orbit, "Orbit Metrics shell renders KPI cards and chart regions.", "Scaffolded metrics dashboard"),
    responderSeedErrorCall(orbit, "CSV export, role gating, and anomaly drill-down are still empty.", "Transient sidecar timeout"),
    responderSeedSuggestionCall(orbit, "CSV export, role gating, and anomaly drill-down are still empty.", "Prioritize CSV export, role gating, and anomaly drill-down before cosmetic polish.", 82, "core operator functionality is missing"),
    followUpWorkerCall(orbit, "Prioritize CSV export, role gating, and anomaly drill-down before cosmetic polish.", [
      "Orbit Metrics export pipeline writes files, but admin and manager role gating is wrong on saved views.",
      "- Anomaly drill-down still skips filtered rows.",
    ], 35),
    responderResumeSuggestionCall(orbit, "Anomaly drill-down still skips filtered rows.", "Tighten role filters, then revisit anomaly drill-down.", 58, "the sequence depends on product priority"),
    followUpWorkerCall(orbit, "Lock down role filters for admin and manager saved views, then finish anomaly drill-down and export parity.", [
      "Orbit Metrics role gating now matches admin and manager scopes.",
      "- Anomaly drill-down resolves filtered rows.",
      "- Need export parity from filtered views and production refresh banners.",
    ], 40),
    responderResumeSuggestionCall(orbit, "Need export parity from filtered views and production refresh banners.", "Finish filtered export parity, empty states, and refresh banners before the production pass.", 86, "the remaining work is implementation detail"),
    followUpWorkerCall(orbit, "Finish filtered export parity, empty states, and refresh banners before the production pass.", [
      "Orbit Metrics filtered exports now match the visible table and charts.",
      "- Refresh banners and virtualization are in place.",
      "- Need a production sanity pass on query caching.",
    ], 45),
    responderResumeSuggestionCall(orbit, "Need a production sanity pass on query caching.", "Run a production sanity pass on query caching and stale refresh banners.", 66, "it is the right next step but still review-worthy"),
    followUpWorkerCall(orbit, "Run a production sanity pass on query caching and stale refresh banners.", [
      "Orbit Metrics is working.",
      "- Role-based filters gate correctly.",
      "- Anomaly drill-down and filtered CSV export match.",
      "- Query caching and refresh banners behave in production mode.",
    ], 45),
    responderResumeSuggestionCall(orbit, "Orbit Metrics is working.", "Ask for release notes and an operator handoff checklist.", 51, "the product is done; only packaging remains"),

    initialWorkerCall(atlas, [
      "Atlas Wiki shell loads markdown notes and a basic editor.",
      "- Backlinks and search indexing are in progress.",
      "- Need version history and rename-safe graph updates.",
    ], 30),
    summaryCall(atlas, "Atlas Wiki shell loads markdown notes and a basic editor.", "Started markdown wiki shell"),
    responderSeedSuggestionCall(atlas, "Need version history and rename-safe graph updates.", "Complete backlinks, search indexing, and optimistic saves before debating history polish.", 93, "the missing features are well-scoped"),
    followUpWorkerCall(atlas, "Complete backlinks, search indexing, and optimistic saves before debating history polish.", [
      "Atlas Wiki backlinks and full-text search are now live.",
      "- Version history is still linear and restore previews are missing.",
      "- Need a decision on history semantics before shipping.",
    ], 35),
    responderResumeSuggestionCall(atlas, "Need a decision on history semantics before shipping.", "Decide whether history should stay linear or become branch-aware before shipping.", 54, "this is a product call, not just an implementation task"),
    followUpWorkerCall(atlas, "Implement branch-aware version history with restore previews and keep backlink updates rename-safe.", [
      "Atlas Wiki now has branch-aware version history with restore previews.",
      "- Rename-safe backlink updates survive restores.",
      "- Need share links, command palette, and import/export polish.",
    ], 40),
    responderResumeSuggestionCall(atlas, "Need share links, command palette, and import/export polish.", "Add share links, a command palette, and rename/restore smoke tests.", 84, "the finish line is clear"),
    followUpWorkerCall(atlas, "Add share links, a command palette, and rename/restore smoke tests.", [
      "Atlas Wiki share links and command palette are finished.",
      "- Import/export works for small vaults.",
      "- Need a large-vault indexing pass before release.",
    ], 45),
    responderResumeSuggestionCall(atlas, "Need a large-vault indexing pass before release.", "Finish import/export and verify large-vault indexing before release.", 77, "the remaining risk is performance validation"),
    followUpWorkerCall(atlas, "Finish import/export and verify large-vault indexing before release.", [
      "Atlas Wiki is working.",
      "- Search is instant on large vaults.",
      "- Backlinks survive renames and restores.",
      "- Branch-aware history, share links, and import/export pass smoke tests.",
    ], 45),
    responderResumeSuggestionCall(atlas, "Atlas Wiki is working.", "Ask whether to add onboarding docs for power users.", 49, "feature work is done; only enablement remains"),

    initialWorkerCall(relay, [
      "Relay Playground opens schemas and renders simple endpoints.",
      "- OAuth device flow, request collections, and auth inheritance are still missing.",
    ], 40),
    summaryCall(relay, "Relay Playground opens schemas and renders simple endpoints.", "Opened API playground shell"),
    responderSeedSuggestionCall(relay, "OAuth device flow, request collections, and auth inheritance are still missing.", "Finish OAuth device flow, request collections, and auth inheritance before tuning the surface.", 95, "the implementation sequence is obvious"),
    followUpWorkerCall(relay, "Finish OAuth device flow, request collections, and auth inheritance before tuning the surface.", [
      "Relay Playground completes the OAuth device flow.",
      "- Request collections run, but inherited auth and timeout controls are incomplete.",
      "- Schema examples still miss auth-aware samples.",
    ], 50),
    responderResumeSuggestionCall(relay, "Schema examples still miss auth-aware samples.", "Complete collection replay, auth inheritance, timeout controls, and auth-aware schema examples.", 79, "the missing pieces are connected"),
    followUpWorkerCall(relay, "Complete collection replay, auth inheritance, timeout controls, and auth-aware schema examples.", [
      "Relay Playground collections now inherit auth correctly.",
      "- Timeout controls work.",
      "- The error panel still overreacts to schema resolver warnings.",
    ], 55),
    responderResumeErrorCall(relay, "The error panel still overreacts to schema resolver warnings.", "Mock schema resolver crashed"),
    responderSeedSuggestionCall(relay, "The error panel still overreacts to schema resolver warnings.", "Stabilize timeout controls, calm the warning panel, and verify auth-aware schema examples.", 78, "the remaining work is corrective"),
    followUpWorkerCall(relay, "Stabilize timeout controls, calm the warning panel, and verify auth-aware schema examples.", [
      "Relay Playground now calms schema warnings and renders auth-aware examples.",
      "- Secrets masking in the environment editor is still missing.",
      "- Need confirmation that collection replays preserve variables.",
    ], 60),
    responderResumeSuggestionCall(relay, "Need confirmation that collection replays preserve variables.", "Add secrets masking and confirm collection replays preserve variables.", 62, "this is the last functional safety pass"),
    followUpWorkerCall(relay, "Add secrets masking and confirm collection replays preserve variables.", [
      "Relay Playground is working.",
      "- OAuth device flow completes.",
      "- Collections replay with inherited auth and preserved variables.",
      "- Schema examples render and secrets stay masked.",
    ], 60),
    responderResumeSuggestionCall(relay, "Relay Playground is working.", "Ask for a launch checklist and docs review.", 50, "the application is complete"),
  ];
}

function initialWorkerCall(project: ProjectSpec, lines: string[], delayMs: number): MockCall {
  return {
    provider: project.provider,
    promptIncludesAll: [
      "You are a Guild coding agent",
      `"${project.projectName}" project`,
    ],
    promptExcludesAll: [
      "Respond in this EXACT JSON format",
      "Summarize what this AI coding session just accomplished",
    ],
    sessionId: project.sessionId,
    text: toStreamChunks(lines),
    toolActivity: project.provider === "claude" ? "Read" : "shell",
    delayMs,
    chunkDelayMs: 5,
  };
}

function followUpWorkerCall(
  project: ProjectSpec,
  promptIncludes: string,
  lines: string[],
  delayMs: number,
): MockCall {
  return {
    provider: project.provider,
    promptIncludes,
    promptExcludesAll: [
      "Respond in this EXACT JSON format",
      "Summarize what this AI coding session just accomplished",
    ],
    resumeId: project.sessionId,
    sessionId: project.sessionId,
    text: toStreamChunks(lines),
    toolActivity: project.provider === "claude" ? "Edit" : "shell",
    delayMs,
    chunkDelayMs: 5,
  };
}

function responderSessionId(project: ProjectSpec): string {
  return `${project.label}-roscoe`;
}

function responderSeedSuggestionCall(
  project: ProjectSpec,
  workerSignature: string,
  message: string,
  confidence: number,
  reasoning: string,
): MockCall {
  return {
    provider: project.provider,
    promptIncludesAll: [
      "This is the persistent hidden Roscoe responder thread",
      "Respond in this EXACT JSON format",
      workerSignature,
    ],
    promptExcludesAll: [
      "=== Incremental Lane Delta ===",
    ],
    sessionId: responderSessionId(project),
    text: JSON.stringify({ message, confidence, reasoning }),
    delayMs: 10,
    chunkDelayMs: 5,
  };
}

function responderResumeSuggestionCall(
  project: ProjectSpec,
  workerSignature: string,
  message: string,
  confidence: number,
  reasoning: string,
): MockCall {
  return {
    provider: project.provider,
    promptIncludesAll: [
      "Continue as Roscoe for this same Guild lane.",
      "=== Incremental Lane Delta ===",
      "Respond in this EXACT JSON format",
      workerSignature,
    ],
    resumeId: responderSessionId(project),
    sessionId: responderSessionId(project),
    text: JSON.stringify({ message, confidence, reasoning }),
    delayMs: 10,
    chunkDelayMs: 5,
  };
}

function responderSeedErrorCall(
  project: ProjectSpec,
  workerSignature: string,
  stderr: string,
): MockCall {
  return {
    provider: project.provider,
    promptIncludesAll: [
      "This is the persistent hidden Roscoe responder thread",
      "Respond in this EXACT JSON format",
      workerSignature,
    ],
    promptExcludesAll: [
      "=== Incremental Lane Delta ===",
    ],
    stderr,
    exitCode: 1,
    delayMs: 10,
  };
}

function responderResumeErrorCall(
  project: ProjectSpec,
  workerSignature: string,
  stderr: string,
): MockCall {
  return {
    provider: project.provider,
    promptIncludesAll: [
      "Continue as Roscoe for this same Guild lane.",
      "=== Incremental Lane Delta ===",
      "Respond in this EXACT JSON format",
      workerSignature,
    ],
    resumeId: responderSessionId(project),
    stderr,
    exitCode: 1,
    delayMs: 10,
  };
}

function summaryCall(
  project: ProjectSpec,
  workerSignature: string,
  text: string,
): MockCall {
  return {
    provider: project.provider,
    promptIncludesAll: [
      "Summarize what this AI coding session just accomplished",
      workerSignature,
    ],
    text,
    delayMs: 5,
  };
}

async function retryError(app: ReturnType<typeof render>, label: string, errorText: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    await focusSession(app, label);
    const frame = app.lastFrame() || "";
    if (
      isSessionActive(frame, label) &&
      (frame.includes(errorText) || frame.includes("error │") || frame.includes(" error "))
    ) {
      break;
    }
    await delay(50);
  }
  await pressUntil(app, "r", (frame) =>
    isSessionActive(frame, label) && !frame.includes("error │") && !frame.includes(" error "),
  );
}

async function approveSuggestion(
  app: ReturnType<typeof render>,
  logPath: string,
  label: string,
  text: string,
): Promise<void> {
  await waitForReadySuggestion(app, label, text);
  const priorInvocations = readInvocationLog(logPath).length;
  const started = Date.now();

  while (Date.now() - started < 5000) {
    app.stdin.write("a");
    await delay(75);

    if (readInvocationLog(logPath).length >= priorInvocations + 1) {
      return;
    }
  }

  await waitForInvocationCount(logPath, priorInvocations + 1, 20000);
}

async function manualInput(
  app: ReturnType<typeof render>,
  label: string,
  suggestionText: string,
  manualText: string,
): Promise<void> {
  await waitForReadySuggestion(app, label, suggestionText);
  await pressUntil(app, "m", (frame) =>
    isSessionActive(frame, label) &&
      (frame.includes("manual-input") || frame.includes("Manual override")),
  );
  await delay(100);
  await typeText(app, manualText);
  await delay(75);
  app.stdin.write("\r");
  await delay(50);
}

async function assertSessionSuggestion(
  app: ReturnType<typeof render>,
  label: string,
  expectedText: string,
): Promise<void> {
  await waitForSessionText(app, label, expectedText, 15000);
}

async function waitForReadySuggestion(
  app: ReturnType<typeof render>,
  label: string,
  expectedText: string,
  timeoutMs = 20000,
): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    await focusSession(app, label);
    const frame = app.lastFrame() || "";
    if (!isSessionActive(frame, label)) {
      await delay(25);
      continue;
    }
    const normalized = normalizeFrame(frame);
    const hasDraftState =
      frame.includes("ready │")
      || frame.includes(" ready ")
      || frame.includes("needs review");
    if (hasDraftState && normalized.includes(normalizeFrame(expectedText))) {
      return;
    }
    await delay(25);
  }

  throw new Error(`Timed out waiting for a ready suggestion in ${label}.\nLast frame:\n${app.lastFrame() ?? "(empty)"}`);
}

async function waitForSessionText(
  app: ReturnType<typeof render>,
  label: string,
  text: string,
  timeoutMs = 15000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await focusSession(app, label);
    const frame = app.lastFrame() || "";
    if (normalizeFrame(frame).includes(normalizeFrame(text)) && isSessionActive(frame, label)) {
      return;
    }
    await delay(25);
  }

  throw new Error(`Timed out waiting for "${text}" in ${label}.\nLast frame:\n${app.lastFrame() ?? "(empty)"}`);
}

async function focusSession(app: ReturnType<typeof render>, label: string): Promise<void> {
  const directKey = directSessionKey(label);
  if (directKey) {
    for (let i = 0; i < 4; i += 1) {
      const frame = app.lastFrame() || "";
      if (isSessionActive(frame, label)) return;
      app.stdin.write(directKey);
      await delay(120);
    }
  }

  for (let i = 0; i < 32; i += 1) {
    const frame = app.lastFrame() || "";
    if (isSessionActive(frame, label)) return;
    app.stdin.write("\t");
    await delay(120);
  }

  throw new Error(`Could not focus ${label}.\nLast frame:\n${app.lastFrame() ?? "(empty)"}`);
}

function isSessionActive(frame: string | undefined, label: string): boolean {
  if (!frame) return false;
  const normalized = normalizeFrame(frame);
  if (normalized.includes(normalizeFrame(`Session Transcript — ${label}:main`))) {
    return true;
  }
  if (normalized.includes(normalizeFrame(`${label}:main`))) {
    return true;
  }
  return new RegExp(`▸\\s+\\d+\\s+[^\\n]*\\b${escapeRegExp(label)}\\b`, "i").test(frame);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function directSessionKey(label: string): string | null {
  switch (label) {
    case "pulse":
      return "1";
    case "orbit":
      return "2";
    case "atlas":
      return "3";
    case "relay":
      return "4";
    default:
      return null;
  }
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

function readInvocationLog(logPath: string): Array<{
  provider: MockProvider;
  resumeId: string | null;
  matchedIndex: number | null;
  noMatch?: boolean;
}> {
  const raw = readFileSync(logPath, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as {
    provider: MockProvider;
    resumeId: string | null;
    matchedIndex: number | null;
    noMatch?: boolean;
  });
}

async function waitForInvocationCount(logPath: string, expected: number, timeoutMs = 15000): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (readInvocationLog(logPath).length >= expected) return;
    await delay(25);
  }

  throw new Error(`Timed out waiting for ${expected} invocations.\nCurrent log:\n${readFileSync(logPath, "utf-8")}`);
}

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 15000,
): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const frame = lastFrame();
    if (frame && predicate(frame)) return;
    await delay(25);
  }

  throw new Error(`Timed out waiting for frame.\nLast frame:\n${lastFrame() ?? "(empty)"}`);
}

async function pressUntil(
  app: ReturnType<typeof render>,
  key: string,
  predicate: (frame: string) => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    app.stdin.write(key);
    const attemptStarted = Date.now();

    while (Date.now() - attemptStarted < 500) {
      const frame = app.lastFrame();
      if (frame && predicate(frame)) return;
      await delay(25);
    }
  }

  throw new Error(`Timed out waiting for key "${key}" to take effect.\nLast frame:\n${app.lastFrame() ?? "(empty)"}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function typeText(app: ReturnType<typeof render>, text: string): Promise<void> {
  for (const char of text) {
    app.stdin.write(char);
    await delay(2);
  }
}

function normalizeFrame(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}


function toStreamChunks(lines: string[]): string[] {
  return lines.map((line, index) => (index === lines.length - 1 ? line : `${line}\n`));
}
