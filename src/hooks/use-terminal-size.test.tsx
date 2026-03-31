import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useTerminalSize } from "./use-terminal-size.js";

function Harness() {
  const size = useTerminalSize();
  return <Text>{`${size.columns}x${size.rows}`}</Text>;
}

describe("useTerminalSize", () => {
  it("uses the current stdout size and updates on resize", async () => {
    const originalColumns = process.stdout.columns;
    const originalRows = process.stdout.rows;

    process.stdout.columns = 120;
    process.stdout.rows = 40;

    const app = render(<Harness />);
    expect(app.lastFrame()).toContain("120x40");

    process.stdout.columns = 88;
    process.stdout.rows = 22;
    process.stdout.emit("resize");

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(app.lastFrame()).toContain("88x22");

    process.stdout.columns = originalColumns;
    process.stdout.rows = originalRows;
  });

  it("falls back to 80x24 when stdout dimensions are missing", () => {
    const originalColumns = process.stdout.columns;
    const originalRows = process.stdout.rows;

    process.stdout.columns = undefined as unknown as number;
    process.stdout.rows = undefined as unknown as number;

    const app = render(<Harness />);
    expect(app.lastFrame()).toContain("80x24");

    process.stdout.columns = undefined as unknown as number;
    process.stdout.rows = undefined as unknown as number;
    process.stdout.emit("resize");

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(app.lastFrame()).toContain("80x24");
        process.stdout.columns = originalColumns;
        process.stdout.rows = originalRows;
        resolve();
      }, 10);
    });
  });

  it("removes the resize listener on unmount", () => {
    const offSpy = vi.spyOn(process.stdout, "off");
    const app = render(<Harness />);
    app.unmount();
    expect(offSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    offSpy.mockRestore();
  });
});
