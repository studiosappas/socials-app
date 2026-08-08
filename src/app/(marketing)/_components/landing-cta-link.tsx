import Link from "next/link";

type Variant = "primary" | "secondary" | "ghost";
type Radius = "md" | "none" | "full";

// src/components/ui/button.tsx renders a real <button> with no polymorphic
// "asChild" escape hatch -- CTAs need real <a> semantics (right-click open
// in new tab, no-JS navigation), so this mirrors Button's exact class
// tables rather than nesting a Link inside a button element.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-black/85",
  secondary: "bg-card border border-border text-foreground hover:border-foreground/30",
  ghost: "text-foreground hover:bg-black/[0.03]",
};

const RADIUS_CLASSES: Record<Radius, string> = {
  md: "rounded-md",
  none: "rounded-none",
  full: "rounded-full",
};

export function LandingCtaLink({
  href,
  variant = "secondary",
  radius = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  radius?: Radius;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center px-4 py-2 text-sm transition-colors duration-150 ${RADIUS_CLASSES[radius]} ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}
