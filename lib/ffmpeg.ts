"use client";

import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { en } from "@/lib/i18n/messages/en";
import type { EditorLayer, LayerTransform, TimeRange, Word } from "./types";
import { serializeCaptionAss, serializeStaticTextAss } from "./captionsExport";
import { writeCaptionRasterTrack } from "./captionRaster";
import { originalToEdited } from "./edits";
import { renderLayerTiming } from "./layers";

const CORE_BASE = "/vendor/ffmpeg";
const INPUT_DIR = "/input";
const INPUT_NAME = "input_video";
const INPUT_PATH = `${INPUT_DIR}/${INPUT_NAME}`;
const EXPORT_STALL_TIMEOUT_MS = 90_000;
const EXPORT_FONT_URL = "/vendor/fonts/Geist-Regular.ttf";
const EXPORT_FONT_DIR = "/fonts";
const EXPORT_FONT_PATH = `${EXPORT_FONT_DIR}/Geist-Regular.ttf`;
const EXPORT_FONT_FAMILY = "Geist";

let ffmpegPromise: Promise<FFmpeg> | null = null;
let mountedFor: File | null = null;
let exportFontBytesPromise: Promise<Uint8Array> | null = null;

/** Lazily load a singleton multi-threaded ffmpeg.wasm instance. */
export async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
        // Served same-origin (copied on postinstall): the bundled class worker
        // contains a dynamic import() that Next's bundler cannot handle.
        classWorkerURL: new URL("/vendor/ffmpeg-class/worker.js", location.href).href,
      });
      return ffmpeg;
    })();
    ffmpegPromise.catch(() => {
      ffmpegPromise = null;
    });
  }
  return ffmpegPromise;
}

/**
 * Terminate the ffmpeg worker and hand its heap back to the browser.
 *
 * The media engine still retains its WebAssembly heap and temporary filesystem
 * until its worker is terminated. Nothing needs ffmpeg between audio extraction
 * and export, so drop it there and pay one re-init instead of holding that
 * memory alongside the speech model and decoded PCM.
 */
export async function releaseFFmpeg(): Promise<void> {
  const pending = ffmpegPromise;
  if (!pending) return;
  // In development, Turbopack + hot reload can interrupt the worker lifecycle
  // while we are still transitioning between screens. Keeping the instance
  // alive avoids a noisy terminate path without affecting the app flow.
  if (process.env.NODE_ENV !== "production") return;
  // Clear first so a concurrent getFFmpeg() builds a fresh instance rather than
  // handing out the one we are about to terminate.
  ffmpegPromise = null;
  mountedFor = null;
  try {
    (await pending).terminate();
  } catch {
    // Load failed or the worker is already gone — the heap went with it.
  }
}

/**
 * Forget a media engine that may be stuck while loading.
 *
 * A pending ffmpeg.load() cannot be synchronously terminated because the
 * instance is not available yet. Detach it immediately so a retry can create a
 * fresh worker, then terminate the old instance if it eventually resolves.
 */
export function resetFFmpeg(): void {
  const pending = ffmpegPromise;
  ffmpegPromise = null;
  mountedFor = null;
  if (!pending) return;
  void pending
    .then((ffmpeg) => ffmpeg.terminate())
    .catch(() => {
      // A rejected load has no live worker left to terminate.
    });
}

function terminateFFmpegInstance(ffmpeg: FFmpeg): void {
  ffmpegPromise = null;
  mountedFor = null;
  ffmpeg.terminate();
}

async function ensureInput(ffmpeg: FFmpeg, file: File): Promise<string> {
  if (mountedFor === file) return INPUT_PATH;

  if (mountedFor) {
    try {
      await ffmpeg.unmount(INPUT_DIR);
    } catch {
      // Nothing mounted yet or the worker is already gone.
    }
    mountedFor = null;
  }

  try {
    await ffmpeg.createDir(INPUT_DIR);
  } catch {
    // The mount point may already exist from a previous run.
  }
  const { FFFSType } = await import("@ffmpeg/ffmpeg");
  await ffmpeg.mount(
    FFFSType.WORKERFS,
    { blobs: [{ name: INPUT_NAME, data: file }] },
    INPUT_DIR
  );
  mountedFor = file;
  return INPUT_PATH;
}

