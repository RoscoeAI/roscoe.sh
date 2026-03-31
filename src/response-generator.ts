import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { BrowserAgent } from "./browser-agent.js";
import { InterviewAnswer, loadProfile, loadProjectContext, loadRoscoeSettings, ProjectContext } from "./config.js";
import { dbg } from "./debug-log.js";
import {
  buildCommandPreview,
  detectProtocol,
  HeadlessProfile,
  parseOneShotStreamLine,
  buildTurnCommand,
  summarizeRuntime,
  RuntimeUsageSnapshot,
} from "./llm-runtime.js";
import {
  getDefaultProfileName,
  getLockedProjectProvider,
  getResponderProvider,
  getTokenEfficiencyMode,
  getVerificationCadence,
  getResponderApprovalMode,
  getRuntimeTuningMode,
  getWorkerGovernanceMode,
  recommendResponderRuntime,
} from "./runtime-defaults.js";
import { parseRoscoeDraftPayload } from "./roscoe-draft.js";
import { SessionMonitor } from "./session-monitor.js";
import type { Message } from "./conversation-tracker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLAUDE_HISTORY = join(process.env.HOME || "~", ".claude", "projects");
const CODEX_SESSIONS = join(process.env.HOME || "~", ".codex", "sessions");
const SIDECAR_PROMPT_PATH = join(__dirname, "..", "sidecar-prompt.md");
const SIDECAR_TIMEOUT_MS = 300_000;

function formatInterviewAnswers(answers: InterviewAnswer[]): string[] {
  if (answers.length === 0) return [];
  return answers.slice(-8).map((answer, index) =>
    `${index + 1}. ${answer.theme ? `[${answer.theme}] ` : ""}${answer.question} => ${answer.answer}`,
  );
}

