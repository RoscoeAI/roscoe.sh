import { jsx as _jsx } from "react/jsx-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
let lastOnDone = null;
const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    saveRoscoeSettings: vi.fn(),
    projects: [
        {
            name: "nanobots",
            directory: "/tmp/nanobots",
            onboardedAt: "2026-03-25T12:00:00.000Z",
            lastActive: "2026-03-25T12:00:00.000Z",
        },
        {
            name: "K12.io",
            directory: "/tmp/k12io",
            onboardedAt: "2026-03-12T12:00:00.000Z",
            lastActive: "2026-03-12T12:00:00.000Z",
        },
    ],
    contexts: {
        "/tmp/nanobots": {
            name: "nanobots",
            directory: "/tmp/nanobots",
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Nanobots brief",
            intentBrief: {
                projectStory: "Nanobots project story",
                primaryUsers: [],
                definitionOfDone: ["done means proven"],
                acceptanceChecks: [],
                successSignals: [],
                deliveryPillars: {
                    frontend: ["frontend proof"],
                    backend: ["backend proof"],
                    unitComponentTests: ["unit proof"],
                    e2eTests: ["e2e proof"],
                },
                coverageMechanism: ["vitest coverage"],
                nonGoals: [],
                constraints: [],
                autonomyRules: [],
                qualityBar: [],
                riskBoundaries: [],
                uiDirection: "conversation-first",
            },
            interviewAnswers: [],
            runtimeDefaults: {},
        },
        "/tmp/k12io": {
            name: "K12.io",
            directory: "/tmp/k12io",
            goals: [],
            milestones: [],
            techStack: [],
            notes: "K12 brief",
            intentBrief: {
                projectStory: "K12 project story",
                primaryUsers: [],
                definitionOfDone: ["k12 done"],
                acceptanceChecks: [],
                successSignals: [],
                deliveryPillars: {
                    frontend: ["frontend proof"],
                    backend: ["backend proof"],
                    unitComponentTests: ["unit proof"],
                    e2eTests: ["e2e proof"],
                },
                coverageMechanism: ["vitest coverage"],
                nonGoals: [],
                constraints: [],
                autonomyRules: [],
                qualityBar: [],
                riskBoundaries: [],
                uiDirection: "operator-first",
            },
            interviewAnswers: [],
            runtimeDefaults: {},
        },
    },
}));
vi.mock("../app.js", () => ({
    useAppContext: () => ({
        dispatch: mocks.dispatch,
    }),
}));
vi.mock("../config.js", () => ({
    listProjectHistory: () => [],
    listRegisteredProjects: () => mocks.projects,
    loadProjectContext: (directory) => mocks.contexts[directory] ?? null,
    loadRoscoeSettings: () => ({
        notifications: {
            enabled: false,
            phoneNumber: "",
            provider: "twilio",
        },
    }),
    saveRoscoeSettings: mocks.saveRoscoeSettings,
}));
vi.mock("./roscoe-intro.js", () => ({
    RoscoeIntro: ({ onDone }) => {
        lastOnDone = onDone;
        return _jsx(Text, { children: "INTRO SCREEN" });
    },
}));
vi.mock("./project-brief.js", () => ({
    ProjectBriefView: ({ context }) => (_jsx(Text, { children: `PROJECT BRIEF ${context.name}` })),
}));
import { HomeScreen, resetHomeScreenIntroForTests } from "./home-screen.js";
function delay(ms = 20) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
describe("HomeScreen", () => {
    beforeEach(() => {
        mocks.dispatch.mockReset();
        mocks.saveRoscoeSettings.mockReset();
        lastOnDone = null;
        resetHomeScreenIntroForTests();
    });
    it("shows the intro only once per app run", async () => {
        const first = render(_jsx(HomeScreen, {}));
        expect(first.lastFrame()).toContain("INTRO SCREEN");
        expect(lastOnDone).toBeTypeOf("function");
        lastOnDone?.();
        first.unmount();
        const second = render(_jsx(HomeScreen, {}));
        expect(second.lastFrame()).toContain("ROSCOE DISPATCH");
        expect(second.lastFrame()).toContain("Home Tabs");
        expect(second.lastFrame()).toContain("Dispatch Board");
        expect(second.lastFrame()).not.toContain("INTRO SCREEN");
    });
    it("switches home tabs with arrow keys and shows tab-specific panels", async () => {
        const first = render(_jsx(HomeScreen, {}));
        lastOnDone?.();
        first.unmount();
        const app = render(_jsx(HomeScreen, {}));
        expect(app.lastFrame()).toContain("Dispatch Board");
        expect(app.lastFrame()).toContain("enter panel");
        expect(app.lastFrame()).not.toContain("Optional SMS progress updates from Roscoe");
        app.stdin.write("\u001B[C");
        await delay();
        expect(app.lastFrame()).toContain("Channel Setup");
        expect(app.lastFrame()).toContain("Optional SMS progress updates from Roscoe");
        expect(app.lastFrame()).not.toContain("Onboarded codebases");
    });
    it("lets channel setup drill down with arrows and edit the phone on enter", async () => {
        const first = render(_jsx(HomeScreen, {}));
        lastOnDone?.();
        first.unmount();
        const app = render(_jsx(HomeScreen, {}));
        app.stdin.write("\u001B[C");
        await delay();
        app.stdin.write("\u001B[B");
        await delay();
        app.stdin.write("\r");
        await delay();
        expect(app.lastFrame()).toContain("Phone Number");
        expect(app.lastFrame()).toContain("Send Test SMS");
        app.stdin.write("\r");
        await delay();
        expect(app.lastFrame()).toContain("Enter saves. Esc cancels.");
    });
    it("lets project memory use arrows and enter to open a remembered brief", async () => {
        const first = render(_jsx(HomeScreen, {}));
        lastOnDone?.();
        first.unmount();
        const app = render(_jsx(HomeScreen, {}));
        app.stdin.write("\u001B[D");
        await delay();
        expect(app.lastFrame()).toContain("Project Memory");
        expect(app.lastFrame()).toContain("nanobots");
        expect(app.lastFrame()).not.toContain("Press 1-2");
        app.stdin.write("\u001B[B");
        await delay();
        app.stdin.write("\r");
        await delay();
        expect(app.lastFrame()).toContain("PROJECT BRIEF nanobots");
    });
});
