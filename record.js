/**
 * CursorDemo Screen Recorder
 * Copyright (c) 2026 CursorDemo Contributors
 * GitHub: https://github.com/cursordemo/cursordemo-screen-recorder
 *
 * Licensed under the MIT License.
 */

// Record Page Controller - CursorDemo studio flow
// Screen picker appears on this page, then recording starts on original tab

// Production mode: set to false to disable debug logging
// Use window object to share across multiple scripts
if (typeof window !== 'undefined' && typeof window.DEBUG_MODE === 'undefined') {
  window.DEBUG_MODE = false;
}

// Debug logging utility
function debugLog(...args) {
  if (typeof window !== 'undefined' && window.DEBUG_MODE) {
    console.log(...args);
  }
}

debugLog('[Record] Page loaded');

// Get tab ID and origin tab ID from URL
const urlParams = new URLSearchParams(window.location.search);
let tabId = parseInt(urlParams.get('tabId'));
const originTabId = parseInt(urlParams.get('originTabId'));

debugLog('[Record] Target tab ID:', tabId, 'Origin tab ID:', originTabId);

// State
let mediaStream = null;
/** Video-only stream for picture-in-picture overlay (separate permission from mic) */
let cameraVideoStream = null;
/** Audio-only stream for voice mixed into recording (separate permission from camera) */
let micStream = null;
let isRecording = false;
let startTime = 0;
let hasLeftRecordPageDuringRecording = false;
let autoPausedOnRecordTab = false;
let autoPausedAt = 0;
let totalAutoPausedMs = 0;
let timerInterval = null;
let lastRecordedVideoId = null;
let keepAlivePort = null;
let keepAliveInterval = null;

function getEffectiveRecordingElapsedMs() {
  if (!(startTime > 0)) return 0;
  const effectiveEnd = autoPausedAt > 0 ? autoPausedAt : Date.now();
  return Math.max(0, effectiveEnd - startTime - totalAutoPausedMs);
}

function startKeepAlive() {
  stopKeepAlive();
  try {
    if (typeof chrome === 'undefined' || !chrome?.runtime?.connect) return;
    keepAlivePort = chrome.runtime.connect({ name: 'cursordemo-recorder-keepalive' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      if (isRecording) {
        setTimeout(startKeepAlive, 1000);
      }
    });

    // 5-second heartbeat ping keeps MV3 service worker awake
    keepAliveInterval = setInterval(() => {
      if (keepAlivePort && isRecording) {
        try {
          keepAlivePort.postMessage({ action: 'ping' });
        } catch (e) {}
      }
    }, 5000);
    console.log('[Record] Keep-alive heartbeat connection established');
  } catch (err) {
    console.warn('[Record] Failed to establish keep-alive port:', err);
  }
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  if (keepAlivePort) {
    try {
      keepAlivePort.disconnect();
    } catch (e) {}
    keepAlivePort = null;
  }
}

// DOM Elements
const selectScreenBtn = document.getElementById('selectScreenBtn');
const enableCameraBtn = document.getElementById('enableCameraBtn');
const enableMicBtn = document.getElementById('enableMicBtn');
const cameraStatus = document.getElementById('cameraStatus');
const cameraStatusText = document.getElementById('cameraStatusText');

// Studio UI Elements
const recordingQualitySelect = document.getElementById('recordingQualitySelect');
const modeScreenOnly = document.getElementById('modeScreenOnly');
const modeScreenCam = document.getElementById('modeScreenCam');
const liveCameraPreview = document.getElementById('liveCameraPreview');
const cameraPreviewVideo = document.getElementById('cameraPreviewVideo');
const micVisualizer = document.getElementById('micVisualizer');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNumber = document.getElementById('countdownNumber');
const countdownToggle = document.getElementById('countdownToggle');
const skipCountdownBtn = document.getElementById('skipCountdownBtn');
const targetTabInfo = document.getElementById('targetTabInfo');

const UI_ICONS = {
  spinner: '<svg class="svg-icon svg-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
  monitor: '<svg class="svg-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2.5"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  check: '<svg class="svg-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  refresh: '<svg class="svg-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  camera: '<svg class="svg-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2.5"/></svg>',
  close: '<svg class="svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  mic: '<svg class="svg-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
  stop: '<svg class="svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>'
};

let detectedDisplaySurface = 'monitor';
let detectedVideoWidth = 0;
let detectedVideoHeight = 0;

// Microphone Audio Equalizer State & Visualizer
let micAudioContext = null;
let micAnalyser = null;
let micVisualizerAnimId = null;

function startMicVisualizer(stream) {
  stopMicVisualizer();
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    micAudioContext = new AudioCtx();
    const source = micAudioContext.createMediaStreamSource(stream);
    micAnalyser = micAudioContext.createAnalyser();
    micAnalyser.fftSize = 64;
    micAnalyser.smoothingTimeConstant = 0.65;
    source.connect(micAnalyser);

    const visualizerEl = document.getElementById('micVisualizer');
    if (visualizerEl) visualizerEl.classList.add('active');

    const bars = document.querySelectorAll('#micVisualizer .audio-bar');
    const dataArray = new Uint8Array(micAnalyser.frequencyBinCount);

    function draw() {
      if (!micAnalyser) return;
      micAnalyser.getByteFrequencyData(dataArray);

      if (bars && bars.length) {
        for (let i = 0; i < bars.length; i++) {
          const binIndex = Math.min(i + 1, dataArray.length - 1);
          const val = dataArray[binIndex] || 0;
          const pct = Math.max(15, Math.min(100, Math.round((val / 255) * 100)));
          bars[i].style.height = `${pct}%`;
        }
      }
      micVisualizerAnimId = requestAnimationFrame(draw);
    }
    draw();
  } catch (e) {
    console.warn('[Record] Could not start mic visualizer:', e);
  }
}

function stopMicVisualizer() {
  if (micVisualizerAnimId) {
    cancelAnimationFrame(micVisualizerAnimId);
    micVisualizerAnimId = null;
  }
  if (micAudioContext) {
    try {
      micAudioContext.close();
    } catch (e) {}
    micAudioContext = null;
    micAnalyser = null;
  }
  const visualizerEl = document.getElementById('micVisualizer');
  if (visualizerEl) visualizerEl.classList.remove('active');
  const bars = document.querySelectorAll('#micVisualizer .audio-bar');
  if (bars) {
    bars.forEach(bar => { bar.style.height = ''; });
  }
}

function hasCameraOverlay() {
  return !!(cameraVideoStream && cameraVideoStream.getVideoTracks().length > 0);
}

function hasMicForRecording() {
  return !!(micStream && micStream.getAudioTracks().length > 0);
}

function updateOptionalMediaStatus() {
  const cam = hasCameraOverlay();
  const mic = hasMicForRecording();
  if (!cam && !mic) {
    cameraStatus.style.display = 'none';
    cameraStatus.classList.remove('is-muted');
    return;
  }
  cameraStatus.style.display = 'inline-flex';
  cameraStatus.classList.toggle('is-muted', !mic);
  if (cam && mic) {
    cameraStatusText.textContent = 'Camera & microphone ready';
  } else if (cam) {
    cameraStatusText.textContent = 'Camera overlay ready (mic muted)';
  } else {
    cameraStatusText.textContent = 'Microphone active & testing';
  }
}
const startRecordingBtn = document.getElementById('startRecordingBtn');
const stopRecordingBtn = document.getElementById('stopRecordingBtn');
const screenStatus = document.getElementById('screenStatus');
const screenStatusText = document.getElementById('screenStatusText');
const recordingOverlay = document.getElementById('recordingOverlay');
const cameraOverlay = document.getElementById('cameraOverlay');
const cameraOverlayVideo = document.getElementById('cameraOverlayVideo');
const timer = document.getElementById('timer');
const unsupportedModal = document.getElementById('unsupportedModal');
const unsupportedModalMessage = document.getElementById('unsupportedModalMessage');
const unsupportedModalOk = document.getElementById('unsupportedModalOk');

// Detect browser and OS environment for cross-browser / cross-OS UI & URL handling
function detectEnvironment() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  const platform = (typeof navigator !== 'undefined' && (navigator.userAgentData?.platform || navigator.platform))
    ? String(navigator.userAgentData?.platform || navigator.platform)
    : '';
  const brands = (typeof navigator !== 'undefined' && Array.isArray(navigator.userAgentData?.brands))
    ? navigator.userAgentData.brands.map(b => b.brand || '').join(' ')
    : '';

  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X|Macintosh/i.test(ua);
  const isWindows = /Win/i.test(platform) || /Windows/i.test(ua);
  const isChromeOS = /CrOS/i.test(ua) || /CrOS/i.test(platform);
  const isLinux = (!isMac && !isWindows && !isChromeOS) && (/Linux|X11|Ubuntu|Fedora|Debian|Arch/i.test(platform) || /Linux|X11/i.test(ua));

  let browserName = 'Chrome';
  let scheme = 'chrome://';
  if ((typeof navigator !== 'undefined' && navigator.brave) || /Brave/i.test(brands) || /Brave/i.test(ua)) {
    browserName = 'Brave';
    scheme = 'brave://';
  } else if (/YaBrowser|Yandex/i.test(ua) || /YaBrowser|Yandex/i.test(brands)) {
    browserName = 'Yandex Browser';
    scheme = 'browser://';
  } else if (/OPR\/|Opera/i.test(ua) || /Opera/i.test(brands)) {
    browserName = 'Opera';
    scheme = 'opera://';
  } else if (/Edg\//i.test(ua) || /Microsoft Edge/i.test(brands)) {
    browserName = 'Edge';
    scheme = 'edge://';
  } else if (/Vivaldi/i.test(ua) || /Vivaldi/i.test(brands)) {
    browserName = 'Vivaldi';
    scheme = 'vivaldi://';
  } else if (typeof getComputedStyle === 'function' && typeof document !== 'undefined' && document.documentElement &&
             getComputedStyle(document.documentElement).getPropertyValue('--arc-palette-title')) {
    browserName = 'Arc';
    scheme = 'arc://';
  }

  const osLabel = isMac ? 'macOS' : (isWindows ? 'Windows' : (isChromeOS ? 'ChromeOS' : (isLinux ? 'Linux' : 'Desktop')));

  return {
    isMac,
    isWindows,
    isLinux,
    isChromeOS,
    osLabel,
    browserName,
    scheme
  };
}

const RUNTIME_ENV = detectEnvironment();
const DISCORD_INVITE_URL = 'https://discord.gg/gwATujg6yq';
if (typeof window !== 'undefined') {
  window.DISCORD_INVITE_URL = DISCORD_INVITE_URL;
}

// Utility function to detect unsupported websites across all Chromium browsers
function isUnsupportedWebsite(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.trim().toLowerCase();

  // Internal pages across Chrome, Brave, Edge, Opera, Yandex, Vivaldi, Arc
  const restrictedSchemes = [
    'chrome://',
    'chrome-extension://',
    'chrome-untrusted://',
    'chrome-search://',
    'brave://',
    'edge://',
    'opera://',
    'opr://',
    'vivaldi://',
    'browser://',
    'yandex://',
    'arc://',
    'devtools://',
    'view-source:',
    'about:',
    'javascript:',
    'data:',
    'blob:'
  ];
  for (const scheme of restrictedSchemes) {
    if (lower.startsWith(scheme)) return true;
  }

  // Extension Web Stores across Chromium browsers
  if (lower.includes('chrome.google.com/webstore')) return true;
  if (lower.includes('chromewebstore.google.com')) return true;
  if (lower.includes('microsoftedge.microsoft.com/addons')) return true;
  if (lower.includes('addons.opera.com')) return true;
  if (lower.includes('browser.yandex.') && lower.includes('/addons')) return true;

  return false;
}

