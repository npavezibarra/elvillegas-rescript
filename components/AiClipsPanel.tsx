"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ClipboardCopy,
  FileJson2,
  GripVertical,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import Popover, { PopoverContent, PopoverTrigger } from "./Popover";
import { useEditorStore } from "@/lib/store";
import {
  buildAiTranscriptExport,
  parseClipSuggestions,
  reorderClipSuggestions,
} from "@/lib/aiClips";
import { formatTime } from "@/lib/edits";

function scoreLabel(score?: number): string {
  return score == null ? "—" : String(Math.round(score));
}

export default function AiClipsPanel({
  triggerLabel = "AI Clips",
}: {
  triggerLabel?: string;
} = {}) {
  const words = useEditorStore((s) => s.words);
  const speakers = useEditorStore((s) => s.speakers);
  const duration = useEditorStore((s) => s.duration);
  const suggestions = useEditorStore((s) => s.aiClipSuggestions);
  const durationRange = useEditorStore((s) => s.aiClipDurationRange);
  const previewRange = useEditorStore((s) => s.aiClipPreviewRange);
  const setSuggestions = useEditorStore((s) => s.setAiClipSuggestions);
  const setDurationRange = useEditorStore((s) => s.setAiClipDurationRange);
  const setPreviewRange = useEditorStore((s) => s.setAiClipPreviewRange);
  const createClipFromRange = useEditorStore((s) => s.createClipFromRange);
  const previewAiClip = useEditorStore((s) => s.previewAiClip);

  const [open, setOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [copyError, setCopyError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const canCopy = words.length > 0;
  const activePreview = useMemo(
    () =>
      previewRange
        ? suggestions.find(
            (s) =>
              Math.abs(s.start - previewRange.start) < 1e-3 &&
              Math.abs(s.end - previewRange.end) < 1e-3
          ) ?? null
        : null,
    [previewRange, suggestions]
  );

  const handleCopy = useCallback(async () => {
    if (!canCopy) return;
    setCopyError(null);
    setCopyBusy(true);
    try {
      const text = buildAiTranscriptExport(words, speakers);
      await navigator.clipboard.writeText(text);
    } catch (err) {
      setCopyError(
        err instanceof Error ? err.message : "Could not copy transcript."
      );
    } finally {
      setCopyBusy(false);
    }
  }, [canCopy, words, speakers]);

  const handleImport = useCallback(() => {
    setImportError(null);
    setCreateError(null);
    try {
      const parsed = parseClipSuggestions(pasteValue, duration);
      const min = durationRange.min.trim() === "" ? null : Number(durationRange.min);
      const max = durationRange.max.trim() === "" ? null : Number(durationRange.max);
      if (min !== null && (!Number.isFinite(min) || min < 0)) {
        throw new Error("Minimum clip length must be 0 or greater.");
      }
      if (max !== null && (!Number.isFinite(max) || max < 0)) {
        throw new Error("Maximum clip length must be 0 or greater.");
      }
      if (min !== null && max !== null && max < min) {
        throw new Error("Maximum clip length must be greater than minimum.");
      }
      const filtered = parsed.filter((clip) => {
        const clipDuration = clip.end - clip.start;
        if (min !== null && clipDuration < min - 1e-3) return false;
        if (max !== null && clipDuration > max + 1e-3) return false;
        return true;
      });
      if (filtered.length === 0) {
        throw new Error("No clips match the selected duration range.");
      }
      setSuggestions(filtered);
      setPreviewRange(null);
      setDragIndex(null);
      setDropIndex(null);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Could not import clips."
      );
    }
  }, [
    pasteValue,
    duration,
    durationRange.min,
    durationRange.max,
    setSuggestions,
    setPreviewRange,
  ]);

  const clearPreview = useCallback(() => {
    setPreviewRange(null);
  }, [setPreviewRange]);

  const handleCreateClip = useCallback(
    (start: number, end: number) => {
      setCreateError(null);
      const ok = createClipFromRange({ start, end });
      if (!ok) {
        setCreateError("Could not create a clip from that range.");
      }
    },
    [createClipFromRange]
  );

  const moveClip = useCallback(
    (fromIndex: number, toIndex: number) => {
      setSuggestions(reorderClipSuggestions(suggestions, fromIndex, toIndex));
      setDragIndex(null);
      setDropIndex(null);
    },
    [setSuggestions, suggestions]
  );

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-end" backdrop>
      <div className="relative z-30 shrink-0">
        <PopoverTrigger>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <Sparkles size={14} />
            <span className="hidden sm:inline">{triggerLabel}</span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          role="dialog"
          aria-label="AI Clips"
          className="z-40 w-[32rem] max-w-[calc(100vw-16px)] overflow-hidden"
        >
          <div className="border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
            <p className="text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
              {triggerLabel}
            </p>
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!canCopy || copyBusy}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <ClipboardCopy size={14} />
              {copyBusy ? "Copying transcript…" : "Copy Transcript for AI"}
            </button>
            {copyError && (
              <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                {copyError}
              </p>
            )}
            {createError && (
              <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                {createError}
              </p>
            )}
          </div>

          <div className="space-y-3 px-3 py-3">
            <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
                  Clip duration range
                </p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {durationRange.min.trim() === "" ? "0" : durationRange.min}s
                  {" "}
                  to
                  {" "}
                  {durationRange.max.trim() === "" ? "any" : `${durationRange.max}s`}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    Min seconds
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={durationRange.min}
                    onChange={(e) =>
                      setDurationRange({ ...durationRange, min: e.target.value })
                    }
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    Max seconds
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={durationRange.max}
                    onChange={(e) =>
                      setDurationRange({ ...durationRange, max: e.target.value })
                    }
                    placeholder="Any"
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
                  />
                </label>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                Only clips whose duration falls inside this range will be imported.
              </p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
                Paste ChatGPT clip results:
              </span>
              <textarea
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                placeholder='[{"title":"The nuclear option","start":751.2,"end":844.3,"score":94,"reason":"..."}]'
                className="h-36 w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
              />
            </label>
            {importError && (
              <p className="text-[11px] text-red-600 dark:text-red-400">
                {importError}
              </p>
            )}
            <button
              type="button"
              onClick={handleImport}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <FileJson2 size={14} />
              MAKE CLIPS
            </button>
          </div>

          <div className="border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
                Imported clips
              </p>
              {suggestions.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSuggestions([]);
                    clearPreview();
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <X size={12} />
                  Clear
                </button>
              )}
            </div>

            {suggestions.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                Paste ChatGPT JSON above to load proposed clips.
              </p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {suggestions.map((clip, index) => {
                  const isActive =
                    activePreview != null &&
                    Math.abs(activePreview.start - clip.start) < 1e-3 &&
                    Math.abs(activePreview.end - clip.end) < 1e-3;
                  const isDragging = dragIndex === index;
                  const isDropTarget = dropIndex === index && dragIndex !== index;
                  return (
                    <div
                      key={`${clip.title}-${clip.start}-${clip.end}-${index}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(index));
                        setDragIndex(index);
                        setDropIndex(index);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragIndex == null || dragIndex === index) return;
                        setDropIndex(index);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIndex == null) return;
                        moveClip(dragIndex, index);
                      }}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDropIndex(null);
                      }}
                      className={`rounded-xl border p-3 ${
                        isActive
                          ? "border-zinc-400 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800/80"
                          : isDropTarget
                            ? "border-zinc-400 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800/80"
                            : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                      }`}
                      style={{
                        opacity: isDragging ? 0.55 : 1,
                        transform: isDragging ? "scale(0.99)" : undefined,
                        cursor: "grab",
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-1 shrink-0 text-zinc-300 dark:text-zinc-600">
                          <GripVertical size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {typeof clip.score === "number" && (
                              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
                                {scoreLabel(clip.score)}
                              </span>
                            )}
                            <h3 className="truncate text-[13px] font-semibold uppercase tracking-wide text-zinc-800 dark:text-zinc-100">
                              {clip.title}
                            </h3>
                          </div>
                          <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
                            {formatTime(clip.start)} → {formatTime(clip.end)}
                          </p>
                          <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">
                            {(clip.end - clip.start).toFixed(1)}s
                          </p>
                          {clip.reason && (
                            <p className="mt-2 text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                              {clip.reason}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            previewAiClip({ start: clip.start, end: clip.end })
                          }
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          <Play size={12} />
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCreateClip(clip.start, clip.end)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                        >
                          Create Clip
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </PopoverContent>
      </div>
    </Popover>
  );
}
