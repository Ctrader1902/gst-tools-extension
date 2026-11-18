# GST Tools — Chrome extension (by Asif & Associates)

Download GST returns for many months in one go, straight from the GST portal,
inside your normal Chrome. You log in to the portal yourself; the extension
does the clicking.

| Return type | What you get | Saved as |
|---|---|---|
| R1 JSON | GSTR-1 offline JSON (GENERATE first, DOWNLOAD ~20 min later) | `GSTR1_JSON_<FY>_<Month>_…` |
| GSTR-2B JSON | GSTR-2B Summary + Details files | `GSTR2B_JSON_<FY>_<Month>_…` |
| GSTR-2B Excel | GSTR-2B Excel file | `GSTR2B_EXCEL_<FY>_<Month>_…` |
| GSTR-3B ACK | Filed GSTR-3B PDF | `GSTR3B_ACK_<FY>_<Month>_…` |
| GSTR-1 PDF ACK | Filed GSTR-1 summary PDF | `GSTR1_ACK_<FY>_<Month>_…` |

Files go to your **Downloads\GST Downloads** folder.

## Install (from the zip)

1. Save `gst-tools-extension-<version>.zip` and **unzip** it to a folder you
   will keep (for example `Documents\GST Tools Extension`).
2. In Chrome open **chrome://extensions**.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder.
5. Click the puzzle-piece icon in the toolbar and **pin** "GST Tools".

To update: unzip the new version over the same folder, then press the ↻
reload button on the GST Tools card in chrome://extensions.

## Use

1. Log in to the GST portal (https://services.gst.gov.in) in Chrome as usual.
2. Click the **GST Tools** icon — the panel opens on the right.
3. Pick the Financial Year, one return type, and tick the months.
4. Press **⬇ DOWNLOAD** (for R1 JSON press **⚙ GENERATE R1 JSON** first and
   DOWNLOAD about 20 minutes later).
5. A new portal tab opens and the extension works through the months. You can
   watch it, or keep working in your own tab. The Activity box shows progress.

**Stop** ends the run after the current step. Closing the run's tab also stops it.

## If something goes wrong

- *"Please log in"* — log in to the portal in this Chrome window first.
- *"Not ready yet"* — the portal is still preparing the file; try again in a
  few minutes.
- *Session expired / Access Denied* — log in again and restart the run.
- Anything else: press **Copy debug info** and paste it into a message to
  Asif & Associates. It contains the portal page's buttons and messages, no
  passwords.

## For developers

- Plain JavaScript, Manifest V3, no build step.
- Tests: `py tests/run_tests.py` (runs every `tests/*.html` page in headless
  Chrome and checks `manifest.json`).
- Zip: `powershell -ExecutionPolicy Bypass -File tools\build_zip.ps1` →
  `dist\gst-tools-extension-<version>.zip`.
- Icons: `py tools\make_icons.py`.
- Live test before each release: `docs/live-test-checklist.md`.
- Design and plan: `docs/superpowers/`.
