# Chrome Web Store ASO & Upload Guide — CursorDemo (v1.4.0)

This guide contains the complete Chrome Web Store (CWS) App Store Optimization (ASO) metadata, keyword density targets, 56-locale internationalization strategy, localized store listing copy, visual asset storyboards, and permission justifications for **CursorDemo: Screen Recorder with Auto Zoom**.

---

## 1. Core Chrome Web Store Listing Metadata (`en` Default)

| Field | Value | Character Count / Limit |
| :--- | :--- | :--- |
| **Extension Name (`__MSG_extName__`)** | `CursorDemo: Screen Recorder with Auto Zoom` | **42 / 45 chars** |
| **Short Description (`__MSG_extDescription__`)** | `Free screen recorder with automatic cursor zoom, 1:1 webcam overlay, manual blur, and 4K 60fps MP4 export. 100% local, no watermark.` | **132 / 132 chars** |
| **Action Tooltip (`__MSG_extActionTitle__`)** | `CursorDemo — Free Screen Recorder with Auto Zoom` | **48 chars** |
| **Manifest Version** | `1.4.0` (Manifest V3) | Matches `manifest.json` |
| **Primary Category** | `Productivity` -> `Workflow & Planning` (or `Developer Tools`) | Official CWS Taxonomy |
| **Default Locale** | `en` (with 56 CWS locales in `_locales/<locale>/messages.json`) | **56 Locales (100% `<= 45` & `<= 132`)** |
| **Supported Browsers** | Google Chrome, Brave, Microsoft Edge, Opera / Opera GX, Yandex Browser, Vivaldi, Arc, Chromium | Universal Manifest V3 |
| **Supported Operating Systems** | Windows 10/11, macOS (Intel & Apple Silicon), Linux (X11/Wayland), ChromeOS | Cross-Platform |
| **Official Website URL** | `https://cursordemo.com` | Verified Domain |
| **Support / Issues URL** | `https://github.com/cursordemo/cursordemo-screen-recorder/issues` | Public Issue Tracker |
| **Privacy Policy URL** | `https://github.com/cursordemo/cursordemo-screen-recorder/blob/main/PRIVACY_POLICY.md` | Public Document |

---

## 2. Full Chrome Web Store Detailed Description (Copy & Paste)

> **ASO Note:** The first 160 characters of the detailed description double as the Google SERP meta description for the Chrome Web Store listing. Target keyword clusters (`screen recorder with automatic zoom`, `auto zoom screen recorder`, `screen recorder that follows cursor`, `free Screen Studio alternative`, `SaaS product demo recorder`) are woven naturally at optimal density (~1.4%) without keyword stuffing.

