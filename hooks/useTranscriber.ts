"use client";

import { useCallback, useEffect, useRef } from "react";
import { en } from "@/lib/i18n/messages/en";
import { isModelId } from "@/lib/models";
import { reportError } from "@/lib/sentry";
import { useEditorStore } from "@/lib/store";
import { trackEvent } from "@/lib/telemetry";
import type { WorkerResponse } from "@/lib/types";

let activeWorker: Worker | null = null;
const TRANSCRIPTION_STALL_MS = 2 * 60 * 1000;

/** Stop an in-flight ASR job (e.g. after importing a transcript). */
export function cancelTranscription() {
  activeWorker?.terminate();
  activeWorker = null;
}

/** Owns the transcription web worker and pipes its messages into the store. */
export function useTranscriber() {
  const workerRef = useRef<Worker | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current === null) return;
    clearTimeout(stallTimerRef.current);
    stallTimerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearStallTimer();
      cancelTranscription();
      workerRef.current = null;
    };
  }, [clearStallTimer]);

  const transcribe = useCallback((audio: Float32Array, duration: number) => {
    const store = useEditorStore.getState();
    if (!isModelId(store.source)) {
      store.setError(en["error.selectModel"]);
      return;
    }
    const model = store.source;
    const transcriptLanguage = store.transcriptLanguage;
    store.setStatus("transcribing");
    store.setProgress({ message: en["progress.loadingSpeechModel"], value: null });
    clearStallTimer();
    let lastProgressMessage: string = en["progress.loadingSpeechModel"];
    let lastProgressValue: number | null = null;

    const armStallTimer = () => {
      clearStallTimer();
      stallTimerRef.current = setTimeout(() => {
        const s = useEditorStore.getState();
        if (s.status !== "transcribing" || s.skipTranscription) return;
        cancelTranscription();
        workerRef.current = null;
        s.setError(
          "Transcription stopped responding. Please try again; if it repeats, switch to a smaller speech model."
        );
        reportError(new Error("Transcription stalled without worker progress."), "transcription-watchdog");
      }, TRANSCRIPTION_STALL_MS);
    };
    armStallTimer();

    // Always start a fresh worker so a prior cancel can't leave us without one.
    cancelTranscription();
    workerRef.current = new Worker(
      new URL("../workers/transcription.worker.ts", import.meta.url),
      { type: "module" }
    );
    activeWorker = workerRef.current;
    workerRef.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const s = useEditorStore.getState();
      // An imported transcript sets skipTranscription; ignore late ASR results.
      if (s.skipTranscription) return;
      const msg = event.data;
      switch (msg.type) {
        case "progress": {
          const stageChanged = msg.message !== lastProgressMessage;
          const valueAdvanced =
            msg.value != null &&
            (lastProgressValue == null || msg.value > lastProgressValue);
          // Repeated indeterminate download notifications are not proof that
          // bytes are moving. Only a new stage or a larger percentage keeps
          // the watchdog alive, otherwise a dead fetch can spin forever.
          if (stageChanged || valueAdvanced) armStallTimer();
          lastProgressMessage = msg.message;
          lastProgressValue = msg.value;
          s.setProgress({ message: msg.message, value: msg.value });
          break;
        }
        case "partial":
          armStallTimer();
          s.setPartialText(msg.text);
          break;
        case "complete":
          clearStallTimer();
          s.setWords(msg.words);
          s.setStatus("ready");
          s.setPartialText("");
          const updated = useEditorStore.getState();
          if (updated.videoFile) {
            void import("@/lib/mediaLibrary")
              .then((m) =>
                m.saveLibraryTranscriptForFile(
                  updated.videoFile!,
                  msg.words,
                  updated.speakers
                )
              )
              .then(() => window.dispatchEvent(new Event("rescript-library-updated")))
              .catch((err: unknown) =>
                console.warn("Failed to save library transcript.", err)
              );
          }
          // Which model and language actually get used, to prioritise backends.
          // Nothing about the media itself — not its length, not the text.
          trackEvent("transcription_completed", {
            model,
            language: transcriptLanguage,
          });
          break;
        case "error":
          clearStallTimer();
          s.setError(msg.message);
          // A connection that dropped mid-download is the user's network, and
          // the worker already retried it. There is no stack to act on, so
          // reporting it only spends quota on an issue we cannot fix.
          if (msg.cause !== "network") {
            // Worker errors cross a postMessage boundary, so the original stack
            // is already gone by here — send the message with a stage tag.
            reportError(new Error(msg.message), "transcription");
          }
          break;
      }
    };
    workerRef.current.onerror = (err) => {
      const s = useEditorStore.getState();
      if (s.skipTranscription) return;
      clearStallTimer();
      s.setError(err.message || en["error.workerCrashed"]);
      reportError(
        new Error(err.message || en["error.workerCrashed"]),
        "transcription-worker"
      );
    };

    // Transfer, not copy: the worker takes ownership of the PCM and `audio` is
    // detached here. Nothing on the main thread reads it afterwards — the
    // waveform draws from the envelope the store built in setAudio — and on a
    // long recording the copy this replaces was hundreds of megabytes held for
    // the length of the run.
    workerRef.current.postMessage(
      { audio, duration, model, language: transcriptLanguage },
      [audio.buffer]
    );
  }, [clearStallTimer]);

  return { transcribe, cancel: cancelTranscription };
}
