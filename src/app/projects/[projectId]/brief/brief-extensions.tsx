import { Node, mergeAttributes } from "@tiptap/core";
import TiptapImage from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";

// Images render as a small clickable chip (not full-bleed) that opens the
// full-resolution original in a new tab, since brief docs stay text-dense and
// scannable. A React NodeView (rather than static renderHTML) adds a hover
// remove affordance to match the richer attachment-card treatment.
function ImageChipView({ node, deleteNode }: ReactNodeViewProps<HTMLElement>) {
  return (
    <NodeViewWrapper as="span" className="brief-image-chip group">
      <a
        href={node.attrs.src}
        target="_blank"
        rel="noopener noreferrer"
        download
        draggable={false}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={node.attrs.src}
          alt={node.attrs.alt ?? ""}
          className="brief-image-icon"
          draggable={false}
        />
      </a>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          deleteNode();
        }}
        title="Remove"
        className="brief-chip-remove"
      >
        ×
      </button>
    </NodeViewWrapper>
  );
}

export const IconImage = TiptapImage.extend({
  draggable: true,
  addNodeView() {
    return ReactNodeViewRenderer(ImageChipView);
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    linkChip: {
      insertLinkChip: (attrs: { href: string; label: string }) => ReturnType;
    };
  }
}

function LinkChipView({ node, deleteNode }: ReactNodeViewProps<HTMLElement>) {
  return (
    <NodeViewWrapper as="span" className="brief-link-chip group">
      <a
        href={node.attrs.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        draggable={false}
      >
        🔗 {node.attrs.label || "Link"}
      </a>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          deleteNode();
        }}
        title="Remove"
        className="brief-chip-remove"
      >
        ×
      </button>
    </NodeViewWrapper>
  );
}

// Links are inserted as a standalone icon+label chip rather than marking
// existing text, so a doc full of references stays scannable.
export const LinkChip = Node.create({
  name: "linkChip",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      href: { default: null },
      label: { default: "Link" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-link-chip]",
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return {
            href: el.getAttribute("href"),
            label: el.getAttribute("data-label") || el.textContent || "Link",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "a",
      mergeAttributes({
        "data-link-chip": "",
        "data-label": node.attrs.label,
        href: node.attrs.href,
        target: "_blank",
        rel: "noopener noreferrer nofollow",
        class: "brief-link-chip",
      }),
      `🔗 ${node.attrs.label || "Link"}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkChipView);
  },

  addCommands() {
    return {
      insertLinkChip:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
