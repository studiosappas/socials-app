import type { DemoAssetFolder, MediaRef } from "./types";

export const DEMO_ASSET_FOLDERS: DemoAssetFolder[] = [
  {
    id: "f1",
    name: "Product Shots — Studio",
    typeLabel: "Photography",
    cover: { src: "assets/folder-1.jpg", alt: "Studio product photography", aspect: "4/5" },
    keywords: ["product", "studio", "photography", "shots"],
    aiStatusLabel: "Indexed",
  },
  {
    id: "f2",
    name: "Founder Interviews",
    typeLabel: "Video",
    cover: { src: "assets/folder-2.jpg", alt: "Founder interview footage", aspect: "4/5" },
    keywords: ["video", "founder", "interview", "b-roll"],
    aiStatusLabel: "Indexed",
  },
  {
    id: "f3",
    name: "Logos & Marks",
    typeLabel: "Brand Files",
    cover: { src: "assets/folder-3.jpg", alt: "Logo and brand mark files", aspect: "4/5" },
    keywords: ["logo", "brand", "marks", "icons"],
    aiStatusLabel: "Indexed",
  },
  {
    id: "f4",
    name: "Customer UGC",
    typeLabel: "Photography",
    cover: { src: "assets/folder-4.jpg", alt: "Customer submitted photography", aspect: "4/5" },
    keywords: ["ugc", "customer", "photography", "community"],
    aiStatusLabel: "Indexing",
  },
];

// Fixed match result set shown after the scripted packshot-search demo (see
// stage-01-find.tsx) -- a tag/keyword match, not real vision matching, since
// the real Assets page's own image search is presently an honest stub (it
// tells users "Visual search isn't available yet").
export const DEMO_IMAGE_SEARCH_RESULT_IDS = ["f1", "f4"];

export const DEMO_PACKSHOT: MediaRef = {
  src: "assets/packshot.jpg",
  alt: "Product packshot",
  aspect: "1/1",
};
