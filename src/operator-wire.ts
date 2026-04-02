import React from "react";
import { SessionManagerService } from "./services/session-manager.js";
import { AppAction, PendingOperatorMessage, SessionState, TranscriptEntry } from "./types.js";
import { getPreviewState } from "./session-preview.js";
import {
  buildSmsStatusText,
  formatSmsLaneScope,
  resolveInboundSmsMessage,
} from "./sms-routing.js";
import { getResumePrompt } from "./session-control.js";

let operatorEntryCounter = 0;

export interface InboundOperatorReply {
  id: string;
  body: string;
  answerText: string;
  from: string;
  receivedAt: number;
  token?: string;
  matchedSessionId?: string;
  via: "sms" | "hosted-sms";
}

interface ProcessInboundOperatorRepliesOptions {
  replies: InboundOperatorReply[];
  sessions: Map<string, SessionState>;
  dispatch: React.Dispatch<AppAction>;
  service: SessionManagerService;
  provider: string;
  toolName: string;
  sourceLabel: string;
}

function createOperatorEntry(
  prefix: string,
  sessionId: string,
  provider: string,
  toolName: string,
  text: string,
): TranscriptEntry {
  operatorEntryCounter += 1;
  return {
    id: `${prefix}-${sessionId}-${Date.now()}-${operatorEntryCounter}`,
    timestamp: Date.now(),
    kind: "tool-activity",
    provider,
    toolName,
    text,
  };
}

function createPendingOperatorMessage(
  sessionId: string,
  text: string,
  via: PendingOperatorMessage["via"],
  from?: string | null,
  token?: string,
): PendingOperatorMessage {
  operatorEntryCounter += 1;
  return {
    id: `${via}-pending-${sessionId}-${Date.now()}-${operatorEntryCounter}`,
    text,
    via,
    from: from ?? null,
    receivedAt: Date.now(),
    token,
  };
}

function canAutoInjectOperatorMessage(session: SessionState): boolean {
  return session.managed.awaitingInput
    && session.suggestion.kind !== "editing"
    && session.suggestion.kind !== "manual-input"
    && session.suggestion.kind !== "generating";
}

async function approveSuggestionFromOperator(
  session: SessionState,
  dispatch: React.Dispatch<AppAction>,
  service: SessionManagerService,
  provider: string,
  toolName: string,
  sourceLabel: string,
): Promise<string> {
  if (session.suggestion.kind !== "ready") {
    return `Roscoe has no pending draft waiting for approval on ${formatSmsLaneScope(session)}.`;
  }

  const sentText = await service.executeSuggestion(session.managed, session.suggestion.result);
  dispatch({ type: "SYNC_MANAGED_SESSION", id: session.id, managed: session.managed });
  dispatch({ type: "APPROVE_SUGGESTION", id: session.id, text: sentText });
  dispatch({
    type: "APPEND_TIMELINE_ENTRY",
    id: session.id,
    entry: createOperatorEntry(
      "operator-approve",
      session.id,
      provider,
      toolName,
      `Roscoe sent the pending Guild draft after a ${sourceLabel.toLowerCase()} approval.`,
    ),
  });
  return `Approved and sent Roscoe's pending draft to ${formatSmsLaneScope(session)}.`;
}

function holdSuggestionFromOperator(
  session: SessionState,
  dispatch: React.Dispatch<AppAction>,
  provider: string,
  toolName: string,
  sourceLabel: string,
): string {
  if (session.suggestion.kind !== "ready") {
    if (session.status === "paused" || session.status === "blocked" || session.status === "parked") {
      return `${formatSmsLaneScope(session)} is already holding.`;
    }
    return `Roscoe has no pending draft to hold on ${formatSmsLaneScope(session)}.`;
  }

  dispatch({ type: "REJECT_SUGGESTION", id: session.id });
  dispatch({
    type: "APPEND_TIMELINE_ENTRY",
    id: session.id,
    entry: createOperatorEntry(
      "operator-hold",
      session.id,
      provider,
      toolName,
      `Roscoe held the pending Guild draft after a ${sourceLabel.toLowerCase()} hold command.`,
    ),
  });
  return `Held Roscoe's pending draft for ${formatSmsLaneScope(session)}.`;
}

function resumeLaneFromOperator(
  session: SessionState,
  dispatch: React.Dispatch<AppAction>,
  service: SessionManagerService,
  provider: string,
  toolName: string,
  sourceLabel: string,
): string {
  if (session.status !== "paused" && session.status !== "blocked" && session.status !== "parked") {
    return `${formatSmsLaneScope(session)} is not paused right now.`;
  }

  const managed = session.managed;
  managed._paused = false;
  const resumePrompt = getResumePrompt(session);

  if (managed.awaitingInput) {
    service.injectText(managed, resumePrompt);
    dispatch({ type: "SYNC_MANAGED_SESSION", id: session.id, managed });
    dispatch({ type: "RESUME_SESSION", id: session.id });
  } else {
    service.prepareWorkerTurn(managed, resumePrompt);
    dispatch({ type: "SYNC_MANAGED_SESSION", id: session.id, managed });
    managed.monitor.startTurn(resumePrompt);
    dispatch({ type: "RESUME_SESSION", id: session.id });
  }

  dispatch({
    type: "APPEND_TIMELINE_ENTRY",
    id: session.id,
    entry: createOperatorEntry(
      "operator-resume",
      session.id,
      provider,
      toolName,
      `Roscoe resumed this lane after a ${sourceLabel.toLowerCase()} resume command.`,
    ),
  });
  return `Resumed ${formatSmsLaneScope(session)}.`;
}

