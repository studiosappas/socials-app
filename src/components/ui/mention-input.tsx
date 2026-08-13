"use client";

import { useMemo, useRef, useState } from "react";
import type { MentionableMember } from "@/lib/mentions";

// Finds an in-progress "@query" ending at `caret` -- must start at the
// beginning of the text or right after whitespace, and contain no
// whitespace itself, otherwise there's no active mention to autocomplete.
function findActiveMention(text: string, caret: number): { start: number; query: string } | null {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upToCaret[at - 1])) return null;
  const query = upToCaret.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

export function MentionField({
  value,
  onChange,
  members,
  multiline = false,
  placeholder,
  className = "",
  autoFocus = false,
  rows,
  onKeyDown: onKeyDownProp,
  onBlur: onBlurProp,
  onClick: onClickProp,
}: {
  value: string;
  onChange: (value: string) => void;
  members: MentionableMember[];
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  rows?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  onClick?: (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const matches = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return (members ?? [])
      .filter((m) => m.name.trim() && m.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [mention, members]);

  function syncMentionState(el: HTMLInputElement | HTMLTextAreaElement) {
    const next = findActiveMention(el.value, el.selectionStart ?? el.value.length);
    setMention(next);
    setHighlighted(0);
  }

  function selectMember(member: MentionableMember) {
    if (!mention || !fieldRef.current) return;
    const el = fieldRef.current;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, mention.start);
    const after = value.slice(caret);
    const inserted = `@${member.name} `;
    const next = `${before}${inserted}${after}`;
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (mention && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => (h + 1) % matches.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => (h - 1 + matches.length) % matches.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMember(matches[highlighted]);
      } else if (e.key === "Escape") {
        setMention(null);
      }
    }
    // Consumed above (preventDefault) or not -- either way, callers with
    // their own key handling (save-on-Enter, Escape-to-cancel) should check
    // e.defaultPrevented before acting, so a mention selection doesn't also
    // trigger their own Enter/Escape behavior in the same keystroke.
    onKeyDownProp?.(e);
  }

  const sharedProps = {
    ref: fieldRef,
    value,
    placeholder,
    autoFocus,
    className,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
      syncMentionState(e.target);
    },
    onKeyDown: handleKeyDown,
    onKeyUp: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Arrow-key/Home/End caret moves don't fire onChange -- keep the
      // active-mention window in sync with wherever the caret actually is.
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) syncMentionState(e.currentTarget);
    },
    onClick: (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      syncMentionState(e.currentTarget);
      onClickProp?.(e);
    },
    onBlur: () => {
      setTimeout(() => setMention(null), 120);
      onBlurProp?.();
    },
  };

  return (
    <div className="relative">
      {multiline ? (
        <textarea {...sharedProps} rows={rows} />
      ) : (
        <input type="text" {...sharedProps} />
      )}
      {mention && matches.length > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 max-w-[80vw] rounded-none border border-border bg-background shadow-[0_4px_20px_rgba(0,0,0,0.1)]">
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              // onMouseDown (not onClick) so this fires before the field's
              // own onBlur closes the dropdown out from under the click.
              onMouseDown={(e) => {
                e.preventDefault();
                selectMember(m);
              }}
              className={`block w-full px-2.5 py-1.5 text-left text-xs transition-colors duration-150 ${
                i === highlighted ? "bg-black/[.05]" : "hover:bg-black/[.03]"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
