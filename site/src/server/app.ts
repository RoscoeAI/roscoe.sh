import express from "express";
import { createReadStream, existsSync } from "fs";
import { resolve } from "path";
import { consentRequestSchema, normalizeConsentInput, validateNormalizedPhone } from "../shared/consent.js";
import { sampleMessages, supportEmailDefault } from "../shared/program.js";
import { ConsentRepository } from "./consent-repository.js";

export interface SiteRuntimeConfig {
  canonicalBaseUrl?: string;
  supportEmail?: string;
  staticRoot?: string;
}

function getCanonicalHost(canonicalBaseUrl: string): string {
  return new URL(canonicalBaseUrl).host;
}

function getClientIp(headerValue: string | string[] | undefined, fallback?: string): string | undefined {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return fallback;
  return raw.split(",")[0]?.trim() || fallback;
}

export function createSiteApp(repository: ConsentRepository, runtime: SiteRuntimeConfig = {}) {
  const app = express();
  const canonicalBaseUrl = runtime.canonicalBaseUrl ?? process.env.ROSCOE_SITE_BASE_URL ?? "https://roscoe.sh";
  const supportEmail = runtime.supportEmail ?? process.env.ROSCOE_SITE_SUPPORT_EMAIL ?? supportEmailDefault;
  const canonicalHost = getCanonicalHost(canonicalBaseUrl);

  app.disable("x-powered-by");
  app.use(express.json());

  app.use((req, res, next) => {
    const host = req.headers.host?.split(":")[0];
    if (host && host === `www.${canonicalHost}`) {
      const target = new URL(req.originalUrl || "/", canonicalBaseUrl);
      res.redirect(308, target.toString());
      return;
    }
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, service: "roscoe-site" });
  });

  app.post("/api/consent", async (req, res) => {
    const parsed = consentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "Invalid consent payload.",
        issues: parsed.error.flatten(),
      });
      return;
    }

    const normalized = normalizeConsentInput({
      phoneNumber: parsed.data.phoneNumber,
      email: parsed.data.email || undefined,
      sourcePath: parsed.data.sourcePath,
      categories: parsed.data.categories,
      ipAddress: getClientIp(req.headers["x-forwarded-for"], req.ip),
      userAgent: req.headers["user-agent"],
    });

    if (!validateNormalizedPhone(normalized.phoneNumber)) {
      res.status(400).json({
        ok: false,
        error: "Phone number must be valid E.164 format.",
      });
      return;
    }

    try {
      const result = await repository.save(normalized);
      res.status(200).json({
        ok: true,
        created: result.created,
        recordId: result.record.id,
        submittedAt: result.record.submittedAt,
        supportEmail,
        optInConfirmationMessage: sampleMessages.optInConfirmation,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to store consent.",
      });
    }
  });

  const staticRoot = runtime.staticRoot ?? resolve(process.cwd(), "dist/client");
  if (existsSync(staticRoot)) {
    app.use(express.static(staticRoot));
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }

      const indexPath = resolve(staticRoot, "index.html");
      if (!existsSync(indexPath)) {
        next();
        return;
      }

      res.type("html");
      createReadStream(indexPath).pipe(res);
    });
  }

  return app;
}
