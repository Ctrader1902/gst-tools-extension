// Tracks downloads that a run triggers and names them
// "GST Downloads/<TAG>_<FY>_<Month>_<original>".  Only portal downloads that
// start while the run is "armed" are touched; anything else is left alone.
"use strict";
(function () {
  const M = globalThis.GSTMatch;
  let armed = null;          // {tag, fy, month} of the month being run
  let expecting = false;     // a click that may download is waiting for its file
  let tracked = new Map();   // id -> {id, created, state, filename, meta}
  let lastId = null;

  function track(item) {
    if (tracked.has(item.id)) return tracked.get(item.id);
    if (!armed || !expecting || !M.isPortalDownload(item)) return null;
    const rec = { id: item.id, created: Date.now(), state: item.state || "in_progress",
                  filename: item.filename || "", meta: { ...armed } };
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
    if (delta.state && delta.state.current) rec.state = delta.state.current;
    if (rec.state === "complete") lastId = rec.id;
  }

  const since = (ms) => [...tracked.values()].filter((r) => r.created >= ms);

  globalThis.GSTDownloads = {
    /** Hook into chrome.downloads (or a fake in tests).  Resets tracking. */
    install(api) {
      armed = null;
      expecting = false;
      tracked = new Map();
      lastId = null;
      api.onCreated.addListener(onCreated);
      api.onDeterminingFilename.addListener(onDeterminingFilename);
      api.onChanged.addListener(onChanged);
    },
    arm(meta) { armed = { tag: meta.tag, fy: meta.fy, month: meta.month }; },
    disarm() { armed = null; expecting = false; },
    /** Open / close the window in which portal downloads belong to this month. */
    expect() { expecting = true; },
    settle() { expecting = false; },
    hasNew(sinceMs) { return since(sinceMs).length > 0; },
    lastSavedId() { return lastId; },

    /** Wait for downloads started at/after sinceMs to finish.  Returns the
     *  completed ones once nothing is in progress for stableMs; [] on timeout.
     *  The deadline moves out while data is still flowing.  stopCheck() is
     *  called every pass and may throw to abandon the wait. */
    async waitNew(sinceMs, timeoutMs, stableMs = 1000, stopCheck = () => {}) {
      let end = Date.now() + timeoutMs;
      let quietSince = null;
      while (Date.now() < end) {
        stopCheck();                 // throws when the run was stopped
        const recs = since(sinceMs);
        const done = recs.filter((r) => r.state === "complete");
        const busy = recs.filter((r) => r.state === "in_progress");
        if (busy.length) {
          end = Math.max(end, Date.now() + 5000);
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
