// One set of rules and one set of wording for every file upload in Flow:er.
// Pure (no React, no DOM, no Supabase) -- tested by upload-validation.test.ts.
//
// Each upload entry point names its CONTEXT, and the context decides which
// file types it takes and how large a file may be. Every problem is reported
// as "<Title> — <what to do>", so a rejected file always gets a reason the
// user can act on -- never a silent drop, never a raw storage/server error.

export type UploadContext =
  // Grid Media Library, Post Editor, Content editor, Brief media
  | "media"
  // Content board (also takes PDFs)
  | "content"
  // single images: avatar, landing image, Brand Assets cover, pasted images
  | "image"
  // project photo -- goes through a Server Action (next.config.ts
  // serverActions.bodySizeLimit = 20mb), not direct to storage
  | "project-photo"
  // Add Logo in the image editor -- embedded into the saved annotation,
  // which is itself saved through a 20mb Server Action body
  | "logo"
  // Brand moodboard non-font categories
  | "moodboard"
  | "font"
  | "brand-document";

export type UploadProblemCode =
  | "type"
  | "size"
  | "unreadable"
  | "video-format"
  | "image-format"
  | "network"
  | "auth"
  | "server";

export type UploadProblem = {
  code: UploadProblemCode;
  // Short heading, e.g. "File too large".
  title: string;
  // What happened and what to do, as a full sentence.
  detail: string;
  // Lower-case tag used when several files are listed in one message.
  short: string;
};

export type UploadFailure = { fileName: string; problem: UploadProblem };

type FileLike = { name: string; type: string; size: number };

const MB = 1024 * 1024;
// Every storage bucket's file_size_limit (schema.sql: 52428800).
export const STORAGE_UPLOAD_LIMIT_BYTES = 50 * MB;
// next.config.ts serverActions.bodySizeLimit -- the real ceiling for a file
// sent through a Server Action (the project photo).
export const SERVER_ACTION_UPLOAD_LIMIT_BYTES = 20 * MB;
// A logo is embedded in the editor's saved annotation, and the whole save
// (rendered image + annotation) must fit the 20mb Server Action body, so a
// logo gets a lower limit that leaves room for the rest.
export const LOGO_UPLOAD_LIMIT_BYTES = 10 * MB;

