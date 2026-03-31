import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import type { RoscoeSettings } from "../config.js";

let lastOnDone: (() => void) | null = null;

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  saveRoscoeSettings: vi.fn(),
  setRoscoeKeepAwakeEnabled: vi.fn(),
  ensureHostedRelayClientId: vi.fn(() => "client-123"),
  startHostedRelayDeviceLink: vi.fn(),
  pollHostedRelayDeviceLink: vi.fn(),
  openExternalUrl: vi.fn(),
  sendTestMessage: vi.fn(),
  notificationStatus: {
    enabled: false,
    phoneNumber: "",
    provider: "twilio" as const,
    providerReady: true,
    consentAcknowledged: false,
    consentReady: false,
    summary: "Phone saved; SMS wire is paused.",
    inboundMode: "webhook" as const,
    inboundDetail: "Webhook inbound ready.",
  },
  discoverProviders: vi.fn(() => ([
    {
      id: "claude",
      label: "Claude",
      command: "claude",
      installed: true,
      path: "/usr/local/bin/claude",
      comingSoon: false,
      helpFlags: ["--brief", "--chrome", "--ide"],
      managedToggles: [
        { key: "brief", label: "Brief mode", description: "Brief", flag: "--brief", supported: true },
        { key: "ide", label: "IDE attach", description: "IDE", flag: "--ide", supported: true },
        { key: "chrome", label: "Chrome bridge", description: "Chrome", flag: "--chrome", supported: true },
      ],
      sessionCommands: [],
      extraFlags: [],
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        serenaVisible: false,
        mcpServers: ["chrome-devtools", "Neon"],
        note: "Checking MCP server health...",
      },
    },
    {
      id: "codex",
      label: "Codex",
      command: "codex",
      installed: true,
      path: "/usr/local/bin/codex",
      comingSoon: false,
      helpFlags: ["--search"],
      managedToggles: [
        { key: "webSearch", label: "Live web search", description: "search", flag: "--search", supported: true },
      ],
      sessionCommands: [
        { command: "/fast", label: "Fast mode", description: "manual", managed: false, note: "not auto" },
      ],
      extraFlags: [],
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        serenaVisible: true,
        mcpServers: ["chrome-devtools", "serena"],
        note: null,
      },
    },
    {
      id: "gemini",
      label: "Gemini",
      command: "gemini",
      installed: true,
      path: "/opt/homebrew/bin/gemini",
      comingSoon: false,
      helpFlags: [],
      managedToggles: [],
      sessionCommands: [],
      extraFlags: [],
      preflight: {
        headlessReady: true,
        mcpListReady: true,
        serenaVisible: false,
        mcpServers: [],
        note: "No MCP servers configured.",
      },
    },
  ])),
  settings: {
      notifications: {
        enabled: false,
        phoneNumber: "",
        consentAcknowledged: false,
        consentProofUrls: [] as string[],
        provider: "twilio" as const,
        deliveryMode: "unconfigured" as RoscoeSettings["notifications"]["deliveryMode"],
        hostedTestVerifiedPhone: "",
        hostedRelayClientId: "",
        hostedRelayAccessToken: "",
        hostedRelayAccessTokenExpiresAt: "",
        hostedRelayRefreshToken: "",
        hostedRelayLinkedPhone: "",
        hostedRelayLinkedEmail: "",
      },
    providers: {
      claude: {
        enabled: true,
        brief: false,
        ide: false,
        chrome: false,
      },
      codex: {
        enabled: true,
        webSearch: false,
      },
      gemini: {
        enabled: true,
      },
    },
    behavior: {
      autoHealMetadata: true,
      preventSleepWhileRunning: true,
      parkAtMilestonesForReview: false,
    },
  } as RoscoeSettings,
  state: {
    sessions: new Map(),
    activeSessionId: null as string | null,
  },
  projects: [
    {
      name: "nanobots",
      directory: "/tmp/nanobots",
      onboardedAt: "2026-03-25T12:00:00.000Z",
      lastActive: "2026-03-25T12:00:00.000Z",
    },
    {
      name: "K12.io",
      directory: "/tmp/k12io",
      onboardedAt: "2026-03-12T12:00:00.000Z",
      lastActive: "2026-03-12T12:00:00.000Z",
    },
  ],
  contexts: {
    "/tmp/nanobots": {
      name: "nanobots",
      directory: "/tmp/nanobots",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "Nanobots brief",
      intentBrief: {
        projectStory: "Nanobots project story",
        primaryUsers: [],
        definitionOfDone: ["done means proven"],
        acceptanceChecks: [],
        successSignals: [],
        deliveryPillars: {
          frontend: ["frontend proof"],
          backend: ["backend proof"],
          unitComponentTests: ["unit proof"],
          e2eTests: ["e2e proof"],
        },
        coverageMechanism: ["vitest coverage"],
        nonGoals: [],
        constraints: [],
        autonomyRules: [],
        qualityBar: [],
        riskBoundaries: [],
        uiDirection: "conversation-first",
      },
      interviewAnswers: [],
      runtimeDefaults: {},
    },
    "/tmp/k12io": {
      name: "K12.io",
      directory: "/tmp/k12io",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "K12 brief",
      intentBrief: {
        projectStory: "K12 project story",
        primaryUsers: [],
        definitionOfDone: ["k12 done"],
        acceptanceChecks: [],
        successSignals: [],
        deliveryPillars: {
          frontend: ["frontend proof"],
          backend: ["backend proof"],
          unitComponentTests: ["unit proof"],
          e2eTests: ["e2e proof"],
        },
        coverageMechanism: ["vitest coverage"],
        nonGoals: [],
        constraints: [],
        autonomyRules: [],
        qualityBar: [],
        riskBoundaries: [],
        uiDirection: "operator-first",
      },
      interviewAnswers: [],
      runtimeDefaults: {},
    },
  } as Record<string, unknown>,
}));

vi.mock("../app.js", () => ({
  useAppContext: () => ({
    dispatch: mocks.dispatch,
    state: mocks.state,
  }),
}));

vi.mock("../config.js", () => ({
  listProjectHistory: () => [],
  listRegisteredProjects: () => mocks.projects,
  loadProjectContext: (directory: string) => mocks.contexts[directory] ?? null,
  loadRoscoeSettings: () => structuredClone(mocks.settings),
  saveRoscoeSettings: (next: typeof mocks.settings) => {
    mocks.settings = structuredClone(next);
    mocks.saveRoscoeSettings(next);
  },
  ensureHostedRelayClientId: mocks.ensureHostedRelayClientId,
}));

vi.mock("../keep-awake.js", () => ({
  setRoscoeKeepAwakeEnabled: mocks.setRoscoeKeepAwakeEnabled,
}));

