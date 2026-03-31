import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import type { AppAction } from "../types.js";

const mocks = vi.hoisted(() => ({
  ensureHostedRelayClientId: vi.fn(() => "relay-client-1"),
  loadRoscoeSettings: vi.fn(),
  saveRoscoeSettings: vi.fn(),
  cleanPhoneNumber: vi.fn((value: string) => value.replace(/\s+/g, "")),
  refreshHostedRelaySession: vi.fn(),
  processInboundOperatorReplies: vi.fn(async () => {}),
  deliverQueuedOperatorMessages: vi.fn(),
}));

const clientMocks = vi.hoisted(() => {
  let listener: ((message: any) => void) | null = null;
  const ackInbound = vi.fn();
  const configure = vi.fn();
  const subscribe = vi.fn((next: (message: any) => void) => {
    listener = next;
    return () => {
      listener = null;
    };
  });

  return {
    getClient: () => ({
      ackInbound,
      configure,
      subscribe,
    }),
    getListener: () => listener,
    ackInbound,
    configure,
    subscribe,
    reset() {
      listener = null;
      ackInbound.mockClear();
      configure.mockClear();
      subscribe.mockClear();
    },
  };
});

vi.mock("../config.js", () => ({
  ensureHostedRelayClientId: mocks.ensureHostedRelayClientId,
  loadRoscoeSettings: mocks.loadRoscoeSettings,
  saveRoscoeSettings: mocks.saveRoscoeSettings,
}));

vi.mock("../notification-service.js", () => ({
  cleanPhoneNumber: mocks.cleanPhoneNumber,
}));

vi.mock("../hosted-relay-client.js", () => ({
  getHostedRelayClient: () => clientMocks.getClient(),
  refreshHostedRelaySession: mocks.refreshHostedRelaySession,
}));

vi.mock("../operator-wire.js", () => ({
  processInboundOperatorReplies: mocks.processInboundOperatorReplies,
  deliverQueuedOperatorMessages: mocks.deliverQueuedOperatorMessages,
}));

import { useHostedRelayWire } from "./use-hosted-relay-wire.js";

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createSettings(overrides: Record<string, unknown> = {}) {
  return {
    notifications: {
      deliveryMode: "roscoe-hosted",
      phoneNumber: "+15551234567",
      consentAcknowledged: true,
      hostedRelayAccessToken: "access-1",
      hostedRelayAccessTokenExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      hostedRelayRefreshToken: "refresh-1",
      hostedRelayLinkedPhone: "+15551234567",
      hostedRelayLinkedEmail: "tim@example.com",
      ...overrides,
    },
  };
}

function createService() {
  return {} as any;
}

function Harness({
  sessions,
  dispatch,
  service,
}: {
  sessions: Map<string, any>;
  dispatch: React.Dispatch<AppAction>;
  service: any;
}) {
  useHostedRelayWire(sessions, dispatch, service);
  return <Text>hosted-wire</Text>;
}

