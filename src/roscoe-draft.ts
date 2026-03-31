interface RoscoeDraftPayload {
  message?: string;
  confidence?: number;
  reasoning?: string;
  browserActions?: unknown[];
  orchestratorActions?: unknown[];
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
      "orchestratorActions" in parsed;

    if (!looksLikeDraft) return null;

    return {
      ...(typeof parsed.message === "string" ? { message: parsed.message } : {}),
      ...(typeof parsed.confidence === "number" ? { confidence: parsed.confidence } : {}),
      ...(typeof parsed.reasoning === "string" ? { reasoning: parsed.reasoning } : {}),
      ...(Array.isArray(parsed.browserActions) ? { browserActions: parsed.browserActions } : {}),
      ...(Array.isArray(parsed.orchestratorActions) ? { orchestratorActions: parsed.orchestratorActions } : {}),
    };
  } catch {
    return null;
  }
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
