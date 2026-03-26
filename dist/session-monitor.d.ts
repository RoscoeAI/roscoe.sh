import { EventEmitter } from "events";
import { HeadlessProfile } from "./llm-runtime.js";
export interface SessionEvents {
    text: (chunk: string) => void;
    thinking: (chunk: string) => void;
    "turn-complete": () => void;
    "tool-activity": (toolName: string) => void;
    result: (sessionId: string) => void;
    exit: (code: number) => void;
}
export declare class SessionMonitor extends EventEmitter {
    readonly id: string;
    private proc;
    private rl;
    private sessionId;
    private textBuffer;
    private lastPrompt;
    private lastCommandPreview;
    private resolvedCommand;
    private cwd;
    private profile;
    constructor(id: string, profile: HeadlessProfile, cwd?: string);
    private resolveCommand;
    /**
     * Start a new turn with the given prompt.
     */
    startTurn(prompt: string): void;
    private spawnProcess;
    private handleLine;
    /**
     * Send a follow-up message in the same conversation.
     */
    sendFollowUp(text: string): void;
    getSessionId(): string | null;
    getTextBuffer(): string;
    getLastPrompt(): string | null;
    getLastCommandPreview(): string | null;
    setProfile(profile: HeadlessProfile): void;
    clearTextBuffer(): void;
    kill(): void;
}
