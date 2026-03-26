import { describe, it, expect, vi, beforeEach } from "vitest";
import { homedir } from "os";
import { resolve } from "path";
import { EventEmitter } from "events";
const { mockStartOneShotRun } = vi.hoisted(() => ({
    mockStartOneShotRun: vi.fn(() => ({
        proc: {},
        result: Promise.resolve("Test summary"),
    })),
}));
// Create a proper mock class
class MockSessionMonitor extends EventEmitter {
    startTurn = vi.fn();
    sendFollowUp = vi.fn();
    getSessionId = vi.fn(() => null);
    kill = vi.fn();
    setProfile = vi.fn();
    id;
    constructor(id) {
        super();
        this.id = id;
    }
}
// Mock modules before importing
vi.mock("../config.js", () => ({
    loadProfile: vi.fn(() => ({ name: "test", command: "claude", args: [] })),
    loadProjectContext: vi.fn(() => null),
}));
vi.mock("../session-monitor.js", () => ({
    SessionMonitor: vi.fn().mockImplementation(function (id) {
        return new MockSessionMonitor(id);
    }),
}));
vi.mock("../llm-runtime.js", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        startOneShotRun: mockStartOneShotRun,
    };
});
import { expandTilde, parseSessionSpec, SessionManagerService } from "./session-manager.js";
import { SessionMonitor } from "../session-monitor.js";
import { loadProfile, loadProjectContext } from "../config.js";
import { startOneShotRun } from "../llm-runtime.js";
// ── Pure helpers ────────────────────────────────────────────
describe("expandTilde", () => {
    it("expands ~ alone to homedir", () => {
        expect(expandTilde("~")).toBe(homedir());
    });
    it("expands ~/path to homedir + path", () => {
        expect(expandTilde("~/projects")).toBe(resolve(homedir(), "projects"));
    });
    it("returns non-tilde paths unchanged", () => {
        expect(expandTilde("/usr/local")).toBe("/usr/local");
    });
    it("returns relative paths unchanged", () => {
        expect(expandTilde("relative/path")).toBe("relative/path");
    });
});
describe("parseSessionSpec", () => {
    it("parses profile-only spec", () => {
        const result = parseSessionSpec("claude-code");
        expect(result).toEqual({
            profileName: "claude-code",
            projectDir: null,
            taskName: null,
        });
    });
    it("parses profile@dir spec", () => {
        const result = parseSessionSpec("claude-code@/tmp/project");
        expect(result).toEqual({
            profileName: "claude-code",
            projectDir: resolve("/tmp/project"),
            taskName: null,
        });
    });
    it("parses profile@dir:task spec", () => {
        const result = parseSessionSpec("claude-code@/tmp/project:fix-bug");
        expect(result).toEqual({
            profileName: "claude-code",
            projectDir: resolve("/tmp/project"),
            taskName: "fix-bug",
        });
    });
    it("expands tilde in directory", () => {
        const result = parseSessionSpec("claude-code@~/projects/foo");
        expect(result.projectDir).toBe(resolve(homedir(), "projects/foo"));
    });
    it("handles empty task name after colon", () => {
        const result = parseSessionSpec("claude-code@/tmp/project:");
        expect(result.taskName).toBe("");
    });
    it("handles @ in profile name (uses first @)", () => {
        const result = parseSessionSpec("profile@/path@with-at");
        expect(result.profileName).toBe("profile");
    });
});
// ── SessionManagerService ───────────────────────────────────
describe("SessionManagerService", () => {
    let svc;
    beforeEach(() => {
        // Re-apply mock implementations after mockReset
        vi.mocked(loadProfile).mockReturnValue({ name: "test", command: "claude", args: [] });
        vi.mocked(loadProjectContext).mockReturnValue(null);
        vi.mocked(SessionMonitor).mockImplementation(function (id) {
            return new MockSessionMonitor(id);
        });
        vi.mocked(startOneShotRun).mockImplementation(() => ({
            proc: {},
            result: Promise.resolve("Test summary"),
        }));
        svc = new SessionManagerService();
    });
    describe("startSession", () => {
        it("creates a managed session with correct id format", () => {
            const managed = svc.startSession({
                profileName: "claude-code",
                projectDir: "/tmp/proj",
                worktreePath: "/tmp/proj",
                worktreeName: "main",
                projectName: "proj",
            });
            expect(managed.id).toMatch(/^claude-code-proj-main-\d+$/);
            expect(managed.profileName).toBe("claude-code");
            expect(managed.projectName).toBe("proj");
            expect(managed.awaitingInput).toBe(true);
        });
        it("passes resolved runtime settings through to the worker monitor", () => {
            vi.mocked(loadProfile).mockReturnValue({
                name: "codex",
                command: "codex",
                args: [],
                protocol: "codex",
            });
            vi.mocked(loadProjectContext).mockReturnValue({
                name: "proj",
                directory: "/tmp/proj",
                goals: [],
                milestones: [],
                techStack: [],
                notes: "",
                runtimeDefaults: {
                    workerByProtocol: {
                        codex: {
                            model: "gpt-5.4",
                            reasoningEffort: "xhigh",
                            sandboxMode: "workspace-write",
                            approvalPolicy: "never",
                        },
                    },
                },
            });
            svc.startSession({
                profileName: "codex",
                projectDir: "/tmp/proj",
                worktreePath: "/tmp/proj",
                worktreeName: "main",
                projectName: "proj",
            });
            expect(vi.mocked(SessionMonitor)).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                runtime: expect.objectContaining({
                    model: "gpt-5.4",
                    reasoningEffort: "xhigh",
                }),
            }), "/tmp/proj");
        });
        it("locks a project to the onboarded provider even if a different profile is requested", () => {
            vi.mocked(loadProfile).mockImplementation((name) => {
                if (name === "claude-code") {
                    return { name, command: "claude", args: [], protocol: "claude" };
                }
                return { name: "codex", command: "codex", args: [], protocol: "codex" };
            });
            vi.mocked(loadProjectContext).mockReturnValue({
                name: "proj",
                directory: "/tmp/proj",
                goals: [],
                milestones: [],
                techStack: [],
                notes: "",
                runtimeDefaults: {
                    lockedProvider: "codex",
                    onboarding: {
                        profileName: "codex",
                        runtime: {
                            tuningMode: "auto",
                            model: "gpt-5.4",
                            reasoningEffort: "xhigh",
                        },
                    },
                },
            });
            const managed = svc.startSession({
                profileName: "claude-code",
                projectDir: "/tmp/proj",
                worktreePath: "/tmp/proj",
                worktreeName: "main",
                projectName: "proj",
            });
            expect(managed.profileName).toBe("codex");
            expect(managed.profile.protocol).toBe("codex");
        });
    });
    describe("generateSummary", () => {
        it("returns summary from the shared one-shot runner", async () => {
            const managed = svc.startSession({
                profileName: "test",
                projectDir: "/tmp",
                worktreePath: "/tmp",
                worktreeName: "main",
                projectName: "test",
            });
            managed.tracker.addOutput("Did some work");
            managed.tracker.markTurnComplete();
            const summary = await svc.generateSummary(managed);
            expect(summary).toBe("Test summary");
        });
        it("returns fallback on error", async () => {
            vi.mocked(startOneShotRun).mockImplementation(() => ({
                proc: {},
                result: Promise.reject(new Error("fail")),
            }));
            const managed = svc.startSession({
                profileName: "test",
                projectDir: "/tmp",
                worktreePath: "/tmp",
                worktreeName: "main",
                projectName: "test",
            });
            const summary = await svc.generateSummary(managed);
            expect(summary).toBe("(summary unavailable)");
        });
    });
    describe("injectText", () => {
        it("records user input and sets awaitingInput to false", () => {
            const managed = svc.startSession({
                profileName: "test",
                projectDir: "/tmp",
                worktreePath: "/tmp",
                worktreeName: "main",
                projectName: "test",
            });
            svc.injectText(managed, "hello");
            expect(managed.awaitingInput).toBe(false);
            expect(managed.tracker.getHistory()).toHaveLength(1);
            expect(managed.tracker.getHistory()[0].content).toBe("hello");
        });
    });
    describe("executeSuggestion", () => {
        it("injects a suggestion only once while awaiting input", async () => {
            const managed = svc.startSession({
                profileName: "test",
                projectDir: "/tmp",
                worktreePath: "/tmp",
                worktreeName: "main",
                projectName: "test",
            });
            managed.awaitingInput = true;
            managed.monitor.getSessionId = vi.fn(() => "session-1");
            await svc.executeSuggestion(managed, {
                text: "continue",
                confidence: 90,
                reasoning: "clear next step",
            });
            await svc.executeSuggestion(managed, {
                text: "continue",
                confidence: 90,
                reasoning: "clear next step",
            });
            expect(managed.monitor.sendFollowUp).toHaveBeenCalledTimes(1);
            expect(managed.monitor.sendFollowUp).toHaveBeenCalledWith("continue");
            expect(managed.awaitingInput).toBe(false);
        });
    });
});
