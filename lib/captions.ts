import type { Word } from "./types";

/**
 * Heuristic settings for grouping transcript words into captions.
 * The defaults aim for short, readable blocks that fit one or two centered
 * lines without getting overly chatty.
 */
export interface CaptionLayoutOptions {
  /** Maximum number of words in a caption block. */
  maxWords?: number;
  /** Maximum block duration in seconds before we force a break. */
  maxDurationS?: number;
  /** Maximum whitespace-separated characters in a block before we force a break. */
  maxChars?: number;
  /** Gap between words that should start a new block. */
  gapS?: number;
}

export interface CaptionBlock {
  id: string;
  speaker: number;
  start: number;
  end: number;
  words: Word[];
  text: string;
}

export interface ActiveCaptionWord {
  blockIndex: number;
  wordIndex: number;
  word: Word;
}

const DEFAULT_LAYOUT: Required<CaptionLayoutOptions> = {
  maxWords: 8,
  maxDurationS: 3.2,
  maxChars: 40,
  gapS: 0.6,
};

/**
 * Build caption blocks from a word list.
 *
 * The grouping is intentionally simple:
 * - keep words in chronological order
 * - split on speaker changes
 * - split on noticeable pauses
 * - split when a block gets too long for a centered caption
 */
export function buildCaptionBlocks(
  words: Word[],
  options: CaptionLayoutOptions = {}
): CaptionBlock[] {
  const cfg = { ...DEFAULT_LAYOUT, ...options };
  const visible = words.filter((w) => !w.deleted && w.text.trim().length > 0);
  if (visible.length === 0) return [];

  const blocks: CaptionBlock[] = [];
  let blockWords: Word[] = [];
  let blockCharCount = 0;

  const flush = () => {
    if (blockWords.length === 0) return;
    blocks.push({
      id: `cap-${blockWords[0]!.id}-${blockWords[blockWords.length - 1]!.id}`,
      speaker: blockWords[0]!.speaker,
      start: blockWords[0]!.start,
      end: blockWords[blockWords.length - 1]!.end,
      words: blockWords,
      text: blockWords.map((w) => w.text).join(" "),
    });
    blockWords = [];
    blockCharCount = 0;
  };

  for (const word of visible) {
    const last = blockWords[blockWords.length - 1];
    const shouldBreak =
      !last ||
      word.speaker !== last.speaker ||
      word.start - last.end > cfg.gapS ||
      blockWords.length >= cfg.maxWords ||
      word.end - blockWords[0]!.start > cfg.maxDurationS ||
      blockCharCount + word.text.length + (blockWords.length > 0 ? 1 : 0) >
        cfg.maxChars;

    if (shouldBreak) flush();

    blockWords.push(word);
    blockCharCount += word.text.length + (blockWords.length > 1 ? 1 : 0);
  }

  flush();
  return blocks;
}

/**
 * Find the caption word active at a given time.
 * Mirrors the transcript panel's behavior: the last word whose start is before
 * the playhead remains active until a small grace window after its end.
 */
export function findActiveCaptionWord(
  blocks: CaptionBlock[],
  timeS: number,
  endGraceS = 0.15
): ActiveCaptionWord | null {
  let lo = 0;
  let hi = blocks.length - 1;
  let idx = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid]!.start <= timeS) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (idx < 0) return null;
  const block = blocks[idx]!;
  if (timeS >= block.end + endGraceS) return null;

  const wordIndex = findWordIndex(block.words, timeS, endGraceS);
  if (wordIndex < 0) return null;

  return {
    blockIndex: idx,
    wordIndex,
    word: block.words[wordIndex]!,
  };
}

function findWordIndex(
  words: Word[],
  timeS: number,
  endGraceS: number
): number {
  let lo = 0;
  let hi = words.length - 1;
  let idx = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.start <= timeS) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (idx >= 0 && timeS < words[idx]!.end + endGraceS) return idx;
  return -1;
}

