import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";

export const OPENROUTER_FREE_ROUTER_MODEL_KEY = "openrouter/free";
export const OPENROUTER_FREE_ROUTER_MODEL_ID = "openrouter/free";
export const OPENCODE_OPENROUTER_FREE_ROUTER_MODEL_ID = `openrouter/${OPENROUTER_FREE_ROUTER_MODEL_KEY}`;
export const OPENROUTER_FREE_QWEN_MODEL_KEY = "qwen/qwen3-next-80b-a3b-instruct:free";
export const OPENROUTER_FREE_QWEN_MODEL_ID = `openrouter/${OPENROUTER_FREE_QWEN_MODEL_KEY}`;

interface OpenCodeProviderConfig {
  npm?: string;
  name?: string;
  options?: Record<string, unknown>;
  models?: Record<string, Record<string, unknown>>;
}

export interface RoscoeOpenCodeProviderModelSnapshot {
  id: string;
  name: string | null;
  apiModelId: string | null;
  options: Record<string, unknown> | null;
}

interface OpenCodeLocalMcpConfig {
  type: "local";
  command: string[];
  enabled?: boolean;
  environment?: Record<string, string>;
  timeout?: number;
}

interface RoscoeOpenCodeConfig {
  $schema?: string;
  model?: string;
  small_model?: string;
  provider?: Record<string, OpenCodeProviderConfig>;
  mcp?: Record<string, OpenCodeLocalMcpConfig>;
}

// OpenRouter reads its API key from the shell environment (`OPENROUTER_API_KEY`).
// No keychain source exists — if the env var is set, the key is "shell-env";
// otherwise "none". This used to be a richer union when the Local provider
// needed keychain lookups, but since we've dropped Local, this collapses.
export type OpenRouterApiKeySource = "shell-env" | "none";

export interface RoscoeOpenCodeProviderSnapshot {
  id: string;
  name: string | null;
  npmPackage: string | null;
  baseURL: string | null;
  apiKeyConfigured: boolean;
  apiKeySource: OpenRouterApiKeySource;
  models: RoscoeOpenCodeProviderModelSnapshot[];
  modelIds: string[];
  currentModel: string | null;
  smallModel: string | null;
}

function getRoscoeOpenCodeConfigFilePath(): string {
  return join(
    process.env.ROSCOE_PROVIDER_MODEL_HOME || process.env.HOME || homedir(),
    ".roscoe",
    "opencode.json",
  );
}

function readRoscoeOpenCodeConfig(): RoscoeOpenCodeConfig {
  const configPath = getRoscoeOpenCodeConfigFilePath();
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as RoscoeOpenCodeConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeRoscoeOpenCodeConfig(config: RoscoeOpenCodeConfig): RoscoeOpenCodeConfig {
  const provider = config.provider && typeof config.provider === "object" ? config.provider : {};
  const openrouter = normalizeProviderConfig(provider.openrouter);
  const mcp = config.mcp && typeof config.mcp === "object" ? config.mcp : {};
  const envOpenRouterKey = process.env.OPENROUTER_API_KEY?.trim();

  return {
    $schema: OPENCODE_SCHEMA_URL,
    model: config.model ?? OPENCODE_OPENROUTER_FREE_ROUTER_MODEL_ID,
    small_model: config.small_model ?? OPENCODE_OPENROUTER_FREE_ROUTER_MODEL_ID,
    provider: {
      ...provider,
      openrouter: {
        ...openrouter,
        options: envOpenRouterKey
          ? {
              ...(openrouter.options ?? {}),
              apiKey: "{env:OPENROUTER_API_KEY}",
            }
          : { ...(openrouter.options ?? {}) },
        models: {
          ...(openrouter.models ?? {}),
          [OPENROUTER_FREE_QWEN_MODEL_KEY]: openrouter.models?.[OPENROUTER_FREE_QWEN_MODEL_KEY] ?? {},
        },
      },
    },
    mcp: { ...mcp },
  };
}

function normalizeProviderConfig(
  value: OpenCodeProviderConfig | undefined,
  options: {
    defaultName?: string;
    defaultNpm?: string;
  } = {},
): OpenCodeProviderConfig {
  const typed = value && typeof value === "object" ? value : {} as OpenCodeProviderConfig;
  const models = typed.models && typeof typed.models === "object" ? typed.models : {};
  const normalizedModels = Object.entries(models).reduce<Record<string, Record<string, unknown>>>((accumulator, [key, config]) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return accumulator;
    }
    accumulator[normalizedKey] = config && typeof config === "object" ? { ...config } : {};
    return accumulator;
  }, {});

  return {
    ...(typeof options.defaultNpm === "string" ? { npm: typed.npm?.trim() || options.defaultNpm } : typed.npm?.trim() ? { npm: typed.npm.trim() } : {}),
    ...(typeof options.defaultName === "string" ? { name: typed.name?.trim() || options.defaultName } : typed.name?.trim() ? { name: typed.name.trim() } : {}),
    options: typed.options && typeof typed.options === "object" ? { ...typed.options } : {},
    models: normalizedModels,
  };
}

