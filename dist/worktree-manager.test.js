import { describe, it, expect, vi, beforeEach } from "vitest";
const mockExecSync = vi.fn();
vi.mock("child_process", () => ({
    execSync: (...args) => mockExecSync(...args),
    execFileSync: vi.fn(() => ""),
}));
vi.mock("fs", () => ({
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    readFileSync: vi.fn(() => ""),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isDirectory: () => false })),
}));
import { WorktreeManager } from "./worktree-manager.js";
import { existsSync, copyFileSync, readdirSync, statSync } from "fs";
describe("WorktreeManager", () => {
    let mgr;
    beforeEach(() => {
        mgr = new WorktreeManager("/tmp/myproject");
        vi.mocked(existsSync).mockReturnValue(false);
        mockExecSync.mockReturnValue("");
    });
    describe("constructor", () => {
        it("derives projectName from directory", () => {
            expect(mgr.getProjectName()).toBe("myproject");
        });
        it("resolves projectDir", () => {
            expect(mgr.getProjectDir()).toBe("/tmp/myproject");
        });
    });
    describe("create", () => {
        it("calls git worktree add with correct args", async () => {
            await mgr.create("feature-x");
            expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('git worktree add'), expect.objectContaining({ cwd: "/tmp/myproject" }));
        });
        it("returns WorktreeInfo with correct properties", async () => {
            const info = await mgr.create("feature-x");
            expect(info.name).toBe("myproject-feature-x");
            expect(info.branch).toBe("myproject-feature-x");
            expect(info.projectDir).toBe("/tmp/myproject");
            expect(info.projectName).toBe("myproject");
        });
        it("returns existing worktree info when path exists", async () => {
            vi.mocked(existsSync).mockReturnValue(true);
            const info = await mgr.create("feature-x");
            expect(info.name).toBe("myproject-feature-x");
            // Should not call git worktree add
            expect(mockExecSync).not.toHaveBeenCalledWith(expect.stringContaining("git worktree add"), expect.anything());
        });
        it("copies CLAUDE.md if it exists", async () => {
            vi.mocked(existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.endsWith("CLAUDE.md"))
                    return true;
                if (path.includes(".roscoe"))
                    return false;
                if (path.includes(".llm-responder"))
                    return false;
                if (path.endsWith("package.json"))
                    return false;
                return false;
            });
            await mgr.create("feat");
            expect(copyFileSync).toHaveBeenCalledWith(expect.stringContaining("CLAUDE.md"), expect.stringContaining("CLAUDE.md"));
        });
        it("copies Roscoe memory if it exists", async () => {
            vi.mocked(existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.endsWith(".roscoe") && !path.includes("myproject-"))
                    return true;
                if (path.endsWith(".llm-responder") && !path.includes("myproject-"))
                    return false;
                if (path.endsWith("package.json"))
                    return false;
                return false;
            });
            vi.mocked(readdirSync).mockReturnValue(["project.json"]);
            vi.mocked(statSync).mockReturnValue({ isDirectory: () => false });
            await mgr.create("feat");
            expect(copyFileSync).toHaveBeenCalled();
        });
    });
    describe("list", () => {
        it("parses porcelain output", async () => {
            mockExecSync.mockReturnValue("worktree /tmp/myproject\nbranch refs/heads/main\n\nworktree /tmp/myproject-feat\nbranch refs/heads/myproject-feat\n\n");
            const list = await mgr.list();
            expect(list).toHaveLength(2);
            expect(list[0].branch).toBe("main");
            expect(list[1].name).toBe("myproject-feat");
        });
        it("returns empty for no worktrees output", async () => {
            mockExecSync.mockReturnValue("");
            const list = await mgr.list();
            expect(list).toEqual([]);
        });
    });
    describe("remove", () => {
        it("calls git worktree remove", async () => {
            await mgr.remove("feature-x");
            expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining("git worktree remove"), expect.objectContaining({ cwd: "/tmp/myproject" }));
        });
        it("includes --force when force is true", async () => {
            await mgr.remove("feature-x", true);
            expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining("--force"), expect.anything());
        });
        it("handles already-prefixed task names", async () => {
            await mgr.remove("myproject-feature-x");
            expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining("myproject-feature-x"), expect.anything());
        });
    });
    describe("detectPackageManager (via installDeps)", () => {
        it("uses npm by default", async () => {
            vi.mocked(existsSync).mockImplementation((p) => {
                return String(p).endsWith("package.json");
            });
            await mgr.installDeps("/tmp/wt");
            expect(mockExecSync).toHaveBeenCalledWith("npm install", expect.objectContaining({ cwd: "/tmp/wt" }));
        });
        it("detects bun from bun.lockb", async () => {
            vi.mocked(existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.endsWith("bun.lockb"))
                    return true;
                if (path.endsWith("package.json"))
                    return true;
                return false;
            });
            await mgr.installDeps("/tmp/wt");
            expect(mockExecSync).toHaveBeenCalledWith("bun install", expect.anything());
        });
        it("detects pnpm from pnpm-lock.yaml", async () => {
            vi.mocked(existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.endsWith("pnpm-lock.yaml"))
                    return true;
                if (path.endsWith("package.json"))
                    return true;
                return false;
            });
            await mgr.installDeps("/tmp/wt");
            expect(mockExecSync).toHaveBeenCalledWith("pnpm install", expect.anything());
        });
        it("skips install when no package.json", async () => {
            vi.mocked(existsSync).mockReturnValue(false);
            mockExecSync.mockClear();
            await mgr.installDeps("/tmp/wt");
            expect(mockExecSync).not.toHaveBeenCalled();
        });
    });
});
