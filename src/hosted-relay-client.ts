import { randomUUID } from "crypto";
import WebSocket from "ws";

export interface HostedRelayConnectionConfig {
  baseUrl: string;
  accessToken: string;
  clientId: string;
  enabled: boolean;
}

export interface HostedRelayInboundMessage {
  id: string;
  messageSid?: string;
  fromPhone: string;
  body: string;
  receivedAt: string;
}

export interface HostedRelaySendResult {
  ok: boolean;
  sid?: string;
  status?: string | null;
  delivered?: boolean;
  terminal?: boolean;
  errorCode?: string | number | null;
  errorMessage?: string | null;
  error?: string;
}

type RelayServerToClientMessage =
  | {
      type: "hello-ack";
      phone: string;
      clientId: string;
      active: boolean;
      subscriptionStatus: string | null;
    }
  | {
      type: "inbound-sms";
      message: HostedRelayInboundMessage;
    }
  | {
      type: "outbound-sms-result";
      requestId: string;
      result: HostedRelaySendResult;
    }
  | {
      type: "error";
      message: string;
    };

interface PendingOutboundRequest {
  resolve: (result: HostedRelaySendResult) => void;
  reject: (error: Error) => void;
}

type InboundListener = (message: HostedRelayInboundMessage) => void;

export interface HostedRelayLinkStartResult {
  ok: boolean;
  deviceCode?: string;
  verificationUrl?: string;
  verificationUrlComplete?: string;
  expiresAt?: string;
  pollIntervalSeconds?: number;
  error?: string;
}

export interface HostedRelayLinkPendingResult {
  ok: true;
  status: "pending";
  expiresAt: string;
  pollIntervalSeconds: number;
}

export interface HostedRelayLinkCompleteResult {
  ok: true;
  status: "linked";
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  phone: string;
  clientId: string;
  userEmail?: string;
  userName?: string;
}

export interface HostedRelayLinkErrorResult {
  ok: false;
  error: string;
}

export type HostedRelayLinkPollResult = HostedRelayLinkPendingResult | HostedRelayLinkCompleteResult | HostedRelayLinkErrorResult;

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/relay/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeRelayBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({}));
}

export async function startHostedRelayDeviceLink(
  baseUrl: string,
  phone: string,
  clientId: string,
): Promise<HostedRelayLinkStartResult> {
  const response = await fetch(new URL("/api/auth/device/start", normalizeRelayBaseUrl(baseUrl)), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone, clientId }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    return { ok: false, error: typeof payload.error === "string" ? payload.error : "Unable to start hosted relay linking." };
  }
  return {
    ok: true,
    deviceCode: typeof payload.deviceCode === "string" ? payload.deviceCode : undefined,
    verificationUrl: typeof payload.verificationUrl === "string" ? payload.verificationUrl : undefined,
    verificationUrlComplete: typeof payload.verificationUrlComplete === "string" ? payload.verificationUrlComplete : undefined,
    expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : undefined,
    pollIntervalSeconds: typeof payload.pollIntervalSeconds === "number" ? payload.pollIntervalSeconds : undefined,
  };
}

export async function pollHostedRelayDeviceLink(
  baseUrl: string,
  deviceCode: string,
  clientId: string,
): Promise<HostedRelayLinkPollResult> {
  const response = await fetch(new URL("/api/auth/device/poll", normalizeRelayBaseUrl(baseUrl)), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ deviceCode, clientId }),
  });
  const payload = await parseJson(response);
  if (response.status === 202) {
    return {
      ok: true,
      status: "pending",
      expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
      pollIntervalSeconds: typeof payload.pollIntervalSeconds === "number" ? payload.pollIntervalSeconds : 2,
    };
  }
  if (!response.ok) {
    return { ok: false, error: typeof payload.error === "string" ? payload.error : "Unable to complete hosted relay linking." };
  }
  return {
    ok: true,
    status: "linked",
    accessToken: String(payload.accessToken ?? ""),
    accessTokenExpiresAt: String(payload.accessTokenExpiresAt ?? ""),
    refreshToken: String(payload.refreshToken ?? ""),
    refreshTokenExpiresAt: String(payload.refreshTokenExpiresAt ?? ""),
    phone: String(payload.phone ?? ""),
    clientId: String(payload.clientId ?? ""),
    userEmail: typeof payload.userEmail === "string" ? payload.userEmail : undefined,
    userName: typeof payload.userName === "string" ? payload.userName : undefined,
  };
}

export async function refreshHostedRelaySession(
  baseUrl: string,
  refreshToken: string,
  clientId: string,
): Promise<HostedRelayLinkCompleteResult | HostedRelayLinkErrorResult> {
  const response = await fetch(new URL("/api/auth/refresh", normalizeRelayBaseUrl(baseUrl)), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refreshToken, clientId }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    return { ok: false, error: typeof payload.error === "string" ? payload.error : "Unable to refresh hosted relay auth." };
  }
  return {
    ok: true,
    status: "linked",
    accessToken: String(payload.accessToken ?? ""),
    accessTokenExpiresAt: String(payload.accessTokenExpiresAt ?? ""),
    refreshToken: String(payload.refreshToken ?? ""),
    refreshTokenExpiresAt: String(payload.refreshTokenExpiresAt ?? ""),
    phone: String(payload.phone ?? ""),
    clientId: String(payload.clientId ?? ""),
    userEmail: typeof payload.userEmail === "string" ? payload.userEmail : undefined,
    userName: typeof payload.userName === "string" ? payload.userName : undefined,
  };
}

