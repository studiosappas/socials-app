// Same easing curve as src/lib/dnd-motion.ts's EASING constant (that file
// doesn't export it, and Framer wants the array form rather than a CSS
// string) -- duplicated deliberately so every landing-page animation uses
// the exact same "calm, no-bounce" curve the rest of the app's drag/drop
// motion already uses, instead of Framer's spring defaults.
export const EASE = [0.2, 0, 0, 1] as const;

export const REVEAL_TRANSITION = { duration: 0.5, ease: EASE };