```text
CursorDemo is a free screen recorder with automatic zoom, smooth cursor tracking, interactive privacy blur, and a built-in 4K 60fps MP4 video editor for Chrome, Brave, Edge, Opera, Yandex, Vivaldi, and Arc.

Turn ordinary browser captures into studio-grade SaaS product demos, onboarding walkthroughs, software tutorials, and engineering bug reports in seconds—100% locally in your browser with zero watermarks, zero recording time limits, and zero cloud uploads.

WHY CREATORS & ENGINEERING TEAMS CHOOSE CURSORDEMO
Recording a high-converting software demo usually means paying $89–$229 for a macOS-only desktop app like Screen Studio or using cloud screen recorders that compress your video and upload confidential customer data to external servers. CursorDemo is the free, open-source Screen Studio alternative that runs natively on Windows 10/11, macOS, Linux, and ChromeOS inside any Chromium browser.

KEY FEATURES

1. Screen Recorder with Automatic Zoom & Dual Camera Modes
• Automatically tracks your mouse cursor at 60Hz and detects click clusters and dwell windows to insert smooth automatic zoom keyframes (1.25x to 2.80x presets plus custom multipliers).
• Dual Zoom Modes: Choose "Follow Cursor (Auto Pan)" with 3 camera feel profiles (Smooth, Focused, Tight) and Progressive Edge & Corner Boost, or "Fixed Spot" mode with a draggable purple focal target dot to lock onto forms, modals, or code blocks.
• Powered by Ken Perlin’s 5th-order polynomial smootherstep easing curve and a 36-pixel camera deadzone that eliminates micro-jitter while typing or reading.

2. Catmull-Rom Smooth Cursor Tracking & Click Ripple FX
• Replaces jerky hardware mouse movement with continuous Catmull-Rom spline cursor trajectories.
• Customize click-pulse animations across 4 styles (Radiating Ripple, Ripple + Glow Orb, Expanding Shockwave, Classic Focal Orb), 1–3 harmonic waves, 9 preset colors + custom hex picker, and a soft cursor highlight halo.

3. Zoom-Synced & Screen-Locked Privacy Blur Studio
• Draw and resize privacy blur boxes directly on the video canvas or add timed blur segments on the timeline (shortcut B).
• Dual Tracking Modes: Choose "Zoom-Synced (Tracks UI)" so blur masks dynamically pan and scale with zoomed webpage content, or "Screen-Locked (Fixed)" to pin a blur mask to a fixed screen coordinate.
• Three Redaction Styles: Frosted Glass Gaussian Blur, Pixelate / Mosaic, and Redacted Blackout with adjustable intensity (4px–48px) and corner radius.

4. Free-Form Draggable 1:1 Studio Webcam Overlay
• Keep your face visible alongside your product workflow with a free-form draggable and resizable 1:1 circular or rounded-square camera overlay.
• Smart Auto-Zoom Behavior: Set your camera overlay to Float / Free (stays independent during zoom), Smart Dodge (automatically glides out of the way when the cursor approaches), or Zoom With Screen.

5. Non-Linear Product Demo Video Editor & Studio Framing
• Interactive 3-lane timeline with Camera & Zoom segments (Z), Manual Blur segments (B), Click Ripple markers, Split at playhead (S), and Start/End Scissor Trim handles (I and O).
• Clean Browser mode automatically crops browser tabs and the address bar, paired with optional macOS window traffic-light headers.
• Frame your screen recording with 12 macOS wallpapers (Sequoia, Sonoma, Ventura, Monterey, Big Sur, Studio Space Dark, etc.), 12 curated gradients, custom image uploads, adjustable padding, rounded corners, and drop shadows across 9 aspect ratios (Native, 16:9, 9:16, 1:1, 4:5, 4:3, 16:10, 3:2, 21:9).

6. 100% Local 4K 60fps MP4 & WebM Export (Privacy First)
• Export hardware-accelerated H.264 MP4 (.mp4) or VP9 WebM (.webm) at 720p, 1080p, 2K, or 4K Ultra HD (3840x2160) at 60 frames per second.
• Zero servers, zero accounts, and zero telemetry: all video blobs and cursor coordinates stay inside your browser’s local IndexedDB storage (CursorDemoVideoStorage).

UNIVERSAL CHROMIUM & CROSS-OS COMPATIBILITY
• Works seamlessly across Google Chrome, Brave, Microsoft Edge, Opera / Opera GX, Yandex Browser, Vivaldi, Arc, and Chromium.
• Full support for Windows 10 & 11 (including DPI scaling), macOS (Retina & multi-monitor), Linux (X11/Wayland), and ChromeOS, with automatic left-sidebar offset calibration for vertical tabs and browser sidebars.

OPEN SOURCE & FOREVER FREE
CursorDemo is 100% free and open source under the MIT License.
• Website & Documentation: https://cursordemo.com
• Source Code & Issue Tracker: https://github.com/cursordemo/cursordemo-screen-recorder
```

---

## 3. Chrome Web Store Visual Assets & Screenshot Storyboard

Upload the following visual assets in the Chrome Web Store Developer Dashboard (**Store listing** tab):

### Store Icons & Promo Tiles
- **Store Icon (`128x128`):** Included in package at `icons/icon128.png`
- **High-Res Reference Icon (`512x512`):** Available at `icons/icon512.png` (keep outside the runtime zip; use for dashboard/marketing uploads)
- **Small Promo Tile (`440x280`):** Headline: *"Screen Recorder with Automatic Zoom — 100% Free & Local"*
- **Marquee Promo Tile (`1400x560`):** Headline: *"Studio-Grade SaaS Product Demos in Chrome. Auto-Zoom, Smooth Cursor & 4K 60fps MP4."*

