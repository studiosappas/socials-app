// Opt-in REAL-BROWSER check for the Share Calendar guest page UI
// (preview-calendar/[token]/guest-calendar.tsx) and the team-side Share
// Calendar button. Needs Microsoft Edge (or Chrome) and starts a Next dev
// server.
//
//   node scripts/guest-calendar.check.mjs
//
// Mounts the REAL GuestCalendar and ShareCalendarButton on fixture data
// through a TEMPORARY page under a proxy-public path, ALWAYS deleted again
// afterwards. The data layer (get_shared_calendar + signing) is covered by
// src/lib/calendar-share-model.test.ts; this checks what a guest can and
// can't do in the browser. Server actions are intercepted and aborted:
// nothing reaches the database.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-guest-calendar-harness-check");
const PORT = 3126;
const BASE = `http://localhost:${PORT}/preview-guest-calendar-harness-check`;
const TOKEN = "A".repeat(43);

const HARNESS = `// TEMPORARY -- created and deleted by scripts/guest-calendar.check.mjs. Never commit.
import { GuestCalendar } from "../preview-calendar/[token]/guest-calendar";
import { ShareCalendarButton } from "../projects/[projectId]/calendar/share-calendar-button";
import { buildCalendarCells, type CalendarItem } from "@/lib/calendar-cells";
import type { GuestPreview } from "@/lib/calendar-share-model";

const svg = (fill: string) => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><rect width="30" height="40" fill="' + fill + '"/></svg>');
const POSTER = svg("#48c");
const IMG_A = svg("#c84");
const IMG_B = svg("#4c8");
const it = (itemType: "post" | "story", itemId: string, status: CalendarItem["status"], label: string, thumb: string | null): CalendarItem => ({
  itemType, itemId, label, status, thumbnailUrl: thumb, assetUrls: [], href: "",
});
const ITEMS = [
  { date: "2026-11-03", item: it("post", "reel", "draft", "reel", POSTER) },
  { date: "2026-11-03", item: it("post", "carousel", "scheduled", "carousel", IMG_A) },
  { date: "2026-11-04", item: it("post", "noposter", "draft", "reel", null) },
  { date: "2026-11-05", item: it("story", "s1", "published", "", IMG_B) },
  { date: "2026-11-06", item: it("post", "single", "draft", "post", IMG_A) },
];
const PREVIEWS: Record<string, GuestPreview> = {
  "post:reel": { itemType: "post", caption: "Launch reel caption", notes: "", media: [{ url: "/no-such-video.mp4", posterUrl: POSTER, mediaType: "video" }] },
  "post:carousel": { itemType: "post", caption: "Carousel caption", notes: "Client: swap slide 2 @Sam", media: [{ url: IMG_A, posterUrl: null, mediaType: "image" }, { url: IMG_B, posterUrl: null, mediaType: "image" }] },
  "post:single": { itemType: "post", caption: "Single caption", notes: "   ", media: [{ url: IMG_A, posterUrl: null, mediaType: "image" }] },
  "post:noposter": { itemType: "post", caption: "", notes: "", media: [] },
  "story:s1": { itemType: "story", caption: "", notes: "Story notes text", media: [{ url: IMG_B, posterUrl: null, mediaType: "image" }] },
};

export default async function Harness({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  if (sp.button) {
    return (
      <div data-harness-root className="p-6">
        <ShareCalendarButton projectId="p1" tableMissing={false} links={[{ id: "l1", token: "${TOKEN}", createdAt: "2026-11-01T10:00:00Z" }]} />
      </div>
    );
  }
  const cells = buildCalendarCells({ anchor: new Date("2026-11-01T00:00:00"), weekStartsOn: 1, todayStr: "2026-11-04", items: ITEMS, noteByDate: new Map([["2026-11-03", "Shoot day"]]) });
  return (
    <div data-harness-root>
      <GuestCalendar projectName="Acme" monthLabel="November 2026" prevMonthParam="2026-10" nextMonthParam="2026-12" cells={cells} weekStartsOn={1} previews={PREVIEWS} />
    </div>
  );
}
`;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${name}\n   ${String(e.message).split("\n").slice(0, 8).join("\n   ")}`);
  }
}

async function waitForServer(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server didn't come up at ${url}`);
}

