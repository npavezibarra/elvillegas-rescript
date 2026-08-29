import type {
  EditorLayer,
  LayerTransform,
  TextLayer,
  TextLayerStyle,
} from "./types";

export const CAPTION_LAYER_ID = "captions";

export const DEFAULT_CAPTION_TRANSFORM: LayerTransform = {
  x: 50,
  y: 82,
  width: 92,
  height: 16,
};

export const DEFAULT_TEXT_LAYER_STYLE: TextLayerStyle = {
  color: "#ffffff",
  fontFamily: "Arial",
  fontSize: 32,
  fontWeight: 800,
  textAlign: "center",
  lineHeight: 1.08,
  dropShadow: true,
};

export function getTextLayerStyle(layer: TextLayer): TextLayerStyle {
  return { ...DEFAULT_TEXT_LAYER_STYLE, ...layer.style };
}

export function createCaptionLayer(
  position?: Partial<Pick<LayerTransform, "x" | "y">>,
  duration = 0
): TextLayer {
  return {
    id: CAPTION_LAYER_ID,
    name: "Captions",
    type: "text",
    source: "caption",
    text: "",
    style: DEFAULT_TEXT_LAYER_STYLE,
    transform: { ...DEFAULT_CAPTION_TRANSFORM, ...position },
    start: 0,
    end: duration,
  };
}

export function layerTiming(layer: EditorLayer, duration: number) {
  const start = clamp(layer.start ?? 0, 0, duration);
  const end = clamp(layer.end ?? duration, start, duration);
  return { start, end };
}

export function withLayerTiming(layer: EditorLayer, duration: number): EditorLayer {
  const { start, end } = layerTiming(layer, duration);
  return { ...layer, start, end };
}

export function clampLayerTransform(
  transform: Partial<LayerTransform>,
  base: LayerTransform
): LayerTransform {
  const width = clamp(transform.width ?? base.width, 5, 100);
  const height = clamp(transform.height ?? base.height, 5, 100);
  return {
    x: clamp(transform.x ?? base.x, width / 2, 100 - width / 2),
    y: clamp(transform.y ?? base.y, height / 2, 100 - height / 2),
    width,
    height,
  };
}

export function moveLayer(
  layers: EditorLayer[],
  id: string,
  destinationIndex: number
): EditorLayer[] {
  const index = layers.findIndex((layer) => layer.id === id);
  if (index < 0) return layers;
  const next = [...layers];
  const [layer] = next.splice(index, 1);
  next.splice(clamp(destinationIndex, 0, next.length), 0, layer);
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
