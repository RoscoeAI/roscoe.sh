import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { parse } from "dotenv";
import type { HeadlessProfile } from "./llm-runtime.js";
import { getProjectMemoryDir, resolveProjectRoot } from "./config.js";

export type ProjectSecretTargetFile = ".env.local" | ".env.roscoe.local";
export type ProjectSecretStatus = "pending" | "provided" | "skipped";

export interface ProjectSecretLink {
  label: string;
  url: string;
}

export interface ProjectSecretRequest {
  key: string;
  label: string;
  purpose: string;
  instructions: string[];
  links: ProjectSecretLink[];
  required: boolean;
  targetFile: ProjectSecretTargetFile;
}

export interface ProjectSecretRecord extends ProjectSecretRequest {
  status: ProjectSecretStatus;
  updatedAt: string;
}

const PROJECT_ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.roscoe.local",
] as const;

function getSecretMetadataPath(projectDir: string): string {
  return join(getProjectMemoryDir(resolveProjectRoot(projectDir)), "secrets.json");
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeSecretLinks(value: unknown): ProjectSecretLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [{ label: item.trim(), url: item.trim() }];
    }
    if (!item || typeof item !== "object") return [];
    const typed = item as Record<string, unknown>;
    const url = typeof typed.url === "string" ? typed.url.trim() : "";
    if (!url) return [];
    const label = typeof typed.label === "string" && typed.label.trim()
      ? typed.label.trim()
      : url;
    return [{ label, url }];
  });
}

function normalizeTargetFile(value: unknown): ProjectSecretTargetFile {
  return value === ".env.roscoe.local" ? ".env.roscoe.local" : ".env.local";
}

function normalizeSecretRequest(value: unknown): ProjectSecretRequest | null {
  if (!value || typeof value !== "object") return null;
  const typed = value as Record<string, unknown>;
  const rawKey = typeof typed.key === "string" ? typed.key.trim() : "";
  const key = rawKey.toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) return null;

  const purpose = typeof typed.purpose === "string" ? typed.purpose.trim() : "";
  if (!purpose) return null;

  const label = typeof typed.label === "string" && typed.label.trim()
    ? typed.label.trim()
    : key;

  return {
    key,
    label,
    purpose,
    instructions: normalizeStringArray(typed.instructions),
    links: normalizeSecretLinks(typed.links),
    required: typed.required !== false,
    targetFile: normalizeTargetFile(typed.targetFile),
  };
}

function normalizeSecretRecord(value: unknown): ProjectSecretRecord | null {
  const request = normalizeSecretRequest(value);
  if (!request || !value || typeof value !== "object") return null;
  const typed = value as Record<string, unknown>;
  return {
    ...request,
    status: typed.status === "provided" || typed.status === "skipped" || typed.status === "pending"
      ? typed.status
      : "pending",
    updatedAt: typeof typed.updatedAt === "string" && typed.updatedAt.trim()
      ? typed.updatedAt
      : new Date(0).toISOString(),
  };
}

function readEnvFileMap(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  try {
    return parse(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatEnvValue(value: string): string {
  return JSON.stringify(value);
}

function getExampleEnvFile(targetFile: ProjectSecretTargetFile): ".env.example" | ".env.roscoe.example" {
  return targetFile === ".env.roscoe.local" ? ".env.roscoe.example" : ".env.example";
}

function upsertEnvAssignment(existing: string, key: string, value: string): string {
  const normalizedExisting = existing.replace(/\r\n/g, "\n");
  const lines = normalizedExisting.length > 0 ? normalizedExisting.split("\n") : [];
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`);
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (pattern.test(line)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== "") {
      nextLines.push("");
    }
    nextLines.push(`${key}=${value}`);
  }

  return `${nextLines.join("\n").replace(/\n*$/g, "")}\n`;
}

export function parseSecretRequestBlock(text: string): ProjectSecretRequest | null {
  const match = text.match(/---SECRET---\s*\n?([\s\S]*?)\n?---END_SECRET---/);
  if (!match) return null;
  try {
    return normalizeSecretRequest(JSON.parse(match[1].trim()));
  } catch {
    return null;
  }
}

export function cleanSecretBlocks(text: string): string {
  return text.replace(/---SECRET---[\s\S]*?---END_SECRET---/g, "");
}

export function listProjectSecrets(projectDir: string): ProjectSecretRecord[] {
  const path = getSecretMetadataPath(projectDir);
  if (!existsSync(path)) return [];

  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { secrets?: unknown };
    if (!Array.isArray(raw.secrets)) return [];
    return raw.secrets
      .map((item) => normalizeSecretRecord(item))
      .filter((item): item is ProjectSecretRecord => item !== null);
  } catch {
    return [];
  }
}

export function saveProjectSecretRecord(
  projectDir: string,
  request: ProjectSecretRequest,
  status: ProjectSecretStatus,
): ProjectSecretRecord {
  const canonicalDir = resolveProjectRoot(projectDir);
  const dir = getProjectMemoryDir(canonicalDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const record: ProjectSecretRecord = {
    ...request,
    status,
    updatedAt: new Date().toISOString(),
  };

  const secrets = listProjectSecrets(canonicalDir);
  const nextSecrets = [
    ...secrets.filter((entry) => entry.key !== request.key),
    record,
  ].sort((a, b) => a.key.localeCompare(b.key));

  writeFileSync(getSecretMetadataPath(canonicalDir), JSON.stringify({ secrets: nextSecrets }, null, 2));
  return record;
}

export function loadProjectEnvOverrides(projectDir: string): Record<string, string> {
  const resolvedDir = resolveProjectRoot(projectDir);
  return PROJECT_ENV_FILES.reduce<Record<string, string>>((acc, file) => {
    const next = readEnvFileMap(join(resolvedDir, file));
    return { ...acc, ...next };
  }, {});
}

export function hydrateProcessEnv(projectDir: string): void {
  const env = loadProjectEnvOverrides(projectDir);
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function writeProjectSecretValue(
  projectDir: string,
  key: string,
  value: string,
  targetFile: ProjectSecretTargetFile = ".env.local",
): void {
  const resolvedDir = resolveProjectRoot(projectDir);
  if (!existsSync(resolvedDir)) mkdirSync(resolvedDir, { recursive: true });
  const filePath = join(resolvedDir, targetFile);
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const next = upsertEnvAssignment(existing, key.toUpperCase(), formatEnvValue(value));
  writeFileSync(filePath, next);

  const examplePath = join(resolvedDir, getExampleEnvFile(targetFile));
  const existingExample = existsSync(examplePath) ? readFileSync(examplePath, "utf-8") : "";
  const nextExample = upsertEnvAssignment(existingExample, key.toUpperCase(), "\"\"");
  writeFileSync(examplePath, nextExample);
}

export function applyProjectEnvToProfile(profile: HeadlessProfile, projectDir: string): HeadlessProfile {
  const env = loadProjectEnvOverrides(projectDir);
  if (Object.keys(env).length === 0) return profile;
  return {
    ...profile,
    env: {
      ...env,
      ...(profile.env ?? {}),
    },
  };
}
