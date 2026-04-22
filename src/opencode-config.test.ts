import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("opencode config", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.HOME;
    vi.resetModules();
  });

  it("binds OPENROUTER_API_KEY into Roscoe's managed OpenCode config when present", async () => {
    const home = mkdtempSync(join(tmpdir(), "roscoe-opencode-"));
    homes.push(home);
    process.env.HOME = home;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    vi.resetModules();

    const mod = await import("./opencode-config.js");
    const configPath = mod.ensureRoscoeOpenCodeConfig();
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
      model?: string;
      small_model?: string;
      provider?: {
        openrouter?: {
          options?: Record<string, unknown>;
          models?: Record<string, unknown>;
        };
      };
    };

    expect(parsed.model).toBe("openrouter/openrouter/free");
    expect(parsed.small_model).toBe("openrouter/openrouter/free");
    expect(parsed.provider?.openrouter?.options?.apiKey).toBe("{env:OPENROUTER_API_KEY}");
    expect(parsed.provider?.openrouter?.models).toHaveProperty("qwen/qwen3-next-80b-a3b-instruct:free");
  });

  it("normalizes the OpenRouter free router alias for Roscoe while keeping the provider-qualified OpenCode key", async () => {
    const home = mkdtempSync(join(tmpdir(), "roscoe-opencode-"));
    homes.push(home);
    process.env.HOME = home;
    vi.resetModules();

    const mod = await import("./opencode-config.js");
    expect(mod.normalizeOpenRouterModelId("openrouter/free")).toBe("openrouter/free");
    expect(mod.normalizeOpenRouterModelId("openrouter/openrouter/free")).toBe("openrouter/free");

    mod.upsertRoscoeOpenCodeOpenRouterModels(["openrouter/free"]);
    const parsed = JSON.parse(readFileSync(mod.getRoscoeOpenCodeConfigPath(), "utf-8")) as {
      model?: string;
      small_model?: string;
      provider?: {
        openrouter?: {
          models?: Record<string, unknown>;
        };
      };
    };

    expect(parsed.model).toBe("openrouter/openrouter/free");
    expect(parsed.small_model).toBe("openrouter/openrouter/free");
    expect(parsed.provider?.openrouter?.models).toHaveProperty("openrouter/free");
  });

  it("upsertRoscoeOpenCodeMcpServer records a local MCP transport entry", async () => {
    const home = mkdtempSync(join(tmpdir(), "roscoe-opencode-"));
    homes.push(home);
    process.env.HOME = home;
    vi.resetModules();

    const mod = await import("./opencode-config.js");
    const result = mod.upsertRoscoeOpenCodeMcpServer("serena", ["uvx", "serena"]);
    expect(result.changed).toBe(true);

    const parsed = JSON.parse(readFileSync(result.path, "utf-8")) as {
      mcp?: Record<string, { type: string; command: string[]; enabled?: boolean }>;
    };
    expect(parsed.mcp?.serena).toEqual({
      type: "local",
      command: ["uvx", "serena"],
      enabled: true,
    });

    const snapshots = mod.getRoscoeOpenCodeEnabledMcpServers();
    expect(snapshots).toEqual([
      { name: "serena", command: ["uvx", "serena"] },
    ]);
  });

  it("getRoscoeOpenCodeProviderSnapshot reports openrouter state", async () => {
    const home = mkdtempSync(join(tmpdir(), "roscoe-opencode-"));
    homes.push(home);
    process.env.HOME = home;
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.resetModules();

    const mod = await import("./opencode-config.js");
    mod.upsertRoscoeOpenCodeOpenRouterModels(["openrouter/openai/gpt-4o-mini"]);
    const snapshot = mod.getRoscoeOpenCodeProviderSnapshot("openrouter");

    expect(snapshot.id).toBe("openrouter");
    expect(snapshot.apiKeyConfigured).toBe(true);
    expect(snapshot.apiKeySource).toBe("shell-env");
    expect(snapshot.modelIds).toContain("openrouter/openai/gpt-4o-mini");
    expect(snapshot.modelIds).toContain("openrouter/qwen/qwen3-next-80b-a3b-instruct:free");
  });
});
