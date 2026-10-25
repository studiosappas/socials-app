// A post's chosen EXPORT aspect ratio (posts.aspect_ratio) -- pure, so
// aspect-ratio.test.ts runs under Node.
//
//   Post / Carousel: the exported image(s); a carousel's ratio is set from
//                    its first slide and shared by every image slide
//   standalone Reel: the exported COVER IMAGE (the video file is never touched)
//
// null = a post nobody has chosen a ratio for: every legacy rule applies
// unchanged (lib/media-aspect.ts, lib/cover-framing.ts). The Grid is always
// 3:4 regardless -- it shows the export frame's centred 3:4 window.

export type AspectChoice = "original" | "1:1" | "4:5" | "9:16";

export const ASPECT_CHOICES: readonly AspectChoice[] = ["original", "1:1", "4:5", "9:16"];

const FIXED: Record<Exclude<AspectChoice, "original">, number> = { "1:1": 1, "4:5": 4 / 5, "9:16": 9 / 16 };

export function parseAspectChoice(value: unknown): AspectChoice | null {
  return typeof value === "string" && (ASPECT_CHOICES as readonly string[]).includes(value) ? (value as AspectChoice) : null;
}

export type AspectPostKind = "reel" | "feed";

// Which ratios a post offers. Instagram's feed doesn't take 9:16 images, so
// only a standalone Reel's cover offers it -- and recommends it.
export function aspectOptions(kind: AspectPostKind): AspectChoice[] {
  return kind === "reel" ? ["9:16", "4:5", "1:1", "original"] : ["original", "1:1", "4:5"];
}

// The ratio the editor works in when none is stored yet: a Reel cover
// defaults to 9:16 (written only on an explicit Apply); a feed post keeps
// its legacy behaviour (null).
export function defaultAspectChoice(kind: AspectPostKind): AspectChoice | null {
  return kind === "reel" ? "9:16" : null;
}

// w/h of a choice; "original" is the given source's own aspect.
export function aspectValue(choice: AspectChoice, sourceAspect: number | null | undefined): number | null {
  if (choice === "original") return sourceAspect && sourceAspect > 0 ? sourceAspect : null;
  return FIXED[choice];
}

// Instagram's feed takes 1.91:1 (landscape) to 4:5 (portrait).
export const FEED_MIN_ASPECT = 4 / 5;
export const FEED_MAX_ASPECT = 1.91;

export function aspectWarning(kind: AspectPostKind, choice: AspectChoice, aspect: number | null): string | null {
  if (kind === "reel") {
    return choice === "9:16" ? null : "Instagram shows Reel covers at 9:16 -- this cover may be cropped there.";
  }
  if (choice === "original" && aspect && (aspect < FEED_MIN_ASPECT - 1e-3 || aspect > FEED_MAX_ASPECT + 1e-3)) {
    return "This original ratio is outside what Instagram's feed accepts (1.91:1 to 4:5) -- Instagram may crop it.";
  }
  return null;
}

// Edit Image / Edit Cover's frame for a post with a chosen ratio ({ w, h } as
// the editor takes it), or null to keep the legacy rule.
export function editorAspect(choice: AspectChoice | null, sourceAspect: number | null | undefined): { w: number; h: number } | null {
  if (!choice) return null;
  const a = aspectValue(choice, sourceAspect);
  return a ? { w: a, h: 1 } : null;
}

export const EXPORT_MAX_WIDTH = 1080;

export function aspectLabel(choice: AspectChoice): string {
  return choice === "original" ? "Original" : choice;
}
