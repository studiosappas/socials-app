import type { Metadata } from "next";
import { getSharedPreviewData } from "@/lib/data/share-preview";
import { SharedGallery } from "./shared-gallery";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const data = await getSharedPreviewData(token);
  if (!data) return { title: "Preview Unavailable" };
  return { title: data.title || `${data.projectName} — Preview` };
}

export default async function SharedPreviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getSharedPreviewData(token);

  if (!data) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <span className="text-xs tracking-wide text-muted uppercase">Preview Unavailable</span>
        <p className="max-w-xs text-sm text-muted">This link is no longer available. Ask for a new one if you still need it.</p>
      </div>
    );
  }

  return <SharedGallery title={data.title} projectName={data.projectName} items={data.items} />;
}
