import type { Metadata } from "next";
import { Poppins, Fraunces } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// The "Flow" wordmark's own font, everywhere the app name appears (header,
// footer, marketing nav) -- deliberately not applied site-wide, the rest of
// the UI stays on Poppins.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Flow:er",
  description: "Internal content planning tool for feed grids, calendars, stories, and design tasks.",
};

// Reads a small JSON cookie (set by Account > Preferences whenever theme or
// reduce-motion changes -- see updatePreferences in lib/actions/settings.ts)
// so data-theme/data-reduce-motion land on <html> in the FIRST server
// response, before any client JS runs -- no flash of the wrong theme, and
// no Supabase round trip on every single page load (this layout also wraps
// logged-out marketing pages). No cookie yet (new/never-saved user) means no
// attribute at all, which falls through to :root's light values in
// globals.css -- Light is the default, there's no "system" mode.
async function readThemePrefs(): Promise<{ theme?: "light" | "dark"; reduceMotion: boolean }> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("theme_prefs")?.value;
  if (!raw) return { reduceMotion: false };
  try {
    const parsed = JSON.parse(raw) as { theme?: string; reduce_motion?: boolean };
    const theme = parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : undefined;
    return { theme, reduceMotion: Boolean(parsed.reduce_motion) };
  } catch {
    return { reduceMotion: false };
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { theme, reduceMotion } = await readThemePrefs();

  return (
    <html
      lang="en"
      data-theme={theme}
      data-reduce-motion={reduceMotion ? "true" : undefined}
      className={`${poppins.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
