"use client";

import { useReducer, useRef, useState, useTransition } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { updateBrief, uploadBriefImage } from "@/lib/actions/brief";
import { IconImage, LinkChip } from "./brief-extensions";
import { AnnotationEditor } from "./annotation-editor";
import { LinkDialog } from "./link-dialog";

type ImageAttachment = { kind: "image"; pos: number; nodeSize: number; src: string };
type Attachment =
  | ImageAttachment
  | { kind: "link"; pos: number; nodeSize: number; href: string; label: string };

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
  const [, forceUpdate] = useReducer((c) => c + 1, 0);
  const [editingAttachment, setEditingAttachment] = useState<ImageAttachment | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const hasContent = initialContent && Object.keys(initialContent).length > 0;

  const editor = useEditor({
    immediatelyRender: false,
    editable: canManage,
    extensions: [StarterKit.configure({ link: false }), IconImage, LinkChip],
    content: hasContent ? initialContent : "<p></p>",
    onUpdate: () => forceUpdate(),
    onCreate: () => forceUpdate(),
    editorProps: {
      attributes: {
        class:
          "min-h-[320px] rounded-md border border-border px-4 py-3 text-sm focus:outline-none [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_.brief-image-chip]:relative [&_.brief-image-chip]:inline-flex [&_.brief-image-chip]:align-middle [&_.brief-image-icon]:h-14 [&_.brief-image-icon]:w-14 [&_.brief-image-icon]:rounded [&_.brief-image-icon]:border [&_.brief-image-icon]:border-border [&_.brief-image-icon]:object-cover [&_.brief-link-chip]:relative [&_.brief-link-chip]:inline-flex [&_.brief-link-chip]:items-center [&_.brief-link-chip]:gap-1 [&_.brief-link-chip]:rounded [&_.brief-link-chip]:border [&_.brief-link-chip]:border-border [&_.brief-link-chip]:px-1.5 [&_.brief-link-chip]:py-0.5 [&_.brief-link-chip]:align-middle [&_.brief-link-chip]:text-xs [&_.brief-link-chip_a]:no-underline [&_.brief-chip-remove]:absolute [&_.brief-chip-remove]:-right-1 [&_.brief-chip-remove]:-top-1 [&_.brief-chip-remove]:hidden [&_.brief-chip-remove]:rounded [&_.brief-chip-remove]:bg-black/70 [&_.brief-chip-remove]:px-1 [&_.brief-chip-remove]:text-[10px] [&_.brief-chip-remove]:leading-none [&_.brief-chip-remove]:text-white [&_.group:hover_.brief-chip-remove]:block",
      },
    },
  });

  const attachments: Attachment[] = [];
  if (editor) {
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") {
        attachments.push({ kind: "image", pos, nodeSize: node.nodeSize, src: node.attrs.src });
      } else if (node.type.name === "linkChip") {
        attachments.push({
          kind: "link",
          pos,
          nodeSize: node.nodeSize,
          href: node.attrs.href,
          label: node.attrs.label,
        });
      }
    });
  }

  function focusAttachment(attachment: Attachment) {
    if (!editor) return;
    editor.chain().focus().setTextSelection(attachment.pos).scrollIntoView().run();
  }

  function removeAttachment(attachment: Attachment) {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: attachment.pos, to: attachment.pos + attachment.nodeSize })
      .run();
  }

  function handleAnnotationSaved(newUrl: string) {
    if (editor && editingAttachment) {
      const node = editor.state.doc.nodeAt(editingAttachment.pos);
      if (node) {
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.setNodeMarkup(editingAttachment.pos, undefined, { ...node.attrs, src: newUrl });
            return true;
          })
          .run();
      }
    }
    setEditingAttachment(null);
  }

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
    setLinkDialogOpen(true);
  }

  function handleLinkSubmit(attrs: { href: string; label: string }) {
    setLinkDialogOpen(false);
    if (!editor) return;
    editor.chain().focus().insertLinkChip(attrs).run();
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

      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-3">
          {attachments.map((attachment) => (
            <div
              key={attachment.pos}
              role="button"
              tabIndex={0}
              onClick={() => focusAttachment(attachment)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") focusAttachment(attachment);
              }}
              title={attachment.kind === "image" ? "Jump to image" : attachment.label}
              className="group relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded border border-border transition-colors duration-150 hover:border-foreground/30"
            >
              {attachment.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachment.src} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="px-1 text-center text-[10px] text-muted">🔗 {attachment.label}</span>
              )}
              {canManage && attachment.kind === "image" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingAttachment(attachment);
                  }}
                  title="Annotate"
                  className="absolute bottom-1 left-1 hidden rounded bg-black/70 px-1 text-[10px] leading-none text-white group-hover:block"
                >
                  ✎
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAttachment(attachment);
                  }}
                  className="absolute right-1 top-1 hidden rounded bg-black/70 px-1 text-[10px] leading-none text-white group-hover:block"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {canManage && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Add image"
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded border border-dashed border-border text-lg text-muted hover:bg-black/[.03]"
            >
              +
            </button>
          )}
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

      <AnnotationEditor
        projectId={projectId}
        open={editingAttachment !== null}
        imageUrl={editingAttachment?.src ?? null}
        onClose={() => setEditingAttachment(null)}
        onSaved={handleAnnotationSaved}
      />

      <LinkDialog
        open={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        onSubmit={handleLinkSubmit}
      />
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
