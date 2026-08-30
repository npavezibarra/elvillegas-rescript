import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { buildCaptionBlocks } from "./captions";
import { getCutRanges, originalToEdited } from "./edits";
import { getTextLayerStyle } from "./layers";
import type { TextLayer, TimeRange, Word } from "./types";

const END_GRACE_S = 0.15;
const ACTIVE_BACKGROUND = "#fcd34d";
const ACTIVE_TEXT = "#18181b";

interface CaptionFrameState {
  start: number;
  end: number;
  blockWords?: Word[];
  activeIndex?: number;
}

export interface CaptionRasterTrack {
  concatPath: string;
  files: string[];
}

export async function writeCaptionRasterTrack(
  ffmpeg: FFmpeg,
  words: Word[],
  cuts: TimeRange[] | undefined,
  sourceDuration: number,
  editedDuration: number,
  layer: TextLayer,
  width: number,
  height: number,
  layerStart = 0,
  layerEnd = editedDuration
): Promise<CaptionRasterTrack | null> {
  const prepared = prepareCaptionWords(words, cuts, sourceDuration);
  const blocks = buildCaptionBlocks(prepared);
  if (blocks.length === 0) return null;

  const states = buildFrameStates(
    blocks.map((block) => block.words),
    editedDuration,
    layerStart,
    layerEnd
  );
  if (states.length === 0) return null;

  const renderer = await createCaptionRenderer(layer, width, height);
  const files: string[] = [];
  const concatLines = ["ffconcat version 1.0"];
  let blankPath: string | null = null;

  for (let index = 0; index < states.length; index++) {
    const state = states[index]!;
    let path: string;
    if (!state.blockWords) {
      if (!blankPath) {
        blankPath = "/caption-frame-blank.png";
        await ffmpeg.writeFile(blankPath, await renderer());
        files.push(blankPath);
      }
      path = blankPath;
    } else {
      path = `/caption-frame-${index}.png`;
      await ffmpeg.writeFile(
        path,
        await renderer(state.blockWords, state.activeIndex)
      );
      files.push(path);
    }
    concatLines.push(`file '${path}'`);
    concatLines.push("option framerate 1000");
    concatLines.push(`duration ${(state.end - state.start).toFixed(6)}`);
  }

  // The concat demuxer applies the last duration only when the final frame is repeated.
  const finalPath = states[states.length - 1]!.blockWords
    ? `/caption-frame-${states.length - 1}.png`
    : blankPath!;
  concatLines.push(`file '${finalPath}'`);
  concatLines.push("option framerate 1000");

  const concatPath = "/caption-frames.ffconcat";
  await ffmpeg.writeFile(
    concatPath,
    new TextEncoder().encode(concatLines.join("\n") + "\n")
  );
  files.push(concatPath);
  return { concatPath, files };
}

function prepareCaptionWords(
  words: Word[],
  cuts: TimeRange[] | undefined,
  duration: number
): Word[] {
  const effectiveCuts = cuts ?? getCutRanges(words, duration);
  return words
    .filter((word) => {
      if (word.deleted || !word.text.trim()) return false;
      const midpoint = (word.start + word.end) / 2;
      return !effectiveCuts.some(
        (cut) => midpoint >= cut.start && midpoint < cut.end
      );
    })
    .map((word) => ({
      ...word,
      start: originalToEdited(word.start, effectiveCuts),
      end: originalToEdited(word.end, effectiveCuts),
    }));
}

function buildFrameStates(
  blockWords: Word[][],
  duration: number,
  layerStart: number,
  layerEnd: number
): CaptionFrameState[] {
  const visibleStart = Math.max(0, layerStart);
  const visibleEnd = Math.min(duration, layerEnd);
  const entries = blockWords.flatMap((block) =>
    block.map((word, activeIndex) => ({ block, word, activeIndex }))
  );
  const states: CaptionFrameState[] = [];
  let cursor = 0;

  const addBlankUntil = (end: number) => {
    if (end <= cursor + 0.0005) return;
    states.push({ start: cursor, end });
    cursor = end;
  };

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const nextStart = entries[index + 1]?.word.start ?? Number.POSITIVE_INFINITY;
    const start = Math.max(entry.word.start, visibleStart);
    const end = Math.min(
      entry.word.end + END_GRACE_S,
      nextStart,
      visibleEnd
    );
    if (end <= start || start >= visibleEnd) continue;
    addBlankUntil(Math.min(start, duration));
    const stateStart = Math.max(cursor, start);
    if (end > stateStart + 0.0005) {
      states.push({
        start: stateStart,
        end,
        blockWords: entry.block,
        activeIndex: entry.activeIndex,
      });
      cursor = end;
    }
  }
  addBlankUntil(duration);
  return states;
}

