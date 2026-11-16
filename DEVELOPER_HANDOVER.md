# CursorDemo Screen Recorder — Developer Handover & Complete Technical Reference

> **Repository:** [`https://github.com/getwebgrowth/cursordemo`](https://github.com/getwebgrowth/cursordemo)  
> **Version:** `1.4.0` (Manifest V3, `minimum_chrome_version: "102"`)  
> **Discord Support & Community:** [`https://discord.gg/gwATujg6yq`](https://discord.gg/gwATujg6yq)  
> **Canonical Local Directory:** `/Users/ishara/Downloads/cursordemo` (synced 1:1 with workspace `/Users/ishara/Downloads/cursorfly-screen-recorder-main 2`)  
> **Chrome Web Store Release Archive:** `/Users/ishara/Downloads/cursordemo.zip`

---

## 1. Quick Start for Developers (Windows / macOS / Linux)

No bundler or transpiler is required — **CursorDemo** runs as pure Vanilla ES2022+ JavaScript, HTML5, CSS3, Canvas 2D, Web Audio API, IndexedDB, and Chrome Extension Manifest V3 APIs.

### Load Unpacked in Any Chromium Browser
1. Clone the repository:
   ```bash
   git clone https://github.com/getwebgrowth/cursordemo.git
   cd cursordemo
   ```
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`, `opera://extensions`, `vivaldi://extensions`, `browser://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the cloned `cursordemo/` folder.
5. Click the toolbar icon to open `record.html`.

### Run Local Syntax & Logic Verification (Requires Node.js 18+)
```bash
# 1. Syntax check every core script
for f in background.js content.js record.js editor.js video-processor.js zoom-analyzer.js; do
  node --check "$f" || exit 1
done

# 2. Validate all 56 Chrome Web Store _locales/*/messages.json bundles
node -e '
const fs = require("fs"), path = require("path");
const dirs = fs.readdirSync("_locales");
for (const d of dirs) {
  const m = JSON.parse(fs.readFileSync(path.join("_locales", d, "messages.json"), "utf8"));
  if (m.extName.message.length > 45) throw new Error(d + " extName > 45");
  if (m.extDescription.message.length > 132) throw new Error(d + " extDescription > 132");
}
console.log("Validated", dirs.length, "locales OK");
'
```

---

## 2. Canonical Directory Sync & Release Zip Protocol

> **Critical Maintenance Rule:** Never create extra duplicate folders (`cursorfly-*`, `cursordemo-extension`, etc.) in `/Users/ishara/Downloads/`. Always keep `/Users/ishara/Downloads/cursorfly-screen-recorder-main 2` (if used as an IDE workspace) and `/Users/ishara/Downloads/cursordemo` strictly identical (`0` diff).

After making edits, sync `/Users/ishara/Downloads/cursordemo` and rebuild `/Users/ishara/Downloads/cursordemo.zip` (excluding `.git`, `.DS_Store`, `*.zip`, `*.mp4`, `*.webm`):

```bash
rsync -a --delete --exclude='.git' --exclude='*.zip' --exclude='.DS_Store' \
  "/Users/ishara/Downloads/cursorfly-screen-recorder-main 2/" \
  "/Users/ishara/Downloads/cursordemo/"

diff -rq -x '.git' -x '*.zip' -x '.DS_Store' \
  "/Users/ishara/Downloads/cursorfly-screen-recorder-main 2" \
  "/Users/ishara/Downloads/cursordemo"

rm -f "/Users/ishara/Downloads/cursordemo.zip"
cd "/Users/ishara/Downloads/cursordemo" && zip -r "/Users/ishara/Downloads/cursordemo.zip" . \
  -x "*.git*" "*.DS_Store" "*.zip" "*.mp4" "*.webm"
```

---

## 3. System Architecture & Data Flow

```text
+-----------------------------------------------------------------------------+
| 1. CAPTURE LAYER                                                            |
|                                                                             |
|  background.js (Service Worker)                                             |
|   ├── Action click / onInstalled (?welcome=1) -> opens/focuses record.html  |
|   ├── Injects/re-injects content.js into active recorded tab                |
|   ├── Maintains chrome.storage.local recording state & cursorData snapshot  |
|   └── Routes cursorMove / click / scroll / control messages to record.js    |
|                                                                             |
|  content.js (Injected into all <all_urls> frames at document_start)         |
|   ├── Captures pointermove, mousemove, mousedown, click, dblclick, wheel    |
|   ├── Computes leftChromeWidth, topChromeHeight & normalized coordinates      |
|   └── Floating DOM cam preview stays HIDDEN during active capture           |
|                                                                             |
|  record.html + record.js (Studio Capture Hub)                               |
|   ├── 4-stage getDisplayMedia() fallback + desktopCapture compatibility     |
|   ├── macOS Screen Recording + chrome://flags/#use-sc-content-sharing-picker|
|   ├── Dual MediaRecorder: Primary Screen + Separate 8 Mbps 1:1 Face Cam     |
|   ├── Saves blobs + _cam + _meta JSON into IndexedDB ("CursorDemoVideoStorage")|
|   └── Auto-switches away on start; auto-pauses when returning to record.html|
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| 2. TELEMETRY & CAMERA ENGINE (zoom-analyzer.js)                             |
|   ├── Normalizes coordinates across monitor / window / browser surfaces     |
|   ├── Hybrid Click + Non-Click Hover/Dwell clustering (`analyzeClicks()`)   |
|   ├── Progressive Edge & 4-Corner Focal Boost (`getAdaptiveBoundaryZoom()`) |
|   ├── Steadicam Gaussian smoothing + Catmull-Rom monotone spline cursor pos |
|   └── Cursor Highlight resolver (`resolveCursorHighlightPos()` with fallback) |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| 3. STUDIO EDITOR & EXPORT ENGINE                                            |
|                                                                             |
|  editor.html + editor.js (Dark Pro Studio UI)                               |
|   ├── Tabbed Inspector (`All | Frame | Zoom | Effects`)                     |
|   ├── 3-Lane Timeline (`CAMERA & ZOOM`, `MANUAL BLUR`, `CLICKS`)            |
|   ├── Live Canvas Preview (`renderPreviewFrame()` <-> 1:1 export parity)    |
|   ├── Manual Blur (`+ Blur (B)` / `Draw on Video` / 8-handle resize)        |
|   ├── Free-Form Draggable 1:1 Face Cam (`float`, `smart-dodge`, `zoom-with-screen`)|
|   ├── Cursor Highlight (`halo`, `spotlight`, `ring`, `dot` + size & color)  |
|   └── Lifecycle Modals: `#reviewModal` (1st+ export), `#discordModal` (3rd  |
|       export milestone + automatic crash/error/interrupted-session detection)|
|                                                                             |
|  video-processor.js (1080p / 1440p / 4K @ 60 FPS Renderer)                  |
|   ├── Pre-rendered static backdrop + dual-layer elevation shadow canvas     |
|   ├── Identical zoom crop, Manual Blur, Click Ripples, Cursor Highlight,    |
|   │   macOS Window Header, and 1:1 Face Cam compositing                     |
|   └── WebM / MP4 MediaRecorder + WebM EBML duration header patching         |
+-----------------------------------------------------------------------------+
```

---

## 4. File-by-File Inventory

| File | Responsibility | Key Symbols & Notes |
|---|---|---|
| [`manifest.json`](manifest.json) | MV3 extension manifest | `version: "1.4.0"`, `default_locale: "en"`, permissions: `activeTab`, `storage`, `desktopCapture`, `tabs`, `scripting`, `unlimitedStorage`. |
| [`background.js`](background.js) | Service worker orchestrator | `CURSORDEMO_DISCORD_URL`, `onInstalled` (`?welcome=1`), `updateRecordingIcon`, cursor snapshot buffering, tab-switch helpers. |
| [`content.js`](content.js) | Universal page interaction tracker | `handleMouseMove`, `handleMouseDown`, `handleClick`, `handleScroll`, `sendCursorData`, `leftChromeWidth` sidebar calculation, `lastMouseX/Y = null` guard. |
| [`record.html`](record.html) | Screen Choose & Capture Setup UI | Welcome banner + `#welcomeModal`, Screen Choose cards, `#screenPermissionWarning`, Chrome SC picker flag helper, `#discordModal`, Discord CTAs (`data-discord-link="true"`). |
| [`record.js`](record.js) | Capture streams & MediaRecorder hub | `detectEnvironment()`, `RUNTIME_ENV`, `DISCORD_INVITE_URL`, 4-stage `getDisplayMedia()`, dual Screen + Cam `MediaRecorder`, `CursorDemoVideoStorage`, `showDiscordModal()`, runtime crash listeners. |
| [`zoom-analyzer.js`](zoom-analyzer.js) | Auto-zoom & cursor trajectory math | `ZoomAnalyzer`, `analyzeClicks()`, `getZoomAtTime()`, `getAdaptiveBoundaryZoom()`, `getPointSourceCoords()`, `getCursorAtTime()`, `resolveCursorHighlightPos()`, `getSteadicamCursorAtTime()`. |
| [`editor.html`](editor.html) | Dark Pro Studio Editor layout | Tabbed inspector, `#previewCanvas`, 3-lane timeline, `#exportModal`, `#reviewModal`, `#discordModal`, `#shortcutsModal`, Cursor Highlight controls. |
| [`editor.js`](editor.js) | Studio Editor controller (~7,850 LOC) | `init()`, `renderPreviewFrame()`, `drawCursorDotOnPreview()`, `renderCursorHighlightPrimitive()`, `drawBlurRegionsOnPreview()`, `drawWebcamOnPreview()`, `doExport()`, `showPostDownloadModal()`, `showDiscordModal()`, `setupDiscordModal()`. |
| [`video-processor.js`](video-processor.js) | Hardware-accelerated frame exporter | `VideoProcessor`, `processVideo()`, `drawBlurRegions()`, `drawClickEffects()`, `drawCursorHighlight()`, `drawWebcam()`, WebM EBML duration patcher. |
| [`_locales/*`](_locales) | Chrome Web Store i18n (56 languages) | Every `messages.json` adheres to `extName <= 45` chars and `extDescription <= 132` chars. |
| [`docs/*`](docs) | Marketing/SEO/AEO site assets | `index.html`, `llms.txt`, `llms-full.txt`, `pricing.md`, `robots.txt`, `sitemap.xml`. |
| [`CHROME_STORE_UPLOAD.md`](CHROME_STORE_UPLOAD.md) | Store listing, SEO/GEO/AEO & submission guide | Ready-to-paste copy, permissions justifications, keywords. |
| [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) | Zero-upload privacy disclosure | Explains 100% local IndexedDB + Canvas processing. |

---

## 5. Storage Schemas (IndexedDB, `localStorage`, `chrome.storage.local`)

### IndexedDB (`CursorDemoVideoStorage` v1, store: `videos`, keyPath: `id`)
Legacy fallback reads `CursorFlyVideoStorage` automatically.
- `video_<timestamp>`: `{ id, blob, timestamp, size }` — Main screen recording WebM/MP4 blob.
- `video_<timestamp>_cam`: `{ id, blob, timestamp, size }` — Synchronized separate 1:1 Face Cam stream (`8 Mbps`).
- `video_<timestamp>_meta`: `{ id, blob }` (JSON blob) — Fallback metadata containing `{ cursorData, videoWidth, videoHeight, duration, displaySurface, cameraVideoId }`.

### `localStorage` Keys
| Key | Values | Purpose |
|---|---|---|
| `cursordemo.exportCount` | `'1'`, `'2'`, `'3'`, ... | Tracks successful exports (triggers `#reviewModal` on 1st+, `#discordModal` milestone on 3rd). |
| `cursordemo.reviewPromptShown` | `'true'` | Records review modal display. |
| `cursordemo.reviewPromptDismissed` | `'true'` | Set when user clicks "Don't ask again" or completes review CTA. |
| `cursordemo.discordPromptShown` | `'true'` | Records 3rd-download Discord milestone prompt display. |
| `cursordemo.discordPromptDismissed` | `'true'` | Set when user clicks "Don't show again" in `#discordModal`. |
| `cursordemo.exportInProgress` | JSON `{ startedAt, resolution, format, ... }` | Set at `doExport()` start, cleared on finish/error. If present on `editor.html` reload, auto-opens crash recovery `#discordModal`. |
| `cursordemo.recordingInProgress` | JSON `{ startedAt, displaySurface, quality }` | Set on recording start, cleared on stop. If present on `record.html` reload while idle, auto-opens crash recovery `#discordModal`. |
| `cursordemo.welcomeSeen` / `cursordemo.welcomeBannerDismissed` | `'true'` | Controls onboarding modal & banner dismissal. |
| `cursordemo.lastUserFeedback` / `cursordemo.lastDiscordNote` | String | Preserves user feedback typed before opening GitHub/Discord. |
| `cursordemo.cursorHighlight` | `'true'` \| `'false'` | Cursor Highlight enabled toggle. |
| `cursordemo.cursorHighlightStyle` | `'halo'` \| `'spotlight'` \| `'ring'` \| `'dot'` | Selected Cursor Highlight visual style. |
| `cursordemo.cursorHighlightColor` | Hex string (`#ffab00`) | Selected Cursor Highlight color. |
| `cursordemo.cursorHighlightSize` | `'0.5'`..`'2.5'` | Highlight size multiplier (`1.0` = `100%`). |

---

## 6. Critical Subsystems & Mathematical Invariants

### A. Coordinate Normalization & Chromium Sidebar Compensation (`content.js` & `zoom-analyzer.js`)
- `lastMouseX`, `lastMouseY`, `lastMouseScreenX`, `lastMouseScreenY` initialize to **`null`** (never synthetic center-screen values!). Non-wheel `scroll` events return early if `!Number.isFinite(lastMouseX) || !Number.isFinite(lastMouseY)`.
- Chromium browsers with vertical sidebars (Brave, Opera, Edge, Vivaldi, Yandex, Arc) shift the web viewport rightward relative to the OS window (`window.innerWidth < window.outerWidth`). `content.js` calculates `leftChromeWidth` and attaches normalized tab, window, and screen coordinates to every pointer/click event so zoom focal targets align pixel-accurately across all browsers and OS window modes.

### B. Progressive Edge & 4-Corner Auto-Zoom (`zoom-analyzer.js`)
- Default zoom presets: `shallow: 1.40`, `moderate: 1.75`, `deep: 2.20`, `maximum: 2.80`.
- When hovering or clicking near frame boundaries (`x < 0.14`, `x > 0.86`, `y < 0.14`, `y > 0.86`), zooming at only `1.4x–1.75x` leaves viewport clamp walls unable to center corners. `getAdaptiveBoundaryZoom()` smoothly applies up to **`+28%..+34%`** progressive boundary magnification + homothetic center interpolation (`cx in [1/(2*scale), 1 - 1/(2*scale)]`) so corners and edges remain crisp and comfortably centered without hard wall hits.

### C. 1:1 Preview ↔ 4K Export Rendering Order (`editor.js` `renderPreviewFrame()` <-> `video-processor.js` `processVideo()`)
Both renderers MUST maintain identical transform order and math:
1. Pre-rendered canvas background (`mac-sequoia`, gradient, image, or transparent) + dual-layer elevation shadow.
2. Rounded corner clip (`borderRadius`) enclosing optional macOS titlebar (`macHeaderHeight`) + video viewport.
3. Top crop (`topCrop`) when `cleanBrowser` is enabled (`displaySurface === 'browser'` strips browser tab/address chrome cleanly).
4. Zoom & pan crop rectangle `(sx, sy, sw, sh)` drawn into destination viewport.
5. `Zoom-Synced` (`mode: 'content'`) and `Screen-Locked` (`mode: 'screen'`) Manual Blur regions (`gaussian`, `pixelate`, `solid`).
6. Click ripples (`ripple`, `both`, `ring`, `orb`) using `getDeduplicatedClicks()`.
7. Cursor Highlight (`halo`, `spotlight`, `ring`, `dot`) using `resolveCursorHighlightPos()` — **must receive** `cursorHighlight`, `cursorHighlightStyle`, `cursorHighlightColor`, and `cursorHighlightSize` in `exportSettings`!
8. macOS window traffic lights header (`drawMacWindowHeader`).
9. 1:1 Face Cam bubble (`webcamZoomMode`: default `'float'` stays pinned stationary unless switched to `'smart-dodge'` or `'zoom-with-screen'`).

### D. Duplicate Face Circle Prevention (`record.js` & `content.js`)
- Any floating DOM webcam overlay (`#cameraPreviewOverlay`, `#cursordemo-camera-overlay`) is **strictly hidden during active capture** so pixels are never baked into the screen stream while a separate synchronized `videoId + '_cam'` stream is recorded for non-destructive positioning/resizing inside the Editor.

### E. Lifecycle Modals & Crash Detection
1. **`#reviewModal` (1st+ Download)**: Opens automatically after export #1 and #2 (unless dismissed via "Don't ask again" or CTA click). Dynamically resolves `chrome.runtime.id` for the Chrome Web Store review URL on 4–5 stars, and encodes user text from `#reviewFeedbackInput` into a pre-filled GitHub issue URL on 1–3 stars.
2. **`#discordModal` (3rd Download + Automatic Crash Support)**:
   - **Milestone Mode (`mode: 'milestone'`)**: Automatically triggers on the **3rd successful export** (`exportCount === 3`, or first export `>= 3` if not previously shown/dismissed).
   - **Crash / Error Mode (`mode: 'crash'`)**: Automatically triggers on:
     - Interrupted export detected on reload (`cursordemo.exportInProgress`)
     - Interrupted recording detected on reload (`cursordemo.recordingInProgress`)
     - `doExport()` failure, IndexedDB retrieval failure, empty/corrupt blob, or `video.onerror` decode error
     - Screen/camera/mic capture failure (`NotAllowedError` permission block, `MediaRecorder` error)
     - Global uncaught `window.error` or `unhandledrejection` events
   - Includes a diagnostic summary box with Browser/OS/Resolution/Timestamp, a **Copy Error Details** button, and a direct CTA to [`https://discord.gg/gwATujg6yq`](https://discord.gg/gwATujg6yq).
3. **Global Modal Keyboard Isolation**: When `#discordModal`, `#reviewModal`, `#exportModal`, `#shortcutsModal`, or `#exportProgressOverlay` is open, `Escape` closes the active modal without deselecting timeline segments, and `Space`/`B`/`Z`/`S`/`Delete`/`I`/`O` are blocked from mutating background timeline state.

---

## 7. Known Gotchas & Future Roadmap Ideas

- **Published Chrome Web Store Extension ID**: Once published to the Chrome Web Store, replace `'YOUR_EXTENSION_ID'` fallback inside `getChromeStoreReviewUrl()` in [`editor.js`](editor.js) with the permanent 32-character Store ID (Note: `chrome.runtime.id` already resolves automatically for store installs).
- **Blob Download URL Retention**: Keep `setTimeout(() => URL.revokeObjectURL(url), 60000)` at 60 seconds in `doExport()` — shorter timeouts (`1000ms`) fail when Chrome's *"Ask where to save each file before downloading"* dialog is enabled.
- **Toast Helper Naming**: Always use `showToast(...)` in `editor.js` (line `5246`), never `showEditorToast(...)`.
- **Potential Future Enhancements**:
  - WebCodecs hardware MP4 muxer (`mp4-muxer`) for faster-than-realtime offline 4K exports.
  - Multi-track system + mic audio waveform lane & noise gate in Timeline.
  - Keyboard shortcut overlay / keystroke badge rendering toggle on canvas.
  - Animated custom cursor SVG replacement & click sound synthesis.
