// Tiny in-browser test harness.  Tests register with test(name, fn); fn may
// be async.  After the page loads, all tests run in order and the outcome is
// written to <pre id="result"> for tests/run_tests.py to read.
"use strict";
(function () {
  const tests = [];
  class AssertionError extends Error {}

  function show(v) {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  globalThis.test = (name, fn) => tests.push({ name, fn });
  globalThis.eq = (actual, expected, msg) => {
    if (show(actual) !== show(expected)) {
      throw new AssertionError(`${msg ? msg + ": " : ""}expected ${show(expected)}, got ${show(actual)}`);
    }
  };
  globalThis.ok = (value, msg) => {
    if (!value) throw new AssertionError(msg || `expected truthy, got ${show(value)}`);
  };

  async function runAll() {
    const lines = [];
    let failed = 0;
    for (const t of tests) {
      try {
        await t.fn();
      } catch (e) {
        failed++;
        lines.push(`FAIL ${t.name}: ${e && e.message ? e.message : e}`);
      }
    }
    if (!tests.length) lines.push("FAIL no tests registered");
    else if (!failed) lines.unshift(`PASS ${tests.length}`);
    const pre = document.createElement("pre");
    pre.id = "result";
    pre.textContent = lines.join("\n");
    document.body.appendChild(pre);
  }

  window.addEventListener("error", (ev) => {
    tests.push({ name: "page error", fn: () => { throw new Error(ev.message); } });
  });
  window.addEventListener("load", () => { setTimeout(runAll, 0); });
})();
