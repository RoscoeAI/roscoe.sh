import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, measureElement } from "ink";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import { SessionState, TranscriptEntry } from "../types.js";
import { stripAnsi, wrapBlock, wrapLine } from "../text-layout.js";
import { Panel, Pill } from "./chrome.js";
import {
  formatRoscoeDraftDisplayText,
  normalizeLegacySidecarErrorText,
  normalizeRoscoeDraftMessage,
} from "../roscoe-draft.js";
import { getToolActivityLiveText, getToolActivityNoteText } from "../session-activity.js";
import { sortTranscriptEntries } from "../session-transcript.js";
import { renderMd } from "../render-md.js";

interface DisplayLine {
  id: string;
  text: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

type BubbleSide = "left" | "right" | "center";

interface SessionOutputProps {
  session: SessionState | null;
  sessionLabel?: string;
}

export function confidenceColor(confidence?: number): string {
  if (typeof confidence !== "number") return "gray";
  if (confidence >= 80) return "green";
  if (confidence >= 60) return "yellow";
  return "red";
}

export function deliveryColor(delivery: string): string {
  if (delivery === "auto" || delivery === "approved") return "green";
  if (delivery === "edited") return "yellow";
  if (delivery === "manual") return "magenta";
  return "gray";
}

export function addWrappedLines(
  target: DisplayLine[],
  idPrefix: string,
  text: string,
  width: number,
  options: Pick<DisplayLine, "color" | "bold" | "dimColor"> = {},
  indent = "",
  maxLines?: number,
): void {
  const wrapped = wrapBlock(text, width, indent);
  const visible = typeof maxLines === "number"
    ? wrapped.slice(0, maxLines)
    : wrapped;
  const overflowed = typeof maxLines === "number" && wrapped.length > maxLines;

  visible.forEach((line, idx) => {
    target.push({
      id: `${idPrefix}-${idx}`,
      text: line,
      ...options,
    });
  });

  if (overflowed && visible.length > 0) {
    const last = target[target.length - 1];
    target[target.length - 1] = {
      ...last,
      text: `${last.text.slice(0, Math.max(0, last.text.length - 3))}...`,
    };
  }
}

function addSpacer(target: DisplayLine[], id: string): void {
  target.push({ id, text: "" });
}

export function alignLine(text: string, width: number, side: BubbleSide): string {
  const length = stripAnsi(text).length;
  if (side === "right") {
    return `${" ".repeat(Math.max(0, width - length))}${text}`;
  }
  if (side === "center") {
    return `${" ".repeat(Math.max(0, Math.floor((width - length) / 2)))}${text}`;
  }
  return text;
}

function displayWidth(text: string): number {
  return stringWidth(stripAnsi(text));
}

function padDisplayLine(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}

export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|~~~|\|.+\|)|\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*/m.test(text);
}

