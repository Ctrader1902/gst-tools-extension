"use strict";
const P = globalThis.GSTPortal;
const MT = globalThis.GSTMatch;

function stage(name) {
  const s = document.getElementById("stage");
  s.innerHTML = "";
  s.appendChild(document.getElementById(name).content.cloneNode(true));
  return s;
}
const byGstId = (id) => document.querySelector(`[data-gst-id="${id}"]`);

// The real filed-returns page adds a month dropdown once "Monthly" is chosen.
document.addEventListener("change", (ev) => {
  if (ev.target.id === "rp" && ev.target.value === "Monthly" && !document.getElementById("mm")) {
    document.getElementById("month-slot").innerHTML =
      '<label for="mm">Period</label><select id="mm"><option>Select</option>' +
      "<option>April</option><option>May</option><option>June</option></select>";
  }
});

test("tileButton picks GSTR-1 not GSTR-1A", () => {
  stage("dashboard");
  const b = P.tileButton(MT.formRegex("GSTR-1"), ["download"]);
  ok(b, "found");
  eq(b.text, "DOWNLOAD");
  ok(byGstId(b.id).closest(".tile").textContent.includes("GSTR-1/IFF"), "inside GSTR-1/IFF tile");
});

test("tileButton for GSTR-2B prefers download over view", () => {
  stage("dashboard");
  const b = P.tileButton(MT.formRegex("GSTR-2B"), ["download", "view"]);
  eq(byGstId(b.id).id, "b2-dl");
});

test("tileButton skips disabled buttons", () => {
  stage("dashboard");
  eq(P.tileButton(MT.formRegex("GSTR-3B"), ["download"]), null);
});

test("controls ignores nav", () => {
  stage("dashboard");
  eq(P.controls("^download$").filter((c) => byGstId(c.id).closest("nav")).length, 0);
});

test("controls(LINK_RX) finds two Download here links with row labels", () => {
  stage("gstr2b");
  const links = P.controls(MT.LINK_RX);
  eq(links.length, 2);
  eq(P.rowLabel(links[0].id), "GSTR-2B Summary");
  eq(P.rowLabel(links[1].id), "GSTR-2B Details - Part 1");
});

test("controls(EXCEL_RX) finds exactly the Excel button", () => {
  stage("gstr2b");
  const x = P.controls(MT.EXCEL_RX);
  eq(x.length, 1);
  eq(byGstId(x[0].id).id, "gen-xls");
});

test("click clicks the element", () => {
  stage("gstr2b");
  let clicked = 0;
  document.getElementById("gen-json").addEventListener("click", () => clicked++);
  const b = P.controls(MT.JSON_RX)[0];
  eq(P.click(b.id), true);
  eq(clicked, 1);
  eq(P.click("nope"), false);
});

test("selectLabelled picks fuzzy value and fires change", () => {
  stage("dashboard");
  let changed = 0;
  document.getElementById("fin").addEventListener("change", () => changed++);
  const r = P.selectLabelled(["financial year", "year"], "2025-26");
  eq(r.ok, true);
  eq(r.match, "2025-2026");
  eq(document.getElementById("fin").value, "2025-2026");
  eq(changed, 1);
  const again = P.selectLabelled(["financial year"], "2025-26");
  eq(again.ok, true);
  eq(changed, 1, "no change event when already selected");
});

test("selectLabelled reports missing value and missing dropdown", () => {
  stage("dashboard");
  const r = P.selectLabelled(["period"], "Dec");
  eq(r.ok, false);
  eq(r.found, true);
  ok(r.options.includes("June"));
  eq(P.selectLabelled(["no such label"], "x").found, false);
});

test("selectMonthPeriod: Monthly first, then the month", () => {
  stage("filed");
  P.selectLabelled(["financial year"], "2025-26");
  const first = P.selectMonthPeriod("June", 1);
  eq(first.done, false);
  eq(first.changed, true);
  eq(document.getElementById("rp").value, "Monthly");
  const second = P.selectMonthPeriod("June", 1);
  eq(second.done, true);
  eq(document.getElementById("mm").value, "June");
  P.selectLabelled(["return type"], "GSTR-3B");
  eq(P.filedFiltersOk("2025-26", "June", "GSTR-3B"), true);
  eq(P.filedFiltersOk("2025-26", "June", "GSTR-1"), false);
});

test("state detects Access Denied page", () => {
  stage("denied");
  eq(P.state().denied, true);
  stage("dashboard");
  eq(P.state().denied, false);
  eq(P.state().selects, 3);
});

test("pageMessage reads visible modal, ignores hidden alert", () => {
  stage("gstr2b");
  eq(P.pageMessage(), "");
  stage("modal");
  eq(P.pageMessage(), "Are you sure you want to generate?");
});

test("acceptModal clicks PROCEED", () => {
  stage("modal");
  let hit = 0;
  document.getElementById("proceed").addEventListener("click", () => hit++);
  eq(P.acceptModal(), "PROCEED");
  eq(hit, 1);
});

test("debugInfo lists controls and selects", () => {
  stage("dashboard");
  const d = P.debugInfo();
  ok(d.controls.includes("SEARCH"));
  eq(d.selects.length, 3);
  ok(d.selects[0].options.includes("2025-2026"));
});

test("docId is stable within one document", () => {
  const a = P.docId();
  ok(typeof a === "string" && a.length > 4);
  eq(P.docId(), a);
});

test("click goes through the page's own helper when it is there (javascript: links)", () => {
  stage("gstr2b");
  const seen = [];
  const onGstClick = (ev) => seen.push(ev.detail);
  document.addEventListener("gst-click", onGstClick);
  document.documentElement.dataset.gstMain = "1";
  let direct = 0;
  document.getElementById("gen-json").addEventListener("click", () => direct++);
  const b = P.controls(MT.JSON_RX)[0];
  eq(P.click(b.id), true);
  eq(seen, [b.id], "handed to the page helper");
  eq(direct, 0, "not clicked from the extension's world");
  delete document.documentElement.dataset.gstMain;
  document.removeEventListener("gst-click", onGstClick);
});

test("selectLabelled says whether it changed the dropdown", () => {
  stage("dashboard");
  eq(P.selectLabelled(["financial year"], "2025-26").changed, true);
  eq(P.selectLabelled(["financial year"], "2025-26").changed, false);
});
