import assert from "node:assert/strict";
import {
  applyTranscriptSegmentCorrections,
  buildCorrectionPrompt,
  buildCorrectionSegments,
  parseCorrectionResponse,
} from "../lib/transcriptCorrection";
import type { Word } from "../lib/types";

const words: Word[] = [
  { id: 1, text: "Anavido", start: 1, end: 1.6, speaker: 0, deleted: false },
  { id: 2, text: "habló", start: 1.6, end: 2, speaker: 0, deleted: false },
  { id: 3, text: "de", start: 2, end: 2.2, speaker: 0, deleted: false },
  { id: 4, text: "Bizazio.", start: 2.2, end: 3, speaker: 0, deleted: false },
];

const segments = buildCorrectionSegments(words, { maxWords: 20 });
assert.equal(segments.length, 1);
assert.equal(segments[0].id, "S001");
assert.match(buildCorrectionPrompt(segments), /\[S001\]/);

const reviews = parseCorrectionResponse(
  "[S001]\nAna Vidović habló de Bizancio.",
  segments
);
assert.equal(reviews.length, 1);
assert.equal(reviews[0].risk, "review");

const sameCount = applyTranscriptSegmentCorrections(words, [
  { wordIds: [4], text: "Bizancio." },
]);
assert.ok(sameCount);
assert.equal(sameCount[3].id, 4);
assert.equal(sameCount[3].start, 2.2);
assert.equal(sameCount[3].end, 3);
assert.equal(sameCount[3].text, "Bizancio.");

const expanded = applyTranscriptSegmentCorrections(words, [
  { wordIds: [1], text: "Ana Vidović" },
]);
assert.ok(expanded);
assert.equal(expanded.length, 5);
assert.equal(expanded[0].start, 1);
assert.equal(expanded[1].end, 1.6);
assert.equal(expanded[0].text, "Ana");
assert.equal(expanded[1].text, "Vidović");

assert.throws(
  () => parseCorrectionResponse("Texto sin identificadores", segments),
  /S001/
);

console.log("transcript correction tests passed");
