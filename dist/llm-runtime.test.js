import { describe, expect, it } from "vitest";
import { buildTurnCommand } from "./llm-runtime.js";
describe("buildTurnCommand", () => {
    it("places Codex global approval and sandbox flags before exec", () => {
        const profile = {
            name: "codex",
            command: "codex",
            args: [],
            protocol: "codex",
            runtime: {
                model: "gpt-5.4",
                reasoningEffort: "xhigh",
                sandboxMode: "workspace-write",
                approvalPolicy: "never",
            },
        };
        const command = buildTurnCommand(profile, "hello");
        expect(command.args.slice(0, 8)).toEqual([
            "-m",
            "gpt-5.4",
            "-c",
            'model_reasoning_effort="xhigh"',
            "-s",
            "workspace-write",
            "-a",
            "never",
        ]);
        expect(command.args[8]).toBe("exec");
    });
    it("places Codex exec options before resume and keeps approval/sandbox global", () => {
        const profile = {
            name: "codex",
            command: "codex",
            args: [],
            protocol: "codex",
            runtime: {
                sandboxMode: "workspace-write",
                approvalPolicy: "never",
            },
        };
        const command = buildTurnCommand(profile, "follow up", "thread-1");
        expect(command.args.slice(0, 4)).toEqual(["-s", "workspace-write", "-a", "never"]);
        expect(command.args.slice(4, 8)).toEqual(["exec", "--json", "--skip-git-repo-check", "resume"]);
        expect(command.args.slice(-2)).toEqual(["thread-1", "follow up"]);
    });
});
