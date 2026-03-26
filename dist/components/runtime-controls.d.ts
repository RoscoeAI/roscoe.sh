import { LLMProtocol, RuntimeControlSettings, RuntimeTuningMode } from "../llm-runtime.js";
export interface RuntimeEditorDraft {
    tuningMode: RuntimeTuningMode;
    model: string;
    reasoningEffort: string;
}
export declare function getReasoningOptions(protocol: LLMProtocol): string[];
export declare function createRuntimeEditorDraft(protocol: LLMProtocol, runtime: RuntimeControlSettings | null | undefined): RuntimeEditorDraft;
export declare function RuntimeSummaryPills({ protocol, runtime, }: {
    protocol: LLMProtocol;
    runtime: RuntimeControlSettings | null | undefined;
}): import("react/jsx-runtime").JSX.Element;
export declare function RuntimeEditorPanel({ protocol, runtime, scopeLabel, onApply, accentColor, }: {
    protocol: LLMProtocol;
    runtime: RuntimeControlSettings | null | undefined;
    scopeLabel: string;
    onApply: (draft: RuntimeEditorDraft) => void;
    accentColor?: string;
}): import("react/jsx-runtime").JSX.Element;
