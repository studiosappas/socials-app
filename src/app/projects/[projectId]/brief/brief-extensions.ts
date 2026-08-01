import { Node, mergeAttributes } from "@tiptap/core";
import TiptapImage from "@tiptap/extension-image";

// Images render as a small clickable icon (not full-bleed) that opens/downloads
// the full-resolution file, since brief docs are meant to stay easy to scan.
export const IconImage = TiptapImage.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      {
        href: HTMLAttributes.src,
        target: "_blank",
        rel: "noopener noreferrer",
        download: "",
        class: "brief-image-chip",
      },
      ["img", mergeAttributes(HTMLAttributes, { class: "brief-image-icon" })],
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    linkChip: {
      insertLinkChip: (attrs: { href: string; label: string }) => ReturnType;
    };
  }
}

// Links are inserted as a standalone icon+label chip rather than marking
// existing text, so a doc full of references stays scannable.
export const LinkChip = Node.create({
  name: "linkChip",
  group: "inline",
  inline: true,
  atom: true,

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

  addCommands() {
    return {
      insertLinkChip:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
