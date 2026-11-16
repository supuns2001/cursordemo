# CursorDemo: Free Screen Recorder with Automatic Zoom & Product Demo Editor

![CursorDemo Icon](icons/icon128.png)

**CursorDemo** is a 100% free, open-source **screen recorder with automatic zoom**, smooth cursor tracking, interactive privacy blur, and a non-linear 4K 60fps MP4 product demo editor built as a Manifest V3 Chrome extension. Designed as a cross-platform, zero-watermark **free Screen Studio alternative** for macOS, Windows, Linux, and ChromeOS, CursorDemo automatically follows your mouse cursor, synthesizes click-triggered camera zoom keyframes, and renders studio-framed SaaS product demos locally in your browser with zero cloud uploads.

- **Website & Live Documentation:** [https://cursordemo.com](https://cursordemo.com)
- **Chrome Web Store:** [Install CursorDemo Extension](https://chromewebstore.google.com/detail/cursordemo-screen-recorder/YOUR_EXTENSION_ID)
- **AI & LLM Discovery Bundle:** [`docs/llms.txt`](docs/llms.txt) • [`docs/llms-full.txt`](docs/llms-full.txt) • [`docs/pricing.md`](docs/pricing.md)
- **License:** [MIT License](LICENSE) (`$0` forever free for personal and commercial use)

## Why Choose CursorDemo?

Recording a polished software walkthrough or SaaS onboarding video usually forces a tradeoff between expensive macOS-only desktop apps ($89–$229/seat) and cloud screen recorders that compress video, add watermarks, or upload sensitive customer data to third-party servers.

**CursorDemo** brings studio-grade motion design directly into Chromium browsers:

1. **Dual-Mode Automatic & Manual Zoom (`Follow Cursor` + `Fixed Spot`):** Analyzes 60Hz DOM cursor coordinates, mouse clicks, and dwell velocity to generate smooth, editable zoom segments (`1.25x` to `2.80x` presets + custom multiplier), or locks onto any UI spot using a draggable purple focal target dot.
2. **Mathematical Cursor & Camera Smoothing:** Eliminates hand jitter using **Catmull-Rom spline interpolation**, **Ken Perlin’s 5th-order polynomial smootherstep curve**, **3 camera feel profiles** (`Smooth`, `Focused`, `Tight`), and a **36-pixel camera deadzone**.
3. **Zoom-Synced & Screen-Locked Privacy Blur:** Draw interactive blur boxes directly on the video canvas with **Frosted Glass Gaussian Blur**, **Pixelate / Mosaic**, or **Redacted Blackout** styles that either track zoomed UI elements dynamically or stay pinned to fixed screen coordinates.
4. **Draggable 1:1 Webcam Overlay with `Smart Dodge`:** Presenters stay visible inside a circular or rounded-square Picture-in-Picture camera bubble that is excluded from zoom-click triggers and can automatically dodge the approaching cursor.
5. **100% Local 4K 60fps MP4 & WebM Export:** Powered by client-side `IndexedDB` (`CursorDemoVideoStorage`), HTML5 Canvas 2D, and hardware-accelerated `MediaRecorder` encoding (`video/mp4;codecs=avc1` with automatic VP9/VP8 WebM fallback across all Chromium builds).
6. **Universal Chromium & Cross-OS Compatibility:** Tested and optimized for **Google Chrome, Brave, Microsoft Edge, Opera / Opera GX, Yandex Browser, Vivaldi, Arc, and Chromium** across **Windows 10/11, macOS (Intel & Apple Silicon), Linux (X11/Wayland), and ChromeOS**—including automatic left-sidebar coordinate calibration (`outerWidth - innerWidth`) for Opera, Vivaldi, Brave, Edge, and Yandex vertical tabs.
7. **Global 56-Locale Support:** Natively localized across 56 Chrome Web Store languages inside `_locales/` (every `extName <= 45` chars and `extDescription <= 132` chars).

## Key Features & Capabilities

### Studio Recording Engine (`record.html` & `record.js`)
- **Flexible Capture Targets:** Record a single browser tab, an application window, or an entire desktop monitor at up to 4K 60fps with a 3-tier progressive `getDisplayMedia` fallback for older or custom Chromium builds.
- **Multi-Source Audio Mixing:** Capture crystal-clear microphone narration (including 16kHz–48kHz Bluetooth headsets and studio USB mics), system/tab audio, or both simultaneously via WebAudio mixing.
- **60Hz Cursor & Click Telemetry:** Samples normalized pointer coordinates, click states, and scroll deltas every 16ms across standard web pages.
- **Free-Form 1:1 Webcam Overlay:** Draggable & resizable circular or rounded-square camera overlay with `Float / Free`, `Smart Dodge`, and `Zoom With Screen` modes.

### Non-Linear Product Demo Editor (`editor.html` & `editor.js`)
- **Interactive Multi-Layer Timeline:** Inspect and drag **Zoom** segments (`Follow Cursor` or `Fixed Spot`, shortcut `Z`), **Privacy Blur** regions (shortcut `B`), **Click Ripple** markers, **Split** cuts at playhead (`S`), and **Start/End Scissor Trim** handles (`I` and `O`).
- **Click & Cursor FX:** Choose from 4 click-pulse styles (`Radiating Ripple`, `Ripple + Glow Orb`, `Expanding Shockwave`, `Classic Focal Orb`), 1–3 harmonic waves, 9 preset colors + custom hex picker, and a soft cursor highlight halo.
- **Studio Wallpaper, Clean Browser & 9 Aspect Ratios:** Automatically crop browser tabs (`Clean browser`), add macOS window traffic lights, choose from 12 macOS wallpapers + 12 curated gradients + custom image upload, and export across `Native`, `16:9`, `9:16`, `1:1`, `4:5`, `4:3`, `16:10`, `3:2`, or `21:9` aspect ratios.

## Installation & Quickstart

### Option 1: Install from the Chrome Web Store
Install the latest signed release directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/cursordemo-screen-recorder/YOUR_EXTENSION_ID). Works on **Google Chrome, Brave, Microsoft Edge, Opera, Yandex Browser, Vivaldi, and Arc** on Windows, macOS, Linux, and ChromeOS.

### Option 2: Load Unpacked Extension from Source (Developer Mode)
Clone this repository and load the extension directly into any Chromium browser with zero build tools or external dependencies required:

```bash
git clone https://github.com/cursordemo/cursordemo-screen-recorder.git cursordemo
cd cursordemo
```

1. Open your Chromium browser (`chrome://extensions/`, `brave://extensions/`, `edge://extensions/`, `opera://extensions/`, `browser://extensions/` in Yandex, or `vivaldi://extensions/`).
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked** in the top-left action bar.
4. Select the `cursordemo` directory.
5. Pin **CursorDemo** to your browser toolbar and click the icon to launch the Recording Studio.

### Packaging a Clean Chrome Web Store Release Zip
To generate a production-ready `cursordemo.zip` containing only runtime extension files:

```bash
zip -r cursordemo.zip \
  manifest.json background.js content.js \
  record.html record.js editor.html editor.js \
  video-processor.js zoom-analyzer.js LICENSE \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  _locales/
```

## Examples, Demo Workflow & Output Specifications

### Example Product Demo Workflow
```text
[1. Click CursorDemo Icon] -> [2. Enable Mic + Camera + Auto-Zoom]
       |
       v
[3. Record SaaS Tab (60fps Video + 60Hz DOM Cursor Telemetry)]
       |
       v
[4. Auto-Open Non-Linear Editor -> Fine-Tune Zoom, Blur, Padding & 16:9 Frame]
       |
       v
[5. Export Local 4K 60fps H.264 MP4 (0 Watermarks, 0 Cloud Uploads)]
```

### Sample Exported Output Report
- **Container & Codec:** `MP4 (H.264 avc1.640033 / mp4a.40.2)` or `WebM (VP9 / Opus)`
- **Resolution Presets:** `3840x2160 (4K UHD)`, `2560x1440 (2K QHD)`, `1920x1080 (1080p FHD)`, `1280x720 (720p HD)`
- **Frame Rate:** `60 fps` constant compositor tick
- **Camera Zoom Curve:** `smootherstep(t) = t^3 * (t * (t * 6 - 15) + 10)` with `36px` deadzone stabilization

## How CursorDemo Compares to Alternatives

| Feature / Criterion | CursorDemo (v1.4.0) | Screen Studio | Cursorful | Loom |
| :--- | :--- | :--- | :--- | :--- |
| **Pricing & License** | **$0 Forever Free (MIT Open-Source)** | $89–$229 per seat | Freemium / Paid Pro | Freemium (5m limit) / $15+/mo |
| **Supported Platforms** | **Windows, macOS, Linux, ChromeOS (All Chromium)** | macOS only | Browser extension | Desktop & Chrome |
| **Automatic Cursor Zoom** | **Yes (Follow Cursor + Fixed Spot target)** | Yes | Yes | No |
| **Cursor Smoothing** | **Catmull-Rom splines + Perlin smootherstep** | Proprietary spring physics | Basic smoothing | Raw OS cursor |
| **Interactive Privacy Blur** | **Zoom-Synced & Screen-Locked (3 styles)** | Post-recording mask only | Limited | Enterprise add-on |
| **Max Export Quality** | **4K 60fps MP4 & WebM** | 4K 60fps MP4/GIF | 1080p / 4K (Pro) | Cloud 720p–4K |
| **Data Privacy** | **100% Local IndexedDB (0 uploads)** | Local macOS app | Local / Hybrid | Mandatory cloud upload |

## Technical Architecture & File Structure

| File | Responsibility |
| :--- | :--- |
| `manifest.json` | Manifest V3 configuration (`v1.4.0`), permissions (`activeTab`, `storage`, `desktopCapture`, `tabs`, `scripting`, `unlimitedStorage`), and `_locales` binding. |
| `background.js` | Service worker orchestrating studio tab activation, `cursordemo-cursor-stream` port routing, and cross-origin cursor reconciliation. |
| `content.js` | 60Hz DOM cursor/click/scroll telemetry sampler with multi-monitor and left-sidebar geometry calibration. |
| `record.html` / `record.js` | Recording Studio UI, progressive `getDisplayMedia` stream capture, OS/browser-adaptive helpers, WebAudio mixer, and `CursorDemoVideoStorage` IndexedDB writer. |
| `zoom-analyzer.js` | Click-cluster detector, dwell velocity analyzer, progressive edge & corner focal boost, Perlin 5th-order smootherstep evaluator, and 36px deadzone camera stabilizer. |
| `editor.html` / `editor.js` | Non-linear timeline editor, dual-mode zoom, zoom-synced privacy blur, free-form 1:1 webcam compositor, and 4K 60fps MP4/WebM exporter. |
| `video-processor.js` | High-precision video frame compositor, blur/webcam/cursor renderer, and hardware-accelerated export encoder with progressive codec fallback. |
| `_locales/` | Native Chrome Web Store localization bundles across all 56 supported locale codes (`extName <= 45` chars, `extDescription <= 132` chars). |
| `docs/` | SEO, AEO, and GEO documentation site (`index.html`, `llms.txt`, `llms-full.txt`, `pricing.md`, `robots.txt`, `sitemap.xml`). |

## Privacy & Security Architecture

CursorDemo is architected with **privacy by design**:
- **Zero External Network Requests:** No analytics scripts, no tracking pixels, and no cloud storage buckets.
- **100% Client-Side Storage:** Recordings and cursor coordinates reside strictly inside your browser's local `IndexedDB` (`CursorDemoVideoStorage`) until you export or discard them.
- Read our full [Privacy Policy](PRIVACY_POLICY.md) and [Security Policy](SECURITY.md) for complete permission justifications.

## Recommended GitHub Repository Metadata

When configuring your GitHub repository settings (`About` gear icon), use the following metadata for maximum GitHub and search engine discoverability:

- **Description:** `Free, open-source Chrome screen recorder with automatic zoom, smooth cursor tracking, privacy blur & 4K 60fps MP4 product demo editor. Cross-platform Screen Studio alternative.`
- **Website:** `https://cursordemo.com`
- **Topics (20):** `screen-recorder`, `automatic-zoom`, `auto-zoom`, `cursor-tracking`, `product-demo`, `chrome-extension`, `manifest-v3`, `video-editor`, `screen-studio-alternative`, `screencast`, `privacy-blur`, `mp4-recorder`, `webrtc`, `canvas-2d`, `saas-demo`, `open-source`, `javascript`, `screen-capture`, `tutorial-maker`, `demo-video`

## Contributing, Issues & Community Support

We welcome contributions, bug reports, translations, and feature proposals from the open-source community!

- **Report a Bug or Request a Feature:** Open a ticket on our [GitHub Issue Tracker](https://github.com/cursordemo/cursordemo-screen-recorder/issues).
- **Submit a Pull Request:** Review our [Contribution & Editorial Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before opening a pull request.
- **Community Discussions & Support:** Join our [GitHub Discussions](https://github.com/cursordemo/cursordemo-screen-recorder/discussions) to share product demos, request help, or propose roadmap ideas.
- **Support the Project:** If CursorDemo saves you time and subscription fees, please **star this repository** on GitHub and leave a review on the [Chrome Web Store](https://chromewebstore.google.com/detail/cursordemo-screen-recorder/YOUR_EXTENSION_ID)!

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 CursorDemo Contributors.
