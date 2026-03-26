import { Pool } from "pg";
import { randomUUID } from "crypto";
import {
  ConsentRecord,
  ConsentRecordInput,
  normalizeConsentInput,
  validateNormalizedPhone,
} from "../shared/consent.js";
import { buildConsentRecord, createConsentFingerprint } from "./consent-records.js";

export interface SaveConsentResult {
  record: ConsentRecord;
  created: boolean;
}

export interface ConsentRepository {
  save(input: ConsentRecordInput): Promise<SaveConsentResult>;
}

export class MemoryConsentRepository implements ConsentRepository {
  private readonly records = new Map<string, ConsentRecord>();

  async save(input: ConsentRecordInput): Promise<SaveConsentResult> {
    const normalized = normalizeConsentInput(input);
    if (!validateNormalizedPhone(normalized.phoneNumber)) {
      throw new Error("Phone number must be in E.164 format.");
    }

    const fingerprint = createConsentFingerprint(normalized);
    const existing = this.records.get(fingerprint);
    if (existing) {
      return { record: existing, created: false };
    }

    const record = buildConsentRecord(normalized, randomUUID(), new Date().toISOString());
    this.records.set(fingerprint, record);
    return { record, created: true };
  }
}

export class PostgresConsentRepository implements ConsentRepository {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS roscoe_sms_consents (
        id TEXT PRIMARY KEY,
        phone_number TEXT NOT NULL,
        email TEXT,
        consent_version TEXT NOT NULL,
        categories TEXT[] NOT NULL,
        source_path TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        fingerprint TEXT NOT NULL UNIQUE,
        submitted_at TIMESTAMPTZ NOT NULL
      );
    `);
  }

  async save(input: ConsentRecordInput): Promise<SaveConsentResult> {
    const normalized = normalizeConsentInput(input);
    if (!validateNormalizedPhone(normalized.phoneNumber)) {
      throw new Error("Phone number must be in E.164 format.");
    }

    const fingerprint = createConsentFingerprint(normalized);
    const id = randomUUID();
    const submittedAt = new Date().toISOString();

    const result = await this.pool.query<{
      id: string;
      phone_number: string;
      email: string | null;
      consent_version: string;
      categories: string[];
      source_path: string;
      ip_address: string | null;
      user_agent: string | null;
      fingerprint: string;
      submitted_at: string;
      created: boolean;
    }>(
      `
        INSERT INTO roscoe_sms_consents (
          id,
          phone_number,
          email,
          consent_version,
          categories,
          source_path,
          ip_address,
          user_agent,
          fingerprint,
          submitted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (fingerprint) DO UPDATE
          SET fingerprint = EXCLUDED.fingerprint
        RETURNING
          id,
          phone_number,
          email,
          consent_version,
          categories,
          source_path,
          ip_address,
          user_agent,
          fingerprint,
          submitted_at,
          (xmax = 0) AS created;
      `,
      [
        id,
        normalized.phoneNumber,
        normalized.email ?? null,
        buildConsentRecord(normalized, id, submittedAt).consentVersion,
        normalized.categories,
        normalized.sourcePath,
        normalized.ipAddress ?? null,
        normalized.userAgent ?? null,
        fingerprint,
        submittedAt,
      ],
    );

    const row = result.rows[0];
    return {
      created: row.created,
      record: {
        id: row.id,
        phoneNumber: row.phone_number,
        email: row.email ?? undefined,
        categories: row.categories,
        sourcePath: row.source_path,
        ipAddress: row.ip_address ?? undefined,
        userAgent: row.user_agent ?? undefined,
        fingerprint: row.fingerprint,
        consentVersion: row.consent_version,
        submittedAt: row.submitted_at,
      },
    };
  }
}

export async function createConsentRepositoryFromEnv(): Promise<ConsentRepository> {
  const databaseUrl = process.env.ROSCOE_SITE_DATABASE_URL?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!databaseUrl) {
    if (isProduction) {
      throw new Error("ROSCOE_SITE_DATABASE_URL is required in production.");
    }
    return new MemoryConsentRepository();
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresConsentRepository(pool);
  await repository.ensureSchema();
  return repository;
}
