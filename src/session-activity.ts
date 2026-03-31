function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeToolActivityDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const normalized = detail.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function isGenericToolActivityDetail(
  toolName: string | null | undefined,
  detail: string | null | undefined,
): boolean {
  if (!toolName || !detail) return false;
  return detail.trim().toLowerCase() === `using ${toolName.trim().toLowerCase()}`;
}

export function getToolActivitySummary(
  toolName: string | null | undefined,
  detail?: string | null,
): string | null {
  if (!toolName) return null;

  const normalizedDetail = normalizeToolActivityDetail(detail);
  if (normalizedDetail && !isGenericToolActivityDetail(toolName, normalizedDetail)) {
    const lowered = normalizedDetail.toLowerCase();
    if (lowered.startsWith("tests ·")) return "running tests";
    if (lowered.startsWith("checks ·")) return "running checks";
  }

  const normalized = toolName.trim().toLowerCase();

  if (normalized === "command_execution" || normalized === "bash") {
    return "running shell commands";
  }
  if (normalized === "read") {
    return "reading files";
  }
  if (normalized === "write" || normalized === "edit" || normalized === "multiedit") {
    return "editing files";
  }
  if (normalized === "grep" || normalized === "glob" || normalized === "file_search") {
    return "searching the codebase";
  }
  if (normalized === "websearch" || normalized === "webfetch") {
    return "checking the web";
  }
  if (normalized.startsWith("browser") || normalized.startsWith("mcp__chrome_devtools__")) {
    return "inspecting the app in the browser";
  }
  if (normalized === "todowrite" || normalized === "task" || normalized === "plan") {
    return "planning the next step";
  }
  if (normalized === "agent") {
    return "delegating work";
  }
  if (normalized === "interrupt") {
    return "interrupting current turn";
  }
  if (normalized === "resume") {
    return "resuming interrupted lane";
  }

  return humanizeToolName(toolName);
}

export function getToolActivityStatusLabel(
  toolName: string | null | undefined,
  detail?: string | null,
): string | null {
  const normalizedDetail = normalizeToolActivityDetail(detail);
  if (normalizedDetail && !isGenericToolActivityDetail(toolName, normalizedDetail)) {
    return normalizedDetail.startsWith("Guild")
      ? normalizedDetail
      : `Guild · ${normalizedDetail}`;
  }

  const summary = getToolActivitySummary(toolName, detail);
  if (!summary) return null;

  return summary.startsWith("guild") || summary.startsWith("roscoe")
    ? summary
    : `Guild · ${summary}`;
}

export function getToolActivityLiveText(
  toolName: string | null | undefined,
  detail?: string | null,
): string | null {
  const normalizedDetail = normalizeToolActivityDetail(detail);
  if (normalizedDetail && !isGenericToolActivityDetail(toolName, normalizedDetail)) {
    return normalizedDetail;
  }

  const summary = getToolActivitySummary(toolName, detail);
  if (!summary) return null;
  return `${summary[0].toUpperCase()}${summary.slice(1)} now`;
}

export function getToolActivityNoteText(
  toolName: string | null | undefined,
  detail?: string | null,
): string | null {
  const normalizedDetail = normalizeToolActivityDetail(detail);
  if (normalizedDetail && !isGenericToolActivityDetail(toolName, normalizedDetail)) {
    return normalizedDetail;
  }

  return getToolActivitySummary(toolName, detail);
}
