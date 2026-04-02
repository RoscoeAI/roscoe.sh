import { ChildProcess, spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

let keepAwakeProcess: ChildProcess | null = null;

function getWindowsKeepAwakeCommand(): string {
  const systemRoot = process.env.SystemRoot;
  if (systemRoot) {
    const powershellPath = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (existsSync(powershellPath)) {
      return powershellPath;
    }
  }
  return "powershell.exe";
}

export function isRoscoeKeepAwakeSupported(): boolean {
  if (process.env.NODE_ENV === "test") {
    return false;
  }
  if (process.platform === "darwin") {
    return existsSync("/usr/bin/caffeinate");
  }
  if (process.platform === "win32") {
    return true;
  }
  return false;
}

function clearKeepAwakeProcess(processRef: ChildProcess): void {
  if (keepAwakeProcess === processRef) {
    keepAwakeProcess = null;
  }
}

function startKeepAwake(): void {
  if (!isRoscoeKeepAwakeSupported() || keepAwakeProcess) {
    return;
  }

  const child = process.platform === "darwin"
    ? spawn("/usr/bin/caffeinate", ["-dimsu", "-w", String(process.pid)], {
      stdio: "ignore",
    })
    : spawn(getWindowsKeepAwakeCommand(), [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RoscoeKeepAwake { [DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags); }';",
        "$flags = 0x80000000 -bor 0x00000001 -bor 0x00000002;",
        "try {",
        `  while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {`,
        "    [RoscoeKeepAwake]::SetThreadExecutionState($flags) | Out-Null;",
        "    Start-Sleep -Seconds 30;",
        "  }",
        "} finally {",
        "  [RoscoeKeepAwake]::SetThreadExecutionState(0x80000000) | Out-Null;",
        "}",
      ].join(" "),
    ], {
      stdio: "ignore",
    });

  child.on("exit", () => {
    clearKeepAwakeProcess(child);
  });
  child.on("error", () => {
    clearKeepAwakeProcess(child);
  });
  child.unref();
  keepAwakeProcess = child;
}

function stopKeepAwake(): void {
  if (!keepAwakeProcess) {
    return;
  }

  keepAwakeProcess.kill("SIGTERM");
  keepAwakeProcess = null;
}

export function setRoscoeKeepAwakeEnabled(enabled: boolean): void {
  if (enabled) {
    startKeepAwake();
    return;
  }

  stopKeepAwake();
}

export function resetRoscoeKeepAwakeForTests(): void {
  stopKeepAwake();
}
