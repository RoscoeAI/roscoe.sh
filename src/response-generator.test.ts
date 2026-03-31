import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "stream";
import { EventEmitter } from "events";

const mockSpawn = vi.fn();

vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("./debug-log.js", () => ({
  dbg: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
}));

import { ResponseGenerator } from "./response-generator.js";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import * as config from "./config.js";

function createMockProc() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = { end: vi.fn() };
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(),
    killed: false,
    pid: 1234,
  });
  return proc;
}

class FakeResponderMonitor extends EventEmitter {
  private sessionId: string | null = null;
  startTurn = vi.fn((prompt: string) => {
    this.sessionId = "responder-thread-1";
    setImmediate(() => {
      this.emit("text", '{"message":"seeded","confidence":88,"reasoning":"initial"}');
      this.emit("usage", {
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      });
      this.emit("turn-complete");
      this.emit("exit", 0);
    });
    return prompt;
  });
  sendFollowUp = vi.fn((prompt: string) => {
    setImmediate(() => {
      this.emit("text", '{"message":"resumed","confidence":84,"reasoning":"delta"}');
      this.emit("usage", {
        inputTokens: 3,
        outputTokens: 1,
        cachedInputTokens: 7,
        cacheCreationInputTokens: 0,
      });
      this.emit("turn-complete");
      this.emit("exit", 0);
    });
    return prompt;
  });
  getSessionId = vi.fn(() => this.sessionId);
  restoreSessionId = vi.fn((sessionId: string | null) => {
    this.sessionId = sessionId;
  });
  setProfile = vi.fn();
  kill = vi.fn();
}

class SilentResponderMonitor extends EventEmitter {
  private sessionId: string | null;

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;
  }

  startTurn = vi.fn();
  sendFollowUp = vi.fn((prompt: string) => {
    setImmediate(() => {
      this.emit("turn-complete");
      this.emit("exit", 0);
    });
    return prompt;
  });
  getSessionId = vi.fn(() => this.sessionId);
  restoreSessionId = vi.fn((sessionId: string | null) => {
    this.sessionId = sessionId;
  });
  setProfile = vi.fn();
  kill = vi.fn();
}

class ExitOnlyResponderMonitor extends EventEmitter {
  private sessionId: string | null;

  constructor(sessionId: string | null = null) {
    super();
    this.sessionId = sessionId;
  }

  startTurn = vi.fn((prompt: string) => {
    this.sessionId = this.sessionId ?? "exit-only-session";
    setImmediate(() => {
      this.emit("text", '{"message":"exit-only","confidence":77,"reasoning":"exit path"}');
      this.emit("exit", 0);
    });
    return prompt;
  });
  sendFollowUp = vi.fn((prompt: string) => {
    setImmediate(() => {
      this.emit("text", '{"message":"exit-only","confidence":77,"reasoning":"exit path"}');
      this.emit("exit", 0);
    });
    return prompt;
  });
  getSessionId = vi.fn(() => this.sessionId);
  restoreSessionId = vi.fn((sessionId: string | null) => {
    this.sessionId = sessionId;
  });
  setProfile = vi.fn();
  kill = vi.fn();
}

/** Write a stream-json text_delta line to the proc's stdout */
function writeTextDelta(proc: ReturnType<typeof createMockProc>, text: string) {
  const line = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    },
  });
  proc.stdout.write(line + "\n");
}

/** Simulate a successful sidecar run: stream text, then close with code 0 */
function completeWithText(proc: ReturnType<typeof createMockProc>, text: string) {
  // Use setImmediate so the readline can set up before data arrives
  setImmediate(() => {
    writeTextDelta(proc, text);
    setImmediate(() => {
      proc.stdout.end();
      proc.emit("close", 0);
    });
  });
}

/** Simulate a failed sidecar run */
function failWithCode(proc: ReturnType<typeof createMockProc>, code: number, stderrText?: string) {
  setImmediate(() => {
    if (stderrText) {
      proc.stderr.write(stderrText);
    }
    proc.stdout.end();
    proc.emit("close", code);
  });
}

