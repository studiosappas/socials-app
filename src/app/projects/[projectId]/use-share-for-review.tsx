"use client";

import { useCallback, useRef, useState } from "react";
import { createShareLink, type CreateShareLinkState } from "@/lib/actions/share-links";
import { SHARE_LINK_MESSAGES, copyTextToClipboard, createSingleFlight, reviewLinkUrl } from "@/lib/review-link";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CopyableLinkField } from "./share-menu";

type CreateAction = (projectId: string, state: CreateShareLinkState, formData: FormData) => Promise<CreateShareLinkState>;

// The one Share for Review "confirm" flow, shared by Grid (posts) and
// Content (stories) -- both boards used to carry their own copy of it.
//
// The rules it exists to guarantee:
//   - One click, one link. Overlapping calls are dropped (single-flight) and
//     the confirm button is disabled while a request is pending.
//   - Creating the link and copying it are separate outcomes. Once the
//     server says the link exists, the flow is DONE: selection mode exits
//     (onCreated) before the copy is even attempted, so no copy failure can
//     ever lead to a second link being created for the same selection.
//   - A failed copy is not an error. Safari rejects a clipboard write that
//     no longer counts as part of the click (true after any awaited
//     request), permissions can be denied, the API can be missing -- in all
//     of those the link is shown in a selectable field instead.
//   - Errors are readable. The server action already maps database errors
//     to friendly text; a thrown/network failure gets a generic one.
export function useShareForReview({
  projectId,
  field,
  onCreated,
  create = createShareLink,
}: {
  projectId: string;
  // Which FormData key the selected ids go under.
  field: "post_ids" | "story_ids";
  // Called once the link exists server-side -- exit selection mode, refresh.
  onCreated: () => void;
  // Injectable for the browser regression check; always the real server
  // action in the app.
  create?: CreateAction;
}) {
  const [sharing, setSharing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Set only when the link was created but could not be copied automatically.
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const flight = useRef(createSingleFlight());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, ms: number) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMessage(message);
    toastTimer.current = setTimeout(() => setToastMessage(null), ms);
  }, []);

  const share = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      void flight.current.run(async () => {
        setSharing(true);
        try {
          const formData = new FormData();
          for (const id of ids) formData.append(field, id);
          let result: CreateShareLinkState;
          try {
            result = await create(projectId, undefined, formData);
          } catch {
            result = { message: SHARE_LINK_MESSAGES.createFailed };
          }
          if (!result?.success || !result.token) {
            showToast(result?.message ?? SHARE_LINK_MESSAGES.createFailed, 5000);
            return;
          }
          const url = reviewLinkUrl(window.location.origin, result.token);
          // The link exists now, whatever happens to the copy below.
          onCreated();
          if (await copyTextToClipboard(url)) showToast("Review link copied to clipboard", 2500);
          else setCreatedUrl(url);
        } finally {
          setSharing(false);
        }
      });
    },
    [create, field, onCreated, projectId, showToast],
  );

  const createdLinkDialog = (
    <Dialog open={createdUrl !== null} onClose={() => setCreatedUrl(null)} title="Review link created" radius="none">
      {createdUrl && (
        <div className="flex flex-col gap-4" data-review-link-created="">
          <p className="text-sm text-muted">
            Your review link is ready. It couldn&apos;t be copied automatically in this browser — copy it from here.
          </p>
          <CopyableLinkField url={createdUrl} />
          <div className="flex items-center justify-between gap-3">
            <a
              href={createdUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
            >
              Open link
            </a>
            <Button type="button" variant="primary" radius="none" onClick={() => setCreatedUrl(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );

  return { sharing, share, toastMessage, createdLinkDialog };
}
