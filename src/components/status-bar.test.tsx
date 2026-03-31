import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { StatusBar } from "./status-bar.js";

describe("StatusBar", () => {
  it("displays project name", () => {
    const { lastFrame } = render(
      <StatusBar projectName="myapp" worktreeName="main" autoMode={false} sessionCount={1} viewMode="transcript" followLive={true} />,
    );
    expect(lastFrame()).toContain("myapp");
  });

  it("shows AUTO badge when autoMode is true", () => {
    const { lastFrame } = render(
      <StatusBar projectName="proj" worktreeName="main" autoMode={true} sessionCount={0} viewMode="transcript" followLive={true} />,
    );
    expect(lastFrame()).toContain("AUTO");
  });

  it("shows MANUAL badge when autoMode is false", () => {
    const { lastFrame } = render(
      <StatusBar projectName="proj" worktreeName="main" autoMode={false} sessionCount={0} viewMode="transcript" followLive={true} />,
    );
    expect(lastFrame()).toContain("MANUAL");
  });

  it("shows lane count", () => {
    const { lastFrame } = render(
      <StatusBar projectName="proj" worktreeName="main" autoMode={false} sessionCount={3} viewMode="raw" followLive={false} />,
    );
    expect(lastFrame()).toContain("3 lanes");
    expect(lastFrame()).toContain("raw");
    expect(lastFrame()).toContain("SCROLLED");
    expect(lastFrame()).toContain("jump top");
    expect(lastFrame()).toContain("jump live");
  });

  it("uses singular for 1 lane", () => {
    const { lastFrame } = render(
      <StatusBar projectName="proj" worktreeName="main" autoMode={false} sessionCount={1} viewMode="transcript" followLive={true} />,
    );
    expect(lastFrame()).toContain("1 lane");
    expect(lastFrame()).not.toContain("1 lanes");
  });

  it("shows only the dispatch shortcut when one lane is loaded", () => {
    const { lastFrame } = render(
      <StatusBar projectName="proj" worktreeName="main" autoMode={false} sessionCount={1} viewMode="transcript" followLive={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("[Tab] switch lanes");
    expect(frame).not.toContain("new lane");
    expect(frame).toContain("[h]");
    expect(frame).toContain("dispatch");
    expect(frame).toContain("[c]");
    expect(frame).toContain("close lane");
    expect(frame).not.toContain("[m]");
    expect(frame).not.toContain("[q]");
    expect(frame).toContain("[s]");
    expect(frame).toContain("hide status");
    expect(frame).not.toContain("jump top");
    expect(frame).not.toContain("jump live");
  });

  it("shows Esc when a text-entry mode is active", () => {
    const { lastFrame } = render(
      <StatusBar
        projectName="proj"
        worktreeName="main"
        autoMode={false}
        sessionCount={2}
        suggestionPhaseKind="manual-input"
        viewMode="transcript"
        followLive={true}
      />,
    );
    expect(lastFrame()).toContain("[Esc]");
    expect(lastFrame()).toContain("cancel");
  });

  it("does not show text me in the footer even when SMS questions are actionable", () => {
    const { lastFrame } = render(
      <StatusBar
        projectName="proj"
        worktreeName="main"
        autoMode={true}
        sessionCount={1}
        viewMode="transcript"
        followLive={true}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).not.toContain("[q]");
    expect(frame).not.toContain("text me");
  });

  it("shows preview status and continue controls when a preview break is active", () => {
    const { lastFrame } = render(
      <StatusBar
        projectName="proj"
        worktreeName="main"
        autoMode={true}
        sessionCount={1}
        previewMode="ready"
        viewMode="transcript"
        followLive={true}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("PREVIEW READY");
    expect(frame).toContain("[c]");
    expect(frame).toContain("continue");
    expect(frame).toContain("[b]");
    expect(frame).toContain("clear preview");
    expect(frame).not.toContain("close lane");
  });

  it("shows a force-preview escape hatch while a preview break is queued and the lane is still busy", () => {
    const { lastFrame } = render(
      <StatusBar
        projectName="proj"
        worktreeName="main"
        autoMode={true}
        sessionCount={1}
        previewMode="queued"
        canInterruptActiveTurn={true}
        viewMode="transcript"
        followLive={true}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("[b]");
    expect(frame).toContain("clear preview");
    expect(frame).not.toContain("[x]");
  });

  it("does not duplicate the interrupt hint in the footer while a lane is actively working", () => {
    const { lastFrame } = render(
      <StatusBar
        projectName="proj"
        worktreeName="main"
        autoMode={true}
        sessionCount={1}
        canInterruptActiveTurn={true}
        viewMode="transcript"
        followLive={true}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("[b]");
    expect(frame).toContain("preview");
    expect(frame).not.toContain("[x]");
    expect(frame).not.toContain("interrupt");
  });

  it("shows paused state and swaps the pause hint to resume", () => {
    const { lastFrame } = render(
      <StatusBar
        projectName="proj"
        worktreeName="main"
        autoMode={true}
        sessionCount={1}
        sessionStatus="paused"
        viewMode="transcript"
        followLive={true}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("PAUSED");
    expect(frame).toContain("[p]");
    expect(frame).toContain("resume");
    expect(frame).not.toContain("pause");
  });

  it("shows jump shortcuts only after the transcript is scrolled away from live", () => {
    const { lastFrame } = render(
      <StatusBar
        projectName="proj"
        worktreeName="main"
        autoMode={true}
        sessionCount={1}
        viewMode="transcript"
        followLive={false}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("[g]");
    expect(frame).toContain("jump top");
    expect(frame).toContain("[G/End/l]");
    expect(frame).toContain("jump live");
  });

  it("replaces normal hints with exit confirmation controls when exit confirm is open", () => {
    const { lastFrame } = render(
      <StatusBar
        projectName="proj"
        worktreeName="main"
        autoMode={true}
        sessionCount={2}
        viewMode="transcript"
        followLive={true}
        exitConfirmOpen={true}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("[Enter]");
    expect(frame).toContain("exit now");
    expect(frame).toContain("[Esc]");
    expect(frame).toContain("keep running");
    expect(frame).not.toContain("Ctrl+C");
    expect(frame).not.toContain("dispatch");
  });

  it("replaces normal hints with lane-close confirmation controls when close confirm is open", () => {
    const { lastFrame } = render(
      <StatusBar
        projectName="proj"
        worktreeName="main"
        autoMode={true}
        sessionCount={2}
        viewMode="transcript"
        followLive={true}
        closeLaneConfirmOpen={true}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("[Enter]");
    expect(frame).toContain("close lane");
    expect(frame).toContain("[Esc]");
    expect(frame).toContain("keep lane");
    expect(frame).not.toContain("dispatch");
    expect(frame).not.toContain("Ctrl+C");
  });

  it("shows Tab switch lanes when more than one lane is loaded", () => {
    const { lastFrame } = render(
      <StatusBar
        projectName="proj"
        worktreeName="main"
        autoMode={true}
        sessionCount={2}
        viewMode="transcript"
        followLive={true}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("[Tab]");
    expect(frame).toContain("switch lanes");
  });
});
