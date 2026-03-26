import { ResponseGenerator, SuggestionResult } from "../response-generator.js";
import { InputInjector } from "../input-injector.js";
import { BrowserAgent } from "../browser-agent.js";
import { Orchestrator } from "../orchestrator.js";
import { ManagedSession, SessionStartOpts, ParsedSessionSpec } from "../types.js";
import { RuntimeControlSettings } from "../llm-runtime.js";
import { NotificationService } from "../notification-service.js";
export declare class SessionManagerService {
    generator: ResponseGenerator;
    injector: InputInjector;
    browserAgent: BrowserAgent | null;
    orchestrator: Orchestrator | null;
    notifications: NotificationService;
    constructor(threshold?: number);
    startSession(opts: SessionStartOpts): ManagedSession;
    generateSuggestion(managed: ManagedSession, onPartial?: (text: string) => void): Promise<SuggestionResult>;
    cancelGeneration(): void;
    executeSuggestion(managed: ManagedSession, result: SuggestionResult): Promise<void>;
    generateSummary(managed: ManagedSession): Promise<string>;
    maybeNotifyProgress(managed: ManagedSession, summary: string): Promise<void>;
    injectText(managed: ManagedSession, text: string): void;
    updateManagedRuntime(managed: ManagedSession, runtime: RuntimeControlSettings): ManagedSession;
    prepareWorkerTurn(managed: ManagedSession, upcomingPrompt?: string): ManagedSession;
    private executeBrowserActions;
    private executeOrchestratorActions;
}
export declare function expandTilde(p: string): string;
export declare function parseSessionSpec(spec: string): ParsedSessionSpec;
