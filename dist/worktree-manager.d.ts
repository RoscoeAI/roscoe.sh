export interface WorktreeInfo {
    name: string;
    path: string;
    branch: string;
    projectDir: string;
    projectName: string;
}
export declare class WorktreeManager {
    private projectDir;
    private projectName;
    constructor(projectDir: string);
    /**
     * Create a new worktree for a task.
     * Convention: sibling directory named {project}-{task}, branch named the same.
     */
    create(taskName: string): Promise<WorktreeInfo>;
    /**
     * List all worktrees for this project.
     */
    list(): Promise<WorktreeInfo[]>;
    /**
     * Remove a worktree and optionally its branch.
     */
    remove(taskName: string, force?: boolean): Promise<void>;
    /**
     * Detect the package manager from lockfiles in the project.
     */
    private detectPackageManager;
    /**
     * Run the appropriate package install in a worktree directory.
     */
    installDeps(worktreePath: string): Promise<void>;
    /**
     * Get the list of config files to copy: .env variants + custom list.
     */
    private getFilesToCopy;
    /**
     * Copy config files from the main repo to a worktree.
     */
    copyConfigFiles(worktreePath: string): Promise<string[]>;
    private copyDirectoryContents;
    getProjectName(): string;
    getProjectDir(): string;
}
