import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync: mocks.execFileSync,
}));

vi.mock("fs", () => ({
  mkdirSync: mocks.mkdirSync,
}));

vi.mock("./llm-runtime.js", () => ({
  detectProtocol: (profile: { name?: string; command?: string }) => {
    const source = `${profile.name ?? ""} ${profile.command ?? ""}`.toLowerCase();
    if (source.includes("codex")) return "codex";
    if (source.includes("gemini")) return "gemini";
    return "claude";
  },
  getProviderAdapter: (provider: string) => ({
    label: provider === "codex" ? "Codex" : provider === "gemini" ? "Gemini" : "Claude",
  }),
  isLLMProtocol: (value: string) => ["claude", "codex", "gemini"].includes(value),
}));

import {
  discoverProviders,
  filterProfilesBySelectableProviders,
  getProviderLabel,
  getSelectableProviderIds,
  resetProviderRegistryCacheForTests,
} from "./provider-registry.js";

describe("provider registry", () => {
  let platformSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    mocks.execFileSync.mockReset();
    mocks.mkdirSync.mockReset();
    resetProviderRegistryCacheForTests();
  });

  afterEach(() => {
    platformSpy?.mockRestore();
    platformSpy = null;
  });

  it("discovers installed providers, managed flags, and MCP preflight details", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") return "/usr/bin/claude\n";
      if (command === "which" && args[0] === "codex") return "/usr/bin/codex\n";
      if (command === "which" && args[0] === "gemini") return "/usr/bin/gemini\n";

      if (command === "/usr/bin/claude" && args[0] === "--help") {
        return "Usage\n--output-format\n--resume\n--brief\n--ide\n--chrome\n";
      }
      if (command === "/usr/bin/codex" && args[0] === "--help") {
        return "Run Codex non-interactively\n--search\n";
      }
      if (command === "/usr/bin/gemini" && args[0] === "--help") {
        return "Usage\n--output-format\n--resume\n";
      }

      if (command === "/usr/bin/claude" && args[0] === "mcp") {
        return "Checking MCP server health...\nchrome-devtools: ok\nNeon: ok\n";
      }
      if (command === "/usr/bin/codex" && args[0] === "mcp") {
        return "Name Status\nchrome-devtools connected\nserena connected\n";
      }
      if (command === "/usr/bin/gemini" && args[0] === "mcp") {
        return "No MCP servers configured.\nloaded cached credentials from keychain\n";
      }

      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const providers = discoverProviders();
    const claude = providers.find((provider) => provider.id === "claude");
    const codex = providers.find((provider) => provider.id === "codex");
    const gemini = providers.find((provider) => provider.id === "gemini");

    expect(claude).toMatchObject({
      installed: true,
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        serenaVisible: false,
        mcpServers: ["chrome-devtools", "Neon"],
      },
    });
    expect(claude?.managedToggles.map((toggle) => toggle.key)).toEqual(["brief", "ide", "chrome"]);

    expect(codex).toMatchObject({
      installed: true,
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        serenaVisible: true,
        mcpServers: ["chrome-devtools", "serena"],
      },
    });
    expect(codex?.managedToggles).toEqual([
      expect.objectContaining({ key: "webSearch", supported: true }),
    ]);
    expect(codex?.sessionCommands).toEqual([
      expect.objectContaining({ command: "/fast", managed: false }),
    ]);

    expect(gemini).toMatchObject({
      installed: true,
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        serenaVisible: false,
        mcpServers: [],
        note: "loaded cached credentials from keychain",
      },
    });
    expect(mocks.mkdirSync).toHaveBeenCalled();
  });

  it("uses where.exe on Windows when discovering provider binaries", () => {
    platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "where.exe" && args[0] === "claude") return "C:\\Claude\\claude.cmd\r\n";
      if (command === "where.exe" && args[0] === "codex") throw new Error("missing");
      if (command === "where.exe" && args[0] === "gemini") throw new Error("missing");

      if (command === "C:\\Claude\\claude.cmd" && args[0] === "--help") {
        return "Usage\n--output-format\n--resume\n";
      }
      if (command === "C:\\Claude\\claude.cmd" && args[0] === "mcp") {
        return "No MCP servers configured.\n";
      }

      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const providers = discoverProviders();
    const claude = providers.find((provider) => provider.id === "claude");

    expect(claude?.installed).toBe(true);
    expect(claude?.path).toBe("C:\\Claude\\claude.cmd");
  });

  it("falls back cleanly when providers are missing or MCP checks fail", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") throw new Error("missing");
      if (command === "which" && args[0] === "codex") return "/usr/bin/codex\n";
      if (command === "which" && args[0] === "gemini") throw new Error("missing");

      if (command === "/usr/bin/codex" && args[0] === "--help") {
        return "Run Codex non-interactively\n";
      }
      if (command === "/usr/bin/codex" && args[0] === "mcp") {
        const error = new Error("boom") as Error & { stderr?: string };
        error.stderr = "MCP preflight failed.";
        throw error;
      }

      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const providers = discoverProviders();
    const codex = providers.find((provider) => provider.id === "codex");
    const claude = providers.find((provider) => provider.id === "claude");

    expect(claude).toMatchObject({
      installed: false,
      preflight: {
        headlessReady: false,
        note: "Claude is not installed on this machine.",
      },
    });
    expect(codex).toMatchObject({
      preflight: {
        mcpListReady: false,
        note: "MCP preflight failed.",
      },
    });
  });

  it("treats empty which output as not installed and falls back to the thrown help message when MCP output is empty", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") return "";
      if (command === "which" && args[0] === "codex") return "/usr/bin/codex\n";
      if (command === "which" && args[0] === "gemini") throw new Error("missing");

      if (command === "/usr/bin/codex" && args[0] === "--help") {
        return "Run Codex non-interactively\n";
      }
      if (command === "/usr/bin/codex" && args[0] === "mcp") {
        const error = new Error("broken mcp");
        throw error;
      }

      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const providers = discoverProviders();
    const claude = providers.find((provider) => provider.id === "claude");
    const codex = providers.find((provider) => provider.id === "codex");

    expect(claude?.installed).toBe(false);
    expect(codex?.managedToggles).toEqual([
      expect.objectContaining({ key: "webSearch", supported: false }),
    ]);
    expect(codex?.preflight.note).toBe("broken mcp");
  });

  it("uses stderr/stdout help output when --help exits non-zero and parses gemini MCP server names", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") throw new Error("missing");
      if (command === "which" && args[0] === "codex") throw new Error("missing");
      if (command === "which" && args[0] === "gemini") return "/usr/bin/gemini\n";

      if (command === "/usr/bin/gemini" && args[0] === "--help") {
        const error = new Error("bad exit") as Error & { stdout?: string; stderr?: string };
        error.stdout = "Usage\n--output-format\n";
        error.stderr = "--resume\n";
        throw error;
      }

      if (command === "/usr/bin/gemini" && args[0] === "mcp") {
        return "loaded cached credentials from keychain\n- chrome-devtools\n- serena\n";
      }

      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const providers = discoverProviders();
    const gemini = providers.find((provider) => provider.id === "gemini");

    expect(gemini).toMatchObject({
      installed: true,
      helpFlags: ["--output-format", "--resume"],
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        serenaVisible: true,
        mcpServers: ["chrome-devtools", "serena"],
        note: "loaded cached credentials from keychain",
      },
    });
  });

  it("filters selectable providers and profiles from settings plus saved includes", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") return "/usr/bin/claude\n";
      if (command === "which" && args[0] === "codex") return "/usr/bin/codex\n";
      if (command === "which" && args[0] === "gemini") throw new Error("missing");
      if (args[0] === "--help") return "--output-format\n--resume\nRun Codex non-interactively\n";
      if (args[0] === "mcp") return "No MCP servers configured.\n";
      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const settings = {
      providers: {
        claude: { enabled: false, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
    } as any;

    expect(getSelectableProviderIds(settings)).toEqual(["codex"]);
    expect(getSelectableProviderIds(settings, ["claude"])).toEqual(["codex", "claude"]);
    expect(filterProfilesBySelectableProviders(["claude-code", "codex", "gemini"], settings, ["claude"])).toEqual([
      "claude-code",
      "codex",
    ]);
    expect(getProviderLabel("claude")).toBe("Claude");
  });

  it("falls back to installed providers or defaults when nothing is enabled", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") return "/usr/bin/claude\n";
      if (command === "which" && args[0] === "codex") throw new Error("missing");
      if (command === "which" && args[0] === "gemini") throw new Error("missing");
      if (args[0] === "--help") return "--output-format\n--resume\n";
      if (args[0] === "mcp") return "No MCP servers configured.\n";
      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const settings = {
      providers: {
        claude: { enabled: false, brief: false, ide: false, chrome: false },
        codex: { enabled: false, webSearch: false },
        gemini: { enabled: false },
      },
    } as any;

    expect(getSelectableProviderIds(settings)).toEqual(["claude"]);
    expect(getSelectableProviderIds(settings, ["gemini"])).toEqual(["claude"]);

    resetProviderRegistryCacheForTests();
    mocks.execFileSync.mockImplementation(() => {
      throw new Error("missing");
    });

    expect(getSelectableProviderIds(settings, ["gemini"])).toEqual(["gemini"]);
    expect(getSelectableProviderIds(settings)).toEqual(["claude", "codex"]);
  });

  it("parses non-bulleted gemini MCP output and drops unsupported include providers", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") return "/usr/bin/claude\n";
      if (command === "which" && args[0] === "codex") throw new Error("missing");
      if (command === "which" && args[0] === "gemini") return "/usr/bin/gemini\n";
      if (args[0] === "--help") return "Usage\n--output-format\n--resume\n";
      if (command === "/usr/bin/claude" && args[0] === "mcp") return "Checking MCP server health...\nserena: ok\n";
      if (command === "/usr/bin/gemini" && args[0] === "mcp") return "chrome-devtools\nserena\n";
      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const providers = discoverProviders();
    const gemini = providers.find((provider) => provider.id === "gemini");
    expect(gemini?.preflight.mcpServers).toEqual(["chrome-devtools", "serena"]);

    const settings = {
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: false, webSearch: false },
        gemini: { enabled: false },
      },
    } as any;

    expect(getSelectableProviderIds(settings, ["codex", "gemini"])).toEqual(["claude", "gemini"]);
  });
});
