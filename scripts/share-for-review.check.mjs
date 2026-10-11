// Opt-in REAL-BROWSER regression check for the Share for Review flow
// (projects/[projectId]/share-menu.tsx + use-share-for-review.tsx). Not part
// of the default test run: it starts a Next dev server and needs
// Playwright's Chromium AND WebKit (npx playwright install chromium webkit).
//
//   node scripts/share-for-review.check.mjs
//
// Mounts the REAL ShareMenuButton, the REAL useShareForReview hook and its
// REAL "link created" dialog on fixture data, through a TEMPORARY page it
// creates under a proxy-public path and ALWAYS deletes again afterwards
// (same approach as scripts/post-editor-media-viewer.check.mjs). The create
// action is the hook's injectable `create` -- a local fake that counts its
// calls -- so nothing here touches a database, and "exactly one link per
// submission" is measured directly. The clipboard is replaced per scenario
// (works / denies like Safari / missing entirely).
//
// What this does NOT cover: the real server action and RLS (see
// scripts/share-links-rls.check.mjs and src/lib/review-link.test.ts), and
// the two boards' own wiring of this hook. Playwright's WebKit is not Safari
// on macOS.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-share-review-harness-check");
const PORT = 3126;
const BASE = `http://localhost:${PORT}/preview-share-review-harness-check`;
const DENIED = "Only owners, admins and members can create review links for this project.";

const HARNESS = `"use client";
// TEMPORARY -- created and deleted by scripts/share-for-review.check.mjs. Never commit.
import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShareMenuButton } from "../projects/[projectId]/share-menu";
import { useShareForReview } from "../projects/[projectId]/use-share-for-review";
import { Toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
const LINKS = [
  { id: "l1", token: "tok-mine", title: "Mine", createdAt: "2026-01-02T00:00:00Z", itemCount: 2, canDelete: true },
  { id: "l2", token: "tok-theirs", title: "Theirs", createdAt: "2026-01-01T00:00:00Z", itemCount: 1, canDelete: false },
];
export default function Harness() {
  const params = useSearchParams();
  const server = params.get("server") ?? "ok";
  const canCreate = params.get("role") !== "viewer";
  const [selecting, setSelecting] = useState(false);
  const [calls, setCalls] = useState(0);
  const [created, setCreated] = useState(0);
  const n = useRef(0);
  const create = useCallback(async () => {
    n.current += 1;
    setCalls(n.current);
    await new Promise((r) => setTimeout(r, 500));
    if (server === "denied") return { message: "${DENIED}" };
    if (server === "throw") throw new Error("network down");
    return { success: true, token: "tok-new-" + n.current };
  }, [server]);
  const onCreated = useCallback(() => { setSelecting(false); setCreated((c) => c + 1); }, []);
  const { sharing, share, toastMessage, createdLinkDialog } = useShareForReview({ projectId: "p", field: "post_ids", onCreated, create });
  return (
    <div className="p-6" data-calls={calls} data-created={created} data-selecting={selecting ? "1" : "0"}>
      <div className="flex justify-end">
        <ShareMenuButton projectId="p" links={LINKS} canCreateLinks={canCreate} tableMissing={false} onEnterSelectionMode={() => setSelecting(true)} showLabel />
      </div>
      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-center gap-3 border-t border-border bg-background px-4 py-3">
          <Button type="button" variant="primary" radius="none" data-confirm="" onClick={() => share(["a", "b"])} disabled={sharing}>
            {sharing ? "Sharing…" : "Share for Review"}
          </Button>
        </div>
      )}
      {createdLinkDialog}
      <Toast message={toastMessage} />
    </div>
  );
}
`;

// navigator.clipboard, per scenario. Installed before any page script runs.
const CLIPBOARD = {
  works: () => {
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => void window.__copied.push(t) } });
  },
  // What Safari does to a write that is no longer part of the user's click.
  denied: () => {
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException("The request is not allowed by the user agent.", "NotAllowedError")) },
    });
  },
  missing: () => {
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  },
};

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

