import React from "react";
import { render } from "ink-testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectBriefView } from "./project-brief.js";
import type { ProjectContext, ProjectHistoryRecord } from "../config.js";

const mocks = vi.hoisted(() => ({
  selectOnChange: null as null | ((value: string) => void),
}));

vi.mock("@inkjs/ui", async () => {
  const ink = await vi.importActual<typeof import("ink")>("ink");
  return {
    Select: ({ options, onChange }: { options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) => {
      mocks.selectOnChange = onChange;
      return (
        <ink.Box flexDirection="column">
          {options.map((option) => (
            <ink.Text key={option.value}>{option.label}</ink.Text>
          ))}
        </ink.Box>
      );
    },
  };
});

function makeContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    name: "AppSicle",
    directory: "/tmp/appsicle",
    goals: ["Ship hosted preview"],
    milestones: [],
    techStack: ["React", "TypeScript"],
    notes: "fallback notes",
    runtimeDefaults: {
      guildProvider: "codex",
      responderProvider: "claude",
      responderApprovalMode: "manual",
      workerGovernanceMode: "guild-autonomous",
      verificationCadence: "prove-each-slice",
      tokenEfficiencyMode: "balanced",
      workerByProtocol: {
        codex: {
          model: "gpt-5.4",
          reasoningEffort: "high",
          executionMode: "accelerated",
          tuningMode: "manual",
        },
      },
      responderByProtocol: {
        claude: {
          model: "claude-opus-4-6",
          reasoningEffort: "medium",
          executionMode: "safe",
          tuningMode: "manual",
        },
      },
    },
    intentBrief: {
      projectStory: "A".repeat(220),
      primaryUsers: ["operators"],
      definitionOfDone: ["One", "Two", "Three"],
      acceptanceChecks: [],
      successSignals: [],
      entrySurfaceContract: {
        summary: "Root route should be truthful.",
        defaultRoute: "/",
        expectedExperience: "Explain preview status immediately.",
        allowedShellStates: ["loading"],
      },
      localRunContract: {
        summary: "Local dev mirrors hosted preview.",
        startCommand: "pnpm dev",
        firstRoute: "http://localhost:3000",
        prerequisites: ["Postgres", "Fly token"],
        seedRequirements: ["Seed demo tenant"],
        expectedBlockedStates: ["Preview image not built"],
        operatorSteps: ["Open / and verify truthful status"],
      },
      acceptanceLedgerMode: "inferred",
      acceptanceLedger: [
        {
          label: "Hosted preview live",
          status: "open",
          evidence: ["preview URL", "health endpoint"],
          notes: "still pending deploy",
        },
      ],
      deliveryPillars: {
        frontend: ["Truthful operator-facing route"],
        backend: ["Preview runner contract"],
        unitComponentTests: ["Adapter coverage"],
        e2eTests: ["Hosted proof"],
      },
      coverageMechanism: ["Vitest and targeted live checks"],
      deploymentContract: {
        artifactType: "web-app",
        mode: "planned-greenfield",
        summary: "Hosted proof remains required.",
        platforms: ["Fly.io", "GitHub Actions"],
        environments: ["preview", "production"],
        buildSteps: ["pnpm build"],
        deploySteps: ["fly deploy"],
        previewStrategy: ["Deploy preview first"],
        presenceStrategy: ["Keep stage.appsicle.ai truthful as slices land"],
        proofTargets: ["stage.appsicle.ai"],
        healthChecks: ["GET /health"],
        rollback: ["Redeploy last image"],
        requiredSecrets: ["FLY_API_TOKEN"],
      },
      nonGoals: [],
      constraints: ["Do not lie about preview state"],
      architecturePrinciples: ["Reuse K12 contract shapes"],
      autonomyRules: ["Continue when the next slice is obvious"],
      qualityBar: ["Do not call done without hosted proof"],
      riskBoundaries: ["Do not hide failed preview readiness"],
      uiDirection: "",
    },
    interviewAnswers: [
      { question: "Q1", answer: "Answer 1", theme: "one" },
      { question: "Q2", answer: "Answer 2", theme: "two" },
      { question: "Q3", answer: "Answer 3", theme: "three" },
      { question: "Q4", answer: "Answer 4", theme: "four" },
      { question: "Q5", answer: "Answer 5", theme: "five" },
    ],
    ...overrides,
  };
}

