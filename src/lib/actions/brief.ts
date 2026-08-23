"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrl } from "@/lib/signed-url-cache";
import { generateWithImages } from "@/lib/ai/client";
import { parseDesignLayout, layoutToFabricJson } from "@/lib/ai/design-layout";
import { logActivity } from "@/lib/activity-log";
import { notifyProjectMembers } from "@/lib/notifications";
import { generateServerThumbnail } from "@/lib/server-thumbnail";
import type {
  BriefFrameSection,
  BriefItemKind,
  BriefItemSection,
  BriefTaskStatus,
  BriefTaskType,
  GeneratedDesignPostType,
} from "@/types/database";

const DEFAULT_FRAME_LABELS = ["Cover", "Body 1", "Body 2", "Closure"];

// ---------------------------------------------------------------------------
// Image/product naming.
//
// There is no reliable way to know a "product name" for an arbitrary pasted
// or uploaded image -- see insertBriefImageItem's own comment. What IS
// available and worth using well:
//   1. A page's own declared title (og:title/twitter:title/<title>) when an
//      image was added via the "Link" field and we had to scrape a webpage
//      for its primary image -- this is real metadata the SOURCE SITE chose
//      to publish, not a guess, and product pages commonly set it to the
//      actual product name.
//   2. A meaningful original filename (from a real upload, or the last path
//      segment of a direct image URL) -- turned into a human label instead
//      of shown as a raw slug.
//   3. A clean fallback ("Image") when neither exists -- never a generic
//      browser-assigned name like "image.png", "blob", or a UUID.
// ---------------------------------------------------------------------------

const KNOWN_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
  "bmp",
  "tiff",
  "tif",
  "svg",
  "avif",
]);

// Generic/camera/clipboard-style names carry no real information -- IMG_1234,
// image.png, blob, a bare UUID/hash. Prettifying one of these into "Img
// 1234" would LOOK like a real name without being one, which is exactly the
// "pretend an unreliable value is a product name" trap this feature has to
// avoid. Anything matching one of these is treated as NOT meaningful.
const GENERIC_NAME_PATTERNS = [
  /^img[-_]?\d*$/i,
  /^dsc[-_]?\d*$/i,
  /^image\d*$/i,
  /^photo\d*$/i,
  /^picture\d*$/i,
  /^screen[-_ ]?shot.*$/i,
  /^clipboard.*$/i,
  /^blob$/i,
  /^untitled.*$/i,
  /^file\d*$/i,
  /^download.*$/i,
  /^asset\d*$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^[0-9a-f]{16,}$/i, // long hex hash
];

function stripKnownImageExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return name;
  // Only strips a KNOWN image extension, never just "whatever's after the
  // last dot" -- a scraped page title like "Necklace by J.Crew" has a dot
  // too, and naively slicing at lastIndexOf(".") would mangle it.
  const ext = name.slice(dot + 1).toLowerCase();
  return KNOWN_IMAGE_EXTENSIONS.has(ext) ? name.slice(0, dot) : name;
}

