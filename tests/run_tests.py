"""Run every tests/*.html page in headless Chrome and report the results.

Usage:  py tests/run_tests.py            run all test pages
        py tests/run_tests.py match      run pages whose name contains 'match'
        py tests/run_tests.py --manifest check manifest.json only
Exit code 0 when everything passed.
"""
from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"
CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
]

PERMISSIONS = ["sidePanel", "downloads", "storage", "scripting", "contentSettings"]
HOSTS = ["https://*.gst.gov.in/*"]


def chrome() -> str:
    for p in CHROME_PATHS:
        if os.path.exists(p):
            return p
    sys.exit("Chrome not found.")


def run_page(page: Path) -> tuple[bool, str]:
    with tempfile.TemporaryDirectory() as profile:
        cmd = [chrome(), "--headless=new", "--disable-gpu", "--no-first-run",
               "--allow-file-access-from-files", f"--user-data-dir={profile}",
               "--virtual-time-budget=60000", "--dump-dom", page.as_uri()]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True,
                                 encoding="utf-8", errors="replace", timeout=180).stdout
        except subprocess.TimeoutExpired:
            return False, "TIMEOUT"
    m = re.search(r'<pre id="result">(.*?)</pre>', out, re.S)
    if not m:
        return False, "no result (page did not finish)"
    text = html.unescape(m.group(1)).strip()
    return text.startswith("PASS"), text


def check_manifest() -> tuple[bool, str]:
    man = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    problems = []
    if man.get("manifest_version") != 3:
        problems.append("manifest_version must be 3")
    if sorted(man.get("permissions", [])) != sorted(PERMISSIONS):
        problems.append(f"permissions {man.get('permissions')} != {PERMISSIONS}")
    if sorted(man.get("host_permissions", [])) != sorted(HOSTS):
        problems.append(f"host_permissions {man.get('host_permissions')} != {HOSTS}")
    if "content_scripts" in man:
        problems.append("content_scripts must not be declared")
    files = [man.get("background", {}).get("service_worker"),
             man.get("side_panel", {}).get("default_path"),
             *man.get("icons", {}).values(),
             *man.get("action", {}).get("default_icon", {}).values()]
    sw = ROOT / man.get("background", {}).get("service_worker", "")
    if sw.is_file():
        files += re.findall(r'"([\w/.-]+\.js)"',
                            re.search(r"importScripts\(([^)]*)\)", sw.read_text("utf-8")).group(1)
                            if "importScripts" in sw.read_text("utf-8") else "")
    for f in files:
        if f and not (ROOT / f).is_file():
            problems.append(f"missing file: {f}")
    return not problems, "PASS" if not problems else "FAIL " + "; ".join(problems)


def main() -> int:
    args = sys.argv[1:]
    results = []
    if args == ["--manifest"]:
        results.append(("manifest.json", *check_manifest()))
    else:
        for page in sorted(TESTS.glob("*.html")):
            if args and not any(a in page.name for a in args):
                continue
            results.append((page.name, *run_page(page)))
        if not args and (ROOT / "manifest.json").exists():
            results.append(("manifest.json", *check_manifest()))
    if not results:
        print("no test pages found")
        return 1
    for name, passed, text in results:
        print(f"{name}: {text}")
    bad = [n for n, p, _ in results if not p]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
