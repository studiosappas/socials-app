import { redirect } from "next/navigation";

// Overview now lives at its own segment (./overview), same as every other
// tab (grid, stories, calendar, ...) -- see that folder's own page.tsx for
// why. This bare segment just forwards any old link/bookmark to the real
// route; it renders no UI of its own, so it needs no loading.tsx (redirect()
// throws immediately during render, before anything would need a fallback).
export default async function ProjectRootPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/overview`);
}
