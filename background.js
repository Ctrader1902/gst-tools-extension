// Service worker: owns the run, answers the side panel, keeps the log.
"use strict";
importScripts("lib/match.js", "background/downloads.js", "background/tabs.js", "background/engine.js");

const M = globalThis.GSTMatch;
const E = globalThis.GSTEngine;
const T = globalThis.GSTTabs;
const LOGIN_URL = "https://services.gst.gov.in/services/login";
const GST_SITES = "https://*.gst.gov.in/*";

/** GSTR-2B has several files per month.  Chrome blocks a site's second
 *  automatic download unless allowed, so allow it for GST sites during a run. */
const allowGstDownloads = () =>
  chrome.contentSettings.automaticDownloads.set({ primaryPattern: GST_SITES, setting: "allow" }).catch(() => {});
const restoreDownloadSetting = () =>
  chrome.contentSettings.automaticDownloads.clear({}).catch(() => {});
const MAX_LOG = 300;
const MAX_DEBUG = 10;

GSTDownloads.install(chrome.downloads);
GSTDownloads.onArrived((path) => log(`File arrived: ${String(path).split(/[\\/]/).pop()}`, "ok"));
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

let running = null;        // promise of the active run
let starting = false;      // start()/resume() is setting a run up
let stopReason = null;     // set by Stop or by closing the run tab
let keepAlive = null;
let sessionExpired = false; // last run hit an expired session: wait for a fresh portal page

// ------------------------------------------------------------------ log --
let logQueue = Promise.resolve();
function log(text, kind = "") {
  const line = { t: new Date().toTimeString().slice(0, 8), text: String(text), kind };
  logQueue = logQueue.then(async () => {
    const { log: lines = [] } = await chrome.storage.session.get("log");
    lines.push(line);
    await chrome.storage.session.set({ log: lines.slice(-MAX_LOG) });
  }).catch(() => {});
  chrome.runtime.sendMessage({ evt: "log", line }).catch(() => {});
}
const broadcast = (evt, data) => chrome.runtime.sendMessage({ evt, ...data }).catch(() => {});

// ---------------------------------------------------------------- run --
const checkStop = () => { if (stopReason) throw new E.Stopped(stopReason); };
T.setStopCheck(checkStop);

chrome.tabs.onRemoved.addListener((id) => {
  if ((running || starting) && id === T.runTabId()) stopReason = "Run tab was closed - run stopped.";
});

// After an expired session, "logged in" needs a portal page loaded afresh.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!sessionExpired || info.status !== "complete" || tabId === T.runTabId() || !tab || !tab.url) return;
  try {
    if (/\/auth\//.test(new URL(tab.url).pathname)) sessionExpired = false;
  } catch (e) { /* not a URL */ }
});

function makeCtx() {
  return {
    page: T.page,
    now: () => Date.now(),
    async sleep(ms) {
      checkStop();
      await new Promise((r) => setTimeout(r, ms));
      checkStop();
    },
    log: (m) => log(m),
    downloads: { ...GSTDownloads,
                 waitNew: (since, ms) => GSTDownloads.waitNew(since, ms, 1000, checkStop) },
    gotoUrl: (url) => T.gotoUrl(url),
    waitNavigation: (doc, ms) => T.waitNavigation(doc, ms),
    waitIdle: (ms) => T.waitIdle(ms),
    followNewTab: (ms) => T.followNewTab(ms),
    closeExtraTabs: () => T.closeExtraTabs(),
    takeAlerts: () => T.takeAlerts(),
    checkStop,
    async saveDebug(tag, note) {
      let info = {};
      try { info = await T.page.debugInfo(); } catch (e) { info = { error: String(e.message || e) }; }
      const { debug = [] } = await chrome.storage.local.get("debug");
      debug.push({ time: new Date().toISOString(), tag, note, ...info });
      await chrome.storage.local.set({ debug: debug.slice(-MAX_DEBUG) });
    },
    async persist(state) {
      const { run } = await chrome.storage.session.get("run");
      await chrome.storage.session.set({ run: { ...run, ...state } });
      broadcast("progress", { run: { ...run, ...state } });
    },
  };
}

