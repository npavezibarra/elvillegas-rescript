"use client";

import { useCallback, useEffect, useRef } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { useEditorStore } from "@/lib/store";
import { getCutRanges, isWordCutOut } from "@/lib/edits";
import { extractAudio, getFFmpeg, releaseFFmpeg, resetFFmpeg } from "@/lib/ffmpeg";
import { VAD_SAMPLE_RATE } from "@/lib/vad";
import { isNetworkError } from "@/lib/network";
import { isElectron } from "@/lib/platform";
import { reportError } from "@/lib/sentry";
import { startSessionReporting } from "@/lib/telemetry";
import { useCrossOriginIsolated } from "@/hooks/useCrossOriginIsolated";
import { useDesktopMenu } from "@/hooks/useDesktopMenu";
import { useIsDesktopLayout } from "@/hooks/useIsDesktopLayout";
import { useTranscriber } from "@/hooks/useTranscriber";
import { detectMediaKind, MEDIA_ACCEPT } from "@/lib/media";
import TopBar from "./TopBar";
import DesktopAppBanner from "./DesktopAppBanner";
import ProjectsScreen from "./ProjectsScreen";
import ClipsScreen from "./ClipsScreen";
import TranscriptPanel from "./TranscriptPanel";
import MediaPreview from "./MediaPreview";
import Timeline from "./Timeline";
import ExportDialog from "./ExportDialog";
import { Download, Redo2, Undo2 } from "lucide-react";
import SettingsMenu from "./SettingsMenu";
import ModelSelector, {
  LanguageSection,
  ModelOption,
  ModelOptionSeparator,
} from "./ModelSelector";
import ImportTranscriptOption from "./ImportTranscriptOption";
import { MODEL_ORDER } from "@/lib/models";
import { isTypingTarget } from "@/lib/keyboard";
import { en } from "@/lib/i18n/messages/en";
import { useI18n } from "./I18nProvider";

const HORIZONTAL_WORKSPACE_LAYOUT_KEY =
  "react-resizable-panels:editor-workspace-horizontal:";
const HORIZONTAL_WORKSPACE_MIGRATED_KEY =
  "editor-workspace-horizontal-50-50";
const MEDIA_PIPELINE_STALL_MS = 2 * 60 * 1000;

function withStallWatch<T>(
  work: (beat: () => void) => Promise<T>,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rejectStall: ((err: Error) => void) | null = null;
  const clear = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };
  const beat = () => {
    clear();
    timer = setTimeout(() => {
      rejectStall?.(new Error(message));
    }, MEDIA_PIPELINE_STALL_MS);
  };
  const stalled = new Promise<never>((_resolve, reject) => {
    rejectStall = reject;
    beat();
  });
  return Promise.race([work(beat), stalled]).finally(clear);
}

function shouldMigrateHorizontalWorkspaceLayout() {
  if (typeof window === "undefined") return false;

  const raw = window.localStorage.getItem(HORIZONTAL_WORKSPACE_LAYOUT_KEY);
  if (!raw) return false;

  try {
    const layout = JSON.parse(raw) as Record<string, unknown>;
    const transcript = layout.transcript;
    const media = layout.media;
    if (typeof transcript !== "number" || typeof media !== "number") {
      return false;
    }

    // Migrate only the old 56/44-ish default so custom user layouts keep
    // their own proportions.
    return transcript > media && transcript >= 54 && transcript <= 58;
  } catch {
    return false;
  }
}

/** Transcript and preview split, resizable in both orientations. Wide screens
 *  put the transcript first (left of the preview); stacked screens lead with
 *  the preview on top. Each orientation remembers its own sizes. */
