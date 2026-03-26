import { OnboardingMode } from "../config.js";
import { RuntimeControlSettings } from "../llm-runtime.js";
interface OnboardingScreenProps {
    dir?: string;
    debug?: boolean;
    initialProfileName?: string;
    initialRuntimeOverrides?: RuntimeControlSettings;
    initialMode?: OnboardingMode;
    initialRefineThemes?: string[];
}
type SetupStep = "directory" | "themes" | "profile" | "model" | "effort" | "tuning" | "execution";
export declare function getPreviousOnboardingStep(step: SetupStep, hasPresetDirectory: boolean, mode?: OnboardingMode): SetupStep | "back";
export declare function OnboardingScreen({ dir, debug, initialProfileName, initialRuntimeOverrides, initialMode, initialRefineThemes, }: OnboardingScreenProps): import("react/jsx-runtime").JSX.Element;
export {};
