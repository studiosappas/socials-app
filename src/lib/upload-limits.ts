// The real ceiling once uploads go direct-to-Supabase-Storage (see
// direct-upload.ts) -- Supabase Storage's own documented Free-tier default,
// also set explicitly on every bucket via a migration (see
// RUN_ALL_PENDING_MIGRATIONS.sql) so it's verified, not assumed. Vercel's
// separate, non-configurable ~4.5MB-per-Function request-body limit no
// longer applies to these paths once the file itself skips the Server
// Action -- that Vercel limit, not Supabase and not next.config.ts's own
// serverActions.bodySizeLimit, was the actual reason a 21MB image used to
// fail regardless of any config value here.
export const MAX_IMAGE_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_UPLOAD_SIZE_LABEL = "50MB";

export function tooLargeMessage(): string {
  return `This file is too large. You can upload files up to ${MAX_IMAGE_UPLOAD_SIZE_LABEL}.`;
}

export function validateUploadSize(file: File): { ok: true } | { ok: false; message: string } {
  if (file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
    return { ok: false, message: tooLargeMessage() };
  }
  return { ok: true };
}
