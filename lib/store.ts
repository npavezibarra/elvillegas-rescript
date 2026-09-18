"use client";

import { create } from "zustand";
import type {
  EditSnapshot,
  EditorLayer,
  EditorStatus,
  LayerTransform,
  TextLayerStyle,
  ManualCut,
  ProgressInfo,
  SceneBoundary,
  SpeakerInfo,
  TimeRange,
  VideoLayer,
  Word,
} from "./types";
import {
  addManualCut,
  applyWordBounds,
  canSplitAt,
  carrySceneBoundaries,
  cutRangeAt,
  deleteWordsCoveredBy,
  getClipSegments,
  getCutRanges,
  getKeepRanges,
  getSelectedClipSegment,
  PLAYHEAD_EPSILON_S,
  restoreRangesResult,
  shrinkManualCuts,
  trimEdgeResult,
} from "./edits";
import { isModelId, loadModelPreference, saveModelPreference } from "./models";
import { isTranscriptSource, type TranscriptSource } from "./source";
import { trackEvent } from "./telemetry";
import {
  DEFAULT_TRANSCRIPT_LANGUAGE,
  isTranscriptLanguage,
  loadTranscriptLanguagePreference,
  saveTranscriptLanguagePreference,
  type TranscriptLanguage,
} from "./languages";
import type { ClipSuggestion } from "./aiClips";
import { en } from "@/lib/i18n/messages/en";
import { detectMediaKind, type MediaKind } from "./media";
import { buildWaveformPeaks, type WaveformPeaks } from "./waveform";
import {
  deleteProject,
  fileFromProject,
  getProject,
} from "./projects";
import type {
  VideoExportAspectRatio,
  VideoExportLayout,
} from "./ffmpeg";
import {
  deriveWorkflow,
  type ProjectPhase,
  type WorkspaceScreen,
} from "./workflow";
import {
  addSpeaker as addSpeakerEntry,
  findSpeakerByName,
  moveSpeakerBoundary,
  reassignWords,
  removeSpeaker as removeSpeakerEntry,
  renameSpeaker as renameSpeakerEntry,
  replaceSpeaker as replaceSpeakerEntry,
  speakersFromWords,
} from "./speakers";
import {
  CAPTION_LAYER_ID,
  clampLayerTransform,
  clampVideoCrop,
  clampVideoTransform,
  createCaptionLayer,
  DEFAULT_VIDEO_CROP,
  DEFAULT_VIDEO_TRANSFORM,
  layerTiming,
  moveLayer,
  withLayerTiming,
} from "./layers";
import {
  applyTranscriptSegmentCorrections,
  type TranscriptSegmentCorrection,
} from "./transcriptCorrection";

interface PendingTranscript {
  name: string;
  words: Word[];
  speakers?: SpeakerInfo[];
}

interface AiClipDurationRange {
  min: string;
  max: string;
}

export interface CaptionPosition {
  /** Center point as a percentage of the video frame. */
  x: number;
  y: number;
}

const DEFAULT_CAPTION_POSITION: CaptionPosition = { x: 50, y: 82 };
const DEFAULT_AI_CLIP_DURATION_RANGE: AiClipDurationRange = { min: "0", max: "" };

interface EditorState {
  // Media
  videoFile: File | null;
  mediaUrl: string | null;
  /** Whether the loaded file is video or audio-only. */
  mediaKind: MediaKind | null;
  duration: number;
  /**
   * Min/max envelope of the media's audio track, for the timeline waveform.
   *
   * The decoded PCM itself is deliberately not kept: it is hundreds of
   * megabytes on a long recording and the worker takes ownership of it (see
   * useTranscriber). Null when the file has no audio track.
   */
  waveform: WaveformPeaks | null;
  /** Whether the media has an audio track at all. */
  hasAudio: boolean;
  /** Transcript source selected on the upload screen (speech model or import). */
  source: TranscriptSource;
  /** Language hint sent to Whisper when transcribing (Parakeet auto-detects). */
  transcriptLanguage: TranscriptLanguage;
  /**
   * Caption file parsed on the upload screen when source is "import".
   * Cleared when switching back to a speech model or after media loads.
   */
  pendingTranscript: PendingTranscript | null;
  /** IndexedDB project id when this session is persisted; null for a fresh upload mid-pipeline. */
  projectId: string | null;
  /**
   * When true, Editor extracts audio for the waveform but skips ASR
   * (restored projects / imported transcripts already have words).
   */
  skipTranscription: boolean;

  // Pipeline status
  status: EditorStatus;
  progress: ProgressInfo;
  /** Streaming partial transcript text while transcribing. */
  partialText: string;
  error: string | null;

  // Transcript / edits
  words: Word[];
  /** Named speakers in the project (ids match Word.speaker). */
  speakers: SpeakerInfo[];
  manualCuts: ManualCut[];
  sceneBoundaries: SceneBoundary[];
  showDeleted: boolean;
  past: EditSnapshot[];
  future: EditSnapshot[];
  /** Selected timeline clip index, or null. */
  selectedClipIndex: number | null;
  /**
   * Selected cut-range index (from `getCutRanges`), or null.
   * Used to restore a deleted clip / silence section from the timeline.
   */
  selectedCutIndex: number | null;
  /**
   * Words selected in the transcript or the timeline wordbar. Shared so both
   * views highlight the same selection and the same shortcuts apply.
   */
  selectedWordIds: number[];
  nextManualCutId: number;
  nextBoundaryId: number;
  /**
   * When true, subsequent edit mutations coalesce into the undo entry
   * created by `beginGesture` (one undo step per drag).
   */
  gestureActive: boolean;

  // Playback (mirrored from the <video>/<audio> element for UI rendering)
  currentTime: number;
  playing: boolean;
  videoEl: HTMLMediaElement | null;

  // Export
  exportUrl: string | null;
  exportOpen: boolean;
  exportPreviewAspectRatio: VideoExportAspectRatio | null;
  exportPreviewLayout: VideoExportLayout;
  showCaptions: boolean;
  captionPosition: CaptionPosition;
  /** Placement of the primary video inside the preview and export frame. */
  videoTransform: LayerTransform;
  videoCrop: LayerTransform;
  videoCropAspectRatio: number | null;
  videoSelected: boolean;
  /** Bottom-to-top visual stack rendered over the video frame. */
  layers: EditorLayer[];
  selectedLayerId: string | null;
  /** Incremented when another surface wants the preview Media menu opened. */
  mediaMenuRequestId: number;
  aiClipSuggestions: ClipSuggestion[];
  aiClipDurationRange: AiClipDurationRange;
  aiClipPreviewRange: TimeRange | null;
  /** Immutable editing boundary while an AI clip is open in the editor. */
  activeClipRange: TimeRange | null;
  /** Coarse-grained product phase used to route between top-level windows. */
  projectPhase: ProjectPhase;
  /** Which top-level window the app should show for the current project. */
  workspaceScreen: WorkspaceScreen;

