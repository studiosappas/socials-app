import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Radius = "md" | "none" | "full";

const VARIANT_CLASSES: Record<Variant, string> = {
  // text-accent-foreground (not a hardcoded text-white) -- accent flips to a
  // light color in dark mode (see globals.css), so the text needs to flip
  // with it. hover:opacity-85 works either direction, unlike the old
  // hover:bg-black/85 (which only ever darkened, wrong once accent itself
  // is already light).
  primary: "bg-accent text-accent-foreground hover:opacity-85",
  secondary: "bg-card border border-border text-foreground hover:border-foreground/30",
  ghost: "text-foreground hover:bg-black/[0.03]",
};

const RADIUS_CLASSES: Record<Radius, string> = {
  md: "rounded-md",
  none: "rounded-none",
  full: "rounded-full",
};

export function Button({
  variant = "secondary",
  radius = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; radius?: Radius }) {
  return (
    <button
      className={`${RADIUS_CLASSES[radius]} px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
