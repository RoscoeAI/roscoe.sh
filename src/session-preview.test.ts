import { describe, expect, it } from "vitest";
import {
  buildQueuedPreviewState,
  buildReadyPreviewState,
  getPreviewState,
  recoverPreviewState,
} from "./session-preview.js";

describe("recoverPreviewState", () => {
  it("recovers a queued preview as ready after a paused Guild handoff", () => {
    const source = {
      timeline: [
        {
          id: "preview-1",
          kind: "preview" as const,
          timestamp: 1,
          state: "queued" as const,
          text: "Preview queued. Roscoe will stop this lane at the next clean handoff and hold there until you continue.",
          link: null,
        },
        {
          id: "remote-1",
          kind: "remote-turn" as const,
          timestamp: 2,
          provider: "claude-code",
          text: "Paused.",
        },
      ],
      outputLines: [],
      summary: null,
    };

    expect(recoverPreviewState(undefined, source)).toMatchObject({
      mode: "ready",
    });
  });

  it("does not recover preview state from old queued notes alone", () => {
    const source = {
      timeline: [
        {
          id: "preview-1",
          kind: "preview" as const,
          timestamp: 1,
          state: "queued" as const,
          text: "Preview queued.",
          link: null,
        },
        {
          id: "remote-1",
          kind: "remote-turn" as const,
          timestamp: 2,
          provider: "claude-code",
          text: "Tests passed and the next blocker is auth wiring.",
        },
      ],
      outputLines: [],
      summary: null,
    };

    expect(recoverPreviewState(undefined, source)).toEqual({
      mode: "off",
      message: null,
      link: null,
    });
  });

  it("returns the current preview state when one is already active", () => {
    expect(recoverPreviewState(
      { mode: "ready", message: "Preview ready", link: "https://preview.example.com" },
      { timeline: [], outputLines: [], summary: null },
    )).toEqual({
      mode: "ready",
      message: "Preview ready",
      link: "https://preview.example.com",
    });
  });
});

describe("preview state helpers", () => {
  it("normalizes missing and off preview states", () => {
    expect(getPreviewState(undefined)).toEqual({ mode: "off", message: null, link: null });
    expect(getPreviewState({ mode: "off", message: "ignored", link: "ignored" })).toEqual({ mode: "off", message: null, link: null });
  });

  it("builds queued preview state from links or falls back to the generic queued copy", () => {
    expect(buildQueuedPreviewState({
      timeline: [{ id: "remote-1", kind: "remote-turn", timestamp: 1, provider: "claude", text: "Preview at localhost:3000/demo." }],
      outputLines: [],
      summary: null,
    })).toEqual({
      mode: "queued",
      link: "http://localhost:3000/demo",
      message: "Preview queued. Roscoe will stop at the next clean handoff. Current preview link on deck: http://localhost:3000/demo",
    });

    expect(buildQueuedPreviewState({
      timeline: [],
      outputLines: [],
      summary: null,
    })).toEqual({
      mode: "queued",
      link: null,
      message: "Preview queued. Roscoe will stop this lane at the next clean handoff and hold there until you continue.",
    });
  });

  it("builds ready preview state from a link, a preview command, or the latest remote summary", () => {
    expect(buildReadyPreviewState({
      timeline: [{ id: "remote-1", kind: "remote-turn", timestamp: 1, provider: "claude", text: "Open https://preview.example.com)." }],
      outputLines: [],
      summary: null,
    })).toEqual({
      mode: "ready",
      link: "https://preview.example.com",
      message: "Preview ready. Open https://preview.example.com, inspect the current app state, then press [c] to continue with a follow-up or [b] to clear the break.",
    });

    expect(buildReadyPreviewState({
      timeline: [],
      outputLines: ["Use `pnpm dev` and then inspect the UI"],
      summary: null,
    }).message).toContain("Use `pnpm dev` and then inspect the UI`");

    expect(buildReadyPreviewState({
      timeline: [{ id: "remote-2", kind: "remote-turn", timestamp: 1, provider: "claude", text: "A".repeat(180) }],
      outputLines: [],
      summary: null,
    }).message).toContain("AAA");

    expect(buildReadyPreviewState({
      timeline: [],
      outputLines: [],
      summary: null,
    })).toEqual({
      mode: "ready",
      link: null,
      message: "Preview ready. No preview link was detected yet. Review the latest Guild update, inspect the current app, then press [c] to continue with a follow-up or [b] to clear the break.",
    });
  });

  it("coerces non-string remote text when building the preview summary", () => {
    expect(buildReadyPreviewState({
      timeline: [{ id: "remote-3", kind: "remote-turn", timestamp: 1, provider: "qwen", text: { message: "Preview is ready at localhost:4321" } as any }],
      outputLines: [],
      summary: null,
    }).message).toContain("http://localhost:4321");
  });
});
