import { resolve } from "path";
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
    "deliveryPillars": {
      "frontend": ["what the user-facing surface must do before this is done, or 'not applicable'"],
      "backend": ["what the server/data/API layer must do before this is done, or 'not applicable'"],
      "unitComponentTests": ["how unit/component tests prove the frontend/backend outcomes, including 100% coverage and edge cases"],
      "e2eTests": ["how end-to-end tests prove the full workflow, including 100% coverage of edge cases and failure modes"]
    },
    "coverageMechanism": ["how this repo measures coverage percent today, or the testing/coverage stack Roscoe should establish if none exists"],
    "nonGoals": ["what should not be optimized or expanded during delivery"],
    "constraints": ["technical, product, legal, or team constraint"],
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
- Treat definition of done as a four-pillar contract: (1) frontend outcome, (2) backend outcome, (3) unit/component test proof, and (4) e2e test proof.
- Roscoe must not call work done until pillars 3 and 4 prove pillars 1 and 2. This is a non-negotiable completion rule.
- The testing standard is 100% coverage of expected behavior and edge cases. Capture that bar explicitly in the interview and final brief.
- Roscoe must adapt to the testing mechanism already present in the repo. If no adequate testing/coverage mechanism exists, Roscoe must define one using repo-grounded best judgment and save it in the final brief.
- The final brief must state how Roscoe will obtain a measurable coverage percentage for this repo. "Done" is not allowed without a measurable coverage number.

Before you output the final brief, you MUST cover these themes:
- project story / user intent
- primary user or operator
- definition of done
- acceptance checks / proof of completion
- delivery pillars across frontend, backend, unit/component tests, and e2e tests
- coverage mechanism / measurable coverage percent
- success signals
- non-goals / scope boundaries
- autonomy / escalation rules
- quality bar / testing / review expectations
- UI direction if the repo has user-facing surfaces
- operational or product constraints
- risk boundaries

QUESTION FORMAT — you MUST end each interview turn with exactly this block:

---QUESTION---
{"question": "Your question here?", "options": ["Option A", "Option B", "Option C", "Other (I'll explain)", "Skip — use your best judgment and check in on critical decisions"], "theme": "definition-of-done", "purpose": "Why this answer matters", "selectionMode": "single"}
---END_QUESTION---

Rules:
- First turn must summarize the codebase read and explain what uncertainties remain before asking the first question.
- Use "selectionMode": "multi" when several answers can legitimately apply together, especially for delivery pillars, constraints, non-goals, quality/risk boundaries, or proof bundles.
- You must vet "definition of done" from multiple angles before finishing: desired end state, concrete proof/acceptance checks, and what shortcuts would falsely look done.
- You must ask at least one explicit question about the four delivery pillars if the developer has not already spelled them out.
- You must identify the repo's current testing/coverage mechanism, or propose one if it is missing, before you can finish.
- Ask at least two separate questions about definition of done unless the developer already answered it comprehensively in one response.
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
- Only output the final brief when the intent story, definition of done, acceptance checks, the four delivery pillars, coverage mechanism, scope boundaries, autonomy rules, and quality bar are all concrete enough for future confidence scoring.
- Do not treat work as done unless the brief explicitly says how unit/component and e2e tests prove the frontend/backend outcomes with 100% coverage of edge cases, and how Roscoe can measure that coverage percentage in this repo.
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
- Preserve stable intent. Only change what the new answers actually modify.
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
- Preserve stable saved understanding outside the refined themes.
- Use "selectionMode": "multi" when multiple answers can apply together.
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
  if (/(coverage mechanism|coverage command|coverage percent|measurable coverage|coverage stack|coverage tool|istanbul|nyc|vitest coverage|jest coverage|c8|coverage.py|go test cover|jacoco|lcov)/.test(source)) return "coverage-mechanism";
  if (/(non-goal|non goals|non-goals|scope boundary|scope creep|out of scope)/.test(source)) return "non-goals";
  if (/(constraint|constraints|limit|dependency)/.test(source)) return "constraints";
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
    ...intent.qualityBar,
    ...intent.riskBoundaries,
  ].join(" ").toLowerCase();
}

function hasFourPillarCompletionRule(brief: ProjectContext): boolean {
  const corpus = getIntentAuditCorpus(brief);
  const mentionsFrontendBackend = /(frontend|front end|ui|client)/.test(corpus)
    && /(backend|back end|api|server|data)/.test(corpus);
  const mentionsUnitAndE2e = /(unit|component)/.test(corpus)
    && /(e2e|end-to-end|end to end)/.test(corpus);
  const mentionsProof = /(prove|proof|verify|verified|verifies|demonstrate|demonstrates|show|shows|cover|covers|exercise|exercises)/.test(corpus);
  return mentionsFrontendBackend && mentionsUnitAndE2e && mentionsProof;
}

