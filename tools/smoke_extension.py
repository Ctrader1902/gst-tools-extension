"""Load the unpacked extension in a throw-away headless Chrome and check that
the service worker answers the panel.  Needs `py -m pip install selenium`.

Usage:  py tools/smoke_extension.py
"""
import sys
import tempfile
import time
from pathlib import Path

from selenium import webdriver

ROOT = Path(__file__).resolve().parent.parent
STATUS_JS = ("const cb = arguments[0]; chrome.runtime.sendMessage(arguments[1])"
             ".then(r => cb(JSON.stringify(r)), e => cb('ERR ' + e.message));")


def main() -> int:
    o = webdriver.ChromeOptions()
    for a in ("--headless=new", "--enable-unsafe-extension-debugging",
              "--remote-debugging-pipe", f"--user-data-dir={tempfile.mkdtemp()}"):
        o.add_argument(a)
    o.enable_bidi = True
    d = webdriver.Chrome(options=o)
    try:
        eid = d.webextension.install(path=str(ROOT))["extension"]
        time.sleep(3)
        d.get(f"chrome-extension://{eid}/sidepanel/index.html")
        time.sleep(3)
        status = d.find_element("id", "status").text
        worker = d.execute_async_script(STATUS_JS, {"cmd": "status"})
        start = d.execute_async_script(STATUS_JS, {"cmd": "start", "taskKey": "gstr2b_json",
                                                   "fy": "2025-26", "months": ["June"],
                                                   "mode": "download"})
        print("panel status :", status)
        print("worker status:", worker)
        print("start        :", start)
        ok = worker.startswith("{") and '"error":"login"' in start and "log in" in status.lower()
        print("PASS" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        d.quit()


if __name__ == "__main__":
    sys.exit(main())
