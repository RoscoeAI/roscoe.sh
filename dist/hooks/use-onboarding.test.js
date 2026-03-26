import { describe, it, expect } from "vitest";
import { appendStreamingChunk, formatOnboardingExitError, parseQuestion, cleanStreamingText } from "./use-onboarding.js";
describe("parseQuestion", () => {
    it("parses valid question block", () => {
        const text = `Here's my analysis.

---QUESTION---
{"question": "What framework do you use?", "options": ["React", "Vue", "Other (I'll explain)"], "theme": "ui-direction", "purpose": "This determines how Roscoe should judge frontend work.", "selectionMode": "multi"}
---END_QUESTION---`;
        const result = parseQuestion(text);
        expect(result).not.toBeNull();
        expect(result.text).toBe("What framework do you use?");
        expect(result.options).toEqual(["React", "Vue", "Other (I'll explain)"]);
        expect(result.theme).toBe("ui-direction");
        expect(result.purpose).toContain("Roscoe");
        expect(result.selectionMode).toBe("multi");
    });
    it("returns null when no question block", () => {
        expect(parseQuestion("Just plain text")).toBeNull();
    });
    it("returns null for malformed JSON in question block", () => {
        const text = "---QUESTION---\nnot json\n---END_QUESTION---";
        expect(parseQuestion(text)).toBeNull();
    });
    it("returns null when JSON lacks required fields", () => {
        const text = '---QUESTION---\n{"text": "missing question field"}\n---END_QUESTION---';
        expect(parseQuestion(text)).toBeNull();
    });
    it("defaults question selection mode to single when omitted", () => {
        const text = `---QUESTION---
{"question":"One choice?","options":["A","B"]}
---END_QUESTION---`;
        expect(parseQuestion(text)?.selectionMode).toBe("single");
    });
});
describe("cleanStreamingText", () => {
    it("removes QUESTION blocks", () => {
        const text = 'Analysis here\n---QUESTION---\n{"question":"q","options":["a"]}\n---END_QUESTION---';
        expect(cleanStreamingText(text)).toBe("Analysis here");
    });
    it("removes BRIEF blocks", () => {
        const text = 'Summary\n---BRIEF---\n{"name":"proj"}\n---END_BRIEF---';
        expect(cleanStreamingText(text)).toBe("Summary");
    });
    it("removes multiple blocks", () => {
        const text = 'Before\n---QUESTION---\nq\n---END_QUESTION---\nMiddle\n---BRIEF---\nb\n---END_BRIEF---\nAfter';
        const result = cleanStreamingText(text);
        expect(result).toContain("Before");
        expect(result).toContain("Middle");
        expect(result).toContain("After");
        expect(result).not.toContain("QUESTION");
        expect(result).not.toContain("BRIEF");
    });
    it("trims the result", () => {
        expect(cleanStreamingText("  text  ")).toBe("text");
    });
});
describe("appendStreamingChunk", () => {
    it("inserts a space when a new sentence starts in the next chunk", () => {
        expect(appendStreamingChunk("Let me read the project structure and understand the architecture.", "Let me explore the codebase thoroughly before we begin.")).toBe("Let me read the project structure and understand the architecture. Let me explore the codebase thoroughly before we begin.");
    });
    it("does not add an extra space when the next chunk already starts with whitespace", () => {
        expect(appendStreamingChunk("First sentence.", " Second sentence.")).toBe("First sentence. Second sentence.");
    });
    it("does not force spaces into non-sentence chunk boundaries", () => {
        expect(appendStreamingChunk("path/to", "/file.ts")).toBe("path/to/file.ts");
    });
});
describe("formatOnboardingExitError", () => {
    it("labels Codex exits correctly", () => {
        expect(formatOnboardingExitError({ name: "codex", command: "codex", args: [], protocol: "codex" }, 2)).toBe("Codex exited with code 2");
    });
    it("defaults to Claude labeling when no profile is provided", () => {
        expect(formatOnboardingExitError(undefined, 2)).toBe("Claude exited with code 2");
    });
});
