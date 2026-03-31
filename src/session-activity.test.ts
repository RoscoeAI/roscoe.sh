import { describe, expect, it } from "vitest";
import {
  getToolActivityLiveText,
  getToolActivityNoteText,
  getToolActivityStatusLabel,
  getToolActivitySummary,
} from "./session-activity.js";

describe("session-activity", () => {
  describe("getToolActivitySummary", () => {
    it("returns null when there is no tool name", () => {
      expect(getToolActivitySummary(null)).toBeNull();
      expect(getToolActivitySummary(undefined, "Guild · tests · unit")).toBeNull();
    });

    it("prefers explicit test/check details over generic tool summaries", () => {
      expect(getToolActivitySummary("bash", "tests · unit suite")).toBe("running tests");
      expect(getToolActivitySummary("bash", "checks · lint + typecheck")).toBe("running checks");
    });

    it("maps known tools to user-facing summaries", () => {
      expect(getToolActivitySummary("command_execution", "using command_execution")).toBe("running shell commands");
      expect(getToolActivitySummary("bash", "using bash")).toBe("running shell commands");
      expect(getToolActivitySummary("read")).toBe("reading files");
      expect(getToolActivitySummary("write")).toBe("editing files");
      expect(getToolActivitySummary("edit")).toBe("editing files");
      expect(getToolActivitySummary("multiedit")).toBe("editing files");
      expect(getToolActivitySummary("grep")).toBe("searching the codebase");
      expect(getToolActivitySummary("glob")).toBe("searching the codebase");
      expect(getToolActivitySummary("file_search")).toBe("searching the codebase");
      expect(getToolActivitySummary("websearch")).toBe("checking the web");
      expect(getToolActivitySummary("webfetch")).toBe("checking the web");
      expect(getToolActivitySummary("browser.open")).toBe("inspecting the app in the browser");
      expect(getToolActivitySummary("mcp__chrome_devtools__click")).toBe("inspecting the app in the browser");
      expect(getToolActivitySummary("todowrite")).toBe("planning the next step");
      expect(getToolActivitySummary("task")).toBe("planning the next step");
      expect(getToolActivitySummary("plan")).toBe("planning the next step");
      expect(getToolActivitySummary("agent")).toBe("delegating work");
      expect(getToolActivitySummary("interrupt")).toBe("interrupting current turn");
      expect(getToolActivitySummary("resume")).toBe("resuming interrupted lane");
    });

    it("humanizes unknown tool names", () => {
      expect(getToolActivitySummary("CustomHTTPTool")).toBe("custom httptool");
      expect(getToolActivitySummary("snake_case-tool")).toBe("snake case tool");
    });
  });

  describe("getToolActivityStatusLabel", () => {
    it("prefers explicit detail and preserves Guild-prefixed text", () => {
      expect(getToolActivityStatusLabel("bash", "Guild · checks · lint")).toBe("Guild · checks · lint");
      expect(getToolActivityStatusLabel("bash", "tests · unit suite")).toBe("Guild · tests · unit suite");
    });

    it("prefixes summaries unless they already read as guild or roscoe text", () => {
      expect(getToolActivityStatusLabel("bash", "using bash")).toBe("Guild · running shell commands");
      expect(getToolActivityStatusLabel("GuildHelper")).toBe("guild helper");
      expect(getToolActivityStatusLabel("RoscoePlan")).toBe("roscoe plan");
      expect(getToolActivityStatusLabel(null)).toBeNull();
    });
  });

  describe("getToolActivityLiveText", () => {
    it("returns explicit detail when present", () => {
      expect(getToolActivityLiveText("bash", "checks · lint")).toBe("checks · lint");
    });

    it("capitalizes the summary for live text", () => {
      expect(getToolActivityLiveText("bash", "using bash")).toBe("Running shell commands now");
      expect(getToolActivityLiveText(null)).toBeNull();
    });
  });

  describe("getToolActivityNoteText", () => {
    it("returns specific detail when present", () => {
      expect(getToolActivityNoteText("bash", "Guild · command_execution")).toBe("Guild · command_execution");
    });

    it("falls back to the summary when the detail is generic", () => {
      expect(getToolActivityNoteText("resume", "using resume")).toBe("resuming interrupted lane");
      expect(getToolActivityNoteText(undefined)).toBeNull();
    });
  });
});
