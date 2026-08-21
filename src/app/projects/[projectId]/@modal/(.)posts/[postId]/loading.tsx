import { Modal } from "../../../modal";

// Shown immediately while page.tsx's getPostCoreData is still in flight --
// without this file, Next has no fallback to show for this route segment
// at all, so clicking a tile before router.prefetch() has finished (or
// before it's even had a chance to run) meant nothing appeared until the
// fetch resolved. This can't fix how long the data itself takes, but it
// means the modal's own chrome (backdrop, panel, close button) appears the
// instant you click -- "feels instant" even while the content streams in
// behind it, which is what was actually asked for. (getPostCoreData itself
// no longer needs to wait on the project's whole media library either --
// see lib/data/posts.ts -- so this fallback is now typically on screen for
// less time than it used to be.)
export default function PostEditorLoading() {
  return (
    <Modal>
      <div className="flex animate-pulse flex-col gap-4">
        <div className="aspect-[4/5] w-full max-w-xs rounded-none bg-black/[.06]" />
        <div className="h-3 w-2/3 rounded bg-black/[.06]" />
        <div className="h-3 w-1/2 rounded bg-black/[.06]" />
        <div className="h-20 w-full rounded bg-black/[.06]" />
      </div>
    </Modal>
  );
}
