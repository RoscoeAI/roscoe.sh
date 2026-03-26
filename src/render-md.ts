import { marked, type MarkedExtension } from "marked";
// @ts-expect-error no type declarations
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal() as MarkedExtension);

/** Render markdown to terminal-formatted string */
export function renderMd(text: string): string {
  try {
    return (marked.parse(text) as string).trim();
  } catch {
    return text;
  }
}
