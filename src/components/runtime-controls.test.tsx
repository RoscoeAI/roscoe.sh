import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { RuntimeEditorPanel, RuntimeSummaryPills, createRuntimeEditorDraft, getReasoningOptions } from "./runtime-controls.js";

function renderPanel() {
  const onApply = vi.fn();
  return render(
    <RuntimeEditorPanel
      protocol="codex"
      runtime={{
        tuningMode: "auto",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        bypassApprovalsAndSandbox: true,
      }}
      responderRuntime={{
        tuningMode: "manual",
        model: "gpt-5.4",
        reasoningEffort: "high",
        bypassApprovalsAndSandbox: true,
      }}
      workerGovernanceMode="roscoe-arbiter"
      verificationCadence="batched"
      responderApprovalMode="auto"
      onApply={onApply}
    />,
  );
}

function delay(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(assertion: () => void, attempts = 20, ms = 20) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(ms);
    }
  }
  throw lastError;
}

describe("RuntimeEditorPanel", () => {
  it("builds sensible runtime draft defaults when worker and responder runtimes are missing", () => {
    const draft = createRuntimeEditorDraft(
      "claude",
      null,
      "gemini",
      null,
      "guild-autonomous",
      "prove-each-slice",
      "balanced",
      "manual",
    );

    expect(draft).toMatchObject({
      workerProvider: "claude",
      workerTuningMode: "auto",
      workerExecutionMode: "safe",
      workerModel: "claude-opus-4-6",
      workerReasoningEffort: getReasoningOptions("claude").at(-1),
      responderProvider: "gemini",
      responderModel: "claude-opus-4-6",
      responderReasoningEffort: getReasoningOptions("claude").at(-1),
      workerGovernanceMode: "guild-autonomous",
      verificationCadence: "prove-each-slice",
      tokenEfficiencyMode: "balanced",
      responderApprovalMode: "manual",
    });
  });

  it("falls back to the worker runtime when the responder runtime is not pinned separately", () => {
    const draft = createRuntimeEditorDraft(
      "codex",
      {
        tuningMode: "manual",
        model: "gpt-5.4",
        reasoningEffort: "high",
        bypassApprovalsAndSandbox: true,
      },
      "codex",
      null,
    );

    expect(draft).toMatchObject({
      workerTuningMode: "manual",
      workerExecutionMode: "accelerated",
      responderModel: "gpt-5.4",
      responderReasoningEffort: "high",
    });
  });

  it("renders runtime summary pills for both explicit and optional summary fields", () => {
    const detailed = render(
      <RuntimeSummaryPills
        protocol="codex"
        responderProvider="claude"
        runtime={{
          tuningMode: "manual",
          model: "gpt-5.4",
          reasoningEffort: "high",
          bypassApprovalsAndSandbox: true,
        }}
        responderRuntime={{
          tuningMode: "manual",
          model: "claude-opus-4-6",
          reasoningEffort: "medium",
          dangerouslySkipPermissions: true,
        }}
        workerGovernanceMode="guild-autonomous"
        verificationCadence="prove-each-slice"
        tokenEfficiencyMode="balanced"
        responderApprovalMode="manual"
      />,
    );

    const detailedFrame = detailed.lastFrame()!;
    expect(detailedFrame).toContain("codex locked");
    expect(detailedFrame).toContain("Guild pinned");
    expect(detailedFrame).toContain("Guild gpt-5.4/high");
    expect(detailedFrame).toContain("Roscoe claude-opus-4-6/medium");
    expect(detailedFrame).toContain("accelerated");
    expect(detailedFrame).toContain("Guild direct");
    expect(detailedFrame).toContain("prove each slice");
    expect(detailedFrame).toContain("balanced");
    expect(detailedFrame).toContain("always ask");

    const minimal = render(
      <RuntimeSummaryPills
        protocol="gemini"
        runtime={null}
      />,
    );

    const minimalFrame = minimal.lastFrame()!;
    expect(minimalFrame).toContain("gemini locked");
    expect(minimalFrame).toContain("Guild dynamic");
    expect(minimalFrame).toContain("Guild gemini-3-flash-preview");
    expect(minimalFrame).toContain("Roscoe gemini-3-flash-preview");
    expect(minimalFrame).toContain("safe");
    expect(minimalFrame).not.toContain("Guild direct");
    expect(minimalFrame).not.toContain("Roscoe arbiter");
    expect(minimalFrame).not.toContain("prove each slice");
    expect(minimalFrame).not.toContain("always ask");
  });

  it("renders separate Guild and Roscoe controls without a trace tab", () => {
    const { lastFrame } = renderPanel();

    const frame = lastFrame()!;
    expect(frame).toContain("Runtime & Governance");
    expect(frame).toContain("Guild and Roscoe provider/runtime, execution, check-ins");
    expect(frame).toContain("proof");
    expect(frame).toContain("cadence");
    expect(frame).toContain("Editable now: Guild provider");
    expect(frame).toContain("Current: Guild provider: codex");
    expect(frame).not.toContain("trace");
    expect(frame).not.toContain("Current lane trace");
    expect(frame).not.toContain("Step 1/5");
    expect(frame).not.toContain("accelerated");
    expect(frame).not.toContain("auto when confident");
  });

  it("shows the editable Guild provider choices up front", () => {
    const { lastFrame } = renderPanel();

    const frame = lastFrame()!;
    expect(frame).toContain("Claude");
    expect(frame).toContain("Codex");
  });

  it("keeps both Guild runtime mode choices visible after advancing to that step", async () => {
    const app = renderPanel();

    await delay();
    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Guild runtime");
    });

    const frame = app.lastFrame()!;
    expect(frame).toContain("Allow Roscoe to manage the Guild model and reasoning dynamically");
    expect(frame).toContain("Pin the Guild model and reasoning manually");
  });

  it("walks the auto runtime path through Roscoe provider, execution, governance, and apply", async () => {
    const onApply = vi.fn();
    const app = render(
      <RuntimeEditorPanel
        protocol="codex"
        runtime={{
          tuningMode: "auto",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          bypassApprovalsAndSandbox: true,
        }}
        responderRuntime={{
          tuningMode: "manual",
          model: "gpt-5.4",
          reasoningEffort: "high",
          bypassApprovalsAndSandbox: true,
        }}
        workerGovernanceMode="roscoe-arbiter"
        verificationCadence="batched"
        responderApprovalMode="auto"
        onApply={onApply}
      />,
    );

    await delay();
    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Guild runtime");
    });

    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Guild reasoning");
    });

    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Roscoe provider");
    });

    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Roscoe model:");
    });

    app.stdin.write("gpt-5.4-mini");
    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Roscoe reasoning");
    });

    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Execution mode");
    });

    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Guild check-ins");
    });

    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Verification cadence");
    });

    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Token efficiency");
    });

    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Roscoe approval");
    });

    app.stdin.write("\r");
    await waitFor(() => {
      expect(onApply).toHaveBeenCalled();
    });

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      workerProvider: "claude",
      workerTuningMode: "manual",
      responderProvider: "claude",
      responderModel: "claude-opus-4-6",
    }));
  });

  it("walks the manual Guild runtime path through pinned model and reasoning", async () => {
    const onApply = vi.fn();
    const app = render(
      <RuntimeEditorPanel
        protocol="codex"
        runtime={{
          tuningMode: "auto",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          bypassApprovalsAndSandbox: true,
        }}
        responderRuntime={{
          tuningMode: "manual",
          model: "gpt-5.4",
          reasoningEffort: "high",
          bypassApprovalsAndSandbox: true,
        }}
        workerGovernanceMode="roscoe-arbiter"
        verificationCadence="batched"
        responderApprovalMode="auto"
        onApply={onApply}
      />,
    );

    await delay();
    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Guild runtime");
    });

    app.stdin.write("\u001B[B");
    await delay(20);
    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Guild model:");
    });

    app.stdin.write("gpt-5.4");
    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Guild reasoning");
    });

    app.stdin.write("\r");
    await waitFor(() => {
      expect(app.lastFrame()).toContain("Editable now: Roscoe provider");
    });
  });
});
