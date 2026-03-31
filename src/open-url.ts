import { spawn } from "child_process";
import { platform } from "os";

export async function openExternalUrl(url: string): Promise<void> {
  const currentPlatform = platform();
  const command = currentPlatform === "darwin"
    ? "open"
    : currentPlatform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = currentPlatform === "win32" ? ["/c", "start", "", url] : [url];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.unref();
    resolve();
  });
}
