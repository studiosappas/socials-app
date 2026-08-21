import { FlowerLoader } from "./flower-loader";

// The one shared full-page loading shell, replacing 16 individually-tuned
// page skeletons. Those all tried to visually approximate their real
// destination page -- a grid of tiles, a list of rows, a form -- which
// solved the original "frozen screen on click" problem but introduced a
// new one: a fake, inevitably-slightly-wrong layout that then visibly
// swapped for the real one on every single navigation. No per-page
// skeleton can fully avoid that swap (a month grid's real row count varies
// by month, a card grid's real item count is unknown until the data
// arrives, etc.) -- the fix isn't a better guess, it's not guessing.
//
// This renders only things that are already true the instant the route is
// requested, before any data has loaded: the persistent app chrome (the
// surrounding layout.tsx, already mounted, untouched by this file) stays
// exactly as it was, and the destination's page title is static per-route
// knowledge, not a guess about content. Everything else is the branded
// FlowerLoader motion mark, centered in the remaining content area --
// never a placeholder shaped like a grid, card, list, or form, so there is
// nothing for the real content to visibly replace.
//
// Deliberately not used by the Post/Story editor's intercepted-modal
// loaders (@modal/(.)posts, @modal/(.)stories) -- those mount the real
// <Modal> chrome itself, which is genuinely load-bearing for "the modal
// opening feels instant," not a page-shape guess.
export function PageLoading({ title }: { title?: string }) {
  return (
    <div className="flex h-full min-h-[50vh] flex-col gap-6">
      {title && <h1 className="text-xs font-semibold tracking-wide uppercase text-muted">{title}</h1>}
      {/* flex-1 (not the title's own height) is what actually gets centered
          in -- the symbol should sit in the middle of the remaining content
          area, not hug directly under the title. */}
      <div className="flex flex-1 items-center justify-center">
        <FlowerLoader />
      </div>
    </div>
  );
}
