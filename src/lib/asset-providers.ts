import type { AssetProvider, AssetType } from "@/types/database";

export const PROVIDER_LABEL: Record<AssetProvider, string> = {
  google_drive: "Google Drive",
  dropbox: "Dropbox",
  box: "Box",
  onedrive: "OneDrive",
  collect: "Collect",
  other: "Other",
};

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  product_photography: "Product Photography",
  campaign: "Campaign",
  lifestyle: "Lifestyle",
  packaging: "Packaging",
  ugc: "UGC",
  moodboard: "Moodboard",
  videos: "Videos",
  references: "References",
  other: "Other",
};

export const PROVIDER_OPTIONS = Object.keys(PROVIDER_LABEL) as AssetProvider[];
export const ASSET_TYPE_OPTIONS = Object.keys(ASSET_TYPE_LABEL) as AssetType[];

// Host-pattern matching only -- there's no OAuth/API integration with any of
// these providers, so this never confirms the URL actually works, just
// guesses which badge/icon to show and lets "Open Collection" send the user
// to the right kind of place. Returns null when nothing matches, so the
// caller can fall back to asking the user to pick manually.
export function detectProvider(url: string): AssetProvider | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.includes("drive.google.com") || host.includes("docs.google.com")) return "google_drive";
  if (host.includes("dropbox.com")) return "dropbox";
  if (host.includes("box.com")) return "box";
  if (host.includes("onedrive.live.com") || host.includes("1drv.ms") || host.includes("sharepoint.com")) {
    return "onedrive";
  }
  if (host.includes("collect.so") || host.includes("collect.co") || host.includes("collect.app")) return "collect";
  return null;
}
