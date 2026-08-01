"use client";

import { useRef, useState, useTransition } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { updateBrief, uploadBriefImage } from "@/lib/actions/brief";
import { IconImage, LinkChip } from "./brief-extensions";

export function BriefEditor({
  projectId,
  initialContent,
  canManage,
}: {
  projectId: string;
  initialContent: object | null;
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ message?: string; success?: boolean } | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasContent = initialContent && Object.keys(initialContent).length > 0;

  const editor = useEditor({
    immediatelyRender: false,
    editable: canManage,
    extensions: [StarterKit.configure({ link: false }), IconImage, LinkChip],
    content: hasContent ? initialContent : "<p></p>",
    editorProps: {
      attributes: {
        class:
          "min-h-[320px] rounded-md border border-border px-4 py-3 text-sm focus:outline-none [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_.brief-image-chip]:inline-block [&_.brief-image-chip]:align-middle [&_.brief-image-icon]:h-9 [&_.brief-image-icon]:w-9 [&_.brief-image-icon]:rounded [&_.brief-image-icon]:border [&_.brief-image-icon]:border-border [&_.brief-image-icon]:object-cover [&_.brief-image-icon]: [&_.brief-link-chip]:inline-flex [&_.brief-link-chip]:items-center [&_.brief-link-chip]:gap-1 [&_.brief-link-chip]:rounded [&_.brief-link-chip]:border [&_.brief-link-chip]:border-border [&_.brief-link-chip]:px-1.5 [&_.brief-link-chip]:py-0.5 [&_.brief-link-chip]:align-middle [&_.brief-link-chip]:text-xs [&_.brief-link-chip]:no-underline [&_.brief-link-chip]:",
      },
    },
  });

  function handleSave() {
    if (!editor) return;
    startTransition(async () => {
      const result = await updateBrief(projectId, editor.getJSON());
      setStatus(result);
    });
  }

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;

    const formData = new FormData();
    formData.set("file", file);
    const result = await uploadBriefImage(projectId, formData);

    if (result.url) {
      editor.chain().focus().setImage({ src: result.url }).run();
    } else if (result.message) {
      setStatus({ message: result.message });
    }
  }

  function handleAddLink() {
    if (!editor) return;
    const url = window.prompt("Link URL");
    if (!url) return;
    const label = window.prompt("Link label", "Link") || "Link";
    editor.chain().focus().insertLinkChip({ href: url, label }).run();
  }

  if (!editor) {
    return <p className="text-sm text-muted">Loading editor...</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
          <ToolbarButton
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            label="Bold"
          />
          <ToolbarButton
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            label="Italic"
          />
          <ToolbarButton
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            label="H2"
          />
          <ToolbarButton
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            label="• List"
          />
          <ToolbarButton
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            label="1. List"
          />
          <ToolbarButton active={false} onClick={handleAddLink} label="Link" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded px-2 py-1 text-xs hover:bg-black/[.05]"
          >
            Image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImagePick}
          />
        </div>
      )}

      <EditorContent editor={editor} />

      {canManage && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="self-start rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60"
          >
            {isPending ? "Saving..." : "Save"}
          </button>
          {status?.message && <p className="text-sm text-error">{status.message}</p>}
          {status?.success && !status?.message && (
            <p className="text-sm text-success">Saved.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs ${
        active
          ? "bg-foreground text-background"
          : "hover:bg-black/[.05]"
      }`}
    >
      {label}
    </button>
  );
}
