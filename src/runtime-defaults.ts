import { ProjectContext } from "./config.js";
import {
  detectProtocol,
  HeadlessProfile,
  LLMProtocol,
  RuntimeControlSettings,
  RuntimeTuningMode,
  summarizeRuntime,
} from "./llm-runtime.js";

export interface RuntimePlan {
  profile: HeadlessProfile;
  mode: RuntimeTuningMode;
  strategy: string;
  rationale: string;
  summary: string;
}

export function getRuntimeTuningMode(
  runtime: RuntimeControlSettings | null | undefined,
): RuntimeTuningMode {
  return runtime?.tuningMode === "manual" ? "manual" : "auto";
}

export function getTopModel(protocol: LLMProtocol): string {
  return protocol === "claude" ? "claude-opus-4-6" : "gpt-5.4";
}

export function getDefaultWorkerRuntime(protocol: LLMProtocol): RuntimeControlSettings {
  if (protocol === "claude") {
    return {
      executionMode: "safe",
      tuningMode: "auto",
      model: getTopModel("claude"),
      reasoningEffort: "high",
      permissionMode: "auto",
    };
  }

  return {
    executionMode: "safe",
    tuningMode: "auto",
    model: getTopModel("codex"),
    reasoningEffort: "xhigh",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
  };
}

export function getAcceleratedWorkerRuntime(protocol: LLMProtocol): RuntimeControlSettings {
  if (protocol === "claude") {
    return {
      executionMode: "accelerated",
      tuningMode: "auto",
      model: getTopModel("claude"),
      reasoningEffort: "high",
      dangerouslySkipPermissions: true,
    };
  }

  return {
    executionMode: "accelerated",
    tuningMode: "auto",
    model: getTopModel("codex"),
    reasoningEffort: "xhigh",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
  };
}

export function getDefaultOnboardingRuntime(protocol: LLMProtocol): RuntimeControlSettings {
  if (protocol === "claude") {
    return {
      executionMode: "safe",
      tuningMode: "auto",
      model: getTopModel("claude"),
      reasoningEffort: "max",
      permissionMode: "auto",
    };
  }

  return {
    executionMode: "safe",
    tuningMode: "auto",
    model: getTopModel("codex"),
    reasoningEffort: "xhigh",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
  };
}

