import { buildPauseMarkers } from "../lib/pauseMarkers";
import type { Word } from "../lib/types";

function w(
  id: number,
  start: number,
  end: number,
  deleted = false
): Word {
  return { id, text: `w${id}`, start, end, speaker: 0, deleted };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

{
  const words = [w(1, 0.0, 1.0), w(2, 1.5, 2.0, true), w(3, 3.0, 3.5)];
  const visible = words.filter((word) => !word.deleted);
  const markers = buildPauseMarkers(words, 4.0, [], visible);
  assert(markers.length === 2, `expected 2 markers, got ${markers.length}`);
  assert(markers[0]!.anchorWordId === 1 && markers[0]!.side === "after", "first pause should sit after w1");
  assert(markers[1]!.anchorWordId === 3 && markers[1]!.side === "before", "second pause should sit before w3");
  console.log("mid-gap anchoring: ok");
}

{
  const words = [w(1, 1.0, 1.5), w(2, 3.0, 3.5)];
  const markers = buildPauseMarkers(words, 5.0);
  assert(markers.length === 1, `expected 1 interior marker, got ${markers.length}`);
  assert(markers[0]!.anchorWordId === 2, "interior pause should anchor to the next word");
  assert(markers[0]!.side === "before", "interior pause should render before the next word");
  console.log("edge silences skipped: ok");
}

console.log("ALL PAUSE MARKER TESTS PASSED");
