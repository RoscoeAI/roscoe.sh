import React from "react";
import { SessionManagerService } from "./services/session-manager.js";
import { AppState, AppAction, Screen } from "./types.js";
import { LLMProtocol, RuntimeControlSettings } from "./llm-runtime.js";
export declare function appReducer(state: AppState, action: AppAction): AppState;
interface AppContextValue {
    service: SessionManagerService;
    dispatch: React.Dispatch<AppAction>;
    state: AppState;
}
export declare function useAppContext(): AppContextValue;
export interface AppProps {
    initialScreen?: Screen;
    startSpecs?: string[];
    onboardDir?: string;
    debug?: boolean;
    initialAutoMode?: boolean;
    startRuntimeOverrides?: Partial<Record<LLMProtocol, RuntimeControlSettings>>;
    onboardingProfileName?: string;
    onboardingRuntimeOverrides?: RuntimeControlSettings;
}
export default function App({ initialScreen, startSpecs, onboardDir, debug, initialAutoMode, startRuntimeOverrides, onboardingProfileName, onboardingRuntimeOverrides, }: AppProps): import("react/jsx-runtime").JSX.Element;
export {};