vi.mock("../hosted-relay-client.js", () => ({
  startHostedRelayDeviceLink: mocks.startHostedRelayDeviceLink,
  pollHostedRelayDeviceLink: mocks.pollHostedRelayDeviceLink,
}));

vi.mock("../open-url.js", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

vi.mock("../notification-service.js", () => {
  const cleanPhoneNumber = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("+")) {
      return `+${trimmed.slice(1).replace(/[^\d]/g, "")}`;
    }
    return trimmed.replace(/[^\d]/g, "");
  };

  return {
    cleanPhoneNumber,
    NotificationService: class {
      getStatus() {
        return {
          ...mocks.notificationStatus,
          phoneNumber: cleanPhoneNumber(mocks.settings.notifications.phoneNumber),
          enabled: mocks.settings.notifications.enabled,
          consentAcknowledged: mocks.settings.notifications.consentAcknowledged,
          consentReady: mocks.settings.notifications.consentAcknowledged,
        };
      }

      async sendTestMessage() {
        return mocks.sendTestMessage();
      }
    },
  };
});

vi.mock("../provider-registry.js", () => ({
  discoverProviders: mocks.discoverProviders,
  getProviderLabel: (provider: string) => provider === "claude" ? "Claude" : provider === "codex" ? "Codex" : "Gemini",
}));

vi.mock("./roscoe-intro.js", () => ({
  RoscoeIntro: ({ onDone }: { onDone: () => void }) => {
    lastOnDone = onDone;
    return <Text>INTRO SCREEN</Text>;
  },
}));

vi.mock("./project-brief.js", () => ({
  ProjectBriefView: ({ context }: { context: { name: string } }) => (
    <Text>{`PROJECT BRIEF ${context.name}`}</Text>
  ),
}));

import {
  applyRoscoeAction,
  describeHostedSmsResult,
  formatPlanAmount,
  getRelayBaseUrl,
  HomeScreen,
  pollHostedTestSmsStatus,
  requestHostedCheckoutSession,
  resetHomeScreenIntroForTests,
} from "./home-screen.js";

