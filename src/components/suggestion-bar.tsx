import React, { useState, useMemo } from "react";
import { Box, Text } from "ink";
import { Spinner, Badge } from "@inkjs/ui";
import { PreviewState, SessionStatus, SuggestionPhase } from "../types.js";
import { renderMd } from "../render-md.js";
import { KeyHints, Panel, Pill } from "./chrome.js";
import { formatRoscoeDraftDisplayText, inferRoscoeDecision, normalizeRoscoeDraftMessage } from "../roscoe-draft.js";
import { getPreviewState } from "../session-preview.js";
import { CommandTextInput } from "./command-text-input.js";

const GENERATING_PARTIAL_MAX_CHARS = 240;
const GENERATING_PARTIAL_MAX_LINES = 3;

function isPermissionBlockedSummary(summary: string | null): boolean {
  if (!summary) return false;
  return /(sandbox|permission|approval|den(?:y|ied))/i.test(summary);
}

function isParkedSummary(summary: string | null): boolean {
  if (!summary) return false;
  return /\bparked\b/i.test(summary);
}

function confidenceColor(confidence: number): string {
  if (confidence >= 80) return "green";
  if (confidence >= 60) return "yellow";
  return "red";
}

interface SuggestionBarProps {
  phase: SuggestionPhase;
  sessionStatus?: SessionStatus;
  sessionSummary?: string | null;
  preview?: PreviewState;
  autoMode?: boolean;
  autoSendThreshold?: number;
  toolActivity?: string | null;
  toolActivityDetail?: string | null;
  canInterruptActiveTurn?: boolean;
  onSubmitEdit: (text: string) => void;
  onSubmitManual: (text: string) => void;
}

function GeneratingView({ partial }: { partial?: string }) {
  const rendered = useMemo(() => {
    if (!partial) return "";
    const tail = partial.length > GENERATING_PARTIAL_MAX_CHARS
      ? partial.slice(-GENERATING_PARTIAL_MAX_CHARS)
      : partial;
    return renderMd(tail)
      .split("\n")
      .slice(-GENERATING_PARTIAL_MAX_LINES)
      .join("\n");
  }, [partial]);

  return (
    <Box flexDirection="column">
      <Spinner label="Thinking..." />
      {rendered && (
        <Box marginTop={0} paddingLeft={1} flexDirection="column">
          <Text dimColor>Draft in progress</Text>
          <Text dimColor>{rendered}</Text>
        </Box>
      )}
    </Box>
  );
}

