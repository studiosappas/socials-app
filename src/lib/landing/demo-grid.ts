import type { DemoGridSlot } from "./types";

// Used by the hero preview's "Plan faster" screen and Section 03's real
// drag-and-drop demo. Six slots -- Section 03's mobile layout trims to the
// first four (see section-03-demo-grid.tsx).
export const DEMO_GRID_SLOTS: DemoGridSlot[] = [
  { id: "slot-1", image: { src: "grid/slot-1.jpg", alt: "Feed post 1", aspect: "4/5" }, caption: "Launch teaser" },
  { id: "slot-2", image: { src: "grid/slot-2.jpg", alt: "Feed post 2", aspect: "4/5" }, caption: "Behind the scenes" },
  { id: "slot-3", image: { src: "grid/slot-3.jpg", alt: "Feed post 3", aspect: "4/5" }, caption: "Product detail" },
  { id: "slot-4", image: { src: "grid/slot-4.jpg", alt: "Feed post 4", aspect: "4/5" }, caption: "Customer feature" },
  { id: "slot-5", image: { src: "grid/slot-5.jpg", alt: "Feed post 5", aspect: "4/5" }, caption: "Quote card" },
  { id: "slot-6", image: { src: "grid/slot-6.jpg", alt: "Feed post 6", aspect: "4/5" }, caption: "Weekly recap" },
];
