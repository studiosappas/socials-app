// Client PDF thumbnail sizing -- pure, so client-pdf-layout.test.ts runs
// under Node.
//
// Every post's row has the same IDEAL height (a legacy 3:4 thumb's: 90 x 120
// pt); a post with a chosen ratio gets that height at its own ratio (16:9 ->
// 213 x 120, 9:16 -> 67.5 x 120). A row that wouldn't fit across the content
// width (a long or wide carousel) shrinks uniformly, keeping the ratio, so
// nothing overlaps, clips or stretches. A legacy post (aspect = 3:4) gets
// exactly the old 90 x 120 thumbs.
export function clientPdfThumbSize(
  count: number,
  aspect: number,
  contentW: number,
  gap: number,
  idealH: number,
): { w: number; h: number } {
  const n = Math.max(count, 1);
  let w = idealH * aspect;
  if (n * w + (n - 1) * gap > contentW) w = (contentW - (n - 1) * gap) / n;
  return { w, h: w / aspect };
}
