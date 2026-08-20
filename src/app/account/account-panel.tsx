"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { updateAccountPassword, updateAccountProfile, updatePreferences, updateWorkspaceSettings } from "@/lib/actions/settings";
import { validateUploadSize, tooLargeMessage } from "@/lib/upload-limits";
import { createClient } from "@/lib/supabase/client";
import {
  DATE_FORMAT_OPTIONS,
  LANDING_PAGE_OPTIONS,
  LANGUAGE_OPTIONS,
  type UserPreferences,
  type WorkspaceSettings,
} from "@/lib/account-settings";

const fieldLabelClass = "text-sm font-medium text-foreground";
const sectionLabelClass = "text-xs tracking-wide text-muted uppercase";
const inputClass =
  "w-full border-0 border-b border-border bg-transparent py-2 text-sm focus:border-foreground focus:outline-none";

// Computed once, client-side only (this whole file is "use client") --
// Intl.supportedValuesOf is what makes the Timezone field a real searchable
// dropdown (via <datalist>) without a new dependency. Falls back to just
// UTC on a runtime old enough not to have it, rather than crashing.
const TIMEZONE_OPTIONS: string[] =
  typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["UTC"];

export function AccountPanel({
  name,
  email,
  avatarUrl,
  workspaceSettings,
  preferences,
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
  workspaceSettings: WorkspaceSettings;
  preferences: UserPreferences;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ProfileCard name={name} email={email} avatarUrl={avatarUrl} />
      <SecurityCard />
      <WorkspaceCard settings={workspaceSettings} />
      <PreferencesCard preferences={preferences} />
    </div>
  );
}

// One reusable shell for every section -- title, optional description, then
// whatever the section needs. Keeping this generic (rather than one-off
// markup per card) is what lets Security/Workspace/Preferences grow later
// without the page itself needing another pass.
function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-6 sm:p-8">
      <div className="mb-6 flex flex-col gap-1">
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={fieldLabelClass}>{label}</span>
      {children}
      {helper && <span className="text-xs text-muted">{helper}</span>}
    </label>
  );
}

