import { SessionMonitor } from "./session-monitor.js";
import { InputInjector } from "./input-injector.js";
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
export class Orchestrator {
  private workers = new Map<string, WorkerSession>();
  private injector = new InputInjector();
  private browser: BrowserAgent | null = null;

  constructor(private orchestratorMonitor?: SessionMonitor) {}

  setBrowser(browser: BrowserAgent): void {
    this.browser = browser;
  }

  registerWorker(
    id: string,
    monitor: SessionMonitor,
    profileName: string,
  ): void {
    this.workers.set(id, { id, monitor, profileName });
  }

  unregisterWorker(id: string): void {
    this.workers.delete(id);
  }

  getWorkerIds(): string[] {
    return Array.from(this.workers.keys());
  }

  getWorker(id: string): WorkerSession | undefined {
    return this.workers.get(id);
  }

  /**
   * Send a plan/task to a worker session.
   */
  sendPlan(workerId: string, taskDescription: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }
    this.injector.inject(worker.monitor, taskDescription);
  }

  /**
   * Send a review/feedback message to a worker session.
   */
  sendReview(workerId: string, instructions: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }
    this.injector.inject(worker.monitor, instructions);
  }

  /**
   * Send raw text input to a worker session.
   */
  sendInput(workerId: string, text: string): void {
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
  async screenshotAndShare(
    workerId: string,
    url?: string,
  ): Promise<string> {
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
  async snapshotAndShare(workerId: string): Promise<void> {
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
  broadcastToWorkers(text: string): void {
    for (const worker of this.workers.values()) {
      this.injector.inject(worker.monitor, text);
    }
  }
}
