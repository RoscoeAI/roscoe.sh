import { existsSync, readdirSync, statSync } from "fs";
import { basename, extname, join, relative, resolve, sep } from "path";

export type WorkspaceIntakeMode = "greenfield" | "existing";

export interface WorkspaceIntakeAssessment {
  mode: WorkspaceIntakeMode;
  summary: string;
  signalFiles: string[];
}

const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".turbo",
  ".roscoe",
  ".codex",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "out",
  "target",
]);

const SCAFFOLD_FILES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "tsconfig.json",
  "jsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "vitest.config.ts",
  "vitest.config.js",
  "next.config.js",
  "next.config.ts",
  "README.md",
  "LICENSE",
  ".gitignore",
  ".npmignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
  ".nvmrc",
  ".node-version",
]);

const CODE_ROOT_DIRS = new Set([
  "src",
  "app",
  "components",
  "pages",
  "lib",
  "server",
  "client",
  "api",
  "cmd",
  "pkg",
  "internal",
  "tests",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".cs",
  ".swift",
  ".kt",
  ".scala",
  ".sql",
  ".sh",
  ".html",
  ".css",
  ".scss",
]);

interface CollectedSignal {
  relativePath: string;
  baseName: string;
  extension: string;
  topLevelDir: string;
}

function collectSignalFiles(rootDir: string, maxDepth = 3, maxFiles = 80): CollectedSignal[] {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
  const collected: CollectedSignal[] = [];

  while (queue.length > 0 && collected.length < maxFiles) {
    const current = queue.shift()!;

    let entries;
    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") {
        continue;
      }

      const fullPath = join(current.dir, entry.name);
      const relPath = relative(rootDir, fullPath);
      const topLevelDir = relPath.split(sep)[0]!;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        if (current.depth < maxDepth) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      collected.push({
        relativePath: relPath,
        baseName: basename(entry.name),
        extension: extname(entry.name).toLowerCase(),
        topLevelDir,
      });

      if (collected.length >= maxFiles) {
        break;
      }
    }
  }

  return collected;
}

function hasMeaningfulCode(signals: CollectedSignal[]): boolean {
  return signals.some((signal) =>
    CODE_ROOT_DIRS.has(signal.topLevelDir)
      || (CODE_EXTENSIONS.has(signal.extension) && !SCAFFOLD_FILES.has(signal.baseName)),
  );
}

function summarizeSignalFiles(signals: CollectedSignal[]): string[] {
  return signals
    .map((signal) => signal.relativePath)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 4);
}

export function inspectWorkspaceForOnboarding(dir: string): WorkspaceIntakeAssessment {
  const rootDir = resolve(dir);

  if (!existsSync(rootDir)) {
    return {
      mode: "greenfield",
      summary: "Workspace does not exist yet. Treat onboarding as a greenfield vision and architecture intake.",
      signalFiles: [],
    };
  }

  let stats;
  try {
    stats = statSync(rootDir);
  } catch {
    return {
      mode: "greenfield",
      summary: "Workspace cannot be inspected yet. Treat onboarding as a greenfield vision and architecture intake.",
      signalFiles: [],
    };
  }

  if (!stats.isDirectory()) {
    return {
      mode: "existing",
      summary: "Target path is not a directory, so Roscoe should treat onboarding as an existing workspace edge case.",
      signalFiles: [],
    };
  }

  const signals = collectSignalFiles(rootDir);
  if (signals.length === 0) {
    return {
      mode: "greenfield",
      summary: "Workspace is empty. Treat onboarding as a greenfield vision and architecture intake.",
      signalFiles: [],
    };
  }

  const signalFiles = summarizeSignalFiles(signals);
  if (hasMeaningfulCode(signals)) {
    return {
      mode: "existing",
      summary: `Workspace already contains meaningful implementation files (${signalFiles.join(", ")}). Keep onboarding repo-grounded.`,
      signalFiles,
    };
  }

  return {
    mode: "greenfield",
    summary: `Workspace is scaffold-only so far (${signalFiles.join(", ")}). Treat onboarding as a vision-first greenfield intake.`,
    signalFiles,
  };
}
