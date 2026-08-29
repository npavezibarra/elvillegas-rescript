import {
  getVideoAspectRatioDimensions,
  getVideoExportTransform,
} from "../lib/ffmpeg";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  const dims = getVideoAspectRatioDimensions("original", "original", 1920, 1080);
  assert(dims === null, "original aspect should not crop");
  console.log("original aspect: ok");
}

{
  const dims = getVideoAspectRatioDimensions("original", "landscape", 1920, 1080);
  assert(!!dims, "landscape dims missing");
  assert(dims.width === 1920, `landscape width ${dims.width}`);
  assert(dims.height === 1080, `landscape height ${dims.height}`);
  const transform = getVideoExportTransform("original", "landscape", 1920, 1080);
  assert(transform?.includes("crop=1920:1080"), "landscape crop filter");
  assert(transform?.includes("setsar=1"), "landscape setsar");
  console.log("landscape export: ok");
}

{
  const dims = getVideoAspectRatioDimensions("original", "portrait", 1920, 1080);
  assert(!!dims, "portrait dims missing");
  assert(dims.width === 1080, `portrait width ${dims.width}`);
  assert(dims.height === 1920, `portrait height ${dims.height}`);
  const transform = getVideoExportTransform("original", "portrait", 1920, 1080);
  assert(transform?.includes("crop=1080:1920"), "portrait crop filter");
  assert(transform?.includes("setsar=1"), "portrait setsar");
  console.log("portrait export: ok");
}

{
  const transform = getVideoExportTransform(
    "original",
    "portrait",
    1920,
    1080,
    "fit"
  );
  assert(transform?.includes("pad=1080:1920"), "portrait fit pad filter");
  assert(!transform?.includes("crop=1080:1920"), "portrait fit should not crop");
  console.log("portrait fit export: ok");
}

{
  const dims = getVideoAspectRatioDimensions("720", "portrait", 1280, 720);
  assert(!!dims, "720 portrait dims missing");
  assert(dims.width === 720, `720 portrait width ${dims.width}`);
  assert(dims.height === 1280, `720 portrait height ${dims.height}`);
  console.log("resolution-aware portrait: ok");
}

{
  const transform = getVideoExportTransform("1080", "original", 1920, 1080);
  assert(!!transform && transform.startsWith("scale="), "original aspect should scale only");
  console.log("original aspect scaling: ok");
}

console.log("ALL FFMPEG EXPORT TESTS PASSED");
