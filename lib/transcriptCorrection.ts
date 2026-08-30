import type { TimeRange, Word } from "./types";

export type CorrectionScope = "clip" | "selection" | "all";
export type CorrectionRisk = "safe" | "review" | "high";

export interface TranscriptCorrectionSegment {
  id: string;
  wordIds: number[];
  originalText: string;
  start: number;
  end: number;
}

export interface TranscriptSegmentCorrection {
  wordIds: number[];
  text: string;
}

export interface TranscriptCorrectionReview {
  segment: TranscriptCorrectionSegment;
  correctedText: string;
  risk: CorrectionRisk;
}

function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function normalizedToken(token: string): string {
  return token
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase();
}

function lcsLength(a: string[], b: string[]): number {
  const previous = new Array<number>(b.length + 1).fill(0);
  for (const left of a) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = previous[j];
      previous[j] =
        left === b[j - 1]
          ? diagonal + 1
          : Math.max(previous[j], previous[j - 1]);
      diagonal = saved;
    }
  }
  return previous[b.length];
}

function correctionRisk(original: string, corrected: string): CorrectionRisk {
  const before = tokenize(original);
  const after = tokenize(corrected);
  if (before.length === after.length) return "safe";
  const normalizedBefore = before.map(normalizedToken);
  const normalizedAfter = after.map(normalizedToken);
  const longest = Math.max(normalizedBefore.length, normalizedAfter.length, 1);
  const similarity = lcsLength(normalizedBefore, normalizedAfter) / longest;
  const sizeChange = Math.abs(before.length - after.length) / Math.max(before.length, 1);
  return similarity >= 0.4 && sizeChange <= 0.3 ? "review" : "high";
}

export function buildCorrectionSegments(
  words: Word[],
  options: {
    range?: TimeRange | null;
    selectedIds?: number[];
    maxWords?: number;
  } = {}
): TranscriptCorrectionSegment[] {
  const selected = options.selectedIds?.length
    ? new Set(options.selectedIds)
    : null;
  const maxWords = options.maxWords ?? 36;
  const candidates = words.filter((word) => {
    if (word.deleted) return false;
    if (selected && !selected.has(word.id)) return false;
    if (options.range && !(word.end > options.range.start && word.start < options.range.end)) {
      return false;
    }
    return true;
  });

  const segments: Word[][] = [];
  let current: Word[] = [];
  const flush = () => {
    if (current.length > 0) segments.push(current);
    current = [];
  };

  for (const word of candidates) {
    const previous = current[current.length - 1];
    const isContiguous =
      !previous ||
      (word.speaker === previous.speaker && word.start - previous.end < 2.5);
    if (!isContiguous) flush();
    current.push(word);
    const sentenceEnd = /[.!?…]["')\]]?$/.test(word.text);
    if (current.length >= maxWords || (sentenceEnd && current.length >= 8)) flush();
  }
  flush();

  return segments.map((segment, index) => ({
    id: `S${String(index + 1).padStart(3, "0")}`,
    wordIds: segment.map((word) => word.id),
    originalText: segment.map((word) => word.text).join(" "),
    start: segment[0].start,
    end: segment[segment.length - 1].end,
  }));
}

export function buildCorrectionPrompt(
  segments: TranscriptCorrectionSegment[],
  knownTerms = ""
): string {
  const terms = knownTerms.trim()
    ? `\nNombres y términos de referencia:\n${knownTerms.trim()}\n`
    : "";
  return `Corrige los siguientes segmentos de una transcripción de audio.

Reglas obligatorias:
- Corrige errores de transcripción, ortografía, puntuación y nombres propios.
- No resumas, no parafrasees y no cambies el orden de las ideas.
- No elimines información ni agregues contenido que no esté presente.
- Conserva cada identificador [S000] exactamente como aparece.
- Devuelve solamente los segmentos corregidos, en el mismo orden.
${terms}
${segments.map((segment) => `[${segment.id}]\n${segment.originalText}`).join("\n\n")}`;
}

export function parseCorrectionResponse(
  text: string,
  segments: TranscriptCorrectionSegment[]
): TranscriptCorrectionReview[] {
  const marker = /^\s*\[(S\d{3,})\]\s*$/gm;
  const matches = Array.from(text.replace(/```(?:\w+)?/g, "").matchAll(marker));
  if (matches.length === 0) {
    throw new Error("No se encontraron identificadores como [S001] en la respuesta.");
  }

  const responseById = new Map<string, string>();
  const cleanText = text.replace(/```(?:\w+)?/g, "");
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? cleanText.length;
    const corrected = cleanText.slice(start, end).trim();
    if (corrected) responseById.set(match[1], corrected);
  });

  const missing = segments.filter((segment) => !responseById.has(segment.id));
  if (missing.length > 0) {
    throw new Error(`Faltan ${missing.length} segmentos: ${missing.slice(0, 4).map((s) => `[${s.id}]`).join(", ")}.`);
  }

  return segments
    .map((segment) => {
      const correctedText = responseById.get(segment.id)!;
      return {
        segment,
        correctedText,
        risk: correctionRisk(segment.originalText, correctedText),
      };
    })
    .filter(
      (review) =>
        review.correctedText.trim() !== review.segment.originalText.trim()
    );
}

export function applyTranscriptSegmentCorrections(
  words: Word[],
  corrections: TranscriptSegmentCorrection[]
): Word[] | null {
  if (corrections.length === 0) return null;
  let nextId = words.reduce((largest, word) => Math.max(largest, word.id), 0) + 1;
  const replacements = corrections
    .map((correction) => {
      const idSet = new Set(correction.wordIds);
      const indices = words.reduce<number[]>((result, word, index) => {
        if (idSet.has(word.id)) result.push(index);
        return result;
      }, []);
      const tokens = tokenize(correction.text);
      if (indices.length === 0 || tokens.length === 0) return null;
      const from = indices[0];
      const to = indices[indices.length - 1];
      const selected = words.slice(from, to + 1);
      if (selected.length !== indices.length) return null;
      if (selected.map((word) => word.text).join(" ") === tokens.join(" ")) return null;

      if (tokens.length === selected.length) {
        return {
          from,
          to,
          words: selected.map((word, index) => ({ ...word, text: tokens[index] })),
        };
      }

      const start = selected[0].start;
      const end = selected[selected.length - 1].end;
      const span = Math.max(0.02, end - start);
      const totalWeight = tokens.reduce((total, token) => total + Math.max(1, token.length), 0);
      let cursor = start;
      const replacement = tokens.map((token, index) => {
        const duration = (span * Math.max(1, token.length)) / totalWeight;
        const word: Word = {
          id: nextId++,
          text: token,
          start: cursor,
          end: index === tokens.length - 1 ? end : Math.min(end, cursor + duration),
          speaker: selected[0].speaker,
          deleted: false,
        };
        cursor = word.end;
        return word;
      });
      return { from, to, words: replacement };
    })
    .filter((replacement): replacement is NonNullable<typeof replacement> => Boolean(replacement))
    .sort((a, b) => b.from - a.from);

  if (replacements.length === 0) return null;
  const result = [...words];
  for (const replacement of replacements) {
    result.splice(
      replacement.from,
      replacement.to - replacement.from + 1,
      ...replacement.words
    );
  }
  return result;
}