function SplitWorkspace({ orientation }: { orientation: "horizontal" | "vertical" }) {
  const horizontal = orientation === "horizontal";
  const layoutId =
    horizontal && shouldMigrateHorizontalWorkspaceLayout()
      ? HORIZONTAL_WORKSPACE_MIGRATED_KEY
      : `editor-workspace-${orientation}`;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: layoutId,
    storage: typeof window !== "undefined" ? localStorage : undefined,
  });

  const preview = (
    <Panel
      id="media"
      defaultSize={horizontal ? "50%" : "34vh"}
      minSize={horizontal ? 320 : 140}
      className="flex min-h-0 min-w-0 flex-col"
    >
      <MediaPreview />
    </Panel>
  );
  const transcript = (
    <Panel
      id="transcript"
      defaultSize={horizontal ? "50%" : "66%"}
      minSize={horizontal ? "20%" : 160}
      className="flex min-h-0 min-w-0 flex-col"
    >
      <TranscriptPanel />
    </Panel>
  );
  const separator = (
    <Separator
      className={`${horizontal ? "w-px" : "h-px"} bg-zinc-200 outline-none transition-colors hover:bg-zinc-300 data-[separator=active]:bg-zinc-300 data-[separator=focus]:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:data-[separator=active]:bg-zinc-700 dark:data-[separator=focus]:bg-zinc-700`}
    />
  );

  return (
    <Group
      orientation={orientation}
      className="min-h-0 flex-1"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      // The hairline divider is too small to hit with a finger; widen the
      // touch target well past its visual size.
      resizeTargetMinimumSize={{ coarse: 32, fine: 10 }}
    >
      {horizontal ? (
        <>
          {transcript}
          {separator}
          {preview}
        </>
      ) : (
        <>
          {preview}
          {separator}
          {transcript}
        </>
      )}
    </Group>
  );
}

function EditorWorkspace() {
  const isDesktop = useIsDesktopLayout();
  const mediaKind = useEditorStore((s) => s.mediaKind);
  // Audio has no visual preview — give the transcript the full workspace and
  // mount MediaPreview off-layout so the hidden <audio> element still drives
  // playback / spacebar / timeline controls.
  if (mediaKind === "audio") {
    return (
      <>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TranscriptPanel />
        </div>
        <MediaPreview />
      </>
    );
  }
  // Keyed so crossing the breakpoint remounts the group and restores that
  // orientation's saved layout instead of carrying sizes across.
  return isDesktop ? (
    <SplitWorkspace key="horizontal" orientation="horizontal" />
  ) : (
    <SplitWorkspace key="vertical" orientation="vertical" />
  );
}

