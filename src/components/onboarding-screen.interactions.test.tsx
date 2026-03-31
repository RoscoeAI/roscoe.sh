import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";

const mocks = vi.hoisted(() => {
  const ui = {
    textInputs: [] as Array<{
      placeholder?: string;
      defaultValue?: string;
      suggestions?: string[];
      onChange?: (value: string) => void;
      onSubmit: (value: string) => void;
    }>,
    selects: [] as Array<{ options: Array<{ label: string; value: string }>; onChange: (value: string) => void }>,
    checklists: [] as Array<{ options: string[]; onSubmit: (values: string[]) => void }>,
    runtimePanels: [] as Array<{ onApply: (draft: any) => void }>,
  };

  return {
    ui,
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
  };
});

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
  getAcceleratedWorkerRuntime: (protocol: string) => ({ protocol, executionMode: "accelerated" }),
  getDefaultProfileName: (protocol: string) => protocol === "codex" ? "codex" : "claude-code",
  getDefaultOnboardingRuntime: () => ({ model: "claude-opus-4-6", reasoningEffort: "max" }),
  getDefaultWorkerRuntime: (protocol: string) => ({ protocol, executionMode: "safe" }),
  getExecutionModeLabel: (runtime: { executionMode?: string }) => runtime.executionMode ?? "safe",
  getGuildProvider: () => null,
  getResponderProvider: () => null,
  getTokenEfficiencyMode: () => "save-tokens",
  getVerificationCadence: () => "batched",
  getResponderApprovalMode: () => "auto",
  getTopModel: (protocol: string) => protocol === "codex" ? "gpt-5.4" : "claude-opus-4-6",
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

