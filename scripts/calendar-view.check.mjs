// Opt-in REAL-BROWSER regression check for the Calendar's display/editing
// split (calendar/calendar-view.tsx + calendar-board.tsx). Not part of the
// default test run -- it needs Microsoft Edge (or Chrome) and starts a Next
// dev server.
//
//   node scripts/calendar-view.check.mjs
//
// Mounts the REAL CalendarBoard twice on the same fixture data, through a
// TEMPORARY page it creates under a proxy-public path and ALWAYS deletes
// again afterwards (finally): once as it is now, and once as it was at git
// HEAD (`?impl=old`, copied from `git show HEAD:...`, so run it before
// committing a change to the board). Every state below -- desktop/mobile,
// manager/read-only, expanded week, note editing, menus, dialogs, a real
// drag-and-drop -- must produce the same DOM and the same server-action
// payloads in both, plus a few direct assertions on the new one. Server
// actions are intercepted and aborted: nothing reaches the database.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-calendar-harness-check");
const PORT = 3125;
const BASE = `http://localhost:${PORT}/preview-calendar-harness-check`;
const BOARD = "src/app/projects/[projectId]/calendar/calendar-board.tsx";

const HARNESS = `// TEMPORARY -- created and deleted by scripts/calendar-view.check.mjs. Never commit.
import { CalendarBoard } from "../projects/[projectId]/calendar/calendar-board";
import { CalendarBoard as OldCalendarBoard } from "./old-board";
import { buildCalendarCells, type CalendarItem } from "@/lib/calendar-cells";

const THUMB = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><rect width="30" height="40" fill="#c84"/></svg>');
const it = (itemType: "post" | "story", itemId: string, status: CalendarItem["status"], label: string, thumb = true): CalendarItem => ({
  itemType, itemId, label, status,
  thumbnailUrl: thumb ? THUMB : null,
  assetUrls: thumb ? [THUMB] : [],
  href: "/projects/p1/" + (itemType === "post" ? "posts/" : "stories/") + itemId,
});
const ITEMS = [
  { date: "2026-11-03", item: it("post", "a1", "scheduled", "carousel") },
  { date: "2026-11-03", item: it("story", "a2", "draft", "Launch story", false) },
  { date: "2026-11-05", item: it("post", "b1", "published", "post") },
  { date: "2026-11-10", item: it("post", "c1", "draft", "post") },
  { date: "2026-11-10", item: it("post", "c2", "draft", "reel") },
  { date: "2026-11-10", item: it("post", "c3", "scheduled", "post") },
  { date: "2026-11-10", item: it("post", "c4", "draft", "post", false) },
  { date: "2026-11-30", item: it("story", "d1", "scheduled", "Wrap") },
  { date: "2026-12-02", item: it("post", "e1", "draft", "post") },
];
const NOTES = new Map([["2026-11-03", "Launch day @Sam"], ["2026-11-18", "Shoot only"]]);
const UNSCHEDULED = [it("post", "u1", "draft", "post"), it("story", "u2", "draft", "Teaser")];

export default async function Harness({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const Board = sp.impl === "old" ? OldCalendarBoard : CalendarBoard;
  const cells = buildCalendarCells({ anchor: new Date("2026-11-01T00:00:00"), weekStartsOn: 0, todayStr: "2026-11-10", items: ITEMS, noteByDate: NOTES });
  return (
    <div data-harness-root className="px-4 py-6">
      <Board
        projectId="p1"
        monthLabel="November 2026"
        prevMonthParam="2026-10"
        nextMonthParam="2026-12"
        cells={cells}
        unscheduled={UNSCHEDULED}
        canManage={sp.manage !== "0"}
        members={[{ id: "u-sam", name: "Sam" }]}
        weekStartsOn={0}
      />
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

// The board's DOM plus anything portalled to <body> (dialogs, menus), minus
// Next's dev overlay. Generated ids (React useId / dnd-kit's describedby)
// depend on tree depth, which the split legitimately changes, so they're
// normalised away -- everything else must match exactly.
async function snapshot(page) {
  const html = await page.evaluate(() => {
    const parts = [document.querySelector("[data-harness-root]")?.outerHTML ?? "NO ROOT"];
    for (const el of document.body.children) {
      if (el.matches("script, nextjs-portal, [data-harness-root]") || el.querySelector("[data-harness-root]")) continue;
      parts.push(el.outerHTML);
    }
    return parts.join("\n");
  });
  return html
    .replace(/(id|aria-describedby|aria-labelledby|aria-controls|for)="[^"]*"/g, (m, attr) =>
      /cal-day-/.test(m) ? m : `${attr}="ID"`,
    )
    .replace(/«[^»]*»|_R_[A-Za-z0-9_]+_/g, "ID");
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}:\n   old: ${JSON.stringify(a.slice(Math.max(0, i - 120), i + 120))}\n   new: ${JSON.stringify(b.slice(Math.max(0, i - 120), i + 120))}`;
}

