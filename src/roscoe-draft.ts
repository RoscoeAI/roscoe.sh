export type RoscoeDecision = "message" | "restart-worker" | "noop" | "host-actions-only" | "needs-review";

export interface RoscoeDraftPayload {
  decision?: RoscoeDecision;
  message?: string;
  confidence?: number;
  reasoning?: string;
  browserActions?: unknown[];
  orchestratorActions?: unknown[];
  hostActions?: unknown[];
}

export const SUPPRESSED_CONTINUATION_GUARD_TEXT = "Hold. The same continuation guidance is already in the lane transcript; wait for a materially different Guild update or fresh proof before restating it.";
export const MALFORMED_STRUCTURED_DRAFT_REASONING = "Sidecar returned malformed structured draft output; Roscoe suppressed the raw JSON instead of forwarding it.";
export const LEGACY_STRUCTURED_PARSE_FALLBACK_REASONING = "Could not parse structured response — defaulting to medium confidence";

const SILENT_NOOP_REASONING_PATTERN = /no new guild (turns|activity)|no-activity delta|guild has not responded|sending another message would be (pure )?noise|repeated ci polls are not producing new information|hold silently until a guild turn or ci completion surfaces|only .* (ci results|fresh ci results|hosted results|fresh proof|guild response) .* change the conversation state|wait for fresh proof|existing direction is clear/i;

function isRoscoeDecision(value: unknown): value is RoscoeDecision {
  return value === "message"
    || value === "restart-worker"
    || value === "noop"
    || value === "host-actions-only"
    || value === "needs-review";
}

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```json?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

function extractCandidateJson(text: string): string | null {
  const stripped = stripJsonFence(text);
  if (stripped.startsWith("{") && stripped.endsWith("}")) {
    try {
      JSON.parse(stripped);
      return stripped;
    } catch {
      // fall through to balanced extraction
    }
  }

  const firstBrace = stripped.indexOf("{");
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < stripped.length; i += 1) {
    const char = stripped[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return stripped.slice(firstBrace, i + 1).trim();
      }
    }
  }
  return null;
}

export function looksLikeRoscoeStructuredDraft(text: string): boolean {
  const normalized = stripJsonFence(text).trim();
  if (!normalized) return false;

  const keyHits = [
    /"decision"\s*:/i,
    /"message"\s*:/i,
    /"confidence"\s*:/i,
    /"reasoning"\s*:/i,
    /"hostActions"\s*:/i,
    /"browserActions"\s*:/i,
    /"orchestratorActions"\s*:/i,
  ].filter((pattern) => pattern.test(normalized)).length;

  if (keyHits >= 2 && (normalized.startsWith("{") || normalized.includes("```json") || normalized.includes("{"))) {
    return true;
  }

  return false;
}

export function inferMalformedStructuredDecision(text: string): RoscoeDecision {
  const match = text.match(/"decision"\s*:\s*"([^"]+)"/i);
  return match?.[1]?.toLowerCase() === "noop" ? "noop" : "needs-review";
}

export function parseRoscoeDraftPayload(text: string): RoscoeDraftPayload | null {
  const candidate = extractCandidateJson(text);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const looksLikeDraft =
      "message" in parsed ||
      "confidence" in parsed ||
      "reasoning" in parsed ||
      "browserActions" in parsed ||
      "orchestratorActions" in parsed ||
      "hostActions" in parsed;

    if (!looksLikeDraft) return null;

    return {
      ...(isRoscoeDecision(parsed.decision) ? { decision: parsed.decision } : {}),
      ...(typeof parsed.message === "string" ? { message: parsed.message } : {}),
      ...(typeof parsed.confidence === "number" ? { confidence: parsed.confidence } : {}),
      ...(typeof parsed.reasoning === "string" ? { reasoning: parsed.reasoning } : {}),
      ...(Array.isArray(parsed.browserActions) ? { browserActions: parsed.browserActions } : {}),
      ...(Array.isArray(parsed.orchestratorActions) ? { orchestratorActions: parsed.orchestratorActions } : {}),
      ...(Array.isArray(parsed.hostActions) ? { hostActions: parsed.hostActions } : {}),
    };
  } catch {
    return null;
  }
}

export function isSuppressedContinuationGuard(
  value: Pick<RoscoeDraftPayload, "message" | "reasoning">,
): boolean {
  return (value.message ?? "").trim() === SUPPRESSED_CONTINUATION_GUARD_TEXT
    && (value.reasoning ?? "").includes("Repeated continuation guard suppressed");
}

export function isSilentNoOpReasoning(reasoning: string): boolean {
  return SILENT_NOOP_REASONING_PATTERN.test(reasoning);
}

export function inferRoscoeDecision(
  value: Pick<RoscoeDraftPayload, "decision" | "message" | "reasoning" | "hostActions">,
): RoscoeDecision {
  if (isRoscoeDecision(value.decision)) {
    return value.decision;
  }

  const message = typeof value.message === "string" ? value.message : "";
  const reasoning = typeof value.reasoning === "string" ? value.reasoning : "";
  const hasHostActions = Array.isArray(value.hostActions) && value.hostActions.length > 0;

  if (isSuppressedContinuationGuard({ message, reasoning })) {
    return "noop";
  }
  if (!message.trim() && hasHostActions) {
    return "host-actions-only";
  }
  if (!message.trim() && isSilentNoOpReasoning(reasoning)) {
    return "noop";
  }
  if (!message.trim()) {
    return "needs-review";
  }
  return "message";
}

export function shouldSuppressRestoredRoscoeSuggestion(
  value: Pick<RoscoeDraftPayload, "decision" | "message" | "reasoning" | "hostActions">,
): boolean {
  const message = typeof value.message === "string" ? value.message.trim() : "";
  const reasoning = typeof value.reasoning === "string" ? value.reasoning.trim() : "";

  if (inferRoscoeDecision(value) === "noop") {
    return true;
  }

  if (reasoning === MALFORMED_STRUCTURED_DRAFT_REASONING) {
    return true;
  }

  if (
    reasoning === LEGACY_STRUCTURED_PARSE_FALLBACK_REASONING
    && (message === "" || message === "No response requested." || looksLikeRoscoeStructuredDraft(message))
  ) {
    return true;
  }

  return false;
}

export function normalizeRoscoeDraftMessage(text: string): string {
  const parsed = parseRoscoeDraftPayload(text);
  return typeof parsed?.message === "string" ? parsed.message : text;
}

export function formatRoscoeDraftDisplayText(text: string): string {
  const normalized = normalizeRoscoeDraftMessage(text).trim();
  return normalized || "Roscoe recommends holding the Guild reply for now.";
}

export function normalizeLegacySidecarErrorText(text: string): string {
  const normalized = text.trim();
  if (normalized === "Sidecar timed out after 30s") {
    return "Roscoe sidecar timed out after 30s in an earlier run before the timeout was raised.";
  }
  return text;
}