// Get website name for display
function getWebsiteName(url) {
  if (!url || typeof url !== 'string') return 'this page';
  const lower = url.trim().toLowerCase();

  if (lower.startsWith('chrome://')) {
    const page = url.replace(/^chrome:\/\//i, '').split('/')[0];
    return `Chrome ${page} page`;
  }
  if (lower.startsWith('brave://')) {
    const page = url.replace(/^brave:\/\//i, '').split('/')[0];
    return `Brave ${page} page`;
  }
  if (lower.startsWith('edge://')) {
    const page = url.replace(/^edge:\/\//i, '').split('/')[0];
    return `Edge ${page} page`;
  }
  if (lower.startsWith('opera://') || lower.startsWith('opr://')) {
    const page = url.replace(/^(opera|opr):\/\//i, '').split('/')[0];
    return `Opera ${page} page`;
  }
  if (lower.startsWith('vivaldi://')) {
    const page = url.replace(/^vivaldi:\/\//i, '').split('/')[0];
    return `Vivaldi ${page} page`;
  }
  if (lower.startsWith('browser://') || lower.startsWith('yandex://')) {
    const page = url.replace(/^(browser|yandex):\/\//i, '').split('/')[0];
    return `Yandex ${page} page`;
  }
  if (lower.startsWith('arc://')) {
    const page = url.replace(/^arc:\/\//i, '').split('/')[0];
    return `Arc ${page} page`;
  }
  if (lower.startsWith('chrome-extension://')) {
    return `${RUNTIME_ENV.browserName} Extension page`;
  }
  if (lower.includes('chrome.google.com/webstore') || lower.includes('chromewebstore.google.com')) {
    return 'Chrome Web Store';
  }
  if (lower.includes('microsoftedge.microsoft.com/addons')) {
    return 'Edge Add-ons Store';
  }
  if (lower.includes('addons.opera.com')) {
    return 'Opera Add-ons Store';
  }
  if (lower.includes('settings')) {
    return 'Settings page';
  }

  return 'this page';
}

// Show unsupported website modal
function showUnsupportedModal(url) {
  const websiteName = getWebsiteName(url);
  unsupportedModalMessage.textContent = 
    `CursorDemo is not allowed to record mouse interactions on ${websiteName} or internal Settings pages.`;
  unsupportedModal.classList.add('active');
}

// Hide unsupported website modal
function hideUnsupportedModal() {
  unsupportedModal.classList.remove('active');
}

// Check if target tab is unsupported (without showing modal)
async function checkUnsupportedWebsite() {
  try {
    if (!tabId || isNaN(tabId)) {
      return false;
    }
    
    const tab = await chrome.tabs.get(tabId);
    debugLog('[Record] Checking target tab URL:', tab.url);
    
    if (isUnsupportedWebsite(tab.url)) {
      console.warn('[Record] ⚠️ Unsupported website detected:', tab.url);
      return true;
    }
    return false;
  } catch (error) {
    console.warn('[Record] Could not check tab URL:', error);
    return false;
  }
}

// Modal OK button handler
unsupportedModalOk.addEventListener('click', () => {
  hideUnsupportedModal();
});

// Close modal when clicking outside
unsupportedModal.addEventListener('click', (e) => {
  if (e.target === unsupportedModal) {
    hideUnsupportedModal();
  }
});

// Find the most recently accessed scriptable tab across windows when tabId is missing or restricted
async function resolveBestScriptableTab() {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
    const allTabs = await chrome.tabs.query({});
    const candidates = allTabs.filter(t => t && t.id && t.url && !isUnsupportedWebsite(t.url));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const aAccess = a.lastAccessed || 0;
      const bAccess = b.lastAccessed || 0;
      if (aAccess !== bAccess) return bAccess - aAccess;
      const aActive = a.active ? 1 : 0;
      const bActive = b.active ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return (b.index || 0) - (a.index || 0);
    });
    return candidates[0];
  } catch (e) {
    return null;
  }
}

// Find the best non-recorder tab to focus when recording Entire Screen / Window and no scriptable tab is open
async function resolveBestFallbackTabToFocus(preferredWindowId = null, excludeTabId = null) {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
    const extBaseUrl = chrome.runtime?.getURL ? chrome.runtime.getURL('') : 'chrome-extension://';
    if (originTabId && !isNaN(originTabId) && originTabId !== excludeTabId && chrome.tabs?.get) {
      const origTab = await chrome.tabs.get(originTabId).catch(() => null);
      if (origTab && origTab.id && (!origTab.url || !origTab.url.startsWith(extBaseUrl))) {
        return origTab;
      }
    }
    const allTabs = await chrome.tabs.query({});
    const candidates = allTabs.filter(t =>
      t && t.id &&
      t.id !== excludeTabId &&
      (!t.url || !t.url.startsWith(extBaseUrl))
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const aPrefWin = (preferredWindowId !== null && a.windowId === preferredWindowId) ? 1 : 0;
      const bPrefWin = (preferredWindowId !== null && b.windowId === preferredWindowId) ? 1 : 0;
      if (aPrefWin !== bPrefWin) return bPrefWin - aPrefWin;
      const aAccess = a.lastAccessed || 0;
      const bAccess = b.lastAccessed || 0;
      if (aAccess !== bAccess) return bAccess - aAccess;
      return (b.index || 0) - (a.index || 0);
    });
    return candidates[0];
  } catch (e) {
    return null;
  }
}

// Target Tab Initialization
async function initTargetTab() {
  if (!tabId || isNaN(tabId)) {
    const bestTab = await resolveBestScriptableTab();
    if (bestTab && bestTab.id) {
      tabId = bestTab.id;
      console.log('[Record] Auto-resolved target tabId:', tabId, bestTab.url);
      if (targetTabInfo) {
        targetTabInfo.textContent = bestTab.title || getWebsiteName(bestTab.url);
        targetTabInfo.title = `${bestTab.title || ''} (${bestTab.url || ''})`;
      }
      return;
    }
    console.log('[Record] No specific target tabId - recording entire screen / window');
    if (targetTabInfo) targetTabInfo.textContent = 'Entire Screen / Any Window';
    return;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (isUnsupportedWebsite(tab.url)) {
      const bestTab = await resolveBestScriptableTab();
      if (bestTab && bestTab.id) {
        tabId = bestTab.id;
        if (targetTabInfo) {
          targetTabInfo.textContent = bestTab.title || getWebsiteName(bestTab.url);
          targetTabInfo.title = `${bestTab.title || ''} (${bestTab.url || ''})`;
        }
        return;
      }
      console.warn('[Record] Target tab is unsupported - modal will show when Start Recording is clicked');
    }
    if (targetTabInfo) {
      targetTabInfo.textContent = tab.title || getWebsiteName(tab.url);
      targetTabInfo.title = `${tab.title || ''} (${tab.url || ''})`;
    }
  } catch (error) {
    console.warn('[Record] Could not check tab details:', error);
    const bestTab = await resolveBestScriptableTab();
    if (bestTab && bestTab.id) {
      tabId = bestTab.id;
      if (targetTabInfo) {
        targetTabInfo.textContent = bestTab.title || getWebsiteName(bestTab.url);
        targetTabInfo.title = `${bestTab.title || ''} (${bestTab.url || ''})`;
      }
    } else if (targetTabInfo) {
      targetTabInfo.textContent = 'Active Chrome Tab';
    }
  }
}
initTargetTab();

// Event Listeners
selectScreenBtn.addEventListener('click', selectScreen);
enableCameraBtn.addEventListener('click', enableCameraVideo);
enableMicBtn.addEventListener('click', enableMicrophone);
startRecordingBtn.addEventListener('click', startRecording);
stopRecordingBtn.addEventListener('click', stopRecording);

// Adapt UI hints and permission guidance to active Browser (Chrome, Brave, Edge, Opera, Yandex, Vivaldi, Arc) and OS (macOS, Windows, Linux, ChromeOS)
function applyPlatformAdaptiveUI() {
  const tipBox = document.getElementById('macPickerTip');
  const tipText = document.getElementById('macPickerTipText');
  const flagBtn = document.getElementById('enableChromeThumbnailPickerBtn');
  const screenWarning = document.getElementById('screenPermissionWarning');
  const screenWarningText = document.getElementById('screenWarningText') || screenWarning;
  const cameraWarningText = document.getElementById('cameraWarningText');
  const bName = RUNTIME_ENV.browserName;
  const displayFlagUrl = `${RUNTIME_ENV.scheme}flags/#use-sc-content-sharing-picker`;

  if (!RUNTIME_ENV.isMac) {
    // Windows, Linux, ChromeOS: Do not show macOS 15 ScreenCaptureKit flag; provide OS-native capture & audio guidance
    if (flagBtn) flagBtn.style.display = 'none';
    if (tipText) {
      if (RUNTIME_ENV.isWindows) {
        tipText.innerHTML =
          `<strong>Capturing on Windows:</strong> Choose <strong>Entire Screen</strong> (Screen 1 / Screen 2), <strong>Window</strong>, or <strong>${bName} Tab</strong> in the share dialog. Tick <strong>Also share system audio</strong> to capture desktop sound.`;
      } else if (RUNTIME_ENV.isLinux) {
        tipText.innerHTML =
          `<strong>Capturing on Linux:</strong> Choose <strong>Entire Screen</strong>, <strong>Window</strong>, or <strong>${bName} Tab</strong> in the share dialog (supports both X11 and Wayland via PipeWire / XDG Desktop Portal).`;
      } else {
        tipText.innerHTML =
          `<strong>Capturing on ChromeOS:</strong> Choose <strong>Entire Screen</strong>, <strong>Window</strong>, or <strong>${bName} Tab</strong> in the share dialog and tick <strong>Share audio</strong> to include system sound.`;
      }
    }
    if (screenWarningText) {
      screenWarningText.innerHTML = RUNTIME_ENV.isWindows
        ? `<strong>Black screen detected:</strong> Ensure ${bName} has permission to capture your display in Windows Settings, or re-select a specific <strong>${bName} Tab</strong>.`
        : `<strong>Black screen detected:</strong> Ensure screen sharing permission is granted in your system portal, or re-select a specific <strong>${bName} Tab</strong>.`;
    }
    if (cameraWarningText) {
      cameraWarningText.innerHTML = RUNTIME_ENV.isWindows
        ? `<strong>Camera access required:</strong> Please allow camera access in the ${bName} permission prompt and check Windows Settings → Privacy &amp; security → Camera.`
        : `<strong>Camera access required:</strong> Please allow camera access in the ${bName} permission prompt and verify your webcam is connected.`;
    }
  } else {
    // macOS: Tailor flag helper to active Chromium browser (Chrome, Brave, Edge, Opera, Yandex, Vivaldi)
    if (tipText && bName !== 'Chrome') {
      tipText.innerHTML =
        `<strong>Seeing “Choose a screen” instead of Screen 1 / Screen 2 thumbnails?</strong><br>` +
        `• Click the green <strong>Choose a screen</strong> button in ${bName}’s popup to pick your screen, <em>or</em><br>` +
        `• Disable ${bName}’s macOS 15 picker flag (<code>Use ScreenCaptureKit picker for stream selection</code>) to show <strong>Screen 1 / Screen 2</strong> thumbnails inside the dialog:`;
    }
    if (flagBtn && bName !== 'Chrome') {
      flagBtn.title = `Opens ${displayFlagUrl} — set 'Use ScreenCaptureKit picker for stream selection' to Disabled and relaunch ${bName}`;
      flagBtn.innerHTML = `<span>Restore Screen 1 / Screen 2 Thumbnails in ${bName}</span><span aria-hidden="true">→</span>`;
    }
    if (screenWarningText && bName !== 'Chrome') {
      screenWarningText.innerHTML =
        `<strong>Black screen detected:</strong> macOS requires Screen Recording permission for ${bName} in System Settings → Privacy &amp; Security. You can also re-select a specific <strong>${bName} Tab</strong>.`;
    }
  }

  // Adapt audio tip banner and active recording subtext to active Chromium browser
  if (bName !== 'Chrome') {
    const audioBannerSpans = document.querySelectorAll('.audio-tip-banner summary > span');
    if (audioBannerSpans && audioBannerSpans.length >= 2) {
      audioBannerSpans[1].innerHTML =
        `Want computer sound too? Tick <strong>“Share audio”</strong> in ${bName}’s share dialog.`;
    }
    const recSubtext = document.getElementById('recordingSurfaceSubtext');
    if (recSubtext) {
      recSubtext.textContent =
        `Click anywhere naturally — CursorDemo tracks clicks and zooms automatically. You can also click the red ● CursorDemo toolbar icon or ${bName}'s "Stop sharing" button anytime to finish.`;
    }
  }
}
applyPlatformAdaptiveUI();

// macOS 15+ Thumbnail Picker Flag Helper (works across Chrome, Brave, Edge, Opera, Yandex, Vivaldi)
const enableChromeThumbnailPickerBtn = document.getElementById('enableChromeThumbnailPickerBtn');
if (enableChromeThumbnailPickerBtn) {
  enableChromeThumbnailPickerBtn.addEventListener('click', async () => {
    const bName = RUNTIME_ENV.browserName;
    const displayFlagUrl = `${RUNTIME_ENV.scheme}flags/#use-sc-content-sharing-picker`;
    const chromeFlagUrl = 'chrome://flags/#use-sc-content-sharing-picker';
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(displayFlagUrl).catch(() => {});
      }
    } catch (_) {}
    let openedTab = false;
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        try {
          await chrome.tabs.create({ url: displayFlagUrl, active: true });
          openedTab = true;
        } catch (_) {
          await chrome.tabs.create({ url: chromeFlagUrl, active: true });
          openedTab = true;
        }
      }
    } catch (err) {
      console.warn('[Record] Could not open flags tab directly:', err);
    }
    const tipText = document.getElementById('macPickerTipText');
    if (tipText) {
      tipText.innerHTML = openedTab
        ? `<strong>Flag page opened!</strong> Change <code>Use ScreenCaptureKit picker for stream selection</code> from Default to <strong>Disabled</strong>, then click <strong>Relaunch</strong> at the bottom of ${bName} to restore <strong>Screen 1 / Screen 2</strong> thumbnails.`
        : `<strong>Copied to clipboard:</strong> Paste <code>${displayFlagUrl}</code> in ${bName}’s address bar, set <code>Use ScreenCaptureKit picker for stream selection</code> to <strong>Disabled</strong>, and click <strong>Relaunch</strong>.`;
    }
    enableChromeThumbnailPickerBtn.textContent = openedTab
      ? '✓ Flag Opened — Set to “Disabled” & Click Relaunch'
      : `✓ Copied ${displayFlagUrl}`;
  });
}

