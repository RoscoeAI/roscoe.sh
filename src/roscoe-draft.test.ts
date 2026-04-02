import { describe, expect, it } from "vitest";
import {
  formatRoscoeDraftDisplayText,
  inferMalformedStructuredDecision,
  inferRoscoeDecision,
  isSilentNoOpReasoning,
  LEGACY_STRUCTURED_PARSE_FALLBACK_REASONING,
  looksLikeRoscoeStructuredDraft,
  MALFORMED_STRUCTURED_DRAFT_REASONING,
  normalizeLegacySidecarErrorText,
  normalizeRoscoeDraftMessage,
  parseRoscoeDraftPayload,
  shouldSuppressRestoredRoscoeSuggestion,
} from "./roscoe-draft.js";

describe("parseRoscoeDraftPayload", () => {
  it("parses a valid Roscoe JSON payload", () => {
    expect(parseRoscoeDraftPayload(
      "{\"decision\":\"message\",\"message\":\"Ship it\",\"confidence\":91,\"reasoning\":\"clear next step\",\"orchestratorActions\":[]}",
    )).toMatchObject({
      decision: "message",
      message: "Ship it",
      confidence: 91,
      reasoning: "clear next step",
      orchestratorActions: [],
    });
  });

  it("parses the first valid JSON object when duplicate payloads are concatenated", () => {
    const text = "{\"message\":\"First\",\"confidence\":88,\"reasoning\":\"r\"}{\"message\":\"Second\",\"confidence\":42,\"reasoning\":\"s\"}";

    expect(parseRoscoeDraftPayload(text)).toMatchObject({
      message: "First",
      confidence: 88,
      reasoning: "r",
    });
  });

  it("parses a valid Roscoe JSON payload even when extra wrapper text surrounds it", () => {
    const text = "Roscoe draft:\n{\"message\":\"Wrapped\",\"confidence\":77,\"reasoning\":\"ok\"}\nend";

    expect(parseRoscoeDraftPayload(text)).toMatchObject({
      message: "Wrapped",
      confidence: 77,
      reasoning: "ok",
    });
  });

  it("parses fenced JSON payloads and keeps only draft-like fields", () => {
    const text = "```json\n{\"message\":\"Wrapped\",\"confidence\":77,\"browserActions\":[],\"hostActions\":[],\"other\":\"ignored\"}\n```";

    expect(parseRoscoeDraftPayload(text)).toEqual({
      message: "Wrapped",
      confidence: 77,
      browserActions: [],
      hostActions: [],
    });
  });

  it("parses explanatory text followed by a fenced JSON payload", () => {
    const text = [
      "Still no new Guild turns. Checking CI one more time.",
      "",
      "```json",
      "{\"decision\":\"host-actions-only\",\"message\":\"\",\"confidence\":30,\"reasoning\":\"No new Guild activity and the existing direction is clear; sending another message would be pure noise.\",\"hostActions\":[{\"type\":\"gh\",\"args\":[\"run\",\"list\",\"--branch\",\"test\",\"--limit\",\"3\"],\"description\":\"check the latest hosted runs\"}]}",
      "```",
    ].join("\n");

    expect(parseRoscoeDraftPayload(text)).toEqual({
      decision: "host-actions-only",
      message: "",
      confidence: 30,
      reasoning: "No new Guild activity and the existing direction is clear; sending another message would be pure noise.",
      hostActions: [
        {
          type: "gh",
          args: ["run", "list", "--branch", "test", "--limit", "3"],
          description: "check the latest hosted runs",
        },
      ],
    });
  });

  it("parses wrapped JSON that contains escaped quotes and braces inside strings", () => {
    const text = 'prefix {"message":"Keep the \\\"preview\\\" adapter around {health}.","confidence":81,"reasoning":"quoted"} suffix';

    expect(parseRoscoeDraftPayload(text)).toEqual({
      message: 'Keep the "preview" adapter around {health}.',
      confidence: 81,
      reasoning: "quoted",
    });
  });

  it("returns null for arrays, missing draft keys, malformed payloads, and text with no JSON", () => {
    expect(parseRoscoeDraftPayload("[1,2,3]")).toBeNull();
    expect(parseRoscoeDraftPayload("{\"foo\":\"bar\"}")).toBeNull();
    expect(parseRoscoeDraftPayload("{\"message\":\"broken\"")).toBeNull();
    expect(parseRoscoeDraftPayload("plain text")).toBeNull();
  });

  it("detects malformed structured Roscoe drafts even when parsing fails", () => {
    const text = "```json\n{\"decision\":\"noop\",\"message\":\"\",\"reasoning\":\"hold silently\"\n```";
    expect(looksLikeRoscoeStructuredDraft(text)).toBe(true);
    expect(inferMalformedStructuredDecision(text)).toBe("noop");
    expect(MALFORMED_STRUCTURED_DRAFT_REASONING).toContain("suppressed the raw JSON");
  });
});