export function SuggestionBar({
  phase,
  sessionStatus = "idle",
  sessionSummary = null,
  preview,
  autoMode = false,
  autoSendThreshold = 70,
  toolActivity,
  toolActivityDetail,
  canInterruptActiveTurn = false,
  onSubmitEdit,
  onSubmitManual,
}: SuggestionBarProps) {
  const [editResetKey, setEditResetKey] = useState(0);
  const [manualResetKey, setManualResetKey] = useState(0);
  const previewState = getPreviewState(preview);
  const readyText = phase.kind === "ready" ? normalizeRoscoeDraftMessage(phase.result.text).trim() : "";
  const readyIsHold = phase.kind === "ready" && !readyText;
  const readyDecision = phase.kind === "ready"
    ? inferRoscoeDecision({
        decision: phase.result.decision,
        message: phase.result.text,
        reasoning: phase.result.reasoning,
      })
    : null;
  const readyExplicitReview = readyDecision === "needs-review" && !readyIsHold;
  const readyNeedsReview = phase.kind === "ready" && (readyExplicitReview || !autoMode || phase.result.confidence < autoSendThreshold);
  const readyWillAutoAct = phase.kind === "ready" && autoMode && !readyNeedsReview;
  const subtitle = phase.kind === "ready"
    ? readyNeedsReview
      ? readyExplicitReview
        ? "AUTO is on, but Roscoe marked this draft for review before anything is sent."
        : autoMode
          ? `AUTO is on, but this draft is below the ${autoSendThreshold}/100 send threshold and still needs review.`
          : "Roscoe drafted the next message to send to the Guild. Manual approval is enabled."
      : readyIsHold
        ? "AUTO is on. Roscoe is holding the Guild reply unless you override it."
        : "AUTO is on. Roscoe will send this to the Guild unless you override it."
    : phase.kind === "auto-sent"
      ? phase.text.trim()
        ? "Roscoe sent the draft to the Guild automatically."
        : "Roscoe is blocked waiting for a real unblock from you. Nothing was sent to the Guild."
    : phase.kind === "editing"
      ? "Edit Roscoe's draft before it is sent. Esc cancels."
      : phase.kind === "manual-input"
        ? "Write your own message to the Guild. Esc cancels."
        : phase.kind === "error"
          ? "Roscoe's sidecar did not finish. Nothing was sent to the Guild."
          : "Approve, reshape, or override the next message";
  const minHeight = phase.kind === "ready" || phase.kind === "generating" || phase.kind === "auto-sent" || phase.kind === "error"
    ? 8
    : phase.kind === "editing" || phase.kind === "manual-input"
      ? 7
      : 6;
  const readyPillLabel = phase.kind === "ready"
    ? readyNeedsReview
      ? readyExplicitReview ? "review draft" : autoMode ? "needs review" : "approval required"
      : readyIsHold ? "auto hold" : "auto send"
    : null;
  const readyHints = phase.kind === "ready"
    ? readyNeedsReview
      ? [
          { keyLabel: "a", description: "send" },
          { keyLabel: "e", description: "edit" },
          { keyLabel: "r", description: "hold" },
          { keyLabel: "m", description: "manual" },
          { keyLabel: "h", description: "dispatch" },
        ]
      : readyIsHold
        ? [
          { keyLabel: "m", description: "manual override" },
          { keyLabel: "h", description: "dispatch" },
        ]
        : [
            { keyLabel: "e", description: "edit" },
            { keyLabel: "r", description: "hold" },
            { keyLabel: "m", description: "manual override" },
            { keyLabel: "h", description: "dispatch" },
          ]
    : [];
  const hasLiveActivity = Boolean(toolActivity || toolActivityDetail);
  const showingPreview = previewState.mode !== "off";
  const showingPaused = !showingPreview && phase.kind === "idle" && sessionStatus === "paused";
  const showingBlocked = !showingPreview && phase.kind === "idle" && sessionStatus === "blocked";
  const showingParked = !showingPreview
    && phase.kind === "idle"
    && (sessionStatus === "parked" || (sessionStatus === "waiting" && !hasLiveActivity && isParkedSummary(sessionSummary)));
  const showingWaiting = !showingPreview
    && phase.kind === "idle"
    && sessionStatus === "waiting"
    && !hasLiveActivity
    && !showingParked;
  const previewSubtitle = previewState.mode === "queued"
    ? "Roscoe will stop this lane at the next clean handoff and hold there for preview."
    : "Roscoe is holding the lane for preview until you continue.";
  const previewHints = previewState.mode === "ready"
    ? [
        { keyLabel: "c", description: "continue" },
        { keyLabel: "b", description: "clear preview" },
      ]
    : [
        ...(canInterruptActiveTurn ? [{ keyLabel: "x", description: "force preview" }] : []),
        { keyLabel: "b", description: "clear preview" },
      ];
  const blockedByPermissions = showingBlocked && isPermissionBlockedSummary(sessionSummary);

  return (
    <Panel
      title={showingPreview ? "Preview Break" : showingPaused ? "Lane Paused" : showingBlocked ? "Lane Blocked" : showingParked ? "Lane Parked" : showingWaiting ? "Lane Waiting" : "Command Deck"}
      subtitle={showingPreview
        ? previewSubtitle
        : showingPaused
          ? "You paused this lane manually. Nothing else will run until you resume it or send a new instruction."
          : showingBlocked
            ? "Guild reported a blocker and Roscoe is holding this lane. Press p to resume anyway or m to send a new instruction."
            : showingParked
              ? "Roscoe parked this lane cleanly. Nothing is actively running; resume it or send the next instruction when you want to continue."
              : showingWaiting
                ? "Roscoe is not running anything on this lane right now. Send the next instruction when you want to continue."
              : subtitle}
      rightLabel={showingPreview ? previewState.mode : showingPaused ? "paused" : showingBlocked ? "blocked" : showingParked ? "parked" : showingWaiting ? "waiting" : toolActivity ? `tool ${toolActivity}` : phase.kind}
      accentColor={showingPreview ? "magenta" : showingPaused || showingBlocked ? "yellow" : showingParked || showingWaiting ? "blue" : phase.kind === "error" ? "red" : phase.kind === "ready" ? "yellow" : phase.kind === "manual-input" || phase.kind === "editing" ? "magenta" : "gray"}
      minHeight={showingPreview ? 7 : minHeight}
      height={phase.kind === "generating" ? minHeight : undefined}
      flexShrink={0}
    >
      {showingPreview && (
        <Box flexDirection="column" gap={1}>
          <Text color={previewState.mode === "ready" ? "magenta" : "cyan"}>
            {previewState.message ?? (previewState.mode === "queued" ? "Preview queued." : "Preview ready.")}
          </Text>
          {previewState.link && (
            <Text color="cyan">{previewState.link}</Text>
          )}
          <KeyHints items={previewHints} />
        </Box>
      )}

      {!showingPreview && phase.kind === "idle" && (
        <Box flexDirection="column" gap={1}>
          {showingPaused || showingBlocked || showingParked || showingWaiting ? (
            <>
              <Box gap={1} flexWrap="wrap">
                <Pill label={showingPaused ? "paused" : showingBlocked ? "blocked" : showingParked ? "parked" : "waiting"} color={showingParked || showingWaiting ? "blue" : "yellow"} />
                <Text dimColor>{sessionSummary?.trim() || (showingPaused
                  ? "You intentionally paused this lane."
                  : showingBlocked
                    ? "Guild is waiting on a blocker and Roscoe will not keep sending hold messages."
                    : showingParked
                      ? "Roscoe reached a clean stop point and is waiting for the next intentional pickup."
                      : "Roscoe is waiting for the next explicit operator move on this lane.")}</Text>
              </Box>
              {showingBlocked && (
                <Box flexDirection="column">
                  <Text dimColor>
                    This is a blocker hold, not preview mode. Nothing else will run automatically until you resume it.
                  </Text>
                  {blockedByPermissions && (
                    <Text dimColor>
                      This blocker is coming from the Guild lane running in safe mode. Roscoe can now carry approved local Git staging, commit, and push steps for shared worktree metadata blockers; use <Text color="cyan">u</Text> to switch Guild execution to accelerated when the blocker is broader than Git.
                    </Text>
                  )}
                </Box>
              )}
              {showingPaused && (
                <Text dimColor>
                  This is a manual pause. Resume it when you want Guild work to continue.
                </Text>
              )}
              {showingParked && (
                <Text dimColor>
                  This is a clean parking state, not a failure. Resume it when you want the next slice picked up.
                </Text>
              )}
              {showingWaiting && (
                <Text dimColor>
                  Nothing is currently running. This usually means Roscoe is waiting for your next direction after a dismissed draft or a completed handoff.
                </Text>
              )}
              <KeyHints items={[
                ...(showingWaiting ? [] : [{ keyLabel: "p", description: "resume" }]),
                { keyLabel: "m", description: "type a message" },
                { keyLabel: "h", description: "dispatch" },
              ]} />
            </>
          ) : (
            <>
              <Box gap={1}>
                {toolActivity ? (
                  <>
                    <Spinner label="" />
                    <Text color="cyan">{toolActivityDetail ?? toolActivity}</Text>
                  </>
                ) : (
                  <Text dimColor>Lane working...</Text>
                )}
              </Box>
              <KeyHints items={[
                ...(canInterruptActiveTurn ? [{ keyLabel: "x", description: "interrupt" }] : []),
                { keyLabel: "b", description: "preview" },
                { keyLabel: "m", description: "type a message" },
              ]} />
            </>
          )}
        </Box>
      )}

      {!showingPreview && phase.kind === "generating" && (
        <GeneratingView partial={phase.partial} />
      )}

      {!showingPreview && phase.kind === "ready" && (
        <Box flexDirection="column">
          <Text dimColor>{readyWillAutoAct ? "Roscoe auto decision for the Guild" : "Roscoe draft to the Guild"}</Text>
          <Text bold>{formatRoscoeDraftDisplayText(phase.result.text)}</Text>
          <Box gap={1} marginTop={1}>
            <Badge color={confidenceColor(phase.result.confidence)}>
              {phase.result.confidence}/100
            </Badge>
            {readyPillLabel && (
              <Pill
                label={readyPillLabel}
                color={confidenceColor(phase.result.confidence)}
              />
            )}
            {phase.result.reasoning && (
              <Text dimColor>Why: {phase.result.reasoning}</Text>
            )}
          </Box>
          <Box marginTop={1}>
            <KeyHints items={readyHints} />
          </Box>
        </Box>
      )}

      {!showingPreview && phase.kind === "editing" && (
        <Box flexDirection="column">
          <Text dimColor>Original Roscoe draft: {phase.original}</Text>
          <Box marginTop={1}>
            <Text color="yellow">Message to Guild: </Text>
            <CommandTextInput
              key={editResetKey}
              value={phase.original}
              onSubmit={(val) => {
                onSubmitEdit(val || phase.original);
                setEditResetKey((k) => k + 1);
              }}
            />
          </Box>
          <Box marginTop={1}>
            <KeyHints items={[{ keyLabel: "Esc", description: "cancel" }]} />
          </Box>
        </Box>
      )}

      {!showingPreview && phase.kind === "manual-input" && (
        <Box flexDirection="column">
          <Text dimColor>Manual message to the Guild</Text>
          <Box marginTop={1}>
            <Text color="yellow">Message to Guild: </Text>
            <CommandTextInput
              key={manualResetKey}
              placeholder="Type your message..."
              onSubmit={(val) => {
                if (val.trim()) {
                  onSubmitManual(val.trim());
                  setManualResetKey((k) => k + 1);
                }
              }}
            />
          </Box>
          <Box marginTop={1}>
            <KeyHints items={[{ keyLabel: "Esc", description: "cancel" }]} />
          </Box>
        </Box>
      )}

      {!showingPreview && phase.kind === "error" && (
        <Box flexDirection="column">
          <Text color="red">Roscoe error: {phase.message}</Text>
          <Box marginTop={1}>
            <KeyHints
              items={[
                { keyLabel: "r", description: "retry" },
                { keyLabel: "m", description: "manual" },
                { keyLabel: "n", description: "add lane" },
              ]}
            />
          </Box>
        </Box>
      )}

      {!showingPreview && phase.kind === "auto-sent" && (
        <Box flexDirection="column">
          {phase.text.trim() ? (
            <>
              <Text color="green">
                Auto-sent ({phase.confidence}/100):
              </Text>
              <Text dimColor>
                {phase.text.length > 60 ? `"${phase.text.slice(0, 60)}..."` : `"${phase.text}"`}
              </Text>
            </>
          ) : (
            <>
              <Text color="yellow">Roscoe auto-held the Guild reply.</Text>
              <Text dimColor>Nothing was sent because the current transcript still requires silence until the blocker changes.</Text>
              <Box gap={1} marginTop={1}>
                <Badge color={confidenceColor(phase.confidence)}>
                  {phase.confidence}/100
                </Badge>
                <Pill label="waiting on you" color="yellow" />
              </Box>
              <Box marginTop={1}>
                <KeyHints
                  items={[
                    { keyLabel: "m", description: "manual override" },
                    { keyLabel: "n", description: "add lane" },
                  ]}
                />
              </Box>
            </>
          )}
        </Box>
      )}
    </Panel>
  );
}
