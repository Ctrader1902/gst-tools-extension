"use strict";
const M = globalThis.GSTMatch;
const rx = (s) => new RegExp(s, "i");

test("LINK_RX matches portal link texts", () => {
  const r = rx(M.LINK_RX);
  ok(r.test("Download here"), "Download here");
  ok(r.test("Click here to download - File 1"), "Click here to download");
  ok(r.test("File 2"), "File 2");
  ok(!r.test("GENERATE JSON FILE TO DOWNLOAD"), "json button");
  ok(!r.test("GENERATE EXCEL FILE TO DOWNLOAD"), "excel button");
  ok(!r.test("Download"), "tab Download");
});

test("JSON_RX and EXCEL_RX match only their own button", () => {
  ok(rx(M.JSON_RX).test("GENERATE JSON FILE TO DOWNLOAD"));
  ok(!rx(M.JSON_RX).test("GENERATE EXCEL FILE TO DOWNLOAD"));
  ok(rx(M.EXCEL_RX).test("GENERATE EXCEL FILE TO DOWNLOAD"));
  ok(!rx(M.EXCEL_RX).test("GENERATE JSON FILE TO DOWNLOAD"));
});

test("PDF regexes", () => {
  ok(rx(M.PDF_RX).test("DOWNLOAD (PDF)"));
  ok(rx(M.PDF_AVOID_RX).test("DOWNLOAD E-INVOICE"));
  ok(!rx(M.PDF_AVOID_RX).test("DOWNLOAD (PDF)"));
});

test("formRegex tells GSTR-1 from GSTR-1A", () => {
  const r = new RegExp(M.formRegex("GSTR-1"));
  ok(r.test("gstr-1"), "gstr-1");
  ok(r.test("gstr1"), "gstr1");
  ok(r.test("gstr 1/iff"), "gstr 1/iff");
  ok(!r.test("gstr-1a"), "gstr-1a");
  ok(new RegExp(M.formRegex("GSTR-2B")).test("gstr2b"), "gstr2b");
});

test("bestMatch", () => {
  eq(M.bestMatch(["July", "June"], "Jul"), "July");
  eq(M.bestMatch(["2024-2025", "2025-2026"], "2025-26"), "2025-2026");
  eq(M.bestMatch(["GSTR-1A", "GSTR-1"], "GSTR-1"), "GSTR-1");
  eq(M.bestMatch(["Quarter 1 (Apr - Jun)"], "Quarter 1"), "Quarter 1 (Apr - Jun)");
  eq(M.bestMatch(["x"], ""), null);
  eq(M.bestMatch(["Annual", "Monthly"], "June"), null);
});

test("isQuarterRange", () => {
  eq(M.isQuarterRange("Oct - Dec"), true);
  eq(M.isQuarterRange("April to June"), true);
  eq(M.isQuarterRange("October"), false);
});

test("fyChoices", () => {
  eq(M.fyChoices(new Date(2026, 10, 18)), ["2026-27", "2025-26", "2024-25", "2023-24", "2022-23"]);
  eq(M.fyChoices(new Date(2026, 1, 1))[0], "2025-26");
  eq(M.fyChoices(new Date(2026, 3, 1))[0], "2026-27");
});

test("savedName", () => {
  eq(M.savedName("GSTR2B_EXCEL", "2025-26", "June", "C:\\x\\a.xlsx"),
     "GST Downloads/GSTR2B_EXCEL_2025-26_June_a.xlsx");
  eq(M.savedName("GSTR1_ACK", "2025-26", "April", "GSTR1_ACK_2025-26_April_b.pdf"),
     "GST Downloads/GSTR1_ACK_2025-26_April_b.pdf");
  eq(M.savedName("T", "2025-26", "May", "dir/sub/c.json"), "GST Downloads/T_2025-26_May_c.json");
});

test("isPortalDownload", () => {
  eq(M.isPortalDownload({ url: "blob:x", referrer: "https://return.gst.gov.in/returns/auth/gstr2b" }), true);
  eq(M.isPortalDownload({ url: "https://files.gst.gov.in/a.zip", referrer: "" }), true);
  eq(M.isPortalDownload({ url: "https://example.com/a.pdf", referrer: "" }), false);
  eq(M.isPortalDownload({ url: "https://evilgst.gov.in.example.com/a", referrer: "" }), false);
});

test("summarize buckets states", () => {
  eq(M.summarize({
    April: { state: "saved" }, May: { state: "requested" }, June: { state: "pending" },
    Jul: { state: "failed" }, Aug: { state: "not_run" },
  }), { saved: ["April"], requested: ["May"], pending: ["June"], failed: ["Jul"], notRun: ["Aug"] });
});

test("tables", () => {
  eq(M.MONTHS, ["April", "May", "June", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]);
  eq(M.SHORT[0], "Apr");
  eq(M.QUARTER_OF.Oct, 3);
  eq(Object.keys(M.TASKS), ["r1_json", "gstr2b_json", "gstr2b_excel", "gstr3b_ack", "gstr1_pdf_ack"]);
  eq(M.TASKS.gstr2b_excel, { title: "GSTR-2B Excel", sub: "Auto-drafted ITC", flow: "dashboard",
                             ret: "GSTR-2B", tag: "GSTR2B_EXCEL", fmt: "excel" });
  eq(M.TASKS.gstr1_pdf_ack.tag, "GSTR1_ACK");
});

test("isPortalDownload: files made inside a portal page (blob:, data:)", () => {
  eq(M.isPortalDownload({ url: "blob:https://gstr2b.gst.gov.in/5f1c-77", referrer: "" }), true, "blob from GSTR-2B");
  eq(M.isPortalDownload({ url: "data:application/vnd.ms-excel;base64,AAAA", referrer: "" }), true, "data URL");
  eq(M.isPortalDownload({ url: "blob:https://example.com/1", referrer: "" }), false, "blob from another site");
});
