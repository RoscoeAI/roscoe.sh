import { describe, expect, it } from "vitest";
import {
  formatRoscoeDraftDisplayText,
  normalizeLegacySidecarErrorText,
  normalizeRoscoeDraftMessage,
  parseRoscoeDraftPayload,
} from "./roscoe-draft.js";

describe("parseRoscoeDraftPayload", () => {
  it("parses a valid Roscoe JSON payload", () => {
    expect(parseRoscoeDraftPayload(
      "{\"message\":\"Ship it\",\"confidence\":91,\"reasoning\":\"clear next step\",\"orchestratorActions\":[]}",
    )).toMatchObject({
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
    const text = "```json\n{\"message\":\"Wrapped\",\"confidence\":77,\"browserActions\":[],\"other\":\"ignored\"}\n```";

    expect(parseRoscoeDraftPayload(text)).toEqual({
      message: "Wrapped",
      confidence: 77,
      browserActions: [],
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
