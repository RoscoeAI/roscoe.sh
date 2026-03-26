// @vitest-environment node

import request from "supertest";
import { createSiteApp } from "../src/server/app";
import { MemoryConsentRepository } from "../src/server/consent-repository";

describe("createSiteApp", () => {
  it("returns health and redirects www to the apex host", async () => {
    const app = createSiteApp(new MemoryConsentRepository(), {
      canonicalBaseUrl: "https://roscoe.sh",
    });

    const health = await request(app).get("/healthz");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const redirect = await request(app)
      .get("/sms-consent?mode=review")
      .set("Host", "www.roscoe.sh");

    expect(redirect.status).toBe(308);
    expect(redirect.headers.location).toBe("https://roscoe.sh/sms-consent?mode=review");
  });

  it("stores consent payloads and handles duplicate submissions deterministically", async () => {
    const app = createSiteApp(new MemoryConsentRepository(), {
      canonicalBaseUrl: "https://roscoe.sh",
      supportEmail: "hello@roscoe.sh",
    });

    const payload = {
      phoneNumber: "+14155550123",
      email: "hello@roscoe.sh",
      sourcePath: "/sms-consent",
      consentChecked: true,
      categories: ["Events", "2FA", "Account Notifications"],
    };

    const first = await request(app)
      .post("/api/consent")
      .set("X-Forwarded-For", "203.0.113.10")
      .set("User-Agent", "vitest")
      .send(payload);

    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.created).toBe(true);
    expect(first.body.supportEmail).toBe("hello@roscoe.sh");

    const second = await request(app).post("/api/consent").send(payload);

    expect(second.status).toBe(200);
    expect(second.body.ok).toBe(true);
    expect(second.body.created).toBe(false);
    expect(second.body.recordId).toBe(first.body.recordId);
  });

  it("rejects malformed consent payloads", async () => {
    const app = createSiteApp(new MemoryConsentRepository(), {
      canonicalBaseUrl: "https://roscoe.sh",
    });

    const response = await request(app).post("/api/consent").send({
      phoneNumber: "4155550123",
      sourcePath: "/sms-consent",
      categories: ["2FA"],
      consentChecked: false,
    });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
  });
});
