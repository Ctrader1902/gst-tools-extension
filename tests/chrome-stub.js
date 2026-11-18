// A do-nothing chrome.* stand-in: every API is a function returning a
// resolved promise, every on* is an event with addListener.  Calls are
// recorded in chromeCalls for assertions.
"use strict";
(function () {
  const calls = [];
  const answers = {};
  const events = {};
  const constants = { "chrome.runtime.id": "test-ext-id" };
  function node(path) {
    const fn = (...args) => {
      calls.push({ path, args });
      if (answers[path]) return Promise.resolve(answers[path](...args));
      return Promise.resolve(undefined);
    };
    return new Proxy(fn, {
      get(_t, k) {
        if (k === "then") return undefined;
        const sub = `${path}.${String(k)}`;
        if (sub in constants) return constants[sub];
        if (typeof k === "string" && /^on[A-Z]/.test(k)) {
          if (!events[sub]) {
            const fns = [];
            events[sub] = { fns, addListener: (f) => fns.push(f), removeListener() {} };
          }
          return events[sub];
        }
        return node(sub);
      },
    });
  }
  globalThis.chromeEvents = events;
  globalThis.chromeCalls = calls;
  globalThis.chromeAnswers = answers;
  globalThis.chrome = node("chrome");
  // storage.get resolves to {} so destructuring works
  answers["chrome.storage.session.get"] = () => ({});
  answers["chrome.storage.local.get"] = () => ({});
  answers["chrome.tabs.query"] = () => [];
  answers["chrome.runtime.sendMessage"] = () => undefined;
  // importScripts for page context: synchronous XHR + global eval
  globalThis.importScripts = (...files) => {
    for (const f of files) {
      const x = new XMLHttpRequest();
      x.open("GET", "../" + f, false);
      x.send();
      (0, eval)(x.responseText + `\n//# sourceURL=${f}`);
    }
  };
})();
