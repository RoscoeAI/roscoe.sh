import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecFileSync = vi.fn();

vi.mock("child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
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
import { existsSync, copyFileSync, readFileSync, readdirSync, statSync } from "fs";

describe("WorktreeManager", () => {
  let mgr: WorktreeManager;

  beforeEach(() => {
    mgr = new WorktreeManager("/tmp/myproject");
    vi.mocked(existsSync).mockReturnValue(false);
    mockExecFileSync.mockReturnValue("");
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
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "git",
        ["worktree", "add", "/tmp/myproject-feature-x", "-b", "myproject-feature-x"],
        expect.objectContaining({ cwd: "/tmp/myproject" }),
      );
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
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("copies CLAUDE.md if it exists", async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith("CLAUDE.md")) return true;
        if (path.includes(".roscoe")) return false;
        if (path.includes(".llm-responder")) return false;
        if (path.endsWith("package.json")) return false;
        return false;
      });
      await mgr.create("feat");
      expect(copyFileSync).toHaveBeenCalledWith(
        expect.stringContaining("CLAUDE.md"),
        expect.stringContaining("CLAUDE.md"),
      );
    });

    it("copies Roscoe memory if it exists", async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith(".roscoe") && !path.includes("myproject-")) return true;
        if (path.endsWith(".llm-responder") && !path.includes("myproject-")) return false;
        if (path.endsWith("package.json")) return false;
        return false;
      });
      vi.mocked(readdirSync).mockReturnValue(["project.json"] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as any);
      await mgr.create("feat");
      expect(copyFileSync).toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("parses porcelain output", async () => {
      mockExecFileSync.mockReturnValue(
        "worktree /tmp/myproject\nbranch refs/heads/main\n\nworktree /tmp/myproject-feat\nbranch refs/heads/myproject-feat\n\n",
      );
      const list = await mgr.list();
      expect(list).toHaveLength(2);
      expect(list[0].branch).toBe("main");
      expect(list[1].name).toBe("myproject-feat");
    });

    it("returns empty for no worktrees output", async () => {
      mockExecFileSync.mockReturnValue("");
      const list = await mgr.list();
      expect(list).toEqual([]);
    });

    it("fills unknown branch names when porcelain output omits a branch line", async () => {
      mockExecFileSync.mockReturnValue(
        "worktree /tmp/myproject-detached\nHEAD abcdef123\n\n",
      );
      const list = await mgr.list();
      expect(list).toEqual([
        expect.objectContaining({
          name: "myproject-detached",
          branch: "unknown",
        }),
      ]);
    });
  });

  describe("remove", () => {
    it("calls git worktree remove", async () => {
      await mgr.remove("feature-x");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", "/tmp/myproject-feature-x"],
        expect.objectContaining({ cwd: "/tmp/myproject" }),
      );
    });

    it("includes --force when force is true", async () => {
      await mgr.remove("feature-x", true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", "/tmp/myproject-feature-x", "--force"],
        expect.anything(),
      );
    });

    it("handles already-prefixed task names", async () => {
      await mgr.remove("myproject-feature-x");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", "/tmp/myproject-feature-x"],
        expect.anything(),
      );
    });

    it("swallows branch deletion failures after removing the worktree", async () => {
      mockExecFileSync
        .mockReturnValueOnce("")
        .mockImplementationOnce(() => {
          throw new Error("branch still merged elsewhere");
        });

      await expect(mgr.remove("feature-x")).resolves.toBeUndefined();
      expect(mockExecFileSync).toHaveBeenNthCalledWith(
        2,
        "git",
        ["branch", "-d", "myproject-feature-x"],
        expect.anything(),
      );
    });
  });

  describe("detectPackageManager (via installDeps)", () => {
    it("uses npm by default", async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        return String(p).endsWith("package.json");
      });
      await mgr.installDeps("/tmp/wt");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "npm",
        ["install"],
        expect.objectContaining({ cwd: "/tmp/wt" }),
      );
    });

    it("detects bun from bun.lockb", async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith("bun.lockb")) return true;
        if (path.endsWith("package.json")) return true;
        return false;
      });
      await mgr.installDeps("/tmp/wt");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "bun",
        ["install"],
        expect.anything(),
      );
    });

    it("detects pnpm from pnpm-lock.yaml", async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith("pnpm-lock.yaml")) return true;
        if (path.endsWith("package.json")) return true;
        return false;
      });
      await mgr.installDeps("/tmp/wt");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "pnpm",
        ["install"],
        expect.anything(),
      );
    });

    it("detects yarn from yarn.lock", async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith("yarn.lock")) return true;
        if (path.endsWith("package.json")) return true;
        return false;
      });
      await mgr.installDeps("/tmp/wt");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "yarn",
        ["install"],
        expect.anything(),
      );
    });

    it("ignores install failures because dependencies may already exist", async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        return String(p).endsWith("package.json");
      });
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error("install failed");
      });
      await expect(mgr.installDeps("/tmp/wt")).resolves.toBeUndefined();
    });

    it("skips install when no package.json", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      mockExecFileSync.mockClear();
      await mgr.installDeps("/tmp/wt");
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });
  });

  describe("copyConfigFiles", () => {
    it("copies nested files from the custom copy list and ignores malformed copy lists", async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        const path = String(p);
        if (path.includes(".roscoe/copy-files.json")) return true;
        if (path.endsWith("copy-me/config.json")) return true;
        if (path.endsWith(".env.local")) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(["copy-me/config.json"]));

      const copied = await mgr.copyConfigFiles("/tmp/wt");
      expect(copied).toEqual(expect.arrayContaining(["copy-me/config.json", ".env.local"]));

      vi.mocked(readFileSync).mockReturnValueOnce("{not-json");
      await expect(mgr.copyConfigFiles("/tmp/wt")).resolves.toEqual([".env.local"]);
    });
  });
});
