"use client";

import { useCallback } from "react";
import { ArrowLeft, FileVideo, Sparkles } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { formatTime } from "@/lib/edits";
import { useI18n } from "./I18nProvider";
import { type ClipSuggestion } from "@/lib/aiClips";

function scoreLabel(score?: number): string {
  return score == null ? "—" : String(Math.round(score));
}

function ClipCard({
  clip,
  index,
  onOpen,
}: {
  clip: ClipSuggestion;
  index: number;
  onOpen: (clip: ClipSuggestion) => void;
}) {
  const { t } = useI18n();
  const duration = Math.max(0, clip.end - clip.start);
  const accent = [
    "from-amber-500/25 via-zinc-900 to-zinc-900",
    "from-sky-500/25 via-zinc-900 to-zinc-900",
    "from-fuchsia-500/25 via-zinc-900 to-zinc-900",
    "from-emerald-500/25 via-zinc-900 to-zinc-900",
  ][index % 4];

  return (
    <button
      type="button"
      onClick={() => onOpen(clip)}
      className="group overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 dark:border-zinc-800 dark:bg-zinc-900/80"
    >
      <div className={`relative aspect-[16/11] overflow-hidden bg-gradient-to-br ${accent}`}>
        <div className="absolute inset-0 bg-black/20" />
        <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
          <Sparkles size={12} />
          <span>{t("common.tools")}</span>
        </div>
        <div className="absolute bottom-4 left-4 right-4">
          <p className="max-w-[15rem] text-lg font-semibold leading-tight tracking-tight text-white">
            {clip.title}
          </p>
          <p className="mt-2 text-[12px] text-white/75">
            {formatTime(clip.start)} - {formatTime(clip.end)}
          </p>
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-medium text-zinc-900 dark:text-zinc-100">
              {clip.title}
            </p>
          <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
            {formatTime(duration)} clip
          </p>
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lime-500/10 text-lime-500 ring-1 ring-inset ring-lime-500/20">
            <span className="text-sm font-semibold leading-none">
              {scoreLabel(clip.score)}
            </span>
          </div>
        </div>

        {clip.reason ? (
          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            {clip.reason}
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-zinc-400 dark:text-zinc-500">
            {t("common.loading")}
          </p>
        )}
      </div>
    </button>
  );
}

export default function ClipsScreen() {
  const { locale } = useI18n();
  const suggestions = useEditorStore((s) => s.aiClipSuggestions);
  const videoFile = useEditorStore((s) => s.videoFile);
  const setSelectedWords = useEditorStore((s) => s.setSelectedWords);
  const setAiClipPreviewRange = useEditorStore((s) => s.setAiClipPreviewRange);
  const setWorkspaceScreen = useEditorStore((s) => s.setWorkspaceScreen);
  const setSelectedClipIndex = useEditorStore((s) => s.setSelectedClipIndex);
  const setSelectedCutIndex = useEditorStore((s) => s.setSelectedCutIndex);
  const isSpanish = locale === "es";

  const openClip = useCallback(
    (clip: ClipSuggestion) => {
      // Opening an LLM proposal must not mutate the timeline. It is a focused
      // editing view of that original-media range, even if other cuts exist.
      setSelectedClipIndex(null);
      setSelectedCutIndex(null);
      setAiClipPreviewRange({ start: clip.start, end: clip.end });
      setSelectedWords([]);
      setWorkspaceScreen("editor");
    },
    [
      setAiClipPreviewRange,
      setSelectedClipIndex,
      setSelectedCutIndex,
      setSelectedWords,
      setWorkspaceScreen,
    ]
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.92),_rgba(245,245,245,0.96)_36%,_rgba(240,240,240,1))] dark:bg-[radial-gradient(circle_at_top,_rgba(24,24,27,0.98),_rgba(9,9,11,1)_46%)]">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-8 px-6 py-6 sm:px-8 lg:px-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setWorkspaceScreen("projects")}
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft size={16} />
            <span>{isSpanish ? "Volver a proyectos" : "Back to projects"}</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-[13px] text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
              <FileVideo size={14} />
              <span>{videoFile?.name ?? (isSpanish ? "Proyecto" : "Project")}</span>
            </div>
          </div>
        </div>

        <section className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-zinc-400 dark:text-zinc-500">
            {isSpanish ? "Ventana de clips" : "Clips"}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {isSpanish ? "Clips encontrados" : "Detected clips"}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                {isSpanish
                  ? "Estos son los clips propuestos por el LLM. Haz click en uno para abrirlo en edición."
                  : "These are the clips proposed by the LLM. Click one to open it in the editor."}
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-[13px] text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
              <Sparkles size={14} />
              {isSpanish
                ? `${suggestions.length} clips listos`
                : `${suggestions.length} clips ready`}
            </div>
          </div>
        </section>

        {suggestions.length === 0 ? (
          <section className="flex min-h-[22rem] items-center justify-center rounded-[1.75rem] border border-dashed border-zinc-200 bg-white/70 p-6 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="max-w-md">
              <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                {isSpanish ? "Todavía no hay clips" : "No clips yet"}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                {isSpanish
                  ? "Vuelve a la ventana de proyectos, pega el resultado del LLM y pulsa MAKE CLIPS."
                  : "Return to the projects window, paste the LLM result, and press MAKE CLIPS."}
              </p>
            </div>
          </section>
        ) : (
          <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {suggestions.map((clip, index) => (
                <ClipCard
                  key={`${clip.title}-${clip.start}-${clip.end}-${index}`}
                  clip={clip}
                  index={index}
                  onOpen={openClip}
                />
              ))}
          </section>
        )}
      </div>
    </div>
  );
}
