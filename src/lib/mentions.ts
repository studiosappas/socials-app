export type MentionableMember = { id: string; name: string; avatarUrl?: string | null };

// Longest-name-first so e.g. "@Jo" can't shadow-match inside "@John" when
// both are project members -- the autocomplete (mention-input.tsx) always
// inserts a member's full exact name, so this is a reliable exact-substring
// check, not fuzzy matching.
export function parseMentions(text: string, members: MentionableMember[]): string[] {
  const lower = text.toLowerCase();
  const sorted = [...members].filter((m) => m.name.trim()).sort((a, b) => b.name.length - a.name.length);
  const matched = new Set<string>();
  for (const member of sorted) {
    if (lower.includes(`@${member.name.toLowerCase()}`)) matched.add(member.id);
  }
  return Array.from(matched);
}
