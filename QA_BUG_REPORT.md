# QA Bug Report — CursorDemo Screen Recorder (v1.4.0)

> **Document Status:** QA Part 2 Analysis Completed  
> **Environment:** Chrome / Chromium MV3 (Desktop)  
> **Scope:** Capture, Telemetry, Editor, Video Processor, UI Components, Timeline  
> **Verification Status:** 100% Passed (`scripts/verify.js` & `scripts/build.js`)  
> **Author:** QA Engineering Team  

---

## 1. Executive Summary

| Total Items | Resolved | Open (QA Part 2) | Critical (P1) | High (P1/P2) | Medium (P2/P3) | Feature / Enhancement |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **14** | **12** | **2 Open** | **0 Open** (1 Resolved) | **0 Open** (3 Resolved) | **1 Open** (5 Resolved) | **1 Open Feature Gap** |

---

## 2. Bug Tracking Matrix

| Bug ID | Title | Module / File | Severity | Priority | Status | Trigger Condition | Actual Result |
|:---:|---|---|:---:|:---:|:---:|---|---|
| **BUG-001** | Export Fails with "Failed to fetch" Alert | [editor.js:7800](editor.js#L7800) | **Critical** | **P1** | `Resolved` | User clicks "Export" after blob URL is revoked or invalid | Fast-path in-memory blob + robust IndexedDB fallback recovery. |
| **BUG-002** | Duplicate Click Event Flooding | [content.js:673](content.js#L673) | **High** | **P1** | `Resolved` | User right-clicks, middle-clicks, or double-clicks during recording | Timestamp and coordinate deduplication eliminates duplicate capture. |
| **BUG-003** | Memory Leak: Unrevoked Video Blob on Export Failure | [video-processor.js:740](video-processor.js#L740) | **High** | **P1** | `Resolved` | Video export encounters an encoding or processing error | Cleaned up in catch block: video blob URL revoked and canvas cleared. |
| **BUG-004** | Missing 0-Byte Blob Validation Triggers Corrupt Downloads | [video-processor.js:688](video-processor.js#L688), [editor.js:8015](editor.js#L8015) | **High** | **P2** | `Resolved` | MediaRecorder emits empty chunks during processing | Validates `blob.size > 0` in processor and editor; halts corrupt downloads. |
| **BUG-005** | Dead DOM References for Millisecond Displays & Trim Overlays | [editor.js:294](editor.js#L294) | **Medium** | **P2** | `Resolved` | Video is loaded and playback/timeline progress runs | Domestic elements safely mapped to existing DOM tree (`#timeDisplay`, `#trimmedLeft/Right`). |
| **BUG-006** | Unhandled `localStorage.setItem` in Export Completion | [editor.js:8052](editor.js#L8052) | **Medium** | **P2** | `Resolved` | Export finishes when `localStorage` is full or restricted | Storage operations safely guarded in try/catch across export flow. |
| **BUG-007** | Missing CSS Class `.ripple-test-placeholder` in Sandbox | [editor.js:7214](editor.js#L7214), [editor.html:2185](editor.html#L2185) | **Medium** | **P3** | `Resolved` | User clicks inside the Ripple Effect test sandbox | Added `.ripple-test-placeholder` class to test span for smooth opacity transitions. |
| **BUG-008** | Export Parity Discrepancy for Webcam Border & Shadow | [editor.js:7659](editor.js#L7659), [video-processor.js:78](video-processor.js#L78) | **Low** | **P3** | `Resolved` | User exports video with customized webcam style | Export settings forward webcamBorderStyle & webcamShadow for 1:1 parity. |
| **BUG-009** | Potential `NaN` Coordinates on 0-Dimension Video | [zoom-analyzer.js:1269](zoom-analyzer.js#L1269) | **Low** | **P3** | `Resolved` | `getCursorAtTime()` called with 0 width or height | Zero-division guarded with `videoWidth > 0 ? x / videoWidth : 0.5`. |
| **BUG-010** | "Show Click Highlight / Ripples" Fails During Video Export | [editor.js:7923](editor.js#L7923), [video-processor.js:1473](video-processor.js#L1473), [video-processor.js:1520](video-processor.js#L1520) | **Medium** | **P2** | `Resolved` | Exporting recording without active tab telemetry, or when exportSettings drops clickEnabled | clickEnabled forwarded, _dedupedClicks reset per export, telemetry notice shown. |
| **BUG-011** | Spurious Chrome Extension Errors on Missing Camera/Mic Hardware Fallback | [record.js:1075](record.js#L1075), [record.js:1120](record.js#L1120) | **Low** | **P3** | `Resolved` | User without webcam/mic enables Face Cam or Microphone in recorder deck | Fast-paths non-existent hardware without redundant calls; logs benign device absence at info level. |
| **BUG-012** | Stationary Cursor Highlight Rendered When Telemetry Is Absent | [zoom-analyzer.js:1306](zoom-analyzer.js#L1306), [editor.js:639](editor.js#L639), [editor.js:2550](editor.js#L2550) | **Medium** | **P2** | `Resolved` | User records a restricted page (`chrome-extension://*`, `chrome://*`) and enables Cursor Highlight | Returns null instead of synthetic static focal points; shows clear telemetry notification in UI. |
| **BUG-013** | Pulse Style & Ripple Waves Lack Immediate Visual Feedback on Change | [editor.js:2436](editor.js#L2436), [editor.js:7938](editor.js#L7938) | **Medium** | **P2** | `Open` | User selects different Pulse Style or Ripple Waves from dropdowns while video is paused | No visible preview on video canvas or sandbox, leading user to believe dropdowns are broken. |
| **GAP-001** | Middle-Cut / Video Splitting & Non-Contiguous Trimming Not Supported | [editor.js:3812](editor.js#L3812), [editor.js:6030](editor.js#L6030), [video-processor.js:219](video-processor.js#L219) | **Feature Gap** | **P2** | `Open` | User attempts to cut/delete an unwanted section from the middle of the video | Timeline only supports 2-point start/end trim; `Split (S)` only splits Zoom Segments. |

---

## 3. Detailed Bug Specifications

---

### BUG-001: Export Fails with "Failed to fetch" Alert

* **Module / File:** `editor.js` (Line 7800)
* **Severity:** **Critical** | **Priority:** **P1** | **Status:** `Resolved`
* **Trigger Condition:** User opens the Export Modal and clicks the green "Export" button.
* **Steps to Reproduce:**
  1. Record a screen video and open `editor.html`.
  2. Click the "Export Video" button to open the modal.
  3. Select Resolution: `1080p`, Format: `MP4` or `WebM`, Quality: `High`.
  4. Click "Export".
* **Actual Result:**
  * Native browser alert displays: `The extension CursorDemo says: Export failed: Failed to fetch`.
  * The export process halts and the user cannot download the video.
* **Expected Result:**
  * The video data is reliably loaded from memory or IndexedDB, encoded, and downloaded without network/fetch failures.
* **Root Cause:**
  * Line 7800 executes: `const blob = currentVideoBlob || await fetch(video.src).then(r => r.blob());`
  * If `currentVideoBlob` is null (e.g. session recovery, refreshed tab) and `video.src` is an expired/revoked `blob:` URL or an oversized base64 data URL (>30MB), `fetch(video.src)` throws `TypeError: Failed to fetch`.
  * No fallback to IndexedDB (`retrieveVideoFromIndexedDB`) exists inside `doExport()`.
* **Fix Applied:**
  * Added 3-tier high-performance recovery in `editor.js`: (1) Fast-paths `currentVideoBlob` in memory (0ms overhead); (2) Catches `fetch(video.src)` failures gracefully; (3) Automatically recovers the original video blob directly from IndexedDB via `currentVideoId` / query param fallback. Safe user-facing error message replaces cryptic alert.

---

### BUG-002: Duplicate Click Event Flooding

* **Module / File:** `content.js` (Lines 673-678, 808-830)
* **Severity:** **High** | **Priority:** **P1** | **Status:** `Resolved`
* **Trigger Condition:** User performs a right-click, middle-click, or double-click on any webpage while recording.
* **Steps to Reproduce:**
  1. Start recording a browser tab.
  2. Right-click anywhere to open a context menu, or double-click any word/button.
  3. Stop recording and inspect the recorded clicks in Editor timeline.
* **Actual Result:**
  * Two identical click events are recorded at the exact same millisecond.
  * Timeline displays doubled ripple animations and triggers duplicate zoom calculations.
* **Expected Result:**
  * Exactly one click event is recorded per user interaction.
* **Root Cause:**
  * In `startTracking()`, event listeners for `contextmenu`, `auxclick`, and `dblclick` are added to both `window` and `document` with `{ capture: true }`.
  * Unlike `handleClick` and `handleMouseDown`, these three event handlers lacked timestamp and coordinate deduplication checks.
* **Fix Applied:**
  * Implemented `lastClickTs` / `lastClickX` / `lastClickY` deduplication in `handleContextMenu` and `handleAuxClick` (20ms threshold), and dedicated `lastDblClickTs` / `lastDblClickX` / `lastDblClickY` deduplication in `handleDoubleClick` (40ms threshold).

---

### BUG-003: Memory Leak — Unrevoked Video Blob on Export Failure

* **Module / File:** `video-processor.js` (Lines 154, 740-750)
* **Severity:** **High** | **Priority:** **P1** | **Status:** `Resolved`
* **Trigger Condition:** Any failure, exception, or timeout occurs during the video export process.
* **Steps to Reproduce:**
  1. Trigger an export error (e.g. MediaRecorder timeout, unsupported codec, or cancelled export).
  2. Retry exporting 3-5 times.
  3. Monitor Chrome Task Manager memory for the editor tab.
* **Actual Result:**
  * Several hundred megabytes of RAM remain allocated per attempt; the browser tab eventually crashes with Out of Memory.
* **Expected Result:**
  * All temporary video objects and blob URLs are explicitly revoked and garbage-collected upon failure.
* **Root Cause:**
  * Line 154 creates `this.video.src = URL.createObjectURL(videoBlob);`.
  * While `URL.revokeObjectURL(this.video.src)` is called on success (line 705), it was omitted in the `catch (error)` block (lines 740-750). Setting `this.video.src = ''` does not revoke the allocated blob URL.
* **Fix Applied:**
  * Added `if (this.video && this.video.src && this.video.src.startsWith('blob:')) { URL.revokeObjectURL(this.video.src); }` inside the `catch` block of `processVideo()`, plus canvas clearing to immediately free GPU/V8 memory.

---

### BUG-004: Missing 0-Byte Blob Validation Triggers Corrupt Downloads

* **Module / File:** `video-processor.js` (Line 688), `editor.js` (Lines 8015-8045)
* **Severity:** **High** | **Priority:** **P2** | **Status:** `Resolved`
* **Trigger Condition:** Encoding produces an empty chunk list due to recorder failure or rapid cancellation.
* **Steps to Reproduce:**
  1. Simulate an export where MediaRecorder fails to record frames.
  2. Wait for `processVideo()` to resolve.
* **Actual Result:**
  * The application downloads a 0-byte unplayable `.webm` or `.mp4` file and shows a post-export rating modal.
* **Expected Result:**
  * The application detects the empty file, rejects the operation, and displays an error modal with diagnostics.
* **Root Cause:**
  * `video-processor.js` constructs `new Blob(this.chunks, ...)` without verifying `blob.size > 0`, resolving an empty blob.
  * `editor.js` does not validate `processed.size > 0` before triggering the browser download link.
* **Fix Applied:**
  * Added dual-tier validation: `video-processor.js` validates `if (!blob || blob.size === 0) throw new Error(...)` before duration patching, and `editor.js` validates `if (!processed || !processed.size || processed.size === 0) throw new Error(...)` before downloading.

---

### BUG-005: Dead DOM References for Millisecond Displays & Trim Overlays

* **Module / File:** `editor.js` (Lines 294-306, 5682-5689) vs `editor.html`
* **Severity:** **Medium** | **Priority:** **P2** | **Status:** `Resolved`
* **Trigger Condition:** Normal editor initialization and timeline playback.
* **Steps to Reproduce:**
  1. Open a recorded video in `editor.html`.
  2. Inspect the DOM elements while playing the video.
* **Actual Result:**
  * Elements `currentTime`, `currentTimeMs`, `totalTime`, `totalTimeMs`, `timelinePlayhead`, `trimOverlayStart`, `trimOverlayEnd`, and `leftTimeBadge` evaluate to `null`.
  * Millisecond precision updates are silently skipped.
* **Expected Result:**
  * DOM selectors match elements present in `editor.html`.
* **Root Cause:**
  * `editor.js` queried legacy element IDs that were removed or consolidated in `editor.html` (which now uses `#timeDisplay` and `#trimmedLeft`/`#trimmedRight`).
* **Fix Applied:**
  * Updated element initialization to map `trimOverlayStart` to `#trimmedLeft`, `trimOverlayEnd` to `#trimmedRight`, and `currentTimeEl` to `#timeDisplay`, ensuring unified, active DOM references without dead null pointers.

---

### BUG-006: Unhandled `localStorage.setItem` in Export Completion

* **Module / File:** `editor.js` (Lines 8052-8055)
* **Severity:** **Medium** | **Priority:** **P2** | **Status:** `Resolved`
* **Trigger Condition:** Browser `localStorage` quota (5MB) is exhausted or disabled in private browsing.
* **Steps to Reproduce:**
  1. Fill `localStorage` up to capacity or enable strict browser storage partitioning.
  2. Export a video until 100% completion.
* **Actual Result:**
  * `localStorage.setItem` throws an uncaught `DOMException (QuotaExceededError)`, interrupting the export completion UI.
* **Expected Result:**
  * Storage operations fail gracefully without interrupting the user workflow.
* **Root Cause:**
  * Calls to `localStorage.setItem('cursordemo.reviewPromptShown', 'true')` and `localStorage.setItem('cursordemo.discordPromptShown', 'true')` were not guarded by `try...catch`.
* **Fix Applied:**
  * Wrapped all `localStorage` access across post-export rating modals, discord milestone prompts, and export counters in safe `try...catch` blocks to gracefully ignore quota and security errors.

---

### BUG-007: Missing CSS Class `.ripple-test-placeholder` in Ripple Sandbox

* **Module / File:** `editor.js` (Line 7214) vs `editor.html` (Line 2185)
* **Severity:** **Medium** | **Priority:** **P3** | **Status:** `Resolved`
* **Trigger Condition:** User clicks inside the Ripple Effect test area in the sidebar settings.
* **Steps to Reproduce:**
  1. Navigate to the Effects panel in `editor.html`.
  2. Click or right-click inside the `#rippleTestArea` test box.
* **Actual Result:**
  * The text "Click anywhere here to preview radiating ripple" stays at 100% opacity, cluttering the preview waves.
* **Expected Result:**
  * The placeholder text dims to 25% opacity while ripples animate.
* **Root Cause:**
  * `editor.js` searched for `testArea.querySelector('.ripple-test-placeholder')`, but the `<span>` in `editor.html` had no class attribute.
* **Fix Applied:**
  * Added `class="ripple-test-placeholder"` with smooth CSS opacity transition to the placeholder `<span>` in `editor.html`.

---

### BUG-008: Export Parity Discrepancy for Webcam Border & Shadow

* **Module / File:** `editor.js` (Lines 7659-7706) vs `video-processor.js` (Lines 78-79)
* **Severity:** **Low** | **Priority:** **P3** | **Status:** `Resolved`
* **Trigger Condition:** User configures custom webcam border style or shadow and exports the video.
* **Steps to Reproduce:**
  1. Change webcam style settings in the Editor inspector.
  2. Export the video and inspect the rendered webcam bubble against the live canvas preview.
* **Actual Result:**
  * Exported video uses hardcoded defaults (`glow`, `shadow: true`), causing a slight rendering divergence.
* **Expected Result:**
  * Exported frames match the preview canvas with 1:1 parity.
* **Root Cause:**
  * `exportSettings` in `editor.js` did not pass `webcamBorderStyle` and `webcamShadow` to `VideoProcessor`.
* **Fix Applied:**
  * Forwarded `webcamBorderStyle: settings.webcamBorderStyle || 'glow'` and `webcamShadow: settings.webcamShadow !== false` inside `exportSettings` in `editor.js`.

---

### BUG-009: Potential `NaN` Coordinates on 0-Dimension Video

* **Module / File:** `zoom-analyzer.js` (Lines 1269-1270)
* **Severity:** **Low** | **Priority:** **P3** | **Status:** `Resolved`
* **Trigger Condition:** `getCursorAtTime()` is called before video dimensions are parsed (`videoWidth === 0`).
* **Steps to Reproduce:**
  1. Invoke `getCursorAtTime()` with 0 width or height arguments.
* **Actual Result:**
  * Calculates `x / 0` and returns `normX: NaN`, breaking dependent Canvas 2D matrix transformations.
* **Expected Result:**
  * Safely defaults to `0.5` normalized coordinates.
* **Root Cause:**
  * Division was performed without verifying `videoWidth > 0` and `videoHeight > 0`.
* **Fix Applied:**
  * Guarded all coordinate normalization divisions across Catmull-Rom splines and point resolvers with `videoWidth > 0 ? x / videoWidth : 0.5` and `videoHeight > 0 ? y / videoHeight : 0.5`.

---

### BUG-010: "Show Click Highlight / Ripples" Fails During Video Export

* **Module / File:** `editor.js` (Line 7923), `video-processor.js` (Lines 1473, 1520)
* **Severity:** **Medium** | **Priority:** **P2** | **Status:** `Resolved`
* **Trigger Condition:** User enables the "Show Click Ripples" / "Show click highlight" toggle and exports a video (especially external screen captures, imported videos, or after settings modifications).
* **Steps to Reproduce:**
  1. Record an entire screen / external desktop window, an unsupported tab (`chrome://*`), or import a video file directly via "Load Video".
  2. In the editor sidebar under "Click & Cursor FX" (or "CLICK ANIMATION"), verify the "Show Click Ripples" / "Show click highlight" toggle is switched ON (green).
  3. Click "Export Video" and proceed with export (1080p, MP4 / WebM).
  4. Play the exported video and inspect timestamps where mouse clicks occurred.
* **Actual Result:**
  * The exported video renders no click highlights, pulse waves, or ripple animations.
  * The user is given no warning or indication in the UI explaining why click effects are absent.
* **Expected Result:**
  * If click telemetry is present, exported video renders click pulses with 1:1 parity to the editor preview.
  * If click telemetry is absent, the toggle should be disabled with an informative message explaining that click effects require tab-level recording.
* **Root Cause:**
  1. **Dual-Path Parity Violation in Export Settings:** In `editor.js` (Line 7923), `exportSettings` passed `clickStyle`, `clickWaves`, `clickColor`, and `clickForce`, but omitted `clickEnabled: settings.clickEnabled`. In `video-processor.js` (Line 1520), `if (this.settings.clickEnabled === false || ...)` guards rendering.
  2. **Silent Failure on Missing Telemetry:** Recordings outside injected browser tabs (or files loaded via `loadVideoFileDirectly`) populate `cursorData = []`. `getDeduplicatedClicks()` returns an empty array, causing `drawClickEffects()` to exit silently while the UI toggle remains deceptively checked.
  3. **Stale Cache Retention:** `VideoProcessor.prototype.getDeduplicatedClicks` cached results in `this._dedupedClicks` across invocations without clearing them when `processVideo()` started.
  4. **Terminology Ambiguity:** In legacy UI strings, the ripple effect was labeled "Show click highlight", creating confusion for users who expected a persistent cursor halo spotlight (`cursorHighlightEnabled`, which defaults to OFF) rather than transient click pulse ripples.
* **Fix Applied:**
  1. Forwarded `clickEnabled: settings.clickEnabled !== false` in `exportSettings` inside `editor.js`.
  2. Reset `this._dedupedClicks = null; this._dedupedRef = null;` at the beginning of `processVideo()` in `video-processor.js` to eliminate stale click cache.
  3. Added informative tooltip warning on `#clickEnabled` when video recording has 0 click telemetry points.

---

### BUG-011: Spurious Chrome Extension Errors on Missing Camera/Mic Hardware Fallback

* **Module / File:** `record.js` (Lines 1074-1080, 1120, 1190-1199, 1234)
* **Severity:** **Low** | **Priority:** **P3** | **Status:** `Resolved`
* **Trigger Condition:** User toggles "Screen & Face Cam (PiP)" or "Enable Camera" / "Enable Microphone" on a system without a connected webcam or microphone (or when permission is denied).
* **Steps to Reproduce:**
  1. On a machine without an attached webcam, open `record.html`.
  2. Click the "Screen & Face Cam (PiP)" tab or "Enable Camera".
  3. Open `chrome://extensions` and inspect the extension card.
* **Actual Result:**
  * Chrome displays a red "Errors" badge with 2 warnings:
    1. `[Record] Ideal camera constraints unavailable, attempting generic fallback: NotFoundError`
    2. `[Record] Camera initialization error: NotFoundError Requested device not found`
* **Expected Result:**
  * Expected hardware states (e.g. no webcam plugged in) should be handled cleanly with informative UI messaging without firing redundant secondary getUserMedia requests or logging warnings that trigger Chrome's extension error badge.
* **Root Cause:**
  1. **Redundant Secondary Request:** When `getUserMedia` fails with `NotFoundError` (no hardware attached) or `NotAllowedError` (user denied permission), the constraint catch block logged `console.warn` and attempted a second generic request (`video: true`) which was guaranteed to fail.
  2. **Chrome MV3 Error Badge Pollution:** Chrome treats all `console.warn` calls originating from extension pages as extension errors in `chrome://extensions`. Normal hardware absence is a benign user state, not an unhandled extension script exception.
* **Fix Applied:**
  1. Fast-path rethrow of `NotFoundError`, `DevicesNotFoundError`, `NotAllowedError`, and `PermissionDeniedError` in constraint catch block in `record.js`, avoiding redundant hardware queries.
  2. Log benign hardware absence / user permission rejections with `console.info` / `debugLog` instead of `console.warn`.

---

### BUG-012: Stationary Cursor Highlight Rendered When Telemetry Is Absent

* **Module / File:** `zoom-analyzer.js` (Line 1306), `editor.js` (Lines 639, 2550)
* **Severity:** **Medium** | **Priority:** **P2** | **Status:** `Resolved`
* **Trigger Condition:** User enables "Cursor highlight" on a recording with 0 cursor movement events (e.g. captured on internal `chrome-extension://*` or `chrome://*` pages where content script injection is prohibited by Chrome security, or imported external videos).
* **Steps to Reproduce:**
  1. Record an internal Chrome page (e.g. `chrome-extension://...` or `chrome://extensions`).
  2. In `editor.html`, enable "Cursor highlight" (green toggle).
  3. Play the video.
* **Actual Result:**
  * A stationary golden halo remained frozen at an auto-paced zoom segment focal point (`normX: 0.38, normY: 0.38`), misleading the user into thinking playback tracking had frozen or failed.
  * No warning was displayed indicating why cursor tracking was unavailable.
* **Expected Result:**
  * If no cursor telemetry exists (`cursorData = []`), no fake stationary halo should be drawn.
  * The UI should display an informative warning tooltip and toast explaining that cursor tracking requires recording standard web pages (`https://`).
* **Root Cause:**
  * `ZoomAnalyzer.prototype.resolveCursorHighlightPos` fell back to synthetic zoom segment coordinates or viewport center when `cursorData` was empty instead of returning `null`.
* **Fix Applied:**
  1. Guarded `resolveCursorHighlightPos` in `zoom-analyzer.js` to immediately return `null` when `cursorData` is empty or missing.
  2. Added informative tooltip on `#cursorHighlightEnabled` and toast notification when enabled without cursor telemetry.

---

### BUG-013: Pulse Style & Ripple Waves Lack Immediate Visual Feedback on Change

* **Module / File:** `editor.js` (Lines 2436-2451, 7938-8032), `editor.html` (Lines 4284-4342)
* **Severity:** **Medium** | **Priority:** **P2** | **Status:** `Open`
* **Trigger Condition:** User opens "Cursor & Interaction" sidebar and changes "Pulse Style" (e.g. from Radiating Ripple to Expanding Shockwave) or "Ripple Waves" (e.g. from 2 Waves to 3 Waves) while video is paused.
* **Steps to Reproduce:**
  1. Record a video and open the Studio Editor.
  2. Click the Cursor & Interaction icon on the right dock rail to open its inspector card.
  3. Change the dropdown "Pulse Style" from *Radiating Ripple* to *Expanding Shockwave*.
  4. Change the dropdown "Ripple Waves" from *2 Waves* to *3 Waves*.
* **Actual Result:**
  * Nothing changes on the main video canvas or in the sidebar. The UI gives zero visual confirmation that the option was applied.
  * Users commonly mistake the persistent yellow halo (which is Cursor Highlight) for the pulse effect and assume the dropdowns are non-functional / broken.
* **Expected Result:**
  * Changing either dropdown should immediately trigger an animated preview of the selected wave style (either right inside the "Live Pulse Test" sandbox card, and/or momentarily at the cursor position on the preview canvas) so the user instantly sees the visual difference between Shockwave, Radiating Ripple, and 1/2/3 waves.
* **Root Cause:**
  1. **Playback Window Restriction:** On the main video preview, `drawClickEffectsOnCanvas()` strictly evaluates `currentTime` against recorded clicks (`[click.timestamp - 80ms, click.timestamp + 520ms]`). When paused at `00:00` where no click occurred, 0 clicks exist to draw, making `requestPreviewRedraw()` a visual no-op for click ripples.
  2. **Passive Sandbox:** The `#rippleTestArea` sandbox only listens to manual click events and does not automatically fire a preview pulse upon dropdown option changes.
  3. **Canvas Dimension / Lifecycle Desync:** `setupRippleSandbox()` runs `resizeCanvas()` once on DOM load when `#cursorSection` is hidden (`display: none`). Its bounding rect is `0x0` (falling back to `400x110`), and `resizeCanvas()` is never re-run when switching to the Cursor tab, causing canvas resolution and DPR mismatch.
* **Proposed Remediation:**
  1. Automatically trigger a demonstration ripple in the "Live Pulse Test" sandbox whenever `clickStyle`, `clickWaves`, `clickColor`, or `clickForce` changes.
  2. Re-trigger `resizeCanvas()` whenever the Cursor drawer panel is opened or toggled.
  3. Optionally trigger a momentary preview ripple at the cursor's current canvas location on dropdown change.

---

### GAP-001: Middle-Cut / Video Splitting & Non-Contiguous Trimming Not Supported

* **Module / File:** `editor.js` (Lines 3774-3815, 6030-6117), `video-processor.js` (Lines 219-225, 660, 787-1110)
* **Severity:** **Feature Gap / Architectural Limitation** | **Priority:** **P2** | **Status:** `Open`
* **Trigger Condition:** User attempts to cut, slice, or delete an unwanted section from the middle of the recorded video on the timeline.
* **Steps to Reproduce:**
  1. Open a recording with mistakes or pauses in the middle of the timeline.
  2. Move playhead to the middle and click the timeline toolbar `Split (S)` button.
* **Actual Result:**
  * The `Split (S)` button does not cut the video; it only splits or creates a **Zoom Segment** (`zoomSegments`) — the blue zoom camera pill.
  * The yellow scissor handles on the timeline only drag inward from the very beginning (`trimStart`) and very end (`trimEnd`).
  * There is no tool or UI to mark an IN/OUT slice in the middle of the video, delete it, or export a stitched video excluding the cut middle section.
* **Expected Result:**
  * Capability to perform a middle-cut / razor slice (e.g. cut section from 0:15 to 0:30, ripple delete, and seamlessly join 0:00-0:15 with 0:30-end in both preview playback and exported MP4/WebM).
* **Root Cause:**
  1. **Single Linear Range Data Model:** `trimHandles` is modeled strictly as `{ start: number, end: number }` (single continuous range from `start` to `end`).
  2. **Linear Rendering Pipeline in `video-processor.js`:** Export iterates linearly through `currentTime` from `startTime` to `endTime`: `await this.processFrames(zoomSegments, videoWidth, videoHeight, startTime, endTime, targetFps, onProgress)`. It does not support non-contiguous frame intervals or multiple video segments.
  3. **Misleading UI affordance:** The toolbar button `Split (S)` has a split/scissor icon and shortcut that video editors expect to slice video tracks, but its implementation (`splitAtPlayhead()`) only partitions zoom telemetry pills.
* **Proposed Architecture for Future Implementation:**
  1. **Multi-Segment Model:** Transition `trimHandles` to a list of active timeline intervals: `activeSegments: [{ start: number, end: number }, ...]`.
  2. **Timeline Slice UI:** Allow pressing `S` or a dedicated Razor tool to create a cut boundary on the video track, select a middle slice, and press `Delete` to remove it (ripple-join).
  3. **Non-Contiguous Playback & Export:** Update playback loop in `editor.js` to jump across deleted gaps, and update `video-processor.js` to process frames across each active segment into a continuous encoded stream.
