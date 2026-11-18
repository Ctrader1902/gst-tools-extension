"use strict";
const $ = (s) => document.querySelector(s);
const $all = (s) => Array.from(document.querySelectorAll(s));
let status = { loggedIn: false, running: false, run: null, log: [] };
let sent = [];
chromeAnswers["chrome.runtime.sendMessage"] = (msg) => {
  sent.push(msg);
  if (msg.cmd === "status") return status;
  if (msg.cmd === "start") return { error: "login" };
  return { ok: true };
};
const visible = (el) => !!el && el.offsetParent !== null;

async function fresh(st) {
  status = { loggedIn: false, running: false, run: null, log: [], ...st };
  sent = [];
  document.getElementById("app").textContent = "";
  await GSTPanel.init({ poll: false });
}

test("five return types and twelve months", async () => {
  await fresh();
  const radios = $all("input[name=rtype]");
  eq(radios.map((r) => r.value), ["r1_json", "gstr2b_json", "gstr2b_excel", "gstr3b_ack", "gstr1_pdf_ack"]);
  eq($all("input[name=month]").length, 12);
  eq($all("#fy option").length, 5);
});

test("Open GST portal shown only when not logged in", async () => {
  await fresh({ loggedIn: false });
  ok(visible($("#open-portal")), "visible when logged out");
  await fresh({ loggedIn: true });
  ok(!visible($("#open-portal")), "hidden when logged in");
});

test("GENERATE only for R1 JSON with months", async () => {
  await fresh({ loggedIn: true });
  $("input[value=gstr2b_excel]").click();
  $("input[name=month][value=June]").click();
  eq($("#generate").disabled, true);
  $("input[value=r1_json]").click();
  eq($("#generate").disabled, false);
  $("#none").click();
  eq($("#generate").disabled, true);
  eq($("#download").disabled, true);
});

test("DOWNLOAD sends start with months in FY order", async () => {
  await fresh({ loggedIn: true });
  $("input[value=gstr2b_json]").click();
  $("input[name=month][value=Jan]").click();
  $("input[name=month][value=April]").click();
  $("#download").click();
  await new Promise((r) => setTimeout(r, 50));
  const start = sent.find((m) => m.cmd === "start");
  eq(start, { cmd: "start", taskKey: "gstr2b_json", fy: $("#fy").value, months: ["April", "Jan"], mode: "download" });
  ok(/log in/i.test($("#status").textContent), "status asks to log in");
});

test("log lines render with their kind", async () => {
  await fresh({ log: [{ t: "14:59:45", text: "Not ready yet: June", kind: "warn" }] });
  const line = $("#log .line.warn");
  ok(line && line.textContent.includes("Not ready yet: June"));
});

test("controls locked while running", async () => {
  await fresh({ loggedIn: true, running: true,
                run: { taskKey: "gstr3b_ack", months: ["May"], index: 0, results: {} } });
  eq($("#download").disabled, true);
  ok(visible($("#stop")), "stop visible");
  eq($("input[name=rtype]:checked").value, "gstr3b_ack", "shows the running type");
  eq($all("input[name=month]:checked").map((c) => c.value), ["May"], "shows the running months");
});

test("double click on DOWNLOAD sends one start", async () => {
  await fresh({ loggedIn: true });
  $("input[value=gstr3b_ack]").click();
  $("input[name=month][value=May]").click();
  $("#download").click();
  $("#download").click();
  await new Promise((r) => setTimeout(r, 50));
  eq(sent.filter((m) => m.cmd === "start").length, 1);
});

test("finished run's status shown on open; expiry offers the portal", async () => {
  await fresh({ loggedIn: false, run: { done: true, taskKey: "gstr3b_ack", months: ["May"],
    status: { kind: "err", text: "Session expired - log in to the GST portal again.", expired: true } } });
  ok($("#status").textContent.startsWith("Session expired"), $("#status").textContent);
  ok(visible($("#open-portal")), "portal button");
});
