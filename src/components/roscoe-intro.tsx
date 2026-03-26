import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

const WORD = "ROSCOE";
const LETTER_TICK_MS = 60;
const TAGLINE = "Autopilot for Claude & Codex CLIs";
const RAIL_WIDTH = 34;
const WHEEL_FRAMES = ["-*-", "\\|/", "-+-", "/|\\"];
const HEAD_FRAMES = [
  ["     ____     ", " ___/ __ \\___ ", "[___|_[]_|___]", "    /_||_\\    "],
  ["     ____     ", " ___/ __ \\___ ", "[___|_oo_|___]", "   _/_||_\\_   "],
  ["    _====_    ", " __/ /__\\ \\__ ", "[___|####|___]", "   _/_||_\\_   "],
  ["     ____     ", " ___/____\\___ ", "[___|====|___]", "    \\_||_/    "],
] as const;
const SPIN_FRAMES = [
  [
    "  ||  ",
    "  ||  ",
    "  ||  ",
    "  ||  ",
    "  ||  ",
  ],
  [
    "  /\\  ",
    " //|  ",
    "</||> ",
    "  |\\\\ ",
    "  \\/  ",
  ],
  [
    " .--. ",
    "/_[]_\\",
    "|====|",
    "|_[]_|",
    " '--' ",
  ],
  [
    "  /\\  ",
    "  |\\\\ ",
    " <||\\>",
    " //|  ",
    "  \\/  ",
  ],
  [
    "  ||  ",
    " /||  ",
    "  ||  ",
    "  ||\\ ",
    "  ||  ",
  ],
] as const;
const LETTER_PHASE_TICKS = SPIN_FRAMES.length + 1;

const LETTER_ART: Record<string, string[]> = {
  R: [
    "RRRR  ",
    "R   R ",
    "RRRR  ",
    "R  R  ",
    "R   R ",
  ],
  O: [
    " OOO  ",
    "O   O ",
    "O   O ",
    "O   O ",
    " OOO  ",
  ],
  S: [
    " SSSS ",
    "S     ",
    " SSS  ",
    "    S ",
    "SSSS  ",
  ],
  C: [
    " CCCC ",
    "C     ",
    "C     ",
    "C     ",
    " CCCC ",
  ],
  E: [
    "EEEEE ",
    "E     ",
    "EEE   ",
    "E     ",
    "EEEEE ",
  ],
};

const BLANK_LETTER = [
  "      ",
  "      ",
  "      ",
  "      ",
  "      ",
];

export function buildRoscoeWordmark(revealCount: number, activeSpinPhase: number | null = null): string[] {
  const letters = WORD.split("").map((letter, index) => {
    if (index < revealCount) return LETTER_ART[letter];
    if (index === revealCount && activeSpinPhase !== null) {
      return SPIN_FRAMES[Math.min(activeSpinPhase, SPIN_FRAMES.length - 1)];
    }
    return BLANK_LETTER;
  });
  return Array.from({ length: BLANK_LETTER.length }, (_, row) =>
    letters.map((art) => art[row]).join(" "),
  );
}

export function buildPulseRail(width: number, tick: number): string {
  const chars = Array.from({ length: Math.max(6, width) }, () => "=");
  const step = Math.floor(tick / 2) % chars.length;
  const mirror = chars.length - 1 - step;
  chars[step] = "o";
  chars[mirror] = "o";
  return chars.join("");
}

function placeGlyph(width: number, center: number, glyph: string): string {
  const safeWidth = Math.max(glyph.length + 2, width);
  const start = Math.max(0, Math.min(safeWidth - glyph.length, center - Math.floor(glyph.length / 2)));
  const chars = Array.from({ length: safeWidth }, () => " ");

  for (let i = 0; i < glyph.length; i += 1) {
    chars[start + i] = glyph[i];
  }

  return chars.join("");
}

function buildTelegraphHead(width: number, activeIndex: number, phase: number): string[] {
  const slotWidth = LETTER_ART.R[0].length + 1;
  const center = Math.min(width - 1, activeIndex * slotWidth + Math.floor(LETTER_ART.R[0].length / 2));
  return HEAD_FRAMES[phase % HEAD_FRAMES.length].map((glyph) => placeGlyph(width, center, glyph));
}

interface RoscoeIntroProps {
  onDone: () => void;
}

export function RoscoeIntro({ onDone }: RoscoeIntroProps) {
  const [tick, setTick] = useState(0);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((current) => current + 1);
    }, LETTER_TICK_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  useInput((input, key) => {
    if (key.ctrl || key.meta) return;
    if (input || key.return || key.escape || key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || key.tab) {
      finish();
    }
  });

  const totalRevealTicks = WORD.length * LETTER_PHASE_TICKS;
  const revealStep = Math.min(WORD.length - 1, Math.floor(Math.min(tick, Math.max(0, totalRevealTicks - 1)) / LETTER_PHASE_TICKS));
  const phase = tick < totalRevealTicks ? tick % LETTER_PHASE_TICKS : 0;
  const titleSettled = tick >= totalRevealTicks;
  const stampedLetters = titleSettled ? WORD.length : revealStep + (phase === LETTER_PHASE_TICKS - 1 ? 1 : 0);
  const activeSpinPhase = titleSettled || phase === LETTER_PHASE_TICKS - 1 ? null : phase;
  const wordmark = useMemo(
    () => buildRoscoeWordmark(stampedLetters, activeSpinPhase),
    [activeSpinPhase, stampedLetters],
  );
  const taglineChars = Math.max(0, tick - totalRevealTicks + 6);
  const rail = buildPulseRail(RAIL_WIDTH, tick);
  const wheelFrame = WHEEL_FRAMES[Math.floor(tick / 4) % WHEEL_FRAMES.length];
  const visibleTagline = TAGLINE.slice(0, Math.min(TAGLINE.length, taglineChars));
  const showPrompt = tick > totalRevealTicks + 18;
  const promptVisible = showPrompt && Math.floor(tick / 10) % 2 === 0;
  const headLines = !titleSettled
    ? buildTelegraphHead(wordmark[0]?.length ?? 0, revealStep, phase)
    : [];

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="round"
      borderColor="yellow"
      overflow="hidden"
    >
      <Box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <Box justifyContent="center">
          <Text color="yellow" dimColor>{`${wheelFrame} ${rail} ${wheelFrame}`}</Text>
        </Box>

        {headLines.length > 0 && (
          <Box flexDirection="column">
            {headLines.map((line, index) => (
              <Box key={`head-${index}`} justifyContent="center">
                <Text color={index === 1 ? "white" : "yellow"}>{line}</Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          {wordmark.map((line, index) => (
            <Box key={`wordmark-${index}`} justifyContent="center">
              <Text color="yellow" bold>{line}</Text>
            </Box>
          ))}
        </Box>

        <Box justifyContent="center">
          <Text bold>{visibleTagline || " "}</Text>
        </Box>

        <Box justifyContent="center">
          <Text color="yellow" dimColor>{`${wheelFrame} ${rail.split("").reverse().join("")} ${wheelFrame}`}</Text>
        </Box>

        <Box justifyContent="center">
          <Text color={promptVisible ? "cyan" : "gray"}>
            {showPrompt ? "Press any key to begin." : " "}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
