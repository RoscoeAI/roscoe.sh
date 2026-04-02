import React, { useEffect, useMemo, useState } from "react";
import { existsSync } from "fs";
import { Box, Text, useInput } from "ink";
import { Select, TextInput, Spinner, StatusMessage } from "@inkjs/ui";
import { useAppContext } from "../app.js";
import {
  listLaneSessions,
  listProjectHistory,
  listRegisteredProjects,
  listProfiles,
  loadRoscoeSettings,
  loadProfile,
  loadProjectContext,
  ResponderApprovalMode,
  resolveProjectRoot,
} from "../config.js";
import { filterProfilesBySelectableProviders } from "../provider-registry.js";
import { WorktreeManager } from "../worktree-manager.js";
import { basename } from "path";
import { homedir } from "os";
import { Divider, KeyHints, Panel, Pill } from "./chrome.js";
import { detectProtocol, summarizeRuntime } from "../llm-runtime.js";
import {
  getExecutionModeLabel,
  formatResponderApprovalLabel,
  formatWorkerGovernanceLabel,
  formatTokenEfficiencyLabel,
  getGuildProvider,
  getResponderApprovalMode,
  getResponderProvider,
  getTokenEfficiencyMode,
  getWorkerGovernanceMode,
  getWorkerProfileForProject,
} from "../runtime-defaults.js";
import { ProjectBriefView } from "./project-brief.js";
import type { SessionStartOpts } from "../types.js";
import { getRestoredSuggestionPhase, sortTranscriptEntries } from "../session-transcript.js";
import { getPreviewState } from "../session-preview.js";

type Step = "project" | "brief" | "profile" | "worktree" | "add-more" | "auto-mode";
const ONBOARD_PROJECT_VALUE = "__onboard_project__";

const stepNumber: Record<Step, number> = {
  project: 1,
  brief: 2,
  profile: 3,
  worktree: 4,
  "add-more": 5,
  "auto-mode": 6,
};

const totalSetupSteps = Object.keys(stepNumber).length;

export function getPreviousSetupStep(step: Step): Step | "home" {
  if (step === "project") return "home";
  if (step === "brief") return "project";
  if (step === "profile") return "brief";
  if (step === "worktree") return "profile";
  if (step === "add-more") return "worktree";
  return "add-more";
}

interface PendingSpec {
  projectDir: string;
  projectName: string;
  profileName: string;
  worktreePath: string;
  worktreeName: string;
  runtimeSummary: string;
}

interface SessionSetupBootstrap {
  projects: ReturnType<typeof listRegisteredProjects>;
  roscoeSettings: ReturnType<typeof loadRoscoeSettings>;
  autoHealMetadata: boolean;
  allProfiles: ReturnType<typeof listProfiles>;
  profiles: string[];
  currentProjectDir: string;
  initialProject: { name: string; directory: string } | null;
  initialProjectContext: ReturnType<typeof loadProjectContext>;
}

function buildSessionSetupBootstrap(preselectedProjectDir?: string): SessionSetupBootstrap {
  const projects = listRegisteredProjects();
  const roscoeSettings = loadRoscoeSettings();
  const autoHealMetadata = roscoeSettings.behavior.autoHealMetadata;
  const allProfiles = listProfiles();
  const configuredProfiles = filterProfilesBySelectableProviders(allProfiles, roscoeSettings);
  const profiles = configuredProfiles.length > 0 ? configuredProfiles : allProfiles;
  const currentProjectDir = resolveProjectRoot(process.cwd());
  const initialProjectDir = preselectedProjectDir ? resolveProjectRoot(preselectedProjectDir) : null;
  const initialProject = initialProjectDir
    ? {
        name: projects.find((project) => project.directory === initialProjectDir)?.name ?? basename(initialProjectDir),
        directory: initialProjectDir,
      }
    : null;
  const initialProjectContext = initialProject ? loadProjectContext(initialProject.directory) : null;

  return {
    projects,
    roscoeSettings,
    autoHealMetadata,
    allProfiles,
    profiles,
    currentProjectDir,
    initialProject,
    initialProjectContext,
  };
}