async function ensureExportFont(ffmpeg: FFmpeg): Promise<void> {
  exportFontBytesPromise ??= fetch(EXPORT_FONT_URL).then(async (response) => {
    if (!response.ok) throw new Error("Could not load the export font.");
    return new Uint8Array(await response.arrayBuffer());
  });
  try {
    await ffmpeg.createDir(EXPORT_FONT_DIR);
  } catch {
    // The directory may already exist on a reused media engine.
  }
  // writeFile transfers its buffer to the worker, so preserve the cached copy.
  await ffmpeg.writeFile(EXPORT_FONT_PATH, new Uint8Array(await exportFontBytesPromise));
}

/**
 * Extract the audio track as mono 16 kHz float PCM — the exact format
 * Whisper expects, and what we render the timeline waveform from.
 * Works for both video and audio-only files. Resolves to null when the file
 * has no audio track — those still open for editing with an empty transcript.
 */
export async function extractAudio(
  file: File,
  onProgress?: (progress: number) => void
): Promise<Float32Array | null> {
  const ffmpeg = await getFFmpeg();
  const input = await ensureInput(ffmpeg, file);
  const out = "audio.pcm";
  let sawAudioStream = false;
  const logHandler = ({ message }: { type: string; message: string }) => {
    if (/Stream #\d+:\d+.*: Audio:/.test(message)) sawAudioStream = true;
  };
  const progressHandler = ({ progress }: { progress: number; time: number }) => {
    if (!Number.isFinite(progress)) return;
    onProgress?.(Math.max(0, Math.min(0.98, progress)));
  };
  ffmpeg.on("log", logHandler);
  ffmpeg.on("progress", progressHandler);
  let code: number;
  try {
    code = await ffmpeg.exec([
      "-i", input,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-f", "f32le",
      "-y", out,
    ]);
  } finally {
    ffmpeg.off("log", logHandler);
    ffmpeg.off("progress", progressHandler);
  }
  if (code !== 0) {
    if (!sawAudioStream) return null;
    throw new Error(en["error.extractAudio"]);
  }
  const data = (await ffmpeg.readFile(out)) as Uint8Array;
  await ffmpeg.deleteFile(out);
  if (data.byteLength < 4) return null;
  // Copy into a fresh buffer so byteOffset/alignment is clean.
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return new Float32Array(buf as ArrayBuffer);
}

/** Container / codec presets for video export. */
export type VideoExportFormat = "mp4" | "webm";

/** Target output height. `"original"` keeps the source resolution. */
export type VideoExportResolution = "original" | "720" | "1080" | "2160";

/** Output crop / aspect ratio preset. */
export type VideoExportAspectRatio = "original" | "landscape" | "portrait";

/** How the source fits inside the chosen aspect ratio. */
export type VideoExportLayout = "fit" | "fill";

/** Container / codec presets for audio-only export. */
export type AudioExportFormat = "m4a" | "mp3" | "wav";

export interface VideoExportOptions {
  /** When false, render a silent video (source has no audio track). */
  withAudio?: boolean;
  /** Burn word-highlighted captions into the exported video. */
  burnCaptions?: boolean;
  /** Caption words / cuts for burn-in. */
  captions?: {
    words: Word[];
    cuts?: TimeRange[];
    duration: number;
  };
  /** Visual text and image layers, ordered from back to front. */
  layers?: EditorLayer[];
  format?: VideoExportFormat;
  resolution?: VideoExportResolution;
  aspectRatio?: VideoExportAspectRatio;
  layout?: VideoExportLayout;
  /** Placement of the source video within the exported frame. */
  videoTransform?: LayerTransform;
  /** Source region visible inside the video layer. */
  videoCrop?: LayerTransform;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface AudioExportOptions {
  format?: AudioExportFormat;
}

const VIDEO_HEIGHT: Record<Exclude<VideoExportResolution, "original">, number> = {
  "720": 720,
  "1080": 1080,
  "2160": 2160,
};

/**
 * Scale filter that fits inside the target height without upscaling, keeping
 * even dimensions (required by libx264 / libvpx).
 */
function scaleFilter(resolution: VideoExportResolution): string | null {
  if (resolution === "original") return null;
  const h = VIDEO_HEIGHT[resolution];
  // Never upscale: cap height at source ih. force_original_aspect_ratio keeps
  // width proportional; the second scale snaps to even sizes.
  return `scale=-2:'min(ih,${h})',scale=trunc(iw/2)*2:trunc(ih/2)*2`;
}

function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

function cropFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
}

function fitFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

/** Output dimensions after export scaling / reframing. */
export function getVideoExportDimensions(
  resolution: VideoExportResolution,
  aspectRatio: VideoExportAspectRatio,
  sourceWidth = 1920,
  sourceHeight = 1080
): { width: number; height: number } {
  const aspect = getVideoAspectRatioDimensions(
    resolution,
    aspectRatio,
    sourceWidth,
    sourceHeight
  );
  if (aspect) return aspect;

  if (resolution === "original") {
    return { width: Math.max(2, sourceWidth), height: Math.max(2, sourceHeight) };
  }

  const targetHeight = VIDEO_HEIGHT[resolution];
  const height = Math.max(2, Math.min(sourceHeight, targetHeight));
  const width = even((sourceWidth * height) / Math.max(1, sourceHeight));
  return { width, height };
}

/** Compute the centered export size for a 16:9 or 9:16 render. */
export function getVideoAspectRatioDimensions(
  resolution: VideoExportResolution,
  aspectRatio: VideoExportAspectRatio,
  sourceWidth = 1920,
  sourceHeight = 1080
): { width: number; height: number } | null {
  if (aspectRatio === "original") return null;
  const baseHeight =
    resolution === "original"
      ? Math.max(2, Math.min(sourceWidth, sourceHeight))
      : VIDEO_HEIGHT[resolution];
  if (aspectRatio === "landscape") {
    return { width: even((baseHeight * 16) / 9), height: even(baseHeight) };
  }
  return { width: even(baseHeight), height: even((baseHeight * 16) / 9) };
}

/** Video reframe filter for the chosen export aspect ratio. */
export function getVideoExportTransform(
  resolution: VideoExportResolution,
  aspectRatio: VideoExportAspectRatio,
  sourceWidth = 1920,
  sourceHeight = 1080,
  layout: VideoExportLayout = "fill"
): string | null {
  const dimensions = getVideoAspectRatioDimensions(
    resolution,
    aspectRatio,
    sourceWidth,
    sourceHeight
  );
  if (dimensions) {
    return layout === "fit"
      ? fitFilter(dimensions.width, dimensions.height)
      : cropFilter(dimensions.width, dimensions.height);
  }
  return scaleFilter(resolution);
}

/**
 * Render the edited video: keep only `keepRanges` of the original media and
 * concatenate them. Re-encodes so cuts land exactly on word boundaries
 * rather than keyframes. `withAudio: false` renders a silent source, whose
 * missing [0:a] would otherwise fail the whole filtergraph.
 */
export async function exportVideo(
  file: File,
  keepRanges: TimeRange[],
  editedDuration: number,
  onProgress: (ratio: number) => void,
  {
    withAudio = true,
    burnCaptions = false,
    captions,
    layers = [],
    format = "mp4",
    resolution = "original",
    aspectRatio = "original",
    layout = "fill",
    sourceWidth = 1920,
    sourceHeight = 1080,
    videoTransform,
    videoCrop,
  }: VideoExportOptions = {}
): Promise<Blob> {
  if (keepRanges.length === 0) {
    throw new Error(en["error.nothingToExport"]);
  }
  const ffmpeg = await getFFmpeg();
  const input = await ensureInput(ffmpeg, file);
  const out = format === "webm" ? "output.webm" : "output.mp4";
  const transform = getVideoExportTransform(
    resolution,
    aspectRatio,
    sourceWidth,
    sourceHeight,
    layout
  );

  const parts: string[] = [];
  const labels: string[] = [];
  keepRanges.forEach((r, i) => {
    const s = r.start.toFixed(3);
    const e = r.end.toFixed(3);
    parts.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`);
    labels.push(`[v${i}]`);
    if (withAudio) {
      parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
      labels[labels.length - 1] += `[a${i}]`;
    }
  });
  let filter =
    parts.join(";") +
    `;${labels.join("")}concat=n=${keepRanges.length}:v=1:a=${
      withAudio ? 1 : 0
    }[outv]${withAudio ? "[outa]" : ""}`;
  const captionDims = getVideoExportDimensions(
    resolution,
    aspectRatio,
    sourceWidth,
    sourceHeight
  );
  let videoMap = transform ? "[vout]" : "[outv]";
  if (transform) {
    filter += `;[outv]${transform}[vout]`;
  }
  if (videoCrop && (videoCrop.width < 100 || videoCrop.height < 100 || videoCrop.x !== 50 || videoCrop.y !== 50)) {
    const width = even((videoCrop.width / 100) * captionDims.width);
    const height = even((videoCrop.height / 100) * captionDims.height);
    const x = Math.round((videoCrop.x / 100) * captionDims.width - width / 2);
    const y = Math.round((videoCrop.y / 100) * captionDims.height - height / 2);
    filter += `;${videoMap}crop=${width}:${height}:${x}:${y}[videoCrop]`;
    videoMap = "[videoCrop]";
  }
  if (videoTransform && (videoTransform.width < 100 || videoTransform.height < 100 || videoTransform.x !== 50 || videoTransform.y !== 50)) {
    const width = even((videoTransform.width / 100) * captionDims.width);
    const height = even((videoTransform.height / 100) * captionDims.height);
    const x = Math.round((videoTransform.x / 100) * captionDims.width - width / 2);
    const y = Math.round((videoTransform.y / 100) * captionDims.height - height / 2);
    filter += `;${videoMap}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[videoLayer];color=c=black:s=${captionDims.width}x${captionDims.height}:d=${editedDuration.toFixed(3)}[videoCanvas];[videoCanvas][videoLayer]overlay=${x}:${y}[vvideo]`;
    videoMap = "[vvideo]";
  }

  const layerFiles: string[] = [];
  const layerInputArgs: string[] = [];
  let layerSequence = 0;
  let imageInputIndex = 1;
  const layersToRender = layers.length > 0 ? layers : [];
  const postRollDuration = layersToRender.reduce((max, layer) => {
    if (layer.type !== "image" || !layer.postRoll) return max;
    const start = layer.start ?? 0;
    const end = layer.end ?? start;
    return Math.max(max, end - start);
  }, 0);
  const compositionDuration = editedDuration + postRollDuration;
  let audioMap = withAudio ? "[outa]" : null;

  if (postRollDuration > 0) {
    // Extend only the rendered composition. The source media and its clip
    // boundaries remain unchanged while the end card covers the final frame.
    filter += `;${videoMap}tpad=stop_mode=clone:stop_duration=${postRollDuration.toFixed(3)}[vpostroll]`;
    videoMap = "[vpostroll]";
    if (withAudio) {
      filter += `;[outa]apad=pad_dur=${postRollDuration.toFixed(3)}[apostroll]`;
      audioMap = "[apostroll]";
    }
  }
  let stalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;

  const clearStallTimer = () => {
    if (stallTimer !== null) clearTimeout(stallTimer);
    stallTimer = null;
  };
  const armStallTimer = () => {
    clearStallTimer();
    stallTimer = setTimeout(() => {
      stalled = true;
      terminateFFmpegInstance(ffmpeg);
    }, EXPORT_STALL_TIMEOUT_MS);
  };

  // Older callers can still request captions without the layer model.
  if (layersToRender.length === 0 && burnCaptions && captions?.words.length) {
    await ensureExportFont(ffmpeg);
    const path = "/captions.ass";
    const ass = serializeCaptionAss(captions.words, {
      cuts: captions.cuts,
      duration: captions.duration,
      playResX: captionDims.width,
      playResY: captionDims.height,
      fontName: EXPORT_FONT_FAMILY,
    });
    await ffmpeg.writeFile(path, new TextEncoder().encode(ass));
    layerFiles.push(path);
    filter += `;${videoMap}ass=filename=${path}:fontsdir=${EXPORT_FONT_DIR}:original_size=${captionDims.width}x${captionDims.height}[vl${layerSequence}]`;
    videoMap = `[vl${layerSequence++}]`;
  }

  for (const layer of layersToRender) {
    const sourceDuration = captions?.duration ?? editedDuration;
    const originalTiming = renderLayerTiming(layer, sourceDuration);
    const layerStart = layer.type === "image" && layer.postRoll
      ? editedDuration
      : originalToEdited(originalTiming.start, captions?.cuts ?? []);
    const layerEnd = layer.type === "image" && layer.postRoll
      ? editedDuration + (originalTiming.end - originalTiming.start)
      : originalToEdited(originalTiming.end, captions?.cuts ?? []);
    if (layer.type === "text") {
      if (layer.source === "caption" && (!burnCaptions || !captions?.words.length)) {
        continue;
      }
      if (layer.source === "caption") {
        const track = await writeCaptionRasterTrack(
          ffmpeg,
          captions!.words,
          captions!.cuts,
          captions!.duration,
          compositionDuration,
          layer,
          captionDims.width,
          captionDims.height,
          layerStart,
          layerEnd
        );
        if (!track) continue;
        layerFiles.push(...track.files);
        const captionInputIndex = imageInputIndex++;
        layerInputArgs.push(
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          track.concatPath
        );
        const captionLabel = `caption${layerSequence}`;
        filter += `;[${captionInputIndex}:v]format=rgba,setpts=PTS-STARTPTS[${captionLabel}];${videoMap}[${captionLabel}]overlay=0:0:eof_action=pass:repeatlast=1[vl${layerSequence}]`;
        videoMap = `[vl${layerSequence++}]`;
        continue;
      }
      await ensureExportFont(ffmpeg);
      const path = `/layer-${layerSequence}.ass`;
      const ass = serializeStaticTextAss(
        layer,
        compositionDuration,
        captionDims.width,
        captionDims.height,
        layerStart,
        layerEnd,
        EXPORT_FONT_FAMILY
      );
      await ffmpeg.writeFile(path, new TextEncoder().encode(ass));
      layerFiles.push(path);
      filter += `;${videoMap}ass=filename=${path}:fontsdir=${EXPORT_FONT_DIR}:original_size=${captionDims.width}x${captionDims.height}[vl${layerSequence}]`;
      videoMap = `[vl${layerSequence++}]`;
      continue;
    }

    const imagePath = `/layer-${layerSequence}${imageFileExtension(layer.src)}`;
    await ffmpeg.writeFile(imagePath, dataUrlBytes(layer.src));
    layerFiles.push(imagePath);
    // Keep this as a single frame. Overlay repeats that frame while the main
    // video advances, so image timestamps cannot corrupt export progress.
    layerInputArgs.push("-i", imagePath);
    const width = even((layer.transform.width / 100) * captionDims.width);
    const height = even((layer.transform.height / 100) * captionDims.height);
    const x = Math.round((layer.transform.x / 100) * captionDims.width - width / 2);
    const y = Math.round((layer.transform.y / 100) * captionDims.height - height / 2);
    const crop = layer.crop;
    const cropFilter = crop
      ? `crop=iw*${(crop.width / 100).toFixed(6)}:ih*${(crop.height / 100).toFixed(6)}:iw*${((crop.x - crop.width / 2) / 100).toFixed(6)}:ih*${((crop.y - crop.height / 2) / 100).toFixed(6)},`
      : "";
    const imageLabel = `img${layerSequence}`;
    filter += `;[${imageInputIndex}:v]format=rgba,${cropFilter}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[${imageLabel}];${videoMap}[${imageLabel}]overlay=${x}:${y}:eof_action=repeat:repeatlast=1:enable='between(t,${layerStart.toFixed(3)},${layerEnd.toFixed(3)})'[vl${layerSequence}]`;
    videoMap = `[vl${layerSequence++}]`;
    imageInputIndex++;
  }

  const progressHandler = ({ time }: { progress: number; time: number }) => {
    armStallTimer();
    // `time` is the output timestamp in microseconds.
    const ratio = Math.min(1, time / 1e6 / Math.max(0.001, editedDuration));
    // Reserve 100% for the point where the muxed file has actually been read.
    onProgress(Math.min(0.99, Math.max(0, ratio)));
  };
  ffmpeg.on("progress", progressHandler);
  try {
    const codecArgs =
      format === "webm"
        ? [
            "-c:v", "libvpx-vp9",
            "-crf", "35",
            "-b:v", "0",
            "-row-mt", "1",
            "-cpu-used", "8",
            ...(withAudio ? ["-c:a", "libopus", "-b:a", "128k"] : []),
          ]
        : [
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "22",
            ...(withAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
          ];

    const runExport = async (
      activeFilter: string,
      activeMap: string,
      extraInputs: string[] = []
    ) => {
      stalled = false;
      armStallTimer();
      const code = await ffmpeg.exec([
        "-i",
        input,
        ...extraInputs,
        "-filter_complex",
        activeFilter,
        "-map",
        activeMap,
        ...(withAudio ? ["-map", audioMap ?? "[outa]"] : ["-an"]),
        ...codecArgs,
        // Filters such as overlays can keep producing repeated frames after
        // their primary input reaches EOF. Cap the muxed program explicitly.
        "-t",
        compositionDuration.toFixed(3),
        "-y",
        out,
      ]);
      clearStallTimer();
      if (code !== 0) throw new Error(en["error.videoExport"]);
    };

    try {
      await runExport(filter, videoMap, layerInputArgs);
    } catch (err) {
      if (stalled) throw new Error(en["error.exportStalled"]);
      throw err;
    }
    armStallTimer();
    let data: Uint8Array;
    try {
      data = (await ffmpeg.readFile(out)) as Uint8Array;
    } catch (readErr) {
      if (stalled) throw new Error(en["error.exportStalled"]);
      throw readErr;
    }
    clearStallTimer();
    const buf =
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? (data.buffer as ArrayBuffer)
        : data.slice().buffer;
    const blob = new Blob([buf], {
      type: format === "webm" ? "video/webm" : "video/mp4",
    });
    await ffmpeg.deleteFile(out);
    onProgress(1);
    return blob;
  } finally {
    clearStallTimer();
    ffmpeg.off("progress", progressHandler);
    for (const path of layerFiles) {
      try {
        await ffmpeg.deleteFile(path);
      } catch {
        // Best effort cleanup for temporary layer assets.
      }
    }
  }
}

function dataUrlBytes(source: string): Uint8Array {
  const match = /^data:[^;]+;base64,([\s\S]+)$/.exec(source);
  if (!match) throw new Error("Image layer has an invalid source.");
  const binary = atob(match[1]);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function imageFileExtension(source: string): string {
  const mime = /^data:([^;]+);base64,/i.exec(source)?.[1]?.toLowerCase();
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return ".png";
}

/**
 * Render an edited audio-only file: keep only `keepRanges` and concatenate
 * them. Works for both audio projects and the audio track of a video file.
 */
export async function exportAudio(
  file: File,
  keepRanges: TimeRange[],
  editedDuration: number,
  onProgress: (ratio: number) => void,
  { format = "m4a" }: AudioExportOptions = {}
): Promise<Blob> {
  if (keepRanges.length === 0) {
    throw new Error(en["error.nothingToExport"]);
  }
  const ffmpeg = await getFFmpeg();
  const input = await ensureInput(ffmpeg, file);
  const out =
    format === "mp3" ? "output.mp3" : format === "wav" ? "output.wav" : "output.m4a";

  const parts: string[] = [];
  const labels: string[] = [];
  keepRanges.forEach((r, i) => {
    const s = r.start.toFixed(3);
    const e = r.end.toFixed(3);
    parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[a${i}]`);
  });
  const filter =
    parts.join(";") +
    `;${labels.join("")}concat=n=${keepRanges.length}:v=0:a=1[outa]`;

  const progressHandler = ({ time }: { progress: number; time: number }) => {
    const ratio = Math.min(1, time / 1e6 / Math.max(0.001, editedDuration));
    onProgress(Math.max(0, ratio));
  };
  ffmpeg.on("progress", progressHandler);
  try {
    const codecArgs =
      format === "mp3"
        ? ["-c:a", "libmp3lame", "-b:a", "192k"]
        : format === "wav"
          ? ["-c:a", "pcm_s16le"]
          : ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];

    const code = await ffmpeg.exec([
      "-i", input,
      "-filter_complex", filter,
      "-map", "[outa]",
      ...codecArgs,
      "-y", out,
    ]);
    if (code !== 0) throw new Error(en["error.audioExport"]);
    const data = (await ffmpeg.readFile(out)) as Uint8Array;
    await ffmpeg.deleteFile(out);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const mime =
      format === "mp3"
        ? "audio/mpeg"
        : format === "wav"
          ? "audio/wav"
          : "audio/mp4";
    return new Blob([buf as ArrayBuffer], { type: mime });
  } finally {
    ffmpeg.off("progress", progressHandler);
  }
}
