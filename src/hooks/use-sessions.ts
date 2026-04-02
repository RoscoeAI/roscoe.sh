import { useCallback } from "react";
import { AppAction, SessionStartOpts } from "../types.js";
import { RuntimeUsageSnapshot } from "../llm-runtime.js";
import { SessionManagerService } from "../services/session-manager.js";
import { getRestoredSuggestionPhase, sortTranscriptEntries } from "../session-transcript.js";
import { getPreviewState } from "../session-preview.js";
import { getProjectContractFingerprint, loadProjectContext } from "../config.js";

function emptyUsage(): RuntimeUsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

export function useSessions(
  dispatch: React.Dispatch<AppAction>,
  service: SessionManagerService,
) {
  const startSession = useCallback(
    (opts: SessionStartOpts) => {
      const { managed, restoredState } = service.startSession(opts);
      const liveFingerprint = getProjectContractFingerprint(loadProjectContext(managed.projectDir));
      const restoredSuggestion = getRestoredSuggestionPhase(restoredState?.timeline ?? []);
      const restoredStatus = restoredState?.status === "review" && restoredSuggestion.kind !== "ready"
        ? "waiting"
        : restoredState?.status ?? "active";
      dispatch({
        type: "ADD_SESSION",
        session: {
          id: managed.id,
          profileName: managed.profileName,
          projectName: managed.projectName,
          worktreeName: managed.worktreeName,
          startedAt: restoredState?.startedAt && restoredState.startedAt !== new Date(0).toISOString()
            ? restoredState.startedAt
            : new Date().toISOString(),
          status: restoredStatus,
          outputLines: restoredState?.outputLines ?? [],
          suggestion: restoredSuggestion,
          managed,
          summary: restoredState?.summary ?? null,
          currentToolUse: restoredState?.currentToolUse ?? null,
          currentToolDetail: restoredState?.currentToolDetail ?? null,
          usage: restoredState?.usage ?? emptyUsage(),
          rateLimitStatus: restoredState?.rateLimitStatus ?? null,
          timeline: sortTranscriptEntries(restoredState?.timeline ?? []),
          preview: getPreviewState(restoredState?.preview),
          pendingOperatorMessages: restoredState?.pendingOperatorMessages ?? [],
          contractFingerprint: restoredState?.contractFingerprint ?? liveFingerprint,
          viewMode: "transcript",
          scrollOffset: 0,
          followLive: true,
        },
      });
      return managed;
    },
    [dispatch, service],
  );

  const switchSession = useCallback(
    (id: string) => {
      dispatch({ type: "SET_ACTIVE", id });
    },
    [dispatch],
  );

  return { startSession, switchSession };
}
