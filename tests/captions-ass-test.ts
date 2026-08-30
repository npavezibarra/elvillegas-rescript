/**
 * Unit tests for ASS burn-in caption export.
 * Run: npx tsx tests/captions-ass-test.ts
 */
import { serializeCaptionAss, serializeStaticTextAss } from "../lib/captionsExport";
import { createCaptionLayer } from "../lib/layers";
import type { TextLayer, Word } from "../lib/types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const layer: TextLayer = {
    id: "title",
    name: "Title",
    type: "text",
    source: "static",
    text: "A title",
    transform: { x: 50, y: 20, width: 60, height: 15 },
    style: {
      color: "#ffffff",
      fontFamily: "Arial",
      fontSize: 48,
      fontWeight: 700,
      textAlign: "center",
      lineHeight: 1.1,
      dropShadow: true,
    },
  };
  const ass = serializeStaticTextAss(layer, 12.5, 1920, 1080);
  assert(ass.includes("{\\an5\\pos(960,216)}A title"), "static text position");
  assert(ass.includes("0:00:12.50"), "static text duration");
  const bundledFontAss = serializeStaticTextAss(
    layer,
    12.5,
    1920,
    1080,
    0,
    12.5,
    "Geist"
  );
  assert(bundledFontAss.includes("Style: Text,Geist,"), "bundled static text font");
  console.log("static text export: ok");
}

{
  const layer: TextLayer = {
    id: "timed-title",
    name: "Timed title",
    type: "text",
    source: "static",
    text: "Brief",
    transform: { x: 50, y: 20, width: 60, height: 15 },
  };
  const ass = serializeStaticTextAss(layer, 20, 1000, 1000, 3, 7);
  assert(ass.includes("0:00:03.00,0:00:07.00"), "static text timing");
  console.log("static text timing: ok");
}

const words: Word[] = [
  { id: 0, text: "Sigo", start: 0, end: 0.35, speaker: 0, deleted: false },
  { id: 1, text: "con", start: 0.35, end: 0.52, speaker: 0, deleted: false },
  { id: 2, text: "Rettig", start: 0.52, end: 0.9, speaker: 0, deleted: false },
  { id: 3, text: "y", start: 1.65, end: 1.75, speaker: 0, deleted: false },
  { id: 4, text: "Greenberg", start: 1.75, end: 2.15, speaker: 0, deleted: false },
];

{
  const ass = serializeCaptionAss(words, {
    duration: 3,
    playResX: 1080,
    playResY: 1920,
  });
  assert(ass.includes("[Script Info]"), "ass header");
  assert(ass.includes("PlayResX: 1080"), "ass width");
  assert(ass.includes("PlayResY: 1920"), "ass height");
  assert(ass.includes("Style: Active,Arial,"), "active caption style");
  assert(ass.includes("&H004DD3FC"), "active caption amber background");
  assert(ass.includes("{\\rActive}Sigo{\\rCaption}"), "active word 1");
  assert(ass.includes("{\\rActive}con{\\rCaption}"), "active word 2");
  assert(ass.includes("{\\rActive}Rettig{\\rCaption}"), "active word 3");
  assert(ass.includes("Dialogue: 0,0:00:00.00,0:00:00.35,Caption"), "first word cue timing");
  assert(ass.includes("Dialogue: 0,0:00:00.35,0:00:00.52,Caption"), "second word cue timing");
  assert(ass.includes("Dialogue: 0,0:00:01.65,0:00:01.75,Caption"), "second block cue timing");
  console.log("ass burn-in export: ok");
}

{
  const layer = createCaptionLayer({ x: 25, y: 40 });
  layer.style = {
    color: "#36c6ff",
    fontFamily: "Georgia",
    fontSize: 40,
    fontWeight: 700,
    textAlign: "left",
    lineHeight: 1.1,
    dropShadow: false,
  };
  const ass = serializeCaptionAss(words, {
    duration: 3,
    playResX: 1000,
    playResY: 1000,
    layer,
    fontName: "Geist",
  });
  assert(ass.includes("{\\an4\\pos(250,400)}"), "caption layer position and alignment");
  assert(ass.includes("&H00FFC636"), "caption layer color");
  assert(ass.includes("Style: Caption,Geist,"), "bundled caption font override");
  console.log("caption layer styling: ok");
}

console.log("ALL CAPTIONS ASS TESTS PASSED");
