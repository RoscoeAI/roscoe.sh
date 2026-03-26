import { describe, it, expect, vi } from "vitest";
import { InputInjector } from "./input-injector.js";
describe("InputInjector", () => {
    const injector = new InputInjector();
    function makeMockMonitor(sessionId) {
        return {
            getSessionId: vi.fn(() => sessionId),
            startTurn: vi.fn(),
            sendFollowUp: vi.fn(),
        };
    }
    it("calls startTurn when no session ID exists", () => {
        const monitor = makeMockMonitor(null);
        injector.inject(monitor, "hello");
        expect(monitor.startTurn).toHaveBeenCalledWith("hello");
        expect(monitor.sendFollowUp).not.toHaveBeenCalled();
    });
    it("calls sendFollowUp when session ID exists", () => {
        const monitor = makeMockMonitor("session-123");
        injector.inject(monitor, "follow up");
        expect(monitor.sendFollowUp).toHaveBeenCalledWith("follow up");
        expect(monitor.startTurn).not.toHaveBeenCalled();
    });
    it("passes the exact text to the monitor method", () => {
        const monitor = makeMockMonitor(null);
        const text = "complex message\nwith newlines";
        injector.inject(monitor, text);
        expect(monitor.startTurn).toHaveBeenCalledWith(text);
    });
});
