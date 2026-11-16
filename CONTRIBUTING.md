# Contributing & Editorial Review Policy for CursorDemo

Thank you for your interest in contributing to **CursorDemo: Free Screen Recorder with Automatic Zoom & Product Demo Editor**!

---

## 1. Guiding Engineering Principles

1. **100% Local & Zero Telemetry:** Every feature must run client-side inside the browser using standard Web APIs (`MediaRecorder`, `IndexedDB`, `Canvas 2D`, `WebAudio`). Never introduce external tracking, analytics, or remote script loading.
2. **Zero Build-Step Simplicity:** CursorDemo runs as clean, dependency-free Manifest V3 JavaScript/HTML/CSS that any developer can audit and load unpacked in seconds.
3. **Accessibility & SEO Excellence:** Both `record.html` and `editor.html` must maintain a **100/100** score on our accessibility and semantic HTML checks (every form control must have an explicit `aria-label` or `<label>`, single `<h1>`, `<main>` landmark, and `lang="en"`).
4. **56-Locale Chrome Web Store Parity:** Whenever `extName`, `extDescription`, or `extTitle` changes, all 56 locale files in `_locales/<locale>/messages.json` must remain valid JSON with `extName <= 45` characters and `extDescription <= 132` characters.

---

## 2. Local Development Setup

```bash
git clone https://github.com/cursordemo/cursordemo-screen-recorder.git cursordemo
cd cursordemo
```

1. Open `chrome://extensions/` in Google Chrome or any Chromium browser.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `cursordemo` repository root folder.
4. After editing any `.js` or `.html` file, click the **Reload** icon on the CursorDemo extension card in `chrome://extensions/`.

---

## 3. Pre-PR Verification Checklist

Before submitting a Pull Request, verify the following:

- **JavaScript Syntax:** Run `node --check` on `background.js`, `content.js`, `record.js`, `editor.js`, `video-processor.js`, and `zoom-analyzer.js`.
- **Automatic Zoom & Camera Physics:** Verify that clicking inside a recorded tab generates smooth Perlin 5th-order polynomial zoom transitions without jitter (`36px` deadzone intact) and that clicking `#cursordemo-camera-overlay` does not trigger false zoom blocks.
- **Export Pipeline:** Test both **MP4 (H.264)** and **WebM (VP9)** exports at 1080p and 4K in `editor.html`.

---

## 4. Open-Source Editorial & Benchmark Review Policy

All technical documentation, performance claims, and competitive comparisons in `README.md` and `docs/` (`index.html`, `llms.txt`, `llms-full.txt`, `pricing.md`) are reviewed by maintainers against reproducible local browser benchmarks and verifiable public pricing/feature documentation. If you spot an outdated comparison entry, please open an issue or pull request with a citation to the vendor's current documentation.
