import { BrowserAgent } from "./browser-agent.js";
import { ProjectContext } from "./config.js";
import { HeadlessProfile } from "./llm-runtime.js";
export interface BrowserAction {
    type: "screenshot" | "navigate" | "login" | "interact" | "snapshot";
    params: Record<string, string>;
    description: string;
}
export interface OrchestratorAction {
    type: "plan" | "review" | "input";
    workerId: string;
    text: string;
}
export interface SuggestionResult {
    text: string;
    confidence: number;
    reasoning: string;
    browserActions?: BrowserAction[];
    orchestratorActions?: OrchestratorAction[];
}
export interface SessionInfo {
    profile: HeadlessProfile;
    profileName: string;
    projectName: string;
    projectDir: string;
    worktreePath: string;
    worktreeName: string;
}
export interface SuggestionTrace {
    prompt: string;
    commandPreview: string;
    runtimeSummary: string;
    strategy: string;
    rationale: string;
}
export declare class ResponseGenerator {
    private confidenceThreshold;
    private browser;
    private projectContext;
    private sidecarProc;
    constructor(confidenceThreshold?: number);
    setBrowser(browser: BrowserAgent): void;
    setProjectContext(context: ProjectContext | null): void;
    setConfidenceThreshold(threshold: number): void;
    getConfidenceThreshold(): number;
    private loadSidecarPrompt;
    readClaudeTranscript(projectPath?: string): string[];
    readCodexTranscript(): string[];
    buildContext(conversationContext: string, llmName: string, session?: SessionInfo): Promise<string>;
    private loadSessionProjectContext;
    cancelGeneration(): void;
    generateSuggestion(conversationContext: string, llmName: string, session?: SessionInfo, onPartial?: (accumulated: string) => void, onTrace?: (trace: SuggestionTrace) => void): Promise<SuggestionResult>;
    meetsThreshold(result: SuggestionResult): boolean;
}
