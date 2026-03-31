import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  startSession: vi.fn(),
  createWorktree: vi.fn(async (taskName: string) => ({ path: `/tmp/${taskName}` })),
  textInputs: [] as Array<{ onSubmit: (value: string) => void }>,
  state: { autoMode: false, autoModeConfigured: false },
  listLaneSessions: vi.fn<(projectDir: string) => Array<Record<string, string>>>(() => []),
  listProjectHistory: vi.fn<(projectDir: string) => unknown[]>(() => []),
  loadProjectContext: vi.fn<(directory: string) => Record<string, unknown> | null>(() => null),
  listRegisteredProjects: vi.fn(() => [
    {
      name: "K12.io",
      directory: "/tmp/k12io",
      onboardedAt: "2026-03-12T12:00:00.000Z",
      lastActive: "2026-03-12T12:00:00.000Z",
    },
  ]),
}));

vi.mock("../app.js", () => ({
  useAppContext: () => ({
    dispatch: mocks.dispatch,
    service: { startSession: mocks.startSession },
    state: mocks.state,
  }),
}));

vi.mock("../config.js", () => ({
  getProjectContextPath: (directory: string) => `${directory}/.roscoe/project.json`,
  listLaneSessions: mocks.listLaneSessions,
  listProjectHistory: mocks.listProjectHistory,
  listRegisteredProjects: mocks.listRegisteredProjects,
  listProfiles: () => ["claude-code", "codex"],
  loadRoscoeSettings: () => ({
    notifications: { enabled: false, phoneNumber: "", provider: "twilio" },
    providers: {
      claude: { enabled: true, brief: false, ide: false, chrome: false },
      codex: { enabled: true, webSearch: false },
      gemini: { enabled: false },
    },
    behavior: { autoHealMetadata: true },
  }),
  loadProfile: (name: string) => ({ name, protocol: name.includes("codex") ? "codex" : "claude" }),
  loadProjectContext: mocks.loadProjectContext,
  resolveProjectRoot: (directory: string) => directory === "/tmp/k12io/cli" ? "/tmp/k12io" : directory,
}));

vi.mock("../provider-registry.js", () => ({
  filterProfilesBySelectableProviders: (profiles: string[]) => profiles,
}));

vi.mock("@inkjs/ui", async () => {
  const actual = await vi.importActual<typeof import("@inkjs/ui")>("@inkjs/ui");
  const ink = await vi.importActual<typeof import("ink")>("ink");
  return {
    ...actual,
    TextInput: ({ onSubmit }: { onSubmit: (value: string) => void }) => {
      mocks.textInputs.push({ onSubmit });
      return <ink.Text>TEXT INPUT</ink.Text>;
    },
  };
});

vi.mock("../worktree-manager.js", () => ({
  WorktreeManager: class {
    async create(taskName: string) {
      return mocks.createWorktree(taskName);
    }
  },
}));

vi.mock("../llm-runtime.js", () => ({
  detectProtocol: (profile: { protocol?: string; name?: string }) => profile.protocol ?? (profile.name?.includes("codex") ? "codex" : "claude"),
  summarizeRuntime: () => "runtime summary",
}));

vi.mock("../runtime-defaults.js", () => ({
  formatVerificationCadenceLabel: (mode: string) => mode,
  formatResponderApprovalLabel: (mode: string) => mode,
  formatTokenEfficiencyLabel: (mode: string) => mode,
  formatWorkerGovernanceLabel: (mode: string) => mode,
  getExecutionModeLabel: () => "safe",
  getGuildProvider: (context: any) => context?.runtimeDefaults?.guildProvider ?? null,
  getResponderApprovalMode: (context: any) => context?.runtimeDefaults?.responderApprovalMode ?? null,
  getResponderProvider: (context: any) => context?.runtimeDefaults?.responderProvider ?? null,
  getRuntimeTuningMode: () => "manual",
  getTokenEfficiencyMode: () => "save-tokens",
  getVerificationCadence: () => "batched",
  getWorkerGovernanceMode: (context: any) => context?.runtimeDefaults?.workerGovernanceMode ?? "roscoe-arbiter",
  getWorkerProfileForProject: (profile: unknown) => profile,
}));

