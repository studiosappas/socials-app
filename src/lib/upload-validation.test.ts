// Tests for upload-validation.ts. Run with:
//   node --experimental-strip-types src/lib/upload-validation.test.ts

import assert from "node:assert/strict";
import {
  checkFile,
  failureSummary,
  formatLimit,
  LOGO_UPLOAD_LIMIT_BYTES,
  problemMessage,
  SERVER_ACTION_UPLOAD_LIMIT_BYTES,
  serverUploadProblem,
  SIGNED_OUT,
  STORAGE_UPLOAD_LIMIT_BYTES,
  storageErrorProblem,
  supportedTypesLabel,
  UNREADABLE_FILE,
  UNSUPPORTED_VIDEO,
  uploadLimitBytes,
  validateFiles,
  type UploadContext,
} from "./upload-validation.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const f = (name: string, type: string, size = 1000) => ({ name, type, size });
const accepted = (file: { name: string; type: string; size: number }, context: UploadContext) => checkFile(file, context) === null;

test("media: every image and video type is accepted; PDFs, documents, audio and archives are not", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "image/avif", "image/svg+xml"]) {
    assert.ok(accepted(f("x", type), "media"), type);
  }
  // container/codec support is the decode check's job, not the type check's: AVI is a video/* type
  for (const type of ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo", "video/x-matroska"]) {
    assert.ok(accepted(f("x", type), "media"), type);
  }
  for (const type of ["application/pdf", "text/plain", "application/zip", "audio/mpeg", "application/octet-stream"]) {
    assert.equal(checkFile(f("x", type), "media")?.code, "type", type);
  }
});

test("HEIC/HEIF with an EMPTY type (Windows/Chromium) is still accepted; other empty types are not guessed", () => {
  for (const context of ["media", "content", "image", "project-photo"] as UploadContext[]) {
    assert.ok(accepted(f("IMG_0001.HEIC", ""), context), context);
    assert.ok(accepted(f("photo.heif", ""), context), context);
  }
  assert.equal(checkFile(f("clip.mov", ""), "media")?.code, "type", "never guess a video as an image");
  assert.equal(checkFile(f("README", ""), "media")?.code, "type");
});

test("content additionally takes PDFs; brief/editor media contexts do not", () => {
  assert.ok(accepted(f("deck.pdf", "application/pdf"), "content"));
  assert.ok(accepted(f("a.mp4", "video/mp4"), "content"));
  assert.equal(checkFile(f("deck.pdf", "application/pdf"), "media")?.code, "type");
  assert.equal(checkFile(f("a.zip", "application/zip"), "content")?.code, "type");
});

test("single-image contexts take images only", () => {
  for (const context of ["image", "project-photo"] as UploadContext[]) {
    assert.ok(accepted(f("a.png", "image/png"), context));
    assert.equal(checkFile(f("a.mp4", "video/mp4"), context)?.code, "type");
    assert.equal(checkFile(f("a.pdf", "application/pdf"), context)?.code, "type");
  }
});

test("logo: images, and SVG even when the browser reports no type", () => {
  assert.ok(accepted(f("logo.png", "image/png"), "logo"));
  assert.ok(accepted(f("logo.svg", "image/svg+xml"), "logo"));
  assert.ok(accepted(f("logo.svg", ""), "logo"));
  assert.equal(checkFile(f("logo.pdf", "application/pdf"), "logo")?.code, "type");
});

test("moodboard: images and PDFs; fonts by extension only, whatever type the OS reports", () => {
  assert.ok(accepted(f("board.jpg", "image/jpeg"), "moodboard"));
  assert.ok(accepted(f("guide.pdf", "application/pdf"), "moodboard"));
  assert.equal(checkFile(f("brand.ttf", "font/ttf"), "moodboard")?.code, "type");
  for (const [name, type] of [["a.ttf", "font/ttf"], ["a.OTF", ""], ["a.woff", "application/font-woff"], ["a.woff2", "application/octet-stream"]]) {
    assert.ok(accepted(f(name, type), "font"), name);
  }
  for (const name of ["a.zip", "a.png", "a.ttc", "font"]) assert.equal(checkFile(f(name, ""), "font")?.code, "type", name);
});

test("brand documents: PDF, DOC, DOCX, TXT by extension", () => {
  for (const name of ["a.pdf", "a.doc", "a.DOCX", "notes.txt"]) assert.ok(accepted(f(name, ""), "brand-document"), name);
  for (const name of ["a.pages", "a.rtf", "a.xlsx", "a.png"]) assert.equal(checkFile(f(name, ""), "brand-document")?.code, "type", name);
});

test("size limits: exactly at the limit passes, one byte over fails, with the real limit in the message", () => {
  const cases: [UploadContext, number, string][] = [
    ["media", STORAGE_UPLOAD_LIMIT_BYTES, "50 MB"],
    ["content", STORAGE_UPLOAD_LIMIT_BYTES, "50 MB"],
    ["image", STORAGE_UPLOAD_LIMIT_BYTES, "50 MB"],
    ["project-photo", SERVER_ACTION_UPLOAD_LIMIT_BYTES, "20 MB"],
    ["logo", LOGO_UPLOAD_LIMIT_BYTES, "10 MB"],
    ["font", STORAGE_UPLOAD_LIMIT_BYTES, "50 MB"],
    ["brand-document", STORAGE_UPLOAD_LIMIT_BYTES, "50 MB"],
  ];
  for (const [context, limit, label] of cases) {
    const ok = context === "font" ? f("a.ttf", "", limit) : context === "brand-document" ? f("a.pdf", "", limit) : f("a.png", "image/png", limit);
    assert.equal(checkFile(ok, context), null, `${context} at limit`);
    const problem = checkFile({ ...ok, size: limit + 1 }, context);
    assert.equal(problem?.code, "size", `${context} over limit`);
    assert.equal(problemMessage(problem!), `File too large — The maximum file size here is ${label}.`);
    assert.equal(uploadLimitBytes(context), limit);
  }
  assert.equal(formatLimit(20 * 1024 * 1024), "20 MB");
});

