const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function stripDisplayMarkdown(text: string): string {
  return stripAnsi(text)
    .replace(/\r/g, "")
    .replace(/\t/g, "  ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "- ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1");
}

function wrapWord(word: string, width: number): string[] {
  if (word.length <= width) return [word];
  const parts: string[] = [];
  for (let i = 0; i < word.length; i += width) {
    parts.push(word.slice(i, i + width));
  }
  return parts;
}

export function wrapLine(text: string, width: number): string[] {
  const safeWidth = Math.max(12, width);
  const normalized = text.trimEnd();
  if (!normalized) return [""];

  const words = normalized.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      const parts = wrapWord(word, safeWidth);
      current = parts.shift() ?? "";
      for (const part of parts) {
        lines.push(current);
        current = part;
      }
      continue;
    }

    if ((current + " " + word).length <= safeWidth) {
      current = `${current} ${word}`;
      continue;
    }

    lines.push(current);
    const parts = wrapWord(word, safeWidth);
    current = parts.shift() ?? "";
    for (const part of parts) {
      lines.push(current);
      current = part;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export function wrapBlock(text: string, width: number, indent = ""): string[] {
  const normalized = stripDisplayMarkdown(text);
  const paragraphs = normalized.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    for (const line of wrapLine(paragraph, Math.max(12, width - indent.length))) {
      lines.push(`${indent}${line}`);
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.length > 0 ? lines : [indent.trimEnd()];
}