// Mode Switcher Listeners
if (modeScreenOnly) {
  modeScreenOnly.addEventListener('click', () => {
    modeScreenOnly.classList.add('active');
    if (modeScreenCam) modeScreenCam.classList.remove('active');
    if (cameraVideoStream) {
      cameraVideoStream.getTracks().forEach(t => t.stop());
      cameraVideoStream = null;
    }
    if (liveCameraPreview) liveCameraPreview.style.display = 'none';
    if (cameraPreviewVideo) cameraPreviewVideo.srcObject = null;
    const cameraWarning = document.getElementById('cameraPermissionWarning');
    if (cameraWarning) cameraWarning.style.display = 'none';
    if (enableCameraBtn) {
      enableCameraBtn.disabled = false;
      enableCameraBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.camera}</span> Enable Camera`;
    }
    updateOptionalMediaStatus();
  });
}

if (modeScreenCam) {
  modeScreenCam.addEventListener('click', async () => {
    modeScreenCam.classList.add('active');
    if (modeScreenOnly) modeScreenOnly.classList.remove('active');
    if (!cameraVideoStream) {
      await enableCameraVideo();
    }
  });
}

// Global Keyboard Shortcuts (Space / Enter to Launch or Skip, Esc to Cancel Countdown or Modal)
window.addEventListener('keydown', (e) => {
  const discordModalEl = document.getElementById('discordModal');
  const welcomeModalEl = document.getElementById('welcomeModal');
  const isDiscordModalOpen = Boolean(discordModalEl && !discordModalEl.classList.contains('hidden'));
  const isWelcomeModalOpen = Boolean(welcomeModalEl && !welcomeModalEl.classList.contains('hidden'));

  if (isDiscordModalOpen) {
    if (e.code === 'Escape') {
      e.preventDefault();
      closeDiscordModal(false);
    }
    return;
  }

  if (isWelcomeModalOpen) {
    if (e.code === 'Escape') {
      e.preventDefault();
      closeWelcomeModal();
    }
    return;
  }

  if (unsupportedModal && unsupportedModal.classList.contains('active')) {
    if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      hideUnsupportedModal();
    }
    return;
  }

  if (countdownActive) {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (skipCountdownBtn) skipCountdownBtn.click();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      if (countdownCancelFn) countdownCancelFn();
    }
    return;
  }

  if (!isRecording) {
    const target = e.target;
    const tag = target && target.tagName ? target.tagName.toUpperCase() : '';
    const isInteractive = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A' || tag === 'SUMMARY' ||
      (tag === 'BUTTON' && target !== startRecordingBtn) ||
      (target && typeof target.closest === 'function' && target.closest('a, summary, input, select, textarea, button:not(#startRecordingBtn)'));
    if (!isInteractive && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      startRecording();
    }
  }
});

// Step 1: Select Screen - Uses getDisplayMedia to show picker on THIS page
// Following the approach from: https://www.recall.ai/blog/how-to-build-a-chrome-recording-extension
async function selectScreen() {
  try {
    debugLog('[Record] Selecting screen...');
    selectScreenBtn.disabled = true;
    selectScreenBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.spinner}</span> Selecting...`;

    // If an existing stream is active, stop it before picking a new one
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      mediaStream = null;
    }
    detectedVideoWidth = 0;
    detectedVideoHeight = 0;

    // 3-tier progressive getDisplayMedia fallback chain across Chrome, Brave, Edge, Opera, Yandex, Vivaldi, Arc
    // on macOS, Windows, Linux, and ChromeOS
    const displayMediaOptions = {
      video: {
        displaySurface: 'monitor',
        width: { ideal: 1920, max: 3840 },
        height: { ideal: 1080, max: 2160 },
        frameRate: { ideal: 30, max: 60 }
      },
      audio: true, // Enable audio capture - user must select audio in picker
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude'
    };

    const isUserCancelError = (err) => Boolean(
      err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'AbortError')
    );

    try {
      mediaStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    } catch (pickerErr) {
      if (isUserCancelError(pickerErr)) {
        throw pickerErr;
      }
      console.warn('[Record] Primary getDisplayMedia options rejected, retrying with { video: true, audio: true }:', pickerErr);
      try {
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
      } catch (fallbackAudioErr) {
        if (isUserCancelError(fallbackAudioErr)) {
          throw fallbackAudioErr;
        }
        console.warn('[Record] Audio+video getDisplayMedia rejected, retrying with { video: true }:', fallbackAudioErr);
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: true
        });
      }
    }

    console.log('[Record] Screen selected!');
    console.log('[Record] Video tracks:', mediaStream.getVideoTracks().length);
    console.log('[Record] Audio tracks:', mediaStream.getAudioTracks().length);

    // Get video track settings, upgrade to native 4K/60fps if supported, and set contentHint for maximum UI sharpness
    const videoTrack = mediaStream.getVideoTracks()[0];
    if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
      const qualityPreset = document.getElementById('recordingQualitySelect')?.value || 'auto';
      if (qualityPreset !== '1080p') {
        try {
          await videoTrack.applyConstraints({
            width: { ideal: 3840, max: 3840 },
            height: { ideal: 2160, max: 2160 },
            frameRate: { ideal: 60, max: 60 }
          });
        } catch (_) {}
      }
    }
    if (videoTrack && 'contentHint' in videoTrack) {
      videoTrack.contentHint = 'detail'; // Tells Chromium to prioritize detail/sharp text over high frame loss
      console.log('[Record] Set videoTrack.contentHint = "detail" for maximum UI text sharpness');
    }
    const settings = videoTrack ? videoTrack.getSettings() : {};
    detectedDisplaySurface = settings.displaySurface || 'monitor';
    if (settings.width > 0) detectedVideoWidth = settings.width;
    if (settings.height > 0) detectedVideoHeight = settings.height;
    console.log('[Record] Video settings:', settings, 'Surface:', detectedDisplaySurface);

    // If user selected a specific tab or window in the picker whose title matches an open scriptable tab,
    // update tabId so we switch to and track the actual selected tab/window.
    try {
      const trackLabel = (videoTrack && videoTrack.label) ? videoTrack.label.trim() : '';
      if (trackLabel && typeof chrome !== 'undefined' && chrome.tabs?.query) {
        const allTabs = await chrome.tabs.query({});
        const scriptable = allTabs.filter(t => t && t.id && t.url && !isUnsupportedWebsite(t.url));
        const exactMatch = scriptable.find(t => t.title && (
          trackLabel === t.title ||
          trackLabel.endsWith(t.title) ||
          (t.title.length >= 6 && trackLabel.includes(t.title))
        ));
        if (exactMatch && exactMatch.id) {
          tabId = exactMatch.id;
          console.log('[Record] Matched selected stream label to tabId:', tabId, exactMatch.title);
        }
      }
    } catch (_) {}

    if (!tabId || isNaN(tabId)) {
      const bestTab = await resolveBestScriptableTab();
      if (bestTab && bestTab.id) {
        tabId = bestTab.id;
      }
    }
    if (targetTabInfo) {
      const surfaceBadge = detectedDisplaySurface === 'window'
        ? 'Window Capture'
        : (detectedDisplaySurface === 'monitor' ? 'Entire Screen' : 'Chrome Tab');
      if (tabId && !isNaN(tabId)) {
        try {
          const t = await chrome.tabs.get(tabId);
          if (t && t.title) {
            targetTabInfo.textContent = `${surfaceBadge} • ${t.title}`;
            targetTabInfo.title = `${surfaceBadge}: ${t.title} (${t.url || ''})`;
          }
        } catch (_) {}
      } else {
        targetTabInfo.textContent = surfaceBadge;
      }
    }

    // Log audio track information if present
    // Following the article's approach: verify audio tracks are captured
    const audioTracks = mediaStream.getAudioTracks();
    if (audioTracks.length > 0) {
      audioTracks.forEach((track, index) => {
        const audioSettings = track.getSettings();
        console.log(`[Record] Audio track ${index + 1} settings:`, audioSettings);
        console.log(`[Record] Audio track ${index + 1} label:`, track.label);
        console.log(`[Record] Audio track ${index + 1} enabled:`, track.enabled);
        console.log(`[Record] Audio track ${index + 1} kind:`, track.kind);
      });
      console.log('[Record] ✅ System/tab audio will be recorded');
    }

    // Update UI
    selectScreenBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.check}</span> Screen Selected`;
    selectScreenBtn.classList.remove('btn-primary');
    selectScreenBtn.classList.add('btn-outline');
    selectScreenBtn.disabled = false; // Allow user to click again to switch screens
    document.getElementById('displayTile')?.classList.add('is-configured');
    
    screenStatus.style.display = 'inline-flex';
    const hasAudio = mediaStream.getAudioTracks().length > 0;
    const resInfo = (settings.width && settings.height) 
      ? ` (${settings.width}×${settings.height}${settings.frameRate ? ` @ ${Math.round(settings.frameRate)}fps` : ''}${settings.width >= 3200 ? ' • 4K UHD' : (settings.width >= 2560 ? ' • 2K Retina' : '')})`
      : '';
    screenStatusText.textContent = hasAudio 
      ? `Display & tab audio ready${resInfo}`
      : `Display ready (no tab audio)${resInfo}`;

    // Enable start recording button
    startRecordingBtn.disabled = false;
    startRecordingBtn.classList.remove('btn-outline');
    startRecordingBtn.classList.add('btn-primary');

    // Check if the stream has visible video content (detect macOS black screen capture)
    const warningEl = document.getElementById('screenPermissionWarning');
    if (warningEl) warningEl.style.display = 'none';

    setTimeout(async () => {
      if (!mediaStream || mediaStream.getVideoTracks().length === 0) return;
      const hasContent = await checkStreamHasVisibleContent(mediaStream);
      if (!hasContent && warningEl) {
        console.warn('[Record] ⚠️ Black stream detected from getDisplayMedia! Likely macOS Screen Recording permission missing for Chrome');
        warningEl.style.display = 'block';
        document.getElementById('displayTile')?.classList.remove('is-configured');
        // Allow user to re-select screen/tab easily
        selectScreenBtn.disabled = false;
        selectScreenBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.refresh}</span> Re-select Screen or Tab`;
        selectScreenBtn.classList.remove('btn-outline');
        selectScreenBtn.classList.add('btn-primary');
      }
    }, 450);

    // Handle stream ending (user clicked Chrome's native "Stop sharing" button)
    mediaStream.getVideoTracks()[0].onended = () => {
      console.log('[Record] Stream ended by user');
      if (isRecording) {
        stopRecording();
      } else {
        resetUI();
      }
    };

    return true;

  } catch (error) {
    // Screen selection error
    selectScreenBtn.disabled = false;
    selectScreenBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.monitor}</span> Select Screen`;
    selectScreenBtn.classList.add('btn-primary');
    selectScreenBtn.classList.remove('btn-outline');
    document.getElementById('displayTile')?.classList.remove('is-configured');
    
    const errMsg = String(error && error.message ? error.message : '');
    if (error && error.name === 'NotAllowedError' && /system/i.test(errMsg)) {
      const warningEl = document.getElementById('screenPermissionWarning');
      if (warningEl) warningEl.style.display = 'block';
      showDiscordModal({
        mode: 'crash',
        reason: 'system-screen-permission',
        title: 'Screen Recording Blocked by System Settings',
        error: `Your operating system blocked screen recording (${errMsg || error.name}). Please enable Screen Recording permission for ${RUNTIME_ENV.browserName}, or join our Discord for step-by-step help.`
      });
    } else if (error && error.name !== 'NotAllowedError' && error.name !== 'AbortError' && error.name !== 'PermissionDeniedError') {
      showDiscordModal({
        mode: 'crash',
        reason: 'screen-select-failed',
        title: 'Screen Selection Didn\'t Work',
        error: 'Failed to select screen: ' + (error.message || String(error))
      });
    }
    return false;
  }
}

/**
 * Checks if captured mediaStream video track has real non-black content.
 * Returns false if macOS permission is blocking video capture (all pixels 0,0,0).
 */
async function checkStreamHasVisibleContent(stream) {
  try {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') return true;

    const testVideo = document.createElement('video');
    testVideo.muted = true;
    testVideo.playsInline = true;
    testVideo.srcObject = new MediaStream([videoTrack]);
    await testVideo.play().catch(() => {});

    for (let attempt = 0; attempt < 6; attempt++) {
      if (testVideo.readyState >= 2 && testVideo.videoWidth > 0 && testVideo.videoHeight > 0) {
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (testVideo.readyState < 2 || !testVideo.videoWidth || !testVideo.videoHeight) {
      testVideo.pause();
      testVideo.srcObject = null;
      return true;
    }

    const s = videoTrack.getSettings ? videoTrack.getSettings() : {};
    if (testVideo.videoWidth > 0 && testVideo.videoHeight > 0) {
      detectedVideoWidth = s.width || testVideo.videoWidth;
      detectedVideoHeight = s.height || testVideo.videoHeight;
      if (screenStatusText && (!s.width || !s.height)) {
        const hasAudio = stream.getAudioTracks().length > 0;
        const resInfo = ` (${detectedVideoWidth}×${detectedVideoHeight}${s.frameRate ? ` @ ${Math.round(s.frameRate)}fps` : ''}${detectedVideoWidth >= 3200 ? ' • 4K UHD' : (detectedVideoWidth >= 2560 ? ' • 2K Retina' : '')})`;
        screenStatusText.textContent = hasAudio
          ? `Display & tab audio ready${resInfo}`
          : `Display ready (no tab audio)${resInfo}`;
      }
    }

    const testCanvas = document.createElement('canvas');
    testCanvas.width = 32;
    testCanvas.height = 32;
    const testCtx = testCanvas.getContext('2d', { willReadFrequently: true });
    testCtx.drawImage(testVideo, 0, 0, 32, 32);

    const imgData = testCtx.getImageData(0, 0, 32, 32).data;
    let hasContent = false;
    let hasOpaque = false;
    for (let i = 0; i < imgData.length; i += 4) {
      if (imgData[i + 3] > 0) {
        hasOpaque = true;
      }
      if (imgData[i] > 3 || imgData[i + 1] > 3 || imgData[i + 2] > 3) {
        hasContent = true;
        break;
      }
    }

    testVideo.pause();
    testVideo.srcObject = null;
    // If no opaque pixels were rendered yet (e.g. backgrounded tab during window picker), do not false-positive
    return hasOpaque ? hasContent : true;
  } catch (e) {
    return true; // Don't block on check error
  }
}

// Enable/disable camera only (picture-in-picture overlay)
async function enableCameraVideo() {
  const cameraWarning = document.getElementById('cameraPermissionWarning');
  const cameraWarningText = document.getElementById('cameraWarningText');

  // If camera already active, toggle it off
  if (cameraVideoStream) {
    debugLog('[Record] Disabling camera overlay...');
    cameraVideoStream.getTracks().forEach((t) => t.stop());
    cameraVideoStream = null;

    if (cameraPreviewVideo) {
      cameraPreviewVideo.srcObject = null;
    }
    if (liveCameraPreview) {
      liveCameraPreview.style.display = 'none';
    }
    if (cameraWarning) {
      cameraWarning.style.display = 'none';
    }
    enableCameraBtn.disabled = false;
    enableCameraBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.camera}</span> Enable Camera`;
    if (modeScreenOnly) modeScreenOnly.classList.add('active');
    if (modeScreenCam) modeScreenCam.classList.remove('active');
    updateOptionalMediaStatus();
    return;
  }

  try {
    debugLog('[Record] Requesting camera (video only)...');
    enableCameraBtn.disabled = true;
    enableCameraBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.spinner}</span> Connecting...`;
    if (cameraWarning) cameraWarning.style.display = 'none';

    // Progressive fallback: Try ideal HD 30fps webcam constraints first; fallback to generic video: true
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });
    } catch (idealErr) {
      console.warn('[Record] Ideal camera constraints unavailable, attempting generic fallback:', idealErr?.name || idealErr);
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
    }

    cameraVideoStream = stream;
    console.log('[Record] Camera (overlay) enabled, video tracks:', cameraVideoStream.getVideoTracks().length);

    if (liveCameraPreview) {
      liveCameraPreview.style.display = 'flex';
    }
    if (cameraPreviewVideo) {
      cameraPreviewVideo.srcObject = cameraVideoStream;
      cameraPreviewVideo.play().catch(() => {});
    }

    if (cameraWarning) cameraWarning.style.display = 'none';
    enableCameraBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.close}</span> Turn Off`;
    enableCameraBtn.disabled = false;
    if (modeScreenCam) modeScreenCam.classList.add('active');
    if (modeScreenOnly) modeScreenOnly.classList.remove('active');

    cameraVideoStream.getVideoTracks()[0].onended = () => {
      console.log('[Record] Camera video ended by user or device');
      if (cameraVideoStream) {
        cameraVideoStream.getTracks().forEach((t) => t.stop());
        cameraVideoStream = null;
      }
      if (cameraPreviewVideo) {
        cameraPreviewVideo.srcObject = null;
      }
      if (liveCameraPreview) {
        liveCameraPreview.style.display = 'none';
      }
      enableCameraBtn.disabled = false;
      enableCameraBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.camera}</span> Enable Camera`;
      if (modeScreenOnly) modeScreenOnly.classList.add('active');
      if (modeScreenCam) modeScreenCam.classList.remove('active');
      updateOptionalMediaStatus();
    };

    updateOptionalMediaStatus();
  } catch (error) {
    console.warn('[Record] Camera initialization error:', error?.name, error?.message);
    enableCameraBtn.disabled = false;
    enableCameraBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.camera}</span> Enable Camera`;
    if (liveCameraPreview) {
      liveCameraPreview.style.display = 'none';
    }
    if (modeScreenOnly) modeScreenOnly.classList.add('active');
    if (modeScreenCam) modeScreenCam.classList.remove('active');

    let msg = 'Could not access camera (' + (error?.name || 'Error') + '). Please ensure your webcam is connected.';
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      const osCameraSetting = RUNTIME_ENV.isMac
        ? 'macOS System Settings → Privacy & Security → Camera'
        : (RUNTIME_ENV.isWindows ? 'Windows Settings → Privacy & security → Camera' : 'your system privacy settings');
      msg = `<strong>Camera permission blocked:</strong> Click the lock/tune icon in the ${RUNTIME_ENV.browserName} address bar to allow Camera access, and check ${osCameraSetting}.`;
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      msg = '<strong>No camera found:</strong> Please connect a webcam or enable your built-in camera to use Face Cam.';
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      msg = '<strong>Camera is in use:</strong> Another app (Zoom, Meet, FaceTime, or another tab) is currently using the camera. Please close it and try again.';
    } else if (error.name === 'OverconstrainedError') {
      msg = '<strong>Camera constraint error:</strong> Your webcam does not support the requested video format.';
    }

    if (cameraWarning && cameraWarningText) {
      cameraWarningText.innerHTML = msg;
      cameraWarning.style.display = 'block';
    }
  }
}

