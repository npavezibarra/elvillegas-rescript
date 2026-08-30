"use client";

import { useMemo, useState } from "react";
import { FloatingPortal } from "@floating-ui/react";
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Sparkles,
  X,
} from "lucide-react";
import type { TimeRange, Word } from "@/lib/types";
import {
  buildCorrectionPrompt,
  buildCorrectionSegments,
  parseCorrectionResponse,
  type CorrectionRisk,
  type CorrectionScope,
  type TranscriptCorrectionReview,
  type TranscriptSegmentCorrection,
} from "@/lib/transcriptCorrection";

const RISK_LABEL: Record<CorrectionRisk, string> = {
  safe: "Cambio seguro",
  review: "Revisar palabras",
  high: "Cambio importante",
};

const RISK_CLASS: Record<CorrectionRisk, string> = {
  safe: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  review: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  high: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};

export default function TranscriptCorrectionDialog({
  words,
  selectedIds,
  clipRange,
  onApply,
  onClose,
}: {
  words: Word[];
  selectedIds: number[];
  clipRange: TimeRange | null;
  onApply: (corrections: TranscriptSegmentCorrection[]) => void;
  onClose: () => void;
}) {
  const initialScope: CorrectionScope = clipRange
    ? "clip"
    : selectedIds.length > 0
      ? "selection"
      : "all";
  const [scope, setScope] = useState<CorrectionScope>(initialScope);
  const [knownTerms, setKnownTerms] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [reviews, setReviews] = useState<TranscriptCorrectionReview[] | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const segments = useMemo(
    () =>
      buildCorrectionSegments(words, {
        range: scope === "clip" ? clipRange : null,
        selectedIds: scope === "selection" ? selectedIds : undefined,
      }),
    [clipRange, scope, selectedIds, words]
  );
  const prompt = useMemo(
    () => buildCorrectionPrompt(segments, knownTerms),
    [knownTerms, segments]
  );

  const changeScope = (next: CorrectionScope) => {
    setScope(next);
    setPasteValue("");
    setReviews(null);
    setAccepted(new Set());
    setMessage(null);
  };

  const copyPrompt = async () => {
    setMessage(null);
    try {
      await navigator.clipboard.writeText(prompt);
      setMessage(`${segments.length} segmentos copiados. Pégalos en tu LLM.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo copiar el texto."
      );
    }
  };

  const analyze = () => {
    setMessage(null);
    try {
      const nextReviews = parseCorrectionResponse(pasteValue, segments);
      setReviews(nextReviews);
      setAccepted(
        new Set(
          nextReviews
            .filter((review) => review.risk === "safe")
            .map((review) => review.segment.id)
        )
      );
      if (nextReviews.length === 0) {
        setMessage("La respuesta no contiene cambios respecto del texto original.");
      }
    } catch (error) {
      setReviews(null);
      setAccepted(new Set());
      setMessage(
        error instanceof Error ? error.message : "No se pudo analizar la respuesta."
      );
    }
  };

  const applyAccepted = () => {
    if (!reviews) return;
    const corrections = reviews
      .filter((review) => accepted.has(review.segment.id))
      .map((review) => ({
        wordIds: review.segment.wordIds,
        text: review.correctedText,
      }));
    if (corrections.length === 0) return;
    onApply(corrections);
    onClose();
  };

  return (
    <FloatingPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Corregir transcripción con IA"
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-black/25 dark:border-zinc-700 dark:bg-zinc-900">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-amber-500" />
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Corregir transcripción con IA
                </h2>
              </div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Corrige el texto sin perder su unión con el audio y los clips.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X size={18} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="flex flex-wrap gap-2">
              {clipRange && (
                <ScopeButton selected={scope === "clip"} onClick={() => changeScope("clip")}>
                  Clip actual
                </ScopeButton>
              )}
              {selectedIds.length > 0 && (
                <ScopeButton selected={scope === "selection"} onClick={() => changeScope("selection")}>
                  Selección ({selectedIds.length})
                </ScopeButton>
              )}
              <ScopeButton selected={scope === "all"} onClick={() => changeScope("all")}>
                Transcripción completa
              </ScopeButton>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      1. Copiar para la IA
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {segments.length} segmentos con identificadores protegidos
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyPrompt()}
                    disabled={segments.length === 0}
                    className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  >
                    <ClipboardCopy size={14} />
                    Copiar prompt
                  </button>
                </div>
                <label className="mt-4 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Nombres o términos conocidos (opcional)
                </label>
                <textarea
                  value={knownTerms}
                  onChange={(event) => setKnownTerms(event.target.value)}
                  placeholder="José Antonio Kast, Justiniano, Revuelta de Niká..."
                  className="mt-1.5 h-20 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-zinc-400 focus:bg-white dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500"
                />
              </div>

              <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  2. Pegar la respuesta corregida
                </p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  ReScript comprobará los identificadores antes de cambiar el texto.
                </p>
                <textarea
                  value={pasteValue}
                  onChange={(event) => {
                    setPasteValue(event.target.value);
                    setReviews(null);
                  }}
                  placeholder={'[S001]\nTexto corregido...'}
                  className="mt-4 h-28 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800 outline-none transition focus:border-zinc-400 focus:bg-white dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500"
                />
                <button
                  type="button"
                  onClick={analyze}
                  disabled={!pasteValue.trim() || segments.length === 0}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Sparkles size={14} />
                  Analizar correcciones
                </button>
              </div>
            </div>

            {message && (
              <div className="mt-4 rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {message}
              </div>
            )}

            {reviews && reviews.length > 0 && (
              <div className="mt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      3. Revisar cambios
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      Los cambios seguros están seleccionados automáticamente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAccepted(
                        new Set(
                          reviews
                            .filter((review) => review.risk === "safe")
                            .map((review) => review.segment.id)
                        )
                      )
                    }
                    className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    Seleccionar solo cambios seguros
                  </button>
                </div>

                <div className="mt-3 space-y-3">
                  {reviews.map((review) => {
                    const checked = accepted.has(review.segment.id);
                    return (
                      <label
                        key={review.segment.id}
                        className={`block cursor-pointer rounded-2xl border p-4 transition ${
                          checked
                            ? "border-zinc-400 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-800/60"
                            : "border-zinc-200 dark:border-zinc-800"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                              checked
                                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                                : "border-zinc-300 dark:border-zinc-600"
                            }`}
                          >
                            {checked && <Check size={13} />}
                          </span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setAccepted((current) => {
                                const next = new Set(current);
                                if (next.has(review.segment.id)) next.delete(review.segment.id);
                                else next.add(review.segment.id);
                                return next;
                              })
                            }
                            className="sr-only"
                          />
                          <span className="font-mono text-xs font-semibold text-zinc-500">
                            [{review.segment.id}]
                          </span>
                          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${RISK_CLASS[review.risk]}`}>
                            {review.risk !== "safe" && <AlertTriangle size={10} className="mr-1 inline" />}
                            {RISK_LABEL[review.risk]}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Original</p>
                            <p className="mt-1 text-sm leading-6 text-zinc-500 line-through decoration-zinc-300 dark:text-zinc-400 dark:decoration-zinc-600">
                              {review.segment.originalText}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Corregido</p>
                            <p className="mt-1 text-sm leading-6 text-zinc-900 dark:text-zinc-100">
                              {review.correctedText}
                            </p>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Los tiempos, clips y cortes permanecerán vinculados al audio.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={applyAccepted}
                disabled={!reviews || accepted.size === 0}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                Aplicar {accepted.size || ""} correcciones
              </button>
            </div>
          </footer>
        </section>
      </div>
    </FloatingPortal>
  );
}

function ScopeButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        selected
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}
