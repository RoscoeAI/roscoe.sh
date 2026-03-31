import { PreviewState, SessionStatus, SuggestionPhase } from "./types.js";

export interface SmsLaneTarget {
  id: string;
  projectName: string;
  worktreeName: string;
  status: SessionStatus;
  summary?: string | null;
  preview?: PreviewState;
  suggestionKind?: SuggestionPhase["kind"];
  currentToolUse?: string | null;
  currentToolDetail?: string | null;
  awaitingInput?: boolean;
}

export interface ResolvedSmsMessage {
  kind: "status" | "message" | "help" | "approve" | "hold" | "resume";
  targetId: string | null;
  text: string;
  responseText?: string;
}

function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase();
}

export function formatSmsLaneScope(target: Pick<SmsLaneTarget, "projectName" | "worktreeName">): string {
  return target.worktreeName === "main"
    ? target.projectName
    : `${target.projectName}/${target.worktreeName}`;
}

function isStatusCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  return normalized === "status"
    || normalized === "check in"
    || normalized === "checkin"
    || normalized === "update"
    || normalized === "summary"
    || normalized === "what's up";
}

function isHelpCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  return normalized === "help" || normalized === "?";
}

function isApproveCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  return normalized === "approve"
    || normalized === "send"
    || normalized === "send it"
    || normalized === "approve draft"
    || normalized === "send draft";
}

function isHoldCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  return normalized === "hold"
    || normalized === "reject"
    || normalized === "dismiss"
    || normalized === "don't send"
    || normalized === "do not send";
}

function isResumeCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  return normalized === "resume"
    || normalized === "continue"
    || normalized === "unpause"
    || normalized === "keep going";
}

export function buildSmsHelpText(target: SmsLaneTarget | null, laneCount: number): string {
  if (!target) {
    return laneCount > 1
      ? "Roscoe has multiple live lanes. Prefix your text with a lane scope, for example \"appsicle: status\" or \"nanobots/auth: approve\"."
      : "Text \"status\" for a quick check-in, \"approve\" to send a waiting Roscoe draft, \"hold\" to keep it unsent, \"resume\" to continue a paused lane, or send freeform guidance.";
  }

  const scope = formatSmsLaneScope(target);
  const commands = ["\"status\""];
  if (target.suggestionKind === "ready") {
    commands.push("\"approve\"", "\"hold\"");
  }
  if (target.status === "paused" || target.status === "blocked" || target.status === "parked") {
    commands.push("\"resume\"");
  }
  commands.push("freeform guidance");
  return `Roscoe SMS commands for ${scope}: ${commands.join(", ")}.`;
}

function extractScopePrefix(
  body: string,
): { scope: string | null; text: string } {
  const match = body.match(/^\s*([a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?)\s*:\s*(.+)$/);
  if (!match) {
    return { scope: null, text: body.trim() };
  }

  return {
    scope: match[1].trim(),
    text: match[2].trim(),
  };
}

function findLaneByScope(scope: string, lanes: SmsLaneTarget[]): SmsLaneTarget | null {
  const normalized = normalizeScope(scope);
  const exact = lanes.find((lane) => normalizeScope(formatSmsLaneScope(lane)) === normalized);
  if (exact) return exact;

  const projectMatches = lanes.filter((lane) => normalizeScope(lane.projectName) === normalized);
  return projectMatches.length === 1 ? projectMatches[0] : null;
}

function buildAmbiguousResponse(lanes: SmsLaneTarget[]): string {
  const scopes = lanes.map((lane) => formatSmsLaneScope(lane)).slice(0, 4);
  const exampleScope = scopes[0] ?? "project";
  return `Roscoe has ${lanes.length} live lanes. Prefix your text with a lane scope, for example "${exampleScope}: status" or "${exampleScope}: keep going".`;
}

function buildNoLaneResponse(): string {
  return "Roscoe has no live lanes right now. Start a lane in the TUI first, then text \"status\" or send guidance here.";
}

export function resolveInboundSmsMessage(
  body: string,
  lanes: SmsLaneTarget[],
): ResolvedSmsMessage {
  const normalizedBody = body.replace(/\s+/g, " ").trim();
  if (!normalizedBody) {
    return {
      kind: "help",
      targetId: null,
      text: "",
      responseText: "Roscoe received an empty text. Reply with \"status\" for a quick check-in or send guidance for a lane.",
    };
  }

  const { scope, text } = extractScopePrefix(normalizedBody);
  const scopedTarget = scope ? findLaneByScope(scope, lanes) : null;
  const target = scopedTarget ?? (lanes.length === 1 ? lanes[0] : null);

  if (scope && !scopedTarget && lanes.length > 1) {
    return {
      kind: "help",
      targetId: null,
      text,
      responseText: lanes.length > 0
        ? `Roscoe could not match "${scope}". Try one of: ${lanes.map((lane) => formatSmsLaneScope(lane)).join(", ")}.`
        : buildNoLaneResponse(),
    };
  }

  if (!target && lanes.length === 0) {
    return {
      kind: "help",
      targetId: null,
      text,
      responseText: buildNoLaneResponse(),
    };
  }

  if (!target && lanes.length > 1) {
    return {
      kind: isStatusCommand(text)
        ? "status"
        : isApproveCommand(text)
          ? "approve"
          : isHoldCommand(text)
            ? "hold"
            : isResumeCommand(text)
              ? "resume"
              : "message",
      targetId: null,
      text,
      responseText: buildAmbiguousResponse(lanes),
    };
  }

  if (isHelpCommand(text)) {
    return {
      kind: "help",
      targetId: target?.id ?? null,
      text,
      responseText: target
        ? buildSmsHelpText(target, lanes.length)
        : buildAmbiguousResponse(lanes),
    };
  }

  return {
    kind: isStatusCommand(text)
      ? "status"
      : isApproveCommand(text)
        ? "approve"
        : isHoldCommand(text)
          ? "hold"
          : isResumeCommand(text)
            ? "resume"
            : "message",
    targetId: target?.id ?? null,
    text,
  };
}

export function buildSmsStatusText(target: SmsLaneTarget): string {
  const scope = formatSmsLaneScope(target);
  const statusLabel = target.preview?.mode === "ready"
    ? "preview ready"
    : target.preview?.mode === "queued"
      ? "preview queued"
      : target.status === "paused"
        ? "paused on blocker"
        : target.suggestionKind === "ready"
          ? "needs review"
          : target.suggestionKind === "manual-input"
            ? "waiting for your message"
            : target.awaitingInput
              ? "waiting"
              : target.currentToolDetail
                ? target.currentToolDetail
                : target.currentToolUse
                  ? target.currentToolUse
                  : target.status;
  const summary = target.summary?.replace(/\s+/g, " ").trim();
  const parts = [`Roscoe status for ${scope}: ${statusLabel}.`];
  if (summary) {
    parts.push(summary);
  }
  if (target.suggestionKind === "ready") {
    parts.push("Reply \"approve\" to send the draft, \"hold\" to keep it unsent, or text \"help\" for SMS commands.");
  } else if (target.status === "paused" || target.status === "blocked" || target.status === "parked") {
    parts.push("Reply \"resume\" to continue this lane, or text \"help\" for SMS commands.");
  } else {
    parts.push("Reply here with guidance, or text \"help\" for SMS commands.");
  }
  const body = parts.join(" ");
  return body.length > 620 ? `${body.slice(0, 617).trimEnd()}...` : body;
}
