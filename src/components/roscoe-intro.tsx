import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

const WORD = "ROSCOE";
const FRAME_TICK_MS = 100;
const TAGLINE = "Autopilot for Claude & Codex CLIs";
const FRAME_WIDTH = 80;
const FRAME_HEIGHT = 24;
const LETTER_PHASE_TICKS = 4;

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

const BRAND_FRAMES = [
  [
    "      ",
    "  ..  ",
    " .... ",
    "  ..  ",
    "      ",
  ],
  [
    "      ",
    "  ::  ",
    " :::: ",
    "  ::  ",
    "      ",
  ],
  [
    "      ",
    "  ||  ",
    " |||| ",
    "  ||  ",
    "      ",
  ],
] as const;

const BLANK_LETTER = [
  "      ",
  "      ",
  "      ",
  "      ",
  "      ",
];

const WHEEL_TEMPLATE = [
  "  /----\\  ",
  " /      \\ ",
  "/        \\",
  "|        |",
  "|        |",
  "|        |",
  "|        |",
  "\\        /",
  " \\      / ",
  "  \\----/  ",
] as const;

const WHEEL_TOP = 7;
const WHEEL_LEFT = 28;
const WHEEL_CENTER_ROW = WHEEL_TOP + 4;
const WHEEL_CENTER_COL = WHEEL_LEFT + 4;
const BUCKET_SLOTS = [
  { row: 2, col: 4 },
  { row: 3, col: 6 },
  { row: 4, col: 7 },
  { row: 6, col: 6 },
  { row: 7, col: 4 },
  { row: 6, col: 2 },
  { row: 4, col: 1 },
  { row: 3, col: 2 },
] as const;

function createCanvas(): string[][] {
  return Array.from({ length: FRAME_HEIGHT }, () => Array.from({ length: FRAME_WIDTH }, () => " "));
}

function writeText(canvas: string[][], row: number, col: number, text: string): void {
  if (row < 0 || row >= FRAME_HEIGHT) return;
  for (let index = 0; index < text.length; index += 1) {
    const targetCol = col + index;
    if (targetCol < 0 || targetCol >= FRAME_WIDTH) continue;
    canvas[row][targetCol] = text[index];
  }
}

function writeTransparent(canvas: string[][], row: number, col: number, text: string): void {
  if (row < 0 || row >= FRAME_HEIGHT) return;
  for (let index = 0; index < text.length; index += 1) {
    const targetCol = col + index;
    if (targetCol < 0 || targetCol >= FRAME_WIDTH) continue;
    if (text[index] !== " ") {
      canvas[row][targetCol] = text[index];
    }
  }
}

function renderCanvas(canvas: string[][]): string[] {
  return canvas.map((row) => row.join(""));
}

function buildSpokes(phase: number): Array<{ row: number; col: number; char: string }> {
  switch (phase % 4) {
    case 0:
      return [
        { row: 3, col: 4, char: "|" },
        { row: 5, col: 4, char: "|" },
        { row: 4, col: 3, char: "-" },
        { row: 4, col: 5, char: "-" },
      ];
    case 1:
      return [
        { row: 3, col: 3, char: "\\" },
        { row: 5, col: 5, char: "\\" },
        { row: 3, col: 5, char: "/" },
        { row: 5, col: 3, char: "/" },
      ];
    case 2:
      return [
        { row: 2, col: 4, char: "|" },
        { row: 6, col: 4, char: "|" },
        { row: 4, col: 2, char: "-" },
        { row: 4, col: 6, char: "-" },
      ];
    default:
      return [
        { row: 2, col: 2, char: "\\" },
        { row: 6, col: 6, char: "\\" },
        { row: 2, col: 6, char: "/" },
        { row: 6, col: 2, char: "/" },
      ];
  }
}

