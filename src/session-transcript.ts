import { RestoreRecovery, SuggestionPhase, TranscriptEntry } from "./types.js";
import { shouldSuppressRestoredRoscoeSuggestion } from "./roscoe-draft.js";

function isConversationEntry(entry: TranscriptEntry): boolean {
  if (entry.kind === "local-suggestion") {
    return entry.state === "pending";
  }
  return entry.kind === "remote-turn" || entry.kind === "local-sent";
}

export function sortTranscriptEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      if (a.entry.timestamp !== b.entry.timestamp) {
        return a.entry.timestamp - b.entry.timestamp;
      }
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

export function isPauseAcknowledgementText(text: string | null | undefined): boolean {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized === "paused" || normalized === "paused.") {
    return true;
  }

  if (/^still [^.]{1,120}\.\s*paused(?:\.|$)/.test(normalized)) {
    return true;
  }

  if (/^(?:blocked|waiting)[^.]{0,120}\.\s*paused(?:\.|$)/.test(normalized)) {
    return true;
  }

  return false;
}

export function isParkedDecisionText(text: string | null | undefined): boolean {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return false;

  return normalized.startsWith("parked")
    || normalized.startsWith("lane is parked")
    || normalized.startsWith("this lane is parked")
    || normalized.includes("lane remains parked")
    || normalized.includes("lane parked, nothing to direct")
    || normalized.includes("nothing to direct. lane parked");
}

export function isParkedAcknowledgementText(text: string | null | undefined): boolean {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return false;

  return isParkedDecisionText(normalized)
    || normalized.includes("waiting for the next lane delta")
    || normalized.includes("nothing to direct")
    || normalized.includes("no-op. lane remains parked");
}

export function hasTerminalParkedExchange(entries: TranscriptEntry[]): boolean {
  const sorted = sortTranscriptEntries(entries);
  let lastRemoteTurn: TranscriptEntry | null = null;

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const entry = sorted[index];

    if (!lastRemoteTurn) {
      if (entry.kind === "remote-turn") {
        lastRemoteTurn = entry;
      }
      continue;
    }

    if (entry.kind === "local-sent") {
      return isParkedDecisionText(lastRemoteTurn.text) && isParkedDecisionText(entry.text);
    }

    if (entry.kind === "local-suggestion" && entry.state === "pending") {
      return false;
    }
  }

  return false;
}

export function inferTerminalParkedState(
  entries: TranscriptEntry[],
  summary: string | null | undefined = null,
): boolean {
  if (hasTerminalParkedExchange(entries)) {
    return true;
  }

  const lastConversationEntry = getLastConversationEntry(entries);
  if (lastConversationEntry) {
    return isParkedAcknowledgementText(lastConversationEntry.text);
  }

  return isParkedDecisionText(summary);
}

export function hasBoundedFutureWorkSignal(entries: TranscriptEntry[]): boolean {
  const sorted = sortTranscriptEntries(entries);
  const recentConversationEntries = sorted
    .filter((entry) => entry.kind === "remote-turn" || entry.kind === "local-sent")
    .slice(-24);

  return recentConversationEntries.some((entry) => {
    const normalized = (entry.text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    return /(remaining gap|remaining gaps|remaining work|next lane|next slice|next session|later lane|later thread|follow-up remains|open items|deployment thread|bounded follow-up|future thread)/.test(normalized);
  });
}

export function compactRedundantParkedConversation(entries: TranscriptEntry[]): TranscriptEntry[] {
  const sorted = sortTranscriptEntries(entries);
  const compacted: TranscriptEntry[] = [];
  let parkedRun: TranscriptEntry[] = [];

  const flushParkedRun = () => {
    if (parkedRun.length === 0) return;
    compacted.push(...parkedRun.slice(-2));
    parkedRun = [];
  };

  for (const entry of sorted) {
    const isParkedConversationEntry = (entry.kind === "local-sent" || entry.kind === "remote-turn")
      && isParkedDecisionText(entry.text);

    if (isParkedConversationEntry) {
      parkedRun.push(entry);
      continue;
    }

    flushParkedRun();
    compacted.push(entry);
  }

  flushParkedRun();
  return compacted;
}

export function getLastConversationEntry(entries: TranscriptEntry[]): TranscriptEntry | null {
  const sorted = sortTranscriptEntries(entries);
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (isConversationEntry(sorted[index])) {
      return sorted[index];
    }
  }
  return null;
}

