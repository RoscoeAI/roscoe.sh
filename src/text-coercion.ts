export function coerceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => coerceText(item).trim())
      .filter(Boolean)
      .join(" ");
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "message", "reasoning", "detail", "value"]) {
      const nested = coerceText(record[key]).trim();
      if (nested) return nested;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}
