// The download steps, ported from gst_bot.py.  Pure logic: everything that
// touches Chrome comes in through `ctx` (see background.js makeCtx), so the
// whole flow is testable with a fake portal.
//
// ctx = { page: {<content-script ops>, async}, now(), sleep(ms), log(msg),
//         downloads: {arm, disarm, hasNew(since), waitNew(since, ms)},
//         gotoUrl(url), waitNavigation(oldDocId, ms), waitIdle(ms),
//         followNewTab(), closeExtraTabs(), takeAlerts(), checkStop(),
//         saveDebug(tag, note), persist(state) }
"use strict";
(function () {
  const M = globalThis.GSTMatch;
  const SERVICES_DASHBOARD_URL = "https://services.gst.gov.in/services/auth/dashboard";
  const RETURNS_DASHBOARD = ["/returns/auth/dashboard", "https://return.gst.gov.in/returns/auth/dashboard"];
  const FILED_RETURNS = ["/returns/auth/efiledReturns", "https://return.gst.gov.in/returns/auth/efiledReturns"];

  class NotReady extends Error {}
  class SessionExpired extends Error {}
  class Stopped extends Error {}

  const base = (p) => String(p).split(/[\\/]/).pop();

  /** Call fn every intervalMs until it returns something truthy or time runs out. */
  async function poll(ctx, timeoutMs, fn, intervalMs = 1000) {
    const end = ctx.now() + timeoutMs;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (ctx.now() >= end) return null;
      await ctx.sleep(intervalMs);
    }
  }

  const first = async (ctx, rx) => (await ctx.page.controls(rx))[0] || null;
  const waitControl = (ctx, rx, ms) => poll(ctx, ms, () => first(ctx, rx), 700);

  async function clickText(ctx, rx, ms = 20000) {
    const el = await waitControl(ctx, rx, ms);
    if (!el) throw new Error(`Button matching '${rx}' not found.`);
    await ctx.page.click(el.id);
  }

  /** Accept a JS alert (logged) and press PROCEED/YES/OK in a modal. */
  async function acceptDialogs(ctx) {
    for (const a of await ctx.takeAlerts()) ctx.log(`Portal: ${a}`);
    const pressed = await ctx.page.acceptModal();
    if (pressed) await ctx.sleep(800);
  }

  async function waitFiles(ctx, since, ms) {
    return (await ctx.downloads.waitNew(since, ms)).map((d) => d.filename);
  }

  // ---------------------------------------------------------- navigation --
  const onPortal = (st) => /^http/.test(st.url || "") && !st.denied && !st.login;

  /** Open a return page by clicking the portal's own menu link (typing the
   *  URL is refused with 'Access Denied'). */
  async function openPage(ctx, [path, url], name) {
    ctx.log(`Opening ${name} ...`);
    for (let attempt = 0; attempt < 2; attempt++) {
      let st = await ctx.page.state();
      if (attempt || !onPortal(st)) {
        await ctx.gotoUrl(SERVICES_DASHBOARD_URL);
        st = await ctx.page.state();
        if (st.login || st.denied) throw new SessionExpired("GST session has expired - log in again.");
      }
      const doc = await ctx.page.docId();
      const how = await ctx.page.navigate(path, url);
      await ctx.waitNavigation(doc, 60000);
      st = await ctx.page.state();
      if (st.denied) {
        ctx.log(`Portal refused the page (${how}) - retrying via the dashboard ...`);
        continue;
      }
      if (st.login) throw new SessionExpired("GST session has expired - log in again.");
      await poll(ctx, 45000, async () => (await ctx.page.state()).selects > 0, 500);
      await ctx.sleep(1000);
      await ctx.page.dismissPopups();
      return;
    }
    throw new SessionExpired(`Portal shows 'Access Denied' for ${name} - ` +
                             "the session has probably expired, log in again.");
  }

  /** Pick `value` in the dropdown labelled like one of `labels`. */
  async function selectLabelled(ctx, labels, value, { timeout = 20000, required = true } = {}) {
    let last = { found: false, options: [] };
    const hit = await poll(ctx, timeout, async () => {
      const r = await ctx.page.selectLabelled(labels, value);
      if (!r.ok) last = r;
      return r.ok ? r : null;
    }, 500);
    if (hit) {
      await ctx.sleep(1000);                 // dependent dropdowns refill
      ctx.log(`  ${labels[0]} = ${hit.match}`);
      return hit.match;
    }
    if (!required) return null;
    if (!last.found) throw new Error(`Dropdown '${labels[0]}' not found on the page.`);
    throw new Error(`'${value}' not offered in '${labels[0]}'. Available: ${JSON.stringify(last.options)}`);
  }

  async function selectMonthPeriod(ctx, month, timeout = 25000) {
    const q = M.QUARTER_OF[month];
    const end = ctx.now() + timeout;
    let seen = {};
    while (ctx.now() < end) {
      const r = await ctx.page.selectMonthPeriod(month, q);
      seen = r.seen || seen;
      if (r.done) {
        if (r.changed) await ctx.waitIdle(5000);
        ctx.log(`  month = ${r.match || month}`);
        return;
      }
      if (r.changed) await ctx.waitIdle(8000);
      else await ctx.sleep(600);
    }
    throw new Error(`Could not choose month '${month}'. Dropdowns seen: ${JSON.stringify(seen)}`);
  }

  // ------------------------------------------- Returns Dashboard (JSON/Excel) --
  async function dashboardMonth(ctx, task, fy, month, mode) {
    await openPage(ctx, RETURNS_DASHBOARD, "Returns Dashboard");
    await selectLabelled(ctx, ["financial year", "year", "fin"], fy);
    await selectLabelled(ctx, ["quarter", "qtr"], `Quarter ${M.QUARTER_OF[month]}`, { required: false });
    await selectLabelled(ctx, ["period", "month", "mon"], month);
    await clickText(ctx, "^search$");
    await ctx.sleep(2500);

    const rx = M.formRegex(task.ret);
    const btn = await poll(ctx, 25000,
      () => ctx.page.tileButton(rx, ["download", "prepare offline", "view"]), 700);
    if (!btn) {
      throw new Error(`No ${task.ret} tile found on the Returns Dashboard ` +
                      "(return may not be available for this period).");
    }
    ctx.log(`${task.ret} tile: ${btn.text || "button"}`);
    await ctx.page.click(btn.id);
    await ctx.followNewTab();
    await ctx.sleep(2000);
    await openOfflineDownloadTab(ctx);
    if (task.fmt === "excel") return { state: "saved", files: await grabExcel(ctx), note: "" };
    if (mode === "generate") return requestJson(ctx);
    return { state: "saved", files: await grabJson(ctx, task), note: "" };
  }

  /** The offline page has Upload / Download tabs - pick Download. */
  async function openOfflineDownloadTab(ctx) {
    const p = ctx.page;
    if ((await p.controls(M.JSON_RX)).length || (await p.controls(M.LINK_RX)).length ||
        (await p.controls(M.EXCEL_RX)).length) return;
    const tab = await first(ctx, "^download$");
    if (tab) {
      await p.click(tab.id);
      await ctx.sleep(1500);
    }
  }

  /** GENERATE (R1): ask the portal to prepare a fresh JSON file. */
  async function requestJson(ctx) {
    const since = ctx.now();
    let links = await ctx.page.controls(M.LINK_RX);
    if (!links.length) {
      const btn = await waitControl(ctx, M.JSON_RX, 20000);
      if (!btn) throw new Error("No 'Generate JSON' button on this page.");
      ctx.log(`Clicking '${btn.text}' ...`);
      await ctx.page.click(btn.id);
      await ctx.sleep(1000);
      await acceptDialogs(ctx);
      links = (await poll(ctx, 12000, async () => {
        const l = await ctx.page.controls(M.LINK_RX);
        return l.length || ctx.downloads.hasNew(since) ? l : null;
      })) || [];
    }
    if (ctx.downloads.hasNew(since)) {             // portal handed it over at once
      return { state: "saved", files: await waitFiles(ctx, since, 60000), note: "" };
    }
    if (links.length) {
      const again = await first(ctx, "generate new|regenerate|new json|generate again");
      if (again) {
        ctx.log(`Clicking '${again.text}' ...`);
        await ctx.page.click(again.id);
        await ctx.sleep(1000);
        await acceptDialogs(ctx);
        await ctx.sleep(1500);
      } else {
        const note = "A file generated earlier is ready on the portal - press DOWNLOAD to get it.";
        ctx.log(note);
        return { state: "requested", files: [], note };
      }
    }
    const msg = await ctx.page.pageMessage();
    const note = "Generation requested - the portal needs about 20 minutes, then press DOWNLOAD." +
                 (msg ? ` Portal: ${msg}` : "");
    ctx.log(note);
    return { state: "requested", files: [], note };
  }

  /** DOWNLOAD: get the JSON file(s) the portal has ready. */
  async function grabJson(ctx, task) {
    let links = await ctx.page.controls(M.LINK_RX);
    if (links.length) return clickLinks(ctx, links);

    const btn = await waitControl(ctx, M.JSON_RX, 20000);
    if (!btn) throw new Error("No JSON download button on this page.");
    ctx.log(`Clicking '${btn.text}' ...`);
    const since = ctx.now();
    await ctx.page.click(btn.id);
    await ctx.sleep(1000);
    await acceptDialogs(ctx);

    // either the file downloads straight away, or the ready file's links appear
    const got = await poll(ctx, 30000, async () => {
      if (ctx.downloads.hasNew(since)) return { files: true };
      links = await ctx.page.controls(M.LINK_RX);
      return links.length ? { links } : null;
    });
    if (got && got.files) return waitFiles(ctx, since, 60000);
    if (got && got.links) return clickLinks(ctx, got.links);

    const msg = await ctx.page.pageMessage();
    const tail = msg ? ` Portal: ${msg}` : "";
    if (task.ret === "GSTR-1") {
      throw new NotReady("File not ready yet. Press GENERATE R1 JSON, wait about 20 minutes, " +
                         "then press DOWNLOAD." + tail);
    }
    throw new NotReady("The portal is still preparing the file - press DOWNLOAD again in a few minutes." + tail);
  }

  /** GSTR-2B Excel: GENERATE EXCEL FILE TO DOWNLOAD; the .xlsx downloads
   *  straight away, or new "Download here" links appear. */
  async function grabExcel(ctx) {
    const btn = await waitControl(ctx, M.EXCEL_RX, 20000);
    if (!btn) throw new Error("No 'Generate Excel' button on this page.");
    const before = (await ctx.page.controls(M.LINK_RX)).length;   // e.g. JSON links already shown
    ctx.log(`Clicking '${btn.text}' ...`);
    const since = ctx.now();
    await ctx.page.click(btn.id);
    await ctx.sleep(1000);
    await acceptDialogs(ctx);

    const got = await poll(ctx, 90000, async () => {
      if (ctx.downloads.hasNew(since)) return { files: true };
      const links = await ctx.page.controls(M.LINK_RX);
      return links.length > before ? { links } : null;
    });
    if (got && got.files) return waitFiles(ctx, since, 120000);
    if (got && got.links) return clickLinks(ctx, got.links, before);

    const msg = await ctx.page.pageMessage();
    throw new NotReady("The portal is still preparing the Excel file - press DOWNLOAD again in a few minutes." +
                       (msg ? ` Portal: ${msg}` : ""));
  }

  async function clickLinks(ctx, links, start = 0) {
    const saved = [];
    const count = links.length;
    for (let i = start; i < count; i++) {
      const fresh = await ctx.page.controls(M.LINK_RX);   // the page may re-render
      if (i >= fresh.length) break;
      const label = await ctx.page.rowLabel(fresh[i].id);
      ctx.log(`Downloading part ${i + 1 - start}/${count - start} (${label}) ...`);
      const since = ctx.now();
      await ctx.page.click(fresh[i].id);
      await acceptDialogs(ctx);
      saved.push(...await waitFiles(ctx, since, 120000));
      await ctx.closeExtraTabs();
    }
    return saved;
  }

  // ------------------------------------------- View e-Filed Returns (PDF) --
  async function filedPdfMonth(ctx, task, fy, month) {
    await openPage(ctx, FILED_RETURNS, "View e-Filed Returns");
    // Order matters: the year resets the other fields; "Monthly" adds the month dropdown.
    let okForm = false;
    for (let attempt = 1; attempt <= 3 && !okForm; attempt++) {
      await selectLabelled(ctx, ["financial year", "finyr", "year"], fy);
      await ctx.waitIdle(15000);
      await selectMonthPeriod(ctx, month);
      await selectLabelled(ctx, ["return type", "rettyp", "type"], task.ret);
      await ctx.waitIdle(5000);
      okForm = await ctx.page.filedFiltersOk(fy, month, task.ret);
      if (!okForm && attempt < 3) ctx.log(`  the portal reset the form - filling it again (${attempt + 1}/3) ...`);
    }
    if (!okForm) throw new Error("The portal keeps resetting the search form.");

    const rx = M.formRegex(task.ret);
    let btn = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await clickText(ctx, "^search$");
      await ctx.sleep(3000);
      btn = await poll(ctx, 20000, () => ctx.page.tileButton(rx, ["download", "view"]), 700);
      if (btn) break;
      const note = await ctx.page.pageMessage();
      if (attempt < 3 && new RegExp(M.SEARCH_RETRY_RX, "i").test(note)) {
        ctx.log(`Portal says '${note}' - searching again (${attempt + 1}/3) ...`);
        await ctx.sleep(3000);
        continue;
      }
      throw new Error(`No filed ${task.ret} found for ${month} ${fy}.` + (note ? ` Portal says: ${note}` : ""));
    }
    ctx.log(`${task.ret} row: ${btn.text || "button"}`);
    const since = ctx.now();
    await ctx.page.click(btn.id);
    await ctx.sleep(2000);
    await acceptDialogs(ctx);

    let files = await waitFiles(ctx, since, 12000);
    if (files.length) return files;
    await ctx.followNewTab();

    // GSTR-1: VIEW opens the return; the PDF is on its summary page
    const summary = await waitControl(ctx, "view summary", 20000);
    if (summary) {
      ctx.log("Opening VIEW SUMMARY ...");
      await ctx.page.click(summary.id);
      await ctx.sleep(3000);
      await ctx.page.dismissPopups();
    }
    const dl = await poll(ctx, 25000, async () => {
      const avoid = new RegExp(M.PDF_AVOID_RX, "i");
      const found = (await ctx.page.controls(M.PDF_RX)).filter((c) => !avoid.test(c.text));
      found.sort((a, b) => (/pdf/i.test(b.text) ? 1 : 0) - (/pdf/i.test(a.text) ? 1 : 0));
      return found[0] || null;
    }, 700);
    if (!dl) throw new Error("Opened the filed return but found no 'DOWNLOAD (PDF)' button.");
    ctx.log(`Clicking '${dl.text}' ...`);
    await ctx.page.click(dl.id);
    await ctx.sleep(1500);
    await acceptDialogs(ctx);
    files = await waitFiles(ctx, since, 120000);          // the PDF is built on demand
    if (!files.length) throw new Error("Clicked DOWNLOAD (PDF) but no file arrived.");
    return files;
  }

  // ---------------------------------------------------------------- run --
  async function runMonth(ctx, task, fy, month, mode) {
    if (task.flow === "dashboard") return dashboardMonth(ctx, task, fy, month, mode);
    return { state: "saved", files: await filedPdfMonth(ctx, task, fy, month), note: "" };
  }

  /** Run one return type for several months.  Results per month:
   *  saved | requested | pending | failed | not_run. */
  async function runBatch(ctx, taskKey, fy, months, mode, startIndex = 0, prior = {}) {
    const task = M.TASKS[taskKey];
    const verb = mode === "generate" ? "Generate" : "Download";
    ctx.log(startIndex
      ? `=== Resuming ${task.title} | FY ${fy} at ${months[startIndex]} ===`
      : `=== ${verb}: ${task.title} | FY ${fy} | ${months.join(", ")} ===`);
    const results = { ...prior };
    const notRun = (from, note) => {
      for (const m of months.slice(from)) results[m] = { state: "not_run", files: [], note };
    };

    for (let i = startIndex; i < months.length; i++) {
      const month = months[i];
      let r = { state: "failed", files: [], note: "" };
      let halt = null;
      try {
        ctx.checkStop();
        ctx.log(`--- ${month} (${i + 1}/${months.length}) ---`);
        ctx.downloads.arm({ tag: task.tag, fy, month });
        const st = await ctx.page.state();
        if (st.login || st.denied) throw new SessionExpired("GST session has expired - log in again.");
        r = await runMonth(ctx, task, fy, month, mode);
      } catch (e) {
        if (e instanceof Stopped || e instanceof SessionExpired) {
          halt = e;
        } else if (e instanceof NotReady) {
          r = { state: "pending", files: [], note: e.message };
          ctx.log(`${month}: ${e.message}`);
        } else {
          const note = String(e && e.message || e);
          r = { state: "failed", files: [], note };
          ctx.log(`ERROR (${month}): ${note}`);
          await ctx.saveDebug(`${task.tag}-${month}`, note);
        }
      } finally {
        ctx.downloads.disarm();
      }
      if (halt) {
        ctx.log(halt.message);
        notRun(i, halt.message);
        break;
      }
      for (const f of r.files) ctx.log(`Saved: ${base(f)}`);
      if (r.files.length) r.state = "saved";
      results[month] = r;
      await ctx.closeExtraTabs();
      await ctx.persist({ taskKey, fy, months, mode, index: i + 1, results });
    }

    const done = Object.values(results).filter((r) => r.state === "saved" || r.state === "requested").length;
    ctx.log(`=== finished: ${done}/${months.length} month(s) done ===`);
    return results;
  }

  globalThis.GSTEngine = { runBatch, runMonth, NotReady, SessionExpired, Stopped, poll };
})();
