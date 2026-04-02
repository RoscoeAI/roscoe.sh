import { execFileSync } from "child_process";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { RoscoeSettings } from "./config.js";
import { detectProtocol, getProviderAdapter, isLLMProtocol, type LLMProtocol } from "./llm-runtime.js";

export type ProviderId = "claude" | "codex" | "gemini";

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
  serenaVisible: boolean;
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

const PROVIDER_SPECS: Array<{ id: ProviderId; label: string; command: string; comingSoon: boolean }> = [
  { id: "claude", label: "Claude", command: "claude", comingSoon: false },
  { id: "codex", label: "Codex", command: "codex", comingSoon: false },
  { id: "gemini", label: "Gemini", command: "gemini", comingSoon: false },
];

let providerCache: DiscoveredProvider[] | null = null;

export function resetProviderRegistryCacheForTests(): void {
  providerCache = null;
}

function extractHelpFlags(helpText: string): string[] {
  const matches = helpText.match(/--[a-z0-9][a-z0-9-]*/gim) ?? [];
  return Array.from(new Set(matches.map((value) => value.toLowerCase()))).sort();
}

function ensureProviderSupportDir(providerId: ProviderId): void {
  if (providerId !== "gemini") return;

  try {
    mkdirSync(join(homedir(), ".gemini"), { recursive: true });
  } catch {
    // Best effort only. If this fails, let normal provider discovery continue.
  }
}

function detectProvider(spec: { id: ProviderId; label: string; command: string; comingSoon: boolean }): DiscoveredProvider {
  let path: string | null = null;
  let helpText = "";
  const locator = process.platform === "win32" ? "where.exe" : "which";

  try {
    path = execFileSync(locator, [spec.command], {
      encoding: "utf-8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().split(/\r?\n/)[0]?.trim() || null;
  } catch {
    path = null;
  }

  if (path) {
    ensureProviderSupportDir(spec.id);

    try {
      helpText = execFileSync(path, ["--help"], {
        encoding: "utf-8",
        timeout: 2500,
        maxBuffer: 512 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const typed = error as { stdout?: string; stderr?: string };
      helpText = `${typed.stdout ?? ""}\n${typed.stderr ?? ""}`.trim();
    }
  }

  const helpFlags = extractHelpFlags(helpText);
  const isInstalled = path !== null;
  const managedToggles: ProviderToggleDescriptor[] = spec.id === "codex"
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
  const sessionCommands: ProviderSessionCommandDescriptor[] = spec.id === "codex"
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
  const managedFlagNames = new Set(managedToggles.map((toggle) => toggle.flag.toLowerCase()));
  const extraFlags = helpFlags.filter((flag) => !managedFlagNames.has(flag));
  const preflight = detectProviderPreflight(spec, path, helpText, helpFlags);

  return {
    id: spec.id,
    label: spec.label,
    command: spec.command,
    installed: isInstalled,
    path,
    comingSoon: spec.comingSoon,
    helpFlags,
    managedToggles,
    sessionCommands,
    extraFlags,
    preflight,
  };
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
      serenaVisible: false,
      mcpServers: [],
      note: `${spec.label} is not installed on this machine.`,
    };
  }

  const headlessReady = detectHeadlessReady(spec.id, helpText, helpFlags);
  const mcpOutput = runProviderMcpList(path, spec.id);

  return {
    headlessReady,
    mcpListReady: mcpOutput.ok,
    serenaVisible: /\bserena\b/i.test(mcpOutput.output),
    mcpServers: parseMcpServerNames(spec.id, mcpOutput.output),
    note: mcpOutput.note,
  };
}

function detectHeadlessReady(providerId: ProviderId, helpText: string, helpFlags: string[]): boolean {
  if (providerId === "codex") {
    return helpText.includes("Run Codex non-interactively");
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
    const keychainWarning = lines.find((line) => /keychain|fallback/i.test(line));
    if (keychainWarning) return keychainWarning;
  }

  if (providerId === "claude") {
    const healthLine = lines.find((line) => /^checking mcp server health/i.test(line));
    if (healthLine) return healthLine;
  }

  if (/No MCP servers configured\./i.test(output)) {
    return "No MCP servers configured.";
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
      .filter((line) => !/keychain|loaded cached credentials/i.test(line))
      .map((line) => line.match(/^[-*]?\s*([A-Za-z0-9._-]+)/)?.[1] ?? null)
      .filter((line): line is string => Boolean(line));
  }

  return [];
}

export function discoverProviders(): DiscoveredProvider[] {
  if (providerCache) return providerCache;
  providerCache = PROVIDER_SPECS.map(detectProvider);
  return providerCache;
}

export function getProviderLabel(provider: ProviderId | LLMProtocol): string {
  return getProviderAdapter(provider).label;
}

export function getSelectableProviderIds(
  settings: RoscoeSettings,
  include: LLMProtocol[] = [],
): LLMProtocol[] {
  const installedSupportedProviders = discoverProviders()
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
  return include.length > 0 ? Array.from(new Set(include)) : ["claude", "codex"];
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