async function open(browser, { mobile = false, query = "" } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 1000 },
    hasTouch: mobile,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  const actions = [];
  const errors = [];
  await page.route("**/*", (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"]) {
      actions.push(req.postData() ?? "");
      return route.abort();
    }
    return route.continue();
  });
  page.on("console", (m) => {
    // The fixture's video URL doesn't exist on purpose (the poster is what's checked).
    if (m.type() === "error" && !/no-such-video|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}${query}`);
  await page.waitForSelector("[data-harness-root]", { timeout: 120000 });
  await page.waitForTimeout(800);
  return { ctx, page, actions, errors };
}

// SHOTS=<dir> also saves screenshots of the open previews, for a visual look.
const shot = async (page, name) => process.env.SHOTS && page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) });
const dialog = (page) => page.locator("[role=dialog]");
// The app's own Dialog (components/ui/dialog.tsx) has no role attribute.
const appDialog = (page) => page.locator("div.fixed.inset-0.z-50");

async function run(browser) {
  // ---------- desktop ----------
  {
    const { ctx, page, actions, errors } = await open(browser);
    const root = page.locator("[data-harness-root]");

    await check("desktop: same Calendar layout, no Drafts / day menu / editing affordances", async () => {
      await page.getByText("November 2026").first().waitFor();
      assert.equal(await root.getByText("Drafts", { exact: false }).count(), 0);
      assert.equal(await page.locator("[title='Day options']").count(), 0);
      assert.equal(await page.locator("textarea, input, [contenteditable=true]").count(), 0);
      assert.equal(await page.locator("[draggable=true]").count(), 0);
      assert.equal(await page.locator("div.hidden.sm\\:block button[title='Click to expand this week']").count(), 42);
    });

    await check("desktop: no links into the app -- only month navigation", async () => {
      const hrefs = await root.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      assert.ok(hrefs.length > 0);
      for (const h of hrefs) assert.match(h, /^\?month=\d{4}-\d{2}$/);
    });

    await check("desktop: video chip shows its poster; missing poster shows the icon fallback", async () => {
      const reel = page.locator("div.hidden.sm\\:block [role=button][title='Reel']").first();
      const src = await reel.locator("img").getAttribute("src");
      assert.ok(src?.startsWith("data:image/svg+xml") && decodeURIComponent(src).includes("#48c"), src);
      const noPoster = page.locator("div.hidden.sm\\:block [role=button][title='Reel']").nth(1);
      assert.equal(await noPoster.locator("img").count(), 0);
      assert.match(await noPoster.innerText(), /🖼/);
    });

    await check("desktop: day note is read-only text", async () => {
      const note = page.locator("div.hidden.sm\\:block [title='Shoot day']");
      await note.click();
      await page.waitForTimeout(300);
      assert.equal(await note.getAttribute("role"), null);
      assert.equal(await page.locator("textarea").count(), 0);
    });

    await check("desktop: clicking a chip opens the preview with media + caption, not the week", async () => {
      const before = await page.locator("div.hidden.sm\\:block [role=button][title='Carousel']").count();
      await page.locator("div.hidden.sm\\:block [role=button][title='Carousel']").first().click();
      await dialog(page).waitFor();
      assert.match(await dialog(page).innerText(), /Carousel caption/);
      assert.match(await dialog(page).innerText(), /1 \/ 2/);
      await dialog(page).getByLabel("Next").click();
      assert.match(await dialog(page).innerText(), /2 \/ 2/);
      await page.keyboard.press("ArrowRight");
      assert.match(await dialog(page).innerText(), /1 \/ 2/);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      assert.equal(await dialog(page).count(), 0);
      assert.equal(await page.locator("div.hidden.sm\\:block [role=button][title='Carousel']").count(), before, "week did not expand");
    });

    await check("desktop: video preview shows the poster cover and caption", async () => {
      await page.locator("div.hidden.sm\\:block [role=button][title='Reel']").first().click();
      await dialog(page).waitFor();
      assert.match(await dialog(page).innerText(), /Launch reel caption/);
      assert.ok((await dialog(page).locator("video").count()) === 1);
      await dialog(page).getByLabel("Close").last().click();
      await page.waitForTimeout(200);
      assert.equal(await dialog(page).count(), 0);
    });

    const headings = async () => page.locator("[data-guest-preview-text] h3").allInnerTexts();
    const openChip = async (title, nth = 0) => {
      await page.locator(`div.hidden.sm\\:block [role=button][title='${title}']`).nth(nth).click();
      await dialog(page).waitFor();
    };
    const closePreview = async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      assert.equal(await dialog(page).count(), 0);
    };

    await check("desktop: single image with caption -> Caption section only (blank notes hidden)", async () => {
      await openChip("Post");
      assert.deepEqual(await headings(), ["CAPTION"]);
      assert.match(await page.locator("[data-guest-preview-text]").innerText(), /Single caption/);
      await closePreview();
    });

    await check("desktop: carousel with caption + notes beside the media; slides keep the text", async () => {
      await openChip("Carousel");
      assert.deepEqual(await headings(), ["CAPTION", "NOTES"]);
      const panel = page.locator("[data-guest-preview-text]");
      const text = await panel.innerText();
      assert.match(text, /Carousel caption/);
      assert.match(text, /Client: swap slide 2 @Sam/);
      const media = await dialog(page).locator(".animate-settle-in").boundingBox();
      const box = await panel.boundingBox();
      assert.ok(box.x >= media.x + media.width - 1, `panel beside media: panel.x=${box.x} media.right=${media.x + media.width}`);
      assert.ok(box.y < media.y + media.height && box.y + box.height > media.y, "same row");
      assert.ok(media.width * media.height > box.width * 200, "media stays the larger element");
      await shot(page, "desktop-carousel");
      await dialog(page).getByLabel("Next").click();
      assert.match(await dialog(page).innerText(), /2 \/ 2/);
      assert.equal(await panel.innerText(), text, "unchanged after slide change");
      await page.keyboard.press("ArrowLeft");
      assert.match(await dialog(page).innerText(), /1 \/ 2/);
      assert.equal(await panel.innerText(), text);
      await closePreview();
    });

    await check("desktop: story with notes only -> Notes section only", async () => {
      await openChip("Story");
      assert.deepEqual(await headings(), ["NOTES"]);
      assert.match(await page.locator("[data-guest-preview-text]").innerText(), /Story notes text/);
      await closePreview();
    });

    await check("desktop: neither caption nor notes -> no text panel at all", async () => {
      await openChip("Reel", 1);
      assert.equal(await page.locator("[data-guest-preview-text]").count(), 0);
      assert.equal(await dialog(page).getByText(/^(Caption|Notes)$/i).count(), 0);
      await closePreview();
    });

    await check("desktop: text panel is read-only (no controls, links or editable fields)", async () => {
      await openChip("Carousel");
      const panel = page.locator("[data-guest-preview-text]");
      assert.equal(await panel.locator("button, a, input, textarea, select, [contenteditable=true], [role=button]").count(), 0);
      await closePreview();
    });

    await check("desktop: clicking a day expands its week; expanded tiles open the preview", async () => {
      await page.locator("div.hidden.sm\\:block button[title='Click to expand this week']").filter({ has: page.locator("span:text-is('5')") }).first().click();
      await page.waitForTimeout(500);
      const tile = page.locator("div.hidden.sm\\:block [role=button][title='Story'] img");
      await tile.first().waitFor();
      await tile.first().click();
      await dialog(page).waitFor();
      await page.keyboard.press("Escape");
    });

    await check("desktop: no server actions, no console/hydration errors", async () => {
      assert.deepEqual(actions, []);
      assert.deepEqual(errors, []);
    });
    await ctx.close();
  }

  // ---------- mobile ----------
  {
    const { ctx, page, actions, errors } = await open(browser, { mobile: true });
    await check("mobile: mini calendar + day strips, no ⋮ menu, no Drafts", async () => {
      assert.equal(await page.locator("[title='Day options']").count(), 0);
      assert.equal(await page.getByText("Drafts").count(), 0);
      await page.locator("div.sticky button").filter({ hasText: /^3$/ }).first().tap();
      await page.waitForTimeout(600);
      assert.ok((await page.locator("#cal-day-2026-11-03 [role=button]").count()) >= 2);
      assert.ok(await page.locator("#cal-day-2026-11-03").getByText("Shoot day").isVisible());
    });
    await check("mobile: tapping a strip tile opens the preview; close returns to the calendar", async () => {
      await page.locator("#cal-day-2026-11-03 [role=button][title='Carousel']").tap();
      await dialog(page).waitFor();
      assert.match(await dialog(page).innerText(), /Carousel caption/);
      await dialog(page).getByLabel("Close").last().tap();
      await page.waitForTimeout(200);
      assert.equal(await dialog(page).count(), 0);
    });
    await check("mobile: caption + notes below the media; slides keep the text", async () => {
      await page.locator("div.sticky button").filter({ hasText: /^3$/ }).first().tap();
      await page.waitForTimeout(500);
      await page.locator("#cal-day-2026-11-03 [role=button][title='Carousel']").tap();
      await dialog(page).waitFor();
      const panel = page.locator("[data-guest-preview-text]");
      assert.deepEqual(await panel.locator("h3").allInnerTexts(), ["CAPTION", "NOTES"]);
      const media = await dialog(page).locator(".animate-settle-in").boundingBox();
      const box = await panel.boundingBox();
      assert.ok(box.y >= media.y + media.height, `panel below media: panel.y=${box.y} media.bottom=${media.y + media.height}`);
      assert.ok(box.width <= 390 && media.width <= 390, "no horizontal overflow");
      await shot(page, "mobile-carousel-top");
      const text = await panel.innerText();
      await dialog(page).getByLabel("Next").tap();
      assert.match(await dialog(page).innerText(), /2 \/ 2/);
      assert.equal(await panel.innerText(), text);
      await panel.scrollIntoViewIfNeeded();
      assert.ok(await panel.getByText("Client: swap slide 2 @Sam").isVisible());
      await shot(page, "mobile-carousel-text");
      await dialog(page).getByLabel("Close").last().tap();
      await page.waitForTimeout(200);
      assert.equal(await dialog(page).count(), 0);
    });
    await check("mobile: item with neither -> media only, no text panel", async () => {
      await page.locator("div.sticky button").filter({ hasText: /^4$/ }).first().tap();
      await page.waitForTimeout(500);
      await page.locator("#cal-day-2026-11-04 [role=button][title='Reel']").tap();
      await dialog(page).waitFor();
      assert.equal(await page.locator("[data-guest-preview-text]").count(), 0);
      await dialog(page).getByLabel("Close").last().tap();
      await page.waitForTimeout(200);
    });
    await check("mobile: no server actions, no console/hydration errors", async () => {
      assert.deepEqual(actions, []);
      assert.deepEqual(errors, []);
    });
    await ctx.close();
  }

  // ---------- team-side button ----------
  {
    const { ctx, page, actions, errors } = await open(browser, { query: "?button=1" });
    await check("Share Calendar: lists links, copies the guest URL, revoke + create call their actions", async () => {
      await page.getByText("Share Calendar").first().click();
      await appDialog(page).waitFor();
      await appDialog(page).getByText("Copy Link", { exact: true }).click();
      await page.waitForTimeout(200);
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(copied, `http://localhost:${PORT}/preview-calendar/${TOKEN}`);
      assert.equal(await appDialog(page).locator("a[href]").getAttribute("href"), `/preview-calendar/${TOKEN}`);
      await appDialog(page).getByRole("button", { name: "Revoke", exact: true }).click();
      await page.waitForTimeout(800);
      await appDialog(page).getByRole("button", { name: "+ Create & Copy Link" }).click();
      await page.waitForTimeout(800);
      assert.equal(actions.length, 2, `actions: ${actions.length}`);
      assert.match(actions[0], /"p1"/);
      assert.match(actions[0], /"l1"/);
      assert.match(actions[1], /"p1"/);
    });
    await check("Share Calendar: no console errors (aborted actions aside)", async () => {
      assert.deepEqual(errors.filter((e) => !/fetch|Failed to fetch|aborted|network/i.test(e)), []);
    });
    await ctx.close();
  }
}

let server;
let browser;
try {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(path.join(HARNESS_DIR, "page.tsx"), HARNESS);
  server = spawn(`npx next dev --port ${PORT}`, { cwd: ROOT, shell: true, stdio: "ignore" });
  await waitForServer(BASE, 180000);
  browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch({ channel: "chrome" }));
  await run(browser);
} finally {
  await browser?.close().catch(() => {});
  if (server?.pid) {
    try {
      if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-server.pid);
    } catch {
      // already gone
    }
  }
  fs.rmSync(HARNESS_DIR, { recursive: true, force: true });
  // See calendar-view.check.mjs: stale route type stubs would break tsc.
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
