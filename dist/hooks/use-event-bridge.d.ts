import { AppAction, SessionState, ManagedSession } from "../types.js";
import { SessionManagerService } from "../services/session-manager.js";
import { ProjectContext } from "../config.js";
/** Build an initial prompt for auto-starting a session */
export declare function buildInitialPrompt(managed: ManagedSession, context: ProjectContext | null): string;
/** Strip basic markdown formatting for terminal display */
export declare function stripMarkdown(line: string): string;
/** Throttled dispatcher for streaming partial text into the generating phase */
export declare function createPartialDispatcher(dispatch: React.Dispatch<AppAction>, id: string): (partial: string) => void;
export declare function useEventBridge(sessions: Map<string, SessionState>, dispatch: React.Dispatch<AppAction>, service: SessionManagerService, autoMode: boolean): void;
