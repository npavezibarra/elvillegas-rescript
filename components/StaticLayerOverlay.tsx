"use client";

/* eslint-disable @next/next/no-img-element -- layers use project-persisted data URLs */

import { useRef } from "react";
import { DEFAULT_VIDEO_CROP, getTextLayerStyle } from "@/lib/layers";
import type { EditorLayer, LayerTransform } from "@/lib/types";

export default function StaticLayerOverlay({
  layer,
  layerIndex,
  onSelect,
  onCrop,
  onTransformChange,
}: {
  layer: Exclude<EditorLayer, { type: "text"; source: "caption" }>;
  layerIndex: number;
  onSelect: () => void;
  onCrop?: () => void;
  onTransformChange: (transform: Partial<LayerTransform>) => void;
}) {
  const start = useRef<{ x: number; y: number; transform: LayerTransform } | null>(null);
  const style = layer.type === "text" ? getTextLayerStyle(layer) : null;

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 10 + layerIndex }}>
      <div
        role="button"
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const frame = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!frame) return;
          onSelect();
          start.current = { x: event.clientX, y: event.clientY, transform: layer.transform };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onDoubleClick={(event) => {
          if (layer.type !== "image") return;
          event.preventDefault();
          event.stopPropagation();
          onCrop?.();
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !start.current) return;
          const frame = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!frame) return;
          onTransformChange({
            x: start.current.transform.x + ((event.clientX - start.current.x) / frame.width) * 100,
            y: start.current.transform.y + ((event.clientY - start.current.y) / frame.height) * 100,
          });
        }}
        onPointerUp={(event) => {
          start.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
        style={{
          left: `${layer.transform.x}%`,
          top: `${layer.transform.y}%`,
          width: `${layer.transform.width}%`,
          height: `${layer.transform.height}%`,
        }}
        className={`pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center active:cursor-grabbing ${
          layer.type === "image" ? "overflow-hidden" : ""
        }`}
      >
        {layer.type === "image" ? (
          <div
            className="absolute"
            style={{
              left: `${((-(layer.crop ?? DEFAULT_VIDEO_CROP).x + (layer.crop ?? DEFAULT_VIDEO_CROP).width / 2) / (layer.crop ?? DEFAULT_VIDEO_CROP).width) * 100}%`,
              top: `${((-(layer.crop ?? DEFAULT_VIDEO_CROP).y + (layer.crop ?? DEFAULT_VIDEO_CROP).height / 2) / (layer.crop ?? DEFAULT_VIDEO_CROP).height) * 100}%`,
              width: `${(100 / (layer.crop ?? DEFAULT_VIDEO_CROP).width) * 100}%`,
              height: `${(100 / (layer.crop ?? DEFAULT_VIDEO_CROP).height) * 100}%`,
            }}
          >
            <img src={layer.src} alt={layer.name} className="h-full w-full select-none object-cover" draggable={false} />
          </div>
        ) : (
          <div
            className="w-full whitespace-pre-wrap break-words px-2"
            style={{
              color: style!.color,
              fontFamily: style!.fontFamily,
              fontSize: `clamp(14px, ${style!.fontSize / 12}vw, ${style!.fontSize}px)`,
              fontWeight: style!.fontWeight,
              textAlign: style!.textAlign,
              lineHeight: style!.lineHeight,
              textShadow: style!.dropShadow ? "0 2px 6px rgba(0,0,0,0.8)" : "none",
            }}
          >
            {layer.text}
          </div>
        )}
      </div>
    </div>
  );
}
