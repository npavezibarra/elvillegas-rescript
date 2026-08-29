"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  AudioLines,
  Film,
  Loader2,
  Music,
  Trash2,
  Plus,
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
import { MODEL_ORDER } from "@/lib/models";
import { useCrossOriginIsolated } from "@/hooks/useCrossOriginIsolated";
import { detectMediaKind, MEDIA_ACCEPT } from "@/lib/media";
import { formatTime } from "@/lib/edits";
import { listProjects, type ProjectMeta } from "@/lib/projects";
import { isElectron } from "@/lib/platform";
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const isolation = useCrossOriginIsolated();
  const ready = isolation === "ready";
  const status = useEditorStore((s) => s.status);
  const progress = useEditorStore((s) => s.progress);
  const videoFile = useEditorStore((s) => s.videoFile);
  const projectPhase = useEditorStore((s) => s.projectPhase);
  const source = useEditorStore((s) => s.source);
  const pendingTranscript = useEditorStore((s) => s.pendingTranscript);
  const openProject = useEditorStore((s) => s.openProject);
  const removeProject = useEditorStore((s) => s.removeProject);
  const { locale, t } = useI18n();
  const isSpanish = locale === "es";

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (err) {
      console.warn("Failed to list saved projects.", err);
      setProjects([]);
    }
  }, []);

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
        onFile(file, { words: pending.words, speakers: pending.speakers });
        return;
      }
      onFile(file);
    },
    [onFile, ready, t]
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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.9),_rgba(245,245,245,0.95)_36%,_rgba(240,240,240,1))] dark:bg-[radial-gradient(circle_at_top,_rgba(30,30,30,0.98),_rgba(10,10,10,1)_46%)]">
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
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-[13px] text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {isSpanish
                ? `${projects.length} proyectos guardados`
                : `${projects.length} saved projects`}
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
                {status === "preparing" || status === "transcribing"
                  ? progress.message
                  : projectPhase === "transcript_ready"
                    ? isSpanish
                      ? "La transcripción terminó. Usa AI para copiar el prompt, pega la respuesta del LLM y después pulsa MAKE CLIPS."
                      : "The transcript is ready. Use AI to copy the prompt, paste the LLM response, then press MAKE CLIPS."
                    : projectPhase === "clips_ready"
                      ? isSpanish
                        ? "Los clips ya están listos para revisar."
                        : "The clips are ready to review."
                      : isSpanish
                        ? "Abre un clip para entrar a la pantalla de edición."
                        : "Open a clip to enter the editing screen."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {status === "ready" && (
                <>
                  <AiClipsPanel triggerLabel={isSpanish ? "AI" : "AI"} />
                  <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400">
                    {isSpanish ? "Pega la respuesta del LLM y pulsa MAKE CLIPS" : "Paste the LLM response and press MAKE CLIPS"}
                  </div>
                </>
              )}
              {(status === "preparing" || status === "transcribing") && (
                <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400">
                  <Loader2 size={14} className="animate-spin" />
                  <span>{isSpanish ? "Procesando" : "Processing"}</span>
                </div>
              )}
              {projectPhase === "clips_ready" && (
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {isSpanish ? "Clips listos" : "Clips ready"}
                </div>
              )}
            </div>
          </section>
        )}

        <section>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            <ProjectUploadCard
              ready={ready}
              dragging={dragging}
              source={source}
              pendingTranscript={pendingTranscript}
              onFiles={handleFiles}
              inputId={inputId}
              inputRef={inputRef}
              onDraggingChange={setDragging}
            />

            {projects.length === 0 ? (
              <div className="flex min-h-[18rem] items-center justify-center rounded-[1.75rem] border border-dashed border-zinc-200 bg-white/70 p-6 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
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
