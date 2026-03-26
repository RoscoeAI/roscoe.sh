import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadRoscoeSettings: vi.fn(() => ({
    notifications: {
      enabled: true,
      phoneNumber: "+15551234567",
      provider: "twilio" as const,
    },
  })),
}));

vi.mock("./config.js", () => ({
  loadRoscoeSettings: mocks.loadRoscoeSettings,
}));

import { NotificationService, cleanPhoneNumber, estimateProgress, extractUrls, readWebhookConfig } from "./notification-service.js";

function makeManagedSession() {
  return {
    id: "session-1",
    projectName: "nanobots",
    worktreeName: "soc2",
    tracker: {
      getRecentHistory: () => [
        { role: "assistant", content: "Preview deployed at https://preview.example.com and Playwright now passes.", timestamp: Date.now() },
      ],
    },
  } as any;
}

describe("NotificationService", () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_FROM_NUMBER: "+15557654321",
    };
    global.fetch = fetchMock as any;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    });
  });

  it("normalizes phone numbers", () => {
    expect(cleanPhoneNumber("(555) 123-4567")).toBe("5551234567");
    expect(cleanPhoneNumber("+1 (555) 123-4567")).toBe("+15551234567");
  });

  it("extracts evidence urls", () => {
    expect(extractUrls("Preview https://a.example.com and docs https://b.example.com/path.")).toEqual([
      "https://a.example.com",
      "https://b.example.com/path",
    ]);
  });

  it("estimates higher completion when tests and deploy evidence exist", () => {
    expect(
      estimateProgress(
        "Preview is deployed and Playwright coverage is green.",
        "assistant: Tests passed at https://preview.example.com",
      ).percent,
    ).toBeGreaterThanOrEqual(88);
  });

  it("reports provider readiness in status", () => {
    const service = new NotificationService();
    expect(service.getStatus()).toMatchObject({
      enabled: true,
      providerReady: true,
      provider: "twilio",
      inboundMode: "poll",
    });
  });

  it("prefers webhook mode in auto when a public URL is configured", () => {
    process.env.ROSCOE_SMS_TRANSPORT = "auto";
    process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL = "https://roscoe-sms-dev.k12.io/twilio/sms";

    expect(readWebhookConfig()).toMatchObject({
      requestedMode: "auto",
      effectiveMode: "webhook",
      publicUrl: "https://roscoe-sms-dev.k12.io/twilio/sms",
    });
  });

  it("falls back to polling when webhook mode is requested without a public URL", () => {
    process.env.ROSCOE_SMS_TRANSPORT = "webhook";
    delete process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL;

    expect(readWebhookConfig()).toMatchObject({
      requestedMode: "webhook",
      effectiveMode: "poll",
    });
  });

  it("sends a milestone text with summary and evidence", async () => {
    const service = new NotificationService();
    const sent = await service.maybeSendProgressUpdate(
      makeManagedSession(),
      "Playwright and Vitest are green and the preview is deployed.",
    );

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const [, options] = fetchMock.mock.calls[0];
    expect(String(options.body)).toContain("Roscoe%3A");
    expect(String(options.body)).toContain("preview.example.com");
  });

  it("deduplicates repeated progress updates", async () => {
    const service = new NotificationService();
    await service.maybeSendProgressUpdate(
      makeManagedSession(),
      "Playwright and Vitest are green and the preview is deployed.",
    );
    const second = await service.maybeSendProgressUpdate(
      makeManagedSession(),
      "Playwright and Vitest are green and the preview is deployed.",
    );

    expect(second).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports queued vs delivered state for a test SMS", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ sid: "SM123", status: "queued" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ sid: "SM123", status: "delivered" }),
      });

    const service = new NotificationService();
    const result = await service.sendTestMessage();

    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(true);
    expect(result.status).toBe("delivered");
    expect(result.detail).toContain("delivered");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/SM123.json",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("surfaces Twilio delivery failures for a test SMS", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ sid: "SM999", status: "queued" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          sid: "SM999",
          status: "undelivered",
          error_code: 30007,
          error_message: "Carrier violation",
        }),
      });

    const service = new NotificationService();
    const result = await service.sendTestMessage();

    expect(result.ok).toBe(false);
    expect(result.status).toBe("undelivered");
    expect(result.detail).toContain("Carrier violation");
    expect(result.detail).toContain("30007");
  });

  it("sends an SMS question with a reply token", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ sid: "SMQ1", status: "queued" }),
    });

    const service = new NotificationService();
    const result = await service.sendQuestion(makeManagedSession(), "Which scope should I prioritize?");

    expect(result.ok).toBe(true);
    expect(result.token).toMatch(/^\[R\d+\]$/);
    expect(result.renderedQuestion).toContain("Which scope should I prioritize?");
    expect(result.renderedQuestion).toContain(result.token);
  });

  it("polls inbound replies and matches them back to the pending session", async () => {
    const service = new NotificationService();
    const question = await service.sendQuestion(makeManagedSession(), "Which scope should I prioritize?");
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({
        messages: [
          {
            sid: "SMIN1",
            direction: "inbound",
            from: "+15551234567",
            to: "+15557654321",
            body: `${question.token} Focus on the operator UI first`,
            date_sent: new Date().toUTCString(),
          },
        ],
      }),
    });
    const replies = await service.readIncomingReplies();

    expect(replies).toHaveLength(1);
    expect(replies[0].matchedSessionId).toBe("session-1");
    expect(replies[0].answerText).toBe("Focus on the operator UI first");
    expect(replies[0].matchedQuestion).toBe("Which scope should I prioritize?");
  });
});