// Enable/disable microphone only — mixed into recording with screen audio & live visualizer
async function enableMicrophone() {
  // If microphone already active, toggle it off / mute
  if (micStream) {
    console.log('[Record] Disabling/muting microphone...');
    stopMicVisualizer();
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    document.getElementById('micTile')?.classList.remove('is-configured');
    enableMicBtn.disabled = false;
    enableMicBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.mic}</span> Enable Microphone`;
    enableMicBtn.classList.add('btn-outline');
    enableMicBtn.classList.remove('btn-primary');
    updateOptionalMediaStatus();
    return;
  }

  try {
    debugLog('[Record] Requesting microphone (audio only)...');
    enableMicBtn.disabled = true;
    enableMicBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.spinner}</span> Connecting...`;

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 2 }
        },
        video: false
      });
    } catch (idealMicErr) {
      if (idealMicErr && (idealMicErr.name === 'NotAllowedError' || idealMicErr.name === 'PermissionDeniedError')) {
        throw idealMicErr;
      }
      console.warn('[Record] Ideal microphone constraints unavailable, retrying with generic audio fallback:', idealMicErr?.name || idealMicErr);
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
    }

    console.log('[Record] Microphone enabled, audio tracks:', micStream.getAudioTracks().length);
    startMicVisualizer(micStream);

    micStream.getAudioTracks().forEach((track, i) => {
      const settings = track.getSettings();
      console.log(`[Record] Microphone ${i + 1}:`, {
        sampleRate: settings.sampleRate,
        channelCount: settings.channelCount
      });
      track.onended = () => {
        console.log('[Record] Microphone track ended by user');
        stopMicVisualizer();
        if (micStream) {
          micStream.getTracks().forEach((t) => t.stop());
          micStream = null;
        }
        document.getElementById('micTile')?.classList.remove('is-configured');
        enableMicBtn.disabled = false;
        enableMicBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.mic}</span> Enable Microphone`;
        enableMicBtn.classList.add('btn-outline');
        enableMicBtn.classList.remove('btn-primary');
        updateOptionalMediaStatus();
      };
    });

    enableMicBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.check}</span> Mic Active (Mute)`;
    enableMicBtn.classList.remove('btn-outline');
    enableMicBtn.classList.add('btn-primary');
    enableMicBtn.disabled = false;
    document.getElementById('micTile')?.classList.add('is-configured');

    updateOptionalMediaStatus();
  } catch (error) {
    console.warn('[Record] Microphone error:', error?.name, error?.message);
    stopMicVisualizer();
    document.getElementById('micTile')?.classList.remove('is-configured');
    enableMicBtn.disabled = false;
    enableMicBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.mic}</span> Enable Microphone`;
    enableMicBtn.classList.add('btn-outline');
    enableMicBtn.classList.remove('btn-primary');
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      alert('Microphone permission denied. Allow microphone access to record your voice.');
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      alert('No microphone found. Connect a microphone to record voice.');
    } else {
      alert('Failed to enable microphone: ' + error.message);
    }
  }
}

/** Stop optional camera/mic tracks and reset buttons (e.g. after recording or full reset) */
function resetOptionalMediaUI() {
  stopMicVisualizer();
  if (cameraVideoStream) {
    cameraVideoStream.getTracks().forEach((t) => t.stop());
    cameraVideoStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }

  if (liveCameraPreview) {
    liveCameraPreview.style.display = 'none';
  }
  if (cameraPreviewVideo) {
    cameraPreviewVideo.srcObject = null;
  }

  document.getElementById('micTile')?.classList.remove('is-configured');
  const cameraWarning = document.getElementById('cameraPermissionWarning');
  if (cameraWarning) cameraWarning.style.display = 'none';
  enableCameraBtn.disabled = false;
  enableCameraBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.camera}</span> Enable Camera`;
  enableMicBtn.disabled = false;
  enableMicBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.mic}</span> Enable Microphone`;
  enableMicBtn.classList.add('btn-outline');
  enableMicBtn.classList.remove('btn-primary');
  cameraStatus.style.display = 'none';
  cameraStatus.classList.remove('is-muted');

  if (modeScreenOnly) modeScreenOnly.classList.add('active');
  if (modeScreenCam) modeScreenCam.classList.remove('active');
}

// Reset UI when stream ends
function resetUI() {
  document.getElementById('displayTile')?.classList.remove('is-configured');
  const screenWarning = document.getElementById('screenPermissionWarning');
  if (screenWarning) screenWarning.style.display = 'none';
  selectScreenBtn.disabled = false;
  selectScreenBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.monitor}</span> Select Screen`;
  selectScreenBtn.classList.add('btn-primary');
  selectScreenBtn.classList.remove('btn-outline');
  
  startRecordingBtn.disabled = false;
  startRecordingBtn.innerHTML = '<span class="rec-pulse-icon"></span> Start Recording';
  
  screenStatus.style.display = 'none';
  mediaStream = null;
  
  resetOptionalMediaUI();
}

// Full-Screen 3-2-1 Studio Countdown
let countdownActive = false;
let countdownCancelFn = null;

function runCountdown(seconds = 3) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('countdownOverlay');
    const numEl = document.getElementById('countdownNumber');
    const skipBtn = document.getElementById('skipCountdownBtn');

    if (!overlay || !numEl) {
      resolve(true);
      return;
    }

    // Hide pre-recording camera preview bubble before countdown so it never gets captured into Frame 0
    if (liveCameraPreview) liveCameraPreview.style.display = 'none';
    if (cameraOverlay) cameraOverlay.classList.remove('active');

    countdownActive = true;
    overlay.classList.add('active');
    let current = seconds;

    function playTickSound(isFinal = false) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(isFinal ? 880 : 440, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.16);
        setTimeout(() => { ctx.close().catch(() => {}); }, 250);
      } catch (e) {}
    }

    function renderNumber(n) {
      numEl.textContent = n;
      numEl.classList.remove('pulse-anim');
      void numEl.offsetWidth; // trigger reflow
      numEl.classList.add('pulse-anim');
      playTickSound(n === 1);
    }

    renderNumber(current);

    let timerId = null;

    const finish = (proceed) => {
      if (!countdownActive) return;
      countdownActive = false;
      if (timerId) clearInterval(timerId);
      overlay.classList.remove('active');
      countdownCancelFn = null;
      if (!proceed && hasCameraOverlay() && liveCameraPreview) {
        liveCameraPreview.style.display = 'flex';
      }
      resolve(proceed);
    };

    countdownCancelFn = () => finish(false);

    if (skipBtn) {
      skipBtn.onclick = () => finish(true);
    }

    timerId = setInterval(() => {
      current--;
      if (current > 0) {
        renderNumber(current);
      } else {
        clearInterval(timerId);
        finish(true);
      }
    }, 1000);
  });
}

// 1-Click Launch Entry Point
async function startRecording() {
  if (isRecording) return;

  // Step 1: Ensure display source is selected (effortless 1-click launch)
  if (!mediaStream) {
    const success = await selectScreen();
    if (!success || !mediaStream) {
      // User cancelled picker or permission was denied
      return;
    }
  }

  // Step 2: Pre-flight check / auto-resolve target tab
  try {
    if (!tabId || isNaN(tabId)) {
      const bestTab = await resolveBestScriptableTab();
      if (bestTab && bestTab.id) {
        tabId = bestTab.id;
      }
    }
    if (tabId && !isNaN(tabId)) {
      const tab = await chrome.tabs.get(tabId);
      if (isUnsupportedWebsite(tab.url)) {
        const bestTab = await resolveBestScriptableTab();
        if (bestTab && bestTab.id) {
          tabId = bestTab.id;
        } else if (detectedDisplaySurface === 'browser') {
          showUnsupportedModal(tab.url);
          return;
        }
      }
    }
  } catch (e) {
    console.warn('[Record] Pre-flight tab check error:', e);
  }

  // Step 3: 3-2-1 Countdown (if enabled)
  const toggle = document.getElementById('countdownToggle');
  const useCountdown = toggle ? toggle.checked : true;
  if (useCountdown) {
    const proceed = await runCountdown(3);
    if (!proceed) {
      console.log('[Record] Countdown cancelled by user');
      return;
    }
  }

  // Step 4: Execute actual recording
  await executeActualRecording();
}

// Helper: Draw a video/image source into a square 1:1 canvas using center-crop (prevents aspect-ratio squishing of 16:9 webcams)
function drawCenterCroppedCameraFrame(source, ctx, canvasWidth, canvasHeight) {
  if (!source || !ctx) return false;
  const rawW = ('videoWidth' in source) ? source.videoWidth : (source.naturalWidth ?? source.width ?? 0);
  const rawH = ('videoHeight' in source) ? source.videoHeight : (source.naturalHeight ?? source.height ?? 0);
  const vw = Number(rawW);
  const vh = Number(rawH);
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return false;
  const sSize = Math.min(vw, vh);
  const sx = (vw - sSize) / 2;
  const sy = (vh - sSize) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sSize, sSize, 0, 0, canvasWidth, canvasHeight);
  return true;
}

