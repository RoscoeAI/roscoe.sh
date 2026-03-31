import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { SessionMonitor } from "./session-monitor.js";
import {
  InterviewAnswer,
  InterviewQuestionRecord,
  OnboardingMode,
  ProjectContext,
  ProjectHistoryRecord,
  ProjectRuntimeDefaults,
  loadProjectContext,
  listProjectHistory,
  normalizeProjectContext,
  registerProject,
  saveProjectHistory,
  saveProjectContext,
} from "./config.js";
import { EventEmitter } from "events";
import { dbg, enableDebug } from "./debug-log.js";
import { detectProtocol, HeadlessProfile, summarizeRuntime } from "./llm-runtime.js";
import { applyRuntimeSettings, getDefaultOnboardingRuntime } from "./runtime-defaults.js";
import { inspectWorkspaceForOnboarding } from "./workspace-intake.js";
import {
  ProjectSecretRequest,
  applyProjectEnvToProfile,
  saveProjectSecretRecord,
  writeProjectSecretValue,
} from "./project-secrets.js";
import { inferDeploymentAssessment } from "./deployment-contract.js";

const ONBOARDING_CHECKPOINT_VERSION = 1;
const ONBOARDING_CHECKPOINT_FILE = "onboarding-checkpoint.json";

interface OnboardingCheckpoint {
  version: number;
  mode: OnboardingMode;
  protocol: "claude" | "codex" | "gemini";
  profileName: string;
  projectDir: string;
  createdAt: string;
  updatedAt: string;
  sessionId: string | null;
  workspaceMode: string;
  questionHistory: InterviewQuestionRecord[];
  interviewAnswers: InterviewAnswer[];
  sessionInterviewAnswers: InterviewAnswer[];
  rawTranscript: string;
  outputBuffer: string;
  completed: boolean;
}

function getOnboardingCheckpointPath(projectDir: string): string {
  return join(projectDir, ".roscoe", ONBOARDING_CHECKPOINT_FILE);
}

function pruneForCheckpoint(text: string, maxLength = 20000): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(-maxLength)}`;
}

function parseCheckpoint(raw: unknown): OnboardingCheckpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const typed = raw as Record<string, unknown>;
  if (typed.version !== ONBOARDING_CHECKPOINT_VERSION) return null;

  const protocol = typed.protocol;
  if (protocol !== "claude" && protocol !== "codex" && protocol !== "gemini") return null;
  if (typed.mode !== "onboard" && typed.mode !== "refine") return null;
  if (typeof typed.profileName !== "string") return null;
  if (typeof typed.projectDir !== "string") return null;
  if (!Array.isArray(typed.questionHistory)) return null;
  if (!Array.isArray(typed.interviewAnswers)) return null;
  if (!Array.isArray(typed.sessionInterviewAnswers)) return null;

  return {
    version: ONBOARDING_CHECKPOINT_VERSION,
    mode: typed.mode,
    protocol,
    profileName: typed.profileName,
    projectDir: typed.projectDir,
    createdAt: typeof typed.createdAt === "string" ? typed.createdAt : new Date(0).toISOString(),
    updatedAt: typeof typed.updatedAt === "string" ? typed.updatedAt : new Date(0).toISOString(),
    sessionId: typeof typed.sessionId === "string" ? typed.sessionId : null,
    workspaceMode: typeof typed.workspaceMode === "string" ? typed.workspaceMode : "unknown",
    questionHistory: typed.questionHistory as InterviewQuestionRecord[],
    interviewAnswers: typed.interviewAnswers as InterviewAnswer[],
    sessionInterviewAnswers: typed.sessionInterviewAnswers as InterviewAnswer[],
    rawTranscript: typeof typed.rawTranscript === "string" ? typed.rawTranscript : "",
    outputBuffer: typeof typed.outputBuffer === "string" ? typed.outputBuffer : "",
    completed: typed.completed === true,
  };
}

const BRIEF_SCHEMA_EXAMPLE = `{
  "name": "project name",
  "directory": "/path/to/project",
  "goals": ["goal 1", "goal 2"],
  "milestones": ["milestone 1 by date"],
  "techStack": ["tech1", "tech2"],
  "notes": "operational notes and repo-grounded context",
  "intentBrief": {
    "projectStory": "big-picture vision and why this project exists",
    "primaryUsers": ["primary user or operator"],
    "definitionOfDone": ["specific condition that must be true before this is done"],
    "acceptanceChecks": ["proof Roscoe should look for before treating the work as complete"],
    "successSignals": ["observable sign that the work is successful"],
    "entrySurfaceContract": {
      "summary": "what the default first screen or entry surface must be",
      "defaultRoute": "/",
      "expectedExperience": "what the operator should truthfully see on first boot",
      "allowedShellStates": ["placeholder or shell states that are explicitly acceptable, if any"]
    },
    "localRunContract": {
      "summary": "what should work locally and what prerequisites must be surfaced",
      "startCommand": "pnpm dev",
      "firstRoute": "http://localhost:3000",
      "prerequisites": ["auth, secrets, database, external infra, or other prerequisites that must exist"],
      "seedRequirements": ["seed data or tenant/bootstrap requirements for the happy path"],
      "expectedBlockedStates": ["specific blocked states Roscoe may treat as honest blockers, not completion"],
      "operatorSteps": ["the truthful first-run steps an operator should follow locally"]
    },
    "acceptanceLedger": [
      {
        "label": "named acceptance artifact or milestone",
        "status": "open",
        "evidence": ["what proof would count once this item is proven"],
        "notes": "why it is still open, blocked, or already proven"
      }
    ],
    "deliveryPillars": {
      "frontend": ["what the user-facing surface must do before this is done, or 'not applicable'"],
      "backend": ["what the server/data/API layer must do before this is done, or 'not applicable'"],
      "unitComponentTests": ["how unit/component tests should support the current slice, with reasonable coverage focused on changed logic, regressions, and failure modes"],
      "e2eTests": ["how end-to-end or workflow tests should prove the experience at the right stage, with risk-based coverage instead of blanket exhaustiveness"]
    },
    "coverageMechanism": ["how this repo validates progress today, such as canonical test commands, coverage reports, preview flows, or manual validation checkpoints"],
    "deploymentContract": {
      "mode": "inferred-existing",
      "summary": "short deploy stance Roscoe should preserve or defer",
      "artifactType": "web app, service, worker, CLI/package, or not applicable yet",
      "platforms": ["Cloudflare", "Vercel", "Docker", "npm, or another repo-grounded platform"],
      "environments": ["preview", "staging", "production"],
      "buildSteps": ["canonical build command or workflow"],
      "deploySteps": ["canonical deploy path Roscoe should preserve or use later in conversation"],
      "previewStrategy": ["how preview or non-production validation works, or why it is deferred"],
      "presenceStrategy": ["how a truthful non-local web presence should stay updated as the project evolves, or why that is deferred"],
      "proofTargets": ["the preview, stage, or production URL/pattern the operator should be able to open as proof"],
      "healthChecks": ["how Roscoe should confirm a deployment is healthy"],
      "rollback": ["how to roll back safely if a deploy goes bad"],
      "requiredSecrets": ["exact env vars needed for deploy or preview work"]
    },
    "nonGoals": ["what should not be optimized or expanded during delivery"],
    "constraints": ["technical, product, legal, or team constraint"],
    "architecturePrinciples": ["architectural rules Roscoe should preserve, such as shared components, queueing boundaries, audit logging, idempotency, explicit contracts, or DRY service seams"],
    "autonomyRules": ["when Roscoe may act vs when Roscoe must ask"],
    "qualityBar": ["review, testing, and polish expectations"],
    "riskBoundaries": ["mistakes or changes Roscoe should avoid making without approval"],
    "uiDirection": "UI and tone guidance if relevant"
  }
}`;

const ONBOARDING_PROMPT = `You are Roscoe's onboarding strategist for a new project.