function writeRoscoeOpenCodeConfig(config: RoscoeOpenCodeConfig): void {
  const normalized = normalizeRoscoeOpenCodeConfig(config);
  const configPath = getRoscoeOpenCodeConfigFilePath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(normalized, null, 2));
}

export function normalizeOpenRouterModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return OPENROUTER_FREE_QWEN_MODEL_ID;
  }

  if (
    trimmed === OPENROUTER_FREE_ROUTER_MODEL_ID
    || trimmed === OPENCODE_OPENROUTER_FREE_ROUTER_MODEL_ID
  ) {
    return OPENROUTER_FREE_ROUTER_MODEL_ID;
  }

  return trimmed.startsWith("openrouter/")
    ? trimmed
    : `openrouter/${trimmed.replace(/^\/+/, "")}`;
}

export function repairOpenRouterModelId(modelId: string): string {
  return normalizeOpenRouterModelId(modelId);
}

export function isKnownDeprecatedOpenRouterModelId(_modelId: string): boolean {
  return false;
}

function toOpenRouterModelKey(modelId: string): string {
  const normalized = repairOpenRouterModelId(modelId);
  if (normalized === OPENROUTER_FREE_ROUTER_MODEL_ID) {
    return OPENROUTER_FREE_ROUTER_MODEL_KEY;
  }
  return normalized.replace(/^openrouter\//, "");
}

export function ensureRoscoeOpenCodeConfig(): string {
  const current = readRoscoeOpenCodeConfig();
  const normalized = normalizeRoscoeOpenCodeConfig(current);
  if (JSON.stringify(current) !== JSON.stringify(normalized)) {
    writeRoscoeOpenCodeConfig(normalized);
  }
  return getRoscoeOpenCodeConfigFilePath();
}

export function getRoscoeOpenCodeEnv(
  env: NodeJS.ProcessEnv | null | undefined = undefined,
): NodeJS.ProcessEnv {
  return {
    ...(env ?? {}),
    OPENCODE_CONFIG: ensureRoscoeOpenCodeConfig(),
  };
}

export function upsertRoscoeOpenCodeMcpServer(
  name: string,
  command: string[],
  options: {
    environment?: Record<string, string>;
    timeout?: number;
  } = {},
): { changed: boolean; path: string } {
  const current = normalizeRoscoeOpenCodeConfig(readRoscoeOpenCodeConfig());
  const next: RoscoeOpenCodeConfig = {
    ...current,
    mcp: {
      ...(current.mcp ?? {}),
      [name]: {
        type: "local",
        command: [...command],
        enabled: true,
        ...(options.environment ? { environment: options.environment } : {}),
        ...(typeof options.timeout === "number" ? { timeout: options.timeout } : {}),
      },
    },
  };

  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (changed) {
    writeRoscoeOpenCodeConfig(next);
  } else {
    ensureRoscoeOpenCodeConfig();
  }

  return {
    changed,
    path: getRoscoeOpenCodeConfigFilePath(),
  };
}

export function upsertRoscoeOpenCodeOpenRouterModels(
  modelIds: readonly string[],
): { changed: boolean; path: string } {
  const current = normalizeRoscoeOpenCodeConfig(readRoscoeOpenCodeConfig());
  const existingModels = current.provider?.openrouter?.models ?? {};
  const nextModelKeys = Array.from(new Set([
    OPENROUTER_FREE_QWEN_MODEL_KEY,
    ...modelIds
      .map((modelId) => typeof modelId === "string" ? toOpenRouterModelKey(modelId) : "")
      .filter(Boolean),
  ]));

  const next: RoscoeOpenCodeConfig = {
    ...current,
    provider: {
      ...(current.provider ?? {}),
      openrouter: {
        ...(current.provider?.openrouter ?? {}),
        models: nextModelKeys.reduce<Record<string, Record<string, unknown>>>((accumulator, key) => {
          accumulator[key] = existingModels[key] ?? {};
          return accumulator;
        }, {}),
      },
    },
  };

  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (changed) {
    writeRoscoeOpenCodeConfig(next);
  } else {
    ensureRoscoeOpenCodeConfig();
  }

  return {
    changed,
    path: getRoscoeOpenCodeConfigFilePath(),
  };
}

export function getRoscoeOpenCodeProviderSnapshot(providerId: string): RoscoeOpenCodeProviderSnapshot {
  const config = normalizeRoscoeOpenCodeConfig(readRoscoeOpenCodeConfig());
  const provider = config.provider?.[providerId];
  const models = Object.entries(provider?.models ?? {}).map(([modelId, modelConfig]) => {
    const normalizedId = normalizeOpenRouterModelId(modelId);
    const name = typeof modelConfig?.name === "string" && modelConfig.name.trim().length > 0
      ? modelConfig.name.trim()
      : null;
    const apiModelId = typeof modelConfig?.id === "string" && modelConfig.id.trim().length > 0
      ? modelConfig.id.trim()
      : null;
    const parsedOptions = modelConfig?.options && typeof modelConfig.options === "object"
      ? { ...modelConfig.options }
      : null;
    return {
      id: normalizedId,
      name,
      apiModelId,
      options: parsedOptions,
    };
  });
  const modelIds = models.map((model) => model.id);
  const currentModel = typeof config.model === "string" && config.model.startsWith(`${providerId}/`)
    ? normalizeOpenRouterModelId(config.model)
    : null;
  const smallModel = typeof config.small_model === "string" && config.small_model.startsWith(`${providerId}/`)
    ? normalizeOpenRouterModelId(config.small_model)
    : null;
  const apiKeySource: OpenRouterApiKeySource = process.env.OPENROUTER_API_KEY?.trim()
    ? "shell-env"
    : "none";

  return {
    id: providerId,
    name: typeof provider?.name === "string" && provider.name.trim().length > 0 ? provider.name.trim() : null,
    npmPackage: typeof provider?.npm === "string" && provider.npm.trim().length > 0 ? provider.npm.trim() : null,
    baseURL: typeof provider?.options?.baseURL === "string" && provider.options.baseURL.trim().length > 0
      ? provider.options.baseURL.trim()
      : null,
    apiKeyConfigured: apiKeySource === "shell-env",
    apiKeySource,
    models,
    modelIds,
    currentModel,
    smallModel,
  };
}

export function getRoscoeOpenCodeConfigPath(): string {
  return ensureRoscoeOpenCodeConfig();
}

export interface RoscoeOpenCodeMcpServerSnapshot {
  name: string;
  command: string[];
  environment?: Record<string, string>;
  timeout?: number;
}

/**
 * Returns MCP servers declared in `~/.roscoe/opencode.json` that are both
 * `type: "local"` and `enabled !== false`. Shared across providers — the
 * `opencode serve` subprocess forwards these to OpenRouter lanes when it
 * starts. (The `type: "local"` label refers to the MCP transport being a
 * locally-spawned process, not the defunct "Local" model provider.)
 */
export function getRoscoeOpenCodeEnabledMcpServers(): RoscoeOpenCodeMcpServerSnapshot[] {
  const config = readRoscoeOpenCodeConfig();
  const mcp = config.mcp && typeof config.mcp === "object" ? config.mcp : {};
  const out: RoscoeOpenCodeMcpServerSnapshot[] = [];
  for (const [name, entry] of Object.entries(mcp)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type !== "local") continue;
    if (entry.enabled === false) continue;
    const command = Array.isArray(entry.command)
      ? entry.command.filter((part) => typeof part === "string" && part.length > 0)
      : [];
    if (command.length === 0) continue;
    out.push({
      name,
      command,
      ...(entry.environment && typeof entry.environment === "object"
        ? { environment: { ...entry.environment } }
        : {}),
      ...(typeof entry.timeout === "number" ? { timeout: entry.timeout } : {}),
    });
  }
  return out;
}