// Step 4: Execute Recording Backend Flow
async function executeActualRecording() {
  // Clean up any previous recording resources
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    console.log('[Record] Cleaning up previous MediaRecorder before starting new recording');
    try {
      mediaRecorder.stop();
    } catch (e) {
      console.warn('[Record] Error stopping previous MediaRecorder:', e);
    }
    mediaRecorder = null;
  }
  if (cameraMediaRecorder && cameraMediaRecorder.state !== 'inactive') {
    try {
      cameraMediaRecorder.stop();
    } catch (e) {}
    cameraMediaRecorder = null;
  }
  recordedChunks = [];
  recordedCameraChunks = [];
  cameraRecordingFinalizePromise = null;
  hasLeftRecordPageDuringRecording = false;
  autoPausedOnRecordTab = false;
  autoPausedAt = 0;
  totalAutoPausedMs = 0;
  
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Ensure we have the best available scriptable tabId before starting recording
  try {
    if (!tabId || isNaN(tabId)) {
      const bestTab = await resolveBestScriptableTab();
      if (bestTab && bestTab.id) {
        tabId = bestTab.id;
      }
    }
    if (tabId && !isNaN(tabId)) {
      const tab = await chrome.tabs.get(tabId);
      console.log('[Record] Checking target tab before recording:', tab.url);
      
      if (isUnsupportedWebsite(tab.url)) {
        const bestTab = await resolveBestScriptableTab();
        if (bestTab && bestTab.id) {
          tabId = bestTab.id;
        } else if (detectedDisplaySurface === 'browser') {
          console.warn('[Record] ⚠️ Unsupported website detected, showing modal');
          if (hasCameraOverlay() && liveCameraPreview) liveCameraPreview.style.display = 'flex';
          showUnsupportedModal(tab.url);
          return;
        } else {
          tabId = NaN;
        }
      }
    }
  } catch (error) {
    console.warn('[Record] Could not check tab before recording:', error);
  }

  try {
    console.log('[Record] Starting recording...');
    startRecordingBtn.disabled = true;
    startRecordingBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.spinner}</span> Starting...`;

    // Hide any pre-recording camera preview on record.html BEFORE recording starts so a duplicate
    // face circle is NEVER burned into the screen video (the webcam is recorded on its own synchronized
    // studio track and composited cleanly in the Editor).
    if (liveCameraPreview) liveCameraPreview.style.display = 'none';
    if (cameraOverlay) {
      cameraOverlay.classList.remove('active');
      cameraOverlay.style.display = 'none';
    }

    // Never inject a second DOM webcam bubble onto the recorded tab — the webcam is recorded as a
    // dedicated synchronized track (cameraMediaRecorder -> videoId + '_cam') and composited in Editor/Export.
    const shouldInjectInTabOverlay = false;

    // SECOND: Tell background we're starting (sets isRecording = true)
    const response = await chrome.runtime.sendMessage({
      action: 'startRecordingWithMediaStream',
      tabId: tabId && !isNaN(tabId) ? tabId : null,
      displaySurface: detectedDisplaySurface,
      cameraOverlayEnabled: hasCameraOverlay(), // Pass camera overlay flag
      injectInTabCameraOverlay: shouldInjectInTabOverlay,
      settings: {
        trackCursor: true,
        recordMicrophone: false,
        quality: '1080p',
        fps: '30'
      }
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to start recording');
    }
    
    console.log('[Record] Background acknowledged, isRecording is now true');

    // THIRD: Inject content script for cursor tracking across target tab and all open scriptable tabs/windows
    const trackingResult = await injectCursorTracking();
    
    // If unsupported website detected on explicit tab capture, stop everything gracefully
    if (trackingResult && trackingResult.unsupported && detectedDisplaySurface === 'browser') {
      try {
        await chrome.runtime.sendMessage({ action: 'recordingStopped' });
      } catch (e) {}
      
      try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
        if (mediaStream) {
          mediaStream.getTracks().forEach(track => track.stop());
        }
      } catch (e) {}
      
      startRecordingBtn.disabled = false;
      startRecordingBtn.innerHTML = '<span class="rec-pulse-icon"></span> Start Recording';
      if (hasCameraOverlay() && liveCameraPreview) liveCameraPreview.style.display = 'flex';
      showUnsupportedModal(trackingResult.url);
      return;
    }

    // FOURTH: Switch away from record.html to the target tab (or fallback non-recorder tab / minimize).
    // Never steal OS window focus if the user already focused another Chrome window or native app
    // during the picker or countdown (document.hasFocus() === false).
    if (!tabId || isNaN(tabId)) {
      const bestTab = await resolveBestScriptableTab();
      if (bestTab && bestTab.id) {
        tabId = bestTab.id;
      }
    }
    const minimizeRecorderWindowSafely = async (winId) => {
      if (winId === undefined || !chrome.windows?.update) return false;
      try {
        const win = chrome.windows?.get ? await chrome.windows.get(winId).catch(() => null) : null;
        if (win && win.state === 'fullscreen') {
          // macOS WindowServer ignores minimize on fullscreen spaces unless exited to normal first
          await chrome.windows.update(winId, { state: 'normal' }).catch(() => {});
          await new Promise(r => setTimeout(r, 120));
        }
        const updatedWin = await chrome.windows.update(winId, { state: 'minimized' }).catch(() => null);
        return Boolean(updatedWin && (!updatedWin.state || updatedWin.state === 'minimized'));
      } catch (_) {
        return false;
      }
    };
    const recordPageHadFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    if (document.visibilityState === 'visible') {
      try {
        const currentRecordTab = (chrome.tabs?.getCurrent) ? await chrome.tabs.getCurrent().catch(() => null) : null;
        let focusTargetTabId = (tabId && !isNaN(tabId)) ? tabId : null;
        let focusTargetTab = focusTargetTabId ? await chrome.tabs.get(focusTargetTabId).catch(() => null) : null;

        // If no scriptable tab is available (e.g. user only has chrome://settings or internal tabs open)
        // and we are recording Entire Screen or Window, switch to the user's previous/fallback tab so record.html
        // does not stay in the foreground of the screen recording.
        if (!focusTargetTab && detectedDisplaySurface !== 'browser') {
          const fallbackTab = await resolveBestFallbackTabToFocus(currentRecordTab?.windowId ?? null, currentRecordTab?.id ?? null);
          if (fallbackTab && fallbackTab.id) {
            focusTargetTabId = fallbackTab.id;
            focusTargetTab = fallbackTab;
          }
        }

        if (focusTargetTabId && focusTargetTab) {
          console.log('[Record] Switching away from record.html to tab:', focusTargetTabId, 'recordPageHadFocus:', recordPageHadFocus);
          await chrome.tabs.update(focusTargetTabId, { active: true }).catch(() => {});
          // If record.html lives in a different Chrome window than focusTargetTab, also switch record.html's
          // window to another tab in that window so record.html is hidden on Entire Screen recordings.
          if (currentRecordTab && currentRecordTab.windowId !== undefined &&
              focusTargetTab.windowId !== undefined && currentRecordTab.windowId !== focusTargetTab.windowId &&
              chrome.tabs?.query) {
            const extBaseUrl = chrome.runtime?.getURL ? chrome.runtime.getURL('') : 'chrome-extension://';
            const sameWinTabs = await chrome.tabs.query({ windowId: currentRecordTab.windowId }).catch(() => []);
            const fallbackSameWinTab = sameWinTabs.find(t => t && t.id && t.id !== currentRecordTab.id && (!t.url || !t.url.startsWith(extBaseUrl)));
            if (fallbackSameWinTab) {
              await chrome.tabs.update(fallbackSameWinTab.id, { active: true }).catch(() => {});
            } else if (detectedDisplaySurface === 'monitor') {
              await minimizeRecorderWindowSafely(currentRecordTab.windowId);
            }
          }
          // Only focus focusTargetTab's window if record.html still had OS focus or explicit Tab capture was chosen
          if ((recordPageHadFocus || detectedDisplaySurface === 'browser') &&
              focusTargetTab.windowId !== undefined && chrome.windows?.update) {
            await chrome.windows.update(focusTargetTab.windowId, { focused: true }).catch(() => {});
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        } else if (detectedDisplaySurface === 'monitor' && currentRecordTab?.windowId !== undefined) {
          // record.html is the only open tab in Chrome while recording Entire Screen — minimize it (or open a clean tab if fullscreen cannot minimize)
          const minimized = await minimizeRecorderWindowSafely(currentRecordTab.windowId);
          if (!minimized && document.visibilityState === 'visible' && chrome.tabs?.create) {
            await chrome.tabs.create({ windowId: currentRecordTab.windowId, active: true }).catch(() => {});
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        } else if (detectedDisplaySurface === 'window' && recordPageHadFocus && currentRecordTab?.windowId !== undefined && chrome.tabs?.create) {
          // record.html is the only open tab in its window during Window capture — open a new active tab so record.html does not block the window
          await chrome.tabs.create({ windowId: currentRecordTab.windowId, active: true }).catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } catch (e) {
        console.warn('[Record] Could not switch away from record.html:', e);
      }
    }

    // FIFTH: Sync recording start time right before MediaRecorder starts
    console.log('[Record] Syncing recording start time with MediaRecorder start');
    try {
      await chrome.runtime.sendMessage({ action: 'syncRecordingStartTime' });
    } catch (e) {
      console.warn('[Record] Could not sync recording start time:', e);
    }

    // Re-trigger startTracking on active visible tab(s) after tab switch & time sync so initial windowMetrics
    // and t=0 geometry are captured while the target tab is visible
    try {
      if (tabId && !isNaN(tabId)) {
        chrome.tabs.sendMessage(tabId, { action: 'startTracking' }).catch(() => {});
      }
      if (chrome.tabs?.query) {
        chrome.tabs.query({ active: true }).then((activeTabs) => {
          for (const t of (activeTabs || [])) {
            if (t && t.id && t.url && !isUnsupportedWebsite(t.url)) {
              chrome.tabs.sendMessage(t.id, { action: 'startTracking' }).catch(() => {});
            }
          }
        }).catch(() => {});
      }
    } catch (_) {}

    // Stop launcher preview visualizer to save resources while recording
    stopMicVisualizer();

    // SIXTH: Start local recording AFTER tab switch and time sync
    startTime = Date.now();
    await startLocalRecording();
    
    isRecording = true;
    startTime = Date.now();
    hasLeftRecordPageDuringRecording = (document.visibilityState === 'hidden');
    try {
      localStorage.setItem('cursordemo.recordingInProgress', JSON.stringify({
        startedAt: startTime,
        displaySurface: detectedDisplaySurface || 'monitor',
        quality: document.getElementById('recordingQualitySelect')?.value || 'auto'
      }));
    } catch (_) {}
    startKeepAlive();
    
    // Start timer
    timerInterval = setInterval(updateTimer, 100);

    // Update recording overlay surface heading & subtext to match what is being captured
    const recordingSurfaceHeading = document.getElementById('recordingSurfaceHeading');
    const recordingSurfaceSubtext = document.getElementById('recordingSurfaceSubtext');
    if (recordingSurfaceHeading) {
      recordingSurfaceHeading.textContent = detectedDisplaySurface === 'monitor'
        ? 'Capturing Entire Screen'
        : (detectedDisplaySurface === 'window' ? 'Capturing Window' : 'Capturing Tab');
    }
    if (recordingSurfaceSubtext) {
      recordingSurfaceSubtext.textContent = detectedDisplaySurface === 'monitor'
        ? 'Your entire screen is being recorded. Switch to any window or app — click the CursorDemo toolbar icon or the button below when finished.'
        : (detectedDisplaySurface === 'window'
          ? 'Your selected window is being recorded. Click the CursorDemo toolbar icon or the button below when finished.'
          : 'Your tab is being recorded with live cursor tracking. Click the CursorDemo toolbar icon or the button below when finished.');
    }

    // Show recording overlay (will be visible when user comes back to this tab).
    // NOTE: Do NOT show #cameraOverlay on record.html — the webcam is recorded on its own synchronized
    // cameraMediaRecorder stream and composited in the Editor, so showing a DOM camera bubble on record.html
    // would burn a duplicate face circle into the screen recording.
    recordingOverlay.classList.add('active');

  } catch (error) {
    console.log('[Record] Start recording error:', error);
    try { localStorage.removeItem('cursordemo.recordingInProgress'); } catch (_) {}
    
    startRecordingBtn.disabled = false;
    startRecordingBtn.innerHTML = '<span class="rec-pulse-icon"></span> Start Recording';
    if (hasCameraOverlay() && liveCameraPreview) {
      liveCameraPreview.style.display = 'flex';
    }
    
    if (!error.message || (!error.message.includes('unsupported website') && !error.message.includes('Cannot record'))) {
      if (typeof showDiscordModal === 'function') {
        showDiscordModal({
          mode: 'crash',
          reason: 'recording-start-error',
          summary: 'Failed to start screen recording.',
          details: `StartRecordingError: ${error.message || 'Unknown error'}\nSurface: ${detectedDisplaySurface || 'unknown'}\nBrowser: ${RUNTIME_ENV.browserName} (${RUNTIME_ENV.osLabel})`
        });
      } else {
        alert('Failed to start recording: ' + (error.message || 'Unknown error'));
      }
    }
  }
}

// Inject content script into target tab and all open scriptable tabs across all windows
async function injectCursorTracking() {
  try {
    if (!tabId || isNaN(tabId)) {
      const bestTab = await resolveBestScriptableTab();
      if (bestTab && bestTab.id) {
        tabId = bestTab.id;
      }
    }

    const tabsToTrack = [];
    let primaryTabRestrictedUrl = null;

    if (tabId && !isNaN(tabId)) {
      try {
        const primaryTab = await chrome.tabs.get(tabId);
        if (primaryTab && primaryTab.url) {
          if (isUnsupportedWebsite(primaryTab.url)) {
            primaryTabRestrictedUrl = primaryTab.url;
          } else {
            tabsToTrack.push(primaryTab);
          }
        }
      } catch (e) {}
    }

    // Also include all other open scriptable tabs across all Chrome windows
    // so Window and Entire Screen captures track cursor and clicks in any window immediately
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        const allTabs = await chrome.tabs.query({});
        for (const t of allTabs) {
          if (t && t.id && t.url && !isUnsupportedWebsite(t.url)) {
            if (!tabsToTrack.some(existing => existing.id === t.id)) {
              tabsToTrack.push(t);
            }
          }
        }
      }
    } catch (e) {}

    if (tabsToTrack.length === 0) {
      if (primaryTabRestrictedUrl && detectedDisplaySurface === 'browser') {
        return { unsupported: true, url: primaryTabRestrictedUrl };
      }
      console.log('[Record] No scriptable browser tabs currently open - recording screen / external window');
      return { unsupported: false };
    }

    if ((!tabId || isNaN(tabId) || primaryTabRestrictedUrl) && tabsToTrack[0]?.id) {
      tabId = tabsToTrack[0].id;
    }

    await Promise.allSettled(tabsToTrack.map(async (t) => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: t.id, allFrames: true },
          files: ['content.js']
        });
      } catch (_) {}
      try {
        await chrome.tabs.sendMessage(t.id, { action: 'startTracking' });
      } catch (_) {}
    }));

    // Wait briefly and confirm startTracking on primary tab
    await new Promise(resolve => setTimeout(resolve, 150));
    if (tabId && !isNaN(tabId)) {
      try {
        const trackingResponse = await chrome.tabs.sendMessage(tabId, { action: 'startTracking' });
        console.log('[Record] ✅ Cursor tracking started on primary tab:', tabId, 'total tracked tabs:', tabsToTrack.length, trackingResponse);
      } catch (e) {}
    }

    return { unsupported: false };
  } catch (error) {
    console.log('[Record] Could not inject content script:', error.message);
    return { unsupported: false };
  }
}

// Local recording using the mediaStream we already have
let mediaRecorder = null;
let recordedChunks = [];
let cameraMediaRecorder = null;
let recordedCameraChunks = [];
let cameraRecordingFinalizePromise = null;

async function startLocalRecording() {
  const qualityPresets = {
    '4k-max': { width: 3840, height: 2160, bitrate: 200000000 }, // 200 Mbps — ultra lossless master
    '4k':     { width: 3840, height: 2160, bitrate: 140000000 }, // 140 Mbps — 4K studio master
    '1440p':  { width: 2560, height: 1440, bitrate: 90000000 },  // 90 Mbps — crystal clear 2K / Retina source
    '1080p':  { width: 1920, height: 1080, bitrate: 60000000 },  // 60 Mbps — sharp 1080p broadcast master with zero macroblocking
    '720p':   { width: 1280, height: 720,  bitrate: 30000000 }   // 30 Mbps — clean 720p source
  };
  
  // Check if we have audio tracks to include in recording
  let audioTracks = mediaStream.getAudioTracks();
  const videoTracks = mediaStream.getVideoTracks();

  // Dynamic preset based on user selection or captured screen/window resolution (accounting for high-DPI Retina displays)
  const qualitySelect = document.getElementById('recordingQualitySelect');
  const userChosenQuality = qualitySelect ? qualitySelect.value : null;

  const videoSettings = videoTracks[0]?.getSettings() || {};
  const dpr = window.devicePixelRatio || 1;
  const screenW = videoSettings.width || Math.round(window.screen.width * dpr) || 1920;
  const screenH = videoSettings.height || Math.round(window.screen.height * dpr) || 1080;
  
  let presetKey = '1080p';
  if (userChosenQuality && qualityPresets[userChosenQuality]) {
    presetKey = userChosenQuality;
  } else if (screenW >= 2800 || screenH >= 1700) {
    presetKey = '4k';
  } else if (screenW >= 2000 || screenH >= 1200) {
    presetKey = '1440p';
  } else if (screenW < 1400 && screenH < 900) {
    presetKey = '720p';
  }
  const preset = qualityPresets[presetKey] || qualityPresets['4k'];
  console.log(`[Record] Selected quality preset: ${presetKey} (${screenW}x${screenH}, ${preset.bitrate / 1000000} Mbps)`);
  
  // Codec detection - VP9 profile 2 / profile 0 preferred for quality, VP8/WebM fallback
  const codecs = [
    'video/webm;codecs=vp09.02.10.10,opus',
    'video/webm;codecs=vp09.00.10.08,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp09.02.10.10',
    'video/webm;codecs=vp09.00.10.08',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  
  let selectedCodec = codecs[0];
  for (const codec of codecs) {
    if (MediaRecorder.isTypeSupported(codec)) {
      selectedCodec = codec;
      console.log('[Record] Using codec:', codec);
      break;
    }
  }
  
  // Add microphone-only audio (separate from camera permission) when enabled
  if (hasMicForRecording()) {
    const micAudioTracks = micStream.getAudioTracks();
    if (micAudioTracks.length > 0) {
      console.log('[Record] Adding microphone audio track(s) to recording stream');
      const combinedStream = new MediaStream();
      videoTracks.forEach((track) => combinedStream.addTrack(track));

      if (audioTracks.length > 0) {
        // Both system audio and microphone are present:
        // MediaRecorder only records the FIRST audio track if multiple are added!
        // Mix both into a single stereo track using Web Audio API to prevent track dropping
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          window.recordingAudioContext = new AudioContextClass();
          const dest = window.recordingAudioContext.createMediaStreamDestination();
          
          const systemSource = window.recordingAudioContext.createMediaStreamSource(new MediaStream(audioTracks));
          systemSource.connect(dest);
          
          const micSource = window.recordingAudioContext.createMediaStreamSource(new MediaStream(micAudioTracks));
          micSource.connect(dest);
          
          const mixedTrack = dest.stream.getAudioTracks()[0];
          combinedStream.addTrack(mixedTrack);
          console.log('[Record] Successfully mixed system audio and mic into single track via AudioContext');
        } catch (mixErr) {
          console.warn('[Record] Failed to mix audio with AudioContext, falling back to track append:', mixErr);
          audioTracks.forEach((track) => combinedStream.addTrack(track));
          micAudioTracks.forEach((track) => combinedStream.addTrack(track));
        }
      } else {
        // Only microphone audio
        micAudioTracks.forEach((track) => combinedStream.addTrack(track));
      }

      mediaStream = combinedStream;
      audioTracks = mediaStream.getAudioTracks();
      console.log('[Record] Combined stream has', audioTracks.length, 'audio track(s)');
    }
  }
  
  const hasAudioTracks = audioTracks.length > 0;
  
  console.log('[Record] MediaRecorder setup:');
  console.log('[Record] - Video tracks:', videoTracks.length);
  console.log('[Record] - Audio tracks:', audioTracks.length);
  
  if (hasAudioTracks) {
    audioTracks.forEach((track, i) => {
      console.log(`[Record] - Audio track ${i + 1}:`, {
        label: track.label,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        settings: track.getSettings()
      });
    });
  }
  
  // Always try to use audio-capable codecs first
  // This ensures audio is recorded if tracks are present across all Chromium builds (Chrome, Brave, Edge, Opera, Yandex, Vivaldi, Linux Chromium)
  const audioCodecs = [
    'video/webm;codecs=vp09.02.10.10,opus',
    'video/webm;codecs=vp09.00.10.08,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4'
  ];
  
  const videoOnlyCodecs = [
    'video/webm;codecs=vp09.02.10.10',
    'video/webm;codecs=vp09.00.10.08',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1',
    'video/mp4'
  ];
  
  const codecsToTry = hasAudioTracks ? audioCodecs : videoOnlyCodecs;
  
  let selectedMimeType = '';
  if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
    for (const codec of codecsToTry) {
      try {
        if (MediaRecorder.isTypeSupported(codec)) {
          selectedMimeType = codec;
          console.log('[Record] Selected codec:', codec, hasAudioTracks ? '(with audio support)' : '(video only)');
          break;
        }
      } catch (_) {}
    }
  }
  
  const options = {
    ...(selectedMimeType ? { mimeType: selectedMimeType } : {}),
    videoBitsPerSecond: preset.bitrate
  };
  
  // Add audio bitrate if we have audio tracks
  if (hasAudioTracks) {
    options.audioBitsPerSecond = 320000; // 320 kbps broadcast studio quality
    console.log('[Record] Audio bitrate set to 320 kbps (studio quality)');
    
    // Log audio track settings for quality verification
    audioTracks.forEach((track, i) => {
      const settings = track.getSettings();
      console.log(`[Record] Audio track ${i + 1} quality settings:`, {
        sampleRate: settings.sampleRate,
        channelCount: settings.channelCount,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl
      });
    });
  }
  
  console.log('[Record] Final MediaRecorder options:', options);
  console.log('[Record] Stream will be recorded with:', {
    videoTracks: videoTracks.length,
    audioTracks: audioTracks.length,
    mimeType: options.mimeType
  });
  
  // Verify the stream has the tracks we expect
  if (hasAudioTracks) {
    const allAudioEnabled = audioTracks.every(track => track.enabled && track.readyState === 'live');
    if (!allAudioEnabled) {
      console.warn('[Record] ⚠️ Some audio tracks are not enabled or not live!');
      audioTracks.forEach((track, i) => {
        if (!track.enabled || track.readyState !== 'live') {
          console.warn(`[Record] Audio track ${i + 1} issue:`, {
            enabled: track.enabled,
            readyState: track.readyState
          });
        }
      });
    }
  }
  
  // Progressive MediaRecorder constructor fallback so hardware encoder limits or custom Chromium builds never fail
  try {
    mediaRecorder = new MediaRecorder(mediaStream, options);
  } catch (initErr1) {
    console.warn('[Record] Primary MediaRecorder options rejected, trying safe 25Mbps fallback:', initErr1);
    try {
      mediaRecorder = new MediaRecorder(mediaStream, {
        ...(selectedMimeType ? { mimeType: selectedMimeType } : {}),
        videoBitsPerSecond: Math.min(preset.bitrate, 25000000)
      });
    } catch (initErr2) {
      console.warn('[Record] Secondary MediaRecorder options rejected, trying default MediaRecorder:', initErr2);
      mediaRecorder = new MediaRecorder(mediaStream);
    }
  }
  selectedMimeType = (mediaRecorder && mediaRecorder.mimeType) ? mediaRecorder.mimeType : (selectedMimeType || 'video/webm');
  recordedChunks = [];
  let lastChunkLogTime = 0;

  // Set up synchronized webcam MediaRecorder when Face Cam is active
  recordedCameraChunks = [];
  cameraMediaRecorder = null;
  cameraRecordingFinalizePromise = null;
  if (hasCameraOverlay() && cameraVideoStream && cameraVideoStream.getVideoTracks().some(t => t.readyState === 'live')) {
    try {
      let camMimeType = '';
      if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
        for (const codec of videoOnlyCodecs) {
          try {
            if (MediaRecorder.isTypeSupported(codec)) {
              camMimeType = codec;
              break;
            }
          } catch (_) {}
        }
      }
      const camStream = new MediaStream(cameraVideoStream.getVideoTracks());
      try {
        cameraMediaRecorder = new MediaRecorder(camStream, {
          ...(camMimeType ? { mimeType: camMimeType } : {}),
          videoBitsPerSecond: 8000000 // 8 Mbps studio-grade webcam capture
        });
      } catch (_) {
        cameraMediaRecorder = new MediaRecorder(camStream);
      }
      camMimeType = (cameraMediaRecorder && cameraMediaRecorder.mimeType) ? cameraMediaRecorder.mimeType : (camMimeType || 'video/webm');
      cameraMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedCameraChunks.push(e.data);
        }
      };
      cameraRecordingFinalizePromise = new Promise((resolveCam) => {
        cameraMediaRecorder.onstop = async () => {
          try {
            await new Promise(r => setTimeout(r, 150));
            if (recordedCameraChunks.length > 0) {
              let camBlob = new Blob(recordedCameraChunks, { type: camMimeType });
              const camElapsedMs = getEffectiveRecordingElapsedMs();
              if (camBlob.size > 0 && camMimeType.includes('webm') && camElapsedMs > 0) {
                camBlob = await fixWebmDurationBlob(camBlob, camElapsedMs);
              }
              resolveCam(camBlob.size > 0 ? camBlob : null);
            } else {
              resolveCam(null);
            }
          } catch (camErr) {
            console.warn('[Record] Error finalizing camera blob:', camErr);
            resolveCam(null);
          }
        };
        cameraMediaRecorder.onerror = () => resolveCam(null);
      });
    } catch (camInitErr) {
      console.warn('[Record] Could not initialize cameraMediaRecorder:', camInitErr);
      cameraMediaRecorder = null;
      cameraRecordingFinalizePromise = null;
    }
  }
  
  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
      const now = Date.now();
      if (now - lastChunkLogTime > 6000) {
        lastChunkLogTime = now;
        console.log('[Record] Data chunk received. Total chunks:', recordedChunks.length);
      }
    }
  };
  
  mediaRecorder.onerror = (event) => {
    console.error('[Record] MediaRecorder error:', event.error);
    console.error('[Record] Error details:', {
      error: event.error,
      state: mediaRecorder.state
    });
    if (typeof showDiscordModal === 'function') {
      showDiscordModal({
        mode: 'crash',
        reason: 'mediarecorder-error',
        summary: 'MediaRecorder encountered an encoding error during screen recording.',
        details: `MediaRecorderError: ${event?.error?.name || 'Error'} — ${event?.error?.message || String(event?.error || 'Unknown error')}\nState: ${mediaRecorder?.state || 'unknown'}`
      });
    }
  };
  
  // Store references for use in callbacks
  const finalAudioTracks = audioTracks;
  const finalHasAudioTracks = hasAudioTracks;
  let resolveRecordingFinalize = null;
  recordingFinalizePromise = new Promise((resolve) => {
    resolveRecordingFinalize = resolve;
  });
  
  mediaRecorder.onstop = async () => {
    try {
      const hadCameraOverlay = hasCameraOverlay();
      if (cameraMediaRecorder && cameraMediaRecorder.state !== 'inactive') {
        try {
          cameraMediaRecorder.stop();
        } catch (e) {}
      }
      const preWaitChunks = recordedChunks.slice();
      console.log('[Record] MediaRecorder stopped. Total chunks (pre-wait):', preWaitChunks.length);
      console.log('[Record] MediaRecorder state:', mediaRecorder?.state);
      
      // Wait a bit for any final trailing data chunks from Chromium
      await new Promise(resolve => setTimeout(resolve, 350));
      
      const chunksToSave = recordedChunks.length >= preWaitChunks.length ? recordedChunks.slice() : preWaitChunks;
      
      // Verify we have data
      const totalSize = chunksToSave.reduce((sum, chunk) => sum + chunk.size, 0);
      console.log('[Record] Total recorded data:', totalSize, 'bytes', `(${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
      if (chunksToSave.length <= 20) {
        console.log('[Record] Chunk details:', chunksToSave.map((c, i) => `Chunk ${i + 1}: ${c.size} bytes`));
      } else {
        console.log('[Record] Sample first 5 chunks:', chunksToSave.slice(0, 5).map((c, i) => `Chunk ${i + 1}: ${c.size} bytes`));
      }
      
      if (totalSize === 0 || chunksToSave.length === 0) {
        console.error('[Record] ⚠️ ERROR: No data recorded!');
        console.error('[Record] MediaRecorder may not have captured any data. Possible causes:');
        console.error('[Record] - Recording was too short');
        console.error('[Record] - MediaRecorder failed silently');
        console.error('[Record] - No video/audio tracks were active');
        
        // Check track status
        if (mediaStream) {
          const videoTracks = mediaStream.getVideoTracks();
          const audioTracks = mediaStream.getAudioTracks();
          console.error('[Record] Stream status at stop:', {
            videoTracks: videoTracks.length,
            audioTracks: audioTracks.length,
            videoTrackStates: videoTracks.map(t => ({ enabled: t.enabled, readyState: t.readyState })),
            audioTrackStates: audioTracks.map(t => ({ enabled: t.enabled, readyState: t.readyState }))
          });
        }
        
        if (typeof showDiscordModal === 'function') {
          showDiscordModal({
            mode: 'crash',
            reason: 'empty-recording',
            summary: 'Recording failed because no video data was captured.',
            details: `NoDataCaptured: chunks=${chunksToSave.length}, totalSize=${totalSize}, mimeType=${selectedMimeType || 'video/webm'}, surface=${detectedDisplaySurface || 'unknown'}`
          });
        } else {
          alert('Recording failed: No data was captured. This may happen if:\n- The recording was too short\n- The screen share was stopped\n- There was an error during recording\n\nPlease try recording again.');
        }
        return;
      }
      
      const effectiveMimeType = selectedMimeType || 'video/webm';
      const blob = new Blob(chunksToSave, { type: effectiveMimeType });
      console.log('[Record] Created blob:', blob.size, 'bytes', `(${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
      console.log('[Record] Blob type:', blob.type);
      
      // Verify blob is valid
      if (blob.size === 0) {
        console.error('[Record] ⚠️ ERROR: Blob is empty even though chunks exist!');
        if (typeof showDiscordModal === 'function') {
          showDiscordModal({
            mode: 'crash',
            reason: 'empty-blob',
            summary: 'Recording failed because the generated video blob was empty (0 bytes).',
            details: `EmptyBlobError: chunks=${chunksToSave.length}, totalSize=${totalSize}, mimeType=${effectiveMimeType}`
          });
        } else {
          alert('Recording failed: Created blob is empty. Please try again.');
        }
        return;
      }
      
      // Validate blob has WebM magic bytes (for WebM files)
      if (effectiveMimeType.includes('webm')) {
        const firstBytes = await blob.slice(0, 4).arrayBuffer();
        const view = new Uint8Array(firstBytes);
        const magicBytes = Array.from(view).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log('[Record] Blob first 4 bytes (hex):', magicBytes);
        
        // WebM files should start with 0x1A 0x45 0xDF 0xA3 (EBML header)
        if (view[0] === 0x1A && view[1] === 0x45 && view[2] === 0xDF && view[3] === 0xA3) {
          console.log('[Record] ✅ Blob has valid WebM magic bytes');
        } else {
          console.warn('[Record] ⚠️ Blob does not have valid WebM magic bytes! This may indicate corruption.');
        }
      }
      
      // Log final audio track status
      if (finalHasAudioTracks) {
        console.log('[Record] Final audio track status:');
        finalAudioTracks.forEach((track, i) => {
          const trackInfo = {
            label: track.label,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState
          };
          console.log(`[Record] - Audio track ${i + 1}:`, trackInfo);
        });
      }
      
      // Calculate exact duration (excluding any time auto-paused on record.html)
      const elapsedMs = getEffectiveRecordingElapsedMs();
      const recordingDurationSec = elapsedMs / 1000;
      console.log('[Record] Recording duration:', recordingDurationSec.toFixed(2), 'seconds');

      let finalBlob = blob;
      if (effectiveMimeType.includes('webm')) {
        finalBlob = await fixWebmDurationBlob(blob, elapsedMs);
        console.log('[Record] ✅ WebM duration header patched with duration:', recordingDurationSec.toFixed(2), 's');
      }

      let finalCameraBlob = null;
      if (cameraRecordingFinalizePromise) {
        finalCameraBlob = await Promise.race([
          cameraRecordingFinalizePromise,
          new Promise(r => setTimeout(() => r(null), 3000))
        ]);
        cameraRecordingFinalizePromise = null;
      }

      await saveRecording(finalBlob, recordingDurationSec, hadCameraOverlay, finalCameraBlob);
    } finally {
      if (resolveRecordingFinalize) {
        resolveRecordingFinalize(true);
      }
    }
  };
  
  // Start recording
  try {
    mediaRecorder.start(1000); // Collect data every 1000ms (1s timeslice for stable memory across 10min to 10hr recordings)
    console.log('[Record] MediaRecorder.start(1000) called');
    if (cameraMediaRecorder && cameraMediaRecorder.state === 'inactive') {
      try {
        cameraMediaRecorder.start(1000);
        console.log('[Record] ✅ cameraMediaRecorder started in sync with screen MediaRecorder');
      } catch (camStartErr) {
        console.warn('[Record] Failed to start cameraMediaRecorder:', camStartErr);
      }
    }
    
    // Verify it actually started
    if (mediaRecorder.state === 'recording') {
      console.log('[Record] ✅ MediaRecorder is recording!');
    } else {
      console.warn('[Record] ⚠️ MediaRecorder state after start:', mediaRecorder.state);
    }
    
    // Monitor for errors during recording
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log('[Record] MediaRecorder still recording after 1 second');
        if (recordedChunks.length === 0) {
          console.warn('[Record] ⚠️ No data chunks received yet - this may be normal for very short recordings');
        }
      } else {
        console.error('[Record] ⚠️ MediaRecorder stopped unexpectedly! State:', mediaRecorder?.state);
      }
    }, 1000);
    
  } catch (error) {
    console.error('[Record] Failed to start MediaRecorder:', error);
    throw new Error('Failed to start recording: ' + error.message);
  }
}

/**
 * Pure JavaScript WebM EBML duration patcher.
 * Inserts or updates the EBML Duration element inside the Info element so the resulting
 * WebM file has a known, seekable duration in Chrome, VLC, QuickTime, and other media players.
 */
async function fixWebmDurationBlob(blob, durationMs) {
  if (!blob || !blob.type.includes('webm') || durationMs <= 0) {
    return blob;
  }
  // Safety guard for massive multi-gigabyte recordings (>1.5GB):
  // Calling arrayBuffer() on blobs >2GB will throw RangeError: Array buffer allocation failed.
  if (blob.size > 1.5 * 1024 * 1024 * 1024) {
    console.log('[Record] Large recording detected (>1.5GB); preserving blob directly to prevent memory exhaustion');
    return blob;
  }
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    function readId(offset) {
      const b0 = uint8Array[offset];
      let len = 1;
      let mask = 0x80;
      while (len <= 4 && !(b0 & mask)) {
        len++;
        mask >>= 1;
      }
      let id = 0;
      for (let i = 0; i < len; i++) {
        id = (id * 256) + uint8Array[offset + i];
      }
      return { id, length: len };
    }

    function readSize(offset) {
      const b0 = uint8Array[offset];
      let len = 1;
      let mask = 0x80;
      while (len <= 8 && !(b0 & mask)) {
        len++;
        mask >>= 1;
      }
      let size = b0 & ~mask;
      for (let i = 1; i < len; i++) {
        size = (size * 256) + uint8Array[offset + i];
      }
      return { size, length: len };
    }

    if (uint8Array.length < 16) return blob;
    const headerId = readId(0);
    if (headerId.id !== 0x1A45DFA3) return blob;

    const headerSize = readSize(headerId.length);
    let pos = headerId.length + headerSize.length + headerSize.size;

    const segId = readId(pos);
    if (segId.id !== 0x18538067) return blob;

    pos += segId.length;
    const segSize = readSize(pos);
    pos += segSize.length;

    const searchLimit = Math.min(uint8Array.length, pos + 65536);
    let infoOffset = -1;
    let infoSizeObj = null;

    while (pos + 8 < searchLimit) {
      const el = readId(pos);
      const sizeObj = readSize(pos + el.length);
      if (el.id === 0x1549A966) {
        infoOffset = pos;
        infoSizeObj = sizeObj;
        break;
      }
      pos += el.length + sizeObj.length + sizeObj.size;
    }

    if (infoOffset === -1 || !infoSizeObj) return blob;

    const infoDataStart = infoOffset + 4 + infoSizeObj.length;
    const infoDataEnd = infoDataStart + infoSizeObj.size;

    let scanPos = infoDataStart;
    let timecodeScale = 1000000; // default 1ms
    let durationOffset = -1;
    let durationSize = 0;

    while (scanPos < infoDataEnd) {
      const el = readId(scanPos);
      const sz = readSize(scanPos + el.length);
      if (el.id === 0x2AD7B1) {
        let val = 0;
        for (let i = 0; i < sz.size; i++) {
          val = (val * 256) + uint8Array[scanPos + el.length + sz.length + i];
        }
        if (val > 0) timecodeScale = val;
      } else if (el.id === 0x4489) {
        durationOffset = scanPos + el.length + sz.length;
        durationSize = sz.size;
        break;
      }
      scanPos += el.length + sz.length + sz.size;
    }

    const durationInUnits = (durationMs * 1000000) / timecodeScale;

    if (durationOffset !== -1) {
      const dv = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
      if (durationSize === 4) {
        dv.setFloat32(durationOffset, durationInUnits, false);
      } else if (durationSize === 8) {
        dv.setFloat64(durationOffset, durationInUnits, false);
      }
      return new Blob([uint8Array], { type: blob.type });
    }

    // Insert 11-byte Duration element into Info
    const durElem = new Uint8Array(11);
    durElem[0] = 0x44;
    durElem[1] = 0x89;
    durElem[2] = 0x88; // 8 bytes Float64
    const dvDur = new DataView(durElem.buffer);
    dvDur.setFloat64(3, durationInUnits, false);

    const newInfoSize = infoSizeObj.size + 11;
    let newSizeVint;
    if (infoSizeObj.length === 1 && newInfoSize < 127) {
      newSizeVint = new Uint8Array([0x80 | newInfoSize]);
    } else if (infoSizeObj.length === 2 && newInfoSize < 16383) {
      newSizeVint = new Uint8Array([0x40 | (newInfoSize >> 8), newInfoSize & 0xFF]);
    } else {
      newSizeVint = new Uint8Array([
        0x10 | ((newInfoSize >> 24) & 0x0F),
        (newInfoSize >> 16) & 0xFF,
        (newInfoSize >> 8) & 0xFF,
        newInfoSize & 0xFF
      ]);
    }

    const part1 = uint8Array.subarray(0, infoOffset + 4);
    const part4 = uint8Array.subarray(infoDataStart);

    const totalLen = part1.length + newSizeVint.length + durElem.length + part4.length;
    const result = new Uint8Array(totalLen);
    let cur = 0;
    result.set(part1, cur); cur += part1.length;
    result.set(newSizeVint, cur); cur += newSizeVint.length;
    result.set(durElem, cur); cur += durElem.length;
    result.set(part4, cur);

    return new Blob([result], { type: blob.type });
  } catch (err) {
    console.warn('[WebM] Could not patch duration header:', err);
    return blob;
  }
}

// Store video in IndexedDB with auto-pruning to keep storage bounded
async function storeVideoInIndexedDB(videoId, blob, protectedKeys = []) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('CursorDemoVideoStorage', 1);
    
    request.onerror = () => reject(new Error('Failed to open IndexedDB'));
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['videos'], 'readwrite');
      const store = transaction.objectStore('videos');
      const putRequest = store.put({ id: videoId, blob: blob, timestamp: Date.now() });
      
      putRequest.onsuccess = () => {
        // Auto-prune older recordings: keep the most recent 10 entries (protecting current screen + camera pair)
        try {
          const getAllKeysReq = store.getAllKeys();
          getAllKeysReq.onsuccess = () => {
            const keys = getAllKeysReq.result || [];
            if (keys.length > 10) {
              const protectedSet = new Set([videoId, ...(Array.isArray(protectedKeys) ? protectedKeys : [])]);
              const keysToDelete = keys.slice(0, keys.length - 10);
              keysToDelete.forEach(k => {
                if (!protectedSet.has(k)) store.delete(k);
              });
              console.log('[Record] IndexedDB auto-pruned', keysToDelete.length, 'older entries');
            }
          };
        } catch (pruneErr) {
          console.warn('[Record] IndexedDB pruning skipped:', pruneErr);
        }
        resolve();
      };
      putRequest.onerror = () => reject(new Error('Failed to store video in IndexedDB'));
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos', { keyPath: 'id' });
      }
    };
  });
}

let recordingFinalizePromise = null;
let isStoppingRecording = false;

async function saveRecording(blob, durationSec = 0, cameraOverlayFlag = undefined, cameraBlob = null) {
  try {
    console.log('[Record] Saving recording...');
    console.log('[Record] Blob to save:', blob.size, 'bytes', `(${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
    
    // Validate blob
    if (!blob || blob.size === 0) {
      throw new Error('Cannot save empty blob');
    }
    
    // Get video dimensions (fall back to cached dimensions if track already ended via native "Stop sharing")
    let videoWidth = detectedVideoWidth || 1920;
    let videoHeight = detectedVideoHeight || 1080;
    let displaySurface = detectedDisplaySurface || 'monitor';
    
    if (mediaStream) {
      const videoTrack = mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        videoWidth = settings.width || detectedVideoWidth || 1920;
        videoHeight = settings.height || detectedVideoHeight || 1080;
        if (settings.displaySurface) {
          displaySurface = settings.displaySurface;
        }
      }
    }
    
    console.log('[Record] Video dimensions:', videoWidth, 'x', videoHeight, 'Surface:', displaySurface, 'Duration:', durationSec);
    
    // Always store directly in IndexedDB: instant, zero-copy, bypasses 64MB IPC limit and base64 bloat
    const videoId = 'video_' + Date.now();
    const cameraVideoId = (cameraBlob && cameraBlob.size > 0) ? (videoId + '_cam') : null;
    const metaId = videoId + '_meta';
    const protectedIds = cameraVideoId ? [videoId, cameraVideoId, metaId] : [videoId, metaId];
    await storeVideoInIndexedDB(videoId, blob, protectedIds);
    if (cameraVideoId && cameraBlob) {
      await storeVideoInIndexedDB(cameraVideoId, cameraBlob, protectedIds);
      console.log('[Record] Camera video stored in IndexedDB with ID:', cameraVideoId, 'size:', cameraBlob.size);
    }
    lastRecordedVideoId = videoId;
    console.log('[Record] Video stored in IndexedDB with ID:', videoId);
    
    // Send lightweight reference to background
    const storeResponse = await chrome.runtime.sendMessage({
      action: 'storeVideoBlob',
      videoId: videoId,
      cameraVideoId: cameraVideoId,
      useIndexedDB: true,
      size: blob.size,
      width: videoWidth,
      height: videoHeight,
      duration: durationSec,
      displaySurface: displaySurface,
      cameraOverlayEnabled: cameraOverlayFlag !== undefined ? cameraOverlayFlag : hasCameraOverlay()
    });
    
    if (!storeResponse || !storeResponse.success) {
      throw new Error('Failed to store video reference in background: ' + (storeResponse?.error || 'Unknown error'));
    }
    
    console.log('[Record] ✅ Video stored successfully!');
    
    // Notify background that recording is complete
    await chrome.runtime.sendMessage({ action: 'recordingStopped' });

    // Also persist session metadata + cursorData snapshot in IndexedDB under videoId + '_meta'
    // so editor.js can always recover cursorData even if service worker or chrome.storage.local is cleared
    try {
      const recData = await chrome.runtime.sendMessage({ action: 'getRecordingData' }).catch(() => null);
      const metaPayload = {
        videoId,
        cameraVideoId,
        videoWidth,
        videoHeight,
        duration: durationSec,
        displaySurface,
        cameraOverlayEnabled: cameraOverlayFlag !== undefined ? cameraOverlayFlag : hasCameraOverlay(),
        cursorData: (recData && Array.isArray(recData.cursorData)) ? recData.cursorData : [],
        timestamp: Date.now()
      };
      const metaBlob = new Blob([JSON.stringify(metaPayload)], { type: 'application/json' });
      await storeVideoInIndexedDB(metaId, metaBlob, protectedIds).catch(() => {});
    } catch (_) {}

    try {
      localStorage.removeItem('cursordemo.recordingInProgress');
    } catch (_) {}
    
  } catch (error) {
    console.error('[Record] Error saving recording:', error);
    console.error('[Record] Error stack:', error.stack);
    try {
      localStorage.removeItem('cursordemo.recordingInProgress');
    } catch (_) {}
    if (typeof showDiscordModal === 'function') {
      showDiscordModal({
        mode: 'crash',
        reason: 'save-recording-error',
        title: 'Failed to Save Recording',
        summary: 'CursorDemo encountered an error while saving your recording to local storage.',
        details: `SaveRecordingError: ${error.message || 'Unknown error'}\nStack: ${error.stack || 'n/a'}`
      });
    } else {
      alert('Failed to save recording: ' + (error.message || 'Unknown error') + '\n\nPlease try recording again.');
    }
    throw error;
  }
}

// Stop Recording
async function stopRecording() {
  if (isStoppingRecording) {
    console.log('[Record] stopRecording already in progress, skipping duplicate call');
    return;
  }
  isStoppingRecording = true;
  try {
    console.log('[Record] Stopping recording...');
    stopRecordingBtn.disabled = true;
    stopRecordingBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.spinner}</span> Stopping...`;

    clearInterval(timerInterval);
    stopKeepAlive();
    isRecording = false;
    
    // Stop cursor tracking on target tab and all open scriptable tabs
    try {
      if (tabId && !isNaN(tabId)) {
        chrome.tabs.sendMessage(tabId, { action: 'stopTracking' }).catch(() => {});
      }
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        const allTabs = await chrome.tabs.query({}).catch(() => []);
        for (const t of allTabs) {
          if (t && t.id && t.url && !isUnsupportedWebsite(t.url)) {
            chrome.tabs.sendMessage(t.id, { action: 'stopTracking' }).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.log('[Record] Could not stop tracking (tab may be restricted)');
    }

    // Stop the MediaRecorder if still active, and ALWAYS await recordingFinalizePromise
    // (critical when user clicks Chrome's native "Stop sharing" bar, which transitions
    // mediaRecorder.state to 'inactive' and fires onstop asynchronously at the same time)
    if (cameraMediaRecorder && cameraMediaRecorder.state !== 'inactive') {
      try {
        cameraMediaRecorder.stop();
      } catch (e) {
        console.warn('[Record] cameraMediaRecorder.stop() error:', e);
      }
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      console.log('[Record] Stopping MediaRecorder, current state:', mediaRecorder.state);
      try {
        mediaRecorder.stop();
      } catch (e) {
        console.warn('[Record] mediaRecorder.stop() error:', e);
      }
    }
    if (recordingFinalizePromise) {
      console.log('[Record] Waiting for MediaRecorder onstop & saveRecording to finalize...');
      await Promise.race([
        recordingFinalizePromise,
        new Promise(resolve => setTimeout(() => {
          console.warn('[Record] recordingFinalizePromise timeout after 12 seconds');
          resolve(false);
        }, 12000))
      ]);
      recordingFinalizePromise = null;
    }
    
    // Now stop all tracks (after MediaRecorder has finished and saved chunks)
    if (mediaStream) {
      console.log('[Record] Stopping media stream tracks...');
      mediaStream.getTracks().forEach(track => {
        track.onended = null;
        track.stop();
        console.log('[Record] Stopped track:', track.kind, track.label);
      });
      mediaStream = null;
    }
    
    // Clean up recording AudioContext if created
    if (window.recordingAudioContext) {
      try {
        window.recordingAudioContext.close();
      } catch (e) {}
      window.recordingAudioContext = null;
    }
    
    // Hide camera overlay
    if (cameraOverlay) {
      cameraOverlay.classList.remove('active');
      if (cameraOverlayVideo) {
        cameraOverlayVideo.srcObject = null;
      }
    }
    
    // Stop camera frame sender if it was active
    if (window.cameraFrameSender) {
      clearInterval(window.cameraFrameSender);
      window.cameraFrameSender = null;
    }
    
    // Clean up camera frame capture resources
    if (window.cameraFrameVideo) {
      window.cameraFrameVideo.pause();
      window.cameraFrameVideo.srcObject = null;
      window.cameraFrameVideo = null;
    }
    if (window.cameraFrameCanvas) {
      // Clear canvas
      if (window.cameraFrameCtx) {
        window.cameraFrameCtx.clearRect(0, 0, window.cameraFrameCanvas.width, window.cameraFrameCanvas.height);
      }
      window.cameraFrameCanvas = null;
      window.cameraFrameCtx = null;
    }
    
    // Stop optional camera / microphone streams
    if (cameraVideoStream || micStream) {
      console.log('[Record] Stopping optional camera/mic tracks...');
      resetOptionalMediaUI();
    }
    
    // Clean up MediaRecorder and chunks
    if (mediaRecorder) {
      mediaRecorder = null;
    }
    if (cameraMediaRecorder) {
      cameraMediaRecorder = null;
    }
    recordedChunks = [];
    recordedCameraChunks = [];

    // Wait for video to be ready
    console.log('[Record] Waiting for video data to be stored...');
    
    let dataReady = false;
    let attempts = 0;
    const maxAttempts = 50; // Increased timeout
    
    while (!dataReady && attempts < maxAttempts) {
      if (attempts > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      try {
        const checkResponse = await chrome.runtime.sendMessage({
          action: 'getRecordingData'
        });
        
        if (checkResponse && checkResponse.videoDataReady && checkResponse.videoData) {
          dataReady = true;
          debugLog('[Record] ✅ Video data ready!');
          debugLog('[Record] Video data size:', checkResponse.videoData.length, 'chars');
          // Cursor data points tracked
          openEditor();
          break;
        } else {
          console.log(`[Record] Waiting for video data... (attempt ${attempts + 1}/${maxAttempts})`);
          if (checkResponse) {
            console.log('[Record] Response status:', {
              videoDataReady: checkResponse.videoDataReady,
              hasVideoData: !!checkResponse.videoData,
              videoDataLength: checkResponse.videoData?.length || 0
            });
          }
        }
      } catch (e) {
        console.warn('[Record] Error checking data:', e);
      }
      
      attempts++;
    }
    
    if (!dataReady) {
      console.error('[Record] ⚠️ Timeout waiting for video data');
      const finalCheck = await chrome.runtime.sendMessage({ action: 'getRecordingData' });
      if (finalCheck && finalCheck.videoData) {
        console.log('[Record] Video data found on final check, opening editor');
        openEditor();
      } else {
        throw new Error('Recording did not complete. The video data was not saved. Please try recording again.');
      }
    }
    
  } catch (error) {
    console.error('[Record] Stop recording error:', error);
    try {
      localStorage.removeItem('cursordemo.recordingInProgress');
    } catch (_) {}
    if (typeof showDiscordModal === 'function') {
      showDiscordModal({
        mode: 'crash',
        reason: 'stop-recording-error',
        title: 'Recording Failed to Finalize',
        summary: error.message || 'An unexpected error occurred while stopping the recording.',
        details: `StopRecordingError: ${error.message || String(error)}\nSurface: ${detectedDisplaySurface || 'unknown'}\nBrowser: ${RUNTIME_ENV.browserName} (${RUNTIME_ENV.osLabel})`
      });
    } else {
      alert('Error: ' + error.message);
    }
    
    stopRecordingBtn.disabled = false;
    stopRecordingBtn.innerHTML = `<span class="btn-icon">${UI_ICONS.stop}</span> Stop Recording & Open Editor`;
    if (!isRecording && !mediaStream) {
      if (recordingOverlay) recordingOverlay.classList.remove('active');
      resetUI();
    }
  } finally {
    isStoppingRecording = false;
  }
}

// Open Editor
function openEditor() {
  console.log('[Record] Opening editor with videoId:', lastRecordedVideoId);
  try {
    localStorage.removeItem('cursordemo.recordingInProgress');
  } catch (_) {}
  const editorUrl = chrome.runtime.getURL(lastRecordedVideoId ? `editor.html?videoId=${lastRecordedVideoId}` : 'editor.html');
  chrome.tabs.create({ url: editorUrl }, (tab) => {
    console.log('[Record] Editor opened in tab:', tab.id);
    // Close this recording page
    setTimeout(() => window.close(), 500);
  });
}

// Update Timer
function updateTimer() {
  const elapsed = getEffectiveRecordingElapsedMs();
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  timer.textContent = `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

// Listen for recording stopped message (from extension icon click)
if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'recordingStopped') {
      console.log('[Record] Recording stopped notification received');
      if (isRecording) {
        stopRecording();
      }
    }
  });
}

