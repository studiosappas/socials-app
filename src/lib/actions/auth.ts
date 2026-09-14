"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { resolveLandingPath } from "@/lib/account-settings";

export type AuthFormState = { message?: string } | undefined;

const LoginSchema = z.object({
  email: z.email({ error: "Enter a valid email." }),
  password: z.string().min(1, { error: "Password is required." }),
});

const SignupSchema = z.object({
  name: z.string().min(2, { error: "Name must be at least 2 characters." }).trim(),
  email: z.email({ error: "Enter a valid email." }),
  password: z.string().min(8, { error: "Password must be at least 8 characters." }),
});

// A copy-pasted or autofilled email can carry leading/trailing whitespace or
// mixed case -- Supabase Auth does not normalize either before matching
// against the stored account, so an otherwise-correct login/signup/reset
// silently fails to match ("Invalid login credentials") purely because of
// invisible whitespace or casing. Applied identically at every entry point
// that ever hands an email to Supabase Auth (login, signup, password
// reset request) so an account's stored identity is consistent everywhere.
function normalizeEmail(raw: FormDataEntryValue | null): string {
  return String(raw ?? "").trim().toLowerCase();
}

// This app has no existing NEXT_PUBLIC_SITE_URL/VERCEL_URL-style env var or
// server-side "build our own absolute URL" helper anywhere (confirmed by
// search -- the only precedent, window.location.origin in share-menu.tsx/
// grid-board.tsx, is client-only and unusable from a Server Action). Deriving
// the origin from the incoming request's own Host header is the standard,
// env-var-free way to get a correct, production-safe URL here: it resolves
// to the real domain in production, the right preview URL on a preview
// deploy, and localhost in dev, automatically -- never a hardcoded value.
async function getSiteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function login(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse({
    email: normalizeEmail(formData.get("email")),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { message: error.message };
  }

  redirect(await resolveLandingPath(supabase, data.user.id));
}

export async function signup(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = SignupSchema.safeParse({
    name: formData.get("name"),
    email: normalizeEmail(formData.get("email")),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { name: parsed.data.name } },
  });

  if (error) {
    return { message: error.message };
  }

  if (!data.session) {
    return { message: "Check your email to confirm your account, then log in." };
  }

  redirect("/projects");
}

const ForgotPasswordSchema = z.object({
  email: z.email({ error: "Enter a valid email." }),
});

export type ForgotPasswordState = { status: "idle" | "sent" | "error"; message?: string };

// Deliberately returns the SAME { status: "sent" } shape whether or not the
// email actually belongs to an account -- resetPasswordForEmail itself
// already never reveals that (it succeeds either way), and this preserves
// that guarantee up through the UI rather than accidentally reintroducing
// an enumeration vector via error handling. An `error` status here means a
// genuine service-level failure (rate limit, network, misconfiguration),
// never "no such user" -- Supabase's own error text is logged, not shown,
// so nothing internal leaks to the client.
export async function requestPasswordReset(
  _state: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = ForgotPasswordSchema.safeParse({ email: normalizeEmail(formData.get("email")) });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid email." };
  }

  const supabase = await createClient();
  const origin = await getSiteOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`,
  });

  if (error) {
    console.error("resetPasswordForEmail failed:", error.message);
    return { status: "error", message: "Something went wrong. Please try again in a moment." };
  }

  return { status: "sent" };
}

const NewPasswordSchema = z
  .object({
    password: z.string().min(8, { error: "Password must be at least 8 characters." }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type UpdatePasswordState = { status: "idle" | "success" | "error"; message?: string };

// Operates on whatever session the /auth/callback route already established
// (the recovery link's own code exchange) -- updateUser reads that session
// from cookies the same way every other authenticated server action does,
// no separate recovery token handling needed. Signs the session out
// immediately after a successful update rather than leaving the recovery
// session active: Supabase does not distinguish a recovery session from an
// ordinary one once established, and requiring a fresh login with the new
// password is the predictable, unsurprising choice already used elsewhere
// in this product (a real login), and it can't produce a redirect loop the
// way silently keeping an ambiguous "authenticated at /auth/reset-password"
// state could.
export async function updateRecoveryPassword(
  _state: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const parsed = NewPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", message: "This reset link has expired or was already used." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("updateUser (password recovery) failed:", error.message);
    return { status: "error", message: "Couldn't update your password. Please request a new reset link." };
  }

  await supabase.auth.signOut();
  return { status: "success" };
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