export function mergeRuntimeSettings(
  ...settings: Array<RuntimeControlSettings | null | undefined>
): RuntimeControlSettings {
  const merged: RuntimeControlSettings = {};

  for (const setting of settings) {
    if (!setting) continue;
    for (const [key, value] of Object.entries(setting)) {
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }

  return merged;
}

export function applyRuntimeSettings(
  profile: HeadlessProfile,
  runtime: RuntimeControlSettings | null | undefined,
): HeadlessProfile {
  return {
    ...profile,
    runtime: mergeRuntimeSettings(profile.runtime, runtime),
  };
}

export function getProjectWorkerRuntime(
  context: ProjectContext | null,
  protocol: LLMProtocol,
): RuntimeControlSettings | null {
  return context?.runtimeDefaults?.workerByProtocol?.[protocol] ?? null;
}

export function getLockedProjectProvider(context: ProjectContext | null): LLMProtocol | null {
  if (context?.runtimeDefaults?.lockedProvider) {
    return context.runtimeDefaults.lockedProvider;
  }

  const onboardingProfile = context?.runtimeDefaults?.onboarding?.profileName?.toLowerCase();
  if (!onboardingProfile) return null;
  return onboardingProfile.includes("codex") ? "codex" : "claude";
}

export function getExecutionModeLabel(runtime: RuntimeControlSettings | null | undefined): string {
  return runtime?.executionMode === "accelerated" ? "accelerated" : "safe";
}

export function getWorkerProfileForProject(
  baseProfile: HeadlessProfile,
  context: ProjectContext | null,
  overrides?: RuntimeControlSettings | null,
): HeadlessProfile {
  const protocol = detectProtocol(baseProfile);
  const safeDefault = getDefaultWorkerRuntime(protocol);
  const projectDefault = getProjectWorkerRuntime(context, protocol);
  const executionRuntime = overrides?.executionMode === "accelerated"
    ? getAcceleratedWorkerRuntime(protocol)
    : projectDefault?.executionMode === "accelerated"
      ? getAcceleratedWorkerRuntime(protocol)
      : safeDefault;

  return applyRuntimeSettings(
    baseProfile,
    mergeRuntimeSettings(executionRuntime, projectDefault, overrides),
  );
}

function getDefaultEffort(protocol: LLMProtocol): string {
  return protocol === "claude" ? "high" : "xhigh";
}

function buildOnboardingRuntimePlan(
  baseProfile: HeadlessProfile,
): RuntimePlan {
  const protocol = detectProtocol(baseProfile);
  const tuningMode = getRuntimeTuningMode(baseProfile.runtime);
  const topModel = getTopModel(protocol);
  const configuredModel = baseProfile.runtime?.model || topModel;
  const configuredEffort = baseProfile.runtime?.reasoningEffort || (protocol === "claude" ? "max" : "xhigh");

  if (tuningMode === "manual") {
    const profile = applyRuntimeSettings(baseProfile, {
      tuningMode,
      model: configuredModel,
      reasoningEffort: configuredEffort,
    });

    return {
      profile,
      mode: tuningMode,
      strategy: "manual-pinned",
      rationale: "Pinned to the configured model and reasoning effort within the locked provider.",
      summary: summarizeRuntime(profile),
    };
  }

  const profile = applyRuntimeSettings(baseProfile, {
    tuningMode,
    model: topModel,
    reasoningEffort: protocol === "claude" ? "max" : "xhigh",
  });

  return {
    profile,
    mode: tuningMode,
    strategy: "auto-onboarding",
    rationale: "Roscoe keeps onboarding on the strongest in-provider model and high-depth reasoning while reading the repo and interviewing for intent.",
    summary: summarizeRuntime(profile),
  };
}

function buildRuntimePlan(
  baseProfile: HeadlessProfile,
  conversationContext: string,
  projectContext: ProjectContext | null,
): RuntimePlan {
  const protocol = detectProtocol(baseProfile);
  const tuningMode = getRuntimeTuningMode(baseProfile.runtime);
  const topModel = getTopModel(protocol);
  const configuredModel = baseProfile.runtime?.model || topModel;
  const configuredEffort = baseProfile.runtime?.reasoningEffort || getDefaultEffort(protocol);

  const text = [
    conversationContext,
    projectContext?.notes ?? "",
    ...(projectContext?.goals ?? []),
    ...(projectContext?.techStack ?? []),
  ].join(" ").toLowerCase();
  const taskText = conversationContext.toLowerCase();

  const frontendSurfaceHint = /(frontend|ui|ux|layout|css|tailwind|animation|typography|landing page|hero|component|ink|responsive|visual)/.test(taskText);
  const frontendTaskHint = /(polish|style|restyle|spacing|theme|copy|animate|motion|visual|typography|layout|responsive|refine|tweak|design)/.test(taskText);
  const frontendHint = frontendSurfaceHint && frontendTaskHint;
  const deepHint = /(security|audit|auth|payment|stripe|migration|database|sql|webhook|race|concurrency|failing test|incident|refactor|review)/.test(text);

  if (tuningMode === "manual") {
    const profile = applyRuntimeSettings(baseProfile, {
      tuningMode,
      model: configuredModel,
      reasoningEffort: configuredEffort,
    });

    return {
      profile,
      mode: tuningMode,
      strategy: "manual-pinned",
      rationale: "Pinned to the configured model and reasoning effort within the locked provider.",
      summary: summarizeRuntime(profile),
    };
  }

  const model = frontendHint ? configuredModel : topModel;
  const reasoningEffort = frontendHint
    ? "medium"
    : deepHint
      ? (protocol === "claude" ? "max" : "xhigh")
      : (protocol === "claude" ? "high" : "xhigh");

  const strategy = frontendHint ? "auto-frontend" : deepHint ? "auto-deep-analysis" : "auto-top-tier";
  const rationale = frontendHint
    ? "Lower reasoning keeps UI and iteration loops moving faster while staying inside the locked provider."
    : deepHint
      ? `High-complexity work benefits from maximum reasoning depth, so Roscoe steps up to ${topModel} when needed.`
      : "Defaulting to the strongest in-provider model and high reasoning for general coding work.";

  const profile = applyRuntimeSettings(baseProfile, {
    tuningMode,
    model,
    reasoningEffort,
  });

  return {
    profile,
    mode: tuningMode,
    strategy,
    rationale,
    summary: summarizeRuntime(profile),
  };
}

export function recommendResponderRuntime(
  baseProfile: HeadlessProfile,
  conversationContext: string,
  projectContext: ProjectContext | null,
): RuntimePlan {
  return buildRuntimePlan(baseProfile, conversationContext, projectContext);
}

export function recommendWorkerRuntime(
  baseProfile: HeadlessProfile,
  conversationContext: string,
  projectContext: ProjectContext | null,
): RuntimePlan {
  return buildRuntimePlan(baseProfile, conversationContext, projectContext);
}

export function recommendOnboardingRuntime(
  baseProfile: HeadlessProfile,
): RuntimePlan {
  return buildOnboardingRuntimePlan(baseProfile);
}
