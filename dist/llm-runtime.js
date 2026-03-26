import { spawn } from "child_process";
import { basename } from "path";
import { createInterface } from "readline";
export function detectProtocol(profile) {
    if (profile.protocol)
        return profile.protocol;
    const hint = `${basename(profile.command)} ${profile.name}`.toLowerCase();
    if (hint.includes("codex"))
        return "codex";
    return "claude";
}
export function buildTurnCommand(profile, prompt, sessionId) {
    const protocol = detectProtocol(profile);
    const env = { ...process.env };
    const runtime = profile.runtime;
    if (protocol === "codex") {
        const globalArgs = [];
        const execArgs = ["--json", "--skip-git-repo-check"];
        if (runtime?.model) {
            globalArgs.push("-m", runtime.model);
        }
        if (runtime?.reasoningEffort) {
            globalArgs.push("-c", `model_reasoning_effort="${runtime.reasoningEffort}"`);
        }
        if (runtime?.bypassApprovalsAndSandbox) {
            globalArgs.push("--dangerously-bypass-approvals-and-sandbox");
        }
        else {
            if (runtime?.sandboxMode) {
                globalArgs.push("-s", runtime.sandboxMode);
            }
            if (runtime?.approvalPolicy) {
                globalArgs.push("-a", runtime.approvalPolicy);
            }
        }
        if (sessionId) {
            return {
                command: profile.command,
                args: [
                    ...globalArgs,
                    "exec",
                    ...execArgs,
                    ...profile.args,
                    "resume",
                    sessionId,
                    prompt,
                ],
                env,
            };
        }
        return {
            command: profile.command,
            args: [
                ...globalArgs,
                "exec",
                ...execArgs,
                ...profile.args,
                prompt,
            ],
            env,
        };
    }
    delete env.CLAUDECODE;
    const args = [
        ...(runtime?.model ? ["--model", runtime.model] : []),
        ...(runtime?.reasoningEffort ? ["--effort", runtime.reasoningEffort] : []),
        ...(runtime?.dangerouslySkipPermissions
            ? ["--dangerously-skip-permissions"]
            : runtime?.permissionMode
                ? ["--permission-mode", runtime.permissionMode]
                : []),
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        ...profile.args,
    ];
    if (sessionId) {
        args.push("--resume", sessionId);
    }
    return {
        command: profile.command,
        args,
        env,
    };
}
function shellQuote(value) {
    if (!/[\s"'\\]/.test(value))
        return value;
    return JSON.stringify(value);
}
export function buildCommandPreview(profile, sessionId) {
    const spec = buildTurnCommand(profile, "<prompt>", sessionId);
    return [spec.command, ...spec.args].map(shellQuote).join(" ");
}
export function summarizeRuntime(profile) {
    const protocol = detectProtocol(profile);
    const runtime = profile.runtime;
    const parts = [protocol];
    if (runtime?.model)
        parts.push(runtime.model);
    if (runtime?.reasoningEffort)
        parts.push(runtime.reasoningEffort);
    if (protocol === "claude") {
        if (runtime?.dangerouslySkipPermissions) {
            parts.push("dangerous");
        }
        else if (runtime?.permissionMode) {
            parts.push(runtime.permissionMode);
        }
    }
    else {
        if (runtime?.sandboxMode)
            parts.push(runtime.sandboxMode);
        if (runtime?.approvalPolicy)
            parts.push(runtime.approvalPolicy);
    }
    return parts.join(" · ");
}
export function parseSessionStreamLine(profile, line, handlers) {
    if (!line.trim())
        return;
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch {
        return;
    }
    if (detectProtocol(profile) === "codex") {
        parseCodexSessionLine(parsed, handlers);
        return;
    }
    parseClaudeSessionLine(parsed, handlers);
}
export function parseOneShotStreamLine(profile, line) {
    if (!line.trim())
        return {};
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch {
        return {};
    }
    if (detectProtocol(profile) === "codex") {
        const item = parsed.item;
        if (parsed.type === "item.completed" &&
            item?.type === "agent_message" &&
            typeof item.text === "string") {
            return { replaceText: item.text };
        }
        return {};
    }
    if (parsed.type === "stream_event") {
        const event = parsed.event;
        const delta = event?.delta;
        if (event?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
            return { appendText: delta.text };
        }
        return {};
    }
    if (parsed.type === "result" && typeof parsed.result === "string") {
        return { replaceText: parsed.result };
    }
    return {};
}
export function startOneShotRun(profile, prompt, options = {}) {
    const spec = buildTurnCommand(profile, prompt);
    const proc = spawn(spec.command, spec.args, {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: spec.env,
    });
    proc.stdin?.end();
    let accumulated = "";
    let stderrText = "";
    let timedOut = false;
    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
        const event = parseOneShotStreamLine(profile, line);
        if (event.appendText) {
            accumulated += event.appendText;
            options.onText?.(accumulated);
            return;
        }
        if (event.replaceText && !accumulated) {
            accumulated = event.replaceText;
            options.onText?.(accumulated);
        }
    });
    const result = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            timedOut = true;
            proc.kill();
        }, options.timeoutMs ?? 30_000);
        proc.stderr?.on("data", (chunk) => {
            stderrText += chunk.toString();
        });
        proc.on("close", (code) => {
            clearTimeout(timeout);
            rl.close();
            const cancelled = proc.killed && !timedOut;
            if (timedOut) {
                reject(new Error("LLM timed out"));
                return;
            }
            if (cancelled) {
                reject(new Error("LLM run was cancelled"));
                return;
            }
            if (code !== 0) {
                const message = stderrText.trim().split("\n")[0] || `LLM process failed (exit code ${code})`;
                reject(new Error(message));
                return;
            }
            if (!accumulated.trim()) {
                reject(new Error("LLM produced no output"));
                return;
            }
            resolve(accumulated.trim());
        });
    });
    return { proc, result };
}
function parseClaudeSessionLine(parsed, handlers) {
    const type = parsed.type;
    if (type === "stream_event") {
        const event = parsed.event;
        const eventType = event?.type;
        if (eventType === "content_block_delta") {
            const delta = event?.delta;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
                handlers.onText?.(delta.text);
            }
            else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
                handlers.onThinking?.(delta.thinking);
            }
            return;
        }
        if (eventType === "content_block_start") {
            const block = event?.content_block;
            if (block?.type === "tool_use" && typeof block.name === "string") {
                handlers.onToolActivity?.(block.name);
            }
        }
        return;
    }
    if (type === "result") {
        if (typeof parsed.session_id === "string") {
            handlers.onSessionId?.(parsed.session_id);
        }
        if (parsed.stop_reason === "end_turn") {
            handlers.onTurnComplete?.();
        }
    }
}
function parseCodexSessionLine(parsed, handlers) {
    const type = parsed.type;
    if (type === "thread.started" && typeof parsed.thread_id === "string") {
        handlers.onSessionId?.(parsed.thread_id);
        return;
    }
    if (type === "turn.completed") {
        handlers.onTurnComplete?.();
        return;
    }
    if (!type?.startsWith("item."))
        return;
    const item = parsed.item;
    if (!item || typeof item.type !== "string")
        return;
    if (item.type === "agent_message" && type === "item.completed" && typeof item.text === "string") {
        handlers.onText?.(item.text);
        return;
    }
    if (type === "item.started") {
        handlers.onToolActivity?.(item.type);
    }
}
