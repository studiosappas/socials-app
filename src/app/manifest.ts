import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Flow:er",
    short_name: "Flow:er",
    description: "Internal content planning tool for feed grids, calendars, stories, and design tasks.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#171412",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
