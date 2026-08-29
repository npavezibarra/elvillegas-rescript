"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import {
  cutRangeAt,
  PLAYHEAD_EPSILON_S,
} from "@/lib/edits";
import { useCutRanges } from "@/hooks/useCutRanges";
import { useSelectedClipSegment } from "@/hooks/useSelectedClipSegment";
import CaptionOverlay from "./CaptionOverlay";
import LayerControls from "./LayerControls";
import LayerPropertiesPanel from "./LayerPropertiesPanel";
import StaticLayerOverlay from "./StaticLayerOverlay";
import { getTextLayerStyle, layerTiming } from "@/lib/layers";

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
  const showCaptions = useEditorStore((s) => s.showCaptions);
  const setShowCaptions = useEditorStore((s) => s.setShowCaptions);
  const layers = useEditorStore((s) => s.layers);
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const setSelectedLayerId = useEditorStore((s) => s.setSelectedLayerId);
  const updateLayerTransform = useEditorStore((s) => s.updateLayerTransform);
  const updateTextLayer = useEditorStore((s) => s.updateTextLayer);
  const addTextLayer = useEditorStore((s) => s.addTextLayer);
  const addImageLayer = useEditorStore((s) => s.addImageLayer);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  const moveLayerToIndex = useEditorStore((s) => s.moveLayerToIndex);
  const words = useEditorStore((s) => s.words);
  const duration = useEditorStore((s) => s.duration);
  const currentTime = useEditorStore((s) => s.currentTime);
  const [ratioMenuOpen, setRatioMenuOpen] = useState(false);
  const [layersMenuOpen, setLayersMenuOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const cuts = useCutRanges();
  const selectedClipSegment = useSelectedClipSegment();
  const activePlaybackRange = selectedClipSegment ?? aiClipPreviewRange;
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);

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

  useEffect(() => {
    if (!ratioMenuOpen && !layersMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      setRatioMenuOpen(false);
      setLayersMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [layersMenuOpen, ratioMenuOpen]);

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

  const addImageFromFile = useCallback(
    (file: File | undefined) => {
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") addImageLayer(reader.result, file.name);
      };
      reader.readAsDataURL(file);
    },
    [addImageLayer]
  );

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
  const selectedRatioLabel =
    selectedAspectRatio === "landscape"
      ? "16:9"
      : selectedAspectRatio === "portrait"
        ? "9:16"
        : "Original";
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
  const videoClassName =
    objectFit === "contain"
      ? "h-full w-full cursor-pointer object-contain"
      : "h-full w-full cursor-pointer object-cover";
  const layoutButtonClass = (selected: boolean, disabled: boolean) =>
    `flex h-7 items-center rounded-lg px-2 text-xs transition ${
      disabled
        ? "cursor-not-allowed text-zinc-300 dark:text-zinc-600"
        : selected
          ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    }`;

  const renderLayers = () => (
    <>
      {layers.map((layer, index) => {
        const timing = layerTiming(layer, duration);
        if (currentTime < timing.start || currentTime > timing.end) return null;
        if (layer.type === "text" && layer.source === "caption") {
          return (
            <CaptionOverlay
              key={layer.id}
              enabled={showCaptions}
              words={words}
              currentTime={currentTime}
              transform={layer.transform}
              textStyle={getTextLayerStyle(layer)}
              layerIndex={index}
              onTransformChange={(transform) => updateLayerTransform(layer.id, transform)}
              onSelect={() => setSelectedLayerId(layer.id)}
            />
          );
        }
        return (
          <StaticLayerOverlay
            key={layer.id}
            layer={layer}
            layerIndex={index}
            onSelect={() => setSelectedLayerId(layer.id)}
            onTransformChange={(transform) => updateLayerTransform(layer.id, transform)}
          />
        );
      })}
      {selectedLayer && (
        <LayerControls
          name={selectedLayer.name}
          transform={selectedLayer.transform}
          onTransformChange={(transform) => updateLayerTransform(selectedLayer.id, transform)}
        />
      )}
      {selectedLayer && (
        <LayerPropertiesPanel
          layer={selectedLayer}
          onTransformChange={(transform) => updateLayerTransform(selectedLayer.id, transform)}
          onTextChange={(update) => updateTextLayer(selectedLayer.id, update)}
          onRemove={() => removeLayer(selectedLayer.id)}
        />
      )}
    </>
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-zinc-900">
      <div
        ref={toolbarRef}
        className="relative z-20 flex h-10 shrink-0 items-center gap-2 border-b border-zinc-100/80 bg-white/75 px-3 backdrop-blur-md sm:px-4 dark:border-zinc-800/80 dark:bg-zinc-900/75"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Preview
        </span>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setRatioMenuOpen((v) => !v)}
                className="flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                RATIO
                <ChevronDown size={13} />
              </button>
              {ratioMenuOpen && (
                <div className="absolute left-0 top-full z-30 mt-1 min-w-36 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/30">
                  {([
                    { value: "original", label: "Original" },
                    { value: "landscape", label: "16:9" },
                    { value: "portrait", label: "9:16" },
                  ] as const).map((opt) => {
                    const selected = selectedAspectRatio === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                      onClick={() => {
                          setExportPreviewAspectRatio(
                            opt.value === "original" ? null : opt.value
                          );
                          setRatioMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition ${
                          selected
                            ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        }`}
                      >
                        <span>{opt.label}</span>
                        {selected && <span className="text-xs font-semibold">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <span className="hidden rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 sm:inline dark:bg-indigo-950/50 dark:text-indigo-300">
              {selectedRatioLabel}
            </span>

            <div className="relative">
              <button
                type="button"
                onClick={() => setLayersMenuOpen((open) => !open)}
                className="flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                Layers
                <ChevronDown size={13} />
              </button>
              {layersMenuOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/30">
                  <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">
                    Stack order
                  </p>
                  {[...layers].reverse().map((layer) => {
                    const index = layers.findIndex((item) => item.id === layer.id);
                    const selected = selectedLayerId === layer.id;
                    return (
                      <div
                        key={layer.id}
                        className={`flex items-center gap-1 rounded-lg px-1 py-0.5 ${
                          selected ? "bg-indigo-50 dark:bg-indigo-950/40" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedLayerId(layer.id)}
                          className="min-w-0 flex-1 truncate px-1.5 py-1 text-left text-xs text-zinc-600 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
                        >
                          {layer.name}
                        </button>
                        <button
                          type="button"
                          disabled={index === layers.length - 1}
                          onClick={() => moveLayerToIndex(layer.id, index + 1)}
                          aria-label={`Bring ${layer.name} forward`}
                          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveLayerToIndex(layer.id, index - 1)}
                          aria-label={`Send ${layer.name} backward`}
                          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        >
                          <ChevronDown size={12} />
                        </button>
                      </div>
                    );
                  })}
                  <div className="mt-1 flex gap-1 border-t border-zinc-100 pt-1 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => addTextLayer()}
                      className="flex-1 rounded-lg px-2 py-1.5 text-left text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      + Text
                    </button>
                    <label className="flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                      + Image
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => {
                          addImageFromFile(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>

            <span className="mx-1 hidden h-5 w-px bg-zinc-200 sm:block dark:bg-zinc-700" />
            <span className="hidden px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400 sm:inline dark:text-zinc-500">
              LAYOUT
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

            <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
            <button
              type="button"
              onClick={() => setShowCaptions(!showCaptions)}
              className={`flex h-7 items-center rounded-lg px-2 text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                showCaptions
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
              aria-pressed={showCaptions}
            >
              CC
            </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-zinc-50/70 p-3 sm:p-4 dark:bg-zinc-950/70">
        {framedPreview ? (
          <div
            className="relative inline-flex h-full max-h-full max-w-full overflow-hidden rounded-sm bg-black shadow-lg shadow-zinc-900/10 dark:shadow-black/40"
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
              className={videoClassName}
            />
            {renderLayers()}
          </div>
        ) : (
          <div className="relative inline-flex max-h-full max-w-full">
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
            {renderLayers()}
          </div>
        )}
      </div>
    </section>
  );
}
