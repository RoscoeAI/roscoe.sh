import { jsx as _jsx } from "react/jsx-runtime";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { StatusBar } from "./status-bar.js";
describe("StatusBar", () => {
    it("displays project name", () => {
        const { lastFrame } = render(_jsx(StatusBar, { projectName: "myapp", worktreeName: "main", autoMode: false, sessionCount: 1, viewMode: "transcript", followLive: true }));
        expect(lastFrame()).toContain("myapp");
    });
    it("shows AUTO badge when autoMode is true", () => {
        const { lastFrame } = render(_jsx(StatusBar, { projectName: "proj", worktreeName: "main", autoMode: true, sessionCount: 0, viewMode: "transcript", followLive: true }));
        expect(lastFrame()).toContain("AUTO");
    });
    it("shows MANUAL badge when autoMode is false", () => {
        const { lastFrame } = render(_jsx(StatusBar, { projectName: "proj", worktreeName: "main", autoMode: false, sessionCount: 0, viewMode: "transcript", followLive: true }));
        expect(lastFrame()).toContain("MANUAL");
    });
    it("shows session count", () => {
        const { lastFrame } = render(_jsx(StatusBar, { projectName: "proj", worktreeName: "main", autoMode: false, sessionCount: 3, viewMode: "raw", followLive: false }));
        expect(lastFrame()).toContain("3 sessions");
        expect(lastFrame()).toContain("raw");
        expect(lastFrame()).toContain("SCROLLED");
        expect(lastFrame()).toContain("text question");
    });
    it("uses singular for 1 session", () => {
        const { lastFrame } = render(_jsx(StatusBar, { projectName: "proj", worktreeName: "main", autoMode: false, sessionCount: 1, viewMode: "transcript", followLive: true }));
        expect(lastFrame()).toContain("1 session");
        expect(lastFrame()).not.toContain("1 sessions");
    });
});
