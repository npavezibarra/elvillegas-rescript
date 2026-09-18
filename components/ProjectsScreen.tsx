"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  AudioLines,
  Film,
  FolderOpen,
  Loader2,
  Music,
  Trash2,
  Plus,
  Upload,
  X,
} from "lucide-react";
import logo from "@/assets/logo.png";
import SettingsMenu from "./SettingsMenu";
import ModelSelector, {
  LanguageSection,
  ModelOption,
  ModelOptionSeparator,
} from "./ModelSelector";
import ImportTranscriptOption from "./ImportTranscriptOption";
import AiClipsPanel from "./AiClipsPanel";
import YouTubeImportControl from "./YouTubeImportControl";
import { cancelTranscription } from "@/hooks/useTranscriber";
import { MODEL_ORDER } from "@/lib/models";
import { useCrossOriginIsolated } from "@/hooks/useCrossOriginIsolated";
import { detectMediaKind, MEDIA_ACCEPT } from "@/lib/media";
import { formatTime } from "@/lib/edits";
import { listProjects, type ProjectMeta } from "@/lib/projects";
import {
  deleteLibraryFile,
  fileFromLibraryRecord,
  getLibraryFile,
  listLibraryFiles,
  putLibraryFile,
  type LibraryFileMeta,
  type LibraryFileSource,
} from "@/lib/mediaLibrary";
import { isElectron } from "@/lib/platform";
import { resetFFmpeg } from "@/lib/ffmpeg";
import { useEditorStore } from "@/lib/store";
import type { SpeakerInfo, Word } from "@/lib/types";
import { useI18n } from "./I18nProvider";
import { formatRelativeTime, localizeRuntimeMessage } from "@/lib/i18n";
import type { RefObject } from "react";

const CARD_BACKGROUNDS = [
  "from-orange-500/20 via-zinc-900 to-zinc-900",
  "from-sky-500/20 via-zinc-900 to-zinc-900",
  "from-fuchsia-500/20 via-zinc-900 to-zinc-900",
  "from-emerald-500/20 via-zinc-900 to-zinc-900",
];

const MEDIA_ICON = {
  audio: AudioLines,
  video: Film,
};

function MediaGlyph({ dragging }: { dragging: boolean }) {
  return (
    <div className="pointer-events-none relative flex h-24 w-full items-center justify-center">
      <div
        className={`absolute h-[4.25rem] w-[3.25rem] -rotate-[11deg] rounded-2xl border border-zinc-200 bg-white shadow-sm transition-transform duration-300 ease-out dark:border-zinc-800 dark:bg-zinc-900 ${
          dragging
            ? "-translate-x-10 -translate-y-1.5 -rotate-[18deg]"
            : "translate-x-[-1.25rem] translate-y-0 group-hover:-translate-x-10 group-hover:-translate-y-1.5 group-hover:-rotate-[18deg]"
        }`}
      />
      <div
        className={`absolute z-10 flex h-20 w-16 items-center justify-center rounded-2xl border border-zinc-200 bg-white shadow-sm transition-transform duration-300 ease-out dark:border-zinc-800 dark:bg-zinc-900 ${
          dragging ? "-translate-y-2.5" : "group-hover:-translate-y-2.5"
        }`}
      >
        <Music size={22} className="text-neutral-400 dark:text-neutral-500" />
      </div>
      <div
        className={`absolute h-[4.25rem] w-[3.25rem] rotate-[11deg] rounded-2xl border border-zinc-200 bg-white shadow-sm transition-transform duration-300 ease-out dark:border-zinc-800 dark:bg-zinc-900 ${
          dragging
            ? "translate-x-10 -translate-y-1.5 rotate-[18deg]"
            : "translate-x-[1.25rem] translate-y-0 group-hover:translate-x-10 group-hover:-translate-y-1.5 group-hover:rotate-[18deg]"
        }`}
      />
    </div>
  );
}

