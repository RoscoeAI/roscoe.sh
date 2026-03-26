import { createHmac, timingSafeEqual } from "crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { loadRoscoeSettings } from "./config.js";
import { ManagedSession } from "./types.js";

const DEFAULT_PROGRESS_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_WEBHOOK_PORT = 8787;
const DEFAULT_WEBHOOK_PATH = "/twilio/sms";
const TEST_STATUS_POLL_ATTEMPTS = process.env.NODE_ENV === "test" ? 3 : 4;
const TEST_STATUS_POLL_INTERVAL_MS = process.env.NODE_ENV === "test" ? 1 : 1500;
const WEBHOOK_TWIML_RESPONSE = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>";

export interface NotificationStatus {
  enabled: boolean;
  phoneNumber: string;
  provider: "twilio";
  providerReady: boolean;
  summary: string;
  inboundMode: "poll" | "webhook";
  inboundDetail: string;
}

interface ProgressEstimate {
  percent: number;
  rationale: string;
}

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber?: string;
  messagingServiceSid?: string;
}

interface SentProgressState {
  at: number;
  signature: string;
  percent: number;
  urls: string[];
}

type TwilioMessageStatus =
  | "accepted"
  | "scheduled"
  | "canceled"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "delivered"
  | "undelivered"
  | "receiving"
  | "received"
  | "read";

type SmsInboundTransportPreference = "auto" | "poll" | "webhook";

interface SmsWebhookConfig {
  requestedMode: SmsInboundTransportPreference;
  effectiveMode: "poll" | "webhook";
  detail: string;
  port: number;
  path: string;
  publicUrl: string | null;
  validateSignature: boolean;
}

interface TwilioMessageRecord {
  sid?: string;
  status?: TwilioMessageStatus;
  error_code?: number | null;
  error_message?: string | null;
  direction?: string;
  body?: string;
  from?: string;
  to?: string;
  date_created?: string;
  date_sent?: string;
}

export interface SmsSendResult {
  ok: boolean;
  accepted: boolean;
  delivered: boolean;
  status: TwilioMessageStatus | "unknown";
  sid?: string;
  errorCode?: number | null;
  errorMessage?: string | null;
  detail: string;
}

export interface SmsQuestionResult extends SmsSendResult {
  token: string;
  prompt: string;
  renderedQuestion: string;
}

export interface IncomingSmsReply {
  sid: string;
  body: string;
  answerText: string;
  from: string;
  to?: string;
  receivedAt: number;
  token?: string;
  matchedSessionId?: string;
  matchedQuestion?: string;
}

interface PendingSmsQuestion {
  token: string;
  sessionId: string;
  scope: string;
  question: string;
  askedAt: number;
}

interface TwilioMessageListPayload {
  messages?: TwilioMessageRecord[];
}

let smsQuestionCounter = 0;

function cleanPhoneNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/[^\d]/g, "")}`;
  }
  return trimmed.replace(/[^\d]/g, "");
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)>\]]+/g) ?? [];
  return Array.from(new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, "")))).slice(0, 2);
}

function estimateProgress(summary: string, transcript: string): ProgressEstimate {
  const corpus = `${summary} ${transcript}`.toLowerCase();

  if (/(complete|completed|done|all green|passed|verified|shipped)/.test(corpus) && /(test|coverage|playwright|vitest|jest|cypress)/.test(corpus)) {
    return { percent: 92, rationale: "Tests and implementation evidence are landing together." };
  }
  if (/(deploy|deployed|preview|live|vercel\.app|netlify\.app|onrender\.com)/.test(corpus) && /(test|coverage|verified)/.test(corpus)) {
    return { percent: 88, rationale: "A live artifact exists and the proof path is being verified." };
  }
  if (/(test|coverage|playwright|vitest|jest|cypress)/.test(corpus) && /(added|wrote|implemented|fixed|wired|proves|proof)/.test(corpus)) {
    return { percent: 72, rationale: "Roscoe has a proving path and is making it pass." };
  }
  if (/(implemented|built|wired|added|scaffolded|integrated)/.test(corpus)) {
    return { percent: 56, rationale: "Implementation is underway, but final proof is still forming." };
  }
  if (/(explor|inspect|mapped|analyz|investigat|read the repo)/.test(corpus)) {
    return { percent: 18, rationale: "The worker is still grounding itself in the codebase." };
  }
  if (/(blocked|failing|error|stuck|cannot|can't)/.test(corpus)) {
    return { percent: 34, rationale: "Work is underway, but Roscoe sees a blocker in the proof path." };
  }

  return { percent: 45, rationale: "Roscoe sees active movement but not enough proof to call the next phase." };
}

function buildNotificationBody(
  session: ManagedSession,
  summary: string,
  estimate: ProgressEstimate,
  urls: string[],
): string {
  const scope = session.worktreeName === "main"
    ? session.projectName
    : `${session.projectName}/${session.worktreeName}`;
  const pieces = [
    `Roscoe: ${scope} is ~${estimate.percent}% complete.`,
    summary.replace(/\s+/g, " ").trim(),
  ];

  if (urls.length > 0) {
    pieces.push(`Evidence: ${urls.join(" ")}`);
  }

  const body = pieces.join(" ");
  return body.length > 620 ? `${body.slice(0, 617).trimEnd()}...` : body;
}

function readTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

  if (!accountSid || !authToken) return null;
  if (!fromNumber && !messagingServiceSid) return null;

  return {
    accountSid,
    authToken,
    ...(fromNumber ? { fromNumber } : {}),
    ...(messagingServiceSid ? { messagingServiceSid } : {}),
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  return fallback;
}

function normalizePath(pathValue: string | undefined): string {
  const raw = pathValue?.trim() || DEFAULT_WEBHOOK_PATH;
  if (!raw.startsWith("/")) return `/${raw}`;
  return raw;
}

function normalizePublicWebhookUrl(publicValue: string | undefined, path: string): string | null {
  const raw = publicValue?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!parsed.pathname || parsed.pathname === "/") {
      parsed.pathname = path;
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function readWebhookConfig(): SmsWebhookConfig {
  const requestedModeRaw = process.env.ROSCOE_SMS_TRANSPORT?.trim().toLowerCase();
  const requestedMode: SmsInboundTransportPreference =
    requestedModeRaw === "poll" || requestedModeRaw === "webhook" || requestedModeRaw === "auto"
      ? requestedModeRaw
      : "auto";
  const portRaw = process.env.ROSCOE_SMS_WEBHOOK_PORT?.trim();
  const parsedPort = portRaw ? Number(portRaw) : DEFAULT_WEBHOOK_PORT;
  const port = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : DEFAULT_WEBHOOK_PORT;
  const path = normalizePath(process.env.ROSCOE_SMS_WEBHOOK_PATH);
  const publicUrl = normalizePublicWebhookUrl(process.env.ROSCOE_SMS_WEBHOOK_PUBLIC_URL, path);
  const validateSignature = parseBoolean(process.env.ROSCOE_SMS_WEBHOOK_VALIDATE, true);
  const webhookConfigured = port > 0 && publicUrl !== null;

  if (requestedMode === "poll") {
    return {
      requestedMode,
      effectiveMode: "poll",
      detail: "Polling Twilio for inbound replies.",
      port,
      path,
      publicUrl,
      validateSignature,
    };
  }

  if (webhookConfigured) {
    return {
      requestedMode,
      effectiveMode: "webhook",
      detail: `Webhook ingress active at ${publicUrl}.`,
      port,
      path,
      publicUrl,
      validateSignature,
    };
  }

  return {
    requestedMode,
    effectiveMode: "poll",
    detail: requestedMode === "webhook"
      ? "Webhook requested but ROSCOE_SMS_WEBHOOK_PUBLIC_URL is missing; falling back to polling."
      : "Webhook not configured; polling Twilio for inbound replies.",
    port,
    path,
    publicUrl,
    validateSignature,
  };
}

function parseTwilioPayload(text: string): TwilioMessageRecord | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as TwilioMessageRecord;
  } catch {
    return null;
  }
}

function parseTwilioListPayload(text: string): TwilioMessageListPayload | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as TwilioMessageListPayload;
  } catch {
    return null;
  }
}

function messageTimestamp(record: TwilioMessageRecord): number {
  const raw = record.date_sent ?? record.date_created;
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildTwilioSignature(url: string, params: URLSearchParams, authToken: string): string {
  const pairs = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const payload = `${url}${pairs.map(([key, value]) => `${key}${value}`).join("")}`;
  return createHmac("sha1", authToken).update(payload).digest("base64");
}

function validateTwilioSignature(
  signature: string | undefined,
  url: string,
  params: URLSearchParams,
  authToken: string,
): boolean {
  if (!signature) return false;
  const expected = buildTwilioSignature(url, params, authToken);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export class NotificationService {
  private lastSentBySession = new Map<string, SentProgressState>();
  private pendingQuestions = new Map<string, PendingSmsQuestion>();
  private seenInboundSids = new Set<string>();
  private webhookReplies: IncomingSmsReply[] = [];
  private webhookServer: Server | null = null;
  private webhookStartError: string | null = null;
  private webhookListeningPort: number | null = null;

  hasPendingQuestions(): boolean {
    return this.pendingQuestions.size > 0;
  }

  getInboundTransport(): { mode: "poll" | "webhook"; detail: string; listeningPort?: number | null; publicUrl?: string | null } {
    const config = readWebhookConfig();
    const detail = this.webhookStartError
      ? `${config.detail} Listener error: ${this.webhookStartError}`
      : config.detail;
    return {
      mode: config.effectiveMode,
      detail,
      ...(config.effectiveMode === "webhook" ? { listeningPort: this.webhookListeningPort ?? config.port, publicUrl: config.publicUrl } : {}),
    };
  }

  getStatus(): NotificationStatus {
    const settings = loadRoscoeSettings();
    const twilio = readTwilioConfig();
    const phoneNumber = cleanPhoneNumber(settings.notifications.phoneNumber);
    const providerReady = twilio !== null;
    const enabled = settings.notifications.enabled && phoneNumber.length > 0 && providerReady;
    const inbound = this.getInboundTransport();

    const summary = !phoneNumber
      ? "Add a phone number to receive Roscoe updates."
      : !providerReady
        ? "Twilio env vars are missing."
        : settings.notifications.enabled
          ? "Roscoe will text milestone updates."
          : "Phone saved; SMS updates are paused.";

    return {
      enabled,
      phoneNumber,
      provider: "twilio",
      providerReady,
      summary,
      inboundMode: inbound.mode,
      inboundDetail: inbound.detail,
    };
  }

  async ensureInboundTransportReady(): Promise<void> {
    const config = readWebhookConfig();
    if (config.effectiveMode !== "webhook") return;
    if (this.webhookServer) return;

    const twilio = readTwilioConfig();
    if (!twilio) {
      this.webhookStartError = "Twilio env vars are missing.";
      return;
    }

    await new Promise<void>((resolve) => {
      const server = createServer((req, res) => {
        void this.handleWebhookRequest(req, res, twilio, config);
      });
      server.once("error", (error) => {
        this.webhookStartError = error instanceof Error ? error.message : String(error);
        resolve();
      });
      server.listen(config.port, "127.0.0.1", () => {
        this.webhookServer = server;
        const address = server.address();
        this.webhookListeningPort = typeof address === "object" && address ? address.port : config.port;
        this.webhookStartError = null;
        resolve();
      });
    });
  }

  async shutdown(): Promise<void> {
    if (!this.webhookServer) return;
    await new Promise<void>((resolve) => {
      this.webhookServer?.close(() => resolve());
    });
    this.webhookServer = null;
    this.webhookListeningPort = null;
  }

  async readIncomingReplies(): Promise<IncomingSmsReply[]> {
    if (!this.hasPendingQuestions()) return [];
    await this.ensureInboundTransportReady();
    const transport = this.getInboundTransport();
    if (transport.mode === "webhook" && this.webhookServer) {
      return this.drainWebhookReplies();
    }
    return this.pollIncomingReplies();
  }

  async sendTestMessage(): Promise<SmsSendResult> {
    const settings = loadRoscoeSettings();
    const phoneNumber = cleanPhoneNumber(settings.notifications.phoneNumber);
    if (!phoneNumber) {
      return {
        ok: false,
        accepted: false,
        delivered: false,
        status: "unknown",
        detail: "Add a phone number before sending a test SMS.",
      };
    }

    return this.sendSms(
      phoneNumber,
      "Roscoe wire is live. You’ll get milestone texts with progress estimates and evidence links.",
      { pollForFinalStatus: true },
    );
  }

  async maybeSendProgressUpdate(
    session: ManagedSession,
    summary: string,
  ): Promise<boolean> {
    const settings = loadRoscoeSettings();
    const phoneNumber = cleanPhoneNumber(settings.notifications.phoneNumber);
    if (!settings.notifications.enabled || !phoneNumber || summary === "(summary unavailable)") {
      return false;
    }

    const transcript = session.tracker.getRecentHistory(8)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");
    const urls = extractUrls(`${summary}\n${transcript}`);
    const estimate = estimateProgress(summary, transcript);
    const signature = `${summary}|${estimate.percent}|${urls.join("|")}`;
    const previous = this.lastSentBySession.get(session.id);
    const now = Date.now();

    if (previous?.signature === signature) return false;
    if (
      previous &&
      now - previous.at < DEFAULT_PROGRESS_COOLDOWN_MS &&
      Math.abs(previous.percent - estimate.percent) < 10 &&
      urls.every((url) => previous.urls.includes(url))
    ) {
      return false;
    }

    await this.sendSms(
      phoneNumber,
      buildNotificationBody(session, summary, estimate, urls),
    );

    this.lastSentBySession.set(session.id, {
      at: now,
      signature,
      percent: estimate.percent,
      urls,
    });
    return true;
  }

  async sendQuestion(
    session: ManagedSession,
    question: string,
  ): Promise<SmsQuestionResult> {
    const settings = loadRoscoeSettings();
    const phoneNumber = cleanPhoneNumber(settings.notifications.phoneNumber);
    const cleanQuestion = question.replace(/\s+/g, " ").trim();
    if (!cleanQuestion || !phoneNumber) {
      return {
        ok: false,
        accepted: false,
        delivered: false,
        status: "unknown",
        token: this.createQuestionToken(),
        prompt: question,
        renderedQuestion: "",
        detail: !cleanQuestion
          ? "Roscoe could not find a clear question to text."
          : "Add a phone number before sending an SMS question.",
      };
    }

    const token = this.createQuestionToken();
    const scope = session.worktreeName === "main"
      ? session.projectName
      : `${session.projectName}/${session.worktreeName}`;
    const renderedQuestion = `Roscoe question ${token} for ${scope}: ${cleanQuestion} Reply with ${token} followed by your answer.`;
    const result = await this.sendSms(
      phoneNumber,
      renderedQuestion,
      { pollForFinalStatus: false },
    );

    if (result.ok || result.accepted) {
      this.pendingQuestions.set(token, {
        token,
        sessionId: session.id,
        scope,
        question: cleanQuestion,
        askedAt: Date.now(),
      });
      await this.ensureInboundTransportReady();
    }

    return {
      ...result,
      token,
      prompt: cleanQuestion,
      renderedQuestion,
    };
  }

  private async pollIncomingReplies(): Promise<IncomingSmsReply[]> {
    const settings = loadRoscoeSettings();
    const phoneNumber = cleanPhoneNumber(settings.notifications.phoneNumber);
    const twilio = readTwilioConfig();
    if (!phoneNumber || !twilio) return [];

    const query = new URLSearchParams();
    query.set("From", phoneNumber);
    query.set("PageSize", "20");
    const auth = Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json?${query.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
        },
      },
    );

    const payloadText = await response.text();
    const payload = parseTwilioListPayload(payloadText);
    if (!response.ok) {
      throw new Error(`Twilio inbox check failed: ${response.status}${payloadText.trim() ? ` ${payloadText.trim()}` : ""}`);
    }

    const replies = (payload?.messages ?? [])
      .filter((message) => !this.seenInboundSids.has(message.sid ?? ""))
      .filter((message) => (message.direction ?? "").startsWith("inbound"))
      .sort((a, b) => messageTimestamp(a) - messageTimestamp(b))
      .map((message) => this.mapInboundReply(message))
      .filter((reply): reply is IncomingSmsReply => reply !== null);

    for (const reply of replies) {
      this.markReplyConsumed(reply);
    }

    return replies;
  }

  private async sendSms(
    to: string,
    body: string,
    options: { pollForFinalStatus?: boolean } = {},
  ): Promise<SmsSendResult> {
    const twilio = readTwilioConfig();
    if (!twilio) {
      throw new Error("Twilio SMS is not configured.");
    }

    const form = new URLSearchParams();
    form.set("To", to);
    form.set("Body", body);
    if (twilio.fromNumber) form.set("From", twilio.fromNumber);
    if (twilio.messagingServiceSid) form.set("MessagingServiceSid", twilio.messagingServiceSid);

    const auth = Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
    );

    const payloadText = await response.text();
    const payload = parseTwilioPayload(payloadText);

    if (!response.ok) {
      const details = payload?.error_message
        ? `${payload.error_message}${payload.error_code ? ` (${payload.error_code})` : ""}`
        : payloadText.trim();
      throw new Error(`Twilio SMS failed: ${response.status}${details ? ` ${details}` : ""}`);
    }

    const terminal = options.pollForFinalStatus && payload?.sid
      ? await this.pollForFinalStatus(twilio, payload.sid)
      : payload;

    return this.buildSendResult(terminal ?? payload ?? {});
  }

  private async pollForFinalStatus(twilio: TwilioConfig, sid: string): Promise<TwilioMessageRecord> {
    let latest = await this.fetchMessage(twilio, sid);
    for (let attempt = 0; attempt < TEST_STATUS_POLL_ATTEMPTS; attempt += 1) {
      if (latest.status && this.isTerminalStatus(latest.status)) {
        return latest;
      }
      await new Promise((resolve) => setTimeout(resolve, TEST_STATUS_POLL_INTERVAL_MS));
      latest = await this.fetchMessage(twilio, sid);
    }
    return latest;
  }

  private async fetchMessage(twilio: TwilioConfig, sid: string): Promise<TwilioMessageRecord> {
    const auth = Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages/${sid}.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
        },
      },
    );

    const payloadText = await response.text();
    const payload = parseTwilioPayload(payloadText);
    if (!response.ok) {
      const details = payload?.error_message
        ? `${payload.error_message}${payload.error_code ? ` (${payload.error_code})` : ""}`
        : payloadText.trim();
      throw new Error(`Twilio status check failed: ${response.status}${details ? ` ${details}` : ""}`);
    }
    return payload ?? {};
  }

  private async handleWebhookRequest(
    req: IncomingMessage,
    res: ServerResponse,
    twilio: TwilioConfig,
    config: SmsWebhookConfig,
  ): Promise<void> {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && reqUrl.pathname === config.path) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("roscoe sms webhook ok");
      return;
    }

    if (req.method !== "POST" || reqUrl.pathname !== config.path) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }

    const body = await this.readRequestBody(req);
    const params = new URLSearchParams(body);
    if (config.validateSignature && config.publicUrl) {
      const signature = req.headers["x-twilio-signature"];
      const provided = Array.isArray(signature) ? signature[0] : signature;
      if (!validateTwilioSignature(provided, config.publicUrl, params, twilio.authToken)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("invalid signature");
        return;
      }
    }

    const reply = this.mapInboundReply({
      sid: params.get("MessageSid") ?? undefined,
      body: params.get("Body") ?? undefined,
      from: params.get("From") ?? undefined,
      to: params.get("To") ?? undefined,
      direction: "inbound-webhook",
      date_created: new Date().toISOString(),
    });

    if (reply) {
      this.webhookReplies.push(reply);
    }

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(WEBHOOK_TWIML_RESPONSE);
  }

  private async readRequestBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8");
  }

  private drainWebhookReplies(): IncomingSmsReply[] {
    const replies = [...this.webhookReplies];
    this.webhookReplies = [];
    for (const reply of replies) {
      this.markReplyConsumed(reply);
    }
    return replies;
  }

  private markReplyConsumed(reply: IncomingSmsReply): void {
    this.seenInboundSids.add(reply.sid);
    if (reply.token) {
      this.pendingQuestions.delete(reply.token);
    }
  }

  private isTerminalStatus(status: TwilioMessageStatus): boolean {
    return ["delivered", "undelivered", "failed", "canceled", "sent", "read"].includes(status);
  }

  private buildSendResult(record: TwilioMessageRecord): SmsSendResult {
    const status = record.status ?? "unknown";
    const errorCode = record.error_code ?? null;
    const errorMessage = record.error_message ?? null;

    if (status === "delivered") {
      return {
        ok: true,
        accepted: true,
        delivered: true,
        status,
        sid: record.sid,
        errorCode,
        errorMessage,
        detail: `Twilio reports the test SMS was delivered${record.sid ? ` (${record.sid})` : ""}.`,
      };
    }

    if (status === "sent" || status === "read") {
      return {
        ok: true,
        accepted: true,
        delivered: false,
        status,
        sid: record.sid,
        errorCode,
        errorMessage,
        detail: `Twilio handed off the test SMS${record.sid ? ` (${record.sid})` : ""} with status ${status}. Delivery may still be pending.`,
      };
    }

    if (status === "failed" || status === "undelivered" || status === "canceled") {
      const suffix = errorMessage
        ? ` ${errorMessage}${errorCode ? ` (${errorCode})` : ""}.`
        : ".";
      return {
        ok: false,
        accepted: false,
        delivered: false,
        status,
        sid: record.sid,
        errorCode,
        errorMessage,
        detail: `Twilio marked the test SMS as ${status}.${suffix}`.replace("..", "."),
      };
    }

    if (status === "queued" || status === "accepted" || status === "sending" || status === "scheduled") {
      return {
        ok: true,
        accepted: true,
        delivered: false,
        status,
        sid: record.sid,
        errorCode,
        errorMessage,
        detail: `Twilio accepted the test SMS${record.sid ? ` (${record.sid})` : ""} with status ${status}. Delivery is not confirmed yet.`,
      };
    }

    return {
      ok: true,
      accepted: true,
      delivered: false,
      status,
      sid: record.sid,
      errorCode,
      errorMessage,
      detail: `Twilio accepted the test SMS${record.sid ? ` (${record.sid})` : ""}, but no delivery status is available yet.`,
    };
  }

  private createQuestionToken(): string {
    smsQuestionCounter += 1;
    return `[R${smsQuestionCounter}]`;
  }

  private mapInboundReply(message: TwilioMessageRecord): IncomingSmsReply | null {
    const sid = message.sid?.trim();
    const body = message.body?.trim();
    const from = message.from?.trim();
    if (!sid || !body || !from) return null;

    const tokenMatch = body.match(/\[(R\d+)\]/i);
    const normalizedToken = tokenMatch ? `[${tokenMatch[1].toUpperCase()}]` : undefined;
    let pending = normalizedToken ? this.pendingQuestions.get(normalizedToken) : undefined;
    if (!pending && this.pendingQuestions.size === 1) {
      pending = Array.from(this.pendingQuestions.values())[0];
    }
    if (!pending) return null;

    const answerText = normalizedToken
      ? body.replace(normalizedToken, "").trim()
      : body.trim();

    return {
      sid,
      body,
      answerText: answerText || body.trim(),
      from,
      to: message.to?.trim(),
      receivedAt: messageTimestamp(message) || Date.now(),
      token: pending.token,
      matchedSessionId: pending.sessionId,
      matchedQuestion: pending.question,
    };
  }
}

export { cleanPhoneNumber, estimateProgress, extractUrls, readWebhookConfig };