export function inferAwaitingInput(
  entries: TranscriptEntry[],
  currentToolUse: string | null,
): boolean {
  if (currentToolUse) return false;
  const lastEntry = getLastConversationEntry(entries);
  if (!lastEntry) return true;
  if (lastEntry.kind === "remote-turn") return true;
  if (lastEntry.kind === "local-suggestion") return lastEntry.state === "pending";
  return false;
}

function normalizeInlineText(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(80, maxLength - 3)).trimEnd()}...`;
}

function humanizeToolName(toolName: string | null): string {
  if (!toolName) return "Guild";
  return toolName.replace(/[_-]+/g, " ").trim().toLowerCase();
}

export function getRestoreRecoveryPlan(
  entries: TranscriptEntry[],
  providerSessionId: string | null,
  currentToolUse: string | null,
): RestoreRecovery | null {
  const lastEntry = getLastConversationEntry(entries);
  if (!lastEntry || lastEntry.kind !== "local-sent") {
    return null;
  }

  const handoff = normalizeInlineText(lastEntry.text, 260);
  const interruptedTurn = currentToolUse
    ? ` during ${humanizeToolName(currentToolUse)}`
    : "";

  if (!providerSessionId) {
    return {
      mode: "restage-roscoe",
      note: "Roscoe restored this lane after restart and is restaging the interrupted Guild turn from the last stable handoff.",
    };
  }

  return {
    mode: "resume-worker",
    prompt: [
      `Roscoe restarted this lane while your previous turn was interrupted${interruptedTurn}. Continue from the same lane state.`,
      "Do not restart the whole investigation or repeat already-completed exploratory work unless it is needed to verify partial progress.",
      handoff ? `Last stable Roscoe handoff: ${handoff}` : "",
      "First check whether any partial edits or proof results already landed, then take the next concrete step and report back normally.",
    ].filter(Boolean).join(" "),
    note: currentToolUse
      ? `Roscoe resumed the interrupted Guild turn after restart (${humanizeToolName(currentToolUse)}).`
      : "Roscoe resumed the interrupted Guild turn after restart.",
  };
}

export function getInterruptedExitRecoveryPlan(
  entries: TranscriptEntry[],
  providerSessionId: string | null,
  currentToolUse: string | null,
): RestoreRecovery | null {
  const lastEntry = getLastConversationEntry(entries);
  if (!lastEntry || lastEntry.kind !== "local-sent") {
    return null;
  }

  const handoff = normalizeInlineText(lastEntry.text, 260);
  const interruptedTurn = currentToolUse
    ? ` during ${humanizeToolName(currentToolUse)}`
    : "";

  if (!providerSessionId) {
    return {
      mode: "restage-roscoe",
      note: "Roscoe detected that the Guild turn exited before reporting back and is restaging from the last stable handoff.",
    };
  }

  return {
    mode: "resume-worker",
    prompt: [
      `The Guild turn exited before reporting back${interruptedTurn}. Continue from the same lane state.`,
      "Do not restart the whole investigation or repeat already-completed exploratory work unless it is needed to verify partial progress.",
      handoff ? `Last stable Roscoe handoff: ${handoff}` : "",
      "First check whether any partial edits or proof results already landed, then take the next concrete step and report back normally.",
    ].filter(Boolean).join(" "),
    note: currentToolUse
      ? `Roscoe detected that the Guild turn exited during ${humanizeToolName(currentToolUse)} and is resuming from the last stable handoff.`
      : "Roscoe detected that the Guild turn exited before reporting back and is resuming from the last stable handoff.",
  };
}

export function getRestoredSuggestionPhase(entries: TranscriptEntry[]): SuggestionPhase {
  const sorted = sortTranscriptEntries(entries);
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const entry = sorted[index];
    if (entry.kind === "local-suggestion" && entry.state === "pending") {
      if (shouldSuppressRestoredRoscoeSuggestion({ decision: entry.decision, message: entry.text, reasoning: entry.reasoning })) {
        return { kind: "idle" };
      }
      return {
        kind: "ready",
        result: {
          decision: entry.decision,
          text: entry.text,
          confidence: entry.confidence,
          reasoning: entry.reasoning,
        },
      };
    }
  }
  return { kind: "idle" };
}

export function normalizeRestoredTimeline(entries: TranscriptEntry[]): TranscriptEntry[] {
  return sortTranscriptEntries(entries).map((entry) => {
    if (
      entry.kind === "local-suggestion"
      && entry.state === "pending"
      && shouldSuppressRestoredRoscoeSuggestion({ decision: entry.decision, message: entry.text, reasoning: entry.reasoning })
    ) {
      return {
        ...entry,
        state: "dismissed" as const,
      };
    }
    return entry;
  });
}
