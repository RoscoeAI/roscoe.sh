import { PreviewState, SessionState, TranscriptEntry } from "./types.js";
import { isPauseAcknowledgementText } from "./session-transcript.js";

const EMPTY_PREVIEW_STATE: PreviewState = {
  mode: "off",
  message: null,
  link: null,
};

const URL_PATTERN = /https?:\/\/[^\s<>()\]]+/gi;
const LOCALHOST_PATTERN = /\blocalhost:\d{2,5}(?:\/[^\s<>()\]]*)?/gi;
const PREVIEW_COMMAND_PATTERN = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|preview)\b[^\n]*/i;

type PreviewSource = Pick<SessionState, "timeline" | "outputLines" | "summary">;

function cleanLink(link: string): string {
  return link.replace(/[),.;]+$/, "");
}

function collectPreviewTexts(source: PreviewSource): string[] {
  const timelineTexts = [...source.timeline]
    .reverse()
    .filter((entry): entry is Extract<TranscriptEntry, { text: string }> =>
      entry.kind === "remote-turn" || entry.kind === "tool-activity" || entry.kind === "preview",
    )
    .slice(0, 8)
    .map((entry) => entry.text);

  const outputText = source.outputLines.slice(-40).join("\n").trim();
  return [
    ...timelineTexts,
    ...(source.summary ? [source.summary] : []),
    ...(outputText ? [outputText] : []),
  ];
}

function findPreviewLink(source: PreviewSource): string | null {
  for (const text of collectPreviewTexts(source)) {
    const urlMatch = text.match(URL_PATTERN)?.[0];
    if (urlMatch) {
      return cleanLink(urlMatch);
    }

    const localhostMatch = text.match(LOCALHOST_PATTERN)?.[0];
    if (localhostMatch) {
      return `http://${cleanLink(localhostMatch)}`;
    }
  }

  return null;
}

function findPreviewCommand(source: PreviewSource): string | null {
  for (const text of collectPreviewTexts(source)) {
    const commandMatch = text.match(PREVIEW_COMMAND_PATTERN)?.[0];
    if (commandMatch) {
      return commandMatch.trim();
    }
  }

  return null;
}

function summarizeLatestRemoteTurn(entries: TranscriptEntry[]): string | null {
  const latestRemote = [...entries].reverse().find((entry) => entry.kind === "remote-turn");
  const text = latestRemote?.text.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return null;
  return text.length > 140 ? `${text.slice(0, 137).trimEnd()}...` : text;
}

export function getPreviewState(preview?: PreviewState | null): PreviewState {
  if (!preview || preview.mode === "off") {
    return EMPTY_PREVIEW_STATE;
  }

  return {
    mode: preview.mode,
    message: preview.message ?? null,
    link: preview.link ?? null,
  };
}

export function recoverPreviewState(
  preview: PreviewState | null | undefined,
  source: PreviewSource,
): PreviewState {
  const current = getPreviewState(preview);
  if (current.mode !== "off") {
    return current;
  }

  const latestPreview = [...source.timeline].reverse().find((entry): entry is Extract<TranscriptEntry, { kind: "preview" }> =>
    entry.kind === "preview");
  if (!latestPreview || latestPreview.state !== "queued") {
    return current;
  }

  const latestRemote = [...source.timeline].reverse().find((entry): entry is Extract<TranscriptEntry, { kind: "remote-turn" }> =>
    entry.kind === "remote-turn");
  if (!latestRemote || !isPauseAcknowledgementText(latestRemote.text)) {
    return current;
  }

  return buildReadyPreviewState(source);
}

export function buildQueuedPreviewState(source: PreviewSource): PreviewState {
  const link = findPreviewLink(source);
  return {
    mode: "queued",
    link,
    message: link
      ? `Preview queued. Roscoe will stop at the next clean handoff. Current preview link on deck: ${link}`
      : "Preview queued. Roscoe will stop this lane at the next clean handoff and hold there until you continue.",
  };
}

export function buildReadyPreviewState(source: PreviewSource): PreviewState {
  const link = findPreviewLink(source);
  const command = findPreviewCommand(source);
  const latestRemote = summarizeLatestRemoteTurn(source.timeline);

  if (link) {
    return {
      mode: "ready",
      link,
      message: `Preview ready. Open ${link}, inspect the current app state, then press [c] to continue with a follow-up or [b] to clear the break.`,
    };
  }

  if (command) {
    return {
      mode: "ready",
      link: null,
      message: `Preview ready. No preview link was detected yet. Use \`${command}\` to inspect the current app, then press [c] to continue with a follow-up or [b] to clear the break.`,
    };
  }

  return {
    mode: "ready",
    link: null,
    message: latestRemote
      ? `Preview ready. No preview link was detected yet. Review the latest Guild update: ${latestRemote} Then press [c] to continue with a follow-up or [b] to clear the break.`
      : "Preview ready. No preview link was detected yet. Review the latest Guild update, inspect the current app, then press [c] to continue with a follow-up or [b] to clear the break.",
  };
}
