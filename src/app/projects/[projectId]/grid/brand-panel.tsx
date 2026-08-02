"use client";

import { useActionState, useEffect, useState } from "react";
import { updateGridSettings, updateProfilePreview } from "@/lib/actions/projects";
import type { Platform } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog } from "@/components/ui/dialog";

const labelClass = "text-xs tracking-wide text-muted uppercase";
const inputClass =
  "w-full border-0 border-b border-border bg-transparent py-1 text-sm focus:border-foreground focus:outline-none";

export function BrandPanel({
  projectId,
  projectName,
  brandNotes,
  platform,
  igUsername,
  igDisplayName,
  igBio,
  igPostsCount,
  igFollowersCount,
  igFollowingCount,
  igWebsiteLink,
  igHandle,
  profilePhotoUrl,
  showScheduledDates,
  postsCount,
  canManage,
}: {
  projectId: string;
  projectName: string;
  brandNotes: string;
  platform: Platform;
  igUsername: string;
  igDisplayName: string;
  igBio: string;
  igPostsCount: number;
  igFollowersCount: number;
  igFollowingCount: number;
  igWebsiteLink: string;
  igHandle: string;
  profilePhotoUrl: string | null;
  showScheduledDates: boolean;
  postsCount: number;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(
    updateGridSettings.bind(null, projectId),
    undefined,
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const editable = canManage && editMode;

  return (
    <div className="flex flex-col gap-8 text-sm">
      {canManage && (
        <div className="flex items-center justify-between">
          <span className={labelClass}>Edit Mode</span>
          <Switch checked={editMode} onChange={setEditMode} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Button type="button" variant="secondary" onClick={() => setProfileOpen(true)} className="w-full">
          Edit Profile
        </Button>
        <Button type="button" variant="secondary" onClick={() => setNotesOpen(true)} className="w-full">
          Add Notes
        </Button>
      </div>

      <form action={action} className="flex flex-col gap-8">
        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>Platform</span>
          {editable ? (
            <select name="platform" defaultValue={platform} className={inputClass}>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
            </select>
          ) : (
            <p className="text-sm capitalize">{platform}</p>
          )}
        </div>

        <p className={labelClass}>{postsCount} posts</p>

        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>Profile preview</span>
          <p className="text-xs text-muted">
            Username, bio, followers &amp; photo shown on the profile preview.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>Account (Instagram handle)</span>
          {editable ? (
            <>
              <input name="ig_handle" defaultValue={igHandle} placeholder="@handle" className={inputClass} />
              <p className="text-[11px] text-muted">Manual reference only — not a live connection.</p>
            </>
          ) : (
            <p className="text-sm">{igHandle || "—"}</p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className={labelClass}>Scheduled dates</span>
          {editable ? (
            <Switch name="show_scheduled_dates" defaultChecked={showScheduledDates} />
          ) : (
            <span className="text-sm text-muted">{showScheduledDates ? "On" : "Off"}</span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>Notes &amp; settings</span>
          <p className="text-sm">{projectName}</p>
          {editable ? (
            <textarea
              name="brand_notes"
              defaultValue={brandNotes}
              rows={6}
              placeholder="Brand voice, content pillars, posting cadence..."
              className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm focus:border-foreground focus:outline-none"
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-muted">{brandNotes || "No notes yet."}</p>
          )}
        </div>

        {editable && (
          <Button type="submit" variant="primary" disabled={pending} className="self-start">
            {pending ? "Saving..." : "Save"}
          </Button>
        )}
        {state?.message && <p className="text-xs text-error">{state.message}</p>}
        {state?.success && !state?.message && <p className="text-xs text-success">Saved.</p>}
      </form>

      <ProfilePreviewDialog
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        projectId={projectId}
        igUsername={igUsername}
        igDisplayName={igDisplayName}
        igBio={igBio}
        igPostsCount={igPostsCount}
        igFollowersCount={igFollowersCount}
        igFollowingCount={igFollowingCount}
        igWebsiteLink={igWebsiteLink}
        profilePhotoUrl={profilePhotoUrl}
      />

      <NotesDialog
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        projectId={projectId}
        brandNotes={brandNotes}
        platform={platform}
        igHandle={igHandle}
        showScheduledDates={showScheduledDates}
      />
    </div>
  );
}

function NotesDialog({
  open,
  onClose,
  projectId,
  brandNotes,
  platform,
  igHandle,
  showScheduledDates,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  brandNotes: string;
  platform: Platform;
  igHandle: string;
  showScheduledDates: boolean;
}) {
  const [state, action, pending] = useActionState(
    updateGridSettings.bind(null, projectId),
    undefined,
  );

  useEffect(() => {
    if (state?.success) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onClose={onClose} title="Add notes">
      <form action={action} className="flex flex-col gap-6">
        <input type="hidden" name="platform" value={platform} />
        <input type="hidden" name="ig_handle" value={igHandle} />
        {showScheduledDates && <input type="hidden" name="show_scheduled_dates" value="on" />}

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Notes &amp; settings</span>
          <textarea
            name="brand_notes"
            defaultValue={brandNotes}
            rows={6}
            placeholder="Brand voice, content pillars, posting cadence..."
            className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm focus:border-foreground focus:outline-none"
          />
        </label>

        {state?.message && <p className="text-xs text-error">{state.message}</p>}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-xs tracking-wide text-muted uppercase hover:text-foreground"
          >
            Cancel
          </button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ProfilePreviewDialog({
  open,
  onClose,
  projectId,
  igUsername,
  igDisplayName,
  igBio,
  igPostsCount,
  igFollowersCount,
  igFollowingCount,
  igWebsiteLink,
  profilePhotoUrl,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  igUsername: string;
  igDisplayName: string;
  igBio: string;
  igPostsCount: number;
  igFollowersCount: number;
  igFollowingCount: number;
  igWebsiteLink: string;
  profilePhotoUrl: string | null;
}) {
  const [state, action, pending] = useActionState(
    updateProfilePreview.bind(null, projectId),
    undefined,
  );

  useEffect(() => {
    if (state?.success) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onClose={onClose} title="Edit profile">
      <form action={action} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className={labelClass}>Profile picture</span>
          <div className="flex items-center gap-3">
            {profilePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profilePhotoUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
            ) : (
              <div className="h-14 w-14 rounded-full bg-border" />
            )}
            <label>
              <span className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs tracking-wide uppercase hover:border-foreground/40">
                Upload new
              </span>
              <input type="file" name="profile_photo" accept="image/*" className="hidden" />
            </label>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Username</span>
          <input name="ig_username" defaultValue={igUsername} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Display name</span>
          <input name="ig_display_name" defaultValue={igDisplayName} className={inputClass} />
        </label>

        <div className="grid grid-cols-3 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Posts</span>
            <input type="number" name="ig_posts_count" defaultValue={igPostsCount} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Followers</span>
            <input type="number" name="ig_followers_count" defaultValue={igFollowersCount} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Following</span>
            <input type="number" name="ig_following_count" defaultValue={igFollowingCount} className={inputClass} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Bio</span>
          <textarea
            name="ig_bio"
            defaultValue={igBio}
            rows={3}
            placeholder="A few lines about the brand."
            className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm focus:border-foreground focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Website link</span>
          <input
            name="ig_website_link"
            defaultValue={igWebsiteLink}
            placeholder="www.example.com"
            className={inputClass}
          />
        </label>

        {state?.message && <p className="text-xs text-error">{state.message}</p>}

        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="text-xs tracking-wide text-muted uppercase hover:text-foreground"
          >
            Cancel
          </button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving..." : "Save profile"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
