import { InputInjector } from "./input-injector.js";
/**
 * Orchestrator that directs multiple worker LLM sessions.
 * Can analyze codebases, interview the user, and send tasks to workers.
 */
export class Orchestrator {
    orchestratorMonitor;
    workers = new Map();
    injector = new InputInjector();
    browser = null;
    constructor(orchestratorMonitor) {
        this.orchestratorMonitor = orchestratorMonitor;
    }
    setBrowser(browser) {
        this.browser = browser;
    }
    registerWorker(id, monitor, profileName) {
        this.workers.set(id, { id, monitor, profileName });
    }
    unregisterWorker(id) {
        this.workers.delete(id);
    }
    getWorkerIds() {
        return Array.from(this.workers.keys());
    }
    getWorker(id) {
        return this.workers.get(id);
    }
    /**
     * Send a plan/task to a worker session.
     */
    sendPlan(workerId, taskDescription) {
        const worker = this.workers.get(workerId);
        if (!worker) {
            throw new Error(`Worker ${workerId} not found`);
        }
        this.injector.inject(worker.monitor, taskDescription);
    }
    /**
     * Send a review/feedback message to a worker session.
     */
    sendReview(workerId, instructions) {
        const worker = this.workers.get(workerId);
        if (!worker) {
            throw new Error(`Worker ${workerId} not found`);
        }
        this.injector.inject(worker.monitor, instructions);
    }
    /**
     * Send raw text input to a worker session.
     */
    sendInput(workerId, text) {
        const worker = this.workers.get(workerId);
        if (!worker) {
            throw new Error(`Worker ${workerId} not found`);
        }
        this.injector.inject(worker.monitor, text);
    }
    /**
     * Take a browser screenshot and send the file path to a worker session
     * so the LLM can reference the visual state of the app.
     */
    async screenshotAndShare(workerId, url) {
        if (!this.browser) {
            throw new Error("Browser agent not initialized");
        }
        if (url) {
            await this.browser.open(url);
        }
        const screenshotPath = await this.browser.screenshot();
        const worker = this.workers.get(workerId);
        if (!worker) {
            throw new Error(`Worker ${workerId} not found`);
        }
        // Send the screenshot path to the worker so it can view it
        const message = `Here's a screenshot of the current app state: ${screenshotPath}`;
        this.injector.inject(worker.monitor, message);
        return screenshotPath;
    }
    /**
     * Get a browser snapshot and share the element context with a worker.
     */
    async snapshotAndShare(workerId) {
        if (!this.browser) {
            throw new Error("Browser agent not initialized");
        }
        const summary = await this.browser.getContextSummary();
        const worker = this.workers.get(workerId);
        if (!worker) {
            throw new Error(`Worker ${workerId} not found`);
        }
        const message = `Current browser state:\n${summary}`;
        this.injector.inject(worker.monitor, message);
    }
    /**
     * Send the same message to all worker sessions.
     */
    broadcastToWorkers(text) {
        for (const worker of this.workers.values()) {
            this.injector.inject(worker.monitor, text);
        }
    }
}