async function run(engine, browser) {
  for (const [label, viewport, mobile] of [
    ["desktop", { width: 1280, height: 800 }, false],
    ["mobile", { width: 390, height: 844 }, true],
  ]) {
    const name = `${engine} / ${label}`;
    async function open(clipboard, query = "") {
      const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
      const page = await ctx.newPage();
      await page.addInitScript(CLIPBOARD[clipboard]);
      await page.goto(BASE + query, { waitUntil: "load" });
      const trigger = page.locator("button[title='Share & export']");
      await trigger.waitFor({ timeout: 60000 });
      // Hydrated once the menu actually opens on click.
      for (const end = Date.now() + 60000; ; ) {
        await trigger.click();
        if (await page.getByText("Share review", { exact: true }).count()) break;
        if (Date.now() > end) throw new Error("page never hydrated");
        await page.waitForTimeout(250);
      }
      const state = () =>
        page.evaluate(() => {
          const d = document.querySelector("[data-calls]").dataset;
          return { calls: Number(d.calls), created: Number(d.created), selecting: d.selecting === "1", copied: window.__copied };
        });
      const enterSelection = async () => {
        if (!(await page.getByText("Share review", { exact: true }).count())) await trigger.click();
        await page.getByRole("button", { name: "Share for Review", exact: true }).click();
        await page.locator("[data-confirm]").waitFor();
      };
      return { ctx, page, state, enterSelection, trigger };
    }

    {
      const { ctx, page, state, enterSelection } = await open("works");
      await check(`${name}: clipboard works -> one link, copied, toast, selection exits`, async () => {
        await enterSelection();
        await page.locator("[data-confirm]").click();
        await page.getByText("Review link copied to clipboard").waitFor({ timeout: 5000 });
        const s = await state();
        assert.deepEqual({ calls: s.calls, created: s.created, selecting: s.selecting }, { calls: 1, created: 1, selecting: false });
        assert.equal(s.copied.length, 1);
        assert.match(s.copied[0], new RegExp(`^http://localhost:${PORT}/preview/tok-new-1$`));
        assert.equal(await page.locator("[data-review-link-created]").count(), 0);
      });
      await ctx.close();
    }

    for (const clipboard of ["denied", "missing"]) {
      const { ctx, page, state, enterSelection } = await open(clipboard);
      await check(`${name}: clipboard ${clipboard} -> link still created ONCE, shown in a selectable field`, async () => {
        await enterSelection();
        await page.locator("[data-confirm]").click();
        const dialog = page.locator("[data-review-link-created]");
        await dialog.waitFor({ timeout: 5000 });
        const s = await state();
        assert.deepEqual({ calls: s.calls, created: s.created, selecting: s.selecting }, { calls: 1, created: 1, selecting: false });
        const input = dialog.locator("input[aria-label='Review link']");
        assert.equal(await input.inputValue(), `http://localhost:${PORT}/preview/tok-new-1`);
        assert.equal(await input.getAttribute("readonly"), "");
        // Focusing the field selects the whole link, ready for a manual copy.
        await input.focus();
        const sel = await input.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
        assert.equal(sel, `http://localhost:${PORT}/preview/tok-new-1`);
        assert.equal(await page.locator("[data-confirm]").count(), 0, "confirm bar is gone -- no way to submit the same selection again");
      });
      await check(`${name}: clipboard ${clipboard} -> the field's own Copy never creates another link, and says so when blocked`, async () => {
        const dialog = page.locator("[data-review-link-created]");
        await dialog.getByRole("button", { name: "Copy", exact: true }).click();
        await dialog.getByText("Copying is blocked in this browser").waitFor({ timeout: 3000 });
        await dialog.getByRole("button", { name: "Done" }).click();
        assert.equal(await dialog.count(), 0);
        const s = await state();
        assert.deepEqual({ calls: s.calls, created: s.created }, { calls: 1, created: 1 });
      });
      await ctx.close();
    }

    {
      const { ctx, page, state, enterSelection } = await open("denied");
      await check(`${name}: repeated clicking while pending -> exactly ONE create call`, async () => {
        await enterSelection();
        // Five clicks inside one task, before React can re-render the button as disabled.
        await page.locator("[data-confirm]").evaluate((btn) => {
          for (let i = 0; i < 5; i++) btn.click();
        });
        await page.waitForTimeout(150);
        assert.equal(await page.locator("[data-confirm]").isDisabled(), true, "disabled while pending");
        await page.locator("[data-confirm]").click({ force: true }).catch(() => {});
        await page.locator("[data-review-link-created]").waitFor({ timeout: 5000 });
        const s = await state();
        assert.deepEqual({ calls: s.calls, created: s.created }, { calls: 1, created: 1 });
      });
      await ctx.close();
    }

    for (const [server, expected] of [
      ["denied", DENIED],
      ["throw", "Couldn't create the review link. Please try again."],
    ]) {
      const { ctx, page, state, enterSelection } = await open("works", `?server=${server}`);
      await check(`${name}: server ${server === "denied" ? "rejects (role/RLS)" : "throws"} -> friendly message, nothing copied, selection kept for a retry`, async () => {
        await enterSelection();
        await page.locator("[data-confirm]").click();
        await page.getByText(expected).waitFor({ timeout: 5000 });
        const text = await page.locator("body").innerText();
        assert.ok(!/row-level security|violates|network down/i.test(text), "no raw error text on screen");
        const s = await state();
        assert.deepEqual({ calls: s.calls, created: s.created, selecting: s.selecting, copied: s.copied.length }, { calls: 1, created: 0, selecting: true, copied: 0 });
        assert.equal(await page.locator("[data-review-link-created]").count(), 0);
        await page.waitForFunction(() => !document.querySelector("[data-confirm]").disabled);
      });
      await ctx.close();
    }

    {
      const { ctx, page, state } = await open("works", "?role=viewer");
      await check(`${name}: Viewer/Client -> Share for Review is unavailable and says why; no selection flow, no Manage entry`, async () => {
        const box = page.locator("[data-share-unavailable]");
        assert.equal(await box.count(), 1);
        assert.equal(await box.getByRole("button", { name: "Share for Review" }).isDisabled(), true);
        assert.ok((await box.innerText()).includes(DENIED));
        await box.getByRole("button", { name: "Share for Review" }).click({ force: true }).catch(() => {});
        assert.equal((await state()).selecting, false);
        assert.equal(await page.getByRole("button", { name: "Manage Review Links" }).count(), 0);
      });
      await ctx.close();
    }

    {
      const { ctx, page, state } = await open("denied");
      await check(`${name}: Manage Review Links -> Delete only on links this user may delete; denied copy falls back to a field`, async () => {
        await page.getByRole("button", { name: "Manage Review Links" }).click();
        await page.getByText("Theirs", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Delete", exact: true }).count(), 1);
        await page.getByRole("button", { name: "Copy Link" }).nth(1).click();
        const field = page.locator("[data-review-link-field] input");
        await field.waitFor({ timeout: 3000 });
        assert.equal(await field.inputValue(), `http://localhost:${PORT}/preview/tok-theirs`);
        assert.equal((await state()).calls, 0);
        assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= viewport.width + 1, "no horizontal overflow");
      });
      await ctx.close();
    }
  }
}

if (fs.existsSync(HARNESS_DIR)) {
  console.error(`Refusing to run: ${HARNESS_DIR} already exists.`);
  process.exit(1);
}
let server;
const browsers = [];
try {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(path.join(HARNESS_DIR, "page.tsx"), HARNESS);
  server = spawn(`npx next dev --port ${PORT}`, { cwd: ROOT, shell: true, stdio: "ignore" });
  await waitForServer(BASE, 180000);
  for (const [engine, type] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await type.launch();
    browsers.push(browser);
    console.log(`\n### ${engine} ${browser.version()}${engine === "webkit" ? " (Playwright build -- not Safari on macOS)" : ""}`);
    await run(engine, browser);
  }
} finally {
  for (const b of browsers) await b.close().catch(() => {});
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
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
