import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeHostedSmsResult,
  formatPlanAmount,
  getRelayBaseUrl,
  pollHostedTestSmsStatus,
} from "./home-screen.js";

describe("home-screen helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ROSCOE_RELAY_BASE_URL;
  });

  it("uses the configured relay base url and falls back to roscoe.sh", () => {
    delete process.env.ROSCOE_RELAY_BASE_URL;
    expect(getRelayBaseUrl()).toBe("https://roscoe.sh");

    process.env.ROSCOE_RELAY_BASE_URL = " https://relay.example ";
    expect(getRelayBaseUrl()).toBe("https://relay.example");
  });

  it("formats plan amounts in uppercase currencies", () => {
    expect(formatPlanAmount(500, "usd")).toBe("$5.00");
  });

  it("describes hosted sms failures, delivered sends, terminal failures, and pending delivery", () => {
    expect(describeHostedSmsResult("6122030386", {
      ok: false,
      error: "provider blocked",
    })).toEqual({
      text: "provider blocked",
      color: "red",
    });

    expect(describeHostedSmsResult("6122030386", {
      ok: true,
      delivered: true,
      terminal: true,
      status: "delivered",
    })).toEqual({
      text: "Hosted relay test SMS delivered to 6122030386. Reply C to verify the round trip back into this CLI.",
      color: "yellow",
    });

    expect(describeHostedSmsResult("6122030386", {
      ok: true,
      delivered: false,
      terminal: true,
      status: "undelivered",
      errorMessage: "carrier blocked",
    })).toEqual({
      text: "Hosted relay test SMS did not deliver (undelivered). carrier blocked",
      color: "red",
    });

    expect(describeHostedSmsResult("6122030386", {
      ok: true,
      delivered: false,
      terminal: false,
      status: null,
    })).toEqual({
      text: "Hosted relay test SMS submitted to Twilio for 6122030386 (queued). Reply C when it arrives to verify the round trip.",
      color: "yellow",
    });
  });

  it("polls hosted sms status until delivery is confirmed", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          sid: "SM123",
          status: "queued",
          delivered: false,
          terminal: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          sid: "SM123",
          status: "delivered",
          delivered: true,
          terminal: true,
        }),
      });
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    const promise = pollHostedTestSmsStatus("https://roscoe.sh", "SM123");
    await vi.advanceTimersByTimeAsync(4000);
    await expect(promise).resolves.toMatchObject({
      sid: "SM123",
      status: "delivered",
      delivered: true,
      terminal: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("returns an explicit error when hosted sms status cannot be fetched", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "status unavailable" }),
    }) as unknown as typeof fetch);

    const promise = pollHostedTestSmsStatus("https://roscoe.sh", "SM404");
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toEqual({
      ok: false,
      error: "status unavailable",
    });

    vi.useRealTimers();
  });
});