export class HostedRelayClient {
  private config: HostedRelayConnectionConfig | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<InboundListener>();
  private connectResolvers: Array<() => void> = [];
  private pendingOutbound = new Map<string, PendingOutboundRequest>();
  private subscriptionStatus: string | null = null;
  private active = false;

  constructor(
    private readonly createSocket: (url: string, accessToken: string) => WebSocket = (url, accessToken) =>
      new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }),
  ) {}

  configure(config: HostedRelayConnectionConfig | null): void {
    const next = config && config.enabled ? config : null;
    const changed = JSON.stringify(this.config) !== JSON.stringify(next);
    this.config = next;
    if (!next) {
      this.disconnect();
      return;
    }

    if (changed) {
      this.disconnect();
      this.ensureConnected().catch(() => {
        // Best-effort relay bridge; reconnection is automatic.
      });
    }
  }

  subscribe(listener: InboundListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getConnectionState(): { connected: boolean; active: boolean; subscriptionStatus: string | null } {
    return {
      connected: this.socket?.readyState === WebSocket.OPEN,
      active: this.active,
      subscriptionStatus: this.subscriptionStatus,
    };
  }

  async sendOperatorSms(body: string): Promise<HostedRelaySendResult> {
    const socket = await this.ensureConnected();
    const requestId = randomUUID();
    const promise = new Promise<HostedRelaySendResult>((resolve, reject) => {
      this.pendingOutbound.set(requestId, { resolve, reject });
      setTimeout(() => {
        const pending = this.pendingOutbound.get(requestId);
        if (!pending) return;
        this.pendingOutbound.delete(requestId);
        reject(new Error("Hosted relay SMS request timed out."));
      }, 15_000);
    });

    socket.send(JSON.stringify({
      type: "send-operator-sms",
      requestId,
      body,
    }));

    return promise;
  }

  ackInbound(messageIds: string[]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || messageIds.length === 0) {
      return;
    }

    this.socket.send(JSON.stringify({
      type: "ack-inbound",
      messageIds,
    }));
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // best effort
      }
      this.socket = null;
    }
    this.active = false;
    this.subscriptionStatus = null;
    for (const pending of this.pendingOutbound.values()) {
      pending.reject(new Error("Hosted relay connection closed."));
    }
    this.pendingOutbound.clear();
  }

  private async ensureConnected(): Promise<WebSocket> {
    if (!this.config) {
      throw new Error("Hosted relay is not configured.");
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    if (this.socket?.readyState === WebSocket.CONNECTING) {
      return new Promise<WebSocket>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Hosted relay connection timed out.")), 5000);
        this.connectResolvers.push(() => {
          clearTimeout(timeout);
          if (this.socket?.readyState === WebSocket.OPEN) {
            resolve(this.socket);
          } else {
            reject(new Error("Hosted relay connection failed."));
          }
        });
      });
    }

    const socket = this.createSocket(
      toWebSocketUrl(this.config.baseUrl),
      this.config.accessToken,
    );
    this.socket = socket;
    socket.on("open", () => {
      const resolvers = [...this.connectResolvers];
      this.connectResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    });
    socket.on("message", (raw) => {
      this.handleServerMessage(String(raw));
    });
    socket.on("close", () => {
      this.socket = null;
      this.active = false;
      this.subscriptionStatus = null;
      this.scheduleReconnect();
    });
    socket.on("error", () => {
      this.scheduleReconnect();
    });

    return new Promise<WebSocket>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Hosted relay connection timed out.")), 5000);
      this.connectResolvers.push(() => {
        clearTimeout(timeout);
        if (this.socket?.readyState === WebSocket.OPEN) {
          resolve(this.socket);
        } else {
          reject(new Error("Hosted relay connection failed."));
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.config?.enabled || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected().catch(() => {
        this.scheduleReconnect();
      });
    }, 2000);
  }

  private handleServerMessage(raw: string): void {
    let message: RelayServerToClientMessage | null = null;
    try {
      message = JSON.parse(raw) as RelayServerToClientMessage;
    } catch {
      return;
    }

    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      return;
    }

    if (message.type === "hello-ack") {
      this.active = message.active;
      this.subscriptionStatus = message.subscriptionStatus;
      return;
    }

    if (message.type === "inbound-sms") {
      for (const listener of this.listeners) {
        listener(message.message);
      }
      return;
    }

    if (message.type === "outbound-sms-result") {
      const pending = this.pendingOutbound.get(message.requestId);
      if (!pending) return;
      this.pendingOutbound.delete(message.requestId);
      pending.resolve(message.result);
    }
  }
}

let singleton: HostedRelayClient | null = null;

export function getHostedRelayClient(): HostedRelayClient {
  singleton ??= new HostedRelayClient();
  return singleton;
}

export function resetHostedRelayClientForTests(): void {
  singleton?.disconnect();
  singleton = null;
}
