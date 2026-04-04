import { execFile, execFileSync, type ExecFileOptionsWithStringEncoding } from "child_process";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { RoscoeSettings } from "./config.js";
import { dbg } from "./debug-log.js";
import { detectProtocol, getProviderAdapter, isLLMProtocol, type LLMProtocol } from "./llm-runtime.js";

export type ProviderId = LLMProtocol;

export interface ProviderToggleDescriptor {
  key: string;
  label: string;
  description: string;
  flag: string;
  supported: boolean;
}

export interface ProviderSessionCommandDescriptor {
  command: string;
  label: string;
  description: string;
  managed: boolean;
  note?: string;
}

export interface ProviderPreflightStatus {
  headlessReady: boolean;
  mcpListReady: boolean;
  mcpServers: string[];
  note: string | null;
}

export interface DiscoveredProvider {
  id: ProviderId;
  label: string;
  command: string;
  installed: boolean;
  path: string | null;
  comingSoon: boolean;
  helpFlags: string[];
  managedToggles: ProviderToggleDescriptor[];
  sessionCommands: ProviderSessionCommandDescriptor[];
  extraFlags: string[];
  preflight: ProviderPreflightStatus;
}

export interface InstalledProvider {
  id: ProviderId;
  label: string;
  command: string;
  installed: boolean;
  path: string | null;
  comingSoon: boolean;
}

const PROVIDER_SPECS: Array<{ id: ProviderId; label: string; command: string; comingSoon: boolean }> = [
  { id: "claude", label: "Claude", command: "claude", comingSoon: false },
  { id: "codex", label: "Codex", command: "codex", comingSoon: false },
  { id: "qwen", label: "Qwen", command: "qwen", comingSoon: false },
  { id: "kimi", label: "Kimi", command: "kimi", comingSoon: false },
  { id: "gemini", label: "Gemini", command: "gemini", comingSoon: false },
];

let installedProviderCache: InstalledProvider[] | null = null;
let providerCache: DiscoveredProvider[] | null = null;
let providerCachePromise: Promise<DiscoveredProvider[]> | null = null;

export function resetProviderRegistryCacheForTests(): void {
  installedProviderCache = null;
  providerCache = null;
  providerCachePromise = null;
}

function extractHelpFlags(helpText: string): string[] {
  const matches = helpText.match(/--[a-z0-9][a-z0-9-]*/gim) ?? [];
  return Array.from(new Set(matches.map((value) => value.toLowerCase()))).sort();
}

function ensureProviderSupportDir(providerId: ProviderId): void {
  if (providerId !== "gemini" && providerId !== "kimi") return;

  try {
    mkdirSync(join(homedir(), providerId === "kimi" ? ".kimi" : ".gemini"), { recursive: true });
  } catch {
    // Best effort only. If this fails, let normal provider discovery continue.
  }
}

