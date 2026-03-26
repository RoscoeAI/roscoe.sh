type Step = "project" | "brief" | "profile" | "worktree" | "add-more" | "auto-mode";
export declare function getPreviousSetupStep(step: Step): Step | "home";
interface SessionSetupProps {
    preselectedProjectDir?: string;
}
export declare function SessionSetup({ preselectedProjectDir }: SessionSetupProps): import("react/jsx-runtime").JSX.Element;
export {};
