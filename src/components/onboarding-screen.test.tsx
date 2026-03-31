import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { homedir } from "os";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  start: vi.fn(),
  sendInput: vi.fn(),
  sendSecretInput: vi.fn(),
  skipSecretInput: vi.fn(),
  updateRuntime: vi.fn(),
  resolveProjectRoot: vi.fn((directory: string) => directory),
  inspectWorkspaceForOnboarding: vi.fn(() => ({
    mode: "existing",
    summary: "Workspace already contains meaningful implementation files.",
    signalFiles: ["src/index.ts"],
  })),
  onboardingState: {
    status: "idle",
    streamingText: "",
    thinkingText: "",
    qaHistory: [],
    question: null,
    secretRequest: null,
    error: null,
    projectContext: null,
    toolActivity: null,
  },
}));

vi.mock("../app.js", () => ({
  useAppContext: () => ({
    dispatch: mocks.dispatch,
  }),
}));

vi.mock("../hooks/use-onboarding.js", () => ({
  SKIP_OPTION: "Skip",
  useOnboarding: () => ({
    state: mocks.onboardingState,
    start: mocks.start,
    sendInput: mocks.sendInput,
    sendSecretInput: mocks.sendSecretInput,
    skipSecretInput: mocks.skipSecretInput,
    updateRuntime: mocks.updateRuntime,
  }),
}));

vi.mock("../config.js", () => ({
  loadProjectContext: () => null,
  listProfiles: () => ["claude-code", "codex"],
  loadRoscoeSettings: () => ({
    notifications: { enabled: false, phoneNumber: "", provider: "twilio" },
    providers: {
      claude: { enabled: true, brief: false, ide: false, chrome: false },
      codex: { enabled: true, webSearch: false },
      gemini: { enabled: false },
    },
  }),
  loadProfile: (name: string) => ({ name }),
  resolveProjectRoot: mocks.resolveProjectRoot,
}));

vi.mock("../provider-registry.js", () => ({
  filterProfilesBySelectableProviders: (profiles: string[]) => profiles,
  getSelectableProviderIds: () => ["claude", "codex"],
}));

vi.mock("../llm-runtime.js", () => ({
  detectProtocol: (profile: { name?: string }) => (profile.name?.includes("codex") ? "codex" : "claude"),
  getProviderAdapter: (protocol: string) => ({
    label: protocol === "codex" ? "Codex" : "Claude",
    reasoningOptions: protocol === "codex" ? ["low", "medium", "high", "xhigh"] : ["low", "medium", "high", "max"],
    defaultReasoningEffort: protocol === "codex" ? "xhigh" : "high",
    onboardingReasoningEffort: protocol === "codex" ? "xhigh" : "max",
  }),
}));

vi.mock("../runtime-defaults.js", () => ({
  applyRuntimeSettings: (profile: unknown) => profile,
  formatTokenEfficiencyLabel: (mode: string) => mode,
  formatVerificationCadenceLabel: (mode: string) => mode,
  formatResponderApprovalLabel: (mode: string) => mode,
  formatWorkerGovernanceLabel: (mode: string) => mode,
  getAcceleratedWorkerRuntime: () => ({}),
  getDefaultProfileName: (protocol: string) => protocol === "codex" ? "codex" : "claude-code",
  getDefaultOnboardingRuntime: () => ({ model: "claude-opus-4-6", reasoningEffort: "max" }),
  getDefaultWorkerRuntime: () => ({}),
  getExecutionModeLabel: () => "safe",
  getGuildProvider: () => null,
  getResponderProvider: () => null,
  getTokenEfficiencyMode: () => "save-tokens",
  getVerificationCadence: () => "batched",
  getResponderApprovalMode: () => "auto",
  getRuntimeTuningMode: () => "auto",
  getTopModel: () => "claude-opus-4-6",
  getWorkerGovernanceMode: () => "roscoe-arbiter",
  mergeRuntimeSettings: (...parts: Array<Record<string, unknown> | undefined>) => Object.assign({}, ...parts.filter(Boolean)),
  recommendOnboardingRuntime: (profile: any) => ({
    profile,
    mode: "auto",
    strategy: "auto-onboarding",
    rationale: "Roscoe stays on the strongest onboarding runtime.",
    summary: "claude · claude-opus-4-6 · max",
  }),
}));

