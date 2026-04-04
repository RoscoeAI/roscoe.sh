#!/usr/bin/env node

import { Command } from "commander";
import { resolve, basename } from "path";
import { homedir } from "os";
import React from "react";
import { render } from "ink";
import {
  listProfiles,
  listAuthProfiles,
  listRegisteredProjects,
} from "./config.js";
import { enableDebug } from "./debug-log.js";
import { WorktreeManager } from "./worktree-manager.js";
import App from "./app.js";
import { detectProtocol, LLMProtocol, RuntimeControlSettings } from "./llm-runtime.js";
import { hydrateProcessEnv } from "./project-secrets.js";

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

const program = new Command();

hydrateProcessEnv(process.cwd());

function cleanRuntimeSettings(settings: RuntimeControlSettings): RuntimeControlSettings | undefined {
  const entries = Object.entries(settings).filter(([, value]) => value !== undefined && value !== false && value !== "");
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as RuntimeControlSettings;
}

function buildProviderRuntimeOverrides(options: Record<string, unknown>): Partial<Record<LLMProtocol, RuntimeControlSettings>> {
  const hasClaudeOverride =
    typeof options.claudeModel === "string" ||
    typeof options.claudeEffort === "string" ||
    typeof options.claudePermissionMode === "string" ||
    options.claudeDangerous === true;

  const hasCodexOverride =
    typeof options.codexModel === "string" ||
    typeof options.codexEffort === "string" ||
    typeof options.codexSandbox === "string" ||
    typeof options.codexApproval === "string" ||
    options.codexDangerous === true;

  const overrides: Partial<Record<LLMProtocol, RuntimeControlSettings>> = {};

  if (hasClaudeOverride) {
    const claude = cleanRuntimeSettings({
      model: options.claudeModel as string | undefined,
      reasoningEffort: options.claudeEffort as string | undefined,
      permissionMode: options.claudePermissionMode as string | undefined,
      dangerouslySkipPermissions: options.claudeDangerous === true,
      executionMode: options.claudeDangerous === true ? "accelerated" : undefined,
    });
    if (claude) overrides.claude = claude;
  }

  if (hasCodexOverride) {
    const codex = cleanRuntimeSettings({
      model: options.codexModel as string | undefined,
      reasoningEffort: options.codexEffort as string | undefined,
      sandboxMode: options.codexSandbox as string | undefined,
      approvalPolicy: options.codexApproval as string | undefined,
      bypassApprovalsAndSandbox: options.codexDangerous === true,
      executionMode: options.codexDangerous === true ? "accelerated" : undefined,
    });
    if (codex) overrides.codex = codex;
  }

  return overrides;
}

program
  .name("roscoe")
  .description(
    "AI co-pilot that monitors LLM conversations, automates browser interactions, and orchestrates multi-agent workflows",
  )
  .version("0.4.0")
  .option("--debug", "Enable debug logging to ~/.roscoe/debug.log");

// ── default action (interactive TUI) ──────────────────────

program.action(() => {
  const debug = program.opts().debug === true;
  if (debug) enableDebug();
  render(React.createElement(App, { initialScreen: "home", debug }));
});

// ── start command ─────────────────────────────────────────

program
  .command("start")
  .description(
    "Start monitoring LLM sessions. Format: profile@dir:task or just profile",
  )
  .argument(
    "<specs...>",
    "Session specs: profile, profile@project-dir, or profile@project-dir:task-name",
  )
  .option("-a, --auto", "Auto-send high-confidence suggestions")
  .option("--claude-model <model>", "Claude worker model override")
  .option("--claude-effort <level>", "Claude worker effort override")
  .option("--claude-permission-mode <mode>", "Claude permission mode override")
  .option("--claude-dangerous", "Run Claude workers with --dangerously-skip-permissions")
  .option("--codex-model <model>", "Codex worker model override")
  .option("--codex-effort <level>", "Codex reasoning effort override")
  .option("--codex-sandbox <mode>", "Codex sandbox mode override")
  .option("--codex-approval <policy>", "Codex approval policy override")
  .option("--codex-dangerous", "Run Codex workers with --dangerously-bypass-approvals-and-sandbox")
  .action((specs: string[], options: Record<string, unknown>) => {
    const debug = program.opts().debug === true;
    if (debug) enableDebug();
    render(
      React.createElement(App, {
        initialScreen: "session-view",
        startSpecs: specs,
        debug,
        initialAutoMode: options.auto === true,
        startRuntimeOverrides: buildProviderRuntimeOverrides(options),
      }),
    );
  });

// ── onboard command ───────────────────────────────────────

