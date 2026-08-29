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
  const cuts = useCutRanges();

  return useMemo(
    () => getSelectedClipSegment(cuts, duration, sceneBoundaries, selectedClipIndex),
    [cuts, duration, sceneBoundaries, selectedClipIndex]
  );
}