function ProfileCard({
  name: initialName,
  email: initialEmail,
  avatarUrl,
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(updateAccountProfile, undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();

  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [savedName, setSavedName] = useState(initialName);
  const [savedEmail, setSavedEmail] = useState(initialEmail);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);

  // Local object URL for a freshly-picked file -- computed directly (not
  // stored+set in an effect) so there's a single source of truth per
  // avatarFile; the effect below only handles the revoke side effect.
  const avatarPreviewUrl = useMemo(() => (avatarFile ? URL.createObjectURL(avatarFile) : null), [avatarFile]);
  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

  // Resets the "what's saved" baseline the moment a save succeeds -- adjusts
  // state during render (React's own documented pattern for "reset derived
  // state when a value changes") rather than in an effect, since the reset
  // itself needs no separate synchronization with anything external.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) {
      setSavedName(name);
      setSavedEmail(email);
      setAvatarFile(null);
      setAvatarRemoved(false);
    }
  }

  // The two things that are genuinely external-system side effects (as
  // opposed to the state resets above) stay in an effect of their own.
  useEffect(() => {
    if (!state?.success) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      const sizeCheck = validateUploadSize(file);
      if (!sizeCheck.ok) {
        setUploadError(sizeCheck.message);
        e.target.value = "";
        return;
      }
    }
    setUploadError(undefined);
    setAvatarFile(file);
    if (file) setAvatarRemoved(false);
  }

  function handleRemove() {
    setAvatarFile(null);
    setAvatarRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // The photo itself goes direct browser-to-Storage (avatars bucket, same
  // ${userId}/avatar.ext + upsert:true convention the server action used to
  // use itself) before the action ever runs -- bypasses Vercel's Function
  // request-body limit entirely. Name/email/remove_avatar still travel
  // through the action's own FormData as before, just without the file.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setUploadError(undefined);
    startTransition(async () => {
      const formData = new FormData(formEl);
      formData.delete("avatar");

      if (avatarFile) {
        setUploading(true);
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setUploading(false);
          setUploadError("Not signed in.");
          return;
        }
        const ext = avatarFile.name.includes(".") ? avatarFile.name.split(".").pop() : undefined;
        const path = `${user.id}/avatar${ext ? `.${ext}` : ""}`;
        const supabaseUpload = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { contentType: avatarFile.type, upsert: true });
        setUploading(false);
        if (supabaseUpload.error) {
          setUploadError(
            supabaseUpload.error.message.toLowerCase().includes("size")
              ? tooLargeMessage()
              : "Couldn't upload this photo. Please try again.",
          );
          return;
        }
        formData.set("avatar_storage_path", path);
      }

      action(formData);
    });
  }

  const displayedAvatarUrl = avatarRemoved ? null : (avatarPreviewUrl ?? avatarUrl);
  const isDirty =
    name.trim() !== savedName || email.trim() !== savedEmail || avatarFile !== null || avatarRemoved;

  return (
    <SettingsCard title="Profile" description="Your name, photo, and how people can reach you.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <input type="hidden" name="remove_avatar" value={avatarRemoved ? "true" : "false"} />

        <div className="flex items-center gap-5">
          <div className="relative h-24 w-24 shrink-0">
            {displayedAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayedAvatarUrl} alt="" className="h-24 w-24 rounded-full object-cover" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-black/[.04] text-2xl uppercase text-muted">
                {(name || "?").slice(0, 1)}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <label>
                <span className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 hover:border-foreground/40">
                  {avatarUrl || avatarPreviewUrl ? "Replace photo" : "Upload photo"}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  name="avatar"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
              {displayedAvatarUrl && (
                <button
                  type="button"
                  onClick={handleRemove}
                  className="text-xs tracking-wide text-muted uppercase transition-colors duration-150 hover:text-error"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-xs text-muted">PNG or JPG, square images look best.</p>
          </div>
        </div>

        <Field label="Name">
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputClass}
          />
        </Field>

        <Field label="Email" helper="Changing this sends a confirmation link to your new address.">
          <input
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={inputClass}
          />
        </Field>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending || uploading || !isDirty} className="w-fit">
            {uploading ? "Uploading…" : pending ? "Saving…" : "Save Changes"}
          </Button>
          {uploadError ? (
            <span className="text-xs text-error">{uploadError}</span>
          ) : (
            <StatusNote pending={pending} state={state} />
          )}
        </div>
      </form>
    </SettingsCard>
  );
}

function SecurityCard() {
  const [state, action, pending] = useActionState(updateAccountPassword, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) {
      setPassword("");
      setConfirmPassword("");
    }
  }

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  const canSubmit = password.length >= 8 && password === confirmPassword;

  return (
    <SettingsCard title="Security" description="Manage your password and how you sign in.">
      <form ref={formRef} action={action} className="flex flex-col gap-6">
        <Field label="New password">
          <input
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className={inputClass}
          />
        </Field>
        <Field label="Confirm password">
          <input
            name="confirm_password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className={inputClass}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending || !canSubmit} className="w-fit">
            {pending ? "Updating…" : "Update Password"}
          </Button>
          <StatusNote pending={pending} state={state} successLabel="Password updated." />
        </div>
      </form>
    </SettingsCard>
  );
}

