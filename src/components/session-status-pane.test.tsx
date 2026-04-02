import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { SessionStatusPane } from "./session-status-pane.js";
import { SessionState } from "../types.js";
import { ProjectContext } from "../config.js";

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "s1",
    profileName: "codex",
    projectName: "proj",
    worktreeName: "main",
    startedAt: "2026-03-26T20:00:00.000Z",
    status: "active",
    outputLines: [],
    suggestion: { kind: "idle" },
    managed: {
      profile: {
        protocol: "codex",
        runtime: {
          model: "gpt-5.4",
          reasoningEffort: "medium",
          bypassApprovalsAndSandbox: true,
        },
      },
      awaitingInput: false,
      lastWorkerRuntimeSummary: "codex · gpt-5.4 · medium · bypass",
      lastResponderRuntimeSummary: "codex · gpt-5.4 · high · bypass",
    } as any,
    summary: null,
    currentToolUse: "command_execution",
    usage: {
      inputTokens: 17384,
      outputTokens: 26,
      cachedInputTokens: 5504,
      cacheCreationInputTokens: 0,
    },
    rateLimitStatus: null,
    timeline: [
      { id: "r1", kind: "remote-turn", timestamp: 1, provider: "codex", text: "One" },
      { id: "l1", kind: "local-sent", timestamp: 2, text: "Two", delivery: "auto" },
    ],
    viewMode: "transcript",
    scrollOffset: 0,
    followLive: true,
    ...overrides,
  };
}

function makeProjectContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    name: "proj",
    directory: "/tmp/proj",
    goals: [],
    milestones: [],
    techStack: [],
    notes: "",
    interviewAnswers: [],
    intentBrief: {
      projectStory: "",
      primaryUsers: [],
      definitionOfDone: [],
      acceptanceChecks: [],
      successSignals: [],
      deliveryPillars: {
        frontend: [],
        backend: [],
        unitComponentTests: [],
        e2eTests: [],
      },
      coverageMechanism: [],
      nonGoals: [],
      constraints: [],
      autonomyRules: [],
      qualityBar: [],
      riskBoundaries: [],
      uiDirection: "",
    },
    runtimeDefaults: {
      guildProvider: "codex",
      responderProvider: "codex",
      workerByProtocol: {
        codex: {
          executionMode: "safe",
          tuningMode: "auto",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
        },
      },
      responderByProtocol: {
        codex: {
          executionMode: "safe",
          tuningMode: "manual",
          model: "gpt-5.4",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
        },
      },
      workerGovernanceMode: "roscoe-arbiter",
      verificationCadence: "batched",
      tokenEfficiencyMode: "save-tokens",
      responderApprovalMode: "auto",
    },
    ...overrides,
  };
}