  // Actions
  /** Load media for editing. Pass `words` to skip Whisper and use that transcript. */
  loadVideo: (
    file: File,
    options?: { words?: Word[]; speakers?: SpeakerInfo[] }
  ) => void;
  /** Restore a saved project from IndexedDB (no re-transcription). */
  openProject: (id: string) => Promise<void>;
  /** Delete a saved project; if it is the active one, resets to the home screen. */
  removeProject: (id: string) => Promise<void>;
  setSource: (s: TranscriptSource) => void;
  setTranscriptLanguage: (language: TranscriptLanguage) => void;
  setPendingTranscript: (t: PendingTranscript | null) => void;
  setDuration: (d: number) => void;
  /**
   * Hand the decoded PCM to the store. Only the waveform envelope is retained;
   * the caller keeps ownership of the buffer itself (and transfers it to the
   * transcription worker).
   */
  setAudio: (a: Float32Array | null) => void;
  setStatus: (s: EditorStatus) => void;
  setProgress: (p: ProgressInfo) => void;
  setPartialText: (t: string) => void;
  setError: (message: string) => void;
  setWords: (words: Word[], speakers?: SpeakerInfo[]) => void;
  /**
   * Replace the current transcript with an imported one (keeps media).
   * Used when the user brings their own SRT/VTT/JSON instead of Whisper.
   */
  importWords: (words: Word[], speakers?: SpeakerInfo[]) => void;
  /** Rename a speaker everywhere it appears. */
  renameSpeaker: (id: number, name: string) => void;
  /** Create a new speaker; returns its id (or -1 if unchanged). */
  addSpeaker: (name?: string) => number;
  /** Reassign selected / listed words to a speaker (creating the speaker if needed). */
  reassignWordsToSpeaker: (ids: number[], toSpeaker: number) => void;
  /**
   * Change who speaks a turn. Pass `toSpeaker: "new"` to create a speaker.
   * Optional `name` renames/creates with that label.
   */
  changeTurnSpeaker: (
    wordIds: number[],
    toSpeaker: number | "new",
    name?: string
  ) => void;
  /** Move a turn's start to `targetWordId` (boundary with the previous turn). */
  moveSpeakerLabel: (turnStartWordId: number, targetWordId: number) => void;
  /** Merge all of `fromId` into `toId` across the project. */
  replaceSpeakerInProject: (fromId: number, toId: number) => void;
  /** Remove a speaker; their turns join the speaker above in the script. */
  removeSpeakerFromProject: (id: number) => void;
  deleteWords: (ids: number[]) => void;
  restoreWords: (ids: number[]) => void;
  /** Cut arbitrary time ranges (e.g. detected silences) as manual cuts. */
  cutRanges: (ranges: TimeRange[]) => void;
  /** Restore arbitrary cut ranges (manual cuts + covered deleted words). */
  restoreRanges: (ranges: TimeRange[]) => void;
  /** Cut the currently selected timeline clip out of the edited media. */
  deleteSelectedClip: () => boolean;
  /** Restore the currently selected cut range (deleted clip / silence). */
  restoreSelectedCut: () => boolean;
  /** Replace the selected (contiguous) words with corrected text. */
  correctWords: (ids: number[], text: string) => void;
  /** Apply reviewed AI corrections as one undoable transcript edit. */
  applyTranscriptCorrections: (
    corrections: TranscriptSegmentCorrection[]
  ) => void;
  /** Nudge a word's start/end on the timeline (may steal time from neighbors). */
  adjustWordBounds: (id: number, start: number, end: number) => void;
  /** Insert a scene boundary at the playhead. */
  splitAtPlayhead: () => boolean;
  /** Insert a scene boundary at an arbitrary time. */
  splitAtTime: (time: number) => boolean;
  /** Remove a scene boundary by id (join adjacent clips). */
  removeSceneBoundary: (id: number) => void;
  /** Convert a suggested time range into a selectable clip segment. */
  createClipFromRange: (range: TimeRange) => boolean;
  /**
   * Move one edge of a kept region from `from` to `to` (original-media times).
   * `edge` names the side that stays kept ("in" = the clip to the right of the
   * edge, "out" = the clip to the left), which is what decides whether the move
   * cuts or reclaims. Edges are addressed by time, not clip index, because a
   * trim can merge or split clips mid-drag and renumber them.
   */
  trimEdge: (edge: "in" | "out", from: number, to: number) => void;
  setSelectedClipIndex: (index: number | null) => void;
  setSelectedCutIndex: (index: number | null) => void;
  setSelectedWords: (ids: number[]) => void;
  /** Start a drag gesture so subsequent edits share one undo entry. */
  beginGesture: () => void;
  /** End the current drag gesture. */
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  toggleShowDeleted: () => void;
  setCurrentTime: (t: number) => void;
  seekTo: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setVideoEl: (el: HTMLMediaElement | null) => void;
  /** Play/pause, skipping out of cut ranges and restarting from the start if parked at the end. */
  togglePlayback: () => void;
  setExportUrl: (url: string | null) => void;
  setExportOpen: (open: boolean) => void;
  setExportPreviewAspectRatio: (ratio: VideoExportAspectRatio | null) => void;
  setExportPreviewLayout: (layout: VideoExportLayout) => void;
  setShowCaptions: (showCaptions: boolean) => void;
  setCaptionPosition: (position: CaptionPosition) => void;
  updateVideoTransform: (transform: Partial<LayerTransform>) => void;
  updateVideoCrop: (
    transform: Partial<LayerTransform>,
    cropAspectRatio?: number
  ) => void;
  updateImageCrop: (
    id: string,
    transform: Partial<LayerTransform>,
    cropAspectRatio?: number
  ) => void;
  updateVideoLayerCrop: (
    id: string,
    transform: Partial<LayerTransform>,
    cropAspectRatio?: number
  ) => void;
  setVideoSelected: (selected: boolean) => void;
  duplicateVideoLayer: (sourceLayerId?: string) => string;
  addTextLayer: (text?: string) => string;
  addImageLayer: (src: string, name?: string, aspectRatio?: number) => string;
  addEndCardLayer: (
    src: string,
    name?: string,
    aspectRatio?: number,
    startAt?: number
  ) => string;
  updateLayerTransform: (id: string, transform: Partial<LayerTransform>) => void;
  updateLayerTiming: (id: string, timing: Partial<{ start: number; end: number }>) => void;
  updateTextLayer: (
    id: string,
    update: { text?: string; style?: Partial<TextLayerStyle> }
  ) => void;
  removeLayer: (id: string) => void;
  moveLayerToIndex: (id: string, index: number) => void;
  setSelectedLayerId: (id: string | null) => void;
  requestMediaMenuOpen: () => void;
  setWorkspaceScreen: (screen: WorkspaceScreen) => void;
  setAiClipSuggestions: (suggestions: ClipSuggestion[]) => void;
  clearAiClipSuggestions: () => void;
  setAiClipDurationRange: (range: AiClipDurationRange) => void;
  setAiClipPreviewRange: (range: TimeRange | null) => void;
  setActiveClipRange: (range: TimeRange | null) => void;
  previewAiClip: (range: TimeRange) => void;
  reset: () => void;
}

function bumpAutosave() {
  // Dynamic import avoids a circular dependency with lib/autosave.ts.
  void import("./autosave").then((m) => m.scheduleProjectAutosave());
}

function flushAutosave() {
  // Keep the save path lazy for the same circular-dependency reason.
  void import("./autosave").then((m) => m.flushProjectAutosave());
}

/**
 * How many undo steps to keep.
 *
 * Snapshots share structure with the live state, but every edit replaces the
 * words array wholesale, so each entry pins a distinct copy — on an hour-long
 * transcript that is a few megabytes per step. Unbounded, a long editing
 * session grows without limit and never gives any of it back. A hundred steps
 * is far more than anyone walks back through interactively.
 */
const MAX_UNDO_STEPS = 100;

/** Append to the undo stack, dropping the oldest entries past the cap. */
function pushHistory(past: EditSnapshot[], entry: EditSnapshot): EditSnapshot[] {
  const next = [...past, entry];
  return next.length > MAX_UNDO_STEPS ? next.slice(next.length - MAX_UNDO_STEPS) : next;
}

function snapshotOf(s: {
  words: Word[];
  speakers: SpeakerInfo[];
  manualCuts: ManualCut[];
  sceneBoundaries: SceneBoundary[];
}): EditSnapshot {
  return {
    words: s.words,
    speakers: s.speakers,
    manualCuts: s.manualCuts,
    sceneBoundaries: s.sceneBoundaries,
  };
}