function delay(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootHome() {
  const first = render(<HomeScreen />);
  lastOnDone?.();
  first.unmount();
  return render(<HomeScreen />);
}

async function moveToTab(app: ReturnType<typeof render>, count: number) {
  for (let i = 0; i < count; i += 1) {
    app.stdin.write("\u001B[C");
    await delay();
  }
}

async function moveToTabLabel(app: ReturnType<typeof render>, label: string, maxSteps = 8) {
  for (let i = 0; i < maxSteps; i += 1) {
    if (app.lastFrame()?.includes(`▸ ${label}`)) {
      return;
    }
    app.stdin.write("\u001B[C");
    await delay();
  }
  throw new Error(`Did not reach tab containing: ${label}`);
}

async function moveDownUntil(app: ReturnType<typeof render>, snippet: string, maxSteps = 8) {
  for (let i = 0; i < maxSteps; i += 1) {
    if (app.lastFrame()?.includes(snippet)) {
      return;
    }
    app.stdin.write("\u001B[B");
    await delay();
  }
  throw new Error(`Did not reach selection containing: ${snippet}`);
}

describe("HomeScreen", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.dispatch.mockReset();
    mocks.saveRoscoeSettings.mockReset();
    mocks.setRoscoeKeepAwakeEnabled.mockReset();
    mocks.ensureHostedRelayClientId.mockReset();
    mocks.startHostedRelayDeviceLink.mockReset();
    mocks.pollHostedRelayDeviceLink.mockReset();
    mocks.openExternalUrl.mockReset();
    mocks.sendTestMessage.mockReset();
    mocks.discoverProviders.mockClear();
    mocks.settings = {
      notifications: {
        enabled: false,
        phoneNumber: "",
        consentAcknowledged: false,
        consentProofUrls: [],
        provider: "twilio",
        deliveryMode: "unconfigured",
        hostedTestVerifiedPhone: "",
        hostedRelayClientId: "",
        hostedRelayAccessToken: "",
        hostedRelayAccessTokenExpiresAt: "",
        hostedRelayRefreshToken: "",
        hostedRelayLinkedPhone: "",
        hostedRelayLinkedEmail: "",
      },
      providers: {
        claude: {
          enabled: true,
          brief: false,
          ide: false,
          chrome: false,
        },
        codex: {
          enabled: true,
          webSearch: false,
        },
        gemini: {
          enabled: true,
        },
      },
      behavior: {
        autoHealMetadata: true,
        preventSleepWhileRunning: true,
        parkAtMilestonesForReview: false,
      },
    };
    mocks.notificationStatus = {
      enabled: false,
      phoneNumber: "",
      provider: "twilio",
      providerReady: true,
      consentAcknowledged: false,
      consentReady: false,
      summary: "Phone saved; SMS wire is paused.",
      inboundMode: "webhook",
      inboundDetail: "Webhook inbound ready.",
    };
    mocks.state.sessions = new Map();
    mocks.state.activeSessionId = null;
    lastOnDone = null;
    resetHomeScreenIntroForTests();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/relay/billing/plans")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            plans: [
              { priceId: "price_month", amount: 500, currency: "usd", interval: "month", intervalCount: 1, label: "$5/mo" },
              { priceId: "price_year", amount: 5000, currency: "usd", interval: "year", intervalCount: 1, label: "$50/yr" },
            ],
          }),
        };
      }
      if (url.includes("/api/relay/billing/status")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            status: {
              phone: "6122030386",
              subscriptionStatus: null,
              active: false,
              recordUpdatedAt: "2026-03-30T12:00:00.000Z",
            },
          }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: "Unhandled fetch in test" }),
      };
    }) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats hosted relay helpers and sms result copy", () => {
    const previousBaseUrl = process.env.ROSCOE_RELAY_BASE_URL;
    delete process.env.ROSCOE_RELAY_BASE_URL;
    expect(getRelayBaseUrl()).toBe("https://roscoe.sh");
    process.env.ROSCOE_RELAY_BASE_URL = "https://relay.example";
    expect(getRelayBaseUrl()).toBe("https://relay.example");
    if (previousBaseUrl === undefined) {
      delete process.env.ROSCOE_RELAY_BASE_URL;
    } else {
      process.env.ROSCOE_RELAY_BASE_URL = previousBaseUrl;
    }

    expect(formatPlanAmount(500, "usd")).toBe("$5.00");

    expect(describeHostedSmsResult("16122030386", {
      ok: false,
    })).toEqual({
      text: "Failed to send hosted test SMS.",
      color: "red",
    });

    expect(describeHostedSmsResult("16122030386", {
      ok: true,
      delivered: false,
      terminal: true,
      status: "undelivered",
      errorMessage: "carrier blocked",
    })).toEqual({
      text: "Hosted relay test SMS did not deliver (undelivered). carrier blocked Checkout remains locked until delivery is confirmed.",
      color: "red",
    });

    expect(describeHostedSmsResult("16122030386", {
      ok: true,
      delivered: false,
      terminal: false,
      status: "queued",
    })).toEqual({
      text: "Hosted relay test SMS submitted to Twilio for 16122030386 (queued). Delivery is not confirmed yet, so checkout remains locked.",
      color: "yellow",
    });

    expect(describeHostedSmsResult("16122030386", {
      ok: true,
      delivered: false,
      terminal: true,
    })).toEqual({
      text: "Hosted relay test SMS did not deliver. Checkout remains locked until delivery is confirmed.",
      color: "red",
    });

    expect(describeHostedSmsResult("16122030386", {
      ok: true,
      delivered: false,
      terminal: false,
      errorMessage: "carrier still pending",
    })).toEqual({
      text: "Hosted relay test SMS submitted to Twilio for 16122030386 (queued). Delivery is not confirmed yet, so checkout remains locked. carrier still pending",
      color: "yellow",
    });
  });

  it("polls hosted sms status until delivery, timeout, or error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, sid: "SM123", status: "queued", delivered: false, terminal: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, sid: "SM123", status: "delivered", delivered: true, terminal: true }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const deliveredPromise = pollHostedTestSmsStatus("https://relay.example", "SM123");
    await vi.advanceTimersByTimeAsync(4000);
    await expect(deliveredPromise).resolves.toMatchObject({ delivered: true, status: "delivered" });

    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, sid: "SM456", status: "queued", delivered: false, terminal: false }),
    });

    const timeoutPromise = pollHostedTestSmsStatus("https://relay.example", "SM456");
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(timeoutPromise).resolves.toMatchObject({ sid: "SM456", delivered: false, terminal: false });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });

    const errorPromise = pollHostedTestSmsStatus("https://relay.example", "SM789");
    await vi.advanceTimersByTimeAsync(2000);
    await expect(errorPromise).resolves.toEqual({
      ok: false,
      error: "Hosted relay SMS status is unavailable.",
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "provider rejected the request" }),
    });

    const explicitErrorPromise = pollHostedTestSmsStatus("https://relay.example", "SM790");
    await vi.advanceTimersByTimeAsync(2000);
    await expect(explicitErrorPromise).resolves.toEqual({
      ok: false,
      error: "provider rejected the request",
    });
    vi.useRealTimers();
  });

  it("shows the intro only once per app run", async () => {
    const first = render(<HomeScreen />);
    expect(first.lastFrame()).toContain("INTRO SCREEN");
    expect(lastOnDone).toBeTypeOf("function");

    lastOnDone?.();
    first.unmount();

    const second = render(<HomeScreen />);
    expect(second.lastFrame()).toContain("ROSCOE DISPATCH");
    expect(second.lastFrame()).toContain("Home Tabs");
    expect(second.lastFrame()).toContain("Dispatch Board");
    expect(second.lastFrame()).not.toContain("Project Memory");
    expect(second.lastFrame()).not.toContain("INTRO SCREEN");
  });

  it("exits the process from dispatch when Exit is selected", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);

    const app = await bootHome();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();

    expect(() => app.stdin.write("\r")).toThrow("exit:0");
    exitSpy.mockRestore();
  });

  it("switches home tabs with arrow keys and shows tab-specific panels", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    expect(app.lastFrame()).toContain("Dispatch Board");
    expect(app.lastFrame()).toContain("launch path");
    expect(app.lastFrame()).toContain("Start Sessions");
    expect(app.lastFrame()).toContain("›");
    expect(app.lastFrame()).toContain("Provider Setup");
    expect(app.lastFrame()).not.toContain("Project Memory");
    expect(app.lastFrame()).not.toContain("Optional two-way SMS wire for milestones, intervention, and check-ins");
    expect(mocks.discoverProviders).not.toHaveBeenCalled();

    app.stdin.write("\u001B[C");
    await delay();
    expect(mocks.discoverProviders).toHaveBeenCalledTimes(1);
    expect(app.lastFrame()).toContain("Provider Setup");
    expect(app.lastFrame()).toContain("Installed CLIs");
    expect(app.lastFrame()).toContain("headless ready");
    expect(app.lastFrame()).toContain("mcp ready");
    expect(app.lastFrame()).toContain("serena missing");
    expect(app.lastFrame()).toContain("MCP servers:");

    app.stdin.write("\u001B[C");
    await delay();
    expect(app.lastFrame()).toContain("Roscoe Settings");
    expect(app.lastFrame()).toContain("Auto-heal metadata");
    expect(app.lastFrame()).toContain("Prevent sleep while Roscoe runs");
    expect(app.lastFrame()).toContain("Park at large milestones for human review");

    app.stdin.write("\u001B[C");
    await delay();
    expect(app.lastFrame()).toContain("Channel Setup");
    expect(app.lastFrame()).toContain("First choose whether Roscoe channels should run through roscoe.sh");
    expect(app.lastFrame()).toContain("Roscoe-hosted");
    expect(app.lastFrame()).toContain("Self-hosted");
    expect(app.lastFrame()).toContain("Slack, Discord, Telegram, WhatsApp");
    expect(app.lastFrame()).not.toContain("Onboarded codebases");
  });

  it("toggles Roscoe metadata auto-heal from the Roscoe Settings tab", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();

    expect(app.lastFrame()).toContain("Roscoe Settings");
    expect(app.lastFrame()).toContain("Auto-heal metadata");

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      behavior: expect.objectContaining({
        autoHealMetadata: false,
      }),
    }));
  });

  it("toggles keep-awake through the Roscoe action helper", () => {
    const result = applyRoscoeAction(mocks.settings, "prevent-sleep");

    expect(result.settings.behavior.preventSleepWhileRunning).toBe(false);
    expect(result.keepAwakeEnabled).toBe(false);
    expect(result.message).toEqual({
      text: "Roscoe will no longer request Mac keep-awake while it runs.",
      color: "yellow",
    });
  });

  it("toggles milestone parking from the Roscoe Settings tab", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();

    await moveDownUntil(app, "› Park at large milestones for human review");
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      behavior: expect.objectContaining({
        parkAtMilestonesForReview: true,
      }),
    }));
  });

  it("toggles Claude Chrome bridge from Provider Setup", async () => {
    const app = await bootHome();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.objectContaining({
        claude: expect.objectContaining({
          chrome: true,
        }),
      }),
    }));
    expect(app.lastFrame()).toContain("Claude Chrome bridge enabled for new turns.");
  });

  it("switches from Roscoe settings actions to the next tab with the arrow keys", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();

    await moveDownUntil(app, "› Auto-heal metadata");
    app.stdin.write("\u001B[C");
    await delay();

    expect(app.lastFrame()).toContain("Channel Setup");
  });

  it("shows a return-to-running-lane action when a live lane exists", async () => {
    mocks.state.sessions = new Map([
      ["lane-1", {
        id: "lane-1",
        projectName: "nanobots",
        worktreeName: "main",
        status: "active",
      }],
    ]);
    mocks.state.activeSessionId = "lane-1";

    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    expect(app.lastFrame()).toContain("Return to running lane");
    expect(app.lastFrame()).toContain("nanobots:main");

    app.stdin.write("\r");
    await delay();

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_ACTIVE", id: "lane-1" });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_SCREEN", screen: "session-view" });
  });

  it("falls back to the first non-exited lane when the remembered active lane has exited", async () => {
    mocks.state.sessions = new Map([
      ["lane-exited", {
        id: "lane-exited",
        projectName: "old",
        worktreeName: "main",
        status: "exited",
      }],
      ["lane-live", {
        id: "lane-live",
        projectName: "nanobots",
        worktreeName: "soc2",
        status: "review",
      }],
    ]);
    mocks.state.activeSessionId = "lane-exited";

    const app = await bootHome();
    expect(app.lastFrame()).toContain("Return to running lane");
    expect(app.lastFrame()).toContain("nanobots:soc2");
  });

  it("acknowledges start sessions immediately before opening lane setup", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    expect(app.lastFrame()).toContain("Start Sessions");

    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Opening lane setup...");

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "OPEN_SESSION_SETUP" });
  });

  it("acknowledges onboarding immediately from dispatch", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Opening onboarding...");
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "OPEN_ONBOARDING", request: { mode: "onboard" } });
  });

  it("lets channel setup choose self-hosted and edit the phone on enter", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Channel Route");
    expect(app.lastFrame()).toContain("Self-hosted");
    expect(app.lastFrame()).toContain(".env.local");
    expect(app.lastFrame()).toContain("Phone Number");
    expect(app.lastFrame()).toContain("Send Test SMS");

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Phone Number");
    expect(app.lastFrame()).toContain("Enter continues to SMS consent. Esc cancels.");
  });

  it("blocks arming self-hosted SMS until phone consent is accepted", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).not.toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        enabled: true,
      }),
    }));
    expect(app.lastFrame()).toContain("Add a phone number before arming SMS updates");
  });

  it("shows an SMS consent dialog after entering a phone number", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("+15551234567");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("SMS Consent");
    expect(app.lastFrame()).toContain("Accepting will save");
    expect(app.lastFrame()).toContain("Accept");
    expect(app.lastFrame()).toContain("Cancel");
  });

  it("shows provider setup between dispatch and channel setup", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();

    expect(mocks.discoverProviders).toHaveBeenCalledTimes(1);
    expect(app.lastFrame()).toContain("Provider Setup");
    expect(app.lastFrame()).toContain("Claude");
    expect(app.lastFrame()).toContain("Codex");
    expect(app.lastFrame()).toContain("Gemini");
    expect(app.lastFrame()).toContain("headless ready");
    expect(app.lastFrame()).toContain("mcp ready");

    app.stdin.write("\u001B[C");
    await delay();

    expect(app.lastFrame()).toContain("Roscoe Settings");
    expect(app.lastFrame()).not.toContain("Project Memory");

    app.stdin.write("\u001B[C");
    await delay(40);

    expect(app.lastFrame()).toContain("Channel Setup");
    expect(app.lastFrame()).toContain("Roscoe-hosted");
    expect(app.lastFrame()).toContain("Slack, Discord, Telegram, WhatsApp");
    expect(app.lastFrame()).not.toContain("Project Memory");

    app.stdin.write("\u001B[C");
    await delay();

    expect(app.lastFrame()).toContain("Dispatch Board");
    expect(app.lastFrame()).not.toContain("Project Memory");
  });

  it("loads hosted billing details from roscoe.sh outside the vitest short-circuit", async () => {
    const previousVitest = process.env.VITEST;
    delete process.env.VITEST;
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "+16122030386";
    mocks.settings.notifications.consentAcknowledged = true;

    try {
      const app = await bootHome();
      await moveToTab(app, 3);
      await delay(50);

      expect(app.lastFrame()).toContain("Checkout");
      expect(app.lastFrame()).toContain("$5.00/month");
      expect(app.lastFrame()).toContain("annual $50.00/year");
      expect(app.lastFrame()).toContain("Latest relay billing update: 2026-03-30T12:00:00.000Z");
    } finally {
      process.env.VITEST = previousVitest;
    }
  });

  it("renders active hosted status, monthly-only pricing, and linked fallback text", async () => {
    const previousVitest = process.env.VITEST;
    delete process.env.VITEST;
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "+16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "+16122030386";
    mocks.settings.notifications.hostedRelayAccessToken = "access-token";
    mocks.settings.notifications.hostedRelayLinkedPhone = "+16122030386";
    mocks.settings.notifications.hostedRelayLinkedEmail = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/relay/billing/plans")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            plans: [
              { priceId: "price_month", amount: 500, currency: "usd", interval: "month", intervalCount: 1, label: "$5/mo" },
            ],
          }),
        };
      }
      if (url.includes("/api/relay/billing/status")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            status: {
              phone: "16122030386",
              subscriptionStatus: "active",
              active: true,
              recordUpdatedAt: "2026-03-30T12:00:00.000Z",
            },
          }),
        };
      }
      return { ok: false, json: async () => ({ error: "Unhandled fetch in test" }) };
    }) as unknown as typeof fetch);

    try {
      const app = await bootHome();
      await moveToTab(app, 3);
      await delay(50);

      expect(app.lastFrame()).toContain("subscription active");
      expect(app.lastFrame()).toContain("Checkout");
      expect(app.lastFrame()).toContain("Active");
      expect(app.lastFrame()).toContain("Link This CLI");
      expect(app.lastFrame()).toContain("Linked");
      expect(app.lastFrame()).not.toContain("annual");
    } finally {
      process.env.VITEST = previousVitest;
    }
  });

  it("falls back cleanly when hosted billing fetches fail", async () => {
    const previousVitest = process.env.VITEST;
    delete process.env.VITEST;
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "+16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("relay unavailable");
    }) as unknown as typeof fetch);

    try {
      const app = await bootHome();
      await moveToTab(app, 3);
      await delay(50);

      expect(app.lastFrame()).toContain("Checkout");
      expect(app.lastFrame()).toContain("Loading pricing...");
      expect(app.lastFrame()).not.toContain("Latest relay billing update:");
    } finally {
      process.env.VITEST = previousVitest;
    }
  });

  it("falls back cleanly when hosted billing responds non-ok or no phone is saved", async () => {
    const previousVitest = process.env.VITEST;
    delete process.env.VITEST;
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/relay/billing/plans")) {
        return {
          ok: false,
          json: async () => ({ error: "plans unavailable" }),
        };
      }
      throw new Error(`status fetch should not run without a phone: ${url}`);
    }) as unknown as typeof fetch);

    try {
      const app = await bootHome();
      await delay();
      await moveToTabLabel(app, "Channel Setup");
      await delay(50);

      expect(app.lastFrame()).toContain("Checkout");
      expect(app.lastFrame()).toContain("Loading pricing...");
      expect(app.lastFrame()).not.toContain("Latest relay billing update:");
      expect(app.lastFrame()).toContain("No phone saved yet.");
    } finally {
      process.env.VITEST = previousVitest;
    }
  });

  it("wraps home tabs left from dispatch to channel and back to dispatch", async () => {
    const app = await bootHome();

    app.stdin.write("\u001B[D");
    await delay();
    expect(app.lastFrame()).toContain("Channel Setup");

    app.stdin.write("\u001B[C");
    await delay();
    expect(app.lastFrame()).toContain("Dispatch Board");
  });

  it("switches tabs directly from the dispatch action list with left and right arrows", async () => {
    const app = await bootHome();

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    expect(app.lastFrame()).toContain("Provider Setup");

    app.stdin.write("\u001B[D");
    await delay();
    expect(app.lastFrame()).toContain("Dispatch Board");
  });

  it("does not scan providers until Provider Setup is opened", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    expect(app.lastFrame()).toContain("Dispatch Board");
    expect(mocks.discoverProviders).not.toHaveBeenCalled();

    app.stdin.write("\u001B[C");
    await delay();

    expect(app.lastFrame()).toContain("Provider Setup");
    expect(mocks.discoverProviders).toHaveBeenCalledTimes(1);
  });

  it("shows the no-provider state when no installed providers are detected", async () => {
    mocks.discoverProviders.mockReturnValueOnce([]);

    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();

    expect(app.lastFrame()).toContain("none detected");
    expect(app.lastFrame()).toContain("No supported providers were detected on this machine");
  });

  it("toggles provider-managed flags and guards against hiding the last enabled provider", async () => {
    mocks.settings.providers.codex.enabled = false;
    mocks.settings.providers.gemini.enabled = false;

    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    let app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).not.toHaveBeenCalled();
    app.unmount();

    mocks.settings.providers.codex.enabled = true;
    app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\r");
    await delay();
    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.objectContaining({
        claude: expect.objectContaining({
          enabled: false,
        }),
      }),
    }));

    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\r");
    await delay();
    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.objectContaining({
        codex: expect.objectContaining({
          webSearch: true,
        }),
      }),
    }));
  });

  it("toggles Claude brief mode from Provider Setup", async () => {
    const app = await bootHome();
    await moveToTab(app, 1);
    await delay();

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.objectContaining({
        claude: expect.objectContaining({
          brief: true,
        }),
      }),
    }));
    expect(app.lastFrame()).toContain("Claude brief mode enabled");
  });

  it("resets the channel route after choosing self-hosted", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Self-hosted");

    await moveDownUntil(app, "› Reset Route");
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("route not chosen");
    expect(app.lastFrame()).toContain("First choose whether Roscoe channels should run through roscoe.sh");
  });

  it("shows hosted relay details after choosing roscoe-hosted", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Channel Route");
    expect(app.lastFrame()).toContain("Roscoe-hosted");
    expect(app.lastFrame()).toContain("Send Hosted Test SMS");
    expect(app.lastFrame()).toContain("Checkout");
    expect(app.lastFrame()).toContain("Link This CLI");
    expect(app.lastFrame()).toContain("Loading pricing");
    expect(app.lastFrame()).toContain("Slack, Discord, Telegram, WhatsApp");
  });

  it("lets the user accept the SMS consent dialog", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("+16122030386");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("SMS Consent");
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        phoneNumber: "+16122030386",
        consentAcknowledged: true,
      }),
    }));
    expect(app.lastFrame()).toContain("SMS consent accepted");
  });

  it("preserves hosted relay credentials when accepting consent for the same linked phone", async () => {
    mocks.settings.notifications.phoneNumber = "+16122030386";
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.hostedTestVerifiedPhone = "+16122030386";
    mocks.settings.notifications.hostedRelayAccessToken = "linked-access";
    mocks.settings.notifications.hostedRelayAccessTokenExpiresAt = "2026-04-01T00:00:00.000Z";
    mocks.settings.notifications.hostedRelayRefreshToken = "linked-refresh";
    mocks.settings.notifications.hostedRelayLinkedPhone = "+16122030386";
    mocks.settings.notifications.hostedRelayLinkedEmail = "tim@slatebox.com";

    const app = await bootHome();
    await moveToTab(app, 3);
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        phoneNumber: "+16122030386",
        consentAcknowledged: true,
        hostedTestVerifiedPhone: "+16122030386",
        hostedRelayAccessToken: "linked-access",
        hostedRelayAccessTokenExpiresAt: "2026-04-01T00:00:00.000Z",
        hostedRelayRefreshToken: "linked-refresh",
        hostedRelayLinkedPhone: "+16122030386",
        hostedRelayLinkedEmail: "tim@slatebox.com",
      }),
    }));
  });

  it("lets the user cancel the SMS consent dialog and clears the number", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("+16122030386");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        phoneNumber: "",
        consentAcknowledged: false,
      }),
    }));
    expect(app.lastFrame()).toContain("Phone number cleared");
  });

  it("blocks hosted actions until the required phone verification steps are complete", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Roscoe-hosted");

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Add a phone number before sending a hosted test SMS");

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Save a phone number before opening hosted checkout");

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Save a phone number before linking this CLI");
  });

  it("sends a hosted test SMS and unlocks checkout", async () => {
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/relay/billing/plans")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            plans: [
              { priceId: "price_month", amount: 500, currency: "usd", interval: "month", intervalCount: 1, label: "$5/mo" },
            ],
          }),
        };
      }
      if (url.includes("/api/relay/billing/status")) {
        return {
          ok: true,
          json: async () => ({ ok: true, status: { phone: "16122030386", subscriptionStatus: null, active: false } }),
        };
      }
      if (url.includes("/api/relay/sms/test")) {
        return {
          ok: true,
          json: async () => ({ ok: true, sid: "SM123", status: "delivered", delivered: true, terminal: true }),
        };
      }
      if (url.includes("/api/relay/billing/checkout-session")) {
        expect(init?.method).toBe("POST");
        return {
          ok: true,
          json: async () => ({ ok: true, url: "https://checkout.example/session" }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: "Unhandled fetch in test" }),
      };
    }) as unknown as typeof fetch);

    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay(150);

    expect(mocks.saveRoscoeSettings.mock.calls.some(([settings]) =>
      settings?.notifications?.hostedTestVerifiedPhone === "16122030386",
    )).toBe(true);
    expect(app.lastFrame()).toContain("Checkout is now unlocked");

  });

  it("requests a hosted checkout session URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/api/relay/billing/checkout-session");
      return {
        ok: true,
        json: async () => ({ ok: true, url: "https://checkout.example/session" }),
      };
    }) as unknown as typeof fetch);

    await expect(requestHostedCheckoutSession("https://roscoe.sh", "16122030386"))
      .resolves.toBe("https://checkout.example/session");
  });

  it("links the CLI through the hosted relay device flow", async () => {
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "16122030386";
    mocks.startHostedRelayDeviceLink.mockResolvedValue({
      ok: true,
      deviceCode: "ABCD-1234",
      verificationUrlComplete: "https://roscoe.sh/link?code=ABCD-1234",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pollIntervalSeconds: 0,
    });
    mocks.pollHostedRelayDeviceLink.mockResolvedValue({
      ok: true,
      status: "approved",
      accessToken: "access-token",
      accessTokenExpiresAt: "2026-04-01T00:00:00.000Z",
      refreshToken: "refresh-token",
      phone: "16122030386",
      userEmail: "tim@slatebox.com",
      pollIntervalSeconds: 1,
    });

    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    vi.useFakeTimers();
    app.stdin.write("\r");
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    vi.useRealTimers();

    expect(mocks.ensureHostedRelayClientId).toHaveBeenCalled();
    expect(mocks.openExternalUrl).toHaveBeenCalledWith("https://roscoe.sh/link?code=ABCD-1234");
    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        hostedRelayAccessToken: "access-token",
        hostedRelayRefreshToken: "refresh-token",
        hostedRelayLinkedPhone: "16122030386",
        hostedRelayLinkedEmail: "tim@slatebox.com",
      }),
    }));
    expect(app.lastFrame()).toContain("now linked to roscoe.sh as tim@slatebox.com");
  });

  it("arms self-hosted SMS and sends a local test text", async () => {
    mocks.sendTestMessage.mockResolvedValue({
      ok: true,
      accepted: true,
      delivered: true,
      status: "delivered",
      detail: "Local test SMS delivered.",
    });

    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("+16122030386");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\r");
    await delay();

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        enabled: true,
      }),
    }));

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.sendTestMessage).toHaveBeenCalled();
    expect(app.lastFrame()).toContain("Local test SMS delivered.");
  });

  it("shows a self-hosted SMS send failure", async () => {
    mocks.settings.notifications.deliveryMode = "self-hosted";
    mocks.settings.notifications.phoneNumber = "+16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.sendTestMessage.mockRejectedValueOnce(new Error("Twilio send failed"));

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    await moveDownUntil(app, "› Send Test SMS");
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Twilio send failed");
  });

  it("keeps hosted checkout locked when the hosted test SMS does not deliver", async () => {
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/relay/billing/plans")) {
        return {
          ok: true,
          json: async () => ({ ok: true, plans: [{ priceId: "price_month", amount: 500, currency: "usd", interval: "month", intervalCount: 1, label: "$5/mo" }] }),
        };
      }
      if (url.includes("/api/relay/billing/status")) {
        return {
          ok: true,
          json: async () => ({ ok: true, status: { phone: "16122030386", subscriptionStatus: null, active: false } }),
        };
      }
      if (url.includes("/api/relay/sms/test")) {
        return {
          ok: true,
          json: async () => ({ ok: true, sid: "SM123", status: "undelivered", delivered: false, terminal: true, errorMessage: "carrier blocked" }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: "Unhandled fetch in test" }),
      };
    }) as unknown as typeof fetch);

    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay(100);

    expect(app.lastFrame()).toContain("did not deliver");
    expect(app.lastFrame()).toContain("Checkout remains locked");
    expect(mocks.saveRoscoeSettings).not.toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        hostedTestVerifiedPhone: "16122030386",
      }),
    }));
  });

  it("shows a hosted checkout error when roscoe.sh cannot create the session", async () => {
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "16122030386";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/relay/billing/plans")) {
        return {
          ok: true,
          json: async () => ({ ok: true, plans: [{ priceId: "price_month", amount: 500, currency: "usd", interval: "month", intervalCount: 1, label: "$5/mo" }] }),
        };
      }
      if (url.includes("/api/relay/billing/status")) {
        return {
          ok: true,
          json: async () => ({ ok: true, status: { phone: "16122030386", subscriptionStatus: null, active: false } }),
        };
      }
      if (url.includes("/api/relay/billing/checkout-session")) {
        return {
          ok: false,
          json: async () => ({ error: "Checkout provider unavailable" }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: "Unhandled fetch in test" }),
      };
    }) as unknown as typeof fetch);

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    await moveDownUntil(app, "› Checkout");
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Checkout provider unavailable");
  });

  it("shows a hosted link expiration error when approval never completes", async () => {
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "16122030386";
    mocks.startHostedRelayDeviceLink.mockResolvedValueOnce({
      ok: true,
      deviceCode: "DEV-1",
      verificationUrlComplete: "https://roscoe.sh/link?device_code=DEV-1",
      expiresAt: new Date(Date.now() - 500).toISOString(),
      pollIntervalSeconds: 1,
    });

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay(50);

    expect(app.lastFrame()).toContain("Hosted relay link request expired before approval completed");
  });

  it("blocks self-hosted SMS arming when a phone is saved but consent is still missing", async () => {
    mocks.settings.notifications.deliveryMode = "self-hosted";
    mocks.settings.notifications.phoneNumber = "+16122030386";
    mocks.settings.notifications.consentAcknowledged = false;

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    await moveDownUntil(app, "› SMS Wire");
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Save a phone number and accept the SMS consent notice before arming SMS updates.");
  });

  it("clears editing state when phone entry is cancelled with escape", async () => {
    mocks.settings.notifications.deliveryMode = "self-hosted";
    mocks.settings.notifications.phoneNumber = "+16122030386";

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    await moveDownUntil(app, "› Phone Number");
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Enter continues to SMS consent. Esc cancels.");

    app.stdin.write("\u001B");
    await delay();

    expect(app.lastFrame()).toContain("Phone Number");
    expect(app.lastFrame()).not.toContain("Enter continues to SMS consent. Esc cancels.");
  });

  it("lets the user navigate the SMS consent dialog before cancelling", async () => {
    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("+16122030386");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("SMS Consent");

    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[A");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Phone number cleared");
  });

  it("blocks hosted actions until SMS consent is accepted", async () => {
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = false;

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    await moveDownUntil(app, "› Send Hosted Test SMS");
    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Accept SMS consent before sending a hosted test SMS");

    await moveDownUntil(app, "› Checkout");
    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Accept SMS consent before opening hosted checkout");

    await moveDownUntil(app, "› Link This CLI");
    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Accept SMS consent before linking this CLI");
  });

  it("blocks hosted checkout and linking until the test SMS is verified", async () => {
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "";

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    await moveDownUntil(app, "› Checkout");
    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Send a hosted test SMS first. Checkout stays locked until delivery is confirmed.");

    await moveDownUntil(app, "› Link This CLI");
    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Send a hosted test SMS first so Roscoe can verify this phone before linking the CLI.");
  });

  it("re-verifies the same hosted phone by clearing the prior verification first", async () => {
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "16122030386";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/relay/billing/plans")) {
        return {
          ok: true,
          json: async () => ({ ok: true, plans: [{ priceId: "price_month", amount: 500, currency: "usd", interval: "month", intervalCount: 1, label: "$5/mo" }] }),
        };
      }
      if (url.includes("/api/relay/billing/status")) {
        return {
          ok: true,
          json: async () => ({ ok: true, status: { phone: "16122030386", subscriptionStatus: null, active: false } }),
        };
      }
      if (url.includes("/api/relay/sms/test")) {
        return {
          ok: true,
          json: async () => ({ ok: true, sid: "SM999", status: "delivered", delivered: true, terminal: true }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: "Unhandled fetch in test" }),
      };
    }) as unknown as typeof fetch);

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    await moveDownUntil(app, "› Send Hosted Test SMS");
    app.stdin.write("\r");
    await delay(120);

    expect(mocks.saveRoscoeSettings).toHaveBeenNthCalledWith(1, expect.objectContaining({
      notifications: expect.objectContaining({
        hostedTestVerifiedPhone: "",
      }),
    }));
    expect(mocks.saveRoscoeSettings).toHaveBeenNthCalledWith(2, expect.objectContaining({
      notifications: expect.objectContaining({
        hostedTestVerifiedPhone: "16122030386",
      }),
    }));
  });

  it("shows a hosted test SMS send error when roscoe.sh rejects the request", async () => {
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/relay/billing/plans")) {
        return {
          ok: true,
          json: async () => ({ ok: true, plans: [{ priceId: "price_month", amount: 500, currency: "usd", interval: "month", intervalCount: 1, label: "$5/mo" }] }),
        };
      }
      if (url.includes("/api/relay/billing/status")) {
        return {
          ok: true,
          json: async () => ({ ok: true, status: { phone: "16122030386", subscriptionStatus: null, active: false } }),
        };
      }
      if (url.includes("/api/relay/sms/test")) {
        return {
          ok: false,
          json: async () => ({ error: "Hosted SMS blocked by provider" }),
        };
      }
      return {
        ok: false,
        json: async () => ({ error: "Unhandled fetch in test" }),
      };
    }) as unknown as typeof fetch);

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay(80);
    expect(app.lastFrame()).toContain("Send Hosted Test SMS");

    await moveDownUntil(app, "› Send Hosted Test SMS", 12);
    app.stdin.write("\r");
    await delay(120);

    expect(app.lastFrame()).toContain("Hosted SMS blocked by provider");
  });

  it("supports left/right keyboard navigation inside provider and channel sections", async () => {
    const app = await bootHome();
    await moveToTab(app, 1);
    await delay();

    app.stdin.write("\u001B[B");
    await delay();
    expect(app.lastFrame()).toContain("Claude");

    app.stdin.write("\u001B[C");
    await delay();
    expect(app.lastFrame()).toContain("Codex");
    expect(app.lastFrame()).toContain("serena visible");

    app.stdin.write("\u001B[D");
    await delay();
    expect(app.lastFrame()).toContain("Claude");

    app.stdin.write("\u001B[A");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    expect(app.lastFrame()).toContain("Roscoe Settings");

    app.stdin.write("\u001B[C");
    await delay();
    expect(app.lastFrame()).toContain("Channel Setup");

    app.stdin.write("\u001B[B");
    await delay();
    expect(app.lastFrame()).toContain("Roscoe-hosted");

    app.stdin.write("\u001B[D");
    await delay();
    expect(app.lastFrame()).toContain("Roscoe Settings");
  });

  it("renders Gemini provider details and handles providers with no managed toggles", async () => {
    const app = await bootHome();
    await moveToTab(app, 1);
    await delay();

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();

    const frame = app.lastFrame()!;
    expect(frame).toContain("Gemini");
    expect(frame).toContain("Gemini availability");
    expect(frame).toContain("MCP servers:");
    expect(frame).toContain("none detected");
    expect(frame).toContain("Gemini lanes use --output-format stream-json");

    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Gemini");
  });

  it("renders provider scanning and no-provider states when discovery changes", async () => {
    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const realSetTimeout = global.setTimeout;
    const setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((() => 0) as typeof setTimeout);
    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await new Promise<void>((resolve) => realSetTimeout(resolve, 20));
    expect(app.lastFrame()).toContain("scanning");

    setTimeoutSpy.mockRestore();
    mocks.discoverProviders.mockReturnValueOnce([]);
    app.unmount();

    const refreshed = await bootHome();
    await moveToTab(refreshed, 1);
    await delay(50);

    expect(refreshed.lastFrame()).toContain("none detected");
    expect(refreshed.lastFrame()).toContain("No supported providers were detected on this machine.");
  });

  it("moves focus back to the home tabs when up-arrow is pressed on the first channel action", async () => {
    mocks.settings.notifications.deliveryMode = "self-hosted";
    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    app.stdin.write("\u001B[B");
    await delay();

    expect(app.lastFrame()).toContain("› Channel Route");

    app.stdin.write("\u001B[A");
    await delay();

    const frame = app.lastFrame()!;
    expect(frame).toContain("▸ Channel Setup");
    expect(frame).not.toContain("› Channel Route");
  });

  it("surfaces a hosted link bootstrap failure before polling begins", async () => {
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "16122030386";
    mocks.startHostedRelayDeviceLink.mockResolvedValueOnce({
      ok: false,
      error: "Unable to start hosted relay linking.",
    });

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    await moveDownUntil(app, "› Link This CLI");
    app.stdin.write("\r");
    await delay(50);

    expect(app.lastFrame()).toContain("Unable to start hosted relay linking.");
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("keeps polling a hosted link until approval completes", async () => {
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "16122030386";
    mocks.startHostedRelayDeviceLink.mockResolvedValueOnce({
      ok: true,
      deviceCode: "DEV-2",
      verificationUrlComplete: "https://roscoe.sh/link?device_code=DEV-2",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      pollIntervalSeconds: 1,
    });
    mocks.pollHostedRelayDeviceLink
      .mockResolvedValueOnce({
        ok: true,
        status: "pending",
        pollIntervalSeconds: 1,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: "approved",
        accessToken: "linked-access",
        accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        refreshToken: "linked-refresh",
        phone: "16122030386",
        userEmail: "tim@slatebox.com",
      });

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    await moveDownUntil(app, "› Link This CLI");
    vi.useFakeTimers();
    app.stdin.write("\r");
    await vi.advanceTimersByTimeAsync(2500);
    await Promise.resolve();
    vi.useRealTimers();

    expect(mocks.pollHostedRelayDeviceLink).toHaveBeenCalledTimes(2);
    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        hostedRelayAccessToken: "linked-access",
        hostedRelayRefreshToken: "linked-refresh",
        hostedRelayLinkedPhone: "16122030386",
        hostedRelayLinkedEmail: "tim@slatebox.com",
      }),
    }));
  });

  it("surfaces hosted relay link failures without storing credentials", async () => {
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "16122030386";
    mocks.startHostedRelayDeviceLink.mockResolvedValue({
      ok: true,
      deviceCode: "ABCD-1234",
      verificationUrlComplete: "https://roscoe.sh/link?code=ABCD-1234",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pollIntervalSeconds: 0,
    });
    mocks.pollHostedRelayDeviceLink.mockResolvedValue({
      ok: false,
      error: "approval denied",
    });

    const first = render(<HomeScreen />);
    lastOnDone?.();
    first.unmount();

    const app = render(<HomeScreen />);
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[C");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    vi.useFakeTimers();
    app.stdin.write("\r");
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    vi.useRealTimers();

    expect(app.lastFrame()).toContain("approval denied");
    expect(mocks.saveRoscoeSettings).not.toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        hostedRelayAccessToken: "access-token",
      }),
    }));
  });

  it("surfaces invalid hosted relay bootstrap payloads and non-error link failures", async () => {
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "16122030386";
    mocks.startHostedRelayDeviceLink.mockResolvedValueOnce({
      ok: true,
      deviceCode: "DEV-3",
      verificationUrlComplete: "",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pollIntervalSeconds: 1,
    });

    let app = await bootHome();
    await moveToTab(app, 3);
    await delay();
    await moveDownUntil(app, "› Link This CLI");
    app.stdin.write("\r");
    await delay(60);
    expect(app.lastFrame()).toContain("Unable to start hosted relay linking.");
    app.unmount();

    mocks.startHostedRelayDeviceLink.mockResolvedValueOnce({
      ok: true,
      deviceCode: "DEV-4",
      verificationUrlComplete: "https://roscoe.sh/link?device_code=DEV-4",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pollIntervalSeconds: 0,
    });
    mocks.pollHostedRelayDeviceLink.mockResolvedValueOnce({
      ok: false,
      error: "",
    });

    app = await bootHome();
    await moveToTab(app, 3);
    await delay();
    await moveDownUntil(app, "› Link This CLI");
    vi.useFakeTimers();
    app.stdin.write("\r");
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.resolve();
    vi.useRealTimers();
    expect(app.lastFrame()).toContain("Unable to link this Roscoe CLI to the hosted relay.");
  });

  it("stores hosted relay credentials without an email and handles expired link requests", async () => {
    mocks.settings.notifications.deliveryMode = "roscoe-hosted";
    mocks.settings.notifications.phoneNumber = "16122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.hostedTestVerifiedPhone = "16122030386";
    mocks.startHostedRelayDeviceLink.mockResolvedValueOnce({
      ok: true,
      deviceCode: "DEV-5",
      verificationUrlComplete: "https://roscoe.sh/link?device_code=DEV-5",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pollIntervalSeconds: 1,
    });
    mocks.pollHostedRelayDeviceLink.mockResolvedValueOnce({
      ok: true,
      status: "approved",
      accessToken: "access-no-email",
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      refreshToken: "refresh-no-email",
      phone: "16122030386",
      userEmail: "",
    });

    let app = await bootHome();
    await moveToTab(app, 3);
    await delay();
    await moveDownUntil(app, "› Link This CLI");
    vi.useFakeTimers();
    app.stdin.write("\r");
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.resolve();
    vi.useRealTimers();

    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        hostedRelayAccessToken: "access-no-email",
        hostedRelayRefreshToken: "refresh-no-email",
        hostedRelayLinkedEmail: "",
      }),
    }));
    expect(app.lastFrame()).toContain("This Roscoe CLI is now linked to roscoe.sh.");
    app.unmount();

    mocks.startHostedRelayDeviceLink.mockResolvedValueOnce({
      ok: true,
      deviceCode: "DEV-6",
      verificationUrlComplete: "https://roscoe.sh/link?device_code=DEV-6",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      pollIntervalSeconds: 1,
    });

    app = await bootHome();
    await moveToTab(app, 3);
    await delay();
    await moveDownUntil(app, "› Link This CLI");
    app.stdin.write("\r");
    await delay(50);
    expect(app.lastFrame()).toContain("Hosted relay link request expired before approval completed.");
  });

  it("handles non-delivered and rejected self-hosted SMS test results", async () => {
    mocks.settings.notifications.deliveryMode = "self-hosted";
    mocks.settings.notifications.phoneNumber = "6122030386";
    mocks.settings.notifications.consentAcknowledged = true;
    mocks.settings.notifications.enabled = true;
    mocks.sendTestMessage
      .mockResolvedValueOnce({ ok: true, delivered: false, detail: "Queued for carrier delivery." })
      .mockResolvedValueOnce({ ok: false, delivered: false, detail: "Carrier rejected the destination number." });

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();
    await moveDownUntil(app, "› Send Test SMS");
    app.stdin.write("\r");
    await delay(80);
    expect(app.lastFrame()).toContain("Queued for carrier delivery.");

    app.stdin.write("\u001B[A");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    await delay(80);
    app.stdin.write("\r");
    await delay(80);
    expect(app.lastFrame()).toContain("Carrier rejected the destination number.");

    app.stdin.write("\u001B[A");
    await delay();
    expect(app.lastFrame()).toContain("Phone saved; SMS wire is paused.");
  });

  it("clears the phone number when an empty value is submitted", async () => {
    mocks.settings.notifications.deliveryMode = "self-hosted";

    const app = await bootHome();
    await moveToTab(app, 3);
    await delay();

    await moveDownUntil(app, "› Phone Number");
    app.stdin.write("\r");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        phoneNumber: "",
        consentAcknowledged: false,
        hostedTestVerifiedPhone: "",
      }),
    }));
    expect(app.lastFrame()).toContain("Phone number cleared.");
  });
});