### 5-Slide Screenshot Storyboard (`1280x800` or `640x400` PNG)
1. **Slide 1 (Hero — Dual-Mode Automatic Zoom):** Split view showing a webpage click transforming into a 2.0x Perlin-eased automatic zoom (`Follow Cursor` + `Fixed Spot` purple target dot) with the Zoom timeline track below. Caption: *"Automatic Cursor-Following Zoom & Fixed-Spot Target Lock"*.
2. **Slide 2 (Catmull-Rom Cursor Smoothing & Click FX):** Visual path comparison between raw jagged mouse input and smoothed Catmull-Rom spline trajectory with radiating click ripples. Caption: *"Silky-Smooth Cursor Tracking & Customizable Click Ripples"*.
3. **Slide 3 (Non-Linear Studio Editor & 9 Aspect Ratios):** Full view of `editor.html` showcasing Clean Browser tab cropping, macOS Sequoia wallpaper, rounded corners, 9 aspect ratio presets (`16:9`, `9:16`, `1:1`), and timeline controls. Caption: *"Built-In Non-Linear Editor with 24 Studio Backdrops"*.
4. **Slide 4 (Zoom-Synced Privacy Blur Studio):** Demonstrating `Zoom-Synced` and `Screen-Locked` privacy blur masks (`Frosted Glass`, `Pixelate / Mosaic`, `Redacted Blackout`) redacting sensitive customer emails and API keys. Caption: *"Zoom-Synced Privacy Blur & Timed Redaction Masks"*.
5. **Slide 5 (100% Local 4K 60fps MP4 Export):** Highlighting the Export modal (`4K Ultra HD`, `MP4 H.264`, `60fps`) and the zero-cloud IndexedDB badge. Caption: *"100% Free, Open-Source & Local 4K 60fps MP4 Export — No Watermarks"*.

---

## 4. Chrome Web Store Privacy Tab & Permission Justifications

When filling out the **Privacy practices** tab in the Chrome Web Store Developer Dashboard, use these exact justifications covering every permission in `manifest.json`:

### Single Purpose Description
```text
CursorDemo records browser tabs, windows, or screens and provides a local non-linear video editor with automatic cursor-following zoom, smooth cursor tracking, and privacy blur to export MP4/WebM product demo videos.
```

### Permission Justifications (All 6 `permissions` + `host_permissions`)
| Permission | Justification for Chrome Web Store Review Team |
| :--- | :--- |
| **`activeTab`** | Required to communicate with the currently active browser tab when the user explicitly initiates a recording, enabling synchronized 60Hz cursor coordinate tracking and circular webcam overlay positioning during active capture. |
| **`storage`** | Required to persist user preferences (selected microphone/camera device IDs, default export format/resolution, and studio theme settings) locally on the user's device. |
| **`desktopCapture`** | Required to allow users to capture their browser tab, application window, or desktop screen video and system audio when recording a product demo. |
| **`tabs`** | Required by the background service worker (`background.js`) to manage the Recording Studio (`record.html`) and Demo Editor (`editor.html`) tabs and maintain cursor telemetry connection across tab navigation during an active recording session. |
| **`scripting`** | Required to inject `content.js` into the recorded tab when a recording session starts so the extension can capture 60Hz cursor/click/scroll coordinates for automatic zoom synthesis and render the user-toggled circular webcam overlay. |
| **`unlimitedStorage`** | Required so local browser `IndexedDB` (`CursorDemoVideoStorage`) can temporarily store large, high-bitrate 1080p and 4K 60fps raw screen recording video blobs on the user's device prior to editing and MP4/WebM export without failing due to standard browser quota limits. |
| **`host_permissions` (`<all_urls>`)** | Required so users can record product demos, track cursor movements for automatic zoom, and display the Picture-in-Picture webcam overlay across any standard HTTP/HTTPS web application or localhost development server they choose to demonstrate, including across multi-page navigation during a recording session. |

### Data Usage Certification
- **Does this extension collect or transmit any user data?** **No.** All video recordings, audio streams, and cursor telemetry are processed and stored 100% locally on the user's device using browser `IndexedDB` (`CursorDemoVideoStorage`) and `localStorage`.
- **Remote Code:** **No** remote code is fetched or executed.

---

## 5. Multi-Language Localization (`_locales/` — 56 Locales)

