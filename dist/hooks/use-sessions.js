import { useCallback } from "react";
export function useSessions(dispatch, service) {
    const startSession = useCallback((opts) => {
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
    }, [dispatch, service]);
    const switchSession = useCallback((id) => {
        dispatch({ type: "SET_ACTIVE", id });
    }, [dispatch]);
    return { startSession, switchSession };
}
