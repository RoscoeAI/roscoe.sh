import { createHash } from "crypto";
import {
  ConsentRecord,
  ConsentRecordInput,
  normalizeConsentInput,
} from "../shared/consent.js";
import { consentVersion } from "../shared/program.js";

export function createConsentFingerprint(input: ConsentRecordInput): string {
  const normalized = normalizeConsentInput(input);
  return createHash("sha256")
    .update(
      JSON.stringify({
        phoneNumber: normalized.phoneNumber,
        email: normalized.email ?? "",
        categories: normalized.categories,
        sourcePath: normalized.sourcePath,
        consentVersion,
      }),
    )
    .digest("hex");
}

export function buildConsentRecord(
  input: ConsentRecordInput,
  id: string,
  submittedAt: string,
): ConsentRecord {
  const normalized = normalizeConsentInput(input);
  return {
    ...normalized,
    id,
    consentVersion,
    fingerprint: createConsentFingerprint(normalized),
    submittedAt,
  };
}
