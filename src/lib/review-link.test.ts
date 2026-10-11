// Tests for review-link.ts and the review-link role helpers in
// role-permissions.ts -- no React, no DOM, no network. Run with:
//   node --experimental-strip-types src/lib/review-link.test.ts

import assert from "node:assert/strict";
import {
  SHARE_LINK_MESSAGES,
  copyTextToClipboard,
  createSingleFlight,
  friendlyShareLinkError,
  reviewLinkUrl,
} from "./review-link.ts";
import { canCreateReviewLinks, canDeleteReviewLink, canManageReviewLinks } from "./role-permissions.ts";

let passed = 0;
const pending: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  pending.push(
    (async () => {
      try {
        await fn();
        passed++;
        console.log(`ok - ${name}`);
      } catch (err) {
        console.error(`FAIL - ${name}`);
        throw err;
      }
    })(),
  );
}

const ROLES = ["owner", "admin", "editor", "designer", "viewer", "client"] as const;

test("create: Owner, Admin and Member (editor) only", () => {
  assert.deepEqual(
    ROLES.filter((r) => canCreateReviewLinks(r)),
    ["owner", "admin", "editor"],
  );
  assert.equal(canCreateReviewLinks(null), false);
  assert.equal(canCreateReviewLinks(undefined), false);
});

test("manage every link: Owner and Admin only -- Member is NOT a manager", () => {
  assert.deepEqual(
    ROLES.filter((r) => canManageReviewLinks(r)),
    ["owner", "admin"],
  );
  assert.equal(canManageReviewLinks(null), false);
});

test("delete: managers any link; Member only their own; Viewer/Client/designer never", () => {
  for (const role of ["owner", "admin"] as const) {
    assert.equal(canDeleteReviewLink(role, false), true);
    assert.equal(canDeleteReviewLink(role, true), true);
  }
  assert.equal(canDeleteReviewLink("editor", true), true);
  assert.equal(canDeleteReviewLink("editor", false), false);
  for (const role of ["viewer", "client", "designer"] as const) {
    assert.equal(canDeleteReviewLink(role, false), false);
    // even a link they created under an earlier, higher role
    assert.equal(canDeleteReviewLink(role, true), false);
  }
  assert.equal(canDeleteReviewLink(null, true), false);
});

test("reviewLinkUrl builds the public preview URL", () => {
  assert.equal(reviewLinkUrl("https://app.example", "abc-123"), "https://app.example/preview/abc-123");
});

test("clipboard success -> true, and the exact text is written", async () => {
  const written: string[] = [];
  const ok = await copyTextToClipboard("https://x/preview/t", { writeText: async (t) => void written.push(t) });
  assert.equal(ok, true);
  assert.deepEqual(written, ["https://x/preview/t"]);
});

test("clipboard denied (Safari after an awaited request / permission) -> false, never throws", async () => {
  const denied = {
    writeText: async () => {
      throw new DOMException("The request is not allowed by the user agent", "NotAllowedError");
    },
  };
  assert.equal(await copyTextToClipboard("x", denied), false);
});

test("clipboard throwing synchronously -> false, never throws", async () => {
  const broken = {
    writeText: () => {
      throw new Error("boom");
    },
  };
  assert.equal(await copyTextToClipboard("x", broken as never), false);
});

test("clipboard unavailable (insecure context / old browser) -> false", async () => {
  assert.equal(await copyTextToClipboard("x", null), false);
  assert.equal(await copyTextToClipboard("x", {}), false);
  // No explicit clipboard and no usable navigator.clipboard in this runtime either.
  assert.equal(await copyTextToClipboard("x"), false);
});

test("RLS rejection is reported as a permission message, never the raw database text", () => {
  const raw = { code: "42501", message: 'new row violates row-level security policy for table "share_links"' };
  const create = friendlyShareLinkError(raw, "create");
  assert.equal(create, SHARE_LINK_MESSAGES.createNotAllowed);
  assert.ok(!/row-level|policy|share_links/i.test(create));
  assert.equal(friendlyShareLinkError(raw, "delete"), SHARE_LINK_MESSAGES.deleteNotAllowed);
  // Same text without the code still maps.
  assert.equal(friendlyShareLinkError({ message: raw.message }, "create"), SHARE_LINK_MESSAGES.createNotAllowed);
});

test("missing table, deleted content and unknown errors each get their own friendly message", () => {
  assert.equal(friendlyShareLinkError({ code: "42P01", message: 'relation "share_links" does not exist' }, "create"), SHARE_LINK_MESSAGES.notSetUp);
  assert.equal(friendlyShareLinkError({ code: "PGRST205", message: "schema cache" }, "create"), SHARE_LINK_MESSAGES.notSetUp);
  assert.equal(friendlyShareLinkError({ code: "23503", message: "violates foreign key constraint" }, "create"), SHARE_LINK_MESSAGES.contentUnavailable);
  assert.equal(friendlyShareLinkError({ code: "XX000", message: "internal: secret detail" }, "create"), SHARE_LINK_MESSAGES.createFailed);
  assert.equal(friendlyShareLinkError({ code: "XX000", message: "internal: secret detail" }, "delete"), SHARE_LINK_MESSAGES.deleteFailed);
  assert.equal(friendlyShareLinkError(null, "create"), SHARE_LINK_MESSAGES.createFailed);
});

test("single-flight: overlapping calls run ONCE (repeated clicking can't create two links)", async () => {
  const flight = createSingleFlight();
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const first = flight.run(async () => {
    runs++;
    await gate;
    return "created";
  });
  // Clicks 2..5 land while the first request is still pending.
  const extra = await Promise.all([1, 2, 3, 4].map(() => flight.run(async () => void runs++)));
  assert.equal(flight.busy, true);
  assert.deepEqual(extra, [undefined, undefined, undefined, undefined]);
  release();
  assert.equal(await first, "created");
  assert.equal(runs, 1);
  assert.equal(flight.busy, false);
});

test("single-flight: free again after success AND after a failure", async () => {
  const flight = createSingleFlight();
  await assert.rejects(flight.run(async () => Promise.reject(new Error("network"))));
  assert.equal(flight.busy, false);
  assert.equal(await flight.run(async () => 2), 2);
});

await Promise.all(pending);
console.log(`\n${passed} tests passed`);
