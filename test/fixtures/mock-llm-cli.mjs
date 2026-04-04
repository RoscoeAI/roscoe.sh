#!/usr/bin/env node

import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from "fs";

const provider = process.argv[2];
const args = process.argv.slice(3);
const scenarioPath = process.env.MOCK_LLM_SCENARIO_FILE;
const statePath = process.env.MOCK_LLM_STATE_FILE;
const logPath = process.env.MOCK_LLM_LOG_FILE;

if (!provider || !scenarioPath || !statePath) {
  console.error("mock-llm-cli requires provider, MOCK_LLM_SCENARIO_FILE, and MOCK_LLM_STATE_FILE");
  process.exit(2);
}

const scenario = JSON.parse(readFileSync(scenarioPath, "utf-8"));
const parsed = provider === "codex"
  ? parseCodexArgs(args)
  : provider === "gemini"
    ? parseGeminiArgs(args)
    : provider === "qwen"
      ? parseQwenArgs(args)
    : provider === "kimi"
      ? parseKimiArgs(args)
      : parseClaudeArgs(args);
const { callIndex, call } = await reserveMatchingCallIndex(
  scenario.calls || [],
  statePath,
  provider,
  parsed,
);
if (!call) {
  if (logPath) {
    appendFileSync(
      logPath,
      `${JSON.stringify({
        provider,
        prompt: parsed.prompt,
        resumeId: parsed.resumeId ?? null,
        args,
        matchedIndex: null,
        noMatch: true,
      })}\n`,
    );
  }
  console.error(`No matching mock call configured for ${provider} prompt=${parsed.prompt} resume=${parsed.resumeId}`);
  process.exit(2);
} else if (logPath) {
  appendFileSync(
    logPath,
    `${JSON.stringify({ provider, prompt: parsed.prompt, resumeId: parsed.resumeId ?? null, args, matchedIndex: callIndex })}\n`,
  );
}

if (call.stderr) {
  process.stderr.write(call.stderr);
}

await sleep(call.delayMs || 0);

if (!shouldSkipTurnOutput(call)) {
  if (provider === "codex") {
    await emitCodex(call, callIndex);
  } else if (provider === "gemini") {
    await emitGemini(call, callIndex);
  } else if (provider === "qwen") {
    await emitQwen(call, callIndex);
  } else if (provider === "kimi") {
    await emitKimi(call, callIndex);
  } else {
    await emitClaude(call, callIndex);
  }
}

process.exit(call.exitCode ?? 0);

async function emitClaude(call, index) {
  if (call.toolActivity) {
    println({
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: {
          type: "tool_use",
          name: call.toolActivity,
        },
      },
    });
  }

  if (call.thinking) {
    await sleep(call.chunkDelayMs || 0);
    println({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: {
          type: "thinking_delta",
          thinking: call.thinking,
        },
      },
    });
  }

  for (const chunk of getChunks(call.text || "")) {
    await sleep(call.chunkDelayMs || 0);
    println({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: chunk,
        },
      },
    });
  }

  if (call.skipCompletion) {
    return;
  }

  await sleep(call.chunkDelayMs || 0);
  println({
    type: "result",
    session_id: call.sessionId || `mock-claude-${index}`,
    stop_reason: "end_turn",
    result: call.resultText,
  });
}

async function emitCodex(call, index) {
  println({
    type: "thread.started",
    thread_id: call.sessionId || `mock-codex-${index}`,
  });
  println({ type: "turn.started" });

  if (call.toolActivity) {
    await sleep(call.chunkDelayMs || 0);
    println({
      type: "item.started",
      item: {
        id: "tool_0",
        type: call.toolActivity,
      },
    });
  }

  if (call.skipCompletion) {
    return;
  }

  await sleep(call.chunkDelayMs || 0);
  println({
    type: "item.completed",
    item: {
      id: "item_0",
      type: "agent_message",
      text: getText(call.text),
    },
  });

  await sleep(call.chunkDelayMs || 0);
  println({
    type: "turn.completed",
    usage: {
      input_tokens: 1,
      output_tokens: 1,
    },
  });
}

