import {
  ProjectContext,
  ResponderApprovalMode,
  TokenEfficiencyMode,
  VerificationCadence,
  WorkerGovernanceMode,
} from "./config.js";
import {
  detectProtocol,
  getProviderAdapter,
  HeadlessProfile,
  LLMProtocol,
  RuntimeExecutionMode,
  RuntimeControlSettings,
  RuntimeTuningMode,
  summarizeRuntime,
  shouldPassExplicitModel,
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
  return getProviderAdapter(protocol).topModel;
}

export function getDefaultProfileName(protocol: LLMProtocol): string {
  return getProviderAdapter(protocol).defaultProfileName;
}

export function getDefaultWorkerRuntime(protocol: LLMProtocol): RuntimeControlSettings {
  return { ...getProviderAdapter(protocol).defaultWorkerRuntime };
}

export function getAcceleratedWorkerRuntime(protocol: LLMProtocol): RuntimeControlSettings {
  return { ...getProviderAdapter(protocol).acceleratedWorkerRuntime };
}

export function getRuntimeBaseForExecutionMode(
  protocol: LLMProtocol,
  executionMode: RuntimeExecutionMode,
): RuntimeControlSettings {
  return executionMode === "accelerated"
    ? getAcceleratedWorkerRuntime(protocol)
    : getDefaultWorkerRuntime(protocol);
}

export function buildConfiguredRuntime(
  protocol: LLMProtocol,
  executionMode: RuntimeExecutionMode,
  tuningMode: RuntimeTuningMode,
  model?: string,
  reasoningEffort?: string,
): RuntimeControlSettings {
  return mergeRuntimeSettings(
    getRuntimeBaseForExecutionMode(protocol, executionMode),
    { executionMode, tuningMode },
    model ? { model } : undefined,
    reasoningEffort ? { reasoningEffort } : undefined,
  );
}

