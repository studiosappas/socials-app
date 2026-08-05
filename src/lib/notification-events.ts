// Deliberately its own plain module, not exported from actions/settings.ts --
// a "use server" file can only export async functions (server actions);
// Next.js silently mangles a plain data export like this one when a client
// component imports it from a "use server" file (NOTIFICATION_EVENTS.map is
// not a function at runtime, no build-time error). Shared as-is by both the
// server action (updateNotificationPrefs, reading the same keys back out of
// the submitted form) and the client panel (rendering one checkbox per event).
export const NOTIFICATION_EVENTS: { key: string; label: string }[] = [
  { key: "approval_requested", label: "Someone requests approval" },
  { key: "brand_knowledge_uploaded", label: "Someone uploads Brand Knowledge" },
  { key: "member_joined", label: "Someone joins the project" },
  { key: "ai_analysis_complete", label: "AI finishes analyzing new files" },
  { key: "brief_updated", label: "Brief is updated" },
  { key: "brief_comment", label: "New comment in Brief" },
  { key: "new_uploaded_assets", label: "Someone uploads new assets" },
];
