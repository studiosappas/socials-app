"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { LandingCtaLink } from "../landing-cta-link";
import { NAV_CONTENT, EASE } from "@/lib/landing";

// This page has its own nav, separate from the app's internal AppHeader --
// no per-section links (the scroll-progress dots/mobile bar cover that job),
// just the four items the brief asks for. Shrinks + gains a blur background
// once scrolling begins, mirroring AppHeader's own rounded-full pill chrome
// so the shrunk state still reads as the same design system.
export function MarketingNav() {
  const { scrollY } = useScroll();
  const paddingBlock = useTransform(scrollY, [0, 80], [24, 12]);
  const blurOpacity = useTransform(scrollY, [0, 40], [0, 1]);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <motion.header
      style={{ paddingTop: paddingBlock, paddingBottom: paddingBlock }}
      className="sticky top-0 z-50 px-4 sm:px-8"
    >
      <motion.div
        style={{ opacity: blurOpacity }}
        className="absolute inset-0 -z-10 bg-background/80 backdrop-blur-md"
        transition={{ ease: EASE }}
      />
      <nav className="mx-auto flex max-w-6xl items-center justify-between">
        <Link href="/" className="text-sm font-semibold tracking-wide">
          {NAV_CONTENT.logoLabel}
        </Link>

        <div className="hidden items-center gap-6 text-xs tracking-wide uppercase sm:flex">
          <Link href={NAV_CONTENT.links.pricing.href} className="text-muted transition-colors duration-150 hover:text-foreground">
            {NAV_CONTENT.links.pricing.label}
          </Link>
          <Link href={NAV_CONTENT.links.bookDemo.href} className="text-muted transition-colors duration-150 hover:text-foreground">
            {NAV_CONTENT.links.bookDemo.label}
          </Link>
          <Link href={NAV_CONTENT.links.login.href} className="text-muted transition-colors duration-150 hover:text-foreground">
            {NAV_CONTENT.links.login.label}
          </Link>
          <LandingCtaLink href={NAV_CONTENT.links.startFree.href} variant="primary" radius="full" className="normal-case">
            {NAV_CONTENT.links.startFree.label}
          </LandingCtaLink>
        </div>

        {/* Mobile: Start Free always visible (highest-frequency action), the
            rest collapse behind a toggled menu -- AppHeader has no mobile
            menu today to copy, this is a new, minimal pattern. */}
        <div className="flex items-center gap-3 sm:hidden">
          <LandingCtaLink href={NAV_CONTENT.links.startFree.href} variant="primary" radius="full" className="text-xs normal-case">
            {NAV_CONTENT.links.startFree.label}
          </LandingCtaLink>
          <button
            type="button"
            aria-label="Menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center text-foreground"
          >
            <MenuIcon open={menuOpen} />
          </button>
        </div>
      </nav>

      {menuOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="mx-auto mt-4 flex max-w-6xl flex-col gap-3 border-t border-border pt-4 text-sm sm:hidden"
        >
          <Link href={NAV_CONTENT.links.pricing.href} onClick={() => setMenuOpen(false)}>
            {NAV_CONTENT.links.pricing.label}
          </Link>
          <Link href={NAV_CONTENT.links.bookDemo.href} onClick={() => setMenuOpen(false)}>
            {NAV_CONTENT.links.bookDemo.label}
          </Link>
          <Link href={NAV_CONTENT.links.login.href} onClick={() => setMenuOpen(false)}>
            {NAV_CONTENT.links.login.label}
          </Link>
        </motion.div>
      )}
    </motion.header>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {open ? (
        <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <path d="M2 5H16M2 9H16M2 13H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
    </svg>
  );
}
