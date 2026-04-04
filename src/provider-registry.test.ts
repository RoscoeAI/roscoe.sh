import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: mocks.execFile,
  execFileSync: mocks.execFileSync,
}));

vi.mock("fs", () => ({
  mkdirSync: mocks.mkdirSync,
}));

vi.mock("./llm-runtime.js", () => ({
  detectProtocol: (profile: { name?: string; command?: string }) => {
    const source = `${profile.name ?? ""} ${profile.command ?? ""}`.toLowerCase();
    if (source.includes("codex")) return "codex";
    if (source.includes("qwen")) return "qwen";
    if (source.includes("kimi")) return "kimi";
    if (source.includes("gemini")) return "gemini";
    return "claude";
  },
  getProviderAdapter: (provider: string) => ({
    label: provider === "codex"
      ? "Codex"
      : provider === "qwen"
        ? "Qwen"
      : provider === "gemini"
        ? "Gemini"
        : provider === "kimi"
          ? "Kimi"
          : "Claude",
  }),
  isLLMProtocol: (value: string) => ["claude", "codex", "qwen", "gemini", "kimi"].includes(value),
}));

import {
  discoverInstalledProviders,
  discoverProviders,
  discoverProvidersAsync,
  filterProfilesBySelectableProviders,
  getProviderLabel,
  getSelectableProviderIds,
  resetProviderRegistryCacheForTests,
} from "./provider-registry.js";