// Handle page visibility - auto-pause capture when returning to record.html during Entire Screen / Window
// recording so clicking "Stop Recording & Open Editor" never burns the last 1-2 seconds of record.html into the video
document.addEventListener('visibilitychange', () => {
  if (!isRecording || isStoppingRecording) return;
  if (document.visibilityState === 'hidden') {
    hasLeftRecordPageDuringRecording = true;
    if (autoPausedOnRecordTab) {
      if (autoPausedAt > 0) {
        totalAutoPausedMs += Math.max(0, Date.now() - autoPausedAt);
      }
      autoPausedOnRecordTab = false;
      autoPausedAt = 0;
      if (mediaRecorder && mediaRecorder.state === 'paused' && typeof mediaRecorder.resume === 'function') {
        try { mediaRecorder.resume(); } catch (_) {}
      }
      if (cameraMediaRecorder && cameraMediaRecorder.state === 'paused' && typeof cameraMediaRecorder.resume === 'function') {
        try { cameraMediaRecorder.resume(); } catch (_) {}
      }
      console.log('[Record] Resumed MediaRecorder after leaving record.html');
    }
  } else if (document.visibilityState === 'visible') {
    if (hasLeftRecordPageDuringRecording && detectedDisplaySurface !== 'browser' && !autoPausedOnRecordTab) {
      if (mediaRecorder && mediaRecorder.state === 'recording' && typeof mediaRecorder.pause === 'function') {
        try {
          mediaRecorder.pause();
          autoPausedOnRecordTab = true;
          autoPausedAt = Date.now();
          console.log('[Record] Auto-paused MediaRecorder while record.html is in foreground');
        } catch (_) {}
      }
      if (cameraMediaRecorder && cameraMediaRecorder.state === 'recording' && typeof cameraMediaRecorder.pause === 'function') {
        try { cameraMediaRecorder.pause(); } catch (_) {}
      }
    }
    recordingOverlay.classList.add('active');
  }
});

