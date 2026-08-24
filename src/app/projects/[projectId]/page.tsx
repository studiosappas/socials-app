import { endOfWeek, format, startOfWeek } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrl } from "@/lib/signed-url-cache";
import { hasPagePermission } from "@/lib/role-permissions";
import { AnimatedNumber } from "./animated-number";
import {
  AiRecommendationsPanel,
  BrandIntelligenceSection,
  ProfilePanel,
  WorkplaceInsightsPanel,
} from "./overview-panels";
import { AccessRestricted } from "./access-restricted";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const weekStart = format(startOfWeek(new Date()), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(new Date()), "yyyy-MM-dd");
  const today = format(new Date(), "yyyy-MM-dd");

  const [
    { data: project },
    { data: membership },
    { data: sections },
    { count: postsThisWeek },
    { count: storiesThisWeek },
    { count: unscheduledPosts },
    { count: unscheduledStories },
    { count: postsToday },
    { count: storiesToday },
    { data: tasksDueToday },
    { count: inReviewCount },
    { data: draftPostsNoDate },
    { data: draftStoriesNoDate },
    { data: trackedTasks },
    { data: strategyRow },
    { data: documentRows },
    { data: socialLinks },
  ] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "name, brand_notes, content_pillars, ig_username, ig_display_name, ig_bio, ig_website_link, industry, platform, profile_photo_path, posts_per_week, stories_per_week, reels_per_week, newsletter_per_week",
      )
      .eq("id", projectId)
      .single(),
    supabase
      .from("project_members")
      .select("role, custom_permissions")
      .eq("project_id", projectId)
      .eq("user_id", user!.id)
      .single(),
    supabase.from("project_sections").select("id, title, body").eq("project_id", projectId).order("position"),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gte("scheduled_date", weekStart)
      .lte("scheduled_date", weekEnd),
    supabase
      .from("stories")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gte("scheduled_date", weekStart)
      .lte("scheduled_date", weekEnd),
    supabase.from("posts").select("*", { count: "exact", head: true }).eq("project_id", projectId).is("scheduled_date", null),
    supabase.from("stories").select("*", { count: "exact", head: true }).eq("project_id", projectId).is("scheduled_date", null),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("scheduled_date", today),
    supabase
      .from("stories")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("scheduled_date", today),
    supabase
      .from("tasks")
      .select("id, title")
      .eq("project_id", projectId)
      .eq("user_id", user!.id)
      .eq("due_date", today)
      .neq("status", "done"),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "in_review"),
    supabase.from("posts").select("id").eq("project_id", projectId).eq("status", "draft").is("scheduled_date", null),
    supabase.from("stories").select("id").eq("project_id", projectId).eq("status", "draft").is("scheduled_date", null),
    supabase.from("tasks").select("source_id, source_type").eq("project_id", projectId).in("source_type", ["post", "story"]),
    supabase
      .from("brand_strategy")
      .select(
        "brand_values, vision, voice, positioning, audience_notes, ai_summary, ai_brand_dna, ai_tone_of_voice, ai_communication_style, ai_content_pillars, ai_audience_snapshot, ai_visual_language, ai_avoid, ai_insights, ai_insights_updated_at, spectrum_serious_playful, spectrum_classic_futuristic, spectrum_premium_accessible, spectrum_editorial_commercial, spectrum_minimal_expressive, spectrum_luxury_casual",
      )
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("brand_documents")
      .select("id, source_type, filename, url, ai_analysis, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    // Isolated from the main projects select above -- instagram_url/tiktok_url
    // are new columns that may not exist yet on a not-yet-migrated database,
    // and PostgREST fails the whole select if any referenced column is
    // missing. A pending migration just means these two links read as empty,
    // not that the rest of Overview fails to load.
    supabase.from("projects").select("instagram_url, tiktok_url").eq("id", projectId).maybeSingle(),
  ]);

  if (!membership || !hasPagePermission(membership.role, membership.custom_permissions, "overview")) {
    return <AccessRestricted />;
  }

  const canManage = membership.role === "owner" || membership.role === "admin";

  // The same profile_photo_path nav-data.ts/Grid/Tasks each independently
  // sign for their own display -- routing through the shared cache means
  // whichever of those already signed it wins, and this just reuses that
  // entry instead of minting a 4th signed URL for the same file.
  const profilePhotoUrl = await getCachedSignedUrl(supabase, "project-media", project?.profile_photo_path);

  const trackedPostIds = new Set(
    (trackedTasks ?? []).filter((t) => t.source_type === "post").map((t) => t.source_id),
  );
  const trackedStoryIds = new Set(
    (trackedTasks ?? []).filter((t) => t.source_type === "story").map((t) => t.source_id),
  );
  const untrackedDraftPosts = (draftPostsNoDate ?? []).filter((p) => !trackedPostIds.has(p.id));
  const untrackedDraftStories = (draftStoriesNoDate ?? []).filter((s) => !trackedStoryIds.has(s.id));

  const focusItems: string[] = [];
  if ((postsToday ?? 0) > 0) focusItems.push(`${postsToday} post${postsToday === 1 ? "" : "s"} scheduled`);
  if ((storiesToday ?? 0) > 0) focusItems.push(`${storiesToday} stor${storiesToday === 1 ? "y" : "ies"} waiting`);
  if ((inReviewCount ?? 0) > 0) focusItems.push(`${inReviewCount} approval${inReviewCount === 1 ? "" : "s"} pending`);

  const reminders: string[] = [];
  if (untrackedDraftPosts.length > 0) {
    reminders.push(`${untrackedDraftPosts.length} draft post${untrackedDraftPosts.length === 1 ? "" : "s"} with no scheduled date`);
  }
  if (untrackedDraftStories.length > 0) {
    reminders.push(`${untrackedDraftStories.length} draft stor${untrackedDraftStories.length === 1 ? "y" : "ies"} with no scheduled date`);
  }

  const strategy = {
    brandValues: strategyRow?.brand_values ?? "",
    vision: strategyRow?.vision ?? "",
    voice: strategyRow?.voice ?? "",
    positioning: strategyRow?.positioning ?? "",
    audienceNotes: strategyRow?.audience_notes ?? "",
    aiSummary: strategyRow?.ai_summary ?? "",
    aiBrandDna: strategyRow?.ai_brand_dna ?? "",
    aiToneOfVoice: strategyRow?.ai_tone_of_voice ?? "",
    aiCommunicationStyle: strategyRow?.ai_communication_style ?? "",
    aiContentPillars: strategyRow?.ai_content_pillars ?? "",
    aiAudienceSnapshot: strategyRow?.ai_audience_snapshot ?? "",
    aiVisualLanguage: strategyRow?.ai_visual_language ?? "",
    aiAvoid: strategyRow?.ai_avoid ?? "",
    spectrum: {
      seriousPlayful: strategyRow?.spectrum_serious_playful ?? 50,
      classicFuturistic: strategyRow?.spectrum_classic_futuristic ?? 50,
      premiumAccessible: strategyRow?.spectrum_premium_accessible ?? 50,
      editorialCommercial: strategyRow?.spectrum_editorial_commercial ?? 50,
      minimalExpressive: strategyRow?.spectrum_minimal_expressive ?? 50,
      luxuryCasual: strategyRow?.spectrum_luxury_casual ?? 50,
    },
  };

  const documents = (documentRows ?? []).map((d) => ({
    id: d.id,
    sourceType: d.source_type,
    filename: d.filename,
    url: d.url,
    aiAnalysis: d.ai_analysis,
    createdAt: d.created_at,
  }));

  return (
    <div className="grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-2">
      {/* Left column: each section stacks on its own content height (not
          locked to match the right column's row heights), which is what
          keeps this side from trailing off into a big empty gap. */}
      <div className="flex flex-col gap-12">
        <section>
          <ProfilePanel
            projectId={projectId}
            projectName={project?.name ?? ""}
            brandNotes={project?.brand_notes ?? ""}
            contentPillars={project?.content_pillars ?? ""}
            sections={sections ?? []}
            igUsername={project?.ig_username ?? ""}
            igDisplayName={project?.ig_display_name ?? ""}
            igBio={project?.ig_bio ?? ""}
            websiteUrl={project?.ig_website_link ?? ""}
            industry={project?.industry ?? ""}
            platform={project?.platform ?? "instagram"}
            instagramUrl={socialLinks?.instagram_url ?? ""}
            tiktokUrl={socialLinks?.tiktok_url ?? ""}
            profilePhotoUrl={profilePhotoUrl}
            postsPerWeek={project?.posts_per_week ?? 0}
            storiesPerWeek={project?.stories_per_week ?? 0}
            reelsPerWeek={project?.reels_per_week ?? 0}
            newsletterPerWeek={project?.newsletter_per_week ?? 0}
            canManage={canManage}
          />
        </section>

        <section className="grid grid-cols-2 gap-4 sm:gap-8">
          <StatTile label="Unscheduled Posts" value={unscheduledPosts ?? 0} />
          <StatTile label="Unscheduled Stories" value={unscheduledStories ?? 0} />
          <StatTile label="Posts This Week" value={postsThisWeek ?? 0} />
          <StatTile label="Stories This Week" value={storiesThisWeek ?? 0} />
        </section>

        <section>
          <WorkplaceInsightsPanel items={focusItems} reminders={reminders} tasksDueToday={tasksDueToday ?? []} />
        </section>
      </div>

      <div className="flex flex-col gap-12">
        <section>
          <BrandIntelligenceSection
            projectId={projectId}
            documents={documents}
            strategy={strategy}
            canManage={canManage}
          />
        </section>

        <section>
          <AiRecommendationsPanel
            projectId={projectId}
            insights={strategyRow?.ai_insights ?? null}
            updatedAt={strategyRow?.ai_insights_updated_at ?? null}
            canManage={canManage}
          />
        </section>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-2 border border-border p-4 sm:p-6">
      <span className="text-3xl font-light sm:text-5xl">
        <AnimatedNumber value={value} />
      </span>
      <span className="text-xs tracking-wide text-muted uppercase">{label}</span>
    </div>
  );
}
