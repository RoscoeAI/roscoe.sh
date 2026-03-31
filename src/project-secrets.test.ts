import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyProjectEnvToProfile,
  cleanSecretBlocks,
  hydrateProcessEnv,
  listProjectSecrets,
  parseSecretRequestBlock,
  saveProjectSecretRecord,
  writeProjectSecretValue,
} from "./project-secrets.js";

describe("project secrets", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.TEST_SECRET_FROM_PROJECT;
  });

  it("parses a structured secret request block", () => {
    const result = parseSecretRequestBlock(`---SECRET---
{"key":"CF_API_TOKEN","label":"Cloudflare token","purpose":"Needed for previews.","instructions":["Open dashboard"],"links":[{"label":"Docs","url":"https://example.com"}],"required":true,"targetFile":".env.local"}
---END_SECRET---`);

    expect(result).toEqual({
      key: "CF_API_TOKEN",
      label: "Cloudflare token",
      purpose: "Needed for previews.",
      instructions: ["Open dashboard"],
      links: [{ label: "Docs", url: "https://example.com" }],
      required: true,
      targetFile: ".env.local",
    });
  });

  it("normalizes string links, fallback labels, optional targets, and optional required flags", () => {
    const result = parseSecretRequestBlock(`---SECRET---
{"key":"api_token","purpose":"Needed for sync.","instructions":["Open dashboard"],"links":["https://example.com",{"url":"https://docs.example.com"}],"required":false,"targetFile":".env.roscoe.local"}
---END_SECRET---`);

    expect(result).toEqual({
      key: "API_TOKEN",
      label: "API_TOKEN",
      purpose: "Needed for sync.",
      instructions: ["Open dashboard"],
      links: [
        { label: "https://example.com", url: "https://example.com" },
        { label: "https://docs.example.com", url: "https://docs.example.com" },
      ],
      required: false,
      targetFile: ".env.roscoe.local",
    });
  });

  it("rejects malformed secret blocks and strips them from transcripts", () => {
    expect(parseSecretRequestBlock(`---SECRET---\n{"key":"bad key"}\n---END_SECRET---`)).toBeNull();
    expect(parseSecretRequestBlock(`---SECRET---\n{"key":"CF_API_TOKEN","purpose":""}\n---END_SECRET---`)).toBeNull();
    expect(parseSecretRequestBlock(`---SECRET---\n123\n---END_SECRET---`)).toBeNull();
    expect(cleanSecretBlocks("hello\n---SECRET---\n{}\n---END_SECRET---\nworld")).toBe("hello\n\nworld");
  });

  it("writes and updates secrets in .env.local", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secrets-"));
    tempDirs.push(dir);

    writeProjectSecretValue(dir, "CF_API_TOKEN", "first-value");
    writeProjectSecretValue(dir, "CF_API_TOKEN", "second-value");

    const written = readFileSync(join(dir, ".env.local"), "utf-8");
    expect(written).toContain('CF_API_TOKEN="second-value"');
    expect(written.match(/CF_API_TOKEN=/g)).toHaveLength(1);
    expect(readFileSync(join(dir, ".env.example"), "utf-8")).toContain('CF_API_TOKEN=""');
  });

  it("writes Roscoe-only secrets into .env.roscoe.local and its example file", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secrets-local-"));
    tempDirs.push(dir);

    writeProjectSecretValue(dir, "roscoe_token", "abc123", ".env.roscoe.local");

    expect(readFileSync(join(dir, ".env.roscoe.local"), "utf-8")).toContain('ROSCOE_TOKEN="abc123"');
    expect(readFileSync(join(dir, ".env.roscoe.example"), "utf-8")).toContain('ROSCOE_TOKEN=""');
  });

  it("appends a new env assignment with a separating blank line when the file already ends with content", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secrets-append-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, ".env.local"), 'FIRST_KEY="one"');

    writeProjectSecretValue(dir, "SECOND_KEY", "two");

    expect(readFileSync(join(dir, ".env.local"), "utf-8")).toBe('FIRST_KEY="one"\n\nSECOND_KEY="two"\n');
  });

  it("persists non-sensitive secret metadata separately from env files", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secret-meta-"));
    tempDirs.push(dir);

    saveProjectSecretRecord(dir, {
      key: "CF_API_TOKEN",
      label: "Cloudflare token",
      purpose: "Needed for preview deploys.",
      instructions: ["Open dashboard"],
      links: [{ label: "Docs", url: "https://example.com" }],
      required: true,
      targetFile: ".env.local",
    }, "provided");

    const secrets = listProjectSecrets(dir);
    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatchObject({
      key: "CF_API_TOKEN",
      status: "provided",
      targetFile: ".env.local",
    });
  });

  it("updates an existing secret record and reuses an existing metadata directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secret-update-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, ".roscoe"), { recursive: true });

    saveProjectSecretRecord(dir, {
      key: "CF_API_TOKEN",
      label: "Cloudflare token",
      purpose: "Needed for preview deploys.",
      instructions: ["Open dashboard"],
      links: [],
      required: true,
      targetFile: ".env.local",
    }, "pending");
    saveProjectSecretRecord(dir, {
      key: "CF_API_TOKEN",
      label: "Cloudflare token",
      purpose: "Needed for preview deploys.",
      instructions: ["Open dashboard"],
      links: [],
      required: true,
      targetFile: ".env.local",
    }, "skipped");

    expect(listProjectSecrets(dir)).toEqual([
      expect.objectContaining({
        key: "CF_API_TOKEN",
        status: "skipped",
      }),
    ]);
  });

  it("filters invalid secret metadata and survives malformed files", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secret-bad-"));
    tempDirs.push(dir);
    const memoryDir = join(dir, ".roscoe");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "secrets.json"), JSON.stringify({
      secrets: [
        { key: "bad key", purpose: "broken" },
        { key: "CF_TOKEN", purpose: "Missing target file is okay" },
      ],
    }));

    expect(listProjectSecrets(dir)).toEqual([
      expect.objectContaining({
        key: "CF_TOKEN",
        label: "CF_TOKEN",
        targetFile: ".env.local",
        status: "pending",
      }),
    ]);

    writeFileSync(join(memoryDir, "secrets.json"), "{not-json");
    expect(listProjectSecrets(dir)).toEqual([]);
  });

  it("returns an empty list when secrets metadata exists but does not contain an array", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secret-empty-meta-"));
    tempDirs.push(dir);
    const memoryDir = join(dir, ".roscoe");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "secrets.json"), JSON.stringify({ secrets: {} }));

    expect(listProjectSecrets(dir)).toEqual([]);
  });

  it("hydrates Roscoe and Guild profiles from project-local env files", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secret-env-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, ".env.local"), 'TEST_SECRET_FROM_PROJECT="secret-value"\n');

    const profile = applyProjectEnvToProfile({
      name: "claude-code",
      command: "claude",
      args: [],
    }, dir);

    expect(profile.env?.TEST_SECRET_FROM_PROJECT).toBe("secret-value");
  });

  it("returns the original profile when there are no env overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secret-empty-"));
    tempDirs.push(dir);
    const profile = {
      name: "codex",
      command: "codex",
      args: [],
      env: {
        EXISTING: "1",
      },
    };

    expect(applyProjectEnvToProfile(profile, dir)).toBe(profile);
  });

  it("hydrates process env from the cwd project files without overriding exported env", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secret-process-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, ".env.local"), 'TEST_SECRET_FROM_PROJECT="project-value"\n');

    hydrateProcessEnv(dir);
    expect(process.env.TEST_SECRET_FROM_PROJECT).toBe("project-value");

    process.env.TEST_SECRET_FROM_PROJECT = "shell-value";
    hydrateProcessEnv(dir);
    expect(process.env.TEST_SECRET_FROM_PROJECT).toBe("shell-value");
  });

  it("loads env overrides in precedence order across project env files", () => {
    const dir = mkdtempSync(join(tmpdir(), "roscoe-secret-precedence-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, ".env"), 'TEST_SECRET_FROM_PROJECT="root"\n');
    writeFileSync(join(dir, ".env.local"), 'TEST_SECRET_FROM_PROJECT="local"\n');
    writeFileSync(join(dir, ".env.development.local"), 'TEST_SECRET_FROM_PROJECT="dev"\n');
    writeFileSync(join(dir, ".env.roscoe.local"), 'TEST_SECRET_FROM_PROJECT="roscoe"\n');

    hydrateProcessEnv(dir);
    expect(process.env.TEST_SECRET_FROM_PROJECT).toBe("roscoe");
  });
});
