import { describe, it, expect, beforeEach } from "vitest";
import { ConversationTracker } from "./conversation-tracker.js";
describe("ConversationTracker", () => {
    let tracker;
    beforeEach(() => {
        tracker = new ConversationTracker();
    });
    describe("addOutput", () => {
        it("accumulates text in pending buffer", () => {
            tracker.addOutput("hello ");
            tracker.addOutput("world");
            tracker.markTurnComplete();
            const history = tracker.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0].content).toBe("hello world");
        });
        it("does not create a message until markTurnComplete", () => {
            tracker.addOutput("pending");
            expect(tracker.getHistory()).toHaveLength(0);
        });
    });
    describe("markTurnComplete", () => {
        it("trims whitespace from accumulated output", () => {
            tracker.addOutput("  spaced  ");
            tracker.markTurnComplete();
            expect(tracker.getHistory()[0].content).toBe("spaced");
        });
        it("ignores empty/whitespace-only output", () => {
            tracker.addOutput("   ");
            tracker.markTurnComplete();
            expect(tracker.getHistory()).toHaveLength(0);
        });
        it("sets role to assistant", () => {
            tracker.addOutput("response");
            tracker.markTurnComplete();
            expect(tracker.getHistory()[0].role).toBe("assistant");
        });
        it("resets pending buffer after completing", () => {
            tracker.addOutput("first");
            tracker.markTurnComplete();
            tracker.addOutput("second");
            tracker.markTurnComplete();
            expect(tracker.getHistory()).toHaveLength(2);
            expect(tracker.getHistory()[1].content).toBe("second");
        });
    });
    describe("recordUserInput", () => {
        it("adds a user message", () => {
            tracker.recordUserInput("do something");
            const msg = tracker.getHistory()[0];
            expect(msg.role).toBe("user");
            expect(msg.content).toBe("do something");
        });
        it("trims input text", () => {
            tracker.recordUserInput("  padded  ");
            expect(tracker.getHistory()[0].content).toBe("padded");
        });
    });
    describe("getHistory", () => {
        it("returns a copy, not the internal array", () => {
            tracker.recordUserInput("msg");
            const history = tracker.getHistory();
            history.push({ role: "system", content: "injected", timestamp: 0 });
            expect(tracker.getHistory()).toHaveLength(1);
        });
    });
    describe("getRecentHistory", () => {
        it("returns only the last N messages", () => {
            for (let i = 0; i < 30; i++) {
                tracker.recordUserInput(`msg ${i}`);
            }
            expect(tracker.getRecentHistory(5)).toHaveLength(5);
            expect(tracker.getRecentHistory(5)[0].content).toBe("msg 25");
        });
        it("defaults to 20 messages", () => {
            for (let i = 0; i < 30; i++) {
                tracker.recordUserInput(`msg ${i}`);
            }
            expect(tracker.getRecentHistory()).toHaveLength(20);
        });
    });
    describe("getLastAssistantMessage", () => {
        it("returns null when no messages exist", () => {
            expect(tracker.getLastAssistantMessage()).toBeNull();
        });
        it("returns null when only user messages exist", () => {
            tracker.recordUserInput("hello");
            expect(tracker.getLastAssistantMessage()).toBeNull();
        });
        it("returns the most recent assistant message", () => {
            tracker.addOutput("first response");
            tracker.markTurnComplete();
            tracker.recordUserInput("follow up");
            tracker.addOutput("second response");
            tracker.markTurnComplete();
            expect(tracker.getLastAssistantMessage()).toBe("second response");
        });
    });
    describe("getContextForGeneration", () => {
        it("formats messages with role labels", () => {
            tracker.recordUserInput("do the thing");
            tracker.addOutput("done");
            tracker.markTurnComplete();
            const context = tracker.getContextForGeneration();
            expect(context).toContain("User: do the thing");
            expect(context).toContain("LLM: done");
        });
        it("returns empty string for no messages", () => {
            expect(tracker.getContextForGeneration()).toBe("");
        });
    });
});
