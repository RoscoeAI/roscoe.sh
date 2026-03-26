import { jsx as _jsx } from "react/jsx-runtime";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { SuggestionBar } from "./suggestion-bar.js";
const noop = vi.fn();
const defaultProps = {
    onSubmitEdit: noop,
    onSubmitManual: noop,
};
describe("SuggestionBar", () => {
    it("shows monitoring message in idle phase", () => {
        const { lastFrame } = render(_jsx(SuggestionBar, { phase: { kind: "idle" }, ...defaultProps }));
        expect(lastFrame()).toContain("Session working...");
    });
    it("shows spinner in generating phase", () => {
        const { lastFrame } = render(_jsx(SuggestionBar, { phase: { kind: "generating" }, ...defaultProps }));
        expect(lastFrame()).toContain("Thinking...");
    });
    it("shows partial text alongside spinner when available", () => {
        const { lastFrame } = render(_jsx(SuggestionBar, { phase: { kind: "generating", partial: '{"message": "working on it' }, ...defaultProps }));
        const frame = lastFrame();
        expect(frame).toContain("Thinking...");
        expect(frame).toContain('"message": "working on it');
    });
    it("shows suggestion text and confidence in ready phase", () => {
        const phase = {
            kind: "ready",
            result: { text: "Do the thing", confidence: 85, reasoning: "clear context" },
        };
        const { lastFrame } = render(_jsx(SuggestionBar, { phase: phase, ...defaultProps }));
        const frame = lastFrame();
        expect(frame).toContain("Do the thing");
        expect(frame).toContain("85/100");
        expect(frame).toContain("[a] approve");
    });
    it("shows error message in error phase", () => {
        const phase = { kind: "error", message: "API timeout" };
        const { lastFrame } = render(_jsx(SuggestionBar, { phase: phase, ...defaultProps }));
        expect(lastFrame()).toContain("API timeout");
        expect(lastFrame()).toContain("[m]");
    });
    it("shows manual input prompt in manual-input phase", () => {
        const { lastFrame } = render(_jsx(SuggestionBar, { phase: { kind: "manual-input" }, ...defaultProps }));
        expect(lastFrame()).toContain("Your message");
    });
});
