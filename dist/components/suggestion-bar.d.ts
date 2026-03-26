import { SuggestionPhase } from "../types.js";
interface SuggestionBarProps {
    phase: SuggestionPhase;
    toolActivity?: string | null;
    onSubmitEdit: (text: string) => void;
    onSubmitManual: (text: string) => void;
}
export declare function SuggestionBar({ phase, toolActivity, onSubmitEdit, onSubmitManual, }: SuggestionBarProps): import("react/jsx-runtime").JSX.Element;
export {};