Your job is to train Roscoe with the exact intent, definition of done, autonomy rules, and quality bar that should govern future Guild sessions.

PHASE 1: Explore the codebase FIRST.
- Inspect structure, tech stack, architecture, docs, tests, CI/CD, major product surfaces, and any obvious gaps.
- Write a comprehensive CLAUDE.md in the project root with purpose, architecture, conventions, key files, and how to run/test/deploy.
- From that exploration, determine which product and delivery ambiguities matter most for Roscoe.

PHASE 2: Conduct a comprehensive intent interview.
- Ask a repo-grounded interview question using either a single-choice or multi-select checklist when more than one answer may apply.
- Ask ONE question per turn.
- Prefer 4-6 options.
- Always include "Other (I'll explain)" and "Skip — use your best judgment and check in on critical decisions".
- Ask enough questions to confidently capture the full intent story. Default target: 6-9 questions unless the repo is trivial or the developer keeps skipping.
- Make it explicit that the onboarding provider is locked for this project after onboarding. Roscoe may retune model and reasoning effort later, but only inside that provider.
- Treat definition of done as a staged delivery contract: frontend outcome, backend outcome, unit/component proof, and e2e or workflow proof. Roscoe should keep those aligned, but should not force exhaustive hardening before the feature shape is validated.
- Previews are optional checkpoints, not mandatory gates. Roscoe may keep Guild moving until a meaningful checkpoint, then use preview or manual validation when that will answer the next decision faster than more implementation.
- The default testing standard is reasonable, risk-based coverage of changed behavior, regressions, and important failure modes. Broaden toward stricter coverage only when the feature stabilizes, the risk is high, or the project explicitly demands it.
- Roscoe must adapt to the testing and validation mechanism already present in the repo. If no adequate mechanism exists, Roscoe must define a repo-grounded plan that matches the current stage of the work instead of front-loading blanket coverage work.
- The final brief must state how Roscoe will validate progress in this repo, such as canonical test commands, coverage reports, preview links, or manual validation checkpoints. Prefer measurable signals when the repo supports them, but a coverage percent is not universally required.
- Deployment is a first-class project contract, not a later improvisation. For established repos, infer and preserve the existing deployment path instead of inventing a new stack. For greenfield repos, choose or explicitly defer the initial deployment shape.
- There is no generic deploy command. Roscoe may only coordinate deployment later through conversation after the project contract is understood.
- For web-facing or hosted apps, deployment proof starts early: explicitly settle whether preview, staging, or another hosted web presence should exist during development, how it stays updated, and what URL or URL pattern counts as operator-openable proof.
- If the repo narrative implies hosting, do not let Roscoe treat local-only proof as the whole story forever. Either establish the hosted proof path or explicitly defer it with a reason.
- Architecture is part of the saved operating contract, not optional polish. Capture the architectural practices Roscoe should preserve even when there is no immediate architecture fork in the road.
- The final brief must include a first-class acceptance ledger. Do not just narrate completion criteria; enumerate the concrete artifacts or checkpoints Roscoe should keep open, blocked, or proven over time.
- If the repo does not force a hard architecture choice yet, establish repo-grounded default principles around shared components and modules, DRY boundaries, queueing or background-work seams, audit logging or observability, and explicit ownership of cross-cutting behavior.
- For greenfield projects with user-facing surfaces, you must explicitly settle the initial entry surface: what the default route, homepage, landing page, dashboard, or redirect should be on first boot, and whether a scaffold placeholder is acceptable or not.
- For greenfield projects with user-facing surfaces, you must also settle the first local operator path: what should work on localhost, what prerequisites (seed data, sign-in, tenant creation, secrets, external infra) are required, and which missing prerequisites Roscoe must surface explicitly instead of hiding behind shell UI states.

Before you output the final brief, you MUST cover these themes:
- project story / user intent
- primary user or operator
- definition of done
- acceptance checks / proof of completion
- entry surface contract / default first screen
- local first-run contract / prerequisites and honest blocked states
- acceptance ledger / what remains open vs proven
- delivery pillars across frontend, backend, unit/component tests, and e2e tests
- coverage mechanism / validation path
- success signals
- non-goals / scope boundaries
- deployment contract / release path or explicit defer
- hosted proof path / preview-stage presence for web-facing apps
- architecture principles / system design guardrails
- autonomy / escalation rules
- quality bar / testing / review expectations
- UI direction if the repo has user-facing surfaces
- operational or product constraints
- risk boundaries

QUESTION FORMAT — you MUST end each interview turn with exactly this block:

---QUESTION---
{"question": "Your question here?", "options": ["Option A", "Option B", "Option C", "Other (I'll explain)", "Skip — use your best judgment and check in on critical decisions"], "theme": "definition-of-done", "purpose": "Why this answer matters", "selectionMode": "single"}
---END_QUESTION---

SECRET FORMAT — when a real credential or API secret is needed soon, you MUST end the turn with exactly this block instead of a question:

---SECRET---
{"key":"CLOUDFLARE_API_TOKEN","label":"Cloudflare API token","purpose":"Needed to create or update preview infrastructure.","instructions":["Open the provider dashboard.","Create the token with the minimum scopes needed for this repo.","Copy the token value once and return here to paste it securely."],"links":[{"label":"Provider dashboard","url":"https://example.com/dashboard"},{"label":"Official docs","url":"https://example.com/docs"}],"required":true,"targetFile":".env.local"}
---END_SECRET---

Rules:
- First turn must summarize the codebase read and explain what uncertainties remain before asking the first question.
- Only request a secret when it is likely to unblock realistic implementation or preview work soon.
- Request at most one secret per turn.
- Include the exact env var name Roscoe should save, a concise purpose, step-by-step instructions, and official links when you know them.
- Prefer ".env.local" unless the secret is only for Roscoe/operator tooling, in which case use ".env.roscoe.local".
- Never invent links. If you are not confident in a URL, omit it.
- After Roscoe says the user provided a secret securely, treat it as available and do not ask for the raw value again unless replacement is necessary.
- Use "selectionMode": "multi" when several answers can legitimately apply together, especially for delivery pillars, constraints, non-goals, quality/risk boundaries, or proof bundles.
- You must vet "definition of done" from multiple angles before finishing: desired end state, concrete proof/acceptance checks, and what shortcuts would falsely look done.
- You must ask at least one explicit question about the four delivery pillars if the developer has not already spelled them out.
- You must identify the repo's current testing or validation mechanism, or propose one if it is missing, before you can finish.
- You must either confirm or establish the architecture principles Roscoe should keep defending as the codebase grows.
- Ask at least two separate questions about definition of done unless the developer already answered it comprehensively in one response.
- For greenfield projects with a UI, ask at least one explicit question about the default entry surface or first screen unless the developer already answered it clearly.
- For greenfield projects with a UI, ask at least one explicit question about the local first-run path and prerequisites unless the developer already answered it clearly.
- For greenfield or hosted web apps, ask at least one explicit question about the first truthful hosted proof surface unless the developer already answered it clearly.
- Every question must be explicitly grounded in repo context, not a generic intake form.
- Keep summaries concise and high-signal because they stream into the terminal UI.
- Do not output the final brief until the intent story is concrete enough to guide Roscoe's future confidence decisions.

For the final brief, end your response with:

---BRIEF---
${BRIEF_SCHEMA_EXAMPLE}
---END_BRIEF---`;

const FOLLOWUP_PROMPT = `Continue Roscoe's codebase-grounded intent interview.

Last question: "{QUESTION}"
Developer answer: "{ANSWER}"

Decide what Roscoe still needs to know in order to confidently guide Guild sessions.

Rules:
- Ask another multiple-choice question using the ---QUESTION--- format if any required intent theme is still underspecified.
- If a near-term secret is the main blocker, ask for it with the ---SECRET--- format instead of a normal question.
- Only output the final brief when the intent story, definition of done, acceptance checks, the four delivery pillars, validation mechanism, scope boundaries, architecture principles, autonomy rules, and quality bar are all concrete enough for future confidence scoring.
- The final brief must also include a deployment contract, even if the answer is to defer deployment details for now.
- For web-facing or hosted apps, the deployment contract must say whether a hosted preview/stage presence should exist during development, how it stays updated, and what URL or URL pattern counts as proof, unless the developer explicitly defers that decision.
- Do not treat work as done unless the brief explicitly says how unit/component and e2e or workflow checks prove the frontend/backend outcomes at a reasonable, risk-based level for this repo, and how Roscoe can validate progress or completion here.
- If the developer selected skip, make a reasonable assumption but call out the assumption in your visible summary.
- Keep every question grounded in the actual repo you explored, not a generic product questionnaire.

For the final brief, end your response with:

---BRIEF---
${BRIEF_SCHEMA_EXAMPLE}
---END_BRIEF---`;

const REFINE_PROMPT = `You are Roscoe's refinement strategist for an already onboarded project.

Your job is to refine the saved project understanding without rerunning the full intake.

Rules:
- Do NOT redo repo exploration unless the saved brief is obviously missing critical facts.
- Start from the saved project brief, saved interview answers, and the latest saved onboarding/refine history.
- Focus only on the requested refinement themes.
- Ask targeted follow-up questions using the same ---QUESTION--- format. Use "selectionMode": "multi" when multiple answers can apply together.
- If a near-term secret is the main blocker for refining the project contract or unblocking future delivery, ask for it with the ---SECRET--- format.
- Preserve stable intent. Only change what the new answers actually modify.
- Treat deployment as one of the same saved contract dimensions as validation, architecture, and autonomy. Refine it when the requested themes touch shipping, rollout, preview, release, or production behavior.
- Keep the provider locked. Roscoe may retune model and reasoning later, but only inside the locked provider.
- End with a full updated ---BRIEF--- block once the targeted themes are clear.

Requested refinement themes: {THEMES}

Saved brief:
{BRIEF}

Saved interview answers:
{ANSWERS}

Latest raw history excerpt:
{HISTORY}
`;

const REFINE_FOLLOWUP_PROMPT = `Continue Roscoe's targeted refinement of the saved project brief.

Refinement themes: {THEMES}
Last question: "{QUESTION}"
Developer answer: "{ANSWER}"

Rules:
- Ask only the next highest-value follow-up question for the requested themes unless the brief is now ready.
- If a near-term secret is the main blocker, ask for it with the ---SECRET--- format instead of a normal question.
- Preserve stable saved understanding outside the refined themes.
- Use "selectionMode": "multi" when multiple answers can apply together.
- Preserve or refine the deployment contract symmetrically with the other saved brief fields.
- End with a full updated ---BRIEF--- block once the changes are concrete and coherent.

For the final brief, end your response with:

