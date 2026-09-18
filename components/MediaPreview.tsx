"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronUp, Crosshair, FileImage, Film, ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import {
  cutRangeAt,
  PLAYHEAD_EPSILON_S,
} from "@/lib/edits";
import { useCutRanges } from "@/hooks/useCutRanges";
import { useSelectedClipSegment } from "@/hooks/useSelectedClipSegment";
import CaptionOverlay from "./CaptionOverlay";
import CropDialog from "./CropDialog";
import LayerControls from "./LayerControls";
import LayerPropertiesPanel from "./LayerPropertiesPanel";
import StaticLayerOverlay from "./StaticLayerOverlay";
import { getCompositionDuration, getTextLayerStyle, renderLayerTiming } from "@/lib/layers";
import type { ImageLayer } from "@/lib/types";
import { getPreviewCaptionWords } from "@/lib/captions";
import { deleteMediaAsset, getMediaAsset, listMediaAssets, putMediaAsset, type MediaAssetMeta } from "@/lib/mediaAssets";

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
  const activeClipRange = useEditorStore((s) => s.activeClipRange);
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
  const videoTransform = useEditorStore((s) => s.videoTransform);
  const videoCrop = useEditorStore((s) => s.videoCrop);
  const videoCropAspectRatio = useEditorStore((s) => s.videoCropAspectRatio);
  const videoSelected = useEditorStore((s) => s.videoSelected);
  const setVideoSelected = useEditorStore((s) => s.setVideoSelected);
  const updateVideoTransform = useEditorStore((s) => s.updateVideoTransform);
  const updateVideoCrop = useEditorStore((s) => s.updateVideoCrop);
  const updateImageCrop = useEditorStore((s) => s.updateImageCrop);
  const setShowCaptions = useEditorStore((s) => s.setShowCaptions);
  const layers = useEditorStore((s) => s.layers);
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const setSelectedLayerId = useEditorStore((s) => s.setSelectedLayerId);
  const mediaMenuRequestId = useEditorStore((s) => s.mediaMenuRequestId);
  const updateLayerTransform = useEditorStore((s) => s.updateLayerTransform);
  const updateTextLayer = useEditorStore((s) => s.updateTextLayer);
  const addTextLayer = useEditorStore((s) => s.addTextLayer);
  const addImageLayer = useEditorStore((s) => s.addImageLayer);
  const addEndCardLayer = useEditorStore((s) => s.addEndCardLayer);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  const moveLayerToIndex = useEditorStore((s) => s.moveLayerToIndex);
  const words = useEditorStore((s) => s.words);
  const duration = useEditorStore((s) => s.duration);
  const currentTime = useEditorStore((s) => s.currentTime);
  const compositionDuration = useMemo(
    () => getCompositionDuration(layers, duration),
    [duration, layers]
  );
  const [cropOpen, setCropOpen] = useState(false);
  const [imageCropLayerId, setImageCropLayerId] = useState<string | null>(null);
  const [ratioMenuOpen, setRatioMenuOpen] = useState(false);
  const [layersMenuOpen, setLayersMenuOpen] = useState(false);
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [mediaAssets, setMediaAssets] = useState<MediaAssetMeta[]>([]);
  const [mediaAssetUrls, setMediaAssetUrls] = useState<Record<string, string>>({});
  const [mediaAssetsLoading, setMediaAssetsLoading] = useState(false);
  const [previewFrameSize, setPreviewFrameSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const cuts = useCutRanges();
  const selectedClipSegment = useSelectedClipSegment();
  const activePlaybackRange =
    activeClipRange ?? aiClipPreviewRange ?? selectedClipSegment;
  const captionWords = useMemo(
    () => getPreviewCaptionWords(words, cuts, activePlaybackRange),
    [activePlaybackRange, cuts, words]
  );
  const activePlaybackEnd = useMemo(
    () =>
      captionWords.reduce(
        (end, word) => Math.max(end, word.end),
        activePlaybackRange?.end ?? duration
      ),
    [activePlaybackRange, captionWords, duration]
  );
  const activeCompositionEnd = useMemo(
    () =>
      layers.reduce((end, layer) => {
        if (layer.type !== "image" || !layer.postRoll) return end;
        const timing = renderLayerTiming(layer, duration);
        if (timing.start < activePlaybackEnd - 0.001) return end;
        return Math.max(end, timing.end);
      }, activePlaybackEnd),
    [activePlaybackEnd, duration, layers]
  );
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);
  const imageCropLayer = layers.find(
    (layer): layer is ImageLayer =>
      layer.id === imageCropLayerId && layer.type === "image"
  );
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const videoDragStart = useRef<{ x: number; y: number; transform: typeof videoTransform } | null>(null);
  const suppressVideoClick = useRef(false);
  const isAudio = mediaKind === "audio";
  const cutsRef = useRef(cuts);
  const seenMediaMenuRequestId = useRef(mediaMenuRequestId);
  const postRollClockRef = useRef<number | null>(null);
  useEffect(() => {
    cutsRef.current = cuts;
  }, [cuts]);

  useEffect(() => {
    if (mediaMenuRequestId === seenMediaMenuRequestId.current) return;
    seenMediaMenuRequestId.current = mediaMenuRequestId;
    setMediaMenuOpen(true);
    setRatioMenuOpen(false);
    setLayersMenuOpen(false);
  }, [mediaMenuRequestId]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !activePlaybackRange) return;
    if (
      media.currentTime < activePlaybackRange.start ||
      media.currentTime > activePlaybackRange.end
    ) {
      media.currentTime = activePlaybackRange.start;
      setCurrentTime(activePlaybackRange.start);
    }
  }, [activePlaybackRange, setCurrentTime]);

  useEffect(() => {
    if (!ratioMenuOpen && !layersMenuOpen && !mediaMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      setRatioMenuOpen(false);
      setLayersMenuOpen(false);
      setMediaMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [layersMenuOpen, mediaMenuOpen, ratioMenuOpen]);

  useEffect(() => {
    if (!mediaMenuOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setMediaAssetsLoading(true);
    });
    void listMediaAssets()
      .then((assets) => {
        if (!cancelled) setMediaAssets(assets);
      })
      .finally(() => {
        if (!cancelled) setMediaAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaMenuOpen]);

  const selectedAspectRatio = exportPreviewAspectRatio ?? "landscape";
  const canvasAspectRatio =
    selectedAspectRatio === "portrait" ? 9 / 16 : 16 / 9;

  useEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport || isAudio) return;

    const fitFrameToViewport = () => {
      const bounds = viewport.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      let width = bounds.width;
      let height = width / canvasAspectRatio;
      if (height > bounds.height) {
        height = bounds.height;
        width = height * canvasAspectRatio;
      }

      setPreviewFrameSize({ width, height });
    };

    fitFrameToViewport();
    const observer = new ResizeObserver(fitFrameToViewport);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [canvasAspectRatio, isAudio, mediaUrl]);

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
        const now = performance.now();
        let t = media.currentTime;
        const store = useEditorStore.getState();
        const storeTime = store.currentTime;
        if (
          store.playing &&
          media.paused &&
          storeTime >= activePlaybackEnd - 0.02 &&
          storeTime < activeCompositionEnd - 0.005
        ) {
          const last = postRollClockRef.current ?? now;
          const nextTime = Math.min(
            activeCompositionEnd,
            Math.max(storeTime, activePlaybackEnd) + (now - last) / 1000
          );
          postRollClockRef.current = now;
          setCurrentTime(nextTime);
          if (nextTime >= activeCompositionEnd - 0.005) {
            postRollClockRef.current = null;
            setPlaying(false);
          }
          raf = requestAnimationFrame(tick);
          return;
        }
        postRollClockRef.current = null;
        if (!media.paused) {
          if (
            activePlaybackRange &&
            t >= activePlaybackEnd - 0.02 &&
            activeCompositionEnd > activePlaybackEnd + 0.005
          ) {
            media.pause();
            media.currentTime = activePlaybackEnd;
            setCurrentTime(activePlaybackEnd);
            setPlaying(true);
            postRollClockRef.current = now;
            raf = requestAnimationFrame(tick);
            return;
          }
          if (activePlaybackRange && t >= activePlaybackEnd - 0.02) {
            media.pause();
            media.currentTime = activePlaybackEnd;
            t = activePlaybackEnd;
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
        const showingPostRoll =
          storeTime >= duration - 0.02 && compositionDuration > duration;
        if (!showingPostRoll && Math.abs(storeTime - t) > 0.005) {
          setCurrentTime(t);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    activePlaybackRange,
    activePlaybackEnd,
    activeCompositionEnd,
    selectedClipSegment,
    setCurrentTime,
    setPlaying,
    compositionDuration,
    duration,
  ]);

  const togglePlay = useCallback(() => {
    useEditorStore.getState().togglePlayback();
  }, []);

  const startVideoDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const frame = event.currentTarget.closest("[data-video-frame]");
      if (!frame) return;
      setVideoSelected(true);
      setSelectedLayerId(null);
      videoDragStart.current = {
        x: event.clientX,
        y: event.clientY,
        transform: videoTransform,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [setSelectedLayerId, setVideoSelected, videoTransform]
  );

  const moveVideo = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId) || !videoDragStart.current) return;
      const frame = event.currentTarget.closest("[data-video-frame]");
      if (!frame) return;
      const bounds = frame.getBoundingClientRect();
      const dx = event.clientX - videoDragStart.current.x;
      const dy = event.clientY - videoDragStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) suppressVideoClick.current = true;
      updateVideoTransform({
        x: videoDragStart.current.transform.x + (dx / bounds.width) * 100,
        y: videoDragStart.current.transform.y + (dy / bounds.height) * 100,
      });
    },
    [updateVideoTransform]
  );

  const stopVideoDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    videoDragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const addImageFromFile = useCallback(
    (file: File | undefined) => {
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") return;
        const src = reader.result;
        const image = new window.Image();
        image.onload = () => {
          const aspectRatio =
            image.naturalWidth && image.naturalHeight
              ? image.naturalWidth / image.naturalHeight
              : undefined;
          addImageLayer(src, file.name, aspectRatio);
        };
        image.onerror = () => addImageLayer(src, file.name);
        image.src = src;
      };
      reader.readAsDataURL(file);
    },
    [addImageLayer]
  );

  const uploadMediaAssets = useCallback(async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) return;
    setMediaAssetsLoading(true);
    try {
      const saved = await Promise.all(selectedFiles.map((file) => putMediaAsset(file)));
      setMediaAssets((current) => [...saved, ...current]);
    } finally {
      setMediaAssetsLoading(false);
    }
  }, []);

  const removeMediaAsset = useCallback(async (asset: MediaAssetMeta) => {
    await deleteMediaAsset(asset.id);
    setMediaAssets((current) => current.filter((item) => item.id !== asset.id));
    setMediaAssetUrls((current) => {
      const next = { ...current };
      if (next[asset.id]) URL.revokeObjectURL(next[asset.id]);
      delete next[asset.id];
      return next;
    });
  }, []);

  const insertMediaAsset = useCallback(async (asset: MediaAssetMeta) => {
    if (!asset.type.startsWith("image/")) return;
    const stored = await getMediaAsset(asset.id);
    if (!stored) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : null;
      if (!src) return;
      const image = new window.Image();
      image.onload = () => {
        addEndCardLayer(src, stored.name, image.naturalWidth / image.naturalHeight);
        setMediaMenuOpen(false);
      };
      image.src = src;
    };
    reader.readAsDataURL(stored.blob);
  }, [addEndCardLayer]);

  const loadAssetUrl = useCallback(async (asset: MediaAssetMeta) => {
    if (mediaAssetUrls[asset.id]) return;
    const stored = await getMediaAsset(asset.id);
    if (!stored) return;
    const url = URL.createObjectURL(stored.blob);
    setMediaAssetUrls((current) => ({ ...current, [asset.id]: url }));
  }, [mediaAssetUrls]);

  useEffect(() => {
    mediaAssets.forEach((asset) => {
      void loadAssetUrl(asset);
    });
  }, [loadAssetUrl, mediaAssets]);

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

  const selectedRatioLabel =
    selectedAspectRatio === "portrait" ? "9:16" : "16:9";
  const transformedVideoClass =
    exportPreviewLayout === "fit"
      ? "h-full w-full select-none object-contain"
      : "h-full w-full select-none object-cover";
  const applyVideoCrop = (
    crop: typeof videoCrop,
    visibleCropAspectRatio: number
  ) => {
    updateVideoCrop(crop, visibleCropAspectRatio);
    // `LayerTransform` is stored as canvas percentages. Match its height to
    // the source crop so the purple box has the same visible proportion.
    updateVideoTransform({
      height:
        (videoTransform.width * getVisibleFrameAspectRatio()) /
        visibleCropAspectRatio,
    });
  };
  const getVisibleFrameAspectRatio = () => {
    const bounds = previewFrameRef.current?.getBoundingClientRect();
    return bounds?.width && bounds.height
      ? bounds.width / bounds.height
      : canvasAspectRatio;
  };
  const centerSelectedLayer = () => {
    if (selectedLayer) {
      updateLayerTransform(selectedLayer.id, { x: 50, y: 50 });
      return;
    }
    if (videoSelected) updateVideoTransform({ x: 50, y: 50 });
  };

  const renderLayers = () => (
    <>
      {layers.map((layer, index) => {
        const timing = renderLayerTiming(layer, duration);
        if (currentTime < timing.start || currentTime > timing.end) return null;
        if (layer.type === "text" && layer.source === "caption") {
          return (
            <CaptionOverlay
              key={layer.id}
              enabled={showCaptions}
              words={captionWords}
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
            onCrop={layer.type === "image" ? () => setImageCropLayerId(layer.id) : undefined}
          />
        );
      })}
      {selectedLayer && (
        <LayerControls
          name={selectedLayer.name}
          transform={selectedLayer.transform}
          onTransformChange={(transform) => updateLayerTransform(selectedLayer.id, transform)}
          lockAspectRatio={
            selectedLayer.type === "image" && Boolean(selectedLayer.cropAspectRatio)
          }
        />
      )}
      {selectedLayer && (
        <LayerPropertiesPanel
          layer={selectedLayer}
          onTransformChange={(transform) => updateLayerTransform(selectedLayer.id, transform)}
          onTextChange={(update) => updateTextLayer(selectedLayer.id, update)}
          onClose={() => setSelectedLayerId(null)}
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
                onClick={() => setMediaMenuOpen((open) => !open)}
                className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                  mediaMenuOpen
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                }`}
                aria-expanded={mediaMenuOpen}
              >
                MEDIA
                <ChevronDown size={13} />
              </button>
              {mediaMenuOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white p-2 shadow-lg shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/30">
                  <div className="flex items-center justify-between px-1 pb-2">
                    <div>
                      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Media library</p>
                      <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">Saved on this device</p>
                    </div>
                    <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
                      <Upload size={12} />
                      Add
                      <input
                        type="file"
                        multiple
                        accept="image/*,video/*,audio/*"
                        className="sr-only"
                        onChange={(event) => {
                          if (event.target.files) void uploadMediaAssets(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {mediaAssetsLoading && mediaAssets.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-400">
                      <Loader2 size={14} className="animate-spin" /> Loading media…
                    </div>
                  ) : mediaAssets.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-200 px-4 py-8 text-center dark:border-zinc-700">
                      <ImagePlus size={22} className="mx-auto mb-2 text-zinc-300 dark:text-zinc-600" />
                      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Your library is empty</p>
                      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">Add images, GIFs, videos or audio files.</p>
                    </div>
                  ) : (
                    <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-0.5 scrollbar-thin">
                      {mediaAssets.map((asset) => {
                        const isImage = asset.type.startsWith("image/");
                        const url = mediaAssetUrls[asset.id];
                        return (
                          <div key={asset.id} className="group relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                            <button
                              type="button"
                              disabled={!isImage}
                              onClick={() => void insertMediaAsset(asset)}
                              className="block w-full text-left disabled:cursor-default"
                              title={isImage ? "Add to timeline ending" : "Video and audio assets are stored for reuse"}
                            >
                              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                                {url && isImage ? (
                                  <img src={url} alt="" className="h-full w-full object-cover" />
                                ) : url && asset.type.startsWith("video/") ? (
                                  <video src={url} muted className="h-full w-full object-cover" />
                                ) : isImage ? (
                                  <FileImage size={20} className="text-zinc-400" />
                                ) : (
                                  <Film size={20} className="text-zinc-400" />
                                )}
                              </div>
                              <p className="truncate px-1.5 py-1.5 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">{asset.name}</p>
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeMediaAsset(asset)}
                              aria-label={`Delete ${asset.name}`}
                              className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition hover:bg-red-600 group-hover:opacity-100"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {mediaAssetsLoading && mediaAssets.length > 0 && (
                    <div className="flex items-center justify-center gap-1 pt-2 text-[10px] text-zinc-400">
                      <Loader2 size={11} className="animate-spin" /> Saving…
                    </div>
                  )}
                </div>
              )}
            </div>
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
                    { value: "landscape", label: "16:9" },
                    { value: "portrait", label: "9:16" },
                  ] as const).map((opt) => {
                    const selected = selectedAspectRatio === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setExportPreviewAspectRatio(opt.value);
                          const nextFrameAspectRatio =
                            opt.value === "landscape"
                              ? 16 / 9
                              : 9 / 16;
                          if (videoCropAspectRatio) {
                            updateVideoTransform({
                              height:
                                (videoTransform.width * nextFrameAspectRatio) /
                                videoCropAspectRatio,
                            });
                          }
                          layers.forEach((layer) => {
                            if (layer.type !== "image" || !layer.cropAspectRatio) return;
                            updateLayerTransform(layer.id, {
                              height:
                                (layer.transform.width * nextFrameAspectRatio) /
                                layer.cropAspectRatio,
                            });
                          });
                          // Start a new frame in Fit so no source content is
                          // lost unless the editor explicitly chooses Fill.
                          setExportPreviewLayout("fit");
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

            <button
              type="button"
              onClick={centerSelectedLayer}
              disabled={!selectedLayer && !videoSelected}
              title="Align selected layer to center"
              aria-label="Align selected layer to center"
              className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <Crosshair size={13} />
              <span className="hidden xl:inline">Center</span>
            </button>

            <span className="mx-1 hidden h-5 w-px bg-zinc-200 sm:block dark:bg-zinc-700" />
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
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black p-3 sm:p-4">
        <div
          ref={previewViewportRef}
          className="flex h-full w-full items-center justify-center overflow-hidden"
        >
          <div
            data-video-frame
            data-layer-surface
            ref={previewFrameRef}
            className="relative flex-none overflow-hidden rounded-sm border border-zinc-500 bg-black shadow-lg shadow-black/40"
            style={
              previewFrameSize
                ? previewFrameSize
                : { aspectRatio: canvasAspectRatio, maxHeight: "100%", maxWidth: "100%" }
            }
          >
          <div
            role="button"
            tabIndex={0}
            aria-label="Move and resize video"
            onPointerDown={startVideoDrag}
            onPointerMove={moveVideo}
            onPointerUp={stopVideoDrag}
            onPointerCancel={stopVideoDrag}
            onDoubleClick={() => {
              setVideoSelected(true);
              setCropOpen(true);
            }}
            onClick={() => {
              if (suppressVideoClick.current) {
                suppressVideoClick.current = false;
                return;
              }
              if (!videoSelected) return;
              togglePlay();
            }}
            style={{
              left: `${videoTransform.x}%`,
              top: `${videoTransform.y}%`,
              width: `${videoTransform.width}%`,
              height: `${videoTransform.height}%`,
            }}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
          >
            <div
              className="absolute"
              style={{
                left: `${((-videoCrop.x + videoCrop.width / 2) / videoCrop.width) * 100}%`,
                top: `${((-videoCrop.y + videoCrop.height / 2) / videoCrop.height) * 100}%`,
                width: `${(100 / videoCrop.width) * 100}%`,
                height: `${(100 / videoCrop.height) * 100}%`,
              }}
            >
              <video
                ref={refCb}
                src={mediaUrl}
                playsInline
                draggable={false}
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration);
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => {
                  const { currentTime: storeTime, playing: storePlaying } =
                    useEditorStore.getState();
                  if (
                    storePlaying &&
                    storeTime >= activePlaybackEnd - 0.02 &&
                    storeTime < activeCompositionEnd - 0.005
                  ) {
                    return;
                  }
                  setPlaying(false);
                }}
                className={transformedVideoClass}
              />
            </div>
          </div>
          {renderLayers()}
          {videoSelected && (
            <LayerControls
              name="Video"
              transform={videoTransform}
              onTransformChange={updateVideoTransform}
              lockAspectRatio
            />
          )}
          </div>
        </div>
      </div>
      {cropOpen && (
        <CropDialog
          src={mediaUrl}
          kind="video"
          currentTime={currentTime}
          crop={videoCrop}
          onClose={() => setCropOpen(false)}
          onApply={(crop, visibleCropAspectRatio) => {
            applyVideoCrop(crop, visibleCropAspectRatio);
            setCropOpen(false);
          }}
        />
      )}
      {imageCropLayer && (
        <CropDialog
          src={imageCropLayer.src}
          kind="image"
          crop={imageCropLayer.crop ?? { x: 50, y: 50, width: 100, height: 100 }}
          onClose={() => setImageCropLayerId(null)}
          onApply={(crop, visibleCropAspectRatio) => {
            updateImageCrop(
              imageCropLayer.id,
              crop,
              visibleCropAspectRatio
            );
            updateLayerTransform(imageCropLayer.id, {
              height:
                (imageCropLayer.transform.width * getVisibleFrameAspectRatio()) /
                visibleCropAspectRatio,
            });
            setImageCropLayerId(null);
          }}
        />
      )}
    </section>
  );
}
