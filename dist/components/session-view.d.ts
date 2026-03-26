import { RuntimeControlSettings } from "../llm-runtime.js";
interface SessionViewProps {
    startSpecs?: string[];
    startRuntimeOverrides?: Partial<Record<"claude" | "codex", RuntimeControlSettings>>;
}
export declare function SessionView({ startSpecs, startRuntimeOverrides }: SessionViewProps): import("react/jsx-runtime").JSX.Element;
export {};
