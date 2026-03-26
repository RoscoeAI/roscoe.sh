import { z } from "zod";
import { consentCategories } from "./program.js";

const categorySchema = z.enum(consentCategories);

export const consentRequestSchema = z.object({
  phoneNumber: z.string().min(7, "Please enter a valid phone number."),
  email: z.string().email().optional().or(z.literal("")),
  sourcePath: z.enum(["/", "/sms-consent"]),
  consentChecked: z.boolean().refine((value) => value, {
    message: "Please check the consent box before joining the wire.",
  }),
  categories: z.array(categorySchema).min(1, "Select at least one message category."),
});

export type ConsentRequest = z.infer<typeof consentRequestSchema>;

export interface ConsentRecordInput {
  phoneNumber: string;
  email?: string;
  sourcePath: string;
  categories: string[];
  ipAddress?: string;
  userAgent?: string;
}

export interface ConsentRecord extends ConsentRecordInput {
  id: string;
  consentVersion: string;
  fingerprint: string;
  submittedAt: string;
}

export function normalizePhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return `+${digits.slice(1).replace(/[^\d]/g, "")}`;
  }
  const bareDigits = digits.replace(/[^\d]/g, "");
  if (bareDigits.length === 10) return `+1${bareDigits}`;
  if (bareDigits.length === 11 && bareDigits.startsWith("1")) return `+${bareDigits}`;
  return `+${bareDigits}`;
}

export function validateNormalizedPhone(phone: string): boolean {
  return /^\+\d{10,15}$/.test(phone);
}

export function normalizeConsentInput(input: ConsentRecordInput): ConsentRecordInput {
  const categories = Array.from(new Set(input.categories)).sort();
  return {
    ...input,
    phoneNumber: normalizePhoneNumber(input.phoneNumber),
    email: input.email?.trim() || undefined,
    categories,
    sourcePath: input.sourcePath === "/sms-consent" ? "/sms-consent" : "/",
  };
}