function buildMillFrame(phase: number): string[] {
  const canvas = createCanvas();

  writeText(canvas, 0, 0, "~~~~≈≈≈≈≈≈~~~~≈≈≈≈≈≈~~~~≈≈≈≈≈~~~~");
  writeText(canvas, 1, 0, "≈≈≈≈~~~~≈≈≈≈≈≈~~~~≈≈≈≈≈≈~~~~≈≈≈≈");
  writeText(canvas, 2, 0, "~~~~≈≈≈≈≈≈~~~~≈≈≈≈≈≈~~~~≈≈≈≈≈~~~~");
  writeText(canvas, 3, 0, "≈≈≈≈~~~~≈≈≈≈≈≈~~~~≈≈≈≈≈≈~~~~≈≈≈≈");

  writeText(canvas, 4, 12, "[=======][=======][=======]");
  writeText(canvas, 5, 34, "||");
  writeText(canvas, 6, 35, "||");

  WHEEL_TEMPLATE.forEach((line, index) => {
    writeText(canvas, WHEEL_TOP + index, WHEEL_LEFT, line);
  });

  for (const spoke of buildSpokes(phase)) {
    canvas[WHEEL_TOP + spoke.row][WHEEL_LEFT + spoke.col] = spoke.char;
  }

  canvas[WHEEL_CENTER_ROW][WHEEL_CENTER_COL] = "+";

  for (let slot = 0; slot < 4; slot += 1) {
    const bucket = BUCKET_SLOTS[(phase + slot * 2) % BUCKET_SLOTS.length];
    const bucketChar = (phase + slot) % 2 === 0 ? "U" : "V";
    canvas[WHEEL_TOP + bucket.row][WHEEL_LEFT + bucket.col] = bucketChar;
  }

  const fallCol = 37 + Math.floor((phase % 2));
  const fallChars = [".", ",", ":", "|"];
  for (let row = 5; row <= 11; row += 1) {
    canvas[row][fallCol] = fallChars[(phase + row) % fallChars.length];
  }

  canvas[15][36] = ".";
  canvas[16][37] = ",";
  canvas[17][38] = ":";
  canvas[18][39] = "|";

  writeText(canvas, 5, 56, "      XXXXXXXXXXXXXX");
  writeText(canvas, 6, 55, "     XXX XXXXXX X XXX");
  writeText(canvas, 7, 56, "####################");
  writeText(canvas, 8, 56, "##      [ ]       ##");
  writeText(canvas, 9, 56, "##                ##");
  writeText(canvas, 10, 56, "##      ____      ##");
  writeText(canvas, 11, 56, "##     | __ |     ##");
  writeText(canvas, 12, 56, "##     ||  ||     ##");
  writeText(canvas, 13, 56, "##     ||__||     ##");
  writeText(canvas, 14, 56, "##                ##");
  writeText(canvas, 15, 56, "####################");

  writeText(canvas, 17, 22, "________________________________________________________");
  writeText(canvas, 18, 22, "_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _");
  writeText(canvas, 19, 36, "~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~");
  writeText(canvas, 20, 42, `~ ${fallChars[phase % fallChars.length]} ~ ${fallChars[(phase + 2) % fallChars.length]} ~ ~ ~`);
  writeText(canvas, 21, 49, "~ ~ ~ ~ ~ ~ ~ ~ ~");

  writeTransparent(canvas, 22, 2, "             ");
  writeTransparent(canvas, 23, 2, "             ");

  return renderCanvas(canvas);
}

export function buildMillFrames(): string[][] {
  return Array.from({ length: 8 }, (_, phase) => buildMillFrame(phase));
}

export function buildRoscoeWordmark(revealCount: number, activeSpinPhase: number | null = null): string[] {
  const letters = WORD.split("").map((letter, index) => {
    if (index < revealCount) return LETTER_ART[letter];
    if (index === revealCount && activeSpinPhase !== null) {
      return BRAND_FRAMES[Math.min(activeSpinPhase, BRAND_FRAMES.length - 1)];
    }
    return BLANK_LETTER;
  });

  return Array.from({ length: BLANK_LETTER.length }, (_, row) => letters.map((art) => art[row]).join(" "));
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
    }, FRAME_TICK_MS);

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
  const millFrames = useMemo(() => buildMillFrames(), []);
  const millFrame = millFrames[tick % millFrames.length];
  const taglineChars = Math.max(0, tick - totalRevealTicks + 6);
  const visibleTagline = TAGLINE.slice(0, Math.min(TAGLINE.length, taglineChars));
  const showPrompt = tick > totalRevealTicks + 18;
  const promptVisible = showPrompt && Math.floor(tick / 10) % 2 === 0;

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="round"
      borderColor="yellow"
      overflow="hidden"
    >
      <Box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <Box flexDirection="column">
          {millFrame.map((line, index) => (
            <Box key={`mill-${index}`} justifyContent="center">
              <Text color={index <= 3 || index >= 19 ? "cyan" : index >= 17 ? "yellow" : "gray"} dimColor={index >= 17 && index < 19}>
                {line}
              </Text>
            </Box>
          ))}
        </Box>

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
          <Text color={promptVisible ? "cyan" : "gray"}>
            {showPrompt ? "Press any key to begin." : " "}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
