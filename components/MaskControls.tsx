"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { LayerTransform } from "@/lib/types";

type Corner = "nw" | "ne" | "sw" | "se";

const CORNERS: { corner: Corner; className: string; cursor: string }[] = [
  { corner: "nw", className: "-left-1.5 -top-1.5", cursor: "nwse-resize" },
  { corner: "ne", className: "-right-1.5 -top-1.5", cursor: "nesw-resize" },
  { corner: "sw", className: "-bottom-1.5 -left-1.5", cursor: "nesw-resize" },
  { corner: "se", className: "-bottom-1.5 -right-1.5", cursor: "nwse-resize" },
];

export default function MaskControls({
  transform,
  onTransformChange,
  label = "Mask",
}: {
  transform: LayerTransform;
  onTransformChange: (transform: Partial<LayerTransform>) => void;
  label?: string;
}) {
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const surface = event.currentTarget.closest("[data-layer-surface]");
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    const initial = transform;
    event.currentTarget.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      onTransformChange({
        x: initial.x + ((moveEvent.clientX - event.clientX) / bounds.width) * 100,
        y: initial.y + ((moveEvent.clientY - event.clientY) / bounds.height) * 100,
      });
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, corner: Corner) => {
    event.preventDefault();
    event.stopPropagation();
    const surface = event.currentTarget.closest("[data-layer-surface]");
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    const initial = transform;
    event.currentTarget.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = ((moveEvent.clientX - event.clientX) / bounds.width) * 100;
      const dy = ((moveEvent.clientY - event.clientY) / bounds.height) * 100;
      onTransformChange({
        x: initial.x + dx / 2,
        y: initial.y + dy / 2,
        width: initial.width + (corner.includes("e") ? dx : -dx),
        height: initial.height + (corner.includes("s") ? dy : -dy),
      });
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  const left = transform.x - transform.width / 2;
  const top = transform.y - transform.height / 2;
  const right = 100 - (transform.x + transform.width / 2);
  const bottom = 100 - (transform.y + transform.height / 2);

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: `${top}%` }} />
      <div className="absolute bottom-0 left-0 bg-black/55" style={{ top: `${top}%`, width: `${left}%`, height: `${transform.height}%` }} />
      <div className="absolute right-0 bg-black/55" style={{ top: `${top}%`, width: `${right}%`, height: `${transform.height}%` }} />
      <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${bottom}%` }} />
      <div
        role="button"
        tabIndex={0}
        aria-label="Move mask"
        onPointerDown={startDrag}
        style={{
          left: `${transform.x}%`,
          top: `${transform.y}%`,
          width: `${transform.width}%`,
          height: `${transform.height}%`,
        }}
        className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-move border-2 border-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
      >
        <span className="absolute -top-6 left-0 rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-semibold text-amber-950 shadow-sm">
          {label}
        </span>
        {CORNERS.map(({ corner, className, cursor }) => (
          <button
            key={corner}
            type="button"
            aria-label="Resize mask"
            onPointerDown={(event) => startResize(event, corner)}
            className={`absolute h-3 w-3 rounded-sm border-2 border-white bg-amber-400 shadow-sm ${className}`}
            style={{ cursor }}
          />
        ))}
      </div>
    </div>
  );
}