function formatWorktreeLabel(name: string): string {
  return name === "main" ? "main repo" : `worktree - ${name}`;
}

function shortenPath(p: string): string {
  const home = homedir();
  if (p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface SessionSetupProps {
  preselectedProjectDir?: string;
  openedFromSessionView?: boolean;
}

export function SessionSetup({ preselectedProjectDir, openedFromSessionView = false }: SessionSetupProps) {
  const { dispatch, service, state } = useAppContext();

  const bootstrap = useMemo(() => buildSessionSetupBootstrap(preselectedProjectDir), [preselectedProjectDir]);
  const [step, setStep] = useState<Step>(() =>
    bootstrap.initialProjectContext ? "brief" : bootstrap.initialProject ? "profile" : "project",
  );
  const [selectedProject, setSelectedProject] = useState<{ name: string; directory: string } | null>(
    () => bootstrap.initialProject,
  );
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [pendingSpecs, setPendingSpecs] = useState<PendingSpec[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [worktreeResetKey, setWorktreeResetKey] = useState(0);

  useEffect(() => {
    setSelectedProject(bootstrap.initialProject);
    setStep(bootstrap.initialProjectContext ? "brief" : bootstrap.initialProject ? "profile" : "project");
    setSelectedProfile("");
    setPendingSpecs([]);
    setError(null);
    setCreatingWorktree(false);
    setWorktreeResetKey(0);
  }, [bootstrap]);

  const {
    projects,
    roscoeSettings,
    autoHealMetadata,
    allProfiles,
    profiles,
    currentProjectDir,
  } = bootstrap;
  const latestPending = pendingSpecs[pendingSpecs.length - 1];
  const selectedProjectContext = selectedProject ? loadProjectContext(selectedProject.directory) : null;
  const selectedProjectLabel = selectedProject?.name ?? "this project";
  const selectedProjectHistory = useMemo(
    () => selectedProject ? listProjectHistory(selectedProject.directory) : [],
    [selectedProject],
  );
  const resumableLane = useMemo(() => {
    if (!selectedProject) return null;

    const lanes = Array.from(
      listLaneSessions(selectedProject.directory)
        .filter((record) => !autoHealMetadata || record.status !== "exited")
        .filter((record) => record.worktreeName === "main" || existsSync(record.worktreePath))
        .reduce((byWorktree, record) => {
          const worktreeIdentity = [
            record.projectDir,
            record.worktreePath,
            record.worktreeName,
          ].join("::");
          const existing = byWorktree.get(worktreeIdentity);
          const recordSavedAt = record.savedAt ?? "";
          const existingSavedAt = existing?.savedAt ?? "";
          const selectedProfileMatch = selectedProfile.length > 0 && record.profileName === selectedProfile;
          const existingSelectedProfileMatch = Boolean(
            selectedProfile.length > 0 && existing?.profileName === selectedProfile,
          );
          if (
            !existing
            || (selectedProfileMatch && !existingSelectedProfileMatch)
            || (selectedProfileMatch === existingSelectedProfileMatch && recordSavedAt > existingSavedAt)
          ) {
            byWorktree.set(worktreeIdentity, record);
          }
          return byWorktree;
        }, new Map<string, ReturnType<typeof listLaneSessions>[number]>())
        .values(),
    );

    return lanes.length === 1 ? lanes[0] : null;
  }, [autoHealMetadata, selectedProject, selectedProfile]);
  const guildProvider = getGuildProvider(selectedProjectContext);
  const responderProvider = getResponderProvider(selectedProjectContext);
  const savedGuildRuntime = guildProvider
    ? selectedProjectContext?.runtimeDefaults?.workerByProtocol?.[guildProvider]
    : null;
  const selectedProjectResponderApprovalMode = selectedProjectContext
    ? getResponderApprovalMode(selectedProjectContext)
    : null;
  const allowedProfiles = guildProvider
    ? filterProfilesBySelectableProviders(allProfiles, roscoeSettings, [guildProvider])
        .filter((profileName) => detectProtocol(loadProfile(profileName)) === guildProvider)
    : profiles;
  const briefContinueLabel = resumableLane
    ? `Continue with saved lane in ${selectedProjectLabel}`
    : allowedProfiles.length === 1
      ? openedFromSessionView
        ? `Continue with new lane in ${selectedProjectLabel}`
        : `Continue in ${selectedProjectLabel}`
      : `Continue to runtime selection for ${selectedProjectLabel}`;

  const projectItems = [
    ...projects.map((p) => ({
      label: `${p.name}  ${shortenPath(p.directory)} · ${formatDate(p.lastActive)}`,
      value: p.directory,
    })),
    {
      label: `${currentProjectDir === process.cwd() ? "Current directory" : "Current repo root"}  ${shortenPath(currentProjectDir)}`,
      value: currentProjectDir,
    },
    { label: "Onboard another project  run Roscoe's intake first", value: ONBOARD_PROJECT_VALUE },
  ];

  const profileItems = allowedProfiles.map((p) => ({ label: p, value: p }));

  const addMoreItems = [
    { label: "No — start these lanes", value: "no" },
    { label: "Yes — add another lane", value: "yes" },
  ];

  const autoModeItems = [
    { label: "Roscoe decides for me when confidence is high", value: "yes" },
    { label: "Roscoe always asks me before replying", value: "no" },
  ];

  const getQueuedSavedApprovalMode = (): ResponderApprovalMode | null => {
    if (pendingSpecs.length === 0) return null;
    const modes = pendingSpecs.map((spec) => getResponderApprovalMode(loadProjectContext(spec.projectDir)));
    if (modes.some((mode) => mode === null)) return null;
    return modes.every((mode) => mode === modes[0]) ? modes[0] : null;
  };

  const applyApprovalModeAndLaunch = (mode: ResponderApprovalMode | null, specs: SessionStartOpts[]) => {
    if (mode === "auto" || mode === "manual") {
      dispatch({ type: "SET_AUTO_MODE", enabled: mode === "auto" });
    } else if (!state.autoModeConfigured) {
      dispatch({ type: "SET_AUTO_MODE", enabled: true });
    }
    launchSessions(specs);
  };

  const handleProjectSelect = (value: string) => {
    if (value === ONBOARD_PROJECT_VALUE) {
      dispatch({ type: "OPEN_ONBOARDING", request: { mode: "onboard" } });
      return;
    }

    const projectDir = resolveProjectRoot(value);
    const proj = projects.find((p) => p.directory === projectDir);
    const nextProject = {
      name: proj?.name ?? basename(projectDir),
      directory: projectDir,
    };
    setSelectedProject(nextProject);
    setStep(loadProjectContext(nextProject.directory) ? "brief" : "profile");
  };

  const goBack = () => {
    setError(null);

    if (creatingWorktree) return;

    if (step === "project" && pendingSpecs.length > 0) {
      const lastQueuedSpec = pendingSpecs[pendingSpecs.length - 1];
      if (lastQueuedSpec) {
        setSelectedProject({
          name: lastQueuedSpec.projectName,
          directory: lastQueuedSpec.projectDir,
        });
        setSelectedProfile(lastQueuedSpec.profileName);
      }
      setStep("add-more");
      return;
    }

    const previousStep = getPreviousSetupStep(step);

    if (previousStep === "home") {
      dispatch({ type: "GO_BACK" });
      return;
    }

    if (previousStep === "project") {
      setSelectedProject(null);
      setSelectedProfile("");
      setStep(previousStep);
      return;
    }

    if (previousStep === "brief") {
      setStep(previousStep);
      return;
    }

    if (previousStep === "profile") {
      setStep(previousStep);
      return;
    }

    if (previousStep === "worktree") {
      if (latestPending) {
        setSelectedProject({
          name: latestPending.projectName,
          directory: latestPending.projectDir,
        });
        setSelectedProfile(latestPending.profileName);
      }
      setPendingSpecs((prev) => prev.slice(0, -1));
      setStep(previousStep);
      return;
    }

    setStep(previousStep);
  };

  useInput((_input, key) => {
    if (key.escape) {
      goBack();
    }
  });

  const handleProfileSelect = (value: string) => {
    setSelectedProfile(value);
    setStep("worktree");
  };

  const handleWorktreeSubmit = async (value: string) => {
    const taskName = value.trim();
    const projDir = selectedProject!.directory;
    const projectContext = loadProjectContext(projDir);
    const baseProfile = loadProfile(selectedProfile);
    const resolvedProfile = getWorkerProfileForProject(baseProfile, projectContext);
    const runtimeSummary = summarizeRuntime(resolvedProfile);

    if (taskName) {
      setCreatingWorktree(true);
      try {
        const wm = new WorktreeManager(projDir);
        const wt = await wm.create(taskName);
        setPendingSpecs((prev) => [
          ...prev,
          {
            profileName: selectedProfile,
            projectDir: projDir,
            projectName: selectedProject!.name,
            worktreePath: wt.path,
            worktreeName: taskName,
            runtimeSummary,
          },
        ]);
      } catch (err) {
        setError(`Failed to create worktree: ${err instanceof Error ? err.message : err}`);
      }
      setCreatingWorktree(false);
    } else {
      setPendingSpecs((prev) => [
        ...prev,
        {
          profileName: selectedProfile,
          projectDir: projDir,
          projectName: selectedProject!.name,
          worktreePath: projDir,
          worktreeName: "main",
          runtimeSummary,
        },
      ]);
    }

    setWorktreeResetKey((k) => k + 1);
    setStep("add-more");
  };

  const handleAddMore = (value: string) => {
    if (value === "yes") {
      setSelectedProject(null);
      setSelectedProfile("");
      setStep("project");
    } else {
      const savedApprovalMode = getQueuedSavedApprovalMode();
      if (savedApprovalMode) {
        applyApprovalModeAndLaunch(savedApprovalMode, pendingSpecs.map(({ profileName, projectDir, projectName, worktreePath, worktreeName }) => ({
          profileName,
          projectDir,
          projectName,
          worktreePath,
          worktreeName,
        })));
        return;
      }
      setStep("auto-mode");
    }
  };

  const launchSessions = (specs: SessionStartOpts[]) => {
    let lastStartedId: string | null = null;
    for (const spec of specs) {
      const { managed, restoredState } = service.startSession(spec);
      lastStartedId = managed.id;
      const restoredSuggestion = getRestoredSuggestionPhase(restoredState?.timeline ?? []);
      const restoredStatus = restoredState?.status === "review" && restoredSuggestion.kind !== "ready"
        ? "waiting"
        : restoredState?.status
        ?? (restoredSuggestion.kind === "ready" ? "review" : "active");
      dispatch({
        type: "ADD_SESSION",
        session: {
          id: managed.id,
          profileName: managed.profileName,
          projectName: managed.projectName,
          worktreeName: managed.worktreeName,
          startedAt: restoredState?.startedAt && restoredState.startedAt !== new Date(0).toISOString()
            ? restoredState.startedAt
            : new Date().toISOString(),
          status: restoredStatus,
          outputLines: restoredState?.outputLines ?? [],
          suggestion: restoredSuggestion,
          managed,
          summary: restoredState?.summary ?? null,
          currentToolUse: restoredState?.currentToolUse ?? null,
          currentToolDetail: restoredState?.currentToolDetail ?? null,
          usage: restoredState?.usage ?? {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
          rateLimitStatus: restoredState?.rateLimitStatus ?? null,
          timeline: sortTranscriptEntries(restoredState?.timeline ?? []),
          preview: getPreviewState(restoredState?.preview),
          pendingOperatorMessages: restoredState?.pendingOperatorMessages ?? [],
          viewMode: "transcript",
          scrollOffset: 0,
          followLive: true,
        },
      });
    }

    if (lastStartedId) {
      dispatch({ type: "SET_ACTIVE", id: lastStartedId });
    }
    dispatch({ type: "SET_SCREEN", screen: "session-view" });
  };

  const handleAutoMode = (value: string) => {
    const autoEnabled = value === "yes";
    applyApprovalModeAndLaunch(autoEnabled ? "auto" : "manual", pendingSpecs.map(({ profileName, projectDir, projectName, worktreePath, worktreeName }) => ({
      profileName,
      projectDir,
      projectName,
      worktreePath,
      worktreeName,
    })));
  };

  const handleBriefContinue = () => {
    if (resumableLane && selectedProject) {
      applyApprovalModeAndLaunch(selectedProjectResponderApprovalMode, [{
        profileName: resumableLane.profileName,
        projectDir: selectedProject.directory,
        projectName: selectedProject.name,
        worktreePath: resumableLane.worktreePath,
        worktreeName: resumableLane.worktreeName,
      }]);
      return;
    }

    if (allowedProfiles.length === 1) {
      setSelectedProfile(allowedProfiles[0]);
      setStep("worktree");
      return;
    }

    setStep("profile");
  };

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Panel
        title="Lane Setup"
        subtitle="Assemble a working stack of monitored lanes"
        accentColor="yellow"
        rightLabel={`Step ${stepNumber[step]}/${totalSetupSteps}`}
      >
        <Box gap={1} flexWrap="wrap">
          <Pill label={selectedProject?.name ?? "project"} color={selectedProject ? "cyan" : "gray"} />
          <Pill label={selectedProfile || "runtime"} color={selectedProfile ? "cyan" : "gray"} />
          <Pill
            label={latestPending ? formatWorktreeLabel(latestPending.worktreeName) : "main or worktree"}
            color={latestPending ? (latestPending.worktreeName === "main" ? "gray" : "yellow") : "gray"}
          />
          <Pill
            label={
              pendingSpecs.length === 0
                ? "0 lanes"
                : `${pendingSpecs.length} lane${pendingSpecs.length === 1 ? "" : "s"}`
            }
            color={pendingSpecs.length > 0 ? "green" : "gray"}
          />
        </Box>
        <Box marginTop={1}>
          <KeyHints
            items={[
              { keyLabel: "Enter", description: "confirm selection" },
              { keyLabel: "blank worktree", description: "use main repo" },
              {
                keyLabel: "Esc",
                description: step === "project" && pendingSpecs.length === 0
                  ? "back to dispatch board"
                  : "back one step",
              },
            ]}
          />
        </Box>
      </Panel>

      {error && (
        <Box>
          <StatusMessage variant="error">{error}</StatusMessage>
        </Box>
      )}

      <Panel
        title="Current Step"
        subtitle={
          step === "project" ? "Pick a remembered repo, use the current directory, or onboard a new one." :
          step === "brief" ? "Review the saved Roscoe understanding before you continue." :
          step === "profile" ? "Choose the Guild runtime CLI for this lane." :
          step === "worktree" ? "Name a task branch or stay on main." :
          step === "add-more" ? "Decide whether to add another lane." :
          "Choose how Roscoe should interact with you for this launch."
        }
        accentColor={step === "auto-mode" ? "green" : "gray"}
      >
        {step === "project" && (
          <Box flexDirection="column">
            <Text color="yellow" bold>Choose or onboard a project:</Text>
            <Select options={projectItems} onChange={handleProjectSelect} />
          </Box>
        )}

        {step === "brief" && selectedProjectContext && selectedProject && (
            <ProjectBriefView
            context={selectedProjectContext}
            history={selectedProjectHistory}
            actionItems={[
              { label: briefContinueLabel, value: "continue" },
              { label: "Refine Understanding", value: "refine" },
              { label: "Back", value: "back" },
            ]}
            onAction={(value) => {
              if (value === "continue") {
                handleBriefContinue();
                return;
              }
              if (value === "refine") {
                dispatch({
                  type: "OPEN_ONBOARDING",
                  request: {
                    dir: selectedProject.directory,
                    initialProfileName: selectedProjectContext.runtimeDefaults?.onboarding?.profileName,
                    initialRuntimeOverrides: selectedProjectContext.runtimeDefaults?.onboarding?.runtime,
                    mode: "refine",
                  },
                });
                return;
              }
              setStep("project");
            }}
            title="Project Brief"
            subtitle="Review Roscoe's saved understanding before launching Guild lanes"
          />
        )}

        {step === "profile" && (
          <Box flexDirection="column">
            <Text color="yellow" bold>Select a runtime:</Text>
            {selectedProject && (
              <>
                <Text dimColor>
                  This chooses the Guild worker CLI/provider, not the model ID. Saved model and reasoning defaults will still be applied when the lane launches.
                </Text>
                {guildProvider && (
                  <Text dimColor>
                    Guild lanes launch on <Text color="cyan">{guildProvider}</Text>{responderProvider ? <> while Roscoe drafts on <Text color="magenta">{responderProvider}</Text></> : null}. Guild lanes can still retune model and reasoning inside their provider.
                  </Text>
                )}
                {selectedProjectContext && (
                  <Text dimColor>
                    {savedGuildRuntime ? (
                      <>
                        Saved access: <Text color="cyan">{getExecutionModeLabel(savedGuildRuntime)}</Text> ·{" "}
                      </>
                    ) : "Saved controls: "}
                    <Text color="cyan">{formatWorkerGovernanceLabel(getWorkerGovernanceMode(selectedProjectContext))}</Text> ·{" "}
                    <Text color="cyan">{formatTokenEfficiencyLabel(getTokenEfficiencyMode(selectedProjectContext))}</Text> ·{" "}
                    <Text color="cyan">{formatResponderApprovalLabel(getResponderApprovalMode(selectedProjectContext) ?? "auto")}</Text>
                  </Text>
                )}
              </>
            )}
            <Select options={profileItems} onChange={handleProfileSelect} />
          </Box>
        )}

        {step === "worktree" && (
          <Box flexDirection="column">
            <Text color="yellow" bold>
              Worktree task name (leave empty for main repo):
            </Text>
            {creatingWorktree ? (
              <Spinner label="Creating worktree..." />
            ) : (
              <Box marginTop={1}>
                <Text color="yellow">&gt; </Text>
                <TextInput
                  key={worktreeResetKey}
                  placeholder="task-name"
                  onSubmit={handleWorktreeSubmit}
                />
              </Box>
            )}
          </Box>
        )}

        {step === "add-more" && (
          <Box flexDirection="column">
            <Text color="yellow" bold>Add another lane?</Text>
            <Select options={addMoreItems} onChange={handleAddMore} />
          </Box>
        )}

        {step === "auto-mode" && (
          <Box flexDirection="column">
            <Text color="yellow" bold>
              How should Roscoe handle high-confidence replies?
            </Text>
            <Select options={autoModeItems} onChange={handleAutoMode} />
          </Box>
        )}
      </Panel>

      {pendingSpecs.length > 0 && step !== "add-more" && (
        <Panel
          title="Lane Preview"
          subtitle="The lane stack that will be created when you continue"
          rightLabel={`${pendingSpecs.length} queued`}
        >
          <Box flexDirection="column">
            {pendingSpecs.map((spec, index) => (
              <Box key={`${spec.projectDir}-${spec.profileName}-${spec.worktreeName}`} flexDirection="column">
                {index > 0 && <Divider />}
                <Box justifyContent="space-between">
                  <Box gap={1}>
                    <Text color="cyan" bold>{spec.projectName}</Text>
                    <Text dimColor>{spec.profileName}</Text>
                  </Box>
                  <Pill label={formatWorktreeLabel(spec.worktreeName)} color={spec.worktreeName === "main" ? "gray" : "yellow"} />
                </Box>
                <Text dimColor>{spec.runtimeSummary}</Text>
                <Text dimColor>{shortenPath(spec.worktreePath)}</Text>
              </Box>
            ))}
          </Box>
        </Panel>
      )}
    </Box>
  );
}