export async function processInboundOperatorReplies({
  replies,
  sessions,
  dispatch,
  service,
  provider,
  toolName,
  sourceLabel,
}: ProcessInboundOperatorRepliesOptions): Promise<void> {
  for (const reply of replies) {
    const liveSessions = Array.from(sessions.values())
      .filter((session) => session.status !== "exited");
    const resolved = reply.matchedSessionId
      ? {
          kind: "message" as const,
          targetId: reply.matchedSessionId,
          text: reply.answerText,
        }
      : resolveInboundSmsMessage(
          reply.answerText,
          liveSessions.map((session) => ({
            id: session.id,
            projectName: session.projectName,
            worktreeName: session.worktreeName,
            status: session.status,
            summary: session.summary,
            preview: getPreviewState(session.preview),
            suggestionKind: session.suggestion.kind,
            currentToolUse: session.currentToolUse,
            currentToolDetail: session.currentToolDetail ?? null,
            awaitingInput: session.managed.awaitingInput,
          })),
        );

    if (resolved.responseText) {
      void service.notifications.sendOperatorMessage(resolved.responseText);
    }

    if (resolved.kind === "help" || !resolved.targetId) {
      continue;
    }

    const session = sessions.get(resolved.targetId);
    if (!session) continue;
    const scope = formatSmsLaneScope(session);
    const inboundNote = resolved.kind === "status"
      ? `${sourceLabel} check-in${reply.token ? ` ${reply.token}` : ""} from ${reply.from}.`
      : `${sourceLabel} ${resolved.kind}${reply.token ? ` ${reply.token}` : ""} from ${reply.from}: ${resolved.text}`;

    dispatch({
      type: "APPEND_TIMELINE_ENTRY",
      id: session.id,
      entry: createOperatorEntry("operator-reply", session.id, provider, toolName, inboundNote),
    });

    if (resolved.kind === "status") {
      void service.notifications.sendOperatorMessage(buildSmsStatusText({
        id: session.id,
        projectName: session.projectName,
        worktreeName: session.worktreeName,
        status: session.status,
        summary: session.summary,
        preview: getPreviewState(session.preview),
        suggestionKind: session.suggestion.kind,
        currentToolUse: session.currentToolUse,
        currentToolDetail: session.currentToolDetail ?? null,
        awaitingInput: session.managed.awaitingInput,
      }));
      continue;
    }

    if (resolved.kind === "approve") {
      void service.notifications.sendOperatorMessage(
        await approveSuggestionFromOperator(session, dispatch, service, provider, toolName, sourceLabel),
      );
      continue;
    }

    if (resolved.kind === "hold") {
      void service.notifications.sendOperatorMessage(
        holdSuggestionFromOperator(session, dispatch, provider, toolName, sourceLabel),
      );
      continue;
    }

    if (resolved.kind === "resume") {
      void service.notifications.sendOperatorMessage(
        resumeLaneFromOperator(session, dispatch, service, provider, toolName, sourceLabel),
      );
      continue;
    }

    if (!canAutoInjectOperatorMessage(session)) {
      const pending = createPendingOperatorMessage(session.id, resolved.text, reply.via, reply.from, reply.token);
      dispatch({ type: "QUEUE_OPERATOR_MESSAGE", id: session.id, message: pending });
      dispatch({
        type: "APPEND_TIMELINE_ENTRY",
        id: session.id,
        entry: createOperatorEntry(
          "operator-queued",
          session.id,
          provider,
          toolName,
          `Roscoe queued the ${sourceLabel.toLowerCase()} for the next clean handoff because the Guild lane is still busy.`,
        ),
      });
      void service.notifications.sendOperatorMessage(
        `Queued your note for ${scope}. Guild is still busy, so Roscoe will inject it at the next clean handoff.`,
      );
      continue;
    }

    service.injectOperatorGuidance(session.managed, resolved.text, "sms");
    dispatch({ type: "SYNC_MANAGED_SESSION", id: session.id, managed: session.managed });
    dispatch({ type: "SUBMIT_TEXT", id: session.id, text: resolved.text, delivery: "manual" });
    void service.notifications.sendOperatorMessage(`Delivered your note to ${scope}.`);
  }
}

export function deliverQueuedOperatorMessages(
  sessions: Map<string, SessionState>,
  dispatch: React.Dispatch<AppAction>,
  service: SessionManagerService,
  provider: string,
  toolName: string,
  sourceLabel: string,
): void {
  for (const session of sessions.values()) {
    const pendingMessages = session.pendingOperatorMessages ?? [];
    if (pendingMessages.length === 0 || !canAutoInjectOperatorMessage(session)) {
      continue;
    }

    const nextMessage = pendingMessages[0];
    service.injectOperatorGuidance(session.managed, nextMessage.text, "sms");
    dispatch({ type: "SYNC_MANAGED_SESSION", id: session.id, managed: session.managed });
    dispatch({ type: "SHIFT_OPERATOR_MESSAGE", id: session.id, messageId: nextMessage.id });
    dispatch({ type: "SUBMIT_TEXT", id: session.id, text: nextMessage.text, delivery: "manual" });
    dispatch({
      type: "APPEND_TIMELINE_ENTRY",
      id: session.id,
      entry: createOperatorEntry(
        "operator-delivered",
        session.id,
        provider,
        toolName,
        `Delivered queued ${sourceLabel.toLowerCase()} from ${nextMessage.from ?? "operator"} to the Guild lane.`,
      ),
    });
    void service.notifications.sendOperatorMessage(
      `Delivered your queued note to ${formatSmsLaneScope(session)}.`,
    );
  }
}
