"use strict";
const E = globalThis.GSTEngine;
const MM = globalThis.GSTMatch;

/** A fake portal: ops answer from `spec`, clicks are recorded, and clicking an
 *  id listed in spec.fileOn produces a finished download. */
function fakeWorld(spec = {}) {
  const w = { clicks: [], pending: [], armed: [], logs: [], debug: [], persisted: [],
              t: 0, doc: 1, month: null, flags: {} };
  let fileNo = 0;
  const controls = spec.controls || {};
  w.page = {
    docId: async () => String(w.doc),
    state: async () => ({ url: "https://return.gst.gov.in/x", login: false,
                          denied: !!w.flags.denied, selects: 3 }),
    navigate: async () => { w.doc++; return "menu link"; },
    selectLabelled: async (labels, value) => ({ ok: true, match: value, found: true }),
    selectMonthPeriod: async () => ({ done: true, changed: false }),
    filedFiltersOk: async () => true,
    controls: async (rx) => (controls[rx] ? controls[rx](w)
      : rx === "^search$" ? [{ id: "search", text: "SEARCH" }] : []),
    tileButton: async () => (spec.tile ? spec.tile(w) : { id: "tile", text: "DOWNLOAD" }),
    click: async (id) => {
      if (id === "search") { w.searches = (w.searches || 0) + 1; return true; }
      w.clicks.push(id);
      if ((spec.fileOn || []).includes(id)) w.pending.push({ id: ++fileNo, filename: `C:\\d\\f${fileNo}.bin` });
      if (spec.onClick) spec.onClick(w, id);
      return true;
    },
    acceptModal: async () => null,
    pageMessage: async () => "",
    rowLabel: async () => "GSTR-2B Summary",
    dismissPopups: async () => 0,
    debugInfo: async () => ({ url: "x", controls: [] }),
  };
  w.ctx = {
    page: w.page,
    now: () => w.t,
    sleep: async (ms) => { w.t += ms; },
    log: (m) => w.logs.push(m),
    downloads: {
      arm: (meta) => { w.month = meta.month; w.armed.push(meta.month); },
      disarm: () => {},
      hasNew: () => w.pending.length > 0,
      waitNew: async () => w.pending.splice(0),
    },
    gotoUrl: async () => {},
    waitNavigation: async () => {},
    waitIdle: async () => {},
    followNewTab: async () => false,
    closeExtraTabs: async () => {},
    takeAlerts: async () => [],
    checkStop: () => { if (w.flags.stop) throw new E.Stopped("Run tab was closed - run stopped."); },
    saveDebug: async (tag, note) => { w.debug.push({ tag, note }); },
    persist: async (s) => { w.persisted.push(JSON.parse(JSON.stringify(s))); if (spec.onPersist) spec.onPersist(w, s); },
  };
  return w;
}
const L = (n) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, text: "Download here" }));

test("2B json downloads Download-here links", async () => {
  const w = fakeWorld({
    controls: {
      [MM.JSON_RX]: () => [{ id: "json", text: "GENERATE JSON FILE TO DOWNLOAD" }],
      [MM.LINK_RX]: (w) => (w.clicks.includes("json") ? L(2) : []),
    },
    fileOn: ["l0", "l1"],
  });
  const r = await E.runMonth(w.ctx, MM.TASKS.gstr2b_json, "2025-26", "June", "download");
  eq(r.state, "saved");
  eq(r.files.length, 2);
  eq(w.clicks, ["tile", "json", "l0", "l1"]);
});

test("2B json pending when nothing appears", async () => {
  const w = fakeWorld({ controls: { [MM.JSON_RX]: () => [{ id: "json", text: "GENERATE JSON" }] } });
  let err = null;
  try { await E.runMonth(w.ctx, MM.TASKS.gstr2b_json, "2025-26", "June", "download"); } catch (e) { err = e; }
  ok(err instanceof E.NotReady, "NotReady");
  ok(err.message.startsWith("The portal is still preparing the file"), err.message);
});

test("excel downloads only new links", async () => {
  const w = fakeWorld({
    controls: {
      [MM.JSON_RX]: () => [{ id: "json", text: "GENERATE JSON FILE TO DOWNLOAD" }],
      [MM.EXCEL_RX]: () => [{ id: "xls", text: "GENERATE EXCEL FILE TO DOWNLOAD" }],
      [MM.LINK_RX]: (w) => (w.clicks.includes("xls") ? L(3) : L(2)),
    },
    fileOn: ["l2"],
  });
  const r = await E.runMonth(w.ctx, MM.TASKS.gstr2b_excel, "2025-26", "June", "download");
  eq(r.state, "saved");
  eq(w.clicks, ["tile", "xls", "l2"]);
});