function isMeaningfulName(baseName: string): boolean {
  const trimmed = baseName.trim();
  if (!trimmed) return false;
  return !GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// Turns "gold-pearl-necklace.jpg" into "Gold Pearl Necklace"; leaves a
// generic/camera/clipboard-style name alone and returns fallbackLabel
// instead. Safe to run on an already-clean scraped page title too (no
// extension to strip, already real words, so this is close to a no-op for
// that case) -- it's the one place every image-insertion path funnels its
// raw source name through, so the naming hierarchy only has to be right
// here, not duplicated per caller.
function prettifyLabel(rawName: string, fallbackLabel = "Image"): string {
  const withoutExt = stripKnownImageExtension(rawName);
  if (!isMeaningfulName(withoutExt)) return fallbackLabel;
  const spaced = withoutExt
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return fallbackLabel;
  return spaced
    .split(" ")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

// og:title/twitter:title first (a page's own declared social-share title --
// e-commerce product pages commonly set this to the actual product name),
// falling back to the plain <title> tag. Capped at a sane length since a
// page's <title> can be a long "Product Name | Category | Store Name |
// Free Shipping" string -- still better than nothing, but not allowed to
// balloon into something absurd as an item label.
function extractPageTitle(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const decoded = decodeHtmlEntities(match[1]).trim();
    if (decoded && decoded.length <= 120) return decoded;
  }
  return null;
}

const BRIEF_STATUS_LABEL: Record<BriefTaskStatus, string> = {
  draft: "Draft",
  internal_review: "Internal Review",
  ready_for_design: "Ready for Design",
};

type ActionResult = { success: boolean; message?: string };

export async function createBriefTask(
  projectId: string,
  position: number,
): Promise<ActionResult & { taskId?: string }> {
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from("brief_tasks")
    .insert({ project_id: projectId, name: `Task ${String(position + 1).padStart(2, "0")}`, position })
    .select("id")
    .single();

  if (error || !task) {
    return { success: false, message: error?.message ?? "Failed to create task." };
  }

  const frameRows = (["frames", "text"] as BriefFrameSection[]).flatMap((section) =>
    DEFAULT_FRAME_LABELS.map((label, i) => ({
      task_id: task.id,
      section,
      label,
      position: i,
    })),
  );
  const { error: frameError } = await supabase.from("brief_task_frames").insert(frameRows);
  if (frameError) {
    return { success: false, message: frameError.message };
  }

  // Not revalidating this action's own route -- its only caller
  // (brief-board.tsx's handleAddTask, and its undo/redo commands) already
  // calls router.refresh() itself right after, since there's no optimistic
  // insertion of a new task card yet.
  return { success: true, taskId: task.id };
}

export async function renameBriefTask(
  projectId: string,
  taskId: string,
  name: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("brief_tasks")
    .update({ name: name.trim() || "Task" })
    .eq("id", taskId);
  if (error) return { success: false, message: error.message };
  // Not revalidating -- the task name field is an uncontrolled input
  // (defaultValue) that already shows the typed text, and nothing else on
  // the page reads task.name, so there was nothing for a fresh render to
  // usefully bring back.
  return { success: true };
}

export async function setBriefTaskTypes(
  projectId: string,
  taskId: string,
  contentTypes: BriefTaskType[],
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_tasks").update({ content_types: contentTypes }).eq("id", taskId);
  if (error) return { success: false, message: error.message };
  // Not revalidating -- brief-board.tsx's Post Type pills already apply
  // this optimistically (optimisticType) before this call and roll back on
  // failure, so the UI is already showing the correct final state either way.
  return { success: true };
}

// Generic internal-review workflow (Draft -> Internal Review -> Ready for
// Design) -- not tied to any specific person or role. Gated the same way as
// every other Brief mutation: no manual role check here, RLS's owner/admin
// policy on brief_tasks already enforces it. logActivity/notifyProjectMembers
// are both best-effort/try-caught internally, so neither can fail this update.
export async function setBriefTaskStatus(
  projectId: string,
  taskId: string,
  taskName: string,
  status: BriefTaskStatus,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_tasks").update({ status }).eq("id", taskId);
  if (error) return { success: false, message: error.message };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const label = BRIEF_STATUS_LABEL[status];
    await logActivity(supabase, projectId, user.id, `moved "${taskName}" to ${label}`);
    await notifyProjectMembers(
      supabase,
      projectId,
      "brief_updated",
      {
        title: `${taskName} — ${label}`,
        description:
          status === "internal_review"
            ? "Sent for internal review."
            : status === "ready_for_design"
              ? "Ready for design."
              : "Reset to draft.",
        icon: status === "internal_review" ? "👀" : status === "ready_for_design" ? "✅" : "📝",
        link: `/projects/${projectId}/brief`,
      },
      { excludeUserId: user.id },
    );
  }

  // Not revalidating -- brief-board.tsx's Status pills already apply this
  // optimistically (optimisticStatus) before this call and roll back on
  // failure, same reasoning as setBriefTaskTypes above.
  return { success: true };
}

export async function deleteBriefTask(projectId: string, taskId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_tasks").delete().eq("id", taskId);
  if (error) return { success: false, message: error.message };
  // Not revalidating -- its one real caller (TaskCard's handleDelete)
  // already hides the card optimistically before this runs, and only
  // calls router.refresh() on failure to resync. The "Add task" undo
  // command still refreshes on its own since undo isn't optimistic here.
  return { success: true };
}

