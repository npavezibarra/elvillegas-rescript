import { findSilenceRanges } from "./silences";
import type { ManualCut, TimeRange, Word } from "./types";

export interface PauseMarker {
  anchorWordId: number;
  side: "before" | "after";
  duration: number;
  ranges: TimeRange[];
}

/** Tiny slack so pause chips stay stable around adjacent cut/silence edges. */
const PAUSE_EPSILON = 1e-4;

/**
 * Convert detected silence ranges into transcript pause chips anchored to the
 * visible words they sit between. Leading / trailing silence is intentionally
 * ignored because there is no nearby word block to host a chip.
 */
export function buildPauseMarkers(
  words: Word[],
  duration: number,
  manualCuts: ManualCut[] = [],
  visibleWords: Word[] = words
): PauseMarker[] {
  const silenceRanges = findSilenceRanges(words, duration, manualCuts);
  if (silenceRanges.length === 0 || visibleWords.length === 0) return [];

  const shown = [...visibleWords].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id - b.id
  );
  const markers: PauseMarker[] = [];

  for (const silence of silenceRanges) {
    let leftIndex = -1;
    let rightIndex = -1;
    for (let i = 0; i < shown.length; i++) {
      const word = shown[i]!;
      if (word.end <= silence.start + PAUSE_EPSILON) leftIndex = i;
      if (rightIndex < 0 && word.start >= silence.end - PAUSE_EPSILON) {
        rightIndex = i;
        break;
      }
    }

    if (leftIndex < 0 || rightIndex < 0 || rightIndex <= leftIndex) continue;
    const anchor = shown[leftIndex]!;
    const next = shown[rightIndex]!;
    const gapMidpoint = (anchor.end + next.start) / 2;
    const side =
      silence.end <= gapMidpoint + PAUSE_EPSILON ? "after" : "before";
    markers.push({
      anchorWordId: side === "after" ? anchor.id : next.id,
      side,
      duration: silence.end - silence.start,
      ranges: [silence],
    });
  }

  return markers;
}