async function emitGemini(call, index) {
  println({
    type: "init",
    session_id: call.sessionId || `mock-gemini-${index}`,
    model: "gemini-3-flash-preview",
  });
  println({
    type: "message",
    role: "user",
    content: call.promptEcho || "prompt",
  });

  if (call.toolActivity) {
    await sleep(call.chunkDelayMs || 0);
    println({
      type: "tool_use",
      tool_name: call.toolActivity,
      tool_id: "tool_0",
      parameters: call.toolParameters || {},
    });
  }

  for (const chunk of getChunks(call.text || "")) {
    await sleep(call.chunkDelayMs || 0);
    println({
      type: "message",
      role: "assistant",
      content: chunk,
      delta: true,
    });
  }

  if (call.skipCompletion) {
    return;
  }

  await sleep(call.chunkDelayMs || 0);
  println({
    type: "result",
    status: "success",
    stats: {
      input_tokens: 1,
      output_tokens: 1,
    },
  });
}

async function emitKimi(call, index) {
  process.stdout.write(`To resume this session: kimi -r ${call.sessionId || `mock-kimi-${index}`}\n`);

  if (call.toolActivity || call.thinking) {
    await sleep(call.chunkDelayMs || 0);
    println({
      role: "assistant",
      ...(call.toolActivity
        ? {
            tool_calls: [
              {
                function: {
                  name: call.toolActivity,
                  arguments: JSON.stringify(call.toolParameters || {}),
                },
              },
            ],
          }
        : {}),
      content: call.thinking
        ? [{ type: "think", think: call.thinking }]
        : [],
    });
  }

  if (call.skipCompletion) {
    return;
  }

  await sleep(call.chunkDelayMs || 0);
  println({
    role: "assistant",
    content: getChunks(call.text || "").map((chunk) => ({
      type: "text",
      text: chunk,
    })),
  });
}

async function emitQwen(call, index) {
  println({
    type: "system",
    subtype: "init",
    session_id: call.sessionId || `mock-qwen-${index}`,
    model: "coder-model",
    permission_mode: "yolo",
  });

  if (call.thinking) {
    await sleep(call.chunkDelayMs || 0);
    println({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: {
          type: "thinking_delta",
          thinking: call.thinking,
        },
      },
    });
  }

  if (call.toolActivity) {
    await sleep(call.chunkDelayMs || 0);
    println({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          name: call.toolActivity,
          input: call.toolParameters || {},
        },
      },
    });
  }

  for (const chunk of getChunks(call.text || "")) {
    await sleep(call.chunkDelayMs || 0);
    println({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: chunk,
        },
      },
    });
  }

  if (call.skipCompletion) {
    return;
  }

  await sleep(call.chunkDelayMs || 0);
  println({
    type: "assistant",
    message: {
      content: [
        ...(call.thinking ? [{ type: "thinking", thinking: call.thinking }] : []),
        ...(call.toolActivity
          ? [{ type: "tool_use", name: call.toolActivity, input: call.toolParameters || {} }]
          : []),
        ...getChunks(call.text || "").map((chunk) => ({
          type: "text",
          text: chunk,
        })),
      ],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
      },
      stop_reason: "end_turn",
    },
  });

  await sleep(call.chunkDelayMs || 0);
  println({
    type: "result",
    subtype: "success",
    session_id: call.sessionId || `mock-qwen-${index}`,
    result: getText(call.text),
    usage: {
      input_tokens: 1,
      output_tokens: 1,
    },
  });
}

function getChunks(text) {
  if (!text) return [];
  if (Array.isArray(text)) return text;
  return [text];
}

function getText(text) {
  if (!text) return "";
  if (Array.isArray(text)) return text.join("");
  return text;
}

function shouldSkipTurnOutput(call) {
  if (!call || !call.exitCode || call.exitCode === 0) return false;
  const hasText = Array.isArray(call.text) ? call.text.length > 0 : Boolean(call.text);
  return !hasText
    && !call.resultText
    && !call.sessionId
    && !call.toolActivity
    && !call.thinking;
}

function parseClaudeArgs(args) {
  const promptIndex = args.indexOf("-p");
  const resumeIndex = args.indexOf("--resume");
  return {
    prompt: promptIndex === -1 ? "" : args[promptIndex + 1] || "",
    resumeId: resumeIndex === -1 ? null : args[resumeIndex + 1] || null,
  };
}