import { SessionSetup } from "./session-setup.js";
import { getPreviousSetupStep } from "./session-setup.js";

function delay(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(assertion: () => void, attempts = 20, ms = 20) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(ms);
    }
  }
  throw lastError;
}

describe("SessionSetup", () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.startSession.mockReset();
    mocks.createWorktree.mockReset();
    mocks.createWorktree.mockImplementation(async (taskName: string) => ({ path: `/tmp/${taskName}` }));
    mocks.textInputs.length = 0;
    mocks.state.autoMode = false;
    mocks.state.autoModeConfigured = false;
    mocks.listLaneSessions.mockReset();
    mocks.listLaneSessions.mockReturnValue([]);
    mocks.listProjectHistory.mockReset();
    mocks.listProjectHistory.mockReturnValue([]);
    mocks.loadProjectContext.mockReset();
    mocks.loadProjectContext.mockReturnValue(null);
  });

  it("shows onboarding in the unified project chooser and a back hint", () => {
    const app = render(<SessionSetup />);
    const frame = app.lastFrame();

    expect(frame).toContain("Choose or onboard a project:");
    expect(frame).toContain("Onboard another project");
    expect(frame).toContain("Esc");
    expect(frame).toContain("back to dispatch board");
  });

  it("opens onboarding from the project chooser", async () => {
    const app = render(<SessionSetup />);

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "OPEN_ONBOARDING",
      request: { mode: "onboard" },
    });
  });

  it("maps setup back navigation to the expected prior step", () => {
    expect(getPreviousSetupStep("project")).toBe("home");
    expect(getPreviousSetupStep("brief")).toBe("project");
    expect(getPreviousSetupStep("profile")).toBe("brief");
    expect(getPreviousSetupStep("worktree")).toBe("profile");
    expect(getPreviousSetupStep("add-more")).toBe("worktree");
    expect(getPreviousSetupStep("auto-mode")).toBe("add-more");
  });

  it("keeps the unified chooser focused on start/setup rather than a dead-end prompt", () => {
    const app = render(<SessionSetup />);
    const frame = app.lastFrame();

    expect(frame).toContain("Pick a remembered repo, use the current directory, or onboard a new one.");
    expect(frame).toContain("Current");
  });

  it("hides the lane preview panel until the user is assembling more than one lane", () => {
    const app = render(<SessionSetup />);
    const frame = app.lastFrame();

    expect(frame).not.toContain("Lane Preview");
    expect(frame).not.toContain("No sessions configured yet.");
  });

  it("shows a project-specific saved-lane continue action when exactly one resumable lane exists", async () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: { responderApprovalMode: "auto" },
          }
        : null
    ));
    mocks.listLaneSessions.mockReturnValue([
      {
        projectDir: "/tmp/k12io",
        projectName: "K12.io",
        worktreePath: "/tmp/k12io",
        worktreeName: "main",
        profileName: "claude-code",
      },
    ]);
    mocks.startSession.mockReturnValue({
      managed: {
        id: "sess-1",
        profileName: "claude-code",
        projectName: "K12.io",
        worktreeName: "main",
      },
      restoredState: null,
    });

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    const frame = app.lastFrame();

    expect(frame).toContain("Continue with saved lane in K12.io");
    expect(frame).not.toContain("Continue with new lane");
    expect(frame).not.toContain("Continue to runtime selection");

    app.stdin.write("\r");
    await waitFor(() => {
      expect(mocks.startSession).toHaveBeenCalled();
    });

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_AUTO_MODE", enabled: true });
    expect(mocks.startSession).toHaveBeenCalledWith({
      profileName: "claude-code",
      projectDir: "/tmp/k12io",
      projectName: "K12.io",
      worktreePath: "/tmp/k12io",
      worktreeName: "main",
    });
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ADD_SESSION",
      session: expect.objectContaining({
        id: "sess-1",
        profileName: "claude-code",
        projectName: "K12.io",
        worktreeName: "main",
      }),
    }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_ACTIVE", id: "sess-1" });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_SCREEN", screen: "session-view" });
  });

  it("ignores exited saved lanes when deciding whether to offer saved-lane continue", () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: { responderApprovalMode: "auto" },
          }
        : null
    ));
    mocks.listLaneSessions.mockReturnValue([
      {
        projectDir: "/tmp/k12io",
        projectName: "K12.io",
        worktreePath: "/tmp/k12io",
        worktreeName: "main",
        profileName: "claude-code",
        status: "exited",
      },
    ]);

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    const frame = app.lastFrame();

    expect(frame).not.toContain("Continue with saved lane in K12.io");
    expect(frame).toContain("Continue to runtime selection for K12.io");
  });

  it("keeps the user's explicit approval mode when continuing a saved lane", async () => {
    mocks.state.autoMode = false;
    mocks.state.autoModeConfigured = true;
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: { responderApprovalMode: "manual" },
          }
        : null
    ));
    mocks.listLaneSessions.mockReturnValue([
      {
        projectDir: "/tmp/k12io",
        projectName: "K12.io",
        worktreePath: "/tmp/k12io",
        worktreeName: "main",
        profileName: "claude-code",
      },
    ]);
    mocks.startSession.mockReturnValue({
      managed: {
        id: "sess-1",
        profileName: "claude-code",
        projectName: "K12.io",
        worktreeName: "main",
      },
      restoredState: null,
    });

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\r");
    await waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_AUTO_MODE", enabled: false });
    });
  });

  it("keeps runtime selection when more than one saved lane exists", () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: { responderApprovalMode: "auto" },
          }
        : null
    ));
    mocks.listLaneSessions.mockReturnValue([
      {
        projectDir: "/tmp/k12io",
        projectName: "K12.io",
        worktreePath: "/tmp/k12io",
        worktreeName: "main",
        profileName: "claude-code",
      },
      {
        projectDir: "/tmp/k12io",
        projectName: "K12.io",
        worktreePath: "/tmp",
        worktreeName: "feature",
        profileName: "codex",
      },
    ]);

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    const frame = app.lastFrame();

    expect(frame).toContain("Continue to runtime selection for K12.io");
  });

  it("shows a neutral continue action from the home flow and skips runtime selection from the brief when only one runtime is allowed", async () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: {
              guildProvider: "claude",
              responderProvider: "codex",
              responderApprovalMode: "auto",
            },
          }
        : null
    ));

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    const frame = app.lastFrame();

    expect(frame).toContain("Continue in K12.io");
    expect(frame).not.toContain("Continue with new lane");
    expect(frame).not.toContain("Continue to runtime selection");

    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Worktree task name");
    });
    expect(app.lastFrame()).not.toContain("Select a runtime:");
  });

  it("shows a project-specific new-lane action when opened from an existing lane surface", () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: {
              guildProvider: "claude",
              responderProvider: "codex",
              responderApprovalMode: "auto",
            },
          }
        : null
    ));

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" openedFromSessionView />);
    const frame = app.lastFrame();

    expect(frame).toContain("Continue with new lane in K12.io");
    expect(frame).not.toContain("Continue in K12.io");
  });

  it("continues from the brief into runtime selection when multiple profiles are allowed", async () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: {
              responderApprovalMode: "auto",
            },
          }
        : null
    ));

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Select a runtime:");
    });
  });

  it("opens refine understanding from the saved brief", async () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: {
              onboarding: {
                profileName: "claude-code",
                runtime: { model: "claude-opus-4-6" },
              },
              responderApprovalMode: "auto",
            },
          }
        : null
    ));

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "OPEN_ONBOARDING",
      request: {
        dir: "/tmp/k12io",
        initialProfileName: "claude-code",
        initialRuntimeOverrides: { model: "claude-opus-4-6" },
        mode: "refine",
      },
    });
  });

  it("backs out from the saved brief to the project chooser", async () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: { responderApprovalMode: "auto" },
          }
        : null
    ));

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Choose or onboard a project:");
  });

  it("uses escape from the saved brief to return to the project chooser", async () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: { responderApprovalMode: "auto" },
          }
        : null
    ));

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    expect(app.lastFrame()).toContain("Project story");

    app.stdin.write("\u001B");
    await delay();

    expect(app.lastFrame()).toContain("Choose or onboard a project:");
  });

  it("treats duplicate snapshots for the same saved lane as a direct continue", () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: { responderApprovalMode: "auto" },
          }
        : null
    ));
    mocks.listLaneSessions.mockReturnValue([
      {
        projectDir: "/tmp/k12io",
        projectName: "K12.io",
        worktreePath: "/tmp/k12io",
        worktreeName: "main",
        profileName: "claude-code",
        savedAt: "2026-03-26T00:00:00.000Z",
      },
      {
        projectDir: "/tmp/k12io",
        projectName: "K12.io",
        worktreePath: "/tmp/k12io",
        worktreeName: "main",
        profileName: "claude-code",
        savedAt: "2026-03-26T01:00:00.000Z",
      },
    ]);

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io/cli" />);
    const frame = app.lastFrame();

    expect(frame).toContain("Continue with saved lane in K12.io");
    expect(frame).not.toContain("Continue to runtime selection");
  });

  it("shows a compact saved brief by default and expands on demand", async () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Fallback brief",
            intentBrief: {
              projectStory: "Roscoe tracks provider lanes and keeps the project aligned with the saved contract.",
              definitionOfDone: [
                "Guild lanes can keep progressing without manual babysitting.",
                "Roscoe can resume and review prior state after a restart.",
              ],
              deliveryPillars: {
                frontend: ["Keep the TUI legible while multiple lanes run."],
                backend: ["Persist lane state and transcript ordering consistently."],
                unitComponentTests: [],
                e2eTests: [],
              },
              coverageMechanism: ["Keep the launch and restore paths covered by tests."],
              constraints: ["Do not regress the resume flow."],
              architecturePrinciples: ["Prefer shared lane state instead of one-off screen-local state."],
              autonomyRules: ["Roscoe can continue drafting until the user intervenes."],
              qualityBar: ["Any broken resume path is a release blocker."],
            },
            interviewAnswers: [
              { question: "How should Roscoe behave?", answer: "Stay aligned with the saved brief.", theme: "autonomy-rules" },
            ],
            runtimeDefaults: { responderApprovalMode: "auto" },
          }
        : null
    ));

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);

    expect(app.lastFrame()).toContain("Project story");
    expect(app.lastFrame()).toContain("Definition of done");
    expect(app.lastFrame()).toContain("show full brief");
    expect(app.lastFrame()).not.toContain("Coverage mechanism");
    expect(app.lastFrame()).not.toContain("Interview trail");

    app.stdin.write("x");
    await delay();

    expect(app.lastFrame()).toContain("Coverage mechanism");
    expect(app.lastFrame()).toContain("Interview trail");
    expect(app.lastFrame()).toContain("show less");
  });

  it("creates a named worktree and queues it as a pending lane", async () => {
    mocks.createWorktree.mockResolvedValue({ path: "/tmp/k12io/.worktrees/feature-a" });

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\r");
    await delay();

    mocks.textInputs.at(-1)?.onSubmit("feature-a");
    await delay(50);

    expect(mocks.createWorktree).toHaveBeenCalledWith("feature-a");
    expect(app.lastFrame()).toContain("Add another lane?");
    expect(app.lastFrame()).toContain("feature-a");
  });

  it("surfaces worktree creation errors", async () => {
    mocks.createWorktree.mockRejectedValue(new Error("git worktree failed"));

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\r");
    await delay();

    mocks.textInputs.at(-1)?.onSubmit("broken-lane");
    await delay(50);

    expect(app.lastFrame()).toContain("Failed to create worktree: git worktree failed");
  });

  it("returns to the project chooser when adding another lane, while keeping the queued lane preview visible", async () => {
    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);

    expect(app.lastFrame()).toContain("Select a runtime:");

    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Worktree task name");

    mocks.textInputs.at(-1)?.onSubmit("");
    await delay();

    expect(app.lastFrame()).toContain("Add another lane?");
    expect(app.lastFrame()).not.toContain("Lane Preview");

    app.stdin.write("\u001B[B");
    await delay();

    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Choose or onboard a project:");
    expect(app.lastFrame()).toContain("Lane Preview");
    expect(app.lastFrame()).toContain("K12.io");
    expect(app.lastFrame()).toContain("claude-code");
    expect(app.lastFrame()).not.toContain("Worktree task name");
  });

  it("backs from the project chooser to the add-another-lane step when lanes are already queued", async () => {
    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);

    app.stdin.write("\r");
    await delay();

    mocks.textInputs.at(-1)?.onSubmit("");
    await delay();

    app.stdin.write("\u001B[B");
    await delay();

    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Choose or onboard a project:");

    app.stdin.write("\u001B");
    await delay();

    expect(app.lastFrame()).toContain("Add another lane?");
    expect(app.lastFrame()).toContain("No — start these lanes");
  });

  it("goes back to dispatch when escape is pressed on the project chooser with no queued lanes", async () => {
    const app = render(<SessionSetup />);

    app.stdin.write("\u001B");
    await delay();

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" });
  });

  it("goes back from profile selection to the saved brief", async () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: { responderApprovalMode: "auto" },
          }
        : null
    ));

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    expect(app.lastFrame()).toContain("Project story");

    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Select a runtime:");

    app.stdin.write("\u001B");
    await delay();

    expect(app.lastFrame()).toContain("Project story");
  });

  it("goes back from the worktree step into runtime selection", async () => {
    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io/cli" />);

    expect(app.lastFrame()).toContain("Select a runtime:");

    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Worktree task name");

    app.stdin.write("\u001B");
    await delay();

    expect(app.lastFrame()).toContain("Select a runtime:");
  });

  it("goes back from the add-another-lane step and drops the queued lane", async () => {
    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);

    app.stdin.write("\r");
    await delay();
    mocks.textInputs.at(-1)?.onSubmit("feature-b");
    await delay(30);

    expect(app.lastFrame()).toContain("Add another lane?");
    expect(app.lastFrame()).toContain("feature-b");

    app.stdin.write("\u001B");
    await delay();

    expect(app.lastFrame()).toContain("Worktree task name");
    expect(app.lastFrame()).not.toContain("Lane Preview");
  });

  it("defaults the add-another-lane step to starting the queued lanes", async () => {
    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);

    app.stdin.write("\r");
    await delay();

    mocks.textInputs.at(-1)?.onSubmit("");
    await delay();

    expect(app.lastFrame()).toContain("No — start these lanes");

    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("How should Roscoe handle high-confidence replies?");
    expect(app.lastFrame()).not.toContain("Worktree task name");
  });

  it("starts queued lanes immediately when they share a saved approval mode", async () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: { responderApprovalMode: "auto" },
          }
        : null
    ));
    mocks.startSession.mockReturnValue({
      managed: {
        id: "sess-shared-auto",
        profileName: "claude-code",
        projectName: "K12.io",
        worktreeName: "main",
      },
      restoredState: null,
    });

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Select a runtime:");
    app.stdin.write("\r");
    await delay();
    expect(app.lastFrame()).toContain("Worktree task name");
    mocks.textInputs.at(-1)?.onSubmit("");
    await delay();

    expect(app.lastFrame()).toContain("Add another lane?");
    app.stdin.write("\r");
    await delay(40);

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_AUTO_MODE", enabled: true });
    expect(mocks.startSession).toHaveBeenCalledWith(expect.objectContaining({
      profileName: "claude-code",
      projectDir: "/tmp/k12io",
      projectName: "K12.io",
      worktreeName: "main",
    }));
    expect(app.lastFrame()).not.toContain("How should Roscoe handle high-confidence replies?");
  });

  it("falls back to auto mode when resuming a saved lane without a saved approval mode", async () => {
    mocks.state.autoMode = false;
    mocks.state.autoModeConfigured = false;
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: {},
          }
        : null
    ));
    mocks.listLaneSessions.mockReturnValue([
      {
        projectDir: "/tmp/k12io",
        projectName: "K12.io",
        worktreePath: "/tmp/k12io",
        worktreeName: "main",
        profileName: "claude-code",
      },
    ]);
    mocks.startSession.mockReturnValue({
      managed: {
        id: "sess-fallback-auto",
        profileName: "claude-code",
        projectName: "K12.io",
        worktreeName: "main",
      },
      restoredState: null,
    });

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\r");
    await waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_AUTO_MODE", enabled: true });
    });
    expect(mocks.startSession).toHaveBeenCalledWith(expect.objectContaining({
      profileName: "claude-code",
      projectDir: "/tmp/k12io",
      projectName: "K12.io",
      worktreeName: "main",
    }));
  });

  it("launches queued lanes in manual approval mode when chosen from the auto-mode step", async () => {
    mocks.startSession.mockReturnValue({
      managed: {
        id: "sess-2",
        profileName: "claude-code",
        projectName: "K12.io",
        worktreeName: "main",
      },
      restoredState: {
        status: null,
        startedAt: new Date(0).toISOString(),
        timeline: [],
        preview: { mode: "off" },
      },
    });

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\r");
    await delay();
    mocks.textInputs.at(-1)?.onSubmit("");
    await delay();
    app.stdin.write("\r");
    await delay();

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay(50);

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_AUTO_MODE", enabled: false });
    expect(mocks.startSession).toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_ACTIVE", id: "sess-2" });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_SCREEN", screen: "session-view" });
  });

  it("restores a pending suggestion as a review lane when launching a saved session", async () => {
    mocks.loadProjectContext.mockImplementation((directory: string) => (
      directory === "/tmp/k12io"
        ? {
            name: "K12.io",
            directory,
            goals: [],
            milestones: [],
            techStack: [],
            notes: "Saved brief",
            runtimeDefaults: { responderApprovalMode: "auto" },
          }
        : null
    ));
    mocks.listLaneSessions.mockReturnValue([
      {
        projectDir: "/tmp/k12io",
        projectName: "K12.io",
        worktreePath: "/tmp/k12io",
        worktreeName: "main",
        profileName: "claude-code",
      },
    ]);
    mocks.startSession.mockReturnValue({
      managed: {
        id: "sess-review",
        profileName: "claude-code",
        projectName: "K12.io",
        worktreeName: "main",
      },
      restoredState: {
        status: null,
        startedAt: new Date(0).toISOString(),
        outputLines: [],
        summary: "Needs review",
        currentToolUse: null,
        currentToolDetail: null,
        usage: undefined,
        rateLimitStatus: null,
        timeline: [
          {
            kind: "local-suggestion",
            state: "pending",
            text: "Send this next.",
            confidence: 82,
            reasoning: "ready",
            timestamp: 1,
          },
        ],
        preview: { mode: "off" },
        pendingOperatorMessages: [],
      },
    });

    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\r");
    await waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: "ADD_SESSION",
        session: expect.objectContaining({
          id: "sess-review",
          status: "review",
          suggestion: expect.objectContaining({
            kind: "ready",
            result: expect.objectContaining({
              text: "Send this next.",
              confidence: 82,
            }),
          }),
        }),
      }));
    });

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_ACTIVE", id: "sess-review" });
  });

  it("selects a project without a saved brief and falls back to its basename", async () => {
    const app = render(<SessionSetup />);

    app.stdin.write("\u001B[B");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("Select a runtime:");
    expect(app.lastFrame()).toContain("roscoe.sh");
  });

  it("backs out from the auto-mode step to add-another-lane", async () => {
    const app = render(<SessionSetup preselectedProjectDir="/tmp/k12io" />);
    app.stdin.write("\r");
    await delay();
    mocks.textInputs.at(-1)?.onSubmit("");
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(app.lastFrame()).toContain("How should Roscoe handle high-confidence replies?");

    app.stdin.write("\u001B");
    await delay();

    expect(app.lastFrame()).toContain("Add another lane?");
  });
});
