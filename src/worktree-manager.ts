import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join, resolve, basename, dirname } from "path";
import {
  getProjectMemoryDir,
  resolveProjectMemoryDir,
} from "./config.js";

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  projectDir: string;
  projectName: string;
}

type PackageManager = "npm" | "bun" | "yarn" | "pnpm";

export class WorktreeManager {
  private projectName: string;

  constructor(private projectDir: string) {
    this.projectDir = resolve(projectDir);
    this.projectName = basename(this.projectDir);
  }

  /**
   * Create a new worktree for a task.
   * Convention: sibling directory named {project}-{task}, branch named the same.
   */
  async create(taskName: string): Promise<WorktreeInfo> {
    const name = `${this.projectName}-${taskName}`;
    const worktreePath = resolve(this.projectDir, "..", name);
    const branch = name;

    if (existsSync(worktreePath)) {
      // Worktree already exists — return its info
      return { name, path: worktreePath, branch, projectDir: this.projectDir, projectName: this.projectName };
    }

    // Create the worktree with a new branch
    execSync(`git worktree add "${worktreePath}" -b "${branch}"`, {
      cwd: this.projectDir,
      stdio: "pipe",
    });

    // Copy config files
    await this.copyConfigFiles(worktreePath);

    // Copy Roscoe memory if it exists. Legacy .llm-responder data is read and copied into .roscoe.
    const roscoeDir = resolveProjectMemoryDir(this.projectDir);
    if (existsSync(roscoeDir)) {
      this.copyDirectoryContents(roscoeDir, getProjectMemoryDir(worktreePath));
    }

    // Copy CLAUDE.md if it exists
    const claudeMd = join(this.projectDir, "CLAUDE.md");
    if (existsSync(claudeMd)) {
      copyFileSync(claudeMd, join(worktreePath, "CLAUDE.md"));
    }

    // Install dependencies
    await this.installDeps(worktreePath);

    return { name, path: worktreePath, branch, projectDir: this.projectDir, projectName: this.projectName };
  }

  /**
   * List all worktrees for this project.
   */
  async list(): Promise<WorktreeInfo[]> {
    const output = execSync("git worktree list --porcelain", {
      cwd: this.projectDir,
      encoding: "utf-8",
    });

    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        current.path = line.replace("worktree ", "").trim();
        current.name = basename(current.path);
        current.projectDir = this.projectDir;
        current.projectName = this.projectName;
      } else if (line.startsWith("branch ")) {
        current.branch = line.replace("branch refs/heads/", "").trim();
      } else if (line === "") {
        if (current.path) {
          worktrees.push({
            name: current.name || basename(current.path),
            path: current.path,
            branch: current.branch || "unknown",
            projectDir: this.projectDir,
            projectName: this.projectName,
          });
        }
        current = {};
      }
    }

    return worktrees;
  }

  /**
   * Remove a worktree and optionally its branch.
   */
  async remove(taskName: string, force = false): Promise<void> {
    const name = taskName.startsWith(this.projectName)
      ? taskName
      : `${this.projectName}-${taskName}`;
    const worktreePath = resolve(this.projectDir, "..", name);

    const forceFlag = force ? " --force" : "";
    execSync(`git worktree remove "${worktreePath}"${forceFlag}`, {
      cwd: this.projectDir,
      stdio: "pipe",
    });

    // Delete the branch too
    try {
      execSync(`git branch -d "${name}"`, {
        cwd: this.projectDir,
        stdio: "pipe",
      });
    } catch {
      // Branch may have unmerged changes; skip
    }
  }

  /**
   * Detect the package manager from lockfiles in the project.
   */
  private detectPackageManager(): PackageManager {
    if (existsSync(join(this.projectDir, "bun.lockb")) || existsSync(join(this.projectDir, "bun.lock"))) return "bun";
    if (existsSync(join(this.projectDir, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(this.projectDir, "yarn.lock"))) return "yarn";
    return "npm";
  }

  /**
   * Run the appropriate package install in a worktree directory.
   */
  async installDeps(worktreePath: string): Promise<void> {
    const pm = this.detectPackageManager();
    // Only install if there's a package.json
    if (!existsSync(join(worktreePath, "package.json"))) return;

    try {
      execSync(`${pm} install`, {
        cwd: worktreePath,
        stdio: "pipe",
        timeout: 120_000,
      });
    } catch {
      // Non-fatal — deps may already be available
    }
  }

  /**
   * Get the list of config files to copy: .env variants + custom list.
   */
  private getFilesToCopy(): string[] {
    const files = [".env", ".env.local", ".env.development.local"];

    // Check for custom copy list
    const copyListPath = join(resolveProjectMemoryDir(this.projectDir), "copy-files.json");
    if (existsSync(copyListPath)) {
      try {
        const extra = JSON.parse(readFileSync(copyListPath, "utf-8"));
        if (Array.isArray(extra)) files.push(...extra);
      } catch {
        // skip
      }
    }

    return files;
  }

  /**
   * Copy config files from the main repo to a worktree.
   */
  async copyConfigFiles(worktreePath: string): Promise<string[]> {
    const copied: string[] = [];
    for (const file of this.getFilesToCopy()) {
      const src = join(this.projectDir, file);
      if (existsSync(src)) {
        const dest = join(worktreePath, file);
        // Ensure parent directory exists
        const destDir = dirname(dest);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        copyFileSync(src, dest);
        copied.push(file);
      }
    }
    return copied;
  }

  private copyDirectoryContents(sourceDir: string, targetDir: string): void {
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

    for (const entry of readdirSync(sourceDir)) {
      const sourcePath = join(sourceDir, entry);
      const targetPath = join(targetDir, entry);
      if (statSync(sourcePath).isDirectory()) {
        this.copyDirectoryContents(sourcePath, targetPath);
      } else {
        const targetParent = dirname(targetPath);
        if (!existsSync(targetParent)) mkdirSync(targetParent, { recursive: true });
        copyFileSync(sourcePath, targetPath);
      }
    }
  }

  getProjectName(): string {
    return this.projectName;
  }

  getProjectDir(): string {
    return this.projectDir;
  }
}
