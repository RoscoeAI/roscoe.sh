import { describe, it, expect, vi } from "vitest";
import { interruptActiveLane } from "./session-interrupt.js";
import { SessionState, AppAction } from "./types.js";
import * as sessionPreview from "./session-preview.js";

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "s1",
    profileName: "claude-code",
    projectName: "nanobots",
    worktreeName: "main",
    startedAt: "2026-03-26T00:00:00.000Z",
    status: "active",
    outputLines: [],
    suggestion: { kind: "idle" },
    managed: {
      monitor: { kill: vi.fn() },
      awaitingInput: false,
      _paused: false,
    } as any,
    summary: null,
    currentToolUse: "Agent",
    currentToolDetail: "tests · chat-interface",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    rateLimitStatus: null,
    timeline: [],
    preview: { mode: "off", message: null, link: null },
    viewMode: "transcript",
    scrollOffset: 0,
    followLive: true,
    ...overrides,
  };
}

describe("interruptActiveLane", () => {
  it("interrupts the active turn and hands control back for manual input", () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = { cancelGeneration: vi.fn() };
    const session = makeSession();

    interruptActiveLane(dispatch, service as any, session);

    expect(service.cancelGeneration).toHaveBeenCalled();
    expect(session.managed.monitor.kill).toHaveBeenCalled();
    expect(session.managed.awaitingInput).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TOOL_ACTIVITY", id: "s1", toolName: null });
    expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_SESSION_STATUS", id: "s1", status: "waiting" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPEND_TIMELINE_ENTRY",
      id: "s1",
      entry: expect.objectContaining({
        kind: "tool-activity",
        provider: "roscoe",
        toolName: "interrupt",
        text: expect.stringContaining("handed control back to you"),
      }),
    }));
    expect(dispatch).toHaveBeenCalledWith({ type: "START_MANUAL", id: "s1" });
  });

  it("forces a queued preview break open instead of dropping into manual input", () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = { cancelGeneration: vi.fn() };
    const session = makeSession({
      preview: {
        mode: "queued",
        message: "Preview queued. Roscoe will stop this lane at the next clean handoff and hold there until you continue.",
        link: null,
      },
      timeline: [
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "claude-code",
          text: "Tests are in place. Start the dev server with npm run dev.",
        },
      ],
    });

    interruptActiveLane(dispatch, service as any, session);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPEND_TIMELINE_ENTRY",
      id: "s1",
      entry: expect.objectContaining({
        text: expect.stringContaining("forced the preview break open"),
      }),
    }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ACTIVATE_PREVIEW_BREAK",
      id: "s1",
      message: expect.stringContaining("Preview ready."),
    }));
    expect(dispatch).not.toHaveBeenCalledWith({ type: "START_MANUAL", id: "s1" });
  });

  it("preserves the preview link when one is already queued", () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = { cancelGeneration: vi.fn() };
    const session = makeSession({
      preview: {
        mode: "queued",
        message: "Preview queued",
        link: "https://preview.example.com",
      },
      timeline: [
        {
          id: "remote-1",
          kind: "remote-turn",
          timestamp: 1,
          provider: "claude-code",
          text: "Preview ready for inspection at https://preview.example.com",
        },
      ],
    });

    interruptActiveLane(dispatch, service as any, session);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ACTIVATE_PREVIEW_BREAK",
      id: "s1",
      link: "https://preview.example.com",
    }));
  });

  it("falls back to the default preview-ready message when no clean preview summary exists yet", () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = { cancelGeneration: vi.fn() };
    const session = makeSession({
      preview: {
        mode: "queued",
        message: "Preview queued",
        link: null,
      },
      timeline: [],
    });

    interruptActiveLane(dispatch, service as any, session);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ACTIVATE_PREVIEW_BREAK",
      id: "s1",
      message: expect.stringContaining("Preview ready."),
    }));
  });

  it("uses the interrupt fallback when the ready preview helper returns no message", () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const service = { cancelGeneration: vi.fn() };
    const session = makeSession({
      preview: {
        mode: "queued",
        message: "Preview queued",
        link: null,
      },
    });

    const spy = vi.spyOn(sessionPreview, "buildReadyPreviewState").mockReturnValue({
      mode: "ready",
      link: null,
      message: null,
    });

    interruptActiveLane(dispatch, service as any, session);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ACTIVATE_PREVIEW_BREAK",
      id: "s1",
      message: "Preview ready.",
    }));

    spy.mockRestore();
  });
});
