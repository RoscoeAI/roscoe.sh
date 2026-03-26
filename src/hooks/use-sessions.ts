import { useCallback } from "react";
import { AppAction, SessionStartOpts } from "../types.js";
import { SessionManagerService } from "../services/session-manager.js";

export function useSessions(
  dispatch: React.Dispatch<AppAction>,
  service: SessionManagerService,
) {
  const startSession = useCallback(
    (opts: SessionStartOpts) => {
      const managed = service.startSession(opts);
      dispatch({
        type: "ADD_SESSION",
        session: {
          id: managed.id,
          profileName: managed.profileName,
          projectName: managed.projectName,
          worktreeName: managed.worktreeName,
          status: "active",
          outputLines: [],
          suggestion: { kind: "idle" },
          managed,
          summary: null,
          currentToolUse: null,
          timeline: [],
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