vi.mock("../workspace-intake.js", () => ({
  inspectWorkspaceForOnboarding: mocks.inspectWorkspaceForOnboarding,
}));

vi.mock("fs", () => ({
  readdirSync: vi.fn(() => []),
}));

import { readdirSync } from "fs";
import { OnboardingScreen, expandTilde, getDirSuggestions, getPreviousOnboardingStep, inspectSubmittedProjectDir } from "./onboarding-screen.js";

describe("OnboardingScreen", () => {
  const delay = () => new Promise((resolve) => setTimeout(resolve, 0));

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.start.mockReset();
    mocks.sendInput.mockReset();
    mocks.sendSecretInput.mockReset();
    mocks.skipSecretInput.mockReset();
    mocks.updateRuntime.mockReset();
    mocks.resolveProjectRoot.mockReset();
    mocks.resolveProjectRoot.mockImplementation((directory: string) => directory);
    mocks.inspectWorkspaceForOnboarding.mockReset();
    mocks.inspectWorkspaceForOnboarding.mockReturnValue({
      mode: "existing",
      summary: "Workspace already contains meaningful implementation files.",
      signalFiles: ["src/index.ts"],
    });
    vi.mocked(readdirSync).mockReset();
    vi.mocked(readdirSync).mockReturnValue([]);
    Object.assign(mocks.onboardingState, {
      status: "idle",
      streamingText: "",
      thinkingText: "",
      qaHistory: [],
      question: null,
      secretRequest: null,
      error: null,
      projectContext: null,
      toolActivity: null,
    });
  });

  it("shows an escape back hint on the setup screen", () => {
    const app = render(<OnboardingScreen />);
    const frame = app.lastFrame();

    expect(frame).toContain("Esc");
    expect(frame).toContain("back to previous screen");
  });

  it("makes the Guild and Roscoe provider split explicit during onboarding setup", () => {
    const app = render(<OnboardingScreen dir="/tmp/project" />);
    const frame = app.lastFrame();

    expect(frame).toContain("Roscoe will onboard and draft on");
    expect(frame).toContain("Future Guild lanes will launch on");
  });

  it("starts refine mode on the theme checklist when a directory is already known", () => {
    const app = render(<OnboardingScreen dir="/tmp/project" initialMode="refine" />);
    const frame = app.lastFrame();

    expect(frame).toContain("Refine Roscoe");
    expect(frame).toContain("Refine Themes");
    expect(frame).toContain("project-story");
    expect(frame).toContain("Step 1/2");
  });

  it("maps setup back-navigation correctly", () => {
    expect(getPreviousOnboardingStep("directory", false)).toBe("back");
    expect(getPreviousOnboardingStep("runtime", false)).toBe("directory");
    expect(getPreviousOnboardingStep("runtime", true)).toBe("back");
    expect(getPreviousOnboardingStep("themes", false, "refine")).toBe("directory");
    expect(getPreviousOnboardingStep("themes", true, "refine")).toBe("back");
    expect(getPreviousOnboardingStep("runtime", false, "refine")).toBe("themes");
  });

  it("makes the Guild and Roscoe control split explicit during onboarding setup", () => {
    const app = render(<OnboardingScreen dir="/tmp/project" />);
    const frame = app.lastFrame();

    expect(frame).toContain("Execution controls file and network access");
    expect(frame).toContain("Guild check-in mode");
    expect(frame).toContain("Verification cadence");
    expect(frame).toContain("Token efficiency");
    expect(frame).toContain("approval controls whether Roscoe asks you");
  });

  it("detects when a submitted directory should confirm the repo root", () => {
    mocks.resolveProjectRoot.mockImplementation((directory: string) => directory === "/tmp/project/cli" ? "/tmp/project" : directory);

    expect(inspectSubmittedProjectDir("/tmp/project/cli")).toEqual({
      enteredDir: "/tmp/project/cli",
      suggestedDir: "/tmp/project",
      needsConfirmation: true,
    });
    expect(inspectSubmittedProjectDir("/tmp/project")).toEqual({
      enteredDir: "/tmp/project",
      suggestedDir: "/tmp/project",
      needsConfirmation: false,
    });
  });

  it("expands home-relative paths and suggests visible directories", () => {
    vi.mocked(readdirSync).mockReturnValue([
      { name: "appsicle", isDirectory: () => true },
      { name: ".hidden", isDirectory: () => true },
      { name: "README.md", isDirectory: () => false },
    ] as any);

    expect(expandTilde("~")).toBe(homedir());
    expect(expandTilde("~/Projects")).toBe(`${homedir()}/Projects`);
    expect(getDirSuggestions("~/app")).toEqual(["~/appsicle/"]);
  });

  it("returns suggestions when the input already ends in a slash and swallows fs errors", () => {
    vi.mocked(readdirSync).mockReturnValue([
      { name: "one", isDirectory: () => true },
      { name: "two", isDirectory: () => true },
    ] as any);
    expect(getDirSuggestions("/tmp/work/")).toEqual(["/tmp/work/one/", "/tmp/work/two/"]);

    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error("boom");
    });
    expect(getDirSuggestions("/tmp/missing")).toEqual([]);
    expect(getDirSuggestions("")).toEqual([]);
  });

  it("renders first-class secure secret intake when Roscoe requests a credential", () => {
    Object.assign(mocks.onboardingState, {
      status: "interviewing",
      secretRequest: {
        key: "CF_API_TOKEN",
        label: "Cloudflare token",
        purpose: "Needed to provision previews.",
        instructions: ["Open the dashboard.", "Create a scoped token."],
        links: [{ label: "Docs", url: "https://example.com" }],
        required: true,
        targetFile: ".env.local",
      },
    });

    const app = render(<OnboardingScreen dir="/tmp/project" />);
    const frame = app.lastFrame();

    expect(frame).toContain("Secure Secret");
    expect(frame).toContain("Cloudflare token");
    expect(frame).toContain("CF_API_TOKEN");
    expect(frame).toContain(".env.local");
    expect(frame).toContain("How to get it");
    expect(frame).toContain("Official links");
  });

  it("renders the running state with interview trail, live analysis, and runtime retune overlay", async () => {
    Object.assign(mocks.onboardingState, {
      status: "running",
      streamingText: "Roscoe is reading the repo structure.",
      thinkingText: "Comparing architecture notes",
      qaHistory: [
        { question: "What matters most?", answer: "Deployment", theme: "definition-of-done" },
      ],
      toolActivity: "serena",
    });

    const app = render(<OnboardingScreen dir="/tmp/project" />);
    expect(app.lastFrame()).toContain("Roscoe Onboarding");
    expect(app.lastFrame()).toContain("Interview Trail");
    expect(app.lastFrame()).toContain("Live Analysis");
    expect(app.lastFrame()).toContain("Using serena...");
    expect(app.lastFrame()).toContain("retune runtime");
  });

  it("shows the refine and greenfield onboarding variants while running", () => {
    Object.assign(mocks.onboardingState, {
      status: "running",
      streamingText: "Tightening the saved brief.",
      thinkingText: "",
      qaHistory: [],
      toolActivity: null,
    });

    let app = render(<OnboardingScreen dir="/tmp/project" initialMode="refine" />);
    expect(app.lastFrame()).toContain("Loading the saved brief");
    expect(app.lastFrame()).toContain("Saved-brief refinement before the interview");
    app.unmount();

    mocks.inspectWorkspaceForOnboarding.mockReturnValue({
      mode: "greenfield",
      summary: "Empty workspace with only scaffolding.",
      signalFiles: [],
    });
    app = render(<OnboardingScreen dir="/tmp/project" />);
    expect(app.lastFrame()).toContain("Assessing the greenfield workspace first");
    expect(app.lastFrame()).toContain("Vision and scaffold intake before the interview");
    expect(app.lastFrame()).toContain("Workspace assessment: Empty workspace with only scaffolding.");
  });

  it("renders interviewing fallback text input when no structured question is available", () => {
    Object.assign(mocks.onboardingState, {
      status: "interviewing",
      streamingText: "Need one more detail.",
      qaHistory: [{ question: "Q1", answer: "A1" }],
      question: null,
    });

    const app = render(<OnboardingScreen dir="/tmp/project" />);
    const frame = app.lastFrame();

    expect(frame).toContain("Roscoe Intent Interview");
    expect(frame).toContain("Current Read");
    expect(frame).toContain("Reply");
    expect(frame).toContain("Fallback text input");
  });

  it("submits the fallback reply input to Roscoe", async () => {
    Object.assign(mocks.onboardingState, {
      status: "interviewing",
      question: null,
      secretRequest: null,
    });

    const app = render(<OnboardingScreen dir="/tmp/project" />);
    for (const char of "Ship it") {
      app.stdin.write(char);
      await delay();
    }
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.sendInput).toHaveBeenCalledWith("Ship it");
  });

  it("renders interviewing single-select and multi-select question states", () => {
    Object.assign(mocks.onboardingState, {
      status: "interviewing",
      question: {
        text: "Which surface matters most?",
        options: ["Builder", "Embed"],
        theme: "ui-direction",
        purpose: "Guide the next slice",
        selectionMode: "single",
      },
    });

    let app = render(<OnboardingScreen dir="/tmp/project" />);
    let frame = app.lastFrame();
    expect(frame).toContain("Question 1");
    expect(frame).toContain("Which surface matters most?");
    expect(frame).toContain("Builder");

    Object.assign(mocks.onboardingState, {
      status: "interviewing",
      question: {
        text: "Which proofs are required?",
        options: ["CI", "Preview"],
        theme: "acceptance-checks",
        purpose: "Choose all that apply",
        selectionMode: "multi",
      },
    });

    app = render(<OnboardingScreen dir="/tmp/project" />);
    frame = app.lastFrame();
    expect(frame).toContain("Which proofs are required?");
    expect(frame).toContain("Choose all that apply");
    expect(frame).toContain("Preview");
  });

  it("renders complete and error states", () => {
    Object.assign(mocks.onboardingState, {
      status: "complete",
      projectContext: { name: "AppSicle" },
      qaHistory: [{ question: "Q1", answer: "A1" }],
    });

    let app = render(<OnboardingScreen dir="/tmp/project" />);
    let frame = app.lastFrame();
    expect(frame).toContain("Onboarding Complete");
    expect(frame).toContain("AppSicle");
    expect(frame).toContain("Returning to home");

    Object.assign(mocks.onboardingState, {
      status: "error",
      error: "Codex exited with code 2",
      projectContext: null,
      qaHistory: [],
    });

    app = render(<OnboardingScreen dir="/tmp/project" />);
    frame = app.lastFrame();
    expect(frame).toContain("Codex exited with code 2");
  });

  it("renders completion copy even when there is no saved project context and falls back to unknown error text", () => {
    Object.assign(mocks.onboardingState, {
      status: "complete",
      projectContext: null,
      qaHistory: [],
    });

    let app = render(<OnboardingScreen dir="/tmp/project" />);
    let frame = app.lastFrame();
    expect(frame).toContain("Project registered. Returning to home");
    expect(frame).not.toContain("Interview Trail");

    Object.assign(mocks.onboardingState, {
      status: "error",
      error: null,
    });

    app = render(<OnboardingScreen dir="/tmp/project" />);
    frame = app.lastFrame();
    expect(frame).toContain("Unknown error");
  });

  it("submits and skips secure secret intake through the masked input", async () => {
    const secretRequest = {
      key: "CF_API_TOKEN",
      label: "Cloudflare token",
      purpose: "Needed to provision previews.",
      instructions: [],
      links: [],
      required: true,
      targetFile: ".env.local",
    };
    Object.assign(mocks.onboardingState, {
      status: "interviewing",
      secretRequest,
    });

    const app = render(<OnboardingScreen dir="/tmp/project" />);
    for (const char of "abc123") {
      app.stdin.write(char);
      await delay();
    }
    await delay();
    app.stdin.write("\r");
    await delay();

    expect(mocks.sendSecretInput).toHaveBeenCalledWith(secretRequest, "abc123");

    app.stdin.write("s");
    await delay();
    expect(mocks.skipSecretInput).toHaveBeenCalledWith(secretRequest);
  });

  it("auto-returns to dispatch after onboarding completes", () => {
    vi.useFakeTimers();
    Object.assign(mocks.onboardingState, {
      status: "complete",
      projectContext: { name: "AppSicle" },
      qaHistory: [],
    });

    render(<OnboardingScreen dir="/tmp/project" />);
    vi.advanceTimersByTime(3000);

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" });
  });

});
