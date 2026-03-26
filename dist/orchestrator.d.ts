import { SessionMonitor } from "./session-monitor.js";
import { BrowserAgent } from "./browser-agent.js";
interface WorkerSession {
    id: string;
    monitor: SessionMonitor;
    profileName: string;
}
/**
 * Orchestrator that directs multiple worker LLM sessions.
 * Can analyze codebases, interview the user, and send tasks to workers.
 */
export declare class Orchestrator {
    private orchestratorMonitor?;
    private workers;
    private injector;
    private browser;
    constructor(orchestratorMonitor?: SessionMonitor | undefined);
    setBrowser(browser: BrowserAgent): void;
    registerWorker(id: string, monitor: SessionMonitor, profileName: string): void;
    unregisterWorker(id: string): void;
    getWorkerIds(): string[];
    getWorker(id: string): WorkerSession | undefined;
    /**
     * Send a plan/task to a worker session.
     */
    sendPlan(workerId: string, taskDescription: string): void;
    /**
     * Send a review/feedback message to a worker session.
     */
    sendReview(workerId: string, instructions: string): void;
    /**
     * Send raw text input to a worker session.
     */
    sendInput(workerId: string, text: string): void;
    /**
     * Take a browser screenshot and send the file path to a worker session
     * so the LLM can reference the visual state of the app.
     */
    screenshotAndShare(workerId: string, url?: string): Promise<string>;
    /**
     * Get a browser snapshot and share the element context with a worker.
     */
    snapshotAndShare(workerId: string): Promise<void>;
    /**
     * Send the same message to all worker sessions.
     */
    broadcastToWorkers(text: string): void;
}
export {};