function parseCodexArgs(args) {
  const execIndex = args.indexOf("exec");
  if (execIndex === -1) {
    throw new Error(`Unsupported codex invocation: ${args.join(" ")}`);
  }

  const valueOptions = new Set([
    "-m",
    "--model",
    "-s",
    "--sandbox",
    "-a",
    "--ask-for-approval",
    "-c",
    "--config",
    "-p",
    "--profile",
    "-C",
    "--cd",
    "--add-dir",
  ]);
  const execArgs = args.slice(execIndex + 1);
  const resumeIndex = execArgs.indexOf("resume");
  const isResume = resumeIndex !== -1;
  const positional = [];

  for (let i = 0; i < execArgs.length; i += 1) {
    const value = execArgs[i];
    if (i === resumeIndex && value === "resume") {
      continue;
    }
    if (value === "--json" || value === "--skip-git-repo-check" || value === "--dangerously-bypass-approvals-and-sandbox") {
      continue;
    }
    if (value.includes("=") && value.startsWith("--")) {
      continue;
    }
    if (valueOptions.has(value)) {
      i += 1;
      continue;
    }
    if (value.startsWith("-")) {
      continue;
    }
    positional.push(value);
  }

  if (isResume) {
    return {
      resumeId: positional.at(-2) || null,
      prompt: positional.at(-1) || "",
    };
  }

  return {
    resumeId: null,
    prompt: positional.at(-1) || "",
  };
}

function parseGeminiArgs(args) {
  const promptIndex = args.indexOf("-p");
  const resumeIndex = args.indexOf("--resume");
  return {
    prompt: promptIndex === -1 ? "" : args[promptIndex + 1] || "",
    resumeId: resumeIndex === -1 ? null : args[resumeIndex + 1] || null,
  };
}

function parseQwenArgs(args) {
  const valueOptions = new Set([
    "-m",
    "--model",
    "-p",
    "--prompt",
    "--approval-mode",
    "-o",
    "--output-format",
    "--resume",
    "--session-id",
    "--input-format",
    "--auth-type",
    "--channel",
    "--sandbox-image",
    "--extensions",
    "--include-directories",
    "--add-dir",
    "--allowed-mcp-server-names",
    "--allowed-tools",
    "--openai-api-key",
    "--openai-base-url",
    "--tavily-api-key",
    "--google-api-key",
    "--google-search-engine-id",
    "--web-search-default",
    "--system-prompt",
    "--append-system-prompt",
    "--max-session-turns",
    "--core-tools",
    "--exclude-tools",
  ]);
  const promptIndex = args.indexOf("-p") !== -1 ? args.indexOf("-p") : args.indexOf("--prompt");
  const resumeIndex = args.indexOf("--resume");
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (valueOptions.has(value)) {
      i += 1;
      continue;
    }
    if (value === "--sandbox" || value === "--include-partial-messages" || value === "--yolo" || value === "--continue") {
      continue;
    }
    if (value.startsWith("-")) {
      continue;
    }
    positional.push(value);
  }

  return {
    prompt: promptIndex === -1 ? positional.at(-1) || "" : args[promptIndex + 1] || "",
    resumeId: resumeIndex === -1 ? null : args[resumeIndex + 1] || null,
  };
}

function parseKimiArgs(args) {
  const promptIndex = args.indexOf("-p");
  const resumeIndex = args.indexOf("--resume");
  return {
    prompt: promptIndex === -1 ? "" : args[promptIndex + 1] || "",
    resumeId: resumeIndex === -1 ? null : args[resumeIndex + 1] || null,
  };
}

function println(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function findMatchingCallIndex(calls, used, provider, parsed) {
  return calls.findIndex((call, index) => {
    if (used.includes(index)) return false;
    if (call.provider !== provider) return false;
    if ((call.resumeId || null) !== (parsed.resumeId || null)) return false;

    if (call.promptIncludes && !parsed.prompt.includes(call.promptIncludes)) {
      return false;
    }

    if (Array.isArray(call.promptIncludesAll)) {
      if (!call.promptIncludesAll.every((needle) => parsed.prompt.includes(needle))) {
        return false;
      }
    }

    if (Array.isArray(call.promptExcludesAll)) {
      if (call.promptExcludesAll.some((needle) => parsed.prompt.includes(needle))) {
        return false;
      }
    }

    return true;
  });
}

async function reserveMatchingCallIndex(calls, statePath, provider, parsed) {
  return withFileLock(`${statePath}.lock`, async () => {
    const state = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, "utf-8"))
      : { used: [] };
    const callIndex = findMatchingCallIndex(calls, state.used || [], provider, parsed);
    if (callIndex !== -1) {
      writeFileSync(statePath, JSON.stringify({ used: [...(state.used || []), callIndex] }));
    }
    return {
      callIndex,
      call: callIndex === -1 ? null : calls[callIndex],
    };
  });
}

async function withFileLock(lockPath, fn) {
  const started = Date.now();
  for (;;) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      break;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        if (Date.now() - started > 5000) {
          throw new Error(`Timed out waiting for mock scenario lock: ${lockPath}`);
        }
        await sleep(5);
        continue;
      }
      throw error;
    }
  }

  try {
    return await fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
