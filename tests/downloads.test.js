"use strict";
const D = globalThis.GSTDownloads;

function fakeApi() {
  const ev = () => { const fns = []; return { fns, addListener: (f) => fns.push(f) }; };
  return { onCreated: ev(), onDeterminingFilename: ev(), onChanged: ev() };
}
function create(api, item) {
  api.onCreated.fns.forEach((f) => f(item));
  let suggestion = "not called";
  api.onDeterminingFilename.fns.forEach((f) => f(item, (s) => { suggestion = s; }));
  return suggestion;
}
const change = (api, delta) => api.onChanged.fns.forEach((f) => f(delta));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORTAL = { referrer: "https://return.gst.gov.in/returns/auth/gstr2b", url: "blob:https://return.gst.gov.in/1" };

test("renames portal download while armed", () => {
  const api = fakeApi(); D.install(api);
  D.arm({ tag: "GSTR1_ACK", fy: "2025-26", month: "April" }); D.expect();
  const s = create(api, { id: 1, filename: "x.pdf", ...PORTAL });
  eq(s, { filename: "GST Downloads/GSTR1_ACK_2025-26_April_x.pdf", conflictAction: "uniquify" });
  D.disarm();
});

test("ignores non-portal download", () => {
  const api = fakeApi(); D.install(api);
  D.arm({ tag: "T", fy: "2025-26", month: "May" });
  eq(create(api, { id: 2, filename: "a.zip", url: "https://example.com/a.zip", referrer: "" }), undefined);
  D.disarm();
});

test("ignores download while disarmed", () => {
  const api = fakeApi(); D.install(api);
  eq(create(api, { id: 3, filename: "b.pdf", ...PORTAL }), undefined);
  eq(D.hasNew(0), false);
});

test("waitNew resolves after complete", async () => {
  const api = fakeApi(); D.install(api);
  const since = Date.now();
  D.arm({ tag: "T", fy: "2025-26", month: "June" }); D.expect();
  create(api, { id: 4, filename: "c.json", ...PORTAL });
  eq(D.hasNew(since), true);
  const p = D.waitNew(since, 3000, 50);
  await sleep(100);
  change(api, { id: 4, filename: { current: "C:\D\GST Downloads\T_2025-26_June_c.json" },
                state: { current: "complete" } });
  const got = await p;
  eq(got, [{ id: 4, filename: "C:\D\GST Downloads\T_2025-26_June_c.json" }]);
  eq(D.lastSavedId(), 4);
  D.disarm();
});

test("waitNew returns [] on timeout", async () => {
  const api = fakeApi(); D.install(api);
  eq(await D.waitNew(Date.now(), 50, 10), []);
});

test("interrupted download is not returned", async () => {
  const api = fakeApi(); D.install(api);
  const since = Date.now();
  D.arm({ tag: "T", fy: "2025-26", month: "Jul" }); D.expect();
  create(api, { id: 5, filename: "d.json", ...PORTAL });
  change(api, { id: 5, state: { current: "interrupted" } });
  eq(await D.waitNew(since, 300, 10), []);
  D.disarm();
});

test("late file between waits is not renamed or counted", () => {
  const api = fakeApi(); D.install(api);
  const since = Date.now();
  D.arm({ tag: "T", fy: "2025-26", month: "Aug" });          // month armed, no click waiting
  eq(create(api, { id: 6, filename: "late.json", ...PORTAL }), undefined);
  D.expect(); D.settle();                                     // a click's wait finished
  eq(create(api, { id: 7, filename: "later.json", ...PORTAL }), undefined);
  eq(D.hasNew(since), false);
  D.disarm();
});

test("waitNew stops when the run is stopped", async () => {
  const api = fakeApi(); D.install(api);
  let calls = 0;
  let err = null;
  try {
    await D.waitNew(Date.now(), 5000, 10, () => { if (++calls > 2) throw new Error("stopped"); });
  } catch (e) { err = e; }
  eq(err && err.message, "stopped");
});

test("a download stuck in progress does not keep the run waiting forever", async () => {
  const api = fakeApi(); D.install(api);
  const since = Date.now();
  D.arm({ tag: "T", fy: "2025-26", month: "Sep" }); D.expect();
  create(api, { id: 8, filename: "stuck.pdf", state: "in_progress", ...PORTAL });
  const t0 = Date.now();
  eq(await D.waitNew(since, 50, 10, () => {}, 200), []);
  ok(Date.now() - t0 < 2000, "gave up after the hard cap");
  D.disarm();
});

test("finished download is noticed even when Chrome's update event is missed", async () => {
  const api = fakeApi();
  api.search = async ({ id }) => [{ id, state: "complete", filename: "C:\d\GST Downloads\T_2025-26_Oct_a.json", bytesReceived: 10 }];
  D.install(api);
  const since = Date.now();
  D.arm({ tag: "T", fy: "2025-26", month: "Oct" }); D.expect();
  create(api, { id: 21, filename: "a.json", state: "in_progress", ...PORTAL });
  const t0 = Date.now();
  const got = await D.waitNew(since, 30000, 10);
  eq(got, [{ id: 21, filename: "C:\d\GST Downloads\T_2025-26_Oct_a.json" }]);
  ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  D.disarm();
});

test("a stalled extra download does not hold up the file that arrived", async () => {
  const api = fakeApi();
  api.search = async ({ id }) => [id === 31
    ? { id, state: "complete", filename: "C:\d\b.pdf", bytesReceived: 5 }
    : { id, state: "in_progress", filename: "", bytesReceived: 0 }];
  D.install(api);
  const since = Date.now();
  D.arm({ tag: "T", fy: "2025-26", month: "Nov" }); D.expect();
  create(api, { id: 31, filename: "b.pdf", state: "in_progress", ...PORTAL });
  create(api, { id: 32, filename: "b2.pdf", state: "in_progress", ...PORTAL });
  const t0 = Date.now();
  const got = await D.waitNew(since, 30000, 10, () => {}, 300000, 300);
  eq(got.map((g) => g.id), [31]);
  ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  D.disarm();
});