describe("SessionStatusPane", () => {
  it("renders elapsed time, turns, tokens, and current on-deck state", () => {
    const { lastFrame } = render(
      <SessionStatusPane
        session={makeSession()}
        projectContext={makeProjectContext()}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Status");
    expect(frame).toContain("2 msgs");
    expect(frame).toContain("1 turns");
    expect(frame).toContain("Guild codex:gpt-5.4/medium");
    expect(frame).toContain("Roscoe codex:gpt-5.4/high");
    expect(frame).toContain("Guild auto");
    expect(frame).toContain("accelerated");
    expect(frame).toContain("Guild access open");
    expect(frame).toContain("Roscoe access draft-only");
    expect(frame).toContain("host bridge: git + gh run + kubectl");
    expect(frame).toContain("Roscoe arbiter");
    expect(frame).toContain("batch proofs");
    expect(frame).toContain("save tokens");
    expect(frame).toContain("auto-send");
    expect(frame).toContain("Guild · running shell commands");
    expect(frame).toContain("tok 17.4k/26");
    expect(frame).toContain("cache 5.5k");
    expect(frame).toContain("limits n/a");
  });

  it("shows provider limit info when present", () => {
    const { lastFrame } = render(
      <SessionStatusPane
        session={makeSession({
          profileName: "claude",
          managed: {
            profile: {
              protocol: "claude",
            },
            awaitingInput: true,
          } as any,
          rateLimitStatus: {
            source: "claude",
            windowLabel: "5h",
            status: "allowed",
            resetsAt: "2026-03-26T22:00:00.000Z",
          },
        })}
        projectContext={makeProjectContext({
          runtimeDefaults: {
            guildProvider: "claude",
            responderProvider: "claude",
            workerByProtocol: {
              claude: {
                executionMode: "accelerated",
                tuningMode: "manual",
                model: "claude-opus-4-6",
                reasoningEffort: "high",
                dangerouslySkipPermissions: true,
              },
            },
            responderByProtocol: {
              claude: {
                executionMode: "accelerated",
                tuningMode: "manual",
                model: "claude-opus-4-6",
                reasoningEffort: "high",
                dangerouslySkipPermissions: true,
              },
            },
            workerGovernanceMode: "guild-autonomous",
            verificationCadence: "prove-each-slice",
            tokenEfficiencyMode: "balanced",
            responderApprovalMode: "manual",
          },
        })}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("balanced");
    expect(frame).toContain("accelerated");
    expect(frame).toContain("Guild access open");
    expect(frame).toContain("Roscoe access open");
    expect(frame).toContain("Guild direct");
    expect(frame).toContain("prove each slice");
    expect(frame).toContain("always ask");
    expect(frame).toContain("5h · allowed");
    expect(frame).toMatch(/5h · allowed · \d{1,2}:\d{2} [AP]M/);
  });

  it("falls back to pending limits, cache creation tokens, and default runtime identity details", () => {
    const { lastFrame } = render(
      <SessionStatusPane
        session={makeSession({
          startedAt: "not-a-date",
          profileName: "claude",
          status: "review",
          currentToolUse: null,
          usage: {
            inputTokens: 2_550_000,
            outputTokens: 1_250_000_000,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 1_500,
          },
          managed: {
            profile: {
              protocol: "claude",
              runtime: {
                model: "claude-sonnet-4",
                reasoningEffort: "medium",
              },
            },
            awaitingInput: false,
            lastWorkerRuntimeSummary: null,
            lastResponderRuntimeSummary: null,
          } as any,
          suggestion: { kind: "idle" },
        })}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("just started");
    expect(frame).toContain("needs review");
    expect(frame).toContain("Guild claude:claude-sonnet-4/medium");
    expect(frame).toContain("Roscoe claude:claude-sonnet-4/medium");
    expect(frame).toContain("tok 2.5m/1.3b");
    expect(frame).toContain("cache+ 1.5k");
    expect(frame).toContain("limits pending");
  });

  it("prefers explicit paused and responder-editing states over generic tool activity", () => {
    const { lastFrame: pausedFrame } = render(
      <SessionStatusPane
        session={makeSession({
          status: "paused",
          currentToolUse: "command_execution",
          suggestion: { kind: "ready", message: "Review this", confidence: 82, reasoning: "Looks good." } as any,
        })}
        projectContext={makeProjectContext()}
      />,
    );
    expect(pausedFrame()!).toContain("paused");

    const { lastFrame: replyingFrame } = render(
      <SessionStatusPane
        session={makeSession({
          status: "active",
          currentToolUse: null,
          managed: {
            profile: { protocol: "codex", runtime: { model: "gpt-5.4", reasoningEffort: "medium" } },
            awaitingInput: false,
            lastWorkerRuntimeSummary: "codex · gpt-5.4 · medium · bypass",
            lastResponderRuntimeSummary: "codex · gpt-5.4 · high · bypass",
          } as any,
          suggestion: { kind: "editing", draft: "Tighten this." } as any,
        })}
      />,
    );
    expect(replyingFrame()!).toContain("you replying");
  });

  it("covers blocked, parked, exited, ready, deciding, and generic idle deck labels", () => {
    const blocked = render(
      <SessionStatusPane
        session={makeSession({
          status: "blocked",
          currentToolUse: "command_execution",
        })}
        projectContext={makeProjectContext()}
      />,
    );
    expect(blocked.lastFrame()!).toContain("blocked");

    const parked = render(
      <SessionStatusPane
        session={makeSession({
          status: "parked",
          currentToolUse: null,
        })}
        projectContext={makeProjectContext()}
      />,
    );
    expect(parked.lastFrame()!).toContain("parked");

    const exited = render(
      <SessionStatusPane
        session={makeSession({
          status: "exited",
          currentToolUse: null,
        })}
        projectContext={makeProjectContext()}
      />,
    );
    expect(exited.lastFrame()!).toContain("ended");

    const ready = render(
      <SessionStatusPane
        session={makeSession({
          currentToolUse: null,
          suggestion: { kind: "ready", message: "Ship it", confidence: 88, reasoning: "clear" } as any,
        })}
        projectContext={makeProjectContext()}
      />,
    );
    expect(ready.lastFrame()!).toContain("you reviewing");

    const deciding = render(
      <SessionStatusPane
        session={makeSession({
          currentToolUse: null,
          managed: {
            profile: { protocol: "codex", runtime: { model: "gpt-5.4", reasoningEffort: "medium" } },
            awaitingInput: true,
            lastWorkerRuntimeSummary: null,
            lastResponderRuntimeSummary: null,
          } as any,
        })}
        projectContext={makeProjectContext()}
      />,
    );
    expect(deciding.lastFrame()!).toContain("Roscoe deciding");

    const genericIdleFallback = render(
      <SessionStatusPane
        session={makeSession({
          currentToolUse: null,
          suggestion: { kind: "idle" },
        })}
        projectContext={makeProjectContext()}
      />,
    );
    expect(genericIdleFallback.lastFrame()!).toContain("Guild working");
  });

  it("renders minute-level elapsed time, unknown resets, and a hidden policy line when no project context exists", () => {
    const now = new Date("2026-03-26T20:01:42.000Z").valueOf();
    const dateNowSpy = jestLikeDateNow(now);

    const { lastFrame } = render(
      <SessionStatusPane
        session={makeSession({
          startedAt: "2026-03-26T20:00:00.000Z",
          profileName: "mystery-profile",
          currentToolUse: null,
          usage: {
            inputTokens: 550,
            outputTokens: 42,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
          managed: {
            profile: {
              protocol: "codex",
              runtime: null,
            },
            awaitingInput: false,
            lastWorkerRuntimeSummary: "unknown-provider",
            lastResponderRuntimeSummary: null,
          } as any,
          rateLimitStatus: {
            source: "claude",
            windowLabel: null,
            status: null,
            resetsAt: "not-a-date",
          } as any,
        })}
        projectContext={null}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("1m 42s");
    expect(frame).toContain("limit · unknown · unknown");
    expect(frame).toContain("Guild codex:gpt-5.4/xhigh");
    expect(frame).toContain("Roscoe codex:gpt-5.4/xhigh");
    expect(frame).not.toContain("Roscoe arbiter");

    dateNowSpy.mockRestore();
  });
});

function jestLikeDateNow(now: number) {
  const original = Date.now;
  const spy = {
    mockRestore() {
      Date.now = original;
    },
  };
  Date.now = () => now;
  return spy;
}
