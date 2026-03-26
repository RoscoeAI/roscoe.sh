import { jsx as _jsx } from "react/jsx-runtime";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { SessionOutput } from "./session-output.js";
function makeSession(overrides = {}) {
    return {
        id: "s1",
        profileName: "claude",
        projectName: "proj",
        worktreeName: "main",
        status: "active",
        outputLines: [],
        suggestion: { kind: "idle" },
        managed: {},
        summary: null,
        currentToolUse: null,
        timeline: [],
        viewMode: "transcript",
        scrollOffset: 0,
        followLive: true,
        ...overrides,
    };
}
describe("SessionOutput", () => {
    it("shows waiting message when there is no active session", () => {
        const { lastFrame } = render(_jsx(SessionOutput, { session: null }));
        expect(lastFrame()).toContain("Waiting for output...");
    });
    it("renders transcript rows with remote and local labels", () => {
        const session = makeSession({
            managed: {
                profile: {
                    name: "claude-code",
                    command: "claude",
                    args: [],
                    protocol: "claude",
                    runtime: {
                        tuningMode: "auto",
                        model: "claude-opus-4-6",
                        reasoningEffort: "high",
                        permissionMode: "auto",
                    },
                },
                monitor: {
                    getLastCommandPreview: () => 'claude --model claude-opus-4-6 -p "<prompt>"',
                    getLastPrompt: () => "Investigate the failing webhook tests and keep the fix narrow.",
                },
                lastResponderCommand: 'claude --model claude-opus-4-6 --effort medium -p "<prompt>"',
                lastResponderPrompt: "Suggest the best next message to send back to the worker.",
                lastResponderStrategy: "auto-frontend",
                lastResponderRuntimeSummary: "claude · claude-opus-4-6 · medium · auto",
                lastResponderRationale: "Lower reasoning keeps UI and iteration loops moving faster.",
                lastWorkerRuntimeSummary: "claude · claude-opus-4-6 · high · auto",
                lastWorkerRuntimeStrategy: "auto-managed",
                lastWorkerRuntimeRationale: "Roscoe can retune model and reasoning within the locked provider before the next Guild turn.",
            },
            timeline: [
                {
                    id: "r1",
                    kind: "remote-turn",
                    timestamp: 1,
                    provider: "claude",
                    text: "Implemented the fix and added tests.",
                },
                {
                    id: "l1",
                    kind: "local-sent",
                    timestamp: 2,
                    text: "Run one final sanity pass.",
                    delivery: "approved",
                    confidence: 88,
                    reasoning: "The worker says the feature is complete.",
                },
            ],
        });
        const { lastFrame } = render(_jsx(SessionOutput, { session: session, sessionLabel: "proj:main" }));
        const frame = lastFrame();
        expect(frame).toContain("GUILD PROJ CLI");
        expect(frame).toContain("ROSCOE CLI");
        expect(frame).toContain("Provider: locked to claude");
        expect(frame).toContain("Management: auto");
        expect(frame).toContain("Investigate the failing webhook tests");
        expect(frame).toContain("GUILD PROJ");
        expect(frame).toContain("ROSCOE");
        expect(frame).toContain("88/100");
        expect(frame).toContain("Reasoning:");
    });
    it("renders raw mode with wrapped raw line counts", () => {
        const session = makeSession({
            viewMode: "raw",
            outputLines: ["| severity | issue |", "| high | width handling |"],
        });
        const { lastFrame } = render(_jsx(SessionOutput, { session: session, sessionLabel: "proj:main" }));
        const frame = lastFrame();
        expect(frame).toContain("raw");
        expect(frame).toContain("2 lines");
        expect(frame).toContain("| severity | issue |");
    });
});
