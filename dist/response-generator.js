import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { loadProjectContext } from "./config.js";
import { dbg } from "./debug-log.js";
import { buildCommandPreview, parseOneShotStreamLine, buildTurnCommand, summarizeRuntime, } from "./llm-runtime.js";
import { getLockedProjectProvider, getRuntimeTuningMode, recommendResponderRuntime } from "./runtime-defaults.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLAUDE_HISTORY = join(process.env.HOME || "~", ".claude", "projects");
const CODEX_SESSIONS = join(process.env.HOME || "~", ".codex", "sessions");
const SIDECAR_PROMPT_PATH = join(__dirname, "..", "sidecar-prompt.md");
function formatInterviewAnswers(answers) {
    if (answers.length === 0)
        return [];
    return answers.slice(-8).map((answer, index) => `${index + 1}. ${answer.theme ? `[${answer.theme}] ` : ""}${answer.question} => ${answer.answer}`);
}
function appendProjectIntent(parts, projectCtx) {
    if (!projectCtx.intentBrief)
        return;
    parts.push("=== Roscoe Intent Brief ===");
    parts.push(`Project story: ${projectCtx.intentBrief.projectStory}`);
    if (projectCtx.intentBrief.primaryUsers.length > 0) {
        parts.push(`Primary users: ${projectCtx.intentBrief.primaryUsers.join(", ")}`);
    }
    if (projectCtx.intentBrief.definitionOfDone.length > 0) {
        parts.push(`Definition of done: ${projectCtx.intentBrief.definitionOfDone.join(" | ")}`);
    }
    if (projectCtx.intentBrief.acceptanceChecks.length > 0) {
        parts.push(`Acceptance checks: ${projectCtx.intentBrief.acceptanceChecks.join(" | ")}`);
    }
    if (projectCtx.intentBrief.successSignals.length > 0) {
        parts.push(`Success signals: ${projectCtx.intentBrief.successSignals.join(" | ")}`);
    }
    if (projectCtx.intentBrief.deliveryPillars.frontend.length > 0) {
        parts.push(`Delivery pillar / frontend: ${projectCtx.intentBrief.deliveryPillars.frontend.join(" | ")}`);
    }
    if (projectCtx.intentBrief.deliveryPillars.backend.length > 0) {
        parts.push(`Delivery pillar / backend: ${projectCtx.intentBrief.deliveryPillars.backend.join(" | ")}`);
    }
    if (projectCtx.intentBrief.deliveryPillars.unitComponentTests.length > 0) {
        parts.push(`Delivery pillar / unit-component tests: ${projectCtx.intentBrief.deliveryPillars.unitComponentTests.join(" | ")}`);
    }
    if (projectCtx.intentBrief.deliveryPillars.e2eTests.length > 0) {
        parts.push(`Delivery pillar / e2e tests: ${projectCtx.intentBrief.deliveryPillars.e2eTests.join(" | ")}`);
    }
    if (projectCtx.intentBrief.coverageMechanism.length > 0) {
        parts.push(`Coverage mechanism: ${projectCtx.intentBrief.coverageMechanism.join(" | ")}`);
    }
    if (projectCtx.intentBrief.nonGoals.length > 0) {
        parts.push(`Non-goals: ${projectCtx.intentBrief.nonGoals.join(" | ")}`);
    }
    if (projectCtx.intentBrief.constraints.length > 0) {
        parts.push(`Constraints: ${projectCtx.intentBrief.constraints.join(" | ")}`);
    }
    if (projectCtx.intentBrief.autonomyRules.length > 0) {
        parts.push(`Autonomy rules: ${projectCtx.intentBrief.autonomyRules.join(" | ")}`);
    }
    if (projectCtx.intentBrief.qualityBar.length > 0) {
        parts.push(`Quality bar: ${projectCtx.intentBrief.qualityBar.join(" | ")}`);
    }
    if (projectCtx.intentBrief.riskBoundaries.length > 0) {
        parts.push(`Risk boundaries: ${projectCtx.intentBrief.riskBoundaries.join(" | ")}`);
    }
    if (projectCtx.intentBrief.uiDirection) {
        parts.push(`UI direction: ${projectCtx.intentBrief.uiDirection}`);
    }
    if (projectCtx.interviewAnswers && projectCtx.interviewAnswers.length > 0) {
        parts.push("Recent interview answers:");
        parts.push(...formatInterviewAnswers(projectCtx.interviewAnswers));
    }
    parts.push("");
}
export class ResponseGenerator {
    confidenceThreshold;
    browser = null;
    projectContext = null;
    sidecarProc = null;
    constructor(confidenceThreshold = 70) {
        this.confidenceThreshold = confidenceThreshold;
    }
    setBrowser(browser) {
        this.browser = browser;
    }
    setProjectContext(context) {
        this.projectContext = context;
    }
    setConfidenceThreshold(threshold) {
        this.confidenceThreshold = threshold;
    }
    getConfidenceThreshold() {
        return this.confidenceThreshold;
    }
    loadSidecarPrompt() {
        try {
            if (existsSync(SIDECAR_PROMPT_PATH)) {
                return readFileSync(SIDECAR_PROMPT_PATH, "utf-8");
            }
        }
        catch {
            // fall through
        }
        return "You are a developer's conversation co-pilot. Output ONLY the suggested message — no meta-commentary.";
    }
    readClaudeTranscript(projectPath) {
        const lines = [];
        try {
            if (!projectPath)
                return lines;
            const encoded = projectPath.replace(/\//g, "-");
            const dir = join(CLAUDE_HISTORY, encoded);
            if (!existsSync(dir))
                return lines;
            const files = readdirSync(dir)
                .filter((f) => f.endsWith(".jsonl"))
                .map((f) => ({
                name: f,
                mtime: statSync(join(dir, f)).mtimeMs,
            }))
                .sort((a, b) => b.mtime - a.mtime);
            if (files.length > 0) {
                const content = readFileSync(join(dir, files[0].name), "utf-8");
                const jsonLines = content.trim().split("\n").slice(-50);
                for (const line of jsonLines) {
                    try {
                        const entry = JSON.parse(line);
                        if (entry.display)
                            lines.push(entry.display);
                    }
                    catch {
                        // skip
                    }
                }
            }
        }
        catch {
            // best-effort
        }
        return lines;
    }
    readCodexTranscript() {
        const lines = [];
        try {
            if (!existsSync(CODEX_SESSIONS))
                return lines;
            const findJsonl = (dir) => {
                const results = [];
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    const full = join(dir, entry.name);
                    if (entry.isDirectory())
                        results.push(...findJsonl(full));
                    else if (entry.name.endsWith(".jsonl"))
                        results.push(full);
                }
                return results;
            };
            const files = findJsonl(CODEX_SESSIONS)
                .map((f) => ({ path: f, mtime: statSync(f).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            if (files.length > 0) {
                const content = readFileSync(files[0].path, "utf-8");
                const jsonLines = content.trim().split("\n").slice(-50);
                for (const line of jsonLines) {
                    try {
                        const entry = JSON.parse(line);
                        if (entry.payload?.content || entry.payload?.message) {
                            lines.push(entry.payload.content || entry.payload.message);
                        }
                    }
                    catch {
                        // skip
                    }
                }
            }
        }
        catch {
            // best-effort
        }
        return lines;
    }
    async buildContext(conversationContext, llmName, session) {
        const parts = [];
        // Per-session project context: load from the session's project dir
        const projectCtx = session
            ? this.loadSessionProjectContext(session)
            : this.projectContext;
        if (projectCtx) {
            parts.push("=== Project Context ===");
            parts.push(`Project: ${projectCtx.name}`);
            if (session?.worktreeName && session.worktreeName !== "main") {
                parts.push(`Worktree: ${session.worktreeName} (${session.worktreePath})`);
            }
            parts.push(`Goals: ${projectCtx.goals.join(", ")}`);
            parts.push(`Milestones: ${projectCtx.milestones.join(", ")}`);
            parts.push(`Tech: ${projectCtx.techStack.join(", ")}`);
            if (projectCtx.notes) {
                parts.push(`Notes: ${projectCtx.notes}`);
            }
            const lockedProvider = getLockedProjectProvider(projectCtx);
            if (lockedProvider) {
                parts.push(`Locked worker provider: ${lockedProvider}`);
            }
            if (session?.profile?.runtime) {
                parts.push(`Runtime management mode: ${getRuntimeTuningMode(session.profile.runtime)}`);
            }
            parts.push("");
            appendProjectIntent(parts, projectCtx);
        }
        // Active conversation
        parts.push(`=== Active Guild conversation with ${llmName} ===`);
        parts.push(conversationContext);
        // Transcript context from the session's working directory
        const transcriptPath = session?.worktreePath || process.cwd();
        const claudeLines = this.readClaudeTranscript(transcriptPath);
        if (claudeLines.length > 0) {
            parts.push("\n=== Recent Claude Code transcript ===");
            parts.push(claudeLines.slice(-20).join("\n"));
        }
        const codexLines = this.readCodexTranscript();
        if (codexLines.length > 0) {
            parts.push("\n=== Recent Codex transcript ===");
            parts.push(codexLines.slice(-20).join("\n"));
        }
        // Browser context
        if (this.browser) {
            try {
                const browserContext = await this.browser.getContextSummary();
                parts.push("\n=== Current Browser State ===");
                parts.push(browserContext);
            }
            catch {
                // browser context is best-effort
            }
        }
        return parts.join("\n");
    }
    loadSessionProjectContext(session) {
        try {
            return loadProjectContext(session.projectDir);
        }
        catch {
            return null;
        }
    }
    cancelGeneration() {
        this.sidecarProc?.kill();
        this.sidecarProc = null;
    }
    async generateSuggestion(conversationContext, llmName, session, onPartial, onTrace) {
        const context = await this.buildContext(conversationContext, llmName, session);
        const sidecarPrompt = this.loadSidecarPrompt();
        const projectCtx = session
            ? this.loadSessionProjectContext(session)
            : this.projectContext;
        const hasBrowser = this.browser !== null;
        const hasOrchestrator = projectCtx !== null;
        const browserInstructions = hasBrowser
            ? `\n\nYou can suggest browser actions. Include a "browserActions" array in your JSON with objects like:
  {"type": "screenshot", "params": {}, "description": "why"}
  {"type": "navigate", "params": {"url": "..."}, "description": "why"}`
            : "";
        const orchestratorInstructions = hasOrchestrator
            ? `\n\nYou can suggest orchestrator actions to direct other AI worker sessions. Include an "orchestratorActions" array with objects like:
  {"type": "plan", "workerId": "session-id", "text": "task description"}
  {"type": "review", "workerId": "session-id", "text": "review instructions"}`
            : "";
        const prompt = `${sidecarPrompt}

---

Given the following context from active Guild coding sessions, formulate the best possible next message Roscoe should send.

${context}

---

Respond in this EXACT JSON format (no markdown fences, just raw JSON):
{
  "message": "the suggested message to send",
  "confidence": <number 0-100>,
  "reasoning": "one sentence explaining why"${hasBrowser ? ',\n  "browserActions": []' : ""}${hasOrchestrator ? ',\n  "orchestratorActions": []' : ""}
}

Confidence guide:
- 90-100: Transcript, definition of done, and acceptance checks all point to the same next step with no meaningful scope risk
- 70-89: Good alignment with intent, but there is still implementation or prioritization ambiguity
- 50-69: Multiple plausible next steps fit the transcript, and Roscoe's intent brief does not clearly choose between them
- Below 50: The next move would set scope, reinterpret definition of done, or claim completion without enough grounding in the intent brief${browserInstructions}${orchestratorInstructions}`;
        const baseProfile = session?.profile ?? inferProfile(llmName);
        const runtimePlan = recommendResponderRuntime(baseProfile, conversationContext, projectCtx);
        const sidecarProfile = runtimePlan.profile;
        onTrace?.({
            prompt,
            commandPreview: buildCommandPreview(sidecarProfile),
            runtimeSummary: runtimePlan.summary || summarizeRuntime(sidecarProfile),
            strategy: runtimePlan.strategy,
            rationale: runtimePlan.rationale,
        });
        return new Promise((resolve, reject) => {
            let accumulated = "";
            let stderrText = "";
            let timedOut = false;
            let cancelled = false;
            const spec = buildTurnCommand(sidecarProfile, prompt);
            dbg("sidecar", `spawning ${spec.command}`);
            const proc = spawn(spec.command, spec.args, {
                stdio: ["pipe", "pipe", "pipe"],
                env: spec.env,
            });
            this.sidecarProc = proc;
            proc.stdin.end();
            const timeout = setTimeout(() => {
                timedOut = true;
                proc.kill();
            }, 30000);
            const rl = createInterface({ input: proc.stdout });
            rl.on("line", (line) => {
                const event = parseOneShotStreamLine(sidecarProfile, line);
                if (event.appendText) {
                    accumulated += event.appendText;
                    onPartial?.(accumulated);
                    return;
                }
                if (event.replaceText && !accumulated) {
                    accumulated = event.replaceText;
                    onPartial?.(accumulated);
                }
            });
            proc.stderr?.on("data", (chunk) => {
                const text = chunk.toString();
                stderrText += text;
                if (text.trim())
                    dbg("sidecar:stderr", text.trim());
            });
            proc.on("close", (code) => {
                dbg("sidecar", `closed with code ${code}`);
                clearTimeout(timeout);
                rl.close();
                if (this.sidecarProc === proc) {
                    this.sidecarProc = null;
                }
                // Check if this was a cancellation (proc.killed but not timed out)
                cancelled = proc.killed && !timedOut;
                if (code !== 0 || timedOut || cancelled) {
                    let message;
                    if (timedOut) {
                        message = "Sidecar timed out after 30s";
                    }
                    else if (cancelled) {
                        message = "Sidecar generation was cancelled";
                    }
                    else if (stderrText.trim()) {
                        message = stderrText.trim().split("\n")[0].slice(0, 120);
                    }
                    else {
                        message = `Sidecar process failed (exit code ${code})`;
                    }
                    reject(new Error(message));
                    return;
                }
                try {
                    const raw = accumulated.trim();
                    const jsonStr = raw
                        .replace(/^```json?\n?/, "")
                        .replace(/\n?```$/, "")
                        .trim();
                    const parsed = JSON.parse(jsonStr);
                    resolve({
                        text: parsed.message || raw,
                        confidence: typeof parsed.confidence === "number"
                            ? parsed.confidence
                            : 50,
                        reasoning: parsed.reasoning || "",
                        browserActions: parsed.browserActions,
                        orchestratorActions: parsed.orchestratorActions,
                    });
                }
                catch {
                    if (accumulated.trim()) {
                        resolve({
                            text: accumulated.trim(),
                            confidence: 50,
                            reasoning: "Could not parse structured response — defaulting to medium confidence",
                        });
                    }
                    else {
                        reject(new Error("Sidecar produced no output"));
                    }
                }
            });
        });
    }
    meetsThreshold(result) {
        return result.confidence >= this.confidenceThreshold;
    }
}
function inferProfile(llmName) {
    const normalized = llmName.toLowerCase();
    if (normalized.includes("codex")) {
        return {
            name: llmName,
            command: "codex",
            args: [],
            protocol: "codex",
        };
    }
    return {
        name: llmName,
        command: "claude",
        args: [],
        protocol: "claude",
    };
}
