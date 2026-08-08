"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LandingMedia } from "../landing-media";
import { DEMO_ASSET_FOLDERS, EASE } from "@/lib/landing";

export function DemoLiveSearch() {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DEMO_ASSET_FOLDERS;
    return DEMO_ASSET_FOLDERS.filter((f) => f.keywords.some((k) => k.includes(q)) || f.name.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-xs tracking-wide text-muted uppercase">Search the library</p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Try “video” or “product”"
        className="w-full max-w-xs rounded-full border border-border px-4 py-2 text-sm focus:border-foreground focus:outline-none"
      />
      <div className="grid w-full max-w-xs grid-cols-2 gap-3">
        <AnimatePresence mode="popLayout">
          {results.map((folder) => (
            <motion.div
              key={folder.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="aspect-[4/5] overflow-hidden rounded-md border border-border"
            >
              {folder.cover && <LandingMedia media={folder.cover} className="aspect-[4/5]" />}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
