import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { BrowserAgent } from "./browser-agent.js";
import { InterviewAnswer, loadProfile, loadProjectContext, loadRoscoeSettings, ProjectContext, saveProjectContext } from "./config.js";
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
  getExecutionModeLabel,
  getLockedProjectProvider,
  getResponderProvider,
  getTokenEfficiencyMode,
  getVerificationCadence,
  getResponderApprovalMode,
  getRuntimeTuningMode,
  getWorkerGovernanceMode,
  recommendResponderRuntime,
} from "./runtime-defaults.js";
import {
  inferMalformedStructuredDecision,
  inferRoscoeDecision,
  looksLikeRoscoeStructuredDraft,
  MALFORMED_STRUCTURED_DRAFT_REASONING,
  parseRoscoeDraftPayload,
  RoscoeDecision,
} from "./roscoe-draft.js";
import { SessionMonitor } from "./session-monitor.js";
import type { Message } from "./conversation-tracker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLAUDE_HISTORY = join(process.env.HOME || "~", ".claude", "projects");
const CODEX_SESSIONS = join(process.env.HOME || "~", ".codex", "sessions");
const SIDECAR_PROMPT_PATH = join(__dirname, "..", "sidecar-prompt.md");
const SIDECAR_TIMEOUT_MS = 300_000;
const ACCEPTANCE_CLOSURE_PATTERN = /\b(already closed|ledger is closed|ledger items? (?:are )?(?:done|closed|complete)|acceptance ledger (?:is )?closed|all \d+ (?:acceptance )?ledger items? (?:are )?(?:done|closed|complete)|all three (?:acceptance )?ledger items? (?:are )?(?:done|closed|complete)|what is closed now|closed now|that closes|closes the .* front|shipped and validated|done and validated|no items remain open)\b/i;
const ACCEPTANCE_PROOF_PATTERN = /\b(ci run|actions\/runs\/\d{6,}|\d{6,}|all green|fully green|hosted-green|green|0 failures|build green|mergeable|validated|pass(?:es|ed|ing)?|e2e|typecheck|lint|tests|nitro build)\b/i;
const ACCEPTANCE_NEGATIVE_PATTERN = /\b(acceptance ledger still open|continuation guard tripped|meaningful work remains|do not park|keep the next slice focused|future lane|future thread|remaining work)\b/i;
const STALLED_GUILD_REVIEW_PATTERN = /\b(unresponsive|manual restart|fresh prompt|stalled [a-z]+ session|stalled guild|developer intervention|pick this up in a different lane|resend (?:the )?(?:triage )?directive)\b/i;
const DEFERENTIAL_TAIL_PATTERN = /\b(your call|if you want|want me to|would you prefer|up to you|should go to the developer|defer to the developer)\b/i;
const EXPLICIT_APPROVAL_BOUNDARY_PATTERN = /\b(production deploy|deploy to prod|push to main|merge to main|destructive|delete data|migration|billing approval|secret rotation|approval boundary|risk boundary)\b/i;
const DEPLOYED_CONTRADICTION_PATTERN = /\b(still broken|same error|invalid authentication state|can you read pod logs|pod logs|dig deeper|live issue remains|same failure)\b/i;
const DEPLOYED_DEBUG_PATTERN = /\b(kubectl|pod logs|server logs|rollout status|describe|dig deeper|contradiction mode|callback params|cookies?)\b/i;
const CLOSURE_SIGNAL_PATTERN = /\b(fully closed|lane is fully closed|lane is closed|nothing left|only remaining (?:check|thing)|parked|done|final hosted result|hold silently|waiting on the final hosted result)\b/i;
const MAX_COMPACT_TEXT_CHARS = 220;
const MAX_COMPACT_CONVERSATION_LINES = 80;
const MAX_COMPACT_CONVERSATION_CHARS = 12_000;
const MAX_COMPACT_TRANSCRIPT_LINES = 6;

type ProjectIntentRenderMode = "balanced" | "compact";

