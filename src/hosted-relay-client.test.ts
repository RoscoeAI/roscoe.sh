import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "http";
import { EventEmitter } from "events";
import { WebSocketServer } from "ws";
import {
  HostedRelayClient,
  getHostedRelayClient,
  pollHostedRelayDeviceLink,
  refreshHostedRelaySession,
  resetHostedRelayClientForTests,
  startHostedRelayDeviceLink,
} from "./hosted-relay-client.js";

function waitFor<T>(factory: () => T | null | undefined, timeoutMs = 3000): Promise<T> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const value = factory();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for condition."));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("HostedRelayClient", () => {
  let httpServer: HttpServer | null = null;
  let socketServer: WebSocketServer | null = null;

  beforeEach(() => {
    httpServer = createServer();
    socketServer = new WebSocketServer({ server: httpServer, path: "/api/relay/ws" });
  });

  afterEach(async () => {
    socketServer?.clients.forEach((client) => client.close());
    await new Promise<void>((resolve) => socketServer?.close(() => resolve()));
    socketServer = null;
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
    httpServer = null;
    resetHostedRelayClientForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects, receives inbound hosted SMS, and acknowledges messages", async () => {
    const receivedFromClient: unknown[] = [];

    socketServer?.on("connection", (socket, req) => {
      expect(req.headers.authorization).toBe("Bearer relay-access-token");

      socket.send(JSON.stringify({
        type: "hello-ack",
        phone: "+15551234567",
        clientId: "cli-1",
        active: true,
        subscriptionStatus: "active",
      }));
      socket.send(JSON.stringify({
        type: "inbound-sms",
        message: {
          id: "msg-1",
          messageSid: "SM123",
          fromPhone: "+15551234567",
          body: "status",
          receivedAt: new Date().toISOString(),
        },
      }));
      socket.on("message", (raw) => {
        receivedFromClient.push(JSON.parse(String(raw)));
      });
    });

    await new Promise<void>((resolve) => httpServer?.listen(0, "127.0.0.1", () => resolve()));
    const address = httpServer?.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const client = new HostedRelayClient();
    const inboundMessages: string[] = [];
    client.subscribe((message) => {
      inboundMessages.push(message.body);
      client.ackInbound([message.id]);
    });
    client.configure({
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}`,
      accessToken: "relay-access-token",
      clientId: "cli-1",
    });

    await waitFor(() => inboundMessages[0]);
    expect(inboundMessages).toEqual(["status"]);

    await waitFor(() => receivedFromClient.find((message: any) => message.type === "ack-inbound"));
    expect(receivedFromClient).toContainEqual({
      type: "ack-inbound",
      messageIds: ["msg-1"],
    });
    expect(client.getConnectionState()).toMatchObject({
      connected: true,
      active: true,
      subscriptionStatus: "active",
    });

    client.disconnect();
  });

  it("sends operator SMS requests over the hosted relay socket", async () => {
    let requestId = "";
    const receivedFromClient: unknown[] = [];

    socketServer?.on("connection", (socket) => {
      socket.send(JSON.stringify({
        type: "hello-ack",
        phone: "+15551234567",
        clientId: "cli-2",
        active: true,
        subscriptionStatus: "active",
      }));
      socket.on("message", (raw) => {
        const payload = JSON.parse(String(raw));
        receivedFromClient.push(payload);
        if (payload.type === "send-operator-sms") {
          requestId = payload.requestId;
          socket.send(JSON.stringify({
            type: "outbound-sms-result",
            requestId: payload.requestId,
            result: {
              ok: true,
              sid: "SM999",
              status: "queued",
              delivered: false,
              terminal: false,
            },
          }));
        }
      });
    });

    await new Promise<void>((resolve) => httpServer?.listen(0, "127.0.0.1", () => resolve()));
    const address = httpServer?.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const client = new HostedRelayClient();
    client.configure({
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}`,
      accessToken: "relay-access-token-2",
      clientId: "cli-2",
    });

    vi.useFakeTimers();
    const pending = client.sendOperatorSms("Roscoe checking in");
    await Promise.resolve();
    const result = await pending;
    expect(result).toEqual({
      ok: true,
      sid: "SM999",
      status: "queued",
      delivered: false,
      terminal: false,
    });
    expect(requestId).not.toBe("");
    expect(receivedFromClient).toContainEqual({
      type: "send-operator-sms",
      requestId,
      body: "Roscoe checking in",
    });
    await vi.advanceTimersByTimeAsync(15_000);

    client.disconnect();
  });

  it("hits the hosted relay auth endpoints for device linking and refresh", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deviceCode: "DEVICE123",
          verificationUrl: "https://roscoe.sh/link",
          verificationUrlComplete: "https://roscoe.sh/link?device_code=DEVICE123",
          expiresAt: "2026-03-30T12:10:00.000Z",
          pollIntervalSeconds: 2,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: "access-1",
          accessTokenExpiresAt: "2026-03-30T12:15:00.000Z",
          refreshToken: "refresh-1",
          refreshTokenExpiresAt: "2026-04-29T12:00:00.000Z",
          phone: "+14155550123",
          clientId: "cli-1",
          userEmail: "tim@example.com",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: "access-2",
          accessTokenExpiresAt: "2026-03-30T12:20:00.000Z",
          refreshToken: "refresh-2",
          refreshTokenExpiresAt: "2026-04-29T12:00:00.000Z",
          phone: "+14155550123",
          clientId: "cli-1",
          userEmail: "tim@example.com",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const started = await startHostedRelayDeviceLink("https://roscoe.sh", "+14155550123", "cli-1");
    expect(started.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://roscoe.sh/api/auth/device/start");

    const polled = await pollHostedRelayDeviceLink("https://roscoe.sh", "DEVICE123", "cli-1");
    expect(polled.ok).toBe(true);
    if (polled.ok && polled.status === "linked") {
      expect(polled.status).toBe("linked");
      expect(polled.userEmail).toBe("tim@example.com");
    }

    const refreshed = await refreshHostedRelaySession("https://roscoe.sh", "refresh-1", "cli-1");
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      expect(refreshed.accessToken).toBe("access-2");
    }

  });

  it("returns fallback auth errors when relay endpoints fail or return non-json", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error("bad json");
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "refresh denied" }),
      });

    vi.stubGlobal("fetch", fetchMock);

    await expect(startHostedRelayDeviceLink("https://roscoe.sh/", "+14155550123", "cli-1")).resolves.toEqual({
      ok: false,
      error: "Unable to start hosted relay linking.",
    });

    await expect(pollHostedRelayDeviceLink("https://roscoe.sh/", "DEVICE123", "cli-1")).resolves.toEqual({
      ok: true,
      status: "pending",
      expiresAt: "",
      pollIntervalSeconds: 2,
    });

    await expect(refreshHostedRelaySession("https://roscoe.sh/", "refresh-1", "cli-1")).resolves.toEqual({
      ok: false,
      error: "refresh denied",
    });
  });

  it("normalizes missing optional auth payload fields and uses secure websocket URLs for https bases", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "custom start failure" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          expiresAt: "2026-03-30T12:30:00.000Z",
          pollIntervalSeconds: 9,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          userName: "Tim",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "custom refresh failure" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          userName: "Tim",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    await expect(startHostedRelayDeviceLink("https://roscoe.sh", "+14155550123", "cli-1")).resolves.toEqual({
      ok: false,
      error: "custom start failure",
    });

    await expect(startHostedRelayDeviceLink("https://roscoe.sh", "+14155550123", "cli-1")).resolves.toEqual({
      ok: true,
      deviceCode: undefined,
      verificationUrl: undefined,
      verificationUrlComplete: undefined,
      expiresAt: undefined,
      pollIntervalSeconds: undefined,
    });

    await expect(pollHostedRelayDeviceLink("https://roscoe.sh", "DEVICE123", "cli-1")).resolves.toEqual({
      ok: true,
      status: "pending",
      expiresAt: "2026-03-30T12:30:00.000Z",
      pollIntervalSeconds: 9,
    });

    await expect(pollHostedRelayDeviceLink("https://roscoe.sh", "DEVICE123", "cli-1")).resolves.toEqual({
      ok: true,
      status: "linked",
      accessToken: "",
      accessTokenExpiresAt: "",
      refreshToken: "",
      refreshTokenExpiresAt: "",
      phone: "",
      clientId: "",
      userEmail: undefined,
      userName: "Tim",
    });

    await expect(refreshHostedRelaySession("https://roscoe.sh", "refresh-1", "cli-1")).resolves.toEqual({
      ok: false,
      error: "custom refresh failure",
    });

    await expect(refreshHostedRelaySession("https://roscoe.sh", "refresh-1", "cli-1")).resolves.toEqual({
      ok: true,
      status: "linked",
      accessToken: "",
      accessTokenExpiresAt: "",
      refreshToken: "",
      refreshTokenExpiresAt: "",
      phone: "",
      clientId: "",
      userEmail: undefined,
      userName: "Tim",
    });

    const createdSockets: string[] = [];
    class FakeSocket extends EventEmitter {
      readyState = 0;
      send() {}
      close() {
        this.readyState = 3;
      }
      open() {
        this.readyState = 1;
        this.emit("open");
      }
    }
    const client = new HostedRelayClient((url) => {
      createdSockets.push(url);
      return new FakeSocket() as any;
    });
    client.configure({
      enabled: true,
      baseUrl: "https://relay.example/path",
      accessToken: "token",
      clientId: "cli-1",
    });
    ((client as any).socket as FakeSocket).open();
    expect(createdSockets[0]).toBe("wss://relay.example/api/relay/ws");
    client.disconnect();
  });

  it("uses the default poll error when the device-link poll endpoint fails without a string error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: "bad" } }),
    }));

    await expect(pollHostedRelayDeviceLink("https://roscoe.sh", "DEVICE123", "cli-1")).resolves.toEqual({
      ok: false,
      error: "Unable to complete hosted relay linking.",
    });
  });

  it("rejects outbound SMS when the client disconnects and can reconnect later", async () => {
    class FakeSocket extends EventEmitter {
      readyState = 0;
      sent: string[] = [];
      send(payload: string) {
        this.sent.push(payload);
      }
      close() {
        this.readyState = 3;
      }
      open() {
        this.readyState = 1;
        this.emit("open");
      }
    }

    const sockets: FakeSocket[] = [];
    const client = new HostedRelayClient(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as any;
    });

    client.configure({
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-1",
    });
    sockets[0].open();

    const pending = client.sendOperatorSms("Roscoe checking in");
    await Promise.resolve();
    const sent = JSON.parse(sockets[0].sent[0] ?? "{}");
    expect(sent.type).toBe("send-operator-sms");

    client.disconnect();
    await expect(pending).rejects.toThrow("Hosted relay connection closed.");

    vi.useFakeTimers();
    client.configure(null);
    client.configure({
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-1",
    });
    sockets[1].open();
    client.ackInbound(["msg-2"]);
    expect(JSON.parse(sockets[1].sent[0] ?? "{}")).toEqual({
      type: "ack-inbound",
      messageIds: ["msg-2"],
    });
    client.disconnect();
  });

  it("reconnects automatically after the hosted socket closes", async () => {
    class FakeSocket extends EventEmitter {
      readyState = 0;
      send() {}
      close() {
        this.readyState = 3;
      }
      open() {
        this.readyState = 1;
        this.emit("open");
      }
      fail() {
        this.readyState = 3;
        this.emit("close");
      }
    }

    const sockets: FakeSocket[] = [];
    const client = new HostedRelayClient(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as any;
    });

    client.configure({
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-1",
    });
    sockets[0].open();

    vi.useFakeTimers();
    sockets[0].fail();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets).toHaveLength(2);
    client.disconnect();
  });

  it("does not reconnect when the config is unchanged or reconnecting is disabled", async () => {
    class FakeSocket extends EventEmitter {
      readyState = 0;
      send() {}
      close() {
        this.readyState = 3;
      }
      open() {
        this.readyState = 1;
        this.emit("open");
      }
    }

    const sockets: FakeSocket[] = [];
    const client = new HostedRelayClient(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as any;
    });

    const config = {
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-1",
    };
    client.configure(config);
    sockets[0].open();
    client.configure({ ...config });
    expect(sockets).toHaveLength(1);

    vi.useFakeTimers();
    (client as any).config = null;
    (client as any).scheduleReconnect();
    await vi.advanceTimersByTimeAsync(2500);
    expect(sockets).toHaveLength(1);
    client.disconnect();
  });

  it("keeps retrying reconnects after a reconnect attempt fails", async () => {
    const client = new HostedRelayClient();
    (client as any).config = {
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-1",
    };

    const ensureConnected = vi.fn().mockRejectedValue(new Error("nope"));
    (client as any).ensureConnected = ensureConnected;

    vi.useFakeTimers();
    (client as any).scheduleReconnect();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();

    expect(ensureConnected).toHaveBeenCalledTimes(1);
    expect((client as any).reconnectTimer).not.toBeNull();
    client.disconnect();
  });

  it("schedules reconnects after socket errors", async () => {
    class FakeSocket extends EventEmitter {
      readyState = 0;
      send() {}
      close() {
        this.readyState = 3;
      }
      open() {
        this.readyState = 1;
        this.emit("open");
      }
      failError() {
        this.readyState = 3;
        this.emit("error", new Error("boom"));
      }
    }

    const sockets: FakeSocket[] = [];
    const client = new HostedRelayClient(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as any;
    });

    client.configure({
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-1",
    });
    sockets[0].open();

    vi.useFakeTimers();
    sockets[0].failError();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets).toHaveLength(2);
    client.disconnect();
  });

  it("rejects connecting callers when the relay handshake resolves without an open socket", async () => {
    class FakeSocket extends EventEmitter {
      readyState = 0;
      send() {}
      close() {
        this.readyState = 3;
      }
    }

    const client = new HostedRelayClient(() => new FakeSocket() as any);
    client.configure({
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-1",
    });

    const pending = client.sendOperatorSms("hello from connecting");
    await Promise.resolve();
    for (const resolve of (client as any).connectResolvers) {
      resolve();
    }
    await expect(pending).rejects.toThrow("Hosted relay connection failed.");
    client.disconnect();
  });

  it("times out outbound SMS requests when the server never responds", async () => {
    class FakeSocket extends EventEmitter {
      readyState = 0;
      sent: string[] = [];
      send(payload: string) {
        this.sent.push(payload);
      }
      close() {
        this.readyState = 3;
      }
      open() {
        this.readyState = 1;
        this.emit("open");
      }
    }

    vi.useFakeTimers();
    const client = new HostedRelayClient(() => new FakeSocket() as any);
    client.configure({
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-1",
    });
    const socket = (client as any).socket as FakeSocket;
    socket.open();

    const pending = client.sendOperatorSms("hello timeout");
    const assertion = expect(pending).rejects.toThrow("Hosted relay SMS request timed out.");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    client.disconnect();
  });

  it("times out connection attempts when the hosted socket never opens", async () => {
    class FakeSocket extends EventEmitter {
      readyState = 0;
      send() {}
      close() {
        this.readyState = 3;
      }
    }

    vi.useFakeTimers();
    const client = new HostedRelayClient(() => new FakeSocket() as any);
    client.configure({
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-1",
    });

    const pending = client.sendOperatorSms("hello connect timeout");
    const assertion = expect(pending).rejects.toThrow("Hosted relay connection timed out.");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    client.disconnect();
  });

  it("ignores malformed or unrecognized server messages", async () => {
    socketServer?.on("connection", (socket) => {
      socket.send("not-json");
      socket.send(JSON.stringify({ nope: true }));
      socket.send(JSON.stringify({ type: "error", message: "relay problem" }));
      socket.send(JSON.stringify({
        type: "outbound-sms-result",
        requestId: "missing",
        result: { ok: true },
      }));
      socket.send(JSON.stringify({
        type: "hello-ack",
        phone: "+15551234567",
        clientId: "cli-3",
        active: false,
        subscriptionStatus: null,
      }));
    });

    await new Promise<void>((resolve) => httpServer?.listen(0, "127.0.0.1", () => resolve()));
    const address = httpServer?.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const client = new HostedRelayClient();
    client.configure({
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}`,
      accessToken: "relay-access-token-3",
      clientId: "cli-3",
    });

    await waitFor(() => client.getConnectionState().connected ? "connected" : null);
    expect(client.getConnectionState()).toMatchObject({
      connected: true,
      active: false,
      subscriptionStatus: null,
    });
    client.disconnect();
  });

  it("supports unsubscribing listeners and times out unanswered outbound SMS requests", async () => {
    class FakeSocket extends EventEmitter {
      readyState = 0;
      sent: string[] = [];
      send(payload: string) {
        this.sent.push(payload);
      }
      close() {
        this.readyState = 3;
      }
      open() {
        this.readyState = 1;
        this.emit("open");
      }
    }

    const sockets: FakeSocket[] = [];
    const client = new HostedRelayClient(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as any;
    });

    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    unsubscribe();

    client.configure({
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-timeout",
    });
    sockets[0].open();
    sockets[0].emit("message", JSON.stringify({
      type: "inbound-sms",
      message: {
        id: "msg-timeout",
        fromPhone: "+15551234567",
        body: "status",
        receivedAt: new Date().toISOString(),
      },
    }));
    expect(listener).not.toHaveBeenCalled();

    vi.useFakeTimers();
    const pending = client.sendOperatorSms("No one answers this");
    const expectation = expect(pending).rejects.toThrow("Hosted relay SMS request timed out.");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15000);
    await expectation;
    client.disconnect();
  });

  it("no-ops ackInbound when disconnected and resolves singleton reset", () => {
    const first = getHostedRelayClient();
    const second = getHostedRelayClient();
    expect(first).toBe(second);

    expect(() => first.ackInbound(["msg-1"])).not.toThrow();
    expect(() => first.ackInbound([])).not.toThrow();

    resetHostedRelayClientForTests();
    expect(getHostedRelayClient()).not.toBe(first);
  });

  it("throws clear errors when hosted relay is unconfigured or a socket never opens", async () => {
    class HangingSocket extends EventEmitter {
      readyState = 0;
      send() {}
      close() {
        this.readyState = 3;
      }
    }

    const unconfigured = new HostedRelayClient();
    await expect(unconfigured.sendOperatorSms("hello")).rejects.toThrow("Hosted relay is not configured.");

    const client = new HostedRelayClient(() => new HangingSocket() as any);
    client.configure({
      enabled: true,
      baseUrl: "http://relay.example",
      accessToken: "token",
      clientId: "cli-1",
    });

    vi.useFakeTimers();
    const promise = client.sendOperatorSms("hello");
    const expectation = expect(promise).rejects.toThrow("Hosted relay connection timed out.");
    await vi.advanceTimersByTimeAsync(5000);
    await expectation;
    client.disconnect();
  });
});
