"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { MentionField } from "@/components/ui/mention-input";
import type { ItemCommentItem, ProjectMemberOption } from "@/lib/data/post-comments";

// Internal team comment thread -- same list+form shape as task-detail.tsx's
// comments, reused here for posts/stories (see post-comments.ts). Kept
// generic over fetch/add so both post and story editors can bind their own
// server actions (which need projectId) without duplicating this component.
export function ItemComments({
  itemId,
  currentUserId,
  members,
  fetchComments,
  addComment,
}: {
  itemId: string;
  currentUserId: string;
  members: ProjectMemberOption[];
  fetchComments: (itemId: string) => Promise<ItemCommentItem[]>;
  addComment: (itemId: string, text: string) => Promise<{ success: boolean; message?: string }>;
}) {
  const [comments, setComments] = useState<ItemCommentItem[] | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchComments(itemId).then((c) => {
      if (!cancelled) setComments(c);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    // Append instantly -- no separate save step, matching TaskDetail's comments.
    const optimistic: ItemCommentItem = {
      id: `optimistic-${Date.now()}`,
      itemId,
      authorId: currentUserId,
      authorName: "You",
      authorAvatarUrl: null,
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => [...(prev ?? []), optimistic]);
    setText("");
    const result = await addComment(itemId, trimmed);
    if (result.success) fetchComments(itemId).then(setComments);
    setPosting(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs tracking-wide text-muted uppercase">Comments</h3>
      <div className="flex flex-col gap-2">
        {(comments ?? []).map((c) => (
          <div key={c.id} className="flex items-start gap-2 text-sm">
            <Avatar name={c.authorName} avatarUrl={c.authorAvatarUrl} />
            <div className="min-w-0">
              <span className="mr-1.5 text-xs font-semibold">{c.authorName}</span>
              <span className="text-muted">{c.text}</span>
            </div>
          </div>
        ))}
        {comments !== null && comments.length === 0 && <p className="text-xs text-muted">No comments yet.</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border pt-2">
        <MentionField
          value={text}
          onChange={setText}
          members={members}
          placeholder="Write a comment — @ to mention"
          className="w-full border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || posting}
          className="shrink-0 text-xs tracking-wide text-muted uppercase transition-colors duration-150 hover:text-foreground disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
