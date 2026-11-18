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
  D.arm({ tag: "GSTR1_ACK", fy: "2025-26", month: "April" });
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
  D.arm({ tag: "T", fy: "2025-26", month: "June" });
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
  D.arm({ tag: "T", fy: "2025-26", month: "Jul" });
  create(api, { id: 5, filename: "d.json", ...PORTAL });
  change(api, { id: 5, state: { current: "interrupted" } });
  eq(await D.waitNew(since, 300, 10), []);
  D.disarm();
});