function snapshotsEqual(a: EditSnapshot, b: EditSnapshot): boolean {
  return (
    a.words === b.words &&
    a.speakers === b.speakers &&
    a.manualCuts === b.manualCuts &&
    a.sceneBoundaries === b.sceneBoundaries
  );
}

function maxId(items: Array<{ id: number }>, fallback = 1): number {
  return items.reduce((m, x) => Math.max(m, x.id), fallback - 1) + 1;
}

function postRollEndAfter(
  layers: EditorLayer[],
  duration: number,
  startAt: number
): number {
  return layers.reduce((end, layer) => {
    if (layer.type !== "image" || !layer.postRoll) return end;
    const timing = layerTiming(layer, duration);
    if (timing.start < startAt - 0.001) return end;
    return Math.max(end, timing.end);
  }, startAt);
}

function clipTranscriptEnd(words: Word[], clip: TimeRange): number {
  return words.reduce((end, word) => {
    if (word.deleted) return end;
    if (word.end <= clip.start || word.start >= clip.end + 0.001) return end;
    return Math.max(end, word.end);
  }, clip.end);
}

function pushEdit(
  get: () => EditorState,
  set: (
    partial:
      | Partial<EditorState>
      | ((s: EditorState) => Partial<EditorState>)
  ) => void,
  next: Partial<
    Pick<
      EditorState,
      | "words"
      | "speakers"
      | "manualCuts"
      | "sceneBoundaries"
      | "selectedClipIndex"
      | "selectedCutIndex"
      | "selectedWordIds"
      | "nextManualCutId"
      | "nextBoundaryId"
      | "workspaceScreen"
    >
  >
) {
  const s = get();
  if (s.gestureActive) {
    // Coalesce into the snapshot already pushed by beginGesture.
    set(withWorkflow(s, { future: [], ...next }));
  } else {
    set(
      withWorkflow(s, {
      past: pushHistory(s.past, snapshotOf(s)),
      future: [],
      ...next,
      })
    );
  }
  bumpAutosave();
}

