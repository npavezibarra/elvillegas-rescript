"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { getTextLayerStyle } from "@/lib/layers";
import type { EditorLayer, LayerTransform, TextLayerStyle } from "@/lib/types";

const TRANSFORM_FIELDS: { key: keyof LayerTransform; label: string }[] = [
  { key: "x", label: "X" },
  { key: "y", label: "Y" },
  { key: "width", label: "W" },
  { key: "height", label: "H" },
];

export default function LayerPropertiesPanel({
  layer,
  onTransformChange,
  onTextChange,
  onRemove,
}: {
  layer: EditorLayer;
  onTransformChange: (transform: Partial<LayerTransform>) => void;
  onTextChange: (update: { text?: string; style?: Partial<TextLayerStyle> }) => void;
  onRemove: () => void;
}) {
  const textStyle = layer.type === "text" ? getTextLayerStyle(layer) : null;
  const [tab, setTab] = useState<"layout" | "style">("layout");

  return (
    <aside className="absolute right-3 top-3 z-40 w-56 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-xl shadow-zinc-900/10 backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95 dark:shadow-black/30">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">{layer.name}</span>
        {layer.id !== "captions" && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove layer"
            className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {layer.type === "text" && (
        <div className="mb-2 flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
          {([
            ["layout", "Layout"],
            ["style", "Style"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 rounded-md py-1 text-[10px] font-medium transition ${
                tab === id
                  ? "bg-white text-indigo-700 shadow-sm dark:bg-zinc-700 dark:text-indigo-300"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(layer.type !== "text" || tab === "layout") && <div className="grid grid-cols-4 gap-1 border-y border-zinc-100 py-2 dark:border-zinc-800">
        {TRANSFORM_FIELDS.map(({ key, label }) => (
          <label key={key} className="min-w-0 text-[9px] font-semibold text-zinc-400">
            {label}
            <input
              type="number"
              min="0"
              max="100"
              value={Math.round(layer.transform[key])}
              onChange={(event) => onTransformChange({ [key]: Number(event.target.value) })}
              className="mt-0.5 w-full rounded border border-zinc-200 bg-white px-1 py-1 text-[11px] font-medium text-zinc-700 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            />
          </label>
        ))}
      </div>}

      {layer.type === "text" && tab === "layout" && (
        <div className="space-y-2 pt-2">
          {layer.source === "static" ? (
            <label className="block text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
              Text
              <textarea
                value={layer.text}
                onChange={(event) => onTextChange({ text: event.target.value })}
                rows={3}
                className="mt-1 w-full resize-none rounded border border-zinc-200 bg-white p-1.5 text-xs text-zinc-700 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
              />
            </label>
          ) : (
            <p className="text-[10px] leading-relaxed text-zinc-400">Caption text comes from the transcript.</p>
          )}
          <div className="flex gap-1">
            {(["left", "center", "right"] as const).map((align) => (
              <button
                key={align}
                type="button"
                onClick={() => onTextChange({ style: { textAlign: align } })}
                className={`flex-1 rounded px-1.5 py-1 text-[10px] capitalize transition ${
                  textStyle!.textAlign === align
                    ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                    : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {align}
              </button>
            ))}
          </div>
        </div>
      )}

      {layer.type === "text" && tab === "style" && (
        <div className="space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <label className="block text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
            Font
            <select
              value={textStyle!.fontFamily}
              onChange={(event) => onTextChange({ style: { fontFamily: event.target.value } })}
              className="mt-1 w-full rounded border border-zinc-200 bg-white px-1.5 py-1.5 text-xs text-zinc-700 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            >
              <option value="Arial">Arial</option>
              <option value="Georgia">Georgia</option>
              <option value="Impact">Impact</option>
              <option value="Trebuchet MS">Trebuchet MS</option>
              <option value="Courier New">Courier New</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
              Color
              <input
                type="color"
                value={textStyle!.color}
                onChange={(event) => onTextChange({ style: { color: event.target.value } })}
                className="mt-1 block h-7 w-9 cursor-pointer rounded border border-zinc-200 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="flex-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
              Size
              <input
                type="number"
                min="12"
                max="96"
                value={textStyle!.fontSize}
                onChange={(event) => onTextChange({ style: { fontSize: Number(event.target.value) } })}
                className="mt-1 w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs text-zinc-700 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
              Weight
              <select
                value={textStyle!.fontWeight}
                onChange={(event) => onTextChange({ style: { fontWeight: Number(event.target.value) as 500 | 600 | 700 | 800 } })}
                className="mt-1 w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs text-zinc-700 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
              >
                <option value="500">Medium</option>
                <option value="600">Semibold</option>
                <option value="700">Bold</option>
                <option value="800">Extra bold</option>
              </select>
            </label>
            <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
              Line height
              <input
                type="number"
                min="0.8"
                max="2"
                step="0.05"
                value={textStyle!.lineHeight}
                onChange={(event) => onTextChange({ style: { lineHeight: Number(event.target.value) } })}
                className="mt-1 w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs text-zinc-700 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => onTextChange({ style: { dropShadow: !textStyle!.dropShadow } })}
            className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition ${
              textStyle!.dropShadow
                ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                : "bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            Drop shadow
            <span className="text-[10px] font-semibold uppercase">{textStyle!.dropShadow ? "On" : "Off"}</span>
          </button>
        </div>
      )}
    </aside>
  );
}
