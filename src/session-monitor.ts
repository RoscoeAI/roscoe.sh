import { EventEmitter } from "events";
import { spawn, ChildProcess, execFileSync } from "child_process";
import { createInterface, Interface } from "readline";
import { dbg } from "./debug-log.js";
import {
  HeadlessProfile,
  buildCommandPreview,
  buildTurnCommand,
  parseSessionStreamLine,
} from "./llm-runtime.js";

export interface SessionEvents {
  text: (chunk: string) => void;
  thinking: (chunk: string) => void;
  "turn-complete": () => void;
  "tool-activity": (toolName: string) => void;
  result: (sessionId: string) => void;
  exit: (code: number) => void;
}

export class SessionMonitor extends EventEmitter {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private sessionId: string | null = null;
  private textBuffer = "";
  private lastPrompt: string | null = null;
  private lastCommandPreview: string | null = null;
  private resolvedCommand: string;
  private cwd: string;
  private profile: HeadlessProfile;

  constructor(
    public readonly id: string,
    profile: HeadlessProfile,
    cwd?: string,
  ) {
    super();
    this.profile = profile;
    this.cwd = cwd || process.cwd();
    this.resolvedCommand = this.resolveCommand(profile.command);
  }

  private resolveCommand(command: string): string {
    if (command.startsWith("/")) return command;
    try {
      return execFileSync("which", [command], { encoding: "utf-8" }).trim();
    } catch {
      return command;
    }
  }

  /**
   * Start a new turn with the given prompt.
   */
  startTurn(prompt: string): void {
    this.lastPrompt = prompt;
    this.lastCommandPreview = buildCommandPreview(
      { ...this.profile, command: this.resolvedCommand },
      this.sessionId,
    );
    const spec = buildTurnCommand(
      { ...this.profile, command: this.resolvedCommand },
      prompt,
      this.sessionId,
    );
    this.spawnProcess(spec.args, spec.env);
  }

  private spawnProcess(args: string[], env: NodeJS.ProcessEnv): void {
    // Clean up any previous process's readline
    this.rl?.close();

    dbg("proc", `spawn ${this.resolvedCommand} ${args.slice(0, 4).join(" ")}... (cwd: ${this.cwd})`);

    const proc = spawn(this.resolvedCommand, args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: env as Record<string, string>,
    });
    this.proc = proc;

    // The headless CLIs receive the prompt via argv, not stdin.
    proc.stdin!.end();

    const rl = createInterface({ input: proc.stdout! });
    this.rl = rl;
    rl.on("line", (line) => this.handleLine(line));

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) dbg("llm:stderr", text);
    });

    // Capture proc reference in closure to avoid race with next spawnProcess call
    proc.on("close", (code) => {
      dbg("proc", `closed with code ${code}`);
      rl.close();
      if (this.proc === proc) {
        this.proc = null;
        this.rl = null;
      }
      this.emit("exit", code ?? 0);
    });
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    parseSessionStreamLine(this.profile, line, {
      onText: (text) => {
        this.textBuffer += text;
        this.emit("text", text);
      },
      onThinking: (text) => {
        this.emit("thinking", text);
      },
      onToolActivity: (toolName) => {
        dbg("event", `tool-use: ${toolName}`);
        this.emit("tool-activity", toolName);
      },
      onSessionId: (sid) => {
        this.sessionId = sid;
        this.emit("result", sid);
      },
      onTurnComplete: () => {
        dbg("event", "turn-complete");
        this.emit("turn-complete");
      },
    });
  }

  /**
   * Send a follow-up message in the same conversation.
   */
  sendFollowUp(text: string): void {
    if (!this.sessionId) {
      throw new Error("No session ID — cannot send follow-up before first turn completes");
    }
    // startTurn already handles --resume when sessionId is set
    this.startTurn(text);
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getTextBuffer(): string {
    return this.textBuffer;
  }

  getLastPrompt(): string | null {
    return this.lastPrompt;
  }

  getLastCommandPreview(): string | null {
    return this.lastCommandPreview;
  }

  setProfile(profile: HeadlessProfile): void {
    this.profile = profile;
    this.resolvedCommand = this.resolveCommand(profile.command);
  }

  clearTextBuffer(): void {
    this.textBuffer = "";
  }

  kill(): void {
    this.proc?.kill();
  }
}
