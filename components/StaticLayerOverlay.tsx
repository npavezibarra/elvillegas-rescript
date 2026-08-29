"use client";

import { useRef } from "react";
import { getTextLayerStyle } from "@/lib/layers";
import type { EditorLayer, LayerTransform } from "@/lib/types";

export default function StaticLayerOverlay({
  layer,
  layerIndex,
  onSelect,
  onTransformChange,
}: {
  layer: Exclude<EditorLayer, { type: "text"; source: "caption" }>;
  layerIndex: number;
  onSelect: () => void;
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
        className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center active:cursor-grabbing"
      >
        {layer.type === "image" ? (
          <img src={layer.src} alt={layer.name} className="h-full w-full select-none object-contain" draggable={false} />
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
