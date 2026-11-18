# GST Tools Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension whose side panel downloads R1 JSON, GSTR-2B JSON/Excel, GSTR-3B ACK and GSTR-1 PDF ACK for chosen months by driving a dedicated, logged-in GST portal tab.

**Architecture:** `background.js` (service worker) owns the run: it opens a dedicated portal tab, injects `lib/match.js` + `content/portal.js` after every page load, and sends page-operation messages ("select this", "click that") step by step, mirroring `gst_bot.py`. Downloads are renamed through `chrome.downloads.onDeterminingFilename`. The side panel only shows state and sends start/stop.

**Tech Stack:** Plain JavaScript (no bundler, no npm), Chrome MV3 APIs. Tests: plain HTML test pages run in headless Chrome by `tests/run_tests.py` (Python `py` launcher; Node is not installed on this machine).

**Spec:** `docs/superpowers/specs/2026-11-18-gst-tools-extension-design.md`
Port source (read-only reference): `C:\Users\ASIF\Documents\Default Project\gst_bot.py` (commit `6194cf6`).

## Global Constraints

- Manifest V3; no remote code, no `eval`, no network calls of our own, no analytics.
- `host_permissions`: exactly `https://services.gst.gov.in/*`, `https://return.gst.gov.in/*`.
- `permissions`: exactly `sidePanel`, `downloads`, `storage`, `scripting` (spec listed `tabs`; host permissions already expose portal tab URLs, so `tabs` is dropped — narrower for Web Store review).
- No `content_scripts` in the manifest: scripts are injected only into the run's tab, so the user's own portal tab is never touched.
- Saved file path: `GST Downloads/<TAG>_<FY>_<Month>_<original name>`, `conflictAction: "uniquify"`.
- Month keys exactly as desktop: `April, May, June, Jul, Aug, Sep, Oct, Nov, Dec, Jan, Feb, Mar`; panel labels `Apr … Mar`.
- FY choices: current FY and the 4 before it (5 total, same as desktop `_fy_choices`), format `2025-26`.
- Branding: "GST TOOLS · Asif & Associates". Colours from desktop: navy `#14213d`, bg `#eef1f6`, accent `#1d4ed8`, teal `#0f766e`, ok `#15803d`, warn `#b45309`, err `#b91c1c`, border `#d8dee8`.
- User-facing pending/requested wording copied from desktop (`gst_bot.py` `_grab_json`, `_request_json`, `_grab_excel`; `gst_tools.py` `_do_download`).
- One shared script `lib/match.js` is a classic script that sets `globalThis.GSTMatch`; it is loaded by the worker (`importScripts`), the content script (injected first) and the test pages.

## Review Focus

1. **Session expires mid-run** (portal shows login page or "Access Denied") → run stops, remaining months are marked "not run", panel says "Log in again". Test: Task 4 `stops on access denied`.
2. **User closes the run tab or the side panel mid-run** → closing the tab ends the run with a clear log line; closing the panel does not stop the run, and reopening it shows current progress. Test: Task 4 `run tab closed`, Task 5 manual check.
3. **A download the user starts themselves during a run** (e.g. in their own tab) must not be renamed. Rename only while armed AND the download's `referrer`/`url` host ends with `gst.gov.in` AND it starts within the armed window. Test: Task 1 `isPortalDownload`, Task 4 arming.
4. **No logged-in portal tab when DOWNLOAD is pressed** → panel shows "Please log in" + "Open GST portal" button; no run starts. Test: Task 5 manual check.
5. **Service worker suspended mid-run** → state in `chrome.storage.session`; on worker start, an unfinished run is resumed at the current month (month restarted from its first step). Test: Task 4 `resume`.

---

### Task 1: Project skeleton, shared matching library, test harness

**Files:**
- Create: `manifest.json`, `icons/icon16.png icon32.png icon48.png icon128.png`, `tools/make_icons.py`
- Create: `lib/match.js`
- Create: `tests/run_tests.py`, `tests/harness.js`, `tests/match.html`, `tests/match.test.js`
- Create: `.gitignore` (`dist/`, `__pycache__/`)

