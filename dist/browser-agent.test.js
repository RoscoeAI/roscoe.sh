import { describe, it, expect, vi, beforeEach } from "vitest";
const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
    execFile: (...args) => mockExecFile(...args),
}));
vi.mock("fs", () => ({
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
}));
import { BrowserAgent } from "./browser-agent.js";
describe("BrowserAgent", () => {
    let agent;
    beforeEach(() => {
        agent = new BrowserAgent("test-session");
        mockExecFile.mockReset();
    });
    function mockExecSuccess(stdout) {
        mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
            cb(null, stdout, "");
        });
    }
    function mockExecError(message) {
        mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
            cb(new Error(message), "", "stderr output");
        });
    }
    describe("constructor", () => {
        it("generates session ID if not provided", () => {
            const a = new BrowserAgent();
            expect(a.getSessionId()).toMatch(/^roscoe-\d+$/);
        });
        it("uses provided session ID", () => {
            expect(agent.getSessionId()).toBe("test-session");
        });
    });
    describe("open", () => {
        it("calls agent-browser open with URL and session", async () => {
            mockExecSuccess(JSON.stringify({ url: "https://example.com", title: "Example" }));
            const result = await agent.open("https://example.com");
            expect(result.url).toBe("https://example.com");
            expect(result.title).toBe("Example");
            expect(mockExecFile).toHaveBeenCalledWith("agent-browser", ["open", "https://example.com", "--json", "--session", "test-session"], expect.any(Object), expect.any(Function));
        });
        it("rejects on error", async () => {
            mockExecError("connection refused");
            await expect(agent.open("https://bad.url")).rejects.toThrow("agent-browser open failed");
        });
    });
    describe("screenshot", () => {
        it("generates filename and returns path", async () => {
            mockExecSuccess("");
            const path = await agent.screenshot();
            expect(path).toMatch(/screenshot-\d+\.png$/);
        });
        it("uses custom filename when provided", async () => {
            mockExecSuccess("");
            const path = await agent.screenshot("custom.png");
            expect(path).toContain("custom.png");
        });
    });
    describe("snapshot", () => {
        it("returns parsed element list", async () => {
            const elements = [
                { ref: "e1", role: "button", name: "Submit" },
                { ref: "e2", role: "textbox", name: "Email" },
            ];
            mockExecSuccess(JSON.stringify(elements));
            const result = await agent.snapshot();
            expect(result).toHaveLength(2);
            expect(result[0].name).toBe("Submit");
        });
    });
    describe("interact", () => {
        it("sends action, ref, and optional value", async () => {
            mockExecSuccess("ok");
            await agent.interact("click", "e1");
            expect(mockExecFile).toHaveBeenCalledWith("agent-browser", ["click", "e1", "--json", "--session", "test-session"], expect.any(Object), expect.any(Function));
        });
        it("includes value when provided", async () => {
            mockExecSuccess("ok");
            await agent.interact("fill", "e2", "test@example.com");
            expect(mockExecFile).toHaveBeenCalledWith("agent-browser", ["fill", "e2", "test@example.com", "--json", "--session", "test-session"], expect.any(Object), expect.any(Function));
        });
    });
    describe("login", () => {
        it("opens URL and executes auth steps", async () => {
            mockExecSuccess(JSON.stringify({ url: "https://app.com", title: "App" }));
            const profile = {
                name: "test-auth",
                url: "https://app.com/login",
                steps: [
                    { action: "fill", ref: "email", value: "user@test.com" },
                    { action: "click", ref: "submit" },
                ],
            };
            await agent.login(profile);
            // open + fill + click = at least 3 exec calls
            expect(mockExecFile).toHaveBeenCalledTimes(3);
        });
        it("interpolates env vars in step values", async () => {
            mockExecSuccess(JSON.stringify({ url: "https://app.com", title: "App" }));
            process.env.TEST_PASSWORD = "secret123";
            const profile = {
                name: "test-auth",
                url: "https://app.com",
                steps: [
                    { action: "fill", ref: "password", value: "${TEST_PASSWORD}" },
                ],
            };
            await agent.login(profile);
            expect(mockExecFile).toHaveBeenCalledWith("agent-browser", expect.arrayContaining(["fill", "password", "secret123"]), expect.any(Object), expect.any(Function));
            delete process.env.TEST_PASSWORD;
        });
    });
    describe("getContextSummary", () => {
        it("returns page state and elements summary", async () => {
            // First call: getState via evaluate
            // Second call: snapshot
            let callCount = 0;
            mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
                callCount++;
                if (args[0] === "evaluate") {
                    cb(null, JSON.stringify({ url: "https://example.com", title: "Example" }), "");
                }
                else if (args[0] === "snapshot") {
                    cb(null, JSON.stringify([
                        { ref: "e1", role: "button", name: "Click me" },
                    ]), "");
                }
                else {
                    cb(null, "", "");
                }
            });
            const summary = await agent.getContextSummary();
            expect(summary).toContain("Example");
            expect(summary).toContain("Click me");
        });
    });
    describe("getScreenshotDir", () => {
        it("returns screenshot directory path", () => {
            expect(agent.getScreenshotDir()).toContain("screenshots");
        });
    });
});
