import { STORAGE_UPLOAD_LIMIT_BYTES } from "@/lib/upload-validation";

// The real ceiling once uploads go direct-to-Supabase-Storage (see
// direct-upload.ts) -- Supabase Storage's own documented Free-tier default,
// also set explicitly on every bucket via a migration (see
// RUN_ALL_PENDING_MIGRATIONS.sql) so it's verified, not assumed. Vercel's
// separate, non-configurable ~4.5MB-per-Function request-body limit no
// longer applies to these paths once the file itself skips the Server
// Action -- that Vercel limit, not Supabase and not next.config.ts's own
// serverActions.bodySizeLimit, was the actual reason a 21MB image used to
// fail regardless of any config value here.
//
// Size checks and their messages now live in upload-validation.ts, per
// upload context; this stays as the same number for the external-media
// importer (external-media-resolver.ts).
export const MAX_IMAGE_UPLOAD_SIZE_BYTES = STORAGE_UPLOAD_LIMIT_BYTES;