describe("provider registry", () => {
  let platformSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    mocks.execFile.mockReset();
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
      if (command === "which" && args[0] === "qwen") return "/usr/bin/qwen\n";
      if (command === "which" && args[0] === "kimi") return "/usr/bin/kimi\n";
      if (command === "which" && args[0] === "gemini") return "/usr/bin/gemini\n";

      if (command === "/usr/bin/claude" && args[0] === "--help") {
        return "Usage\n--output-format\n--resume\n--brief\n--ide\n--chrome\n";
      }
      if (command === "/usr/bin/codex" && args[0] === "--help") {
        return "Run Codex non-interactively\n--search\n";
      }
      if (command === "/usr/bin/qwen" && args[0] === "--help") {
        return "Usage\n--output-format\n--resume\n--include-partial-messages\n";
      }
      if (command === "/usr/bin/gemini" && args[0] === "--help") {
        return "Usage\n--output-format\n--resume\n";
      }
      if (command === "/usr/bin/kimi" && args[0] === "--help") {
        return "Usage\n--print\n--output-format\n--resume\n--thinking\n";
      }

      if (command === "/usr/bin/claude" && args[0] === "mcp") {
        return "Checking MCP server health...\nchrome-devtools: ok\nNeon: ok\n";
      }
      if (command === "/usr/bin/codex" && args[0] === "mcp") {
        return "Name Status\nchrome-devtools connected\nserena connected\n";
      }
      if (command === "/usr/bin/qwen" && args[0] === "mcp") {
        return "No MCP servers configured.\n";
      }
      if (command === "/usr/bin/gemini" && args[0] === "mcp") {
        return "No MCP servers configured.\nloaded cached credentials from keychain\n";
      }
      if (command === "/usr/bin/kimi" && args[0] === "mcp") {
        return "MCP config file: /Users/test/.kimi/mcp.json\nNo MCP servers configured.\n";
      }

      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const providers = discoverProviders();
    const claude = providers.find((provider) => provider.id === "claude");
    const codex = providers.find((provider) => provider.id === "codex");
    const qwen = providers.find((provider) => provider.id === "qwen");
    const kimi = providers.find((provider) => provider.id === "kimi");
    const gemini = providers.find((provider) => provider.id === "gemini");

    expect(claude).toMatchObject({
      installed: true,
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        mcpServers: ["chrome-devtools", "Neon"],
        note: null,
      },
    });
    expect(claude?.managedToggles.map((toggle) => toggle.key)).toEqual(["brief", "ide", "chrome"]);

    expect(codex).toMatchObject({
      installed: true,
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        mcpServers: ["chrome-devtools", "serena"],
      },
    });
    expect(codex?.managedToggles).toEqual([
      expect.objectContaining({ key: "webSearch", supported: true }),
    ]);
    expect(codex?.sessionCommands).toEqual([
      expect.objectContaining({ command: "/fast", managed: false }),
    ]);

    expect(qwen).toMatchObject({
      installed: true,
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        mcpServers: [],
        note: null,
      },
    });
    expect(gemini).toMatchObject({
      installed: true,
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        mcpServers: [],
        note: "Gemini loaded cached credentials.",
      },
    });
    expect(kimi).toMatchObject({
      installed: true,
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        mcpServers: [],
        note: null,
      },
    });
    expect(mocks.mkdirSync).toHaveBeenCalled();
  });

  it("treats wrapped Kimi session aliases as headless-ready resume support", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") throw new Error("missing");
      if (command === "which" && args[0] === "codex") throw new Error("missing");
      if (command === "which" && args[0] === "qwen") throw new Error("missing");
      if (command === "which" && args[0] === "kimi") return "/usr/bin/kimi\n";
      if (command === "which" && args[0] === "gemini") throw new Error("missing");

      if (command === "/usr/bin/kimi" && args[0] === "--help") {
        return "Usage\n--print\n--output-format\n--session,--res…  -S,-r\n";
      }
      if (command === "/usr/bin/kimi" && args[0] === "mcp") {
        return "No MCP servers configured.\n";
      }

      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const providers = discoverProviders();
    const kimi = providers.find((provider) => provider.id === "kimi");

    expect(kimi?.preflight.headlessReady).toBe(true);
  });

  it("uses where.exe on Windows when discovering provider binaries", () => {
    platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "where.exe" && args[0] === "claude") return "C:\\Claude\\claude.cmd\r\n";
      if (command === "where.exe" && args[0] === "codex") throw new Error("missing");
      if (command === "where.exe" && args[0] === "qwen") throw new Error("missing");
      if (command === "where.exe" && args[0] === "kimi") throw new Error("missing");
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
      if (command === "which" && args[0] === "qwen") throw new Error("missing");
      if (command === "which" && args[0] === "kimi") throw new Error("missing");
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
      if (command === "which" && args[0] === "qwen") throw new Error("missing");
      if (command === "which" && args[0] === "kimi") throw new Error("missing");
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
      if (command === "which" && args[0] === "qwen") throw new Error("missing");
      if (command === "which" && args[0] === "kimi") throw new Error("missing");
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
        mcpServers: ["chrome-devtools", "serena"],
        note: "Gemini loaded cached credentials.",
      },
    });
  });

  it("normalizes Gemini keychain fallback notes into a non-fatal message", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") throw new Error("missing");
      if (command === "which" && args[0] === "codex") throw new Error("missing");
      if (command === "which" && args[0] === "qwen") throw new Error("missing");
      if (command === "which" && args[0] === "kimi") throw new Error("missing");
      if (command === "which" && args[0] === "gemini") return "/usr/bin/gemini\n";

      if (command === "/usr/bin/gemini" && args[0] === "--help") {
        return "Usage\n--output-format\n--resume\n";
      }
      if (command === "/usr/bin/gemini" && args[0] === "mcp") {
        return [
          "Keychain initialization encountered an error: Cannot find module '../build/Release/keytar.node'",
          "Using FileKeychain fallback for secure storage.",
          "Loaded cached credentials.",
          "No MCP servers configured.",
        ].join("\n");
      }

      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const providers = discoverProviders();
    const gemini = providers.find((provider) => provider.id === "gemini");

    expect(gemini?.preflight).toMatchObject({
      mcpListReady: true,
      mcpServers: [],
      note: "Gemini could not load its keychain bridge, so it fell back to file-backed credentials.",
    });
  });

  it("filters selectable providers and profiles from settings plus saved includes", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") return "/usr/bin/claude\n";
      if (command === "which" && args[0] === "codex") return "/usr/bin/codex\n";
      if (command === "which" && args[0] === "qwen") throw new Error("missing");
      if (command === "which" && args[0] === "kimi") throw new Error("missing");
      if (command === "which" && args[0] === "gemini") throw new Error("missing");
      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const settings = {
      providers: {
        claude: { enabled: false, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        qwen: { enabled: false },
        gemini: { enabled: false },
        kimi: { enabled: false },
      },
    } as any;

    expect(getSelectableProviderIds(settings)).toEqual(["codex"]);
    expect(getSelectableProviderIds(settings, ["claude"])).toEqual(["codex", "claude"]);
    expect(filterProfilesBySelectableProviders(["claude-code", "codex", "qwen", "gemini", "kimi"], settings, ["claude"])).toEqual([
      "claude-code",
      "codex",
    ]);
    expect(mocks.execFileSync).not.toHaveBeenCalledWith("/usr/bin/claude", ["--help"], expect.anything());
    expect(mocks.execFileSync).not.toHaveBeenCalledWith("/usr/bin/codex", ["mcp", "list"], expect.anything());
    expect(getProviderLabel("claude")).toBe("Claude");
  });

  it("falls back to installed providers or defaults when nothing is enabled", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") return "/usr/bin/claude\n";
      if (command === "which" && args[0] === "codex") throw new Error("missing");
      if (command === "which" && args[0] === "qwen") throw new Error("missing");
      if (command === "which" && args[0] === "kimi") throw new Error("missing");
      if (command === "which" && args[0] === "gemini") throw new Error("missing");
      if (args[0] === "--help") return "--output-format\n--resume\n";
      if (args[0] === "mcp") return "No MCP servers configured.\n";
      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    const settings = {
      providers: {
        claude: { enabled: false, brief: false, ide: false, chrome: false },
        codex: { enabled: false, webSearch: false },
        qwen: { enabled: false },
        gemini: { enabled: false },
        kimi: { enabled: false },
      },
    } as any;

    expect(getSelectableProviderIds(settings)).toEqual(["claude"]);
    expect(getSelectableProviderIds(settings, ["gemini"])).toEqual(["claude"]);

    resetProviderRegistryCacheForTests();
    mocks.execFileSync.mockImplementation(() => {
      throw new Error("missing");
    });

    expect(getSelectableProviderIds(settings, ["gemini"])).toEqual(["gemini"]);
    expect(getSelectableProviderIds(settings)).toEqual(["claude", "codex", "qwen", "gemini", "kimi"]);
  });

  it("parses non-bulleted gemini MCP output and drops unsupported include providers", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") return "/usr/bin/claude\n";
      if (command === "which" && args[0] === "codex") throw new Error("missing");
      if (command === "which" && args[0] === "qwen") throw new Error("missing");
      if (command === "which" && args[0] === "kimi") throw new Error("missing");
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
        qwen: { enabled: false },
        gemini: { enabled: false },
        kimi: { enabled: false },
      },
    } as any;

    expect(getSelectableProviderIds(settings, ["codex", "gemini"])).toEqual(["claude", "gemini"]);
  });

  it("discovers installed providers without paying help or MCP preflight", () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") return "/usr/bin/claude\n";
      if (command === "which" && args[0] === "codex") throw new Error("missing");
      if (command === "which" && args[0] === "qwen") throw new Error("missing");
      if (command === "which" && args[0] === "kimi") throw new Error("missing");
      if (command === "which" && args[0] === "gemini") throw new Error("missing");
      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });

    expect(discoverInstalledProviders()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "claude", installed: true, path: "/usr/bin/claude" }),
      expect.objectContaining({ id: "codex", installed: false, path: null }),
    ]));
    expect(mocks.execFileSync).not.toHaveBeenCalledWith("/usr/bin/claude", ["--help"], expect.anything());
    expect(mocks.execFileSync).not.toHaveBeenCalledWith("/usr/bin/claude", ["mcp", "list"], expect.anything());
  });

  it("discovers provider preflight asynchronously for the Provider Setup tab", async () => {
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "claude") return "/usr/bin/claude\n";
      if (command === "which" && args[0] === "codex") throw new Error("missing");
      if (command === "which" && args[0] === "qwen") throw new Error("missing");
      if (command === "which" && args[0] === "kimi") throw new Error("missing");
      if (command === "which" && args[0] === "gemini") throw new Error("missing");
      throw new Error(`unexpected execFileSync call: ${command} ${args.join(" ")}`);
    });
    mocks.execFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      if (command === "/usr/bin/claude" && args[0] === "--help") {
        callback(null, "Usage\n--output-format\n--resume\n--brief\n", "");
        return {} as never;
      }
      if (command === "/usr/bin/claude" && args[0] === "mcp") {
        callback(null, "Checking MCP server health...\nchrome-devtools: ok\n", "");
        return {} as never;
      }
      callback(new Error(`unexpected execFile call: ${command} ${args.join(" ")}`), "", "");
      return {} as never;
    });

    const providers = await discoverProvidersAsync();
    const claude = providers.find((provider) => provider.id === "claude");

    expect(claude).toMatchObject({
      installed: true,
      helpFlags: ["--brief", "--output-format", "--resume"],
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        mcpServers: ["chrome-devtools"],
        note: null,
      },
    });
  });
});