test("an empty file is unreadable; a wrong type is reported before size", () => {
  assert.equal(checkFile(f("a.png", "image/png", 0), "media"), UNREADABLE_FILE);
  assert.equal(checkFile(f("a.zip", "application/zip", STORAGE_UPLOAD_LIMIT_BYTES * 2), "media")?.code, "type");
});

test("messages: consistent 'Title — detail' wording, and the agreed video wording", () => {
  assert.equal(
    problemMessage(UNSUPPORTED_VIDEO),
    "Unsupported video format — This video can't be played in your browser. Please convert it to MP4 (H.264) and try again.",
  );
  assert.equal(problemMessage(checkFile(f("a.zip", "application/zip"), "content")!), "Unsupported file type — Only images, videos and PDFs can be uploaded here.");
  assert.equal(supportedTypesLabel("font"), "font files (TTF, OTF, WOFF or WOFF2)");
});

test("validateFiles keeps order, passes valid files through and names every rejected one", () => {
  const files = [f("a.jpg", "image/jpeg"), f("notes.zip", "application/zip"), f("b.mp4", "video/mp4"), f("big.png", "image/png", STORAGE_UPLOAD_LIMIT_BYTES + 1)];
  const { accepted: ok, rejected } = validateFiles(files, "media");
  assert.deepEqual(ok.map((x) => x.name), ["a.jpg", "b.mp4"]);
  assert.deepEqual(rejected.map((r) => [r.fileName, r.problem.code]), [["notes.zip", "type"], ["big.png", "size"]]);
});

test("failureSummary: one file gets the full reason; several are listed by name with targeted hints", () => {
  assert.equal(failureSummary([]), null);
  assert.equal(
    failureSummary([{ fileName: "clip.avi", problem: UNSUPPORTED_VIDEO }]),
    `"clip.avi" wasn't uploaded. Unsupported video format — This video can't be played in your browser. Please convert it to MP4 (H.264) and try again.`,
  );
  const many = failureSummary(
    [
      { fileName: "clip.avi", problem: UNSUPPORTED_VIDEO },
      { fileName: "notes.zip", problem: checkFile(f("notes.zip", "application/zip"), "media")! },
      { fileName: "big.png", problem: checkFile(f("big.png", "image/png", STORAGE_UPLOAD_LIMIT_BYTES + 1), "media")! },
    ],
    "media",
  )!;
  assert.equal(
    many,
    "3 files weren't uploaded: clip.avi (unsupported video format), notes.zip (unsupported file type), big.png (too large, max 50 MB). " +
      "Please convert videos to MP4 (H.264). Only images and videos can be uploaded here.",
  );
});

test("storage errors: size and type refusals are the file's fault; network failures never are", () => {
  assert.equal(storageErrorProblem({ message: "The object exceeded the maximum allowed size", statusCode: "413" }).code, "size");
  assert.equal(storageErrorProblem({ message: "Payload too large" }).code, "size");
  assert.equal(storageErrorProblem({ message: "mime type video/x-msvideo is not supported", statusCode: "415" }).code, "type");
  for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "request timed out"]) {
    assert.equal(storageErrorProblem({ message }).code, "network", message);
  }
  assert.equal(storageErrorProblem({ message: "new row violates row-level security policy", statusCode: "403" }).code, "server");
  assert.equal(storageErrorProblem(null).code, "server");
  // the raw storage text never reaches the message
  assert.ok(!problemMessage(storageErrorProblem({ message: "row-level security" })).includes("row-level"));
});

test("logo: an oversize logo's message states the 10 MB limit", () => {
  const problem = checkFile(f("logo.png", "image/png", LOGO_UPLOAD_LIMIT_BYTES + 1), "logo")!;
  assert.equal(problemMessage(problem), "File too large — The maximum file size here is 10 MB.");
});

test("auth: only RELIABLE sign-in failures get the sign-in message; everything else stays generic and hides technical text", () => {
  const signIn = "Signed out — Please sign in to upload files.";
  for (const message of ["You must be logged in.", "Not signed in.", "JWT expired", "invalid JWT: unable to parse", "User not authenticated"]) {
    assert.equal(problemMessage(serverUploadProblem(message)), signIn, message);
  }
  assert.equal(problemMessage(storageErrorProblem({ message: "Unauthorized", statusCode: "401" })), signIn);
  assert.equal(problemMessage(storageErrorProblem({ message: "jwt expired", statusCode: "400" })), signIn);
  // a permission refusal is not a sign-in problem
  for (const message of ["new row violates row-level security policy", 'duplicate key value violates unique constraint "x"', "", null, undefined]) {
    const p = serverUploadProblem(message);
    assert.equal(p.code, "server", String(message));
    assert.equal(problemMessage(p), "Upload failed — Something went wrong while saving this file. Please try again.");
  }
  assert.equal(storageErrorProblem({ message: "new row violates row-level security policy", statusCode: "403" }).code, "server");
  assert.match(failureSummary([{ fileName: "a.png", problem: SIGNED_OUT }, { fileName: "b.png", problem: SIGNED_OUT }])!, /Please sign in to upload files\.$/);
});

console.log(`\n${passed} tests passed`);
