// Real-browser regression check for the Grid crop renderers' CSS contract --
// the landscape "image shrinks when dragged horizontally" bug was a CSS
// clamp (Tailwind preflight's `img { max-width: 100% }`), not a math error,
// so pure-geometry tests (src/lib/crop-geometry.test.ts) could never catch
// it. This lays out the exact DOM shape GridCropOverlay and
// CroppedCoverImage render (frame -> overflow-hidden clip -> absolutely
// positioned <img> at base-cover size + transform) under the REAL
// preflight stylesheet from node_modules, using the REAL UNCLAMPED_IMG_SIZE
// and crop-geometry helpers, and measures what Chromium actually paints.
//
//   node "src/app/projects/[projectId]/grid/grid-crop-render.check.mjs"
//
// Requires Playwright's Chromium (npx playwright install chromium).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { UNCLAMPED_IMG_SIZE } from "./grid-constants.ts";
import { clampOffsetPx, coverBaseScale, coverageSlackPx } from "../../../../lib/crop-geometry.ts";

const preflight = readFileSync(new URL("../../../../../node_modules/tailwindcss/preflight.css", import.meta.url), "utf8");
const unclampedCss = `max-width:${UNCLAMPED_IMG_SIZE.maxWidth};max-height:${UNCLAMPED_IMG_SIZE.maxHeight};`;
const FRAME = { w: 150, h: 200 }; // 3:4 Grid cover
const FRAME_LEFT = 300;
const FRAME_TOP = 100;
const TOL = 0.5; // sub-pixel layout snapping

function page(natural, zoom, offsetPx, withFix) {
  const base = coverBaseScale(FRAME.w, FRAME.h, natural.w, natural.h);
  const imgW = natural.w * base;
  const imgH = natural.h * base;
  const svg = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${natural.w}' height='${natural.h}'><rect width='100%' height='100%' fill='red'/></svg>`,
  )}`;
  return `<!doctype html><style>${preflight}</style>
<div style="position:absolute;left:${FRAME_LEFT}px;top:${FRAME_TOP}px;width:${FRAME.w}px;height:${FRAME.h}px">
  <div style="position:absolute;inset:0;overflow:hidden">
    <img id="i" src="${svg}" style="position:absolute;top:50%;left:50%;width:${imgW}px;height:${imgH}px;${withFix ? unclampedCss : ""}transform:translate(-50%,-50%) translate(${offsetPx.x}px,${offsetPx.y}px) rotate(0deg) scale(${zoom})">
  </div>
</div>`;
}

function extremes(natural, zoom) {
  const base = coverBaseScale(FRAME.w, FRAME.h, natural.w, natural.h);
  const imgW = natural.w * base;
  const imgH = natural.h * base;
  const { slackX, slackY } = coverageSlackPx(0, (imgW * zoom) / 2, (imgH * zoom) / 2, FRAME.w / 2, FRAME.h / 2);
  // Simulated "drag all the way" in each direction, clamped exactly like the editor.
  return [
    { x: 0, y: 0 },
    clampOffsetPx({ x: -1e5, y: 0 }, 0, slackX, slackY),
    clampOffsetPx({ x: 1e5, y: 0 }, 0, slackX, slackY),
    clampOffsetPx({ x: 0, y: -1e5 }, 0, slackX, slackY),
    clampOffsetPx({ x: 0, y: 1e5 }, 0, slackX, slackY),
  ];
}

async function measure(browserPage, html) {
  await browserPage.setContent(html);
  await browserPage.waitForFunction(() => document.getElementById("i").complete);
  return browserPage.$eval("#i", (el) => {
    const b = el.getBoundingClientRect();
    return { w: b.width, h: b.height, left: b.left, right: b.right, top: b.top, bottom: b.bottom };
  });
}

const browser = await chromium.launch();
let passed = 0;
try {
  const p = await browser.newPage();
  const sources = {
    "landscape 16:9": { w: 1600, h: 900 },
    "portrait 9:16": { w: 900, h: 1600 },
    square: { w: 1000, h: 1000 },
  };
  for (const [name, natural] of Object.entries(sources)) {
    for (const zoom of [1, 1.5]) {
      for (const off of extremes(natural, zoom)) {
        const r = await measure(p, page(natural, zoom, off, true));
        const aspect = r.w / r.h;
        assert.ok(Math.abs(aspect - natural.w / natural.h) < 0.01, `${name} z${zoom}: aspect ${aspect} != source`);
        assert.ok(
          r.left <= FRAME_LEFT + TOL &&
            r.right >= FRAME_LEFT + FRAME.w - TOL &&
            r.top <= FRAME_TOP + TOL &&
            r.bottom >= FRAME_TOP + FRAME.h - TOL,
          `${name} z${zoom} offset(${off.x.toFixed(1)},${off.y.toFixed(1)}): frame not covered ${JSON.stringify(r)}`,
        );
        passed++;
      }
    }
    console.log(`ok - ${name}: aspect preserved + frame covered at center and every pan extreme, zoom 1 and 1.5`);
  }

  // Guard that this check actually detects the bug: WITHOUT the fix, the
  // landscape source must render squashed to the frame's width.
  const squashed = await measure(p, page(sources["landscape 16:9"], 1, { x: 0, y: 0 }, false));
  assert.ok(Math.abs(squashed.w - FRAME.w) < TOL, "expected preflight to clamp the unfixed landscape image");
  console.log(`ok - control: without UNCLAMPED_IMG_SIZE the landscape image is squashed to ${squashed.w.toFixed(1)}x${squashed.h.toFixed(1)}`);
  passed++;
} finally {
  await browser.close();
}
console.log(`\n${passed} checks passed`);