// Handle page unload
window.addEventListener('beforeunload', () => {
  if (isRecording) {
    if (cameraMediaRecorder && cameraMediaRecorder.state !== 'inactive') {
      try { cameraMediaRecorder.stop(); } catch (_) {}
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
    }
    if (cameraVideoStream) {
      cameraVideoStream.getTracks().forEach(track => track.stop());
    }
  }
});

// Restore and persist user-selected recording quality preset
try {
  chrome.storage?.local?.get(['preferredRecordingQuality'], (res) => {
    if (res?.preferredRecordingQuality) {
      const el = document.getElementById('recordingQualitySelect');
      if (el) el.value = res.preferredRecordingQuality;
    }
  });

  document.getElementById('recordingQualitySelect')?.addEventListener('change', (e) => {
    chrome.storage?.local?.set({ preferredRecordingQuality: e.target.value });
  });
} catch (e) {
  console.warn('[Record] Failed to load/save quality preset from storage:', e);
}

// ========== WELCOME PAGE & DISCORD SUPPORT / CRASH MODAL CONTROLLER ==========
function syncAllDiscordLinks() {
  document.querySelectorAll('[data-discord-link="true"]').forEach((el) => {
    el.setAttribute('href', DISCORD_INVITE_URL);
  });
}

function openWelcomeModal() {
  const modal = document.getElementById('welcomeModal');
  if (!modal) return;
  syncAllDiscordLinks();
  modal.classList.remove('hidden');
}

