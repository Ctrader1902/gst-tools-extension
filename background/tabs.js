// The run's dedicated portal tab: open it, inject the page scripts after each
// load, talk to them, follow tabs the portal opens, and close them again.
"use strict";
(function () {
  const PORTAL_URLS = ["https://services.gst.gov.in/*", "https://return.gst.gov.in/*"];
  const SERVICES_DASHBOARD_URL = "https://services.gst.gov.in/services/auth/dashboard";

  let runTab = null;        // the tab the run opened
  let current = null;       // the tab page ops go to (runTab or a tab it opened)
  const extra = new Set();  // tabs opened from the run's tabs
  let fresh = [];           // newly opened, not yet followed
  let stopCheck = () => {};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  chrome.tabs.onCreated.addListener((tab) => {
    if (runTab == null || tab.openerTabId == null) return;
    if (tab.openerTabId === runTab || extra.has(tab.openerTabId)) {
      extra.add(tab.id);
      fresh.push(tab.id);
    }
  });
  chrome.tabs.onRemoved.addListener((id) => {
    extra.delete(id);
    fresh = fresh.filter((t) => t !== id);
    if (current === id) current = runTab;
  });

  async function tabGone(id) {
    try { await chrome.tabs.get(id); return false; } catch (e) { return true; }
  }

  async function waitComplete(tabId, timeoutMs = 60000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      stopCheck();
      let tab;
      try { tab = await chrome.tabs.get(tabId); } catch (e) { return false; }
      if (tab.status === "complete") return true;
      await sleep(300);
    }
    return false;
  }

  /** Content script + alert/confirm auto-accept in the page's own world. */
  async function inject(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/match.js", "content/portal.js"] });
    await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN",
      func: () => {
        if (window.__gstAlerts) return;
        window.__gstAlerts = [];
        const note = (m) => { window.__gstAlerts.push(String(m)); };
        window.alert = (m) => { note(m); };
        window.confirm = (m) => { note(m); return true; };
        window.prompt = (m) => { note(m); return ""; };
      },
    });
  }

  const PORT_GONE = /port closed|receiving end does not exist|could not establish connection|frame.*removed|no tab with id/i;

  /** Call a content-script op on the current tab, (re)injecting after loads. */
  async function call(op, args) {
    let lastErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      stopCheck();
      try {
        const res = await chrome.tabs.sendMessage(current, { op, args }, { frameId: 0 });
        if (res === undefined) throw new Error("Receiving end does not exist (no reply)");
        if (res.error) throw Object.assign(new Error(res.error), { fromPage: true });
        return res.value;
      } catch (e) {
        if (e.fromPage) throw e;
        lastErr = e;
        // a click that navigates can lose its reply: the click still happened
        if ((op === "click" || op === "navigate") && /port closed/i.test(e.message)) return true;
        if (!PORT_GONE.test(e.message)) throw e;
        if (await tabGone(current)) {
          if (current !== runTab) { current = runTab; continue; }
          stopCheck();
          throw new Error("The run tab is gone.");
        }
        await waitComplete(current, 60000);
        try { await inject(current); } catch (err) { lastErr = err; await sleep(1000); }
      }
    }
    throw new Error(`The portal page did not respond (${op}): ${lastErr && lastErr.message}`);
  }

  const page = new Proxy({}, { get: (_t, op) => (...args) => call(op, args) });

  globalThis.GSTTabs = {
    page,
    setStopCheck(fn) { stopCheck = fn; },
    runTabId: () => runTab,

    /** A tab with a signed-in portal page (URL path has /auth/), not the run tab. */
    async findLoggedInPortalTab() {
      const tabs = await chrome.tabs.query({ url: PORTAL_URLS });
      return tabs.find((t) => t.id !== runTab && t.url && /\/auth\//.test(new URL(t.url).pathname)) || null;
    },

    async openRunTab(nextTo) {
      const tab = await chrome.tabs.create({
        url: SERVICES_DASHBOARD_URL, active: true,
        windowId: nextTo ? nextTo.windowId : undefined,
        index: nextTo ? nextTo.index + 1 : undefined,
      });
      this.adopt(tab.id);
      await waitComplete(tab.id, 60000);
      return tab.id;
    },

    adopt(tabId) {
      runTab = tabId;
      current = tabId;
      extra.clear();
      fresh = [];
    },

    async tabExists(tabId) { return !(await tabGone(tabId)); },

    async gotoUrl(url) {
      await chrome.tabs.update(runTab, { url });
      current = runTab;
      await sleep(500);
      await waitComplete(runTab, 60000);
    },

    /** Wait until the page with docId `oldDoc` has been replaced and loaded. */
    async waitNavigation(oldDoc, timeoutMs = 60000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        await sleep(400);
        let doc = null;
        try { doc = await call("docId", []); } catch (e) { if (!PORT_GONE.test(e.message)) throw e; }
        if (doc && doc !== oldDoc) return true;
      }
      return false;
    },

    /** AngularJS has no requests in flight (the portal reloads lists). */
    async waitIdle(timeoutMs = 15000) {
      const end = Date.now() + timeoutMs;
      await sleep(400);
      while (Date.now() < end) {
        let pending = 0;
        try {
          const [r] = await chrome.scripting.executeScript({
            target: { tabId: current }, world: "MAIN",
            func: () => {
              try {
                const inj = window.angular && angular.element(document.body).injector();
                return inj ? inj.get("$http").pendingRequests.length : 0;
              } catch (e) { return 0; }
            },
          });
          pending = r ? r.result : 0;
        } catch (e) { pending = 0; }
        if (!pending) break;
        await sleep(300);
      }
      await sleep(600);
    },

    async takeAlerts() {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: current }, world: "MAIN",
          func: () => (window.__gstAlerts ? window.__gstAlerts.splice(0) : []),
        });
        return (r && r.result) || [];
      } catch (e) { return []; }
    },

    /** If a click opened a new tab, send page ops there. */
    async followNewTab(waitMs = 3000) {
      const end = Date.now() + waitMs;
      while (Date.now() < end) {
        if (fresh.length) {
          current = fresh.pop();
          fresh = [];
          await waitComplete(current, 60000);
          return true;
        }
        await sleep(300);
      }
      return false;
    },

    async closeExtraTabs() {
      for (const id of [...extra]) {
        try { await chrome.tabs.remove(id); } catch (e) { /* already gone */ }
      }
      extra.clear();
      fresh = [];
      current = runTab;
    },

    async closeRunTab() {
      await this.closeExtraTabs();
      if (runTab != null) {
        try { await chrome.tabs.remove(runTab); } catch (e) { /* already gone */ }
      }
      runTab = current = null;
    },
  };
})();
