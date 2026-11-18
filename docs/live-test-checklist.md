# Live test checklist (needs a real GST login)

Load the extension: chrome://extensions → Developer mode → Load unpacked →
this folder (or the unzipped `dist` zip). After any code change press ↻ on
the extension card. Errors from the extension show on that card ("Errors")
and in the service worker console ("Inspect views: service worker").

Log in to the portal in Chrome, then open the GST Tools panel.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | Panel opened before logging in | "Please log in…" + Open GST portal button | |
| 2 | After logging in, wait 3 s | "Logged in to the GST portal." | |
| 3 | GSTR-2B JSON, **June** (failed in the desktop app) | Summary + Details parts saved as `GSTR2B_JSON_<FY>_June_…` | |
| 4 | GSTR-2B Excel, one month | `.xlsx` saved as `GSTR2B_EXCEL_<FY>_<Month>_…` | |
| 5 | GSTR-3B ACK, two months | two PDFs `GSTR3B_ACK_…` | |
| 6 | GSTR-1 PDF ACK, one month | PDF via VIEW SUMMARY, `GSTR1_ACK_…` | |
| 7 | R1 JSON → GENERATE, one month | "Generation requested" | |
| 8 | R1 JSON → DOWNLOAD ~20 min later | JSON parts saved `GSTR1_JSON_…` | |
| 9 | Close the side panel mid-run, reopen | run continues; progress and log shown | |
| 10 | Close the run tab mid-run | "Run tab was closed - run stopped."; rest "Not run" | |
| 11 | Press Stop mid-run | stops after current step | |
| 12 | Download any other file (another site) during a run | its name is **not** changed | |
| 13 | Log out of the portal in your own tab mid-run | run stops with "log in again" | |
| 14 | A month with no filed return | that month "Failed", next month still runs; Copy debug info gives text | |
| 15 | Open folder | opens the folder with the last saved file | |

Note any failure with the Activity log and the Copy debug info text.
