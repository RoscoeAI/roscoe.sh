import { SessionManagerService } from "./services/session-manager.js";
import { AppAction, SessionState, TranscriptEntry } from "./types.js";
import { buildReadyPreviewState, getPreviewState } from "./session-preview.js";

let interruptEntryCounter = 0;

function createInterruptEntry(session: SessionState, text: string): TranscriptEntry {
  interruptEntryCounter += 1;
  return {
    id: `interrupt-${session.id}-${Date.now()}-${interruptEntryCounter}`,
    kind: "tool-activity",
    timestamp: Date.now(),
    provider: "roscoe",
    toolName: "interrupt",
    text,
  };
}

export function interruptActiveLane(
  dispatch: (action: AppAction) => void,
  service: Pick<SessionManagerService, "cancelGeneration">,
  session: SessionState,
): void {
  service.cancelGeneration();
  session.managed.monitor.kill();
  session.managed.awaitingInput = true;
  session.managed._paused = false;

  dispatch({ type: "SYNC_MANAGED_SESSION", id: session.id, managed: session.managed });
  dispatch({ type: "SET_TOOL_ACTIVITY", id: session.id, toolName: null });
  dispatch({ type: "UPDATE_SESSION_STATUS", id: session.id, status: "waiting" });

  const previewState = getPreviewState(session.preview);
  if (previewState.mode === "queued") {
    const readyPreview = buildReadyPreviewState(session);
    dispatch({
      type: "APPEND_TIMELINE_ENTRY",
      id: session.id,
      entry: createInterruptEntry(
        session,
        "Roscoe interrupted the current Guild turn and forced the preview break open. The interrupted step may need to be rerun.",
      ),
    });
    dispatch({
      type: "ACTIVATE_PREVIEW_BREAK",
      id: session.id,
      message: readyPreview.message ?? "Preview ready.",
      ...(readyPreview.link ? { link: readyPreview.link } : {}),
    });
    return;
  }

  dispatch({
    type: "APPEND_TIMELINE_ENTRY",
    id: session.id,
    entry: createInterruptEntry(
      session,
      "Roscoe interrupted the current Guild turn and handed control back to you. The interrupted step may need to be rerun.",
    ),
  });
  dispatch({ type: "START_MANUAL", id: session.id });
}
