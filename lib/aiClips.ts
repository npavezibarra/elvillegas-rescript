import { speakerLabel } from "./speakers";
import type { SpeakerInfo, Word } from "./types";

/** JSON shape returned by ChatGPT and imported by Rescript. */
export interface ClipSuggestion {
  title: string;
  /** Original media time in seconds. */
  start: number;
  /** Original media time in seconds. */
  end: number;
  score?: number;
  reason?: string;
}

export interface AiTranscriptBlock {
  id: string;
  start: number;
  end: number;
  speaker: number;
  speakerName: string;
  text: string;
}

const BLOCK_PREFIX = "B";
const MIN_SENTENCE_BLOCK_S = 4;
const PAUSE_BREAK_S = 0.85;
const MAX_BLOCK_DURATION_S = 22;
const MAX_BLOCK_WORDS = 42;

function isSentenceEnding(text: string): boolean {
  return /[.!?][)"'\]]*$/.test(text.trim());
}

function blockId(index: number): string {
  return `${BLOCK_PREFIX}${String(index).padStart(4, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatAiTimestamp(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMs = Math.round(seconds * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const base = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return ms > 0 ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

function blockHeader(block: AiTranscriptBlock): string {
  return `[${block.id} | ${formatAiTimestamp(block.start)} - ${formatAiTimestamp(block.end)}] ${block.speakerName}`;
}

function makeBlock(
  words: Word[],
  startIndex: number,
  endIndex: number,
  speakers: SpeakerInfo[]
): AiTranscriptBlock {
  const slice = words.slice(startIndex, endIndex + 1);
  const start = slice[0]?.start ?? 0;
  const end = slice[slice.length - 1]?.end ?? start;
  const speaker = slice[0]?.speaker ?? -1;
  const speakerName = speakerLabel(speakers, speaker);
  return {
    id: blockId(0), // replaced by the caller with the stable block index
    start,
    end,
    speaker,
    speakerName,
    text: slice.map((w) => w.text).join(" "),
  };
}

/**
 * Group transcript words into stable, human-readable blocks for AI export.
 *
 * The export follows the original media timeline, not the edited timeline:
 * deleted words stay in place so the model does not lose context.
 */
export function buildAiTranscriptBlocks(
  words: Word[],
  speakers: SpeakerInfo[] = []
): AiTranscriptBlock[] {
  if (words.length === 0) return [];

  const blocks: AiTranscriptBlock[] = [];
  let startIndex = 0;

  const flush = (endIndex: number) => {
    const block = makeBlock(words, startIndex, endIndex, speakers);
    blocks.push({ ...block, id: blockId(blocks.length + 1) });
    startIndex = endIndex + 1;
  };

  for (let i = 0; i < words.length; i++) {
    const current = words[i];
    const next = words[i + 1];
    if (!next) {
      flush(i);
      break;
    }

    const blockStart = words[startIndex]!;
    const blockDuration = current.end - blockStart.start;
    const blockWords = i - startIndex + 1;
    const gap = next.start - current.end;
    const speakerChanged = next.speaker !== current.speaker;
    const pauseBreak = gap >= PAUSE_BREAK_S;
    const lengthCapReached =
      blockDuration >= MAX_BLOCK_DURATION_S || blockWords >= MAX_BLOCK_WORDS;
    const sentenceEnd = isSentenceEnding(current.text);
    const naturalSentenceBreak =
      sentenceEnd &&
      (blockDuration >= MIN_SENTENCE_BLOCK_S || blockWords >= 12 || gap >= 0.25);

    if (
      speakerChanged ||
      pauseBreak ||
      lengthCapReached ||
      naturalSentenceBreak
    ) {
      flush(i);
    }
  }

  return blocks;
}

export function buildAiTranscriptHeader(): string {
  return [
    "You are helping analyze a transcript for Rescript.",
    "The timestamps below are ORIGINAL media time in seconds.",
    "Transcript blocks include compact IDs like B0001 for reference.",
    "When I later ask for clips, return ONLY valid JSON matching this schema:",
    `[{"title":"...","start":0,"end":0,"score":0,"reason":"..."}]`,
    "Rules:",
    "- title, start, and end are required",
    "- score and reason are optional",
    "- start/end must be original media time in seconds",
    "- return valid JSON only when asked for clips",
  ].join("\n");
}

export function buildAiTranscriptExport(
  words: Word[],
  speakers: SpeakerInfo[] = []
): string {
  const blocks = buildAiTranscriptBlocks(words, speakers);
  const lines = [buildAiTranscriptHeader(), ""];
  for (const block of blocks) {
    lines.push(blockHeader(block));
    lines.push(block.text);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function extractJsonCandidate(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // fall through
  }

  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1).trim();
  return trimmed;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Parse and validate the ChatGPT clip JSON payload.
 * Throws on any malformed entry so state cannot be corrupted.
 */
export function parseClipSuggestions(
  text: string,
  duration: number
): ClipSuggestion[] {
  const jsonText = extractJsonCandidate(text);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error("Could not parse clip JSON. Paste a JSON array.");
  }

  if (!Array.isArray(raw)) {
    throw new Error("Clip JSON must be an array.");
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Clip ${index + 1} must be an object.`);
    }
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!title) throw new Error(`Clip ${index + 1} is missing a title.`);

    const start = asNumber(rec.start);
    if (start === null) {
      throw new Error(`Clip ${index + 1} is missing a valid start time.`);
    }
    if (start < 0) {
      throw new Error(`Clip ${index + 1} has a negative start time.`);
    }

    const end = asNumber(rec.end);
    if (end === null) {
      throw new Error(`Clip ${index + 1} is missing a valid end time.`);
    }
    if (end <= start) {
      throw new Error(`Clip ${index + 1} must end after it starts.`);
    }
    if (duration > 0 && end > duration + 1e-4) {
      throw new Error(`Clip ${index + 1} ends beyond the video duration.`);
    }

    let score: number | undefined;
    if (rec.score !== undefined) {
      const parsedScore = asNumber(rec.score);
      if (parsedScore === null) {
        throw new Error(`Clip ${index + 1} has an invalid score.`);
      }
      if (parsedScore < 0 || parsedScore > 100) {
        throw new Error(`Clip ${index + 1} score must be between 0 and 100.`);
      }
      score = parsedScore;
    }

    const reason =
      rec.reason === undefined
        ? undefined
        : typeof rec.reason === "string"
          ? rec.reason.trim()
          : null;
    if (reason === null) {
      throw new Error(`Clip ${index + 1} has an invalid reason.`);
    }

    return {
      title,
      start,
      end,
      ...(score !== undefined ? { score } : {}),
      ...(reason ? { reason } : {}),
    };
  });
}

/** Move one clip suggestion within the imported list. */
export function reorderClipSuggestions<T extends ClipSuggestion>(
  suggestions: T[],
  fromIndex: number,
  toIndex: number
): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= suggestions.length ||
    toIndex < 0 ||
    toIndex >= suggestions.length ||
    fromIndex === toIndex
  ) {
    return suggestions;
  }
  const next = [...suggestions];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}
