# CursorDemo Project Brain (`BRAIN.md`)

> Fast-loading architectural memory & mental model for engineers and AI assistants working on CursorDemo (`https://github.com/getwebgrowth/cursordemo`).

## 1. Identity & Core Links
- **Product Name:** CursorDemo — Auto-Zoom Screen Recorder & 4K Studio Editor (Chrome Extension MV3, v1.4.0)
- **GitHub Repository:** `https://github.com/getwebgrowth/cursordemo`
- **Discord Community / Support:** `https://discord.gg/gwATujg6yq` (wired via `DISCORD_INVITE_URL`, `CURSORDEMO_DISCORD_URL`, and `[data-discord-link="true"]` in `record.html`, `record.js`, `editor.html`, `editor.js`, `background.js`)
- **Canonical Directories:**
  - Release folder: `/Users/ishara/Downloads/cursordemo`
  - IDE workspace mirror: `/Users/ishara/Downloads/cursorfly-screen-recorder-main 2` (must stay `0` diff via `rsync -a --delete`)
  - Web Store upload zip: `/Users/ishara/Downloads/cursordemo.zip`

## 2. Non-Negotiable Technical Invariants ("Do Not Break")

| Area | Invariant | Why It Matters |
|---|---|---|
| **Cursor Initial State** | `lastMouseX`, `lastMouseY`, `lastMouseScreenX`, `lastMouseScreenY` in `content.js` MUST start as `null`. Guard non-wheel `scroll` with `Number.isFinite(...)`. | Prevents fake `(0.5, 0.5)` center jumps before real cursor movement. |
| **Container Validation** | `editor.js` `init()` MUST accept both WebM (`1A 45 DF A3`) and ISO BMFF MP4 (`ftyp`, `moov`, `mdat`, `styp`, `free`, `wide`). | Brave/macOS/Windows fallback codecs can record fragmented MP4 instead of WebM. |
| **Webcam Mode** | `settings.webcamZoomMode` defaults to `'float'` (stationary); `'floating'` normalizes to `'float'`. | Prevents user face bubble from sliding unpredictably during auto-zoom unless user picks `'smart-dodge'` or `'zoom-with-screen'`. |
| **No Duplicate Face Cam** | DOM webcam overlays stay hidden during active capture (`record.js` / `content.js`). | Avoids baking a static circular webcam into screen pixels while Editor composites the separate `_cam` stream. |
| **1:1 Highlight Parity** | `doExport()` in `editor.js` MUST pass `cursorHighlight`, `cursorHighlightStyle`, `cursorHighlightColor`, `cursorHighlightSize` to `VideoProcessor`, and `VideoProcessor.drawCursorHighlight()` MUST call `resolveCursorHighlightPos()`. | Ensures preview & 4K export match identically and still work when `cursorData` only has clicks/zoom segments. |
| **Modal Shortcuts** | `editor.js` `keydown` checks `isDiscordOpen`, `isReviewOpen`, `isShortcutsOpen`, `isExportOpen`, `isProgressOpen` before acting on `Space`/`B`/`Z`/`S`/`Delete`/`I`/`O`. | Prevents background playback/timeline mutations while typing feedback in modals. |
| **Blob Revoke Timing** | `doExport()` waits `60000ms` before calling `URL.revokeObjectURL(url)`. | Allows native OS "Save As" dialogs to finish writing without network/blob failure. |
| **Locale Caps** | All 56 `_locales/*/messages.json` files must keep `extName <= 45` chars and `extDescription <= 132` chars. | Chrome Web Store rejects packages exceeding manifest localization length limits. |
| **Toast API** | Call `showToast(msg)` in `editor.js` (`showEditorToast` does not exist). | Prevents uncaught `ReferenceError` during post-download CTA toast. |

## 3. Lifecycle Flow Cheat Sheet
- **Install:** `background.js` `onInstalled` (`reason === 'install'`) opens `record.html?welcome=1` -> `#welcomeModal` auto-opens unless `cursordemo.welcomeSeen === 'true'`.
- **Capture Start:** `record.js` saves `cursordemo.recordingInProgress`, uses 4-stage `getDisplayMedia()` fallback, switches to target tab; returning to `record.html` auto-pauses capture so user isn't forced to record the controller UI.
- **Editor Load:** `editor.js` reads `video_<id>`, `video_<id>_cam`, `video_<id>_meta` from `CursorDemoVideoStorage` (falling back to `CursorFlyVideoStorage` & `chrome.storage.local`). Checks stale `cursordemo.exportInProgress` for crash recovery.
- **Exports:**
  - Export `#1` & `#2` -> `#reviewModal` (celebration + 5-star Chrome Web Store CTA / 1–3 star GitHub feedback encoder).
  - Export `#3` -> `#discordModal` (`mode: 'milestone'`) inviting creator to `https://discord.gg/gwATujg6yq`.
  - Any crash / decode error / capture error / export exception / interrupted session -> `#discordModal` (`mode: 'crash'`) with copyable diagnostic telemetry + Discord invite.

## 4. Debugging Playbook
- **Screen picker empty on macOS 15:** Check `#screenPermissionWarning` & Chrome flag hint `chrome://flags/#use-sc-content-sharing-picker` in `record.js`.
- **Cursor offset in Brave/Opera/Edge/Vivaldi/Yandex:** Inspect `leftChromeWidth` and `topChromeHeight` math in `content.js` and `ZoomAnalyzer.getPointSourceCoords()` in `zoom-analyzer.js`.
- **Export differs from Preview:** Compare `renderPreviewFrame()` (around `editor.js:5870–5940`) vs `VideoProcessor.processVideo()` (around `video-processor.js:895–1020`) and verify every setting field is forwarded in `exportSettings` (`editor.js:7659–7706`).
- **Extension fails `init()` on load:** Run `node --check *.js` — any syntax or top-level initialization error in `editor.js`/`record.js` will trigger the global `error` listener and open `#discordModal`.
