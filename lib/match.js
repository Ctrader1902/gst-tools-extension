// Shared tables and text-matching rules (ported from the desktop app's
// gst_bot.py).  Classic script: sets globalThis.GSTMatch so it works in the
// service worker (importScripts), the injected content script and tests.
"use strict";
(function () {
  if (globalThis.GSTMatch) return;

  // Financial-year order (April .. March), spelled the way the portal does.
  const MONTHS = ["April", "May", "June", "Jul", "Aug", "Sep",
                  "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const SHORT = ["Apr", "May", "Jun", "Jul", "Aug", "Sep",
                 "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const QUARTER_OF = Object.fromEntries(MONTHS.map((m, i) => [m, Math.floor(i / 3) + 1]));
  const MONTH_FULL = { Jul: "July", Aug: "August", Sep: "September", Oct: "October",
                       Nov: "November", Dec: "December", Jan: "January",
                       Feb: "February", Mar: "March" };

  //   flow "dashboard": Returns Dashboard -> tile DOWNLOAD -> JSON / Excel
  //   flow "filed_pdf": View e-Filed Returns -> row VIEW/DOWNLOAD -> PDF
  const TASKS = {
    r1_json:       { title: "R1 JSON", sub: "GSTR-1 offline file", flow: "dashboard",
                     ret: "GSTR-1", tag: "GSTR1_JSON" },
    gstr2b_json:   { title: "GSTR-2B JSON", sub: "Auto-drafted ITC", flow: "dashboard",
                     ret: "GSTR-2B", tag: "GSTR2B_JSON" },
    gstr2b_excel:  { title: "GSTR-2B Excel", sub: "Auto-drafted ITC", flow: "dashboard",
                     ret: "GSTR-2B", tag: "GSTR2B_EXCEL", fmt: "excel" },
    gstr3b_ack:    { title: "GSTR-3B ACK", sub: "Filed return PDF", flow: "filed_pdf",
                     ret: "GSTR-3B", tag: "GSTR3B_ACK" },
    gstr1_pdf_ack: { title: "GSTR-1 PDF ACK", sub: "Filed return PDF", flow: "filed_pdf",
                     ret: "GSTR-1", tag: "GSTR1_ACK" },
  };

  // Links to a ready file.  GSTR-1: "Click here to download - File 1";
  // GSTR-2B: a table "GSTR-2B Summary | Download here".
  const LINK_RX = "click here to download|^file\\s*\\d+|download.*file\\s*\\d+|^download\\s*here$";
  const JSON_RX = "generate.*json|json";
  const EXCEL_RX = "generate.*excel|excel";
  const PDF_RX = "pdf|^download$|^download filed";
  const PDF_AVOID_RX = "e-?invoice|history|excel|json|certificate|challan";
  const SEARCH_RETRY_RX = "system failure|try again|error";

  /** Lowercase and drop everything that is not a letter/digit. */
  function norm(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  /** 'GSTR-1' -> regex source matching 'gstr-1', 'gstr1', 'gstr 1/iff' but not 'gstr-1a'
   *  (apply to lowercased text). */
  function formRegex(name) {
    const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return "(?<![a-z0-9])" + norm(name).split("").map(esc).join("[^a-z0-9]*") + "(?![a-z0-9])";
  }

  /** Pick the option that best matches `wanted` (port of _best_match). */
  function bestMatch(options, wanted) {
    const w = norm(wanted);
    if (!w) return null;
    for (const o of options) if (norm(o) === w) return o;                 // exact
    const rx = new RegExp(formRegex(wanted));                             // whole word
    for (const o of options) if (rx.test(String(o).toLowerCase())) return o;
    for (const o of options) if (norm(o).startsWith(w)) return o;         // Jul -> July
    const digits = String(wanted).replace(/\D/g, "");                     // 2025-26 vs 2025-2026
    if (digits.length >= 6) {
      for (const o of options) {
        const d = String(o).replace(/\D/g, "");
        if (d.startsWith(digits.slice(0, 4)) && d.endsWith(digits.slice(-2))) return o;
      }
    }
    for (const o of options) if (norm(o).includes(w)) return o;           // contains
    return null;
  }

  /** "Oct - Dec", "April to June": a quarter, not a month. */
  function isQuarterRange(text) {
    return /[a-z]{3,}\s*(-|to)\s*[a-z]{3,}/i.test(String(text || ""));
  }

  /** Current financial year first, then the 4 before it: "2026-27", ... */
  function fyChoices(today) {
    const d = today || new Date();
    const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    const out = [];
    for (let y = start; y > start - 5; y--) out.push(`${y}-${String(y + 1).slice(2)}`);
    return out;
  }

  /** Download path inside the browser's download folder. */
  function savedName(tag, fy, month, original) {
    const base = String(original || "download").split(/[\\/]/).pop();
    const prefix = `${tag}_${fy}_${month}_`;
    return "GST Downloads/" + (base.startsWith(prefix) ? base : prefix + base);
  }

  function hostIsPortal(u) {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return h === "gst.gov.in" || h.endsWith(".gst.gov.in");
    } catch (e) {
      return false;
    }
  }

  /** True when a download came from the GST portal. */
  function isPortalDownload(item) {
    return [item.url, item.finalUrl, item.referrer].some((u) => u && hostIsPortal(u));
  }

  /** Group months by their result state. */
  function summarize(results) {
    const out = { saved: [], requested: [], pending: [], failed: [], notRun: [] };
    const key = { saved: "saved", requested: "requested", pending: "pending",
                  failed: "failed", not_run: "notRun" };
    for (const [month, r] of Object.entries(results || {})) {
      const k = key[r && r.state];
      if (k) out[k].push(month);
    }
    return out;
  }

  globalThis.GSTMatch = {
    MONTHS, SHORT, QUARTER_OF, MONTH_FULL, TASKS,
    LINK_RX, JSON_RX, EXCEL_RX, PDF_RX, PDF_AVOID_RX, SEARCH_RETRY_RX,
    norm, formRegex, bestMatch, isQuarterRange, fyChoices, savedName,
    isPortalDownload, summarize,
  };
})();
