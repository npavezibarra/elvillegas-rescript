"use client";

/* eslint-disable @next/next/no-img-element -- project images are persisted data URLs */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import MaskControls from "./MaskControls";
import { clampVideoCrop, DEFAULT_VIDEO_CROP } from "@/lib/layers";
import type { LayerTransform } from "@/lib/types";

export default function CropDialog({
  src,
  kind,
  currentTime,
  crop,
  onApply,
  onClose,
}: {
  src: string;
  kind: "video" | "image";
  currentTime?: number;
  crop: LayerTransform;
  onApply: (crop: LayerTransform, visibleCropAspectRatio: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(crop);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [surfaceSize, setSurfaceSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const cropViewportRef = useRef<HTMLDivElement | null>(null);
  const cropSurfaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (kind !== "video") return;
    const video = previewRef.current;
    if (!video) return;
    const seek = () => {
      const time = currentTime ?? 0;
      video.currentTime = Math.min(time, Math.max(0, video.duration || time));
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    return () => video.removeEventListener("loadedmetadata", seek);
  }, [currentTime, kind, src]);

  useEffect(() => {
    const viewport = cropViewportRef.current;
    if (!viewport) return;

    const fitSurfaceToViewport = () => {
      const bounds = viewport.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      let width = bounds.width;
      let height = width / aspectRatio;
      if (height > bounds.height) {
        height = bounds.height;
        width = height * aspectRatio;
      }
      setSurfaceSize({ width, height });
    };

    fitSurfaceToViewport();
    const observer = new ResizeObserver(fitSurfaceToViewport);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [aspectRatio, src]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop video"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flex max-h-[min(900px,calc(100vh-2rem))] w-full max-w-6xl flex-col rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl shadow-black/60 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">Crop</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Ajusta el área que quieres mostrar y aplica el recorte al canvas.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close crop"
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          >
            <X size={22} />
          </button>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-auto rounded-xl bg-black p-2 sm:p-4">
          <div
            ref={cropViewportRef}
            className="flex min-h-[320px] items-center justify-center"
            style={{ height: "min(65vh, 640px)" }}
          >
            <div
              data-layer-surface
              ref={cropSurfaceRef}
              className="relative flex-none overflow-hidden bg-black"
              style={
                surfaceSize
                  ? surfaceSize
                  : { aspectRatio, maxHeight: "100%", maxWidth: "100%" }
              }
            >
              {kind === "video" ? (
                <video
                  ref={previewRef}
                  src={src}
                  muted
                  playsInline
                  draggable={false}
                  onLoadedMetadata={(event) => {
                    if (event.currentTarget.videoWidth && event.currentTarget.videoHeight) {
                      setAspectRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight);
                    }
                  }}
                  className="h-full w-full select-none object-contain"
                />
              ) : (
                <img
                  src={src}
                  alt="Image crop preview"
                  draggable={false}
                  onLoad={(event) => {
                    if (event.currentTarget.naturalWidth && event.currentTarget.naturalHeight) {
                      setAspectRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight);
                    }
                  }}
                  className="h-full w-full select-none object-contain"
                />
              )}
              <MaskControls
                label="Crop"
                transform={draft}
                onTransformChange={(change) =>
                  setDraft((current) => clampVideoCrop(change, current))
                }
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setDraft(DEFAULT_VIDEO_CROP)}
            className="rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-700"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              const bounds = cropSurfaceRef.current?.getBoundingClientRect();
              const visibleCropAspectRatio =
                bounds?.width && bounds.height
                  ? ((draft.width / 100) * bounds.width) /
                    ((draft.height / 100) * bounds.height)
                  : (draft.width * aspectRatio) / Math.max(0.01, draft.height);
              onApply(draft, visibleCropAspectRatio);
            }}
            className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
          >
            Apply
          </button>
        </div>
      </section>
    </div>
  );
}