CursorDemo ships with **56 Chrome Web Store locales** pre-configured in `_locales/<locale>/messages.json`:
`am`, `ar`, `bg`, `bn`, `ca`, `cs`, `da`, `de`, `el`, `en`, `en_AU`, `en_GB`, `en_US`, `es`, `es_419`, `et`, `fa`, `fi`, `fil`, `fr`, `gu`, `he`, `hi`, `hr`, `hu`, `id`, `it`, `ja`, `kn`, `ko`, `lt`, `lv`, `ml`, `mr`, `ms`, `nl`, `no`, `pa`, `pl`, `pt_BR`, `pt_PT`, `ro`, `ru`, `sk`, `sl`, `sr`, `sv`, `sw`, `ta`, `te`, `th`, `tr`, `uk`, `vi`, `zh_CN`, `zh_TW`.

Every single locale strictly satisfies Chrome Web Store's hard validation rules:
- `extName.message <= 45` characters (100% verified across all 56 locales)
- `extDescription.message <= 132` characters (100% verified across all 56 locales)
- `extActionTitle.message` and `extTitle.message` present in all 56 locales

### Localized Store Listing Summaries for Major Global Markets
- **Español (`es` / `es_419`):** *CursorDemo es un grabador de pantalla gratuito con zoom automático al cursor, cámara web 1:1 arrastrable, desenfoque de privacidad y editor de vídeo MP4 4K a 60fps integrado para Chrome, Brave, Edge, Opera y Yandex en Windows, macOS y Linux. 100% local y sin marca de agua.*
- **Português (`pt_BR` / `pt_PT`):** *O CursorDemo é um gravador de tela gratuito com zoom automático no cursor, câmera 1:1 arrastável, desfoque de privacidade e editor de vídeo MP4 4K 60fps integrado para Chrome, Brave, Edge, Opera e Yandex no Windows, macOS e Linux. 100% local e sem marca d'água.*
- **Français (`fr`):** *CursorDemo est un enregistreur d'écran gratuit avec zoom automatique sur le curseur, webcam 1:1 déplaçable, floutage de confidentialité et éditeur vidéo MP4 4K 60fps intégré pour Chrome, Brave, Edge, Opera et Yandex sur Windows, macOS et Linux. 100% local, sans filigrane.*
- **Deutsch (`de`):** *CursorDemo ist ein kostenloser Bildschirmrekorder mit automatischem Cursor-Zoom, frei positionierbarer 1:1-Webcam, Datenschutz-Unschärfe und integriertem 4K 60fps MP4-Videoeditor für Chrome, Brave, Edge, Opera und Yandex unter Windows, macOS und Linux. 100% lokal ohne Wasserzeichen.*
- **Русский (`ru`):** *CursorDemo — бесплатная программа для записи экрана с автоматическим зумом за курсором, веб-камерой 1:1, размытием конфиденциальных данных и встроенным видеоредактором 4K 60fps MP4 для Яндекс Браузера, Chrome, Brave, Edge и Opera на Windows, macOS и Linux. 100% локально и без водяных знаков.*
- **日本語 (`ja`):** *CursorDemoは、カーソル自動追従ズーム、1:1ワイプカメラ、プライバシーぼかし、4K 60fps MP4動画エディタを内蔵した完全無料の画面録画拡張機能です。Windows、macOS、Linux上のChrome、Brave、Edge、Opera、Vivaldiに対応。透かしなし・100%ローカル処理。*
- **简体中文 (`zh_CN`):** *CursorDemo 是一款完全免费的自动缩放录屏扩展，内置鼠标光标平滑追踪、1:1 自由拖拽圆形摄像头、隐私打码模糊与 4K 60fps MP4 视频编辑器。支持 Windows、macOS 与 Linux 上的 Chrome、Brave、Edge、Opera 等浏览器，无水印，100% 本地运行。*
- **한국어 (`ko`):** *CursorDemo는 자동 커서 줌, 1:1 웹캠 오버레이, 개인정보 블러 및 내장형 4K 60fps MP4 비디오 편집기를 갖춘 무료 화면 녹화 확장 프로그램입니다. Windows, macOS, Linux의 Chrome, Brave, Edge, Opera, Vivaldi를 지원하며 워터마크 없이 100% 로컬에서 처리됩니다.*

---

## 6. Clean Packaging Command

Run the following command from the repository root to build `cursordemo.zip` containing only runtime extension files:

```bash
rm -f cursordemo.zip
zip -r cursordemo.zip \
  manifest.json background.js content.js \
  record.html record.js editor.html editor.js \
  video-processor.js zoom-analyzer.js LICENSE \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  _locales/
```
