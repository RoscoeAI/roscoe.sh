import { SessionState } from "../types.js";
interface SessionListProps {
    sessions: Map<string, SessionState>;
    activeSessionId: string | null;
    width?: number;
}
export declare function SessionList({ sessions, activeSessionId, width }: SessionListProps): import("react/jsx-runtime").JSX.Element;
export {};
