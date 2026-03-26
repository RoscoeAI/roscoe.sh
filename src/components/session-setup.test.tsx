import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  startSession: vi.fn(),
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
  }),
}));

vi.mock("../config.js", () => ({
  listProjectHistory: () => [],
  listRegisteredProjects: mocks.listRegisteredProjects,
  listProfiles: () => ["claude-code", "codex"],
  loadProfile: () => ({ protocol: "claude" }),
  loadProjectContext: () => null,
}));

vi.mock("../worktree-manager.js", () => ({
  WorktreeManager: class {
    async create(taskName: string) {
      return { path: `/tmp/${taskName}` };
    }
  },
}));

vi.mock("../llm-runtime.js", () => ({
  summarizeRuntime: () => "runtime summary",
}));

vi.mock("../runtime-defaults.js", () => ({
  getLockedProjectProvider: () => null,
  getWorkerProfileForProject: (profile: unknown) => profile,
}));

import { SessionSetup } from "./session-setup.js";
import { getPreviousSetupStep } from "./session-setup.js";

describe("SessionSetup", () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.startSession.mockReset();
  });

  it("shows onboarding in the unified project chooser and a back hint", () => {
    const app = render(<SessionSetup />);
    const frame = app.lastFrame();

    expect(frame).toContain("Choose or onboard a project:");
    expect(frame).toContain("Onboard another project");
    expect(frame).toContain("Esc");
    expect(frame).toContain("back to dispatch board");
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
    expect(frame).toContain("Current directory");
  });
});
