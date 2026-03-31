import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  class MockOnboarder {
    listeners = new Map<string, Array<(...args: any[]) => void>>();
    start = vi.fn();
    sendInput = vi.fn();
    sendSecretInput = vi.fn();
    updateRuntime = vi.fn();
    constructorArgs: any[];

    constructor(...args: any[]) {
      this.constructorArgs = args;
      created.push(this);
    }

    on(event: string, handler: (...args: any[]) => void) {
      const current = this.listeners.get(event) ?? [];
      current.push(handler);
      this.listeners.set(event, current);
    }

    emit(event: string, ...args: any[]) {
      for (const handler of this.listeners.get(event) ?? []) {
        handler(...args);
      }
    }
  }

  const created: MockOnboarder[] = [];

  return {
    MockOnboarder,
    created,
    loadProjectContext: vi.fn(() => ({ name: "AppSicle" })),
    listProjectHistory: vi.fn(() => ([{ id: "h1" }])),
    detectProtocol: vi.fn((profile?: { protocol?: string }) => profile?.protocol ?? "claude"),
    getProviderAdapter: vi.fn((provider?: string) => ({
      label: provider === "codex" ? "Codex" : "Claude",
      defaultReasoningEffort: "medium",
      onboardingReasoningEffort: "high",
    })),
    Onboarder: MockOnboarder,
  };
});

vi.mock("../onboarder.js", () => ({
  Onboarder: mocks.Onboarder,
}));

vi.mock("../config.js", () => ({
  loadProjectContext: mocks.loadProjectContext,
  listProjectHistory: mocks.listProjectHistory,
}));

vi.mock("../llm-runtime.js", () => ({
  detectProtocol: mocks.detectProtocol,
  getProviderAdapter: mocks.getProviderAdapter,
}));

import { useOnboarding } from "./use-onboarding.js";

let latestHook: ReturnType<typeof useOnboarding> | null = null;

