import { describe, expect, it } from "vitest";
import {
  applyRuntimeSettings,
  buildConfiguredRuntime,
  describeVerificationCadence,
  describeWorkerGovernance,
  formatResponderApprovalLabel,
  formatTokenEfficiencyLabel,
  formatWorkerGovernanceLabel,
  formatVerificationCadenceLabel,
  getAcceleratedWorkerRuntime,
  getDefaultProfileName,
  getDefaultOnboardingRuntime,
  getDefaultWorkerRuntime,
  getExecutionModeLabel,
  getGuildProvider,
  getLockedProjectProvider,
  getProjectResponderRuntime,
  getProjectWorkerRuntime,
  getResponderApprovalMode,
  getResponderProfileForProject,
  getResponderProvider,
  getRuntimeBaseForExecutionMode,
  getRuntimeTuningMode,
  getTopModel,
  getTokenEfficiencyMode,
  getVerificationCadence,
  getWorkerGovernanceMode,
  getWorkerProfileForProject,
  mergeRuntimeSettings,
  recommendOnboardingRuntime,
  recommendResponderRuntime,
  recommendWorkerRuntime,
} from "./runtime-defaults.js";
import { HeadlessProfile } from "./llm-runtime.js";

describe("runtime-defaults", () => {
  it("reads the explicit locked provider from project defaults", () => {
    expect(getLockedProjectProvider({
      name: "proj",
      directory: "/tmp/proj",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "",
      runtimeDefaults: {
        lockedProvider: "codex",
      },
    })).toBe("codex");
  });

  it("falls back through provider and governance helpers cleanly", () => {
    const context = {
      name: "proj",
      directory: "/tmp/proj",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "",
      runtimeDefaults: {
        guildProvider: "gemini",
        responderProvider: "claude",
        workerGovernanceMode: "guild-autonomous",
        responderApprovalMode: "manual",
        tokenEfficiencyMode: "balanced",
        onboarding: {
          profileName: "codex",
        },
        workerByProtocol: {
          codex: {
            executionMode: "accelerated",
            model: "gpt-5.4",
          },
        },
        responderByProtocol: {
          claude: {
            executionMode: "safe",
            model: "claude-opus-4-6",
          },
        },
      },
    } as const;

    expect(getGuildProvider(context as any)).toBe("gemini");
    expect(getResponderProvider(context as any)).toBe("claude");
    expect(getWorkerGovernanceMode(context as any)).toBe("guild-autonomous");
    expect(getResponderApprovalMode(context as any)).toBe("manual");
    expect(getTokenEfficiencyMode(context as any)).toBe("balanced");
    expect(getProjectWorkerRuntime(context as any, "codex")).toMatchObject({
      executionMode: "accelerated",
      model: "gpt-5.4",
    });
    expect(getProjectResponderRuntime(context as any, "claude")).toMatchObject({
      executionMode: "safe",
      model: "claude-opus-4-6",
    });
    expect(formatWorkerGovernanceLabel("guild-autonomous")).toBe("Guild direct");
    expect(formatResponderApprovalLabel("manual")).toBe("always ask");
    expect(formatTokenEfficiencyLabel("balanced")).toBe("balanced");
    expect(describeWorkerGovernance("guild-autonomous")).toContain("act directly");
    expect(describeVerificationCadence("prove-each-slice")).toContain("canonical repo-wide proof stack");
  });

  it("detects providers from onboarding profile names and defaults governance labels when unset", () => {
    const context = {
      name: "proj",
      directory: "/tmp/proj",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "",
      runtimeDefaults: {
        onboarding: {
          profileName: "gemini",
        },
      },
    } as const;

    expect(getGuildProvider(context as any)).toBe("gemini");
    expect(getResponderProvider(context as any)).toBe("gemini");
    expect(getWorkerGovernanceMode(null)).toBe("roscoe-arbiter");
    expect(getResponderApprovalMode(null)).toBeNull();
    expect(getTokenEfficiencyMode(null)).toBe("save-tokens");
    expect(formatWorkerGovernanceLabel("roscoe-arbiter")).toBe("Roscoe arbiter");
    expect(formatVerificationCadenceLabel("prove-each-slice")).toBe("prove each slice");
    expect(describeWorkerGovernance("roscoe-arbiter")).toContain("stop at material changes");
    expect(describeVerificationCadence("batched")).toContain("fresh global read");
  });

  it("merges configured runtimes without overwriting with undefined values", () => {
    expect(getRuntimeTuningMode(undefined)).toBe("auto");
    expect(getRuntimeTuningMode({ tuningMode: "manual" })).toBe("manual");
    expect(getRuntimeBaseForExecutionMode("codex", "accelerated")).toEqual(getAcceleratedWorkerRuntime("codex"));
    expect(getRuntimeBaseForExecutionMode("claude", "safe")).toEqual(getDefaultWorkerRuntime("claude"));

    const merged = mergeRuntimeSettings(
      { executionMode: "safe", model: "gpt-5.4", reasoningEffort: "medium" },
      undefined,
      { model: undefined, reasoningEffort: "high" },
      null,
    );
    expect(merged).toEqual({
      executionMode: "safe",
      model: "gpt-5.4",
      reasoningEffort: "high",
    });

    expect(buildConfiguredRuntime("codex", "safe", "auto")).toMatchObject({
      executionMode: "safe",
      tuningMode: "auto",
    });
    expect(buildConfiguredRuntime("codex", "accelerated", "manual", "gpt-5.5", "high")).toMatchObject({
      executionMode: "accelerated",
      tuningMode: "manual",
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
  });

  it("applies project worker and responder defaults to profiles", () => {
    const workerBase: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
      runtime: {
        executionMode: "safe",
        model: "gpt-5.4",
      },
    };
    const responderBase: HeadlessProfile = {
      name: "claude-code",
      command: "claude",
      args: [],
      protocol: "claude",
      runtime: {
        executionMode: "safe",
        model: "claude-opus-4-6",
      },
    };
    const context = {
      name: "proj",
      directory: "/tmp/proj",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "",
      runtimeDefaults: {
        workerByProtocol: {
          codex: {
            executionMode: "accelerated",
            reasoningEffort: "high",
          },
        },
        responderByProtocol: {
          claude: {
            reasoningEffort: "medium",
          },
        },
      },
    };

    expect(applyRuntimeSettings(workerBase, { reasoningEffort: "low" }).runtime).toMatchObject({
      executionMode: "safe",
      model: "gpt-5.4",
      reasoningEffort: "low",
    });
    expect(getWorkerProfileForProject(workerBase, context as any, null).runtime).toMatchObject({
      executionMode: "accelerated",
      reasoningEffort: "high",
    });
    expect(getWorkerProfileForProject(workerBase, context as any, { executionMode: "accelerated", model: "gpt-5.5" }).runtime).toMatchObject({
      executionMode: "accelerated",
      model: "gpt-5.5",
    });
    expect(getResponderProfileForProject(responderBase, context as any).runtime).toMatchObject({
      executionMode: "safe",
      model: "claude-opus-4-6",
      reasoningEffort: "medium",
    });
  });

  it("defaults autonomous worker profiles to accelerated unless the project explicitly pins safe mode", () => {
    const workerBase: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
      runtime: {
        model: "gpt-5.4",
      },
    };

    expect(getWorkerProfileForProject(workerBase, null, null).runtime).toMatchObject({
      executionMode: "accelerated",
      bypassApprovalsAndSandbox: true,
    });

    expect(getWorkerProfileForProject(workerBase, {
      name: "proj",
      directory: "/tmp/proj",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "",
      runtimeDefaults: {
        workerByProtocol: {
          codex: {
            executionMode: "safe",
            sandboxMode: "workspace-write",
            approvalPolicy: "never",
          },
        },
      },
    } as any, null).runtime).toMatchObject({
      executionMode: "safe",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    });
  });

  it("keeps manual runtime settings pinned", () => {
    const profile: HeadlessProfile = {
      name: "claude-code",
      command: "claude",
      args: [],
      protocol: "claude",
      runtime: {
        tuningMode: "manual",
        model: "claude-opus-4-6",
        reasoningEffort: "max",
      },
    };

    const plan = recommendResponderRuntime(profile, "Polish the frontend spacing and button hover states.", null);
    expect(plan.mode).toBe("manual");
    expect(plan.strategy).toBe("manual-pinned");
    expect(plan.profile.runtime?.reasoningEffort).toBe("max");
  });

  it("lowers reasoning for clear frontend work in auto mode", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
      runtime: {
        tuningMode: "auto",
        model: "gpt-5.4",
        reasoningEffort: "xhigh",
      },
    };

    const plan = recommendResponderRuntime(profile, "Tighten the Ink layout, typography, and colors for the dashboard UI.", null);
    expect(plan.mode).toBe("auto");
    expect(plan.strategy).toBe("auto-efficient-frontend");
    expect(plan.profile.runtime?.reasoningEffort).toBe("low");
  });

  it("keeps onboarding on top-tier reasoning in auto mode", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
      runtime: {
        tuningMode: "auto",
        model: "gpt-5.4",
        reasoningEffort: "low",
      },
    };

    const plan = recommendOnboardingRuntime(profile);
    expect(plan.strategy).toBe("auto-onboarding");
    expect(plan.profile.runtime?.reasoningEffort).toBe("xhigh");
  });

  it("does not persist the sentinel default model for Qwen or Kimi auto plans", () => {
    const qwenPlan = recommendWorkerRuntime({
      name: "qwen",
      command: "qwen",
      args: [],
      protocol: "qwen",
      runtime: {
        tuningMode: "auto",
        reasoningEffort: "high",
      },
    }, "Audit the production bug and ship the fix.", null);

    expect(qwenPlan.profile.runtime?.model).toBeUndefined();
    expect(qwenPlan.summary).toBe("qwen · high · sandbox");

    const kimiPlan = recommendOnboardingRuntime({
      name: "kimi",
      command: "kimi",
      args: [],
      protocol: "kimi",
      runtime: {
        tuningMode: "auto",
        reasoningEffort: "medium",
      },
    });

    expect(kimiPlan.profile.runtime?.model).toBeUndefined();
    expect(kimiPlan.summary).toBe("kimi · high · plan · thinking");
  });

  it("keeps onboarding pinned when manual tuning is set", () => {
    const profile: HeadlessProfile = {
      name: "gemini",
      command: "gemini",
      args: [],
      protocol: "gemini",
      runtime: {
        tuningMode: "manual",
        model: "gemini-3-pro",
        reasoningEffort: "medium",
      },
    };

    const plan = recommendOnboardingRuntime(profile);
    expect(plan.strategy).toBe("manual-pinned");
    expect(plan.profile.runtime).toMatchObject({
      tuningMode: "manual",
      model: "gemini-3-pro",
      reasoningEffort: "medium",
    });
    expect(getDefaultOnboardingRuntime("gemini")).toMatchObject({
      model: "gemini-3-flash-preview",
    });
  });

  it("does not downshift to frontend mode for generic repo UI mentions alone", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
      runtime: {
        tuningMode: "auto",
        model: "gpt-5.4",
        reasoningEffort: "xhigh",
      },
    };

    const plan = recommendResponderRuntime(profile, "Clarify the repo direction and definition of done.", {
      name: "proj",
      directory: "/tmp/proj",
      goals: ["Ship a strong UI"],
      milestones: [],
      techStack: ["Next.js", "React"],
      notes: "The repo has a frontend surface.",
    });
    expect(plan.strategy).toBe("auto-efficient-general");
    expect(plan.profile.runtime?.reasoningEffort).toBe("medium");
  });

  it("uses deep-analysis mode for substantive Guild work and top-tier mode for generic work", () => {
    const profile: HeadlessProfile = {
      name: "codex",
      command: "codex",
      args: [],
      protocol: "codex",
      runtime: {
        tuningMode: "auto",
        model: "gpt-5.4",
        reasoningEffort: "medium",
      },
    };
    const tokenSavingContext = {
      name: "proj",
      directory: "/tmp/proj",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "",
      runtimeDefaults: {
        tokenEfficiencyMode: "save-tokens",
      },
    };

    const workerPlan = recommendWorkerRuntime(
      profile,
      "Audit the Stripe webhook, auth flow, and database migration before shipping.",
      tokenSavingContext as any,
    );
    expect(workerPlan.strategy).toBe("auto-deep-analysis");

    const responderPlan = recommendResponderRuntime(
      profile,
      "Explain what should happen next in the repo.",
      null,
    );
    expect(responderPlan.strategy).toBe("auto-efficient-general");

    const topTierPlan = recommendResponderRuntime(
      profile,
      "Explain what should happen next in the repo.",
      {
        name: "proj",
        directory: "/tmp/proj",
        goals: [],
        milestones: [],
        techStack: [],
        notes: "",
        runtimeDefaults: {
          tokenEfficiencyMode: "balanced",
        },
      } as any,
    );
    expect(topTierPlan.strategy).toBe("auto-top-tier");
  });

  it("treats bypass and dangerous permission flags as accelerated execution", () => {
    expect(getExecutionModeLabel({ bypassApprovalsAndSandbox: true })).toBe("accelerated");
    expect(getExecutionModeLabel({ dangerouslySkipPermissions: true })).toBe("accelerated");
    expect(getExecutionModeLabel({ sandboxMode: "danger-full-access" })).toBe("accelerated");
    expect(getExecutionModeLabel({ executionMode: "safe" })).toBe("safe");
  });

  it("defaults verification cadence to batched and preserves explicit project settings", () => {
    expect(getVerificationCadence(null)).toBe("batched");
    expect(formatVerificationCadenceLabel("batched")).toBe("batch proofs");
    expect(getVerificationCadence({
      name: "proj",
      directory: "/tmp/proj",
      goals: [],
      milestones: [],
      techStack: [],
      notes: "",
      runtimeDefaults: {
        verificationCadence: "prove-each-slice",
      },
    })).toBe("prove-each-slice");
  });

  it("exposes adapter-driven Gemini defaults as a first-class contract", () => {
    expect(getDefaultProfileName("gemini")).toBe("gemini");
    expect(getTopModel("gemini")).toBe("gemini-3-flash-preview");
    expect(getDefaultWorkerRuntime("gemini")).toMatchObject({
      model: "gemini-3-flash-preview",
      reasoningEffort: "high",
      executionMode: "safe",
    });
  });
});
