"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { LayerTransform } from "@/lib/types";

type Corner = "nw" | "ne" | "sw" | "se";

const CORNERS: { corner: Corner; className: string; cursor: string }[] = [
  { corner: "nw", className: "-left-1 -top-1", cursor: "nwse-resize" },
  { corner: "ne", className: "-right-1 -top-1", cursor: "nesw-resize" },
  { corner: "sw", className: "-bottom-1 -left-1", cursor: "nesw-resize" },
  { corner: "se", className: "-bottom-1 -right-1", cursor: "nwse-resize" },
];

export default function LayerControls({
  name,
  transform,
  onTransformChange,
}: {
  name: string;
  transform: LayerTransform;
  onTransformChange: (transform: Partial<LayerTransform>) => void;
}) {
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
        width: initial.width + (corner.includes("e") ? dx : -dx) * 2,
        height: initial.height + (corner.includes("s") ? dy : -dy) * 2,
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

  return (
    <div data-layer-surface className="pointer-events-none absolute inset-0 z-30">
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 border border-indigo-400 shadow-[0_0_0_1px_rgba(255,255,255,0.8)]"
        style={{
          left: `${transform.x}%`,
          top: `${transform.y}%`,
          width: `${transform.width}%`,
          height: `${transform.height}%`,
        }}
      >
        <span className="absolute -top-5 left-0 rounded bg-indigo-500 px-1.5 py-0.5 text-[9px] font-medium text-white shadow-sm">
          {name}
        </span>
        {CORNERS.map(({ corner, className, cursor }) => (
          <button
            key={corner}
            type="button"
            aria-label={`Resize ${name}`}
            onPointerDown={(event) => startResize(event, corner)}
            className={`pointer-events-auto absolute h-2.5 w-2.5 rounded-sm border border-white bg-indigo-500 shadow-sm ${className}`}
            style={{ cursor }}
          />
        ))}
      </div>
    </div>
  );
}