---BRIEF---
${BRIEF_SCHEMA_EXAMPLE}
---END_BRIEF---`;

const MIN_INTERVIEW_QUESTIONS = 8;
const MIN_DONE_VETTING_QUESTIONS = 2;
const REQUIRED_THEME_COVERAGE = [
  "project-story",
  "primary-users",
  "definition-of-done",
  "acceptance-checks",
  "delivery-pillars",
  "coverage-mechanism",
  "non-goals",
  "autonomy-rules",
  "quality-bar",
  "risk-boundaries",
] as const;

interface BriefReadinessReport {
  ok: boolean;
  missingThemes: string[];
  missingFields: string[];
  interviewCount: number;
  doneVettingCount: number;
}

interface OnboarderOptions {
  mode?: OnboardingMode;
  refineThemes?: string[];
  seedContext?: ProjectContext | null;
  seedHistory?: ProjectHistoryRecord[];
}

function extractQuestionRecord(text: string): InterviewQuestionRecord | null {
  const match = text.match(/---QUESTION---\s*\n?([\s\S]*?)\n?---END_QUESTION---/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as Record<string, unknown>;
    if (typeof parsed.question !== "string" || !Array.isArray(parsed.options)) return null;
    return {
      question: parsed.question,
      options: parsed.options.filter((option): option is string => typeof option === "string" && option.trim().length > 0),
      ...(typeof parsed.theme === "string" ? { theme: parsed.theme } : {}),
      ...(typeof parsed.purpose === "string" ? { purpose: parsed.purpose } : {}),
      ...(parsed.selectionMode === "multi" || parsed.selectionMode === "single"
        ? { selectionMode: parsed.selectionMode }
        : {}),
    };
  } catch {
    return null;
  }
}

function formatInterviewAnswersForPrompt(answers: InterviewAnswer[]): string {
  if (answers.length === 0) return "(none)";
  return answers.map((answer, index) => {
    const theme = answer.theme ? ` [${answer.theme}]` : "";
    return `${index + 1}.${theme} Q: ${answer.question}\nA: ${answer.answer}`;
  }).join("\n\n");
}

function formatHistoryForPrompt(history: ProjectHistoryRecord[]): string {
  if (history.length === 0) return "(none)";
  return history.slice(0, 2).map((entry, index) => {
    const excerpt = entry.rawTranscript.replace(/\s+/g, " ").trim().slice(-4000) || "(empty)";
    return `History ${index + 1} (${entry.mode} @ ${entry.createdAt}): ${excerpt}`;
  }).join("\n\n");
}

function classifyInterviewTheme(source: string): string | null {
  if (!source.trim()) return null;
  if (/(project story|project-story|vision|intent)/.test(source)) return "project-story";
  if (/(primary user|primary-users|users|operator|audience)/.test(source)) return "primary-users";
  if (/(acceptance|proof|verification|acceptance check)/.test(source)) return "acceptance-checks";
  if (/(success signal|success|outcome metric)/.test(source)) return "success-signals";
  if (/(delivery pillar|delivery-pillar|frontend|front end|backend|back end|unit\/component|unit component|component tests|e2e|end-to-end|end to end)/.test(source)) return "delivery-pillars";
  if (/(coverage mechanism|coverage command|coverage percent|measurable coverage|coverage stack|coverage tool|validation path|validate progress|validation mechanism|test command|test suite|istanbul|nyc|vitest coverage|jest coverage|c8|coverage.py|go test cover|jacoco|lcov)/.test(source)) return "coverage-mechanism";
  if (/(deploy|deployment|release path|release flow|rollout|preview environment|preview env|production|staging|vercel|cloudflare|netlify|render|railway|fly\.io|wrangler|docker|kubernetes|helm|terraform|pulumi|npm publish)/.test(source)) return "deployment-contract";
  if (/(non-goal|non goals|non-goals|scope boundary|scope creep|out of scope)/.test(source)) return "non-goals";
  if (/(constraint|constraints|limit|dependency)/.test(source)) return "constraints";
  if (/(architecture|architectural|system design|shared component|shared module|dry|queue|job worker|background work|audit log|audit trail|observability|contract ownership|service seam|idempot)/.test(source)) return "architecture-principles";
  if (/(autonomy|escalation|approval|ask first)/.test(source)) return "autonomy-rules";
  if (/(quality|testing|review|polish|bar)/.test(source)) return "quality-bar";
  if (/(risk|danger|avoid|boundary)/.test(source)) return "risk-boundaries";
  if (/(ui|ux|visual|design|frontend)/.test(source)) return "ui-direction";
  if (/(definition of done|definition-of-done|completion|end state|\bdone\b)/.test(source)) return "definition-of-done";
  return null;
}

function normalizeInterviewTheme(theme?: string, question = ""): string | null {
  const explicitTheme = classifyInterviewTheme((theme ?? "").toLowerCase());
  if (explicitTheme) return explicitTheme;
  return classifyInterviewTheme(question.toLowerCase());
}

function humanizeTheme(theme: string): string {
  return theme.replace(/-/g, " ");
}

function projectNeedsUiDirection(brief: ProjectContext): boolean {
  const text = [
    brief.name,
    brief.notes,
    ...brief.goals,
    ...brief.techStack,
  ].join(" ").toLowerCase();
  return /(ui|ux|frontend|react|next|ink|tailwind|css|web|mobile|design)/.test(text);
}

function getIntentAuditCorpus(brief: ProjectContext): string {
  const intent = brief.intentBrief;
  if (!intent) return "";
  return [
    ...intent.definitionOfDone,
    ...intent.acceptanceChecks,
    ...intent.successSignals,
    ...intent.deliveryPillars.frontend,
    ...intent.deliveryPillars.backend,
    ...intent.deliveryPillars.unitComponentTests,
    ...intent.deliveryPillars.e2eTests,
    ...intent.coverageMechanism,
    ...(intent.architecturePrinciples ?? []),
    ...intent.qualityBar,
    ...intent.riskBoundaries,
  ].join(" ").toLowerCase();
}

function hasDeliveryProofPlan(brief: ProjectContext): boolean {
  const intent = brief.intentBrief;
  if (!intent) return false;
  const corpus = getIntentAuditCorpus(brief);
  const hasOutcomePillars = intent.deliveryPillars.frontend.length > 0
    && intent.deliveryPillars.backend.length > 0;
  const hasVerificationPillars = intent.deliveryPillars.unitComponentTests.length > 0
    && intent.deliveryPillars.e2eTests.length > 0;
  const mentionsProof = /(prove|proof|verify|verified|verifies|demonstrate|demonstrates|show|shows|cover|covers|exercise|exercises)/.test(corpus);
  return hasOutcomePillars && hasVerificationPillars && mentionsProof;
}

function hasReasonableVerificationStandard(brief: ProjectContext): boolean {
  const corpus = getIntentAuditCorpus(brief);
  const mentionsVerification = /(coverage|test|tests|verify|verification|proof|validate|validation)/.test(corpus);
  const mentionsStandard = /(reasonable|risk-based|risk based|targeted|focused|progressive|proportionate|appropriate|100 ?%|full|complete)/.test(corpus);
  const mentionsRisk = /edge cases?|corner cases?|failure modes?|error paths?|regressions?|critical paths?|changed behavior|core flows?/.test(corpus);
  return mentionsVerification && mentionsStandard && mentionsRisk;
}

function hasValidationMechanism(brief: ProjectContext): boolean {
  const corpus = [
    ...(brief.intentBrief?.coverageMechanism ?? []),
    ...(brief.intentBrief?.acceptanceChecks ?? []),
    ...(brief.intentBrief?.qualityBar ?? []),
  ].join(" ").toLowerCase();
  const mentionsMechanism = /(coverage|test|tests|vitest|jest|istanbul|nyc|c8|playwright|cypress|coverage\.py|pytest-cov|go test cover|jacoco|lcov|simplecov|preview|demo|manual validation|smoke|qa|acceptance)/.test(corpus);
  const mentionsExecution = /(report|command|suite|run|stack|preview|link|browser|checkpoint|manual|validate|validation|check|checks|gate|harness)/.test(corpus);
  return mentionsMechanism && mentionsExecution;
}

function hasInitialUserEntrySurfaceContract(brief: ProjectContext): boolean {
  const contract = brief.intentBrief?.entrySurfaceContract;
  return Boolean(
    contract
    && contract.summary.trim()
    && contract.defaultRoute.trim()
    && contract.expectedExperience.trim(),
  );
}

function hasLocalFirstRunContract(brief: ProjectContext): boolean {
  const contract = brief.intentBrief?.localRunContract;
  return Boolean(
    contract
    && contract.summary.trim()
    && contract.startCommand.trim()
    && contract.firstRoute.trim()
    && contract.operatorSteps.length > 0
    && (contract.prerequisites.length > 0 || contract.seedRequirements.length > 0 || contract.expectedBlockedStates.length > 0),
  );
}

function hasAcceptanceLedger(brief: ProjectContext): boolean {
  return Boolean(
    brief.intentBrief?.acceptanceLedger?.length
    && brief.intentBrief.acceptanceLedger.some((item) => item.label.trim().length > 0),
  );
}

function needsHostedPresenceProof(brief: ProjectContext): boolean {
  const contract = brief.intentBrief?.deploymentContract;
  if (!contract) return false;
  if (contract.mode === "defer" || contract.mode === "not-applicable") return false;
  const artifact = contract.artifactType.toLowerCase();
  return artifact.includes("web") || artifact.includes("edge app");
}

function hasHostedPresenceProofContract(brief: ProjectContext): boolean {
  const contract = brief.intentBrief?.deploymentContract;
  return Boolean(
    contract
    && contract.presenceStrategy.length > 0
    && contract.proofTargets.length > 0,
  );
}

/**
 * Manages the project onboarding flow using a headless LLM CLI.
 * Each turn is a separate non-interactive process and resumes via the provider's
 * native session/thread mechanism.
 */
export class Onboarder extends EventEmitter {
  private session: SessionMonitor | null = null;
  private outputBuffer = "";
  private projectDir: string;
  private profile: HeadlessProfile;
  private projectRuntimeDefaults: ProjectRuntimeDefaults | undefined;
  private interviewAnswers: InterviewAnswer[] = [];
  private sessionInterviewAnswers: InterviewAnswer[] = [];
  private questionHistory: InterviewQuestionRecord[] = [];
  private rawTranscript = "";
  private onboardingCheckpoint: OnboardingCheckpoint | null = null;
  private mode: OnboardingMode;
  private refineThemes: string[];
  private seedContext: ProjectContext | null;
  private seedHistory: ProjectHistoryRecord[];
  private ignoredSuccessfulExits = 0;
  private workspaceAssessment = inspectWorkspaceForOnboarding(process.cwd());
  private completed = false;

  constructor(
    projectDir: string,
    debug = false,
    profile: HeadlessProfile = applyRuntimeSettings({
      name: "orchestrator",
      command: "claude",
      args: [],
      protocol: "claude",
    }, getDefaultOnboardingRuntime("claude")),
    projectRuntimeDefaults?: ProjectRuntimeDefaults,
    options: OnboarderOptions = {},
  ) {
    super();
    this.projectDir = projectDir;
    this.profile = profile;
    this.projectRuntimeDefaults = projectRuntimeDefaults;
    this.mode = options.mode ?? "onboard";
    this.refineThemes = options.refineThemes ?? [];
    this.seedContext = options.seedContext ?? loadProjectContext(projectDir);
    this.seedHistory = options.seedHistory ?? listProjectHistory(projectDir);
    if (debug) enableDebug();
  }

  start(): void {
    const dir = resolve(this.projectDir);
    dbg("onboard", `start dir=${dir}`);
    mkdirSync(dir, { recursive: true });
    this.workspaceAssessment = inspectWorkspaceForOnboarding(dir);
    this.outputBuffer = "";
    this.rawTranscript = "";
    this.interviewAnswers = this.mode === "refine"
      ? [...(this.seedContext?.interviewAnswers ?? [])]
      : [];
    this.questionHistory = [];
    this.sessionInterviewAnswers = this.mode === "refine"
      ? [...(this.seedContext?.interviewAnswers ?? [])].filter(Boolean)
      : [];

    this.onboardingCheckpoint = this.loadCheckpoint();
    if (this.shouldResumeFromCheckpoint()) {
      this.interviewAnswers = this.onboardingCheckpoint.interviewAnswers;
      this.questionHistory = this.onboardingCheckpoint.questionHistory;
      this.sessionInterviewAnswers = this.onboardingCheckpoint.sessionInterviewAnswers;
      this.rawTranscript = this.onboardingCheckpoint.rawTranscript;
      this.outputBuffer = "";
      this.rawTranscript = pruneForCheckpoint(this.rawTranscript, 20000);
    }
    this.completed = false;

    this.profile = applyProjectEnvToProfile(this.profile, dir);
    this.session = new SessionMonitor(
      `orchestrator-${Date.now()}`,
      this.profile,
      dir,
    );

    if (this.mode === "onboard" && this.onboardingCheckpoint?.sessionId) {
      this.session.restoreSessionId(this.onboardingCheckpoint.sessionId);
    }

    this.wireEvents();

    if (this.shouldResumeFromCheckpoint()) {
      this.session.startTurn(this.buildResumePrompt());
      return;
    }

    this.session.startTurn(this.buildStartPrompt());
  }

  private shouldResumeFromCheckpoint(): boolean {
    if (!this.onboardingCheckpoint) return false;
    if (this.onboardingCheckpoint.completed) return false;
    if (!this.onboardingCheckpoint.sessionId) return false;
    if (this.mode !== this.onboardingCheckpoint.mode) return false;
    if (this.onboardingCheckpoint.protocol !== detectProtocol(this.profile)) return false;
    if (this.onboardingCheckpoint.profileName && this.onboardingCheckpoint.profileName !== this.profile.name) return false;
    return true;
  }

  private buildResumePrompt(): string {
    const lastQuestion = this.questionHistory.at(-1);
    const interviewContext = this.interviewAnswers.length === 0
      ? "No interview answers were saved yet."
      : formatInterviewAnswersForPrompt(this.interviewAnswers);

    return `The previous onboarding turn was interrupted and Roscoe should continue from the same session.

