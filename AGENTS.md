# AGENTS.md — Instructions for AI Coding Agents

Read [`BRAIN.md`](BRAIN.md) and [`DEVELOPER_HANDOVER.md`](DEVELOPER_HANDOVER.md) before modifying code in this repository.

## Project Summary
- **Extension:** CursorDemo (Chrome MV3 Screen Recorder + 4K Dark Pro Studio Video Editor, zero build step / pure Vanilla JS).
- **Repo:** `https://github.com/getwebgrowth/cursordemo`
- **Community / Support Link:** `https://discord.gg/gwATujg6yq` (never replace with a placeholder).

## Mandatory Rules for Every Edit
1. **Maintain Dual-Path Parity:** Whenever rendering logic changes in `editor.js` (`renderPreviewFrame`, `drawBlurRegionsOnPreview`, `drawClickEffectsOnCanvas`, `drawCursorDotOnPreview`, `drawWebcamOnPreview`), update the matching method in `video-processor.js` (`processVideo`, `drawBlurRegions`, `drawClickEffects`, `drawCursorHighlight`, `drawWebcam`) AND forward the corresponding settings inside `doExport()` (`exportSettings`).
2. **Preserve Keyboard & Modal Isolation:** Never let single-key shortcuts (`Space`, `B`, `Z`, `S`, `Delete`, `I`, `O`) fire when any modal/overlay is open, and never modify timeline selection on `Escape` when closing a modal.
3. **Preserve macOS / Cross-Browser Guards:** Keep `leftChromeWidth` sidebar offset math (`content.js`), `null` initial pointer coordinates (`content.js`), WebM + MP4 header detection (`editor.js`), and the 4-stage `getDisplayMedia()` fallback (`record.js`).
4. **Always Verify After Editing:**
   ```bash
   for f in background.js content.js record.js editor.js video-processor.js zoom-analyzer.js; do
     node --check "$f" || exit 1
   done
   ```
5. **Sync Canonical Release Directory (when working in local Downloads workspace):**
   - Keep `/Users/ishara/Downloads/cursorfly-screen-recorder-main 2` and `/Users/ishara/Downloads/cursordemo` identical (`diff -rq` = 0 differences, excluding `.git`, `*.zip`, `.DS_Store`).
   - Rebuild `/Users/ishara/Downloads/cursordemo.zip` without `.git` or `.DS_Store` before handoff.
