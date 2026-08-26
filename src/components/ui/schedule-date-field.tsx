"use client";

import { formatScheduleDate, type WorkspaceSettings } from "@/lib/account-settings";

// Native input[type=date]'s own visible text is locale-controlled by the
// browser/OS (HTML5 spec keeps the displayed format out of author hands
// on purpose, while `value` stays a locale-independent YYYY-MM-DD string)
// -- there is no attribute or CSS override that makes it show
// "DD/MM/YYYY" vs "MM/DD/YYYY" per the app's own date-format preference.
// So this keeps a REAL native <input type="date"> underneath (the OS
// picker, keyboard entry, and the existing iOS width fix all keep working
// exactly as before -- fieldClassName is expected to already include
// that fix) but makes its own rendered text invisible and lets a plain,
// app-formatted label sit visually on top of it. The label is
// pointer-events-none and purely decorative; the real input still fills
// the same box and paints after it in DOM order, so it receives every
// tap/click.
export function ScheduleDateField({
  value,
  onChange,
  disabled,
  dateFormat,
  fieldClassName,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  dateFormat: WorkspaceSettings["date_format"];
  fieldClassName: string;
  ariaLabel: string;
}) {
  return (
    <div className="relative min-w-0">
      <div aria-hidden className={`${fieldClassName} pointer-events-none flex items-center`}>
        {value ? formatScheduleDate(value, dateFormat) : ""}
      </div>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        className={`${fieldClassName} appearance-none [-webkit-appearance:none] absolute inset-0 opacity-0`}
      />
    </div>
  );
}