function WorkspaceCard({ settings: initial }: { settings: WorkspaceSettings }) {
  const [state, action, pending] = useActionState(updateWorkspaceSettings, undefined);
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) setSaved(values);
  }

  function set<K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const isDirty = JSON.stringify(values) !== JSON.stringify(saved);

  return (
    <SettingsCard title="Workspace" description="Defaults that apply across every project you work in.">
      <form action={action} className="flex flex-col gap-6">
        <Field label="Language">
          <Select name="language" value={values.language} onChange={(v) => set("language", v)} options={LANGUAGE_OPTIONS} />
        </Field>

        <Field label="Timezone">
          <input
            name="timezone"
            list="timezone-options"
            value={values.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            className={inputClass}
          />
          <datalist id="timezone-options">
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </Field>

        <Field label="Date Format">
          <Select
            name="date_format"
            value={values.date_format}
            onChange={(v) => set("date_format", v)}
            options={DATE_FORMAT_OPTIONS}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Week Starts On</span>
          <input type="hidden" name="week_starts_on" value={values.week_starts_on} />
          <SegmentedControl
            value={String(values.week_starts_on)}
            onChange={(v) => set("week_starts_on", (v === "1" ? 1 : 0) as WorkspaceSettings["week_starts_on"])}
            options={[
              { value: "1", label: "Monday" },
              { value: "0", label: "Sunday" },
            ]}
          />
        </div>

        <Field label="Default Home Page">
          <Select
            name="default_landing_page"
            value={values.default_landing_page}
            onChange={(v) => set("default_landing_page", v)}
            options={LANDING_PAGE_OPTIONS}
          />
        </Field>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending || !isDirty} className="w-fit">
            {pending ? "Saving…" : "Save Workspace Settings"}
          </Button>
          <StatusNote pending={pending} state={state} />
        </div>
      </form>
    </SettingsCard>
  );
}

function PreferencesCard({ preferences: initial }: { preferences: UserPreferences }) {
  const [state, action, pending] = useActionState(updatePreferences, undefined);
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) setSaved(values);
  }

  function setNotif(key: keyof UserPreferences["notifications"], v: boolean) {
    setValues((p) => ({ ...p, notifications: { ...p.notifications, [key]: v } }));
  }
  function setInterfaceOpt(key: keyof UserPreferences["interface"], v: boolean) {
    setValues((p) => ({ ...p, interface: { ...p.interface, [key]: v } }));
  }

  const isDirty = JSON.stringify(values) !== JSON.stringify(saved);

  return (
    <SettingsCard title="Preferences" description="How Flow:er looks and behaves for you.">
      <form action={action} className="flex flex-col gap-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className={sectionLabelClass}>Theme</span>
            <span className="text-sm text-foreground">{values.theme === "dark" ? "Dark" : "Light"}</span>
          </div>
          <input type="hidden" name="theme" value={values.theme} />
          <ThemeSwitch
            value={values.theme}
            onChange={(v) => {
              setValues((p) => ({ ...p, theme: v }));
              // Instant preview, independent of Save -- a plain DOM write in
              // the click handler (not an effect/render) so flipping the
              // switch is felt immediately; an unsaved change reverts on the
              // next full load since only Save actually persists the
              // theme_prefs cookie this reads from (see layout.tsx).
              document.documentElement.setAttribute("data-theme", v);
            }}
          />
        </div>

        <div className="flex flex-col gap-2.5">
          <span className={sectionLabelClass}>Notifications</span>
          <Checkbox
            name="notif_email"
            checked={values.notifications.email}
            onChange={(v) => setNotif("email", v)}
            label="Email notifications"
          />
          <Checkbox
            name="notif_in_app"
            checked={values.notifications.in_app}
            onChange={(v) => setNotif("in_app", v)}
            label="In-app notifications"
          />
          <Checkbox
            name="notif_task_assignments"
            checked={values.notifications.task_assignments}
            onChange={(v) => setNotif("task_assignments", v)}
            label="Task assignments"
          />
          <Checkbox
            name="notif_client_review"
            checked={values.notifications.client_review}
            onChange={(v) => setNotif("client_review", v)}
            label="Client Review updates"
          />
          <Checkbox
            name="notif_ai_generation"
            checked={values.notifications.ai_generation}
            onChange={(v) => setNotif("ai_generation", v)}
            label="AI generation completed"
          />
          <Checkbox
            name="notif_daily_summary"
            checked={values.notifications.daily_summary}
            onChange={(v) => setNotif("daily_summary", v)}
            label="Daily summary"
          />
        </div>

        <div className="flex flex-col gap-3">
          <span className={sectionLabelClass}>Calendar</span>
          {/* Not a name'd form field -- there's only one view today, so the
              server action always writes "month" regardless. Left as a real
              (disabled) select rather than removed, so the control is
              already in place the moment a second view exists. */}
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabelClass}>Default View</span>
            <select value="month" disabled className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}>
              <option value="month">Month</option>
            </select>
          </label>
          <Checkbox
            name="calendar_show_weekends"
            checked={values.calendar.show_weekends}
            onChange={(v) => setValues((p) => ({ ...p, calendar: { ...p.calendar, show_weekends: v } }))}
            label="Show weekends"
          />
        </div>

        <div className="flex flex-col gap-2.5">
          <span className={sectionLabelClass}>Interface</span>
          <Checkbox
            name="interface_compact_mode"
            checked={values.interface.compact_mode}
            onChange={(v) => setInterfaceOpt("compact_mode", v)}
            label="Compact Mode"
          />
          <Checkbox
            name="interface_reduce_motion"
            checked={values.interface.reduce_motion}
            onChange={(v) => setInterfaceOpt("reduce_motion", v)}
            label="Reduce Motion"
          />
          <Checkbox
            name="interface_show_ai_tips"
            checked={values.interface.show_ai_tips}
            onChange={(v) => setInterfaceOpt("show_ai_tips", v)}
            label="Show AI Tips"
          />
          <Checkbox
            name="interface_auto_expand_comments"
            checked={values.interface.auto_expand_comments}
            onChange={(v) => setInterfaceOpt("auto_expand_comments", v)}
            label="Auto-expand comments"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending || !isDirty} className="w-fit">
            {pending ? "Saving…" : "Save Preferences"}
          </Button>
          <StatusNote pending={pending} state={state} />
        </div>
      </form>
    </SettingsCard>
  );
}

