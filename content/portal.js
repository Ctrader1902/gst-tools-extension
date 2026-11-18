// Page operations on GST portal pages, ported from gst_bot.py.  Injected
// (after lib/match.js) into the run's tab only, after every page load.  The
// service worker calls these through chrome.tabs.sendMessage({op, args}).
// Elements are handed out as ids stored in a data-gst-id attribute.
"use strict";
(function () {
  const M = globalThis.GSTMatch;
  const CONTROLS = "a, button, input[type=button], input[type=submit]";
  const SKIP = "nav, header, footer, .navbar, .dropdown-menu";

  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const textOf = (e) => clean(e.innerText || e.value || e.textContent);

  let seq = 0;
  function idOf(el) {
    if (!el.dataset.gstId) el.dataset.gstId = `g${Date.now().toString(36)}${++seq}`;
    return el.dataset.gstId;
  }
  const byId = (id) => document.querySelector(`[data-gst-id="${CSS.escape(String(id))}"]`);

  /** Click like the page itself would.  A click from this (extension) world
   *  on an <a href="javascript:..."> is blocked by the extension's Content
   *  Security Policy, so hand it to the page helper (tabs.js) when present. */
  function pageClick(el) {
    if (document.documentElement.dataset.gstMain === "1") {
      document.dispatchEvent(new CustomEvent("gst-click", { detail: idOf(el) }));
    } else {
      el.click();
    }
  }
  const ref = (el) => ({ id: idOf(el), text: textOf(el) });

  /** Visible <select>s with a lowercase description (label/name/id/ng-model). */
  function selects() {
    return Array.from(document.querySelectorAll("select")).filter(vis).map((s) => {
      let t = "";
      if (s.id) {
        const l = document.querySelector(`label[for="${CSS.escape(s.id)}"]`);
        if (l) t += l.innerText + " ";
      }
      let p = s.parentElement;
      for (let i = 0; i < 4 && p && !t.trim(); i++) {
        if (p.querySelectorAll("select").length > 1) break;
        const l = p.querySelector("label");
        if (l) t = l.innerText + " ";
        p = p.parentElement;
      }
      t += [s.name, s.id, s.getAttribute("data-ng-model"), s.getAttribute("ng-model"),
            s.getAttribute("formcontrolname")].filter(Boolean).join(" ");
      return { el: s, desc: t.toLowerCase() };
    });
  }
  const optionTexts = (s) => Array.from(s.options).map((o) => clean(o.text));
  const current = (s) => (s.selectedIndex >= 0 ? clean(s.options[s.selectedIndex].text) : "");

  /** Choose option `index` the way a user would, so AngularJS notices. */
  function choose(s, index) {
    s.selectedIndex = index;
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const ops = {
    /** Random id of this document: changes when the page is replaced. */
    docId() {
      if (!window.__gstDocId) window.__gstDocId = Math.random().toString(36).slice(2, 12);
      return window.__gstDocId;
    },

    state() {
      const title = document.title || "";
      const heading = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,.box,p"))
        .some((e) => vis(e) && /^access denied!?$/i.test(clean(e.innerText)));
      return {
        url: location.href,
        title,
        login: location.pathname.includes("/services/login"),
        denied: /access denied/i.test(title) || /accessdenied/i.test(location.href) || heading,
        selects: selects().length,
      };
    },

    /** Visible links/buttons whose text matches `pattern` (menus skipped). */
    controls(pattern) {
      const rx = new RegExp(pattern, "i");
      return Array.from(document.querySelectorAll(CONTROLS))
        .filter((e) => vis(e) && !e.closest(SKIP) && rx.test(textOf(e)))
        .map(ref);
    },

    /** A button in the tile/row of one return type: its nearest ancestor that
     *  mentions any GSTR form must mention the wanted one. */
    tileButton(formRx, words) {
      const rx = new RegExp(formRx, "i");
      const btns = Array.from(document.querySelectorAll(CONTROLS))
        .filter((e) => vis(e) && !e.closest(SKIP));
      for (const w of words) {
        for (const b of btns) {
          if (!textOf(b).toLowerCase().includes(w)) continue;
          if (b.disabled || /disabled/.test(b.className)) continue;
          for (let p = b.parentElement; p && p !== document.body; p = p.parentElement) {
            const pt = p.innerText || "";
            if (/gstr/i.test(pt)) {
              if (rx.test(pt)) return ref(b);
              break;
            }
          }
        }
      }
      return null;
    },

    click(id) {
      const el = byId(id);
      if (!el) return false;
      try { el.scrollIntoView({ block: "center" }); } catch (e) { /* ignore */ }
      pageClick(el);
      return true;
    },

    /** Pick `value` in the dropdown whose description has all words of one label. */
    selectLabelled(labels, value) {
      let found = false;
      let options = [];
      for (const label of labels) {
        const words = label.split(/\s+/);
        const hit = selects().find((s) => words.every((w) => s.desc.includes(w)));
        if (!hit) continue;
        found = true;
        options = optionTexts(hit.el);
        const match = M.bestMatch(options, value);
        if (match == null) continue;
        const changed = current(hit.el) !== match;
        if (changed) choose(hit.el, options.indexOf(match));
        return { ok: true, match, found: true, changed };
      }
      return { ok: false, found, options: options.filter(Boolean) };
    },

    /** One pass over View e-Filed Returns' period dropdowns: the month itself,
     *  else "Monthly", else the quarter.  Call again while changed. */
    selectMonthPeriod(month, quarter) {
      const qFirst = M.MONTHS[(quarter - 1) * 3].slice(0, 3).toLowerCase();
      const seen = {};
      let changed = false;
      for (const { el, desc } of selects()) {
        if (/type|year|finyr/.test(desc)) continue;
        const opts = optionTexts(el);
        seen[desc.trim().slice(0, 40)] = opts.filter(Boolean).slice(0, 14);
        const cur = current(el);
        const singles = opts.filter((o) => o.toLowerCase() !== "monthly" && !M.isQuarterRange(o));
        const m = M.bestMatch(singles, month);
        if (m) {
          if (cur !== m) choose(el, opts.indexOf(m));
          return { done: true, changed: cur !== m, match: m, seen };
        }
        if (opts.includes("Monthly")) {
          if (cur !== "Monthly") { choose(el, opts.indexOf("Monthly")); changed = true; }
          continue;
        }
        const qm = M.bestMatch(opts, `Quarter ${quarter}`) || opts.find((o) =>
          new RegExp(`^\\s*${qFirst}`).test(o.toLowerCase()) ||
          new RegExp(`\\bq\\s*${quarter}\\b`).test(o.toLowerCase())) || null;
        if (qm && cur !== qm) { choose(el, opts.indexOf(qm)); changed = true; }
      }
      return { done: false, changed, seen };
    },

    /** True when year, month and return type are all still chosen. */
    filedFiltersOk(fy, month, ret) {
      const want = (M.MONTH_FULL[month] || month).toLowerCase().slice(0, 3);
      const rx = new RegExp(M.formRegex(ret));
      const seen = { fy: false, month: false, ret: false };
      for (const { el, desc } of selects()) {
        const cur = current(el);
        const low = cur.toLowerCase();
        if (desc.includes("year") || desc.includes("finyr")) seen.fy = M.bestMatch([cur], fy) != null;
        else if (desc.includes("type")) seen.ret = rx.test(low);
        else if (low.slice(0, 3) === want && !low.includes("monthly")) seen.month = true;
      }
      return seen.fy && seen.month && seen.ret;
    },

    /** Text of a link's table row without the link, e.g. "GSTR-2B Summary". */
    rowLabel(id) {
      const el = byId(id);
      if (!el) return "";
      const tr = el.closest("tr");
      const label = tr ? Array.from(tr.cells).filter((c) => !c.contains(el))
        .map((c) => c.innerText).join(" ") : "";
      return clean(label) || textOf(el);
    },

    pageMessage() {
      for (const css of [".modal.in .modal-body", ".modal.show .modal-body", ".alert",
                         "div[role='alert']", ".err", ".text-danger"]) {
        for (const el of document.querySelectorAll(css)) {
          const t = clean(el.innerText);
          if (vis(el) && t) return t.slice(0, 200);
        }
      }
      return "";
    },

    /** Press PROCEED / YES / OK / DOWNLOAD... in a visible dialog. */
    acceptModal() {
      for (const el of document.querySelectorAll(".modal a, .modal button, .ui-dialog button")) {
        const t = textOf(el);
        if (vis(el) && /^(proceed|yes|ok|download.*)$/i.test(t)) {
          pageClick(el);
          return t;
        }
      }
      return null;
    },

    /** Close advisory pop-ups (only 'close' buttons). */
    dismissPopups() {
      let n = 0;
      for (const el of document.querySelectorAll(".modal button, .modal a")) {
        if (!vis(el)) continue;
        const t = textOf(el).toLowerCase();
        if (["close", "×", "x"].includes(t) || el.classList.contains("close")) { pageClick(el); n++; }
      }
      return n;
    },

    /** Go to `path` like a user: click the portal's own (often hidden) menu
     *  link; else set location from this page so the Referer is the portal. */
    navigate(path, url) {
      const a = Array.from(document.querySelectorAll("a[href]")).find((x) => {
        try { return new URL(x.href, location.href).pathname === path; } catch (e) { return false; }
      });
      setTimeout(() => {
        if (a) { a.setAttribute("target", "_self"); pageClick(a); } else { location.href = url; }
      }, 50);
      return a ? "menu link" : "page script";
    },

    debugInfo() {
      return {
        url: location.href,
        title: document.title,
        message: ops.pageMessage(),
        controls: Array.from(document.querySelectorAll(CONTROLS))
          .filter((e) => vis(e) && textOf(e)).slice(0, 40).map(textOf),
        selects: selects().map((s) => ({ desc: s.desc.trim(), options: optionTexts(s.el).filter(Boolean) })),
      };
    },
  };

  globalThis.GSTPortal = ops;

  const rt = globalThis.chrome && chrome.runtime && chrome.runtime.onMessage;
  if (rt && !window.__gstPortal) {
    window.__gstPortal = true;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.op || !(msg.op in globalThis.GSTPortal)) return false;
      try {
        sendResponse({ value: globalThis.GSTPortal[msg.op](...(msg.args || [])) });
      } catch (e) {
        sendResponse({ error: String(e && e.message || e) });
      }
      return false;
    });
  }
})();
