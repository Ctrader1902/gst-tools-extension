// Side panel: choose FY / return type / months, start or stop a run, show
// the activity log.  All work happens in the service worker.
"use strict";
(function () {
  const M = globalThis.GSTMatch;
  const state = { loggedIn: false, running: false, run: null, logShown: 0 };
  let els = {};
  let pollTimer = null;

  const send = (msg) => chrome.runtime.sendMessage(msg);

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kids) if (k) e.append(k);
    return e;
  }

  function build(root) {
    const fy = el("select", { id: "fy", onchange: savePrefs },
      ...M.fyChoices(new Date()).map((y) => el("option", { value: y, text: y })));

    const types = el("div", { class: "types" }, ...Object.entries(M.TASKS).map(([key, t], i) =>
      el("label", {},
        el("input", { type: "radio", name: "rtype", value: key, onchange: changed,
                      ...(i === 0 ? { checked: "" } : {}) }),
        ` ${t.title}`, el("span", { class: "sub", text: t.sub }))));

    const months = el("div", { class: "months" }, ...M.MONTHS.map((m, i) =>
      el("label", { title: M.MONTH_FULL[m] || m },
        el("input", { type: "checkbox", name: "month", value: m, onchange: changed }), M.SHORT[i])));

    root.append(
      el("header", {}, el("div", { class: "app", text: "GST TOOLS" }),
         el("div", { class: "firm", text: "by Asif & Associates" })),
      el("div", { class: "card" },
        el("div", { id: "status-box", class: "status" },
          el("span", { class: "dot" }), el("span", { id: "status", class: "text", text: "Checking ..." }),
          el("button", { id: "open-portal", class: "btn primary hidden", text: "Open GST portal",
                         onclick: () => send({ cmd: "openPortal" }) }))),
      el("div", { class: "card" },
        el("label", { class: "field", for: "fy", text: "Financial Year" }), fy,
        el("div", { class: "section" }, el("label", { class: "field", text: "Return type" }), types),
        el("div", { class: "section" },
          el("div", { class: "months-head" }, el("label", { class: "field", text: "Months" }),
            el("span", {},
              el("button", { id: "all", class: "linkbtn", text: "All", onclick: () => tickAll(true) }),
              el("button", { id: "none", class: "linkbtn", text: "None", onclick: () => tickAll(false) }))),
          months),
        el("div", { class: "actions" },
          el("button", { id: "download", class: "btn primary", text: "⬇ DOWNLOAD", onclick: () => start("download") }),
          el("button", { id: "generate", class: "btn teal", text: "⚙ GENERATE R1 JSON", onclick: () => start("generate") }),
          el("button", { id: "stop", class: "btn danger hidden", text: "■ Stop", onclick: () => send({ cmd: "stop" }) })),
        el("div", { class: "actions" },
          el("button", { id: "open-folder", class: "btn ghost", text: "Open folder", onclick: () => send({ cmd: "openFolder" }) }),
          el("button", { id: "copy-debug", class: "btn ghost", text: "Copy debug info", onclick: copyDebug })),
        el("div", { class: "note", text: "Log in to the GST portal in this browser first. R1 JSON: the portal " +
          "needs about 20 minutes to prepare the file - press GENERATE R1 JSON first; afterwards DOWNLOAD " +
          "fetches it. Files are saved in Downloads\\GST Downloads." })),
      el("div", { class: "card" },
        el("div", { class: "log-head" }, el("label", { class: "field", text: "Activity" }),
          el("button", { id: "clear-log", class: "linkbtn", text: "Clear", onclick: clearLog })),
        el("div", { id: "log" })));

    els = Object.fromEntries(["fy", "status", "status-box", "open-portal", "download", "generate",
                              "stop", "log"].map((id) => [id, root.querySelector(`#${id}`)]));
  }

  const chosenType = () => (document.querySelector("input[name=rtype]:checked") || {}).value;
  const chosenMonths = () => Array.from(document.querySelectorAll("input[name=month]:checked")).map((c) => c.value);

  function tickAll(on) {
    document.querySelectorAll("input[name=month]").forEach((c) => { c.checked = on; });
    changed();
  }

  function changed() { state.shownStatus = null; savePrefs(); update(); }

  function savePrefs() {
    chrome.storage.local.set({ prefs: { fy: els.fy.value, type: chosenType(), months: chosenMonths() } });
  }

  async function restorePrefs() {
    const { prefs } = (await chrome.storage.local.get("prefs")) || {};
    if (!prefs) return;
    if ([...els.fy.options].some((o) => o.value === prefs.fy)) els.fy.value = prefs.fy;
    const r = document.querySelector(`input[name=rtype][value="${CSS.escape(prefs.type || "")}"]`);
    if (r) r.checked = true;
    for (const c of document.querySelectorAll("input[name=month]")) c.checked = (prefs.months || []).includes(c.value);
  }

  function setStatus(kind, text) {
    els["status-box"].className = `status ${kind}`;
    els.status.textContent = text;
  }

  /** While a run is going on, show what it is running. */
  function showRun(run) {
    const r = document.querySelector(`input[name=rtype][value="${CSS.escape(run.taskKey || "")}"]`);
    if (r) r.checked = true;
    for (const c of document.querySelectorAll("input[name=month]")) c.checked = (run.months || []).includes(c.value);
  }

  function update() {
    if (state.running && state.run) showRun(state.run);
    const months = chosenMonths();
    const idle = !state.running && !state.starting;
    els.download.disabled = !idle || !months.length || !chosenType();
    els.generate.disabled = !idle || !months.length || chosenType() !== "r1_json";
    els.stop.classList.toggle("hidden", idle);
    const expired = !!(state.shownStatus && state.shownStatus.expired);
    els["open-portal"].classList.toggle("hidden", state.loggedIn && !expired);
    document.querySelectorAll("input, select").forEach((i) => { i.disabled = !idle; });
    if (state.running && state.run) {
      const r = state.run;
      const t = M.TASKS[r.taskKey];
      const at = Math.min((r.index || 0) + 1, r.months.length);
      setStatus("busy", `Running ${t ? t.title : ""}: month ${at} of ${r.months.length} ...`);
    } else if (state.shownStatus) {
      setStatus(state.shownStatus.kind, state.shownStatus.text);
    } else {
      if (state.loggedIn) setStatus("ok", "Logged in to the GST portal.");
      else setStatus("warn", "Please log in to the GST portal in this browser first.");
    }
  }

  function addLog(line) {
    const div = el("div", { class: `line ${line.kind || ""}` },
      el("span", { class: "t", text: line.t || "" }), line.text);
    const atEnd = els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - 4;
    els.log.append(div);
    if (atEnd) els.log.scrollTop = els.log.scrollHeight;
  }

  function renderLog(lines) {
    els.log.textContent = "";
    (lines || []).forEach(addLog);
    els.log.scrollTop = els.log.scrollHeight;
  }

  async function refresh(withLog = false) {
    let st;
    try { st = await send({ cmd: "status" }); } catch (e) { return; }
    if (!st) return;
    state.loggedIn = st.loggedIn;
    state.running = st.running;
    state.run = st.run;
    if (withLog) renderLog(st.log);
    // reopening the panel after a run: show how it ended
    if (withLog && !st.running && st.run && st.run.done && st.run.status) state.shownStatus = st.run.status;
    update();
  }

  async function start(mode) {
    if (state.starting || state.running) return;      // a double click starts one run
    state.starting = true;
    state.shownStatus = null;
    update();
    try {
      const r = await send({ cmd: "start", taskKey: chosenType(), fy: els.fy.value,
                             months: M.MONTHS.filter((m) => chosenMonths().includes(m)), mode });
      if (r && r.error === "login") {
        state.loggedIn = false;
        state.shownStatus = { kind: "warn", text: "Please log in to the GST portal first, then press the button again." };
        return;
      }
      if (r && r.error) { state.shownStatus = { kind: "err", text: r.error }; return; }
      els.log.textContent = "";
    } finally {
      state.starting = false;
      update();
    }
    await refresh();
  }

  async function copyDebug() {
    const r = await send({ cmd: "debug" });
    const text = JSON.stringify((r && r.debug) || [], null, 2);
    try {
      await navigator.clipboard.writeText(text);
      state.shownStatus = { kind: "ok", text: "Debug info copied - paste it into a message to the person who supports you." };
      update();
    } catch (e) {
      setStatus("err", "Could not copy debug info.");
    }
  }

  async function clearLog() {
    els.log.textContent = "";
    await send({ cmd: "clearLog" });
  }

  async function init({ poll = true } = {}) {
    const root = document.getElementById("app");
    state.shownStatus = null;
    state.starting = false;
    build(root);
    await restorePrefs();
    await refresh(true);
    if (!init.listening && chrome.runtime.onMessage) {
      init.listening = true;
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || !msg.evt) return;
        if (msg.evt === "log") addLog(msg.line);
        if (msg.evt === "progress") { state.run = msg.run; update(); }
        if (msg.evt === "done") {
          state.running = false;
          state.shownStatus = msg.status;
          update();
        }
      });
    }
    if (poll && !pollTimer) pollTimer = setInterval(() => refresh(false), 3000);
  }

  globalThis.GSTPanel = { init };
  if (!window.__noAutoInit) document.addEventListener("DOMContentLoaded", () => init());
})();