function clipText(text: string, maxChars = MAX_COMPACT_TEXT_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function summarizeValues(values: string[], limit: number, maxChars = MAX_COMPACT_TEXT_CHARS): string {
  const cleaned = values
    .map((value) => clipText(value, maxChars))
    .filter((value) => value.length > 0);
  if (cleaned.length === 0) return "";
  const head = cleaned.slice(0, limit).join(" | ");
  const remaining = cleaned.length - limit;
  return remaining > 0 ? `${head} | +${remaining} more` : head;
}

function summarizeAcceptanceLedger(
  projectCtx: ProjectContext,
  limit = 4,
): { openSummary: string; provenCount: number; openCount: number } {
  const ledger = projectCtx.intentBrief?.acceptanceLedger ?? [];
  const openItems = ledger.filter((item) => item.status !== "proven");
  const provenCount = ledger.length - openItems.length;
  return {
    openSummary: summarizeValues(openItems.map((item) => item.label), limit, 140),
    provenCount,
    openCount: openItems.length,
  };
}

function formatInterviewAnswers(answers: InterviewAnswer[], options?: { limit?: number; compact?: boolean }): string[] {
  if (answers.length === 0) return [];
  const limit = options?.limit ?? 8;
  const compact = options?.compact ?? false;
  const selected = answers.slice(-limit);
  return selected.map((answer, index) => {
    const question = compact ? clipText(answer.question, 110) : answer.question;
    const response = compact ? clipText(answer.answer, 160) : answer.answer;
    return `${index + 1}. ${answer.theme ? `[${answer.theme}] ` : ""}${question} => ${response}`;
  });
}

function appendProjectIntent(
  parts: string[],
  projectCtx: ProjectContext,
  mode: ProjectIntentRenderMode = "balanced",
): void {
  if (!projectCtx.intentBrief) return;
  if (mode === "compact") {
    const ledgerSummary = summarizeAcceptanceLedger(projectCtx);
    parts.push("=== Roscoe Contract Digest ===");
    parts.push(`Project story: ${clipText(projectCtx.intentBrief.projectStory, 180)}`);
    if (projectCtx.intentBrief.definitionOfDone.length > 0) {
      parts.push(`Definition of done: ${summarizeValues(projectCtx.intentBrief.definitionOfDone, 3, 140)}`);
    }
    if (projectCtx.intentBrief.acceptanceChecks.length > 0) {
      parts.push(`Acceptance checks: ${summarizeValues(projectCtx.intentBrief.acceptanceChecks, 3, 140)}`);
    }
    if (projectCtx.intentBrief.entrySurfaceContract?.summary) {
      parts.push(`Entry surface: ${clipText(projectCtx.intentBrief.entrySurfaceContract.summary, 160)}`);
    }
    if (projectCtx.intentBrief.localRunContract?.summary) {
      parts.push(`Local run: ${clipText(projectCtx.intentBrief.localRunContract.summary, 160)}`);
    }
    if (ledgerSummary.openCount > 0) {
      parts.push(`Open ledger (${ledgerSummary.openCount}, ${ledgerSummary.provenCount} proven): ${ledgerSummary.openSummary}`);
    } else if ((projectCtx.intentBrief.acceptanceLedger?.length ?? 0) > 0) {
      parts.push(`Acceptance ledger: all ${(projectCtx.intentBrief.acceptanceLedger ?? []).length} items currently proven.`);
    }
    if (projectCtx.intentBrief.coverageMechanism.length > 0) {
      parts.push(`Coverage mechanism: ${summarizeValues(projectCtx.intentBrief.coverageMechanism, 2, 140)}`);
    }
    if (projectCtx.intentBrief.deploymentContract?.summary) {
      parts.push(`Deployment: ${clipText(projectCtx.intentBrief.deploymentContract.summary, 160)}`);
    }
    if (projectCtx.intentBrief.nonGoals.length > 0) {
      parts.push(`Non-goals: ${summarizeValues(projectCtx.intentBrief.nonGoals, 3, 120)}`);
    }
    if (projectCtx.intentBrief.autonomyRules.length > 0) {
      parts.push(`Autonomy rules: ${summarizeValues(projectCtx.intentBrief.autonomyRules, 3, 120)}`);
    }
    if (projectCtx.intentBrief.qualityBar.length > 0) {
      parts.push(`Quality bar: ${summarizeValues(projectCtx.intentBrief.qualityBar, 3, 120)}`);
    }
    if (projectCtx.intentBrief.riskBoundaries.length > 0) {
      parts.push(`Risk boundaries: ${summarizeValues(projectCtx.intentBrief.riskBoundaries, 3, 120)}`);
    }
    parts.push(
      loadRoscoeSettings().behavior.parkAtMilestonesForReview
        ? "Milestone parking mode: enabled."
        : "Milestone parking mode: disabled.",
    );
    if (projectCtx.interviewAnswers && projectCtx.interviewAnswers.length > 0) {
      parts.push("Recent interview answers:");
      parts.push(...formatInterviewAnswers(projectCtx.interviewAnswers, { limit: 3, compact: true }));
    }
    parts.push("");
    return;
  }
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

function compactConversationContext(conversationContext: string): string {
  const lines = conversationContext.split("\n").filter((line) => line.trim().length > 0);
  const truncatedByLines = lines.length > MAX_COMPACT_CONVERSATION_LINES
    ? lines.slice(-MAX_COMPACT_CONVERSATION_LINES)
    : lines;
  let compacted = truncatedByLines.join("\n");
  if (compacted.length > MAX_COMPACT_CONVERSATION_CHARS) {
    compacted = compacted.slice(compacted.length - MAX_COMPACT_CONVERSATION_CHARS);
    const newlineIndex = compacted.indexOf("\n");
    if (newlineIndex >= 0) {
      compacted = compacted.slice(newlineIndex + 1);
    }
  }
  if (compacted !== conversationContext.trim()) {
    return `[Roscoe compacted older lane context for token efficiency.]\n${compacted}`;
  }
  return compacted;
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

export interface HostAction {
  type: "git" | "gh" | "kubectl";
  args: string[];
  description: string;
}

export interface SuggestionResult {
  decision?: RoscoeDecision;
  text: string;
  confidence: number;
  reasoning: string;
  browserActions?: BrowserAction[];
  orchestratorActions?: OrchestratorAction[];
  hostActions?: HostAction[];
}

export interface SessionInfo {
  profile: HeadlessProfile;
  responderProfile?: HeadlessProfile;
  profileName: string;
  projectName: string;
  projectDir: string;
  worktreePath: string;
  worktreeName: string;
  responderMonitor?: SessionMonitor;
  responderHistory?: Message[];
  responderHistoryCursor?: number;
  onResponderStateReset?: () => void;
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

function normalizeComparisonText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function describeRuntimeAccess(runtime: HeadlessProfile["runtime"], role: "guild" | "roscoe"): string {
  const executionMode = getExecutionModeLabel(runtime);
  if (role === "guild") {
    return executionMode === "accelerated"
      ? "Guild access: accelerated filesystem + network access is enabled for this lane."
      : "Guild access: safe sandboxed execution is active for this lane.";
  }

  return executionMode === "accelerated"
    ? "Roscoe access: accelerated responder runtime is enabled, but Roscoe should still stay focused on drafting and coordination."
    : "Roscoe access: safe responder runtime is active; Roscoe drafts, coordinates, and may use tightly scoped hostActions when the transcript already justifies them.";
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

  private shouldRetryStatefulResponder(
    error: unknown,
    session: SessionInfo,
  ): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const hasExistingResponderThread = Boolean(session.responderMonitor?.getSessionId());
    if (!hasExistingResponderThread) return false;
    return true;
  }

  private resetStatefulResponder(session: SessionInfo): void {
    session.responderMonitor?.restoreSessionId(null);
    session.responderHistoryCursor = 0;
    session.onResponderStateReset?.();
  }

  private sanitizeResponderProfileForDrafting(profile: HeadlessProfile): HeadlessProfile {
    if (detectProtocol(profile) !== "claude") {
      return profile;
    }

    if (!profile.runtime) {
      return profile;
    }

    const runtime = { ...profile.runtime };
    delete runtime.permissionMode;
    delete runtime.dangerouslySkipPermissions;
    return {
      ...profile,
      runtime,
    };
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
    const compactMode = projectCtx ? getTokenEfficiencyMode(projectCtx) === "save-tokens" : false;

    if (projectCtx) {
      parts.push("=== Project Context ===");
      parts.push(`Project: ${projectCtx.name}`);
      if (session?.worktreeName && session.worktreeName !== "main") {
        parts.push(`Worktree: ${session.worktreeName} (${session.worktreePath})`);
      }
      parts.push(`Goals: ${compactMode ? summarizeValues(projectCtx.goals, 3, 120) : projectCtx.goals.join(", ")}`);
      parts.push(`Milestones: ${compactMode ? summarizeValues(projectCtx.milestones, 3, 120) : projectCtx.milestones.join(", ")}`);
      parts.push(`Tech: ${compactMode ? summarizeValues(projectCtx.techStack, 4, 80) : projectCtx.techStack.join(", ")}`);
      if (projectCtx.notes) {
        parts.push(`Notes: ${compactMode ? clipText(projectCtx.notes, 180) : projectCtx.notes}`);
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
        parts.push(describeRuntimeAccess(session.profile.runtime, "guild"));
      }
      if (session?.responderProfile?.runtime) {
        parts.push(describeRuntimeAccess(session.responderProfile.runtime, "roscoe"));
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
      parts.push(`Token efficiency: ${compactMode
        ? "save tokens — compact contract digest plus recent lane delta only"
        : "balanced — broader context when it materially helps the next move"}`);
      parts.push("");
      appendProjectIntent(parts, projectCtx, compactMode ? "compact" : "balanced");
    }

    // Active conversation
    parts.push(`=== Active Guild conversation with ${llmName} ===`);
    parts.push(compactMode ? compactConversationContext(conversationContext) : conversationContext);

    // Transcript context from the session's working directory
    const transcriptPath = session?.worktreePath || process.cwd();
    const claudeLines = this.readClaudeTranscript(transcriptPath);
    if (claudeLines.length > 0) {
      parts.push("\n=== Recent Claude Code transcript ===");
      parts.push(
        (compactMode ? claudeLines.slice(-MAX_COMPACT_TRANSCRIPT_LINES) : claudeLines.slice(-20))
          .map((line) => compactMode ? clipText(line, 180) : line)
          .join("\n"),
      );
    }

    const codexLines = this.readCodexTranscript(transcriptPath);
    if (codexLines.length > 0) {
      parts.push("\n=== Recent Codex transcript ===");
      parts.push(
        (compactMode ? codexLines.slice(-MAX_COMPACT_TRANSCRIPT_LINES) : codexLines.slice(-20))
          .map((line) => compactMode ? clipText(line, 180) : line)
          .join("\n"),
      );
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

  private getStructuredResponseInstructions(hasBrowser: boolean, hasOrchestrator: boolean, hasHostActions: boolean): string {
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

    const hostInstructions = hasHostActions
      ? `\n\nYou can suggest tightly scoped host-side Git, GitHub CLI, or read-only kubectl actions when the transcript already justifies them and Roscoe needs a host bridge. Include a "hostActions" array with objects like:
  {"type": "git", "args": ["add", "path/to/file.ts"], "description": "stage the approved file"}
  {"type": "git", "args": ["commit", "-m", "Commit message"], "description": "create the approved commit"}
  {"type": "git", "args": ["push", "origin", "HEAD:test"], "description": "push the approved branch"}
  {"type": "gh", "args": ["run", "list", "--branch", "test", "--limit", "3"], "description": "check the latest hosted runs"}
  {"type": "gh", "args": ["run", "view", "23871518136", "--json", "status,conclusion,url"], "description": "inspect the hosted CI result"}
  {"type": "kubectl", "args": ["--context", "k12-test-user", "rollout", "status", "deployment/k12io-test", "-n", "default"], "description": "check the current test rollout"}
  {"type": "kubectl", "args": ["--context", "k12-test-user", "logs", "deployment/k12io-test", "-n", "default", "--since", "30m"], "description": "inspect recent deployed app logs"}

Host action rules:
- Keep hostActions limited to Git, \`gh run list\` / \`gh run view\`, and read-only \`kubectl\` checks (\`config current-context\`, \`get\`, \`describe\`, \`logs\`, \`rollout status\`). Do not use shell wrappers, chaining, or arbitrary binaries.
- Only use hostActions when the transcript already justifies the exact step and Roscoe needs a host bridge, not because you want broader elevated access.
- Do not invent file lists, commit messages, or ref names that are not grounded in the transcript.
- For \`gh\` hostActions, stay focused on hosted CI proof that is already named in the transcript (branch, commit, run id, job, or status check).
- For \`kubectl\` hostActions, stay read-only and focused on explaining a live deployed contradiction: active rollout, current pod, recent logs, or resource description on the affected environment.
- If you include hostActions, write "message" as the follow-up Roscoe should send to the Guild after those hostActions run successfully. Do not ask the user to approve or manually run the Git command again.`
      : "";

    return `Respond in this EXACT JSON format (no markdown fences, just raw JSON):
{
  "decision": "message | restart-worker | noop | host-actions-only | needs-review",
  "message": "the suggested message to send",
  "confidence": <number 0-100>,
  "reasoning": "one sentence explaining why"${hasBrowser ? ',\n  "browserActions": []' : ""}${hasOrchestrator ? ',\n  "orchestratorActions": []' : ""}${hasHostActions ? ',\n  "hostActions": []' : ""}
}

Decision rules:
- "message": Roscoe should send the message to Guild normally
- "restart-worker": Roscoe should restart the Guild turn and send this message as the fresh redirect when the current Guild lane appears stalled but the next open ledger item is still clear
- "noop": Roscoe should hold silently and send nothing
- "host-actions-only": Roscoe should run the listed hostActions now; keep "message" empty unless Roscoe should send a follow-up after those actions succeed
- "needs-review": Roscoe should surface the draft for developer review instead of auto-sending

Message style rules:
- Do not reuse a stock Roscoe scaffold or boilerplate opener/closer.
- Write the next message as a natural continuation of this exact lane's conversation.
- Keep the message terse by default: prefer 1 short paragraph or 2-4 flat bullets, not a long memo.
- Do not restate the full project brief, ledger, or run history when a short directive or short rationale is enough.
- Do not paste or quote structured JSON back into the conversation.
- If older Roscoe turns in the transcript are repetitive, do not imitate their wording.
- Only mention project anchoring, cross-project leakage, or "wrong session" corrections if the current turn still shows a real project mix-up that affects the next move.
- Do not mechanically tell Guild to rerun the full proof stack after every micro-change; follow the saved verification cadence and only call for heavy reruns when they materially change the next decision.
- Do not make preview a mandatory gate; only suggest it when a live artifact would answer the next decision faster than more implementation or tests.
- Do not treat a shell route, placeholder page, sign-in wall, tenant-not-found state, or preview-unavailable panel as "done" unless the saved brief explicitly says that state is the intended milestone. If local use still depends on seed data, auth, or external infrastructure, say so plainly and point to the next unblock.
- If the project has a hosted web presence story, do not treat local-only proof as the whole story forever. Establish or preserve the truthful preview/stage/production path that fits the repo, and use operator-openable URLs as proof when that contract says they should exist.
- If the developer says the deployed environment is still broken after green CI or a closure summary, treat that as a contradiction, not noise. Do not close the lane. Gather live deployed evidence first: rollout status, recent pod/server logs, relevant curl/browser repro, and the exact failing auth/callback/request path.
- If the Guild lane is blocked by the shared worktree/.git boundary, or Roscoe only needs hosted CI proof via \`gh run\`, prefer hostActions over asking the user to run those commands manually.
- If the Guild has gone silent through repeated no-activity deltas but the next still-open ledger item is clear, use "restart-worker" with the exact redirect Roscoe should send. Do not ask the developer whether Roscoe should resend it unless the next slice is genuinely ambiguous or crosses an approval boundary.
- When the saved brief clearly resolves a trade-off, direct the choice plainly. Do not end with "your call", "if you want", or another deference phrase unless an explicit approval boundary is actually in play.
- If the runtime supports native agent or sub-agent delegation, you may suggest bounded parallel subtasks when they keep the feedback loop shorter without making ownership murky.

Confidence guide:
- 90-100: Transcript, definition of done, and acceptance checks all point to the same next step with no meaningful scope risk
- 70-89: Good alignment with intent, but there is still implementation or prioritization ambiguity
- 50-69: Multiple plausible next steps fit the transcript, and Roscoe's intent brief does not clearly choose between them
- Below 50: The next move would set scope, reinterpret definition of done, or claim completion without enough grounding in the intent brief${browserInstructions}${orchestratorInstructions}${hostInstructions}`;
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
      if (looksLikeRoscoeStructuredDraft(trimmed)) {
        return {
          decision: inferMalformedStructuredDecision(trimmed),
          text: "",
          confidence: 20,
          reasoning: MALFORMED_STRUCTURED_DRAFT_REASONING,
        };
      }
      return {
        decision: "needs-review",
        text: trimmed,
        confidence: 50,
        reasoning: "Could not parse structured response — defaulting to medium confidence",
      };
    }

    const decision = inferRoscoeDecision(parsed);
    return {
      decision,
      text: typeof parsed.message === "string" ? parsed.message : "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      browserActions: parsed.browserActions as BrowserAction[] | undefined,
      orchestratorActions: parsed.orchestratorActions as OrchestratorAction[] | undefined,
      hostActions: parsed.hostActions as HostAction[] | undefined,
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

  private getRecentTranscriptLines(conversationContext: string): string[] {
    return conversationContext
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-120);
  }

  private getAcceptanceMatchTerms(item: { label: string; evidence: string[] }): string[] {
    const terms = [item.label];
    const withoutParens = item.label.replace(/\s*\([^)]*\)/g, "").trim();
    if (withoutParens.length > 0 && withoutParens !== item.label) {
      terms.push(withoutParens);
    }
    const colonIndex = item.label.indexOf(":");
    if (colonIndex >= 0) {
      const suffix = item.label.slice(colonIndex + 1).trim();
      if (suffix.length > 0) {
        terms.push(suffix);
      }
    }
    const colonSansParensIndex = withoutParens.indexOf(":");
    if (colonSansParensIndex >= 0) {
      const suffix = withoutParens.slice(colonSansParensIndex + 1).trim();
      if (suffix.length > 0) {
        terms.push(suffix);
      }
    }

    for (const evidence of item.evidence) {
      const cleaned = evidence.replace(/[`*]/g, "").trim();
      if (cleaned.length >= 14) {
        terms.push(cleaned);
      }
    }

    return uniqueStrings(terms.map((term) => normalizeComparisonText(term)).filter((term) => term.length >= 12));
  }

  private collectAcceptanceProofLines(
    lines: string[],
    item: { label: string; evidence: string[] },
  ): string[] {
    const terms = this.getAcceptanceMatchTerms(item);
    if (terms.length === 0) {
      return [];
    }

    const matchIndexes = lines.flatMap((line, index) => {
      const normalized = normalizeComparisonText(line);
      if (ACCEPTANCE_NEGATIVE_PATTERN.test(normalized)) {
        return [];
      }
      return terms.some((term) => normalized.includes(term)) ? [index] : [];
    });
    if (matchIndexes.length === 0) {
      return [];
    }

    const proofIndexes = new Set<number>();

    for (const index of matchIndexes) {
      const start = Math.max(0, index - 3);
      const end = Math.min(lines.length - 1, index + 3);
      let windowHasProof = false;

      for (let cursor = start; cursor <= end; cursor += 1) {
        const candidate = lines[cursor]!;
        if (ACCEPTANCE_PROOF_PATTERN.test(candidate) || ACCEPTANCE_CLOSURE_PATTERN.test(candidate)) {
          windowHasProof = true;
          break;
        }
      }

      if (!windowHasProof) {
        continue;
      }

      proofIndexes.add(index);
      for (let cursor = start; cursor <= end; cursor += 1) {
        const candidate = lines[cursor]!;
        if (ACCEPTANCE_PROOF_PATTERN.test(candidate) || ACCEPTANCE_CLOSURE_PATTERN.test(candidate)) {
          proofIndexes.add(cursor);
        }
      }
    }

    if (proofIndexes.size === 0) {
      return [];
    }

    return Array.from(proofIndexes)
      .sort((a, b) => a - b)
      .map((index) => lines[index]!)
      .slice(-3);
  }

  private syncAcceptanceLedgerFromTranscript(
    conversationContext: string,
    projectCtx: ProjectContext | null,
    session?: SessionInfo,
  ): ProjectContext | null {
    if (!projectCtx?.intentBrief?.acceptanceLedger?.length) {
      return projectCtx;
    }
    if (projectCtx.intentBrief.acceptanceLedgerMode === "inferred") {
      return projectCtx;
    }

    const lines = this.getRecentTranscriptLines(conversationContext);
    const hasClosureSignal = lines.some((line) => ACCEPTANCE_CLOSURE_PATTERN.test(line));
    const hasProofSignal = lines.some((line) => ACCEPTANCE_PROOF_PATTERN.test(line));
    if (!hasClosureSignal || !hasProofSignal) {
      return projectCtx;
    }

    let changed = false;
    const updatedLedger = projectCtx.intentBrief.acceptanceLedger.map((item) => {
      if (item.status === "proven") {
        return item;
      }

      const transcriptProof = this.collectAcceptanceProofLines(lines, item);
      if (transcriptProof.length === 0) {
        return item;
      }

      changed = true;
      return {
        ...item,
        status: "proven" as const,
        evidence: uniqueStrings([
          ...item.evidence,
          ...transcriptProof.map((line) => `Transcript proof: ${line}`),
        ]).slice(0, 8),
      };
    });

    if (!changed) {
      return projectCtx;
    }

    const nextContext: ProjectContext = {
      ...projectCtx,
      intentBrief: {
        ...projectCtx.intentBrief,
        acceptanceLedger: updatedLedger,
      },
    };

    try {
      saveProjectContext(nextContext);
    } catch {
      // best-effort sync; guard logic can still use the in-memory update
    }

    if (!session) {
      this.projectContext = nextContext;
    }

    return nextContext;
  }

  private getNextOpenAcceptanceLedgerItem(projectCtx: ProjectContext | null): { label: string } | null {
    return projectCtx?.intentBrief?.acceptanceLedger?.find((item) => item.status !== "proven") ?? null;
  }

  private buildRestartWorkerMessage(nextOpenLabel: string): string {
    return `Continue. The last proof cluster is already settled. Restart from the next still-open ledger item: ${nextOpenLabel}. First verify what proof already exists for that item, then take the smallest concrete step that advances or closes it. Do not reopen superseded green runs unless they materially block this item.`;
  }

  private maybeRecoverStalledGuild(
    result: SuggestionResult,
    session: SessionInfo | undefined,
    projectCtx: ProjectContext | null,
  ): SuggestionResult {
    if (!session) {
      return result;
    }

    if (inferRoscoeDecision(result) === "restart-worker") {
      return result;
    }

    if (inferRoscoeDecision(result) !== "needs-review") {
      return result;
    }

    if (this.buildIncrementalConversationContext(session).trim()) {
      return result;
    }

    const nextOpen = this.getNextOpenAcceptanceLedgerItem(projectCtx);
    if (!nextOpen) {
      return result;
    }

    const combined = `${result.text}\n${result.reasoning}`;
    if (!STALLED_GUILD_REVIEW_PATTERN.test(combined)) {
      return result;
    }

    return {
      ...result,
      decision: "restart-worker",
      text: this.buildRestartWorkerMessage(nextOpen.label),
      confidence: Math.max(82, Math.min(result.confidence, 92)),
      reasoning: `Guild stall self-heal: ${nextOpen.label} is still open, no new Guild delta landed, and Roscoe is restarting the lane on the next concrete ledger item instead of asking the developer whether to resend the prompt.`,
    };
  }

  private maybeStrengthenArbiterConviction(
    result: SuggestionResult,
    projectCtx: ProjectContext | null,
  ): SuggestionResult {
    if (getWorkerGovernanceMode(projectCtx) !== "roscoe-arbiter") {
      return result;
    }

    if (inferRoscoeDecision(result) === "noop" || inferRoscoeDecision(result) === "host-actions-only") {
      return result;
    }

    const combined = `${result.text}\n${result.reasoning}`;
    if (!DEFERENTIAL_TAIL_PATTERN.test(combined)) {
      return result;
    }

    if (EXPLICIT_APPROVAL_BOUNDARY_PATTERN.test(combined)) {
      return result;
    }

    let nextText = result.text.trim();
    if (!nextText) {
      return result;
    }

    nextText = nextText
      .replace(/\bThe alternative is[\s\S]*$/i, "")
      .replace(/\b(your call|if you want|want me to|would you prefer|up to you)\b[\s\S]*$/i, "")
      .replace(/\bthis should go to the developer\b[\s\S]*$/i, "")
      .replace(/\bdefer to the developer\b[\s\S]*$/i, "")
      .trim();

    if (!nextText || nextText === result.text.trim()) {
      return result;
    }

    nextText = nextText.replace(/^Recommendation:\s*/i, "Proceed with this: ");

    return {
      ...result,
      decision: "message",
      text: nextText,
      confidence: Math.max(84, Math.min(result.confidence, 94)),
      reasoning: "Roscoe arbiter conviction: the onboarding brief already resolves this trade-off, so Roscoe should direct the stronger path instead of deferring it back to the developer.",
    };
  }

  private detectLiveDeployedContradiction(
    conversationContext: string,
    projectCtx: ProjectContext | null,
    result: SuggestionResult,
  ): { triggered: boolean; evidence?: string } {
    const deploymentArtifact = projectCtx?.intentBrief?.deploymentContract?.artifactType?.toLowerCase() ?? "";
    const hasHostedStory = Boolean(
      projectCtx?.intentBrief?.deploymentContract
      || /\bweb app\b|\bsite\b|\bfrontend\b|\bembed\b|\bbuilder\b/.test(deploymentArtifact),
    );
    if (!hasHostedStory) {
      return { triggered: false };
    }

    const recentLines = this.getRecentTranscriptLines(conversationContext).slice(-24);
    const contradictionLine = [...recentLines]
      .reverse()
      .find((line) => DEPLOYED_CONTRADICTION_PATTERN.test(line));
    if (!contradictionLine) {
      return { triggered: false };
    }

    const combined = `${result.text}\n${result.reasoning}`;
    const isAlreadyDebugging = DEPLOYED_DEBUG_PATTERN.test(combined);
    const looksClosedOrIdle = inferRoscoeDecision(result) === "noop"
      || CLOSURE_SIGNAL_PATTERN.test(combined);

    if (!looksClosedOrIdle || isAlreadyDebugging) {
      return { triggered: false };
    }

    return {
      triggered: true,
      evidence: clipText(contradictionLine, 220),
    };
  }

  private wasRecentEquivalentGuardAlreadySent(
    conversationContext: string,
    text: string,
  ): boolean {
    if (!text.trim()) {
      return false;
    }
    return normalizeComparisonText(conversationContext).includes(normalizeComparisonText(text));
  }

  private applyDraftGuards(
    result: SuggestionResult,
    conversationContext: string,
    projectCtx: ProjectContext | null,
  ): SuggestionResult {
    const contradiction = this.detectLiveDeployedContradiction(conversationContext, projectCtx, result);
    if (contradiction.triggered) {
      return {
        ...result,
        decision: "message",
        text: `Do not close or hold this lane. The developer just reproduced the issue on the deployed environment: ${contradiction.evidence}. Enter contradiction mode now: verify the active rollout/pod, pull recent pod or server logs on the failing auth path, compare the live callback params/cookies against the expected state handling, and only then ship the next fix and re-prove it on the deployed URL.`,
        confidence: 94,
        reasoning: "Developer-reported deployed failure outranks green CI or closure summaries until the live contradiction is explained with direct runtime evidence.",
      };
    }

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

    const correctionText = `${canAutoSendCorrection ? "Continue." : "Do not park or call this done yet."} ${loadRoscoeSettings().behavior.parkAtMilestonesForReview ? "Operator-facing blockers remain" : "Milestone parking is off by default, and meaningful work remains"}: ${labels.join("; ")}. Keep the next slice focused on the next concrete, finish-seeking step instead of deferring it to a future lane.`;
    if (canAutoSendCorrection && this.wasRecentEquivalentGuardAlreadySent(conversationContext, correctionText)) {
      return {
        ...result,
        decision: "noop",
        confidence: Math.min(result.confidence, 68),
        reasoning: evidence.length > 0
          ? `Repeated continuation guard suppressed: ${labels.join("; ")}. Evidence: ${evidence.slice(0, 2).join(" | ")}.`
          : `Repeated continuation guard suppressed: ${labels.join("; ")}.`,
        text: "Hold. The same continuation guidance is already in the lane transcript; wait for a materially different Guild update or fresh proof before restating it.",
      };
    }

    return {
      ...result,
      decision: "message",
      text: correctionText,
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
    const hasHostActions = session !== undefined;

    return `${sidecarPrompt}

---

Given the following context from active Guild coding sessions, formulate the best possible next message Roscoe should send.

${context}

---

This is the persistent hidden Roscoe responder thread for this lane. Keep the stable project contract, runtime policy, and lane context in memory. Future turns may send only incremental lane deltas unless Roscoe explicitly reseeds you.

${this.getStructuredResponseInstructions(hasBrowser, hasOrchestrator, hasHostActions)}`;
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
    parts.push(this.getStructuredResponseInstructions(this.browser !== null, projectCtx !== null, session !== undefined));
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
    let projectCtx = session
      ? this.loadSessionProjectContext(session)
      : this.projectContext;
    projectCtx = this.syncAcceptanceLedgerFromTranscript(conversationContext, projectCtx, session);
    if (session && !session.responderMonitor) {
      throw new Error("Roscoe responder session is required for lane-backed drafting");
    }
    const responderProvider = getResponderProvider(projectCtx);
    const baseProfile = responderProvider
      ? loadProfile(getDefaultProfileName(responderProvider))
      : session?.profile ?? inferProfile(llmName);
    const runtimePlan = recommendResponderRuntime(baseProfile, conversationContext, projectCtx);
    const sidecarProfile = this.sanitizeResponderProfileForDrafting(runtimePlan.profile);
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

    let rawResult: SuggestionResult;
    try {
      rawResult = useStatefulResponder
        ? await this.generateSuggestionStateful(prompt, sidecarProfile, session!, onPartial, onUsage)
        : await this.generateSuggestionStateless(prompt, sidecarProfile, onPartial);
    } catch (error) {
      if (!useStatefulResponder || !this.shouldRetryStatefulResponder(error, session!)) {
        throw error;
      }

      this.resetStatefulResponder(session!);
      const reseedPrompt = await this.buildResponderSeedPrompt(conversationContext, llmName, session, projectCtx);
      onTrace?.({
        prompt: reseedPrompt,
        commandPreview: buildCommandPreview(sidecarProfile),
        runtimeSummary: runtimePlan.summary || summarizeRuntime(sidecarProfile),
        strategy: runtimePlan.strategy,
        rationale: `${runtimePlan.rationale} Roscoe cleared a failed hidden responder thread and reseeded it from the current lane state.`,
      });
      rawResult = await this.generateSuggestionStateful(reseedPrompt, sidecarProfile, session!, onPartial, onUsage);
    }

    if (
      useStatefulResponder
      && rawResult.reasoning === MALFORMED_STRUCTURED_DRAFT_REASONING
      && session?.responderMonitor?.getSessionId()
    ) {
      this.resetStatefulResponder(session!);
      const reseedPrompt = await this.buildResponderSeedPrompt(conversationContext, llmName, session, projectCtx);
      onTrace?.({
        prompt: reseedPrompt,
        commandPreview: buildCommandPreview(sidecarProfile),
        runtimeSummary: runtimePlan.summary || summarizeRuntime(sidecarProfile),
        strategy: runtimePlan.strategy,
        rationale: `${runtimePlan.rationale} Roscoe cleared a malformed hidden responder draft and reseeded it from the current lane state.`,
      });
      rawResult = await this.generateSuggestionStateful(reseedPrompt, sidecarProfile, session!, onPartial, onUsage);
    }

    const recoveredResult = this.maybeRecoverStalledGuild(rawResult, session, projectCtx);
    const strengthenedResult = this.maybeStrengthenArbiterConviction(recoveredResult, projectCtx);
    return this.applyDraftGuards(strengthenedResult, conversationContext, projectCtx);
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