function hasCoverageStandard(brief: ProjectContext): boolean {
  const corpus = getIntentAuditCorpus(brief);
  const mentionsCoverage = /(100 ?%|full|complete).{0,24}(coverage)|coverage.{0,24}(100 ?%|full|complete)/.test(corpus);
  const mentionsEdgeCases = /edge cases?|corner cases?|failure modes?|error paths?|regressions?/.test(corpus);
  return mentionsCoverage && mentionsEdgeCases;
}

function hasMeasurableCoverageMechanism(brief: ProjectContext): boolean {
  const corpus = [
    ...(brief.intentBrief?.coverageMechanism ?? []),
    ...(brief.intentBrief?.qualityBar ?? []),
  ].join(" ").toLowerCase();
  const mentionsCoverage = /coverage/.test(corpus);
  const mentionsMeasurement = /%|percent|percentage|report|threshold|gate/.test(corpus);
  const mentionsTooling = /(vitest|jest|istanbul|nyc|c8|playwright|cypress|coverage\.py|pytest-cov|go test cover|jacoco|lcov|simplecov)/.test(corpus);
  return mentionsCoverage && (mentionsMeasurement || mentionsTooling);
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
  private mode: OnboardingMode;
  private refineThemes: string[];
  private seedContext: ProjectContext | null;
  private seedHistory: ProjectHistoryRecord[];
  private ignoredSuccessfulExits = 0;

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
    this.interviewAnswers = this.mode === "refine"
      ? [...(this.seedContext?.interviewAnswers ?? [])]
      : [];
    this.sessionInterviewAnswers = [];
    this.questionHistory = [];
    this.rawTranscript = "";

    this.session = new SessionMonitor(
      `orchestrator-${Date.now()}`,
      this.profile,
      dir,
    );

    this.wireEvents();
    this.session.startTurn(this.buildStartPrompt());
  }

  private wireEvents(): void {
    if (!this.session) return;

    this.session.on("text", (chunk: string) => {
      this.outputBuffer += chunk;
      this.rawTranscript += chunk;
      this.emit("output", chunk);
    });

    this.session.on("turn-complete", () => {
      dbg("onboard", `turn-complete (buffer: ${this.outputBuffer.length} chars)`);
      const question = extractQuestionRecord(this.outputBuffer);
      if (question && this.questionHistory[this.questionHistory.length - 1]?.question !== question.question) {
        this.questionHistory.push(question);
      }
      const briefState = this.checkForProjectBrief();
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
    const prompt = this.buildFollowUpPrompt(
      question?.question ?? "Unknown question",
      text,
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
      return ONBOARDING_PROMPT;
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
    if (!brief.intentBrief?.deliveryPillars?.frontend?.length) missingFields.push("delivery pillars: frontend outcome");
    if (!brief.intentBrief?.deliveryPillars?.backend?.length) missingFields.push("delivery pillars: backend outcome");
    if (!brief.intentBrief?.deliveryPillars?.unitComponentTests?.length) missingFields.push("delivery pillars: unit/component test proof");
    if (!brief.intentBrief?.deliveryPillars?.e2eTests?.length) missingFields.push("delivery pillars: e2e test proof");
    if (!brief.intentBrief?.coverageMechanism?.length) missingFields.push("coverage mechanism with measurable percent");
    if (!brief.intentBrief?.nonGoals?.length) missingFields.push("non goals");
    if (!brief.intentBrief?.constraints?.length) missingFields.push("constraints");
    if (!brief.intentBrief?.autonomyRules?.length) missingFields.push("autonomy rules");
    if (!brief.intentBrief?.qualityBar?.length) missingFields.push("quality bar");
    if (!brief.intentBrief?.riskBoundaries?.length) missingFields.push("risk boundaries");
    if (projectNeedsUiDirection(brief) && !brief.intentBrief?.uiDirection) {
      missingFields.push("ui direction");
    }

    if (this.mode !== "refine" && this.interviewAnswers.length < MIN_INTERVIEW_QUESTIONS) {
      missingFields.push(`at least ${MIN_INTERVIEW_QUESTIONS} interview answers`);
    }
    if (this.mode !== "refine" && doneVettingCount < MIN_DONE_VETTING_QUESTIONS) {
      missingFields.push("two definition-of-done vetting passes");
    }
    if (!hasFourPillarCompletionRule(brief)) {
      missingFields.push("four-pillar completion rule tying tests to frontend/backend outcomes");
    }
    if (!hasCoverageStandard(brief)) {
      missingFields.push("100% coverage and edge-case standard");
    }
    if (!hasMeasurableCoverageMechanism(brief)) {
      missingFields.push("measurable coverage mechanism for this repo");
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
