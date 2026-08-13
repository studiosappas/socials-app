// landing-media is a public Supabase Storage bucket (no signed URL needed,
// same pattern as avatars/brief-media) -- this builds the public URL for a
// MediaRef's `src` path directly from NEXT_PUBLIC_SUPABASE_URL, which is
// safe to inline client-side (it's the anon-key project URL, not a secret).
export function landingMediaUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/landing-media/${path}`;
}