export function getDefaultOnboardingRuntime(protocol: LLMProtocol): RuntimeControlSettings {
  return { ...getProviderAdapter(protocol).defaultOnboardingRuntime };
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

export function getProjectResponderRuntime(
  context: ProjectContext | null,
  protocol: LLMProtocol,
): RuntimeControlSettings | null {
  return context?.runtimeDefaults?.responderByProtocol?.[protocol] ?? null;
}

export function getGuildProvider(context: ProjectContext | null): LLMProtocol | null {
  if (context?.runtimeDefaults?.guildProvider) {
    return context.runtimeDefaults.guildProvider;
  }

  if (context?.runtimeDefaults?.lockedProvider) {
    return context.runtimeDefaults.lockedProvider;
  }

  const onboardingProfile = context?.runtimeDefaults?.onboarding?.profileName?.toLowerCase();
  if (!onboardingProfile) return null;
  return detectProtocol({
    name: onboardingProfile,
    command: onboardingProfile,
  });
}

export function getResponderProvider(context: ProjectContext | null): LLMProtocol | null {
  if (context?.runtimeDefaults?.responderProvider) {
    return context.runtimeDefaults.responderProvider;
  }

  return getGuildProvider(context);
}

export function getWorkerGovernanceMode(context: ProjectContext | null): WorkerGovernanceMode {
  return context?.runtimeDefaults?.workerGovernanceMode === "guild-autonomous"
    ? "guild-autonomous"
    : "roscoe-arbiter";
}

export function getResponderApprovalMode(context: ProjectContext | null): ResponderApprovalMode | null {
  return context?.runtimeDefaults?.responderApprovalMode === "manual"
    ? "manual"
    : context?.runtimeDefaults?.responderApprovalMode === "auto"
      ? "auto"
      : null;
}

export function getVerificationCadence(context: ProjectContext | null): VerificationCadence {
  return context?.runtimeDefaults?.verificationCadence === "prove-each-slice"
    ? "prove-each-slice"
    : "batched";
}

export function getTokenEfficiencyMode(context: ProjectContext | null): TokenEfficiencyMode {
  return context?.runtimeDefaults?.tokenEfficiencyMode === "balanced"
    ? "balanced"
    : "save-tokens";
}

export function formatWorkerGovernanceLabel(mode: WorkerGovernanceMode): string {
  return mode === "guild-autonomous" ? "Guild direct" : "Roscoe arbiter";
}

export function formatVerificationCadenceLabel(mode: VerificationCadence): string {
  return mode === "prove-each-slice" ? "prove each slice" : "batch proofs";
}

export function formatResponderApprovalLabel(mode: ResponderApprovalMode): string {
  return mode === "manual" ? "always ask" : "auto when confident";
}

export function formatTokenEfficiencyLabel(mode: TokenEfficiencyMode): string {
  return mode === "save-tokens" ? "save tokens" : "balanced";
}

export function describeWorkerGovernance(mode: WorkerGovernanceMode): string {
  return mode === "guild-autonomous"
    ? "Guild workers can act directly inside the brief and only check in with Roscoe on ambiguity, blockers, or explicit risk boundaries."
    : "Guild workers keep their configured access, but they stop at material changes so Roscoe can approve, reshape, or hold the next move.";
}

export function describeVerificationCadence(mode: VerificationCadence): string {
  return mode === "prove-each-slice"
    ? "Rerun the canonical repo-wide proof stack after each focused slice is ready to verify."
    : "Use narrow checks while editing, and save the heavy repo-wide proof stack for meaningful checkpoints, before handoff, or when a fresh global read is needed.";
}

export function getLockedProjectProvider(context: ProjectContext | null): LLMProtocol | null {
  return getGuildProvider(context);
}

export function getExecutionModeLabel(runtime: RuntimeControlSettings | null | undefined): string {
  return runtime?.executionMode === "accelerated"
    || runtime?.sandboxMode === "danger-full-access"
    || runtime?.dangerouslySkipPermissions
    || runtime?.bypassApprovalsAndSandbox
    ? "accelerated"
    : "safe";
}

export function getWorkerProfileForProject(
  baseProfile: HeadlessProfile,
  context: ProjectContext | null,
  overrides?: RuntimeControlSettings | null,
): HeadlessProfile {
  const protocol = detectProtocol(baseProfile);
  const safeDefault = getDefaultWorkerRuntime(protocol);
  const projectDefault = getProjectWorkerRuntime(context, protocol);
  const explicitExecutionMode = overrides?.executionMode ?? projectDefault?.executionMode ?? null;
  const executionRuntime = explicitExecutionMode === "safe"
    ? safeDefault
    : getAcceleratedWorkerRuntime(protocol);

  return applyRuntimeSettings(
    baseProfile,
    mergeRuntimeSettings(executionRuntime, projectDefault, overrides),
  );
}

export function getResponderProfileForProject(
  baseProfile: HeadlessProfile,
  context: ProjectContext | null,
): HeadlessProfile {
  const protocol = detectProtocol(baseProfile);
  const responderRuntime = getProjectResponderRuntime(context, protocol);
  return applyRuntimeSettings(baseProfile, responderRuntime);
}

function getDefaultEffort(protocol: LLMProtocol): string {
  return getProviderAdapter(protocol).defaultReasoningEffort;
}

function getPinnedModelOrUndefined(model: string | undefined): string | undefined {
  return shouldPassExplicitModel(model) ? model : undefined;
}

function buildOnboardingRuntimePlan(
  baseProfile: HeadlessProfile,
): RuntimePlan {
  const protocol = detectProtocol(baseProfile);
  const adapter = getProviderAdapter(protocol);
  const tuningMode = getRuntimeTuningMode(baseProfile.runtime);
  const topModel = getPinnedModelOrUndefined(adapter.topModel);
  const configuredModel = getPinnedModelOrUndefined(baseProfile.runtime?.model) ?? topModel;
  const configuredEffort = baseProfile.runtime?.reasoningEffort || adapter.onboardingReasoningEffort;

  if (tuningMode === "manual") {
    const profile = applyRuntimeSettings(baseProfile, {
      tuningMode,
      ...(configuredModel ? { model: configuredModel } : {}),
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
    ...(topModel ? { model: topModel } : {}),
    reasoningEffort: adapter.onboardingReasoningEffort,
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
  role: "guild" | "roscoe",
): RuntimePlan {
  const protocol = detectProtocol(baseProfile);
  const adapter = getProviderAdapter(protocol);
  const tuningMode = getRuntimeTuningMode(baseProfile.runtime);
  const topModel = getPinnedModelOrUndefined(adapter.topModel);
  const configuredModel = getPinnedModelOrUndefined(baseProfile.runtime?.model) ?? topModel;
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
      ...(configuredModel ? { model: configuredModel } : {}),
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
  const tokenEfficiencyMode = getTokenEfficiencyMode(projectContext);
  const responderEfficient = role === "roscoe" && tokenEfficiencyMode === "save-tokens";
  const reasoningEffort = frontendHint
    ? (responderEfficient ? adapter.efficientFrontendReasoningEffort : adapter.frontendReasoningEffort)
    : deepHint
      ? responderEfficient
        ? adapter.efficientDeepReasoningEffort
        : adapter.deepReasoningEffort
      : responderEfficient
        ? adapter.efficientGeneralReasoningEffort
        : adapter.generalReasoningEffort;

  const strategy = frontendHint
    ? responderEfficient ? "auto-efficient-frontend" : "auto-frontend"
    : deepHint
      ? responderEfficient ? "auto-efficient-analysis" : "auto-deep-analysis"
      : responderEfficient ? "auto-efficient-general" : "auto-top-tier";
  const rationale = frontendHint
    ? responderEfficient
      ? "Roscoe stays deliberately lighter on clear UI work to conserve tokens while keeping iteration tight."
      : "Lower reasoning keeps UI and iteration loops moving faster while staying inside the locked provider."
    : deepHint
      ? responderEfficient
        ? `Roscoe keeps reasoning high but not maximum to conserve tokens until the transcript proves extra depth is necessary.`
        : `High-complexity work benefits from maximum reasoning depth, so Roscoe steps up to ${topModel} when needed.`
      : responderEfficient
        ? "Roscoe keeps general coding replies lighter by default so the Guild can spend the heavier reasoning budget on execution."
        : "Defaulting to the strongest in-provider model and high reasoning for general coding work.";

  const profile = applyRuntimeSettings(baseProfile, {
    tuningMode,
    ...(model ? { model } : {}),
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
  return buildRuntimePlan(getResponderProfileForProject(baseProfile, projectContext), conversationContext, projectContext, "roscoe");
}

export function recommendWorkerRuntime(
  baseProfile: HeadlessProfile,
  conversationContext: string,
  projectContext: ProjectContext | null,
): RuntimePlan {
  return buildRuntimePlan(baseProfile, conversationContext, projectContext, "guild");
}

export function recommendOnboardingRuntime(
  baseProfile: HeadlessProfile,
): RuntimePlan {
  return buildOnboardingRuntimePlan(baseProfile);
}
