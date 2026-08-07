// Plain helper, deliberately NOT in task-automation.ts -- that file is
// "use server", and Next.js requires every export from a "use server" file
// to be an async Server Action, which this isn't.

// Posts have no "name" field to build a task title from -- falls back to
// the post_type + date when there's no caption yet to summarize.
export function deriveAutoTaskTitle(caption: string, postType: string, date: string): string {
  const trimmed = caption.trim();
  if (trimmed) {
    const snippet = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
    return `Publish: ${snippet}`;
  }
  return `Publish: ${postType} — ${date}`;
}
