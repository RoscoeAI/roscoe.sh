import { describe, expect, it } from "vitest";

import { stripAnsi, stripDisplayMarkdown, wrapBlock, wrapLine } from "./text-layout.js";

describe("text-layout", () => {
  it("strips ANSI escape sequences", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m plain")).toBe("red plain");
  });

  it("strips display markdown while preserving readable text", () => {
    expect(
      stripDisplayMarkdown("## **Hello**\n> *world*\n- `code`\n[Roscoe](https://roscoe.sh)\r\t"),
    ).toBe("Hello\nworld\n- code\nRoscoe  ");
  });

  it("wraps blank and short lines safely", () => {
    expect(wrapLine("", 5)).toEqual([""]);
    expect(wrapLine("short line", 40)).toEqual(["short line"]);
  });

  it("wraps long words and multiple words across lines", () => {
    expect(wrapLine("supercalifragilistic", 6)).toEqual([
      "supercalifra",
      "gilistic",
    ]);
    expect(wrapLine("alpha beta gamma", 12)).toEqual([
      "alpha beta",
      "gamma",
    ]);
    expect(wrapLine("alpha supercalifragilistic", 12)).toEqual([
      "alpha",
      "supercalifra",
      "gilistic",
    ]);
  });

  it("wraps markdown blocks with indentation and preserves paragraph gaps", () => {
    expect(
      wrapBlock("**Alpha** beta\n\nGamma delta epsilon", 16, "  "),
    ).toEqual([
      "  Alpha beta",
      "",
      "  Gamma delta",
      "  epsilon",
    ]);
  });

  it("returns the trimmed indent when the wrapped block is otherwise empty", () => {
    expect(wrapBlock("   \n\n", 20, "    ")).toEqual([""]);
  });

  it("drops trailing blank paragraphs from wrapped blocks", () => {
    expect(wrapBlock("Alpha\n\n", 20)).toEqual(["Alpha"]);
  });
});
