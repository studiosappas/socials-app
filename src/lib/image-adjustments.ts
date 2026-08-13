import * as fabric from "fabric";

// Fabric picks WebGL vs Canvas2D filtering globally for the whole page, not
// per-canvas (see setFilterBackend/getFilterBackend in fabric's own
// FilterBackend.ts) -- this app only ever uses Fabric in AnnotationEditor,
// so forcing pure Canvas2D once here is safe and means the one genuinely new
// filter below (ShadowsHighlights) only needs a 2D pixel-loop
// implementation, no GLSL shader.
fabric.setFilterBackend(new fabric.Canvas2dFilterBackend());

export type AdjustmentValues = {
  brightness: number;
  contrast: number;
  saturation: number;
  vibrance: number;
  shadows: number;
  highlights: number;
  exposure: number;
  warmth: number;
  hue: number;
};

export const NEUTRAL_ADJUSTMENTS: AdjustmentValues = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  shadows: 0,
  highlights: 0,
  exposure: 0,
  warmth: 0,
  hue: 0,
};

// How far Warmth pushes the red/blue channels apart at its max value -- a
// fraction of 255, same unit ColorMatrix's own offset positions (4/9/14/19)
// already use (see applyTo2d below and fabric's own ColorMatrix.ts).
const WARMTH_STRENGTH = 0.15;
// How strongly Shadows/Highlights can lift or crush their respective
// luminance range, in raw 0-255 units -- kept modest (vs. Brightness' full
// +/-255 range) since only part of the tonal range is affected per pixel.
const SHADOWS_HIGHLIGHTS_STRENGTH = 80;

type ShadowsHighlightsOwnProps = { shadows: number; highlights: number };

const shadowsHighlightsDefaults: ShadowsHighlightsOwnProps = { shadows: 0, highlights: 0 };

// No built-in Fabric filter does a luminance-dependent tone split (every
// built-in is a flat per-pixel formula) -- this applies a simple weighted
// brighten/darken: pixels below mid-gray move by `shadows`, pixels above by
// `highlights`, fading to no effect at the midpoint, the same one-slider-per-
// tonal-range approximation Canva-style simple editors use (not a full
// Lightroom-grade tone curve).
class ShadowsHighlightsFilter extends fabric.filters.BaseFilter<
  "ShadowsHighlights",
  ShadowsHighlightsOwnProps
> {
  declare shadows: number;
  declare highlights: number;

  static type = "ShadowsHighlights" as const;
  static defaults = shadowsHighlightsDefaults;

  isNeutralState() {
    return this.shadows === 0 && this.highlights === 0;
  }

  applyTo2d({ imageData: { data } }: { imageData: ImageData }) {
    const { shadows, highlights } = this;
    if (shadows === 0 && highlights === 0) return;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const shadowWeight = lum < 128 ? 1 - lum / 128 : 0;
      const highlightWeight = lum > 128 ? (lum - 128) / 127 : 0;
      const delta = shadows * shadowWeight * SHADOWS_HIGHLIGHTS_STRENGTH + highlights * highlightWeight * SHADOWS_HIGHLIGHTS_STRENGTH;
      if (delta === 0) continue;
      data[i] += delta;
      data[i + 1] += delta;
      data[i + 2] += delta;
    }
  }
}
fabric.classRegistry.setClass(ShadowsHighlightsFilter);

function identityColorMatrix(): number[] {
  return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
}

// Builds a fresh filter array from UI-range values, omitting any filter
// whose value is neutral -- an untouched image round-trips through
// toObject()/toJSON() with an empty filters array, same as today.
export function buildFilters(values: AdjustmentValues): fabric.filters.BaseFilter<string>[] {
  const list: fabric.filters.BaseFilter<string>[] = [];

  if (values.brightness !== 0) {
    list.push(new fabric.filters.Brightness({ brightness: values.brightness / 100 }));
  }
  if (values.contrast !== 0) {
    list.push(new fabric.filters.Contrast({ contrast: values.contrast / 100 }));
  }
  if (values.saturation !== 0) {
    list.push(new fabric.filters.Saturation({ saturation: values.saturation / 100 }));
  }
  if (values.vibrance !== 0) {
    list.push(new fabric.filters.Vibrance({ vibrance: values.vibrance / 100 }));
  }
  if (values.exposure !== 0) {
    // Multiplicative (gamma) brighten/darken, distinct from the additive
    // Brightness filter above -- fabric's Gamma range is 0.01-2.2 per channel.
    const gamma = Math.min(2.2, Math.max(0.01, Math.pow(2, values.exposure / 100)));
    list.push(new fabric.filters.Gamma({ gamma: [gamma, gamma, gamma] }));
  }
  if (values.warmth !== 0) {
    const k = (values.warmth / 100) * WARMTH_STRENGTH;
    const matrix = identityColorMatrix();
    matrix[4] = k; // red channel offset
    matrix[14] = -k; // blue channel offset
    list.push(new fabric.filters.ColorMatrix({ matrix: matrix as fabric.filters.ColorMatrix["matrix"] }));
  }
  if (values.hue !== 0) {
    list.push(new fabric.filters.HueRotation({ rotation: values.hue / 180 }));
  }
  if (values.shadows !== 0 || values.highlights !== 0) {
    list.push(
      new ShadowsHighlightsFilter({ shadows: values.shadows / 100, highlights: values.highlights / 100 }),
    );
  }

  return list;
}

// The inverse of buildFilters -- recovers UI-range values from whatever
// filters are actually on the image (defaulting to neutral for any filter
// not present), so reopening an already-adjusted image (or undoing past an
// adjustment change) shows sliders that match the canvas's real state.
export function readAdjustments(image: fabric.FabricImage): AdjustmentValues {
  const values = { ...NEUTRAL_ADJUSTMENTS };
  for (const filter of image.filters ?? []) {
    if (!filter) continue;
    switch (filter.type) {
      case "Brightness":
        values.brightness = Math.round((filter as fabric.filters.Brightness).brightness * 100);
        break;
      case "Contrast":
        values.contrast = Math.round((filter as fabric.filters.Contrast).contrast * 100);
        break;
      case "Saturation":
        values.saturation = Math.round((filter as fabric.filters.Saturation).saturation * 100);
        break;
      case "Vibrance":
        values.vibrance = Math.round((filter as fabric.filters.Vibrance).vibrance * 100);
        break;
      case "Gamma": {
        const gamma = (filter as fabric.filters.Gamma).gamma[0];
        values.exposure = Math.round(Math.log2(gamma) * 100);
        break;
      }
      case "ColorMatrix": {
        const k = (filter as fabric.filters.ColorMatrix).matrix[4];
        values.warmth = Math.round((k / WARMTH_STRENGTH) * 100);
        break;
      }
      case "HueRotation":
        values.hue = Math.round((filter as fabric.filters.HueRotation).rotation * 180);
        break;
      case "ShadowsHighlights": {
        const f = filter as ShadowsHighlightsFilter;
        values.shadows = Math.round(f.shadows * 100);
        values.highlights = Math.round(f.highlights * 100);
        break;
      }
      default:
        break;
    }
  }
  return values;
}

export function applyAdjustments(image: fabric.FabricImage, values: AdjustmentValues) {
  image.filters = buildFilters(values);
  image.applyFilters();
}
