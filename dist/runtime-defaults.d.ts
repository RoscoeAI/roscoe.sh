import { ProjectContext } from "./config.js";
import { HeadlessProfile, LLMProtocol, RuntimeControlSettings, RuntimeTuningMode } from "./llm-runtime.js";
export interface RuntimePlan {
    profile: HeadlessProfile;
    mode: RuntimeTuningMode;
    strategy: string;
    rationale: string;
    summary: string;
}
export declare function getRuntimeTuningMode(runtime: RuntimeControlSettings | null | undefined): RuntimeTuningMode;
export declare function getTopModel(protocol: LLMProtocol): string;
export declare function getDefaultWorkerRuntime(protocol: LLMProtocol): RuntimeControlSettings;
export declare function getAcceleratedWorkerRuntime(protocol: LLMProtocol): RuntimeControlSettings;
export declare function getDefaultOnboardingRuntime(protocol: LLMProtocol): RuntimeControlSettings;
export declare function mergeRuntimeSettings(...settings: Array<RuntimeControlSettings | null | undefined>): RuntimeControlSettings;
export declare function applyRuntimeSettings(profile: HeadlessProfile, runtime: RuntimeControlSettings | null | undefined): HeadlessProfile;
export declare function getProjectWorkerRuntime(context: ProjectContext | null, protocol: LLMProtocol): RuntimeControlSettings | null;
export declare function getLockedProjectProvider(context: ProjectContext | null): LLMProtocol | null;
export declare function getExecutionModeLabel(runtime: RuntimeControlSettings | null | undefined): string;
export declare function getWorkerProfileForProject(baseProfile: HeadlessProfile, context: ProjectContext | null, overrides?: RuntimeControlSettings | null): HeadlessProfile;
export declare function recommendResponderRuntime(baseProfile: HeadlessProfile, conversationContext: string, projectContext: ProjectContext | null): RuntimePlan;
export declare function recommendWorkerRuntime(baseProfile: HeadlessProfile, conversationContext: string, projectContext: ProjectContext | null): RuntimePlan;
export declare function recommendOnboardingRuntime(baseProfile: HeadlessProfile): RuntimePlan;
