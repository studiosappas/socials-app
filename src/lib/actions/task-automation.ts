"use server";

import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// The generic, pluggable auto-task engine the brief asks for: every
// automatic task source gets one `ensureAutoTaskFor*` (create-or-refresh)
// function here, keyed by `source_type`. Adding a new auto-source later
// (e.g. "write captions") means one more function in this file, not a
// change to the todo page or its data layer.

export async function ensureAutoTaskForPost(
  supabase: SupabaseClient,
  projectId: string,
  postId: string,
  opts: { title: string; dueDate: string },
): Promise<void> {
  const { data: existing } = await supabase
    .from("tasks")
    .select("id")
    .eq("source_type", "post")
    .eq("source_id", postId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("tasks")
      .update({ title: opts.title, due_date: opts.dueDate, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("tasks").insert({
    user_id: user.id,
    project_id: projectId,
    title: opts.title,
    due_date: opts.dueDate,
    status: "todo",
    source_type: "post",
    source_id: postId,
  });
}

// Auto-completion is deliberately NOT tied to the post actually going live
// on Instagram (this app has no way to observe that) -- it fires on an
// in-app-observable signal instead: the post's own `status` field reaching
// "published", which the team sets themselves in the post editor. Manual
// override (marking done earlier, or reopening afterward) always stays
// available since this only ever pushes a task toward "done," never locks it.
export async function completeAutoTaskForPost(supabase: SupabaseClient, postId: string): Promise<void> {
  await supabase
    .from("tasks")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("source_type", "post")
    .eq("source_id", postId)
    .neq("status", "done");
}
