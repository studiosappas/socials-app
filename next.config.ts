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
    // src/proxy.ts runs on nearly every request (its matcher only excludes
    // static assets). Next.js buffers each request body in memory for the
    // proxy independently of serverActions.bodySizeLimit above, and its own
    // default is a much lower 10MB -- silently truncating any larger body
    // *before* the Server Action ever sees it, which surfaces downstream as
    // a multipart parse failure ("Unexpected end of form") rather than a
    // clean size-limit error. Must stay >= bodySizeLimit or that limit is
    // dead code.
    proxyClientMaxBodySize: "20mb",
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