vi.mock("@inkjs/ui", () => ({
  TextInput: ({
    placeholder,
    defaultValue,
    suggestions,
    onChange,
    onSubmit,
  }: {
    placeholder?: string;
    defaultValue?: string;
    suggestions?: string[];
    onChange?: (value: string) => void;
    onSubmit: (value: string) => void;
  }) => {
    mocks.ui.textInputs.push({ placeholder, defaultValue, suggestions, onChange, onSubmit });
    return <Text>{placeholder ?? "text-input"}</Text>;
  },
  StatusMessage: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
  Select: ({ options, onChange }: { options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) => {
    mocks.ui.selects.push({ options, onChange });
    return <Text>{options.map((option) => option.label).join(" | ")}</Text>;
  },
}));

vi.mock("./runtime-controls.js", () => ({
  RuntimeEditorPanel: ({ onApply }: { onApply: (draft: any) => void }) => {
    mocks.ui.runtimePanels.push({ onApply });
    return <Text>RuntimeEditorPanel</Text>;
  },
  RuntimeSummaryPills: () => <Text>RuntimeSummaryPills</Text>,
}));

vi.mock("./checklist-select.js", () => ({
  ChecklistSelect: ({ options, onSubmit }: { options: string[]; onSubmit: (values: string[]) => void }) => {
    mocks.ui.checklists.push({ options, onSubmit });
    return <Text>{options.join(" | ")}</Text>;
  },
}));

import { OnboardingScreen } from "./onboarding-screen.js";

describe("OnboardingScreen interactions", () => {
  const delay = () => new Promise((resolve) => setTimeout(resolve, 0));
  const waitFor = async (assertion: () => void, attempts = 20) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        assertion();
        return;
      } catch (error) {
        lastError = error;
        await delay();
      }
    }
    throw lastError;
  };

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
    mocks.ui.textInputs.length = 0;
    mocks.ui.selects.length = 0;
    mocks.ui.checklists.length = 0;
    mocks.ui.runtimePanels.length = 0;
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

  it("confirms a nested directory, advances to runtime, and starts onboarding from the runtime wizard", async () => {
    mocks.resolveProjectRoot.mockImplementation((directory: string) => directory === "/tmp/project/cli" ? "/tmp/project" : directory);
    mocks.start.mockImplementation(() => {
      Object.assign(mocks.onboardingState, {
        status: "running",
        streamingText: "Booting the onboarding session.",
      });
    });

    const app = render(<OnboardingScreen />);
    mocks.ui.textInputs.at(-1)?.onSubmit("/tmp/project/cli");
    await delay();
    expect(app.lastFrame()).toContain("Repo root detected for this path:");

    mocks.ui.selects.at(-1)?.onChange("entered");
    await delay();
    expect(app.lastFrame()).toContain("RuntimeEditorPanel");

    mocks.ui.runtimePanels.at(-1)?.onApply({
      workerProvider: "codex",
      responderProvider: "claude",
      workerExecutionMode: "accelerated",
      workerModel: "gpt-5.4",
      workerReasoningEffort: "high",
      responderModel: "claude-opus-4-6",
      responderReasoningEffort: "max",
      workerTuningMode: "manual",
      workerGovernanceMode: "guild-direct",
      verificationCadence: "proof-first",
      tokenEfficiencyMode: "balanced",
      responderApprovalMode: "manual",
    });
    await delay();

    expect(mocks.start).toHaveBeenCalled();
    expect(app.lastFrame()).toContain("Roscoe Onboarding");
  });

  it("accepts refine themes and advances into the runtime wizard", async () => {
    const app = render(<OnboardingScreen dir="/tmp/project" initialMode="refine" />);

    mocks.ui.checklists.at(-1)?.onSubmit(["definition-of-done", "quality-bar"]);
    await delay();

    expect(app.lastFrame()).toContain("RuntimeEditorPanel");
  });

  it("submits single-select other answers as free text", async () => {
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

    const app = render(<OnboardingScreen dir="/tmp/project" />);
    mocks.ui.selects.at(-1)?.onChange("Other (I'll explain)");
    await delay();

    expect(app.lastFrame()).toContain("Your answer:");
    mocks.ui.textInputs.at(-1)?.onSubmit("A guided setup surface");
    await delay();

    expect(mocks.sendInput).toHaveBeenCalledWith(expect.objectContaining({
      text: "A guided setup surface",
      mode: "single",
      freeText: "A guided setup surface",
    }));
  });

  it("submits multi-select skip and multi-select other answers correctly", async () => {
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

    let app = render(<OnboardingScreen dir="/tmp/project" />);
    mocks.ui.checklists.at(-1)?.onSubmit(["Skip"]);
    await delay();
    expect(mocks.sendInput).toHaveBeenCalledWith({
      text: "Skip",
      mode: "multi",
      selectedOptions: ["Skip"],
    });

    mocks.sendInput.mockReset();
    app.unmount();

    app = render(<OnboardingScreen dir="/tmp/project" />);
    mocks.ui.checklists.at(-1)?.onSubmit(["CI", "Other (I'll explain)"]);
    await delay();
    expect(app.lastFrame()).toContain("Selected options: CI");

    mocks.ui.textInputs.at(-1)?.onSubmit("Health checks");
    await delay();
    expect(mocks.sendInput).toHaveBeenCalledWith({
      text: "CI\n\nHealth checks",
      mode: "multi",
      selectedOptions: ["CI"],
      freeText: "Health checks",
    });
  });

  it("submits direct multi-select answers without dropping into free text", async () => {
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

    render(<OnboardingScreen dir="/tmp/project" />);
    mocks.ui.checklists.at(-1)?.onSubmit(["CI", "Preview"]);
    await delay();

    expect(mocks.sendInput).toHaveBeenCalledWith({
      text: "CI | Preview",
      mode: "multi",
      selectedOptions: ["CI", "Preview"],
    });
  });

  it("opens the runtime editor during a running onboarding session and applies runtime changes", async () => {
    mocks.start.mockImplementation(() => {
      Object.assign(mocks.onboardingState, {
        status: "running",
        streamingText: "Booting the onboarding session.",
      });
    });

    const app = render(<OnboardingScreen />);
    mocks.ui.textInputs.at(-1)?.onSubmit("/tmp/project");
    await delay();
    mocks.ui.runtimePanels.at(-1)?.onApply({
      workerProvider: "codex",
      responderProvider: "claude",
      workerExecutionMode: "accelerated",
      workerModel: "gpt-5.4",
      workerReasoningEffort: "high",
      responderModel: "claude-opus-4-6",
      responderReasoningEffort: "max",
      workerTuningMode: "manual",
      workerGovernanceMode: "guild-direct",
      verificationCadence: "proof-first",
      tokenEfficiencyMode: "balanced",
      responderApprovalMode: "manual",
    });
    await delay();
    await delay();
    expect(app.lastFrame()).toContain("Roscoe Onboarding");

    const panelsBeforeRetune = mocks.ui.runtimePanels.length;
    app.stdin.write("u");
    await delay();
    await delay();
    expect(mocks.ui.runtimePanels.length).toBeGreaterThan(panelsBeforeRetune);

    mocks.ui.runtimePanels.at(-1)?.onApply({
      workerProvider: "claude",
      responderProvider: "codex",
      workerExecutionMode: "safe",
      workerModel: "claude-opus-4-6",
      workerReasoningEffort: "max",
      responderModel: "gpt-5.4",
      responderReasoningEffort: "xhigh",
      workerTuningMode: "auto",
      workerGovernanceMode: "roscoe-arbiter",
      verificationCadence: "batched",
      tokenEfficiencyMode: "save-tokens",
      responderApprovalMode: "auto",
    });
    await delay();

    expect(mocks.updateRuntime).toHaveBeenCalled();
  });

  it("opens the runtime editor during interviewing and closes free-text mode with escape", async () => {
    mocks.start.mockImplementation(() => {
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
    });

    const app = render(<OnboardingScreen />);
    mocks.ui.textInputs.at(-1)?.onSubmit("/tmp/project");
    await delay();
    mocks.ui.runtimePanels.at(-1)?.onApply({
      workerProvider: "codex",
      responderProvider: "claude",
      workerExecutionMode: "accelerated",
      workerModel: "gpt-5.4",
      workerReasoningEffort: "high",
      responderModel: "claude-opus-4-6",
      responderReasoningEffort: "max",
      workerTuningMode: "manual",
      workerGovernanceMode: "guild-direct",
      verificationCadence: "proof-first",
      tokenEfficiencyMode: "balanced",
      responderApprovalMode: "manual",
    });
    await delay();
    await delay();
    expect(app.lastFrame()).toContain("Roscoe Intent Interview");

    app.stdin.write("u");
    await delay();
    await delay();
    expect(app.lastFrame()).toContain("RuntimeEditorPanel");

    app.stdin.write("\u001B");
    await waitFor(() => {
      expect(app.lastFrame()).not.toContain("RuntimeEditorPanel");
    });

    mocks.ui.selects.at(-1)?.onChange("Other (I'll explain)");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Your answer:");
    });

    app.stdin.write("\u001B");
    await waitFor(() => {
      expect(app.lastFrame()).not.toContain("Your answer:");
    });
    expect(app.lastFrame()).toContain("Which surface matters most?");
  });

  it("clears a pending directory confirmation when escape is pressed", async () => {
    mocks.resolveProjectRoot.mockImplementation((directory: string) => directory === "/tmp/project/cli" ? "/tmp/project" : directory);

    const app = render(<OnboardingScreen />);
    mocks.ui.textInputs.at(-1)?.onSubmit("/tmp/project/cli");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Repo root detected for this path:");
    });
    app.stdin.write("\u001B");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Project Directory");
      expect(app.lastFrame()).not.toContain("Repo root detected for this path:");
    });
  });

  it("ignores blank free-text and fallback submissions and allows clearing secret input before submit", async () => {
    Object.assign(mocks.onboardingState, {
      status: "interviewing",
      question: {
        text: "Which surface matters most?",
        options: ["Builder", "Embed"],
        selectionMode: "single",
      },
    });

    const app = render(<OnboardingScreen dir="/tmp/project" />);
    mocks.ui.selects.at(-1)?.onChange("Other (I'll explain)");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Your answer:");
    });
    mocks.ui.textInputs.at(-1)?.onSubmit("   ");
    await waitFor(() => {
      expect(mocks.sendInput).toHaveBeenCalledWith({
        text: "",
        mode: "single",
      });
    });
    mocks.sendInput.mockReset();

    Object.assign(mocks.onboardingState, {
      status: "interviewing",
      question: null,
      secretRequest: {
        key: "CF_API_TOKEN",
        label: "Cloudflare token",
        purpose: "Needed to provision previews.",
        instructions: [],
        links: [],
        required: false,
        targetFile: ".env.roscoe.local",
      },
    });
    await delay();

    app.stdin.write("abc");
    await delay();
    app.stdin.write("\u007f");
    await delay();
    app.stdin.write("\u0015");
    await delay();
    app.stdin.write("\r");
    await delay();
    expect(mocks.sendSecretInput).not.toHaveBeenCalled();

    Object.assign(mocks.onboardingState, {
      status: "interviewing",
      question: null,
      secretRequest: null,
    });
    mocks.sendInput.mockReset();
    app.unmount();

    const fallbackApp = render(<OnboardingScreen dir="/tmp/project" />);
    mocks.ui.textInputs.at(-1)?.onSubmit("   ");
    await delay();
    expect(mocks.sendInput).not.toHaveBeenCalled();
    fallbackApp.unmount();
  });

});
