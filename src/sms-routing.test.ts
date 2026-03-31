import { describe, expect, it } from "vitest";
import { buildSmsHelpText, buildSmsStatusText, formatSmsLaneScope, resolveInboundSmsMessage } from "./sms-routing.js";

const singleLane = [
  {
    id: "lane-1",
    projectName: "appsicle",
    worktreeName: "main",
    status: "waiting" as const,
    summary: "Scaffolded the repo and is waiting for direction.",
    suggestionKind: "ready" as const,
    awaitingInput: true,
  },
];

describe("sms routing", () => {
  it("formats lane scopes", () => {
    expect(formatSmsLaneScope({ projectName: "appsicle", worktreeName: "main" })).toBe("appsicle");
    expect(formatSmsLaneScope({ projectName: "nanobots", worktreeName: "auth" })).toBe("nanobots/auth");
  });

  it("routes status to the only live lane", () => {
    expect(resolveInboundSmsMessage("status", singleLane)).toMatchObject({
      kind: "status",
      targetId: "lane-1",
    });
  });

  it("treats untokened text as operator guidance", () => {
    expect(resolveInboundSmsMessage("Keep going on auth", singleLane)).toMatchObject({
      kind: "message",
      targetId: "lane-1",
      text: "Keep going on auth",
    });
  });

  it("does not mistake normal colon text for a lane scope when only one lane is live", () => {
    expect(resolveInboundSmsMessage("note: keep going on auth", singleLane)).toMatchObject({
      kind: "message",
      targetId: "lane-1",
      text: "keep going on auth",
    });
  });

  it("requires a scope prefix when multiple lanes are live", () => {
    const resolved = resolveInboundSmsMessage("status", [
      ...singleLane,
      {
        id: "lane-2",
        projectName: "nanobots",
        worktreeName: "auth",
        status: "active" as const,
      },
    ]);

    expect(resolved.targetId).toBeNull();
    expect(resolved.responseText).toContain("live lanes");
  });

  it("returns a no-lane response when no live lanes exist", () => {
    const resolved = resolveInboundSmsMessage("status", []);
    expect(resolved.kind).toBe("help");
    expect(resolved.responseText).toContain("no live lanes");
  });

  it("returns a helpful response for empty texts and help commands", () => {
    expect(resolveInboundSmsMessage("   ", singleLane)).toMatchObject({
      kind: "help",
      targetId: null,
    });

    const help = resolveInboundSmsMessage("help", singleLane);
    expect(help.kind).toBe("help");
    expect(help.responseText).toContain("appsicle");
  });

  it("resolves an explicit lane scope", () => {
    const resolved = resolveInboundSmsMessage("nanobots/auth: status", [
      ...singleLane,
      {
        id: "lane-2",
        projectName: "nanobots",
        worktreeName: "auth",
        status: "active" as const,
      },
    ]);

    expect(resolved).toMatchObject({
      kind: "status",
      targetId: "lane-2",
    });
  });

  it("resolves an unambiguous project-only scope", () => {
    const resolved = resolveInboundSmsMessage("nanobots: keep going", [
      ...singleLane,
      {
        id: "lane-2",
        projectName: "nanobots",
        worktreeName: "auth",
        status: "active" as const,
      },
    ]);

    expect(resolved).toMatchObject({
      kind: "resume",
      targetId: "lane-2",
    });
  });

  it("reports an unknown scope when multiple lanes are live", () => {
    const resolved = resolveInboundSmsMessage("missing: status", [
      ...singleLane,
      {
        id: "lane-2",
        projectName: "nanobots",
        worktreeName: "auth",
        status: "active" as const,
      },
    ]);

    expect(resolved.kind).toBe("help");
    expect(resolved.responseText).toContain("could not match");
    expect(resolved.responseText).toContain("appsicle");
  });

  it("routes approve/send commands to the only live lane", () => {
    expect(resolveInboundSmsMessage("approve", singleLane)).toMatchObject({
      kind: "approve",
      targetId: "lane-1",
    });
    expect(resolveInboundSmsMessage("send it", singleLane)).toMatchObject({
      kind: "approve",
      targetId: "lane-1",
    });
  });

  it("routes hold and resume commands to the only live lane", () => {
    expect(resolveInboundSmsMessage("hold", singleLane)).toMatchObject({
      kind: "hold",
      targetId: "lane-1",
    });
    expect(resolveInboundSmsMessage("resume", singleLane)).toMatchObject({
      kind: "resume",
      targetId: "lane-1",
    });
  });

  it("builds a compact status text", () => {
    const status = buildSmsStatusText({
      id: "lane-1",
      projectName: "appsicle",
      worktreeName: "main",
      status: "waiting",
      summary: "Scaffolded the repo and is waiting for direction.",
      suggestionKind: "ready",
      awaitingInput: true,
    });

    expect(status).toContain("Roscoe status for appsicle");
    expect(status).toContain("needs review");
    expect(status).toContain("Reply \"approve\" to send the draft");
  });

  it("builds help and status text for paused and preview-ready lanes", () => {
    const pausedTarget = {
      id: "lane-2",
      projectName: "nanobots",
      worktreeName: "auth",
      status: "paused" as const,
      summary: "Waiting on operator approval.",
      currentToolUse: "bash",
    };
    const previewTarget = {
      id: "lane-3",
      projectName: "roscoe-web",
      worktreeName: "preview",
      status: "active" as const,
      summary: "Preview artifact is ready.",
      preview: { mode: "ready" as const, message: "Preview ready", link: "https://preview.example" },
    };

    expect(buildSmsHelpText(pausedTarget, 1)).toContain("\"resume\"");
    expect(buildSmsStatusText(pausedTarget)).toContain("paused on blocker");
    expect(buildSmsStatusText(pausedTarget)).toContain("Reply \"resume\"");
    expect(buildSmsStatusText(previewTarget)).toContain("preview ready");
  });

  it("builds generic help text and uses the most specific status label", () => {
    expect(buildSmsHelpText(null, 1)).toContain("\"status\"");
    expect(buildSmsHelpText(null, 2)).toContain("multiple live lanes");

    const toolDetailTarget = {
      id: "lane-4",
      projectName: "appsicle",
      worktreeName: "main",
      status: "active" as const,
      summary: "Running tests.",
      currentToolUse: "bash",
      currentToolDetail: "running shell commands",
      awaitingInput: false,
    };
    const manualTarget = {
      id: "lane-5",
      projectName: "appsicle",
      worktreeName: "preview",
      status: "waiting" as const,
      summary: "Waiting for operator text.",
      suggestionKind: "manual-input" as const,
      awaitingInput: true,
    };
    const parkedTarget = {
      id: "lane-6",
      projectName: "appsicle",
      worktreeName: "main",
      status: "parked" as const,
      summary: "Clean parking state.",
      awaitingInput: true,
    };
    const longSummaryTarget = {
      id: "lane-7",
      projectName: "appsicle",
      worktreeName: "main",
      status: "waiting" as const,
      summary: "This is a very long summary ".repeat(40),
      awaitingInput: true,
    };

    expect(buildSmsStatusText(toolDetailTarget)).toContain("running shell commands");
    expect(buildSmsStatusText(manualTarget)).toContain("waiting for your message");
    expect(buildSmsStatusText(parkedTarget)).toContain("Reply \"resume\"");
    expect(buildSmsStatusText(longSummaryTarget).length).toBeLessThanOrEqual(620);
  });
});

