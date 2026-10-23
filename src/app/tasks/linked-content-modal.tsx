"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/app/projects/[projectId]/modal";
import { PostEditor } from "@/app/projects/[projectId]/posts/[postId]/post-editor";
import { StoryEditor } from "@/app/projects/[projectId]/stories/[storyId]/story-editor";
import { fetchPostForModal, type PostForModalData } from "@/lib/actions/posts";
import { fetchStoryForModal } from "@/lib/actions/stories";
import type { StoryPageData } from "@/lib/data/stories";

export type LinkedContentTarget = { projectId: string; type: "post" | "story"; id: string };

type LoadResult =
  | { kind: "post"; data: PostForModalData }
  | { kind: "story"; data: StoryPageData }
  | { kind: "missing" };

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

  // ONE promise per loaded result, not a fresh Promise.resolve() per render:
  // PostEditor's library section reads it through use(), and a new, untracked
  // promise on every re-render made it suspend again each time -- briefly
  // hiding the picker and resetting its scroll position, which the
  // scroll-driven paging depends on.
  const mediaLibraryPromise = useMemo(
    () => (result?.kind === "post" ? Promise.resolve(result.data.mediaLibrary) : null),
    [result],
  );

  return (
    <Modal onClose={onClose}>
      {result === null && <p className="text-sm text-muted">Loading…</p>}
      {result?.kind === "missing" && <p className="text-sm text-muted">This content couldn&apos;t be found.</p>}
      {result?.kind === "post" && mediaLibraryPromise && (
        <PostEditor
          projectId={target.projectId}
          post={result.data.post}
          assets={result.data.assets}
          links={result.data.links}
          // Already fully resolved by the time `result` is set (see
          // fetchPostForModal's own comment on why this entry point can't
          // stream it in separately) -- wrapped in Promise.resolve() just
          // to satisfy PostEditor's prop type, not to defer anything.
          mediaLibraryPromise={mediaLibraryPromise}
          canManage={result.data.canManage}
          role={result.data.role}
          currentUserId={result.data.currentUserId}
          members={result.data.members}
          customFonts={result.data.customFonts}
          dateFormat={result.data.dateFormat}
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
          role={result.data.role}
          currentUserId={result.data.currentUserId}
          members={result.data.members}
          dateFormat={result.data.dateFormat}
          hideBackLink
        />
      )}
    </Modal>
  );
}
