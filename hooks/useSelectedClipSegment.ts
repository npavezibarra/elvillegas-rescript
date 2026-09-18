"use client";

import { useMemo } from "react";
import { getSelectedClipSegment } from "@/lib/edits";
import { useEditorStore } from "@/lib/store";
import type { ClipSegment } from "@/lib/types";
import { useCutRanges } from "./useCutRanges";

export function useSelectedClipSegment(): ClipSegment | null {
  const sceneBoundaries = useEditorStore((s) => s.sceneBoundaries);
  const duration = useEditorStore((s) => s.duration);
  const selectedClipIndex = useEditorStore((s) => s.selectedClipIndex);
  const aiClipPreviewRange = useEditorStore((s) => s.aiClipPreviewRange);
  const activeClipRange = useEditorStore((s) => s.activeClipRange);
  const cuts = useCutRanges();

  return useMemo(
    () => {
      // An imported AI proposal is the active editing scope. It must take
      // precedence over the underlying full-video keep range when a timeline
      // interaction happens inside the proposal.
      const scope = activeClipRange ?? aiClipPreviewRange;
      if (scope) {
        return {
          id: `active-${scope.start.toFixed(4)}-${scope.end.toFixed(4)}`,
          start: scope.start,
          end: scope.end,
          index: -1,
        };
      }
      const selected = getSelectedClipSegment(
        cuts,
        duration,
        sceneBoundaries,
        selectedClipIndex
      );
      if (selected) return selected;

      return null;
    },
    [
      aiClipPreviewRange,
      activeClipRange,
      cuts,
      duration,
      sceneBoundaries,
      selectedClipIndex,
    ]
  );
}