export default function Editor() {
  const { t } = useI18n();
  const status = useEditorStore((s) => s.status);
  const workspaceScreen = useEditorStore((s) => s.workspaceScreen);
  const videoFile = useEditorStore((s) => s.videoFile);
  const skipTranscription = useEditorStore((s) => s.skipTranscription);
  const loadVideo = useEditorStore((s) => s.loadVideo);
  const { transcribe } = useTranscriber();

  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const setExportOpen = useEditorStore((s) => s.setExportOpen);
  const setSelectedClipIndex = useEditorStore((s) => s.setSelectedClipIndex);
  const setSelectedCutIndex = useEditorStore((s) => s.setSelectedCutIndex);
  const setSelectedWords = useEditorStore((s) => s.setSelectedWords);
  const setAiClipPreviewRange = useEditorStore((s) => s.setAiClipPreviewRange);
  const setActiveClipRange = useEditorStore((s) => s.setActiveClipRange);
  const setWorkspaceScreen = useEditorStore((s) => s.setWorkspaceScreen);
  const { locale } = useI18n();
  const isSpanish = locale === "es";

  // File › Open Project… reaches the same picker the upload screen uses, from
  // anywhere in the app.
  const menuInputRef = useRef<HTMLInputElement>(null);
  const isolation = useCrossOriginIsolated();
  const isolated = isolation === "ready";
  const openFilePicker = useCallback(() => menuInputRef.current?.click(), []);
  useDesktopMenu(openFilePicker, isolated);

  const startMenuFile = useCallback(
    (file: File) => {
      const { source, pendingTranscript } = useEditorStore.getState();
      if (source === "import") {
        if (!pendingTranscript) {
          alert(t("editor.chooseTranscript"));
          return;
        }
        loadVideo(file, {
          words: pendingTranscript.words,
          speakers: pendingTranscript.speakers,
        });
        return;
      }
      loadVideo(file);
    },
    [loadVideo, t]
  );

  // The pipeline needs SharedArrayBuffer, so a file picked before the page is
  // cross-origin isolated waits here instead of failing on load.
  const deferredFile = useRef<File | null>(null);
  const startMenuFileRef = useRef(startMenuFile);
  useEffect(() => {
    startMenuFileRef.current = startMenuFile;
  }, [startMenuFile]);
  useEffect(() => {
    if (!isolated || !deferredFile.current) return;
    const file = deferredFile.current;
    deferredFile.current = null;
    startMenuFileRef.current(file);
  }, [isolated]);

  const handleMenuFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!detectMediaKind(file)) {
        alert(t("editor.chooseMedia"));
        return;
      }
      if (!isolated) {
        deferredFile.current = file;
        return;
      }
      startMenuFile(file);
    },
    [isolated, startMenuFile, t]
  );

  // Daily-active signal: reports the launch, then again on each day rollover so
  // a long-running window doesn't look churned.
  useEffect(() => startSessionReporting(), []);

  // Processing pipeline: load ffmpeg -> extract audio -> (maybe) transcribe.
  // Restored projects already have words; they only need PCM for the waveform.
  useEffect(() => {
    if (!videoFile) return;
    const restoreOnly = useEditorStore.getState().skipTranscription;
    let cancelled = false;
    (async () => {
      const s = useEditorStore.getState();
      try {
        if (restoreOnly) {
          // Restored projects already have words, so we can show the editor
          // immediately and let waveform extraction finish in the background.
          s.setStatus("ready");
          s.setProgress({ message: "", value: null });
        } else {
          s.setProgress({ message: en["progress.loadingMediaEngine"], value: null });
        }
        await withStallWatch(
          async (beat) => {
            await getFFmpeg();
            beat();
          },
          "Media engine stopped responding while loading."
        );
        if (cancelled) return;
        s.setProgress({ message: en["progress.extractingAudio"], value: 0 });
        const audio = await withStallWatch(
          (beat) =>
            extractAudio(videoFile, (value) => {
              beat();
              s.setProgress({ message: en["progress.extractingAudio"], value });
            }),
          "Audio extraction stopped responding."
        );
        if (cancelled) return;
        s.setAudio(audio);
        // ffmpeg's gigabyte is pure overhead from here until the user exports,
        // and holding it through model instantiation is what makes WebKit kill
        // the tab. Export re-initialises it lazily from the HTTP cache.
        await releaseFFmpeg();
        if (!restoreOnly && !audio) {
          s.setStatus("ready");
          s.setProgress({ message: "", value: null });
          return;
        }
        if (!restoreOnly && audio) {
          transcribe(audio, audio.length / VAD_SAMPLE_RATE);
        }
      } catch (err) {
        if (cancelled) return;
        resetFFmpeg();
        console.error("Processing pipeline failed:", err);
        // Same reasoning as the worker's error path: a dropped connection while
        // pulling the media engine is the user's network, not a bug, and
        // "Failed to fetch" tells them nothing about what to do next.
        if (isNetworkError(err)) {
          s.setError(en["error.mediaEngineNetwork"]);
          return;
        }
        reportError(err, "media-pipeline");
        s.setError(
          err instanceof Error ? err.message : en["error.processFile"]
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoFile, skipTranscription, transcribe]);

  // The desktop shell opens as a small upload window and grows once the
  // three-pane editor takes over (and shrinks back on "start over"). Keep
  // the editor interactive while the native window resizes: an overlay here
  // can remain above the app if Electron misses an animation completion.
  useEffect(() => {
    const idle = status === "idle";
    window.rescriptDesktop?.setWindowMode(idle ? "compact" : "expanded");
  }, [status]);

  // Global shortcuts: space = play/pause, ⌘Z / ⇧⌘Z = undo / redo, S = split,
  // Delete/Backspace = delete selected clip or restore selected cut / cut words.
  // Capture phase so Space is ours before a focused <button> synthesizes a click
  // (which would double-toggle playback and look like the hotkey "didn't work").
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useEditorStore.getState();
      if (e.code === "Space" && s.videoEl && !s.exportOpen) {
        e.preventDefault();
        e.stopPropagation();
        s.togglePlayback();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (
        e.key.toLowerCase() === "s" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        s.status === "ready" &&
        !s.exportOpen
      ) {
        e.preventDefault();
        s.splitAtPlayhead();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        s.status === "ready" &&
        !s.exportOpen
      ) {
        // Cut region selected → restore it (also covers cut words clicked on
        // the timeline, which select their cut). Kept words → cut them. Clip
        // selected with no words → delete the clip.
        if (s.selectedCutIndex != null) {
          e.preventDefault();
          e.stopPropagation();
          s.restoreSelectedCut();
          return;
        }
        if (s.selectedWordIds.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          const cuts = getCutRanges(s.words, s.duration, s.manualCuts);
          const selected = s.words.filter((w) => s.selectedWordIds.includes(w.id));
          const allCutOut =
            selected.length > 0 && selected.every((w) => isWordCutOut(w, cuts));
          if (allCutOut) {
            s.restoreRanges([
              {
                start: selected[0]!.start,
                end: selected[selected.length - 1]!.end,
              },
            ]);
          }
          else s.deleteWords(s.selectedWordIds);
          s.setSelectedWords([]);
          return;
        }
        if (s.selectedClipIndex != null) {
          e.preventDefault();
          e.stopPropagation();
          s.deleteSelectedClip();
        }
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  // Flush pending autosave when the tab hides or unloads.
  useEffect(() => {
    const flush = () => {
      void import("@/lib/autosave").then((m) => m.flushProjectAutosave());
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <DesktopAppBanner />
      {workspaceScreen === "editor" ? (
        <>
          <TopBar>
            {videoFile && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceScreen("clips");
                    setSelectedClipIndex(null);
                    setSelectedCutIndex(null);
                    setSelectedWords([]);
                    setActiveClipRange(null);
                    setAiClipPreviewRange(null);
                  }}
                  className="hidden h-8 items-center rounded-full border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 sm:inline-flex dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  {isSpanish ? "Volver a clips" : "Back to clips"}
                </button>
                <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
              </>
            )}
            {videoFile && (
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceScreen("projects");
                    setSelectedClipIndex(null);
                    setSelectedCutIndex(null);
                    setSelectedWords([]);
                    setActiveClipRange(null);
                    setAiClipPreviewRange(null);
                  }}
                className="flex h-8 items-center rounded-full bg-zinc-900 px-3 text-[13px] font-medium text-white transition hover:bg-zinc-700 cursor-pointer dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {isSpanish ? "Volver a proyectos" : "Back to projects"}
              </button>
            )}
            <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
            <button
              onClick={undo}
              disabled={!canUndo}
              title={t("editor.undo")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title={t("editor.redo")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <Redo2 size={16} />
            </button>
            <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
            <button
              onClick={() => setExportOpen(true)}
              disabled={status !== "ready" && status !== "exporting"}
              className="flex ml-1 h-8 items-center gap-1.5 rounded-full bg-zinc-900 px-4 text-[13px] font-medium text-white transition hover:bg-zinc-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Download size={14} />
              {t("editor.export")}
            </button>
            <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
            <SettingsMenu />
          </TopBar>
          <EditorWorkspace />
          <Timeline />
        </>
      ) : workspaceScreen === "clips" ? (
        <ClipsScreen />
      ) : (
        <>
          {isElectron && <TopBar>
            <ModelSelector groupLabel={t("model.transcriptSource")}>
              {MODEL_ORDER.map((id) => (
                <ModelOption key={id} id={id} />
              ))}
              <ModelOptionSeparator />
              <LanguageSection />
              <ModelOptionSeparator />
              <ImportTranscriptOption />
            </ModelSelector>
            <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
            <SettingsMenu />
          </TopBar>}
          <ProjectsScreen onFile={loadVideo} />
        </>
      )}
      {isElectron && (
        // Present in the layout tree (not display:none) so the native menu's
        // click() reliably opens the picker.
        <input
          ref={menuInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            handleMenuFile(e.target.files?.[0]);
            // Allow re-picking the same file after a "start over".
            e.target.value = "";
          }}
        />
      )}
      <ExportDialog />
    </div>
  );
}
