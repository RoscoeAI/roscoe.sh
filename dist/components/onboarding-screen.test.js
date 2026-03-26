import { jsx as _jsx } from "react/jsx-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
}));
vi.mock("../app.js", () => ({
    useAppContext: () => ({
        dispatch: mocks.dispatch,
    }),
}));
vi.mock("../hooks/use-onboarding.js", () => ({
    SKIP_OPTION: "Skip",
    useOnboarding: () => ({
        state: {
            status: "idle",
            streamingText: "",
            thinkingText: "",
            qaHistory: [],
            question: null,
            error: null,
            projectContext: null,
            toolActivity: null,
        },
        start: vi.fn(),
        sendInput: vi.fn(),
    }),
}));
vi.mock("../config.js", () => ({
    loadProjectContext: () => null,
    listProfiles: () => ["claude-code", "codex"],
    loadProfile: (name) => ({ name }),
}));
vi.mock("../llm-runtime.js", () => ({
    detectProtocol: (profile) => (profile.name?.includes("codex") ? "codex" : "claude"),
}));
vi.mock("../runtime-defaults.js", () => ({
    applyRuntimeSettings: (profile) => profile,
    getAcceleratedWorkerRuntime: () => ({}),
    getDefaultOnboardingRuntime: () => ({ model: "claude-opus-4-6", reasoningEffort: "max" }),
    getDefaultWorkerRuntime: () => ({}),
    getLockedProjectProvider: () => null,
    getRuntimeTuningMode: () => "auto",
    getTopModel: () => "claude-opus-4-6",
    mergeRuntimeSettings: (...parts) => Object.assign({}, ...parts.filter(Boolean)),
    recommendOnboardingRuntime: (profile) => ({
        profile,
        mode: "auto",
        strategy: "auto-onboarding",
        rationale: "Roscoe stays on the strongest onboarding runtime.",
        summary: "claude · claude-opus-4-6 · max",
    }),
}));
import { OnboardingScreen, getPreviousOnboardingStep } from "./onboarding-screen.js";
describe("OnboardingScreen", () => {
    beforeEach(() => {
        mocks.dispatch.mockReset();
    });
    it("shows an escape back hint on the setup screen", () => {
        const app = render(_jsx(OnboardingScreen, {}));
        const frame = app.lastFrame();
        expect(frame).toContain("Esc");
        expect(frame).toContain("back to previous screen");
    });
    it("makes the provider lock explicit during onboarding setup", () => {
        const app = render(_jsx(OnboardingScreen, { dir: "/tmp/project" }));
        const frame = app.lastFrame();
        expect(frame).toContain("project lock");
        expect(frame).toContain("Switching Claude");
    });
    it("maps setup back-navigation correctly", () => {
        expect(getPreviousOnboardingStep("directory", false)).toBe("back");
        expect(getPreviousOnboardingStep("profile", false)).toBe("directory");
        expect(getPreviousOnboardingStep("profile", true)).toBe("back");
        expect(getPreviousOnboardingStep("model", false)).toBe("profile");
        expect(getPreviousOnboardingStep("effort", false)).toBe("model");
        expect(getPreviousOnboardingStep("tuning", false)).toBe("effort");
        expect(getPreviousOnboardingStep("execution", false)).toBe("tuning");
    });
});