const day = (page, n) =>
  page.locator("div.hidden.sm\\:block button[title^='Click to expand']").filter({ has: page.locator(`span:text-is("${n}")`) }).first();

// One scripted session; returns { snapshots, facts } so old and new can be
// compared state by state.
async function session(browser, impl, { manage, mobile }) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 1000 }, hasTouch: mobile });
  const page = await ctx.newPage();
  const actions = [];
  await page.route("**/*", (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"]) {
      actions.push(req.postData() ?? "");
      return route.abort();
    }
    return route.continue();
  });
  page.on("dialog", (d) => d.dismiss());
  const url = `${BASE}?impl=${impl}&manage=${manage ? 1 : 0}`;
  await page.goto(url);
  await page.waitForSelector("text=November 2026", { timeout: 120000 });
  await page.waitForTimeout(400);

  const snapshots = {};
  const facts = {};
  snapshots.initial = await snapshot(page);
  facts.chipHrefs = await page.locator("[data-harness-root] a[href^='/projects/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))].sort());
  facts.drafts = await page.getByText("Drafts", { exact: true }).count();
  facts.navHrefs = await page.locator("[data-harness-root] a[href^='?month=']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));

  if (!mobile) {
    // single click -> the week expands (after the double-click window)
    await day(page, "3").click({ position: { x: 4, y: 4 } });
    await page.waitForTimeout(600);
    snapshots.expanded = await snapshot(page);
    facts.expandedCells = await page.locator("div.hidden.sm\\:block button.sm\\:min-h-56").count();
    await day(page, "3").click({ position: { x: 4, y: 4 } });
    await page.waitForTimeout(600);
    facts.collapsedAgain = await page.locator("div.hidden.sm\\:block button.sm\\:min-h-56").count();

    // double-click -> day detail dialog
    await day(page, "18").dblclick({ position: { x: 4, y: 4 } });
    await page.waitForTimeout(500);
    snapshots.dayDetail = await snapshot(page);
    facts.dayDetailOpen = await page.getByText("2026-11-18", { exact: true }).count();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // right-click -> quick-actions menu (managers only)
    await day(page, "3").click({ button: "right", position: { x: 4, y: 4 } });
    await page.waitForTimeout(400);
    snapshots.contextMenu = await snapshot(page);
    facts.contextMenu = await page.getByText("Remove from Schedule").count();
    await page.keyboard.press("Escape");
    await page.mouse.click(1390, 990);
    await page.waitForTimeout(400);

    // note: click -> inline editor (managers only); Escape -> nothing saved
    await page.locator("div.hidden.sm\\:block").getByText("Launch day @Sam").click();
    await page.waitForTimeout(400);
    snapshots.noteEdit = await snapshot(page);
    facts.noteEditor = await page.locator("div.hidden.sm\\:block textarea").count();
    if (facts.noteEditor) {
      await page.locator("div.hidden.sm\\:block textarea").pressSequentially(" x");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    facts.actionsAfterNoteCancel = actions.length;

    // real drag-and-drop: the 3rd's carousel chip onto the 12th
    if (manage) {
      const chip = page.locator("div.hidden.sm\\:block a[href='/projects/p1/posts/a1']").first();
      const from = await chip.boundingBox();
      const to = await day(page, "12").boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 20, from.y + 10, { steps: 4 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
      await page.waitForTimeout(200);
      facts.dropHighlight = await day(page, "12").evaluate((el) => el.className.includes("bg-black/[.04]"));
      await page.mouse.up();
      await page.waitForTimeout(800);
      facts.dragActions = actions.slice();
    }
  } else {
    await page.locator("div.sticky button").filter({ hasText: /^18$/ }).first().click();
    await page.waitForTimeout(900);
    snapshots.mobileSelected = await snapshot(page);
    facts.highlighted = await page.locator("#cal-day-2026-11-18").evaluate((el) => el.className.includes("bg-black/[.05]"));
    facts.dayMenus = await page.locator("div.sm\\:hidden button[title='Day options']").count();
    facts.stripTiles = await page.locator("#cal-day-2026-11-10 a[href^='/projects/']").count();
  }

  await ctx.close();
  return { snapshots, facts };
}

async function run(browser) {
  for (const manage of [true, false]) {
    for (const mobile of [false, true]) {
      const tag = `${mobile ? "mobile" : "desktop"}/${manage ? "manager" : "read-only"}`;
      const oldRun = await session(browser, "old", { manage, mobile });
      const newRun = await session(browser, "new", { manage, mobile });

      for (const state of Object.keys(oldRun.snapshots)) {
        await check(`${tag}: "${state}" DOM identical to HEAD`, () => {
          const a = oldRun.snapshots[state];
          const b = newRun.snapshots[state];
          if (a !== b) throw new Error(firstDiff(a, b));
        });
      }
      await check(`${tag}: interaction results identical to HEAD`, () => {
        assert.deepEqual(newRun.facts, oldRun.facts);
      });

      const f = newRun.facts;
      await check(`${tag}: expected behaviour`, () => {
        assert.deepEqual(f.navHrefs, ["?month=2026-10", "?month=2026-12"]);
        assert.ok(f.chipHrefs.includes("/projects/p1/posts/a1"));
        assert.equal(f.drafts, manage ? 1 : 0, "Drafts panel only for managers");
        if (!mobile) {
          assert.equal(f.expandedCells, 7, "single click expands the whole week");
          assert.equal(f.collapsedAgain, 0);
          assert.equal(f.dayDetailOpen > 0, true, "double-click opens day detail");
          assert.equal(f.contextMenu, manage ? 1 : 0, "right-click menu only for managers");
          assert.equal(f.noteEditor, manage ? 1 : 0, "note editing only for managers");
          assert.equal(f.actionsAfterNoteCancel, 0, "cancelled note saves nothing");
          if (manage) {
            assert.equal(f.dropHighlight, true, "hovered day shows the drop highlight");
            assert.equal(f.dragActions.length, 1, "one scheduleItem call");
            assert.match(f.dragActions[0], /"p1".*"post".*"a1".*"2026-11-12"/, "drop schedules a1 on the 12th");
          }
        } else {
          assert.equal(f.highlighted, true, "tapping a mini-calendar date highlights that day");
          assert.equal(f.dayMenus > 0, manage, "⋮ day menu only for managers");
          assert.equal(f.stripTiles, 4, "the 10th's strip shows all four tiles");
        }
      });
    }
  }
}

if (fs.existsSync(HARNESS_DIR)) {
  console.error(`Refusing to run: ${HARNESS_DIR} already exists.`);
  process.exit(1);
}
let server;
let browser;
try {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(path.join(HARNESS_DIR, "page.tsx"), HARNESS);
  const oldBoard = execSync(`git show "HEAD:${BOARD}"`, { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(path.join(HARNESS_DIR, "old-board.tsx"), oldBoard);
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
  // next dev registers every route it compiled in generated type stubs
  // (.next/dev/types, included by tsconfig). Left alone, they'd keep
  // referencing the deleted harness page and break `tsc`/`next build`.
  // Regenerated by the next `next dev` run.
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
