import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "stream";
import { EventEmitter } from "events";
const mockSpawn = vi.fn();
vi.mock("child_process", () => ({
    spawn: (...args) => mockSpawn(...args),
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
import { existsSync, readFileSync, readdirSync } from "fs";
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
/** Write a stream-json text_delta line to the proc's stdout */
function writeTextDelta(proc, text) {
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
function completeWithText(proc, text) {
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
function failWithCode(proc, code, stderrText) {
    setImmediate(() => {
        if (stderrText) {
            proc.stderr.write(stderrText);
        }
        proc.stdout.end();
        proc.emit("close", code);
    });
}
describe("ResponseGenerator", () => {
    let gen;
    beforeEach(() => {
        gen = new ResponseGenerator(70);
        mockSpawn.mockReset();
        vi.mocked(existsSync).mockReturnValue(false);
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
                intentBrief: {
                    projectStory: "Give operators a clean workflow",
                    primaryUsers: ["operators"],
                    definitionOfDone: ["main flow is stable"],
                    acceptanceChecks: ["demo path completes without hand holding"],
                    successSignals: ["operators can finish the task"],
                    deliveryPillars: {
                        frontend: ["Frontend operator flow renders and completes correctly"],
                        backend: ["Backend workflow APIs persist and validate correctly"],
                        unitComponentTests: ["Vitest unit/component coverage reaches 100% including edge cases"],
                        e2eTests: ["Playwright e2e coverage reaches 100% across success and failure paths"],
                    },
                    coverageMechanism: ["Vitest plus Playwright coverage reports provide the measurable percent gate"],
                    nonGoals: ["rewriting the stack"],
                    constraints: ["keep the keyboard-first UX"],
                    autonomyRules: ["ask before broad scope changes"],
                    qualityBar: ["Do not call this done until Vitest and Playwright show 100% coverage on edge cases proving the frontend and backend outcomes"],
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
            expect(ctx).toContain("Who is it for?");
        });
        it("includes worktree info from session", async () => {
            vi.mocked(existsSync).mockReturnValue(false);
            const session = {
                profile: { name: "claude", command: "claude", args: [], protocol: "claude" },
                profileName: "test",
                projectName: "proj",
                projectDir: "/tmp/proj",
                worktreePath: "/tmp/proj-feat",
                worktreeName: "feat",
            };
            const ctx = await gen.buildContext("test", "claude", session);
            expect(ctx).toContain("Active Guild conversation with claude");
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
            vi.mocked(readdirSync).mockReturnValue(["session.jsonl"]);
            vi.mocked(readFileSync).mockReturnValue('{"display":"line 1"}\n{"display":"line 2"}\n');
            const lines = gen.readClaudeTranscript("/tmp/project");
            expect(lines).toEqual(["line 1", "line 2"]);
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
        it("emits responder trace metadata with command preview and tuning rationale", async () => {
            const proc = createMockProc();
            mockSpawn.mockReturnValue(proc);
            let trace = null;
            const promise = gen.generateSuggestion("Refine the frontend hero layout and interaction flow", "claude", {
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
            }, undefined, (value) => {
                trace = value;
            });
            completeWithText(proc, JSON.stringify({ message: "Ship it", confidence: 88, reasoning: "clear next step" }));
            await promise;
            expect(trace).toMatchObject({
                strategy: "auto-frontend",
            });
            expect(trace?.prompt).toContain("Respond in this EXACT JSON format");
            expect(trace?.commandPreview).toContain("--model");
            expect(trace?.runtimeSummary).toContain("medium");
            expect(trace?.rationale).toContain("UI");
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
            const partials = [];
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
            expect(result.browserActions[0].type).toBe("screenshot");
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