// iOS-style sliding switch, used for the two-way Light/Dark toggle -- a
// pill track + circular thumb reads as more "satisfying" to flip than a
// segmented pair of buttons for a binary choice, and leaves room for a
// small sun/moon glyph riding along on the thumb.
function ThemeSwitch({
  value,
  onChange,
}: {
  value: "light" | "dark";
  onChange: (value: "light" | "dark") => void;
}) {
  const isDark = value === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle dark mode"
      onClick={() => onChange(isDark ? "light" : "dark")}
      className={`relative flex h-8 w-14 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ease-out ${
        isDark ? "bg-foreground" : "bg-black/[.12]"
      }`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full bg-card shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out ${
          isDark ? "translate-x-6" : "translate-x-0"
        }`}
      >
        {isDark ? <MoonIcon className="h-3.5 w-3.5 text-foreground" /> : <SunIcon className="h-3.5 w-3.5 text-muted" />}
      </span>
    </button>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />
    </svg>
  );
}

// Same pill-row visual already established by the Tasks toolbar's List/Board
// and Active/Completed toggles -- reused here for Week Starts On.
function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex w-fit items-center rounded-full border border-border bg-black/[.02] p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-full px-3.5 py-1.5 text-xs tracking-wide uppercase transition-colors duration-150 ${
            value === opt.value ? "bg-card text-foreground shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Same h-3.5 w-3.5 accent-foreground checkbox already used on the existing
// per-project Notifications settings page. Native checkboxes omit
// themselves from FormData entirely when unchecked, so the server action's
// formData.get(name) === "on" check (same pattern updateNotificationPrefs
// already uses) needs no hidden-field workaround, unlike the segmented
// controls above.
function Checkbox({
  name,
  checked,
  onChange,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2.5 text-sm text-foreground">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-foreground"
      />
      {label}
    </label>
  );
}

function StatusNote({
  pending,
  state,
  successLabel = "Saved.",
}: {
  pending: boolean;
  state: { message?: string; success?: boolean } | undefined;
  successLabel?: string;
}) {
  if (pending || !state) return null;
  if (state.message) {
    return (
      <p className={`animate-settle-in text-xs ${state.success ? "text-success" : "text-error"}`}>
        {state.message}
      </p>
    );
  }
  if (state.success) {
    return <p className="animate-settle-in text-xs text-success">{successLabel}</p>;
  }
  return null;
}
