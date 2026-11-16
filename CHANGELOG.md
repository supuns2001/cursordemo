# Changelog

All notable changes to **CursorDemo: Screen Recorder with Automatic Zoom & Demo Editor** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.0] - 2026-11-10

### Added
- **Full Rebrand to CursorDemo:** Unified product identity (`CursorDemo: Screen Recorder with Auto Zoom`), clean `CursorDemoVideoStorage` IndexedDB namespace, and `cursordemo-*` runtime messaging ports and DOM overlay selectors.
- **Progressive Edge & Corner Focal Boost + Continuous Cursor Follow:** Upgraded `zoom-analyzer.js` and `content.js` with progressive edge & corner focal boost (`0.72 -> 1.0`), 60Hz hover synthesis during stationary moments, and left-sidebar coordinate calibration (`outerWidth - innerWidth`) for Opera, Vivaldi, Brave, Edge, and Yandex vertical tabs.
- **Free-Form 1:1 Studio Webcam Overlay & Smart Dodge:** Upgraded webcam overlay in `record.js`, `editor.js`, and `video-processor.js` with free-form `x, y` drag and corner resize, stationary `Float / Free` default during auto-zoom, `Smart Dodge` cursor avoidance, and automatic duplicate DOM Face Cam prevention during same-tab recording.
- **Zoom-Synced & Screen-Locked Manual Blur Studio:** Added interactive canvas blur region drawing, timeline blur track (`B`), and three redaction modes (`Frosted Glass`, `Pixelate / Mosaic`, `Redacted Blackout`) in `editor.html`, `editor.js`, and `video-processor.js`.
- **Universal Chromium & Cross-OS Compatibility:** Added 3-tier progressive `getDisplayMedia` fallback, flexible 16kHz–48kHz microphone capture, progressive MP4/WebM codec fallback, and browser/OS-adaptive instructions across Chrome, Brave, Edge, Opera, Yandex, Vivaldi, and Arc on Windows, macOS, Linux, and ChromeOS.
- **56-Locale Chrome Web Store Internationalization:** Added `_locales/<locale>/messages.json` across 56 Chrome Web Store locales (`am`, `ar`, `bg`, `bn`, `ca`, `cs`, `da`, `de`, `el`, `en`, `en_AU`, `en_GB`, `en_US`, `es`, `es_419`, `et`, `fa`, `fi`, `fil`, `fr`, `gu`, `he`, `hi`, `hr`, `hu`, `id`, `it`, `ja`, `kn`, `ko`, `lt`, `lv`, `ml`, `mr`, `ms`, `nl`, `no`, `pa`, `pl`, `pt_BR`, `pt_PT`, `ro`, `ru`, `sk`, `sl`, `sr`, `sv`, `sw`, `ta`, `te`, `th`, `tr`, `uk`, `vi`, `zh_CN`, `zh_TW`) with 100% compliance (`extName <= 45` chars, `extDescription <= 132` chars).
- **100/100 Editor Accessibility & Semantic HTML:** Added `<main>`, `<h1>`, and explicit `aria-label` attributes to all interactive form controls in `editor.html`.
- **SEO, AEO & GEO Discovery Bundle (`docs/`):** Added `docs/index.html` (with `SoftwareApplication` and `WebPage` `SpeakableSpecification` JSON-LD), `docs/llms.txt`, `docs/llms-full.txt`, `docs/pricing.md`, `docs/robots.txt`, and `docs/sitemap.xml`.
- **Post-Download Success & Review Popup Modal:** Added a Dark Pro Studio post-download celebration & interactive 5-star review popup modal (`#reviewModal`, `cursordemo.exportCount`, `cursordemo.reviewPromptShown`, `cursordemo.reviewPromptDismissed`) that triggers automatically after the user's first completed video download (`exportCount >= 1`) in `editor.html` and `editor.js`.

### Fixed
- Fixed `manifest.json` description length (`<= 132` chars across all 56 locales) to prevent Chrome Web Store truncation.
- Synchronized `chrome.action.setTitle` in `background.js` with `manifest.json` `__MSG_extActionTitle__` tooltip.

---

## [1.0.1] - 2026-06-15

### Added
- Improved Perlin 5th-order polynomial smootherstep camera zoom transitions and 36-pixel camera deadzone stabilization in `zoom-analyzer.js`.
- Added hardware-accelerated H.264 MP4 (`video/mp4;codecs=avc1`) export support alongside VP9 WebM in `editor.js`.

---

## [1.0.0] - 2026-03-01

### Added
- Initial release of the Manifest V3 Chrome extension screen recorder with 60Hz DOM cursor tracking, automatic zoom synthesis, Catmull-Rom cursor spline smoothing, interactive privacy blur, circular webcam overlay, and non-linear video editor.
