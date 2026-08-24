"use client";

import { useEffect } from "react";
import { markProjectVisited } from "@/lib/actions/projects";

// Fires once per genuine "entered this project" event -- this component is
// part of the [projectId] layout tree, which Next.js keeps mounted across
// sibling-page navigation (Grid -> Calendar -> Tasks, etc.) within the same
// project, so this effect only re-runs when projectId itself changes, never
// on every render/click/route inside an already-open project.
export function TrackProjectVisit({ projectId }: { projectId: string }) {
  useEffect(() => {
    markProjectVisited(projectId);
  }, [projectId]);
  return null;
}
