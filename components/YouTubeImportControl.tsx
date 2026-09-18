"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Loader2, Square, SquarePlay } from "lucide-react";
import { detectMediaKind } from "@/lib/media";
import { useEditorStore } from "@/lib/store";
import type { SpeakerInfo, Word } from "@/lib/types";
import { localizeRuntimeMessage } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

function isImportableVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function YouTubeImportControl({
  ready,
  onFile,
}: {
  ready: boolean;
  onFile: (
    file: File,
    options?: { words?: Word[]; speakers?: SpeakerInfo[] }
  ) => void;
}) {
  const importId = useId();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    id: string;
    status: "starting" | "metadata" | "downloading" | "processing";
    percent: number | null;
    detail?: string;
  } | null>(null);
  const { locale, t } = useI18n();
  const isSpanish = locale === "es";

  useEffect(() => {
    if (!window.rescriptDesktop?.onYouTubeImportProgress) return;
    return window.rescriptDesktop.onYouTubeImportProgress((next) => {
      if (next.id !== importId) return;
      setProgress(next);
    });
  }, [importId]);

  const handleImport = useCallback(async () => {
    if (!ready || busy) return;
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!isImportableVideoUrl(trimmed)) {
      alert(t("youtube.invalidUrl"));
      return;
    }
    if (!window.rescriptDesktop?.importYouTubeVideo) {
      alert(t("youtube.desktopOnly"));
      return;
    }

    setBusy(true);
    setProgress({
      id: importId,
      status: "starting",
      percent: null,
      detail: t("youtube.starting"),
    });
    try {
      const downloaded = await window.rescriptDesktop.importYouTubeVideo({
        id: importId,
        url: trimmed,
      });
      const data =
        downloaded.data instanceof ArrayBuffer
          ? downloaded.data
          : new Uint8Array(downloaded.data).buffer;
      const file = new File([data], downloaded.name, { type: downloaded.type });
      if (!detectMediaKind(file)) {
        alert(t("editor.chooseMedia"));
        return;
      }

      const { source, pendingTranscript } = useEditorStore.getState();
      if (source === "import") {
        if (!pendingTranscript) {
          alert(t("editor.chooseTranscript"));
          return;
        }
        onFile(file, {
          words: pendingTranscript.words,
          speakers: pendingTranscript.speakers,
        });
        return;
      }
      onFile(file);
    } catch (err) {
      console.error(err);
      alert(
        err instanceof Error
          ? localizeRuntimeMessage(err.message, t)
          : t("youtube.failed")
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, importId, onFile, ready, t, url]);

  const handleCancel = useCallback(() => {
    if (!busy) return;
    void window.rescriptDesktop?.cancelYouTubeImport?.(importId);
  }, [busy, importId]);

  return (
    <form
      className="flex min-h-[18rem] flex-col justify-between rounded-[1.75rem] border border-zinc-200 bg-white/85 p-6 shadow-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:bg-zinc-900"
      onSubmit={(e) => {
        e.preventDefault();
        void handleImport();
      }}
    >
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {isSpanish ? "Proyecto nuevo" : "New project"}
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              <SquarePlay size={22} className="text-red-600" />
              {t("youtube.url")}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              {isSpanish
                ? "Pega un enlace de YouTube para importarlo a Rescript."
                : "Paste a YouTube link to import it into Rescript."}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <input
            id="youtube-url"
            type="url"
            inputMode="url"
            aria-label={t("youtube.url")}
            value={url}
            disabled={!ready || busy}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("youtube.placeholder")}
            className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
          />
          <button
            type="submit"
            disabled={!ready || busy || url.trim().length === 0}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 text-[13px] font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy ? t("youtube.importing") : t("youtube.import")}
          </button>
          {busy && (
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-[13px] font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <Square size={13} />
              {t("youtube.cancel")}
            </button>
          )}
        </div>
      </div>

      {busy ? (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-full rounded-full bg-zinc-950 transition-all dark:bg-zinc-100 ${progress?.percent == null ? "w-1/3 animate-pulse" : ""}`}
              style={progress?.percent == null ? undefined : { width: `${progress.percent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              {progress?.detail
                ? localizeRuntimeMessage(progress.detail, t)
                : t("youtube.importingVideo")}
            </span>
            <span className="shrink-0 tabular-nums">
              {progress?.percent == null ? "" : `${Math.round(progress.percent)}%`}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          {t("youtube.help")}
        </p>
      )}
    </form>
  );
}