describe("sms routing edge cases", () => {
  it("covers remaining routing and status fallbacks", () => {
    expect(buildSmsHelpText(null, 0)).toContain("Text \"status\"");

    expect(resolveInboundSmsMessage("missing: status", [])).toMatchObject({
      kind: "help",
      targetId: null,
      responseText: expect.stringContaining("no live lanes"),
    });

    expect(resolveInboundSmsMessage("nanobots: status", [
      { id: "lane-1", projectName: "nanobots", worktreeName: "auth", status: "active" as const },
      { id: "lane-2", projectName: "nanobots", worktreeName: "worker", status: "active" as const },
    ])).toMatchObject({
      kind: "help",
      targetId: null,
      responseText: expect.stringContaining("Try one of: nanobots/auth, nanobots/worker"),
    });

    expect(resolveInboundSmsMessage("summary", [
      { id: "lane-1", projectName: "appsicle", worktreeName: "main", status: "waiting" as const },
      { id: "lane-2", projectName: "nanobots", worktreeName: "auth", status: "active" as const },
    ])).toMatchObject({
      kind: "status",
      targetId: null,
    });

    expect(resolveInboundSmsMessage("approve", [
      { id: "lane-1", projectName: "appsicle", worktreeName: "main", status: "waiting" as const },
      { id: "lane-2", projectName: "nanobots", worktreeName: "auth", status: "active" as const },
    ])).toMatchObject({
      kind: "approve",
      targetId: null,
    });

    expect(resolveInboundSmsMessage("hold", [
      { id: "lane-1", projectName: "appsicle", worktreeName: "main", status: "waiting" as const },
      { id: "lane-2", projectName: "nanobots", worktreeName: "auth", status: "active" as const },
    ])).toMatchObject({
      kind: "hold",
      targetId: null,
    });

    expect(resolveInboundSmsMessage("resume", [
      { id: "lane-1", projectName: "appsicle", worktreeName: "main", status: "waiting" as const },
      { id: "lane-2", projectName: "nanobots", worktreeName: "auth", status: "active" as const },
    ])).toMatchObject({
      kind: "resume",
      targetId: null,
    });

    const useCurrentToolTarget = {
      id: "lane-8",
      projectName: "nanobots",
      worktreeName: "auth",
      status: "active" as const,
      summary: "Running tests.",
      currentToolUse: "bash",
      awaitingInput: false,
    };
    const awaitingTarget = {
      id: "lane-9",
      projectName: "nanobots",
      worktreeName: "auth",
      status: "waiting" as const,
      summary: "Awaiting the next step.",
      awaitingInput: true,
    };

    expect(buildSmsStatusText(useCurrentToolTarget)).toContain("bash");
    expect(buildSmsStatusText(awaitingTarget)).toContain("waiting");
  });
});