async function createCaptionRenderer(
  layer: TextLayer,
  outputWidth: number,
  outputHeight: number
): Promise<(words?: Word[], activeIndex?: number) => Promise<Uint8Array>> {
  const style = getTextLayerStyle(layer);
  const frame = document.querySelector<HTMLElement>("[data-video-frame]");
  const frameRect = frame?.getBoundingClientRect();
  const previewWidth = frameRect?.width || outputWidth;
  const previewHeight = frameRect?.height || outputHeight;
  const scaleX = outputWidth / previewWidth;
  const scaleY = outputHeight / previewHeight;
  const scale = Math.min(scaleX, scaleY);
  const viewportWidth = window.innerWidth || previewWidth;
  const previewFontSize = Math.max(
    16,
    Math.min(style.fontSize, (style.fontSize / 12 / 100) * viewportWidth)
  );
  const fontSize = previewFontSize * scale;
  const fontFamily = style.fontFamily;
  const horizontalPadding = (window.innerWidth >= 640 ? 20 : 16) * scaleX;
  const verticalPadding = (window.innerWidth >= 640 ? 14 : 12) * scaleY;
  const wordPaddingX = 6 * scaleX;
  const wordPaddingY = 2 * scaleY;
  const gapX = 6 * scaleX;
  const gapY = 4 * scaleY;
  const letterSpacing = -0.02 * fontSize;
  const maxBlockWidth = 704 * scaleX;

  try {
    await document.fonts.load(
      `${style.fontWeight} ${previewFontSize}px ${quoteFontFamily(fontFamily)}`
    );
  } catch {
    // Canvas uses the same browser fallback as the preview when a font is unavailable.
  }

  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the caption renderer.");
  const layoutCache = new Map<string, CaptionWordLayout[]>();

  const getLayout = (words: Word[]) => {
    const key = words.map((word) => word.text).join("\u0001");
    const cached = layoutCache.get(key);
    if (cached) return cached;

    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "fixed",
      left: "-100000px",
      top: "0",
      width: `${outputWidth}px`,
      height: `${outputHeight}px`,
      overflow: "hidden",
      visibility: "hidden",
      pointerEvents: "none",
    });
    const block = document.createElement("div");
    Object.assign(block.style, {
      boxSizing: "border-box",
      position: "absolute",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      left: `${(layer.transform.x / 100) * outputWidth}px`,
      top: `${(layer.transform.y / 100) * outputHeight}px`,
      width: `${(layer.transform.width / 100) * outputWidth}px`,
      height: `${(layer.transform.height / 100) * outputHeight}px`,
      maxWidth: `${maxBlockWidth}px`,
      padding: `${verticalPadding}px ${horizontalPadding}px`,
      transform: "translate(-50%, -50%)",
    });
    const content = document.createElement("div");
    Object.assign(content.style, {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "center",
      columnGap: `${gapX}px`,
      rowGap: `${gapY}px`,
      letterSpacing: `${letterSpacing}px`,
      color: style.color,
      fontFamily,
      fontSize: `${fontSize}px`,
      fontWeight: String(style.fontWeight),
      lineHeight: String(style.lineHeight),
      textAlign: style.textAlign,
    });
    const spans = words.map((word) => {
      const span = document.createElement("span");
      span.textContent = word.text;
      Object.assign(span.style, {
        boxSizing: "border-box",
        flex: "none",
        padding: `${wordPaddingY}px ${wordPaddingX}px`,
      });
      content.appendChild(span);
      return span;
    });
    block.appendChild(content);
    root.appendChild(block);
    document.body.appendChild(root);
    const rootRect = root.getBoundingClientRect();
    const layout = spans.map((span, index) => {
      const rect = span.getBoundingClientRect();
      return {
        text: words[index]!.text,
        x: rect.left - rootRect.left + rect.width / 2,
        y: rect.top - rootRect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
      };
    });
    root.remove();
    layoutCache.set(key, layout);
    return layout;
  };

  return async (words, activeIndex) => {
    context.clearRect(0, 0, outputWidth, outputHeight);
    if (words && activeIndex !== undefined) {
      context.font = `${style.fontWeight} ${fontSize}px ${quoteFontFamily(fontFamily)}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fontKerning = "auto";
      context.letterSpacing = `${letterSpacing}px`;
      getLayout(words).forEach((item, index) => {
        drawCaptionWord(context, item, index === activeIndex, {
          color: style.color,
          dropShadow: style.dropShadow,
          scale,
          scaleY,
        });
      });
    }
    return canvasToPng(canvas);
  };
}

interface CaptionWordLayout {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function drawCaptionWord(
  context: CanvasRenderingContext2D,
  item: CaptionWordLayout,
  active: boolean,
  options: {
    color: string;
    dropShadow: boolean;
    scale: number;
    scaleY: number;
  }
) {
  context.save();
  context.translate(item.x, item.y);
  if (active) context.scale(1.03, 1.03);
  if (active) {
    context.shadowColor = "rgba(251, 191, 36, 0.18)";
    context.shadowBlur = 24 * options.scale;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 10 * options.scaleY;
    context.fillStyle = ACTIVE_BACKGROUND;
    roundedRect(
      context,
      -item.width / 2,
      -item.height / 2,
      item.width,
      item.height,
      6 * options.scale
    );
    context.fill();
    context.shadowColor = "transparent";
    context.strokeStyle = "rgba(255, 255, 255, 0.18)";
    context.lineWidth = options.scale;
    context.stroke();
  }
  context.fillStyle = active ? ACTIVE_TEXT : options.color;
  context.globalAlpha = active ? 1 : 0.95;
  if (options.dropShadow) {
    context.shadowColor = "rgba(0, 0, 0, 0.95)";
    context.shadowBlur = 6 * options.scale;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 2 * options.scaleY;
  }
  context.fillText(item.text, 0, 0);
  context.restore();
}

function quoteFontFamily(fontFamily: string) {
  return fontFamily.includes(" ") ? `"${fontFamily.replaceAll('"', "")}"` : fontFamily;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Could not render the caption frame."));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}
