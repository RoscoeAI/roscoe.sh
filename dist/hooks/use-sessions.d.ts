import { AppAction, SessionStartOpts } from "../types.js";
import { SessionManagerService } from "../services/session-manager.js";
export declare function useSessions(dispatch: React.Dispatch<AppAction>, service: SessionManagerService): {
    startSession: (opts: SessionStartOpts) => import("../types.js").ManagedSession;
    switchSession: (id: string) => void;
};
