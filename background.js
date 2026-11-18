// Service worker: owns the run, answers the side panel, keeps the log.
"use strict";
importScripts("lib/match.js", "background/downloads.js", "background/tabs.js", "background/engine.js");

const M = globalThis.GSTMatch;
const E = globalThis.GSTEngine;
const T = globalThis.GSTTabs;
const LOGIN_URL = "https://services.gst.gov.in/services/login";
const MAX_LOG = 300;
const MAX_DEBUG = 10;

GSTDownloads.install(chrome.downloads);
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

let running = null;        // promise of the active run
let stopReason = null;     // set by Stop or by closing the run tab
let keepAlive = null;

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
T.setStopCheck(() => { if (stopReason) throw new E.Stopped(stopReason); });

chrome.tabs.onRemoved.addListener((id) => {
  if (running && id === T.runTabId()) stopReason = "Run tab was closed - run stopped.";
});

function makeCtx() {
  return {
    page: T.page,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (m) => log(m),
    downloads: GSTDownloads,
    gotoUrl: (url) => T.gotoUrl(url),
    waitNavigation: (doc, ms) => T.waitNavigation(doc, ms),
    waitIdle: (ms) => T.waitIdle(ms),
    followNewTab: () => T.followNewTab(),
    closeExtraTabs: () => T.closeExtraTabs(),
    takeAlerts: () => T.takeAlerts(),
    checkStop: () => { if (stopReason) throw new E.Stopped(stopReason); },
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
  return { kind, text: `${title}: ${parts.join(", ") || "nothing done"}.` };
}

function runIt(run) {
  stopReason = null;
  keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  running = (async () => {
    let status;
    try {
      const results = await E.runBatch(makeCtx(), run.taskKey, run.fy, run.months, run.mode,
                                       run.index || 0, run.results || {});
      status = summarize(run.taskKey, results);
    } catch (e) {
      log(`ERROR: ${e.message || e}`, "err");
      status = { kind: "err", text: String(e.message || e) };
    } finally {
      clearInterval(keepAlive);
      const { run: saved } = await chrome.storage.session.get("run");
      await chrome.storage.session.set({ run: { ...saved, done: true, status } });
      await T.closeRunTab();
      running = null;
      broadcast("done", { status });
    }
  })();
}

async function start({ taskKey, fy, months, mode }) {
  if (running) return { error: "A run is already in progress." };
  if (!M.TASKS[taskKey] || !months || !months.length) return { error: "Choose a return type and months." };
  if (mode === "generate" && taskKey !== "r1_json") return { error: "Only R1 JSON has a generate step." };
  const portal = await T.findLoggedInPortalTab();
  if (!portal) return { error: "login" };
  const order = M.MONTHS.filter((m) => months.includes(m));
  await chrome.storage.session.set({ log: [] });
  const tabId = await T.openRunTab(portal);
  const run = { taskKey, fy, months: order, mode, index: 0, results: {}, tabId, done: false };
  await chrome.storage.session.set({ run });
  runIt(run);
  return { ok: true };
}

/** The worker was restarted while a run was going on: carry on. */
async function resume() {
  const { run } = await chrome.storage.session.get("run");
  if (!run || run.done || running) return;
  if (!(await T.tabExists(run.tabId))) {
    await chrome.storage.session.set({ run: { ...run, done: true,
      status: { kind: "err", text: "Run tab was closed - run stopped." } } });
    return;
  }
  T.adopt(run.tabId);
  log(`Resuming after a pause at ${run.months[run.index] || "the end"} ...`, "warn");
  runIt(run);
}
resume();

// --------------------------------------------------------- panel API --
async function handle(msg) {
  switch (msg.cmd) {
    case "status": {
      const [{ run }, { log: lines = [] }, portal] = await Promise.all([
        chrome.storage.session.get("run"), chrome.storage.session.get("log"),
        T.findLoggedInPortalTab()]);
      return { loggedIn: !!portal, running: !!running, run: run || null, log: lines };
    }
    case "start":
      return start(msg);
    case "stop":
      if (running) { stopReason = "Stopped by you."; log("Stopping after the current step ...", "warn"); }
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