// Shared by every path that creates an "image" brief_task_item, once the
// bytes already live at `storagePath` in the brief-media bucket -- a real
// upload (addBriefTaskImage, direct browser-to-Storage, see below) and a
// pasted URL (addBriefTaskLink, createBriefImageItem's own server-side
// fetch-then-upload) end up with the exact same brief_attachments +
// brief_task_items rows, so they're indistinguishable afterward: same
// editable object, same "Edit Image" flow, no link-shaped item ever
// created for either path.
async function insertBriefImageItem(
  projectId: string,
  taskId: string,
  section: BriefItemSection,
  notes: string,
  position: number,
  storagePath: string,
  fileName: string,
): Promise<ActionResult & { itemId?: string; attachmentId?: string; label?: string }> {
  const supabase = await createClient();

  const { data: attachment, error: attachmentError } = await supabase
    .from("brief_attachments")
    .insert({ project_id: projectId, original_storage_path: storagePath })
    .select("id")
    .single();
  if (attachmentError || !attachment) {
    return { success: false, message: attachmentError?.message ?? "Failed to save attachment." };
  }

  // See the naming-hierarchy comment near DEFAULT_FRAME_LABELS -- fileName
  // here is whatever the caller had best available (a real upload's
  // File.name, a scraped page title, or a URL's last path segment), and
  // this is the one place that turns it into a clean, human item label
  // rather than showing a raw filename/slug/generic browser-assigned name.
  const label = prettifyLabel(fileName);

  const { data: item, error: itemError } = await supabase
    .from("brief_task_items")
    .insert({
      task_id: taskId,
      section,
      kind: "image",
      label,
      notes: notes.trim(),
      attachment_id: attachment.id,
      position,
    })
    .select("id")
    .single();
  if (itemError) return { success: false, message: itemError.message };

  // Not revalidating -- every caller chain (addBriefTaskImage,
  // addBriefTaskLink's image path) ends at a client handler that already
  // calls router.refresh() itself, since no optimistic item insertion
  // exists yet.
  return { success: true, itemId: item?.id, attachmentId: attachment.id, label };
}

// Only reached from addBriefTaskLink now -- fetching an arbitrary external
// URL happens server-side by necessity (there's no client File involved at
// all), so this is the one real upload path that's still an exception to
// "the browser uploads direct to Storage." The bytes here are always
// small/moderate (a single web image), nowhere near Vercel's Function
// request-body limit.
async function createBriefImageItem(
  projectId: string,
  taskId: string,
  section: BriefItemSection,
  notes: string,
  position: number,
  fileBytes: Buffer,
  contentType: string,
  fileName: string,
  // A scraped page title (og:title/twitter:title/<title>), when addBriefTaskLink
  // had one -- kept as a SEPARATE parameter from fileName rather than reused
  // in its place, since fileName still has to stay filename-shaped here
  // (it's what derives the storage path's extension below); a title can
  // contain a "." of its own (e.g. "Necklace by J.Crew") that would corrupt
  // extension detection if it were passed as fileName instead.
  labelOverride?: string | null,
): Promise<ActionResult & { itemId?: string; attachmentId?: string; label?: string }> {
  const supabase = await createClient();
  const extFromName = fileName.includes(".") ? fileName.split(".").pop() : undefined;
  const ext = extFromName || contentType.split("/").pop();
  const storagePath = `${projectId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const { error: uploadError } = await supabase.storage
    .from("brief-media")
    .upload(storagePath, fileBytes, { contentType });
  if (uploadError) {
    return { success: false, message: uploadError.message };
  }

  return insertBriefImageItem(projectId, taskId, section, notes, position, storagePath, labelOverride || fileName);
}

// og:image (checked both attribute orders) first, then twitter:image, then
// the first real <img> on the page -- a plain regex scan rather than a full
// HTML parser dependency, which is enough for meta tags' simple, regular
// shape and matches how most lightweight link-preview scrapers work.
function extractPrimaryImageUrl(html: string, pageUrl: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    /<img[^>]+src=["'](https?:\/\/[^"']+|\/[^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      return new URL(match[1], pageUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

async function createBriefLinkItem(
  projectId: string,
  taskId: string,
  section: BriefItemSection,
  url: string,
  notes: string,
  position: number,
): Promise<ActionResult & { itemId?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brief_task_items")
    .insert({ task_id: taskId, section, kind: "link", url, label: url, notes: notes.trim(), position })
    .select("id")
    .single();
  if (error) return { success: false, message: error.message };
  // Not revalidating -- its one caller (addBriefTaskLink's plain-link
  // fallback) ends at a client handler that already calls router.refresh()
  // itself.
  return { success: true, itemId: data?.id };
}

// One "Link" entry point: tries to convert the URL into a real editable
// image first -- a direct image URL is used as-is, a webpage's primary
// image (og:image/twitter:image/first real <img>) is fetched otherwise --
// and only falls back to a plain external-link item when no image can be
// found anywhere. Covers both "paste a product photo URL" and "paste a
// reference doc/article link" from one field, no separate tabs.
export async function addBriefTaskLink(
  projectId: string,
  taskId: string,
  section: BriefItemSection,
  url: string,
  notes: string,
  position: number,
): Promise<ActionResult & { itemId?: string; attachmentId?: string; label?: string; kind?: BriefItemKind }> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return { success: false, message: "URL is required." };

  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return { success: false, message: "That doesn't look like a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { success: false, message: "Only http/https URLs are supported." };
  }

  let targetUrl = trimmedUrl;
  let response: Response;
  try {
    response = await fetch(targetUrl);
  } catch {
    return { success: false, message: "Couldn't reach that URL." };
  }
  if (!response.ok) return { success: false, message: `Couldn't fetch that URL (${response.status}).` };

  let contentType = response.headers.get("content-type") ?? "";
  let imageBuffer: Buffer | null = null;
  // Only ever set when we had to scrape a webpage (never for a URL that was
  // already a direct image, which has no HTML/title to read) -- see
  // extractPageTitle's own comment on why this is a genuinely reliable
  // signal, unlike a clipboard-paste's filename/alt text.
  let scrapedTitle: string | null = null;

  if (contentType.startsWith("image/")) {
    imageBuffer = Buffer.from(await response.arrayBuffer());
  } else {
    // Not a direct image -- look for the page's primary image instead of
    // giving up immediately. Any failure along this path (no image found,
    // fetch failed, wasn't actually an image) just falls through to the
    // plain-link fallback below rather than erroring the whole add.
    const html = await response.text();
    scrapedTitle = extractPageTitle(html);
    const imageUrl = extractPrimaryImageUrl(html, targetUrl);
    if (imageUrl) {
      try {
        const fetched = await fetch(imageUrl);
        const fetchedType = fetched.headers.get("content-type") ?? "";
        if (fetched.ok && fetchedType.startsWith("image/")) {
          imageBuffer = Buffer.from(await fetched.arrayBuffer());
          contentType = fetchedType;
          targetUrl = imageUrl;
        }
      } catch {
        // Falls through to the plain-link path.
      }
    }
  }

  if (imageBuffer) {
    const fileName = decodeURIComponent(targetUrl.split("/").pop()?.split("?")[0] || "image");
    const result = await createBriefImageItem(
      projectId,
      taskId,
      section,
      notes,
      position,
      imageBuffer,
      contentType,
      fileName,
      scrapedTitle,
    );
    return { ...result, kind: "image" };
  }

  const linkResult = await createBriefLinkItem(projectId, taskId, section, trimmedUrl, notes, position);
  return { ...linkResult, kind: "link" };
}

