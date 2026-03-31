import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadRoscoeSettings: vi.fn(() => ({
    notifications: {
      enabled: true,
      phoneNumber: "+15551234567",
      deliveryMode: "self-hosted" as const,
      consentAcknowledged: true,
      provider: "twilio" as const,
      hostedRelayClientId: "relay-test-client",
      hostedTestVerifiedPhone: null,
    },
    providers: {
      claude: { enabled: true, brief: false, ide: false, chrome: false },
      codex: { enabled: true, webSearch: false },
      gemini: { enabled: false },
    },
    behavior: {
      autoHealMetadata: true,
      parkAtMilestonesForReview: false,
      preventSleepWhileRunning: true,
    },
  }) as any),
  getHostedRelayClient: vi.fn(() => ({
    sendOperatorSms: vi.fn(),
  })),
}));

vi.mock("./config.js", () => ({
  loadRoscoeSettings: mocks.loadRoscoeSettings,
}));

vi.mock("./hosted-relay-client.js", () => ({
  getHostedRelayClient: mocks.getHostedRelayClient,
}));

import { NotificationService, cleanPhoneNumber, estimateProgress, extractUrls, readWebhookConfig } from "./notification-service.js";

const nativeFetch = globalThis.fetch.bind(globalThis);

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

  it("reports a hosted relay summary when roscoe-hosted delivery is selected", () => {
    mocks.loadRoscoeSettings.mockReturnValueOnce({
      notifications: {
        enabled: true,
        phoneNumber: "+15551234567",
        deliveryMode: "roscoe-hosted" as const,
        consentAcknowledged: true,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: "+15551234567",
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);

    const service = new NotificationService();
    expect(service.getStatus().summary).toContain("roscoe.sh");
  });

  it("requires a phone number before sending a test SMS", async () => {
    mocks.loadRoscoeSettings.mockReturnValueOnce({
      notifications: {
        enabled: true,
        phoneNumber: "",
        deliveryMode: "self-hosted" as const,
        consentAcknowledged: true,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: null,
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);

    const service = new NotificationService();
    const result = await service.sendTestMessage();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Add a phone number");
  });

  it("normalizes phone numbers", () => {
    expect(cleanPhoneNumber("(555) 123-4567")).toBe("5551234567");
    expect(cleanPhoneNumber("+1 (555) 123-4567")).toBe("+15551234567");
  });

  it("returns richer status summaries for hosted, missing-provider, and armed SMS states", () => {
    mocks.loadRoscoeSettings
      .mockReturnValueOnce({
        notifications: {
          enabled: false,
          phoneNumber: "+15551234567",
          deliveryMode: "roscoe-hosted" as const,
          consentAcknowledged: true,
          provider: "twilio" as const,
          hostedRelayClientId: "relay-test-client",
          hostedTestVerifiedPhone: "+15551234567",
        },
        providers: {
          claude: { enabled: true, brief: false, ide: false, chrome: false },
          codex: { enabled: true, webSearch: false },
          gemini: { enabled: false },
        },
        behavior: {
          autoHealMetadata: true,
          parkAtMilestonesForReview: false,
          preventSleepWhileRunning: true,
        },
      } as any)
      .mockReturnValueOnce({
        notifications: {
          enabled: false,
          phoneNumber: "+15551234567",
          deliveryMode: "self-hosted" as const,
          consentAcknowledged: true,
          provider: "twilio" as const,
          hostedRelayClientId: "relay-test-client",
          hostedTestVerifiedPhone: null,
        },
        providers: {
          claude: { enabled: true, brief: false, ide: false, chrome: false },
          codex: { enabled: true, webSearch: false },
          gemini: { enabled: false },
        },
        behavior: {
          autoHealMetadata: true,
          parkAtMilestonesForReview: false,
          preventSleepWhileRunning: true,
        },
      } as any)
      .mockReturnValueOnce({
        notifications: {
          enabled: true,
          phoneNumber: "+15551234567",
          deliveryMode: "self-hosted" as const,
          consentAcknowledged: true,
          provider: "twilio" as const,
          hostedRelayClientId: "relay-test-client",
          hostedTestVerifiedPhone: null,
        },
        providers: {
          claude: { enabled: true, brief: false, ide: false, chrome: false },
          codex: { enabled: true, webSearch: false },
          gemini: { enabled: false },
        },
        behavior: {
          autoHealMetadata: true,
          parkAtMilestonesForReview: false,
          preventSleepWhileRunning: true,
        },
      } as any);

    const hostedService = new NotificationService();
    expect(hostedService.getStatus().summary).toContain("roscoe.sh");

    delete process.env.TWILIO_ACCOUNT_SID;
    const selfHostedMissingProvider = new NotificationService();
    expect(selfHostedMissingProvider.getStatus().summary).toContain("Twilio env vars are missing.");

    process.env.TWILIO_ACCOUNT_SID = "AC123";
    const armedService = new NotificationService();
    expect(armedService.getStatus().summary).toContain("milestones");
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

  it("covers the remaining progress-estimate tiers", () => {
    expect(estimateProgress("Implemented the flow", "Vitest proof now passes.").percent).toBe(72);
    expect(estimateProgress("Implemented the flow", "No proof yet.").percent).toBe(56);
    expect(estimateProgress("Exploring the repo", "Read the repo and mapped the stack.").percent).toBe(18);
    expect(estimateProgress("Blocked on auth", "Cannot proceed until the error clears.").percent).toBe(34);
    expect(estimateProgress("Active movement", "Need more proof.").percent).toBe(45);
  });

  it("reports provider readiness in status", () => {
    const service = new NotificationService();
    expect(service.getStatus()).toMatchObject({
      enabled: true,
      providerReady: true,
      provider: "twilio",
      consentReady: true,
      inboundMode: "poll",
    });
  });

  it("reports webhook listener startup errors in inbound transport details", async () => {
    const service = new NotificationService();
    process.env.ROSCOE_SMS_TRANSPORT = "webhook";
    process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL = "https://roscoe.sh/twilio/sms";
    delete process.env.TWILIO_ACCOUNT_SID;

    await service.ensureInboundTransportReady();

    expect(service.getInboundTransport().detail).toContain("Twilio env vars are missing");
  });

  it("does not report SMS as enabled until consent is configured", () => {
    mocks.loadRoscoeSettings.mockReturnValue({
      notifications: {
        enabled: true,
        phoneNumber: "+15551234567",
        deliveryMode: "self-hosted" as const,
        consentAcknowledged: false,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: null,
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    });

    const service = new NotificationService();
    expect(service.getStatus()).toMatchObject({
      enabled: false,
      consentReady: false,
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

  it("handles malformed payload helpers and provider status fallbacks", async () => {
    const service = new NotificationService() as any;

    expect(service.buildSendResult({ status: "accepted", sid: "SM1" }).detail).toContain("Delivery is not confirmed yet");
    expect(service.buildSendResult({ status: "canceled", error_message: "carrier blocked", error_code: 30007 }).detail).toContain("carrier blocked");
    expect(service.buildSendResult({ status: "mystery", sid: "SM2" }).detail).toContain("no delivery status is available yet");

    expect(await service["readRequestBody"]((async function* () {
      yield Buffer.from("Body=hello");
    })() as any)).toBe("Body=hello");
  });

  it("rejects malformed webhook ports and normalizes webhook root urls", () => {
    process.env.ROSCOE_SMS_TRANSPORT = "auto";
    process.env.ROSCOE_SMS_WEBHOOK_PORT = "NaN";
    process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL = "https://roscoe.sh/";
    delete process.env.ROSCOE_SMS_WEBHOOK_PATH;

    expect(readWebhookConfig()).toMatchObject({
      port: 8787,
      path: "/twilio/sms",
      publicUrl: "https://roscoe.sh/twilio/sms",
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

  it("normalizes webhook config edge cases", () => {
    process.env.ROSCOE_SMS_TRANSPORT = "poll";
    process.env.ROSCOE_SMS_WEBHOOK_PATH = "twilio/replies";
    process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL = "https://roscoe.sh";
    process.env.ROSCOE_SMS_WEBHOOK_VALIDATE = "maybe";

    expect(readWebhookConfig()).toMatchObject({
      requestedMode: "poll",
      effectiveMode: "poll",
      path: "/twilio/replies",
      publicUrl: "https://roscoe.sh/twilio/replies",
      validateSignature: true,
    });

    process.env.ROSCOE_SMS_TRANSPORT = "auto";
    process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL = "not a url";
    expect(readWebhookConfig()).toMatchObject({
      effectiveMode: "poll",
      publicUrl: null,
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

  it("suppresses duplicate progress updates and cooldown-near duplicates", async () => {
    const service = new NotificationService();
    const session = makeManagedSession();

    const first = await service.maybeSendProgressUpdate(
      session,
      "Playwright and Vitest are green and the preview is deployed.",
    );
    const second = await service.maybeSendProgressUpdate(
      session,
      "Playwright and Vitest are green and the preview is deployed.",
    );
    const third = await service.maybeSendProgressUpdate(
      session,
      "Playwright and Vitest are still green with the same preview url.",
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(false);
  });

  it("suppresses duplicate intervention requests during cooldown", async () => {
    const service = new NotificationService();
    const session = makeManagedSession();

    const first = await service.maybeSendInterventionRequest(session, {
      kind: "paused",
      detail: "Need API approval",
    });
    const second = await service.maybeSendInterventionRequest(session, {
      kind: "paused",
      detail: "Need API approval",
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("rejects empty operator messages and unconsented sends", async () => {
    let service = new NotificationService();
    let result = await service.sendOperatorMessage("   ");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("could not build a message");

    mocks.loadRoscoeSettings.mockReturnValueOnce({
      notifications: {
        enabled: true,
        phoneNumber: "+15551234567",
        deliveryMode: "self-hosted" as const,
        consentAcknowledged: false,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: null,
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);

    service = new NotificationService();
    result = await service.sendOperatorMessage("Hello");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Accept the SMS consent notice");
  });

  it("uses hosted relay sends in roscoe-hosted mode and validates linked phone", async () => {
    const sendOperatorSms = vi.fn()
      .mockResolvedValueOnce({ ok: true, delivered: false, status: "submitted", sid: "SM-hosted" })
      .mockResolvedValueOnce({ ok: true, delivered: true, status: "delivered", sid: "SM-hosted-2", errorCode: 30003, errorMessage: "ignored" });
    mocks.getHostedRelayClient.mockReturnValue({ sendOperatorSms });

    mocks.loadRoscoeSettings
      .mockReturnValueOnce({
        notifications: {
          enabled: true,
          phoneNumber: "+15551234567",
          deliveryMode: "roscoe-hosted" as const,
          consentAcknowledged: true,
          provider: "twilio" as const,
          hostedRelayClientId: "relay-test-client",
          hostedTestVerifiedPhone: "+15551234567",
        },
        providers: {
          claude: { enabled: true, brief: false, ide: false, chrome: false },
          codex: { enabled: true, webSearch: false },
          gemini: { enabled: false },
        },
        behavior: {
          autoHealMetadata: true,
          parkAtMilestonesForReview: false,
          preventSleepWhileRunning: true,
        },
      } as any)
      .mockReturnValueOnce({
        notifications: {
          enabled: true,
          phoneNumber: "+15557654321",
          deliveryMode: "roscoe-hosted" as const,
          consentAcknowledged: true,
          provider: "twilio" as const,
          hostedRelayClientId: "relay-test-client",
          hostedTestVerifiedPhone: "+15557654321",
        },
        providers: {
          claude: { enabled: true, brief: false, ide: false, chrome: false },
          codex: { enabled: true, webSearch: false },
          gemini: { enabled: false },
        },
        behavior: {
          autoHealMetadata: true,
          parkAtMilestonesForReview: false,
          preventSleepWhileRunning: true,
        },
      } as any)
      .mockReturnValueOnce({
        notifications: {
          enabled: true,
          phoneNumber: "+15551234567",
          deliveryMode: "roscoe-hosted" as const,
          consentAcknowledged: true,
          provider: "twilio" as const,
          hostedRelayClientId: "relay-test-client",
          hostedTestVerifiedPhone: "+15551234567",
        },
        providers: {
          claude: { enabled: true, brief: false, ide: false, chrome: false },
          codex: { enabled: true, webSearch: false },
          gemini: { enabled: false },
        },
        behavior: {
          autoHealMetadata: true,
          parkAtMilestonesForReview: false,
          preventSleepWhileRunning: true,
        },
      } as any);

    let service = new NotificationService();
    let result = await (service as any).sendSms("+15551234567", "Hello", { pollForFinalStatus: false });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("Hosted relay SMS submitted");

    service = new NotificationService();
    result = await (service as any).sendSms("+15551234567", "Hello", { pollForFinalStatus: false });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("different phone number");

    service = new NotificationService();
    result = await (service as any).sendSms("+15551234567", "Hello", { pollForFinalStatus: false });
    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(true);
    expect(result.status).toBe("delivered");
    expect(result.errorCode).toBe(30003);
  });

  it("reads inbound webhook replies in webhook mode and ignores hosted mode", async () => {
    process.env.ROSCOE_SMS_TRANSPORT = "webhook";
    process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL = "https://roscoe.sh/twilio/sms";
    process.env.ROSCOE_SMS_WEBHOOK_VALIDATE = "false";

    const service = new NotificationService() as any;
    service.webhookServer = {} as any;
    service.webhookReplies = [
      {
        sid: "SM-inbound",
        body: "status",
        answerText: "status",
        from: "+15551234567",
        to: "+15557654321",
        receivedAt: Date.now(),
      },
    ];

    let replies = await service.readIncomingReplies();
    expect(replies).toHaveLength(1);
    expect(service.webhookReplies).toEqual([]);

    mocks.loadRoscoeSettings.mockReturnValueOnce({
      notifications: {
        enabled: true,
        phoneNumber: "+15551234567",
        deliveryMode: "roscoe-hosted" as const,
        consentAcknowledged: true,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: "+15551234567",
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);

    replies = await new NotificationService().readIncomingReplies();
    expect(replies).toEqual([]);
  });

  it("maps inbound replies, supports single pending-question fallback, and filters invalid senders", () => {
    const service = new NotificationService() as any;
    service.pendingQuestions.set("[R9]", {
      token: "[R9]",
      sessionId: "session-1",
      scope: "nanobots",
      question: "Ship it?",
      askedAt: Date.now(),
    });

    let reply = service.mapInboundReply({
      sid: "SM-reply",
      body: "approve",
      from: "+15551234567",
      to: "+15557654321",
      date_created: new Date().toISOString(),
    });
    expect(reply?.matchedSessionId).toBe("session-1");
    expect(reply?.token).toBe("[R9]");

    reply = service.mapInboundReply({
      sid: "",
      body: "approve",
      from: "+15551234567",
    });
    expect(reply).toBeNull();

    reply = service.mapInboundReply({
      sid: "SM-wrong",
      body: "approve",
      from: "+19999999999",
      to: "+15557654321",
    });
    expect(reply).toBeNull();

    service.pendingQuestions.clear();
    reply = service.mapInboundReply({
      sid: "SM-token",
      body: "[r9] ship it",
      from: "+15551234567",
      to: "+15557654321",
      date_created: "bad date",
    });
    expect(reply?.answerText).toBe("ship it");
    expect(reply?.receivedAt).toBeGreaterThan(0);
  });

  it("sends SMS questions, records pending prompts, and consumes replies", async () => {
    const service = new NotificationService() as any;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ sid: "SMQ1", status: "queued" }),
    });

    const result = await service.sendQuestion(
      { ...makeManagedSession(), worktreeName: "feature-x" },
      "Ship it now?",
    );

    expect(result.ok).toBe(true);
    expect(result.token).toMatch(/^\[R\d+\]$/);
    expect(result.renderedQuestion).toContain("nanobots/feature-x");
    expect(service.pendingQuestions.size).toBe(1);

    const reply = service.mapInboundReply({
      sid: "SM-reply-1",
      body: `${result.token} yes`,
      from: "+15551234567",
      to: "+15557654321",
      date_created: new Date().toISOString(),
    });
    expect(reply?.matchedSessionId).toBe("session-1");
    expect(reply?.token).toBe(result.token);
    service.markReplyConsumed(reply);
    expect(service.pendingQuestions.size).toBe(0);
  });

  it("rejects empty, missing-phone, and missing-consent SMS questions", async () => {
    let service = new NotificationService();
    let result = await service.sendQuestion(makeManagedSession(), "   ");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("clear question");

    mocks.loadRoscoeSettings.mockReturnValueOnce({
      notifications: {
        enabled: true,
        phoneNumber: "",
        deliveryMode: "self-hosted" as const,
        consentAcknowledged: true,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: null,
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);
    service = new NotificationService();
    result = await service.sendQuestion(makeManagedSession(), "Ship it?");
    expect(result.detail).toContain("Add a phone number");

    mocks.loadRoscoeSettings.mockReturnValueOnce({
      notifications: {
        enabled: true,
        phoneNumber: "+15551234567",
        deliveryMode: "self-hosted" as const,
        consentAcknowledged: false,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: null,
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);
    service = new NotificationService();
    result = await service.sendQuestion(makeManagedSession(), "Ship it?");
    expect(result.detail).toContain("Accept the SMS consent notice");
  });

  it("parses webhook requests, validates signatures, and rejects invalid routes", async () => {
    process.env.ROSCOE_SMS_TRANSPORT = "webhook";
    process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL = "https://roscoe.sh/twilio/sms";
    process.env.ROSCOE_SMS_WEBHOOK_VALIDATE = "true";
    const service = new NotificationService() as any;

    const writeHead = vi.fn();
    const end = vi.fn();
    await service.handleWebhookRequest(
      { method: "GET", url: "/twilio/sms" } as any,
      { writeHead, end } as any,
      { accountSid: "AC123", authToken: "secret", fromNumber: "+15557654321", messagingServiceSid: null },
      readWebhookConfig(),
    );
    expect(writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/plain" });

    writeHead.mockClear();
    end.mockClear();
    await service.handleWebhookRequest(
      { method: "POST", url: "/wrong-path" } as any,
      { writeHead, end } as any,
      { accountSid: "AC123", authToken: "secret", fromNumber: "+15557654321", messagingServiceSid: null },
      readWebhookConfig(),
    );
    expect(writeHead).toHaveBeenCalledWith(404, { "Content-Type": "text/plain" });

    writeHead.mockClear();
    end.mockClear();
    const body = "MessageSid=SM123&Body=status&From=%2B15551234567&To=%2B15557654321";
    const req = {
      method: "POST",
      url: "/twilio/sms",
      headers: { "x-twilio-signature": "bad-signature" },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body);
      },
    } as any;
    await service.handleWebhookRequest(
      req,
      { writeHead, end } as any,
      { accountSid: "AC123", authToken: "secret", fromNumber: "+15557654321", messagingServiceSid: null },
      readWebhookConfig(),
    );
    expect(writeHead).toHaveBeenCalledWith(403, { "Content-Type": "text/plain" });

    process.env.ROSCOE_SMS_WEBHOOK_VALIDATE = "false";
    writeHead.mockClear();
    end.mockClear();
    await service.handleWebhookRequest(
      req,
      { writeHead, end } as any,
      { accountSid: "AC123", authToken: "secret", fromNumber: "+15557654321", messagingServiceSid: null },
      readWebhookConfig(),
    );
    expect(writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/xml" });
    expect(service.webhookReplies).toHaveLength(1);
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

  it("surfaces an accepted but not yet delivered test SMS honestly", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ sid: "SM124", status: "queued" }),
      })
      .mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ sid: "SM124", status: "sent" }),
      });

    const service = new NotificationService();
    const result = await service.sendTestMessage();

    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(false);
    expect(result.status).toBe("sent");
    expect(result.detail).toContain("Delivery may still be pending");
  });

  it("covers remaining send-result status copy", () => {
    const service = new NotificationService() as any;

    expect(service.buildSendResult({ sid: "SMA", status: "read" }).detail).toContain("status read");
    expect(service.buildSendResult({ sid: "SMB", status: "accepted" }).detail).toContain("Delivery is not confirmed yet");
    expect(service.buildSendResult({ sid: "SMC", status: "failed" }).detail).toContain("marked the test SMS as failed");
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

  it("blocks sending a test SMS when consent has not been acknowledged", async () => {
    mocks.loadRoscoeSettings.mockReturnValueOnce({
      notifications: {
        enabled: true,
        phoneNumber: "+15551234567",
        deliveryMode: "self-hosted" as const,
        consentAcknowledged: false,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: null,
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    });

    const service = new NotificationService();
    const result = await service.sendTestMessage();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("acknowledge");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns polling inbox errors instead of swallowing them", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "upstream broke",
    });

    const service = new NotificationService();
    await expect(service.readIncomingReplies()).rejects.toThrow("Twilio inbox check failed: 500 upstream broke");
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

  it("fails cleanly when Roscoe cannot build an SMS question", async () => {
    const service = new NotificationService();
    const result = await service.sendQuestion(makeManagedSession(), "   ");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("could not find a clear question");
  });

  it("sends a direct operator wire to the configured phone", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ sid: "SMWIRE1", status: "queued" }),
    });

    const service = new NotificationService();
    const result = await service.sendOperatorMessage("Roscoe needs your input on appsicle.");

    expect(result.ok).toBe(true);
    const [, options] = fetchMock.mock.calls[0];
    expect(String(options.body)).toContain("Roscoe+needs+your+input+on+appsicle.");
  });

  it("refuses to send an empty operator message", async () => {
    const service = new NotificationService();
    const result = await service.sendOperatorMessage("   ");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("could not build a message");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks operator messages without a phone number or consent", async () => {
    mocks.loadRoscoeSettings.mockReturnValueOnce({
      notifications: {
        enabled: true,
        phoneNumber: "",
        deliveryMode: "self-hosted" as const,
        consentAcknowledged: true,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: null,
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);

    const noPhoneService = new NotificationService();
    const noPhone = await noPhoneService.sendOperatorMessage("hello");
    expect(noPhone.ok).toBe(false);
    expect(noPhone.detail).toContain("Add a phone number");

    mocks.loadRoscoeSettings.mockReturnValueOnce({
      notifications: {
        enabled: true,
        phoneNumber: "+15551234567",
        deliveryMode: "self-hosted" as const,
        consentAcknowledged: false,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: null,
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);

    const noConsentService = new NotificationService();
    const noConsent = await noConsentService.sendOperatorMessage("hello");
    expect(noConsent.ok).toBe(false);
    expect(noConsent.detail).toContain("consent");
  });

  it("truncates oversized operator messages before sending", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ sid: "SMWIRE2", status: "queued" }),
    });

    const service = new NotificationService();
    await service.sendOperatorMessage("A".repeat(700));

    const [, options] = fetchMock.mock.calls[0];
    const body = String(options.body);
    expect(body.length).toBeLessThan(1000);
    expect(decodeURIComponent(body).replace(/\+/g, " ")).toContain("...");
  });

  it("uses the hosted relay socket when delivery mode is roscoe-hosted", async () => {
    const hostedSend = vi.fn().mockResolvedValue({
      ok: true,
      sid: "SMHOSTED1",
      status: "queued",
      delivered: false,
    });
    mocks.getHostedRelayClient.mockReturnValue({
      sendOperatorSms: hostedSend,
    });
    mocks.loadRoscoeSettings.mockReturnValue({
      notifications: {
        enabled: true,
        phoneNumber: "+15551234567",
        deliveryMode: "roscoe-hosted" as const,
        consentAcknowledged: true,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: "+15551234567",
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);

    const service = new NotificationService();
    const result = await service.sendOperatorMessage("Roscoe hosted relay test.");

    expect(result.ok).toBe(true);
    expect(result.status).toBe("queued");
    expect(result.detail).toContain("Hosted relay SMS queued");
    expect(hostedSend).toHaveBeenCalledWith("Roscoe hosted relay test.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces hosted relay failures and phone mismatches", async () => {
    mocks.loadRoscoeSettings.mockReturnValue({
      notifications: {
        enabled: true,
        phoneNumber: "+15551234567",
        deliveryMode: "roscoe-hosted" as const,
        consentAcknowledged: true,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: "+15551234567",
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);

    mocks.getHostedRelayClient.mockReturnValue({
      sendOperatorSms: vi.fn().mockResolvedValue({
        ok: false,
        status: "failed",
        error: "relay offline",
      }),
    });

    const service = new NotificationService();
    const hostedFailure = await service.sendOperatorMessage("Roscoe hosted relay failure test.");
    expect(hostedFailure.ok).toBe(false);
    expect(hostedFailure.detail).toContain("relay offline");

    const mismatch = await (service as any).sendSms("+15550000000", "wrong target");
    expect(mismatch.ok).toBe(false);
    expect(mismatch.detail).toContain("different phone number");
  });

  it("deduplicates repeated intervention requests for the same lane", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ sid: "SMINT1", status: "queued" }),
    });

    const service = new NotificationService();
    const first = await service.maybeSendInterventionRequest(makeManagedSession(), {
      kind: "needs-review",
      detail: "Roscoe drafted a reply that still needs your review.",
    });
    const second = await service.maybeSendInterventionRequest(makeManagedSession(), {
      kind: "needs-review",
      detail: "Roscoe drafted a reply that still needs your review.",
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includes actionable SMS commands for needs-review interventions", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ sid: "SMINT2", status: "queued" }),
    });

    const service = new NotificationService();
    await service.maybeSendInterventionRequest(makeManagedSession(), {
      kind: "needs-review",
      detail: "Roscoe drafted the next Guild message and wants review before it is sent.",
    });

    const [, options] = fetchMock.mock.calls[0];
    const body = decodeURIComponent(String(options.body)).replace(/\+/g, " ");
    expect(body).toContain('Reply "approve" to send it');
    expect(body).toContain('"hold"');
  });

  it("includes a resume instruction for paused interventions", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ sid: "SMPAUSE1", status: "queued" }),
    });

    const service = new NotificationService();
    await service.maybeSendInterventionRequest(makeManagedSession(), {
      kind: "paused",
      detail: "Waiting on the operator to unblock preview infrastructure.",
    });

    const [, options] = fetchMock.mock.calls[0];
    const body = decodeURIComponent(String(options.body)).replace(/\+/g, " ");
    expect(body).toContain('Reply "resume"');
  });

  it("handles manual-input and error interventions and ignores blank detail", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ sid: "SMINT3", status: "queued" }),
    });

    const service = new NotificationService();
    const manual = await service.maybeSendInterventionRequest(makeManagedSession(), {
      kind: "manual-input",
      detail: "Need direction on the deploy target.",
    });
    const error = await service.maybeSendInterventionRequest(makeManagedSession(), {
      kind: "error",
      detail: "Build crashed during preview provisioning.",
    });
    const blank = await service.maybeSendInterventionRequest(makeManagedSession(), {
      kind: "error",
      detail: "   ",
    });

    expect(manual).toBe(true);
    expect(error).toBe(true);
    expect(blank).toBe(false);
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

  it("surfaces untokened inbound operator messages even without a pending question", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({
        messages: [
          {
            sid: "SMIN2",
            direction: "inbound",
            from: "+15551234567",
            to: "+15557654321",
            body: "status",
            date_sent: new Date().toUTCString(),
          },
        ],
      }),
    });

    const service = new NotificationService();
    const replies = await service.readIncomingReplies();

    expect(replies).toHaveLength(1);
    expect(replies[0].answerText).toBe("status");
    expect(replies[0].matchedSessionId).toBeUndefined();
  });

  it("matches an untokened inbound reply to the sole pending question", async () => {
    const service = new NotificationService();
    await service.sendQuestion(makeManagedSession(), "What should I fix next?");
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({
        messages: [
          {
            sid: "SMIN3",
            direction: "inbound",
            from: "+15551234567",
            to: "+15557654321",
            body: "Focus on deploy next",
            date_sent: new Date().toUTCString(),
          },
        ],
      }),
    });

    const replies = await service.readIncomingReplies();
    expect(replies[0].matchedSessionId).toBe("session-1");
    expect(replies[0].matchedQuestion).toBe("What should I fix next?");
  });

  it("ignores hosted-mode inbox reads because roscoe.sh owns inbound delivery", async () => {
    mocks.loadRoscoeSettings.mockReturnValueOnce({
      notifications: {
        enabled: true,
        phoneNumber: "+15551234567",
        deliveryMode: "roscoe-hosted" as const,
        consentAcknowledged: true,
        provider: "twilio" as const,
        hostedRelayClientId: "relay-test-client",
        hostedTestVerifiedPhone: "+15551234567",
      },
      providers: {
        claude: { enabled: true, brief: false, ide: false, chrome: false },
        codex: { enabled: true, webSearch: false },
        gemini: { enabled: false },
      },
      behavior: {
        autoHealMetadata: true,
        parkAtMilestonesForReview: false,
        preventSleepWhileRunning: true,
      },
    } as any);

    const service = new NotificationService();
    await expect(service.readIncomingReplies()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts inbound webhook replies and exposes them through the inbox drain", async () => {
    process.env.ROSCOE_SMS_TRANSPORT = "webhook";
    process.env.ROSCOE_SMS_WEBHOOK_PORT = "8788";
    process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL = "https://roscoe.sh/twilio/sms";
    process.env.ROSCOE_SMS_WEBHOOK_VALIDATE = "false";

    const service = new NotificationService();
    await service.ensureInboundTransportReady();

    const transport = service.getInboundTransport();
    expect(transport.mode).toBe("webhook");
    expect(transport.listeningPort).toBeTypeOf("number");

    const health = await nativeFetch(`http://127.0.0.1:${transport.listeningPort}/twilio/sms`);
    expect(await health.text()).toContain("roscoe sms webhook ok");

    const response = await nativeFetch(`http://127.0.0.1:${transport.listeningPort}/twilio/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        MessageSid: "SMWEBHOOK1",
        Body: "status",
        From: "+15551234567",
        To: "+15557654321",
      }),
    });

    expect(await response.text()).toContain("<Response>");

    const replies = await service.readIncomingReplies();
    expect(replies).toHaveLength(1);
    expect(replies[0].sid).toBe("SMWEBHOOK1");
    expect(replies[0].answerText).toBe("status");

    await service.shutdown();
  });

  it("rejects invalid webhook signatures and non-matching paths", async () => {
    process.env.ROSCOE_SMS_TRANSPORT = "webhook";
    process.env.ROSCOE_SMS_WEBHOOK_PORT = "8789";
    process.env.ROSCOE_SMS_WEBHOOK_PATH = "/twilio/signed";
    process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL = "https://roscoe.sh/twilio/signed";
    process.env.ROSCOE_SMS_WEBHOOK_VALIDATE = "true";

    const service = new NotificationService();
    await service.ensureInboundTransportReady();
    const transport = service.getInboundTransport();

    const notFound = await nativeFetch(`http://127.0.0.1:${transport.listeningPort}/wrong-path`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "Body=status",
    });
    expect(notFound.status).toBe(404);

    const invalid = await nativeFetch(`http://127.0.0.1:${transport.listeningPort}/twilio/signed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        MessageSid: "SMWEBHOOK2",
        Body: "status",
        From: "+15551234567",
        To: "+15557654321",
      }),
    });
    expect(invalid.status).toBe(403);

    await service.shutdown();
  });

  it("surfaces webhook startup errors and skips webhook mode when Twilio env is missing", async () => {
    process.env.ROSCOE_SMS_TRANSPORT = "webhook";
    process.env.ROSCOE_SMS_WEBHOOK_PORT = "8790";
    process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL = "https://roscoe.sh/twilio/sms";
    delete process.env.TWILIO_FROM_NUMBER;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;

    const missingTwilio = new NotificationService();
    await missingTwilio.ensureInboundTransportReady();
    expect(missingTwilio.getInboundTransport().detail).toContain("Twilio env vars are missing");

    process.env.TWILIO_FROM_NUMBER = "+15557654321";
    const firstService = new NotificationService();
    await firstService.ensureInboundTransportReady();

    const errorService = new NotificationService();
    await errorService.ensureInboundTransportReady();
    expect(errorService.getInboundTransport().detail).toContain("Listener error");
    await firstService.shutdown();
    await errorService.shutdown();
  });

  it("throws useful Twilio send and status-check errors", async () => {
    const service = new NotificationService();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error_message: "Bad send", error_code: 21608 }),
    });
    await expect((service as any).sendSms("+15551234567", "hello")).rejects.toThrow("Twilio SMS failed: 400 Bad send (21608)");

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error_message: "Status broke", error_code: 30032 }),
    });
    await expect((service as any).fetchMessage({ accountSid: "AC123", authToken: "secret", fromNumber: "+15557654321" }, "SMFAIL")).rejects.toThrow(
      "Twilio status check failed: 500 Status broke (30032)",
    );
  });

  it("throws when self-hosted Twilio credentials are missing", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    const service = new NotificationService();

    await expect((service as any).sendSms("+15551234567", "hello")).rejects.toThrow("Twilio SMS is not configured.");
  });

  it("sends through a messaging service SID when no from number is configured", async () => {
    delete process.env.TWILIO_FROM_NUMBER;
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG123";
    const service = new NotificationService();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ sid: "SM123", status: "queued" }),
    });

    await (service as any).sendSms("+15551234567", "hello", { pollForFinalStatus: false });

    const [, request] = fetchMock.mock.calls[0];
    const body = request?.body as URLSearchParams;
    expect(body.get("MessagingServiceSid")).toBe("MG123");
    expect(body.get("From")).toBeNull();
  });

  it("returns the latest non-terminal status after exhausting hosted sms polling attempts", async () => {
    const service = new NotificationService();

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ sid: "SM123", status: "queued" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ sid: "SM123", status: "sending" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ sid: "SM123", status: "queued" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ sid: "SM123", status: "queued" }),
      });

    const result = await (service as any).pollForFinalStatus(
      { accountSid: "AC123", authToken: "secret", fromNumber: "+15557654321" },
      "SM123",
    );

    expect(result).toMatchObject({ sid: "SM123", status: "queued" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