function closeWelcomeModal() {
  const modal = document.getElementById('welcomeModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  try {
    localStorage.setItem('cursordemo.welcomeSeen', 'true');
  } catch (_) {}
}

function dismissWelcomeBanner() {
  const banner = document.getElementById('welcomeBanner');
  if (banner) {
    banner.classList.add('hidden');
  }
  try {
    localStorage.setItem('cursordemo.welcomeBannerDismissed', 'true');
  } catch (_) {}
}

function showDiscordModal(options = {}) {
  const modal = document.getElementById('discordModal');
  if (!modal) return;
  syncAllDiscordLinks();

  const mode = options.mode || 'support'; // 'crash' | 'milestone' | 'support'
  const isCrash = mode === 'crash';
  const banner = document.getElementById('discordModalBanner');
  const badge = document.getElementById('discordModalBadge');
  const title = document.getElementById('discordModalTitle');
  const subtitle = document.getElementById('discordModalSubtitle');
  const crashBox = document.getElementById('discordCrashBox');
  const crashTitle = document.getElementById('discordCrashTitle');
  const crashSummary = document.getElementById('discordCrashSummary');
  const crashDetails = document.getElementById('discordCrashDetails');
  const joinBtnText = document.getElementById('discordModalJoinBtnText');
  const feedbackInput = document.getElementById('discordFeedbackInput');

  if (banner) {
    banner.classList.toggle('is-crash', isCrash);
  }
  if (badge) {
    badge.textContent = isCrash
      ? '⚠️ Issue Detected — Instant Support'
      : (mode === 'milestone' ? '🎉 Creator Milestone • 3+ Downloads' : '💬 CursorDemo Community');
  }
  if (title) {
    title.textContent = options.title || (isCrash
      ? 'Something Crashed or Didn\'t Work? Join Our Discord!'
      : 'Join our Discord for Support & Feature Requests');
  }
  if (subtitle) {
    subtitle.textContent = options.subtitle || (isCrash
      ? 'We detected an unexpected issue. Join our Discord community for fast troubleshooting from the developers or to request features.'
      : 'Get fast help from the developers, report bugs, and request new studio features.');
  }
  if (joinBtnText) {
    joinBtnText.textContent = isCrash
      ? '💬 Join Discord for Instant Support & Fixes →'
      : '💬 Join Discord for Support & Feature Requests →';
  }

  if (crashBox) {
    if (isCrash) {
      crashBox.classList.remove('hidden');
      if (crashTitle) {
        crashTitle.textContent = options.reason
          ? `⚠️ Diagnostic Report (${options.reason})`
          : '⚠️ Issue Detected — Diagnostic Info';
      }
      if (crashSummary) {
        crashSummary.textContent = options.summary || options.error ||
          'Something didn\'t work as expected. Copy the details below and share them in our Discord #support channel for an instant fix.';
      }
      if (crashDetails) {
        const diagLines = [
          options.details || options.error || options.summary || 'Unexpected recording error',
          `Browser: ${RUNTIME_ENV.browserName} (${RUNTIME_ENV.osLabel})`,
          `Surface: ${detectedDisplaySurface || 'monitor'}`,
          `Timestamp: ${new Date().toISOString()}`
        ];
        crashDetails.textContent = diagLines.join('\n');
      }
    } else {
      crashBox.classList.add('hidden');
    }
  }

  if (feedbackInput && options.prefillFeedback) {
    feedbackInput.value = options.prefillFeedback;
  }

  modal.classList.remove('hidden');
}

function closeDiscordModal(dismissPermanently = false) {
  const modal = document.getElementById('discordModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  if (dismissPermanently) {
    try {
      localStorage.setItem('cursordemo.discordPromptDismissed', 'true');
      localStorage.setItem('cursordemo.discordPromptShown', 'true');
    } catch (_) {}
  }
}

function setupDiscordAndWelcomeUI() {
  syncAllDiscordLinks();

  // Welcome banner & modal controls
  const welcomeBanner = document.getElementById('welcomeBanner');
  try {
    if (localStorage.getItem('cursordemo.welcomeBannerDismissed') === 'true' && !urlParams.get('welcome')) {
      welcomeBanner?.classList.add('hidden');
    }
  } catch (_) {}

  document.getElementById('dismissWelcomeBannerBtn')?.addEventListener('click', dismissWelcomeBanner);
  document.getElementById('openWelcomeModalBtn')?.addEventListener('click', openWelcomeModal);
  document.getElementById('closeWelcomeModal')?.addEventListener('click', closeWelcomeModal);
  document.getElementById('welcomeModalBackdrop')?.addEventListener('click', closeWelcomeModal);
  document.getElementById('welcomeStartRecordingBtn')?.addEventListener('click', () => {
    closeWelcomeModal();
    selectScreenBtn?.focus();
  });

  // Auto-open Welcome modal on ?welcome=1 install redirect
  try {
    if (urlParams.get('welcome') === '1' && localStorage.getItem('cursordemo.welcomeSeen') !== 'true') {
      openWelcomeModal();
    }
  } catch (_) {}

  // Discord modal controls
  document.getElementById('openRecordDiscordModalBtn')?.addEventListener('click', () => {
    showDiscordModal({ mode: 'support' });
  });
  document.getElementById('closeDiscordModal')?.addEventListener('click', () => closeDiscordModal(false));
  document.getElementById('discordModalBackdrop')?.addEventListener('click', () => closeDiscordModal(false));
  document.getElementById('discordMaybeLaterBtn')?.addEventListener('click', () => closeDiscordModal(false));
  document.getElementById('discordDontAskBtn')?.addEventListener('click', () => closeDiscordModal(true));

  const copyBtn = document.getElementById('discordCopyErrorBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const detailsEl = document.getElementById('discordCrashDetails');
      const feedbackEl = document.getElementById('discordFeedbackInput');
      const textToCopy = [
        detailsEl?.textContent || '',
        feedbackEl?.value ? `User Note: ${feedbackEl.value.trim()}` : ''
      ].filter(Boolean).join('\n\n');
      try {
        if (navigator.clipboard?.writeText && textToCopy) {
          await navigator.clipboard.writeText(textToCopy);
          copyBtn.textContent = '✓ Copied to Clipboard!';
          setTimeout(() => { copyBtn.textContent = '📋 Copy Error Details'; }, 2000);
        }
      } catch (_) {}
    });
  }

  document.getElementById('discordModalJoinBtn')?.addEventListener('click', () => {
    const detailsEl = document.getElementById('discordCrashDetails');
    const feedbackEl = document.getElementById('discordFeedbackInput');
    const note = feedbackEl?.value?.trim() || '';
    const details = detailsEl?.textContent?.trim() || '';
    if (note || details) {
      try {
        const combined = [note ? `Feature Request / Issue: ${note}` : '', details].filter(Boolean).join('\n\n');
        navigator.clipboard?.writeText?.(combined).catch(() => {});
        localStorage.setItem('cursordemo.lastDiscordNote', combined);
      } catch (_) {}
    }
    setTimeout(() => closeDiscordModal(false), 150);
  });

  // Detect if a previous recording or export crashed / was interrupted unexpectedly
  try {
    const staleRecording = localStorage.getItem('cursordemo.recordingInProgress');
    if (staleRecording && !isRecording) {
      localStorage.removeItem('cursordemo.recordingInProgress');
      let parsed = {};
      try { parsed = JSON.parse(staleRecording) || {}; } catch (_) {}
      showDiscordModal({
        mode: 'crash',
        reason: 'interrupted-recording',
        title: 'Previous Recording Was Interrupted or Crashed',
        summary: 'It looks like your last recording session ended unexpectedly before saving. Join our Discord for support or to report what happened!',
        details: `InterruptedRecordingSession: surface=${parsed.displaySurface || 'unknown'}, quality=${parsed.quality || 'auto'}, startedAt=${parsed.startedAt ? new Date(parsed.startedAt).toISOString() : 'unknown'}`
      });
    }
  } catch (_) {}

  // Global runtime crash / unhandled rejection detector on record.html
  window.addEventListener('error', (event) => {
    const msg = event?.message || String(event?.error || '');
    if (!msg || msg.includes('ResizeObserver')) return;
    showDiscordModal({
      mode: 'crash',
      reason: 'runtime-error',
      title: 'Unexpected Recorder Error Detected',
      summary: 'Something crashed or didn\'t work as expected. Join our Discord for instant help from the team.',
      details: `RuntimeError: ${msg}\nFile: ${event?.filename || 'record.js'}:${event?.lineno || 0}`
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const msg = reason?.message || String(reason || '');
    if (!msg || msg.includes('Extension context invalidated') || msg.includes('Receiving end does not exist')) return;
    showDiscordModal({
      mode: 'crash',
      reason: 'unhandled-rejection',
      title: 'Unexpected Recorder Error Detected',
      summary: 'An operation failed unexpectedly. Join our Discord community for support or to report a bug.',
      details: `UnhandledRejection: ${msg}`
    });
  });
}

setupDiscordAndWelcomeUI();

if (typeof window !== 'undefined') {
  window.showDiscordModal = showDiscordModal;
  window.closeDiscordModal = closeDiscordModal;
  window.openWelcomeModal = openWelcomeModal;
  window.closeWelcomeModal = closeWelcomeModal;
  window.dismissWelcomeBanner = dismissWelcomeBanner;
}

