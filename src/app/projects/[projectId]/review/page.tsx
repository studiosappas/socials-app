import { createClient } from "@/lib/supabase/server";
import { getReviewGalleryData } from "@/lib/data/review";
import { ReviewGallery } from "./review-gallery";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Whole-project read access -- every role that reaches this page (any
  // project member, not just Client Reviewer -- owner/admin land here too
  // when they navigate to it directly) sees every post/story, matching the
  // confirmed "Reviewer scope" decision. The actual access boundary is
  // membership itself, already enforced one layer up in layout.tsx (a
  // non-member never gets a `project` row back there at all).
  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user!.id)
    .maybeSingle();

  const { projectName, items } = await getReviewGalleryData(projectId);

  return (
    <ReviewGallery
      projectId={projectId}
      projectName={projectName}
      items={items}
      viewerRole={membership?.role ?? "viewer"}
    />
  );
}
