import { AuthProfile } from "./browser-agent.js";
import { HeadlessProfile, LLMProtocol, RuntimeControlSettings } from "./llm-runtime.js";
export interface LLMProfile extends HeadlessProfile {
}
export type InterviewSelectionMode = "single" | "multi";
export type OnboardingMode = "onboard" | "refine";
export interface ProjectRuntimeDefaults {
    lockedProvider?: LLMProtocol;
    workerByProtocol?: Partial<Record<LLMProtocol, RuntimeControlSettings>>;
    onboarding?: {
        profileName: string;
        runtime: RuntimeControlSettings;
    };
}
export interface InterviewAnswer {
    question: string;
    answer: string;
    theme?: string;
    mode?: InterviewSelectionMode;
    selectedOptions?: string[];
    freeText?: string;
}
export interface InterviewQuestionRecord {
    question: string;
    options: string[];
    theme?: string;
    purpose?: string;
    selectionMode?: InterviewSelectionMode;
}
export interface DeliveryPillars {
    frontend: string[];
    backend: string[];
    unitComponentTests: string[];
    e2eTests: string[];
}
export interface IntentBrief {
    projectStory: string;
    primaryUsers: string[];
    definitionOfDone: string[];
    acceptanceChecks: string[];
    successSignals: string[];
    deliveryPillars: DeliveryPillars;
    coverageMechanism: string[];
    nonGoals: string[];
    constraints: string[];
    autonomyRules: string[];
    qualityBar: string[];
    riskBoundaries: string[];
    uiDirection: string;
}
export interface ProjectContext {
    name: string;
    directory: string;
    goals: string[];
    milestones: string[];
    techStack: string[];
    notes: string;
    intentBrief?: IntentBrief;
    interviewAnswers?: InterviewAnswer[];
    runtimeDefaults?: ProjectRuntimeDefaults;
}
export interface ProjectHistoryRecord {
    id: string;
    mode: OnboardingMode;
    createdAt: string;
    directory: string;
    projectName: string;
    runtime: {
        profileName: string;
        protocol: LLMProtocol;
        summary: string;
        settings: RuntimeControlSettings;
    };
    rawTranscript: string;
    questions: InterviewQuestionRecord[];
    answers: InterviewAnswer[];
    briefSnapshot: ProjectContext;
}
export interface ProjectRegistryEntry {
    name: string;
    directory: string;
    onboardedAt: string;
    lastActive: string;
}
export interface ProjectRegistry {
    projects: ProjectRegistryEntry[];
}
export interface SmsNotificationSettings {
    enabled: boolean;
    phoneNumber: string;
    provider: "twilio";
}
export interface RoscoeSettings {
    notifications: SmsNotificationSettings;
}
export declare const ROSCOE_PROJECT_DIRNAME = ".roscoe";
export declare const LEGACY_ROSCOE_PROJECT_DIRNAME = ".llm-responder";
export declare function getProjectMemoryDir(projectDir: string): string;
export declare function getLegacyProjectMemoryDir(projectDir: string): string;
export declare function resolveProjectMemoryDir(projectDir: string): string;
export declare function getProjectContextPath(projectDir: string): string;
export declare function getProjectHistoryDir(projectDir: string): string;
export declare function loadProfile(name: string): LLMProfile;
export declare function listProfiles(): string[];
export declare function loadAuthProfile(name: string): AuthProfile;
export declare function listAuthProfiles(): string[];
export declare function loadProjectContext(projectDir: string): ProjectContext | null;
export declare function loadRoscoeSettings(): RoscoeSettings;
export declare function saveRoscoeSettings(settings: RoscoeSettings): void;
export declare function saveProjectContext(context: ProjectContext): void;
export declare function normalizeIntentBrief(context: Partial<ProjectContext>, value: unknown): IntentBrief;
export declare function normalizeProjectContext(context: Partial<ProjectContext>): ProjectContext;
export declare function saveProjectHistory(record: ProjectHistoryRecord): void;
export declare function listProjectHistory(projectDir: string): ProjectHistoryRecord[];
export declare function registerProject(name: string, directory: string): void;
export declare function listRegisteredProjects(): ProjectRegistryEntry[];
export declare function getProjectByName(name: string): ProjectRegistryEntry | undefined;
export declare function updateProjectLastActive(directory: string): void;