export function prefersWideBubble(text: string): boolean {
  return /(^|\n)(\|.+\||```|~~~| {4,}\S)/m.test(text);
}

export function wrapTranscriptBody(text: string, width: number): string[] {
  const source = looksLikeMarkdown(text) ? renderMd(text) : text;
  const lines: string[] = [];

  for (const sourceLine of source.replace(/\r/g, "").split("\n")) {
    if (sourceLine === "") {
      lines.push("");
      continue;
    }

    const wrapped = wrapAnsi(sourceLine, Math.max(12, width), {
      hard: true,
      trim: false,
      wordWrap: false,
    });
    lines.push(...wrapped.split("\n"));
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.length > 0 ? lines : [""];
}

function addBubble(
  target: DisplayLine[],
  {
    idPrefix,
    side,
    speaker,
    speakerColor,
    body,
    width,
    bodyDim = false,
    detail,
    detailColor,
    detailDim = true,
  }: {
    idPrefix: string;
    side: BubbleSide;
    speaker: string;
    speakerColor: string;
    body: string;
    width: number;
    bodyDim?: boolean;
    detail?: string | null;
    detailColor?: string;
    detailDim?: boolean;
  },
): void {
  const useWideBubble = prefersWideBubble(body);
  const maxOuterWidth = useWideBubble
    ? Math.max(18, width)
    : Math.max(18, Math.min(width - 2, Math.floor(width * 0.72)));
  const innerLimit = Math.max(14, maxOuterWidth - 4);
  const wrappedBody = wrapTranscriptBody(body, innerLimit);
  const innerWidth = Math.min(
    innerLimit,
    Math.max(14, ...wrappedBody.map((line) => displayWidth(line))),
  );
  const outerWidth = Math.min(width, innerWidth + 4);
  const indent = side === "left"
    ? 0
    : side === "right"
      ? Math.max(0, width - outerWidth)
      : Math.max(0, Math.floor((width - outerWidth) / 2));
  const indentText = " ".repeat(indent);
  const labelText = side === "right"
    ? `${indentText}${alignLine(speaker, outerWidth, "right")}`
    : side === "center"
      ? alignLine(speaker, width, "center")
      : `${indentText}${speaker}`;

  target.push({
    id: `${idPrefix}-speaker`,
    text: labelText,
    color: speakerColor,
    bold: true,
  });
  target.push({
    id: `${idPrefix}-top`,
    text: `${indentText}╭${"─".repeat(innerWidth + 2)}╮`,
    color: speakerColor,
  });
  wrappedBody.forEach((line, index) => {
    target.push({
      id: `${idPrefix}-body-${index}`,
      text: `${indentText}│ ${padDisplayLine(line, innerWidth)} │`,
      dimColor: bodyDim,
    });
  });
  target.push({
    id: `${idPrefix}-bottom`,
    text: `${indentText}╰${"─".repeat(innerWidth + 2)}╯`,
    color: speakerColor,
  });

  if (detail) {
    const wrappedDetail = wrapBlock(detail, innerLimit);
    wrappedDetail.forEach((line, index) => {
      const aligned = side === "right"
        ? `${indentText}${alignLine(line, outerWidth, "right")}`
        : side === "center"
          ? alignLine(line, width, "center")
          : `${indentText}${line}`;
      target.push({
        id: `${idPrefix}-detail-${index}`,
        text: aligned,
        color: detailColor,
        dimColor: detailDim,
      });
    });
  }

  addSpacer(target, `${idPrefix}-gap`);
}

function addSystemNote(
  target: DisplayLine[],
  idPrefix: string,
  text: string,
  width: number,
  color = "gray",
): void {
  wrapBlock(text, Math.max(16, width - 8)).forEach((line, index) => {
    target.push({
      id: `${idPrefix}-${index}`,
      text: `• ${line}`,
      color,
      dimColor: color === "gray",
    });
  });
  addSpacer(target, `${idPrefix}-gap`);
}

export function compactPendingSuggestions(entries: TranscriptEntry[]): TranscriptEntry[] {
  let latestPendingSuggestionIndex = -1;
  entries.forEach((entry, index) => {
    if (entry.kind === "local-suggestion" && entry.state === "pending") {
      latestPendingSuggestionIndex = index;
    }
  });

  if (latestPendingSuggestionIndex === -1) {
    return entries;
  }

  return entries.filter((entry, index) =>
    entry.kind !== "local-suggestion" || entry.state !== "pending" || index === latestPendingSuggestionIndex,
  );
}

export function countTranscriptMessages(entries: TranscriptEntry[]): number {
  return compactPendingSuggestions(entries).length;
}

export function buildHistoricalTranscriptLines(entries: TranscriptEntry[], width: number, session: SessionState): DisplayLine[] {
  const lines: DisplayLine[] = [];
  const guildLabel = session.worktreeName === "main" ? "Guild" : `Guild · ${session.worktreeName}`;

  for (const entry of sortTranscriptEntries(compactPendingSuggestions(entries))) {
    if (entry.kind === "remote-turn") {
      addBubble(lines, {
        idPrefix: entry.id,
        side: "left",
        speaker: `${guildLabel}${entry.activity ? ` · ${entry.activity}` : ` · ${entry.provider}`}`,
        speakerColor: "cyan",
        body: entry.text,
        width,
        detail: entry.note ? `Thinking: ${entry.note}` : undefined,
      });
      continue;
    }

    if (entry.kind === "local-suggestion") {
      const draftText = normalizeRoscoeDraftMessage(entry.text).trim();
      addBubble(lines, {
        idPrefix: entry.id,
        side: "right",
        speaker: `${draftText ? "Roscoe draft" : "Roscoe hold"} · ${entry.confidence}/100${entry.state === "dismissed" ? " · dismissed" : ""}`,
        speakerColor: entry.state === "dismissed" ? "yellow" : confidenceColor(entry.confidence),
        body: formatRoscoeDraftDisplayText(entry.text),
        width,
        bodyDim: entry.state === "dismissed",
        detail: entry.reasoning ? `Why: ${entry.reasoning}` : undefined,
      });
      continue;
    }

    if (entry.kind === "local-sent") {
      const sentText = normalizeRoscoeDraftMessage(entry.text).trim();
      const speakerBase = entry.delivery === "manual"
        ? "You"
        : sentText
          ? "Roscoe"
          : "Roscoe hold";
      addBubble(lines, {
        idPrefix: entry.id,
        side: "right",
        speaker: `${speakerBase} · ${entry.delivery}${typeof entry.confidence === "number" ? ` · ${entry.confidence}/100` : ""}`,
        speakerColor: deliveryColor(entry.delivery),
        body: sentText ? sentText : "No Guild message was sent.",
        width,
        detail: entry.reasoning ? `Why: ${entry.reasoning}` : undefined,
      });
      continue;
    }

    if (entry.kind === "tool-activity") {
      const activityText = getToolActivityNoteText(entry.toolName, entry.text) ?? entry.toolName;
      addSystemNote(
        lines,
        `${entry.id}-tool`,
        `${entry.provider === "twilio" || entry.provider === "roscoe" ? "Roscoe action" : "Guild tool"} · ${activityText}`,
        width,
        entry.provider === "twilio" || entry.provider === "roscoe" ? "magenta" : "yellow",
      );
      continue;
    }

    if (entry.kind === "preview") {
      addSystemNote(
        lines,
        `${entry.id}-preview`,
        `${entry.state === "ready" ? "Preview ready" : "Preview queued"} · ${entry.text}`,
        width,
        entry.state === "ready" ? "magenta" : "cyan",
      );
      continue;
    }

    addSystemNote(
      lines,
      `${entry.id}-error`,
      `${entry.source === "sidecar" ? "Roscoe error" : "Guild error"} · ${entry.source === "sidecar" ? normalizeLegacySidecarErrorText(entry.text) : entry.text}`,
      width,
      "red",
    );
  }

  return lines;
}

export function buildLiveTranscriptLines(session: SessionState, width: number, heartbeat: number): DisplayLine[] {
  const lines: DisplayLine[] = [];
  const guildLabel = session.worktreeName === "main" ? "Guild" : `Guild · ${session.worktreeName}`;
  const heartbeatFrames = ["·  ", "•• ", "•••"];
  const heartbeatFrame = heartbeatFrames[heartbeat % heartbeatFrames.length];
  if (session.suggestion.kind === "generating") {
    addBubble(lines, {
      idPrefix: "live-roscoe-thinking",
      side: "right",
      speaker: "Roscoe",
      speakerColor: "magenta",
      body: `Thinking${heartbeatFrame}`,
      width,
      bodyDim: true,
    });
  } else if (session.suggestion.kind === "manual-input" || session.suggestion.kind === "editing") {
    addBubble(lines, {
      idPrefix: "live-you",
      side: "right",
      speaker: "You",
      speakerColor: "yellow",
      body: "On deck to reply.",
      width,
      bodyDim: true,
    });
  } else if ((session.status === "active" || session.status === "generating") && !session.managed.awaitingInput) {
    addBubble(lines, {
      idPrefix: "live-guild-working",
      side: "left",
      speaker: guildLabel,
      speakerColor: "cyan",
      body: `${getToolActivityLiveText(session.currentToolUse, session.currentToolDetail) ?? "Working now"}${heartbeatFrame}`,
      width,
      bodyDim: true,
    });
  }

  return lines;
}

export function buildRawLines(lines: string[], width: number): DisplayLine[] {
  const output: DisplayLine[] = [];

  lines.forEach((line, index) => {
    const clean = stripAnsi(line).replace(/\r/g, "").replace(/\t/g, "  ");
    const wrapped = clean.trim()
      ? wrapLine(clean, width)
      : [""];

    wrapped.forEach((wrappedLine, wrappedIndex) => {
      output.push({
        id: `raw-${index}-${wrappedIndex}`,
        text: wrappedLine,
      });
    });
  });

  return output;
}

export function SessionOutput({ session, sessionLabel }: SessionOutputProps) {
  const contentRef = useRef<any>(null);
  const [viewport, setViewport] = useState({ width: 80, height: 14 });
  const [heartbeat, setHeartbeat] = useState(0);

  useEffect(() => {
    if (!session || session.viewMode !== "transcript") return;
    const shouldAnimate = session.suggestion.kind === "generating"
      || (session.followLive && ((session.status === "active" || session.status === "generating") && !session.managed.awaitingInput));
    if (!shouldAnimate) return;

    const timer = setInterval(() => {
      setHeartbeat((current) => current + 1);
    }, 220);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!contentRef.current) return;
    const measured = measureElement(contentRef.current);
    if (measured.width > 0 && measured.height > 0) {
      setViewport((current) => {
        if (current.width === measured.width && current.height === measured.height) {
          return current;
        }

        return {
          width: measured.width,
          height: measured.height,
        };
      });
    }
  });

  const title = sessionLabel ? `Lane Transcript — ${sessionLabel}` : "Lane Transcript";
  const contentWidth = Math.max(24, viewport.width - 1);
  const historicalTranscriptLines = useMemo(() => {
    if (!session || session.viewMode !== "transcript") return [];
    return buildHistoricalTranscriptLines(session.timeline, contentWidth, session);
  }, [contentWidth, session?.timeline, session?.viewMode, session?.worktreeName]);
  const liveTranscriptLines = useMemo(() => {
    if (!session || session.viewMode !== "transcript") return [];
    return buildLiveTranscriptLines(session, contentWidth, heartbeat);
  }, [
    contentWidth,
    heartbeat,
    session?.currentToolDetail,
    session?.currentToolUse,
    session?.managed.awaitingInput,
    session?.status,
    session?.suggestion.kind,
    session?.viewMode,
    session?.worktreeName,
  ]);
  const rawLines = useMemo(() => {
    if (!session || session.viewMode !== "raw") return [];
    return buildRawLines(session.outputLines, contentWidth);
  }, [contentWidth, session?.outputLines, session?.viewMode]);
  const renderedLines = session?.viewMode === "transcript"
    ? [...historicalTranscriptLines, ...liveTranscriptLines]
    : rawLines;

  if (!session) {
    return (
        <Panel
          title={title}
          subtitle="Bird's-eye lane view"
          rightLabel="idle"
          accentColor="gray"
          flexGrow={1}
        >
        <Box flexDirection="column">
          <Text dimColor italic>
            Waiting for output...
          </Text>
          <Text dimColor>
            Remote and local turns will appear here once the active lane starts working.
          </Text>
        </Box>
      </Panel>
    );
  }

  const viewportHeight = Math.max(8, viewport.height || 14);
  const maxOffset = Math.max(0, renderedLines.length - viewportHeight);
  const effectiveOffset = session.followLive
    ? 0
    : Math.min(session.scrollOffset, maxOffset);
  const start = Math.max(0, renderedLines.length - viewportHeight - effectiveOffset);
  const visibleLines = renderedLines.slice(start, start + viewportHeight);
  const hiddenAbove = start;
  const hiddenBelow = Math.max(0, renderedLines.length - (start + visibleLines.length));

  return (
    <Panel
      title={title}
      subtitle={session.viewMode === "transcript" ? "One continuous Guild, Roscoe, and user conversation for this lane" : "Raw Guild worker output"}
      rightLabel={
        session.followLive
          ? `${session.viewMode} · live · ${session.viewMode === "transcript" ? `${countTranscriptMessages(session.timeline)} messages` : `${session.outputLines.length} lines`}`
          : `${session.viewMode} · scrolled`
      }
      accentColor={session.viewMode === "transcript" ? "cyan" : "gray"}
      flexGrow={1}
      bodyFlexGrow
    >
      {session.viewMode === "transcript" && session.followLive && hiddenAbove > 0 && (
        <Box marginBottom={1} gap={1}>
          <Pill label="history above" color="yellow" />
          <Text dimColor>{hiddenAbove} earlier lines. Press ↑ to review the prior conversation.</Text>
        </Box>
      )}
      <Box ref={contentRef} flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleLines.length === 0 ? (
          <Box flexDirection="column">
            <Text dimColor italic>
              {session.viewMode === "transcript" ? "No transcript events yet." : "No raw output yet."}
            </Text>
            <Text dimColor>
              {session.viewMode === "transcript"
                ? "The next Guild or Roscoe message will appear here."
                : "Switch back to transcript or wait for the worker to emit more output."}
            </Text>
          </Box>
        ) : (
          visibleLines.map((line) => (
            <Text
              key={line.id}
              color={line.color}
              bold={line.bold}
              dimColor={line.dimColor}
            >
              {line.text || " "}
            </Text>
          ))
        )}
      </Box>
      {!session.followLive && (
        <Box marginTop={1} flexWrap="wrap" gap={1}>
          <Pill label="scrolled" color="yellow" />
          {hiddenAbove > 0 && <Text dimColor>{hiddenAbove} earlier</Text>}
          {hiddenBelow > 0 && <Text dimColor>{hiddenBelow} newer</Text>}
        </Box>
      )}
    </Panel>
  );
}