function Harness() {
  latestHook = useOnboarding();
  return <Text>{latestHook.state.status}</Text>;
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useOnboarding hook", () => {
  beforeEach(() => {
    latestHook = null;
    mocks.created.length = 0;
    vi.useFakeTimers();
    mocks.loadProjectContext.mockClear();
    mocks.listProjectHistory.mockClear();
    mocks.detectProtocol.mockClear();
    mocks.getProviderAdapter.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts onboarding, streams output, and exposes interview questions", async () => {
    render(<Harness />);
    expect(latestHook).not.toBeNull();

    await act(async () => {
      latestHook!.start("/tmp/appsicle", false, { name: "claude", command: "claude", args: [], protocol: "claude" } as any);
      await flushEffects();
    });
    const onboarder = mocks.created.at(-1)!;

    expect(onboarder.start).toHaveBeenCalled();
    expect(latestHook!.state.status).toBe("initializing");

    await act(async () => {
      onboarder.emit("output", "Roscoe is learning the repo.");
      onboarder.emit("thinking", "Comparing notes");
      await vi.advanceTimersByTimeAsync(80);
      await flushEffects();
    });

    expect(latestHook!.state.status).toBe("running");
    expect(latestHook!.state.streamingText).toContain("Roscoe is learning the repo.");
    expect(latestHook!.state.thinkingText).toContain("Comparing notes");

    await act(async () => {
      onboarder.emit("tool-activity", "serena");
      await flushEffects();
    });
    expect(latestHook!.state.toolActivity).toBe("serena");

    await act(async () => {
      onboarder.emit(
        "output",
        `---QUESTION---
{"question":"Which users matter most?","options":["Teachers","Students"],"theme":"primary-users","selectionMode":"multi"}
---END_QUESTION---`,
      );
      onboarder.emit("turn-complete");
      await flushEffects();
    });

    expect(latestHook!.state.status).toBe("interviewing");
    expect(latestHook!.state.question).toEqual({
      text: "Which users matter most?",
      options: ["Teachers", "Students"],
      theme: "primary-users",
      selectionMode: "multi",
    });
    expect(latestHook!.state.toolActivity).toBeNull();
  });

  it("flushes pure thinking updates even when no output chunk came first", async () => {
    render(<Harness />);

    await act(async () => {
      latestHook!.start("/tmp/appsicle", false, { name: "claude", command: "claude", args: [], protocol: "claude" } as any);
      await flushEffects();
    });
    const onboarder = mocks.created.at(-1)!;

    await act(async () => {
      onboarder.emit("thinking", "Only thinking");
      await vi.advanceTimersByTimeAsync(80);
      await flushEffects();
    });

    expect(latestHook!.state.thinkingText).toContain("Only thinking");
    expect(latestHook!.state.status).toBe("running");
  });

  it("coalesces repeated output/thinking flushes and keeps later tool activity in running state", async () => {
    render(<Harness />);

    await act(async () => {
      latestHook!.start("/tmp/appsicle", false, { name: "claude", command: "claude", args: [], protocol: "claude" } as any);
      await flushEffects();
    });
    const onboarder = mocks.created.at(-1)!;

    await act(async () => {
      onboarder.emit("output", "First chunk.");
      onboarder.emit("output", " Second chunk.");
      onboarder.emit("thinking", "Thinking once.");
      onboarder.emit("thinking", " Thinking twice.");
      await vi.advanceTimersByTimeAsync(80);
      await flushEffects();
    });

    expect(latestHook!.state.streamingText).toContain("First chunk. Second chunk.");
    expect(latestHook!.state.thinkingText).toContain("Thinking once. Thinking twice.");

    await act(async () => {
      onboarder.emit("tool-activity", "serena");
      await flushEffects();
    });

    expect(latestHook!.state.status).toBe("running");
    expect(latestHook!.state.toolActivity).toBe("serena");
  });

  it("seeds refine mode from saved context and history, then reports tightening work", async () => {
    render(<Harness />);

    await act(async () => {
      latestHook!.start(
        "/tmp/appsicle",
        false,
        { name: "claude", command: "claude", args: [], protocol: "claude" } as any,
        undefined,
        "refine",
        ["deployment-contract"],
      );
      await flushEffects();
    });
    const onboarderArgs = mocks.created.at(-1)?.constructorArgs;
    expect(onboarderArgs?.[4]).toEqual(expect.objectContaining({
      mode: "refine",
      refineThemes: ["deployment-contract"],
      seedContext: { name: "AppSicle" },
      seedHistory: [{ id: "h1" }],
    }));

    const onboarder = mocks.created.at(-1)!;
    await act(async () => {
      onboarder.emit("continue-interview", {
        missingThemes: ["deployment-contract"],
        missingFields: ["proofTargets"],
      });
      await flushEffects();
    });

    expect(latestHook!.state.status).toBe("running");
    expect(latestHook!.state.streamingText).toContain("Missing themes: deployment-contract");
    expect(latestHook!.state.streamingText).toContain("Still underspecified: proofTargets");
  });

  it("submits answers with question context and appends qa history", async () => {
    render(<Harness />);

    await act(async () => {
      latestHook!.start("/tmp/appsicle");
      await flushEffects();
    });
    const onboarder = mocks.created.at(-1)!;
    await act(async () => {
      onboarder.emit(
        "output",
        `---QUESTION---
{"question":"Which users matter most?","options":["Teachers","Students"],"theme":"primary-users","purpose":"Guide Roscoe","selectionMode":"multi"}
---END_QUESTION---`,
      );
      onboarder.emit("turn-complete");
      await flushEffects();
    });

    await act(async () => {
      latestHook!.sendInput({
        text: "Teachers and students",
        mode: "multi",
        selectedOptions: ["Teachers", "Students"],
        freeText: "Admins later",
      });
      await flushEffects();
    });

    expect(onboarder.sendInput).toHaveBeenCalledWith(
      "Teachers and students",
      {
        question: "Which users matter most?",
        theme: "primary-users",
        purpose: "Guide Roscoe",
        options: ["Teachers", "Students"],
        selectionMode: "multi",
      },
      {
        mode: "multi",
        selectedOptions: ["Teachers", "Students"],
        freeText: "Admins later",
      },
    );
    expect(latestHook!.state.status).toBe("running");
    expect(latestHook!.state.qaHistory).toContainEqual({
      question: "Which users matter most?",
      answer: "Teachers and students",
      theme: "primary-users",
    });
  });

  it("submits plain string answers without question context and completes clean exits", async () => {
    render(<Harness />);

    await act(async () => {
      latestHook!.start("/tmp/appsicle");
      await flushEffects();
    });
    const onboarder = mocks.created.at(-1)!;

    await act(async () => {
      latestHook!.sendInput("Keep going");
      await flushEffects();
    });

    expect(onboarder.sendInput).toHaveBeenCalledWith(
      "Keep going",
      undefined,
      {},
    );
    expect(latestHook!.state.qaHistory.at(-1)).toEqual({
      question: "",
      answer: "Keep going",
    });

    await act(async () => {
      onboarder.emit("exit", 0);
      await flushEffects();
    });
    expect(latestHook!.state.status).toBe("complete");
    expect(latestHook!.state.error).toBeNull();
  });

  it("handles secure secret submission and skipping", async () => {
    render(<Harness />);

    await act(async () => {
      latestHook!.start("/tmp/appsicle");
      await flushEffects();
    });
    const onboarder = mocks.created.at(-1)!;
    await act(async () => {
      onboarder.emit(
        "output",
        `---SECRET---
{"key":"CF_API_TOKEN","label":"Cloudflare API token","purpose":"Deploy previews","instructions":["Create token"],"links":[],"required":true,"targetFile":".env.local"}
---END_SECRET---`,
      );
      onboarder.emit("turn-complete");
      await flushEffects();
    });

    expect(latestHook!.state.secretRequest).toEqual(expect.objectContaining({
      key: "CF_API_TOKEN",
      targetFile: ".env.local",
    }));

    await act(async () => {
      latestHook!.sendSecretInput(latestHook!.state.secretRequest!, "  secret-value  ");
      await flushEffects();
    });
    expect(onboarder.sendSecretInput).toHaveBeenCalledWith(
      expect.objectContaining({ key: "CF_API_TOKEN" }),
      "provided",
      "secret-value",
    );
    expect(latestHook!.state.qaHistory.at(-1)).toEqual({
      question: "Secure secret: Cloudflare API token",
      answer: "[provided securely in .env.local]",
      theme: "secret:CF_API_TOKEN",
    });

    await act(async () => {
      onboarder.emit(
        "output",
        `---SECRET---
{"key":"TWILIO_AUTH_TOKEN","label":"Twilio auth token","purpose":"Send SMS","instructions":["Copy from Twilio"],"links":[],"required":true,"targetFile":".env.local"}
---END_SECRET---`,
      );
      onboarder.emit("turn-complete");
      await flushEffects();
    });

    await act(async () => {
      latestHook!.skipSecretInput(latestHook!.state.secretRequest!);
      await flushEffects();
    });
    expect(onboarder.sendSecretInput).toHaveBeenCalledWith(
      expect.objectContaining({ key: "TWILIO_AUTH_TOKEN" }),
      "skipped",
    );
    expect(latestHook!.state.qaHistory.at(-1)).toEqual({
      question: "Secure secret: Twilio auth token",
      answer: "[skipped for now]",
      theme: "secret:TWILIO_AUTH_TOKEN",
    });
  });

  it("ignores empty secret submissions, completes successfully, updates runtime, and reports exit errors", async () => {
    render(<Harness />);

    await act(async () => {
      latestHook!.start("/tmp/appsicle", false, { name: "codex", command: "codex", args: [], protocol: "codex" } as any);
      await flushEffects();
    });
    const onboarder = mocks.created.at(-1)!;

    await act(async () => {
      onboarder.emit(
        "output",
        `---SECRET---
{"key":"CF_API_TOKEN","label":"Cloudflare API token","purpose":"Deploy previews","instructions":["Create token"],"links":[],"required":true,"targetFile":".env.local"}
---END_SECRET---`,
      );
      onboarder.emit("turn-complete");
      await flushEffects();
    });
    await act(async () => {
      latestHook!.sendSecretInput(latestHook!.state.secretRequest!, "   ");
      await flushEffects();
    });
    expect(onboarder.sendSecretInput).not.toHaveBeenCalled();

    await act(async () => {
      latestHook!.updateRuntime({ name: "codex", command: "codex", args: [], protocol: "codex" } as any, {
        guildProvider: "codex",
      } as any);
      await flushEffects();
    });
    expect(onboarder.updateRuntime).toHaveBeenCalledWith(
      { name: "codex", command: "codex", args: [], protocol: "codex" },
      { guildProvider: "codex" },
    );

    await act(async () => {
      onboarder.emit("onboarding-complete", { name: "AppSicle" });
      await flushEffects();
    });
    expect(latestHook!.state.status).toBe("complete");
    expect(latestHook!.state.projectContext).toEqual({ name: "AppSicle" });

    await act(async () => {
      latestHook!.start("/tmp/appsicle", false, { name: "codex", command: "codex", args: [], protocol: "codex" } as any);
      await flushEffects();
    });
    const secondOnboarder = mocks.created.at(-1)!;
    await act(async () => {
      secondOnboarder.emit("exit", 2);
      await flushEffects();
    });
    expect(latestHook!.state.status).toBe("error");
    expect(latestHook!.state.error).toBe("Codex exited with code 2");
  });

  it("reports a generic refine message when no missing themes or fields are returned", async () => {
    render(<Harness />);

    await act(async () => {
      latestHook!.start(
        "/tmp/appsicle",
        false,
        { name: "claude", command: "claude", args: [], protocol: "claude" } as any,
        undefined,
        "refine",
        ["deployment-contract"],
      );
      await flushEffects();
    });

    const onboarder = mocks.created.at(-1)!;
    await act(async () => {
      onboarder.emit("continue-interview", {
        missingThemes: [],
        missingFields: [],
      });
      await flushEffects();
    });

    expect(latestHook!.state.streamingText).toBe("Roscoe is tightening the intent brief before finishing.");
    expect(latestHook!.state.status).toBe("running");
  });

  it("ignores exit events after the interview is already complete or waiting on a question", async () => {
    render(<Harness />);

    await act(async () => {
      latestHook!.start("/tmp/appsicle");
      await flushEffects();
    });
    const onboarder = mocks.created.at(-1)!;

    await act(async () => {
      onboarder.emit(
        "output",
        `---QUESTION---
{"question":"Which users matter most?","options":["Teachers","Students"],"theme":"primary-users","selectionMode":"multi"}
---END_QUESTION---`,
      );
      onboarder.emit("turn-complete");
      await flushEffects();
    });

    expect(latestHook!.state.status).toBe("interviewing");

    await act(async () => {
      onboarder.emit("exit", 2);
      await flushEffects();
    });
    expect(latestHook!.state.status).toBe("interviewing");

    await act(async () => {
      onboarder.emit("onboarding-complete", { name: "AppSicle" });
      onboarder.emit("exit", 2);
      await flushEffects();
    });
    expect(latestHook!.state.status).toBe("complete");
    expect(latestHook!.state.error).toBeNull();
  });
});
