import { SessionState } from "../types.js";
interface SessionOutputProps {
    session: SessionState | null;
    sessionLabel?: string;
}
export declare function SessionOutput({ session, sessionLabel }: SessionOutputProps): import("react/jsx-runtime").JSX.Element;
export {};
