"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { generateWithImages } from "@/lib/ai/client";
import { parseDesignLayout, layoutToFabricJson } from "@/lib/ai/design-layout";
import type { BriefFrameSection, BriefItemSection, BriefTaskType, GeneratedDesignPostType } from "@/types/database";

const DEFAULT_FRAME_LABELS = ["Cover", "Body 1", "Body 2", "Closure"];

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

  revalidatePath(`/projects/${projectId}/brief`);
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
  revalidatePath(`/projects/${projectId}/brief`);
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
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function deleteBriefTask(projectId: string, taskId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_tasks").delete().eq("id", taskId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function addBriefTaskLink(
  projectId: string,
  taskId: string,
  section: BriefItemSection,
  url: string,
  notes: string,
  position: number,
): Promise<ActionResult> {
  if (!url.trim()) return { success: false, message: "URL is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_items").insert({
    task_id: taskId,
    section,
    kind: "link",
    url: url.trim(),
    label: url.trim(),
    notes: notes.trim(),
    position,
  });
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function addBriefTaskImage(
  projectId: string,
  taskId: string,
  section: BriefItemSection,
  notes: string,
  position: number,
  formData: FormData,
): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, message: "No file provided." };
  }

  const supabase = await createClient();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : undefined;
  const storagePath = `${projectId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const { error: uploadError } = await supabase.storage
    .from("brief-media")
    .upload(storagePath, file, { contentType: file.type });
  if (uploadError) {
    return { success: false, message: uploadError.message };
  }

  const { data: attachment, error: attachmentError } = await supabase
    .from("brief_attachments")
    .insert({ project_id: projectId, original_storage_path: storagePath })
    .select("id")
    .single();
  if (attachmentError || !attachment) {
    return { success: false, message: attachmentError?.message ?? "Failed to save attachment." };
  }

  const { error: itemError } = await supabase.from("brief_task_items").insert({
    task_id: taskId,
    section,
    kind: "image",
    label: file.name,
    notes: notes.trim(),
    attachment_id: attachment.id,
    position,
  });
  if (itemError) return { success: false, message: itemError.message };

  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function removeBriefTaskItem(projectId: string, itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_items").delete().eq("id", itemId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function addBriefTaskFrame(
  projectId: string,
  taskId: string,
  section: BriefFrameSection,
  position: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("brief_task_frames")
    .insert({ task_id: taskId, section, label: `Text ${position + 1}`, position });
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
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
  revalidatePath(`/projects/${projectId}/brief`);
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
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function removeBriefTaskFrame(projectId: string, frameId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_frames").delete().eq("id", frameId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
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

  const { data } = supabase.storage.from("brief-media").getPublicUrl(storagePath);
  revalidatePath(`/projects/${projectId}/brief`);
  return { previewUrl: data.publicUrl };
}

const SIGNED_URL_TTL_SECONDS = 3600;

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
      supabase.from("brand_moodboard_items").select("category, storage_path, label").eq("project_id", projectId),
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
  // latency and cost on every generation.
  const visionCandidates = [
    ...referenceAssets.map((i) => publicUrl(i.attachment!.original_storage_path)),
    ...(moodboard ?? [])
      .filter((m) => m.category === "reference" || m.category === "campaign")
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

  const { data: signed } = await supabase.storage
    .from("project-media")
    .createSignedUrl(newStoragePath, SIGNED_URL_TTL_SECONDS);
  if (!signed) return { success: false, message: "Couldn't sign the new asset's URL." };

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
    { src: signed.signedUrl, naturalW: baseMeta.width, naturalH: baseMeta.height },
    imagesById,
  );

  const { data: mediaAsset, error: insertError } = await supabase
    .from("media_assets")
    .insert({
      project_id: projectId,
      storage_path: newStoragePath,
      media_type: "image",
      uploaded_by: user.id,
      annotation_json: annotationJson,
      generated_by_ai: true,
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
    imageUrl: signed.signedUrl,
    annotationJson,
  };
}
