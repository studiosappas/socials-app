import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Radius = "md" | "none" | "full";

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