program
  .command("onboard")
  .description(
    "Onboard a project — analyze an existing repo or define a new project vision, then save the operating contract",
  )
  .argument("<dir>", "Path to the project directory")
  .option("--profile <name>", "Initial onboarding profile to use")
  .option("--claude-model <model>", "Default Claude onboarding/worker model")
  .option("--claude-effort <level>", "Default Claude onboarding effort")
  .option("--claude-permission-mode <mode>", "Default Claude onboarding permission mode")
  .option("--claude-dangerous", "Run Claude onboarding with dangerous permissions")
  .option("--codex-model <model>", "Default Codex onboarding/worker model")
  .option("--codex-effort <level>", "Default Codex onboarding reasoning effort")
  .option("--codex-sandbox <mode>", "Default Codex onboarding sandbox mode")
  .option("--codex-approval <policy>", "Default Codex onboarding approval policy")
  .option("--codex-dangerous", "Run Codex onboarding with --dangerously-bypass-approvals-and-sandbox")
  .action((dir: string, options: Record<string, unknown>) => {
    const debug = program.opts().debug === true;
    if (debug) enableDebug();
    const overrides = buildProviderRuntimeOverrides(options);
    const inferredProvider = overrides.codex
      ? "codex"
      : overrides.claude
        ? "claude"
        : undefined;
    const profileName = typeof options.profile === "string"
      ? options.profile
      : inferredProvider === "codex"
        ? "codex"
        : inferredProvider === "claude"
          ? "claude-code"
          : undefined;
    const provider = profileName
      ? detectProtocol({ name: profileName, command: profileName })
      : inferredProvider;
    render(
      React.createElement(App, {
        initialScreen: "onboarding",
        onboardDir: resolve(expandTilde(dir)),
        debug,
        onboardingProfileName: profileName,
        onboardingRuntimeOverrides: provider ? overrides[provider] : undefined,
      }),
    );
  });

// ── projects command (no TUI) ─────────────────────────────

program
  .command("projects")
  .description("List all onboarded projects and their worktrees")
  .action(async () => {
    const projects = listRegisteredProjects();
    if (projects.length === 0) {
      console.log("No projects onboarded yet.");
      console.log("Run 'roscoe onboard <dir>' to onboard a project.");
      return;
    }

    console.log("Onboarded projects:\n");
    for (const p of projects) {
      console.log(`  ${p.name}`);
      console.log(`    Directory:  ${p.directory}`);
      console.log(`    Onboarded:  ${p.onboardedAt.slice(0, 10)}`);
      console.log(`    Last active: ${p.lastActive.slice(0, 10)}`);

      try {
        const wm = new WorktreeManager(p.directory);
        const worktrees = await wm.list();
        if (worktrees.length > 0) {
          console.log(`    Worktrees:`);
          for (const wt of worktrees) {
            const label = wt.path === p.directory ? "main" : wt.branch;
            console.log(`      - ${label} → ${wt.path}`);
          }
        }
      } catch {
        // not a git repo
      }
      console.log();
    }
  });

// ── worktrees command (no TUI) ────────────────────────────

program
  .command("worktrees")
  .description("List worktrees for a project")
  .argument("<dir>", "Project directory")
  .action(async (dir: string) => {
    const projectDir = resolve(expandTilde(dir));
    const wm = new WorktreeManager(projectDir);

    try {
      const worktrees = await wm.list();
      console.log(`Worktrees for ${basename(projectDir)}:\n`);
      for (const wt of worktrees) {
        const label = wt.path === projectDir ? "main (original)" : wt.branch;
        console.log(`  ${label}`);
        console.log(`    Path: ${wt.path}`);
      }
      if (worktrees.length === 0) {
        console.log("  No worktrees found.");
      }
    } catch (err) {
      console.error(
        `Failed to list worktrees: ${err instanceof Error ? err.message : err}`,
      );
    }
  });

// ── worktree-remove command (no TUI) ──────────────────────

program
  .command("worktree-remove")
  .description("Remove a worktree for a project")
  .argument("<dir>", "Project directory")
  .argument("<task>", "Task/worktree name to remove")
  .option("-f, --force", "Force removal even with uncommitted changes")
  .action(async (dir: string, task: string, options: { force?: boolean }) => {
    const projectDir = resolve(expandTilde(dir));
    const wm = new WorktreeManager(projectDir);

    try {
      await wm.remove(task, options.force);
      console.log(`Worktree '${task}' removed.`);
    } catch (err) {
      console.error(
        `Failed to remove worktree: ${err instanceof Error ? err.message : err}`,
      );
    }
  });

// ── profiles command (no TUI) ─────────────────────────────

program
  .command("profiles")
  .description("List available LLM and auth profiles")
  .action(() => {
    const llmProfiles = listProfiles();
    console.log("LLM profiles:");
    for (const p of llmProfiles) {
      console.log(`  - ${p}`);
    }

    const authProfiles = listAuthProfiles();
    if (authProfiles.length > 0) {
      console.log("\nAuth profiles:");
      for (const p of authProfiles) {
        console.log(`  - ${p}`);
      }
    }
  });

program.parse();
