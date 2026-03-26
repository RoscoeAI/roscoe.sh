import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select, TextInput, Spinner, StatusMessage } from "@inkjs/ui";
import { useAppContext } from "../app.js";
import { listProjectHistory, listRegisteredProjects, listProfiles, loadProfile, loadProjectContext } from "../config.js";
import { WorktreeManager } from "../worktree-manager.js";
import { basename } from "path";
import { homedir } from "os";
import { Divider, KeyHints, Panel, Pill } from "./chrome.js";
import { detectProtocol, summarizeRuntime } from "../llm-runtime.js";
import { getLockedProjectProvider, getWorkerProfileForProject } from "../runtime-defaults.js";
import { ProjectBriefView } from "./project-brief.js";

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
}

export function SessionSetup({ preselectedProjectDir }: SessionSetupProps) {
  const { dispatch, service } = useAppContext();

  const projects = listRegisteredProjects();
  const profiles = listProfiles();
  const initialProject = preselectedProjectDir
    ? {
        name: projects.find((project) => project.directory === preselectedProjectDir)?.name ?? basename(preselectedProjectDir),
        directory: preselectedProjectDir,
      }
    : null;
  const initialProjectContext = initialProject ? loadProjectContext(initialProject.directory) : null;

  const [step, setStep] = useState<Step>(initialProjectContext ? "brief" : initialProject ? "profile" : "project");
  const [selectedProject, setSelectedProject] = useState<{ name: string; directory: string } | null>(initialProject);
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [pendingSpecs, setPendingSpecs] = useState<PendingSpec[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [worktreeResetKey, setWorktreeResetKey] = useState(0);
  const latestPending = pendingSpecs[pendingSpecs.length - 1];
  const selectedProjectContext = selectedProject ? loadProjectContext(selectedProject.directory) : null;
  const selectedProjectHistory = useMemo(
    () => selectedProject ? listProjectHistory(selectedProject.directory) : [],
    [selectedProject],
  );
  const lockedProvider = getLockedProjectProvider(selectedProjectContext);
  const allowedProfiles = lockedProvider
    ? profiles.filter((profileName) => detectProtocol(loadProfile(profileName)) === lockedProvider)
    : profiles;

  const projectItems = [
    ...projects.map((p) => ({
      label: `${p.name}  ${shortenPath(p.directory)} · ${formatDate(p.lastActive)}`,
      value: p.directory,
    })),
    { label: `Current directory  ${shortenPath(process.cwd())}`, value: process.cwd() },
    { label: "Onboard another project  run Roscoe's intake first", value: ONBOARD_PROJECT_VALUE },
  ];

  const profileItems = allowedProfiles.map((p) => ({ label: p, value: p }));

  const addMoreItems = [
    { label: "Yes — add another session", value: "yes" },
    { label: "No — proceed to start", value: "no" },
  ];

  const autoModeItems = [
    { label: "Yes — auto-send high-confidence suggestions", value: "yes" },
    { label: "No — always ask for approval", value: "no" },
  ];

  const handleProjectSelect = (value: string) => {
    if (value === ONBOARD_PROJECT_VALUE) {
      dispatch({ type: "OPEN_ONBOARDING", request: { mode: "onboard" } });
      return;
    }

    const proj = projects.find((p) => p.directory === value);
    const nextProject = {
      name: proj?.name ?? basename(value),
      directory: value,
    };
    setSelectedProject(nextProject);
    setStep(loadProjectContext(nextProject.directory) ? "brief" : "profile");
  };

  const goBack = () => {
    setError(null);

    if (creatingWorktree) return;

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
      setStep("auto-mode");
    }
  };

  const handleAutoMode = (value: string) => {
    const autoEnabled = value === "yes";
    dispatch({ type: "SET_AUTO_MODE", enabled: autoEnabled });

    for (const spec of pendingSpecs) {
      const { managed, restoredState } = service.startSession(spec);
      dispatch({
        type: "ADD_SESSION",
        session: {
          id: managed.id,
          profileName: managed.profileName,
          projectName: managed.projectName,
          worktreeName: managed.worktreeName,
          status: "active",
          outputLines: restoredState?.outputLines ?? [],
          suggestion: { kind: "idle" },
          managed,
          summary: restoredState?.summary ?? null,
          currentToolUse: restoredState?.currentToolUse ?? null,
          timeline: restoredState?.timeline ?? [],
          viewMode: "transcript",
          scrollOffset: 0,
          followLive: true,
        },
      });
    }

    dispatch({ type: "SET_SCREEN", screen: "session-view" });
  };

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Panel
        title="Session Setup"
        subtitle="Assemble a working stack of monitored sessions"
        accentColor="yellow"
        rightLabel={`Step ${stepNumber[step]}/5`}
      >
        <Box gap={1} flexWrap="wrap">
          <Pill label={selectedProject?.name ?? "project"} color={selectedProject ? "cyan" : "gray"} />
          <Pill label={selectedProfile || "profile"} color={selectedProfile ? "cyan" : "gray"} />
          <Pill
            label={latestPending ? formatWorktreeLabel(latestPending.worktreeName) : "main or worktree"}
            color={latestPending ? (latestPending.worktreeName === "main" ? "gray" : "yellow") : "gray"}
          />
          <Pill label={pendingSpecs.length === 0 ? "0 configured" : `${pendingSpecs.length} configured`} color={pendingSpecs.length > 0 ? "green" : "gray"} />
        </Box>
        <Box marginTop={1}>
          <KeyHints
            items={[
              { keyLabel: "Enter", description: "confirm selection" },
              { keyLabel: "blank worktree", description: "use main repo" },
              { keyLabel: "Esc", description: step === "project" ? "back to dispatch board" : "back one step" },
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
          step === "profile" ? "Choose the LLM runtime for this session." :
          step === "worktree" ? "Name a task branch or stay on main." :
          step === "add-more" ? "Decide whether to add another lane." :
          "Choose how assertive the system should be."
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
              { label: "Continue to profile selection", value: "continue" },
              { label: "Refine Understanding", value: "refine" },
              { label: "Back", value: "back" },
            ]}
            onAction={(value) => {
              if (value === "continue") {
                setStep("profile");
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
            <Text color="yellow" bold>Select a profile:</Text>
            {selectedProject && (
              <>
                <Text dimColor>
                  Saved runtime defaults will be applied from onboarding when the session launches.
                </Text>
                {lockedProvider && (
                  <Text dimColor>
                    Provider is locked to <Text color="cyan">{lockedProvider}</Text> for this project. Guild lanes can still retune model and reasoning inside that provider.
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
            <Text color="yellow" bold>Add another session?</Text>
            <Select options={addMoreItems} onChange={handleAddMore} />
          </Box>
        )}

        {step === "auto-mode" && (
          <Box flexDirection="column">
            <Text color="yellow" bold>
              Enable auto-send for high-confidence suggestions?
            </Text>
            <Select options={autoModeItems} onChange={handleAutoMode} />
          </Box>
        )}
      </Panel>

      <Panel
        title="Launch Preview"
        subtitle="The stack that will be created when you continue"
        rightLabel={pendingSpecs.length === 0 ? "nothing queued" : `${pendingSpecs.length} queued`}
      >
        {pendingSpecs.length === 0 ? (
          <Text dimColor>No sessions configured yet.</Text>
        ) : (
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
        )}
      </Panel>
    </Box>
  );
}
