"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { LayerTransform, VideoLayer } from "@/lib/types";

export default function VideoLayerOverlay({
  layer,
  layerIndex,
  src,
  currentTime,
  playing,
  onSelect,
  onCrop,
  onTransformChange,
}: {
  layer: VideoLayer;
  layerIndex: number;
  src: string;
  currentTime: number;
  playing: boolean;
  onSelect: () => void;
  onCrop: () => void;
  onTransformChange: (transform: Partial<LayerTransform>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragStart = useRef<{ x: number; y: number; transform: LayerTransform } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    if (Math.abs(video.currentTime - currentTime) > 0.08) video.currentTime = currentTime;
  }, [currentTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      transform: layer.transform,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 10 + layerIndex }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Move ${layer.name}`}
        onPointerDown={startDrag}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onCrop();
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !dragStart.current) return;
          const frame = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!frame) return;
          onTransformChange({
            x: dragStart.current.transform.x + ((event.clientX - dragStart.current.x) / frame.width) * 100,
            y: dragStart.current.transform.y + ((event.clientY - dragStart.current.y) / frame.height) * 100,
          });
        }}
        onPointerUp={(event) => {
          dragStart.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragStart.current = null;
        }}
        style={{
          left: `${layer.transform.x}%`,
          top: `${layer.transform.y}%`,
          width: `${layer.transform.width}%`,
          height: `${layer.transform.height}%`,
        }}
        className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
      >
        <div
          className="absolute"
          style={{
            left: `${((-layer.crop.x + layer.crop.width / 2) / layer.crop.width) * 100}%`,
            top: `${((-layer.crop.y + layer.crop.height / 2) / layer.crop.height) * 100}%`,
            width: `${(100 / layer.crop.width) * 100}%`,
            height: `${(100 / layer.crop.height) * 100}%`,
          }}
        >
          <video
            ref={videoRef}
            src={src}
            muted
            playsInline
            draggable={false}
            className="h-full w-full select-none object-fill"
          />
        </div>
      </div>
    </div>
  );
}
