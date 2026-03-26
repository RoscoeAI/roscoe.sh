import { SessionMonitor } from "./session-monitor.js";
import { InterviewAnswer, OnboardingMode, ProjectContext, ProjectHistoryRecord, ProjectRuntimeDefaults } from "./config.js";
import { EventEmitter } from "events";
import { HeadlessProfile } from "./llm-runtime.js";
interface OnboarderOptions {
    mode?: OnboardingMode;
    refineThemes?: string[];
    seedContext?: ProjectContext | null;
    seedHistory?: ProjectHistoryRecord[];
}
/**
 * Manages the project onboarding flow using a headless LLM CLI.
 * Each turn is a separate non-interactive process and resumes via the provider's
 * native session/thread mechanism.
 */
export declare class Onboarder extends EventEmitter {
    private session;
    private outputBuffer;
    private projectDir;
    private profile;
    private projectRuntimeDefaults;
    private interviewAnswers;
    private sessionInterviewAnswers;
    private questionHistory;
    private rawTranscript;
    private mode;
    private refineThemes;
    private seedContext;
    private seedHistory;
    private ignoredSuccessfulExits;
    constructor(projectDir: string, debug?: boolean, profile?: HeadlessProfile, projectRuntimeDefaults?: ProjectRuntimeDefaults, options?: OnboarderOptions);
    start(): void;
    private wireEvents;
    /**
     * Send the user's interview answer. Claude decides what to ask next.
     */
    sendInput(text: string, question?: {
        question: string;
        theme?: string;
        purpose?: string;
        options?: string[];
        selectionMode?: "single" | "multi";
    }, answerMeta?: Pick<InterviewAnswer, "mode" | "selectedOptions" | "freeText">): void;
    updateRuntime(profile: HeadlessProfile, projectRuntimeDefaults?: ProjectRuntimeDefaults): void;
    private checkForProjectBrief;
    private buildStartPrompt;
    private buildFollowUpPrompt;
    private auditInterviewReadiness;
    private requestMoreInterview;
    getSession(): SessionMonitor | null;
    getProjectDir(): string;
}
export {};
