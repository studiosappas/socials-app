import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

// Reached only two ways: the /auth/callback route after a successful
// recovery-link code exchange (a real session now exists), or directly
// (bookmarked, reused, or a link /auth/callback marked ?error=invalid_link
// because the code was missing/expired/already used). Checking for a
// session here (not just trusting the query param) covers both "the link
// was invalid" and "there never was a session to begin with" the same way.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const invalid = Boolean(error) || !user;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex w-full max-w-sm flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Account recovery</p>
        <h1 className="text-2xl font-light">{invalid ? "Link expired." : "Set a new password."}</h1>
      </div>
      {invalid ? (
        <div className="flex w-full max-w-sm flex-col gap-6">
          <p className="text-sm text-muted">
            This password reset link is invalid, expired, or has already been used.
          </p>
          <Link href="/login/forgot-password" className="text-sm text-foreground underline underline-offset-2">
            Request a new reset link
          </Link>
        </div>
      ) : (
        <ResetPasswordForm />
      )}
    </main>
  );
}