// Re-inserts a brief_task_items row with the exact fields it had before --
// used both as "redo" of Add (link or image) and "undo" of Remove, see
// useUndoStack in brief-board.tsx. Never re-uploads a file: removeBriefTaskItem
// only ever deletes the *item* row, never the underlying brief_attachments
// row an "image" item points at, so that attachment is always still there
// to re-link.
export async function restoreBriefTaskItem(
  projectId: string,
  taskId: string,
  section: BriefItemSection,
  kind: BriefItemKind,
  label: string,
  notes: string,
  attachmentId: string | null,
  url: string | null,
  position: number,
): Promise<ActionResult & { itemId?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brief_task_items")
    .insert({ task_id: taskId, section, kind, label, notes, attachment_id: attachmentId, url, position })
    .select("id")
    .single();
  if (error) return { success: false, message: error.message };
  // Not revalidating -- called from undo (of Remove) and redo (of Add),
  // both of which already call router.refresh() themselves right after.
  return { success: true, itemId: data?.id };
}

export async function addBriefTaskImage(
  projectId: string,
  taskId: string,
  section: BriefItemSection,
  notes: string,
  position: number,
  formData: FormData,
): Promise<ActionResult & { itemId?: string; attachmentId?: string; label?: string }> {
  // The file itself already went direct browser-to-Storage before this
  // action ever runs (see the client's upload handler) -- this only ever
  // receives the resulting storage path, never the raw file.
  const storagePath = formData.get("storagePath");
  const fileName = formData.get("fileName");
  if (typeof storagePath !== "string" || !storagePath) {
    return { success: false, message: "No file provided." };
  }
  return insertBriefImageItem(
    projectId,
    taskId,
    section,
    notes,
    position,
    storagePath,
    typeof fileName === "string" ? fileName : "image",
  );
}

// Edits an already-added link/image item's note -- previously notes could
// only be set once, at add time, with no way back in.
export async function updateBriefTaskItemNotes(projectId: string, itemId: string, notes: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_items").update({ notes: notes.trim() }).eq("id", itemId);
  if (error) return { success: false, message: error.message };
  // Not revalidating -- an uncontrolled textarea (defaultValue) already
  // shows the typed notes, same reasoning as renameBriefTask above.
  return { success: true };
}

