import { describe, expect, it } from "vitest";

import {
  createSmsEntry,
  deriveSmsQuestion,
  getActiveLaneSummary,
  getClosedPersistStatus,
  normalizeInlineText,
} from "./session-view.js";

describe("session-view helpers", () => {
  it("creates unique sms timeline entries", () => {
    const first = createSmsEntry("sms", "lane-1", { kind: "error", text: "First" });
    const second = createSmsEntry("sms", "lane-1", { kind: "error", text: "Second" });

    expect(first.id).not.toBe(second.id);
    expect(first.kind).toBe("error");
    expect(second.text).toBe("Second");
  });

  it("derives the latest question from the most recent remote turn", () => {
    const question = deriveSmsQuestion({
      id: "lane-1",
      timeline: [
        { kind: "remote-turn", text: "First statement." } as any,
        { kind: "remote-turn", text: "What changed? What should we do next?" } as any,
      ],
      managed: {
        tracker: {
          getLastAssistantMessage: () => "Fallback question?",
        },
      },
    });

    expect(question).toBe("What should we do next?");
  });

  it("falls back to the last assistant message and truncates long text when no explicit question exists", () => {
    const message = "word ".repeat(70);
    const question = deriveSmsQuestion({
      id: "lane-1",
      timeline: [],
      managed: {
        tracker: {
          getLastAssistantMessage: () => message,
        },
      },
    });

    expect(question).toContain("...");
    expect(question?.length).toBeLessThanOrEqual(220);
  });

  it("returns null when there is no clear sms question source", () => {
    expect(deriveSmsQuestion({
      id: "lane-1",
      timeline: [],
      managed: {
        tracker: {
          getLastAssistantMessage: () => null,
        },
      },
    })).toBeNull();
  });

  it("normalizes inline text and truncates at the requested length", () => {
    expect(normalizeInlineText("   alpha\n\n beta   ")).toBe("alpha beta");
    expect(normalizeInlineText("x".repeat(120), 20)).toBe(`${"x".repeat(80)}...`);
    expect(normalizeInlineText("   ")).toBe("");
  });

  it("prefers the latest substantive blocked-lane remote turn over a pause acknowledgement", () => {
    const summary = getActiveLaneSummary({
      status: "blocked",
      summary: "fallback summary",
      timeline: [
        { kind: "remote-turn", text: "Paused." },
        { kind: "remote-turn", text: "Blocker unchanged: preview is still not healthy." },
      ],
    } as any);

    expect(summary).toBe("Blocker unchanged: preview is still not healthy.");
  });

  it("falls back to the saved summary when the blocked lane only has pause acknowledgements", () => {
    const summary = getActiveLaneSummary({
      status: "blocked",
      summary: "fallback summary",
      timeline: [
        { kind: "remote-turn", text: "Paused." },
      ],
    } as any);

    expect(summary).toBe("fallback summary");
  });

  it("returns null for a missing session and returns the summary for non-blocked lanes", () => {
    expect(getActiveLaneSummary(null)).toBeNull();
    expect(getActiveLaneSummary({
      status: "active",
      summary: "current summary",
      timeline: [],
    } as any)).toBe("current summary");
  });

  it("maps closed lanes to persisted statuses", () => {
    expect(getClosedPersistStatus({ status: "blocked", suggestion: { kind: "idle" } } as any)).toBe("blocked");
    expect(getClosedPersistStatus({ status: "active", suggestion: { kind: "ready" } } as any)).toBe("review");
    expect(getClosedPersistStatus({ status: "active", suggestion: { kind: "idle" } } as any)).toBe("waiting");
  });
});
