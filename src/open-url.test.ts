import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentPlatform, mockSpawn } = vi.hoisted(() => ({
  currentPlatform: { value: "darwin" },
  mockSpawn: vi.fn(),
}));

vi.mock("os", () => ({
  platform: () => currentPlatform.value,
}));

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}));

import { openExternalUrl } from "./open-url.js";

function createChild() {
  return {
    once: vi.fn(),
    unref: vi.fn(),
  };
}

describe("openExternalUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses open on macOS", async () => {
    currentPlatform.value = "darwin";
    const child = createChild();
    mockSpawn.mockReturnValue(child);

    await openExternalUrl("https://roscoe.sh");

    expect(mockSpawn).toHaveBeenCalledWith("open", ["https://roscoe.sh"], {
      detached: true,
      stdio: "ignore",
    });
    expect(child.once).toHaveBeenCalledWith("error", expect.any(Function));
    expect(child.unref).toHaveBeenCalled();
  });

  it("uses cmd /c start on Windows", async () => {
    currentPlatform.value = "win32";
    const child = createChild();
    mockSpawn.mockReturnValue(child);

    await openExternalUrl("https://roscoe.sh");

    expect(mockSpawn).toHaveBeenCalledWith("cmd", ["/c", "start", "", "https://roscoe.sh"], {
      detached: true,
      stdio: "ignore",
    });
  });

  it("uses xdg-open on Linux", async () => {
    currentPlatform.value = "linux";
    const child = createChild();
    mockSpawn.mockReturnValue(child);

    await openExternalUrl("https://roscoe.sh");

    expect(mockSpawn).toHaveBeenCalledWith("xdg-open", ["https://roscoe.sh"], {
      detached: true,
      stdio: "ignore",
    });
  });
});
