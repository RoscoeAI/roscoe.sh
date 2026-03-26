import { describe, expect, it } from "vitest";
import { getLockedProjectProvider, recommendOnboardingRuntime, recommendResponderRuntime } from "./runtime-defaults.js";
describe("runtime-defaults", () => {
    it("reads the explicit locked provider from project defaults", () => {
        expect(getLockedProjectProvider({
            name: "proj",
            directory: "/tmp/proj",
            goals: [],
            milestones: [],
            techStack: [],
            notes: "",
            runtimeDefaults: {
                lockedProvider: "codex",
            },
        })).toBe("codex");
    });
    it("keeps manual runtime settings pinned", () => {
        const profile = {
            name: "claude-code",
            command: "claude",
            args: [],
            protocol: "claude",
            runtime: {
                tuningMode: "manual",
                model: "claude-opus-4-6",
                reasoningEffort: "max",
            },
        };
        const plan = recommendResponderRuntime(profile, "Polish the frontend spacing and button hover states.", null);
        expect(plan.mode).toBe("manual");
        expect(plan.strategy).toBe("manual-pinned");
        expect(plan.profile.runtime?.reasoningEffort).toBe("max");
    });
    it("lowers reasoning for clear frontend work in auto mode", () => {
        const profile = {
            name: "codex",
            command: "codex",
            args: [],
            protocol: "codex",
            runtime: {
                tuningMode: "auto",
                model: "gpt-5.4",
                reasoningEffort: "xhigh",
            },
        };
        const plan = recommendResponderRuntime(profile, "Tighten the Ink layout, typography, and colors for the dashboard UI.", null);
        expect(plan.mode).toBe("auto");
        expect(plan.strategy).toBe("auto-frontend");
        expect(plan.profile.runtime?.reasoningEffort).toBe("medium");
    });
    it("keeps onboarding on top-tier reasoning in auto mode", () => {
        const profile = {
            name: "codex",
            command: "codex",
            args: [],
            protocol: "codex",
            runtime: {
                tuningMode: "auto",
                model: "gpt-5.4",
                reasoningEffort: "low",
            },
        };
        const plan = recommendOnboardingRuntime(profile);
        expect(plan.strategy).toBe("auto-onboarding");
        expect(plan.profile.runtime?.reasoningEffort).toBe("xhigh");
    });
    it("does not downshift to frontend mode for generic repo UI mentions alone", () => {
        const profile = {
            name: "codex",
            command: "codex",
            args: [],
            protocol: "codex",
            runtime: {
                tuningMode: "auto",
                model: "gpt-5.4",
                reasoningEffort: "xhigh",
            },
        };
        const plan = recommendResponderRuntime(profile, "Clarify the repo direction and definition of done.", {
            name: "proj",
            directory: "/tmp/proj",
            goals: ["Ship a strong UI"],
            milestones: [],
            techStack: ["Next.js", "React"],
            notes: "The repo has a frontend surface.",
        });
        expect(plan.strategy).toBe("auto-top-tier");
        expect(plan.profile.runtime?.reasoningEffort).toBe("xhigh");
    });
});