/** Desktop-app wording for the end of a run. */
function summarize(taskKey, results) {
  const title = M.TASKS[taskKey].title;
  const s = M.summarize(results);
  if (s.saved.length) log(`Downloaded: ${s.saved.join(", ")}`, "ok");
  if (s.requested.length) {
    log(`Generation requested: ${s.requested.join(", ")} - press DOWNLOAD in about 20 minutes.`, "ok");
  }
  if (s.pending.length) {
    log(`Not ready yet: ${s.pending.join(", ")} - ` + (taskKey === "r1_json"
      ? "press GENERATE R1 JSON first, then DOWNLOAD after ~20 min."
      : "try again in a few minutes."), "warn");
  }
  if (s.failed.length) log(`Failed: ${s.failed.join(", ")} (details above).`, "err");
  if (s.notRun.length) log(`Not run: ${s.notRun.join(", ")}.`, "warn");
  const parts = [];
  if (s.saved.length) parts.push(`${s.saved.length} downloaded`);
  if (s.requested.length) parts.push(`${s.requested.length} requested (ready in ~20 min)`);
  if (s.pending.length) parts.push(`${s.pending.length} not ready yet`);
  if (s.failed.length) parts.push(`${s.failed.length} failed`);
  if (s.notRun.length) parts.push(`${s.notRun.length} not run`);
  const kind = s.failed.length || s.notRun.length ? "err" : s.pending.length ? "warn" : "ok";
  const text = `${title}: ${parts.join(", ") || "nothing done"}.`;
  const expired = s.notRun.some((m) => /log in again/i.test((results[m] && results[m].note) || ""));
  if (expired) {
    return { kind: "err", expired: true,
             text: `Session expired - log in to the GST portal again, then start the run again. ${text}` };
  }
  return { kind, text };
}

function runIt(run) {
  keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  running = (async () => {
    let status;
    try {
      const results = await E.runBatch(makeCtx(), run.taskKey, run.fy, run.months, run.mode,
                                       run.index || 0, run.results || {});
      status = summarize(run.taskKey, results);
      if (status.expired) sessionExpired = true;
    } catch (e) {
      log(`ERROR: ${e.message || e}`, "err");
      status = { kind: "err", text: String(e.message || e) };
    } finally {
      clearInterval(keepAlive);
      try {
        const { run: saved } = await chrome.storage.session.get("run");
        await chrome.storage.session.set({ run: { ...saved, done: true, status } });
      } catch (e) { /* the run is over either way */ }
      running = null;                    // finished first: tidying up may never complete
      broadcast("done", { status });
      restoreDownloadSetting();
      T.closeRunTab().catch(() => {});
    }
  })();
}

async function start({ taskKey, fy, months, mode }) {
  if (running || starting) return { error: "A run is already in progress." };
  if (!M.TASKS[taskKey] || !months || !months.length) return { error: "Choose a return type and months." };
  if (mode === "generate" && taskKey !== "r1_json") return { error: "Only R1 JSON has a generate step." };
  starting = true;                     // set before the first await: no second run
  stopReason = null;
  try {
    const portal = sessionExpired ? null : await T.findLoggedInPortalTab();
    if (!portal) return { error: "login" };
    const order = M.MONTHS.filter((m) => months.includes(m));
    await chrome.storage.session.set({ log: [] });
    await allowGstDownloads();
    const tabId = await T.openRunTab(portal);
    const run = { taskKey, fy, months: order, mode, index: 0, results: {}, tabId, done: false };
    await chrome.storage.session.set({ run });
    runIt(run);
    return { ok: true };
  } finally {
    starting = false;
  }
}

/** The worker was restarted while a run was going on: carry on. */
async function resume() {
  if (running || starting) return;
  starting = true;
  try {
    const { run } = await chrome.storage.session.get("run");
    if (!run || run.done || running) return;
    if (!(await T.tabExists(run.tabId))) {
      await chrome.storage.session.set({ run: { ...run, done: true,
        status: { kind: "err", text: "Run tab was closed - run stopped." } } });
      return;
    }
    stopReason = null;
    await allowGstDownloads();
    T.adopt(run.tabId);
    log(`Resuming after a pause at ${run.months[run.index] || "the end"} ...`, "warn");
    runIt(run);
  } finally {
    starting = false;
  }
}
resume();

// --------------------------------------------------------- panel API --
async function handle(msg) {
  switch (msg.cmd) {
    case "status": {
      const [{ run }, { log: lines = [] }, portal] = await Promise.all([
        chrome.storage.session.get("run"), chrome.storage.session.get("log"),
        T.findLoggedInPortalTab()]);
      return { loggedIn: !!portal && !sessionExpired, running: !!running || starting,
               run: run || null, log: lines };
    }
    case "start":
      return start(msg);
    case "stop":
      if (running || starting) { stopReason = "Stopped by you."; log("Stopping after the current step ...", "warn"); }
      return { ok: true };
    case "openPortal":
      await chrome.tabs.create({ url: LOGIN_URL });
      return { ok: true };
    case "openFolder": {
      const id = GSTDownloads.lastSavedId();
      if (id != null) chrome.downloads.show(id); else chrome.downloads.showDefaultFolder();
      return { ok: true };
    }
    case "debug": {
      const { debug = [] } = await chrome.storage.local.get("debug");
      return { debug };
    }
    case "clearLog":
      await chrome.storage.session.set({ log: [] });
      return { ok: true };
    default:
      return { error: `Unknown command ${msg.cmd}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Commands come from our own pages (side panel).  Web pages cannot message
  // the extension, and our content script never sends `cmd`.
  if (!msg || !msg.cmd || sender.id !== chrome.runtime.id) return false;
  handle(msg).then(sendResponse, (e) => sendResponse({ error: String(e.message || e) }));
  return true;
});
