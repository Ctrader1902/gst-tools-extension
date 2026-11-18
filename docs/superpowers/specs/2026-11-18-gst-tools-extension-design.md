# GST Tools — Chrome Extension: Design

Date: 2026-11-18 · Status: draft for approval

## 1. Intent

GST TOOLS (desktop: Python + Selenium + Tkinter, repo `Default Project`)
downloads GST returns for chosen months. The owner wants to **share it with
people who can install a Chrome extension but struggle with desktop
applications**. The extension must therefore install in a few clicks and need
nothing else: no Python, no `run.bat`, no separate browser.

Success: a non-technical user installs it, logs in to the GST portal the way
they always do, opens the side panel, ticks months, presses DOWNLOAD, and the
files land in `Downloads/GST Downloads/` with the same names as today.

## 2. Goals / non-goals / anti-goals

**Goals**
- Same five download types as the desktop app (after commit `6194cf6`):
  | key | column | flow | file prefix |
  |---|---|---|---|
  | `r1_json` | R1 JSON | dashboard JSON (+ GENERATE mode) | `GSTR1_JSON` |
  | `gstr2b_json` | GSTR-2B JSON | dashboard JSON | `GSTR2B_JSON` |
  | `gstr2b_excel` | GSTR-2B Excel | dashboard Excel | `GSTR2B_EXCEL` |
  | `gstr3b_ack` | GSTR-3B ACK | View e-Filed Returns → PDF | `GSTR3B_ACK` |
  | `gstr1_pdf_ack` | GSTR-1 PDF ACK | View e-Filed Returns → VIEW SUMMARY → PDF | `GSTR1_ACK` |
- Batch over several months of one FY for one return type, as today.
- Per-month outcome: saved / requested / pending (not ready) / failed, with an
  activity log, and the run continues past a failed month.
- File naming: `<TAG>_<FY>_<Month>_<original name>` inside
  `Downloads/GST Downloads/`.
- Phase 1: shareable as a zip ("Load unpacked"). Phase 2: Chrome Web Store.
  Phase-1 code must already satisfy Web Store rules (Manifest V3, no remote
  code, narrow permissions) so Phase 2 is packaging only.

**Non-goals**
- Logging in for the user, storing passwords, reading or solving captchas.
- Calling the portal's internal APIs directly (rejected, see §4).
- Firefox/Edge-specific builds (Edge can load the Chrome build; not tested).
- Replacing the desktop app; it stays as is.

**Anti-goals** (would count as failure even if it "works")
- Anything that sends user data (GSTIN, files, logs) off the user's machine.
- Behaviour that makes the portal show "Access Denied" more than a person
  clicking would (e.g. typing return URLs into the address bar).
- A setup step beyond "add extension, pin it".

## 3. Constraints learned from the desktop app

These are hard-won and must carry over:
1. **Navigate by clicking the portal's own links.** Loading
   `return.gst.gov.in/...` URLs directly gives "Access Denied". The desktop app
   clicks the (hidden) menu `<a>` whose pathname matches, else sets
   `location.href` from inside a portal page (`JS_NAV`).
2. **AngularJS forms reset themselves.** On View e-Filed Returns, choosing the
   FY resets other fields; "Return Filing Period = Monthly" adds a month
   dropdown (sometimes a quarter dropdown first). Fill → wait until Angular has
   no pending `$http` requests → verify all three fields → retry up to 3×.
3. **Dropdowns are found by label/name/id/ng-model text**, options by fuzzy
   match (`_best_match`, month long/short names, "Quarter N").
4. **Return tiles/rows are found by the nearest ancestor mentioning a GSTR
   form**, which must match the wanted form (`JS_TILE_BUTTON`, `form_regex`
   that distinguishes GSTR-1 from GSTR-1A).
5. **Link patterns** for ready files:
   `click here to download|^file\s*\d+|download.*file\s*\d+|^download\s*here$`;
   JSON button `generate.*json|json`; Excel button `generate.*excel|excel`;
   PDF button: `pdf|^download$|^download filed` excluding
   `e-?invoice|history|excel|json|certificate|challan`, preferring "PDF".
