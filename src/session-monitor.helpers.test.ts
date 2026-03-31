import { describe, expect, it } from "vitest";
import {
  formatToolDetail,
  looksLikeTestCommand,
  pickStringArrayField,
  pickStringField,
  sanitizeAgentTask,
  summarizeAgentTask,
  truncateDetail,
} from "./session-monitor.js";

describe("session-monitor helpers", () => {
  it("truncates long detail strings and preserves shorter ones", () => {
    expect(truncateDetail("short")).toBe("short");
    expect(truncateDetail("x".repeat(100), 20)).toBe("x".repeat(24) + "...");
  });

  it("picks string and string-array fields from parsed tool input", () => {
    expect(pickStringField({ foo: "", bar: " value " }, ["foo", "bar"])).toBe(" value ");
    expect(pickStringField({ foo: 1 }, ["foo", "bar"])).toBeNull();
    expect(pickStringArrayField({ files: ["a", "", 1, "b"] }, ["files"])).toEqual(["a", "b"]);
    expect(pickStringArrayField({ files: "bad" }, ["files"])).toEqual([]);
  });

  it("normalizes agent task summaries for tests, checks, and generic work", () => {
    expect(sanitizeAgentTask('  "Run chat tests..."  ')).toBe('"Run chat tests..."');
    expect(sanitizeAgentTask("`Investigate lint drift...`")).toBe("Investigate lint drift");
    expect(looksLikeTestCommand("pnpm vitest run")).toBe(true);
    expect(looksLikeTestCommand("draft a changelog")).toBe(false);
    expect(summarizeAgentTask("")).toBe("agent · working");
    expect(summarizeAgentTask("Run pnpm vitest run chat-interface")).toBe("tests · pnpm vitest run chat-interface");
    expect(summarizeAgentTask("Please rerun tests for lane setup")).toBe("tests · lane setup");
    expect(summarizeAgentTask("verify lint and build")).toBe("checks · verify lint and build");
    expect(summarizeAgentTask("investigate websocket auth drift")).toBe("agent · investigate websocket auth drift");
  });

  it("formats bash, read, grep, glob, edit, plan, browser, and agent tool detail", () => {
    expect(formatToolDetail("Bash", '{"command":"pnpm test"}')).toBe("bash · pnpm test");
    expect(formatToolDetail("Read", '{"paths":["a.ts","b.ts"]}')).toBe("read · 2 files");
    expect(formatToolDetail("Grep", '{"pattern":"needle","path":"src/file.ts"}')).toBe("grep · needle @ src/file.ts");
    expect(formatToolDetail("Glob", '{"pattern":"src/**/*.ts"}')).toBe("glob · src/**/*.ts");
    expect(formatToolDetail("Edit", '{"path":"src/file.ts"}')).toBe("edit · src/file.ts");
    expect(formatToolDetail("TodoWrite", '{"todos":["a","b"]}')).toBe("plan · 2 items");
    expect(formatToolDetail("Browser", '{"url":"https://roscoe.sh/docs"}')).toBe("browser · https://roscoe.sh/docs");
    expect(formatToolDetail("Agent", '{"task":"Run unit tests for chat interface"}')).toBe("tests · unit chat interface");
  });

  it("falls back gracefully for raw malformed json and generic string content", () => {
    expect(formatToolDetail("Agent", '{"prompt":"Run tests for lane setup"}')).toBe("tests · lane setup");
    expect(formatToolDetail("Bash", '{"command":"pnpm test"')).toBe("bash · pnpm test");
    expect(formatToolDetail("Read", '{"file_path":"src/index.ts"')).toBe("read · src/index.ts");
    expect(formatToolDetail("Grep", '{"query":"needle"')).toBe("grep · needle");
    expect(formatToolDetail("Edit", '{"path":"src/file.ts"')).toBe("edit · src/file.ts");
    expect(formatToolDetail("Agent", '{"description":"Verify build and lint"')).toBe("checks · Verify build and lint");
    expect(formatToolDetail("UnknownTool", '{"message":"hello world"}')).toBe("unknowntool · hello world");
    expect(formatToolDetail("UnknownTool", "")).toBeNull();
  });

  it("covers additional tool-detail fallbacks and parser branches", () => {
    expect(formatToolDetail("Read", '{"path":"src/index.ts"}')).toBe("read · src/index.ts");
    expect(formatToolDetail("Read", '{"paths":["src/index.ts"]}')).toBe("read · src/index.ts");
    expect(formatToolDetail("Grep", '{"pattern":"needle"}')).toBe("grep · needle");
    expect(formatToolDetail("File_Search", '{"query":"session setup"}')).toBe("grep · session setup");
    expect(formatToolDetail("Write", '{"file_path":"src/new.ts"}')).toBe("edit · src/new.ts");
    expect(formatToolDetail("TodoWrite", '{"items":[]}')).toBe("plan · update");
    expect(formatToolDetail("Agent", '{"tasks":["Investigate websocket auth drift"]}')).toBe("agent · Investigate websocket auth drift");
    expect(formatToolDetail("Agent", '{"description":"Verify build and lint"}')).toBe("checks · Verify build and lint");
    expect(formatToolDetail("BrowserNavigate", '{"selector":"button.save"}')).toBe("browser · button.save");
    expect(formatToolDetail("Agent", '{"message":"Run tests for session monitor"}')).toBe("tests · session monitor");
    expect(formatToolDetail("Agent", '{"note":"Investigate websocket auth drift"}')).toBe("agent · Investigate websocket auth drift");
    expect(formatToolDetail("Agent", "{}")).toBeNull();
  });
});