// Renames a Brief item's own display label -- deliberately scoped to just
// this one brief_task_items row. It can't touch brief_attachments (which
// has no name/label column at all -- the "name" of an image has only ever
// lived on the item row, see insertBriefImageItem's own comment) or
// media_assets (Brief images are never inserted there; Grid/Calendar/
// Stories all read media_assets, a completely separate table/bucket from
// brief_attachments/brief-media, so this rename can never be visible
// anywhere outside this one Brief item).
export async function renameBriefTaskItem(projectId: string, itemId: string, label: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("brief_task_items")
    .update({ label: label.trim() || "Image" })
    .eq("id", itemId);
  if (error) return { success: false, message: error.message };
  // Not revalidating -- the chip shows its own optimistic override (set by
  // the caller before this resolves), same convention as renameBriefTask/
  // renameBriefTaskFrame above.
  return { success: true };
}

export async function removeBriefTaskItem(projectId: string, itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_items").delete().eq("id", itemId);
  if (error) return { success: false, message: error.message };
  // Not revalidating -- its one real caller (ItemSection's handleRemove)
  // already hides the item optimistically before this runs, and only
  // calls router.refresh() on failure to resync. Redo of a prior remove
  // still refreshes on its own since undo/redo replay isn't optimistic here.
  return { success: true };
}

export async function addBriefTaskFrame(
  projectId: string,
  taskId: string,
  section: BriefFrameSection,
): Promise<ActionResult & { frameId?: string; label?: string; position?: number }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("brief_task_frames")
    .select("id, label, position")
    .eq("task_id", taskId)
    .eq("section", section)
    .order("position");
  const frames = existing ?? [];

  // New boxes land second-to-last (just before whatever's currently last --
  // "Closure" by default) instead of appended at the very end, and are
  // auto-numbered as the next "Body N" -- this section is really a fixed
  // opening/closing frame with a growing middle, not a flat list.
  const bodyCount = frames.filter((f) => /^Body \d+$/.test(f.label)).length;
  const label = `Body ${bodyCount + 1}`;
  const insertPosition = Math.max(0, frames.length - 1);

  const toShift = frames.filter((f) => f.position >= insertPosition);
  await Promise.all(
    toShift.map((f) => supabase.from("brief_task_frames").update({ position: f.position + 1 }).eq("id", f.id)),
  );

  const { data: frame, error } = await supabase
    .from("brief_task_frames")
    .insert({ task_id: taskId, section, label, position: insertPosition })
    .select("id")
    .single();
  if (error) return { success: false, message: error.message };
  // Not revalidating -- its callers (handleAddFrame, and the "Remove
  // Frame" undo command) already call router.refresh() themselves right
  // after, since no optimistic insertion of a new frame box exists yet.
  return { success: true, frameId: frame?.id, label, position: insertPosition };
}

// Re-inserts a brief_task_frames row with the exact fields it had before --
// used both as "redo" of Add Frame and "undo" of Remove Frame, see
// useUndoStack in brief-board.tsx.
export async function restoreBriefTaskFrame(
  projectId: string,
  taskId: string,
  section: BriefFrameSection,
  label: string,
  body: string,
  position: number,
): Promise<ActionResult & { frameId?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brief_task_frames")
    .insert({ task_id: taskId, section, label, body, position })
    .select("id")
    .single();
  if (error) return { success: false, message: error.message };
  // Not revalidating -- called from undo (of Remove Frame) and redo (of
  // Add Frame), both of which already call router.refresh() themselves.
  return { success: true, frameId: data?.id };
}

export async function renameBriefTaskFrame(
  projectId: string,
  frameId: string,
  label: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("brief_task_frames")
    .update({ label: label.trim() || "Text" })
    .eq("id", frameId);
  if (error) return { success: false, message: error.message };
  // Not revalidating -- an uncontrolled input (defaultValue) already
  // shows the typed label.
  return { success: true };
}

export async function updateBriefTaskFrameBody(
  projectId: string,
  frameId: string,
  body: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_frames").update({ body }).eq("id", frameId);
  if (error) return { success: false, message: error.message };
  // Not revalidating -- an uncontrolled textarea (defaultValue) already
  // shows the typed body text.
  return { success: true };
}

