import { detectProtocol, summarizeRuntime, } from "./llm-runtime.js";
export function getRuntimeTuningMode(runtime) {
    return runtime?.tuningMode === "manual" ? "manual" : "auto";
}
export function getTopModel(protocol) {
    return protocol === "claude" ? "claude-opus-4-6" : "gpt-5.4";
}
export function getDefaultWorkerRuntime(protocol) {
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
export function getAcceleratedWorkerRuntime(protocol) {
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
export function getDefaultOnboardingRuntime(protocol) {
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
export function mergeRuntimeSettings(...settings) {
    const merged = {};
    for (const setting of settings) {
        if (!setting)
            continue;
        for (const [key, value] of Object.entries(setting)) {
            if (value !== undefined) {
                merged[key] = value;
            }
        }
    }
    return merged;
}
export function applyRuntimeSettings(profile, runtime) {
    return {
        ...profile,
        runtime: mergeRuntimeSettings(profile.runtime, runtime),
    };
}
export function getProjectWorkerRuntime(context, protocol) {
    return context?.runtimeDefaults?.workerByProtocol?.[protocol] ?? null;
}
export function getLockedProjectProvider(context) {
    if (context?.runtimeDefaults?.lockedProvider) {
        return context.runtimeDefaults.lockedProvider;
    }
    const onboardingProfile = context?.runtimeDefaults?.onboarding?.profileName?.toLowerCase();
    if (!onboardingProfile)
        return null;
    return onboardingProfile.includes("codex") ? "codex" : "claude";
}
export function getExecutionModeLabel(runtime) {
    return runtime?.executionMode === "accelerated" ? "accelerated" : "safe";
}
export function getWorkerProfileForProject(baseProfile, context, overrides) {
    const protocol = detectProtocol(baseProfile);
    const safeDefault = getDefaultWorkerRuntime(protocol);
    const projectDefault = getProjectWorkerRuntime(context, protocol);
    const executionRuntime = overrides?.executionMode === "accelerated"
        ? getAcceleratedWorkerRuntime(protocol)
        : projectDefault?.executionMode === "accelerated"
            ? getAcceleratedWorkerRuntime(protocol)
            : safeDefault;
    return applyRuntimeSettings(baseProfile, mergeRuntimeSettings(executionRuntime, projectDefault, overrides));
}
function getDefaultEffort(protocol) {
    return protocol === "claude" ? "high" : "xhigh";
}
function buildOnboardingRuntimePlan(baseProfile) {
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
function buildRuntimePlan(baseProfile, conversationContext, projectContext) {
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
export function recommendResponderRuntime(baseProfile, conversationContext, projectContext) {
    return buildRuntimePlan(baseProfile, conversationContext, projectContext);
}
export function recommendWorkerRuntime(baseProfile, conversationContext, projectContext) {
    return buildRuntimePlan(baseProfile, conversationContext, projectContext);
}
export function recommendOnboardingRuntime(baseProfile) {
    return buildOnboardingRuntimePlan(baseProfile);
}