function appendProjectIntent(parts: string[], projectCtx: ProjectContext): void {
  if (!projectCtx.intentBrief) return;
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
  if (projectCtx.intentBrief.entrySurfaceContract?.summary) {
    parts.push(`Entry surface contract: ${projectCtx.intentBrief.entrySurfaceContract.summary}`);
  }
  if (projectCtx.intentBrief.entrySurfaceContract?.defaultRoute) {
    parts.push(`Default entry route: ${projectCtx.intentBrief.entrySurfaceContract.defaultRoute}`);
  }
  if (projectCtx.intentBrief.entrySurfaceContract?.expectedExperience) {
    parts.push(`Expected first experience: ${projectCtx.intentBrief.entrySurfaceContract.expectedExperience}`);
  }
  if (projectCtx.intentBrief.entrySurfaceContract?.allowedShellStates?.length) {
    parts.push(`Allowed shell states: ${projectCtx.intentBrief.entrySurfaceContract.allowedShellStates.join(" | ")}`);
  }
  if (projectCtx.intentBrief.localRunContract?.summary) {
    parts.push(`Local run contract: ${projectCtx.intentBrief.localRunContract.summary}`);
  }
  if (projectCtx.intentBrief.localRunContract?.startCommand) {
    parts.push(`Local start command: ${projectCtx.intentBrief.localRunContract.startCommand}`);
  }
  if (projectCtx.intentBrief.localRunContract?.firstRoute) {
    parts.push(`Local first route: ${projectCtx.intentBrief.localRunContract.firstRoute}`);
  }
  if (projectCtx.intentBrief.localRunContract?.prerequisites?.length) {
    parts.push(`Local prerequisites: ${projectCtx.intentBrief.localRunContract.prerequisites.join(" | ")}`);
  }
  if (projectCtx.intentBrief.localRunContract?.seedRequirements?.length) {
    parts.push(`Seed requirements: ${projectCtx.intentBrief.localRunContract.seedRequirements.join(" | ")}`);
  }
  if (projectCtx.intentBrief.localRunContract?.expectedBlockedStates?.length) {
    parts.push(`Honest blocked states: ${projectCtx.intentBrief.localRunContract.expectedBlockedStates.join(" | ")}`);
  }
  if (projectCtx.intentBrief.localRunContract?.operatorSteps?.length) {
    parts.push(`Local operator steps: ${projectCtx.intentBrief.localRunContract.operatorSteps.join(" | ")}`);
  }
  if (projectCtx.intentBrief.acceptanceLedger?.length) {
    if (projectCtx.intentBrief.acceptanceLedgerMode === "inferred") {
      parts.push("Acceptance ledger mode: inferred from older brief; unresolved items are advisory until refined or proven.");
    }
    parts.push("Acceptance ledger:");
    for (const item of projectCtx.intentBrief.acceptanceLedger) {
      const details = [
        item.label,
        item.status,
        item.evidence.length > 0 ? `evidence ${item.evidence.join(" / ")}` : "",
        item.notes ? `notes ${item.notes}` : "",
      ].filter(Boolean);
      parts.push(`- ${details.join(" · ")}`);
    }
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
  if (projectCtx.intentBrief.deploymentContract?.summary) {
    parts.push(`Deployment contract: ${projectCtx.intentBrief.deploymentContract.summary}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.artifactType) {
    parts.push(`Deployment artifact type: ${projectCtx.intentBrief.deploymentContract.artifactType}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.platforms?.length) {
    parts.push(`Deployment platforms: ${projectCtx.intentBrief.deploymentContract.platforms.join(" | ")}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.environments?.length) {
    parts.push(`Deployment environments: ${projectCtx.intentBrief.deploymentContract.environments.join(" | ")}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.buildSteps?.length) {
    parts.push(`Canonical build path: ${projectCtx.intentBrief.deploymentContract.buildSteps.join(" | ")}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.deploySteps?.length) {
    parts.push(`Canonical deploy path: ${projectCtx.intentBrief.deploymentContract.deploySteps.join(" | ")}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.previewStrategy?.length) {
    parts.push(`Preview strategy: ${projectCtx.intentBrief.deploymentContract.previewStrategy.join(" | ")}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.presenceStrategy?.length) {
    parts.push(`Hosted presence strategy: ${projectCtx.intentBrief.deploymentContract.presenceStrategy.join(" | ")}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.proofTargets?.length) {
    parts.push(`Hosted proof targets: ${projectCtx.intentBrief.deploymentContract.proofTargets.join(" | ")}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.healthChecks?.length) {
    parts.push(`Deploy health checks: ${projectCtx.intentBrief.deploymentContract.healthChecks.join(" | ")}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.rollback?.length) {
    parts.push(`Rollback path: ${projectCtx.intentBrief.deploymentContract.rollback.join(" | ")}`);
  }
  if (projectCtx.intentBrief.deploymentContract?.requiredSecrets?.length) {
    parts.push(`Deployment secrets: ${projectCtx.intentBrief.deploymentContract.requiredSecrets.join(" | ")}`);
  }
  if (projectCtx.intentBrief.nonGoals.length > 0) {
    parts.push(`Non-goals: ${projectCtx.intentBrief.nonGoals.join(" | ")}`);
  }
  if (projectCtx.intentBrief.constraints.length > 0) {
    parts.push(`Constraints: ${projectCtx.intentBrief.constraints.join(" | ")}`);
  }
  if (projectCtx.intentBrief.architecturePrinciples?.length) {
    parts.push(`Architecture principles: ${projectCtx.intentBrief.architecturePrinciples.join(" | ")}`);
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
  parts.push(
    loadRoscoeSettings().behavior.parkAtMilestonesForReview
      ? "Milestone parking mode: enabled. Roscoe may park at major milestones for human review if the next thread is clearly bounded."
      : "Milestone parking mode: disabled. Do not park merely because a milestone boundary was reached; if meaningful work remains, plan and direct the next concrete slice now.",
  );
  if (projectCtx.intentBrief.uiDirection) {
    parts.push(`UI direction: ${projectCtx.intentBrief.uiDirection}`);
  }
  if (projectCtx.interviewAnswers && projectCtx.interviewAnswers.length > 0) {
    parts.push("Recent interview answers:");
    parts.push(...formatInterviewAnswers(projectCtx.interviewAnswers));
  }
  parts.push("");
}

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
  responderMonitor?: SessionMonitor;
  responderHistory?: Message[];
  responderHistoryCursor?: number;
}

export interface SuggestionTrace {
  prompt: string;
  commandPreview: string;
  runtimeSummary: string;
  strategy: string;
  rationale: string;
}

interface FakeGreenSignal {
  label: string;
  evidence?: string;
  source?: "operator-surface" | "deployment-contract" | "acceptance-ledger";
}

export class ResponseGenerator {
  private confidenceThreshold: number;
  private browser: BrowserAgent | null = null;
  private projectContext: ProjectContext | null = null;
  private activeGenerationTarget: { kill: () => void } | null = null;

  constructor(confidenceThreshold = 70) {
    this.confidenceThreshold = confidenceThreshold;
  }

  setBrowser(browser: BrowserAgent): void {
    this.browser = browser;
  }

  setProjectContext(context: ProjectContext | null): void {
    this.projectContext = context;
  }

  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = threshold;
  }

  getConfidenceThreshold(): number {
    return this.confidenceThreshold;
  }

  private loadSidecarPrompt(): string {
    try {
      if (existsSync(SIDECAR_PROMPT_PATH)) {
        return readFileSync(SIDECAR_PROMPT_PATH, "utf-8");
      }
    } catch {
      // fall through
    }
    return "You are a developer's conversation co-pilot. Output ONLY the suggested message — no meta-commentary.";
  }

  readClaudeTranscript(projectPath?: string): string[] {
    const lines: string[] = [];
    try {
      if (!projectPath) return lines;
      const encoded = projectPath.replace(/\//g, "-");
      const dir = join(CLAUDE_HISTORY, encoded);
      if (!existsSync(dir)) return lines;

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
            if (entry.display) lines.push(entry.display);
          } catch {
            // skip
          }
        }
      }
    } catch {
      // best-effort
    }
    return lines;
  }

  readCodexTranscript(projectPath?: string): string[] {
    const lines: string[] = [];
    try {
      if (!existsSync(CODEX_SESSIONS)) return lines;
      const targetPath = projectPath ? resolve(projectPath) : null;

      const findJsonl = (dir: string): string[] => {
        const results: string[] = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) results.push(...findJsonl(full));
          else if (entry.name.endsWith(".jsonl")) results.push(full);
        }
        return results;
      };

      const files = findJsonl(CODEX_SESSIONS)
        .map((f) => ({ path: f, mtime: statSync(f).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      const matchingFile = files.find((file) => {
        if (!targetPath) return true;
        try {
          const content = readFileSync(file.path, "utf-8");
          const firstLines = content.split("\n").slice(0, 5);
          for (const line of firstLines) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line);
              const cwd = entry.payload?.cwd ?? entry.cwd ?? entry.payload?.session?.cwd;
              if (typeof cwd === "string" && resolve(cwd) === targetPath) {
                return true;
              }
            } catch {
              // ignore malformed leading lines
            }
          }
        } catch {
          // best-effort
        }
        return false;
      });

      if (matchingFile) {
        const content = readFileSync(matchingFile.path, "utf-8");
        const jsonLines = content.trim().split("\n").slice(-50);
        for (const line of jsonLines) {
          try {
            const entry = JSON.parse(line);
            if (entry.payload?.content || entry.payload?.message) {
              lines.push(entry.payload.content || entry.payload.message);
            }
          } catch {
            // skip
          }
        }
      }
    } catch {
      // best-effort
    }
    return lines;
  }

  private readClaudeSessionFallbackText(projectPath: string, sessionId: string): string | null {
    try {
      const encoded = resolve(projectPath).replace(/\//g, "-");
      const file = join(CLAUDE_HISTORY, encoded, `${sessionId}.jsonl`);
      if (!existsSync(file)) return null;

      const lines = readFileSync(file, "utf-8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .reverse();

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (entry.type !== "assistant") continue;
          const message = entry.message as Record<string, unknown> | undefined;
          const content = Array.isArray(message?.content) ? message.content : [];
          const text = content
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
            .filter((item) => item.type === "text" && typeof item.text === "string")
            .map((item) => item.text as string)
            .join("")
            .trim();
          if (text) return text;
        } catch {
          // best-effort
        }
      }
    } catch {
      // best-effort
    }
    return null;
  }

  private recoverStatefulResponderOutput(
    profile: HeadlessProfile,
    session: SessionInfo,
  ): string | null {
    const protocol = detectProtocol(profile);
    const sessionId = session.responderMonitor?.getSessionId();
    if (!sessionId) return null;

    if (protocol === "claude") {
      return this.readClaudeSessionFallbackText(session.worktreePath, sessionId);
    }

    return null;
  }

  async buildContext(
    conversationContext: string,
    llmName: string,
    session?: SessionInfo,
  ): Promise<string> {
    const parts: string[] = [];

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
    const guildProvider = getLockedProjectProvider(projectCtx);
    const responderProvider = getResponderProvider(projectCtx);
    if (guildProvider) {
      parts.push(`Guild provider: ${guildProvider}`);
    }
    if (responderProvider) {
      parts.push(`Roscoe provider: ${responderProvider}`);
    }
    if (session?.profile?.runtime) {
      parts.push(`Runtime management mode: ${getRuntimeTuningMode(session.profile.runtime)}`);
    }
    parts.push(
      `Guild governance mode: ${getWorkerGovernanceMode(projectCtx) === "roscoe-arbiter"
        ? "Roscoe arbiter (Guild should check with Roscoe before material changes)"
        : "Guild autonomous (Guild can proceed directly inside the brief)"}`,
    );
    const responderApprovalMode = getResponderApprovalMode(projectCtx);
    if (responderApprovalMode) {
      parts.push(`Roscoe approval default: ${responderApprovalMode === "auto"
        ? "auto-send high-confidence replies unless a boundary is crossed"
        : "always ask the developer before Roscoe sends a reply"}`);
    }
    parts.push(`Verification cadence: ${getVerificationCadence(projectCtx) === "prove-each-slice"
      ? "prove each focused slice with a fresh full proof run once it is ready"
      : "batch the heavy proof stack and use narrow checks while a coherent slice is still in flight"}`);
    parts.push(`Token efficiency: ${getTokenEfficiencyMode(projectCtx) === "save-tokens"
      ? "keep Roscoe lighter by default and spend the heavier reasoning budget on Guild execution"
      : "balance response quality and depth without an explicit token-saving bias"}`);
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

    const codexLines = this.readCodexTranscript(transcriptPath);
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
      } catch {
        // browser context is best-effort
      }
    }

    return parts.join("\n");
  }

  private loadSessionProjectContext(session: SessionInfo): ProjectContext | null {
    try {
      return loadProjectContext(session.projectDir);
    } catch {
      return null;
    }
  }

  private getStructuredResponseInstructions(hasBrowser: boolean, hasOrchestrator: boolean): string {
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

    return `Respond in this EXACT JSON format (no markdown fences, just raw JSON):
{
  "message": "the suggested message to send",
  "confidence": <number 0-100>,
  "reasoning": "one sentence explaining why"${hasBrowser ? ',\n  "browserActions": []' : ""}${hasOrchestrator ? ',\n  "orchestratorActions": []' : ""}
}

Message style rules:
- Do not reuse a stock Roscoe scaffold or boilerplate opener/closer.
- Write the next message as a natural continuation of this exact lane's conversation.
- If older Roscoe turns in the transcript are repetitive, do not imitate their wording.
- Only mention project anchoring, cross-project leakage, or "wrong session" corrections if the current turn still shows a real project mix-up that affects the next move.
- Do not mechanically tell Guild to rerun the full proof stack after every micro-change; follow the saved verification cadence and only call for heavy reruns when they materially change the next decision.
- Do not make preview a mandatory gate; only suggest it when a live artifact would answer the next decision faster than more implementation or tests.
- Do not treat a shell route, placeholder page, sign-in wall, tenant-not-found state, or preview-unavailable panel as "done" unless the saved brief explicitly says that state is the intended milestone. If local use still depends on seed data, auth, or external infrastructure, say so plainly and point to the next unblock.
- If the project has a hosted web presence story, do not treat local-only proof as the whole story forever. Establish or preserve the truthful preview/stage/production path that fits the repo, and use operator-openable URLs as proof when that contract says they should exist.
- If the runtime supports native agent or sub-agent delegation, you may suggest bounded parallel subtasks when they keep the feedback loop shorter without making ownership murky.

Confidence guide:
- 90-100: Transcript, definition of done, and acceptance checks all point to the same next step with no meaningful scope risk
- 70-89: Good alignment with intent, but there is still implementation or prioritization ambiguity
- 50-69: Multiple plausible next steps fit the transcript, and Roscoe's intent brief does not clearly choose between them
- Below 50: The next move would set scope, reinterpret definition of done, or claim completion without enough grounding in the intent brief${browserInstructions}${orchestratorInstructions}`;
  }

  private parseSuggestionOutput(raw: string): SuggestionResult {
    const trimmed = raw.trim();
    const jsonStr = trimmed
      .replace(/^```json?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
    const parsed = parseRoscoeDraftPayload(jsonStr);
    if (!parsed) {
      if (!trimmed) {
        throw new Error("Sidecar produced no output");
      }
      return {
        text: trimmed,
        confidence: 50,
        reasoning: "Could not parse structured response — defaulting to medium confidence",
      };
    }
    return {
      text: typeof parsed.message === "string" ? parsed.message : "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      browserActions: parsed.browserActions as BrowserAction[] | undefined,
      orchestratorActions: parsed.orchestratorActions as OrchestratorAction[] | undefined,
    };
  }

  private detectFakeGreenSignals(
    conversationContext: string,
    projectCtx: ProjectContext | null,
  ): FakeGreenSignal[] {
    const operatorFacingLines = conversationContext
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed.startsWith("User:") || trimmed.startsWith("Sent to Guild:")) {
          return false;
        }
        const lower = trimmed.toLowerCase();
        if (
          lower.startsWith("do not park or call this done yet")
          || lower.includes("fake-green guard tripped")
          || lower.includes("roscoe cleared stale parked/review guidance")
        ) {
          return false;
        }
        return true;
      });
    const recentOperatorFacingLines = operatorFacingLines.slice(-24);
    const hasExplicitLocalRunContract = Boolean(
      projectCtx?.intentBrief?.entrySurfaceContract
      || projectCtx?.intentBrief?.localRunContract,
    );
    const deploymentContract = projectCtx?.intentBrief?.deploymentContract;
    const deploymentArtifact = deploymentContract?.artifactType?.toLowerCase() ?? "";
    const isWebFacingDeployment = /\bweb app\b|\bsite\b|\bfrontend\b|\bembed\b|\bbuilder\b/.test(deploymentArtifact);
    const expectsHostedPresence = Boolean(
      deploymentContract?.presenceStrategy?.length
      || deploymentContract?.proofTargets?.length,
    );
    const findRecentUnresolvedLine = (pattern: RegExp): string | null => {
      for (let index = recentOperatorFacingLines.length - 1; index >= 0; index -= 1) {
        const line = recentOperatorFacingLines[index]!;
        const lower = line.toLowerCase();
        const matchesPattern = pattern.test(lower);
        const looksResolved = /no scaffold|no placeholder|removed|cleaned up|cleanup|truthful landing|no scaffold residue|instead of a scaffold|operator-facing cleanup|fixed|resolved/.test(lower);
        if (matchesPattern && looksResolved) {
          return null;
        }
        if (looksResolved) {
          continue;
        }
        if (matchesPattern) {
          return line.trim().replace(/\s+/g, " ");
        }
      }
      return null;
    };

    const signals: FakeGreenSignal[] = [];
    const patterns: Array<[RegExp, string]> = [
      [/\bscaffold\b|\bplaceholder\b/, "scaffold or placeholder surface still visible"],
      [/sign in to access|auth(?:entication)? required|login required/, "auth wall is still the operator-facing state"],
      [/tenant not found|project not found|not found\b/, "seeded operator entity is still missing locally"],
      [/preview unavailable|failed health checks|container failed health checks/, "preview path is still unavailable"],
      [/demo tenant|seed data|seed required/, "seed prerequisites still govern local use"],
    ];

    for (const [pattern, label] of patterns) {
      const evidence = findRecentUnresolvedLine(pattern);
      if (evidence) {
          signals.push({ label, evidence, source: "operator-surface" });
      }
    }

    if (expectsHostedPresence) {
      const hostedEvidence = findRecentUnresolvedLine(/not resolving|does not resolve|err_name_not_resolved|nxdomain|dns|could not resolve|domain .* not found|preview url .* missing|staging url .* missing/);
      if (hostedEvidence) {
        signals.push({ label: "expected hosted web presence is not resolving yet", evidence: hostedEvidence, source: "operator-surface" });
      }
    }

    if (isWebFacingDeployment && deploymentContract?.mode === "defer") {
      signals.push({
        label: "hosted proof and deployment are still explicitly deferred for this web app",
        evidence: deploymentContract.summary,
        source: "deployment-contract",
      });
    }

    const unresolvedLedger = projectCtx?.intentBrief?.acceptanceLedger
      ?.filter((item) => item.status !== "proven")
      .map((item) => item.label)
      ?? [];

    if (
      hasExplicitLocalRunContract
      && projectCtx?.intentBrief?.acceptanceLedgerMode !== "inferred"
      && unresolvedLedger.length > 0
    ) {
      signals.push({
        label: `acceptance ledger still open: ${unresolvedLedger.slice(0, 3).join(", ")}`,
        source: "acceptance-ledger",
      });
    }

    return Array.from(new Map(signals.map((signal) => [signal.label, signal])).values());
  }

  private shouldGuardAgainstFakeGreen(text: string): boolean {
    const normalized = text.toLowerCase();
    return /(done|complete|completed|substantively complete|parked|clean stop|nothing to send|green and complete|milestone complete)/.test(normalized);
  }

  private detectPrematureMilestoneParking(
    result: SuggestionResult,
    projectCtx: ProjectContext | null,
  ): { triggered: boolean; reason?: string } {
    if (loadRoscoeSettings().behavior.parkAtMilestonesForReview) {
      return { triggered: false };
    }

    if (!this.shouldGuardAgainstFakeGreen(result.text)) {
      return { triggered: false };
    }

    const normalized = `${result.text}\n${result.reasoning}`.toLowerCase();
    const referencesFutureWork = /(remaining gap|remaining gaps|remaining work|next lane|next slice|next session|later lane|later thread|open items|follow-up remains|deployment thread|bounded follow-up|future thread)/.test(normalized);
    if (referencesFutureWork) {
      return { triggered: true, reason: "the draft still describes future work as a separate lane/thread" };
    }

    const deploymentContract = projectCtx?.intentBrief?.deploymentContract;
    const artifactType = deploymentContract?.artifactType?.toLowerCase() ?? "";
    const isWebFacingDeployment = /\bweb app\b|\bsite\b|\bfrontend\b|\bembed\b|\bbuilder\b/.test(artifactType);
    if (isWebFacingDeployment && deploymentContract?.mode === "defer") {
      return { triggered: true, reason: "hosted proof/deployment is still explicitly deferred for a web app" };
    }

    return { triggered: false };
  }

  private applyDraftGuards(
    result: SuggestionResult,
    conversationContext: string,
    projectCtx: ProjectContext | null,
  ): SuggestionResult {
    const signals = this.detectFakeGreenSignals(conversationContext, projectCtx);
    const prematureParking = this.detectPrematureMilestoneParking(result, projectCtx);
    if ((!this.shouldGuardAgainstFakeGreen(result.text) || signals.length === 0) && !prematureParking.triggered) {
      return result;
    }
    const labels = signals.map((signal) => signal.label);
    const evidence = signals
      .map((signal) => signal.evidence)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    const hasOperatorFacingSignals = signals.some((signal) => signal.source === "operator-surface");
    const canAutoSendCorrection = !hasOperatorFacingSignals && (signals.length > 0 || prematureParking.triggered);
    if (prematureParking.triggered && labels.length === 0) {
      labels.push("milestone parking is off and the remaining work should be planned now");
    }
    if (prematureParking.reason) {
      evidence.push(prematureParking.reason);
    }

    return {
      ...result,
      text: `${canAutoSendCorrection ? "Continue." : "Do not park or call this done yet."} ${loadRoscoeSettings().behavior.parkAtMilestonesForReview ? "Operator-facing blockers remain" : "Milestone parking is off by default, and meaningful work remains"}: ${labels.join("; ")}. Keep the next slice focused on the next concrete, finish-seeking step instead of deferring it to a future lane.`,
      confidence: canAutoSendCorrection
        ? Math.max(82, Math.min(result.confidence, 92))
        : Math.min(result.confidence, 45),
      reasoning: evidence.length > 0
        ? `${canAutoSendCorrection ? "Continuation guard tripped" : "Fake-green guard tripped"}: ${labels.join("; ")}. Evidence: ${evidence.slice(0, 2).join(" | ")}.`
        : `${canAutoSendCorrection ? "Continuation guard tripped" : "Fake-green guard tripped"}: ${labels.join("; ")}.`,
    };
  }

  private buildIncrementalConversationContext(session?: SessionInfo): string {
    const history = session?.responderHistory ?? [];
    const cursor = session?.responderHistoryCursor ?? 0;
    const delta = history.slice(Math.max(0, cursor));
    return delta
      .map((message) => {
        if (message.role === "assistant") {
          return `Guild: ${message.content}`;
        }
        if (message.role === "user") {
          return `Sent to Guild: ${message.content}`;
        }
        return `System: ${message.content}`;
      })
      .join("\n\n");
  }

  private async buildResponderSeedPrompt(
    conversationContext: string,
    llmName: string,
    session: SessionInfo | undefined,
    projectCtx: ProjectContext | null,
  ): Promise<string> {
    const context = await this.buildContext(conversationContext, llmName, session);
    const sidecarPrompt = this.loadSidecarPrompt();
    const hasBrowser = this.browser !== null;
    const hasOrchestrator = projectCtx !== null;

    return `${sidecarPrompt}

---

Given the following context from active Guild coding sessions, formulate the best possible next message Roscoe should send.

${context}

---

This is the persistent hidden Roscoe responder thread for this lane. Keep the stable project contract, runtime policy, and lane context in memory. Future turns may send only incremental lane deltas unless Roscoe explicitly reseeds you.

${this.getStructuredResponseInstructions(hasBrowser, hasOrchestrator)}`;
  }

  private async buildResponderFollowUpPrompt(
    session: SessionInfo | undefined,
    projectCtx: ProjectContext | null,
  ): Promise<string> {
    const parts = [
      "Continue as Roscoe for this same Guild lane.",
      "Reuse the stable project contract, runtime/governance rules, and prior lane context already established earlier in this thread.",
      "Only use the new lane delta below plus the current browser state if present.",
      "",
      "=== Incremental Lane Delta ===",
      this.buildIncrementalConversationContext(session) || "(no new Guild or user turns were recorded since your last Roscoe reply)",
    ];

    if (this.browser) {
      try {
        const browserContext = await this.browser.getContextSummary();
        if (browserContext.trim()) {
          parts.push("");
          parts.push("=== Current Browser State ===");
          parts.push(browserContext);
        }
      } catch {
        // browser context is best-effort
      }
    }

    parts.push("");
    parts.push(this.getStructuredResponseInstructions(this.browser !== null, projectCtx !== null));
    return parts.join("\n");
  }

  cancelGeneration(): void {
    this.activeGenerationTarget?.kill();
    this.activeGenerationTarget = null;
  }

  private async generateSuggestionStateless(
    prompt: string,
    sidecarProfile: HeadlessProfile,
    onPartial?: (accumulated: string) => void,
  ): Promise<SuggestionResult> {
    return new Promise<SuggestionResult>((resolve, reject) => {
      let accumulated = "";
      let stderrText = "";
      let timedOut = false;
      let cancelled = false;

      const spec = buildTurnCommand(sidecarProfile, prompt);
      dbg("sidecar", `spawning ${spec.command}`);
      const proc = spawn(spec.command, spec.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: spec.env as Record<string, string>,
      });
      this.activeGenerationTarget = proc;

      proc.stdin!.end();

      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, SIDECAR_TIMEOUT_MS);

      const rl = createInterface({ input: proc.stdout! });

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

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrText += text;
        if (text.trim()) dbg("sidecar:stderr", text.trim());
      });

      proc.on("close", (code) => {
        dbg("sidecar", `closed with code ${code}`);
        clearTimeout(timeout);
        rl.close();
        if (this.activeGenerationTarget === proc) {
          this.activeGenerationTarget = null;
        }

        cancelled = proc.killed && !timedOut;

        if (code !== 0 || timedOut || cancelled) {
          let message: string;
          if (timedOut) {
            message = `Roscoe sidecar timed out after ${Math.round(SIDECAR_TIMEOUT_MS / 1000)}s before it produced a reply.`;
          } else if (cancelled) {
            message = "Sidecar generation was cancelled";
          } else if (stderrText.trim()) {
            message = stderrText.trim().split("\n")[0].slice(0, 120);
          } else {
            message = `Sidecar process failed (exit code ${code})`;
          }
          reject(new Error(message));
          return;
        }

        try {
          resolve(this.parseSuggestionOutput(accumulated));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  private async generateSuggestionStateful(
    prompt: string,
    sidecarProfile: HeadlessProfile,
    session: SessionInfo,
    onPartial?: (accumulated: string) => void,
    onUsage?: (usage: RuntimeUsageSnapshot) => void,
  ): Promise<SuggestionResult> {
    const monitor = session.responderMonitor;
    if (!monitor) {
      throw new Error("Missing responder monitor for stateful Roscoe generation");
    }

    monitor.setProfile(sidecarProfile);

    return new Promise<SuggestionResult>((resolve, reject) => {
      let accumulated = "";
      let finished = false;
      let timedOut = false;
      let sawTurnComplete = false;

      const cleanup = () => {
        monitor.off("text", onText);
        monitor.off("usage", onUsageEvent);
        monitor.off("turn-complete", onTurnComplete);
        monitor.off("exit", onExit);
        if (this.activeGenerationTarget === monitor) {
          this.activeGenerationTarget = null;
        }
        clearTimeout(timeout);
      };

      const resolveParsedSuggestion = async () => {
        const recovered = accumulated.trim()
          ? accumulated
          : this.recoverStatefulResponderOutput(sidecarProfile, session) ?? "";
        return this.parseSuggestionOutput(recovered);
      };

      const onText = (chunk: string) => {
        accumulated += chunk;
        onPartial?.(accumulated);
      };

      const onUsageEvent = (usage: RuntimeUsageSnapshot) => {
        onUsage?.(usage);
      };

      const onTurnComplete = () => {
        sawTurnComplete = true;
        if (finished) return;
        finished = true;
        cleanup();
        void resolveParsedSuggestion().then(resolve).catch((error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      };

      const onExit = (code: number) => {
        if (finished || sawTurnComplete) return;
        finished = true;
        cleanup();
        if (timedOut) {
          reject(new Error(`Roscoe sidecar timed out after ${Math.round(SIDECAR_TIMEOUT_MS / 1000)}s before it produced a reply.`));
          return;
        }
        if (code === 0) {
          void resolveParsedSuggestion().then(resolve).catch((error) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
          return;
        }
        reject(new Error(`Sidecar process failed (exit code ${code})`));
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        monitor.kill();
      }, SIDECAR_TIMEOUT_MS);

      monitor.on("text", onText);
      monitor.on("usage", onUsageEvent);
      monitor.on("turn-complete", onTurnComplete);
      monitor.on("exit", onExit);
      this.activeGenerationTarget = monitor;

      if (monitor.getSessionId()) {
        monitor.sendFollowUp(prompt);
      } else {
        monitor.startTurn(prompt);
      }
    });
  }

  async generateSuggestion(
    conversationContext: string,
    llmName: string,
    session?: SessionInfo,
    onPartial?: (accumulated: string) => void,
    onTrace?: (trace: SuggestionTrace) => void,
    onUsage?: (usage: RuntimeUsageSnapshot) => void,
  ): Promise<SuggestionResult> {
    const projectCtx = session
      ? this.loadSessionProjectContext(session)
      : this.projectContext;
    if (session && !session.responderMonitor) {
      throw new Error("Roscoe responder session is required for lane-backed drafting");
    }
    const responderProvider = getResponderProvider(projectCtx);
    const baseProfile = responderProvider
      ? loadProfile(getDefaultProfileName(responderProvider))
      : session?.profile ?? inferProfile(llmName);
    const runtimePlan = recommendResponderRuntime(baseProfile, conversationContext, projectCtx);
    const sidecarProfile = runtimePlan.profile;
    const useStatefulResponder = Boolean(session);
    const isSeedTurn = useStatefulResponder
      ? !session?.responderMonitor?.getSessionId() || (session?.responderHistoryCursor ?? 0) === 0
      : false;
    const prompt = useStatefulResponder
      ? isSeedTurn
        ? await this.buildResponderSeedPrompt(conversationContext, llmName, session, projectCtx)
        : await this.buildResponderFollowUpPrompt(session, projectCtx)
      : `${this.loadSidecarPrompt()}

---

Given the following context from active Guild coding sessions, formulate the best possible next message Roscoe should send.

${await this.buildContext(conversationContext, llmName, session)}

---

${this.getStructuredResponseInstructions(this.browser !== null, projectCtx !== null)}`;

    onTrace?.({
      prompt,
      commandPreview: buildCommandPreview(sidecarProfile, useStatefulResponder ? session?.responderMonitor?.getSessionId() : undefined),
      runtimeSummary: runtimePlan.summary || summarizeRuntime(sidecarProfile),
      strategy: runtimePlan.strategy,
      rationale: useStatefulResponder
        ? isSeedTurn
          ? `${runtimePlan.rationale} Roscoe seeds this responder thread once, then resumes it on later turns.`
          : `${runtimePlan.rationale} Roscoe reuses the existing responder thread and sends only incremental lane deltas.`
        : runtimePlan.rationale,
    });

    const rawResult = useStatefulResponder
      ? await this.generateSuggestionStateful(prompt, sidecarProfile, session!, onPartial, onUsage)
      : await this.generateSuggestionStateless(prompt, sidecarProfile, onPartial);

    return this.applyDraftGuards(rawResult, conversationContext, projectCtx);
  }

  meetsThreshold(result: SuggestionResult): boolean {
    return result.confidence >= this.confidenceThreshold;
  }
}

function inferProfile(llmName: string): HeadlessProfile {
  const normalized = llmName.toLowerCase();
  if (normalized.includes("codex")) {
    return {
      name: llmName,
      command: "codex",
      args: [],
      protocol: "codex",
    };
  }

  if (normalized.includes("gemini")) {
    return {
      name: llmName,
      command: "gemini",
      args: [],
      protocol: "gemini",
    };
  }

  return {
    name: llmName,
    command: "claude",
    args: [],
    protocol: "claude",
  };
}
