# Privacy Policy for CursorDemo

**Effective Date:** November 4, 2026  
**Extension Name:** CursorDemo: Screen Recorder with Automatic Zoom & Demo Editor (`v1.4.0`)  
**Official Website:** [https://cursordemo.com](https://cursordemo.com)  
**Source Code Repository:** [https://github.com/cursordemo/cursordemo-screen-recorder](https://github.com/cursordemo/cursordemo-screen-recorder)

---

## 1. Zero-Data-Collection Summary

**CursorDemo does not collect, transmit, store, rent, or sell any personal data, screen recordings, audio streams, cursor telemetry, or browsing activity.**

Every operation performed by CursorDemo—including screen capture, microphone/system audio mixing, 60Hz DOM cursor coordinate tracking, automatic zoom analysis, zoom-synced privacy blurring, webcam overlay rendering, and 4K 60fps MP4/WebM video encoding—occurs **100% locally on your device** inside your Chromium browser sandbox.

---

## 2. How Local Data Is Processed and Stored

1. **Screen, Window & Tab Video/Audio Streams:**
   - Acquired only when you explicitly click **Start Recording** and select a capture surface in Chrome's native `getDisplayMedia` prompt.
   - Stored temporarily inside your browser's local `IndexedDB` database (`CursorDemoVideoStorage`) so the built-in non-linear editor (`editor.html`) can load, preview, and export your video.
   - Overwritten automatically when you record a new session or cleared when you remove the extension or clear browser storage.
2. **Cursor Telemetry & Zoom Keyframes:**
   - During an active recording session, `content.js` samples mouse cursor coordinates (`x`, `y`), click events, and scroll deltas at 60Hz over a local extension port (`cursordemo-cursor-stream`).
   - These coordinates are used exclusively by `zoom-analyzer.js` and `editor.js` on your local machine to calculate automatic zoom blocks and Catmull-Rom smooth cursor paths. They are never sent over the network.
3. **User Preferences (`chrome.storage.local` & `localStorage`):**
   - Stores your local studio settings (preferred microphone/camera device IDs, camera feel presets, aspect ratio preferences, and one-time UI state flags such as `cursordemo.exportCount`, `cursordemo.reviewPromptShown`, and `cursordemo.reviewPromptDismissed`).

---

## 3. Extension Permissions Justification

CursorDemo requests the minimum Manifest V3 permissions required to function:

- **`activeTab`**: Allows CursorDemo to connect to the tab you are actively recording to track cursor movement and display the circular Picture-in-Picture webcam overlay.
- **`storage`**: Saves your local recording and editor preferences on your device.
- **`desktopCapture`**: Enables screen, application window, and browser tab video/audio capture when you initiate a recording session.
- **`tabs`**: Allows `background.js` to coordinate the Recording Studio (`record.html`) and Demo Editor (`editor.html`) tabs and maintain cursor telemetry across page navigations in the recorded tab.
- **`scripting`**: Allows CursorDemo to inject `content.js` into the recorded webpage so automatic zoom cursor tracking and the circular webcam overlay continue working seamlessly if you navigate across pages during a recording.
- **`unlimitedStorage`**: Allows local `IndexedDB` (`CursorDemoVideoStorage`) to store high-bitrate 1080p and 4K 60fps raw recording blobs locally without failing due to standard browser storage quota caps.
- **`host_permissions` (`<all_urls>`)**: Enables cursor tracking, automatic zoom synthesis, and the webcam overlay on any HTTP/HTTPS website or localhost web app you choose to demonstrate.

---

## 4. Third-Party Services, Analytics & Remote Code

- **No Analytics or Telemetry:** CursorDemo contains zero Google Analytics, Mixpanel, Sentry, or third-party tracking scripts.
- **No Remote Code Execution:** All JavaScript, HTML, and CSS assets are bundled directly inside the extension package (`manifest.json`, `background.js`, `content.js`, `record.js`, `editor.js`, `video-processor.js`, `zoom-analyzer.js`).

---

## 5. Open-Source Transparency & Contact

CursorDemo is 100% open-source software licensed under the [MIT License](LICENSE). You can inspect every line of code at [https://github.com/cursordemo/cursordemo-screen-recorder](https://github.com/cursordemo/cursordemo-screen-recorder).

If you have questions about this Privacy Policy, please open an issue on our [GitHub Issue Tracker](https://github.com/cursordemo/cursordemo-screen-recorder/issues).