function withWorkflow(
  base: EditorState,
  next: Partial<EditorState>
): Partial<EditorState> {
  const snapshot = { ...base, ...next };
  const { projectPhase, workspaceScreen } = deriveWorkflow({
    status: snapshot.status,
    aiClipSuggestions: snapshot.aiClipSuggestions,
    selectedClipIndex: snapshot.selectedClipIndex,
    hasVideo: snapshot.videoFile !== null,
    hasTranscript: snapshot.words.length > 0,
  });
  return {
    ...next,
    projectPhase,
    workspaceScreen: next.workspaceScreen ?? base.workspaceScreen ?? workspaceScreen,
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  videoFile: null,
  mediaUrl: null,
  mediaKind: null,
  duration: 0,
  waveform: null,
  hasAudio: false,
  source: "base",
  transcriptLanguage: DEFAULT_TRANSCRIPT_LANGUAGE,
  pendingTranscript: null,
  projectId: null,
  skipTranscription: false,

  status: "idle",
  progress: { message: "", value: null },
  partialText: "",
  error: null,

  words: [],
  speakers: [],
  manualCuts: [],
  sceneBoundaries: [],
  showDeleted: true,
  past: [],
  future: [],
  selectedClipIndex: null,
  selectedCutIndex: null,
  selectedWordIds: [],
  nextManualCutId: 1,
  nextBoundaryId: 1,
  gestureActive: false,

  currentTime: 0,
  playing: false,
  videoEl: null,

  exportUrl: null,
  exportOpen: false,
  exportPreviewAspectRatio: "landscape",
  exportPreviewLayout: "fill",
  showCaptions: true,
  captionPosition: DEFAULT_CAPTION_POSITION,
  videoTransform: DEFAULT_VIDEO_TRANSFORM,
  videoCrop: DEFAULT_VIDEO_CROP,
  videoCropAspectRatio: null,
  videoSelected: false,
  layers: [createCaptionLayer(DEFAULT_CAPTION_POSITION)],
  selectedLayerId: null,
  mediaMenuRequestId: 0,
  aiClipSuggestions: [],
  aiClipDurationRange: DEFAULT_AI_CLIP_DURATION_RANGE,
  aiClipPreviewRange: null,
  activeClipRange: null,
  projectPhase: "idle",
  workspaceScreen: "projects",

  loadVideo: (file, options) => {
    const kind = detectMediaKind(file);
    if (!kind) return;
    const imported = options?.words;
    if (imported && imported.length === 0) return;
    const sessionFile = new File([file], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
    const prev = get().mediaUrl;
    if (prev) URL.revokeObjectURL(prev);
    const current = get().source;
    const speakers = imported
      ? speakersFromWords(imported, options?.speakers ?? [])
      : [];
    set(
      withWorkflow(get(), {
      videoFile: sessionFile,
      mediaUrl: URL.createObjectURL(sessionFile),
      mediaKind: kind,
      projectId: null,
      skipTranscription: Boolean(imported),
      source: imported ? "import" : isModelId(current) ? current : "base",
      pendingTranscript: null,
      status: "preparing",
      progress: {
        message: imported
          ? en["progress.loadingMedia"]
          : en["progress.loadingMediaEngine"],
        value: null,
      },
      words: imported ? imported : [],
      speakers,
      manualCuts: [],
      sceneBoundaries: [],
      past: [],
      future: [],
      selectedClipIndex: null,
      selectedCutIndex: null,
      selectedWordIds: [],
      nextManualCutId: 1,
      nextBoundaryId: 1,
      gestureActive: false,
      partialText: "",
      error: null,
      currentTime: 0,
      exportUrl: null,
      waveform: null,
      hasAudio: false,
      duration: 0,
      exportPreviewAspectRatio: "landscape",
      exportPreviewLayout: "fill",
      showCaptions: true,
      captionPosition: DEFAULT_CAPTION_POSITION,
      videoTransform: DEFAULT_VIDEO_TRANSFORM,
      videoCrop: DEFAULT_VIDEO_CROP,
      videoCropAspectRatio: null,
      videoSelected: false,
      layers: [createCaptionLayer(DEFAULT_CAPTION_POSITION)],
      selectedLayerId: null,
      mediaMenuRequestId: 0,
      aiClipSuggestions: [],
      aiClipDurationRange: DEFAULT_AI_CLIP_DURATION_RANGE,
      aiClipPreviewRange: null,
      activeClipRange: null,
      workspaceScreen: "projects",
      })
    );
    // Funnel step between opening the app and getting a transcript. `kind` and
    // `source` are fixed vocabulary — nothing derived from the file itself.
    trackEvent("project_created", {
      kind,
      source: imported ? "import" : "asr",
    });
  },

  openProject: async (id) => {
    const record = await getProject(id);
    if (!record) throw new Error(en["error.projectMissing"]);
    const file = fileFromProject(record);
    const prev = get().mediaUrl;
    if (prev) URL.revokeObjectURL(prev);
    const manualCuts = record.manualCuts ?? [];
    const sceneBoundaries = record.sceneBoundaries ?? [];
    const speakers = speakersFromWords(record.words, record.speakers ?? []);
    const layers = (
      record.layers && record.layers.length > 0
        ? record.layers
        : [createCaptionLayer(record.captionPosition, record.duration)]
    ).map((layer) => withLayerTiming(layer, record.duration));
    const storedCaptionLayer = layers.find(
      (layer) => layer.id === CAPTION_LAYER_ID
    );
    const captionPosition = storedCaptionLayer
      ? { x: storedCaptionLayer.transform.x, y: storedCaptionLayer.transform.y }
      : record.captionPosition ?? DEFAULT_CAPTION_POSITION;
    set(
      withWorkflow(get(), {
      videoFile: file,
      mediaUrl: URL.createObjectURL(file),
      mediaKind: record.mediaKind,
      duration: record.duration,
      source: isTranscriptSource(record.source) ? record.source : "base",
      transcriptLanguage: isTranscriptLanguage(record.transcriptLanguage)
        ? record.transcriptLanguage
        : DEFAULT_TRANSCRIPT_LANGUAGE,
      projectId: record.id,
      skipTranscription: true,
      pendingTranscript: null,
      status: "preparing",
      progress: { message: en["progress.loadingMediaEngine"], value: null },
      words: record.words,
      speakers,
      manualCuts,
      sceneBoundaries,
      showDeleted: record.showDeleted,
      past: [],
      future: [],
      selectedClipIndex: null,
      selectedCutIndex: null,
      selectedWordIds: [],
      nextManualCutId: maxId(manualCuts, 1),
      nextBoundaryId: maxId(sceneBoundaries, 1),
      partialText: "",
      error: null,
      currentTime: 0,
      playing: false,
      exportUrl: null,
      exportOpen: false,
      exportPreviewAspectRatio: "landscape",
      exportPreviewLayout: "fill",
      showCaptions: true,
      captionPosition,
      videoTransform: record.videoTransform
        ? clampVideoTransform(record.videoTransform, DEFAULT_VIDEO_TRANSFORM)
        : DEFAULT_VIDEO_TRANSFORM,
      videoCrop: record.videoCrop
        ? clampVideoCrop(record.videoCrop, DEFAULT_VIDEO_CROP)
        : DEFAULT_VIDEO_CROP,
      videoCropAspectRatio: record.videoCropAspectRatio ?? null,
      videoSelected: false,
      layers,
      selectedLayerId: null,
      aiClipSuggestions: record.aiClipSuggestions ?? [],
      aiClipDurationRange:
        record.aiClipDurationRange ?? DEFAULT_AI_CLIP_DURATION_RANGE,
      aiClipPreviewRange: null,
      activeClipRange: null,
      waveform: null,
      hasAudio: false,
      workspaceScreen: "clips",
      })
    );
  },

  removeProject: async (id) => {
    await deleteProject(id);
    if (get().projectId === id) {
      get().reset();
    }
  },

  setSource: (source) => {
    if (isModelId(source)) {
      saveModelPreference(source);
      set({ source, pendingTranscript: null });
    } else {
      set({ source });
    }
  },
  setTranscriptLanguage: (transcriptLanguage) => {
    saveTranscriptLanguagePreference(transcriptLanguage);
    set({ transcriptLanguage });
  },
  setPendingTranscript: (pendingTranscript) => set({ pendingTranscript }),
  setDuration: (duration) => {
    set((s) => ({
      duration,
      layers: s.layers.map((layer) =>
        layer.end === undefined || (s.duration === 0 && layer.end === 0)
          ? { ...layer, start: layer.start ?? 0, end: duration }
          : layer
      ),
    }));
    if (get().status === "ready") bumpAutosave();
  },
  setAudio: (audio) =>
    set({
      waveform: audio && audio.length > 0 ? buildWaveformPeaks(audio) : null,
      hasAudio: audio !== null,
    }),
  setStatus: (status) => {
    set((s) => withWorkflow(s, { status }));
    if (status === "ready") bumpAutosave();
  },
  setProgress: (progress) => set({ progress }),
  setPartialText: (partialText) => set({ partialText }),
  setError: (message) =>
    set((s) => withWorkflow(s, { status: "error", error: message })),
  setWords: (words, speakers) => {
    set(
      withWorkflow(get(), {
      words,
      speakers: speakersFromWords(words, speakers ?? []),
      manualCuts: [],
      sceneBoundaries: [],
      past: [],
      future: [],
      selectedClipIndex: null,
      selectedCutIndex: null,
      selectedWordIds: [],
      aiClipSuggestions: [],
      aiClipDurationRange: DEFAULT_AI_CLIP_DURATION_RANGE,
      aiClipPreviewRange: null,
      activeClipRange: null,
      })
    );
    if (get().status === "ready") bumpAutosave();
  },
  importWords: (words, speakers) => {
    if (words.length === 0) return;
    const { status } = get();
    if (
      status !== "ready" &&
      status !== "error" &&
      status !== "transcribing"
    ) {
      return;
    }
    // Stop Whisper if it was still running.
    void import("@/hooks/useTranscriber").then((m) => m.cancelTranscription());
    set(
      withWorkflow(get(), {
      words,
      speakers: speakersFromWords(words, speakers ?? []),
      manualCuts: [],
      sceneBoundaries: [],
      past: [],
      future: [],
      selectedClipIndex: null,
      selectedCutIndex: null,
      selectedWordIds: [],
      partialText: "",
      error: null,
      status: "ready",
      progress: { message: "", value: null },
      skipTranscription: true,
      source: "import",
      aiClipSuggestions: [],
      aiClipDurationRange: DEFAULT_AI_CLIP_DURATION_RANGE,
      aiClipPreviewRange: null,
      activeClipRange: null,
      })
    );
    bumpAutosave();
  },

  renameSpeaker: (id, name) => {
    const { speakers } = get();
    const next = renameSpeakerEntry(speakers, id, name);
    if (next === speakers) return;
    pushEdit(get, set, { speakers: next });
  },

  addSpeaker: (name) => {
    const { speakers } = get();
    const trimmed = name?.trim();
    if (trimmed) {
      const existing = findSpeakerByName(speakers, trimmed);
      if (existing) return existing.id;
    }
    const { speakers: next, id } = addSpeakerEntry(speakers, name);
    pushEdit(get, set, { speakers: next });
    return id;
  },

  reassignWordsToSpeaker: (ids, toSpeaker) => {
    if (ids.length === 0) return;
    const s = get();
    const words = reassignWords(s.words, ids, toSpeaker);
    if (words === s.words) return;
    const speakers = speakersFromWords(words, s.speakers);
    pushEdit(get, set, { words, speakers });
  },

  changeTurnSpeaker: (wordIds, toSpeaker, name) => {
    if (wordIds.length === 0) return;
    const s = get();
    let speakers = s.speakers;
    let targetId: number;
    if (toSpeaker === "new") {
      const added = addSpeakerEntry(speakers, name);
      speakers = added.speakers;
      targetId = added.id;
    } else {
      targetId = toSpeaker;
      if (name && name.trim()) {
        speakers = renameSpeakerEntry(speakers, targetId, name);
      } else if (!speakers.some((sp) => sp.id === targetId)) {
        speakers = speakersFromWords(
          s.words,
          [...speakers, { id: targetId, name: `Speaker ${targetId + 1}` }]
        );
      }
    }
    const words = reassignWords(s.words, wordIds, targetId);
    if (words === s.words && speakers === s.speakers) return;
    pushEdit(get, set, {
      words,
      speakers: speakersFromWords(words, speakers),
    });
  },

  moveSpeakerLabel: (turnStartWordId, targetWordId) => {
    const { words } = get();
    const next = moveSpeakerBoundary(words, turnStartWordId, targetWordId);
    if (!next) return;
    pushEdit(get, set, { words: next });
  },

  replaceSpeakerInProject: (fromId, toId) => {
    const s = get();
    const result = replaceSpeakerEntry(s.words, s.speakers, fromId, toId);
    if (!result) return;
    pushEdit(get, set, {
      words: result.words,
      speakers: result.speakers,
    });
  },

  removeSpeakerFromProject: (id) => {
    const s = get();
    const result = removeSpeakerEntry(s.words, s.speakers, id);
    if (!result) return;
    pushEdit(get, set, {
      words: result.words,
      speakers: result.speakers,
    });
  },

  deleteWords: (ids) => {
    if (ids.length === 0) return;
    const { words } = get();
    const idSet = new Set(ids);
    pushEdit(get, set, {
      words: words.map((w) =>
        idSet.has(w.id) && !w.deleted ? { ...w, deleted: true } : w
      ),
      selectedCutIndex: null,
    });
  },
  cutRanges: (ranges) => {
    const usable = ranges.filter((r) => r.end - r.start > 1e-4);
    if (usable.length === 0) return;
    const s = get();
    const cutsBefore = getCutRanges(s.words, s.duration, s.manualCuts);
    const selectedClipBefore =
      s.selectedClipIndex == null
        ? null
        : getSelectedClipSegment(
            cutsBefore,
            s.duration,
            s.sceneBoundaries,
            s.selectedClipIndex
          );
    let words = s.words;
    let manualCuts = s.manualCuts;
    let nextManualCutId = s.nextManualCutId;
    for (const r of usable) {
      const added = addManualCut(manualCuts, r.start, r.end, nextManualCutId);
      manualCuts = added.cuts;
      nextManualCutId = added.nextId;
      words = deleteWordsCoveredBy(words, r.start, r.end);
    }
    const cutsAfter = getCutRanges(words, s.duration, manualCuts);
    const clipsAfter = getClipSegments(
      getKeepRanges(cutsAfter, s.duration),
      s.sceneBoundaries
    );
    const selectedClipIndex =
      selectedClipBefore == null
        ? null
        : clipsAfter.find((clip) =>
            s.currentTime >= clip.start - 1e-3 &&
            s.currentTime < clip.end - 1e-3
          )?.index ??
          clipsAfter.find(
            (clip) =>
              selectedClipBefore.start < clip.end - 1e-3 &&
              selectedClipBefore.end > clip.start + 1e-3
          )?.index ??
          clipsAfter.find(
            (clip) =>
              clip.start <= selectedClipBefore.start + 1e-3 &&
              clip.end >= selectedClipBefore.end - 1e-3
          )?.index ??
          selectedClipBefore.index;
    pushEdit(get, set, {
      words,
      manualCuts,
      nextManualCutId,
      selectedClipIndex,
      selectedCutIndex: null,
      selectedWordIds: [],
    });
  },
  restoreRanges: (ranges) => {
    const s = get();
    const cutsBefore = getCutRanges(s.words, s.duration, s.manualCuts);
    const selectedClipBefore =
      s.selectedClipIndex == null
        ? null
        : getSelectedClipSegment(
            cutsBefore,
            s.duration,
            s.sceneBoundaries,
            s.selectedClipIndex
          );
    const result = restoreRangesResult(
      s.words,
      s.manualCuts,
      ranges,
      s.nextManualCutId
    );
    if (!result) return;
    const cutsAfter = getCutRanges(result.words, s.duration, result.manualCuts);
    const clipsAfter = getClipSegments(
      getKeepRanges(cutsAfter, s.duration),
      s.sceneBoundaries
    );
    const selectedClipIndex =
      selectedClipBefore == null
        ? null
        : clipsAfter.find((clip) =>
            s.currentTime >= clip.start - 1e-3 &&
            s.currentTime < clip.end - 1e-3
          )?.index ??
          clipsAfter.find(
            (clip) =>
              selectedClipBefore.start < clip.end - 1e-3 &&
              selectedClipBefore.end > clip.start + 1e-3
          )?.index ??
          clipsAfter.find(
            (clip) =>
              clip.start <= selectedClipBefore.start + 1e-3 &&
              clip.end >= selectedClipBefore.end - 1e-3
          )?.index ??
          selectedClipBefore.index;
    pushEdit(get, set, {
      words: result.words,
      manualCuts: result.manualCuts,
      nextManualCutId: result.nextCutId,
      selectedClipIndex,
      selectedCutIndex: null,
      selectedWordIds: [],
    });
  },
  deleteSelectedClip: () => {
    const s = get();
    if (s.selectedClipIndex == null || s.duration <= 0) return false;
    const cuts = getCutRanges(s.words, s.duration, s.manualCuts);
    const clips = getClipSegments(
      getKeepRanges(cuts, s.duration),
      s.sceneBoundaries
    );
    const clip = clips.find((c) => c.index === s.selectedClipIndex);
    if (!clip || clip.end - clip.start <= 1e-4) return false;
    get().cutRanges([{ start: clip.start, end: clip.end }]);
    return true;
  },
  restoreSelectedCut: () => {
    const s = get();
    if (s.selectedCutIndex == null || s.duration <= 0) return false;
    const cuts = getCutRanges(s.words, s.duration, s.manualCuts);
    const cut = cuts[s.selectedCutIndex];
    if (!cut || cut.end - cut.start <= 1e-4) return false;
    get().restoreRanges([{ start: cut.start, end: cut.end }]);
    return true;
  },
  restoreWords: (ids) => {
    if (ids.length === 0) return;
    const s = get();
    const idSet = new Set(ids);
    const restored = s.words.filter((w) => idSet.has(w.id));
    if (restored.length === 0) return;

    // Pull manual cuts off the restored words so transcript restore also
    // brings the audio back (trim-created cuts would otherwise remain).
    let manualCuts = s.manualCuts;
    let nextManualCutId = s.nextManualCutId;
    for (const w of restored) {
      const shrunk = shrinkManualCuts(
        manualCuts,
        w.start,
        w.end,
        nextManualCutId
      );
      manualCuts = shrunk.cuts;
      nextManualCutId = shrunk.nextId;
    }

    const words = s.words.map((w) =>
      idSet.has(w.id) ? { ...w, deleted: false } : w
    );

    pushEdit(get, set, {
      words,
      manualCuts,
      nextManualCutId,
      selectedCutIndex: null,
    });
  },
  correctWords: (ids, text) => {
    const { words } = get();
    const tokens = text.split(/\s+/).filter(Boolean);
    if (ids.length === 0 || tokens.length === 0) return;
    const idSet = new Set(ids);
    const indices = words.reduce<number[]>((acc, w, i) => {
      if (idSet.has(w.id)) acc.push(i);
      return acc;
    }, []);
    if (indices.length === 0) return;
    // Replace the whole contiguous slice covered by the selection.
    const from = indices[0];
    const to = indices[indices.length - 1];
    const selected = words.slice(from, to + 1);
    if (selected.map((w) => w.text).join(" ") === tokens.join(" ")) return;

    // Distribute the original time span across the new words in proportion
    // to their character length.
    const spanStart = selected[0].start;
    const spanEnd = selected[selected.length - 1].end;
    const span = Math.max(0.02, spanEnd - spanStart);
    const totalChars = tokens.reduce((acc, t) => acc + t.length, 0);
    let nextId = words.reduce((m, w) => Math.max(m, w.id), 0) + 1;
    let cursor = spanStart;
    const replacement: Word[] = tokens.map((t) => {
      const dur = (span * t.length) / totalChars;
      const word: Word = {
        id: nextId++,
        text: t,
        start: cursor,
        end: Math.min(spanEnd, cursor + dur),
        speaker: selected[0].speaker,
        // A correction implies the words are wanted, unless the whole
        // selection was already cut.
        deleted: selected.every((w) => w.deleted),
      };
      cursor = word.end;
      return word;
    });
    replacement[replacement.length - 1].end = spanEnd;

    pushEdit(get, set, {
      words: [...words.slice(0, from), ...replacement, ...words.slice(to + 1)],
      // The corrected span is new words with new ids; nothing to stay selected.
      selectedWordIds: [],
    });
  },

  applyTranscriptCorrections: (corrections) => {
    const next = applyTranscriptSegmentCorrections(get().words, corrections);
    if (!next) return;
    pushEdit(get, set, { words: next, selectedWordIds: [] });
  },

  adjustWordBounds: (id, start, end) => {
    const { words, duration } = get();
    const next = applyWordBounds(words, id, start, end, duration);
    if (!next) return;
    pushEdit(get, set, { words: next });
  },

  splitAtPlayhead: () => {
    const s = get();
    const t = s.currentTime;
    return get().splitAtTime(t);
  },

  splitAtTime: (time) => {
    const s = get();
    const cuts = getCutRanges(s.words, s.duration, s.manualCuts);
    if (!canSplitAt(time, s.duration, cuts, s.sceneBoundaries)) return false;
    const id = s.nextBoundaryId;
    pushEdit(get, set, {
      sceneBoundaries: [...s.sceneBoundaries, { id, time }].sort(
        (a, b) => a.time - b.time
      ),
      nextBoundaryId: id + 1,
    });
    return true;
  },

  removeSceneBoundary: (id) => {
    const { sceneBoundaries } = get();
    if (!sceneBoundaries.some((b) => b.id === id)) return;
    pushEdit(get, set, {
      sceneBoundaries: sceneBoundaries.filter((b) => b.id !== id),
      selectedClipIndex: null,
      selectedCutIndex: null,
    });
  },

  createClipFromRange: (range) => {
    const s = get();
    if (s.duration <= 0) return false;
    const start = Math.max(0, Math.min(range.start, s.duration));
    const end = Math.max(0, Math.min(range.end, s.duration));
    if (end - start <= 1e-4) return false;

    const cuts = getCutRanges(s.words, s.duration, s.manualCuts);
    const existingClips = getClipSegments(
      getKeepRanges(cuts, s.duration),
      s.sceneBoundaries
    );
    const existingClip =
      existingClips.find(
        (c) =>
          Math.abs(c.start - start) < 1e-3 && Math.abs(c.end - end) < 1e-3
      ) ??
      existingClips.find((c) => c.start <= start + 1e-3 && c.end >= end - 1e-3) ??
      null;
    if (existingClip) {
      pushEdit(get, set, {
        selectedClipIndex: existingClip.index,
        selectedCutIndex: null,
        selectedWordIds: [],
        workspaceScreen: "editor",
      });
      set({
        activeClipRange: { start: existingClip.start, end: existingClip.end },
      });
      return true;
    }

    const nextBoundaries = [...s.sceneBoundaries];
    let nextBoundaryId = s.nextBoundaryId;
    const addBoundary = (time: number): boolean => {
      if (time <= 1e-3 || time >= s.duration - 1e-3) return true;
      if (!canSplitAt(time, s.duration, cuts, nextBoundaries)) return false;
      nextBoundaries.push({ id: nextBoundaryId++, time });
      return true;
    };

    if (!addBoundary(start)) return false;
    if (!addBoundary(end)) return false;

    nextBoundaries.sort((a, b) => a.time - b.time);
    const clips = getClipSegments(
      getKeepRanges(cuts, s.duration),
      nextBoundaries
    );
    const selectedClip =
      clips.find(
        (c) =>
          c.start <= start + 1e-3 &&
          c.end >= end - 1e-3 &&
          Math.abs(c.start - start) < 1e-3 &&
          Math.abs(c.end - end) < 1e-3
      ) ??
      clips.find((c) => c.start <= start + 1e-3 && c.end >= end - 1e-3) ??
      null;

    pushEdit(get, set, {
      sceneBoundaries: nextBoundaries,
      nextBoundaryId,
      selectedClipIndex: selectedClip?.index ?? null,
      selectedCutIndex: null,
      selectedWordIds: [],
      workspaceScreen: "editor",
    });
    if (selectedClip) {
      set({
        activeClipRange: { start: selectedClip.start, end: selectedClip.end },
      });
    }
    return true;
  },

  trimEdge: (edge, from, to) => {
    const s = get();
    const result = trimEdgeResult(
      s.words,
      s.manualCuts,
      edge,
      from,
      to,
      s.nextManualCutId
    );
    if (!result) return;

    // A split point sitting on the dragged edge *is* that edge — it has to move
    // with it, or the span the drag reclaims becomes an orphan clip.
    const sceneBoundaries = carrySceneBoundaries(s.sceneBoundaries, from, to);

    // Clip indices shift whenever a trim merges or splits keep ranges, so
    // re-find the clip that owns the moved edge instead of keeping an index.
    const clips = getClipSegments(
      getKeepRanges(
        getCutRanges(result.words, s.duration, result.manualCuts),
        s.duration
      ),
      sceneBoundaries
    );
    const owner =
      clips.find((c) => Math.abs((edge === "in" ? c.start : c.end) - to) < 1e-3) ??
      clips.find((c) => to >= c.start && to <= c.end);

    pushEdit(get, set, {
      words: result.words,
      manualCuts: result.manualCuts,
      sceneBoundaries,
      nextManualCutId: result.nextCutId,
      selectedClipIndex: owner?.index ?? s.selectedClipIndex,
      selectedCutIndex: null,
    });
  },

  setSelectedClipIndex: (selectedClipIndex) =>
    set((s) => {
      const next = withWorkflow(s, {
        selectedClipIndex,
        workspaceScreen: selectedClipIndex != null ? "editor" : s.workspaceScreen,
        ...(selectedClipIndex != null ? { selectedCutIndex: null } : {}),
      });
      if (selectedClipIndex == null) return next;
      if (s.activeClipRange) return next;

      const cuts = getCutRanges(s.words, s.duration, s.manualCuts);
      const clip = getSelectedClipSegment(
        cuts,
        s.duration,
        s.sceneBoundaries,
        selectedClipIndex
      );
      return clip
        ? { ...next, activeClipRange: { start: clip.start, end: clip.end } }
        : next;
    }),

  setSelectedCutIndex: (selectedCutIndex) =>
    set((s) =>
      withWorkflow(s, {
        selectedCutIndex,
        workspaceScreen: selectedCutIndex != null ? "editor" : s.workspaceScreen,
        ...(selectedCutIndex != null ? { selectedClipIndex: null } : {}),
      })
    ),

  setSelectedWords: (selectedWordIds) =>
    set({
      selectedWordIds,
      // A fresh word selection from the transcript supersedes a prior cut pick.
      // Timeline cut-word clicks re-select the cut afterward.
      ...(selectedWordIds.length > 0 ? { selectedCutIndex: null } : {}),
    }),

  beginGesture: () => {
    const s = get();
    if (s.gestureActive) return;
    set({
      gestureActive: true,
      past: pushHistory(s.past, snapshotOf(s)),
      future: [],
    });
  },
  endGesture: () => {
    const s = get();
    if (!s.gestureActive) return;
    const last = s.past[s.past.length - 1];
    if (last && snapshotsEqual(last, snapshotOf(s))) {
      // No net change — drop the empty undo entry.
      set({ gestureActive: false, past: s.past.slice(0, -1) });
    } else {
      set({ gestureActive: false });
      bumpAutosave();
    }
  },

  undo: () => {
    const { past, future, words, speakers, manualCuts, sceneBoundaries } =
      get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set(
      withWorkflow(get(), {
      words: prev.words,
      speakers: prev.speakers,
      manualCuts: prev.manualCuts,
      sceneBoundaries: prev.sceneBoundaries,
      past: past.slice(0, -1),
      future: [
        { words, speakers, manualCuts, sceneBoundaries },
        ...future,
      ],
      selectedClipIndex: null,
      selectedCutIndex: null,
      selectedWordIds: [],
      gestureActive: false,
      })
    );
    bumpAutosave();
  },
  redo: () => {
    const { past, future, words, speakers, manualCuts, sceneBoundaries } =
      get();
    if (future.length === 0) return;
    const next = future[0];
    set(
      withWorkflow(get(), {
      words: next.words,
      speakers: next.speakers,
      manualCuts: next.manualCuts,
      sceneBoundaries: next.sceneBoundaries,
      future: future.slice(1),
      past: pushHistory(past, { words, speakers, manualCuts, sceneBoundaries }),
      selectedClipIndex: null,
      selectedCutIndex: null,
      selectedWordIds: [],
      gestureActive: false,
      })
    );
    bumpAutosave();
  },
  toggleShowDeleted: () => {
    set((s) => ({ showDeleted: !s.showDeleted }));
    bumpAutosave();
  },

  setCurrentTime: (currentTime) => set({ currentTime }),
  seekTo: (time) => {
    const media = get().videoEl;
    if (media) media.currentTime = Math.min(Math.max(0, time), get().duration);
    set({ currentTime: time });
  },
  setPlaying: (playing) => set({ playing }),
  setVideoEl: (videoEl) => set({ videoEl }),
  togglePlayback: () => {
    const s = get();
    const media = s.videoEl;
    if (!media) return;
    if (s.playing && media.paused) {
      set({ playing: false });
      return;
    }
    if (media.paused) {
      const cuts = getCutRanges(s.words, s.duration, s.manualCuts);
      const selectedClip = s.activeClipRange
        ? {
            id: "active-clip",
            start: s.activeClipRange.start,
            end: s.activeClipRange.end,
            index: -1,
          }
        : getSelectedClipSegment(
        cuts,
        s.duration,
        s.sceneBoundaries,
        s.selectedClipIndex
      ) ??
        (s.aiClipPreviewRange
          ? {
              id: "ai-preview",
              start: s.aiClipPreviewRange.start,
              end: s.aiClipPreviewRange.end,
              index: -1,
            }
          : null);
      if (selectedClip) {
        const selectedClipEnd = clipTranscriptEnd(s.words, selectedClip);
        if (
          media.currentTime < selectedClip.start ||
          media.currentTime > selectedClipEnd
        ) {
          media.currentTime = selectedClip.start;
        }
        const postRollEnd = postRollEndAfter(s.layers, s.duration, selectedClipEnd);
        if (
          s.currentTime >= selectedClipEnd - 0.05 &&
          s.currentTime < postRollEnd - 0.01
        ) {
          media.pause();
          set({ playing: true, currentTime: Math.max(s.currentTime, selectedClipEnd) });
          return;
        }
      }
      const cut = cutRangeAt(media.currentTime, cuts);
      if (cut) media.currentTime = cut.end + PLAYHEAD_EPSILON_S;
      if (media.currentTime >= media.duration - 0.05) media.currentTime = 0;
      void media.play();
    } else {
      media.pause();
    }
  },
  setExportUrl: (exportUrl) => set({ exportUrl }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setExportPreviewAspectRatio: (exportPreviewAspectRatio) =>
    set({ exportPreviewAspectRatio }),
  setExportPreviewLayout: (exportPreviewLayout) =>
    set({ exportPreviewLayout }),
  setShowCaptions: (showCaptions) => set({ showCaptions }),
  setCaptionPosition: (captionPosition) => {
    set((s) => ({
      captionPosition,
      layers: s.layers.map((layer) =>
        layer.id === CAPTION_LAYER_ID
          ? {
              ...layer,
              transform: clampLayerTransform(captionPosition, layer.transform),
            }
          : layer
      ),
    }));
    bumpAutosave();
  },
  updateVideoTransform: (transform) => {
    set((s) => ({
      videoTransform: clampVideoTransform(transform, s.videoTransform),
    }));
    bumpAutosave();
  },
  updateVideoCrop: (transform, cropAspectRatio) => {
    set((s) => ({
      videoCrop: clampVideoCrop(transform, s.videoCrop),
      ...(cropAspectRatio ? { videoCropAspectRatio: cropAspectRatio } : {}),
    }));
    bumpAutosave();
  },
  updateImageCrop: (id, transform, cropAspectRatio) => {
    set((s) => {
      const image = s.layers.find((layer) => layer.id === id && layer.type === "image");
      if (!image || image.type !== "image") return {};
      const crop = clampVideoCrop(transform, image.crop ?? DEFAULT_VIDEO_CROP);
      return {
        layers: s.layers.map((layer) =>
          layer.id === id && layer.type === "image"
            ? { ...layer, crop, ...(cropAspectRatio ? { cropAspectRatio } : {}) }
            : layer
        ),
      };
    });
    bumpAutosave();
  },
  updateVideoLayerCrop: (id, transform, cropAspectRatio) => {
    set((s) => {
      const video = s.layers.find((layer) => layer.id === id && layer.type === "video");
      if (!video || video.type !== "video") return {};
      const crop = clampVideoCrop(transform, video.crop);
      return {
        layers: s.layers.map((layer) =>
          layer.id === id && layer.type === "video"
            ? { ...layer, crop, ...(cropAspectRatio ? { cropAspectRatio } : {}) }
            : layer
        ),
      };
    });
    bumpAutosave();
  },
  setVideoSelected: (videoSelected) => set({ videoSelected }),
  duplicateVideoLayer: (sourceLayerId) => {
    const id = crypto.randomUUID();
    set((s) => {
      const source = s.layers.find(
        (layer): layer is VideoLayer =>
          layer.id === sourceLayerId && layer.type === "video"
      );
      return {
        layers: [
          ...s.layers,
          {
            id,
            name: `Video copy ${s.layers.filter((layer) => layer.type === "video").length + 1}`,
            type: "video",
            transform: { ...(source?.transform ?? s.videoTransform) },
            crop: { ...(source?.crop ?? s.videoCrop) },
            ...((source?.cropAspectRatio ?? s.videoCropAspectRatio)
              ? { cropAspectRatio: source?.cropAspectRatio ?? s.videoCropAspectRatio ?? undefined }
              : {}),
            start: source?.start ?? 0,
            end: source?.end ?? s.duration,
          },
        ],
        selectedLayerId: id,
        videoSelected: false,
      };
    });
    bumpAutosave();
    return id;
  },
  addTextLayer: (text = "Text") => {
    const id = crypto.randomUUID();
    set((s) => ({
      layers: [
        ...s.layers,
        {
          id,
          name: "Text",
          type: "text",
          source: "static",
          text,
          style: {
            color: "#ffffff",
            fontFamily: "Arial",
            fontSize: 36,
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.15,
            dropShadow: true,
          },
          transform: { x: 50, y: 50, width: 42, height: 16 },
          start: Math.min(s.currentTime, s.duration),
          end: s.duration,
        },
      ],
      selectedLayerId: id,
    }));
    bumpAutosave();
    return id;
  },
  addImageLayer: (src, name = "Image", aspectRatio) => {
    const id = crypto.randomUUID();
    set((s) => {
      const sourceAspectRatio =
        aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0
          ? aspectRatio
          : null;
      const frameAspectRatio =
        (s.exportPreviewAspectRatio ?? "landscape") === "portrait"
          ? 9 / 16
          : 16 / 9;
      let width = 35;
      let height = sourceAspectRatio
        ? (width * frameAspectRatio) / sourceAspectRatio
        : 35;
      if (height > 60) {
        width *= 60 / height;
        height = 60;
      }

      return {
        layers: [
          ...s.layers,
          {
            id,
            name,
            type: "image",
            src,
            transform: { x: 50, y: 50, width, height },
            crop: { ...DEFAULT_VIDEO_CROP },
            ...(sourceAspectRatio
              ? { cropAspectRatio: sourceAspectRatio }
              : {}),
            start: Math.min(s.currentTime, s.duration),
            end: s.duration,
          },
        ],
        selectedLayerId: id,
      };
    });
    bumpAutosave();
    return id;
  },
  addEndCardLayer: (src, name = "Closing image", aspectRatio, startAt) => {
    const id = crypto.randomUUID();
    set((s) => {
      const cuts = getCutRanges(s.words, s.duration, s.manualCuts);
      const activeScope = s.activeClipRange ?? s.aiClipPreviewRange;
      const selectedClip = getSelectedClipSegment(
        cuts,
        s.duration,
        s.sceneBoundaries,
        s.selectedClipIndex
      );
      const clipEnd =
        activeScope
          ? clipTranscriptEnd(s.words, activeScope)
          : selectedClip
            ? clipTranscriptEnd(s.words, selectedClip)
            : s.duration;
      // An end card belongs to the active clip, including an LLM proposal that
      // has no selectedClipIndex yet. It may legitimately start after the
      // source video duration because it extends the composition.
      const start = Math.max(
        0,
        startAt ?? clipEnd
      );
      const sourceAspectRatio =
        aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0
          ? aspectRatio
          : null;
      const frameAspectRatio =
        (s.exportPreviewAspectRatio ?? "landscape") === "portrait"
          ? 9 / 16
          : 16 / 9;
      let width = 100;
      let height = sourceAspectRatio
        ? (width * frameAspectRatio) / sourceAspectRatio
        : 100;
      if (height < 100) {
        width *= 100 / height;
        height = 100;
      }

      return {
        layers: [
          ...s.layers,
          {
            id,
            name,
            type: "image",
            src,
            postRoll: true,
            transform: { x: 50, y: 50, width, height },
            crop: { ...DEFAULT_VIDEO_CROP },
            ...(sourceAspectRatio ? { cropAspectRatio: sourceAspectRatio } : {}),
            start,
            end: start + 3,
          },
        ],
        selectedLayerId: id,
        currentTime: start,
      };
    });
    bumpAutosave();
    return id;
  },
  updateLayerTransform: (id, transform) => {
    set((s) => {
      const current = s.layers.find((layer) => layer.id === id);
      if (!current) return {};
      const nextTransform = current.type === "video"
        ? clampVideoTransform(transform, current.transform)
        : clampLayerTransform(transform, current.transform);
      return {
        layers: s.layers.map((layer) =>
          layer.id === id ? { ...layer, transform: nextTransform } : layer
        ),
        ...(id === CAPTION_LAYER_ID
          ? { captionPosition: { x: nextTransform.x, y: nextTransform.y } }
          : {}),
      };
    });
    bumpAutosave();
  },
  updateLayerTiming: (id, timing) => {
    set((s) => ({
      layers: s.layers.map((layer) => {
        if (layer.id !== id) return layer;
        const current = layerTiming(layer, s.duration);
        const postRoll = layer.type === "image" && layer.postRoll;
        const minLength = postRoll ? 0.1 : Math.min(0.05, s.duration);
        const start = Math.max(
          0,
          Math.min(
            timing.start ?? current.start,
            (timing.end ?? current.end) - minLength
          )
        );
        const end = postRoll
          ? Math.max(timing.end ?? current.end, start + minLength)
          : Math.min(
              s.duration,
              Math.max(timing.end ?? current.end, start + minLength)
            );
        return { ...layer, start, end };
      }),
    }));
    bumpAutosave();
  },
  updateTextLayer: (id, update) => {
    set((s) => ({
      layers: s.layers.map((layer) => {
        if (layer.id !== id || layer.type !== "text") return layer;
        return {
          ...layer,
          ...(update.text !== undefined ? { text: update.text } : {}),
          ...(update.style
            ? {
                style: {
                  color: "#ffffff",
                  fontFamily: "Arial",
                  fontSize: 32,
                  fontWeight: 800,
                  textAlign: "center",
                  lineHeight: 1.08,
                  dropShadow: true,
                  ...layer.style,
                  ...update.style,
                },
              }
            : {}),
        };
      }),
    }));
    bumpAutosave();
  },
  removeLayer: (id) => {
    if (id === CAPTION_LAYER_ID) return;
    set((s) => ({
      layers: s.layers.filter((layer) => layer.id !== id),
      selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId,
    }));
    bumpAutosave();
  },
  moveLayerToIndex: (id, index) => {
    set((s) => ({ layers: moveLayer(s.layers, id, index) }));
    bumpAutosave();
  },
  setSelectedLayerId: (selectedLayerId) =>
    set({ selectedLayerId, ...(selectedLayerId ? { videoSelected: false } : {}) }),
  requestMediaMenuOpen: () =>
    set((s) => ({ mediaMenuRequestId: s.mediaMenuRequestId + 1 })),
  setWorkspaceScreen: (workspaceScreen) =>
    set(
      workspaceScreen === "editor"
        ? { workspaceScreen }
        : { workspaceScreen, activeClipRange: null, aiClipPreviewRange: null }
    ),
  setAiClipSuggestions: (aiClipSuggestions) =>
    set((s) => {
      const next = withWorkflow(s, {
        aiClipSuggestions,
        workspaceScreen: aiClipSuggestions.length > 0 ? "clips" : s.workspaceScreen,
      });
      bumpAutosave();
      flushAutosave();
      return next;
    }),
  clearAiClipSuggestions: () =>
    set((s) => {
      const next = withWorkflow(s, { aiClipSuggestions: [] });
      bumpAutosave();
      flushAutosave();
      return next;
    }),
  setAiClipDurationRange: (aiClipDurationRange) => {
    set({ aiClipDurationRange });
    bumpAutosave();
  },
  setAiClipPreviewRange: (aiClipPreviewRange) =>
    set({ aiClipPreviewRange }),
  setActiveClipRange: (activeClipRange) => set({ activeClipRange }),
  previewAiClip: (aiClipPreviewRange) => {
    set({ aiClipPreviewRange });
    const media = get().videoEl;
    if (media) {
      media.currentTime = aiClipPreviewRange.start;
      void media.play();
    }
  },

  reset: () => {
    const { mediaUrl, exportUrl } = get();
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    set({
      videoFile: null,
      mediaUrl: null,
      mediaKind: null,
      duration: 0,
      waveform: null,
      hasAudio: false,
      source: loadModelPreference(),
      transcriptLanguage: loadTranscriptLanguagePreference(),
      pendingTranscript: null,
      projectId: null,
      skipTranscription: false,
      status: "idle",
      progress: { message: "", value: null },
      partialText: "",
      error: null,
      words: [],
      speakers: [],
      manualCuts: [],
      sceneBoundaries: [],
      past: [],
      future: [],
      selectedClipIndex: null,
      selectedCutIndex: null,
      selectedWordIds: [],
      nextManualCutId: 1,
      nextBoundaryId: 1,
      gestureActive: false,
      currentTime: 0,
      playing: false,
      exportUrl: null,
      exportOpen: false,
      exportPreviewAspectRatio: "landscape",
      exportPreviewLayout: "fill",
      showCaptions: true,
      captionPosition: DEFAULT_CAPTION_POSITION,
      videoTransform: DEFAULT_VIDEO_TRANSFORM,
      videoCrop: DEFAULT_VIDEO_CROP,
      videoCropAspectRatio: null,
      videoSelected: false,
      layers: [createCaptionLayer(DEFAULT_CAPTION_POSITION)],
      selectedLayerId: null,
      aiClipSuggestions: [],
      aiClipDurationRange: DEFAULT_AI_CLIP_DURATION_RANGE,
      aiClipPreviewRange: null,
      activeClipRange: null,
      projectPhase: "idle",
      workspaceScreen: "projects",
    });
  },
}));

/** Apply the stored model preference after mount (avoids SSR/localStorage mismatch). */
export function hydrateModelPreference() {
  const stored = loadModelPreference();
  const current = useEditorStore.getState().source;
  // Don't clobber an in-progress import selection.
  if (current === "import" || stored === current) return;
  useEditorStore.setState({ source: stored });
}

/** Apply the stored transcript language after mount (avoids SSR/localStorage mismatch). */
export function hydrateTranscriptLanguagePreference() {
  const stored = loadTranscriptLanguagePreference();
  if (stored !== useEditorStore.getState().transcriptLanguage) {
    useEditorStore.setState({ transcriptLanguage: stored });
  }
}

// DevTools / Playwright: inspect and drive the editor store from the console.
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as unknown as { __rescriptStore?: typeof useEditorStore }).__rescriptStore =
    useEditorStore;
}
