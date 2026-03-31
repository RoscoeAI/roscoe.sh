import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectWorkspaceForOnboarding } from "./workspace-intake.js";

const permissionRestorePaths: string[] = [];

afterEach(() => {
  for (const dir of permissionRestorePaths.splice(0)) {
    try {
      chmodSync(dir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup only
    }
  }
  vi.restoreAllMocks();
});

describe("inspectWorkspaceForOnboarding", () => {
  it("treats an empty directory as greenfield", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-greenfield-empty-"));
    expect(inspectWorkspaceForOnboarding(dir)).toMatchObject({
      mode: "greenfield",
    });
  });

  it("treats scaffold-only files as greenfield", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-greenfield-scaffold-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo" }, null, 2));
    writeFileSync(join(dir, "README.md"), "# Demo\n");

    expect(inspectWorkspaceForOnboarding(dir)).toMatchObject({
      mode: "greenfield",
    });
  });

  it("treats real source files as an existing codebase", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-greenfield-code-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "export const demo = true;\n");

    expect(inspectWorkspaceForOnboarding(dir)).toMatchObject({
      mode: "existing",
    });
  });

  it("treats a missing workspace as greenfield and a file path as an existing edge case", () => {
    const missingDir = join(tmpdir(), `roscoe-missing-${Date.now()}`);
    expect(inspectWorkspaceForOnboarding(missingDir)).toMatchObject({
      mode: "greenfield",
      signalFiles: [],
    });

    const filePath = join(mkdtempSync(join(tmpdir(), "roscoe-file-target-")), "README.md");
    writeFileSync(filePath, "# just a file\n");
    expect(inspectWorkspaceForOnboarding(filePath)).toMatchObject({
      mode: "existing",
      signalFiles: [],
    });
  });

  it("ignores hidden and ignored directories when deciding whether code already exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-hidden-ignore-"));
    mkdirSync(join(dir, ".git"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), "[core]\n");
    writeFileSync(join(dir, "node_modules", "pkg", "index.ts"), "export const hidden = true;\n");
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "name: ci\n");
    writeFileSync(join(dir, "README.md"), "# scaffold only\n");

    expect(inspectWorkspaceForOnboarding(dir)).toMatchObject({
      mode: "greenfield",
    });
  });

  it("stops descending after the maximum depth and ignores non-file entries like symlinks", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-depth-limit-"));
    const deepDir = join(dir, "a", "b", "c", "d", "e");
    mkdirSync(deepDir, { recursive: true });
    writeFileSync(join(deepDir, "index.ts"), "export const tooDeep = true;\n");
    writeFileSync(join(dir, "README.md"), "# scaffold only\n");
    symlinkSync(join(dir, "README.md"), join(dir, "linked-readme"));

    expect(inspectWorkspaceForOnboarding(dir)).toMatchObject({
      mode: "greenfield",
    });
  });

  it("continues past unreadable directories and still classifies the workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-unreadable-"));
    const lockedDir = join(dir, "src");
    mkdirSync(lockedDir, { recursive: true });
    writeFileSync(join(dir, "README.md"), "# scaffold only\n");
    chmodSync(lockedDir, 0o000);
    permissionRestorePaths.push(dir);

    expect(inspectWorkspaceForOnboarding(dir)).toMatchObject({
      mode: "greenfield",
    });
  });

  it("treats stat failures as greenfield edge cases", async () => {
    vi.resetModules();
    const originalFs = await vi.importActual<typeof import("fs")>("fs");
    vi.doMock("fs", () => ({
      ...originalFs,
      existsSync: vi.fn(() => true),
      statSync: vi.fn(() => {
        throw new Error("boom");
      }),
    }));

    const { inspectWorkspaceForOnboarding: inspectWithFailingStat } = await import("./workspace-intake.js");

    expect(inspectWithFailingStat("/tmp/roscoe-failing-stat")).toMatchObject({
      mode: "greenfield",
      signalFiles: [],
    });
  });
});
