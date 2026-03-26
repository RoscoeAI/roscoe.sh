import { InterviewSelectionMode, OnboardingMode, ProjectContext, ProjectRuntimeDefaults } from "../config.js";
import { HeadlessProfile } from "../llm-runtime.js";
export type OnboardingStatus = "idle" | "initializing" | "running" | "interviewing" | "complete" | "error";
export declare const SKIP_OPTION = "Skip \u2014 use your best judgment and check in on critical decisions";
export interface QAPair {
    question: string;
    answer: string;
    theme?: string;
}
export interface InterviewQuestion {
    text: string;
    options: string[];
    theme?: string;
    purpose?: string;
    selectionMode: InterviewSelectionMode;
}
export interface AnswerSubmission {
    text: string;
    mode?: InterviewSelectionMode;
    selectedOptions?: string[];
    freeText?: string;
}
export interface OnboardingState {
    status: OnboardingStatus;
    streamingText: string;
    thinkingText: string;
    qaHistory: QAPair[];
    question: InterviewQuestion | null;
    error: string | null;
    projectContext: ProjectContext | null;
    toolActivity: string | null;
}
/** Parse structured question block from Claude's response */
export declare function parseQuestion(text: string): InterviewQuestion | null;
/** Remove structured blocks from display text */
export declare function cleanStreamingText(text: string): string;
export declare function appendStreamingChunk(previous: string, chunk: string): string;
export declare function formatOnboardingExitError(profile: HeadlessProfile | undefined, code: number): string;
export declare function useOnboarding(): {
    state: OnboardingState;
    start: (dir: string, debug?: boolean, profile?: HeadlessProfile, runtimeDefaults?: ProjectRuntimeDefaults, mode?: OnboardingMode, refineThemes?: string[]) => void;
    sendInput: (submission: string | AnswerSubmission) => void;
    updateRuntime: (profile: HeadlessProfile, runtimeDefaults?: ProjectRuntimeDefaults) => void;
};
