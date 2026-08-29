"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEditorStore } from "@/lib/store";
import {
  cutRangeAt,
  PLAYHEAD_EPSILON_S,
} from "@/lib/edits";
import { useCutRanges } from "@/hooks/useCutRanges";
import { useSelectedClipSegment } from "@/hooks/useSelectedClipSegment";

/**
 * Owns the <video>/<audio> element and the cut-skipping playback loop.
 * In video mode this is the visual preview; in audio mode it mounts a hidden
 * <audio> so playback still works when the preview panel is omitted.
 */
export default function MediaPreview() {
  const mediaUrl = useEditorStore((s) => s.mediaUrl);
  const mediaKind = useEditorStore((s) => s.mediaKind);
  const setVideoEl = useEditorStore((s) => s.setVideoEl);
  const setDuration = useEditorStore((s) => s.setDuration);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const aiClipPreviewRange = useEditorStore((s) => s.aiClipPreviewRange);
  const setAiClipPreviewRange = useEditorStore((s) => s.setAiClipPreviewRange);
  const exportPreviewAspectRatio = useEditorStore(
    (s) => s.exportPreviewAspectRatio
  );
  const setExportPreviewAspectRatio = useEditorStore(
    (s) => s.setExportPreviewAspectRatio
  );
  const exportPreviewLayout = useEditorStore((s) => s.exportPreviewLayout);
  const setExportPreviewLayout = useEditorStore(
    (s) => s.setExportPreviewLayout
  );
  const cuts = useCutRanges();
  const selectedClipSegment = useSelectedClipSegment();
  const activePlaybackRange = selectedClipSegment ?? aiClipPreviewRange;

  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const isAudio = mediaKind === "audio";
  const cutsRef = useRef(cuts);
  useEffect(() => {
    cutsRef.current = cuts;
  }, [cuts]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !selectedClipSegment) return;
    if (
      media.currentTime < selectedClipSegment.start ||
      media.currentTime > selectedClipSegment.end
    ) {
      media.currentTime = selectedClipSegment.start;
      setCurrentTime(selectedClipSegment.start);
    }
  }, [selectedClipSegment, setCurrentTime]);

  const refCb = useCallback(
    (el: HTMLMediaElement | null) => {
      mediaRef.current = el;
      setVideoEl(el);
    },
    [setVideoEl]
  );

  // Playback loop: mirror time into the store and skip over cut ranges.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const media = mediaRef.current;
      if (media) {
        let t = media.currentTime;
        if (!media.paused) {
          if (activePlaybackRange && t >= activePlaybackRange.end - 0.02) {
            media.pause();
            media.currentTime = activePlaybackRange.end;
            if (!selectedClipSegment) setAiClipPreviewRange(null);
            t = activePlaybackRange.end;
          } else if (
            activePlaybackRange &&
            t < activePlaybackRange.start - 0.02
          ) {
            media.currentTime = activePlaybackRange.start;
            t = activePlaybackRange.start;
          }
          const cut = cutRangeAt(t, cutsRef.current);
          if (cut) {
            const target = cut.end + PLAYHEAD_EPSILON_S;
            if (target >= media.duration - 0.05) {
              media.pause();
              media.currentTime = cut.start;
              t = cut.start;
            } else {
              media.currentTime = target;
              t = target;
            }
          }
        }
        const prev = useEditorStore.getState().currentTime;
        if (Math.abs(prev - t) > 0.005) setCurrentTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    activePlaybackRange,
    selectedClipSegment,
    setAiClipPreviewRange,
    setCurrentTime,
  ]);

  const togglePlay = useCallback(() => {
    useEditorStore.getState().togglePlayback();
  }, []);

  if (!mediaUrl) return null;

  if (isAudio) {
    return (
      <audio
        ref={refCb}
        src={mediaUrl}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="hidden"
      />
    );
  }

  const selectedAspectRatio = exportPreviewAspectRatio ?? "original";
  const framedPreview =
    selectedAspectRatio === "landscape"
      ? "16 / 9"
      : selectedAspectRatio === "portrait"
        ? "9 / 16"
        : null;
  const isRatioOriginal = selectedAspectRatio === "original";
  const objectFit = isRatioOriginal
    ? "contain"
    : exportPreviewLayout === "fit"
      ? "contain"
      : "cover";
  const ratioButtonClass = (selected: boolean) =>
    `rounded-full px-2.5 py-1 transition ${
      selected
        ? "bg-white text-zinc-950 shadow-sm"
        : "text-white/70 hover:bg-white/10 hover:text-white"
    }`;
  const layoutButtonClass = (selected: boolean, disabled: boolean) =>
    `rounded-full px-2.5 py-1 transition ${
      disabled
        ? "cursor-not-allowed text-white/30"
        : selected
          ? "bg-white text-zinc-950 shadow-sm"
          : "text-white/70 hover:bg-white/10 hover:text-white"
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-50/70 p-3 sm:p-4 dark:bg-zinc-950/70">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="pointer-events-none absolute right-3 top-3 z-10">
          <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-zinc-950/85 p-1.5 text-xs font-medium text-white shadow-xl shadow-black/20 backdrop-blur">
            <span className="pl-1 pr-0.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
              Ratio
            </span>
            <button
              type="button"
              onClick={() => setExportPreviewAspectRatio(null)}
              className={ratioButtonClass(isRatioOriginal)}
            >
              Original
            </button>
            <button
              type="button"
              onClick={() => setExportPreviewAspectRatio("landscape")}
              className={ratioButtonClass(selectedAspectRatio === "landscape")}
            >
              16:9
            </button>
            <button
              type="button"
              onClick={() => setExportPreviewAspectRatio("portrait")}
              className={ratioButtonClass(selectedAspectRatio === "portrait")}
            >
              9:16
            </button>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <span className="pl-1 pr-0.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
              Layout
            </span>
            <button
              type="button"
              disabled={isRatioOriginal}
              onClick={() => setExportPreviewLayout("fit")}
              className={layoutButtonClass(
                exportPreviewLayout === "fit",
                isRatioOriginal
              )}
            >
              Fit
            </button>
            <button
              type="button"
              disabled={isRatioOriginal}
              onClick={() => setExportPreviewLayout("fill")}
              className={layoutButtonClass(
                exportPreviewLayout === "fill",
                isRatioOriginal
              )}
            >
              Fill
            </button>
          </div>
        </div>
        {framedPreview ? (
          <div
            className="relative h-full max-h-full max-w-full overflow-hidden rounded-sm bg-black shadow-lg shadow-zinc-900/10 dark:shadow-black/40"
            style={{ aspectRatio: framedPreview }}
          >
            <video
              ref={refCb}
              src={mediaUrl}
              playsInline
              onClick={togglePlay}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              className={
                objectFit === "contain"
                  ? "h-full w-full cursor-pointer object-contain"
                  : "h-full w-full cursor-pointer object-cover"
              }
            />
          </div>
        ) : (
          <video
            ref={refCb}
            src={mediaUrl}
            playsInline
            onClick={togglePlay}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className="max-h-full max-w-full cursor-pointer rounded-sm bg-black object-contain shadow-lg shadow-zinc-900/10 dark:shadow-black/40"
          />
        )}
      </div>
    </div>
  );
}
