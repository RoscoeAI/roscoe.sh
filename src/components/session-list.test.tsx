import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { SessionList } from "./session-list.js";
import { SessionState } from "../types.js";

function makeSession(id: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    id,
    profileName: "claude",
    projectName: "proj",
    worktreeName: "main",
    status: "active",
    outputLines: [],
    suggestion: { kind: "idle" },
    managed: {} as any,
    summary: null,
    currentToolUse: null,
    timeline: [],
    viewMode: "transcript",
    scrollOffset: 0,
    followLive: true,
    ...overrides,
  };
}

describe("SessionList", () => {
  it("shows empty state when no sessions", () => {
    const { lastFrame } = render(
      <SessionList sessions={new Map()} activeSessionId={null} />,
    );
    expect(lastFrame()).toContain("No sessions");
  });

  it("renders session entries", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        profileName: "claude",
        projectName: "myapp",
        managed: {
          profile: {
            name: "claude-code",
            command: "claude",
            args: [],
            protocol: "claude",
            runtime: {
              tuningMode: "auto",
              model: "claude-opus-4-6",
              reasoningEffort: "high",
              permissionMode: "auto",
            },
          },
        } as any,
      })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("myapp");
    expect(frame).toContain("main repo");
    expect(frame).toContain("claude-opus-4-6");
    expect(frame).toContain("auto");
  });

  it("shows worktree name for non-main branches", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", { worktreeName: "feat-auth" })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" />,
    );
    expect(lastFrame()).toContain("worktree - feat-auth");
  });

  it("wraps runtime metadata on narrower rails", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        projectName: "operator-console",
        worktreeName: "stripe-check",
        managed: {
          profile: {
            name: "codex",
            command: "codex",
            args: [],
            protocol: "codex",
            runtime: {
              tuningMode: "auto",
              model: "gpt-5.4",
              reasoningEffort: "xhigh",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
            },
          },
        } as any,
      })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" width={28} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("stripe-check");
    expect(frame).toContain("gpt-5.4/xhigh");
    expect(frame).toContain("auto");
  });

  it("shows transcript turn counts", () => {
    const sessions = new Map([
      ["s1", makeSession("s1", {
        timeline: [
          { id: "r1", kind: "remote-turn", timestamp: 1, provider: "claude", text: "hello" },
          { id: "l1", kind: "local-sent", timestamp: 2, text: "ship it", delivery: "approved", confidence: 90 },
        ],
      })],
    ]);
    const { lastFrame } = render(
      <SessionList sessions={sessions} activeSessionId="s1" />,
    );
    expect(lastFrame()).toContain("2 turns");
  });
});