export async function removeBriefTaskFrame(projectId: string, frameId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_frames").delete().eq("id", frameId);
  if (error) return { success: false, message: error.message };
  // Not revalidating -- its one real caller (FrameSection's
  // handleRemoveFrame) already hides the frame optimistically before this
  // runs, and only calls router.refresh() on failure to resync. Redo of a
  // prior remove still refreshes on its own since undo/redo replay isn't
  // optimistic here.
  return { success: true };
}

export async function saveBriefAnnotation(
  projectId: string,
  attachmentId: string,
  formData: FormData,
): Promise<{ previewUrl?: string; message?: string }> {
  const file = formData.get("file");
  const annotationJsonRaw = formData.get("annotation_json");
  if (!(file instanceof File) || file.size === 0) {
    return { message: "No preview image provided." };
  }
  if (typeof annotationJsonRaw !== "string") {
    return { message: "Missing annotation data." };
  }

  let annotationJson: object;
  try {
    annotationJson = JSON.parse(annotationJsonRaw);
  } catch {
    return { message: "Invalid annotation data." };
  }

  const supabase = await createClient();
  const storagePath = `${projectId}/${crypto.randomUUID()}-preview.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("brief-media")
    .upload(storagePath, file, { contentType: file.type });

  if (uploadError) {
    return { message: uploadError.message };
  }

  const { error: updateError } = await supabase
    .from("brief_attachments")
    .update({ preview_storage_path: storagePath, annotation_json: annotationJson })
    .eq("id", attachmentId);

  if (updateError) {
    return { message: updateError.message };
  }

  // Not revalidating /brief (its own route, only caller) -- brief-board.tsx
  // already patches the edited item's thumbnail locally from the
  // `previewUrl` this returns, and no other route consumes brief
  // attachments today.
  const { data } = supabase.storage.from("brief-media").getPublicUrl(storagePath);
  return { previewUrl: data.publicUrl };
}

// Post/Carousel Cover and Story are explicit in the brief; Reel Cover
// (matches a Reel's own vertical frame) and Newsletter (~1.91:1, standard
// email/link-preview banner width) are reasonable defaults for the two the
// brief didn't specify a size for.
const POST_TYPE_CANVAS: Record<GeneratedDesignPostType, { w: number; h: number }> = {
  post: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
  reel_cover: { w: 1080, h: 1920 },
  newsletter: { w: 1200, h: 628 },
};

async function fetchAsBase64(url: string): Promise<{ buffer: Buffer; base64: string; mediaType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mediaType = response.headers.get("content-type") || "image/jpeg";
    return { buffer, base64: buffer.toString("base64"), mediaType };
  } catch {
    return null;
  }
}

type GenerateDesignResult = {
  success: boolean;
  message?: string;
  mediaAssetId?: string;
  imageUrl?: string;
  annotationJson?: object;
};

// Connects the Brief straight to the AI engine, using the entire existing
// Brief as context -- no separate prompt builder. References are sent to
// Claude as real vision input (style/composition/color guidance only,
// never inserted directly); Images/Products are the real content Claude
// composes into the layout. The result is never a flattened AI image: only
// an abstract layout comes back from Claude (design-layout.ts's
// DesignLayoutElement schema), which is deterministically compiled into
// real Fabric.js object JSON and opened in the exact same AnnotationEditor
// every manually-created design already uses -- same tool, same undo
// stack, same save path.
export async function generateBriefDesign(
  projectId: string,
  taskId: string,
  postType: GeneratedDesignPostType,
): Promise<GenerateDesignResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const [{ data: task }, { data: items }, { data: frames }, { data: strategy }, { data: moodboard }] =
    await Promise.all([
      supabase.from("brief_tasks").select("id, name, content_types").eq("id", taskId).single(),
      supabase
        .from("brief_task_items")
        .select("id, section, kind, label, notes, attachment_id")
        .eq("task_id", taskId),
      supabase.from("brief_task_frames").select("section, label, body").eq("task_id", taskId),
      supabase
        .from("brand_strategy")
        .select("brand_values, vision, voice, positioning, audience_notes")
        .eq("project_id", projectId)
        .maybeSingle(),
      // Isolated -- brand_moodboard_items may not exist yet on a
      // not-yet-migrated database; a missing moodboard should never break
      // generation, just mean less brand context is available.
      supabase.from("brand_moodboard_items").select("category, kind, storage_path, label").eq("project_id", projectId),
    ]);

  if (!task) return { success: false, message: "Task not found." };

  const attachmentIds = (items ?? []).map((i) => i.attachment_id).filter((id): id is string => Boolean(id));
  const { data: attachments } = attachmentIds.length
    ? await supabase.from("brief_attachments").select("id, original_storage_path").in("id", attachmentIds)
    : { data: [] };
  const attachmentById = new Map((attachments ?? []).map((a) => [a.id, a]));

  function publicUrl(path: string): string {
    return supabase.storage.from("brief-media").getPublicUrl(path).data.publicUrl;
  }

  const imageItems = (items ?? [])
    .filter((i): i is typeof i & { attachment_id: string } => i.kind === "image" && Boolean(i.attachment_id))
    .map((i) => ({ ...i, attachment: attachmentById.get(i.attachment_id) }))
    .filter((i) => Boolean(i.attachment));

  const contentAssets = imageItems.filter((i) => i.section === "images" || i.section === "products");
  if (contentAssets.length === 0) {
    return { success: false, message: "Add at least one image or product photo to this task before generating." };
  }
  const referenceAssets = imageItems.filter((i) => i.section === "references");

  const brandLines = [
    `Values: ${strategy?.brand_values || "(none provided)"}`,
    `Vision: ${strategy?.vision || "(none provided)"}`,
    `Voice: ${strategy?.voice || "(none provided)"}`,
    `Positioning: ${strategy?.positioning || "(none provided)"}`,
    `Audience: ${strategy?.audience_notes || "(none provided)"}`,
  ].join("\n");

  const frameLines = (frames ?? [])
    .filter((f) => f.body.trim())
    .map((f) => `${f.section === "text" ? "Text" : "Frame"} "${f.label}": ${f.body}`)
    .join("\n");

  const assetLines = contentAssets.map((i) => `- id "${i.id}" (${i.section}): ${i.label || i.notes || "untitled"}`).join("\n");

  const { w: canvasW, h: canvasH } = POST_TYPE_CANVAS[postType];

  const prompt = [
    `You are a social media designer generating a ${postType.replace("_", " ")} creative, canvas size ${canvasW}x${canvasH}px.`,
    "Use the Brief content and brand info below as the ONLY source of copy/direction -- no extra prompting will be given.",
    "Respond with ONLY a JSON object with this exact shape, no other text:",
    `{"baseAssetId": "<one of the ids listed below>", "elements": [ ... ]}`,
    "Each element in `elements` is one of:",
    `{"type":"text","x":0-1,"y":0-1,"w":0-1,"h":0-1,"text":"...","fontSize":10-140,"color":"#hex","fontWeight":"normal"|"bold","align":"left"|"center"|"right"}`,
    `{"type":"image","assetId":"<one of the ids listed below, NOT the baseAssetId>","x":0-1,"y":0-1,"w":0-1,"h":0-1}`,
    `{"type":"shape","shape":"rect"|"circle","x":0-1,"y":0-1,"w":0-1,"h":0-1,"fill":"#hex or transparent","stroke":"#hex or transparent"}`,
    "x/y/w/h are fractions of the canvas (0 to 1). baseAssetId is the ONE image (from the list below) that becomes the full-bleed background photo -- pick whichever best fits the brief. Any other listed image may optionally also appear as a smaller 'image' element (e.g. a logo or second product shot), never the same id as baseAssetId.",
    "Brief task:",
    `Name: ${task.name}`,
    `Content types: ${(task.content_types ?? []).join(", ") || "(none)"}`,
    frameLines || "(no brief text provided)",
    "Brand info:",
    brandLines,
    "Available images/products (use these ids only):",
    assetLines,
    "Reference images attached below (if any) are STYLE GUIDANCE ONLY -- composition, typography, color, mood. Never reference them as an assetId, they are not selectable content.",
  ].join("\n");

  // Capped at 4 -- references first (the spec's explicit style-guidance
  // source), then moodboard campaign/reference material, bounding both
  // latency and cost on every generation. Only actual uploaded IMAGE files
  // are usable as vision input -- link items have no bytes to send, and
  // font/PDF files aren't images Claude's vision input can decode.
  const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
  const visionCandidates = [
    ...referenceAssets.map((i) => publicUrl(i.attachment!.original_storage_path)),
    ...(moodboard ?? [])
      .filter(
        (m): m is typeof m & { storage_path: string } =>
          m.kind === "file" &&
          Boolean(m.storage_path) &&
          (m.category === "reference" || m.category === "campaign") &&
          IMAGE_EXT.has(m.storage_path!.split(".").pop()?.toLowerCase() ?? ""),
      )
      .map((m) => supabase.storage.from("project-media").getPublicUrl(m.storage_path).data.publicUrl),
  ].slice(0, 4);
  const visionImages = (
    await Promise.all(
      visionCandidates.map(async (url) => {
        const fetched = await fetchAsBase64(url);
        return fetched ? { base64: fetched.base64, mediaType: fetched.mediaType } : null;
      }),
    )
  ).filter((img): img is { base64: string; mediaType: string } => img !== null);

  const result = await generateWithImages(prompt, visionImages);
  if ("error" in result) return { success: false, message: result.error };

  const validAssetIds = new Set(contentAssets.map((i) => i.id));
  const { baseAssetId, elements } = parseDesignLayout(result.text, validAssetIds);
  const chosenBaseId = baseAssetId ?? contentAssets[0].id;
  const baseItem = contentAssets.find((i) => i.id === chosenBaseId)!;

  const baseFetched = await fetchAsBase64(publicUrl(baseItem.attachment!.original_storage_path));
  if (!baseFetched) return { success: false, message: "Couldn't load the base image for generation." };

  let baseMeta: { width?: number; height?: number };
  try {
    baseMeta = await sharp(baseFetched.buffer).metadata();
  } catch {
    return { success: false, message: "Couldn't read the base image's dimensions." };
  }
  if (!baseMeta.width || !baseMeta.height) {
    return { success: false, message: "Couldn't read the base image's dimensions." };
  }

  // Re-uploaded into project-media (not left in brief-media) since it's
  // becoming a real Media Library asset -- same private, signed-URL bucket
  // every Grid/post image already lives in.
  const newStoragePath = `${projectId}/${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("project-media")
    .upload(newStoragePath, baseFetched.buffer, { contentType: "image/jpeg" });
  if (uploadError) return { success: false, message: uploadError.message };

  // Routed through the shared cache even for this brand-new path -- it's a
  // no-op for correctness (nothing else could already have this path
  // cached), but it means Grid's next full load of this exact asset reuses
  // this same signed URL instead of minting a second one moments later.
  const signedUrl = await getCachedSignedUrl(supabase, "project-media", newStoragePath);
  if (!signedUrl) return { success: false, message: "Couldn't sign the new asset's URL." };

  // Secondary images (any "image" element that isn't the base) resolve
  // straight to their existing brief-media public URL -- that bucket is
  // public and never expires, unlike a signed URL, and only the BASE
  // photo's src gets patched-on-reopen by AnnotationEditor (see
  // annotation-editor.tsx), so anything else needs to stay valid forever.
  const imagesById = new Map<string, { src: string; naturalW: number; naturalH: number }>();
  for (const el of elements) {
    if (el.type !== "image" || imagesById.has(el.assetId)) continue;
    const item = contentAssets.find((i) => i.id === el.assetId);
    if (!item) continue;
    const fetched = await fetchAsBase64(publicUrl(item.attachment!.original_storage_path));
    if (!fetched) continue;
    try {
      const meta = await sharp(fetched.buffer).metadata();
      if (meta.width && meta.height) {
        imagesById.set(el.assetId, {
          src: publicUrl(item.attachment!.original_storage_path),
          naturalW: meta.width,
          naturalH: meta.height,
        });
      }
    } catch {
      // Skipped -- a secondary image that can't be read just doesn't
      // appear, rather than failing the whole generation.
    }
  }

  const annotationJson = layoutToFabricJson(
    elements,
    canvasW,
    canvasH,
    { src: signedUrl, naturalW: baseMeta.width, naturalH: baseMeta.height },
    imagesById,
  );

  // This becomes a real Media Library/Grid-placeable asset (same as any
  // other upload), so it needs the same thumbnail guarantee -- otherwise
  // a Grid tile using it would silently fall back to the full original,
  // same as the other upload paths this pass fixed.
  const thumbnailResult = await generateServerThumbnail(supabase, "project-media", newStoragePath, projectId);
  const thumbnailStoragePath = thumbnailResult.ok ? thumbnailResult.path : null;

  const { data: mediaAsset, error: insertError } = await supabase
    .from("media_assets")
    .insert({
      project_id: projectId,
      storage_path: newStoragePath,
      media_type: "image",
      uploaded_by: user.id,
      annotation_json: annotationJson,
      generated_by_ai: true,
      thumbnail_storage_path: thumbnailStoragePath,
    })
    .select("id")
    .single();
  if (insertError || !mediaAsset) {
    return { success: false, message: insertError?.message ?? "Failed to save the generated design." };
  }

  revalidatePath(`/projects/${projectId}/grid`);
  return {
    success: true,
    mediaAssetId: mediaAsset.id,
    imageUrl: signedUrl,
    annotationJson,
  };
}
