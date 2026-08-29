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
  const cuts = useCutRanges();

  return useMemo(
    () => {
      const selected = getSelectedClipSegment(
        cuts,
        duration,
        sceneBoundaries,
        selectedClipIndex
      );
      if (selected) return selected;

      // An AI suggestion is an editable clip even before the user creates any
      // permanent timeline boundaries for it.
      if (!aiClipPreviewRange) return null;
      return {
        id: `ai-${aiClipPreviewRange.start.toFixed(4)}-${aiClipPreviewRange.end.toFixed(4)}`,
        start: aiClipPreviewRange.start,
        end: aiClipPreviewRange.end,
        index: -1,
      };
    },
    [
      aiClipPreviewRange,
      cuts,
      duration,
      sceneBoundaries,
      selectedClipIndex,
    ]
  );
}
