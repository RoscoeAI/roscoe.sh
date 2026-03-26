import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
// Create a class that properly extends EventEmitter for the mock
class MockSessionMonitor extends EventEmitter {
    startTurn = vi.fn();
    sendFollowUp = vi.fn();
    getSessionId = vi.fn(() => "sess-1");
    kill = vi.fn();
    id;
    constructor(id) {
        super();
        this.id = id;
    }
}
let mockMonitorInstance;
vi.mock("./session-monitor.js", () => ({
    SessionMonitor: vi.fn().mockImplementation(function (id) {
        mockMonitorInstance = new MockSessionMonitor(id);
        return mockMonitorInstance;
    }),
}));
vi.mock("./config.js", () => ({
    loadProjectContext: vi.fn(() => null),
    listProjectHistory: vi.fn(() => []),
    registerProject: vi.fn(),
    saveProjectHistory: vi.fn(),
    saveProjectContext: vi.fn(),
    normalizeProjectContext: vi.fn((value) => ({
        name: value.name ?? "project",
        directory: value.directory ?? "/tmp",
        goals: value.goals ?? [],
        milestones: value.milestones ?? [],
        techStack: value.techStack ?? [],
        notes: value.notes ?? "",
        intentBrief: value.intentBrief ?? {
            projectStory: value.notes || "Deliver the project goals without drifting scope.",
            primaryUsers: [],
            definitionOfDone: value.goals ?? [],
            acceptanceChecks: [],
            successSignals: value.milestones ?? [],
            deliveryPillars: {
                frontend: [],
                backend: [],
                unitComponentTests: [],
                e2eTests: [],
            },
            coverageMechanism: [],
            nonGoals: [],
            constraints: [],
            autonomyRules: [],
            qualityBar: [],
            riskBoundaries: [],
            uiDirection: "",
        },
        interviewAnswers: value.interviewAnswers ?? [],
        ...(value.runtimeDefaults ? { runtimeDefaults: value.runtimeDefaults } : {}),
    })),
}));
vi.mock("./debug-log.js", () => ({
    dbg: vi.fn(),
    enableDebug: vi.fn(),
}));
vi.mock("fs", () => ({
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
}));
import { Onboarder } from "./onboarder.js";
import { SessionMonitor } from "./session-monitor.js";
function seedInterviewCoverage(onboarder) {
    onboarder.sendInput("Ship a clean operator workflow", {
        question: "What is the product vision Roscoe should optimize for?",
        theme: "project-story",
    });
    onboarder.sendInput("Operations teams", {
        question: "Who are the primary users Roscoe should optimize for?",
        theme: "primary-users",
    });
    onboarder.sendInput("The main flow works", {
        question: "What is the definition of done Roscoe should defend?",
        theme: "definition-of-done",
    });
    onboarder.sendInput("The demo path works", {
        question: "What proof should Roscoe require before calling this done?",
        theme: "acceptance-checks",
    });
    onboarder.sendInput("Frontend and backend outcomes must be proven by unit/component and e2e coverage", {
        question: "How should Roscoe define the delivery pillars across frontend, backend, unit/component tests, and e2e tests?",
        theme: "delivery-pillars",
    });
    onboarder.sendInput("Avoid scope creep", {
        question: "What are the non goals Roscoe should hold the line on?",
        theme: "non-goals",
    });
    onboarder.sendInput("Ask before changing scope", {
        question: "What autonomy rules should Roscoe follow when Guild sessions hit ambiguity?",
        theme: "autonomy-rules",
    });
    onboarder.sendInput("Require tests and a demo path", {
        question: "What quality bar should Roscoe enforce before Guild work is considered done?",
        theme: "quality-bar",
    });
    onboarder.sendInput("Use Vitest and Playwright coverage reports so Roscoe always has a measurable percent gate", {
        question: "How will Roscoe measure coverage percent in this repo?",
        theme: "coverage-mechanism",
    });
    onboarder.sendInput("Avoid regressions", {
        question: "What risks Roscoe should avoid without explicit approval?",
        theme: "risk-boundaries",
    });
}
describe("Onboarder", () => {
    let onboarder;
    beforeEach(() => {
        // Re-apply mockImplementation since mockReset clears it
        vi.mocked(SessionMonitor).mockImplementation(function (id) {
            mockMonitorInstance = new MockSessionMonitor(id);
            return mockMonitorInstance;
        });
        onboarder = new Onboarder("/tmp/test-project");
    });
    describe("start", () => {
        it("creates a SessionMonitor and starts a turn", () => {
            onboarder.start();
            expect(mockMonitorInstance.startTurn).toHaveBeenCalledWith(expect.stringContaining("Roscoe's onboarding strategist"));
        });
        it("returns the session via getSession", () => {
            onboarder.start();
            expect(onboarder.getSession()).toBeTruthy();
        });
    });
    describe("event forwarding", () => {
        it("forwards text events as output", () => {
            return new Promise((resolve) => {
                onboarder.start();
                onboarder.on("output", (chunk) => {
                    expect(chunk).toBe("hello");
                    resolve();
                });
                mockMonitorInstance.emit("text", "hello");
            });
        });
        it("forwards thinking events", () => {
            return new Promise((resolve) => {
                onboarder.start();
                onboarder.on("thinking", (chunk) => {
                    expect(chunk).toBe("hmm");
                    resolve();
                });
                mockMonitorInstance.emit("thinking", "hmm");
            });
        });
        it("forwards tool-activity events", () => {
            return new Promise((resolve) => {
                onboarder.start();
                onboarder.on("tool-activity", (tool) => {
                    expect(tool).toBe("Read");
                    resolve();
                });
                mockMonitorInstance.emit("tool-activity", "Read");
            });
        });
        it("emits turn-complete when no brief found", () => {
            return new Promise((resolve) => {
                onboarder.start();
                onboarder.on("turn-complete", () => {
                    resolve();
                });
                mockMonitorInstance.emit("text", "Here's my analysis...");
                mockMonitorInstance.emit("turn-complete");
            });
        });
    });
    describe("sendInput", () => {
        it("calls sendFollowUp with formatted prompt", () => {
            onboarder.start();
            onboarder.sendInput("Option A", { question: "Priority?", theme: "definition-of-done" });
            expect(mockMonitorInstance.sendFollowUp).toHaveBeenCalledWith(expect.stringContaining("Priority?"));
            expect(mockMonitorInstance.sendFollowUp).toHaveBeenCalledWith(expect.stringContaining("Option A"));
        });
    });
    describe("checkForProjectBrief", () => {
        it("emits onboarding-complete when ---BRIEF--- block found", () => {
            return new Promise((resolve) => {
                onboarder.start();
                seedInterviewCoverage(onboarder);
                onboarder.on("onboarding-complete", (brief) => {
                    expect(brief.name).toBe("TestProject");
                    expect(brief.intentBrief).toBeTruthy();
                    resolve();
                });
                const briefJson = JSON.stringify({
                    name: "TestProject",
                    directory: "/tmp",
                    goals: ["goal1"],
                    milestones: ["m1"],
                    techStack: ["TypeScript"],
                    notes: "",
                    intentBrief: {
                        projectStory: "Ship safely",
                        primaryUsers: ["operators"],
                        definitionOfDone: ["The frontend and backend operator workflow behave correctly"],
                        acceptanceChecks: ["Vitest unit/component and Playwright e2e runs prove the full workflow end to end"],
                        successSignals: ["operators can finish the task"],
                        deliveryPillars: {
                            frontend: ["Frontend operator flow is complete and stable"],
                            backend: ["Backend workflow API is correct and stable"],
                            unitComponentTests: ["Vitest unit/component coverage reaches 100% on frontend/backend logic and edge cases"],
                            e2eTests: ["Playwright e2e coverage reaches 100% on workflow success and failure modes"],
                        },
                        coverageMechanism: ["Vitest plus Playwright coverage reports provide a measurable percent gate"],
                        nonGoals: ["avoid scope creep"],
                        constraints: ["maintain compatibility"],
                        autonomyRules: ["ask before changing scope"],
                        qualityBar: ["Do not call done until Vitest and Playwright show 100% coverage with edge cases proving the frontend and backend outcomes"],
                        riskBoundaries: ["avoid regressions"],
                        uiDirection: "",
                    },
                });
                mockMonitorInstance.emit("text", `Analysis complete.\n---BRIEF---\n${briefJson}\n---END_BRIEF---`);
                mockMonitorInstance.emit("turn-complete");
            });
        });
        it("persists runtime defaults into the saved brief", () => {
            return new Promise((resolve) => {
                onboarder = new Onboarder("/tmp/test-project", false, undefined, {
                    workerByProtocol: {
                        claude: {
                            model: "claude-opus-4-6",
                            reasoningEffort: "high",
                        },
                    },
                });
                onboarder.start();
                seedInterviewCoverage(onboarder);
                onboarder.on("onboarding-complete", (brief) => {
                    expect(brief.runtimeDefaults).toMatchObject({
                        workerByProtocol: {
                            claude: {
                                model: "claude-opus-4-6",
                            },
                        },
                    });
                    expect(brief.interviewAnswers).toHaveLength(10);
                    expect(brief.interviewAnswers[0]).toMatchObject({
                        theme: "project-story",
                    });
                    resolve();
                });
                const briefJson = JSON.stringify({
                    name: "TestProject",
                    directory: "/tmp",
                    goals: ["goal1"],
                    milestones: ["m1"],
                    techStack: ["TypeScript"],
                    notes: "",
                    intentBrief: {
                        projectStory: "Ship safely",
                        primaryUsers: ["operators"],
                        definitionOfDone: ["The frontend and backend operator workflow behave correctly"],
                        acceptanceChecks: ["Vitest unit/component and Playwright e2e runs prove the full workflow end to end"],
                        successSignals: ["operators can finish the task"],
                        deliveryPillars: {
                            frontend: ["Frontend operator flow is complete and stable"],
                            backend: ["Backend workflow API is correct and stable"],
                            unitComponentTests: ["Vitest unit/component coverage reaches 100% on frontend/backend logic and edge cases"],
                            e2eTests: ["Playwright e2e coverage reaches 100% on workflow success and failure modes"],
                        },
                        coverageMechanism: ["Vitest plus Playwright coverage reports provide a measurable percent gate"],
                        nonGoals: ["avoid scope creep"],
                        constraints: ["maintain compatibility"],
                        autonomyRules: ["ask before changing scope"],
                        qualityBar: ["Do not call done until Vitest and Playwright show 100% coverage with edge cases proving the frontend and backend outcomes"],
                        riskBoundaries: ["avoid regressions"],
                        uiDirection: "",
                    },
                });
                mockMonitorInstance.emit("text", `Analysis complete.\n---BRIEF---\n${briefJson}\n---END_BRIEF---`);
                mockMonitorInstance.emit("turn-complete");
            });
        });
        it("persists captured interview answers into the saved brief", () => {
            return new Promise((resolve) => {
                onboarder.start();
                seedInterviewCoverage(onboarder);
                onboarder.sendInput("Move fast", { question: "How aggressive should Roscoe be?", theme: "autonomy-rules" });
                onboarder.on("onboarding-complete", (brief) => {
                    expect(brief.interviewAnswers).toContainEqual({
                        question: "How aggressive should Roscoe be?",
                        answer: "Move fast",
                        theme: "autonomy-rules",
                    });
                    resolve();
                });
                const briefJson = JSON.stringify({
                    name: "TestProject",
                    directory: "/tmp",
                    goals: ["goal1"],
                    milestones: ["m1"],
                    techStack: ["TypeScript"],
                    notes: "",
                    intentBrief: {
                        projectStory: "Ship safely",
                        primaryUsers: ["operators"],
                        definitionOfDone: ["The frontend and backend operator workflow behave correctly"],
                        acceptanceChecks: ["Vitest unit/component and Playwright e2e runs prove the full workflow end to end"],
                        successSignals: ["operators can finish the task"],
                        deliveryPillars: {
                            frontend: ["Frontend operator flow is complete and stable"],
                            backend: ["Backend workflow API is correct and stable"],
                            unitComponentTests: ["Vitest unit/component coverage reaches 100% on frontend/backend logic and edge cases"],
                            e2eTests: ["Playwright e2e coverage reaches 100% on workflow success and failure modes"],
                        },
                        coverageMechanism: ["Vitest plus Playwright coverage reports provide a measurable percent gate"],
                        nonGoals: ["avoid scope creep"],
                        constraints: ["maintain compatibility"],
                        autonomyRules: ["ask before changing scope"],
                        qualityBar: ["Do not call done until Vitest and Playwright show 100% coverage with edge cases proving the frontend and backend outcomes"],
                        riskBoundaries: ["avoid regressions"],
                        uiDirection: "",
                    },
                });
                mockMonitorInstance.emit("text", `Analysis complete.\n---BRIEF---\n${briefJson}\n---END_BRIEF---`);
                mockMonitorInstance.emit("turn-complete");
            });
        });
        it("does not emit onboarding-complete for malformed brief JSON", () => {
            return new Promise((resolve) => {
                onboarder.start();
                let completed = false;
                onboarder.on("onboarding-complete", () => {
                    completed = true;
                });
                onboarder.on("turn-complete", () => {
                    expect(completed).toBe(false);
                    resolve();
                });
                mockMonitorInstance.emit("text", "---BRIEF---\nnot valid json\n---END_BRIEF---");
                mockMonitorInstance.emit("turn-complete");
            });
        });
    });
    describe("getProjectDir", () => {
        it("returns the project directory", () => {
            expect(onboarder.getProjectDir()).toBe("/tmp/test-project");
        });
    });
});
