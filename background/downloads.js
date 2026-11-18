// Tracks downloads that a run triggers and names them
// "GST Downloads/<TAG>_<FY>_<Month>_<original>".  Only portal downloads that
// start while the run is "armed" are touched; anything else is left alone.
"use strict";
(function () {
  const M = globalThis.GSTMatch;
  let armed = null;          // {tag, fy, month} of the month being run
  let expecting = false;     // a click that may download is waiting for its file
  let tracked = new Map();   // id -> {id, created, state, filename, meta, bytes, moved}
  let lastId = null;
  let api = null;            // chrome.downloads (or a fake): search() is the source of truth
  let onArrived = () => {};

  function track(item) {
    if (tracked.has(item.id)) return tracked.get(item.id);
    if (!armed || !expecting || !M.isPortalDownload(item)) return null;
    const now = Date.now();
    const rec = { id: item.id, created: now, state: item.state || "in_progress",
                  filename: item.filename || "", meta: { ...armed },
                  bytes: item.bytesReceived || 0, moved: now };
    tracked.set(item.id, rec);
    return rec;
  }

  function onCreated(item) { track(item); }

  function onDeterminingFilename(item, suggest) {
    const rec = track(item);
    if (!rec) { suggest(); return; }
    suggest({ filename: M.savedName(rec.meta.tag, rec.meta.fy, rec.meta.month, item.filename),
              conflictAction: "uniquify" });
  }

  function onChanged(delta) {
    const rec = tracked.get(delta.id);
    if (!rec) return;
    if (delta.filename && delta.filename.current) rec.filename = delta.filename.current;
    if (delta.state && delta.state.current) setState(rec, delta.state.current);
  }

  function setState(rec, state) {
    const was = rec.state;
    rec.state = state;
    if (state === "complete") {
      lastId = rec.id;
      if (was !== "complete") onArrived(rec.filename);
    }
  }

  /** Ask Chrome for the real state of unfinished downloads (an update event
   *  can be missed while the service worker is busy). */
  async function refresh(recs) {
    if (!api || typeof api.search !== "function") return;
    for (const rec of recs) {
      let item = null;
      try { [item] = await api.search({ id: rec.id }); } catch (e) { item = null; }
      if (!item) continue;
      if (item.filename) rec.filename = item.filename;
      if ((item.bytesReceived || 0) !== rec.bytes) { rec.bytes = item.bytesReceived || 0; rec.moved = Date.now(); }
      if (item.state && item.state !== rec.state) setState(rec, item.state);
    }
  }

  const since = (ms) => [...tracked.values()].filter((r) => r.created >= ms);

  globalThis.GSTDownloads = {
    /** Hook into chrome.downloads (or a fake in tests).  Resets tracking. */
    install(downloadsApi) {
      api = downloadsApi;
      armed = null;
      expecting = false;
      tracked = new Map();
      lastId = null;
      api.onCreated.addListener(onCreated);
      api.onDeterminingFilename.addListener(onDeterminingFilename);
      api.onChanged.addListener(onChanged);
    },
    /** Called with the file path as soon as a tracked download finishes. */
    onArrived(fn) { onArrived = fn || (() => {}); },
    arm(meta) { armed = { tag: meta.tag, fy: meta.fy, month: meta.month }; },
    disarm() { armed = null; expecting = false; },
    /** Open / close the window in which portal downloads belong to this month. */
    expect() { expecting = true; },
    settle() { expecting = false; },
    hasNew(sinceMs) { return since(sinceMs).length > 0; },
    lastSavedId() { return lastId; },

    /** Wait for downloads started at/after sinceMs to finish.  Returns the
     *  completed ones once nothing is in progress for stableMs; [] on timeout.
     *  The deadline moves out while data is still flowing, but never past
     *  maxExtraMs (a download stuck "in progress" must not hold the run).
     *  A download that received no data for stallMs is not waited for once
     *  another file has arrived (the portal sometimes starts a dud).
     *  stopCheck() is called every pass and may throw to abandon the wait. */
    async waitNew(sinceMs, timeoutMs, stableMs = 1000, stopCheck = () => {}, maxExtraMs = 300000,
                  stallMs = 15000) {
      let end = Date.now() + timeoutMs;
      const hardEnd = end + maxExtraMs;
      let quietSince = null;
      while (Date.now() < end) {
        stopCheck();                 // throws when the run was stopped
        const recs = since(sinceMs);
        await refresh(recs.filter((r) => r.state === "in_progress"));
        const done = recs.filter((r) => r.state === "complete");
        const busy = recs.filter((r) => r.state === "in_progress" &&
                                        !(done.length && Date.now() - r.moved > stallMs));
        if (busy.length) {
          end = Math.min(Math.max(end, Date.now() + 5000), hardEnd);
          quietSince = null;
        } else if (done.length) {
          quietSince = quietSince || Date.now();
          if (Date.now() - quietSince >= stableMs) {
            return done.map((r) => ({ id: r.id, filename: r.filename }));
          }
        }
        await new Promise((r) => setTimeout(r, Math.min(250, stableMs)));
      }
      return [];
    },
  };
})();
