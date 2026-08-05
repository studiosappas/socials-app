import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default is 1MB, which silently rejects most real-world uploads (brand
    // PDFs, decks, images, short video clips) across every upload flow in
    // the app -- Grid media, avatars, and Brand Knowledge documents all go
    // through Server Actions.
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