**Interfaces — Produces (`globalThis.GSTMatch`):**
- `MONTHS: string[]` (12 keys above), `SHORT: string[]`, `QUARTER_OF: {[m]: 1..4}`, `MONTH_FULL: {[m]: string}`
- `TASKS: {[key]: {title, flow: "dashboard"|"filed_pdf", ret, tag, fmt?: "excel"}}` — five keys `r1_json, gstr2b_json, gstr2b_excel, gstr3b_ack, gstr1_pdf_ack`, values from spec §2 table (`r1_json`/`gstr2b_*` flow `"dashboard"`).
- `LINK_RX, JSON_RX, EXCEL_RX, PDF_RX, PDF_AVOID_RX, SEARCH_RETRY_RX` — strings (spec §3.5, §3.7; `SEARCH_RETRY_RX = "system failure|try again|error"`).
- `norm(s): string`, `formRegex(name): string`, `bestMatch(options: string[], wanted: string): string|null` — exact ports of `_norm`, `form_regex`, `_best_match`.
- `isQuarterRange(s): boolean` — `/[a-z]{3,}\s*(-|to)\s*[a-z]{3,}/i`.
- `fyChoices(today: Date): string[]`
- `savedName(tag, fy, month, original): string` — `GST Downloads/<tag>_<fy>_<month>_<basename>`; strips any folder part of `original`; unchanged basename if it already starts with the prefix.
- `isPortalDownload(item: {url, referrer, finalUrl}): boolean` — any of them has host ending `gst.gov.in`.
- `summarize(results: {[month]: {state}}): {saved[], requested[], pending[], failed[], notRun[]}`

