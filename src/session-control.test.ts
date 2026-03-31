import { describe, expect, it } from "vitest";
import { getResumePrompt } from "./session-control.js";
import type { SessionState } from "./types.js";

function makeSession(status: SessionState["status"]): SessionState {
  return {
    id: "lane-1",
    profileName: "codex",
    projectName: "AppSicle",
    worktreeName: "main",
    startedAt: new Date().toISOString(),
    status,
    outputLines: [],
    suggestion: { kind: "idle" },
    managed: {} as SessionState["managed"],
    summary: null,
    currentToolUse: null,
    usage: {} as SessionState["usage"],
    rateLimitStatus: null,
    timeline: [],
    viewMode: "transcript",
    scrollOffset: 0,
    followLive: true,
  };
}

describe("getResumePrompt", () => {
  it("uses the blocker-aware resume prompt for blocked lanes", () => {
    expect(getResumePrompt(makeSession("blocked"))).toContain("First verify whether the blocker is actually cleared");
  });

  it("uses the next-slice resume prompt for parked lanes", () => {
    expect(getResumePrompt(makeSession("parked"))).toContain("pick up the next concrete slice");
  });

  it("uses the generic resume prompt for other paused work", () => {
    expect(getResumePrompt(makeSession("paused"))).toBe("Continue your work from where you left off.");
  });
});
