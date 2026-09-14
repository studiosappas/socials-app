import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The one auth-email landing point in this app -- Supabase's own hosted
// verify endpoint (hit first, from the email link itself) redirects here
// with a PKCE `code` once it's checked the token, and this exchanges that
// code for a real session (setting cookies) before handing off to `next`.
// Currently only used by the password-recovery flow (see requestPasswordReset
// in lib/actions/auth.ts), but not written recovery-specific: any future
// Supabase email flow (signup confirmation, email change, magic link) can
// reuse this exact route by pointing its own `redirectTo` here with a
// different `next`.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/projects";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  // Missing/invalid/expired code -- land at the SAME destination the user
  // was heading to (marked as failed) rather than a bare 404 or an
  // unrelated generic error page, so that destination can show its own
  // "request a new link" recovery state.
  const fallback = new URL(next, url.origin);
  fallback.searchParams.set("error", "invalid_link");
  return NextResponse.redirect(fallback);
}