describe("ProjectBriefView", () => {
  beforeEach(() => {
    mocks.selectOnChange = null;
  });

  it("renders a compact summary, truncates long text, and dispatches actions", () => {
    const onAction = vi.fn();
    const app = render(
      <ProjectBriefView
        context={makeContext()}
        history={[]}
        actionItems={[{ label: "Continue", value: "continue" }]}
        onAction={onAction}
      />,
    );

    const frame = app.lastFrame();
    expect(frame).toContain("Project story");
    expect(frame).toContain("AAA");
    expect(frame).toContain("...");
    expect(frame).toContain("+1 more");
    expect(frame).toContain("legacy memory only");
    expect(frame).toContain("Guild codex");
    expect(frame).toContain("Roscoe claude");
    expect(frame).toContain("[manual]");
    expect(frame).toContain("accelerated");
    expect(frame).toContain("Guild direct");
    expect(frame).toContain("prove each slice");
    expect(frame).toContain("balanced");
    expect(frame).toContain("always ask");
    expect(frame).toContain("show full brief");
    expect(frame).toContain("Continue");

    mocks.selectOnChange?.("continue");
    expect(onAction).toHaveBeenCalledWith("continue");
  });

  it("expands into the full brief and shows inferred acceptance evidence with saved history", async () => {
    const history: ProjectHistoryRecord[] = [{
      id: "hist-1",
      mode: "refine",
      createdAt: "2026-03-30T12:34:56.000Z",
      directory: "/tmp/appsicle",
      projectName: "AppSicle",
      runtime: {
        profileName: "codex",
        protocol: "codex",
        summary: "runtime",
        settings: {},
      },
      rawTranscript: "raw",
      questions: [],
      answers: [],
      briefSnapshot: makeContext(),
    }];

    const app = render(
      <ProjectBriefView
        context={makeContext()}
        history={history}
        actionItems={[{ label: "Continue", value: "continue" }]}
        onAction={vi.fn()}
      />,
    );

    app.stdin.write("x");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const frame = app.lastFrame();
    expect(frame).toContain("show less");
    expect(frame).toContain("Coverage mechanism");
    expect(frame).toContain("Entry surface contract");
    expect(frame).toContain("+2 more");
    expect(frame).toContain("Local first-run contract");
    expect(frame).toContain("Start: pnpm dev");
    expect(frame).toContain("+5 more");
    expect(frame).toContain("Acceptance ledger (inferred)");
    expect(frame).toContain("[open] Hosted preview live -> preview URL, health endpoint (still pending deploy)");
    expect(frame).toContain("Deployment contract");
    expect(frame).toContain("Latest saved history: refine @ 2026-03-30 12:34:56");
    expect(frame).toContain("Interview trail");
    expect(frame).toContain("+1 earlier answers");
    expect(frame).toContain("Adjust later from any live Guild lane with");
  });

  it("falls back cleanly when runtime metadata and interview history are absent", () => {
    const app = render(
      <ProjectBriefView
        context={makeContext({
          runtimeDefaults: {},
          intentBrief: {
            ...makeContext().intentBrief!,
            projectStory: "",
            definitionOfDone: [],
            deliveryPillars: {
              frontend: [],
              backend: [],
              unitComponentTests: [],
              e2eTests: [],
            },
            entrySurfaceContract: undefined,
            localRunContract: undefined,
            acceptanceLedger: [],
            deploymentContract: undefined,
            coverageMechanism: [],
            constraints: [],
            architecturePrinciples: [],
            autonomyRules: [],
            qualityBar: [],
          },
          interviewAnswers: [],
          notes: "Fallback project story from notes",
        })}
        history={[]}
        actionItems={[{ label: "Continue", value: "continue" }]}
        onAction={vi.fn()}
      />,
    );

    const frame = app.lastFrame();
    expect(frame).toContain("Fallback project story from notes");
    expect(frame).not.toContain("Guild codex");
    expect(frame).not.toContain("Roscoe claude");
  });

  it("renders auto-managed runtime defaults and plural history counts", () => {
    const app = render(
      <ProjectBriefView
        context={makeContext({
          runtimeDefaults: {
            guildProvider: "codex",
            responderProvider: "claude",
            workerGovernanceMode: "guild-autonomous",
            verificationCadence: "batched",
            tokenEfficiencyMode: "save-tokens",
            workerByProtocol: {
              codex: {
                model: "gpt-5.4-mini",
                reasoningEffort: "medium",
                executionMode: "safe",
                tuningMode: "auto",
              },
            },
            responderByProtocol: {
              claude: {
                model: "claude-sonnet",
                reasoningEffort: "low",
                executionMode: "safe",
                tuningMode: "manual",
              },
            },
          },
        })}
        history={[
          {
            id: "hist-2",
            mode: "onboard",
            createdAt: "2026-03-30T12:34:56.000Z",
            directory: "/tmp/appsicle",
            projectName: "AppSicle",
            runtime: {
              profileName: "codex",
              protocol: "codex",
              summary: "runtime",
              settings: {},
            },
            rawTranscript: "raw",
            questions: [],
            answers: [],
            briefSnapshot: makeContext(),
          },
          {
            id: "hist-1",
            mode: "refine",
            createdAt: "2026-03-30T11:34:56.000Z",
            directory: "/tmp/appsicle",
            projectName: "AppSicle",
            runtime: {
              profileName: "claude",
              protocol: "claude",
              summary: "runtime",
              settings: {},
            },
            rawTranscript: "raw",
            questions: [],
            answers: [],
            briefSnapshot: makeContext(),
          },
        ]}
        actionItems={[{ label: "Continue", value: "continue" }]}
        onAction={vi.fn()}
      />,
    );

    const frame = app.lastFrame();
    expect(frame).toContain("2 history runs");
    expect(frame).toContain("auto-manage");
    expect(frame).toContain("batch proofs");
    expect(frame).toContain("save tokens");
    expect(frame).toContain("auto when confident");
  });

  it("uses goals as the last project-story fallback and shows sparse expanded sections cleanly", async () => {
    const app = render(
      <ProjectBriefView
        context={makeContext({
          goals: ["Ship the truthful hosted preview path"],
          notes: "",
          runtimeDefaults: {
            guildProvider: "codex",
            responderProvider: "claude",
            workerByProtocol: {
              codex: {
                model: "gpt-5.4",
                reasoningEffort: "high",
                executionMode: "accelerated",
                tuningMode: "manual",
              },
            },
            responderByProtocol: {
              claude: {
                model: "claude-opus",
                reasoningEffort: "medium",
                executionMode: "safe",
                tuningMode: "manual",
              },
            },
          },
          intentBrief: {
            ...makeContext().intentBrief!,
            projectStory: "",
            deliveryPillars: {
              frontend: [],
              backend: [],
              unitComponentTests: [],
              e2eTests: [],
            },
            coverageMechanism: [],
            entrySurfaceContract: undefined,
            localRunContract: undefined,
            acceptanceLedgerMode: "explicit",
            acceptanceLedger: [
              {
                label: "Operator can verify hosted preview",
                status: "open",
                evidence: [],
                notes: "",
              },
            ],
            deploymentContract: {
              ...makeContext().intentBrief!.deploymentContract!,
              summary: "",
              artifactType: "",
              platforms: [],
              environments: [],
              buildSteps: [],
              deploySteps: [],
              previewStrategy: [],
              healthChecks: [],
              rollback: [],
              requiredSecrets: [],
            },
            constraints: [],
            architecturePrinciples: [],
            autonomyRules: [],
            qualityBar: [],
          },
          interviewAnswers: [
            { question: "Q1", answer: "Short answer", theme: "" },
            { question: "Q2", answer: "Another short answer" },
          ],
        })}
        history={[]}
        actionItems={[{ label: "Continue", value: "continue" }]}
        onAction={vi.fn()}
      />,
    );

    app.stdin.write("x");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const frame = app.lastFrame();
    expect(frame).toContain("Ship the truthful hosted preview path");
    expect(frame).toContain("Acceptance ledger");
    expect(frame).toContain("[open] Operator can verify hosted preview");
    expect(frame).toContain("No raw onboarding/refine history has been saved for this project yet.");
    expect(frame).toContain("Q1: Short answer");
    expect(frame).toContain("Q2: Another short answer");
    expect(frame).not.toContain("+1 earlier answers");
    expect(frame).not.toContain("Coverage mechanism");
    expect(frame).not.toContain("Entry surface contract");
    expect(frame).not.toContain("Local first-run contract");
    expect(frame).not.toContain("Constraints");
    expect(frame).not.toContain("Architecture principles");
    expect(frame).not.toContain("Autonomy rules");
    expect(frame).not.toContain("Quality bar");
    expect(frame).not.toContain("Delivery pillars");
  });
});
