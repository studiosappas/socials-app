import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/register");
  // The deliberately-public routes: a Shared Client Preview link is opened
  // by someone with no account at all, and "/" is now the marketing landing
  // page (exact match only -- NOT a prefix, or every route would match) --
  // both must never bounce to /login the way every other route does.
  // "/"'s own page.tsx still redirects an ALREADY-authenticated visitor on
  // to /projects; this just lets an anonymous one reach it at all.
  // "/auth" (the password-recovery callback + set-new-password screen) is
  // public for the same "must always be reachable" reason, but deliberately
  // NOT part of isAuthRoute below -- a password-recovery link intentionally
  // leaves the visitor authenticated (that's what authorizes updating their
  // password), and isAuthRoute's own "authenticated -> bounce to /projects"
  // rule would otherwise redirect them away before they ever see the form.
  const isPublicRoute =
    isAuthRoute ||
    request.nextUrl.pathname.startsWith("/preview") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname === "/";

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/projects";
    return NextResponse.redirect(url);
  }

  return response;
}
