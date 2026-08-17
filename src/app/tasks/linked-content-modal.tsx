"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/app/projects/[projectId]/modal";
import { PostEditor } from "@/app/projects/[projectId]/posts/[postId]/post-editor";
import { StoryEditor } from "@/app/projects/[projectId]/stories/[storyId]/story-editor";
import { fetchPostForModal } from "@/lib/actions/posts";
import { fetchStoryForModal } from "@/lib/actions/stories";
import type { PostPageData } from "@/lib/data/posts";
import type { StoryPageData } from "@/lib/data/stories";

export type LinkedContentTarget = { projectId: string; type: "post" | "story"; id: string };

type LoadResult = { kind: "post"; data: PostPageData } | { kind: "story"; data: StoryPageData } | { kind: "missing" };

// The Tasks page's own equivalent of the Grid/Calendar intercepted-route
// modal (@modal/(.)posts, @modal/(.)stories) -- those only activate for a
// soft navigation already inside /projects/[projectId]/..., which /tasks
// deliberately sits outside of. Fetches the same data those routes'
// getPostPageData/getStoryPageData calls do, just through a plain server
// action triggered by a click instead of a URL match.
export function LinkedContentModal({ target, onClose }: { target: LinkedContentTarget; onClose: () => void }) {
  // Reset (to re-trigger the fetch effect below) the moment a genuinely new
  // target comes in -- same "adjust state during render" pattern already
  // used elsewhere in this codebase, rather than resetting via setState
  // calls at the top of the effect itself.
  const [prevTarget, setPrevTarget] = useState(target);
  const [result, setResult] = useState<LoadResult | null>(null);
  if (target !== prevTarget) {
    setPrevTarget(target);
    setResult(null);
  }

  useEffect(() => {
    if (result !== null) return;
    let cancelled = false;
    const load =
      target.type === "post"
        ? fetchPostForModal(target.projectId, target.id).then(
            (data): LoadResult => (data ? { kind: "post", data } : { kind: "missing" }),
          )
        : fetchStoryForModal(target.projectId, target.id).then(
            (data): LoadResult => (data ? { kind: "story", data } : { kind: "missing" }),
          );
    load.then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [target, result]);

  return (
    <Modal onClose={onClose}>
      {result === null && <p className="text-sm text-muted">Loading…</p>}
      {result?.kind === "missing" && <p className="text-sm text-muted">This content couldn&apos;t be found.</p>}
      {result?.kind === "post" && (
        <PostEditor
          projectId={target.projectId}
          post={result.data.post}
          assets={result.data.assets}
          links={result.data.links}
          mediaLibrary={result.data.mediaLibrary}
          canManage={result.data.canManage}
          currentUserId={result.data.currentUserId}
          members={result.data.members}
          customFonts={result.data.customFonts}
          hideBackLink
        />
      )}
      {result?.kind === "story" && (
        <StoryEditor
          projectId={target.projectId}
          story={result.data.story}
          frames={result.data.frames}
          links={result.data.links}
          mediaLibrary={result.data.mediaLibrary}
          canManage={result.data.canManage}
          currentUserId={result.data.currentUserId}
          members={result.data.members}
          hideBackLink
        />
      )}
    </Modal>
  );
}