describe("ResponseGenerator", () => {
  let gen: ResponseGenerator;

  beforeEach(() => {
    gen = new ResponseGenerator(70);
    mockSpawn.mockReset();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.restoreAllMocks();
  });

  describe("constructor / threshold", () => {
    it("defaults threshold to 70", () => {
      const g = new ResponseGenerator();
      expect(g.getConfidenceThreshold()).toBe(70);
    });

    it("accepts custom threshold", () => {
      expect(gen.getConfidenceThreshold()).toBe(70);
    });

    it("setConfidenceThreshold updates value", () => {
      gen.setConfidenceThreshold(50);
      expect(gen.getConfidenceThreshold()).toBe(50);
    });
  });

  describe("meetsThreshold", () => {
    it("returns true when confidence >= threshold", () => {
      expect(gen.meetsThreshold({ text: "", confidence: 70, reasoning: "" })).toBe(true);
      expect(gen.meetsThreshold({ text: "", confidence: 100, reasoning: "" })).toBe(true);
    });

    it("returns false when confidence < threshold", () => {
      expect(gen.meetsThreshold({ text: "", confidence: 69, reasoning: "" })).toBe(false);
      expect(gen.meetsThreshold({ text: "", confidence: 0, reasoning: "" })).toBe(false);
    });
  });

  describe("buildContext", () => {
    it("includes empty-state headers even when goals and milestones are blank", async () => {
      gen.setProjectContext({
        name: "BareProject",
        directory: "/tmp/bare",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {},
        intentBrief: {
          projectStory: "Bare project story",
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
          nonGoals: [],
          constraints: [],
          architecturePrinciples: [],
          autonomyRules: [],
          qualityBar: [],
          riskBoundaries: [],
          uiDirection: "",
        },
        interviewAnswers: [],
      });

      const ctx = await gen.buildContext("conversation", "claude");
      expect(ctx).toContain("Goals: ");
      expect(ctx).toContain("Milestones: ");
      expect(ctx).toContain("Tech: ");
      expect(ctx).not.toContain("Notes:");
    });

    it("includes conversation context", async () => {
      const ctx = await gen.buildContext("User: hello\nLLM: hi", "claude");
      expect(ctx).toContain("User: hello");
      expect(ctx).toContain("Active Guild conversation with claude");
    });

    it("includes project context when set", async () => {
      gen.setProjectContext({
        name: "MyProject",
        directory: "/tmp",
        goals: ["ship it"],
        milestones: ["v1.0"],
        techStack: ["TypeScript"],
        notes: "important note",
        runtimeDefaults: {
          lockedProvider: "claude",
          workerGovernanceMode: "roscoe-arbiter",
          verificationCadence: "batched",
          responderApprovalMode: "manual",
        },
        intentBrief: {
          projectStory: "Give operators a clean workflow",
          primaryUsers: ["operators"],
          definitionOfDone: ["main flow is stable"],
          acceptanceChecks: ["demo path completes without hand holding"],
          successSignals: ["operators can finish the task"],
          deliveryPillars: {
            frontend: ["Frontend operator flow renders and completes correctly"],
            backend: ["Backend workflow APIs persist and validate correctly"],
            unitComponentTests: ["Vitest unit/component tests cover changed logic, regressions, and edge cases at a reasonable level"],
            e2eTests: ["Playwright e2e tests cover success and failure paths at the right stage of hardening"],
          },
          coverageMechanism: ["Vitest plus Playwright runs provide the canonical validation path"],
          nonGoals: ["rewriting the stack"],
          constraints: ["keep the keyboard-first UX"],
          architecturePrinciples: ["Reuse shared operator modules and keep audit logging unified across material writes"],
          autonomyRules: ["ask before broad scope changes"],
          qualityBar: ["Do not call this done until Vitest and Playwright provide reasonable, risk-based proof on the frontend and backend outcomes"],
          riskBoundaries: ["do not change billing"],
          uiDirection: "bold but legible",
        },
        interviewAnswers: [
          { question: "Who is it for?", answer: "Operators", theme: "users" },
        ],
      });
      const ctx = await gen.buildContext("test", "claude");
      expect(ctx).toContain("MyProject");
      expect(ctx).toContain("ship it");
      expect(ctx).toContain("TypeScript");
      expect(ctx).toContain("important note");
      expect(ctx).toContain("Roscoe Intent Brief");
      expect(ctx).toContain("Definition of done");
      expect(ctx).toContain("Acceptance checks");
      expect(ctx).toContain("Delivery pillar / frontend");
      expect(ctx).toContain("Coverage mechanism");
      expect(ctx).toContain("Architecture principles");
      expect(ctx).toContain("Who is it for?");
      expect(ctx).toContain("Guild governance mode");
      expect(ctx).toContain("Verification cadence");
      expect(ctx).toContain("Roscoe approval default");
    });

    it("includes worktree info from session", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const session = {
        profile: { name: "claude", command: "claude", args: [], protocol: "claude" as const },
        profileName: "test",
        projectName: "proj",
        projectDir: "/tmp/proj",
        worktreePath: "/tmp/proj-feat",
        worktreeName: "feat",
      };
      const ctx = await gen.buildContext("test", "claude", session);
      expect(ctx).toContain("Active Guild conversation with claude");
    });

    it("includes best-effort browser context when available", async () => {
      gen.setBrowser({
        getContextSummary: vi.fn().mockResolvedValue("Browser summary here"),
      } as any);

      const ctx = await gen.buildContext("conversation", "claude");
      expect(ctx).toContain("=== Current Browser State ===");
      expect(ctx).toContain("Browser summary here");
    });

    it("swallows browser-context failures", async () => {
      gen.setBrowser({
        getContextSummary: vi.fn().mockRejectedValue(new Error("browser unavailable")),
      } as any);

      const ctx = await gen.buildContext("conversation", "claude");
      expect(ctx).toContain("=== Active Guild conversation with claude ===");
      expect(ctx).not.toContain("browser unavailable");
    });

    it("includes recent Claude and Codex transcript snippets when they exist", async () => {
      (gen as any).readClaudeTranscript = vi.fn(() => ["Claude line"]);
      (gen as any).readCodexTranscript = vi.fn(() => ["Codex line"]);

      const ctx = await gen.buildContext("conversation", "claude", {
        profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
        profileName: "claude",
        projectName: "demo",
        projectDir: "/tmp/demo",
        worktreePath: "/tmp/demo",
        worktreeName: "main",
      });

      expect(ctx).toContain("=== Recent Claude Code transcript ===");
      expect(ctx).toContain("Claude line");
      expect(ctx).toContain("=== Recent Codex transcript ===");
      expect(ctx).toContain("Codex line");
    });

    it("falls back cleanly when session project context loading throws", async () => {
      vi.spyOn(config, "loadProjectContext").mockImplementation(() => {
        throw new Error("bad project metadata");
      });

      const ctx = await gen.buildContext("conversation", "claude", {
        profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
        profileName: "claude",
        projectName: "demo",
        projectDir: "/tmp/demo",
        worktreePath: "/tmp/demo",
        worktreeName: "main",
      });

      expect(ctx).toContain("=== Active Guild conversation with claude ===");
      expect(ctx).not.toContain("bad project metadata");
    });

    it("includes the enabled milestone parking mode in project context when configured", async () => {
      vi.spyOn(config, "loadRoscoeSettings").mockReturnValue({
        notifications: {
          enabled: false,
          phoneNumber: "",
          consentAcknowledged: false,
          consentProofUrls: [],
          provider: "twilio",
          deliveryMode: "unconfigured",
          hostedTestVerifiedPhone: "",
          hostedRelayClientId: "",
          hostedRelayAccessToken: "",
          hostedRelayAccessTokenExpiresAt: "",
          hostedRelayRefreshToken: "",
          hostedRelayLinkedPhone: "",
          hostedRelayLinkedEmail: "",
        },
        providers: {
          claude: { enabled: true, brief: false, ide: false, chrome: false },
          codex: { enabled: true, webSearch: false },
          gemini: { enabled: true },
        },
        behavior: {
          autoHealMetadata: true,
          preventSleepWhileRunning: true,
          parkAtMilestonesForReview: true,
        },
      } as any);

      gen.setProjectContext({
        name: "MyProject",
        directory: "/tmp",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {},
        intentBrief: {
          projectStory: "Ship safely",
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
          nonGoals: [],
          constraints: [],
          architecturePrinciples: [],
          autonomyRules: [],
          qualityBar: [],
          riskBoundaries: [],
          uiDirection: "",
        },
        interviewAnswers: [],
      });

      const ctx = await gen.buildContext("test", "claude");
      expect(ctx).toContain("Milestone parking mode: enabled.");
    });
  });

  describe("readClaudeTranscript", () => {
    it("returns empty array when no path given", () => {
      expect(gen.readClaudeTranscript()).toEqual([]);
    });

    it("returns empty array when dir does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(gen.readClaudeTranscript("/tmp/project")).toEqual([]);
    });

    it("reads and parses JSONL files", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(["session.jsonl"] as any);
      vi.mocked(readFileSync).mockReturnValue(
        '{"display":"line 1"}\n{"display":"line 2"}\n',
      );
      const lines = gen.readClaudeTranscript("/tmp/project");
      expect(lines).toEqual(["line 1", "line 2"]);
    });
  });

  describe("readCodexTranscript", () => {
    it("returns empty array when sessions dir does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(gen.readCodexTranscript("/tmp/project")).toEqual([]);
    });

    it("only reads the most recent codex session for the matching project path", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          { name: "2026", isDirectory: () => true, isFile: () => false },
        ] as any)
        .mockReturnValueOnce([
          { name: "03", isDirectory: () => true, isFile: () => false },
        ] as any)
        .mockReturnValueOnce([
          { name: "good.jsonl", isDirectory: () => false, isFile: () => true },
          { name: "other.jsonl", isDirectory: () => false, isFile: () => true },
        ] as any);

      vi.mocked(statSync).mockImplementation((path: any) => ({
        mtimeMs: String(path).includes("good.jsonl") ? 2 : 1,
      }) as any);

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        const filePath = String(path);
        if (filePath.includes("good.jsonl")) {
          return [
            JSON.stringify({ type: "session_meta", payload: { cwd: "/tmp/project" } }),
            JSON.stringify({ payload: { message: "correct project line" } }),
          ].join("\n");
        }

        return [
          JSON.stringify({ type: "session_meta", payload: { cwd: "/tmp/other" } }),
          JSON.stringify({ payload: { message: "wrong project line" } }),
        ].join("\n");
      });

      expect(gen.readCodexTranscript("/tmp/project")).toEqual(["correct project line"]);
    });

    it("uses the most recent Codex session when no target path is provided", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          { name: "2026", isDirectory: () => true, isFile: () => false },
        ] as any)
        .mockReturnValueOnce([
          { name: "03", isDirectory: () => true, isFile: () => false },
        ] as any)
        .mockReturnValueOnce([
          { name: "latest.jsonl", isDirectory: () => false, isFile: () => true },
          { name: "older.jsonl", isDirectory: () => false, isFile: () => true },
        ] as any);

      vi.mocked(statSync).mockImplementation((path: any) => ({
        mtimeMs: String(path).includes("latest.jsonl") ? 5 : 1,
      }) as any);
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (String(path).includes("latest.jsonl")) {
          return [
            "not-json",
            JSON.stringify({ payload: { content: "latest content" } }),
          ].join("\n");
        }
        return JSON.stringify({ payload: { message: "older content" } });
      });

      expect(gen.readCodexTranscript()).toEqual(["latest content"]);
    });
  });

  describe("readClaudeSessionFallbackText", () => {
    it("skips non-assistant records and returns the latest assistant text block", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue([
        JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "ignore me" }] } }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "final answer" }] } }),
      ].join("\n"));

      const text = (gen as any).readClaudeSessionFallbackText("/tmp/project", "session-1");
      expect(text).toBe("final answer");
    });
  });

  describe("private helper branches", () => {
    it("reads Claude responder fallback text from the newest assistant entry", () => {
      vi.mocked(existsSync).mockImplementation((path) => String(path).includes("recover.jsonl"));
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (String(path).includes("recover.jsonl")) {
          return [
            JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "ignore" }] } }),
            "not-json",
            JSON.stringify({
              type: "assistant",
              message: {
                content: [
                  { type: "tool_use", name: "Read" },
                  { type: "text", text: "Recovered text" },
                ],
              },
            }),
          ].join("\n");
        }
        return "";
      });

      expect((gen as any).readClaudeSessionFallbackText("/tmp/project", "recover")).toBe("Recovered text");
    });

    it("returns null when responder fallback is unavailable or unsupported", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect((gen as any).readClaudeSessionFallbackText("/tmp/project", "missing")).toBeNull();
      expect((gen as any).recoverStatefulResponderOutput(
        { name: "codex", command: "codex", args: [], protocol: "codex" },
        {
          profile: { name: "codex", command: "codex", args: [], protocol: "codex" },
          profileName: "codex",
          projectName: "proj",
          projectDir: "/tmp/proj",
          worktreePath: "/tmp/proj",
          worktreeName: "main",
          responderMonitor: new SilentResponderMonitor("thread-1") as any,
        },
      )).toBeNull();
    });

    it("builds incremental context including system messages", () => {
      const text = (gen as any).buildIncrementalConversationContext({
        responderHistory: [
          { role: "assistant", content: "Guild reply", timestamp: 1 },
          { role: "user", content: "Roscoe sent this", timestamp: 2 },
          { role: "system", content: "System note", timestamp: 3 },
        ],
        responderHistoryCursor: 0,
      });

      expect(text).toContain("Guild: Guild reply");
      expect(text).toContain("Sent to Guild: Roscoe sent this");
      expect(text).toContain("System: System note");
    });

    it("builds follow-up prompts without browser state when browser lookup fails", async () => {
      gen.setBrowser({
        getContextSummary: vi.fn().mockRejectedValue(new Error("browser down")),
      } as any);

      const prompt = await (gen as any).buildResponderFollowUpPrompt(
        {
          responderHistory: [],
          responderHistoryCursor: 0,
        },
        null,
      );

      expect(prompt).toContain("=== Incremental Lane Delta ===");
      expect(prompt).not.toContain("=== Current Browser State ===");
    });

    it("includes browser state in follow-up prompts when available", async () => {
      gen.setBrowser({
        getContextSummary: vi.fn().mockResolvedValue("Browser health: green"),
      } as any);

      const prompt = await (gen as any).buildResponderFollowUpPrompt(
        {
          responderHistory: [],
          responderHistoryCursor: 0,
        },
        null,
      );

      expect(prompt).toContain("=== Current Browser State ===");
      expect(prompt).toContain("Browser health: green");
    });

    it("upgrades future-lane parking corrections without treating them as fake-green blockers", () => {
      const corrected = (gen as any).applyDraftGuards(
        {
          text: "Parked. The next lane can take the remaining work.",
          confidence: 90,
          reasoning: "Remaining work belongs in a future lane.",
        },
        "No blocker text here.",
        null,
      );

      expect(corrected.text).toContain("Continue.");
      expect(corrected.reasoning).toContain("Continuation guard tripped");
      expect(corrected.confidence).toBeGreaterThanOrEqual(82);
    });

    it("allows milestone parking when the Roscoe behavior toggle is enabled", () => {
      vi.spyOn(config, "loadRoscoeSettings").mockReturnValue({
        notifications: {
          enabled: false,
          phoneNumber: "",
          consentAcknowledged: false,
          consentProofUrls: [],
          provider: "twilio",
          deliveryMode: "unconfigured",
          hostedTestVerifiedPhone: "",
          hostedRelayClientId: "",
          hostedRelayAccessToken: "",
          hostedRelayAccessTokenExpiresAt: "",
          hostedRelayRefreshToken: "",
          hostedRelayLinkedPhone: "",
          hostedRelayLinkedEmail: "",
        },
        providers: {
          claude: { enabled: true, brief: false, ide: false, chrome: false },
          codex: { enabled: true, webSearch: false },
          gemini: { enabled: true },
        },
        behavior: {
          autoHealMetadata: true,
          preventSleepWhileRunning: true,
          parkAtMilestonesForReview: true,
        },
      } as any);

      const corrected = (gen as any).applyDraftGuards(
        {
          text: "Parked. The next lane can take the remaining work.",
          confidence: 90,
          reasoning: "Remaining work belongs in a future lane.",
        },
        "No blocker text here.",
        null,
      );

      expect(corrected.text).toBe("Parked. The next lane can take the remaining work.");
      expect(corrected.reasoning).toBe("Remaining work belongs in a future lane.");
      expect(corrected.confidence).toBe(90);
    });

    it("treats operator-facing fake-green evidence as low-confidence, not auto-send continuation", () => {
      const corrected = (gen as any).applyDraftGuards(
        {
          text: "This lane is parked and done.",
          confidence: 93,
          reasoning: "All clear now.",
        },
        "Preview unavailable. Container failed health checks on the current route.",
        {
          intentBrief: {},
        },
      );

      expect(corrected.text).toContain("Do not park or call this done yet.");
      expect(corrected.reasoning).toContain("Fake-green guard tripped");
      expect(corrected.confidence).toBe(45);
    });
  });

  describe("generateSuggestion", () => {
    it("resolves with parsed JSON response", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const json = JSON.stringify({ message: "do this", confidence: 85, reasoning: "clear next step" });
      const promise = gen.generateSuggestion("context", "claude");
      completeWithText(proc, json);

      const result = await promise;
      expect(result.text).toBe("do this");
      expect(result.confidence).toBe(85);
      expect(result.reasoning).toBe("clear next step");
    });

    it("keeps empty parsed messages empty instead of falling back to raw JSON", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const json = JSON.stringify({ message: "", confidence: 99, reasoning: "Wait here", orchestratorActions: [] });
      const promise = gen.generateSuggestion("context", "claude");
      completeWithText(proc, json);

      const result = await promise;
      expect(result.text).toBe("");
      expect(result.confidence).toBe(99);
      expect(result.reasoning).toBe("Wait here");
      expect(result.orchestratorActions).toEqual([]);
    });

    it("falls back to default parse values when structured fields have the wrong types", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const json = JSON.stringify({ message: 42, confidence: "high", reasoning: 99 });
      const promise = gen.generateSuggestion("context", "claude");
      completeWithText(proc, json);

      const result = await promise;
      expect(result.text).toBe("");
      expect(result.confidence).toBe(50);
      expect(result.reasoning).toBe("");
    });

    it("extracts a JSON draft payload even if extra text wraps it", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const wrapped = 'sidecar reply: {"message":"","confidence":91,"reasoning":"Hold for now"} done';
      const promise = gen.generateSuggestion("context", "claude");
      completeWithText(proc, wrapped);

      const result = await promise;
      expect(result.text).toBe("");
      expect(result.confidence).toBe(91);
      expect(result.reasoning).toBe("Hold for now");
    });

    it("emits responder trace metadata with command preview and tuning rationale", async () => {
      let trace: any = null;
      const responderMonitor = new FakeResponderMonitor();

      const promise = gen.generateSuggestion(
        "Refine the frontend hero layout and interaction flow",
        "claude",
        {
          profile: {
            name: "claude",
            command: "claude",
            args: [],
            protocol: "claude",
          },
          profileName: "claude",
          projectName: "demo",
          projectDir: "/tmp/demo",
          worktreePath: "/tmp/demo",
          worktreeName: "main",
          responderMonitor: responderMonitor as any,
          responderHistory: [
            { role: "assistant", content: "Refine the frontend hero layout and interaction flow", timestamp: 1 },
          ],
          responderHistoryCursor: 0,
        },
        undefined,
        (value) => {
          trace = value;
        },
      );

      await promise;

      expect(trace).toMatchObject({
        strategy: "auto-efficient-frontend",
      });
      expect(trace?.prompt).toContain("Respond in this EXACT JSON format");
      expect(trace?.prompt).toContain("Do not reuse a stock Roscoe scaffold");
      expect(trace?.prompt).toContain('Only mention project anchoring, cross-project leakage, or "wrong session" corrections');
      expect(trace?.prompt).toContain("Do not mechanically tell Guild to rerun the full proof stack after every micro-change");
      expect(trace?.prompt).toContain("persistent hidden Roscoe responder thread");
      expect(trace?.commandPreview).toContain("--model");
      expect(trace?.runtimeSummary).toContain("low");
      expect(trace?.rationale).toContain("UI");
      expect(trace?.rationale).toContain("seeds this responder thread once");
    });

    it("handles markdown-fenced JSON response", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const fenced = '```json\n{"message":"test","confidence":50,"reasoning":"ok"}\n```';
      const promise = gen.generateSuggestion("context", "claude");
      completeWithText(proc, fenced);

      const result = await promise;
      expect(result.text).toBe("test");
    });

    it("falls back to raw text on parse failure", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const promise = gen.generateSuggestion("context", "claude");
      completeWithText(proc, "Just a plain text response");

      const result = await promise;
      expect(result.text).toBe("Just a plain text response");
      expect(result.confidence).toBe(50);
    });

    it("guards against fake-green parking when local operator blockers are still visible", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);
      gen.setProjectContext({
        name: "AppSicle",
        directory: "/tmp/appsicle",
        goals: ["Ship the builder"],
        milestones: ["local happy path works"],
        techStack: ["React"],
        notes: "",
        intentBrief: {
          projectStory: "Build an embeddable builder app",
          primaryUsers: ["operators"],
          definitionOfDone: ["local operator path is real"],
          acceptanceChecks: ["root route or builder entry is truthful"],
          successSignals: ["operators can boot it locally"],
          entrySurfaceContract: {
            summary: "Root route must be truthful on first boot.",
            defaultRoute: "/",
            expectedExperience: "A real entry path, not a scaffold placeholder.",
            allowedShellStates: [],
          },
          localRunContract: {
            summary: "Local boot must surface auth and seed prerequisites honestly.",
            startCommand: "pnpm dev",
            firstRoute: "http://localhost:3000",
            prerequisites: ["sign in"],
            seedRequirements: ["demo tenant"],
            expectedBlockedStates: ["sign in to access the builder", "tenant not found"],
            operatorSteps: ["Start dev server and open the truthful default route."],
          },
          acceptanceLedger: [
            { label: "truthful localhost entry path", status: "open", evidence: [], notes: "" },
          ],
          deliveryPillars: {
            frontend: ["Frontend shell exists"],
            backend: ["APIs exist"],
            unitComponentTests: ["Vitest covers changes"],
            e2eTests: ["Playwright covers critical flow"],
          },
          coverageMechanism: ["Vitest and Playwright"],
          nonGoals: [],
          constraints: [],
          architecturePrinciples: [],
          autonomyRules: [],
          qualityBar: [],
          riskBoundaries: [],
          uiDirection: "",
        },
      });

      const json = JSON.stringify({
        message: "Lane is parked cleanly. Nothing else to send.",
        confidence: 96,
        reasoning: "Scaffold is done.",
      });
      const promise = gen.generateSuggestion(
        "Root route still shows scaffold. Builder says sign in to access the builder. Preview unavailable. Tenant not found.",
        "claude",
      );
      completeWithText(proc, json);

      const result = await promise;
      expect(result.text).toContain("Do not park or call this done yet.");
      expect(result.confidence).toBe(45);
      expect(result.reasoning).toContain("Fake-green guard tripped");
    });

    it("ignores stale scaffold chatter once recent lines show the scaffold was removed", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);
      gen.setProjectContext({
        name: "AppSicle",
        directory: "/tmp/appsicle",
        goals: ["Ship the builder"],
        milestones: ["local happy path works"],
        techStack: ["React"],
        notes: "",
        intentBrief: {
          projectStory: "Build an embeddable builder app",
          primaryUsers: ["operators"],
          definitionOfDone: ["local operator path is real"],
          acceptanceChecks: ["root route or builder entry is truthful"],
          successSignals: ["operators can boot it locally"],
          deliveryPillars: {
            frontend: ["Frontend shell exists"],
            backend: ["APIs exist"],
            unitComponentTests: ["Vitest covers changes"],
            e2eTests: ["Playwright covers critical flow"],
          },
          coverageMechanism: ["Vitest and Playwright"],
          nonGoals: [],
          constraints: [],
          architecturePrinciples: [],
          autonomyRules: [],
          qualityBar: [],
          riskBoundaries: [],
          uiDirection: "",
        },
      });

      const json = JSON.stringify({
        message: "Lane is parked cleanly. Nothing else to send.",
        confidence: 96,
        reasoning: "Current milestone is complete.",
      });
      const promise = gen.generateSuggestion(
        [
          "Builder scaffold is live.",
          "Do not park or call this done yet. Operator-facing blockers remain: scaffold or placeholder surface still visible.",
          "visible scaffold-y copy is removed from the root metadata and idle builder status",
          "Landing page reads well. No scaffold residue, no false promises.",
        ].join("\n"),
        "claude",
      );
      completeWithText(proc, json);

      const result = await promise;
      expect(result.text).toBe("Lane is parked cleanly. Nothing else to send.");
      expect(result.confidence).toBe(96);
      expect(result.reasoning).toBe("Current milestone is complete.");
    });

    it("does not hard-block completion when the acceptance ledger is inferred from migration", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);
      gen.setProjectContext({
        name: "AppSicle",
        directory: "/tmp/appsicle",
        goals: ["Ship the builder"],
        milestones: ["local happy path works"],
        techStack: ["React"],
        notes: "",
        intentBrief: {
          projectStory: "Build an embeddable builder app",
          primaryUsers: ["operators"],
          definitionOfDone: ["local operator path is real"],
          acceptanceChecks: ["root route or builder entry is truthful"],
          successSignals: ["operators can boot it locally"],
          entrySurfaceContract: {
            summary: "Root route must be truthful on first boot.",
            defaultRoute: "/",
            expectedExperience: "A real entry path, not a scaffold placeholder.",
            allowedShellStates: [],
          },
          localRunContract: {
            summary: "Local boot must surface auth and seed prerequisites honestly.",
            startCommand: "pnpm dev",
            firstRoute: "http://localhost:3000",
            prerequisites: ["sign in"],
            seedRequirements: ["demo tenant"],
            expectedBlockedStates: [],
            operatorSteps: ["Start dev server and open the truthful default route."],
          },
          acceptanceLedgerMode: "inferred",
          acceptanceLedger: [
            { label: "truthful localhost entry path", status: "open", evidence: [], notes: "" },
          ],
          deliveryPillars: {
            frontend: ["Frontend shell exists"],
            backend: ["APIs exist"],
            unitComponentTests: ["Vitest covers changes"],
            e2eTests: ["Playwright covers critical flow"],
          },
          coverageMechanism: ["Vitest and Playwright"],
          nonGoals: [],
          constraints: [],
          architecturePrinciples: [],
          autonomyRules: [],
          qualityBar: [],
          riskBoundaries: [],
          uiDirection: "",
        },
      });

      const json = JSON.stringify({
        message: "This lane is parked.",
        confidence: 95,
        reasoning: "The milestone is complete.",
      });
      const promise = gen.generateSuggestion(
        "CI is green. Landing page reads well. No scaffold residue, no false promises.",
        "claude",
      );
      completeWithText(proc, json);

      const result = await promise;
      expect(result.text).toBe("This lane is parked.");
      expect(result.confidence).toBe(95);
      expect(result.reasoning).toBe("The milestone is complete.");
    });

    it("treats a non-resolving hosted proof target as a fake-green blocker for web deployments", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);
      gen.setProjectContext({
        name: "AppSicle",
        directory: "/tmp/appsicle",
        goals: ["Ship the hosted builder"],
        milestones: ["stage URL is truthful"],
        techStack: ["React"],
        notes: "",
        intentBrief: {
          projectStory: "Build an embeddable builder app",
          primaryUsers: ["operators"],
          definitionOfDone: ["stage environment is truthful"],
          acceptanceChecks: ["operators can open the hosted preview path"],
          successSignals: ["operators can verify the hosted surface"],
          deliveryPillars: {
            frontend: ["Hosted entry path works"],
            backend: ["Hosted APIs respond correctly"],
            unitComponentTests: ["Vitest covers changed logic"],
            e2eTests: ["Playwright covers the hosted flow"],
          },
          coverageMechanism: ["Vitest, Playwright, and hosted preview checks"],
          deploymentContract: {
            mode: "planned-greenfield",
            summary: "Stage should stay live during milestone work.",
            artifactType: "web app",
            platforms: ["Fly.io"],
            environments: ["staging", "production"],
            buildSteps: ["pnpm build"],
            deploySteps: ["fly deploy"],
            previewStrategy: ["Use the stage environment as the operator-visible proof surface."],
            presenceStrategy: ["Keep stage.appsicle.ai truthful and updated as milestones land."],
            proofTargets: ["stage.appsicle.ai must resolve and render the current operator-facing experience."],
            healthChecks: ["Open the stage URL and verify the truthful entry path."],
            rollback: ["Rollback the Fly release if the stage deploy regresses."],
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
      });

      const json = JSON.stringify({
        message: "This lane is parked.",
        confidence: 94,
        reasoning: "Hosted proof is complete.",
      });
      const promise = gen.generateSuggestion(
        "CI passed. stage.appsicle.ai is not resolving yet and the hosted proof target is still missing.",
        "claude",
      );
      completeWithText(proc, json);

      const result = await promise;
      expect(result.text).toContain("Do not park or call this done yet.");
      expect(result.reasoning).toContain("expected hosted web presence is not resolving yet");
      expect(result.confidence).toBe(45);
    });

    it("does not allow a web app with deferred deployment to park as done", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);
      gen.setProjectContext({
        name: "AppSicle",
        directory: "/tmp/appsicle",
        goals: ["Ship the hosted builder"],
        milestones: ["truthful web presence stays live"],
        techStack: ["React"],
        notes: "",
        intentBrief: {
          projectStory: "Build an embeddable builder app",
          primaryUsers: ["operators"],
          definitionOfDone: ["hosted proof stays truthful"],
          acceptanceChecks: ["operators can open the hosted surface"],
          successSignals: ["hosted presence matches the current app state"],
          deliveryPillars: {
            frontend: ["Hosted entry path works"],
            backend: ["Hosted APIs respond correctly"],
            unitComponentTests: ["Vitest covers changed logic"],
            e2eTests: ["Playwright covers the hosted flow"],
          },
          coverageMechanism: ["Vitest, Playwright, and hosted proof checks"],
          deploymentContract: {
            mode: "defer",
            summary: "Wire live infrastructure only through explicit conversation.",
            artifactType: "web app",
            platforms: ["Fly.io"],
            environments: ["local", "preview", "production"],
            buildSteps: ["pnpm build"],
            deploySteps: ["deferred"],
            previewStrategy: ["Preview infrastructure exists as a later thread."],
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
      });

      const json = JSON.stringify({
        message: "This lane is parked.",
        confidence: 96,
        reasoning: "Local milestone is complete and deployment can wait for later.",
      });
      const promise = gen.generateSuggestion(
        "Local CI is green and the current slice is stable.",
        "claude",
      );
      completeWithText(proc, json);

      const result = await promise;
      expect(result.text).toContain("Continue.");
      expect(result.reasoning).toContain("hosted proof and deployment are still explicitly deferred for this web app");
      expect(result.reasoning).toContain("Continuation guard tripped");
      expect(result.confidence).toBe(92);
    });

    it("rejects with clean error on non-zero exit", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const promise = gen.generateSuggestion("ctx", "claude");
      failWithCode(proc, 1);

      await expect(promise).rejects.toThrow("Sidecar process failed (exit code 1)");
    });

    it("uses stderr for error message when available", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const promise = gen.generateSuggestion("ctx", "claude");
      failWithCode(proc, 1, "Authentication failed\nMore details here");

      await expect(promise).rejects.toThrow("Authentication failed");
    });

    it("calls onPartial with accumulated text", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const partials: string[] = [];
      const promise = gen.generateSuggestion("context", "claude", undefined, (text) => {
        partials.push(text);
      });

      setImmediate(() => {
        writeTextDelta(proc, '{"mes');
        writeTextDelta(proc, 'sage": "hi"}');
        setImmediate(() => {
          proc.stdout.end();
          proc.emit("close", 0);
        });
      });

      await promise;
      expect(partials.length).toBeGreaterThanOrEqual(1);
      expect(partials[partials.length - 1]).toContain('{"message": "hi"}');
    });

    it("includes browserActions when present in response", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const json = JSON.stringify({
        message: "test",
        confidence: 80,
        reasoning: "ok",
        browserActions: [{ type: "screenshot", params: {}, description: "check state" }],
      });
      const promise = gen.generateSuggestion("ctx", "claude");
      completeWithText(proc, json);

      const result = await promise;
      expect(result.browserActions).toHaveLength(1);
      expect(result.browserActions![0].type).toBe("screenshot");
    });

    it("includes orchestratorActions when present", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const json = JSON.stringify({
        message: "test",
        confidence: 80,
        reasoning: "ok",
        orchestratorActions: [{ type: "plan", workerId: "w1", text: "do task" }],
      });
      const promise = gen.generateSuggestion("ctx", "claude");
      completeWithText(proc, json);

      const result = await promise;
      expect(result.orchestratorActions).toHaveLength(1);
    });

    it("rejects with no output error when process succeeds but produces nothing", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      const promise = gen.generateSuggestion("ctx", "claude");
      setImmediate(() => {
        proc.stdout.end();
        proc.emit("close", 0);
      });

      await expect(promise).rejects.toThrow("Sidecar produced no output");
    });

    it("rejects when stateless parsing fails after a clean sidecar exit", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);
      const parseSpy = vi.spyOn(gen as any, "parseSuggestionOutput").mockImplementation(() => {
        throw new Error("bad parse");
      });

      const promise = gen.generateSuggestion("ctx", "claude");
      completeWithText(proc, JSON.stringify({ message: "hello", confidence: 80, reasoning: "ok" }));

      await expect(promise).rejects.toThrow("bad parse");
      parseSpy.mockRestore();
    });

    it("rejects if a lane-backed session tries to draft without a responder monitor", async () => {
      await expect(
        gen.generateSuggestion(
          "ctx",
          "claude",
          {
            profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
            profileName: "claude",
            projectName: "demo",
            projectDir: "/tmp/demo",
            worktreePath: "/tmp/demo",
            worktreeName: "main",
          },
        ),
      ).rejects.toThrow("Roscoe responder session is required for lane-backed drafting");
    });

    it("uses the longer timeout window with a clearer timeout error", async () => {
      vi.useFakeTimers();
      const proc = createMockProc();
      proc.kill.mockImplementation(() => {
        proc.killed = true;
      });
      mockSpawn.mockReturnValue(proc);

      try {
        const promise = gen.generateSuggestion("ctx", "claude");
        await Promise.resolve();

        vi.advanceTimersByTime(300_000);
        proc.stdout.end();
        proc.emit("close", null);

        await expect(promise).rejects.toThrow("Roscoe sidecar timed out after 300s before it produced a reply.");
      } finally {
        vi.useRealTimers();
      }
    });

    it("seeds a hidden responder session once and resumes it with incremental lane deltas", async () => {
      const responderMonitor = new FakeResponderMonitor();
      const seedTrace: any[] = [];
      const usage: any[] = [];

      const first = await gen.generateSuggestion(
        "LLM: first guild turn",
        "claude",
        {
          profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
          profileName: "claude",
          projectName: "demo",
          projectDir: "/tmp/demo",
          worktreePath: "/tmp/demo",
          worktreeName: "main",
          responderMonitor: responderMonitor as any,
          responderHistory: [
            { role: "assistant", content: "first guild turn", timestamp: 1 },
          ],
          responderHistoryCursor: 0,
        },
        undefined,
        (trace) => seedTrace.push(trace),
        (value) => usage.push(value),
      );

      expect(first.text).toBe("seeded");
      expect(responderMonitor.startTurn).toHaveBeenCalledTimes(1);
      expect(seedTrace[0].prompt).toContain("persistent hidden Roscoe responder thread");
      expect(seedTrace[0].prompt).toContain("Given the following context from active Guild coding sessions");
      expect(usage[0]).toMatchObject({ inputTokens: 10, outputTokens: 2 });

      const second = await gen.generateSuggestion(
        "LLM: first guild turn\n\nUser: edited reply\n\nLLM: second guild turn",
        "claude",
        {
          profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
          profileName: "claude",
          projectName: "demo",
          projectDir: "/tmp/demo",
          worktreePath: "/tmp/demo",
          worktreeName: "main",
          responderMonitor: responderMonitor as any,
          responderHistory: [
            { role: "assistant", content: "first guild turn", timestamp: 1 },
            { role: "user", content: "edited reply", timestamp: 2 },
            { role: "assistant", content: "second guild turn", timestamp: 3 },
          ],
          responderHistoryCursor: 1,
        },
        undefined,
        (trace) => seedTrace.push(trace),
        (value) => usage.push(value),
      );

      expect(second.text).toBe("resumed");
      expect(responderMonitor.sendFollowUp).toHaveBeenCalledTimes(1);
      expect(String(responderMonitor.sendFollowUp.mock.calls[0][0])).toContain("=== Incremental Lane Delta ===");
      expect(String(responderMonitor.sendFollowUp.mock.calls[0][0])).toContain("Sent to Guild: edited reply");
      expect(String(responderMonitor.sendFollowUp.mock.calls[0][0])).toContain("Guild: second guild turn");
      expect(seedTrace[1].prompt).toContain("Incremental Lane Delta");
      expect(seedTrace[1].rationale).toContain("incremental lane deltas");
      expect(usage[1]).toMatchObject({ inputTokens: 3, cachedInputTokens: 7 });
    });

    it("uses the non-seed stateful follow-up path when the responder thread already exists", async () => {
      const responderMonitor = new ExitOnlyResponderMonitor("existing-session");
      const trace: any[] = [];

      const result = await gen.generateSuggestion(
        "assistant: old turn\nuser: revise\nassistant: new turn",
        "claude",
        {
          profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
          profileName: "claude",
          projectName: "demo",
          projectDir: "/tmp/demo",
          worktreePath: "/tmp/demo",
          worktreeName: "main",
          responderMonitor: responderMonitor as any,
          responderHistory: [
            { role: "assistant", content: "old turn", timestamp: 1 },
            { role: "user", content: "revise", timestamp: 2 },
            { role: "assistant", content: "new turn", timestamp: 3 },
          ],
          responderHistoryCursor: 2,
        },
        undefined,
        (value) => {
          trace.push(value);
        },
      );

      expect(result.text).toBe("exit-only");
      expect(responderMonitor.sendFollowUp).toHaveBeenCalledTimes(1);
      expect(responderMonitor.startTurn).not.toHaveBeenCalled();
      expect(trace.at(-1)?.rationale).toContain("incremental lane deltas");
    });

    it("recovers Claude responder output from the native session log when no text is captured in-process", async () => {
      const responderMonitor = new SilentResponderMonitor("resume-session");
      vi.mocked(existsSync).mockImplementation((path) => String(path).includes("resume-session.jsonl"));
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (String(path).includes("resume-session.jsonl")) {
          return [
            JSON.stringify({
              type: "assistant",
              message: {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "{\"message\":\"Recovered hold\",\"confidence\":81,\"reasoning\":\"provider log fallback\"}",
                  },
                ],
                stop_reason: "end_turn",
              },
            }),
            "",
          ].join("\n");
        }
        return "";
      });

      const result = await gen.generateSuggestion(
        "ctx",
        "claude",
        {
          profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
          profileName: "claude",
          projectName: "demo",
          projectDir: "/tmp/demo",
          worktreePath: "/tmp/demo",
          worktreeName: "main",
          responderMonitor: responderMonitor as any,
          responderHistory: [
            { role: "assistant", content: "guild turn", timestamp: 1 },
          ],
          responderHistoryCursor: 1,
        },
      );

      expect(result.text).toBe("Recovered hold");
      expect(result.confidence).toBe(81);
      expect(responderMonitor.sendFollowUp).toHaveBeenCalledTimes(1);
    });

    it("infers Codex and Gemini responder profiles for stateless drafting", async () => {
      const codexProc = createMockProc();
      const geminiProc = createMockProc();
      mockSpawn
        .mockReturnValueOnce(codexProc)
        .mockReturnValueOnce(geminiProc);

      const codexPromise = gen.generateSuggestion("ctx", "codex");
      setImmediate(() => {
        codexProc.stdout.write(JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: '{"message":"codex","confidence":70,"reasoning":"ok"}',
          },
        }) + "\n");
        setImmediate(() => {
          codexProc.stdout.end();
          codexProc.emit("close", 0);
        });
      });
      const geminiPromise = gen.generateSuggestion("ctx", "gemini");
      setImmediate(() => {
        geminiProc.stdout.write(JSON.stringify({
          type: "message",
          role: "assistant",
          content: '{"message":"gemini","confidence":70,"reasoning":"ok"}',
        }) + "\n");
        setImmediate(() => {
          geminiProc.stdout.end();
          geminiProc.emit("close", 0);
        });
      });

      await expect(codexPromise).resolves.toMatchObject({ text: "codex" });
      await expect(geminiPromise).resolves.toMatchObject({ text: "gemini" });
      expect(mockSpawn.mock.calls[0]?.[0]).toBe("codex");
      expect(mockSpawn.mock.calls[1]?.[0]).toBe("gemini");
    });

    it("resolves a stateful responder turn from a clean exit even without turn-complete", async () => {
      const responderMonitor = new ExitOnlyResponderMonitor(null);

      const result = await gen.generateSuggestion(
        "ctx",
        "claude",
        {
          profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
          profileName: "claude",
          projectName: "demo",
          projectDir: "/tmp/demo",
          worktreePath: "/tmp/demo",
          worktreeName: "main",
          responderMonitor: responderMonitor as any,
          responderHistory: [],
          responderHistoryCursor: 0,
        },
      );

      expect(result).toMatchObject({
        text: "exit-only",
        confidence: 77,
        reasoning: "exit path",
      });
      expect(responderMonitor.startTurn).toHaveBeenCalledTimes(1);
    });

    it("rejects stateful generation when the responder monitor is missing", async () => {
      await expect((gen as any).generateSuggestionStateful(
        "ctx",
        { name: "claude", command: "claude", args: [], protocol: "claude" },
        {
          responderMonitor: null,
        },
      )).rejects.toThrow("Missing responder monitor for stateful Roscoe generation");
    });

    it("returns no fallback stateful responder output when the responder session id is missing", () => {
      const recovered = (gen as any).recoverStatefulResponderOutput(
        { name: "claude", command: "claude", args: [], protocol: "claude" },
        {
          responderMonitor: { getSessionId: () => null },
        },
      );

      expect(recovered).toBeNull();
    });

    it("surfaces parse failures after turn-complete in a stateful responder turn", async () => {
      const responderMonitor = new FakeResponderMonitor();
      (gen as any).parseSuggestionOutput = vi.fn(() => {
        throw "bad-parse";
      });
      responderMonitor.startTurn.mockImplementationOnce(() => {
        setImmediate(() => {
          responderMonitor.emit("text", "{\"message\":\"ok\"}");
          responderMonitor.emit("turn-complete");
          responderMonitor.emit("exit", 0);
        });
      });

      await expect(gen.generateSuggestion(
        "ctx",
        "claude",
        {
          profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
          profileName: "claude",
          projectName: "demo",
          projectDir: "/tmp/demo",
          worktreePath: "/tmp/demo",
          worktreeName: "main",
          responderMonitor: responderMonitor as any,
          responderHistory: [],
          responderHistoryCursor: 0,
        },
      )).rejects.toThrow("bad-parse");
    });

    it("surfaces parse failures after a clean stateful exit without turn-complete", async () => {
      const responderMonitor = new ExitOnlyResponderMonitor(null);
      (gen as any).parseSuggestionOutput = vi.fn(() => {
        throw "bad-exit-parse";
      });
      responderMonitor.startTurn.mockImplementationOnce(() => {
        setImmediate(() => {
          responderMonitor.emit("text", "{\"message\":\"ok\"}");
          responderMonitor.emit("exit", 0);
        });
      });

      await expect(gen.generateSuggestion(
        "ctx",
        "claude",
        {
          profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
          profileName: "claude",
          projectName: "demo",
          projectDir: "/tmp/demo",
          worktreePath: "/tmp/demo",
          worktreeName: "main",
          responderMonitor: responderMonitor as any,
          responderHistory: [],
          responderHistoryCursor: 0,
        },
      )).rejects.toThrow("bad-exit-parse");
    });

    it("times out a stateful responder turn and kills the responder monitor", async () => {
      vi.useFakeTimers();
      const responderMonitor = new SilentResponderMonitor(null as any);
      responderMonitor.kill.mockImplementation(() => {
        responderMonitor.emit("exit", 1);
      });

      try {
        const promise = gen.generateSuggestion(
          "ctx",
          "claude",
          {
            profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
            profileName: "claude",
            projectName: "demo",
            projectDir: "/tmp/demo",
            worktreePath: "/tmp/demo",
            worktreeName: "main",
            responderMonitor: responderMonitor as any,
            responderHistory: [],
            responderHistoryCursor: 0,
          },
        );
        const rejection = expect(promise).rejects.toThrow("Roscoe sidecar timed out after 300s before it produced a reply.");

        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(300_000);
        await rejection;
        expect(responderMonitor.kill).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("cancelGeneration", () => {
    it("kills the sidecar process", async () => {
      const proc = createMockProc();
      mockSpawn.mockReturnValue(proc);

      // Start generation (don't await — we'll cancel)
      const promise = gen.generateSuggestion("ctx", "claude");

      // Wait for spawn to be called (buildContext is async)
      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled();
      });

      // Cancel
      gen.cancelGeneration();
      expect(proc.kill).toHaveBeenCalled();

      // Simulate close after kill
      proc.killed = true;
      proc.emit("close", null);

      await expect(promise).rejects.toThrow("cancelled");
    });
  });
});