describe("useHostedRelayWire", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.loadRoscoeSettings.mockReturnValue(createSettings());
    mocks.refreshHostedRelaySession.mockResolvedValue({
      ok: true,
      status: "linked",
      accessToken: "access-2",
      accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      refreshToken: "refresh-2",
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      phone: "+15551234567",
      clientId: "relay-client-1",
      userEmail: "tim@example.com",
    });
    mocks.processInboundOperatorReplies.mockClear();
    mocks.deliverQueuedOperatorMessages.mockClear();
    mocks.saveRoscoeSettings.mockClear();
    clientMocks.reset();
    process.env.ROSCOE_RELAY_BASE_URL = "https://roscoe.sh";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ROSCOE_RELAY_BASE_URL;
  });

  it("configures the hosted relay socket when the link is valid", async () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();
    const sessions = new Map([["lane-1", { id: "lane-1" }]]);

    render(<Harness sessions={sessions} dispatch={dispatch} service={service} />);
    await flushEffects();

    expect(clientMocks.configure).toHaveBeenCalledWith({
      enabled: true,
      baseUrl: "https://roscoe.sh",
      accessToken: "access-1",
      clientId: "relay-client-1",
    });
    expect(mocks.deliverQueuedOperatorMessages).toHaveBeenCalledWith(
      sessions,
      dispatch,
      service,
      "roscoe-relay",
      "hosted-sms",
      "Hosted SMS",
    );
  });

  it("disables the hosted relay socket when the saved link no longer matches the phone", async () => {
    mocks.loadRoscoeSettings.mockReturnValue(createSettings({
      hostedRelayLinkedPhone: "+15550000000",
    }));
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();
    const sessions = new Map();

    render(<Harness sessions={sessions} dispatch={dispatch} service={service} />);
    await flushEffects();

    expect(clientMocks.configure).toHaveBeenCalledWith(null);
    expect(mocks.deliverQueuedOperatorMessages).toHaveBeenCalledWith(
      sessions,
      dispatch,
      service,
      "roscoe-relay",
      "hosted-sms",
      "Hosted SMS",
    );
  });

  it("refreshes the hosted relay session when the access token is about to expire", async () => {
    const nearExpiry = new Date(Date.now() + 30_000).toISOString();
    mocks.loadRoscoeSettings.mockReturnValue(createSettings({
      hostedRelayAccessTokenExpiresAt: nearExpiry,
    }));
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();
    const sessions = new Map();

    render(<Harness sessions={sessions} dispatch={dispatch} service={service} />);
    await flushEffects();

    expect(mocks.refreshHostedRelaySession).toHaveBeenCalledWith(
      "https://roscoe.sh",
      "refresh-1",
      "relay-client-1",
    );
    await flushEffects();

    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        hostedRelayAccessToken: "access-2",
        hostedRelayRefreshToken: "refresh-2",
        hostedRelayLinkedPhone: "+15551234567",
        hostedRelayLinkedEmail: "tim@example.com",
      }),
    }));
  });

  it("keeps the existing config when a hosted relay refresh is rejected", async () => {
    const nearExpiry = new Date(Date.now() + 30_000).toISOString();
    mocks.loadRoscoeSettings.mockReturnValue(createSettings({
      hostedRelayAccessTokenExpiresAt: nearExpiry,
    }));
    mocks.refreshHostedRelaySession.mockResolvedValueOnce({
      ok: false,
      error: "refresh denied",
    });

    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();

    render(<Harness sessions={new Map()} dispatch={dispatch} service={service} />);
    await flushEffects();
    await flushEffects();

    expect(mocks.refreshHostedRelaySession).toHaveBeenCalled();
    expect(mocks.saveRoscoeSettings).not.toHaveBeenCalled();
    expect(clientMocks.configure).toHaveBeenCalledWith({
      enabled: true,
      baseUrl: "https://roscoe.sh",
      accessToken: "access-1",
      clientId: "relay-client-1",
    });
  });

  it("falls back to the default relay base URL and keeps the prior email when refresh succeeds without one", async () => {
    const nearExpiry = new Date(Date.now() + 30_000).toISOString();
    mocks.loadRoscoeSettings.mockReturnValue(createSettings({
      hostedRelayAccessTokenExpiresAt: nearExpiry,
    }));
    mocks.refreshHostedRelaySession.mockResolvedValueOnce({
      ok: true,
      status: "linked",
      accessToken: "access-3",
      accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      refreshToken: "refresh-3",
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      phone: "+15551234567",
      clientId: "relay-client-1",
    });
    delete process.env.ROSCOE_RELAY_BASE_URL;

    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();

    render(<Harness sessions={new Map()} dispatch={dispatch} service={service} />);
    await flushEffects();
    await flushEffects();

    expect(mocks.refreshHostedRelaySession).toHaveBeenCalledWith(
      "https://roscoe.sh",
      "refresh-1",
      "relay-client-1",
    );
    expect(mocks.saveRoscoeSettings).toHaveBeenCalledWith(expect.objectContaining({
      notifications: expect.objectContaining({
        hostedRelayAccessToken: "access-3",
        hostedRelayRefreshToken: "refresh-3",
        hostedRelayLinkedEmail: "tim@example.com",
      }),
    }));
    expect(clientMocks.configure).toHaveBeenCalledWith({
      enabled: true,
      baseUrl: "https://roscoe.sh",
      accessToken: "access-1",
      clientId: "relay-client-1",
    });
  });

  it("swallows refresh exceptions and leaves the existing hosted link alone", async () => {
    const nearExpiry = new Date(Date.now() + 30_000).toISOString();
    mocks.loadRoscoeSettings.mockReturnValue(createSettings({
      hostedRelayAccessTokenExpiresAt: nearExpiry,
    }));
    mocks.refreshHostedRelaySession.mockRejectedValueOnce(new Error("network down"));

    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();

    render(<Harness sessions={new Map()} dispatch={dispatch} service={service} />);
    await flushEffects();
    await flushEffects();

    expect(mocks.refreshHostedRelaySession).toHaveBeenCalled();
    expect(mocks.saveRoscoeSettings).not.toHaveBeenCalled();
    expect(clientMocks.configure).toHaveBeenCalledWith({
      enabled: true,
      baseUrl: "https://roscoe.sh",
      accessToken: "access-1",
      clientId: "relay-client-1",
    });
  });

  it("keeps the current token when there is no expiry timestamp to refresh against", async () => {
    mocks.loadRoscoeSettings.mockReturnValue(createSettings({
      hostedRelayAccessTokenExpiresAt: "",
    }));

    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();

    render(<Harness sessions={new Map()} dispatch={dispatch} service={service} />);
    await flushEffects();

    expect(mocks.refreshHostedRelaySession).not.toHaveBeenCalled();
    expect(clientMocks.configure).toHaveBeenCalledWith({
      enabled: true,
      baseUrl: "https://roscoe.sh",
      accessToken: "access-1",
      clientId: "relay-client-1",
    });
  });

  it("routes inbound hosted SMS through the operator wire and acknowledges delivery", async () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();
    const sessions = new Map([["lane-1", { id: "lane-1" }]]);

    render(<Harness sessions={sessions} dispatch={dispatch} service={service} />);
    await flushEffects();

    const listener = clientMocks.getListener();
    expect(listener).toBeTypeOf("function");

    listener?.({
      id: "msg-1",
      fromPhone: "+15551234567",
      body: "status",
      receivedAt: new Date().toISOString(),
    });
    await flushEffects();

    expect(mocks.processInboundOperatorReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "roscoe-relay",
        toolName: "hosted-sms",
        sourceLabel: "Hosted SMS",
        replies: [
          expect.objectContaining({
            id: "msg-1",
            body: "status",
            answerText: "status",
            from: "+15551234567",
            via: "hosted-sms",
          }),
        ],
      }),
    );
    expect(clientMocks.ackInbound).toHaveBeenCalledWith(["msg-1"]);
  });

  it("does not deliver queued hosted messages when hosted relay mode is disabled", async () => {
    mocks.loadRoscoeSettings.mockReturnValue({
      notifications: {
        deliveryMode: "self-hosted",
        phoneNumber: "+15551234567",
        consentAcknowledged: true,
        hostedRelayAccessToken: "",
        hostedRelayAccessTokenExpiresAt: "",
        hostedRelayRefreshToken: "",
        hostedRelayLinkedPhone: "",
      },
    });
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();

    render(<Harness sessions={new Map()} dispatch={dispatch} service={service} />);
    await flushEffects();

    expect(mocks.deliverQueuedOperatorMessages).not.toHaveBeenCalled();
    expect(clientMocks.configure).toHaveBeenCalledWith(null);
  });
});
