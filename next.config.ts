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
    // Explicit, even though 0 is the documented default for `dynamic`: a
    // phantom render of /projects/[projectId]/layout.tsx (observed with the
    // literal, invalid "todo" as its own projectId -- likely Next's dev
    // tooling probing the sibling static /projects/todo route) was
    // corrupting that SHARED layout's client-cache slot, which every OTHER
    // /projects/[projectId]/... page then reused instead of re-rendering,
    // per Next's own partial-rendering behavior ("shared layouts won't
    // automatically be refetched on every navigation"). Forcing 0 here
    // removes any doubt that something upstream (env, a past Next version)
    // left a non-zero value in effect.
    staleTimes: {
      dynamic: 0,
    },
  },
};

export default nextConfig;