function ProjectUploadCard({
  ready,
  dragging,
  source,
  pendingTranscript,
  onFiles,
  inputId,
  inputRef,
  onDraggingChange,
}: {
  ready: boolean;
  dragging: boolean;
  source: string;
  pendingTranscript: { name: string } | null;
  onFiles: (files: FileList | null) => void;
  inputId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const { locale } = useI18n();
  const isSpanish = locale === "es";
  const primary = isSpanish ? "Sube un video" : "Upload a new video";
  const secondary = isSpanish
    ? "Arrastra un archivo aquí o haz click para comenzar."
    : "Drag a file here or click to start a new project.";

  return (
    <label
      htmlFor={inputId}
      aria-disabled={!ready}
      tabIndex={ready ? 0 : -1}
      onClick={(e) => {
        if (!ready) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (!ready) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (ready) onDraggingChange(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (ready) onDraggingChange(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        onDraggingChange(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDraggingChange(false);
        onFiles(e.dataTransfer.files);
      }}
      className={`group relative flex min-h-[18rem] cursor-pointer flex-col justify-between overflow-hidden rounded-[1.75rem] border border-dashed p-6 transition ${
        ready
          ? dragging
            ? "border-neutral-500 bg-white shadow-xl shadow-black/5 dark:border-neutral-500 dark:bg-zinc-900"
            : "border-zinc-300 bg-white/85 hover:border-neutral-400 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/70 dark:hover:border-neutral-600"
        : "cursor-default border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-900/50"
      }`}
    >
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        disabled={!ready}
        className="sr-only"
        onChange={(e) => onFiles(e.target.files)}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {isSpanish ? "Proyecto nuevo" : "New project"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {primary}
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            {secondary}
          </p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
          <Plus size={18} />
        </div>
      </div>

      <MediaGlyph dragging={dragging} />

      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/90 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300">
        {!ready ? (
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            <span>{isSpanish ? "Preparando el motor multimedia…" : "Preparing the media engine…"}</span>
          </div>
        ) : source === "import" ? (
          pendingTranscript ? (
            <span>
              {isSpanish
                ? `Usaremos ${pendingTranscript.name} para el siguiente video.`
                : `We will use ${pendingTranscript.name} for the next video.`}
            </span>
          ) : (
            <span>
              {isSpanish
                ? "Elige una transcripción antes de subir el video."
                : "Pick a transcript before uploading a video."}
            </span>
          )
        ) : (
          <span>
            {isSpanish
              ? "Formatos soportados: MP4, WebM, MOV, MP3, WAV, M4A…"
              : "Supported formats: MP4, WebM, MOV, MP3, WAV, M4A…"}
          </span>
        )}
      </div>
    </label>
  );
}

function GetVideoOverlay({
  open,
  mode,
  ready,
  dragging,
  source,
  pendingTranscript,
  inputId,
  inputRef,
  onClose,
  onModeChange,
  onFiles,
  onDraggingChange,
  onImportedFile,
}: {
  open: boolean;
  mode: "youtube" | "upload";
  ready: boolean;
  dragging: boolean;
  source: string;
  pendingTranscript: { name: string } | null;
  inputId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onModeChange: (mode: "youtube" | "upload") => void;
  onFiles: (files: FileList | null) => void;
  onDraggingChange: (dragging: boolean) => void;
  onImportedFile: (
    file: File,
    options?: { words?: Word[]; speakers?: SpeakerInfo[] }
  ) => void;
}) {
  const { locale } = useI18n();
  const isSpanish = locale === "es";

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/35 px-4 py-6 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="get-video-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white shadow-2xl shadow-black/20 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-zinc-400 dark:text-zinc-500">
              {isSpanish ? "Herramienta" : "Tool"}
            </p>
            <h2
              id="get-video-title"
              className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
            >
              Get Video
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isSpanish ? "Cerrar" : "Close"}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          <div className="mb-5 grid grid-cols-2 rounded-full border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => onModeChange("youtube")}
              className={`h-10 rounded-full text-[13px] font-semibold transition ${
                mode === "youtube"
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-100 dark:text-zinc-950"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              YouTube URL
            </button>
            <button
              type="button"
              onClick={() => onModeChange("upload")}
              className={`h-10 rounded-full text-[13px] font-semibold transition ${
                mode === "upload"
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-100 dark:text-zinc-950"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {isSpanish ? "Subir video" : "Upload Video"}
            </button>
          </div>

          {mode === "youtube" && isElectron ? (
            <YouTubeImportControl ready={ready} onFile={onImportedFile} />
          ) : (
            <ProjectUploadCard
              ready={ready}
              dragging={dragging}
              source={source}
              pendingTranscript={pendingTranscript}
              onFiles={onFiles}
              inputId={inputId}
              inputRef={inputRef}
              onDraggingChange={onDraggingChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  busy,
  onOpen,
  onRemove,
  index,
}: {
  project: ProjectMeta;
  busy: boolean;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  index: number;
}) {
  const { locale, t } = useI18n();
  const KindIcon = MEDIA_ICON[project.mediaKind];
  const bg = CARD_BACKGROUNDS[index % CARD_BACKGROUNDS.length];

  return (
    <article className="group overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white/90 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 dark:border-zinc-800 dark:bg-zinc-900/80">
      <button
        type="button"
        disabled={busy}
        onClick={() => onOpen(project.id)}
        className="flex w-full cursor-pointer flex-col text-left disabled:cursor-not-allowed disabled:opacity-70"
      >
        <div className={`relative aspect-[16/11] overflow-hidden bg-gradient-to-br ${bg}`}>
          <div className="absolute inset-0 bg-black/25" />
          <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
            <KindIcon size={12} />
            <span>{project.mediaKind === "audio" ? t("export.audio") : t("export.video")}</span>
          </div>
          <div className="absolute bottom-4 left-4 right-4">
            <p className="max-w-[14rem] text-xl font-semibold tracking-tight text-white">
              {project.name}
            </p>
          </div>
        </div>

        <div className="flex items-end justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-zinc-900 dark:text-zinc-100">
              {project.name}
            </p>
            <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
              {formatRelativeTime(locale, project.updatedAt)}
              {project.duration > 0 ? ` · ${formatTime(project.duration)}` : ""}
            </p>
          </div>
          {busy && <Loader2 size={14} className="shrink-0 animate-spin text-zinc-400" />}
        </div>
      </button>

      <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
          {project.mediaKind}
        </span>
        <button
          type="button"
          title={t("upload.removeRecent")}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(project.id);
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function LibraryFileCard({
  item,
  busy,
  onTranscribe,
  onNewProject,
  onRemove,
}: {
  item: LibraryFileMeta;
  busy: boolean;
  onTranscribe: (id: string) => void;
  onNewProject: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const isSpanish = locale === "es";
  const KindIcon = MEDIA_ICON[item.mediaKind];
  const sizeMb = item.size / (1024 * 1024);

  const hasTranscript = item.transcriptStatus === "ready";

  return (
    <article className="overflow-hidden rounded-[1.25rem] border border-zinc-200 bg-white/90 shadow-sm transition hover:shadow-md hover:shadow-black/5 dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="flex w-full items-start gap-3 p-4 text-left">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          <KindIcon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-zinc-900 dark:text-zinc-100">
            {item.name}
          </p>
          <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
            {item.source === "youtube"
              ? isSpanish
                ? "YouTube"
                : "YouTube"
              : isSpanish
                ? "Subido"
                : "Uploaded"}
            {" · "}
            {sizeMb >= 10 ? Math.round(sizeMb) : sizeMb.toFixed(1)} MB
            {" · "}
            {formatRelativeTime(locale, item.updatedAt)}
          </p>
          <p className="mt-1 text-[12px] text-zinc-400 dark:text-zinc-500">
            {hasTranscript
              ? isSpanish
                ? `${item.transcriptWordCount} palabras transcritas`
                : `${item.transcriptWordCount} transcribed words`
              : isSpanish
                ? "Sin transcripción"
                : "No transcript yet"}
          </p>
        </div>
        {busy && <Loader2 size={14} className="mt-1 shrink-0 animate-spin text-zinc-400" />}
      </div>
      <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
          {item.mediaKind === "audio" ? t("export.audio") : t("export.video")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => (hasTranscript ? onNewProject(item.id) : onTranscribe(item.id))}
            className="inline-flex h-8 items-center justify-center rounded-full bg-zinc-900 px-3 text-[12px] font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
          >
            {hasTranscript
              ? isSpanish
                ? "Nuevo proyecto"
                : "New project"
              : isSpanish
                ? "Transcribir"
                : "Transcribe"}
          </button>
          <button
            type="button"
            title={t("upload.removeRecent")}
            disabled={busy}
            onClick={() => onRemove(item.id)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

export default function ProjectsScreen({
  onFile,
}: {
  onFile: (
    file: File,
    options?: { words?: Word[]; speakers?: SpeakerInfo[] }
  ) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [libraryFiles, setLibraryFiles] = useState<LibraryFileMeta[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showGetVideo, setShowGetVideo] = useState(false);
  const [getVideoMode, setGetVideoMode] = useState<"youtube" | "upload">(
    isElectron ? "youtube" : "upload"
  );
  const [processingElapsed, setProcessingElapsed] = useState(0);
  const isolation = useCrossOriginIsolated();
  const ready = isolation === "ready";
  const status = useEditorStore((s) => s.status);
  const progress = useEditorStore((s) => s.progress);
  const error = useEditorStore((s) => s.error);
  const videoFile = useEditorStore((s) => s.videoFile);
  const transcriptWordCount = useEditorStore((s) => s.words.length);
  const projectPhase = useEditorStore((s) => s.projectPhase);
  const source = useEditorStore((s) => s.source);
  const pendingTranscript = useEditorStore((s) => s.pendingTranscript);
  const loadVideo = useEditorStore((s) => s.loadVideo);
  const setError = useEditorStore((s) => s.setError);
  const openProject = useEditorStore((s) => s.openProject);
  const removeProject = useEditorStore((s) => s.removeProject);
  const { locale, t } = useI18n();
  const isSpanish = locale === "es";

  useEffect(() => {
    if (projectPhase !== "processing") return;
    const startedAt = Date.now();
    const updateElapsed = () =>
      setProcessingElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const initialTimer = window.setTimeout(updateElapsed, 0);
    const timer = window.setInterval(updateElapsed, 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [projectPhase, videoFile]);

  useEffect(() => {
    if (projectPhase !== "processing") return;
    const watchdog = window.setTimeout(() => {
      resetFFmpeg();
      cancelTranscription();
      setError(
        isSpanish
          ? "El proceso dejó de responder. El motor fue reiniciado; pulsa Reintentar."
          : "Processing stopped responding. The media engine was reset; press Retry."
      );
    }, 2 * 60 * 1000);
    return () => window.clearTimeout(watchdog);
  }, [isSpanish, progress.message, progress.value, projectPhase, setError]);

  const inferredProgressMessage =
    progress.message ||
    (status === "transcribing"
      ? isSpanish
        ? "Cargando modelo de voz…"
        : "Loading speech model…"
      : isSpanish
        ? "Cargando motor multimedia…"
        : "Loading media engine…");
  const elapsedLabel =
    processingElapsed < 60
      ? `${processingElapsed}s`
      : `${Math.floor(processingElapsed / 60)}m ${processingElapsed % 60}s`;

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (err) {
      console.warn("Failed to list saved projects.", err);
      setProjects([]);
    }
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      setLibraryFiles(await listLibraryFiles());
    } catch (err) {
      console.warn("Failed to list media library.", err);
      setLibraryFiles([]);
    }
  }, []);

  const rememberFile = useCallback(
    async (file: File, source: LibraryFileSource) => {
      try {
        await putLibraryFile(file, source);
        await refreshLibrary();
      } catch (err) {
        console.warn("Failed to add file to media library.", err);
      }
    },
    [refreshLibrary]
  );

  useEffect(() => {
    let cancelled = false;
    void listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch((err) => {
        console.warn("Failed to list saved projects.", err);
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listLibraryFiles()
      .then((rows) => {
        if (!cancelled) setLibraryFiles(rows);
      })
      .catch((err) => {
        console.warn("Failed to list media library.", err);
        if (!cancelled) setLibraryFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onLibraryUpdated = () => {
      void refreshLibrary();
    };
    window.addEventListener("rescript-library-updated", onLibraryUpdated);
    return () => {
      window.removeEventListener("rescript-library-updated", onLibraryUpdated);
    };
  }, [refreshLibrary]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!ready) return;
      const file = files?.[0];
      if (!file) return;
      if (!detectMediaKind(file)) {
        alert(t("editor.chooseMedia"));
        return;
      }
      const { source, pendingTranscript: pending } = useEditorStore.getState();
      if (source === "import") {
        if (!pending) {
          alert(t("editor.chooseTranscript"));
          return;
        }
        void rememberFile(file, "upload");
        onFile(file, { words: pending.words, speakers: pending.speakers });
        return;
      }
      void rememberFile(file, "upload");
      onFile(file);
    },
    [onFile, ready, rememberFile, t]
  );

  const handleImportedFile = useCallback(
    (file: File, source: LibraryFileSource, options?: { words?: Word[]; speakers?: SpeakerInfo[] }) => {
      void rememberFile(file, source);
      onFile(file, options);
    },
    [onFile, rememberFile]
  );

  const handleOpen = useCallback(
    async (id: string) => {
      if (!ready) return;
      setBusyId(id);
      try {
        await openProject(id);
      } catch (err) {
        console.error(err);
        alert(
          err instanceof Error
            ? localizeRuntimeMessage(err.message, t)
            : t("error.openProject")
        );
        await refreshProjects();
      } finally {
        setBusyId(null);
      }
    },
    [openProject, ready, refreshProjects, t]
  );

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await removeProject(id);
        await refreshProjects();
      } catch (err) {
        console.error(err);
        alert(t("error.removeProject"));
      }
    },
    [removeProject, refreshProjects, t]
  );

  const handleTranscribeLibraryFile = useCallback(
    async (id: string) => {
      if (!ready) return;
      setBusyId(id);
      try {
        const record = await getLibraryFile(id);
        if (!record) throw new Error(isSpanish ? "No encontramos ese archivo." : "We could not find that file.");
        onFile(fileFromLibraryRecord(record));
      } catch (err) {
        console.error(err);
        alert(err instanceof Error ? err.message : t("error.openProject"));
        await refreshLibrary();
      } finally {
        setBusyId(null);
      }
    },
    [isSpanish, onFile, ready, refreshLibrary, t]
  );

  const handleNewProjectFromLibraryFile = useCallback(
    async (id: string) => {
      if (!ready) return;
      setBusyId(id);
      try {
        const record = await getLibraryFile(id);
        if (!record) throw new Error(isSpanish ? "No encontramos ese archivo." : "We could not find that file.");
        const words = record.words ?? [];
        if (words.length === 0) {
          onFile(fileFromLibraryRecord(record));
          return;
        }
        onFile(fileFromLibraryRecord(record), {
          words,
          speakers: record.speakers ?? [],
        });
      } catch (err) {
        console.error(err);
        alert(err instanceof Error ? err.message : t("error.openProject"));
        await refreshLibrary();
      } finally {
        setBusyId(null);
      }
    },
    [isSpanish, onFile, ready, refreshLibrary, t]
  );

  const handleRemoveLibraryFile = useCallback(
    async (id: string) => {
      try {
        await deleteLibraryFile(id);
        await refreshLibrary();
      } catch (err) {
        console.error(err);
        alert(isSpanish ? "No se pudo borrar el archivo." : "Could not remove the file.");
      }
    },
    [isSpanish, refreshLibrary]
  );

  const handleCancelProcessing = useCallback(() => {
    cancelTranscription();
    resetFFmpeg();
    setError(isSpanish ? "Transcripción cancelada." : "Transcription cancelled.");
  }, [isSpanish, setError]);

  const handleRetryProcessing = useCallback(() => {
    if (!videoFile) return;
    resetFFmpeg();
    loadVideo(videoFile);
  }, [loadVideo, videoFile]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.9),_rgba(245,245,245,0.95)_36%,_rgba(240,240,240,1))] dark:bg-[radial-gradient(circle_at_top,_rgba(30,30,30,0.98),_rgba(10,10,10,1)_46%)]">
      <GetVideoOverlay
        open={showGetVideo}
        mode={getVideoMode}
        ready={ready}
        dragging={dragging}
        source={source}
        pendingTranscript={pendingTranscript}
        inputId={inputId}
        inputRef={inputRef}
        onClose={() => setShowGetVideo(false)}
        onModeChange={setGetVideoMode}
        onFiles={handleFiles}
        onDraggingChange={setDragging}
        onImportedFile={(file, options) => handleImportedFile(file, "youtube", options)}
      />
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-8 px-6 py-6 sm:px-8 lg:px-10">
        {!isElectron && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <div className="flex min-w-0 items-center">
                <Image
                  src={logo}
                  alt="Rescript"
                  width={24}
                  height={24}
                  priority
                  className="rounded-sm border border-zinc-200 dark:border-zinc-700"
                />
                <p className="ml-2 text-[15px] font-medium text-zinc-800 dark:text-zinc-100">
                  Rescript
                </p>
              </div>
            </Link>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <SettingsMenu />
              <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-700 mr-1" />
              <ModelSelector groupLabel={t("model.transcriptSource")}>
                {MODEL_ORDER.map((id) => (
                  <ModelOption key={id} id={id} />
                ))}
                <ModelOptionSeparator />
                <LanguageSection />
                <ModelOptionSeparator />
                <ImportTranscriptOption />
              </ModelSelector>
            </div>
          </div>
        )}

        <section className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-zinc-400 dark:text-zinc-500">
            {isSpanish ? "Ventana de proyectos" : "Projects"}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {isSpanish ? "Mis proyectos" : "My projects"}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                {isSpanish
                  ? "Sube un video nuevo, o vuelve a abrir uno que ya procesaste."
                  : "Upload a new video, or reopen a project you already processed."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-[13px] text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {isSpanish
                  ? `${projects.length} proyectos guardados`
                  : `${projects.length} saved projects`}
              </div>
              <button
                type="button"
                onClick={() => setShowGetVideo(true)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-zinc-950 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
              >
                <Upload size={15} />
                Get Video
              </button>
            </div>
          </div>
        </section>

        {videoFile && status !== "idle" && (
          <section className="grid gap-4 rounded-[1.75rem] border border-zinc-200 bg-white/90 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-zinc-400 dark:text-zinc-500">
                {isSpanish ? "Proyecto activo" : "Active project"}
              </p>
              <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {videoFile.name}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                {projectPhase === "error"
                  ? error ||
                    (isSpanish
                      ? "No se pudo procesar la transcripción."
                      : "The transcript could not be processed.")
                  : projectPhase === "processing"
                  ? inferredProgressMessage
                  : projectPhase === "transcript_ready"
                    ? isSpanish
                      ? "La transcripción terminó. Ingresa min/max en AI, copia el prompt, pega la respuesta del LLM y pulsa MAKE CLIPS."
                      : "The transcript is ready. Enter min/max in AI, copy the prompt, paste the LLM response, then press MAKE CLIPS."
                    : projectPhase === "clips_ready"
                      ? isSpanish
                        ? "Los clips ya están listos para revisar."
                        : "The clips are ready to review."
                      : isSpanish
                        ? "Abre un clip para entrar a la pantalla de edición."
                        : "Open a clip to enter the editing screen."}
              </p>
              {projectPhase === "processing" && (
                <div className="mt-4 max-w-xl">
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={`h-full rounded-full bg-zinc-950 transition-all dark:bg-zinc-100 ${
                        progress.value == null ? "w-1/3 animate-pulse" : ""
                      }`}
                      style={
                        progress.value == null
                          ? undefined
                          : { width: `${Math.max(2, Math.min(100, progress.value * 100))}%` }
                      }
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>
                      {progress.value == null
                        ? inferredProgressMessage
                        : isSpanish
                          ? "Avanzando"
                          : "In progress"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {progress.value == null
                        ? elapsedLabel
                        : `${Math.round(progress.value * 100)}%`}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {status === "ready" && transcriptWordCount > 0 && (
                <>
                  <AiClipsPanel triggerLabel={isSpanish ? "AI" : "AI"} />
                  <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400">
                    {isSpanish
                      ? "Ingresa min/max, copia el prompt y pulsa MAKE CLIPS"
                      : "Enter min/max, copy the prompt, then press MAKE CLIPS"}
                  </div>
                </>
              )}
              {projectPhase === "processing" && (
                <>
                  <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400">
                    <Loader2 size={14} className="animate-spin" />
                    <span>
                      {isSpanish ? "Procesando" : "Processing"} ·{" "}
                      {progress.value == null
                        ? elapsedLabel
                        : `${Math.round(progress.value * 100)}%`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelProcessing}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-2 text-[12px] font-semibold text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    {isSpanish ? "Cancelar" : "Cancel"}
                  </button>
                </>
              )}
              {projectPhase === "error" && (
                <button
                  type="button"
                  onClick={handleRetryProcessing}
                  className="rounded-full bg-zinc-900 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                >
                  {isSpanish ? "Reintentar" : "Retry"}
                </button>
              )}
              {projectPhase === "clips_ready" && (
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {isSpanish ? "Clips listos" : "Clips ready"}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Our Files
            </h2>
            <button
              type="button"
              onClick={() => setShowLibrary((value) => !value)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white/85 px-4 text-[13px] font-semibold text-zinc-700 shadow-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <FolderOpen size={15} />
              {showLibrary
                ? isSpanish
                  ? "Ocultar Our Files"
                  : "Hide Our Files"
                : isSpanish
                  ? `Ver Our Files (${libraryFiles.length})`
                  : `View Our Files (${libraryFiles.length})`}
            </button>
          </div>
          {showLibrary && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {libraryFiles.length === 0 ? (
                <div className="flex min-h-32 items-center justify-center rounded-[1.25rem] border border-dashed border-zinc-200 bg-white/70 p-6 text-center dark:border-zinc-800 dark:bg-zinc-900/50 md:col-span-2">
                  <p className="max-w-sm text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {isSpanish
                      ? "Los videos que bajes de YouTube o subas desde tu computador aparecerán aquí para reutilizarlos."
                      : "Videos imported from YouTube or uploaded from your computer will appear here for reuse."}
                  </p>
                </div>
              ) : (
                libraryFiles.map((item) => (
                  <LibraryFileCard
                    key={item.id}
                    item={item}
                    busy={busyId === item.id}
                    onTranscribe={handleTranscribeLibraryFile}
                    onNewProject={handleNewProjectFromLibraryFile}
                    onRemove={handleRemoveLibraryFile}
                  />
                ))
              )}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {isSpanish ? "Mis proyectos" : "My projects"}
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {projects.length === 0 ? (
              <div className="flex min-h-[18rem] items-center justify-center rounded-[1.75rem] border border-dashed border-zinc-200 bg-white/70 p-6 text-center dark:border-zinc-800 dark:bg-zinc-900/50 md:col-span-2">
                <div>
                  <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
                    {isSpanish ? "Aún no hay proyectos" : "No projects yet"}
                  </p>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {isSpanish
                      ? "Cuando subas el primer video, aparecerá aquí."
                      : "Your first uploaded video will appear here."}
                  </p>
                </div>
              </div>
            ) : (
              projects.map((project, index) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  busy={busyId === project.id}
                  onOpen={handleOpen}
                  onRemove={handleRemove}
                  index={index}
                />
              ))
            )}
          </div>
        </section>

        {!isElectron && (
          <p className="pb-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
            {isSpanish
              ? "La carga y el procesamiento siguen siendo locales en tu dispositivo."
              : "Upload and processing still happen locally on your device."}
          </p>
        )}
      </div>
    </div>
  );
}