RESUME_CONTEXT:
- Last asked question: ${lastQuestion?.question ?? "(none yet)"}
- Saved interview answers:
${interviewContext}

WORKSPACE_ASSESSMENT:
${this.workspaceAssessment.summary}

Continue this onboarding interview from where it left off. Do not start over.
Ask the next highest-value question, or complete the brief if everything is ready.
- Keep question format: ---QUESTION--- ... ---END_QUESTION---.
- Respect the prior theme coverage and interview progress.`;
  }

  private checkpointPath(): string {
    return getOnboardingCheckpointPath(this.projectDir);
  }

  private loadCheckpoint(): OnboardingCheckpoint | null {
    const checkpointPath = this.checkpointPath();
    if (!existsSync(checkpointPath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(checkpointPath, "utf-8")) as unknown;
      const checkpoint = parseCheckpoint(parsed);
      if (!checkpoint) return null;
      if (checkpoint.projectDir !== this.projectDir) return null;
      return checkpoint;
    } catch {
      return null;
    }
  }

  private saveCheckpoint(completed = false): void {
    if (this.mode !== "onboard") return;
    const checkpointPath = this.checkpointPath();
    if (!existsSync(resolve(this.projectDir, ".roscoe"))) {
      mkdirSync(resolve(this.projectDir, ".roscoe"), { recursive: true });
    }

    const now = new Date().toISOString();
    const checkpoint: OnboardingCheckpoint = {
      version: ONBOARDING_CHECKPOINT_VERSION,
      mode: this.mode,
      protocol: detectProtocol(this.profile),
      profileName: this.profile.name,
      projectDir: this.projectDir,
      createdAt: this.onboardingCheckpoint?.createdAt ?? now,
      updatedAt: now,
      sessionId: this.session?.getSessionId() ?? null,
      workspaceMode: this.workspaceAssessment.mode,
      questionHistory: [...this.questionHistory],
      interviewAnswers: [...this.interviewAnswers],
      sessionInterviewAnswers: [...this.sessionInterviewAnswers],
      rawTranscript: pruneForCheckpoint(this.rawTranscript, 24000),
      outputBuffer: pruneForCheckpoint(this.outputBuffer, 8000),
      completed,
    };

    writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
  }

  private clearCheckpoint(): void {
    const checkpointPath = this.checkpointPath();
    if (existsSync(checkpointPath)) {
      rmSync(checkpointPath, { force: true });
    }
    this.onboardingCheckpoint = null;
  }

  private wireEvents(): void {
    if (!this.session) return;

    this.session.on("text", (chunk: string) => {
      this.outputBuffer += chunk;
      this.rawTranscript += chunk;
      this.emit("output", chunk);
    });

    this.session.on("result", () => {
      this.saveCheckpoint();
    });

    this.session.on("turn-complete", () => {
      dbg("onboard", `turn-complete (buffer: ${this.outputBuffer.length} chars)`);
      const question = extractQuestionRecord(this.outputBuffer);
      if (question && this.questionHistory[this.questionHistory.length - 1]?.question !== question.question) {
        this.questionHistory.push(question);
      }
      const briefState = this.checkForProjectBrief();
      if (briefState !== "completed") {
        this.saveCheckpoint();
      }
      if (briefState === "none") {
        this.emit("turn-complete");
      }
    });

    this.session.on("thinking", (chunk: string) => {
      this.rawTranscript += `\n[thinking] ${chunk}`;
      this.emit("thinking", chunk);
    });

    this.session.on("tool-activity", (toolName: string) => {
      this.rawTranscript += `\n[tool] ${toolName}`;
      this.emit("tool-activity", toolName);
    });

    this.session.on("exit", (code: number) => {
      dbg("onboard", `exit code=${code}`);
      if (code === 0 && this.ignoredSuccessfulExits > 0) {
        this.ignoredSuccessfulExits -= 1;
        return;
      }
      if (code === 0 && !this.completed) {
        const briefState = this.checkForProjectBrief();
        if (briefState !== "none") {
          return;
        }
      }
      this.emit("exit", code);
    });
  }

  /**
   * Send the user's interview answer. Claude decides what to ask next.
   */
  sendInput(
    text: string,
    question?: { question: string; theme?: string; purpose?: string; options?: string[]; selectionMode?: "single" | "multi" },
    answerMeta?: Pick<InterviewAnswer, "mode" | "selectedOptions" | "freeText">,
  ): void {
    if (!this.session) return;
    dbg("onboard", `sendInput: ${text.slice(0, 100)}`);
    this.outputBuffer = "";
    const normalizedTheme = normalizeInterviewTheme(question?.theme, question?.question);
    if (question?.question) {
      const answerRecord: InterviewAnswer = {
        question: question.question,
        answer: text,
        ...(normalizedTheme ? { theme: normalizedTheme } : question.theme ? { theme: question.theme } : {}),
        ...(answerMeta?.mode ? { mode: answerMeta.mode } : {}),
        ...(answerMeta?.selectedOptions?.length ? { selectedOptions: answerMeta.selectedOptions } : {}),
        ...(answerMeta?.freeText ? { freeText: answerMeta.freeText } : {}),
      };
      this.interviewAnswers.push(answerRecord);
      this.sessionInterviewAnswers.push(answerRecord);
    }
    this.rawTranscript += `\n[user] ${text}\n`;
    this.saveCheckpoint();
    const prompt = this.buildFollowUpPrompt(
      question?.question ?? "Unknown question",
      text,
    );
    this.session.sendFollowUp(prompt);
  }

  sendSecretInput(
    request: ProjectSecretRequest,
    action: "provided" | "skipped",
    secretValue?: string,
  ): void {
    if (!this.session) return;
    dbg("onboard", `sendSecretInput: ${request.key} (${action})`);
    this.outputBuffer = "";

    if (action === "provided" && typeof secretValue === "string") {
      writeProjectSecretValue(this.projectDir, request.key, secretValue, request.targetFile);
      saveProjectSecretRecord(this.projectDir, request, "provided");
      this.profile = applyProjectEnvToProfile({
        ...this.profile,
        env: {
          ...(this.profile.env ?? {}),
          [request.key]: secretValue,
        },
      }, this.projectDir);
      this.session.setProfile(this.profile);
    } else {
      saveProjectSecretRecord(this.projectDir, request, "skipped");
    }

    this.rawTranscript += action === "provided"
      ? `\n[secret] ${request.key} provided securely (${request.targetFile})\n`
      : `\n[secret] ${request.key} skipped\n`;
    this.saveCheckpoint();

    const answer = action === "provided"
      ? `The user securely provided ${request.key}. Roscoe saved it to ${request.targetFile}. Treat this secret as available now.`
      : `The user skipped ${request.key} for now. Keep moving without assuming this secret exists unless the developer later provides it.`;

    const prompt = this.buildFollowUpPrompt(
      `Secure secret intake: ${request.key}`,
      answer,
    );
    this.session.sendFollowUp(prompt);
  }

  updateRuntime(
    profile: HeadlessProfile,
    projectRuntimeDefaults?: ProjectRuntimeDefaults,
  ): void {
    this.profile = profile;
    if (projectRuntimeDefaults) {
      this.projectRuntimeDefaults = projectRuntimeDefaults;
    }
    this.session?.setProfile(profile);
  }

  private checkForProjectBrief(): "none" | "continued" | "completed" {
    const jsonMatch = this.outputBuffer.match(
      /---BRIEF---\s*\n?([\s\S]*?)\n?---END_BRIEF---/,
    );

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim()) as Partial<ProjectContext>;
        const brief = normalizeProjectContext({
          ...parsed,
          directory: resolve(this.projectDir),
          interviewAnswers: parsed.interviewAnswers ?? this.interviewAnswers,
          ...(this.projectRuntimeDefaults
            ? { runtimeDefaults: this.projectRuntimeDefaults }
            : {}),
        });
        const readiness = this.auditInterviewReadiness(brief);
        if (!readiness.ok) {
          dbg("onboard", `brief rejected; missing themes=${readiness.missingThemes.join(",")} missingFields=${readiness.missingFields.join(",")}`);
          this.requestMoreInterview(readiness);
          return "continued";
        }
        dbg("onboard", `brief found: ${brief.name}`);
        saveProjectContext(brief);
        saveProjectHistory({
          id: `${new Date().toISOString().replace(/[:.]/g, "-")}-${this.mode}`,
          mode: this.mode,
          createdAt: new Date().toISOString(),
          directory: brief.directory,
          projectName: brief.name,
          runtime: {
            profileName: this.profile.name,
            protocol: detectProtocol(this.profile),
            summary: summarizeRuntime(this.profile),
            settings: this.profile.runtime ?? {},
          },
          rawTranscript: this.rawTranscript.trim(),
          questions: this.questionHistory,
          answers: this.sessionInterviewAnswers,
          briefSnapshot: brief,
        });
        registerProject(brief.name, brief.directory);
        this.completed = true;
        this.clearCheckpoint();
        this.emit("onboarding-complete", brief);
        return "completed";
      } catch {
        // JSON not yet complete or malformed
      }
    }
    return "none";
  }

  private buildStartPrompt(): string {
    if (this.mode !== "refine" || !this.seedContext) {
      if (this.workspaceAssessment.mode === "greenfield") {
        return `${ONBOARDING_PROMPT}

