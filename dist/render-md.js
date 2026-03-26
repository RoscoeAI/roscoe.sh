import { marked } from "marked";
// @ts-expect-error no type declarations
import { markedTerminal } from "marked-terminal";
marked.use(markedTerminal());
/** Render markdown to terminal-formatted string */
export function renderMd(text) {
    try {
        return marked.parse(text).trim();
    }
    catch {
        return text;
    }
}
