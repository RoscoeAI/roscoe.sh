import { ChildProcess } from "child_process";
export type LLMProtocol = "claude" | "codex";
export type RuntimeExecutionMode = "safe" | "accelerated";
export type RuntimeTuningMode = "manual" | "auto";
export interface RuntimeControlSettings {
    executionMode?: RuntimeExecutionMode;
    tuningMode?: RuntimeTuningMode;
    model?: string;
    reasoningEffort?: string;
    permissionMode?: string;
    sandboxMode?: string;
    approvalPolicy?: string;
    dangerouslySkipPermissions?: boolean;
    bypassApprovalsAndSandbox?: boolean;
}
export interface HeadlessProfile {
    name: string;
    command: string;
    args: string[];
    protocol?: LLMProtocol;
    runtime?: RuntimeControlSettings;
}
interface SpawnSpec {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
}
interface SessionLineHandlers {
    onText?: (text: string) => void;
    onThinking?: (text: string) => void;
    onToolActivity?: (toolName: string) => void;
    onSessionId?: (sessionId: string) => void;
    onTurnComplete?: () => void;
}
interface OneShotLineResult {
    appendText?: string;
    replaceText?: string;
}
interface OneShotRunOptions {
    cwd?: string;
    onText?: (accumulated: string) => void;
    timeoutMs?: number;
}
export interface OneShotRunHandle {
    proc: ChildProcess;
    result: Promise<string>;
}
export declare function detectProtocol(profile: Pick<HeadlessProfile, "command" | "name" | "protocol">): LLMProtocol;
export declare function buildTurnCommand(profile: HeadlessProfile, prompt: string, sessionId?: string | null): SpawnSpec;
export declare function buildCommandPreview(profile: HeadlessProfile, sessionId?: string | null): string;
export declare function summarizeRuntime(profile: HeadlessProfile): string;
export declare function parseSessionStreamLine(profile: HeadlessProfile, line: string, handlers: SessionLineHandlers): void;
export declare function parseOneShotStreamLine(profile: HeadlessProfile, line: string): OneShotLineResult;
export declare function startOneShotRun(profile: HeadlessProfile, prompt: string, options?: OneShotRunOptions): OneShotRunHandle;
export {};