6. **Dialogs**: native `alert/confirm` must be accepted; modal buttons
   matching `proceed|yes|ok|download.*` must be clicked.
7. **SEARCH can return "System Failure"** — retry up to 3×.
8. GSTR-1 filed VIEW can open a **new tab**; PDFs are built on demand (wait up
   to 120 s).
9. Timings that work today: GSTR-2B JSON links ≤30 s after GENERATE; Excel
   ≤90 s; PDF ≤120 s.

## 4. Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| **A** | **Side panel UI + background worker that drives the user's logged-in portal tab via content scripts** | Same proven logic, user can watch it; speed equals today's app | **Chosen** — most reliable for non-technical users, ports existing behaviour |
| B | Call the portal's internal JSON endpoints with `fetch` | Much faster, but undocumented, can change silently, odd traffic risks "Access Denied"; users can't diagnose breakage | Rejected |
| C | Inject helper buttons into portal pages only | Very robust, but user still navigates month by month — less than today | Rejected |

Side panel rather than popup: a popup closes when the user clicks the page,
which would kill a run's UI. (The run itself lives in the worker either way.)

Distribution: zip first for testing (owner's choice), Web Store after.

## 5. Design

### 5.1 Parts

```
manifest.json            MV3
background.js            service worker: run state machine, downloads, tabs
content/portal.js        injected on services.gst.gov.in + return.gst.gov.in:
                         page actions (select, click, find, read messages)
content/main-world.js    runs in the page's MAIN world at document_start:
                         auto-accept alert/confirm; expose Angular-idle check
lib/match.js             shared: regexes, form_regex, best_match, month tables
sidepanel/               index.html, panel.js, panel.css — the UI
icons/                   16/32/48/128 px
docs/                    this design, privacy policy (Phase 2)
```

### 5.2 Permissions (Web-Store-safe)

- `host_permissions`: `https://services.gst.gov.in/*`,
  `https://return.gst.gov.in/*` (add a portal subdomain only if a download
  actually comes from one — verify in testing).
- `permissions`: `sidePanel`, `downloads`, `storage`, `scripting`, `tabs`.
- No remote code, no analytics, no network calls of our own.

### 5.3 UI (side panel)

```
+-----------------------------------+
| GST TOOLS · Asif & Associates     |
| ● Logged in  (or: Please log in → |
|   [Open GST portal])              |
| Financial Year [2025-26 ▾]        |
| Return type  (one at a time)      |
|  (•) R1 JSON  ( ) GSTR-2B JSON    |
|  ( ) GSTR-2B Excel ( ) GSTR-3B ACK|
|  ( ) GSTR-1 PDF ACK               |
| Months  All | None                |
|  ☐Apr ☐May ☐Jun ☐Jul ☐Aug ☐Sep    |
|  ☐Oct ☐Nov ☐Dec ☐Jan ☐Feb ☐Mar    |
| [⬇ DOWNLOAD] [⚙ GENERATE R1 JSON] |
| [■ Stop]        [Open folder]     |
| Activity ------------------------ |
| 14:59 GSTR-2B tile: DOWNLOAD      |
| 15:00 Downloading part 1/2 (...)  |
+-----------------------------------+
```
The side panel is narrow (~360 px), so the desktop app's five columns become
one return-type picker + one month grid. GENERATE is enabled only for R1 JSON.
FY choices: current FY and the 5 before it (same as `_fy_choices`).
Settings (last FY / type) persist in `chrome.storage.local`.

### 5.4 Run engine (background.js)

- A run = `{type, fy, months[], mode, index, step, tabId, results}` kept in
  `chrome.storage.session` so it survives the service worker being suspended
  and page navigations.
- The worker drives **one dedicated portal tab** that it opens next to the
  user's portal tab (cookies, so the login, are shared); the user's own tab is
  never touched. If no logged-in portal tab exists, the panel asks the user to
  log in first. Each month is a sequence of steps; after any step that navigates,
  the worker waits for `tabs.onUpdated status=complete` on that tab, then
  messages the content script for the next step. Keep-alive: an open side
  panel port plus step messages keep the worker alive; state in storage covers
  the rest.
- Steps per flow mirror `gst_bot.py`:
  - **dashboard (JSON/Excel)**: go to Returns Dashboard (menu-link nav) →
    select FY, Quarter, Period → SEARCH → find tile button
    (`download|prepare offline|view`) for the form → click (follow new tab if
    opened) → pick "Download" tab if present → mode:
    - JSON download: links present? download them; else click JSON button,
      poll 30 s for links or a download → else *pending*.
    - JSON generate (R1): as `_request_json` → *requested*.
    - Excel: count existing links, click Excel button, poll 90 s for a
      download or new links → else *pending*.
  - **filed PDF**: go to View e-Filed Returns → fill FY / Monthly / month /
    return type with Angular-idle waits and verify, retry ×3 → SEARCH (retry on
    "System Failure") → row button → maybe new tab → VIEW SUMMARY if present
    → PDF button → wait for download.
- **Session checks** before each month: URL contains `/services/login` or the
  page shows "Access Denied" → stop the run with "Log in again", mark
  remaining months not run.
- **Stop** button aborts after the current step.
- After each month: close tabs the run opened, return to the main tab.

### 5.5 Downloads and naming

- Clicking a portal link triggers a normal browser download. The worker
  listens to `chrome.downloads.onDeterminingFilename` while a run is active
  and a download originates from the run's tab(s) / portal hosts, and
  suggests `GST Downloads/<TAG>_<FY>_<Month>_<original>`
  (`conflictAction: "uniquify"`).
- "Download arrived" = `chrome.downloads.onChanged` to `complete` for an item
  started after the click. This replaces the desktop app's folder polling.
- "Open folder" = `chrome.downloads.showDefaultFolder()` (or `show(id)` of the
  last saved file).

### 5.6 Errors and debugging

- Failed month: log the reason; capture a debug record in
  `chrome.storage.local` (URL, page title, visible message, list of visible
  buttons/links texts) — the equivalent of `debug/*.html`. A "Copy debug
  info" button in the panel puts the last records on the clipboard so users
  can paste them to the owner. No screenshots in Phase 1.
- Pending vs failed messages match the desktop app's wording.

### 5.7 Testing

- `lib/match.js` is pure JS with unit tests (Node's built-in `node:test`),
  covering the regexes and `best_match` cases already exercised in the
  desktop app (e.g. "Download here", GSTR-1 vs GSTR-1A, "Oct - Dec" as a
  quarter).
- Portal flows are verified manually on the live portal by the owner (needs a
  real login); a checklist goes in the README.

### 5.8 Packaging

- Phase 1: `npm`-free plain JS; a `build-zip` script (PowerShell) zips the
  folder minus docs/tests → `dist/gst-tools-extension-<version>.zip`, and the
  README has 5-step install instructions with screenshots placeholders.
- Phase 2: icons, store description, privacy policy (states: no data leaves
  the device), `$5` developer account, submission.

## 6. Decided by the owner
- Build as a Chrome extension in a new project folder:
  `C:\Users\ASIF\Documents\GST Tools Extension` (own git repo).
- Approach A (side panel driving the portal tab).
- Zip for testing first, then Chrome Web Store.
- Audience: people comfortable with extensions, not with desktop apps.

## 7. Calls made by Claude (owner may change)
- Users log in themselves; the extension never sees credentials or captcha.
- One return type per run (same as the desktop app).
- Branding kept: "GST TOOLS · Asif & Associates".
- Plain JavaScript, no framework or bundler.
- Debug info is text, copied to clipboard on request; nothing uploaded.
- Runs use a dedicated tab the extension opens, not the user's own tab.

## 8. Left to the builder
- Exact message protocol between worker, content script and panel.
- Timeouts per step (start from §3.9), retry counts.
- Visual styling of the panel (match desktop colours where easy).