describe("inferRoscoeDecision", () => {
  it("prefers explicit decisions when present", () => {
    expect(inferRoscoeDecision({ decision: "noop", message: "Ship it" })).toBe("noop");
    expect(inferRoscoeDecision({ decision: "restart-worker", message: "Resume from NEXT.md" })).toBe("restart-worker");
  });

  it("classifies host-action-only drafts without relying on wording", () => {
    expect(inferRoscoeDecision({
      message: "",
      reasoning: "whatever",
      hostActions: [{ type: "gh" }],
    })).toBe("host-actions-only");
  });

  it("classifies repeated silent holds as noops", () => {
    expect(inferRoscoeDecision({
      message: "",
      reasoning: "Fourth consecutive no-activity delta; the NEXT.md triage direction was already sent clearly, Guild has not responded, and repeated CI polls are not producing new information — Roscoe should hold silently until a Guild turn or CI completion surfaces.",
    })).toBe("noop");
    expect(isSilentNoOpReasoning("No new Guild activity and the existing direction is clear; sending another message would be pure noise.")).toBe(true);
  });

  it("keeps empty non-noop drafts as needs-review", () => {
    expect(inferRoscoeDecision({
      message: "",
      reasoning: "Still needs clarification.",
    })).toBe("needs-review");
  });

  it("suppresses legacy parse-fallback placeholders on restore", () => {
    expect(shouldSuppressRestoredRoscoeSuggestion({
      message: "No response requested.",
      reasoning: LEGACY_STRUCTURED_PARSE_FALLBACK_REASONING,
    })).toBe(true);
    expect(shouldSuppressRestoredRoscoeSuggestion({
      message: "",
      reasoning: MALFORMED_STRUCTURED_DRAFT_REASONING,
    })).toBe(true);
  });
});

describe("normalizeRoscoeDraftMessage", () => {
  it("extracts the message when present and otherwise returns the original text", () => {
    expect(normalizeRoscoeDraftMessage("{\"message\":\"Ship it\",\"confidence\":91}")).toBe("Ship it");
    expect(normalizeRoscoeDraftMessage("keep going")).toBe("keep going");
  });
});

describe("formatRoscoeDraftDisplayText", () => {
  it("falls back to the hold copy when the normalized message is empty", () => {
    expect(formatRoscoeDraftDisplayText("{\"message\":\"   \"}")).toBe("Roscoe recommends holding the Guild reply for now.");
  });

  it("returns the normalized message when it is present", () => {
    expect(formatRoscoeDraftDisplayText("{\"message\":\"Ship the next slice\"}")).toBe("Ship the next slice");
  });
});

describe("normalizeLegacySidecarErrorText", () => {
  it("expands the old 30s timeout message and leaves other errors untouched", () => {
    expect(normalizeLegacySidecarErrorText("Sidecar timed out after 30s")).toContain("before the timeout was raised");
    expect(normalizeLegacySidecarErrorText("Some other error")).toBe("Some other error");
  });
});
