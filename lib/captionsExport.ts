import { getCutRanges, originalToEdited } from "./edits";
import { buildCaptionBlocks } from "./captions";
import { getTextLayerStyle } from "./layers";
import type { TextLayer, TimeRange, Word } from "./types";

export interface CaptionBurnInOptions {
  /** Cut list for the exported timeline. When omitted, derived from words. */
  cuts?: TimeRange[];
  /** Original media duration, used only when deriving cuts. */
  duration?: number;
  /** Final exported frame size. */
  playResX: number;
  playResY: number;
  /** Bottom margin in pixels. */
  marginV?: number;
  /** Font family to use for the caption burn-in. */
  fontName?: string;
  /** Visual layer settings for the moving captions. */
  layer?: TextLayer;
  /** Edited-timeline visibility range for the layer. */
  start?: number;
  end?: number;
}

const DEFAULT_FONT = "Arial";

/**
 * Build an ASS file with word-by-word karaoke highlighting for burn-in export.
 * The generated subtitles are already remapped onto the edited timeline.
 */
export function serializeCaptionAss(
  words: Word[],
  options: CaptionBurnInOptions
): string {
  const prepared = prepareCaptionWords(
    words,
    options.cuts,
    options.duration ?? 0
  );
  if (prepared.length === 0) {
    throw new Error("No caption words available for burn-in.");
  }

  const blocks = buildCaptionBlocks(prepared);
  if (blocks.length === 0) {
    throw new Error("No caption blocks available for burn-in.");
  }

  const textStyle = options.layer ? getTextLayerStyle(options.layer) : null;
  const fontName = textStyle?.fontFamily ?? options.fontName ?? DEFAULT_FONT;
  const fontSize = textStyle
    ? layerFontSize(textStyle.fontSize, options.playResY)
    : captionFontSize(options.playResX, options.playResY);
  const outline = Math.max(2, Math.round(fontSize * 0.09));
  const marginV = options.marginV ?? Math.round(options.playResY * 0.085);
  const marginH = Math.max(32, Math.round(options.playResX * 0.05));
  const playResX = Math.max(2, Math.round(options.playResX));
  const playResY = Math.max(2, Math.round(options.playResY));

  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${fontName},${fontSize},&H0000E5FF,${assColor(textStyle?.color ?? "#ffffff")},&H00000000,&H00000000,${textStyle && textStyle.fontWeight < 700 ? 0 : -1},0,0,0,100,100,0,0,1,${outline},${textStyle?.dropShadow === false ? 0 : 2},2,${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const layerStart = options.start ?? 0;
  const layerEnd = options.end ?? Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    if (block.end <= layerStart || block.start >= layerEnd) continue;
    lines.push(
      `Dialogue: 0,${formatAssTime(Math.max(block.start, layerStart))},${formatAssTime(Math.min(block.end, layerEnd))},Caption,,0,0,0,,${positionTag(options.layer, options.playResX, options.playResY)}${buildKaraokeLine(block.words)}`
    );
  }

  return lines.join("\n") + "\n";
}

/** Render a static text layer for the full edited video duration. */
export function serializeStaticTextAss(
  layer: TextLayer,
  duration: number,
  playResX: number,
  playResY: number,
  start = 0,
  end = duration
): string {
  const style = getTextLayerStyle(layer);
  const fontSize = layerFontSize(style.fontSize, playResY);
  const outline = Math.max(2, Math.round(fontSize * 0.09));
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${Math.round(playResX)}`,
    `PlayResY: ${Math.round(playResY)}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Text,${style.fontFamily},${fontSize},${assColor(style.color)},${assColor(style.color)},&H00000000,&H00000000,${style.fontWeight < 700 ? 0 : -1},0,0,0,100,100,0,0,1,${outline},${style.dropShadow ? 2 : 0},5,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Text,,0,0,0,,${positionTag(layer, playResX, playResY)}${escapeAssText(layer.text)}`,
  ];
  return lines.join("\n") + "\n";
}

function prepareCaptionWords(
  words: Word[],
  cuts: TimeRange[] | undefined,
  duration: number
): Word[] {
  const effectiveCuts = cuts ?? getCutRanges(words, duration);
  return words
    .filter((w) => isWordKept(w, effectiveCuts))
    .map((w) => ({
      ...w,
      start: originalToEdited(w.start, effectiveCuts),
      end: originalToEdited(w.end, effectiveCuts),
    }));
}

function isWordKept(word: Word, cuts: TimeRange[]): boolean {
  if (word.deleted) return false;
  const mid = (word.start + word.end) / 2;
  return !cuts.some((c) => mid >= c.start && mid < c.end);
}

function buildKaraokeLine(words: Word[]): string {
  return words
    .map((word, i) => {
      const next = words[i + 1];
      const durS = next
        ? Math.max(0.01, next.start - word.start)
        : Math.max(0.01, word.end - word.start);
      const centiseconds = Math.max(1, Math.round(durS * 100));
      return `{\\k${centiseconds}}${escapeAssText(word.text)}`;
    })
    .join(" ");
}

function escapeAssText(text: string): string {
  return text.replace(/[{}\\]/g, "\\$&").replace(/\r?\n/g, "\\N");
}

function positionTag(
  layer: TextLayer | undefined,
  width: number,
  height: number
): string {
  if (!layer) return "";
  const style = getTextLayerStyle(layer);
  const x = Math.round((layer.transform.x / 100) * width);
  const y = Math.round((layer.transform.y / 100) * height);
  const alignment =
    style.textAlign === "left" ? 4 : style.textAlign === "right" ? 6 : 5;
  return `{\\an${alignment}\\pos(${x},${y})}`;
}

function assColor(hex: string): string {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return "&H00FFFFFF";
  return `&H00${match[3]}${match[2]}${match[1]}`.toUpperCase();
}

function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const centis = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${hours}:${pad2(minutes)}:${pad2(secs)}.${pad2(centis)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function captionFontSize(width: number, height: number): number {
  const base = Math.min(width, height);
  return Math.max(28, Math.min(78, Math.round(base * 0.055)));
}

function layerFontSize(fontSize: number, outputHeight: number): number {
  return Math.max(16, Math.round((fontSize / 500) * outputHeight));
}