export function formatLimit(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// Windows/Chromium often report HEIC/HEIF with an EMPTY type. The upload
// pipeline treats them as images and the server makes their thumbnail, so
// they are accepted by extension. Other empty-type files are not guessed: a
// video mis-guessed as an image would be stored with the wrong media type.
const EMPTY_TYPE_IMAGE_EXTENSIONS = new Set(["heic", "heif"]);
const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt"]);

const isImage = (f: FileLike) =>
  f.type.startsWith("image/") || (f.type === "" && EMPTY_TYPE_IMAGE_EXTENSIONS.has(extensionOf(f.name)));
const isVideo = (f: FileLike) => f.type.startsWith("video/");
const isPdf = (f: FileLike) => f.type === "application/pdf";

type Rule = { accepts: (f: FileLike) => boolean; supported: string; maxBytes: number };

const RULES: Record<UploadContext, Rule> = {
  media: { accepts: (f) => isImage(f) || isVideo(f), supported: "images and videos", maxBytes: STORAGE_UPLOAD_LIMIT_BYTES },
  content: {
    accepts: (f) => isImage(f) || isVideo(f) || isPdf(f),
    supported: "images, videos and PDFs",
    maxBytes: STORAGE_UPLOAD_LIMIT_BYTES,
  },
  image: { accepts: isImage, supported: "images", maxBytes: STORAGE_UPLOAD_LIMIT_BYTES },
  "project-photo": { accepts: isImage, supported: "images", maxBytes: SERVER_ACTION_UPLOAD_LIMIT_BYTES },
  logo: {
    accepts: (f) => isImage(f) || extensionOf(f.name) === "svg",
    supported: "images (PNG, JPG, SVG or WebP)",
    maxBytes: LOGO_UPLOAD_LIMIT_BYTES,
  },
  moodboard: { accepts: (f) => isImage(f) || isPdf(f), supported: "images and PDFs", maxBytes: STORAGE_UPLOAD_LIMIT_BYTES },
  font: {
    accepts: (f) => FONT_EXTENSIONS.has(extensionOf(f.name)),
    supported: "font files (TTF, OTF, WOFF or WOFF2)",
    maxBytes: STORAGE_UPLOAD_LIMIT_BYTES,
  },
  "brand-document": {
    accepts: (f) => DOCUMENT_EXTENSIONS.has(extensionOf(f.name)),
    supported: "PDF, Word (DOC or DOCX) and text (TXT) files",
    maxBytes: STORAGE_UPLOAD_LIMIT_BYTES,
  },
};

export function uploadLimitBytes(context: UploadContext): number {
  return RULES[context].maxBytes;
}

export function supportedTypesLabel(context: UploadContext): string {
  return RULES[context].supported;
}

// --- problems ---------------------------------------------------------------

export function unsupportedTypeProblem(context: UploadContext): UploadProblem {
  return {
    code: "type",
    title: "Unsupported file type",
    detail: `Only ${RULES[context].supported} can be uploaded here.`,
    short: "unsupported file type",
  };
}

export function tooLargeProblem(maxBytes: number): UploadProblem {
  const limit = formatLimit(maxBytes);
  return {
    code: "size",
    title: "File too large",
    detail: `The maximum file size here is ${limit}.`,
    short: `too large, max ${limit}`,
  };
}

export const UNREADABLE_FILE: UploadProblem = {
  code: "unreadable",
  title: "Unreadable file",
  detail: "This file is empty or damaged and couldn't be read. Please check the file and try again.",
  short: "unreadable file",
};

export const UNSUPPORTED_VIDEO: UploadProblem = {
  code: "video-format",
  title: "Unsupported video format",
  detail: "This video can't be played in your browser. Please convert it to MP4 (H.264) and try again.",
  short: "unsupported video format",
};

// For a video that is ALREADY stored (Edit Cover, Regenerate Poster). From a
// URL the browser's "can't play" can also mean the file couldn't be loaded,
// so this doesn't claim the format for certain.
export const STORED_VIDEO_UNPLAYABLE: UploadProblem = {
  code: "video-format",
  title: "Video can't be played",
  detail:
    "This video can't be played in your browser, so a frame can't be captured from it. If it isn't an MP4 (H.264) video, please upload a converted copy.",
  short: "video can't be played",
};

export const STORED_VIDEO_NOT_LOADED: UploadProblem = {
  code: "network",
  title: "Video didn't load",
  detail: "The video couldn't be loaded in time. Check your internet connection and try again.",
  short: "video didn't load",
};

// Brief ONLY: a reference video the browser can't play is still stored (see
// brief-board.tsx), with this non-blocking notice at upload time...
export const VIDEO_PREVIEW_UNAVAILABLE_UPLOADED =
  "Video preview unavailable — This file was uploaded, but it can't be previewed in your browser. Download it to view it in a compatible application.";
// ...and this one in its preview, next to a Download button.
export const VIDEO_PREVIEW_UNAVAILABLE =
  "Video preview unavailable — This file can't be previewed in your browser. Download it to view it in a compatible application.";

// Whether a file's first bytes look like a real video CONTAINER (AVI, MP4 /
// MOV / M4V / 3GP, WebM / MKV, MPEG program or transport stream, FLV,
// WMV / ASF, Ogg). Used only by Brief, to accept a video the browser can't
// decode as a reference attachment while still turning away a non-video
// file merely named like one (the OS derives the MIME type from the
// extension alone).
//
// A CLIENT-SIDE SAFEGUARD, NOT A SECURITY BOUNDARY: it runs in the
// uploader's browser and can be bypassed by anyone calling the storage API
// directly. Server-side authorization, size limits and storage policies are
// what actually protect the bucket.
export function isRecognisedVideoContainer(head: Uint8Array): boolean {
  const ascii = (from: number, length: number) => String.fromCharCode(...head.subarray(from, from + length));
  const starts = (...bytes: number[]) => head.length >= bytes.length && bytes.every((b, i) => head[i] === b);
  if (head.length < 4) return false;
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "AVI ") return true;
  // ISO base media / QuickTime: a box type at offset 4
  if (head.length >= 8 && ["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(ascii(4, 4))) return true;
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return true; // EBML: WebM, Matroska
  if (starts(0x00, 0x00, 0x01, 0xba) || starts(0x00, 0x00, 0x01, 0xb3)) return true; // MPEG-PS / MPEG video
  if (head.length > 188 && head[0] === 0x47 && head[188] === 0x47) return true; // MPEG-TS sync bytes
  if (ascii(0, 3) === "FLV" && head[3] === 0x01) return true;
  if (starts(0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11)) return true; // ASF / WMV
  if (ascii(0, 4) === "OggS") return true;
  return false;
}

export const UNSUPPORTED_IMAGE: UploadProblem = {
  code: "image-format",
  title: "Unsupported image format",
  detail: "This image can't be displayed in your browser. Please use a PNG, JPG, SVG or WebP file.",
  short: "unsupported image format",
};

export const UPLOAD_NETWORK_FAILED: UploadProblem = {
  code: "network",
  title: "Upload failed",
  detail: "The file couldn't be uploaded. Check your internet connection and try again.",
  short: "upload failed, check your connection",
};

export function uploadServerProblem(detail = "Something went wrong while saving this file. Please try again."): UploadProblem {
  return { code: "server", title: "Upload failed", detail, short: "upload failed" };
}

export const SIGNED_OUT: UploadProblem = {
  code: "auth",
  title: "Signed out",
  detail: "Please sign in to upload files.",
  short: "signed out",
};

// Only messages that RELIABLY mean "no valid session": the upload actions'
// own "You must be logged in." / "Not signed in.", and Supabase's expired or
// invalid session errors. A permission refusal (row-level security) is NOT
// one of them -- signing in again wouldn't fix it.
const SIGNED_OUT_PATTERN = /must be logged in|not signed in|not authenticated|unauthenticated|jwt expired|invalid jwt|session expired/i;

// For the text a save/upload step returned (a Server Action's `message`, a
// storage error): the actionable sign-in message when it's reliably an auth
// failure, otherwise the generic one. Technical text is never shown.
export function serverUploadProblem(message: string | null | undefined): UploadProblem {
  return message && SIGNED_OUT_PATTERN.test(message) ? SIGNED_OUT : uploadServerProblem();
}

export function problemMessage(problem: UploadProblem): string {
  return `${problem.title} — ${problem.detail}`;
}

// --- checks -----------------------------------------------------------------

// Type first (a wrong file is wrong at any size), then empty, then size.
export function checkFile(file: FileLike, context: UploadContext): UploadProblem | null {
  const rule = RULES[context];
  if (!rule.accepts(file)) return unsupportedTypeProblem(context);
  if (file.size === 0) return UNREADABLE_FILE;
  if (file.size > rule.maxBytes) return tooLargeProblem(rule.maxBytes);
  return null;
}

// Keeps the original order within each group, so a multi-file upload still
// proceeds in the order the user picked.
export function validateFiles<T extends FileLike>(
  files: T[],
  context: UploadContext,
): { accepted: T[]; rejected: UploadFailure[] } {
  const accepted: T[] = [];
  const rejected: UploadFailure[] = [];
  for (const file of files) {
    const problem = checkFile(file, context);
    if (problem) rejected.push({ fileName: file.name, problem });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

// One message for any number of failed files, naming each one.
//   1 file:  "clip.avi" wasn't uploaded. Unsupported video format — This video ...
//   more:    3 files weren't uploaded: a.avi (unsupported video format), b.zip
//            (unsupported file type), c.png (too large, max 50 MB). Videos must
//            be MP4 (H.264). Only images and videos can be uploaded here.
export function failureSummary(failures: UploadFailure[], context?: UploadContext): string | null {
  if (failures.length === 0) return null;
  if (failures.length === 1) {
    const [{ fileName, problem }] = failures;
    return `"${fileName}" wasn't uploaded. ${problemMessage(problem)}`;
  }
  const list = failures.map((f) => `${f.fileName} (${f.problem.short})`).join(", ");
  const hints: string[] = [];
  if (failures.some((f) => f.problem.code === "video-format")) hints.push("Please convert videos to MP4 (H.264).");
  if (context && failures.some((f) => f.problem.code === "type")) hints.push(`Only ${RULES[context].supported} can be uploaded here.`);
  if (failures.some((f) => f.problem.code === "network")) hints.push("Check your internet connection and try again.");
  if (failures.some((f) => f.problem.code === "auth")) hints.push("Please sign in to upload files.");
  return `${failures.length} files weren't uploaded: ${list}.${hints.length ? ` ${hints.join(" ")}` : ""}`;
}

// Classifies a Supabase Storage upload error. A size refusal is the file's
// fault; a network failure is not, and must never be reported as a bad file.
export function storageErrorProblem(error: { message?: string; statusCode?: string | number } | null | undefined): UploadProblem {
  const message = (error?.message ?? "").toLowerCase();
  const status = String(error?.statusCode ?? "");
  if (status === "401" || SIGNED_OUT_PATTERN.test(message)) return SIGNED_OUT;
  if (status === "413" || message.includes("size") || message.includes("too large")) {
    return tooLargeProblem(STORAGE_UPLOAD_LIMIT_BYTES);
  }
  if (status === "415" || message.includes("mime")) {
    return {
      code: "type",
      title: "Unsupported file type",
      detail: "This kind of file can't be stored. Please choose a different file.",
      short: "unsupported file type",
    };
  }
  if (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("timeout") ||
    message.includes("timed out")
  ) {
    return UPLOAD_NETWORK_FAILED;
  }
  return uploadServerProblem();
}
