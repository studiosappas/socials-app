"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { updateProjectSettings } from "@/lib/actions/settings";
import type { Platform } from "@/types/database";

const labelClass = "text-xs tracking-wide text-muted uppercase";
const fieldClass =
  "w-full border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none disabled:text-muted";

const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  youtube: "YouTube",
};
const PLATFORM_OPTIONS: Platform[] = ["instagram", "tiktok", "pinterest", "youtube"];

export function ProjectInformationPanel({
  projectId,
  projectName,
  industry,
  platform,
  ownerName,
  ownerEmail,
  createdDate,
  canManage,
}: {
  projectId: string;
  projectName: string;
  industry: string;
  platform: Platform;
  ownerName: string;
  ownerEmail: string;
  createdDate: string;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(updateProjectSettings.bind(null, projectId), undefined);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(platform);

  return (
    <form action={action} className="flex max-w-md flex-col gap-6">
      <h2 className={labelClass}>Project Information</h2>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Project Name</span>
        <input name="name" defaultValue={projectName} disabled={!canManage} required className={fieldClass} />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Project Owner (Read Only)</span>
        <p className="border-b border-transparent py-1.5 text-sm text-muted">{ownerName}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Owner Email (Read Only)</span>
        <p className="border-b border-transparent py-1.5 text-sm text-muted">{ownerEmail}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Created Date (Read Only)</span>
        <p className="border-b border-transparent py-1.5 text-sm text-muted">{createdDate}</p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Industry</span>
        <input
          name="industry"
          defaultValue={industry}
          disabled={!canManage}
          placeholder="Industry"
          className={fieldClass}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Primary Platform</span>
        <input type="hidden" name="platform" value={selectedPlatform} />
        <div className="flex flex-wrap gap-2">
          {PLATFORM_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={!canManage}
              onClick={() => setSelectedPlatform(p)}
              className={`rounded-full border px-4 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 disabled:cursor-default ${
                selectedPlatform === p
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-foreground hover:border-foreground/40"
              }`}
            >
              {PLATFORM_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {canManage && (
        <Button type="submit" variant="primary" radius="none" disabled={pending} className="w-fit self-start">
          {pending ? "Saving…" : "Save"}
        </Button>
      )}
      {state?.message && <p className="text-xs text-error">{state.message}</p>}
      {state?.success && !state?.message && <p className="text-xs text-success">Saved.</p>}
    </form>
  );
}
