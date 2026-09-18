"use client";

import { useMemo, useRef } from "react";
import {
  buildCaptionBlocks,
  findActiveCaptionWord,
} from "@/lib/captions";
import type { LayerTransform, TextLayerStyle, Word } from "@/lib/types";

export default function CaptionOverlay({
  enabled = true,
  words,
  currentTime,
  transform,
  textStyle,
  layerIndex,
  onTransformChange,
  onSelect,
}: {
  enabled?: boolean;
  words: Word[];
  currentTime: number;
  transform: LayerTransform;
  textStyle: TextLayerStyle;
  layerIndex: number;
  onTransformChange: (transform: Partial<LayerTransform>) => void;
  onSelect: () => void;
}) {
  const blocks = useMemo(() => buildCaptionBlocks(words), [words]);
  const active = useMemo(
    () => findActiveCaptionWord(blocks, currentTime),
    [blocks, currentTime]
  );
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  if (!enabled || !active) return null;
  const block = blocks[active.blockIndex];
  if (!block) return null;

  const moveToPointer = (clientX: number, clientY: number, target: HTMLElement) => {
    const frame = target.parentElement?.getBoundingClientRect();
    const offset = dragOffset.current;
    if (!frame || !offset || frame.width === 0 || frame.height === 0) return;
    onTransformChange({
      x: Math.min(92, Math.max(8, ((clientX - frame.left - offset.x) / frame.width) * 100)),
      y: Math.min(92, Math.max(8, ((clientY - frame.top - offset.y) / frame.height) * 100)),
    });
  };

  return (
    <div
      className="pointer-events-none absolute inset-0 select-none"
      style={{ zIndex: 10 + layerIndex }}
    >
      <div
        key={block.id}
        role="group"
        aria-label="Drag captions to position them"
        title="Drag to position captions"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
          const frame = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!frame) return;
          dragOffset.current = {
            x: event.clientX - frame.left - (transform.x / 100) * frame.width,
            y: event.clientY - frame.top - (transform.y / 100) * frame.height,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          moveToPointer(event.clientX, event.clientY, event.currentTarget);
        }}
        onPointerUp={(event) => {
          dragOffset.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragOffset.current = null;
        }}
        style={{
          left: `${transform.x}%`,
          top: `${transform.y}%`,
          width: `${transform.width}%`,
          height: `${transform.height}%`,
          maxWidth: "44rem",
        }}
        className="caption-block pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center touch-none px-4 py-3 text-center active:cursor-grabbing sm:px-5 sm:py-3.5"
      >
        <div
          className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 tracking-[-0.02em]"
          style={{
            color: textStyle.color,
            fontFamily: textStyle.fontFamily,
            fontSize: `clamp(1rem, ${textStyle.fontSize / 12}vw, ${textStyle.fontSize}px)`,
            fontWeight: textStyle.fontWeight,
            textAlign: textStyle.textAlign,
            lineHeight: textStyle.lineHeight,
            textShadow: textStyle.dropShadow ? "0 2px 6px rgba(0,0,0,0.95)" : "none",
          }}
        >
          {block.words.map((word) => {
            const highlighted = word.id === active.word.id;
            return (
              <span
                key={word.id}
                style={highlighted ? { textShadow: "none" } : undefined}
                className={`caption-word rounded-md px-1.5 py-0.5 transition-all duration-150 ${
                  highlighted
                    ? "caption-word-active scale-[1.03] bg-amber-300 text-zinc-950"
                    : "opacity-95"
                }`}
              >
                {word.text}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