- [ ] **Step 1:** Write `tests/harness.js` (tiny `test(name, fn)`, `eq(a,b)`, `ok(x)`; on load writes `<pre id="result">PASS n</pre>` or `FAIL …` lines into the body) and `tests/run_tests.py`: for every `tests/*.html`, run `chrome.exe --headless=new --disable-gpu --allow-file-access-from-files --dump-dom file:///…` (Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`), parse `#result`, print per-file result, exit 1 on any FAIL or missing result.
- [ ] **Step 2: Write failing tests** in `tests/match.test.js` (loaded by `tests/match.html` after `../lib/match.js`):
  - `LINK_RX matches portal link texts`: matches `"Download here"`, `"Click here to download - File 1"`, `"File 2"`; not `"GENERATE JSON FILE TO DOWNLOAD"`, `"GENERATE EXCEL FILE TO DOWNLOAD"`, `"Download"`.
  - `EXCEL_RX`/`JSON_RX` each match only their own generate button text.
  - `formRegex`: `"GSTR-1"` matches `"gstr-1"`, `"gstr1"`, `"gstr 1/iff"`; not `"gstr-1a"`. `"GSTR-2B"` matches `"gstr2b"`.
  - `bestMatch`: `(["July","June"],"Jul") → "July"`; `(["2024-2025","2025-2026"],"2025-26") → "2025-2026"`; `(["GSTR-1A","GSTR-1"],"GSTR-1") → "GSTR-1"`; `(["Quarter 1 (Apr - Jun)"],"Quarter 1") → "Quarter 1 (Apr - Jun)"`; `(["x"],"") → null`.
  - `isQuarterRange("Oct - Dec") === true`, `isQuarterRange("October") === false`.
  - `fyChoices(new Date(2026,10,18))` → `["2026-27","2025-26","2024-25","2023-24","2022-23"]`; `fyChoices(new Date(2026,1,1))[0] === "2025-26"`.
  - `savedName("GSTR2B_EXCEL","2025-26","June","C:\\x\\a.xlsx") === "GST Downloads/GSTR2B_EXCEL_2025-26_June_a.xlsx"`; already-prefixed basename kept as is.
  - `isPortalDownload`: true for `referrer "https://return.gst.gov.in/returns/auth/gstr2b"`; true for url on `files.gst.gov.in`; false for `https://example.com/a.pdf` with empty referrer.
  - `summarize` buckets each state; `notRun` for state `"not_run"`.
- [ ] **Step 3:** Run `py tests/run_tests.py` → Expected: FAIL (GSTMatch undefined).
- [ ] **Step 4:** Implement `lib/match.js` (IIFE, `"use strict"`, assigns `globalThis.GSTMatch`). Use JS regex lookbehind for `formRegex` exactly as Python.
- [ ] **Step 5:** Run `py tests/run_tests.py` → Expected: `match.html PASS`.
- [ ] **Step 6:** `manifest.json`: name "GST Tools", version `0.1.0`, description "Download GST returns (GSTR-1, GSTR-2B, GSTR-3B) for many months from the GST portal.", `background.service_worker: "background.js"`, `side_panel.default_path: "sidepanel/index.html"`, `action.default_title: "GST Tools"`, icons, permissions/host_permissions per Global Constraints, `minimum_chrome_version: "116"`. `tools/make_icons.py` draws a navy rounded square with white "GST" via PIL at 16/32/48/128 px; run it.
- [ ] **Step 7:** Commit: `git add -A && git commit -m "feat: skeleton, shared matching library and tests"`.

### Task 2: Content script — page operations

**Files:**
- Create: `content/portal.js`
- Create: `tests/portal.html` (contains the three fixture `<template>`s), `tests/portal.test.js`

**Interfaces:**
- Consumes: `GSTMatch.*` (Task 1).
- Produces: `globalThis.GSTPortal` with the ops below; when `chrome?.runtime?.onMessage` exists and not already installed (`window.__gstPortal` guard — the script is injected after every load and may be injected twice), registers a listener: message `{op, args}` → `sendResponse(await GSTPortal[op](...args))`, errors as `{error: string}`. All ops return JSON-serialisable values; elements are addressed by a `data-gst-id` attribute the op assigns.
  - `state(): {url, title, login: bool, denied: bool, selects: number}` — `login` = path contains `/services/login`; `denied` = title or URL contains "access denied"/"accessdenied" or a visible heading text "Access Denied!".
  - `controls(pattern): {id, text}[]` — port of `JS_CONTROLS` over `CONTROLS = "a, button, input[type=button], input[type=submit]"`.
  - `tileButton(formRx, words: string[]): {id, text}|null` — port of `JS_TILE_BUTTON`.
  - `click(id): boolean` — scrollIntoView then `.click()`.
  - `selectLabelled(labels: string[], value): {ok, match?, options?, found}` — port of `_select_labelled` single pass (no waiting; worker retries). Selecting = set `selectedIndex`, dispatch `input` and `change` (bubbles) so AngularJS sees it.
  - `selectMonthPeriod(month, quarter): {done: bool, changed: bool, seen}` — one pass of `_select_month_period`.
  - `filedFiltersOk(fy, month, ret): boolean` — port.
  - `rowLabel(id): string` — port of `_row_label`.
  - `pageMessage(): string` — port of `_page_message`.
  - `acceptModal(): string|null` — clicks visible modal control matching `^(proceed|yes|ok|download.*)$`, returns its text.
  - `dismissPopups(): number`.
  - `navigate(path, url): "menu link"|"page script"` — port of `JS_NAV`.
  - `debugInfo(): {url, title, message, controls: string[] (first 40 texts), selects: {desc, options}[]}`.

- [ ] **Step 1: Fixtures** — `<template>`s in `tests/portal.html` imitating the portal: `dashboard.html` (FY/Quarter/Period selects with labels; tiles "GSTR-1/IFF" with DOWNLOAD, "GSTR-1A" with DOWNLOAD, "GSTR-2B" with VIEW and DOWNLOAD; a `<nav>` containing a "Download" link); `gstr2b.html` (buttons "GENERATE JSON FILE TO DOWNLOAD", "GENERATE EXCEL FILE TO DOWNLOAD" below it, table rows "GSTR-2B Summary | Download here", "GSTR-2B Details - Part 1 | Download here"); `filed.html` (FY select, "Return Filing Period" select Annual/Quarterly/Monthly that adds a month select on change to Monthly via inline script, return type select).
- [ ] **Step 2: Write failing tests** (`tests/portal.html` loads `harness.js`, `../lib/match.js`, `../content/portal.js`; fixtures are `<template>` elements in `portal.html` — `fetch` does not work on `file://` — and each test copies one into a fresh `<div id="stage">`; the fixture files of Step 1 are the sources pasted into those templates, so make them `<template>` blocks directly instead of separate files):
  - `tileButton picks GSTR-1 not GSTR-1A` (formRegex("GSTR-1"), ["download"]) → text "DOWNLOAD" inside the GSTR-1/IFF tile.
  - `tileButton for GSTR-2B prefers download over view` with words `["download","view"]`.
  - `controls ignores nav` — `controls("^download$")` doesn't return the nav link.
  - `controls(LINK_RX) finds two Download here links`; `rowLabel` → `"GSTR-2B Summary"`, `"GSTR-2B Details - Part 1"`.
  - `controls(EXCEL_RX)` finds exactly the Excel button.
  - `selectLabelled(["financial year"], "2025-26")` → `{ok:true, match:"2025-2026"}` and a `change` listener on the select fired.
  - `selectMonthPeriod("June", 1)` first pass → `changed:true` (picked Monthly); second pass → `done:true`, month select = "June"; then `filedFiltersOk("2025-26","June","GSTR-3B")` true after selecting type.
  - `state()` on a body with `<h4>Access Denied!</h4>` → `denied:true`.
- [ ] **Step 3:** Run `py tests/run_tests.py` → `portal.html` FAIL.
- [ ] **Step 4:** Implement `content/portal.js`.
- [ ] **Step 5:** Run → both pages PASS.
- [ ] **Step 6:** Commit `feat: content-script page operations`.

### Task 3: Download tracking and renaming

**Files:**
- Create: `background/downloads.js` (classic script, `importScripts`-ed by `background.js`)
- Test: `tests/downloads.html`, `tests/downloads.test.js` (with a fake `chrome.downloads` object)

**Interfaces:**
- Consumes: `GSTMatch.savedName`, `GSTMatch.isPortalDownload`.
- Produces `globalThis.GSTDownloads`:
  - `install(chromeDownloads)` — adds `onCreated`, `onDeterminingFilename`, `onChanged` listeners once.
  - `arm({tag, fy, month}): void` — subsequent portal downloads are named for this month until `disarm()`.
  - `disarm(): void`
  - `waitNew(sinceMs: number, timeoutMs: number): Promise<{id, filename}[]>` — resolves with downloads created at/after `sinceMs` (while armed) once all of them are `complete` and none in progress for 1 s; `[]` on timeout; extends the deadline by 5 s while any is still in progress (port of `_wait_new_files`).
  - `hasNew(sinceMs): boolean` — any armed download created since.
  - `lastSavedId(): number|null`.

- [ ] **Step 1: Failing tests:** `renames portal download while armed` (fake item referrer return.gst.gov.in → suggest called with `{filename:"GST Downloads/GSTR1_ACK_2025-26_April_x.pdf", conflictAction:"uniquify"}`); `ignores non-portal download`; `ignores download while disarmed` (suggest called with no args); `waitNew resolves after complete`; `waitNew returns [] on timeout` (timeout 50 ms); `interrupted download is not returned`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: download tracking and naming`.

### Task 4: Run engine (service worker)

**Files:**
- Create: `background.js`, `background/engine.js`, `background/tabs.js`
- Test: `tests/engine.html`, `tests/engine.test.js` (fake `page` driver + fake downloads)

**Interfaces:**
- Consumes: Tasks 1–3.
- `background/tabs.js` → `globalThis.GSTTabs`:
  - `openRunTab(): Promise<tabId>` — create a background-inactive=false tab at `https://services.gst.gov.in/services/auth/dashboard` in the current window, wait for load.
  - `findLoggedInPortalTab(): Promise<tab|null>` — `chrome.tabs.query({url:["https://services.gst.gov.in/*","https://return.gst.gov.in/*"]})`, excluding `/services/login` and the run tab.
  - `waitLoad(tabId, timeoutMs=60000)`, `waitPageChange(tabId, timeoutMs=60000)` (resolves on next `status:"complete"` after a `loading`), `inject(tabId)` — `scripting.executeScript` files `lib/match.js`, `content/portal.js`; then MAIN-world function overriding `window.alert/confirm/prompt` to log + return true/"" (kept on `window.__gstAlerts` so the worker can log them).
  - `angularIdle(tabId, timeoutMs)` — MAIN-world poll of `angular.element(document.body).injector().get('$http').pendingRequests.length` (port of `_wait_portal_idle`).
  - `page(tabId)` → object with the Task 2 ops as async methods via `chrome.tabs.sendMessage` (re-injecting once on "Receiving end does not exist").
  - Tracks tabs created with `openerTabId` = run tab (`onCreated`) → `followNewTab(waitMs=3000)` switches the run's active tab id; `closeExtraTabs()` closes them.
- `background/engine.js` → `globalThis.GSTEngine`:
  - `runMonth(ctx, task, fy, month, mode): Promise<{state, files: string[], note}>` — `ctx = {page(), nav(path,url,name), waitIdle(ms), sleep(ms), downloads, log(msg), followNewTab(), checkStop()}`. Steps are a direct port of `_dashboard_json_month`, `_open_offline_download_tab`, `_request_json`, `_grab_json`, `_grab_excel`, `_click_links` (arm downloads before each click; `waitNew(since, 120000)` per link), `_filed_pdf_month`, `_wait_pdf_button`, using the timeouts in spec §3.9 and the retry counts in the source. Throws `NotReady(msg)` → pending, `SessionExpired(msg)` → stops the batch.
  - `runBatch(ctx, taskKey, fy, months, mode, startIndex=0, prior={}): Promise<results>` — port of `download_batch`; before each month checks `state()` for login/denied → `SessionExpired`; on any other error logs `ERROR (<month>): <msg>`, stores `debugInfo()` + message in `chrome.storage.local.debug` (keep last 10) and continues; on `SessionExpired` marks the rest `not_run`; persists `{taskKey, fy, months, mode, index, results}` to `chrome.storage.session.run` after each month; finally logs `=== finished: k/n month(s) done ===`.
- `background.js`: `importScripts("lib/match.js","background/downloads.js","background/tabs.js","background/engine.js")`; `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`; message API from the panel: `{cmd:"status"}` → `{loggedIn, running, run, log}`; `{cmd:"start", taskKey, fy, months, mode}`; `{cmd:"stop"}`; `{cmd:"openPortal"}` (opens `https://services.gst.gov.in/services/login`); `{cmd:"openFolder"}` (`downloads.show(lastSavedId)` else `showDefaultFolder()`); `{cmd:"debug"}` → stored debug records. Log lines go to `chrome.storage.session.log` (last 300) and are broadcast `{evt:"log", line, kind}`; summary lines with desktop wording (`Downloaded: …`, `Generation requested: … - press DOWNLOAD in about 20 minutes.`, `Not ready yet: … - …`, `Failed: … (details above).`). On worker start: if `storage.session.run` is unfinished and its tab still exists → resume at `index`. `tabs.onRemoved` of the run tab → stop with "Run tab was closed - run stopped."

- [ ] **Step 1: Failing tests** with a scripted fake `page` (returns canned op results per step) and fake downloads:
  - `2B json downloads Download-here links` — controls(LINK_RX) empty first, after JSON click returns 2 links → 2 clicks, result `saved` with 2 files.
  - `2B json pending when nothing appears` → state `pending`, note starts "The portal is still preparing the file".
  - `excel downloads only new links` — 2 links before, 3 after → clicks only index 2.
  - `r1 generate requested`.
  - `stops on access denied` — month 2 `state().denied` → month 2+ `not_run`, run ends, log contains "log in again".
  - `failed month continues` — month 1 throws → `failed`, month 2 `saved`, debug record stored.
  - `run tab closed` — `checkStop()` throws Stopped → remaining months `not_run`.
  - `resume` — `runBatch(..., startIndex=1, prior={April:{state:"saved"}})` keeps April and runs from May.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `engine.js` (pure, ctx-driven), then `tabs.js` and `background.js` (Chrome-API glue, not unit tested). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: run engine and service worker`.

### Task 5: Side panel

**Files:**
- Create: `sidepanel/index.html`, `sidepanel/panel.css`, `sidepanel/panel.js`

**Interfaces:** Consumes the Task 4 message API and `{evt:"log"|"status"|"done"}` broadcasts; `GSTMatch.TASKS/MONTHS/SHORT/fyChoices`.

- [ ] **Step 1:** Build the layout of spec §5.3: header (navy) with "GST TOOLS · Asif & Associates"; login status line + "Open GST portal" button when not logged in; FY select; five return-type radio buttons (labels from desktop `COLUMN_TITLES`); month grid 6×2 with All/None; buttons DOWNLOAD (accent), GENERATE R1 JSON (teal, enabled only for `r1_json` with ≥1 month), Stop (visible while running), Open folder, Copy debug info; activity log (monospace, time-stamped, coloured by kind, auto-scroll, Clear); note line from desktop about R1 JSON's 20-minute generation.
- [ ] **Step 2:** `panel.js`: restore last FY/type/months from `storage.local.prefs`; poll `{cmd:"status"}` every 3 s for login state; disable controls while running; on open, render stored log and current run progress.
- [ ] **Step 3: Verify** with `tests/panel.html` that loads `../sidepanel/index.html` in an iframe with a stub `chrome` (sendMessage returns `{loggedIn:false, running:false, log:[]}`): asserts 5 radios, 12 checkboxes, GENERATE disabled for `gstr2b_excel`, "Open GST portal" visible. Run `py tests/run_tests.py` → all PASS.
- [ ] **Step 4:** Commit `feat: side panel`.

### Task 6: Packaging, docs, live check

**Files:**
- Create: `tools/build_zip.ps1`, `README.md`, `PRIVACY.md`, `docs/live-test-checklist.md`

- [ ] **Step 1:** `tools/build_zip.ps1`: reads version from `manifest.json`, zips `manifest.json, background.js, background/, content/, lib/, sidepanel/, icons/` to `dist/gst-tools-extension-<version>.zip`. Run it → zip exists; list its entries and confirm no `tests/`, `docs/`, `tools/`.
- [ ] **Step 2:** Validate the manifest loads: a headless check is not possible for branded Chrome extensions, so `tests/run_tests.py --manifest` parses `manifest.json` and asserts permissions/host_permissions equal Global Constraints and every referenced file exists.
- [ ] **Step 3:** `README.md`: what it does; install from zip in 5 steps (download zip → unzip → `chrome://extensions` → Developer mode on → Load unpacked → pin); use (log in to portal, click icon, tick, DOWNLOAD); where files go; troubleshooting ("Copy debug info"). `PRIVACY.md`: no data collected or sent; files stay on the computer; permissions explained one line each.
- [ ] **Step 4:** `docs/live-test-checklist.md`: per return type, one month each + GSTR-2B June (the month that failed in the desktop app), GENERATE R1, session-expiry behaviour, closing panel mid-run, closing run tab mid-run, own download during run not renamed.
- [ ] **Step 5:** Commit `chore: packaging, README, privacy policy, live checklist`.
- [ ] **Step 6:** Owner loads the unpacked extension and runs the live checklist (needs real login) — fixes from that go in follow-up commits.
