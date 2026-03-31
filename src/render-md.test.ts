import { describe, expect, it, vi } from "vitest";

const { mockParse, mockUse, mockMarkedTerminal } = vi.hoisted(() => ({
  mockParse: vi.fn(),
  mockUse: vi.fn(),
  mockMarkedTerminal: vi.fn(() => ({ renderer: "terminal" })),
}));

vi.mock("marked", () => ({
  marked: {
    parse: mockParse,
    use: mockUse,
  },
}));

vi.mock("marked-terminal", () => ({
  markedTerminal: mockMarkedTerminal,
}));

import { renderMd } from "./render-md.js";

describe("renderMd", () => {
  it("registers the terminal renderer and returns parsed markdown", () => {
    mockParse.mockReturnValue(" rendered ");

    expect(renderMd("**hello**")).toBe("rendered");
    expect(mockParse).toHaveBeenCalledWith("**hello**");
  });

  it("falls back to the original text when marked throws", () => {
    mockParse.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(renderMd("raw text")).toBe("raw text");
  });
});
