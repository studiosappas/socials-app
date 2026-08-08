import Link from "next/link";
import { FOOTER_CONTENT, NAV_CONTENT } from "@/lib/landing";
import { LandingCtaLink } from "./landing-cta-link";

export function LandingFooter() {
  return (
    <footer className="border-t border-border px-4 py-16 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-center">
        <h2 className="text-2xl font-light">{FOOTER_CONTENT.ctaHeadline}</h2>
        <LandingCtaLink href={FOOTER_CONTENT.primaryCta.href} variant="primary" radius="full" className="normal-case">
          {FOOTER_CONTENT.primaryCta.label}
        </LandingCtaLink>
        <p className="mt-6 text-xs tracking-wide text-muted uppercase">{FOOTER_CONTENT.tagline}</p>
        <div className="mt-4 flex items-center gap-6 text-xs tracking-wide text-muted uppercase">
          <Link href={NAV_CONTENT.links.pricing.href} className="transition-colors duration-150 hover:text-foreground">
            {NAV_CONTENT.links.pricing.label}
          </Link>
          <Link href={NAV_CONTENT.links.login.href} className="transition-colors duration-150 hover:text-foreground">
            {NAV_CONTENT.links.login.label}
          </Link>
        </div>
      </div>
    </footer>
  );
}
