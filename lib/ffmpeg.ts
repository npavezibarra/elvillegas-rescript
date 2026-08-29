"use client";

import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { en } from "@/lib/i18n/messages/en";
import type { EditorLayer, TimeRange, Word } from "./types";
import { serializeCaptionAss, serializeStaticTextAss } from "./captionsExport";
import { originalToEdited } from "./edits";
import { layerTiming } from "./layers";

const CORE_BASE = "/vendor/ffmpeg";
const INPUT_DIR = "/input";
const INPUT_NAME = "input_video";
const INPUT_PATH = `${INPUT_DIR}/${INPUT_NAME}`;

let ffmpegPromise: Promise<FFmpeg> | null = null;
let mountedFor: File | null = null;

/** Lazily load a singleton multi-threaded ffmpeg.wasm instance. */
export async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      // Multi-threaded ffmpeg.wasm needs SharedArrayBuffer, i.e. a
      // cross-origin-isolated page (COOP/COEP from vercel.json on the web, from
      // the app:// handler in Electron). Without it the core throws a bare
      // "SharedArrayBuffer is not defined" from deep inside the worker.
      if (!self.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
        throw new Error(
          "The media engine isn't ready yet — reload the page and try again."
        );
      }
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
        workerURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.worker.js`, "text/javascript"),
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
 * ffmpeg-core is built with INITIAL_MEMORY === MAXIMUM_MEMORY === 1 GiB on a
 * shared WebAssembly.Memory, so the full gigabyte is committed the moment the
 * core instantiates and never shrinks — deleting MEMFS files frees nothing.
 * Held across transcription it sits alongside onnxruntime's heap, the model
 * weights and the decoded PCM, and WebKit kills the tab for it ("This webpage
 * was reloaded because it was using significant memory"). Nothing needs ffmpeg
 * between audio extraction and export, so drop it there and pay one re-init.
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

/**
 * Extract the audio track as mono 16 kHz float PCM — the exact format
 * Whisper expects, and what we render the timeline waveform from.
 * Works for both video and audio-only files. Resolves to null when the file
 * has no audio track — those still open for editing with an empty transcript.
 */
export async function extractAudio(file: File): Promise<Float32Array | null> {
  const ffmpeg = await getFFmpeg();
  const input = await ensureInput(ffmpeg, file);
  const out = "audio.pcm";
  let sawAudioStream = false;
  const logHandler = ({ message }: { type: string; message: string }) => {
    if (/Stream #\d+:\d+.*: Audio:/.test(message)) sawAudioStream = true;
  };
  ffmpeg.on("log", logHandler);
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

  const layerFiles: string[] = [];
  const layerInputArgs: string[] = [];
  let wroteLayers = false;
  let layerSequence = 0;
  let imageInputIndex = 1;
  const layersToRender = layers.length > 0 ? layers : [];

  // Older callers can still request captions without the layer model.
  if (layersToRender.length === 0 && burnCaptions && captions?.words.length) {
    const path = "/captions.ass";
    const ass = serializeCaptionAss(captions.words, {
      cuts: captions.cuts,
      duration: captions.duration,
      playResX: captionDims.width,
      playResY: captionDims.height,
    });
    await ffmpeg.writeFile(path, new TextEncoder().encode(ass));
    layerFiles.push(path);
    filter += `;${videoMap}ass=filename=${path}:original_size=${captionDims.width}x${captionDims.height}[vl${layerSequence}]`;
    videoMap = `[vl${layerSequence++}]`;
    wroteLayers = true;
  }

  for (const layer of layersToRender) {
    const sourceDuration = captions?.duration ?? editedDuration;
    const originalTiming = layerTiming(layer, sourceDuration);
    const layerStart = originalToEdited(originalTiming.start, captions?.cuts ?? []);
    const layerEnd = originalToEdited(originalTiming.end, captions?.cuts ?? []);
    if (layer.type === "text") {
      if (layer.source === "caption" && (!burnCaptions || !captions?.words.length)) {
        continue;
      }
      const path = `/layer-${layerSequence}.ass`;
      const ass =
        layer.source === "caption"
          ? serializeCaptionAss(captions!.words, {
              cuts: captions!.cuts,
              duration: captions!.duration,
              playResX: captionDims.width,
              playResY: captionDims.height,
              layer,
              start: layerStart,
              end: layerEnd,
            })
          : serializeStaticTextAss(
              layer,
              editedDuration,
              captionDims.width,
              captionDims.height,
              layerStart,
              layerEnd
            );
      await ffmpeg.writeFile(path, new TextEncoder().encode(ass));
      layerFiles.push(path);
      filter += `;${videoMap}ass=filename=${path}:original_size=${captionDims.width}x${captionDims.height}[vl${layerSequence}]`;
      videoMap = `[vl${layerSequence++}]`;
      wroteLayers = true;
      continue;
    }

    const imagePath = `/layer-${layerSequence}${imageFileExtension(layer.src)}`;
    await ffmpeg.writeFile(imagePath, dataUrlBytes(layer.src));
    layerFiles.push(imagePath);
    layerInputArgs.push("-loop", "1", "-framerate", "30", "-i", imagePath);
    const width = even((layer.transform.width / 100) * captionDims.width);
    const height = even((layer.transform.height / 100) * captionDims.height);
    const x = Math.round((layer.transform.x / 100) * captionDims.width - width / 2);
    const y = Math.round((layer.transform.y / 100) * captionDims.height - height / 2);
    const imageLabel = `img${layerSequence}`;
    filter += `;[${imageInputIndex}:v]format=rgba,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0[${imageLabel}];${videoMap}[${imageLabel}]overlay=${x}:${y}:eof_action=repeat:enable='between(t,${layerStart.toFixed(3)},${layerEnd.toFixed(3)})'[vl${layerSequence}]`;
    videoMap = `[vl${layerSequence++}]`;
    imageInputIndex++;
    wroteLayers = true;
  }

  const progressHandler = ({ time }: { progress: number; time: number }) => {
    // `time` is the output timestamp in microseconds.
    const ratio = Math.min(1, time / 1e6 / Math.max(0.001, editedDuration));
    onProgress(Math.max(0, ratio));
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
            "-movflags", "+faststart",
          ];

    const runExport = async (
      activeFilter: string,
      activeMap: string,
      extraInputs: string[] = []
    ) => {
      const code = await ffmpeg.exec([
        "-i",
        input,
        ...extraInputs,
        "-filter_complex",
        activeFilter,
        "-map",
        activeMap,
        ...(withAudio ? ["-map", "[outa]"] : ["-an"]),
        ...codecArgs,
        "-y",
        out,
      ]);
      if (code !== 0) throw new Error(en["error.videoExport"]);
    };

    try {
      await runExport(filter, videoMap, layerInputArgs);
    } catch (err) {
      if (!wroteLayers) throw err;
      const fallbackFilter =
        parts.join(";") +
        `;${labels.join("")}concat=n=${keepRanges.length}:v=1:a=${
          withAudio ? 1 : 0
        }[outv]${withAudio ? "[outa]" : ""}` +
        (transform ? `;[outv]${transform}[vout]` : "");
      const fallbackMap = transform ? "[vout]" : "[outv]";
      await runExport(fallbackFilter, fallbackMap);
    }
    const data = (await ffmpeg.readFile(out)) as Uint8Array;
    await ffmpeg.deleteFile(out);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return new Blob([buf as ArrayBuffer], {
      type: format === "webm" ? "video/webm" : "video/mp4",
    });
  } finally {
    ffmpeg.off("progress", progressHandler);
    await Promise.all(
      layerFiles.map(async (path) => {
        try {
          await ffmpeg.deleteFile(path);
        } catch {
          // Best effort cleanup for temporary layer assets.
        }
      })
    );
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
