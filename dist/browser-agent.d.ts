export interface BrowserState {
    url: string;
    title: string;
    consoleErrors?: string[];
}
export interface ElementSnapshot {
    ref: string;
    role: string;
    name: string;
    description?: string;
}
export interface AuthProfile {
    name: string;
    url: string;
    steps: AuthStep[];
}
export interface AuthStep {
    action: "fill" | "click" | "wait" | "navigate";
    ref?: string;
    value?: string;
}
/**
 * Wraps the `agent-browser` CLI for programmatic browser automation.
 * All commands use --json for machine-readable output and --session for persistence.
 */
export declare class BrowserAgent {
    private sessionId;
    private screenshotDir;
    constructor(sessionId?: string);
    private exec;
    private parseJson;
    open(url: string): Promise<BrowserState>;
    screenshot(filename?: string): Promise<string>;
    snapshot(): Promise<ElementSnapshot[]>;
    interact(action: string, ref: string, value?: string): Promise<string>;
    click(ref: string): Promise<void>;
    fill(ref: string, value: string): Promise<void>;
    evaluate(script: string): Promise<unknown>;
    getState(): Promise<BrowserState>;
    /**
     * Execute a login flow defined by an auth profile.
     * Env vars in step values (${VAR}) are interpolated.
     */
    login(profile: AuthProfile): Promise<void>;
    /**
     * Get a compact summary of the current page state for LLM context.
     */
    getContextSummary(): Promise<string>;
    getSessionId(): string;
    getScreenshotDir(): string;
}