WORKSPACE ASSESSMENT:
${this.workspaceAssessment.summary}
- This is a greenfield or scaffold-only workspace. Do not pretend a mature codebase already exists.
- Phase 1 means inspect whatever scaffold, docs, or config files exist, identify what is still missing, and define the initial system shape Roscoe should create.
- Write CLAUDE.md for the intended system, initial repository structure, architecture boundaries, conventions, and validation plan even if most files do not exist yet.
- The first turn must explicitly say this is a vision-first build from an empty or scaffold-only workspace and identify the key product, architecture, delivery, and deployment decisions Roscoe still needs from the developer.

DEPLOYMENT ASSESSMENT:
${inferDeploymentAssessment(this.projectDir).summary}`;
      }

      return `${ONBOARDING_PROMPT}

WORKSPACE ASSESSMENT:
${this.workspaceAssessment.summary}

DEPLOYMENT ASSESSMENT:
${inferDeploymentAssessment(this.projectDir).summary}`;
    }

    return REFINE_PROMPT
      .replace("{THEMES}", this.refineThemes.length > 0 ? this.refineThemes.join(", ") : "all saved themes that need adjustment")
      .replace("{BRIEF}", JSON.stringify(this.seedContext, null, 2))
      .replace("{ANSWERS}", formatInterviewAnswersForPrompt(this.seedContext.interviewAnswers ?? []))
      .replace("{HISTORY}", formatHistoryForPrompt(this.seedHistory));
  }

  private buildFollowUpPrompt(question: string, answer: string): string {
    if (this.mode !== "refine") {
      return FOLLOWUP_PROMPT
        .replace("{QUESTION}", question)
        .replace("{ANSWER}", answer);
    }

    return REFINE_FOLLOWUP_PROMPT
      .replace("{THEMES}", this.refineThemes.length > 0 ? this.refineThemes.join(", ") : "all saved themes that need adjustment")
      .replace("{QUESTION}", question)
      .replace("{ANSWER}", answer);
  }

  private auditInterviewReadiness(brief: ProjectContext): BriefReadinessReport {
    const coveredThemes = new Set(
      this.interviewAnswers
        .map((answer) => normalizeInterviewTheme(answer.theme, answer.question))
        .filter((theme): theme is string => theme !== null),
    );

    const missingThemes = this.mode === "refine"
      ? []
      : REQUIRED_THEME_COVERAGE
        .filter((theme) => !coveredThemes.has(theme))
        .map((theme) => humanizeTheme(theme));

    const doneVettingCount = this.interviewAnswers.filter((answer) => {
      const theme = normalizeInterviewTheme(answer.theme, answer.question);
      return theme === "definition-of-done" || theme === "acceptance-checks";
    }).length;

    const missingFields: string[] = [];
    if (!brief.intentBrief?.projectStory) missingFields.push("project story");
    if (!brief.intentBrief?.primaryUsers?.length) missingFields.push("primary users");
    if (!brief.intentBrief?.definitionOfDone?.length) missingFields.push("definition of done");
    if (!brief.intentBrief?.acceptanceChecks?.length) missingFields.push("acceptance checks");
    if (!brief.intentBrief?.successSignals?.length) missingFields.push("success signals");
    if (!hasAcceptanceLedger(brief)) missingFields.push("acceptance ledger");
    if (!brief.intentBrief?.deliveryPillars?.frontend?.length) missingFields.push("delivery pillars: frontend outcome");
    if (!brief.intentBrief?.deliveryPillars?.backend?.length) missingFields.push("delivery pillars: backend outcome");
    if (!brief.intentBrief?.deliveryPillars?.unitComponentTests?.length) missingFields.push("delivery pillars: unit/component test proof");
    if (!brief.intentBrief?.deliveryPillars?.e2eTests?.length) missingFields.push("delivery pillars: e2e test proof");
    if (!brief.intentBrief?.coverageMechanism?.length) missingFields.push("validation or coverage mechanism for this repo");
    if (!brief.intentBrief?.deploymentContract?.summary) missingFields.push("deployment contract");
    if (!brief.intentBrief?.nonGoals?.length) missingFields.push("non goals");
    if (!brief.intentBrief?.constraints?.length) missingFields.push("constraints");
    if (!brief.intentBrief?.architecturePrinciples?.length) missingFields.push("architecture principles");
    if (!brief.intentBrief?.autonomyRules?.length) missingFields.push("autonomy rules");
    if (!brief.intentBrief?.qualityBar?.length) missingFields.push("quality bar");
    if (!brief.intentBrief?.riskBoundaries?.length) missingFields.push("risk boundaries");
    if (projectNeedsUiDirection(brief) && !brief.intentBrief?.uiDirection) {
      missingFields.push("ui direction");
    }
    if (this.workspaceAssessment.mode === "greenfield"
      && projectNeedsUiDirection(brief)
      && !hasInitialUserEntrySurfaceContract(brief)) {
      missingFields.push("entry surface contract for the greenfield UI");
    }
    if (this.workspaceAssessment.mode === "greenfield"
      && projectNeedsUiDirection(brief)
      && !hasLocalFirstRunContract(brief)) {
      missingFields.push("local first-run contract and prerequisite handling for the greenfield UI");
    }
    if (needsHostedPresenceProof(brief) && !hasHostedPresenceProofContract(brief)) {
      missingFields.push("hosted proof path for the web presence");
    }

    if (this.mode !== "refine" && this.interviewAnswers.length < MIN_INTERVIEW_QUESTIONS) {
      missingFields.push(`at least ${MIN_INTERVIEW_QUESTIONS} interview answers`);
    }
    if (this.mode !== "refine" && doneVettingCount < MIN_DONE_VETTING_QUESTIONS) {
      missingFields.push("two definition-of-done vetting passes");
    }
    if (!hasDeliveryProofPlan(brief)) {
      missingFields.push("delivery pillars that tie frontend/backend outcomes to unit/component and e2e proof");
    }
    if (!hasReasonableVerificationStandard(brief)) {
      missingFields.push("reasonable, risk-based verification standard");
    }
    if (!hasValidationMechanism(brief)) {
      missingFields.push("repo-grounded validation mechanism");
    }

    return {
      ok: missingThemes.length === 0 && missingFields.length === 0,
      missingThemes,
      missingFields,
      interviewCount: this.interviewAnswers.length,
      doneVettingCount,
    };
  }

  private requestMoreInterview(report: BriefReadinessReport): void {
    if (!this.session) return;
    const parts = [
      "You attempted to finalize Roscoe's project brief too early.",
      `Current interview count: ${report.interviewCount}. Definition-of-done passes: ${report.doneVettingCount}.`,
    ];
    if (report.missingThemes.length > 0) {
      parts.push(`Missing interview themes: ${report.missingThemes.join(", ")}.`);
    }
    if (report.missingFields.length > 0) {
      parts.push(`Missing brief detail: ${report.missingFields.join(", ")}.`);
    }
    parts.push("Continue the interview with the single highest-value multiple-choice question. Do not output a brief yet.");
    this.emit("continue-interview", report);
    this.outputBuffer = "";
    this.ignoredSuccessfulExits += 1;
    this.session.sendFollowUp(parts.join(" "));
  }

  getSession(): SessionMonitor | null {
    return this.session;
  }

  getProjectDir(): string {
    return this.projectDir;
  }
}