function locateProviderPath(command: string): string | null {
  const locator = process.platform === "win32" ? "where.exe" : "which";

  try {
    return execFileSync(locator, [command], {
      encoding: "utf-8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
}

function readProviderHelp(path: string): string {
  try {
    return execFileSync(path, ["--help"], {
      encoding: "utf-8",
      timeout: 2500,
      maxBuffer: 512 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const typed = error as { stdout?: string; stderr?: string };
    return `${typed.stdout ?? ""}\n${typed.stderr ?? ""}`.trim();
  }
}

function buildManagedToggles(spec: { id: ProviderId }, helpFlags: string[]): ProviderToggleDescriptor[] {
  return spec.id === "codex"
    ? [
        {
          key: "webSearch",
          label: "Live web search",
          description: "Adds Codex's `--search` startup flag to new Guild and Roscoe turns.",
          flag: "--search",
          supported: helpFlags.includes("--search"),
        },
      ]
    : spec.id === "claude"
      ? [
          {
            key: "brief",
            label: "Brief mode",
            description: "Adds Claude's `--brief` startup flag to keep agent-to-user communication enabled.",
            flag: "--brief",
            supported: helpFlags.includes("--brief"),
          },
          {
            key: "ide",
            label: "IDE attach",
            description: "Adds Claude's `--ide` startup flag when the local IDE bridge is available.",
            flag: "--ide",
            supported: helpFlags.includes("--ide"),
          },
          {
            key: "chrome",
            label: "Chrome bridge",
            description: "Adds Claude's `--chrome` startup flag when you want the browser bridge available by default.",
            flag: "--chrome",
            supported: helpFlags.includes("--chrome"),
          },
        ]
      : [];
  }

function buildSessionCommands(spec: { id: ProviderId }): ProviderSessionCommandDescriptor[] {
  return spec.id === "codex"
    ? [
        {
          command: "/fast",
          label: "Fast mode",
          description: "Codex appears to support `/fast` as an in-session command, not a startup CLI flag.",
          managed: false,
          note: "Roscoe does not auto-send `/fast` because it behaves like a toggle and current session state is not safely detectable yet.",
        },
      ]
    : [];
}

function buildDiscoveredProvider(
  spec: InstalledProvider,
  helpText: string,
  preflight: ProviderPreflightStatus,
): DiscoveredProvider {
  const helpFlags = extractHelpFlags(helpText);
  const managedToggles = buildManagedToggles(spec, helpFlags);
  const sessionCommands = buildSessionCommands(spec);
  const managedFlagNames = new Set(managedToggles.map((toggle) => toggle.flag.toLowerCase()));
  const extraFlags = helpFlags.filter((flag) => !managedFlagNames.has(flag));

  return {
    id: spec.id,
    label: spec.label,
    command: spec.command,
    installed: spec.installed,
    path: spec.path,
    comingSoon: spec.comingSoon,
    helpFlags,
    managedToggles,
    sessionCommands,
    extraFlags,
    preflight,
  };
}

function detectInstalledProvider(spec: { id: ProviderId; label: string; command: string; comingSoon: boolean }): InstalledProvider {
  const path = locateProviderPath(spec.command);
  return {
    id: spec.id,
    label: spec.label,
    command: spec.command,
    installed: path !== null,
    path,
    comingSoon: spec.comingSoon,
  };
}

function detectProvider(spec: InstalledProvider): DiscoveredProvider {
  if (!spec.path) {
    return buildDiscoveredProvider(spec, "", {
      headlessReady: false,
      mcpListReady: false,
      mcpServers: [],
      note: `${spec.label} is not installed on this machine.`,
    });
  }

  ensureProviderSupportDir(spec.id);
  const helpText = readProviderHelp(spec.path);
  const preflight = detectProviderPreflight(spec, spec.path, helpText, extractHelpFlags(helpText));
  return buildDiscoveredProvider(spec, helpText, preflight);
}

function detectProviderPreflight(
  spec: { id: ProviderId; label: string; command: string; comingSoon: boolean },
  path: string | null,
  helpText: string,
  helpFlags: string[],
): ProviderPreflightStatus {
  if (!path) {
    return {
      headlessReady: false,
      mcpListReady: false,
      mcpServers: [],
      note: `${spec.label} is not installed on this machine.`,
    };
  }

  const headlessReady = detectHeadlessReady(spec.id, helpText, helpFlags);
  const mcpOutput = runProviderMcpList(path, spec.id);

  return {
    headlessReady,
    mcpListReady: mcpOutput.ok,
    mcpServers: parseMcpServerNames(spec.id, mcpOutput.output),
    note: mcpOutput.note,
  };
}

function detectHeadlessReady(providerId: ProviderId, helpText: string, helpFlags: string[]): boolean {
  if (providerId === "codex") {
    return helpText.includes("Run Codex non-interactively");
  }
  if (providerId === "kimi") {
    return helpFlags.includes("--print")
      && helpFlags.includes("--output-format")
      && (
        helpFlags.includes("--resume")
        || helpFlags.includes("--session")
        || /\s-r(?:[\s,]|$)/.test(helpText)
      );
  }
  if (providerId === "qwen") {
    return helpFlags.includes("--output-format") && helpFlags.includes("--resume");
  }
  return helpFlags.includes("--output-format") && helpFlags.includes("--resume");
}

function runProviderMcpList(path: string, providerId: ProviderId): { ok: boolean; output: string; note: string | null } {
  ensureProviderSupportDir(providerId);

  try {
    const output = execFileSync(path, ["mcp", "list"], {
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 512 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return {
      ok: true,
      output,
      note: extractProviderPreflightNote(providerId, output),
    };
  } catch (error) {
    const typed = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${typed.stdout ?? ""}\n${typed.stderr ?? ""}`.trim();
    return {
      ok: false,
      output,
      note: output || typed.message || "MCP preflight failed.",
    };
  }
}

function extractProviderPreflightNote(providerId: ProviderId, output: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (providerId === "gemini") {
    const keytarMissing = lines.find((line) => /keychain initialization encountered an error|cannot find module .*keytar/i.test(line));
    const fileFallback = lines.find((line) => /filekeychain fallback|fallback for secure storage/i.test(line));
    const cachedCredentials = lines.find((line) => /loaded cached credentials/i.test(line));

    if (keytarMissing || fileFallback) {
      return "Gemini could not load its keychain bridge, so it fell back to file-backed credentials.";
    }
    if (cachedCredentials) {
      return "Gemini loaded cached credentials.";
    }
  }

  return null;
}

function parseMcpServerNames(providerId: ProviderId, output: string): string[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (providerId === "codex") {
    return lines
      .filter((line) => !/^Name\s+/i.test(line))
      .map((line) => line.match(/^(\S+)/)?.[1] ?? null)
      .filter((line): line is string => Boolean(line));
  }

  if (providerId === "claude") {
    return lines
      .filter((line) => !/^checking mcp server health/i.test(line))
      .map((line) => line.match(/^([^:]+):/)?.[1]?.trim() ?? null)
      .filter((line): line is string => Boolean(line));
  }

  if (providerId === "gemini") {
    if (/No MCP servers configured\./i.test(output)) return [];
    return lines
      .filter((line) => !/keychain|fallback|loaded cached credentials/i.test(line))
      .map((line) => line.match(/^[-*]?\s*([A-Za-z0-9._-]+)/)?.[1] ?? null)
      .filter((line): line is string => Boolean(line));
  }

  if (providerId === "kimi") {
    if (/No MCP servers configured\./i.test(output)) return [];
    return lines
      .filter((line) => !/^MCP config file:/i.test(line))
      .map((line) => line.match(/^[-*]?\s*([A-Za-z0-9._-]+)/)?.[1] ?? null)
      .filter((line): line is string => Boolean(line));
  }

  if (providerId === "qwen") {
    if (/No MCP servers configured\./i.test(output)) return [];
    return lines
      .map((line) => line.match(/^[-*]?\s*([A-Za-z0-9._-]+)/)?.[1] ?? null)
      .filter((line): line is string => Boolean(line));
  }

  return [];
}

function execFileCapture(
  command: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding,
): Promise<{ ok: boolean; stdout: string; stderr: string; message: string | null }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    dbg("providers:exec", `status=start command=${command} args=${args.join(" ")}`);
    execFile(command, args, options, (error, stdout, stderr) => {
      dbg(
        "providers:exec",
        `status=done command=${command} args=${args.join(" ")} ok=${!error} ms=${Date.now() - startedAt} signal=${error?.signal ?? "none"} message=${error?.message ?? "none"}`,
      );
      resolve({
        ok: !error,
        stdout,
        stderr,
        message: error ? error.message : null,
      });
    });
  });
}

async function runProviderMcpListAsync(path: string, providerId: ProviderId): Promise<{ ok: boolean; output: string; note: string | null }> {
  ensureProviderSupportDir(providerId);
  const result = await execFileCapture(path, ["mcp", "list"], {
    encoding: "utf-8",
    timeout: 5000,
    maxBuffer: 512 * 1024,
  });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return {
    ok: result.ok,
    output,
    note: result.ok
      ? extractProviderPreflightNote(providerId, output)
      : output || result.message || "MCP preflight failed.",
  };
}

async function detectProviderAsync(spec: InstalledProvider): Promise<DiscoveredProvider> {
  dbg("providers", `status=start provider=${spec.id} installed=${spec.installed} path=${spec.path ?? "missing"}`);
  if (!spec.path) {
    dbg("providers", `status=done provider=${spec.id} installed=false`);
    return buildDiscoveredProvider(spec, "", {
      headlessReady: false,
      mcpListReady: false,
      mcpServers: [],
      note: `${spec.label} is not installed on this machine.`,
    });
  }

  ensureProviderSupportDir(spec.id);
  const helpResult = await execFileCapture(spec.path, ["--help"], {
    encoding: "utf-8",
    timeout: 2500,
    maxBuffer: 512 * 1024,
  });
  const helpText = helpResult.ok
    ? helpResult.stdout
    : `${helpResult.stdout}\n${helpResult.stderr}`.trim();
  const helpFlags = extractHelpFlags(helpText);
  const mcpOutput = await runProviderMcpListAsync(spec.path, spec.id);
  const discovered = buildDiscoveredProvider(spec, helpText, {
    headlessReady: detectHeadlessReady(spec.id, helpText, helpFlags),
    mcpListReady: mcpOutput.ok,
    mcpServers: parseMcpServerNames(spec.id, mcpOutput.output),
    note: mcpOutput.note,
  });
  dbg(
    "providers",
    `status=done provider=${spec.id} installed=true headless=${discovered.preflight.headlessReady} mcp=${discovered.preflight.mcpListReady} servers=${discovered.preflight.mcpServers.length}`,
  );
  return discovered;
}

export function discoverInstalledProviders(): InstalledProvider[] {
  if (installedProviderCache) return installedProviderCache;
  installedProviderCache = PROVIDER_SPECS.map(detectInstalledProvider);
  return installedProviderCache;
}

export function discoverProviders(): DiscoveredProvider[] {
  if (providerCache) return providerCache;
  providerCache = discoverInstalledProviders().map(detectProvider);
  return providerCache;
}

export async function discoverProvidersAsync(): Promise<DiscoveredProvider[]> {
  if (providerCache) return providerCache;
  if (providerCachePromise) return providerCachePromise;
  providerCachePromise = Promise.all(discoverInstalledProviders().map(detectProviderAsync))
    .then((providers) => {
      providerCache = providers;
      return providers;
    })
    .finally(() => {
      providerCachePromise = null;
    });
  return providerCachePromise;
}

export function getProviderLabel(provider: ProviderId | LLMProtocol): string {
  return getProviderAdapter(provider).label;
}

export function getSelectableProviderIds(
  settings: RoscoeSettings,
  include: LLMProtocol[] = [],
): LLMProtocol[] {
  const installedSupportedProviders = discoverInstalledProviders()
    .filter((provider) => provider.installed && !provider.comingSoon && isLLMProtocol(provider.id))
    .map((provider) => provider.id);
  const enabled = installedSupportedProviders.filter((provider) => settings.providers[provider].enabled);
  const merged = Array.from(
    new Set([
      ...enabled,
      ...include.filter((provider) => installedSupportedProviders.includes(provider)),
    ]),
  );
  if (merged.length > 0) return merged;
  if (installedSupportedProviders.length > 0) return installedSupportedProviders;
  return include.length > 0 ? Array.from(new Set(include)) : ["claude", "codex", "qwen", "gemini", "kimi"];
}

export function filterProfilesBySelectableProviders(
  profileNames: string[],
  settings: RoscoeSettings,
  include: LLMProtocol[] = [],
): string[] {
  const allowed = getSelectableProviderIds(settings, include);
  return profileNames.filter((profileName) => {
    const inferred = detectProtocol({
      name: profileName,
      command: profileName,
    });
    return allowed.includes(inferred);
  });
}
