import { describe, it, expect } from "vitest";
import { buildInitialPrompt, stripMarkdown } from "./use-event-bridge.js";
const defaultProfile = {
    name: "claude-code",
    command: "claude",
    args: [],
    protocol: "claude",
};
function makeManagedSession(overrides = {}) {
    return {
        id: "test-1",
        monitor: {},
        profile: defaultProfile,
        tracker: {},
        awaitingInput: true,
        profileName: "claude-code",
        projectName: "myproject",
        projectDir: "/tmp/myproject",
        worktreePath: "/tmp/myproject",
        worktreeName: "main",
        _paused: false,
        lastResponderPrompt: null,
        lastResponderCommand: null,
        lastResponderStrategy: null,
        lastResponderRuntimeSummary: null,
        lastResponderRationale: null,
        lastWorkerRuntimeSummary: null,
        lastWorkerRuntimeStrategy: null,
        lastWorkerRuntimeRationale: null,
        ...overrides,
    };
}
describe("buildInitialPrompt", () => {
    it("includes project name", () => {
        const prompt = buildInitialPrompt(makeManagedSession(), null);
        expect(prompt).toContain("myproject");
    });
    it("includes tech stack when context provided", () => {
        const ctx = {
            name: "proj",
            directory: "/tmp",
            goals: ["ship v1"],
            milestones: [],
            techStack: ["React", "TypeScript"],
            notes: "",
            intentBrief: {
                projectStory: "Ship safely",
                primaryUsers: ["operators"],
                definitionOfDone: ["Frontend and backend workflows meet the operator outcome"],
                acceptanceChecks: ["Measured coverage proves the full workflow"],
                successSignals: ["operators can finish the task"],
                deliveryPillars: {
                    frontend: ["Frontend flow is complete"],
                    backend: ["Backend API flow is complete"],
                    unitComponentTests: ["Unit/component tests prove frontend/backend behavior with 100% coverage and edge cases"],
                    e2eTests: ["E2E tests prove the full workflow with 100% coverage and failure modes"],
                },
                coverageMechanism: ["Vitest and Playwright generate the measurable coverage percentage"],
                nonGoals: [],
                constraints: [],
                autonomyRules: [],
                qualityBar: ["Do not call done without 100% measured coverage"],
                riskBoundaries: [],
                uiDirection: "",
            },
        };
        const prompt = buildInitialPrompt(makeManagedSession(), ctx);
        expect(prompt).toContain("React, TypeScript");
        expect(prompt).toContain("ship v1");
        expect(prompt).toContain("Frontend pillar");
        expect(prompt).toContain("Coverage mechanism");
    });
    it("includes task/branch for non-main worktrees", () => {
        const managed = makeManagedSession({ worktreeName: "fix-auth" });
        const prompt = buildInitialPrompt(managed, null);
        expect(prompt).toContain("fix-auth");
        expect(prompt).toContain("Work tests-first");
        expect(prompt).toContain("unit/component and e2e proofs");
        expect(prompt).toContain("Only then implement");
    });
    it("tells main worktree to await instructions", () => {
        const prompt = buildInitialPrompt(makeManagedSession(), null);
        expect(prompt).toContain("await further instructions");
        expect(prompt).toContain("tests-first proof plan");
    });
});
describe("stripMarkdown", () => {
    it("removes bold markers", () => {
        expect(stripMarkdown("**bold text**")).toBe("bold text");
    });
    it("removes italic markers", () => {
        expect(stripMarkdown("*italic*")).toBe("italic");
    });
    it("removes inline code backticks", () => {
        expect(stripMarkdown("`code`")).toBe("code");
    });
    it("removes heading markers", () => {
        expect(stripMarkdown("## Heading")).toBe("Heading");
        expect(stripMarkdown("### Sub")).toBe("Sub");
    });
    it("removes blockquote markers", () => {
        expect(stripMarkdown("> quoted")).toBe("quoted");
    });
    it("normalizes list markers to dash", () => {
        expect(stripMarkdown("* item")).toBe("- item");
        expect(stripMarkdown("+ item")).toBe("- item");
        expect(stripMarkdown("- item")).toBe("- item");
    });
});
