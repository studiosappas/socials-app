// Post Editor "Add from library" picker -- which tiles to show, and where.
// Plain module (no React) so the layout rule is testable on its own.
//
// THE BUG THIS PREVENTS (reproduced on Staging): the picker used to drop
// every used item out of the list, and "used" changes asynchronously --
// when a pick's server action settles, which can be seconds later because
// server actions run one at a time. Picking an already-edited image gives
// the post a copy (addPostAsset), the slide then switches to the copy's
// id, the ORIGINAL stops counting as used and reappears, and every later
// tile shifts one cell. A click aimed at a video landed on the image next
// to it, and that image was saved.
//
// The rule now: once a tile has been shown in this picker, it keeps its
// place for the rest of the session.
//   - A used item that was never shown here stays hidden (as before: the
//     picker doesn't list what the post already had when it opened).
//   - A used item that HAS been shown (picked here, or used again after a
//     failed remove reverted) stays in place, marked "Added" and not
//     clickable. If it stops being used (failed pick, slide removed) it is
//     clickable again, still in place.
//   - Newer pages only ever append at the end.
// So nothing async -- a settle, a copy, a revert, a resync from the server
// -- can move a tile under the pointer.

export type PickerTile<T> = { item: T; added: boolean };

// The media ids the post uses, for the picker's purposes. A slide picked
// from the Library also counts the item it was picked from
// (libraryItemId), so the original of a copy-on-write pick still counts as
// used after the slide settles onto its copy, and can't be added twice.
export function usedLibraryIds(assets: { mediaAssetId: string; libraryItemId?: string }[]): Set<string> {
  const used = new Set<string>();
  for (const a of assets) {
    used.add(a.mediaAssetId);
    if (a.libraryItemId) used.add(a.libraryItemId);
  }
  return used;
}

export function pickerTiles<T extends { id: string }>(
  items: T[],
  used: Set<string>,
  shownHere: Set<string>,
): PickerTile<T>[] {
  const tiles: PickerTile<T>[] = [];
  for (const item of items) {
    const isUsed = used.has(item.id);
    if (isUsed && !shownHere.has(item.id)) continue;
    tiles.push({ item, added: isUsed });
  }
  return tiles;
}

// shownHere plus every tile now on screen; the SAME set when nothing is
// new, so a component storing it in state can skip the update.
export function rememberShown<T extends { id: string }>(shownHere: Set<string>, tiles: PickerTile<T>[]): Set<string> {
  let next: Set<string> | null = null;
  for (const t of tiles) {
    if (shownHere.has(t.item.id)) continue;
    next ??= new Set(shownHere);
    next.add(t.item.id);
  }
  return next ?? shownHere;
}
