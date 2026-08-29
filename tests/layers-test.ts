import {
  clampLayerTransform,
  createCaptionLayer,
  layerTiming,
  moveLayer,
} from "../lib/layers";
import type { EditorLayer } from "../lib/types";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

{
  const layer = createCaptionLayer(undefined, 30);
  layer.start = 4;
  layer.end = 12;
  const timing = layerTiming(layer, 30);
  assert(timing.start === 4 && timing.end === 12, "layer timing is retained");
  const legacyTiming = layerTiming({ ...layer, start: undefined, end: undefined }, 30);
  assert(legacyTiming.start === 0 && legacyTiming.end === 30, "legacy layers span the project");
  console.log("layer timing: ok");
}

{
  const caption = createCaptionLayer({ x: 20, y: 70 });
  assert(caption.source === "caption", "caption layer has a caption source");
  assert(caption.transform.x === 20 && caption.transform.y === 70, "caption position is retained");
  console.log("caption layer: ok");
}

{
  const transform = clampLayerTransform(
    { x: -10, y: 200, width: 40, height: 20 },
    { x: 50, y: 50, width: 30, height: 30 }
  );
  assert(transform.x === 20, `expected constrained x 20, got ${transform.x}`);
  assert(transform.y === 90, `expected constrained y 90, got ${transform.y}`);
  console.log("layer bounds: ok");
}

{
  const layers: EditorLayer[] = [
    createCaptionLayer(),
    {
      id: "image",
      name: "Image",
      type: "image",
      src: "asset://image",
      transform: { x: 50, y: 50, width: 20, height: 20 },
    },
  ];
  const moved = moveLayer(layers, "image", 0);
  assert(moved[0]?.id === "image", "layer order can move to the back");
  console.log("layer stack: ok");
}

console.log("ALL LAYER TESTS PASSED");
