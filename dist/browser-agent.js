import { execFile } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/**
 * Wraps the `agent-browser` CLI for programmatic browser automation.
 * All commands use --json for machine-readable output and --session for persistence.
 */
export class BrowserAgent {
    sessionId;
    screenshotDir;
    constructor(sessionId) {
        this.sessionId = sessionId || `roscoe-${Date.now()}`;
        this.screenshotDir = join(__dirname, "..", "screenshots");
        if (!existsSync(this.screenshotDir)) {
            mkdirSync(this.screenshotDir, { recursive: true });
        }
    }
    exec(args) {
        return new Promise((resolve, reject) => {
            execFile("agent-browser", [...args, "--session", this.sessionId], {
                timeout: 30000,
                maxBuffer: 5 * 1024 * 1024,
                env: process.env,
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`agent-browser ${args[0]} failed: ${error.message}\n${stderr}`));
                    return;
                }
                resolve(stdout.trim());
            });
        });
    }
    parseJson(raw) {
        try {
            return JSON.parse(raw);
        }
        catch {
            throw new Error(`Failed to parse agent-browser output: ${raw.slice(0, 200)}`);
        }
    }
    async open(url) {
        const raw = await this.exec(["open", url, "--json"]);
        return this.parseJson(raw);
    }
    async screenshot(filename) {
        const name = filename || `screenshot-${Date.now()}.png`;
        const path = join(this.screenshotDir, name);
        await this.exec(["screenshot", path]);
        return path;
    }
    async snapshot() {
        const raw = await this.exec(["snapshot", "-i", "--json"]);
        return this.parseJson(raw);
    }
    async interact(action, ref, value) {
        const args = [action, ref];
        if (value !== undefined) {
            args.push(value);
        }
        args.push("--json");
        return await this.exec(args);
    }
    async click(ref) {
        await this.interact("click", ref);
    }
    async fill(ref, value) {
        await this.interact("fill", ref, value);
    }
    async evaluate(script) {
        const raw = await this.exec(["evaluate", script, "--json"]);
        return this.parseJson(raw);
    }
    async getState() {
        const raw = await this.exec(["evaluate", "JSON.stringify({ url: location.href, title: document.title })", "--json"]);
        return this.parseJson(raw);
    }
    /**
     * Execute a login flow defined by an auth profile.
     * Env vars in step values (${VAR}) are interpolated.
     */
    async login(profile) {
        await this.open(profile.url);
        for (const step of profile.steps) {
            const value = step.value ? interpolateEnv(step.value) : undefined;
            switch (step.action) {
                case "navigate":
                    if (value)
                        await this.open(value);
                    break;
                case "fill":
                    if (step.ref && value)
                        await this.fill(step.ref, value);
                    break;
                case "click":
                    if (step.ref)
                        await this.click(step.ref);
                    break;
                case "wait":
                    await new Promise((r) => setTimeout(r, parseInt(value || "1000", 10)));
                    break;
            }
        }
    }
    /**
     * Get a compact summary of the current page state for LLM context.
     */
    async getContextSummary() {
        const parts = [];
        try {
            const state = await this.getState();
            parts.push(`Page: ${state.title} (${state.url})`);
        }
        catch {
            parts.push("Page: (could not read state)");
        }
        try {
            const elements = await this.snapshot();
            if (elements.length > 0) {
                parts.push("Interactive elements:");
                for (const el of elements.slice(0, 20)) {
                    parts.push(`  ${el.ref} [${el.role}] ${el.name}`);
                }
                if (elements.length > 20) {
                    parts.push(`  ... and ${elements.length - 20} more`);
                }
            }
        }
        catch {
            // snapshot is best-effort
        }
        return parts.join("\n");
    }
    getSessionId() {
        return this.sessionId;
    }
    getScreenshotDir() {
        return this.screenshotDir;
    }
}
/**
 * Interpolate ${VAR} patterns with environment variables.
 */
function interpolateEnv(value) {
    return value.replace(/\$\{(\w+)\}/g, (_, varName) => {
        return process.env[varName] || "";
    });
}
