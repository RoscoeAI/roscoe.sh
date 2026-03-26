interface StatusBarProps {
    projectName: string;
    worktreeName: string;
    autoMode: boolean;
    sessionCount: number;
    viewMode: "transcript" | "raw";
    followLive: boolean;
    runtimeEditorOpen?: boolean;
}
export declare function StatusBar({ projectName, worktreeName, autoMode, sessionCount, viewMode, followLive, runtimeEditorOpen, }: StatusBarProps): import("react/jsx-runtime").JSX.Element;
export {};
