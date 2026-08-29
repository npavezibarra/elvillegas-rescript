import {
  buildAiTranscriptBlocks,
  buildAiTranscriptExport,
  parseClipSuggestions,
  reorderClipSuggestions,
} from "../lib/aiClips";
import type { Word } from "../lib/types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const words: Word[] = [
  { id: 0, text: "Hello.", start: 0, end: 0.7, speaker: 0, deleted: false },
  { id: 1, text: "This", start: 1.0, end: 1.3, speaker: 0, deleted: false },
  { id: 2, text: "is", start: 1.3, end: 1.5, speaker: 0, deleted: true },
  { id: 3, text: "one", start: 1.5, end: 1.7, speaker: 0, deleted: false },
  { id: 4, text: "idea.", start: 1.7, end: 2.1, speaker: 0, deleted: false },
  { id: 5, text: "Next", start: 4.0, end: 4.2, speaker: 1, deleted: false },
  { id: 6, text: "turn.", start: 4.2, end: 4.8, speaker: 1, deleted: false },
];

{
  const blocks = buildAiTranscriptBlocks(words);
  assert(blocks.length >= 2, `expected at least 2 blocks, got ${blocks.length}`);
  assert(blocks[0].id === "B0001", `first block id ${blocks[0].id}`);
  assert(
    blocks.some((block) => block.text.includes("is")),
    "deleted words stay in export"
  );
  const exported = buildAiTranscriptExport(words, [
    { id: 0, name: "Fernando" },
    { id: 1, name: "Lucia" },
  ]);
  assert(
    exported.includes("ORIGINAL media time"),
    "header missing original timeline note"
  );
  assert(exported.includes("[B0001 | 00:00:00"), "block header missing");
  assert(exported.includes("Fernando"), "speaker label missing");
  console.log("AI transcript export: ok");
}

{
  const json = `[
    {
      "title": "The nuclear option",
      "start": 12.5,
      "end": 34.2,
      "score": 94,
      "reason": "A strong standalone argument."
    }
  ]`;
  const clips = parseClipSuggestions(json, 120);
  assert(clips.length === 1, "expected one clip");
  assert(clips[0].title === "The nuclear option", "title parse");
  assert(clips[0].start === 12.5, "start parse");
  assert(clips[0].end === 34.2, "end parse");
  console.log("clip JSON parse: ok");
}

{
  let threw = false;
  try {
    parseClipSuggestions(`[{"title":"","start":1,"end":2}]`, 10);
  } catch {
    threw = true;
  }
  assert(threw, "invalid clip should throw");
  console.log("clip validation: ok");
}

{
  const clips = reorderClipSuggestions(
    [
      { title: "One", start: 0, end: 10 },
      { title: "Two", start: 10, end: 20 },
      { title: "Three", start: 20, end: 30 },
    ],
    0,
    2
  );
  assert(clips[2].title === "One", "reorder should move the first clip");
  console.log("clip reorder: ok");
}

console.log("ALL AI CLIPS TESTS PASSED");