test("excel saved when the file downloads straight away", async () => {
  const w = fakeWorld({
    controls: { [MM.EXCEL_RX]: () => [{ id: "xls", text: "GENERATE EXCEL FILE TO DOWNLOAD" }] },
    fileOn: ["xls"],
  });
  const r = await E.runMonth(w.ctx, MM.TASKS.gstr2b_excel, "2025-26", "June", "download");
  eq(r.files, ["C:\\d\\f1.bin"]);
});

test("r1 generate requested", async () => {
  const w = fakeWorld({ controls: { [MM.JSON_RX]: () => [{ id: "json", text: "GENERATE JSON FILE TO DOWNLOAD" }] } });
  const r = await E.runMonth(w.ctx, MM.TASKS.r1_json, "2025-26", "April", "generate");
  eq(r.state, "requested");
  ok(r.note.startsWith("Generation requested"), r.note);
  eq(w.clicks, ["tile", "json"]);
});

test("3B ack saved via direct download", async () => {
  const w = fakeWorld({ fileOn: ["tile"] });
  const r = await E.runMonth(w.ctx, MM.TASKS.gstr3b_ack, "2025-26", "May", "download");
  eq(r.state, "saved");
  eq(r.files.length, 1);
});

test("GSTR-1 ack goes through VIEW SUMMARY to the PDF button", async () => {
  const w = fakeWorld({
    tile: () => ({ id: "tile", text: "VIEW" }),
    controls: {
      "view summary": () => [{ id: "sum", text: "VIEW SUMMARY" }],
      [MM.PDF_RX]: (w) => (w.clicks.includes("sum")
        ? [{ id: "einv", text: "DOWNLOAD E-INVOICE" }, { id: "pdf", text: "DOWNLOAD (PDF)" }] : []),
    },
    fileOn: ["pdf"],
  });
  const r = await E.runMonth(w.ctx, MM.TASKS.gstr1_pdf_ack, "2025-26", "April", "download");
  eq(r.state, "saved");
  eq(w.clicks, ["tile", "sum", "pdf"]);
});

test("search retried on System Failure", async () => {
  let tries = 0;
  const w = fakeWorld({ tile: (w) => (w.searches >= 2 ? { id: "tile", text: "DOWNLOAD" } : null),
                        fileOn: ["tile"] });
  w.page.pageMessage = async () => { tries++; return "System Failure"; };
  const r = await E.runMonth(w.ctx, MM.TASKS.gstr3b_ack, "2025-26", "May", "download");
  eq(r.state, "saved");
  eq(tries, 1);
  eq(w.searches, 2);
});

const twoBLinks = {
  controls: {
    [MM.JSON_RX]: () => [{ id: "json", text: "GENERATE JSON" }],
    [MM.LINK_RX]: (w) => (w.clicks.includes("json") ? L(1) : []),
  },
  fileOn: ["l0"],
  onClick: (w, id) => { if (id === "l0") w.clicks = w.clicks.filter((c) => c !== "json"); },
};

test("stops on access denied", async () => {
  const w = fakeWorld({ ...twoBLinks, onPersist: (w) => { w.flags.denied = true; } });
  const res = await E.runBatch(w.ctx, "gstr2b_json", "2025-26", ["April", "May", "June"], "download");
  eq(res.April.state, "saved");
  eq(res.May.state, "not_run");
  eq(res.June.state, "not_run");
  ok(w.logs.some((l) => /log in again/i.test(l)), "log says log in again");
});

test("failed month continues", async () => {
  const w = fakeWorld({ ...twoBLinks, tile: (w) => (w.month === "April" ? null : { id: "tile", text: "DOWNLOAD" }) });
  const res = await E.runBatch(w.ctx, "gstr2b_json", "2025-26", ["April", "May"], "download");
  eq(res.April.state, "failed");
  eq(res.May.state, "saved");
  eq(w.debug.length, 1);
  eq(w.debug[0].tag, "GSTR2B_JSON-April");
  ok(w.logs.some((l) => l.startsWith("ERROR (April)")));
  ok(w.logs.includes("=== finished: 1/2 month(s) done ==="));
});

test("run tab closed", async () => {
  const w = fakeWorld({ ...twoBLinks, onPersist: (w) => { w.flags.stop = true; } });
  const res = await E.runBatch(w.ctx, "gstr2b_json", "2025-26", ["April", "May", "June"], "download");
  eq(res.April.state, "saved");
  eq(res.May.state, "not_run");
  eq(res.June.state, "not_run");
  ok(w.logs.some((l) => l.includes("run stopped")));
});

test("resume", async () => {
  const w = fakeWorld(twoBLinks);
  const res = await E.runBatch(w.ctx, "gstr2b_json", "2025-26", ["April", "May"], "download", 1,
                               { April: { state: "saved", files: ["a"], note: "" } });
  eq(res.April.state, "saved");
  eq(res.May.state, "saved");
  eq(w.armed, ["May"]);
  eq(w.persisted[w.persisted.length - 1].index, 2);
});
