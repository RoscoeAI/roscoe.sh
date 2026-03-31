import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import type { AppAction } from "../types.js";

const mocks = vi.hoisted(() => ({
  loadRoscoeSettings: vi.fn(),
  processInboundOperatorReplies: vi.fn(async () => {}),
  deliverQueuedOperatorMessages: vi.fn(),
}));

vi.mock("../config.js", () => ({
  loadRoscoeSettings: mocks.loadRoscoeSettings,
}));

vi.mock("../operator-wire.js", () => ({
  processInboundOperatorReplies: mocks.processInboundOperatorReplies,
  deliverQueuedOperatorMessages: mocks.deliverQueuedOperatorMessages,
}));

import { useSmsWire } from "./use-sms-wire.js";

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createSettings(deliveryMode: "self-hosted" | "roscoe-hosted" = "self-hosted") {
  return {
    notifications: {
      deliveryMode,
      enabled: true,
      phoneNumber: "+15551234567",
      consentAcknowledged: true,
      provider: "twilio",
    },
  };
}

function createService(overrides: Record<string, unknown> = {}) {
  return {
    notifications: {
      getStatus: vi.fn(() => ({
        enabled: true,
        providerReady: true,
        phoneNumber: "+15551234567",
      })),
      hasPendingQuestions: vi.fn(() => false),
      readIncomingReplies: vi.fn(async () => ([
        {
          sid: "SM1",
          body: "status",
          answerText: "status",
          from: "+15551234567",
          receivedAt: 123,
          token: "R1",
          matchedSessionId: "lane-1",
        },
      ])),
    },
    ...overrides,
  } as any;
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
  useSmsWire(sessions, dispatch, service);
  return <Text>sms-wire</Text>;
}

describe("useSmsWire", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.loadRoscoeSettings.mockReturnValue(createSettings());
    mocks.processInboundOperatorReplies.mockClear();
    mocks.deliverQueuedOperatorMessages.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls incoming self-hosted SMS replies and normalizes them for operator routing", async () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();
    const sessions = new Map([["lane-1", { id: "lane-1" }]]);

    render(<Harness sessions={sessions} dispatch={dispatch} service={service} />);
    await flushEffects();

    await vi.advanceTimersByTimeAsync(5000);
    await flushEffects();

    expect(service.notifications.readIncomingReplies).toHaveBeenCalled();
    expect(mocks.processInboundOperatorReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twilio",
        toolName: "sms",
        sourceLabel: "SMS",
        sessions,
        dispatch,
        service,
        replies: [
          expect.objectContaining({
            id: "SM1",
            body: "status",
            answerText: "status",
            from: "+15551234567",
            token: "R1",
            matchedSessionId: "lane-1",
            via: "sms",
          }),
        ],
      }),
    );
  });

  it("delivers queued operator messages for self-hosted SMS on mount", async () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();
    const sessions = new Map([["lane-1", { id: "lane-1" }]]);

    render(<Harness sessions={sessions} dispatch={dispatch} service={service} />);
    await flushEffects();

    expect(mocks.deliverQueuedOperatorMessages).toHaveBeenCalledWith(
      sessions,
      dispatch,
      service,
      "twilio",
      "sms",
      "SMS",
    );
  });

  it("stands down completely in hosted relay mode", async () => {
    mocks.loadRoscoeSettings.mockReturnValue(createSettings("roscoe-hosted"));
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService();
    const sessions = new Map([["lane-1", { id: "lane-1" }]]);

    render(<Harness sessions={sessions} dispatch={dispatch} service={service} />);
    await flushEffects();
    await vi.advanceTimersByTimeAsync(5000);
    await flushEffects();

    expect(service.notifications.readIncomingReplies).not.toHaveBeenCalled();
    expect(mocks.processInboundOperatorReplies).not.toHaveBeenCalled();
    expect(mocks.deliverQueuedOperatorMessages).not.toHaveBeenCalled();
  });

  it("ignores Twilio inbox failures because polling is best effort", async () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService({
      notifications: {
        getStatus: vi.fn(() => ({
          enabled: true,
          providerReady: true,
          phoneNumber: "+15551234567",
        })),
        hasPendingQuestions: vi.fn(() => false),
        readIncomingReplies: vi.fn(async () => {
          throw new Error("twilio down");
        }),
      },
    });
    const sessions = new Map([["lane-1", { id: "lane-1" }]]);

    render(<Harness sessions={sessions} dispatch={dispatch} service={service} />);
    await flushEffects();
    await vi.advanceTimersByTimeAsync(5000);
    await flushEffects();

    expect(mocks.processInboundOperatorReplies).not.toHaveBeenCalled();
  });

  it("skips polling when SMS is not ready and there are no pending questions", async () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = createService({
      notifications: {
        getStatus: vi.fn(() => ({
          enabled: false,
          providerReady: false,
          phoneNumber: "",
        })),
        hasPendingQuestions: vi.fn(() => false),
        readIncomingReplies: vi.fn(async () => []),
      },
    });

    render(<Harness sessions={new Map()} dispatch={dispatch} service={service} />);
    await flushEffects();
    await vi.advanceTimersByTimeAsync(5000);
    await flushEffects();

    expect(service.notifications.readIncomingReplies).not.toHaveBeenCalled();
    expect(mocks.processInboundOperatorReplies).not.toHaveBeenCalled();
  });
});
