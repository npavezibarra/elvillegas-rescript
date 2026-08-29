/**
 * Unit tests for caption block generation.
 * Run: npx tsx tests/captions-test.ts
 */
import {
  buildCaptionBlocks,
  findActiveCaptionWord,
} from "../lib/captions";
import type { Word } from "../lib/types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const words: Word[] = [
  { id: 0, text: "Sigo", start: 0, end: 0.35, speaker: 0, deleted: false },
  { id: 1, text: "con", start: 0.35, end: 0.52, speaker: 0, deleted: false },
  { id: 2, text: "Rettig", start: 0.52, end: 0.9, speaker: 0, deleted: false },
  { id: 3, text: "y", start: 1.65, end: 1.75, speaker: 0, deleted: false },
  { id: 4, text: "Greenberg", start: 1.75, end: 2.15, speaker: 0, deleted: false },
  { id: 5, text: "Hola", start: 2.2, end: 2.5, speaker: 1, deleted: false },
  { id: 6, text: "mundo", start: 2.5, end: 2.85, speaker: 1, deleted: true },
  { id: 7, text: "otra", start: 2.9, end: 3.15, speaker: 1, deleted: false },
];

{
  const blocks = buildCaptionBlocks(words);
  assert(blocks.length === 3, `expected 3 blocks, got ${blocks.length}`);
  assert(blocks[0]!.text === "Sigo con Rettig", `block 0 text: ${blocks[0]!.text}`);
  assert(blocks[1]!.text === "y Greenberg", `block 1 text: ${blocks[1]!.text}`);
  assert(blocks[2]!.speaker === 1, "speaker change should start a new block");
  assert(blocks[2]!.text === "Hola otra", `deleted words should be skipped: ${blocks[2]!.text}`);
  console.log("caption grouping: ok");
}

{
  const tight = buildCaptionBlocks(words, { maxWords: 2, maxChars: 12 });
  assert(tight.length >= 4, `tight layout should split more, got ${tight.length}`);
  assert(tight.every((b) => b.text.length <= 12 || b.words.length <= 2), "layout caps respected");
  console.log("layout limits: ok");
}

{
  const blocks = buildCaptionBlocks(words);
  const active = findActiveCaptionWord(blocks, 0.6);
  assert(active?.word.text === "Rettig", `active word at 0.6s: ${active?.word.text}`);
  const late = findActiveCaptionWord(blocks, 3.0);
  assert(late?.word.text === "otra", `active word at 2.82s: ${late?.word.text}`);
  assert(findActiveCaptionWord(blocks, 9) === null, "outside the timeline should return null");
  console.log("active word lookup: ok");
}

console.log("ALL CAPTIONS TESTS PASSED");
