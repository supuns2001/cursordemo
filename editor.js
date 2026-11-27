/**
 * CursorDemo Screen Recorder
 * Copyright (c) 2026 CursorDemo Contributors
 * GitHub: https://github.com/cursordemo/cursordemo-screen-recorder
 *
 * Licensed under the MIT License.
 */

// Editor Page Controller - CursorDemo Studio Editor with full features
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

// Studio vector icon helper for clean inline SVG references
function studioIcon(name, size = 14, extraClass = '', extraStyle = '') {
  const cls = extraClass ? `studio-icon ${extraClass}` : 'studio-icon';
  const st = extraStyle ? ` style="${extraStyle}"` : '';
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24"${st} aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

// Retrieve video from IndexedDB (with backward-compatible fallback to legacy CursorFlyVideoStorage)
function getVideoFromIndexedDBByName(dbName, videoId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);

    request.onerror = () => reject(new Error(`Failed to open IndexedDB (${dbName})`));
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('videos')) {
        db.close();
        reject(new Error(`Store 'videos' not found in ${dbName}`));
        return;
      }
      const transaction = db.transaction(['videos'], 'readonly');
      const store = transaction.objectStore('videos');
      const getRequest = store.get(videoId);

      getRequest.onsuccess = (e) => {
        const result = e.target.result;
        db.close();
        if (result && result.blob) {
          resolve(result.blob);
        } else {
          reject(new Error('Video not found in IndexedDB'));
        }
      };

      getRequest.onerror = () => {
        db.close();
        reject(new Error('Failed to retrieve video from IndexedDB'));
      };
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos', { keyPath: 'id' });
      }
    };
  });
}

async function retrieveVideoFromIndexedDB(videoId) {
  try {
    return await getVideoFromIndexedDBByName('CursorDemoVideoStorage', videoId);
  } catch (primaryErr) {
    try {
      return await getVideoFromIndexedDBByName('CursorFlyVideoStorage', videoId);
    } catch (_) {
      throw primaryErr;
    }
  }
}

// State
let cursorData = [];
let zoomSegments = [];
let blurRegions = [];
let videoWidth = 1920;
let videoHeight = 1080;
let videoDuration = 0; // Canonical duration in seconds (immune to WebM Infinity bug)
let displaySurface = null; // 'monitor', 'window', or 'browser' (tab)
let isPlaying = false;

function getVideoDuration() {
  if (video && isFinite(video.duration) && video.duration > 0) {
    return video.duration;
  }
  if (videoDuration && isFinite(videoDuration) && videoDuration > 0) {
    return videoDuration;
  }
  return 0;
}
let animationFrameId = null;
let videoLoaded = false;
let selectedZoomIndex = -1;
let selectedBlurIndex = -1;
let isDrawBlurMode = false;
let isDraggingBlurBox = false;
let blurDragAction = null; // 'move' | 'draw' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
let blurDragStartMouseX = 0;
let blurDragStartMouseY = 0;
let blurDragInitialRect = null;
let _lastRenderedBlurScreenRects = [];
let _blurMosaicCanvas = null;

let trimHandles = { start: 0, end: 1 };
let undoStack = [];
let redoStack = [];
let cameraOverlayEnabled = false; // Store camera overlay flag at module level
let currentVideoBlob = null; // Store active video blob for export
let currentVideoId = null; // Store active IndexedDB videoId for recovery
let currentVideoTitle = 'Studio Recording'; // Active project/recording title
let currentCameraBlob = null; // Store active synchronized webcam blob for preview & export
let cameraVideo = null; // Offscreen video element for Face Cam compositing
let cameraVideoLoaded = false;
let demoWebcamEnabled = false; // Synthetic 1:1 Studio Test Cam when no recorded camera track exists
let _demoWebcamCanvas = null;
let _lastWebcamRect = null; // Bounding box of Face Cam on previewCanvas
let _webcamDodgeX = null;
let _webcamDodgeY = null;
let _webcamDodgeScale = 1.0;
let _webcamDodgeSettled = true;

window.__getEditorState = () => ({
  cursorData,
  zoomSegments,
  blurRegions,
  videoWidth,
  videoHeight,
  videoLoaded,
  selectedZoomIndex,
  selectedBlurIndex,
  isDrawBlurMode,
  settings,
  analyzer,
  cameraOverlayEnabled,
  cameraVideoLoaded,
  demoWebcamEnabled,
  cameraVideo,
  currentCameraBlob,
  lastWebcamRect: _lastWebcamRect,
  webcamDodgeSettled: _webcamDodgeSettled,
  lastRenderedBlurScreenRects: _lastRenderedBlurScreenRects
});
window.__setEditorState = (patch) => {
  if (patch.cursorData !== undefined) {
    cursorData = patch.cursorData;
    if (analyzer) analyzer.cursorData = cursorData;
  }
  if (patch.zoomSegments !== undefined) zoomSegments = patch.zoomSegments;
  if (patch.blurRegions !== undefined) blurRegions = patch.blurRegions;
  if (patch.videoLoaded !== undefined) videoLoaded = patch.videoLoaded;
  if (patch.selectedZoomIndex !== undefined) selectedZoomIndex = patch.selectedZoomIndex;
  if (patch.selectedBlurIndex !== undefined) selectedBlurIndex = patch.selectedBlurIndex;
  if (patch.isDrawBlurMode !== undefined) isDrawBlurMode = patch.isDrawBlurMode;
  if (patch.cameraOverlayEnabled !== undefined) cameraOverlayEnabled = patch.cameraOverlayEnabled;
  if (patch.cameraVideoLoaded !== undefined) cameraVideoLoaded = patch.cameraVideoLoaded;
  if (patch.demoWebcamEnabled !== undefined) demoWebcamEnabled = patch.demoWebcamEnabled;
  if (patch.cameraVideo !== undefined) cameraVideo = patch.cameraVideo;
  if (patch.currentCameraBlob !== undefined) currentCameraBlob = patch.currentCameraBlob;
  if (patch.settings && typeof patch.settings === 'object') {
    Object.assign(settings, patch.settings);
  }
};

// Drag state
let isDragging = false;
let dragType = null; // 'segment', 'handle-left', 'handle-right', 'blur-segment', 'blur-handle-left', 'blur-handle-right', 'trim-start', 'trim-end', 'playhead'
let dragStartX = 0;
let dragStartValue = 0;
let dragSegmentIndex = -1;
let _scrubSeekPending = false;

// Settings
let settings = {
  background: 'mac-sequoia',
  aspectRatio: 'native',
  applyZoom: true,
  zoomDepth: 'moderate',
  clickEnabled: true,
  clickStyle: 'ripple', // 'ripple' | 'both' | 'ring' | 'orb' | 'none'
  clickWaves: 'double', // 'double' | 'triple' | 'single'
  clickColor: 'white',
  customClickColor: '#ffffff', // Store custom hex color
  clickForce: 'moderate', // 'weak' | 'moderate' | 'strong'
  backgroundImage: null, // Store uploaded image data URL
  cleanBrowser: true, // true = crop tabs / clean browser; false = show original browser tabs
  showBrowserFrame: false, // legacy mirror: false when cleanBrowser is true (for backward compat)
  showMacWindowHeader: true, // true = show macOS window titlebar with traffic lights
  showShadow: true, // true = show shadow effect, false = hide shadow
  padding: 28, // Standard padding (px)
  borderRadius: 14, // Smooth corner radius (px)
  playbackSpeed: 1.0,
  sharpening: true,
  cameraStyle: 'smooth', // Follow-mode camera feel: 'smooth' | 'focused' | 'tight'
  cursorHighlight: false, // Halo / spotlight / ring over the cursor (rendered identically in preview and export)
  cursorHighlightStyle: 'halo', // 'halo' | 'spotlight' | 'ring' | 'dot'
  cursorHighlightColor: '#ffab00', // High-visibility studio gold default (OpenScreen style)
  cursorHighlightSize: 1.0, // 0.5..2.0 multiplier
  adaptiveEdgeZoom: true, // Adaptive boundary zoom & breathing room near screen borders
  showWebcam: true, // Show synchronized 1:1 Face Cam overlay above auto-zoom
  webcamPosition: 'bottom-right', // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'custom'
  webcamCustomX: null, // Normalized 0..1 center X on viewport when freely dragged
  webcamCustomY: null, // Normalized 0..1 center Y on viewport when freely dragged
  webcamSize: 'medium', // 'small' | 'medium' | 'large'
  webcamScale: 1.0, // Custom scale multiplier (0.6..1.6)
  webcamZoomMode: 'float', // 'float' | 'smart-dodge' | 'zoom-with-screen'
  webcamShape: 'circular', // 'circular' | 'rounded'
  webcamFlip: true // Mirror webcam horizontally
};

// Zoom depth values (aligned with OpenScreen & Cursorful studio presets)
const zoomDepths = {
  shallow: 1.40,
  moderate: 1.75,
  deep: 2.20,
  maximum: 2.80
};

// Background styles
const backgrounds = {
  // Apple & macOS Wallpapers
  'mac-sequoia': 'linear-gradient(135deg, #181926 0%, #362238 35%, #8c3b40 70%, #d47753 100%)',
  'mac-sonoma': 'linear-gradient(135deg, #0b1a2c 0%, #174261 35%, #d87057 70%, #f29e59 100%)',
  'mac-ventura': 'linear-gradient(135deg, #24072f 0%, #6f1b94 35%, #e11d5e 70%, #f59100 100%)',
  'mac-monterey': 'linear-gradient(135deg, #0a081a 0%, #2b0f5e 35%, #7033d8 70%, #b87cf0 100%)',
  'mac-bigsur': 'linear-gradient(135deg, #0e1628 0%, #1b357f 35%, #e24391 70%, #f09506 100%)',
  'mac-studio-dark': 'linear-gradient(135deg, #111215 0%, #1c1d22 50%, #262930 100%)',
  'mac-studio-light': 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #cbd5e1 100%)',
  'mac-aurora': 'linear-gradient(135deg, #020617 0%, #064e3b 35%, #059669 70%, #06b6d4 100%)',
  'mac-cyberpunk': 'linear-gradient(135deg, #0a0416 0%, #2e0854 35%, #9333ea 70%, #f43f5e 100%)',
  'mac-solar': 'linear-gradient(135deg, #1a0604 0%, #751a0e 35%, #d92323 70%, #ea580c 100%)',
  'mac-frost': 'linear-gradient(135deg, #082f49 0%, #0284c7 35%, #38bdf8 70%, #bae6fd 100%)',
  'mac-lavender': 'linear-gradient(135deg, #1e1b4b 0%, #4338ca 35%, #818cf8 70%, #c7d2fe 100%)',

  // Curated Gradients & Colors
  'grad-1': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'grad-2': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'grad-3': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'grad-4': 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'grad-5': 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'grad-6': 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  'grad-7': 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  'grad-8': 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
  'grad-9': 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
  'grad-10': 'linear-gradient(135deg, #312e81 0%, #1e1b4b 100%)',
  'grad-11': 'linear-gradient(135deg, #064e3b 0%, #022c22 100%)',
  'grad-12': '#09090b',
  'white': '#ffffff',
  'black': '#000000',
  'hidden': 'transparent'
};

// Click effect colors
const clickColors = {
  white: '#ffffff',
  emerald: '#10b981',
  green: '#10b981',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  pink: '#ec4899',
  orange: '#f97316',
  red: '#ef4444',
  cyan: '#06b6d4',
  amber: '#f59e0b'
};

let analyzer = null;
let processor = null;

// DOM Elements
let loadingOverlay, emptyState, videoFrame, videoBackground, videoWindow;
let video, previewCanvas, ctx;
let playBtn, currentTimeEl, currentTimeMsEl, totalTimeEl, totalTimeMsEl;
let timelineTrack, timelinePlayhead, zoomSegmentsLayer, timelineRuler;
let trimStartScissor, trimEndScissor, trimOverlayStart, trimOverlayEnd;
let timelineProgressFill;
let trimmedLeft, trimmedRight, playheadElement, timeMarkers, timeDisplay, leftLabel;

// Initialize
function initEditorDom() {
  debugLog('[Editor] DOM initialized');
  console.log('%c[CursorDemo Editor] Loaded with Diagnostic Alerts', 'background: #10b981; color: #fff; font-size: 14px; padding: 4px;');

  // Get DOM elements
  loadingOverlay = document.getElementById('loadingOverlay');
  emptyState = document.getElementById('emptyState');
  videoFrame = document.getElementById('videoFrame');
  videoBackground = document.getElementById('videoBackground');
  videoWindow = document.getElementById('videoWindow');
  video = document.getElementById('video');
  previewCanvas = document.getElementById('previewCanvas');
  playBtn = document.getElementById('playBtn');
  trimmedLeft = document.getElementById('trimmedLeft');
  trimmedRight = document.getElementById('trimmedRight');
  trimOverlayStart = document.getElementById('trimOverlayStart') || trimmedLeft;
  trimOverlayEnd = document.getElementById('trimOverlayEnd') || trimmedRight;
  timeMarkers = document.getElementById('timeMarkers');
  timeDisplay = document.getElementById('timeDisplay');
  currentTimeEl = document.getElementById('currentTime') || timeDisplay;
  currentTimeMsEl = document.getElementById('currentTimeMs');
  totalTimeEl = document.getElementById('totalTime');
  totalTimeMsEl = document.getElementById('totalTimeMs');
  timelineTrack = document.getElementById('timelineTrack');
  timelinePlayhead = document.getElementById('timelinePlayhead') || playheadElement;
  playheadElement = document.getElementById('playhead');
  zoomSegmentsLayer = document.getElementById('zoomSegmentsLayer');
  timelineRuler = document.getElementById('timelineRuler');
  trimStartScissor = document.getElementById('trimStartScissor');
  trimEndScissor = document.getElementById('trimEndScissor');
  timeMarkers = document.getElementById('timeMarkers');
  timeDisplay = document.getElementById('timeDisplay');
  leftLabel = document.getElementById('leftLabel');
  timelineProgressFill = document.getElementById('timelineProgressFill');

  // Initialize classes
  analyzer = new ZoomAnalyzer();
  analyzer.cameraStyle = settings.cameraStyle;
  analyzer.adaptiveEdgeZoom = settings.adaptiveEdgeZoom !== false;
  processor = new VideoProcessor();

  // Setup event listeners
  setupEventListeners();
  setupExportModal();
  setupReviewModal();
  setupDiscordModal();
  setupDragInteractions();

  // Initialize UI to match settings
  const showBrowserFrameCheckbox = document.getElementById('showBrowserFrame');
  const showShadowCheckbox = document.getElementById('showShadow');
  if (showBrowserFrameCheckbox) {
    showBrowserFrameCheckbox.checked = settings.cleanBrowser !== false;
    const hint = document.getElementById('browserFrameHint');
    if (hint) {
      hint.textContent = showBrowserFrameCheckbox.checked
        ? 'Clean browser enabled • browser tabs & address bar cropped'
        : 'Original browser address bar & tabs shown';
    }
  }
  if (showShadowCheckbox) {
    showShadowCheckbox.checked = settings.showShadow;
  }
  const showMacWindowHeaderCheckbox = document.getElementById('showMacWindowHeader');
  if (showMacWindowHeaderCheckbox) {
    showMacWindowHeaderCheckbox.checked = settings.showMacWindowHeader !== false;
  }
  const macHeader = document.getElementById('macWindowHeader');
  if (macHeader) {
    macHeader.classList.toggle('hidden', settings.showMacWindowHeader === false);
  }
  const windowPaddingSelect = document.getElementById('windowPadding');
  if (windowPaddingSelect && settings.padding !== undefined) {
    windowPaddingSelect.value = String(settings.padding);
  }
  const windowRadiusSelect = document.getElementById('windowRadius');
  if (windowRadiusSelect && settings.borderRadius !== undefined) {
    windowRadiusSelect.value = String(settings.borderRadius);
  }

  // Initialize Click Ripple & Cursor Highlight settings
  const clickEnabledCheckbox = document.getElementById('clickEnabled');
  const cursorHighlightCheckbox = document.getElementById('cursorHighlightEnabled');
  const cursorHighlightControls = document.getElementById('cursorHighlightControls');
  const cursorHighlightStyleSelect = document.getElementById('cursorHighlightStyle');
  const cursorHighlightSizeSlider = document.getElementById('cursorHighlightSize');
  const cursorHighlightSizeVal = document.getElementById('cursorHighlightSizeValue');
  const cursorHighlightColorInput = document.getElementById('cursorHighlightColor');
  const clickStyleSelect = document.getElementById('clickStyle');
  const clickWavesSelect = document.getElementById('clickWaves');
  const clickForceSelect = document.getElementById('clickForce');
  const clickStyleRow = document.getElementById('clickStyleRow');
  const clickWavesRow = document.getElementById('clickWavesRow');

  try {
    const savedHlEnabled = localStorage.getItem('cursordemo.cursorHighlight');
    if (savedHlEnabled !== null) settings.cursorHighlight = savedHlEnabled === 'true';
    const savedHlStyle = localStorage.getItem('cursordemo.cursorHighlightStyle');
    if (savedHlStyle && ['halo', 'spotlight', 'ring', 'dot'].includes(savedHlStyle)) {
      settings.cursorHighlightStyle = savedHlStyle;
    }
    const savedHlColor = localStorage.getItem('cursordemo.cursorHighlightColor');
    if (savedHlColor && /^#[0-9a-fA-F]{6}$/.test(savedHlColor)) {
      settings.cursorHighlightColor = savedHlColor;
    }
    const savedHlSize = parseFloat(localStorage.getItem('cursordemo.cursorHighlightSize') || '');
    if (Number.isFinite(savedHlSize) && savedHlSize >= 0.5 && savedHlSize <= 2.5) {
      settings.cursorHighlightSize = savedHlSize;
    }
  } catch (_) { }

  if (clickEnabledCheckbox) {
    clickEnabledCheckbox.checked = settings.clickEnabled !== false && settings.clickStyle !== 'none';
  }
  if (cursorHighlightCheckbox) {
    cursorHighlightCheckbox.checked = !!settings.cursorHighlight;
  }
  if (cursorHighlightControls) {
    cursorHighlightControls.style.display = settings.cursorHighlight ? 'flex' : 'none';
  }
  if (cursorHighlightStyleSelect) {
    cursorHighlightStyleSelect.value = settings.cursorHighlightStyle || 'halo';
  }
  if (cursorHighlightSizeSlider) {
    const pct = Math.round((Number(settings.cursorHighlightSize) || 1.0) * 100);
    cursorHighlightSizeSlider.value = String(pct);
    if (cursorHighlightSizeVal) cursorHighlightSizeVal.textContent = `${pct}%`;
  }
  if (cursorHighlightColorInput) {
    cursorHighlightColorInput.value = settings.cursorHighlightColor || '#ffab00';
  }
  document.querySelectorAll('.cursor-hl-color-chip').forEach((chip) => {
    const isAct = (chip.getAttribute('data-hl-color') || '').toLowerCase() === (settings.cursorHighlightColor || '#ffab00').toLowerCase();
    chip.classList.toggle('active', isAct);
    chip.style.border = isAct ? '2px solid #ffffff' : '1px solid var(--border)';
  });
  if (clickStyleSelect) {
    clickStyleSelect.value = settings.clickStyle !== 'none' ? settings.clickStyle : 'ripple';
  }
  if (clickWavesSelect) {
    clickWavesSelect.value = settings.clickWaves || 'double';
  }
  if (clickForceSelect) {
    clickForceSelect.value = settings.clickForce || 'moderate';
  }
  if (clickWavesRow && clickStyleSelect) {
    clickWavesRow.style.display = (clickStyleSelect.value === 'orb') ? 'none' : 'flex';
  }
  if (clickStyleRow && settings.clickStyle === 'none') {
    clickStyleRow.style.opacity = '0.5';
    if (clickWavesRow) clickWavesRow.style.opacity = '0.5';
  }

  // Initialize click color selection
  const colorOptions = document.querySelectorAll('.color-option');
  colorOptions.forEach(opt => {
    if (opt.dataset.color === settings.clickColor) {
      opt.classList.add('selected');
    }
  });

  // Initialize custom color picker and hex input
  const customColorPicker = document.getElementById('customColorPicker');
  const hexColorInput = document.getElementById('hexColorInput');
  if (customColorPicker && hexColorInput) {
    // Set initial values - use custom color if set, otherwise use preset color
    if (!settings.customClickColor) {
      settings.customClickColor = clickColors[settings.clickColor] || '#ffffff';
    }
    let currentColor = settings.customClickColor;
    // Normalize 3-digit hex to 6-digit for color picker compatibility
    if (currentColor.length === 4 && currentColor.startsWith('#')) {
      currentColor = '#' + currentColor[1] + currentColor[1] + currentColor[2] + currentColor[2] + currentColor[3] + currentColor[3];
      settings.customClickColor = currentColor;
    }
    customColorPicker.value = currentColor;
    hexColorInput.value = currentColor;
  }

  // Setup Interactive Live Ripple Sandbox in sidebar
  setupRippleSandbox();

  // Initialize background tab state
  const bgGrid = document.getElementById('bgGrid');
  const bgGridMac = document.getElementById('bgGridMac');
  const bgTabs = document.querySelectorAll('.bg-tab');
  if (settings.background === 'hidden') {
    bgTabs.forEach(t => t.classList.remove('active'));
    document.querySelector('.bg-tab[data-bg-type="hidden"]')?.classList.add('active');
    if (bgGrid) { bgGrid.classList.add('hidden'); bgGrid.style.display = 'none'; }
    if (bgGridMac) { bgGridMac.classList.add('hidden'); bgGridMac.style.display = 'none'; }
  } else if (settings.backgroundImage) {
    bgTabs.forEach(t => t.classList.remove('active'));
    document.querySelector('.bg-tab[data-bg-type="upload"]')?.classList.add('active');
    if (bgGrid) { bgGrid.classList.add('hidden'); bgGrid.style.display = 'none'; }
    if (bgGridMac) { bgGridMac.classList.add('hidden'); bgGridMac.style.display = 'none'; }
  } else if (settings.background && settings.background.startsWith('mac-')) {
    bgTabs.forEach(t => t.classList.remove('active'));
    document.querySelector('.bg-tab[data-bg-type="mac"]')?.classList.add('active');
    if (bgGridMac) { bgGridMac.classList.remove('hidden'); bgGridMac.style.display = 'grid'; }
    if (bgGrid) { bgGrid.classList.add('hidden'); bgGrid.style.display = 'none'; }
  } else {
    bgTabs.forEach(t => t.classList.remove('active'));
    document.querySelector('.bg-tab[data-bg-type="gradient"]')?.classList.add('active');
    if (bgGrid) { bgGrid.classList.remove('hidden'); bgGrid.style.display = 'grid'; }
    if (bgGridMac) { bgGridMac.classList.add('hidden'); bgGridMac.style.display = 'none'; }
  }

  // Load data
  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEditorDom);
} else {
  initEditorDom();
}

async function init() {
  try {
    debugLog('[Editor] Fetching recording data...');

    let response = null;
    let attempts = 0;
    const hasExtensionRuntime = (typeof chrome !== 'undefined' && typeof chrome?.runtime?.sendMessage === 'function');

    while (!response && attempts < (hasExtensionRuntime ? 10 : 0)) {
      try {
        response = await chrome.runtime.sendMessage({ action: 'getRecordingData' });
        if (response && response.success && response.videoData) {
          debugLog('[Editor] Got recording data');
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
        response = null;
      } catch (e) {
        await new Promise(r => setTimeout(r, 1000));
      }
      attempts++;
    }

    if (!response || !response.videoData) {
      // Check query param ?videoId=...
      const queryVideoId = new URLSearchParams(window.location.search).get('videoId');
      if (queryVideoId) {
        debugLog('[Editor] Attempting fast load from query param videoId:', queryVideoId);
        response = {
          videoData: queryVideoId,
          videoStoredInIndexedDB: true,
          cursorData: [],
          videoWidth: 1920,
          videoHeight: 1080,
          cameraOverlayEnabled: false
        };
        // Restore cursor data + real metadata saved for this same recording
        try {
          if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
            const stored = await chrome.storage.local.get(['cursorData_snapshot', 'lastVideoMetadata']);
            const meta = stored.lastVideoMetadata;
            if (meta && meta.videoId === queryVideoId) {
              response.cursorData = stored.cursorData_snapshot || [];
              response.videoWidth = meta.videoWidth || 1920;
              response.videoHeight = meta.videoHeight || 1080;
              response.duration = meta.videoDuration || 0;
              response.displaySurface = meta.displaySurface || null;
              response.cameraOverlayEnabled = meta.cameraOverlayEnabled || false;
              response.cameraVideoId = meta.cameraVideoId || null;
              debugLog('[Editor] Restored', response.cursorData.length, 'cursor events for', queryVideoId);
            }
          }
        } catch (restoreErr) {
          console.warn('[Editor] Could not restore cursor data for videoId:', restoreErr);
        }
      }
    }

    if (!response || !response.videoData) {
      // Fallback: Check chrome.storage.local if service worker terminated
      try {
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          const stored = await chrome.storage.local.get(['cursorData_snapshot', 'lastVideoMetadata']);
          if (stored.lastVideoMetadata && stored.lastVideoMetadata.videoId) {
            debugLog('[Editor] Recovered session from chrome.storage.local fallback');
            response = {
              videoData: stored.lastVideoMetadata.videoId,
              cameraVideoId: stored.lastVideoMetadata.cameraVideoId || null,
              videoStoredInIndexedDB: true,
              cursorData: stored.cursorData_snapshot || [],
              videoWidth: stored.lastVideoMetadata.videoWidth || 1920,
              videoHeight: stored.lastVideoMetadata.videoHeight || 1080,
              duration: stored.lastVideoMetadata.videoDuration || 0,
              displaySurface: stored.lastVideoMetadata.displaySurface || 'monitor',
              cameraOverlayEnabled: stored.lastVideoMetadata.cameraOverlayEnabled || false
            };
          }
        }
      } catch (fallbackErr) {
        console.warn('[Editor] Storage fallback recovery failed:', fallbackErr);
      }
    }

    if (!response || !response.videoData) {
      showEmptyState();
      return;
    }

    cursorData = response.cursorData || [];
    if (cursorData.length === 0) {
      try {
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          const stored = await chrome.storage.local.get(['cursorData_snapshot']);
          if (stored.cursorData_snapshot && stored.cursorData_snapshot.length > 0) {
            cursorData = stored.cursorData_snapshot;
            debugLog('[Editor] Fallback recovered cursorData from chrome.storage.local:', cursorData.length);
          }
        }
      } catch (err) { }
    }
    // Secondary fallback: recover metadata + cursorData from IndexedDB (videoId + '_meta')
    if (cursorData.length === 0 && typeof response.videoData === 'string' && response.videoData.startsWith('video_')) {
      try {
        const metaBlob = await retrieveVideoFromIndexedDB(response.videoData + '_meta');
        if (metaBlob && metaBlob.size > 0) {
          const metaText = await metaBlob.text();
          const metaObj = JSON.parse(metaText);
          if (metaObj && Array.isArray(metaObj.cursorData) && metaObj.cursorData.length > 0) {
            cursorData = metaObj.cursorData;
            debugLog('[Editor] Fallback recovered cursorData from IndexedDB _meta:', cursorData.length);
          }
          if (metaObj && metaObj.videoWidth > 0 && !response.videoWidth) response.videoWidth = metaObj.videoWidth;
          if (metaObj && metaObj.videoHeight > 0 && !response.videoHeight) response.videoHeight = metaObj.videoHeight;
          if (metaObj && metaObj.duration > 0 && !response.duration) response.duration = metaObj.duration;
          if (metaObj && metaObj.displaySurface && !response.displaySurface) response.displaySurface = metaObj.displaySurface;
          if (metaObj && metaObj.cameraVideoId && !response.cameraVideoId) response.cameraVideoId = metaObj.cameraVideoId;
        }
      } catch (_) { }
    }
    videoWidth = response.videoWidth || 1920;
    videoHeight = response.videoHeight || 1080;
    displaySurface = response.displaySurface || null;
    if (analyzer) {
      analyzer.displaySurface = displaySurface;
      analyzer.cursorData = cursorData;
    }
    if (response.duration && isFinite(response.duration) && response.duration > 0) {
      videoDuration = response.duration;
      debugLog('[Editor] Canonical duration from recording metadata:', videoDuration, 'seconds');
    }
    cameraOverlayEnabled = response.cameraOverlayEnabled || false;

    // Log cursor data info
    debugLog('[Editor] Cursor data points:', cursorData.length, 'Surface:', displaySurface);
    const clicks = cursorData.filter(d => d.type === 'click' || d.type === 'doubleclick');
    debugLog('[Editor] Click events:', clicks.length);

    const clickToggleRow = document.getElementById('clickEnabled')?.closest('.setting-row');
    if (clickToggleRow) {
      if (clicks.length === 0) {
        clickToggleRow.setAttribute('title', 'No click telemetry recorded for this capture (click ripples require recording in a supported browser tab: https://).');
      } else {
        clickToggleRow.removeAttribute('title');
      }
    }

    const cursorHlToggleRow = document.getElementById('cursorHighlightEnabled')?.closest('.setting-row');
    if (cursorHlToggleRow) {
      if (cursorData.length === 0) {
        cursorHlToggleRow.setAttribute('title', 'No cursor movement telemetry recorded for this capture (cursor highlight requires recording in a supported browser tab: https://).');
      } else {
        cursorHlToggleRow.removeAttribute('title');
      }
    }

    let blob;

    // Check if video is stored in IndexedDB
    if (response.videoStoredInIndexedDB && typeof response.videoData === 'string' && !response.videoData.startsWith('data:')) {
      currentVideoId = response.videoData;
      currentVideoTitle = 'Recording ' + new Date().toLocaleDateString();
      // Video is in IndexedDB - retrieve it
      debugLog('[Editor] Video stored in IndexedDB, retrieving with ID:', response.videoData);
      try {
        blob = await retrieveVideoFromIndexedDB(response.videoData);
        debugLog('[Editor] Video retrieved from IndexedDB, size:', blob.size, 'bytes');
      } catch (error) {
        console.error('[Editor] Failed to retrieve video from IndexedDB:', error);
        throw new Error('Failed to retrieve video from IndexedDB: ' + error.message);
      }
    } else {
      // Video is in data URL format - convert to blob
      if (!response.videoData.startsWith('data:')) {
        console.error('[Editor] Invalid video data format:', response.videoData.substring(0, 100));
        throw new Error('Invalid video data format');
      }

      debugLog('[Editor] Loading video from data URL, size:', response.videoData.length, 'chars');

      try {
        // Fast path: use native fetch() to convert data URL to Blob without blocking UI thread
        blob = await fetch(response.videoData).then(r => r.blob());
      } catch (fetchErr) {
        debugLog('[Editor] fetch() data URL decode failed, falling back to manual decode:', fetchErr);
        try {
          const base64Index = response.videoData.indexOf(';base64,');
          if (base64Index === -1) {
            throw new Error('Invalid data URL format: missing ;base64, separator');
          }
          const mimeTypeMatch = response.videoData.match(/^data:([^;]+)/);
          const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'video/webm';
          const base64Data = response.videoData.substring(base64Index + 8);

          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          blob = new Blob([bytes], { type: mimeType });
        } catch (conversionError) {
          console.error('[Editor] Error converting data URL to blob:', conversionError);
          throw new Error('Failed to convert data URL to blob: ' + (conversionError.message || conversionError.toString()));
        }
      }
    }

    if (!blob || blob.size === 0) {
      throw new Error('Video blob is empty - recording may have failed');
    }

    currentVideoBlob = blob; // Store module-level blob for export
    debugLog('[Editor] Video blob size:', blob.size, 'bytes');

    // Retrieve synchronized Face Cam blob if recorded alongside screen video
    currentCameraBlob = null;
    cameraVideoLoaded = false;
    const candidateCamId = response.cameraVideoId ||
      ((typeof response.videoData === 'string' && response.videoData.startsWith('video_')) ? (response.videoData + '_cam') : null);
    if (candidateCamId) {
      try {
        const camBlob = await retrieveVideoFromIndexedDB(candidateCamId);
        if (camBlob && camBlob.size > 0) {
          currentCameraBlob = camBlob;
          cameraOverlayEnabled = true;
          await loadCameraVideo(camBlob);
          debugLog('[Editor] Synchronized Face Cam video loaded from IndexedDB:', candidateCamId, camBlob.size, 'bytes');
        }
      } catch (camLoadErr) {
        debugLog('[Editor] No separate camera stream found in IndexedDB for', candidateCamId);
      }
    }
    updateFaceCamUI();

    // Validate blob has WebM (EBML) or MP4 (ISO BMFF) magic bytes
    const firstBytes = await blob.slice(0, 12).arrayBuffer();
    const view = new Uint8Array(firstBytes);
    const magicBytes = Array.from(view.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    debugLog('[Editor] Reconstructed blob first 8 bytes (hex):', magicBytes);

    const isWebM = view.length >= 4 &&
      view[0] === 0x1A && view[1] === 0x45 && view[2] === 0xDF && view[3] === 0xA3;
    const boxType = view.length >= 8
      ? String.fromCharCode(view[4], view[5], view[6], view[7])
      : '';
    const isMp4 = boxType === 'ftyp' || boxType === 'moov' || boxType === 'mdat' ||
      boxType === 'styp' || boxType === 'free' || boxType === 'wide';

    if (isWebM || isMp4) {
      debugLog('[Editor] Reconstructed blob has valid container header:', isWebM ? 'WebM' : `MP4 (${boxType})`);
    } else {
      console.error('[Editor] Reconstructed blob does NOT have valid WebM/MP4 magic bytes!');
      console.error('[Editor] Expected WebM (1A 45 DF A3) or MP4 (ftyp/moov/mdat), Got:', magicBytes);
      throw new Error('Video blob is corrupted - invalid video container format. Magic bytes: ' + magicBytes);
    }

    const url = URL.createObjectURL(blob);

    try {
      await loadVideo(url);
    } catch (loadError) {
      console.error('[Editor] Error loading video:', loadError);
      // Clean up the object URL
      URL.revokeObjectURL(url);
      throw new Error('Failed to load video: ' + (loadError.message || loadError.toString()));
    }

  } catch (error) {
    // Handle Event objects and Error objects properly
    let errorMessage = 'Unknown error';
    let errorDetails = {};

    if (error instanceof Error) {
      errorMessage = error.message || 'Unknown error';
      errorDetails = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
    } else if (error && typeof error === 'object') {
      // Handle Event objects
      if (error.type) {
        errorMessage = `Event error: ${error.type}`;
        errorDetails = {
          type: error.type,
          target: error.target,
          currentTarget: error.currentTarget,
          timeStamp: error.timeStamp
        };
      } else {
        errorMessage = error.toString();
        errorDetails = { error: error };
      }
    } else {
      errorMessage = String(error);
    }

    console.error('[Editor] Init error:', error);
    console.error('[Editor] Error details:', errorDetails);
    console.error('[Editor] Error type:', typeof error, error instanceof Error ? '(Error)' : error instanceof Event ? '(Event)' : '(Other)');

    // Show user-friendly Discord support modal or fallback alert
    let friendlySummary = 'Error loading recording: ' + errorMessage + '. Please try recording again or join our Discord for instant help.';
    if (errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
      console.error('[Editor] Failed to fetch video data - recording may be empty or corrupted');
      friendlySummary = 'Could not load recording. The recording may be empty or corrupted. Join our Discord community for instant troubleshooting.';
    } else if (errorMessage.includes('No video data') || errorMessage.includes('No recording data')) {
      console.error('[Editor] No video data available');
      friendlySummary = 'No recording data found. Please make sure you completed a recording before opening the editor.';
    } else if (errorMessage.includes('empty') || errorMessage.includes('blob is empty')) {
      console.error('[Editor] Video blob is empty');
      friendlySummary = 'The recording appears to be empty (0 bytes). Join our Discord community if screen capture isn\'t working on your system.';
    }

    if (typeof showDiscordModal === 'function') {
      showDiscordModal({
        mode: 'crash',
        reason: 'recording-load-error',
        title: 'Could Not Load Recording — Need Support?',
        summary: friendlySummary,
        details: `EditorInitError: ${errorMessage}\n${errorDetails?.stack || JSON.stringify(errorDetails)}`
      });
    } else {
      alert('Error loading recording: ' + errorMessage + '\n\nPlease try recording again.');
    }

    showEmptyState();
  }
}

/**
 * Load the separate synchronized Face Cam video blob into an offscreen HTMLVideoElement
 * for zoom-independent compositing in live preview and export.
 */
async function loadCameraVideo(blob) {
  if (!blob || blob.size === 0) {
    cameraVideoLoaded = false;
    return;
  }
  try {
    if (cameraVideo && cameraVideo._objectUrl) {
      URL.revokeObjectURL(cameraVideo._objectUrl);
    }
    const camEl = document.createElement('video');
    camEl.muted = true;
    camEl.playsInline = true;
    camEl.preload = 'auto';
    const camUrl = URL.createObjectURL(blob);
    camEl._objectUrl = camUrl;

    await new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const timeoutId = setTimeout(() => finish(camEl.readyState >= 1), 4000);
      camEl.onloadeddata = () => {
        clearTimeout(timeoutId);
        finish(true);
      };
      camEl.onloadedmetadata = () => {
        if (camEl.readyState >= 2) {
          clearTimeout(timeoutId);
          finish(true);
        }
      };
      camEl.onerror = () => {
        clearTimeout(timeoutId);
        finish(false);
      };
      camEl.src = camUrl;
      camEl.load();
    });

    cameraVideo = camEl;
    cameraVideoLoaded = Boolean(camEl.videoWidth > 0 && camEl.videoHeight > 0);
    camEl.addEventListener('seeked', () => {
      requestPreviewRedraw();
    });
    camEl.addEventListener('loadeddata', () => {
      requestPreviewRedraw();
    });
    debugLog('[Editor] Face Cam video ready:', camEl.videoWidth, 'x', camEl.videoHeight);
  } catch (err) {
    console.warn('[Editor] Failed to load separate Face Cam video:', err);
    cameraVideoLoaded = false;
  }
}

/**
 * Render a crisp 1:1 synthetic Studio Presenter feed into _demoWebcamCanvas
 * when the user enables Preview Cam on a recording without a separate webcam stream.
 */
function getOrRenderDemoWebcamCanvas(timeSec) {
  if (!_demoWebcamCanvas) {
    _demoWebcamCanvas = document.createElement('canvas');
    _demoWebcamCanvas.width = 360;
    _demoWebcamCanvas.height = 360;
  }
  const c = _demoWebcamCanvas;
  const dctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  const t = Number.isFinite(timeSec) ? timeSec : (performance.now() / 1000);

  // Studio background gradient
  const bgGrad = dctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, '#0f172a');
  bgGrad.addColorStop(0.5, '#1e1b4b');
  bgGrad.addColorStop(1, '#064e3b');
  dctx.fillStyle = bgGrad;
  dctx.fillRect(0, 0, w, h);

  // Subtle ambient studio keylight
  const glowX = w * 0.5;
  const glowY = h * 0.38;
  const radGrad = dctx.createRadialGradient(glowX, glowY, 10, glowX, glowY, w * 0.55);
  radGrad.addColorStop(0, 'rgba(16, 185, 129, 0.28)');
  radGrad.addColorStop(0.6, 'rgba(99, 102, 241, 0.12)');
  radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  dctx.fillStyle = radGrad;
  dctx.fillRect(0, 0, w, h);

  // Stylized presenter shoulders & head (rock-solid stationary)
  const bobY = 0;
  dctx.save();
  dctx.fillStyle = '#334155';
  dctx.beginPath();
  dctx.ellipse(w / 2, h * 0.88 + bobY, w * 0.34, h * 0.24, 0, Math.PI, 0, false);
  dctx.fill();
  dctx.strokeStyle = 'rgba(255,255,255,0.16)';
  dctx.lineWidth = 2;
  dctx.stroke();

  // Collar / hoodie accent
  dctx.fillStyle = '#10b981';
  dctx.beginPath();
  dctx.arc(w / 2, h * 0.69 + bobY, w * 0.09, 0.15 * Math.PI, 0.85 * Math.PI);
  dctx.fill();

  // Presenter head
  dctx.fillStyle = '#e2e8f0';
  dctx.beginPath();
  dctx.arc(w / 2, h * 0.44 + bobY, w * 0.165, 0, Math.PI * 2);
  dctx.fill();

  // Glasses / studio visor accent
  dctx.fillStyle = '#0f172a';
  if (typeof dctx.roundRect === 'function') {
    dctx.beginPath();
    dctx.roundRect(w * 0.37, h * 0.40 + bobY, w * 0.11, h * 0.055, 6);
    dctx.roundRect(w * 0.52, h * 0.40 + bobY, w * 0.11, h * 0.055, 6);
    dctx.fill();
  }
  dctx.restore();

  // Live audio waveform / speaking ring indicator at bottom
  dctx.save();
  dctx.fillStyle = 'rgba(7, 9, 14, 0.72)';
  if (typeof dctx.roundRect === 'function') {
    dctx.beginPath();
    dctx.roundRect(w * 0.26, h * 0.78, w * 0.48, 28, 14);
    dctx.fill();
  }
  dctx.fillStyle = '#34d399';
  dctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, monospace';
  dctx.textAlign = 'center';
  dctx.textBaseline = 'middle';
  dctx.fillText('● 1:1 STUDIO CAM', w / 2, h * 0.78 + 14);
  dctx.restore();

  return c;
}

/**
 * Update the Face Cam sidebar section UI and status banner
 */
function updateFaceCamUI() {
  const faceCamSection = document.getElementById('faceCamSection');
  if (!faceCamSection) return;

  // Always keep Face Cam section discoverable in the Studio Inspector
  if (faceCamSection.dataset.hiddenByTab !== 'true') {
    faceCamSection.style.display = '';
  }

  const hasRecordedCam = Boolean(cameraVideoLoaded && currentCameraBlob);
  const isCamActive = hasRecordedCam || demoWebcamEnabled;
  const showOn = settings.showWebcam !== false;

  const showWebcamToggle = document.getElementById('showWebcamToggle');
  if (showWebcamToggle) showWebcamToggle.checked = showOn;

  const statusBadge = document.getElementById('faceCamStatusBadge');
  const sourceBanner = document.getElementById('faceCamSourceBanner');
  const sourceText = document.getElementById('faceCamSourceStatusText');
  const demoBtn = document.getElementById('enableDemoWebcamBtn');

  if (hasRecordedCam) {
    if (statusBadge) statusBadge.textContent = '1:1 RECORDED';
    if (sourceBanner) {
      sourceBanner.style.background = 'rgba(16, 185, 129, 0.10)';
      sourceBanner.style.borderColor = 'rgba(16, 185, 129, 0.30)';
    }
    if (sourceText) sourceText.textContent = 'Synchronized 1:1 Face Cam stream active';
    if (demoBtn) demoBtn.style.display = 'none';
  } else {
    if (statusBadge) statusBadge.textContent = demoWebcamEnabled ? 'PREVIEW CAM ON' : '1:1 STUDIO PIP';
    if (demoBtn) {
      demoBtn.style.display = '';
      demoBtn.textContent = demoWebcamEnabled ? 'Disable Preview Cam' : 'Enable Preview Cam';
      demoBtn.style.background = demoWebcamEnabled ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.14)';
      demoBtn.style.borderColor = demoWebcamEnabled ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.45)';
      demoBtn.style.color = demoWebcamEnabled ? '#fca5a5' : '#34d399';
    }
    if (sourceText) {
      sourceText.textContent = demoWebcamEnabled
        ? 'Studio 1:1 Preview Cam active — drag bubble on video!'
        : 'Test draggable 1:1 webcam overlay on stage';
    }
  }

  const controlsWrap = document.getElementById('faceCamControlsWrap');
  if (controlsWrap) {
    controlsWrap.style.opacity = showOn ? '1' : '0.45';
    controlsWrap.style.pointerEvents = showOn ? 'auto' : 'none';
  }

  const zoomModeSelect = document.getElementById('webcamZoomModeSelect');
  const normalizedZoomMode = (settings.webcamZoomMode === 'floating') ? 'float' : (settings.webcamZoomMode || 'float');
  settings.webcamZoomMode = normalizedZoomMode;
  if (zoomModeSelect) zoomModeSelect.value = normalizedZoomMode;

  const posSelect = document.getElementById('webcamPositionSelect');
  const curPos = settings.webcamPosition || 'bottom-right';
  if (posSelect) posSelect.value = curPos;

  document.querySelectorAll('.webcam-pos-quick-btn').forEach(btn => {
    const isAct = btn.dataset.pos === curPos;
    btn.classList.toggle('active', isAct);
    btn.style.borderColor = isAct ? 'rgba(16, 185, 129, 0.45)' : 'var(--border)';
    btn.style.background = isAct ? 'rgba(16, 185, 129, 0.14)' : '#080a10';
    btn.style.color = isAct ? '#34d399' : 'var(--text-secondary)';
  });

  const customPosRow = document.getElementById('webcamCustomPosRow');
  const coordsText = document.getElementById('webcamCoordsText');
  if (customPosRow) {
    const isCustom = settings.webcamPosition === 'custom' && Number.isFinite(settings.webcamCustomX) && Number.isFinite(settings.webcamCustomY);
    customPosRow.style.display = isCustom ? 'flex' : 'none';
    if (isCustom && coordsText) {
      coordsText.textContent = `Dragged: X ${Math.round(settings.webcamCustomX * 100)}%, Y ${Math.round(settings.webcamCustomY * 100)}%`;
    }
  }

  const sizeSelect = document.getElementById('webcamSizeSelect');
  if (sizeSelect) sizeSelect.value = settings.webcamSize || 'medium';

  const scaleSlider = document.getElementById('webcamScaleSlider');
  const scaleValue = document.getElementById('webcamScaleValue');
  const scalePct = Math.round((Number(settings.webcamScale) || 1.0) * 100);
  if (scaleSlider) scaleSlider.value = String(scalePct);
  if (scaleValue) scaleValue.textContent = `${scalePct}%`;

  const shapeSelect = document.getElementById('webcamShapeSelect');
  if (shapeSelect) shapeSelect.value = settings.webcamShape || 'circular';

  const flipToggle = document.getElementById('webcamFlipToggle');
  if (flipToggle) flipToggle.checked = settings.webcamFlip !== false;
}

/**
 * Keep the offscreen Face Cam video synchronized with the main screen recording video
 */
function syncCameraVideoWithMain() {
  if (!cameraVideoLoaded || !cameraVideo || !video) return;
  const targetTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const camDur = (Number.isFinite(cameraVideo.duration) && cameraVideo.duration > 0)
    ? cameraVideo.duration
    : Infinity;
  const safeMaxTime = Number.isFinite(camDur) ? Math.max(0, camDur - 0.02) : targetTime;
  const clampedTime = Math.max(0, Math.min(safeMaxTime, targetTime));
  const isAtCameraEnd = Number.isFinite(camDur) && targetTime >= Math.max(0, camDur - 0.05);

  if (video.paused || !isPlaying || isAtCameraEnd) {
    if (!cameraVideo.paused) {
      cameraVideo.pause();
    }
    if (Math.abs((cameraVideo.currentTime || 0) - clampedTime) > 0.04 && !cameraVideo.seeking) {
      try {
        cameraVideo.currentTime = clampedTime;
      } catch (e) { /* ignore seek race */ }
    }
  } else {
    if (cameraVideo.playbackRate !== video.playbackRate) {
      cameraVideo.playbackRate = video.playbackRate;
    }
    if (Math.abs((cameraVideo.currentTime || 0) - clampedTime) > 0.15 && !cameraVideo.seeking) {
      try {
        cameraVideo.currentTime = clampedTime;
      } catch (e) { /* ignore seek race */ }
    }
    if (cameraVideo.paused && !cameraVideo.ended) {
      cameraVideo.play().catch(() => { });
    }
  }
}

let _isWebcamCurrentlyDodged = false;

/**
 * Compute 1:1 center-cropped webcam overlay layout metrics on a given viewport (preview or export).
 * Supports:
 * 1. Free-form dragged position (webcamCustomX, webcamCustomY) or 4 corner presets
 * 2. Custom scale multiplier (webcamScale)
 * 3. Auto Zoom With Webcam modes:
 *    - 'float' / 'floating' (Default): Constant 1:1 size and locked position above zoom (never moves on its own)
 *    - 'smart-dodge': Floats 1:1 above zoom and dodges only when the cursor physically overlaps the bubble
 *    - 'zoom-with-screen': Scales and pans together with the zoomed screen content
 */
function computeWebcamOverlayMetrics(viewportW, viewportH, camWidth, camHeight, customSettings, zoomContext) {
  const cfg = customSettings || settings;
  const sizeMap = {
    small: 0.14,
    medium: 0.19,
    large: 0.25
  };
  const sizeRatio = sizeMap[cfg.webcamSize] || sizeMap.medium;
  const scaleMult = Math.max(0.5, Math.min(1.8, Number(cfg.webcamScale) || 1.0));
  const baseDim = Math.max(1, Math.min(viewportW, viewportH));
  let camSide = Math.max(36, Math.round(baseDim * sizeRatio * scaleMult));
  const margin = Math.max(10, Math.round(baseDim * 0.032));

  const position = cfg.webcamPosition || 'bottom-right';
  let x = viewportW - camSide - margin;
  let y = viewportH - camSide - margin;

  if (position === 'custom' && Number.isFinite(cfg.webcamCustomX) && Number.isFinite(cfg.webcamCustomY)) {
    const availW = Math.max(1, viewportW - camSide - margin * 2);
    const availH = Math.max(1, viewportH - camSide - margin * 2);
    x = Math.round(margin + Math.max(0, Math.min(1, cfg.webcamCustomX)) * availW);
    y = Math.round(margin + Math.max(0, Math.min(1, cfg.webcamCustomY)) * availH);
  } else if (position === 'top-left') {
    x = margin;
    y = margin;
  } else if (position === 'top-right') {
    x = viewportW - camSide - margin;
    y = margin;
  } else if (position === 'bottom-left') {
    x = margin;
    y = viewportH - camSide - margin;
  }

  const rawZoomMode = cfg.webcamZoomMode || 'float';
  const zoomMode = (rawZoomMode === 'floating') ? 'float' : rawZoomMode;
  let dodged = false;

  if (zoomContext && zoomContext.zoomScale > 1.04) {
    if (zoomMode === 'zoom-with-screen' && zoomContext.sw > 0 && zoomContext.sh > 0) {
      // Scale and pan the webcam bubble as part of the screen canvas
      const srcW = Math.max(1, zoomContext.sourceWidth || viewportW);
      const srcH = Math.max(1, zoomContext.sourceHeight || viewportH);
      const srcX0 = zoomContext.sourceX || 0;
      const srcY0 = zoomContext.sourceY || 0;
      const bubbleSrcX = srcX0 + (x / Math.max(1, viewportW)) * srcW;
      const bubbleSrcY = srcY0 + (y / Math.max(1, viewportH)) * srcH;
      const bubbleSrcSide = (camSide / Math.max(1, viewportW)) * srcW;
      x = Math.round(((bubbleSrcX - zoomContext.sx) / zoomContext.sw) * viewportW);
      y = Math.round(((bubbleSrcY - zoomContext.sy) / zoomContext.sh) * viewportH);
      camSide = Math.max(36, Math.round((bubbleSrcSide / zoomContext.sw) * viewportW));
      _isWebcamCurrentlyDodged = false;
    } else if (
      zoomMode === 'smart-dodge' &&
      !isDraggingWebcamBubble &&
      !isResizingWebcamBubble &&
      Number.isFinite(zoomContext.focusCanvasX) &&
      Number.isFinite(zoomContext.focusCanvasY)
    ) {
      // Only dodge when the cursor is physically inside/overlapping the webcam bubble, with hysteresis
      const bubbleCenterX = x + camSide / 2;
      const bubbleCenterY = y + camSide / 2;
      const bubbleNormX = bubbleCenterX / Math.max(1, viewportW);
      const distToCursor = Math.hypot(zoomContext.focusCanvasX - bubbleCenterX, zoomContext.focusCanvasY - bubbleCenterY);
      const threshold = _isWebcamCurrentlyDodged ? (camSide * 0.90) : (camSide * 0.62);

      if (distToCursor < threshold) {
        dodged = true;
        _isWebcamCurrentlyDodged = true;
        const shrinkSide = Math.max(36, Math.round(camSide * 0.88));
        if (bubbleNormX >= 0.5) {
          x = margin;
        } else {
          x = viewportW - shrinkSide - margin;
        }
        camSide = shrinkSide;
        y = Math.max(margin, Math.min(viewportH - camSide - margin, y));
      } else {
        _isWebcamCurrentlyDodged = false;
      }
    } else {
      _isWebcamCurrentlyDodged = false;
    }
  } else {
    _isWebcamCurrentlyDodged = false;
  }

  const vw = Math.max(1, camWidth || 480);
  const vh = Math.max(1, camHeight || 480);
  const sSize = Math.min(vw, vh);
  const sx = (vw - sSize) / 2;
  const sy = (vh - sSize) / 2;

  return {
    x,
    y,
    width: camSide,
    height: camSide,
    margin,
    sx,
    sy,
    sSize,
    dodged,
    zoomMode,
    shape: cfg.webcamShape || 'circular',
    flip: cfg.webcamFlip !== false
  };
}

/**
 * Draw the Face Cam overlay on top of the zoomed screen preview canvas.
 */
function drawWebcamOnPreview(sx, sy, sw, sh, sourceX, sourceY, sourceWidth, sourceHeight) {
  const hasRealCam = Boolean(cameraVideoLoaded && cameraVideo && cameraVideo.readyState >= 2 && cameraVideo.videoWidth > 0);
  if (!ctx || !previewCanvas || settings.showWebcam === false || (!hasRealCam && !demoWebcamEnabled)) {
    _lastWebcamRect = null;
    _webcamDodgeSettled = true;
    return;
  }

  let camSource = null;
  let camW = 360;
  let camH = 360;

  if (hasRealCam) {
    syncCameraVideoWithMain();
    camSource = cameraVideo;
    camW = cameraVideo.videoWidth;
    camH = cameraVideo.videoHeight;
  } else if (demoWebcamEnabled) {
    camSource = getOrRenderDemoWebcamCanvas(video ? video.currentTime : 0);
    camW = camSource.width;
    camH = camSource.height;
  }

  if (!camSource) {
    _lastWebcamRect = null;
    _webcamDodgeSettled = true;
    return;
  }

  // Compute current cursor canvas position for Smart Dodge
  let focusCanvasX = NaN;
  let focusCanvasY = NaN;
  if (analyzer && cursorData && cursorData.length > 0 && video) {
    const cPos = analyzer.getCursorAtTime(video.currentTime * 1000, videoWidth, videoHeight, displaySurface);
    if (cPos && sw > 0 && sh > 0) {
      focusCanvasX = ((cPos.x - sx) / sw) * previewCanvas.width;
      focusCanvasY = ((cPos.y - sy) / sh) * previewCanvas.height;
    }
  }

  const targetMetrics = computeWebcamOverlayMetrics(
    previewCanvas.width,
    previewCanvas.height,
    camW,
    camH,
    settings,
    {
      zoomScale: _previewZoomScale || 1.0,
      zoomNormX: _previewNormX,
      zoomNormY: _previewNormY,
      focusCanvasX,
      focusCanvasY,
      sx: sx || 0,
      sy: sy || 0,
      sw: sw || videoWidth,
      sh: sh || videoHeight,
      sourceX: sourceX || 0,
      sourceY: sourceY || 0,
      sourceWidth: sourceWidth || videoWidth,
      sourceHeight: sourceHeight || videoHeight
    }
  );

  // In default 'float' mode (or when dragging/resizing), lock coordinates 100% with zero interpolation drift
  if (
    targetMetrics.zoomMode !== 'smart-dodge' ||
    isDraggingWebcamBubble ||
    isResizingWebcamBubble ||
    _webcamDodgeX === null ||
    _webcamDodgeY === null
  ) {
    _webcamDodgeX = targetMetrics.x;
    _webcamDodgeY = targetMetrics.y;
    _webcamDodgeScale = targetMetrics.width;
    _webcamDodgeSettled = true;
  } else {
    _webcamDodgeX += (targetMetrics.x - _webcamDodgeX) * 0.22;
    _webcamDodgeY += (targetMetrics.y - _webcamDodgeY) * 0.22;
    _webcamDodgeScale += (targetMetrics.width - _webcamDodgeScale) * 0.22;
    _webcamDodgeSettled =
      Math.abs(targetMetrics.x - _webcamDodgeX) < 0.5 &&
      Math.abs(targetMetrics.y - _webcamDodgeY) < 0.5 &&
      Math.abs(targetMetrics.width - _webcamDodgeScale) < 0.5;
    if (_webcamDodgeSettled) {
      _webcamDodgeX = targetMetrics.x;
      _webcamDodgeY = targetMetrics.y;
      _webcamDodgeScale = targetMetrics.width;
    }
  }

  const x = Math.round(_webcamDodgeX);
  const y = Math.round(_webcamDodgeY);
  const width = Math.round(_webcamDodgeScale);
  const height = width;
  const { sx: camSx, sy: camSy, sSize, shape, flip, dodged } = targetMetrics;
  const rad = width / 2;
  const handleX = shape === 'circular'
    ? Math.round(x + rad + rad * Math.SQRT1_2)
    : Math.round(x + width - 4);
  const handleY = shape === 'circular'
    ? Math.round(y + rad + rad * Math.SQRT1_2)
    : Math.round(y + height - 4);
  _lastWebcamRect = { x, y, width, height, dodged, shape, handleX, handleY };

  const traceBubblePath = () => {
    ctx.beginPath();
    if (shape === 'circular') {
      ctx.arc(x + width / 2, y + height / 2, width / 2, 0, Math.PI * 2);
    } else if (shape === 'rounded') {
      const r = Math.round(width * 0.22);
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, width, height, r);
      } else {
        ctx.rect(x, y, width, height);
      }
    } else {
      ctx.rect(x, y, width, height);
    }
    ctx.closePath();
  };

  // 1. Ambient drop shadow behind the Face Cam bubble
  ctx.save();
  traceBubblePath();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = Math.max(10, Math.round(width * 0.14));
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(4, Math.round(width * 0.05));
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.restore();

  // 2. Center-cropped 1:1 camera frame inside the clipped shape
  ctx.save();
  traceBubblePath();
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (flip && hasRealCam) {
    ctx.translate(x + width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(camSource, camSx, camSy, sSize, sSize, 0, 0, width, height);
  } else {
    ctx.drawImage(camSource, camSx, camSy, sSize, sSize, x, y, width, height);
  }
  ctx.restore();

  // 3. Crisp studio border ring (emerald glow when dragging, resizing, or Smart-Dodging)
  ctx.save();
  traceBubblePath();
  const borderWidth = Math.max(2, Math.round(width * 0.024));
  ctx.strokeStyle = (isDraggingWebcamBubble || isResizingWebcamBubble || dodged)
    ? 'rgba(16, 185, 129, 0.95)'
    : 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = borderWidth;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.24)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 4. Interactive on-canvas resize handle knob at bottom-right rim
  ctx.beginPath();
  ctx.arc(handleX, handleY, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = '#10b981';
  ctx.fill();
  ctx.lineWidth = 1.75;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

/**
 * ==================== MANUAL BLUR ENGINE ====================
 * Renders user-created blur regions in real time on previewCanvas (and 1:1 in VideoProcessor export).
 */
function getActiveBlurRegionsAtTime(timestampMs) {
  if (!Array.isArray(blurRegions) || blurRegions.length === 0) return [];
  return blurRegions
    .map((reg, index) => ({ reg, index }))
    .filter(({ reg }) => reg && (reg.fullVideo || (timestampMs >= reg.startTime && timestampMs <= reg.endTime)));
}

function computeBlurRegionCanvasRect(reg, canvasW, canvasH, sx, sy, sw, sh, sourceX, sourceY, sourceWidth, sourceHeight) {
  const rx = Math.max(0, Math.min(0.98, Number(reg.x) || 0));
  const ry = Math.max(0, Math.min(0.98, Number(reg.y) || 0));
  const rw = Math.max(0.02, Math.min(1 - rx, Number(reg.width) || 0.25));
  const rh = Math.max(0.02, Math.min(1 - ry, Number(reg.height) || 0.14));

  if (reg.mode === 'screen') {
    return {
      x: rx * canvasW,
      y: ry * canvasH,
      width: rw * canvasW,
      height: rh * canvasH
    };
  }

  // Default 'content' mode (Zoom-Synced: tracks the underlying UI as camera zooms & pans)
  const srcX = (sourceX || 0) + rx * (sourceWidth || videoWidth);
  const srcY = (sourceY || 0) + ry * (sourceHeight || videoHeight);
  const srcW = rw * (sourceWidth || videoWidth);
  const srcH = rh * (sourceHeight || videoHeight);

  const cropSw = Math.max(1, sw || videoWidth);
  const cropSh = Math.max(1, sh || videoHeight);
  return {
    x: ((srcX - (sx || 0)) / cropSw) * canvasW,
    y: ((srcY - (sy || 0)) / cropSh) * canvasH,
    width: (srcW / cropSw) * canvasW,
    height: (srcH / cropSh) * canvasH
  };
}

function drawBlurRegionsOnPreview(sx, sy, sw, sh, sourceX, sourceY, sourceWidth, sourceHeight) {
  _lastRenderedBlurScreenRects = [];
  if (!ctx || !previewCanvas || !videoLoaded || !Array.isArray(blurRegions) || blurRegions.length === 0) return;

  const currentMs = (video ? video.currentTime : 0) * 1000;
  const activeItems = getActiveBlurRegionsAtTime(currentMs);
  if (activeItems.length === 0) return;

  const cw = previewCanvas.width;
  const ch = previewCanvas.height;
  const scaleFactor = Math.max(0.4, cw / 1280);

  activeItems.forEach(({ reg, index }) => {
    const rect = computeBlurRegionCanvasRect(reg, cw, ch, sx, sy, sw, sh, sourceX, sourceY, sourceWidth, sourceHeight);
    _lastRenderedBlurScreenRects.push({
      index,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    });

    // Skip if completely off-screen
    if (rect.x + rect.width < 0 || rect.x > cw || rect.y + rect.height < 0 || rect.y > ch) return;

    const style = reg.style || 'gaussian';
    const intensity = Math.max(4, Math.min(64, Number(reg.intensity) || 18));
    const rawRadius = Number(reg.radius ?? 14);
    const radius = rawRadius >= 900
      ? Math.min(rect.width, rect.height) / 2
      : Math.min(rect.width / 2, rect.height / 2, Math.round(rawRadius * scaleFactor));

    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function' && radius > 0) {
      ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    } else {
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.clip();

    if (style === 'solid') {
      ctx.fillStyle = '#090c14';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      // Subtle diagonal redacted pattern
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1.5;
      const step = 14;
      for (let d = -rect.height; d < rect.width + rect.height; d += step) {
        ctx.beginPath();
        ctx.moveTo(rect.x + d, rect.y);
        ctx.lineTo(rect.x + d - rect.height, rect.y + rect.height);
        ctx.stroke();
      }
    } else if (style === 'pixelate') {
      if (!_blurMosaicCanvas) {
        _blurMosaicCanvas = document.createElement('canvas');
      }
      const blockPx = Math.max(4, Math.round(intensity * 0.7 * scaleFactor));
      const mw = Math.max(2, Math.min(240, Math.ceil(rect.width / blockPx)));
      const mh = Math.max(2, Math.min(240, Math.ceil(rect.height / blockPx)));
      _blurMosaicCanvas.width = mw;
      _blurMosaicCanvas.height = mh;
      const mctx = _blurMosaicCanvas.getContext('2d');
      mctx.imageSmoothingEnabled = true;
      // Map rect back to video crop coordinates
      const subSx = sx + (rect.x / cw) * sw;
      const subSy = sy + (rect.y / ch) * sh;
      const subSw = Math.max(1, (rect.width / cw) * sw);
      const subSh = Math.max(1, (rect.height / ch) * sh);
      mctx.drawImage(video, subSx, subSy, subSw, subSh, 0, 0, mw, mh);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(_blurMosaicCanvas, 0, 0, mw, mh, rect.x, rect.y, rect.width, rect.height);
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    } else {
      // 'gaussian' Frosted Glass Blur
      const blurPx = Math.max(3, Math.round(intensity * scaleFactor));
      ctx.filter = `blur(${blurPx}px)`;
      // Overscan draw slightly so edges inside the clip don't bleed transparency
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
      ctx.filter = 'none';
      // Subtle frosted glass sheen
      ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }

    // Subtle specular border on the blur box
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  });
}

function drawBlurSelectionOverlayOnPreview() {
  if (!ctx || !previewCanvas) return;
  if (selectedBlurIndex < 0 || selectedBlurIndex >= blurRegions.length) return;
  const hit = _lastRenderedBlurScreenRects.find(r => r.index === selectedBlurIndex);
  if (!hit) return;

  const { x, y, width, height } = hit;
  ctx.save();
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);

  // Label pill above the selected blur box
  const reg = blurRegions[selectedBlurIndex];
  const labelText = `Blur #${selectedBlurIndex + 1} (${reg.mode === 'screen' ? 'Screen' : 'Zoom-Synced'})`;
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
  const tw = ctx.measureText(labelText).width + 14;
  const th = 20;
  const lx = Math.max(4, Math.min(previewCanvas.width - tw - 4, x));
  const ly = y > 26 ? (y - 24) : (y + 6);
  ctx.fillStyle = 'rgba(8, 51, 68, 0.92)';
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)';
  ctx.lineWidth = 1;
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(lx, ly, tw, th, 6);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(lx, ly, tw, th);
  }
  ctx.fillStyle = '#ecfeff';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, lx + 7, ly + th / 2);

  // Draw 4 corner resize handles
  const corners = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height]
  ];
  corners.forEach(([cx, cy]) => {
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#06b6d4';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });
  ctx.restore();
}

function addBlurRegion(customProps = {}) {
  const dur = getVideoDuration() || 10;
  const durMs = dur * 1000;
  const currentMs = (video ? video.currentTime : 0) * 1000;
  const startTime = Math.max(0, Math.min(durMs - 500, Math.round(currentMs)));
  const endTime = Math.min(durMs, Math.round(startTime + Math.min(4000, Math.max(1500, durMs * 0.35))));

  saveState();
  const offset = (blurRegions.length % 4) * 0.03;
  const newBlur = {
    id: 'blur_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    startTime: customProps.startTime ?? startTime,
    endTime: customProps.endTime ?? endTime,
    fullVideo: customProps.fullVideo ?? false,
    x: customProps.x ?? Math.min(0.65, 0.34 + offset),
    y: customProps.y ?? Math.min(0.65, 0.36 + offset),
    width: customProps.width ?? 0.28,
    height: customProps.height ?? 0.16,
    mode: customProps.mode || 'content', // 'content' (Zoom-Synced) | 'screen' (Fixed)
    style: customProps.style || 'gaussian', // 'gaussian' | 'pixelate' | 'solid'
    intensity: customProps.intensity ?? 18,
    radius: customProps.radius ?? 14
  };

  blurRegions.push(newBlur);
  const newIdx = blurRegions.length - 1;
  selectBlur(newIdx, { seek: false });
  updateBlurUI();
  requestPreviewRedraw();
  showToast('Added Manual Blur — drag or resize on video');
  return newIdx;
}

function selectBlur(index, options = {}) {
  if (index < 0 || index >= blurRegions.length) {
    deselectAllBlurs();
    return;
  }
  selectedBlurIndex = index;
  const reg = blurRegions[index];

  // Highlight timeline pill
  document.querySelectorAll('.blur-segment-pill').forEach((el, i) => {
    el.classList.toggle('selected', i === index);
  });

  // Populate Selected Blur Inspector
  const inspector = document.getElementById('selectedBlurInspector');
  if (inspector) {
    inspector.style.display = 'block';
    const titleEl = document.getElementById('selectedBlurTitle');
    if (titleEl) titleEl.textContent = `Selected Blur #${index + 1}`;
    const timeRangeEl = document.getElementById('blurInspectorTimeRange');
    if (timeRangeEl) {
      if (reg.fullVideo) {
        timeRangeEl.textContent = 'Entire Video';
      } else {
        const durSec = ((reg.endTime - reg.startTime) / 1000).toFixed(1);
        timeRangeEl.textContent = `${formatTimeShort(reg.startTime / 1000)} - ${formatTimeShort(reg.endTime / 1000)} (${durSec}s)`;
      }
    }
    const modeSelect = document.getElementById('blurTrackModeSelect');
    if (modeSelect) modeSelect.value = reg.mode || 'content';
    const styleSelect = document.getElementById('blurStyleSelect');
    if (styleSelect) styleSelect.value = reg.style || 'gaussian';
    const intensitySlider = document.getElementById('blurIntensitySlider');
    const intensityVal = document.getElementById('blurIntensityValue');
    const curInt = Number(reg.intensity ?? 18);
    if (intensitySlider) intensitySlider.value = String(curInt);
    if (intensityVal) intensityVal.textContent = `${curInt}px`;
    document.querySelectorAll('.blur-intensity-preset-btn').forEach(btn => {
      const pVal = parseInt(btn.dataset.intensity, 10);
      const isAct = Math.abs(curInt - pVal) <= 2;
      btn.classList.toggle('active', isAct);
      btn.style.borderColor = isAct ? 'rgba(34, 211, 238, 0.45)' : 'var(--border)';
      btn.style.background = isAct ? 'rgba(6, 182, 212, 0.16)' : '#080a10';
      btn.style.color = isAct ? '#67e8f9' : 'var(--text-secondary)';
    });
    const radiusSelect = document.getElementById('blurRadiusSelect');
    if (radiusSelect) radiusSelect.value = String(reg.radius ?? 14);
    const fullToggle = document.getElementById('blurFullVideoToggle');
    if (fullToggle) fullToggle.checked = Boolean(reg.fullVideo);
  }

  if (options.seek && video && !reg.fullVideo) {
    const curMs = video.currentTime * 1000;
    if (curMs < reg.startTime || curMs > reg.endTime) {
      video.currentTime = (reg.startTime + Math.min(300, (reg.endTime - reg.startTime) / 2)) / 1000;
    }
  }

  updateBlurList();
  requestPreviewRedraw();
}

function syncDrawBlurModeButtonUI() {
  ['drawBlurModeBtn', 'drawBlurOnCanvasBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('active', isDrawBlurMode);
    btn.style.background = isDrawBlurMode ? 'rgba(6, 182, 212, 0.24)' : '';
    btn.style.borderColor = isDrawBlurMode ? '#22d3ee' : '';
    btn.style.color = isDrawBlurMode ? '#ecfeff' : '';
    btn.innerHTML = isDrawBlurMode
      ? `${studioIcon('target', 12, '', 'color:#22d3ee;margin-right:4px;')}<span>Click &amp; Drag on Video...</span>`
      : `${studioIcon('pencil', 12, '', 'color:#22d3ee;margin-right:4px;')}<span>Draw on Video</span>`;
  });
  if (previewCanvas) {
    previewCanvas.style.cursor = isDrawBlurMode ? 'crosshair' : 'default';
  }
}

function deselectAllBlurs() {
  selectedBlurIndex = -1;
  document.querySelectorAll('.blur-segment-pill').forEach(el => el.classList.remove('selected'));
  const inspector = document.getElementById('selectedBlurInspector');
  if (inspector) inspector.style.display = 'none';
  updateBlurList();
  requestPreviewRedraw();
}

function deleteSelectedBlur() {
  if (selectedBlurIndex < 0 || selectedBlurIndex >= blurRegions.length) return;
  saveState();
  blurRegions.splice(selectedBlurIndex, 1);
  selectedBlurIndex = blurRegions.length > 0 ? Math.min(selectedBlurIndex, blurRegions.length - 1) : -1;
  if (selectedBlurIndex >= 0) {
    selectBlur(selectedBlurIndex, { seek: false });
  } else {
    deselectAllBlurs();
  }
  updateBlurUI();
  requestPreviewRedraw();
  showToast('Deleted Manual Blur');
}

function duplicateSelectedBlur() {
  if (selectedBlurIndex < 0 || selectedBlurIndex >= blurRegions.length) return;
  const src = blurRegions[selectedBlurIndex];
  addBlurRegion({
    startTime: src.startTime,
    endTime: src.endTime,
    fullVideo: src.fullVideo,
    x: Math.min(0.82, src.x + 0.04),
    y: Math.min(0.82, src.y + 0.04),
    width: src.width,
    height: src.height,
    mode: src.mode,
    style: src.style,
    intensity: src.intensity,
    radius: src.radius
  });
}

function renderBlurSegments() {
  const layer = document.getElementById('blurSegmentsLayer');
  if (!layer) return;
  layer.innerHTML = '';

  const dur = getVideoDuration();
  if (!dur || dur <= 0 || !Array.isArray(blurRegions) || blurRegions.length === 0) return;

  blurRegions.forEach((reg, idx) => {
    const startSec = reg.fullVideo ? 0 : (reg.startTime / 1000);
    const endSec = reg.fullVideo ? dur : (reg.endTime / 1000);
    const leftPct = Math.max(0, Math.min(99, (startSec / dur) * 100));
    const widthPct = Math.max(1.8, Math.min(100 - leftPct, ((endSec - startSec) / dur) * 100));

    const pill = document.createElement('div');
    pill.className = `blur-segment-pill${idx === selectedBlurIndex ? ' selected' : ''}`;
    pill.dataset.index = String(idx);
    pill.style.left = `${leftPct}%`;
    pill.style.width = `${widthPct}%`;
    pill.title = `Manual Blur #${idx + 1} (${reg.mode === 'screen' ? 'Screen-Locked' : 'Zoom-Synced'})`;

    if (!reg.fullVideo) {
      const leftH = document.createElement('div');
      leftH.className = 'blur-handle blur-handle-left';
      leftH.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectBlur(idx, { seek: false });
        startDrag(e, 'blur-handle-left', idx);
      });
      pill.appendChild(leftH);

      const rightH = document.createElement('div');
      rightH.className = 'blur-handle blur-handle-right';
      rightH.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectBlur(idx, { seek: false });
        startDrag(e, 'blur-handle-right', idx);
      });
      pill.appendChild(rightH);
    }

    const label = document.createElement('span');
    label.style.pointerEvents = 'none';
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = '3px';
    label.innerHTML = widthPct > 6
      ? `${studioIcon('mask', 11, '', 'color:#22d3ee;')}<span>Blur #${idx + 1}</span>`
      : `${studioIcon('mask', 11, '', 'color:#22d3ee;')}`;
    pill.appendChild(label);

    pill.addEventListener('mousedown', (e) => {
      if (e.target.closest('.blur-handle')) return;
      e.preventDefault();
      e.stopPropagation();
      selectBlur(idx, { seek: true });
      if (!reg.fullVideo) {
        startDrag(e, 'blur-segment', idx);
      }
    });

    layer.appendChild(pill);
  });
}

function updateBlurList() {
  const listEl = document.getElementById('blurList');
  const badgeEl = document.getElementById('blurCountBadge');
  if (badgeEl) {
    badgeEl.textContent = `${blurRegions.length} blur${blurRegions.length === 1 ? '' : 's'}`;
  }
  if (!listEl) return;
  listEl.innerHTML = '';

  if (blurRegions.length === 0) {
    listEl.innerHTML = `<div style="font-size: 11px; color: var(--text-muted); padding: 6px 2px;">No manual blur boxes added yet. Click <strong>+ Add Blur Box</strong> or press <kbd style="background:#080a10;padding:1px 5px;border-radius:4px;border:1px solid var(--border);">B</kbd>.</div>`;
    return;
  }

  blurRegions.forEach((reg, idx) => {
    const item = document.createElement('div');
    const isSel = idx === selectedBlurIndex;
    item.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:7px 9px;border-radius:8px;cursor:pointer;font-size:11.5px;background:${isSel ? 'rgba(6, 182, 212, 0.16)' : 'rgba(255,255,255,0.03)'};border:1px solid ${isSel ? 'rgba(34, 211, 238, 0.5)' : 'var(--border)'};transition:all 0.14s ease;`;
    const timeLabel = reg.fullVideo
      ? 'Entire Video'
      : `${formatTimeShort(reg.startTime / 1000)} - ${formatTimeShort(reg.endTime / 1000)}`;
    const styleBadge = reg.style === 'pixelate' ? 'Mosaic' : (reg.style === 'solid' ? 'Redacted' : 'Frosted');
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:7px;">
        <span style="color:#22d3ee;font-weight:700;display:inline-flex;align-items:center;gap:4px;">${studioIcon('mask', 11, '', 'color:#22d3ee;')} #${idx + 1}</span>
        <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-secondary);">${timeLabel}</span>
        <span style="font-size:9.5px;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,0.06);color:var(--text-muted);">${styleBadge}</span>
      </div>
      <button type="button" class="blur-item-del" title="Delete blur" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px;padding:0 3px;">&times;</button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.blur-item-del')) {
        e.stopPropagation();
        selectedBlurIndex = idx;
        deleteSelectedBlur();
        return;
      }
      selectBlur(idx, { seek: true });
    });
    listEl.appendChild(item);
  });
}

function updateBlurUI() {
  renderBlurSegments();
  updateBlurList();
  if (selectedBlurIndex >= 0 && selectedBlurIndex < blurRegions.length) {
    selectBlur(selectedBlurIndex, { seek: false });
  }
}

function toggleMute() {
  if (!video) return;
  video.muted = !video.muted;
  const muteBtn = document.getElementById('muteBtn');
  const muteIcon = document.getElementById('muteIcon');
  if (video.muted) {
    muteBtn?.classList.add('active');
    if (muteIcon) {
      muteIcon.innerHTML = '<use href="#icon-volume-x"></use>';
    }
    muteBtn?.setAttribute('title', 'Unmute preview audio (M)');
  } else {
    muteBtn?.classList.remove('active');
    if (muteIcon) {
      muteIcon.innerHTML = '<use href="#icon-volume"></use>';
    }
    muteBtn?.setAttribute('title', 'Mute preview audio (M)');
  }
}

function toggleShortcutsModal(forceOpen) {
  const modal = document.getElementById('shortcutsModal');
  if (!modal) return;
  if (typeof forceOpen === 'boolean') {
    if (forceOpen) modal.classList.remove('hidden');
    else modal.classList.add('hidden');
  } else {
    modal.classList.toggle('hidden');
  }
}

function setupEventListeners() {
  // Play button
  playBtn.addEventListener('click', togglePlay);

  // Mute button
  document.getElementById('muteBtn')?.addEventListener('click', toggleMute);

  // Playback speed selector
  document.getElementById('playbackSpeed')?.addEventListener('change', function () {
    if (video) {
      video.playbackRate = parseFloat(this.value);
      settings.playbackSpeed = video.playbackRate;
      debugLog('[Editor] Playback speed set to:', video.playbackRate);
    }
  });


  // Shortcuts modal buttons
  document.getElementById('shortcutsBtn')?.addEventListener('click', () => toggleShortcutsModal(true));
  document.getElementById('closeShortcutsModal')?.addEventListener('click', () => toggleShortcutsModal(false));
  document.getElementById('shortcutsBackdrop')?.addEventListener('click', () => toggleShortcutsModal(false));

  // New recording button
  document.getElementById('newRecordingBtn')?.addEventListener('click', startNewRecording);
  document.getElementById('loadVideoBtn')?.addEventListener('click', loadVideoFromFile);

  // Topbar shortcuts & actions
  document.getElementById('loadVideoTopBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof toggleMediaDrawer === 'function') {
      toggleMediaDrawer();
    } else {
      loadVideoFromFile();
    }
  });
  document.getElementById('newRecordingTopBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    startNewRecording();
  });
  document.getElementById('exportTopBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    exportVideo(e);
  });
  document.getElementById('topbarUndoBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    undo();
  });
  document.getElementById('topbarRedoBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    redo();
  });
  document.getElementById('topbarEditModeBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof closeMediaDrawer === 'function') {
      closeMediaDrawer();
    }
    showToast('In Studio Video Editor');
  });

  // Export button
  document.getElementById('exportBtn')?.addEventListener('click', (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    exportVideo(e);
  });

  // Capture-phase document delegation to guarantee Export button clicks ALWAYS trigger
  document.addEventListener('click', (e) => {
    const btn = e.target && typeof e.target.closest === 'function' ? (e.target.closest('#exportTopBtn') || e.target.closest('#exportBtn')) : null;
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      exportVideo(e);
    }
  }, true);

  // Drag-and-drop video file on empty state
  const emptyStateDrop = document.getElementById('emptyState');
  if (emptyStateDrop) {
    emptyStateDrop.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.add('drag-over');
    });
    emptyStateDrop.addEventListener('dragleave', function (e) {
      e.preventDefault();
      this.classList.remove('drag-over');
    });
    emptyStateDrop.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('video/')) {
        loadVideoFileDirectly(file);
      } else if (file) {
        alert('Please drop a valid video file (MP4, WebM, MOV).');
      }
    });
  }

  // Also allow drag-and-drop on preview area
  const previewAreaDrop = document.querySelector('.preview-area');
  if (previewAreaDrop) {
    previewAreaDrop.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    previewAreaDrop.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('video/')) {
        loadVideoFileDirectly(file);
      }
    });
  }

  // Toolbar buttons
  document.getElementById('resetTimelineBtn').addEventListener('click', resetTimeline);

  // Background options (only gradients now)
  document.querySelectorAll('.bg-option').forEach(opt => {
    opt.addEventListener('click', function () {
      const bg = this.dataset.bg;
      document.querySelectorAll('.bg-option').forEach(o => o.classList.remove('selected'));
      this.classList.add('selected');
      settings.background = bg;
      settings.backgroundImage = null; // Clear image when selecting gradient
      updateBackground();
    });
  });

  // Background tabs
  document.querySelectorAll('.bg-tab').forEach(tab => {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.bg-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');

      const bgType = this.dataset.bgType;
      const bgGridMac = document.getElementById('bgGridMac');
      const bgGrid = document.getElementById('bgGrid');

      if (bgType === 'mac') {
        if (bgGridMac) { bgGridMac.classList.remove('hidden'); bgGridMac.style.display = 'grid'; }
        if (bgGrid) { bgGrid.classList.add('hidden'); bgGrid.style.display = 'none'; }
        if (!settings.background || !settings.background.startsWith('mac-') || settings.backgroundImage) {
          settings.background = 'mac-sequoia';
          settings.backgroundImage = null;
          document.querySelectorAll('.bg-option').forEach(o => o.classList.remove('selected'));
          document.querySelector('.bg-option[data-bg="mac-sequoia"]')?.classList.add('selected');
        }
        updateBackground();
      } else if (bgType === 'gradient') {
        if (bgGridMac) { bgGridMac.classList.add('hidden'); bgGridMac.style.display = 'none'; }
        if (bgGrid) { bgGrid.classList.remove('hidden'); bgGrid.style.display = 'grid'; }
        if (!settings.background || !settings.background.startsWith('grad-') || settings.backgroundImage) {
          settings.background = 'grad-1';
          settings.backgroundImage = null;
          document.querySelectorAll('.bg-option').forEach(o => o.classList.remove('selected'));
          document.querySelector('.bg-option[data-bg="grad-1"]')?.classList.add('selected');
        }
        updateBackground();
      } else if (bgType === 'hidden') {
        if (bgGridMac) { bgGridMac.classList.add('hidden'); bgGridMac.style.display = 'none'; }
        if (bgGrid) { bgGrid.classList.add('hidden'); bgGrid.style.display = 'none'; }
        settings.background = 'hidden';
        settings.backgroundImage = null;
        updateBackground();
      } else if (bgType === 'upload') {
        if (bgGridMac) { bgGridMac.classList.add('hidden'); bgGridMac.style.display = 'none'; }
        if (bgGrid) { bgGrid.classList.add('hidden'); bgGrid.style.display = 'none'; }
        uploadBackground();
      }
    });
  });

  // Settings dropdowns
  document.getElementById('aspectSelect').addEventListener('change', function () {
    settings.aspectRatio = this.value;
    updateFrameSize();
  });

  document.getElementById('showMacWindowHeader')?.addEventListener('change', function () {
    settings.showMacWindowHeader = this.checked;
    const macHeader = document.getElementById('macWindowHeader');
    if (macHeader) {
      macHeader.classList.toggle('hidden', !settings.showMacWindowHeader);
    }
    if (videoLoaded) {
      updateFrameSize();
    }
    requestPreviewRedraw();
  });

  document.getElementById('windowPadding')?.addEventListener('change', function () {
    settings.padding = parseInt(this.value);
    updateFrameSize();
  });

  document.getElementById('windowRadius')?.addEventListener('change', function () {
    settings.borderRadius = parseInt(this.value);
    updateFrameSize();
  });

  // Follow-mode camera feel (applies to preview and export)
  const cameraFeelHints = {
    smooth: 'Calm glide. Holds still while you work in one area, re-frames when you pause, and lines up each click.',
    focused: 'Quicker re-framing with a smaller still zone. Good for fast demos.',
    tight: 'Keeps the cursor close to centre. Snappiest tracking.'
  };
  const applyCameraFeel = (style, persist) => {
    if (!style || !ZoomAnalyzer.CAMERA_PRESETS[style]) return;
    settings.cameraStyle = style;
    if (analyzer) {
      analyzer.cameraStyle = style;
      if (typeof analyzer.invalidatePathCache === 'function') analyzer.invalidatePathCache();
    }
    document.querySelectorAll('.camera-feel-btn').forEach(b => {
      const on = b.dataset.style === style;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const hint = document.getElementById('cameraFeelHint');
    if (hint) hint.textContent = cameraFeelHints[style];
    if (persist) {
      try { localStorage.setItem('cursordemo.cameraStyle', style); } catch (e) { /* storage unavailable */ }
    }
    requestPreviewRedraw();
  };
  document.querySelectorAll('.camera-feel-btn').forEach(btn => {
    btn.addEventListener('click', () => applyCameraFeel(btn.dataset.style, true));
  });
  try {
    const savedFeel = localStorage.getItem('cursordemo.cameraStyle') || localStorage.getItem('cursorfly.cameraStyle');
    if (savedFeel && savedFeel !== settings.cameraStyle) applyCameraFeel(savedFeel, false);
  } catch (e) { /* storage unavailable */ }

  const adaptiveEdgeZoomCheckbox = document.getElementById('adaptiveEdgeZoom');
  try {
    const savedEdgeZoom = localStorage.getItem('cursordemo.adaptiveEdgeZoom') ?? localStorage.getItem('cursorfly.adaptiveEdgeZoom');
    if (savedEdgeZoom !== null) {
      settings.adaptiveEdgeZoom = savedEdgeZoom === 'true';
      if (analyzer) analyzer.adaptiveEdgeZoom = settings.adaptiveEdgeZoom;
    }
  } catch (e) { /* storage unavailable */ }
  if (adaptiveEdgeZoomCheckbox) {
    adaptiveEdgeZoomCheckbox.checked = settings.adaptiveEdgeZoom !== false;
    adaptiveEdgeZoomCheckbox.addEventListener('change', function () {
      settings.adaptiveEdgeZoom = this.checked;
      if (analyzer) {
        analyzer.adaptiveEdgeZoom = this.checked;
        if (typeof analyzer.invalidatePathCache === 'function') {
          analyzer.invalidatePathCache();
        }
      }
      try {
        localStorage.setItem('cursordemo.adaptiveEdgeZoom', this.checked ? 'true' : 'false');
      } catch (e) { /* storage unavailable */ }
      requestPreviewRedraw();
    });
  }

  document.getElementById('zoomDepth').addEventListener('change', function () {
    settings.zoomDepth = this.value;
    if (analyzer) {
      analyzer.ZOOM_LEVEL = zoomDepths[settings.zoomDepth];
      reanalyzeZoom();
    }
  });

  document.getElementById('segModeFollowBtn')?.addEventListener('click', function () {
    if (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length) {
      saveState();
      const seg = zoomSegments[selectedZoomIndex];
      seg.mode = 'follow';
      if (analyzer && typeof analyzer.invalidatePathCache === 'function') analyzer.invalidatePathCache();
      const modeSelect = document.getElementById('selectedSegmentMode');
      if (modeSelect) modeSelect.value = 'follow';
      updateSegmentModeButtons('follow');
      const focalRow = document.getElementById('inspectorFocalPositionRow');
      if (focalRow) focalRow.style.display = 'none';
      previewCanvas?.classList.remove('focal-target-mode');
      updateZoomList();
      renderZoomSegments();
      requestPreviewRedraw();
    }
  });

  document.getElementById('segModeFixedBtn')?.addEventListener('click', function () {
    if (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length) {
      saveState();
      const seg = zoomSegments[selectedZoomIndex];
      seg.mode = 'fixed';
      ensureSegmentFixedCoords(seg);
      if (analyzer && typeof analyzer.invalidatePathCache === 'function') analyzer.invalidatePathCache();
      const modeSelect = document.getElementById('selectedSegmentMode');
      if (modeSelect) modeSelect.value = 'fixed';
      updateSegmentModeButtons('fixed');
      const focalRow = document.getElementById('inspectorFocalPositionRow');
      if (focalRow) focalRow.style.display = 'block';
      previewCanvas?.classList.add('focal-target-mode');
      updateZoomInspectorCoords(seg);
      updateZoomList();
      renderZoomSegments();
      requestPreviewRedraw();
    }
  });

  document.getElementById('selectedSegmentMode')?.addEventListener('change', function () {
    if (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length) {
      saveState();
      const seg = zoomSegments[selectedZoomIndex];
      seg.mode = this.value;
      if (this.value === 'fixed') {
        ensureSegmentFixedCoords(seg);
      }
      if (analyzer && typeof analyzer.invalidatePathCache === 'function') analyzer.invalidatePathCache();
      updateSegmentModeButtons(this.value);
      const focalRow = document.getElementById('inspectorFocalPositionRow');
      if (focalRow) {
        focalRow.style.display = (this.value === 'fixed') ? 'block' : 'none';
      }
      previewCanvas?.classList.toggle('focal-target-mode', this.value === 'fixed');
      updateZoomInspectorCoords(seg);
      updateZoomList();
      renderZoomSegments();
      requestPreviewRedraw();
    }
  });

  // Snap focal target directly to current cursor location (Screen Studio / Cursorful feature)
  document.getElementById('btnSnapFocalToCursor')?.addEventListener('click', function () {
    if (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length) {
      saveState();
      const seg = zoomSegments[selectedZoomIndex];
      seg.mode = 'fixed';
      const modeSelect = document.getElementById('selectedSegmentMode');
      if (modeSelect) modeSelect.value = 'fixed';
      updateSegmentModeButtons('fixed');
      const focalRow = document.getElementById('inspectorFocalPositionRow');
      if (focalRow) focalRow.style.display = 'block';
      previewCanvas?.classList.add('focal-target-mode');

      const timestamp = video.currentTime * 1000;
      const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
      const visibleHeight = Math.max(1, videoHeight - browserUIHeight);
      const cur = analyzer ? analyzer.getCursorAtTime(timestamp, videoWidth, videoHeight, displaySurface) : null;
      if (cur) {
        seg.centerX = Math.max(0, Math.min(videoWidth, cur.x));
        seg.centerY = Math.max(browserUIHeight, Math.min(videoHeight, cur.y));
      } else {
        seg.centerX = videoWidth / 2;
        seg.centerY = browserUIHeight + visibleHeight / 2;
      }
      seg.normalizedX = videoWidth > 0 ? seg.centerX / videoWidth : 0.5;
      seg.normalizedY = videoHeight > 0 ? seg.centerY / videoHeight : 0.5;
      if (analyzer && typeof analyzer.invalidatePathCache === 'function') analyzer.invalidatePathCache();
      updateZoomInspectorCoords(seg);
      renderZoomSegments();
      updateZoomList();
      requestPreviewRedraw();
    }
  });

  // Duplicate selected zoom button
  document.getElementById('duplicateSelectedZoomBtn')?.addEventListener('click', function () {
    duplicateSelectedZoom();
  });

  // Preset focal spots (Center, Top-Left, etc.)
  document.querySelectorAll('.btn-preset-spot').forEach(btn => {
    btn.addEventListener('click', function () {
      const spot = this.dataset.spot;
      if (spot) setZoomFocalPreset(spot);
    });
  });

  // Edge sharpening toggle
  document.getElementById('showSharpening')?.addEventListener('change', function () {
    settings.sharpening = this.checked;
    debugLog('[Editor] Edge sharpening:', settings.sharpening ? 'enabled' : 'disabled');
    requestPreviewRedraw();
  });

  // Re-analyze zoom button
  document.getElementById('reanalyzeZoomBtn')?.addEventListener('click', function () {
    if (!videoLoaded || !analyzer) return;
    saveState();
    reanalyzeZoom();
    const badge = document.getElementById('zoomCountBadge');
    if (badge) {
      badge.style.transform = 'scale(1.2)';
      setTimeout(() => { badge.style.transform = 'scale(1)'; }, 200);
    }
    requestPreviewRedraw();
  });

  // Dual Zoom Mode Dropdowns & Quick Add
  const sidebarAddZoomBtn = document.getElementById('sidebarAddZoomBtn');
  const sidebarZoomMenu = document.getElementById('sidebarZoomMenu');
  const addZoomBtn = document.getElementById('addZoomBtn');
  const timelineZoomMenu = document.getElementById('timelineZoomMenu');

  function closeAllZoomMenus() {
    if (sidebarZoomMenu) sidebarZoomMenu.style.display = 'none';
    if (timelineZoomMenu) timelineZoomMenu.style.display = 'none';
  }

  sidebarAddZoomBtn?.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!sidebarZoomMenu) return;
    const isShowing = sidebarZoomMenu.style.display === 'block';
    closeAllZoomMenus();
    sidebarZoomMenu.style.display = isShowing ? 'none' : 'block';
  });

  addZoomBtn?.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!timelineZoomMenu) return;
    const isShowing = timelineZoomMenu.style.display === 'block';
    closeAllZoomMenus();
    timelineZoomMenu.style.display = isShowing ? 'none' : 'block';
  });

  document.addEventListener('click', function () {
    closeAllZoomMenus();
  });

  document.querySelectorAll('.zoom-mode-option-btn').forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const mode = this.dataset.mode || 'follow';
      closeAllZoomMenus();
      addZoomAtCurrentTime(mode);
    });
  });

  document.getElementById('quickAddFollowBtn')?.addEventListener('click', function (e) {
    e.stopPropagation();
    closeAllZoomMenus();
    addZoomAtCurrentTime('follow');
  });

  document.getElementById('quickAddFixedBtn')?.addEventListener('click', function (e) {
    e.stopPropagation();
    closeAllZoomMenus();
    addZoomAtCurrentTime('fixed');
  });

  // Selected segment custom zoom numeric input
  const inspectorCustomZoomInput = document.getElementById('inspectorCustomZoomInput');
  if (inspectorCustomZoomInput) {
    let _inspectorInputSavedState = false;
    inspectorCustomZoomInput.addEventListener('focus', () => {
      _inspectorInputSavedState = false;
    });
    inspectorCustomZoomInput.addEventListener('input', function () {
      if (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length) {
        const val = parseFloat(this.value);
        if (isFinite(val) && val >= 1.05 && val <= 3.50) {
          if (!_inspectorInputSavedState) {
            saveState();
            _inspectorInputSavedState = true;
          }
          setSegmentZoomLevel(selectedZoomIndex, val, false);
        }
      }
    });
    inspectorCustomZoomInput.addEventListener('change', function () {
      _inspectorInputSavedState = false;
    });
  }

  // Selected segment depth changer
  document.getElementById('selectedSegmentDepth')?.addEventListener('change', function () {
    if (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length) {
      if (this.value === 'custom') {
        const inp = document.getElementById('inspectorCustomZoomInput');
        if (inp) {
          inp.focus();
          inp.select();
        }
        return;
      }
      const val = parseFloat(this.value);
      if (isFinite(val)) {
        saveState();
        setSegmentZoomLevel(selectedZoomIndex, val, false);
        const inp = document.getElementById('inspectorCustomZoomInput');
        if (inp) inp.value = (+val.toFixed(2)).toString();
      }
    }
  });

  // Setup quick zoom popover, context menu, and editor right-click controllers
  setupZoomEditControls();

  // Delete selected zoom button
  document.getElementById('deleteSelectedZoomBtn')?.addEventListener('click', function () {
    deleteSelectedZoom();
    requestPreviewRedraw();
  });

  // Click Ripple Effects toggle
  document.getElementById('clickEnabled')?.addEventListener('change', function () {
    const clickStyleSelect = document.getElementById('clickStyle');
    const clickStyleRow = document.getElementById('clickStyleRow');
    const clickWavesRow = document.getElementById('clickWavesRow');

    settings.clickEnabled = this.checked;
    if (this.checked) {
      settings.clickStyle = clickStyleSelect ? clickStyleSelect.value : 'ripple';
      if (clickStyleRow) clickStyleRow.style.opacity = '1';
      if (clickWavesRow) clickWavesRow.style.opacity = '1';
    } else {
      settings.clickStyle = 'none';
      if (clickStyleRow) clickStyleRow.style.opacity = '0.5';
      if (clickWavesRow) clickWavesRow.style.opacity = '0.5';
    }
    requestPreviewRedraw();
  });

  // Pulse style select
  document.getElementById('clickStyle')?.addEventListener('change', function () {
    if (document.getElementById('clickEnabled')?.checked) {
      settings.clickStyle = this.value;
    }
    const clickWavesRow = document.getElementById('clickWavesRow');
    if (clickWavesRow) {
      clickWavesRow.style.display = (this.value === 'orb') ? 'none' : 'flex';
    }
    requestPreviewRedraw();
  });

  // Ripple waves select
  document.getElementById('clickWaves')?.addEventListener('change', function () {
    settings.clickWaves = this.value;
    requestPreviewRedraw();
  });

  // Click color options
  document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', function () {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      this.classList.add('selected');
      settings.clickColor = this.dataset.color;
      // Update color picker and hex input to match preset color
      const presetColor = clickColors[this.dataset.color];
      if (presetColor) {
        // Ensure preset colors are always 6-digit (they should be, but normalize just in case)
        let normalizedColor = presetColor;
        if (presetColor.length === 4 && presetColor.startsWith('#')) {
          normalizedColor = '#' + presetColor[1] + presetColor[1] + presetColor[2] + presetColor[2] + presetColor[3] + presetColor[3];
        }
        const customColorPicker = document.getElementById('customColorPicker');
        const hexColorInput = document.getElementById('hexColorInput');
        if (customColorPicker) customColorPicker.value = normalizedColor;
        if (hexColorInput) hexColorInput.value = normalizedColor;
        settings.customClickColor = normalizedColor;
      }
      requestPreviewRedraw();
    });
  });

  // Custom color picker
  const customColorPicker = document.getElementById('customColorPicker');
  if (customColorPicker) {
    customColorPicker.addEventListener('input', function () {
      const color = this.value;
      const hexColorInput = document.getElementById('hexColorInput');
      if (hexColorInput) hexColorInput.value = color;
      settings.customClickColor = color;
      // Deselect preset colors when using custom color
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      requestPreviewRedraw();
    });
  }

  // Hex color input
  const hexColorInput = document.getElementById('hexColorInput');
  if (hexColorInput) {
    hexColorInput.addEventListener('input', function () {
      let color = this.value.trim();
      // Add # if missing
      if (!color.startsWith('#')) {
        color = '#' + color;
      }
      // Validate hex color
      const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (hexRegex.test(color)) {
        // Normalize 3-digit hex to 6-digit for color picker compatibility
        let normalizedColor = color;
        if (color.length === 4) {
          normalizedColor = '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
        }
        this.value = color; // Keep original format in input for user
        const customColorPicker = document.getElementById('customColorPicker');
        if (customColorPicker) customColorPicker.value = normalizedColor; // Use normalized for picker
        settings.customClickColor = normalizedColor; // Store normalized version
        // Deselect preset colors when using custom color
        document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
        requestPreviewRedraw();
      }
    });

    hexColorInput.addEventListener('blur', function () {
      let color = this.value.trim();
      // Add # if missing
      if (!color.startsWith('#')) {
        color = '#' + color;
      }
      // Validate and normalize hex color
      const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (hexRegex.test(color)) {
        // Normalize 3-digit hex to 6-digit
        if (color.length === 4) {
          color = '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
        }
        this.value = color;
        const customColorPicker = document.getElementById('customColorPicker');
        if (customColorPicker) customColorPicker.value = color;
        settings.customClickColor = color;
      } else {
        // Reset to current custom color or default
        const currentColor = settings.customClickColor || clickColors[settings.clickColor] || '#ffffff';
        this.value = currentColor;
      }
      requestPreviewRedraw();
    });
  }

  // Click intensity option
  document.getElementById('clickForce')?.addEventListener('change', function () {
    settings.clickForce = this.value;
    requestPreviewRedraw();
  });

  // Browser frame toggle
  const showBrowserFrameCheckbox = document.getElementById('showBrowserFrame');
  const showShadowCheckbox = document.getElementById('showShadow');

  showBrowserFrameCheckbox?.addEventListener('change', function () {
    settings.cleanBrowser = this.checked;
    settings.showBrowserFrame = !this.checked;
    debugLog('[Editor] Clean browser (crop tabs):', settings.cleanBrowser ? 'enabled (tabs cropped)' : 'disabled (original tabs shown)');

    const hint = document.getElementById('browserFrameHint');
    if (hint) {
      hint.textContent = settings.cleanBrowser
        ? 'Clean browser enabled • browser tabs & address bar cropped'
        : 'Original browser address bar & tabs shown';
    }

    if (analyzer && typeof analyzer.invalidatePathCache === 'function') {
      analyzer.invalidatePathCache();
    }

    if (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length) {
      updateZoomInspectorCoords(zoomSegments[selectedZoomIndex]);
    }

    // Update frame size which handles canvas resizing for all aspect ratios
    if (videoLoaded) {
      updateFrameSize();
    }
    requestPreviewRedraw();
  });

  // Shadow effect toggle
  showShadowCheckbox?.addEventListener('change', function () {
    settings.showShadow = this.checked;
    debugLog('[Editor] Shadow effect:', settings.showShadow ? 'enabled' : 'disabled');

    // Update preview shadow effect
    if (videoWindow) {
      if (settings.showShadow) {
        videoWindow.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.22), 0 28px 68px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.12) inset';
      } else {
        videoWindow.style.boxShadow = 'none';
      }
    }
  });

  // Initialize shadow effect on load
  if (showShadowCheckbox && videoWindow) {
    if (settings.showShadow) {
      videoWindow.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.22), 0 28px 68px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.12) inset';
    } else {
      videoWindow.style.boxShadow = 'none';
    }
  }

  // Cursor Highlight toggle & OpenScreen-style customization controls
  document.getElementById('cursorHighlightEnabled')?.addEventListener('change', function () {
    settings.cursorHighlight = this.checked;
    try {
      localStorage.setItem('cursordemo.cursorHighlight', this.checked ? 'true' : 'false');
    } catch (_) { }
    const controlsEl = document.getElementById('cursorHighlightControls');
    if (controlsEl) {
      controlsEl.style.display = this.checked ? 'flex' : 'none';
    }
    requestPreviewRedraw();
    if (this.checked) {
      if (!cursorData || cursorData.length === 0) {
        showToast('No cursor telemetry in this video (recorded on internal/restricted tab). Record a standard website (https://) to track cursor.');
      } else {
        showToast('Cursor Highlight enabled — visible in preview & export');
      }
    }
  });

  document.getElementById('cursorHighlightStyle')?.addEventListener('change', function () {
    settings.cursorHighlightStyle = this.value || 'halo';
    try {
      localStorage.setItem('cursordemo.cursorHighlightStyle', settings.cursorHighlightStyle);
    } catch (_) { }
    requestPreviewRedraw();
  });

  document.getElementById('cursorHighlightSize')?.addEventListener('input', function () {
    const pct = parseInt(this.value, 10) || 100;
    settings.cursorHighlightSize = Math.max(0.5, Math.min(2.5, pct / 100));
    const label = document.getElementById('cursorHighlightSizeValue');
    if (label) label.textContent = `${pct}%`;
    try {
      localStorage.setItem('cursordemo.cursorHighlightSize', String(settings.cursorHighlightSize));
    } catch (_) { }
    requestPreviewRedraw();
  });

  document.querySelectorAll('.cursor-hl-color-chip').forEach((chip) => {
    chip.addEventListener('click', function () {
      const col = this.getAttribute('data-hl-color') || '#ffab00';
      settings.cursorHighlightColor = col;
      const colorInp = document.getElementById('cursorHighlightColor');
      if (colorInp) colorInp.value = col;
      document.querySelectorAll('.cursor-hl-color-chip').forEach((c) => {
        const isAct = c === this;
        c.classList.toggle('active', isAct);
        c.style.border = isAct ? '2px solid #ffffff' : '1px solid var(--border)';
      });
      try {
        localStorage.setItem('cursordemo.cursorHighlightColor', col);
      } catch (_) { }
      requestPreviewRedraw();
    });
  });

  document.getElementById('cursorHighlightColor')?.addEventListener('input', function () {
    const col = this.value || '#ffab00';
    settings.cursorHighlightColor = col;
    document.querySelectorAll('.cursor-hl-color-chip').forEach((c) => {
      const isAct = (c.getAttribute('data-hl-color') || '').toLowerCase() === col.toLowerCase();
      c.classList.toggle('active', isAct);
      c.style.border = isAct ? '2px solid #ffffff' : '1px solid var(--border)';
    });
    try {
      localStorage.setItem('cursordemo.cursorHighlightColor', col);
    } catch (_) { }
    requestPreviewRedraw();
  });

  // Studio Inspector Category Dock & Drawer Management (OpenScreen NLE Style)
  const categoryMetadata = {
    frame: { title: 'Frame & Canvas', icon: 'icon-frame' },
    zoom: { title: 'Camera & Auto-Zoom', icon: 'icon-zoom' },
    cursor: { title: 'Cursor & Interaction', icon: 'icon-pointer' },
    webcam: { title: 'Webcam Overlay', icon: 'icon-camera' },
    blur: { title: 'Blur & Privacy', icon: 'icon-mask' },
    all: { title: 'All Studio Controls', icon: 'icon-sliders' }
  };

  const inspectorDrawer = document.getElementById('inspectorDrawer');
  const drawerTitle = document.getElementById('inspectorDrawerTitle');
  const drawerIcon = document.getElementById('inspectorDrawerIcon');
  const closeDrawerBtn = document.getElementById('closeInspectorDrawerBtn');

  function openCategory(targetGroup) {
    if (inspectorDrawer) {
      inspectorDrawer.classList.remove('collapsed');
      const savedW = parseInt(localStorage.getItem('cursordemo_inspector_width'), 10) || 340;
      inspectorDrawer.style.width = savedW + 'px';
    }

    // Update dock tab buttons
    document.querySelectorAll('.inspector-tab-btn[data-inspector-tab]').forEach(b => {
      const active = b.dataset.inspectorTab === targetGroup;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    // Update drawer header title and icon
    const meta = categoryMetadata[targetGroup] || categoryMetadata.all;
    if (drawerTitle) drawerTitle.textContent = meta.title;
    if (drawerIcon) drawerIcon.innerHTML = `<use href="#${meta.icon}"></use>`;

    // Show/hide matching panel sections
    document.querySelectorAll('.sidebar-content-scrollable .panel-section[data-panel-group]').forEach(sec => {
      const group = sec.dataset.panelGroup;
      const show = targetGroup === 'all' || group === targetGroup;
      sec.dataset.hiddenByTab = show ? 'false' : 'true';
      sec.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('.sidebar-content-scrollable .section-divider').forEach(div => {
      div.style.display = targetGroup === 'all' ? '' : 'none';
    });

    // Reset scroll to top for seamless category feel
    const scrollable = document.querySelector('.sidebar-content-scrollable');
    if (scrollable) scrollable.scrollTop = 0;

    // Trigger video frame resize after drawer transition
    if (typeof updateFrameSize === 'function') {
      setTimeout(updateFrameSize, 60);
    }
  }

  function closeCategoryDrawer() {
    if (!inspectorDrawer) return;
    inspectorDrawer.classList.add('collapsed');
    inspectorDrawer.style.width = '';
    document.querySelectorAll('.inspector-tab-btn[data-inspector-tab]').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    if (typeof updateFrameSize === 'function') {
      setTimeout(updateFrameSize, 60);
    }
  }

  document.querySelectorAll('.inspector-tab-btn[data-inspector-tab]').forEach(tabBtn => {
    tabBtn.addEventListener('click', function () {
      const targetGroup = this.dataset.inspectorTab || 'frame';
      if (this.classList.contains('active') && inspectorDrawer && !inspectorDrawer.classList.contains('collapsed')) {
        closeCategoryDrawer();
      } else {
        openCategory(targetGroup);
      }
    });
  });

  if (closeDrawerBtn) {
    closeDrawerBtn.addEventListener('click', closeCategoryDrawer);
  }

  // Set default initial view to 'frame' (Frame & Canvas)
  openCategory('frame');

  // Update topbar aspect ratio pill when aspectSelect changes
  document.getElementById('aspectSelect')?.addEventListener('change', function () {
    const pill = document.getElementById('topbarAspectPill');
    if (pill) {
      pill.textContent = this.value === 'native' ? 'Native' : this.value;
    }
  });

  // ========== LEFT MEDIA DRAWER & MULTI-CLIP BIN (PHASE 4) ==========
  const mediaDrawer = document.getElementById('mediaDrawer');
  const closeMediaDrawerBtn = document.getElementById('closeMediaDrawerBtn');
  const mediaAddClipDropzone = document.getElementById('mediaAddClipDropzone');
  const mediaAddClipFileInput = document.getElementById('mediaAddClipFileInput');
  const mediaImportFileBtn = document.getElementById('mediaImportFileBtn');
  const mediaNewRecordingBtn = document.getElementById('mediaNewRecordingBtn');
  const refreshRecordingsBtn = document.getElementById('refreshRecordingsBtn');
  const mediaClipSequenceList = document.getElementById('mediaClipSequenceList');
  const recentRecordingsList = document.getElementById('recentRecordingsList');

  let mediaClipSequence = [];

  function openMediaDrawer() {
    if (!mediaDrawer) return;
    mediaDrawer.classList.remove('collapsed');
    mediaDrawer.classList.add('open');
    document.getElementById('loadVideoTopBtn')?.classList.add('active');
    document.getElementById('topbarEditModeBtn')?.classList.remove('active');
    updateMediaDrawerUI();
    loadRecentRecordingsList();
    if (typeof updateFrameSize === 'function') {
      setTimeout(updateFrameSize, 60);
    }
  }

  function closeMediaDrawer() {
    if (!mediaDrawer) return;
    mediaDrawer.classList.add('collapsed');
    mediaDrawer.classList.remove('open');
    document.getElementById('loadVideoTopBtn')?.classList.remove('active');
    document.getElementById('topbarEditModeBtn')?.classList.add('active');
    if (typeof updateFrameSize === 'function') {
      setTimeout(updateFrameSize, 60);
    }
  }

  function toggleMediaDrawer() {
    if (mediaDrawer && mediaDrawer.classList.contains('open') && !mediaDrawer.classList.contains('collapsed')) {
      closeMediaDrawer();
    } else {
      openMediaDrawer();
    }
  }

  function updateMediaDrawerUI() {
    const nameEl = document.getElementById('mediaCurrentClipName');
    const durEl = document.getElementById('mediaCurrentClipDuration');
    const resEl = document.getElementById('mediaCurrentClipRes');
    const countBadge = document.getElementById('mediaClipCountBadge');

    const dur = getVideoDuration();
    if (nameEl) nameEl.textContent = currentVideoTitle || 'Studio Recording';
    if (durEl) durEl.textContent = isFinite(dur) && dur > 0 ? formatTime(dur) : '00:00';
    if (resEl && video) resEl.textContent = `${video.videoWidth || 1920}×${video.videoHeight || 1080}`;

    // Render sequence list
    if (mediaClipSequenceList) {
      mediaClipSequenceList.innerHTML = '';

      // Primary master clip (Track 1)
      const primaryItem = document.createElement('div');
      primaryItem.className = 'media-recording-item';
      primaryItem.style.background = 'rgba(16, 185, 129, 0.08)';
      primaryItem.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      primaryItem.innerHTML = `
        <div class="media-recording-info">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="media-clip-badge badge-primary">Clip 1</span>
            <span class="media-recording-name">${currentVideoTitle || 'Studio Recording'}</span>
          </div>
          <div class="media-recording-details">Master Track • ${isFinite(dur) && dur > 0 ? formatTime(dur) : '00:00'} • ${video?.videoWidth || 1920}×${video?.videoHeight || 1080}</div>
        </div>
        <span class="project-status-dot" style="margin-right: 4px;" title="Active Project Master Track"></span>
      `;
      mediaClipSequenceList.appendChild(primaryItem);

      // Additional secondary clips
      mediaClipSequence.forEach((clip, index) => {
        const item = document.createElement('div');
        item.className = 'media-recording-item';
        item.innerHTML = `
          <div class="media-recording-info">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="media-clip-badge badge-secondary">Clip ${index + 2}</span>
              <span class="media-recording-name">${clip.name || 'Additional Clip'}</span>
            </div>
            <div class="media-recording-details">Merged Sequence • ${(clip.size / (1024 * 1024)).toFixed(1)} MB</div>
          </div>
          <div class="media-recording-actions">
            <button type="button" class="media-mini-btn remove-clip-btn" data-index="${index}" title="Remove from sequence" style="color: #f87171;">
              ✕
            </button>
          </div>
        `;
        const removeBtn = item.querySelector('.remove-clip-btn');
        if (removeBtn) {
          removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mediaClipSequence.splice(index, 1);
            updateMediaDrawerUI();
            showToast('Clip removed from sequence');
          });
        }
        mediaClipSequenceList.appendChild(item);
      });

      const totalClips = 1 + mediaClipSequence.length;
      if (countBadge) countBadge.textContent = totalClips === 1 ? '1 master clip' : `${totalClips} merged clips`;
    }
  }

  async function loadRecentRecordingsList() {
    if (!recentRecordingsList) return;
    recentRecordingsList.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 8px 4px; text-align: center;">Scanning IndexedDB storage...</div>';

    try {
      const items = await getRecentRecordingsFromIndexedDB();
      if (!items || items.length === 0) {
        recentRecordingsList.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 12px 6px; text-align: center; border: 1px dashed rgba(255,255,255,0.06); border-radius: 8px;">No recent recordings found in browser storage</div>';
        return;
      }

      recentRecordingsList.innerHTML = '';
      items.slice(0, 8).forEach(item => {
        const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recording';
        const sizeMb = item.blob && item.blob.size ? (item.blob.size / (1024 * 1024)).toFixed(1) + ' MB' : '0 MB';
        const isCurrent = (item.id === currentVideoId);

        const row = document.createElement('div');
        row.className = 'media-recording-item';
        if (isCurrent) {
          row.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          row.style.background = 'rgba(16, 185, 129, 0.05)';
        }

        row.innerHTML = `
          <div class="media-recording-info">
            <div class="media-recording-name" title="${item.id}">${dateStr}</div>
            <div class="media-recording-details">${item.id} • ${sizeMb}</div>
          </div>
          <div class="media-recording-actions">
            ${isCurrent ? '<span style="font-size: 10px; font-weight: 700; color: #34d399; margin-right: 4px;">ACTIVE</span>' : `
              <button type="button" class="media-mini-btn load-btn" data-id="${item.id}" title="Load recording into editor">
                Load
              </button>
            `}
            <button type="button" class="media-mini-btn download-btn" data-id="${item.id}" title="Download raw recording">
              <svg class="studio-icon" style="width: 10px; height: 10px;"><use href="#icon-export"></use></svg>
            </button>
          </div>
        `;

        const loadBtn = row.querySelector('.load-btn');
        if (loadBtn) {
          loadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm('Load this recording into CursorDemo Studio? Any unsaved edits will be replaced.')) {
              await loadRecordedVideoBlob(item);
            }
          });
        }

        const dlBtn = row.querySelector('.download-btn');
        if (dlBtn) {
          dlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadRawVideo(item);
          });
        }

        recentRecordingsList.appendChild(row);
      });
    } catch (err) {
      recentRecordingsList.innerHTML = `<div style="font-size: 11px; color: #f87171; padding: 8px 4px; text-align: center;">Could not read storage: ${err.message || 'Error'}</div>`;
    }
  }

  async function getRecentRecordingsFromIndexedDB() {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open('CursorDemoVideoStorage', 1);
        request.onerror = () => resolve([]);
        request.onsuccess = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('videos')) {
            db.close();
            return resolve([]);
          }
          const tx = db.transaction(['videos'], 'readonly');
          const store = tx.objectStore('videos');
          const getAllReq = store.getAll();
          getAllReq.onsuccess = () => {
            db.close();
            const items = getAllReq.result || [];
            // Filter to only primary video clips (exclude '_cam' and '_meta')
            const videoItems = items.filter(it => it.id && it.id.startsWith('video_') && !it.id.endsWith('_cam') && !it.id.endsWith('_meta'));
            // Sort newest first
            videoItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            resolve(videoItems);
          };
          getAllReq.onerror = () => {
            db.close();
            resolve([]);
          };
        };
        request.onupgradeneeded = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });
  }

  async function loadRecordedVideoBlob(item) {
    if (!item || !item.blob) return;
    const file = new File([item.blob], `${item.id}.webm`, { type: item.blob.type || 'video/webm' });
    await loadVideoFileDirectly(file);
    currentVideoId = item.id;
    currentVideoTitle = `Recording ${new Date(item.timestamp || Date.now()).toLocaleDateString()}`;
    updateTopbarProjectInfo(currentVideoTitle, 0);
    updateMediaDrawerUI();
    loadRecentRecordingsList();
    showToast('Loaded recording into Studio');
  }

  function downloadRawVideo(item) {
    if (!item || !item.blob) return;
    const url = URL.createObjectURL(item.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.id}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function handleAddClipFile(file) {
    if (!file || !file.type.startsWith('video/')) {
      alert('Please select a valid video file (MP4, WebM, MOV).');
      return;
    }
    // If no video is currently loaded, load it as primary!
    if (!videoLoaded || !currentVideoBlob) {
      loadVideoFileDirectly(file);
      return;
    }
    // Add to secondary sequence
    mediaClipSequence.push({
      id: 'clip_' + Date.now(),
      name: file.name,
      size: file.size,
      file: file
    });
    updateMediaDrawerUI();
    showToast(`Added "${file.name}" to sequence (${mediaClipSequence.length + 1} clips total)`);
  }

  if (closeMediaDrawerBtn) {
    closeMediaDrawerBtn.addEventListener('click', closeMediaDrawer);
  }

  if (refreshRecordingsBtn) {
    refreshRecordingsBtn.addEventListener('click', () => {
      loadRecentRecordingsList();
      showToast('Refreshed recordings library');
    });
  }

  if (mediaImportFileBtn) {
    mediaImportFileBtn.addEventListener('click', loadVideoFromFile);
  }

  if (mediaNewRecordingBtn) {
    mediaNewRecordingBtn.addEventListener('click', startNewRecording);
  }

  if (mediaAddClipDropzone) {
    mediaAddClipDropzone.addEventListener('click', () => {
      mediaAddClipFileInput?.click();
    });
    mediaAddClipDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      mediaAddClipDropzone.style.borderColor = 'rgba(52, 211, 153, 0.8)';
      mediaAddClipDropzone.style.background = 'rgba(16, 185, 129, 0.1)';
    });
    mediaAddClipDropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      mediaAddClipDropzone.style.borderColor = '';
      mediaAddClipDropzone.style.background = '';
    });
    mediaAddClipDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      mediaAddClipDropzone.style.borderColor = '';
      mediaAddClipDropzone.style.background = '';
      const file = e.dataTransfer?.files?.[0];
      if (file) handleAddClipFile(file);
    });
  }

  if (mediaAddClipFileInput) {
    mediaAddClipFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleAddClipFile(file);
      mediaAddClipFileInput.value = '';
    });
  }

  // ========== RESIZABLE PANELS & SAFE BOUNDS (STUDIO NLE SPLITTERS) ==========
  function initPanelResizers() {
    const inspectorResizer = document.getElementById('inspectorResizer');
    const inspectorDrawer = document.getElementById('inspectorDrawer');
    const timelineResizer = document.getElementById('timelineResizer');
    const timelineContainer = document.getElementById('timelineContainer');

    // Safe bounds constraints
    const DEFAULT_INSPECTOR_WIDTH = 340;
    const MIN_INSPECTOR_WIDTH = 280;
    let savedInspectorWidth = parseInt(localStorage.getItem('cursordemo_inspector_width'), 10);
    if (!Number.isFinite(savedInspectorWidth) || savedInspectorWidth < MIN_INSPECTOR_WIDTH) {
      savedInspectorWidth = DEFAULT_INSPECTOR_WIDTH;
    }
    if (inspectorDrawer && !inspectorDrawer.classList.contains('collapsed')) {
      inspectorDrawer.style.width = savedInspectorWidth + 'px';
    }

    const DEFAULT_TIMELINE_HEIGHT = 152;
    const MIN_TIMELINE_HEIGHT = 115;
    let savedTimelineHeight = parseInt(localStorage.getItem('cursordemo_timeline_height'), 10);
    if (!Number.isFinite(savedTimelineHeight) || savedTimelineHeight < MIN_TIMELINE_HEIGHT) {
      savedTimelineHeight = DEFAULT_TIMELINE_HEIGHT;
    }
    if (timelineContainer) {
      timelineContainer.style.height = savedTimelineHeight + 'px';
    }

    // 1. Inspector Horizontal Width Resizer (Left drag handle on Inspector Drawer)
    if (inspectorResizer && inspectorDrawer) {
      let isDraggingInspector = false;
      let startX = 0;
      let startWidth = 0;
      let rafId = null;

      inspectorResizer.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        isDraggingInspector = true;
        startX = e.clientX;
        startWidth = inspectorDrawer.getBoundingClientRect().width;
        inspectorResizer.classList.add('resizing');
        inspectorDrawer.classList.add('is-resizing');
        document.body.classList.add('is-resizing-col');
        try {
          inspectorResizer.setPointerCapture(e.pointerId);
        } catch (_) { }
        e.preventDefault();
      });

      inspectorResizer.addEventListener('pointermove', (e) => {
        if (!isDraggingInspector) return;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          // Dragging left (negative delta) expands the drawer width
          const deltaX = startX - e.clientX;
          const maxAllowedWidth = Math.min(540, Math.floor(window.innerWidth * 0.45));
          const newWidth = Math.max(MIN_INSPECTOR_WIDTH, Math.min(maxAllowedWidth, Math.round(startWidth + deltaX)));

          inspectorDrawer.style.width = newWidth + 'px';
          savedInspectorWidth = newWidth;
          updateFrameSize();
        });
      });

      const stopInspectorDrag = (e) => {
        if (!isDraggingInspector) return;
        isDraggingInspector = false;
        inspectorResizer.classList.remove('resizing');
        inspectorDrawer.classList.remove('is-resizing');
        document.body.classList.remove('is-resizing-col');
        try {
          inspectorResizer.releasePointerCapture(e.pointerId);
        } catch (_) { }
        localStorage.setItem('cursordemo_inspector_width', savedInspectorWidth.toString());
        updateFrameSize();
      };

      inspectorResizer.addEventListener('pointerup', stopInspectorDrag);
      inspectorResizer.addEventListener('pointercancel', stopInspectorDrag);

      // Double-click resets inspector to standard 340px
      inspectorResizer.addEventListener('dblclick', () => {
        inspectorDrawer.style.width = DEFAULT_INSPECTOR_WIDTH + 'px';
        savedInspectorWidth = DEFAULT_INSPECTOR_WIDTH;
        localStorage.setItem('cursordemo_inspector_width', DEFAULT_INSPECTOR_WIDTH.toString());
        updateFrameSize();
        showToast('Inspector width reset to 340px');
      });
    }

    // 2. Timeline Vertical Height Resizer (Top drag handle on Timeline Deck)
    if (timelineResizer && timelineContainer) {
      let isDraggingTimeline = false;
      let startY = 0;
      let startHeight = 0;
      let rafId = null;

      timelineResizer.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        isDraggingTimeline = true;
        startY = e.clientY;
        startHeight = timelineContainer.getBoundingClientRect().height;
        timelineResizer.classList.add('resizing');
        timelineContainer.classList.add('is-resizing');
        document.body.classList.add('is-resizing-row');
        try {
          timelineResizer.setPointerCapture(e.pointerId);
        } catch (_) { }
        e.preventDefault();
      });

      timelineResizer.addEventListener('pointermove', (e) => {
        if (!isDraggingTimeline) return;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          // Dragging up (negative delta) expands timeline height
          const deltaY = startY - e.clientY;
          const maxAllowedHeight = Math.min(320, Math.floor(window.innerHeight * 0.45));
          const newHeight = Math.max(MIN_TIMELINE_HEIGHT, Math.min(maxAllowedHeight, Math.round(startHeight + deltaY)));

          timelineContainer.style.height = newHeight + 'px';
          savedTimelineHeight = newHeight;
          updateFrameSize();
          if (typeof drawTimelineAudioWaveform === 'function') {
            drawTimelineAudioWaveform();
          }
        });
      });

      const stopTimelineDrag = (e) => {
        if (!isDraggingTimeline) return;
        isDraggingTimeline = false;
        timelineResizer.classList.remove('resizing');
        timelineContainer.classList.remove('is-resizing');
        document.body.classList.remove('is-resizing-row');
        try {
          timelineResizer.releasePointerCapture(e.pointerId);
        } catch (_) { }
        localStorage.setItem('cursordemo_timeline_height', savedTimelineHeight.toString());
        updateFrameSize();
        if (typeof drawTimelineAudioWaveform === 'function') {
          drawTimelineAudioWaveform();
        }
      };

      timelineResizer.addEventListener('pointerup', stopTimelineDrag);
      timelineResizer.addEventListener('pointercancel', stopTimelineDrag);

      // Double-click resets timeline to standard 152px
      timelineResizer.addEventListener('dblclick', () => {
        timelineContainer.style.height = DEFAULT_TIMELINE_HEIGHT + 'px';
        savedTimelineHeight = DEFAULT_TIMELINE_HEIGHT;
        localStorage.setItem('cursordemo_timeline_height', DEFAULT_TIMELINE_HEIGHT.toString());
        updateFrameSize();
        if (typeof drawTimelineAudioWaveform === 'function') {
          drawTimelineAudioWaveform();
        }
        showToast('Timeline height reset to default');
      });
    }
  }

  // Initialize panel splitters
  initPanelResizers();

  // Manual Blur controls
  document.getElementById('addBlurBtn')?.addEventListener('click', function (e) {
    e.stopPropagation();
    addBlurRegion();
  });

  ['sidebarAddBlurBtn', 'addBlurInspectorBtn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', function (e) {
      e.stopPropagation();
      addBlurRegion();
    });
  });

  ['drawBlurModeBtn', 'drawBlurOnCanvasBtn'].forEach(id => {
    const drawBtn = document.getElementById(id);
    if (drawBtn) {
      drawBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        isDrawBlurMode = !isDrawBlurMode;
        syncDrawBlurModeButtonUI();
        if (isDrawBlurMode) {
          showToast(`${studioIcon('pencil', 16)} Click and drag on the video preview to draw a blur box`);
        }
      });
    }
  });

  document.getElementById('blurTrackModeSelect')?.addEventListener('change', function () {
    if (selectedBlurIndex >= 0 && selectedBlurIndex < blurRegions.length) {
      saveState();
      blurRegions[selectedBlurIndex].mode = this.value;
      updateBlurUI();
      requestPreviewRedraw();
    }
  });

  document.getElementById('blurStyleSelect')?.addEventListener('change', function () {
    if (selectedBlurIndex >= 0 && selectedBlurIndex < blurRegions.length) {
      saveState();
      blurRegions[selectedBlurIndex].style = this.value;
      updateBlurUI();
      requestPreviewRedraw();
    }
  });

  const blurIntensitySliderEl = document.getElementById('blurIntensitySlider');
  if (blurIntensitySliderEl) {
    blurIntensitySliderEl.addEventListener('mousedown', () => {
      if (selectedBlurIndex >= 0 && selectedBlurIndex < blurRegions.length) {
        saveState();
      }
    });
    blurIntensitySliderEl.addEventListener('input', function () {
      const val = parseInt(this.value, 10) || 18;
      const label = document.getElementById('blurIntensityValue');
      if (label) label.textContent = `${val}px`;
      document.querySelectorAll('.blur-intensity-preset-btn').forEach(btn => {
        const pVal = parseInt(btn.dataset.intensity, 10);
        const isAct = Math.abs(val - pVal) <= 2;
        btn.classList.toggle('active', isAct);
        btn.style.borderColor = isAct ? 'rgba(34, 211, 238, 0.45)' : 'var(--border)';
        btn.style.background = isAct ? 'rgba(6, 182, 212, 0.16)' : '#080a10';
        btn.style.color = isAct ? '#67e8f9' : 'var(--text-secondary)';
      });
      if (selectedBlurIndex >= 0 && selectedBlurIndex < blurRegions.length) {
        blurRegions[selectedBlurIndex].intensity = val;
        requestPreviewRedraw();
      }
    });
  }

  document.querySelectorAll('.blur-intensity-preset-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const val = parseInt(this.dataset.intensity, 10) || 18;
      if (selectedBlurIndex >= 0 && selectedBlurIndex < blurRegions.length) {
        saveState();
        blurRegions[selectedBlurIndex].intensity = val;
        selectBlur(selectedBlurIndex, { seek: false });
        requestPreviewRedraw();
      }
    });
  });

  document.getElementById('blurRadiusSelect')?.addEventListener('change', function () {
    if (selectedBlurIndex >= 0 && selectedBlurIndex < blurRegions.length) {
      saveState();
      blurRegions[selectedBlurIndex].radius = parseInt(this.value, 10) || 0;
      requestPreviewRedraw();
    }
  });

  document.getElementById('blurFullVideoToggle')?.addEventListener('change', function () {
    if (selectedBlurIndex >= 0 && selectedBlurIndex < blurRegions.length) {
      saveState();
      blurRegions[selectedBlurIndex].fullVideo = this.checked;
      updateBlurUI();
      requestPreviewRedraw();
    }
  });

  document.getElementById('duplicateSelectedBlurBtn')?.addEventListener('click', function () {
    duplicateSelectedBlur();
  });

  document.getElementById('deleteSelectedBlurBtn')?.addEventListener('click', function () {
    deleteSelectedBlur();
  });

  // Draggable Face Cam & Auto Zoom With Webcam controls
  document.getElementById('enableDemoWebcamBtn')?.addEventListener('click', function () {
    demoWebcamEnabled = !demoWebcamEnabled;
    if (demoWebcamEnabled) {
      settings.showWebcam = true;
      showToast('Studio 1:1 Preview Cam enabled — drag bubble anywhere on stage');
    } else {
      showToast('Studio Preview Cam disabled');
    }
    updateFaceCamUI();
    requestPreviewRedraw();
  });

  document.getElementById('showWebcamToggle')?.addEventListener('change', function () {
    settings.showWebcam = this.checked;
    if (this.checked && !cameraVideoLoaded && !demoWebcamEnabled) {
      demoWebcamEnabled = true;
    }
    updateFaceCamUI();
    requestPreviewRedraw();
  });

  // Clear any legacy localStorage override so Face Cam always starts stationary ('float') unless explicitly changed in this session
  try {
    localStorage.removeItem('cursordemo.webcamZoomMode');
    localStorage.removeItem('cursorfly.webcamZoomMode');
    localStorage.removeItem('webcamZoomMode');
  } catch (e) { /* storage unavailable */ }
  settings.webcamZoomMode = 'float';

  document.getElementById('webcamZoomModeSelect')?.addEventListener('change', function () {
    saveState();
    settings.webcamZoomMode = (this.value === 'floating') ? 'float' : this.value;
    _webcamDodgeX = null;
    _webcamDodgeY = null;
    _isWebcamCurrentlyDodged = false;
    const modeNames = {
      'float': 'Fixed Position (Webcam stays locked at 1:1 size)',
      'floating': 'Fixed Position (Webcam stays locked at 1:1 size)',
      'smart-dodge': 'Smart Dodge (Webcam avoids zoomed cursor)',
      'zoom-with-screen': 'Zoom With Screen (Scales together)'
    };
    showToast(modeNames[this.value] || 'Updated Webcam Zoom Mode');
    requestPreviewRedraw();
  });

  document.getElementById('webcamPositionSelect')?.addEventListener('change', function () {
    settings.webcamPosition = this.value;
    if (this.value !== 'custom') {
      settings.webcamCustomX = null;
      settings.webcamCustomY = null;
      _webcamDodgeX = null;
      _webcamDodgeY = null;
    } else if (!Number.isFinite(settings.webcamCustomX) || !Number.isFinite(settings.webcamCustomY)) {
      settings.webcamCustomX = 0.82;
      settings.webcamCustomY = 0.80;
    }
    updateFaceCamUI();
    requestPreviewRedraw();
  });

  document.querySelectorAll('.webcam-pos-quick-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const pos = this.dataset.pos || 'bottom-right';
      saveState();
      settings.webcamPosition = pos;
      if (pos !== 'custom') {
        settings.webcamCustomX = null;
        settings.webcamCustomY = null;
      } else if (!Number.isFinite(settings.webcamCustomX) || !Number.isFinite(settings.webcamCustomY)) {
        settings.webcamCustomX = 0.82;
        settings.webcamCustomY = 0.80;
      }
      _webcamDodgeX = null;
      _webcamDodgeY = null;
      updateFaceCamUI();
      requestPreviewRedraw();
    });
  });

  ['resetWebcamCornerBtn', 'resetWebcamPosBtn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', function () {
      saveState();
      settings.webcamPosition = 'bottom-right';
      settings.webcamCustomX = null;
      settings.webcamCustomY = null;
      _webcamDodgeX = null;
      _webcamDodgeY = null;
      updateFaceCamUI();
      requestPreviewRedraw();
      showToast('Snapped Face Cam to Bottom Right');
    });
  });

  document.getElementById('webcamSizeSelect')?.addEventListener('change', function () {
    saveState();
    settings.webcamSize = this.value;
    _webcamDodgeX = null;
    _webcamDodgeY = null;
    requestPreviewRedraw();
  });

  const webcamScaleSliderEl = document.getElementById('webcamScaleSlider');
  if (webcamScaleSliderEl) {
    webcamScaleSliderEl.addEventListener('mousedown', () => {
      saveState();
    });
    webcamScaleSliderEl.addEventListener('input', function () {
      const pct = parseInt(this.value, 10) || 100;
      settings.webcamScale = pct / 100;
      const label = document.getElementById('webcamScaleValue');
      if (label) label.textContent = `${pct}%`;
      _webcamDodgeX = null;
      _webcamDodgeY = null;
      requestPreviewRedraw();
    });
  }

  document.getElementById('webcamShapeSelect')?.addEventListener('change', function () {
    settings.webcamShape = this.value;
    requestPreviewRedraw();
  });

  document.getElementById('webcamFlipToggle')?.addEventListener('change', function () {
    settings.webcamFlip = this.checked;
    requestPreviewRedraw();
  });

  // Initialize Face Cam & Manual Blur UI
  updateFaceCamUI();
  updateBlurUI();

  const applyZoomToggle = document.getElementById('applyZoomToggle');
  if (applyZoomToggle) {
    applyZoomToggle.classList.toggle('active', settings.applyZoom !== false);
    applyZoomToggle.addEventListener('click', function () {
      this.classList.toggle('active');
      settings.applyZoom = this.classList.contains('active');
      debugLog('[Editor] Apply auto zoom:', settings.applyZoom ? 'ON' : 'OFF');

      const layer = document.getElementById('zoomSegmentsLayer');
      if (layer) {
        layer.style.opacity = settings.applyZoom ? '1' : '0.25';
        layer.style.pointerEvents = settings.applyZoom ? 'auto' : 'none';
      }

      if (settings.applyZoom) {
        if (!zoomSegments || zoomSegments.length === 0) {
          analyzeZoom();
        } else {
          updateZoomUI();
        }
      } else {
        _previewZoomScale = 1.0;
        const topbarZoomStatus = document.getElementById('topbarZoomStatus');
        if (topbarZoomStatus) topbarZoomStatus.style.display = 'none';
        const badge = document.getElementById('zoomCountBadge');
        if (badge) badge.textContent = 'Disabled';
      }
      requestPreviewRedraw();
    });
  }

  // Timeline click to seek
  timelineTrack.addEventListener('click', function (e) {
    const dur = getVideoDuration();
    if (!videoLoaded || dur <= 0) return;
    if (isDragging) return;
    if (e.target.closest('.trim-handle')) return;
    if (e.target.closest('.zoom-segment-pill') || e.target.closest('.zoom-segment')) return;
    if (e.target.closest('.blur-segment-pill')) return;

    const rect = this.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = percent * dur;
    video.currentTime = Math.max(0, Math.min(dur, targetTime));
    requestPreviewRedraw();
  });

  // Video events
  video.addEventListener('timeupdate', function () {
    updateTimeline();

    // Check if we've reached the end of the trimmed section
    const dur = getVideoDuration();
    if (isPlaying && dur > 0) {
      const trimEndTime = trimHandles.end * dur;
      if (video.currentTime >= trimEndTime) {
        video.pause();
        video.currentTime = trimHandles.start * dur;
        isPlaying = false;
        updatePlayButton();
      }
    }
    syncCameraVideoWithMain();
  });
  video.addEventListener('play', function () {
    syncCameraVideoWithMain();
  });
  video.addEventListener('pause', function () {
    syncCameraVideoWithMain();
  });
  video.addEventListener('ratechange', function () {
    syncCameraVideoWithMain();
  });
  video.addEventListener('seeking', function () {
    syncCameraVideoWithMain();
  });
  video.addEventListener('seeked', function () {
    syncCameraVideoWithMain();
    requestPreviewRedraw();
  });
  video.addEventListener('canplay', function () {
    requestPreviewRedraw();
  });
  video.addEventListener('loadeddata', function () {
    requestPreviewRedraw();
  });
  video.addEventListener('ended', function () {
    isPlaying = false;
    syncCameraVideoWithMain();
    updatePlayButton();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input, textarea, select')) return;

    const reviewModalEl = document.getElementById('reviewModal');
    const discordModalEl = document.getElementById('discordModal');
    const shortcutsModalEl = document.getElementById('shortcutsModal');
    const exportModalEl = document.getElementById('exportModal');
    const progressOverlayEl = document.getElementById('exportProgressOverlay');
    const isReviewOpen = Boolean(reviewModalEl && !reviewModalEl.classList.contains('hidden'));
    const isDiscordOpen = Boolean(discordModalEl && !discordModalEl.classList.contains('hidden'));
    const isShortcutsOpen = Boolean(shortcutsModalEl && !shortcutsModalEl.classList.contains('hidden'));
    const isExportOpen = Boolean(exportModalEl && !exportModalEl.classList.contains('hidden'));
    const isProgressOpen = Boolean(progressOverlayEl && !progressOverlayEl.classList.contains('hidden'));

    if (e.code === 'Escape') {
      if (isDiscordOpen) {
        closeDiscordModal(false);
        return;
      }
      if (isReviewOpen) {
        closePostDownloadModal(false);
        return;
      }
      if (isShortcutsOpen) {
        toggleShortcutsModal(false);
        return;
      }
      if (isExportOpen && !isExportProcessing) {
        exportModalEl.classList.add('hidden');
        exportModalEl.style.display = 'none';
        return;
      }
      const mediaDrawerEl = document.getElementById('mediaDrawer');
      if (mediaDrawerEl && mediaDrawerEl.classList.contains('open') && !mediaDrawerEl.classList.contains('collapsed')) {
        if (typeof closeMediaDrawer === 'function') closeMediaDrawer();
        return;
      }
    }

    if (isDiscordOpen || isReviewOpen || isShortcutsOpen || isExportOpen || isProgressOpen) {
      return;
    }

    const dur = getVideoDuration();

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 5 : 1));
        break;
      case 'ArrowRight':
        video.currentTime = Math.min(dur || Infinity, video.currentTime + (e.shiftKey ? 5 : 1));
        break;
      case 'KeyJ':
        video.currentTime = Math.max(0, video.currentTime - 2);
        break;
      case 'KeyK':
        togglePlay();
        break;
      case 'KeyL':
        video.currentTime = Math.min(dur || Infinity, video.currentTime + 2);
        break;
      case 'KeyI':
        if (video && dur > 0) {
          saveState();
          trimHandles.start = Math.max(0, Math.min(trimHandles.end - 0.05, video.currentTime / dur));
          updateTrimUI();
          requestPreviewRedraw();
          showToast(`Set Trim Start at ${formatTimeShort(video.currentTime)} (I)`);
        }
        break;
      case 'KeyO':
        if (video && dur > 0) {
          saveState();
          trimHandles.end = Math.min(1, Math.max(trimHandles.start + 0.05, video.currentTime / dur));
          updateTrimUI();
          requestPreviewRedraw();
          showToast(`Set Trim End at ${formatTimeShort(video.currentTime)} (O)`);
        }
        break;
      case 'KeyS':
      case 'KeyC':
      case 'KeyX':
        e.preventDefault();
        splitAtPlayhead();
        break;
      case 'KeyB':
        e.preventDefault();
        addBlurRegion();
        break;
      case 'KeyZ':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (e.shiftKey) { redo(); } else { undo(); }
        } else {
          e.preventDefault();
          if (e.shiftKey) {
            addZoomAtCurrentTime('fixed');
          } else {
            addZoomAtCurrentTime('follow');
          }
        }
        break;
      case 'KeyY':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); redo(); }
        break;
      case 'BracketLeft': {
        // '[' = step playback speed down
        e.preventDefault();
        const _sp = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        const _ci = _sp.indexOf(video.playbackRate);
        const _nr = _sp[Math.max(0, (_ci === -1 ? 3 : _ci) - 1)];
        video.playbackRate = _nr; settings.playbackSpeed = _nr;
        const _se = document.getElementById('playbackSpeed');
        if (_se) _se.value = String(_nr);
        break;
      }
      case 'BracketRight': {
        // ']' = step playback speed up
        e.preventDefault();
        const _sp2 = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        const _ci2 = _sp2.indexOf(video.playbackRate);
        const _nr2 = _sp2[Math.min(_sp2.length - 1, (_ci2 === -1 ? 3 : _ci2) + 1)];
        video.playbackRate = _nr2; settings.playbackSpeed = _nr2;
        const _se2 = document.getElementById('playbackSpeed');
        if (_se2) _se2.value = String(_nr2);
        break;
      }
      case 'KeyM':
        toggleMute();
        break;
      case 'Delete':
      case 'Backspace':
        if (selectedBlurIndex >= 0) {
          deleteSelectedBlur();
        } else if (selectedZoomIndex >= 0) {
          deleteSelectedZoom();
        }
        break;
      case 'Slash':
        if (e.shiftKey) { // '?' key
          e.preventDefault();
          toggleShortcutsModal();
        }
        break;
      case 'Home':
        video.currentTime = trimHandles.start * dur;
        break;
      case 'End':
        video.currentTime = trimHandles.end * dur;
        break;
      case 'Escape':
        toggleShortcutsModal(false);
        closePostDownloadModal(false);
        isDrawBlurMode = false;
        syncDrawBlurModeButtonUI();
        deselectAllBlurs();
        deselectAllZooms();
        break;
    }
  });

  // Click outside to deselect
  document.addEventListener('click', function (e) {
    if (e.target.closest('.zoom-segment-pill') ||
      e.target.closest('.zoom-segment') ||
      e.target.closest('.zoom-segments-layer') ||
      e.target.closest('.zoom-handle') ||
      e.target.closest('.blur-segment-pill') ||
      e.target.closest('.blur-segments-layer') ||
      e.target.closest('.blur-handle') ||
      e.target.closest('#selectedZoomInspector') ||
      e.target.closest('#selectedBlurInspector') ||
      e.target.closest('.sidebar') ||
      e.target.closest('.preview-panel') ||
      e.target.closest('#previewCanvas') ||
      e.target.closest('.timeline-toolbar') ||
      e.target.closest('.timeline-header') ||
      e.target.closest('.timeline-container-inner') ||
      e.target.closest('.modal') ||
      e.target.closest('.toolbar-btn') ||
      e.target.closest('.action-pill-btn') ||
      e.target.closest('.btn-preset-spot')) {
      return;
    }
    deselectAllBlurs();
    deselectAllZooms();
  });
}

function setupDragInteractions() {
  // Scissor trim handles
  trimStartScissor?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startDrag(e, 'trim-start');
  });

  trimEndScissor?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startDrag(e, 'trim-end');
  });

  // Double-click scissors to jump trim to playhead
  trimStartScissor?.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const dur = getVideoDuration();
    if (video && dur > 0) {
      saveState();
      trimHandles.start = Math.max(0, Math.min(trimHandles.end - 0.05, video.currentTime / dur));
      updateTrimUI();
      requestPreviewRedraw();
      showToast(`Trim Start jumped to ${formatTimeShort(video.currentTime)}`);
    }
  });

  trimEndScissor?.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const dur = getVideoDuration();
    if (video && dur > 0) {
      saveState();
      trimHandles.end = Math.min(1, Math.max(trimHandles.start + 0.05, video.currentTime / dur));
      updateTrimUI();
      requestPreviewRedraw();
      showToast(`Trim End jumped to ${formatTimeShort(video.currentTime)}`);
    }
  });

  // Split button click
  document.getElementById('splitBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    splitAtPlayhead();
  });

  // Global mouse events for dragging
  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('mouseup', endDrag);

  // Playhead drag - use timeline container for new widget structure
  const timelineContainerInner = document.querySelector('.timeline-container-inner');
  const clickTarget = timelineContainerInner || timelineTrack;

  clickTarget?.addEventListener('mousedown', (e) => {
    // Don't start drag if clicking on trim handles, zoom pills, blur pills, click markers, or action buttons
    if (e.target.closest('.trim-handle')) return;
    if (e.target.closest('.zoom-segment-pill') || e.target.closest('.zoom-segment')) return;
    if (e.target.closest('.blur-segment-pill')) return;
    if (e.target.closest('.timeline-click-marker')) return;
    if (e.target.closest('button')) return;
    if (!videoLoaded) return;

    const rect = timelineContainerInner ? timelineContainerInner.getBoundingClientRect() : timelineTrack.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const clampedPercent = Math.max(0, Math.min(1, percent));
    const dur = getVideoDuration();
    const targetTime = clampedPercent * dur;

    // Immediate playhead and readout visual feedback
    if (playheadElement) {
      playheadElement.style.left = (clampedPercent * 100) + '%';
    }
    if (timeDisplay) {
      timeDisplay.textContent = `${formatTime(targetTime)} / ${formatTime(dur)}`;
    }
    const leftTimeBadge = document.getElementById('leftTimeBadge');
    if (leftTimeBadge) {
      leftTimeBadge.textContent = formatTime(targetTime);
    }

    if (video.fastSeek) {
      video.fastSeek(Math.max(0, Math.min(dur, targetTime)));
    } else {
      video.currentTime = Math.max(0, Math.min(dur, targetTime));
    }
    _forceRedraw = true;
    requestPreviewRedraw();

    startDrag(e, 'playhead');
  });

  // Setup canvas focal interactions for fixed zoom positioning, manual blur, and draggable webcam
  setupCanvasFocalInteractions();
}

let dragInitialPlayheadMs = 0;
let _preDragState = null;
let _hasDraggedTimeline = false;

function startDrag(e, type, segmentIndex = -1) {
  isDragging = true;
  dragType = type;
  dragStartX = e.clientX;
  dragSegmentIndex = segmentIndex;
  dragInitialPlayheadMs = (video && isFinite(video.currentTime)) ? (video.currentTime * 1000) : 0;
  _hasDraggedTimeline = false;

  if (type === 'segment' || type === 'handle-left' || type === 'handle-right' || type === 'blur-segment' || type === 'blur-handle-left' || type === 'blur-handle-right' || type === 'trim-start' || type === 'trim-end') {
    _preDragState = {
      zoomSegments: JSON.parse(JSON.stringify(zoomSegments)),
      blurRegions: JSON.parse(JSON.stringify(blurRegions)),
      trimHandles: { ...trimHandles }
    };
  } else {
    _preDragState = null;
  }

  if (type === 'trim-start') {
    dragStartValue = trimHandles.start;
    trimStartScissor?.classList.add('active');
  } else if (type === 'trim-end') {
    dragStartValue = trimHandles.end;
    trimEndScissor?.classList.add('active');
  } else if (type === 'segment' && segmentIndex >= 0 && segmentIndex < zoomSegments.length) {
    dragStartValue = zoomSegments[segmentIndex].startTime;
  } else if (type === 'handle-left' && segmentIndex >= 0 && segmentIndex < zoomSegments.length) {
    dragStartValue = zoomSegments[segmentIndex].startTime;
  } else if (type === 'handle-right' && segmentIndex >= 0 && segmentIndex < zoomSegments.length) {
    dragStartValue = zoomSegments[segmentIndex].endTime;
  } else if (type === 'blur-segment' && segmentIndex >= 0 && segmentIndex < blurRegions.length) {
    dragStartValue = blurRegions[segmentIndex].startTime;
  } else if (type === 'blur-handle-left' && segmentIndex >= 0 && segmentIndex < blurRegions.length) {
    dragStartValue = blurRegions[segmentIndex].startTime;
  } else if (type === 'blur-handle-right' && segmentIndex >= 0 && segmentIndex < blurRegions.length) {
    dragStartValue = blurRegions[segmentIndex].endTime;
  }

  document.body.classList.add('is-dragging-timeline');
  document.body.style.cursor = 'ew-resize';
  document.body.style.userSelect = 'none';
}

function handleDrag(e) {
  if (!isDragging || !videoLoaded) return;

  const timelineContainer = document.querySelector('.timeline-container-inner');
  const containerRect = timelineContainer ? timelineContainer.getBoundingClientRect() : null;
  const trackRect = timelineTrack ? timelineTrack.getBoundingClientRect() : null;
  const rect = containerRect || trackRect || document.getElementById('timeline')?.getBoundingClientRect();
  if (!rect || rect.width <= 0) return;

  const dur = getVideoDuration();
  if (dur <= 0) return;

  const deltaX = e.clientX - dragStartX;
  if (Math.abs(deltaX) > 0) {
    _hasDraggedTimeline = true;
  }
  const percentDelta = deltaX / rect.width;
  const timeDelta = percentDelta * dur * 1000;

  if (dragType === 'trim-start') {
    const newStart = Math.max(0, Math.min(trimHandles.end - 0.05, dragStartValue + percentDelta));
    trimHandles.start = newStart;
    updateTrimUI();
    if (video && !_scrubSeekPending) {
      _scrubSeekPending = true;
      requestAnimationFrame(() => {
        _scrubSeekPending = false;
        const target = trimHandles.start * dur;
        if (video.fastSeek) video.fastSeek(target);
        else video.currentTime = target;
        _forceRedraw = true;
        requestPreviewRedraw();
      });
    }
  } else if (dragType === 'trim-end') {
    const newEnd = Math.max(trimHandles.start + 0.05, Math.min(1, dragStartValue + percentDelta));
    trimHandles.end = newEnd;
    updateTrimUI();
    if (video && !_scrubSeekPending) {
      _scrubSeekPending = true;
      requestAnimationFrame(() => {
        _scrubSeekPending = false;
        const target = trimHandles.end * dur;
        if (video.fastSeek) video.fastSeek(target);
        else video.currentTime = target;
        _forceRedraw = true;
        requestPreviewRedraw();
      });
    }
  } else if (dragType === 'playhead') {
    const percent = (e.clientX - rect.left) / rect.width;
    const clampedPercent = Math.max(0, Math.min(1, percent));
    const targetTime = Math.max(0, Math.min(dur, clampedPercent * dur));

    if (playheadElement) {
      playheadElement.style.left = (clampedPercent * 100) + '%';
    }
    if (timeDisplay) {
      timeDisplay.textContent = `${formatTime(targetTime)} / ${formatTime(dur)}`;
    }
    const leftTimeBadge = document.getElementById('leftTimeBadge');
    if (leftTimeBadge) {
      leftTimeBadge.textContent = formatTime(targetTime);
    }

    if (!_scrubSeekPending) {
      _scrubSeekPending = true;
      requestAnimationFrame(() => {
        _scrubSeekPending = false;
        if (video.fastSeek) video.fastSeek(targetTime);
        else video.currentTime = targetTime;
        _forceRedraw = true;
        requestPreviewRedraw();
      });
    }
  } else if (dragType === 'blur-segment' && dragSegmentIndex >= 0 && dragSegmentIndex < blurRegions.length) {
    const reg = blurRegions[dragSegmentIndex];
    const duration = Math.max(250, reg.endTime - reg.startTime);
    const newStart = Math.max(0, Math.min(dur * 1000 - duration, dragStartValue + timeDelta));
    reg.startTime = Math.round(newStart);
    reg.endTime = Math.round(newStart + duration);
    const pill = document.querySelector(`.blur-segment-pill[data-index="${dragSegmentIndex}"]`);
    if (pill) {
      pill.style.left = `${(reg.startTime / 1000 / dur) * 100}%`;
      pill.style.width = `${Math.max(1.8, (duration / 1000 / dur) * 100)}%`;
    }
    const tr = document.getElementById('blurInspectorTimeRange');
    if (tr) tr.textContent = `${formatTimeShort(reg.startTime / 1000)} - ${formatTimeShort(reg.endTime / 1000)} (${(duration / 1000).toFixed(1)}s)`;
    requestPreviewRedraw();
  } else if (dragType === 'blur-handle-left' && dragSegmentIndex >= 0 && dragSegmentIndex < blurRegions.length) {
    const reg = blurRegions[dragSegmentIndex];
    const newStart = Math.max(0, Math.min(reg.endTime - 250, dragStartValue + timeDelta));
    reg.startTime = Math.round(newStart);
    const duration = reg.endTime - reg.startTime;
    const pill = document.querySelector(`.blur-segment-pill[data-index="${dragSegmentIndex}"]`);
    if (pill) {
      pill.style.left = `${(reg.startTime / 1000 / dur) * 100}%`;
      pill.style.width = `${Math.max(1.8, (duration / 1000 / dur) * 100)}%`;
    }
    const tr = document.getElementById('blurInspectorTimeRange');
    if (tr) tr.textContent = `${formatTimeShort(reg.startTime / 1000)} - ${formatTimeShort(reg.endTime / 1000)} (${(duration / 1000).toFixed(1)}s)`;
    requestPreviewRedraw();
  } else if (dragType === 'blur-handle-right' && dragSegmentIndex >= 0 && dragSegmentIndex < blurRegions.length) {
    const reg = blurRegions[dragSegmentIndex];
    const newEnd = Math.max(reg.startTime + 250, Math.min(dur * 1000, dragStartValue + timeDelta));
    reg.endTime = Math.round(newEnd);
    const duration = reg.endTime - reg.startTime;
    const pill = document.querySelector(`.blur-segment-pill[data-index="${dragSegmentIndex}"]`);
    if (pill) {
      pill.style.width = `${Math.max(1.8, (duration / 1000 / dur) * 100)}%`;
    }
    const tr = document.getElementById('blurInspectorTimeRange');
    if (tr) tr.textContent = `${formatTimeShort(reg.startTime / 1000)} - ${formatTimeShort(reg.endTime / 1000)} (${(duration / 1000).toFixed(1)}s)`;
    requestPreviewRedraw();
  } else if (dragType === 'segment' && dragSegmentIndex >= 0 && dragSegmentIndex < zoomSegments.length) {
    const seg = zoomSegments[dragSegmentIndex];
    const duration = Math.max(200, seg.endTime - seg.startTime);
    const newStart = Math.max(0, Math.min(dur * 1000 - duration, dragStartValue + timeDelta));

    seg.startTime = Math.round(newStart);
    seg.endTime = Math.round(newStart + duration);
    if (analyzer && typeof analyzer.invalidatePathCache === 'function') analyzer.invalidatePathCache();

    // Update DOM pill directly for 120fps smoothness without recreating elements
    const pill = document.querySelector(`.zoom-segment-pill[data-index="${dragSegmentIndex}"]`);
    if (pill) {
      const leftPct = (seg.startTime / 1000 / dur) * 100;
      const widthPct = Math.max(1.5, (duration / 1000 / dur) * 100);
      pill.style.left = `${leftPct}%`;
      pill.style.width = `${widthPct}%`;
    }

    // Scrub preview to new start point
    if (!_scrubSeekPending) {
      _scrubSeekPending = true;
      requestAnimationFrame(() => {
        _scrubSeekPending = false;
        const target = seg.startTime / 1000;
        if (video.fastSeek) video.fastSeek(target);
        else video.currentTime = target;
        _forceRedraw = true;
        requestPreviewRedraw();
      });
    }

    const timeRangeEl = document.getElementById('inspectorTimeRange');
    if (timeRangeEl) {
      const durSec = (duration / 1000).toFixed(1);
      timeRangeEl.textContent = `${formatTimeShort(seg.startTime / 1000)} - ${formatTimeShort(seg.endTime / 1000)} (${durSec}s)`;
    }
  } else if (dragType === 'handle-left' && dragSegmentIndex >= 0 && dragSegmentIndex < zoomSegments.length) {
    const seg = zoomSegments[dragSegmentIndex];
    const minDuration = 250; // 0.25s minimum
    const newStart = Math.max(0, Math.min(seg.endTime - minDuration, dragStartValue + timeDelta));

    seg.startTime = Math.round(newStart);
    const duration = seg.endTime - seg.startTime;
    if (analyzer && typeof analyzer.invalidatePathCache === 'function') analyzer.invalidatePathCache();

    // Update DOM pill directly
    const pill = document.querySelector(`.zoom-segment-pill[data-index="${dragSegmentIndex}"]`);
    if (pill) {
      const leftPct = (seg.startTime / 1000 / dur) * 100;
      const widthPct = Math.max(1.5, (duration / 1000 / dur) * 100);
      pill.style.left = `${leftPct}%`;
      pill.style.width = `${widthPct}%`;
      const label = pill.querySelector('.zoom-pill-label');
      if (label) {
        const modeIcon = seg.mode === 'fixed'
          ? studioIcon('pin', 10, '', 'color:#d8b4fe;vertical-align:-1px;')
          : studioIcon('target', 10, '', 'color:#a5b4fc;vertical-align:-1px;');
        const rawLevel = seg.zoomLevel || zoomDepths[settings.zoomDepth] || 1.75;
        const level = Number.isInteger(Number(rawLevel.toFixed(1))) ? rawLevel.toFixed(1) : (+rawLevel.toFixed(2)).toString();
        const iconSpan = `<span class="zoom-pill-mode-icon" title="Click to toggle Follow/Fixed">${modeIcon}</span>`;
        const levelSpan = `<span class="zoom-pill-level-badge" title="Click to adjust zoom scale">${level}×</span>`;
        label.innerHTML = widthPct > 5 ? `${iconSpan} ${levelSpan}` : `${iconSpan}`;
      }
    }

    // Scrub preview to new start point
    if (!_scrubSeekPending) {
      _scrubSeekPending = true;
      requestAnimationFrame(() => {
        _scrubSeekPending = false;
        const target = seg.startTime / 1000;
        if (video.fastSeek) video.fastSeek(target);
        else video.currentTime = target;
        _forceRedraw = true;
        requestPreviewRedraw();
      });
    }

    const timeRangeEl = document.getElementById('inspectorTimeRange');
    if (timeRangeEl) {
      const durSec = (duration / 1000).toFixed(1);
      timeRangeEl.textContent = `${formatTimeShort(seg.startTime / 1000)} - ${formatTimeShort(seg.endTime / 1000)} (${durSec}s)`;
    }
  } else if (dragType === 'handle-right' && dragSegmentIndex >= 0 && dragSegmentIndex < zoomSegments.length) {
    const seg = zoomSegments[dragSegmentIndex];
    const minDuration = 250;
    const newEnd = Math.max(seg.startTime + minDuration, Math.min(dur * 1000, dragStartValue + timeDelta));

    seg.endTime = Math.round(newEnd);
    const duration = seg.endTime - seg.startTime;
    if (analyzer && typeof analyzer.invalidatePathCache === 'function') analyzer.invalidatePathCache();

    // Update DOM pill directly
    const pill = document.querySelector(`.zoom-segment-pill[data-index="${dragSegmentIndex}"]`);
    if (pill) {
      const widthPct = Math.max(1.5, (duration / 1000 / dur) * 100);
      pill.style.width = `${widthPct}%`;
      const label = pill.querySelector('.zoom-pill-label');
      if (label) {
        const modeIcon = seg.mode === 'fixed'
          ? studioIcon('pin', 10, '', 'color:#d8b4fe;vertical-align:-1px;')
          : studioIcon('target', 10, '', 'color:#a5b4fc;vertical-align:-1px;');
        const rawLevel = seg.zoomLevel || zoomDepths[settings.zoomDepth] || 1.75;
        const level = Number.isInteger(Number(rawLevel.toFixed(1))) ? rawLevel.toFixed(1) : (+rawLevel.toFixed(2)).toString();
        const iconSpan = `<span class="zoom-pill-mode-icon" title="Click to toggle Follow/Fixed">${modeIcon}</span>`;
        const levelSpan = `<span class="zoom-pill-level-badge" title="Click to adjust zoom scale">${level}×</span>`;
        label.innerHTML = widthPct > 5 ? `${iconSpan} ${levelSpan}` : `${iconSpan}`;
      }
    }

    // Scrub preview to new end point
    if (!_scrubSeekPending) {
      _scrubSeekPending = true;
      requestAnimationFrame(() => {
        _scrubSeekPending = false;
        const target = seg.endTime / 1000;
        if (video.fastSeek) video.fastSeek(target);
        else video.currentTime = target;
        _forceRedraw = true;
        requestPreviewRedraw();
      });
    }

    const timeRangeEl = document.getElementById('inspectorTimeRange');
    if (timeRangeEl) {
      const durSec = (duration / 1000).toFixed(1);
      timeRangeEl.textContent = `${formatTimeShort(seg.startTime / 1000)} - ${formatTimeShort(seg.endTime / 1000)} (${durSec}s)`;
    }
  }
}

function endDrag() {
  if (isDragging && (dragType === 'segment' || dragType === 'handle-left' || dragType === 'handle-right' || dragType === 'blur-segment' || dragType === 'blur-handle-left' || dragType === 'blur-handle-right' || dragType === 'trim-start' || dragType === 'trim-end')) {
    if (_hasDraggedTimeline && _preDragState) {
      undoStack.push(_preDragState);
      redoStack = [];
      if (undoStack.length > 50) {
        undoStack.shift();
      }
    }
    if (dragType === 'segment' || dragType === 'handle-left' || dragType === 'handle-right') {
      const activeSeg = (dragSegmentIndex >= 0 && dragSegmentIndex < zoomSegments.length) ? zoomSegments[dragSegmentIndex] : null;
      zoomSegments.sort((a, b) => a.startTime - b.startTime);
      if (activeSeg) {
        selectedZoomIndex = zoomSegments.indexOf(activeSeg);
      }
      if (analyzer && typeof analyzer.invalidatePathCache === 'function') analyzer.invalidatePathCache();
    }
    renderZoomSegments();
    updateZoomList();
    updateBlurUI();
    requestPreviewRedraw();
  }

  _preDragState = null;
  _hasDraggedTimeline = false;
  isDragging = false;
  dragType = null;
  dragSegmentIndex = -1;

  document.body.classList.remove('is-dragging-timeline');
  trimStartScissor?.classList.remove('active');
  trimEndScissor?.classList.remove('active');

  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

function updateTrimUI() {
  const dur = getVideoDuration();
  if (!video || dur <= 0) return;

  const startPercent = trimHandles.start * 100;
  const endPercent = (1 - trimHandles.end) * 100;

  // Update trimmed areas
  if (trimmedLeft) {
    trimmedLeft.style.width = startPercent + '%';
  }
  if (trimmedRight) {
    trimmedRight.style.width = endPercent + '%';
  }

  // Update trim handle positions
  if (trimStartScissor) {
    trimStartScissor.style.left = startPercent + '%';
  }
  if (trimEndScissor) {
    trimEndScissor.style.right = (100 - trimHandles.end * 100) + '%';
    trimEndScissor.style.left = 'auto';
  }

  // Update label visibility
  if (leftLabel) {
    if (startPercent < 2) {
      leftLabel.style.display = 'flex';
    } else {
      leftLabel.style.display = 'none';
    }
  }

  // Update time display with formatted range and net trimmed duration
  if (timeDisplay) {
    const startTime = trimHandles.start * dur;
    const endTime = trimHandles.end * dur;
    const startFormatted = formatTimeWithDecimals(startTime);
    const endFormatted = formatTimeWithDecimals(endTime);
    const netDuration = (endTime - startTime).toFixed(1);
    timeDisplay.textContent = `${startFormatted} - ${endFormatted} (${netDuration}s)`;
  }

  // Legacy support for old overlay elements
  if (trimOverlayStart) {
    trimOverlayStart.style.width = startPercent + '%';
  }
  if (trimOverlayEnd) {
    trimOverlayEnd.style.width = endPercent + '%';
  }
}

function captureWebcamUndoState() {
  return {
    showWebcam: settings.showWebcam,
    webcamPosition: settings.webcamPosition,
    webcamCustomX: settings.webcamCustomX,
    webcamCustomY: settings.webcamCustomY,
    webcamSize: settings.webcamSize,
    webcamScale: settings.webcamScale,
    webcamZoomMode: settings.webcamZoomMode,
    webcamShape: settings.webcamShape,
    webcamFlip: settings.webcamFlip
  };
}

function applyWebcamUndoState(ws) {
  if (!ws || typeof ws !== 'object') return;
  Object.assign(settings, ws);
  _webcamDodgeX = null;
  _webcamDodgeY = null;
  _isWebcamCurrentlyDodged = false;
  updateFaceCamUI();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('topbarUndoBtn');
  const redoBtn = document.getElementById('topbarRedoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function updateTopbarProjectInfo(title, durationSec) {
  const titleEl = document.getElementById('topbarProjectTitle');
  const durEl = document.getElementById('projectDurationTag');
  const resEl = document.getElementById('topbarResPill');
  const macTitle = document.getElementById('macWindowTitle');
  if (titleEl && title) {
    titleEl.textContent = title;
    titleEl.setAttribute('title', title);
  }
  if (macTitle && title) {
    macTitle.textContent = title;
  }
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : getVideoDuration();
  if (durEl && Number.isFinite(dur) && dur > 0) {
    durEl.textContent = formatTime(dur);
  }
  if (resEl && videoWidth && videoHeight) {
    const resLabel = (videoWidth >= 3840 || videoHeight >= 2160)
      ? '4K'
      : (videoWidth >= 2560 || videoHeight >= 1440)
        ? '2K'
        : (videoHeight >= 1080 || videoWidth >= 1920)
          ? '1080p'
          : `${videoHeight}p`;
    resEl.textContent = `${resLabel} • 60FPS`;
  }
  if (typeof updateMediaDrawerUI === 'function') {
    updateMediaDrawerUI();
  }
}

function saveState() {
  undoStack.push({
    zoomSegments: JSON.parse(JSON.stringify(zoomSegments)),
    blurRegions: JSON.parse(JSON.stringify(blurRegions)),
    trimHandles: { ...trimHandles },
    webcamState: captureWebcamUndoState()
  });
  redoStack = [];

  if (undoStack.length > 50) {
    undoStack.shift();
  }
  updateUndoRedoButtons();
}

function undo() {
  if (undoStack.length === 0) return;

  redoStack.push({
    zoomSegments: JSON.parse(JSON.stringify(zoomSegments)),
    blurRegions: JSON.parse(JSON.stringify(blurRegions)),
    trimHandles: { ...trimHandles },
    webcamState: captureWebcamUndoState()
  });

  const state = undoStack.pop();
  zoomSegments = state.zoomSegments;
  blurRegions = state.blurRegions || [];
  trimHandles = state.trimHandles;
  if (state.webcamState) {
    applyWebcamUndoState(state.webcamState);
  }
  if (analyzer && typeof analyzer.invalidatePathCache === 'function') {
    analyzer.invalidatePathCache();
  }

  if (selectedZoomIndex >= zoomSegments.length || selectedZoomIndex < 0) {
    deselectAllZooms();
  } else {
    selectZoom(selectedZoomIndex, { seek: false });
  }
  if (selectedBlurIndex >= blurRegions.length || selectedBlurIndex < 0) {
    deselectAllBlurs();
  } else {
    selectBlur(selectedBlurIndex, { seek: false });
  }
  updateZoomUI();
  updateBlurUI();
  updateTrimUI();
  requestPreviewRedraw();
  updateUndoRedoButtons();
}

function redo() {
  if (redoStack.length === 0) return;

  undoStack.push({
    zoomSegments: JSON.parse(JSON.stringify(zoomSegments)),
    blurRegions: JSON.parse(JSON.stringify(blurRegions)),
    trimHandles: { ...trimHandles },
    webcamState: captureWebcamUndoState()
  });

  const state = redoStack.pop();
  zoomSegments = state.zoomSegments;
  blurRegions = state.blurRegions || [];
  trimHandles = state.trimHandles;
  if (state.webcamState) {
    applyWebcamUndoState(state.webcamState);
  }
  if (analyzer && typeof analyzer.invalidatePathCache === 'function') {
    analyzer.invalidatePathCache();
  }

  if (selectedZoomIndex >= zoomSegments.length || selectedZoomIndex < 0) {
    deselectAllZooms();
  } else {
    selectZoom(selectedZoomIndex, { seek: false });
  }
  if (selectedBlurIndex >= blurRegions.length || selectedBlurIndex < 0) {
    deselectAllBlurs();
  } else {
    selectBlur(selectedBlurIndex, { seek: false });
  }
  updateZoomUI();
  updateBlurUI();
  updateTrimUI();
  requestPreviewRedraw();
  updateUndoRedoButtons();
}

function showEmptyState() {
  if (videoLoaded) return;
  loadingOverlay.classList.add('hidden');
  emptyState.classList.remove('hidden');
  videoFrame.classList.add('hidden');
}

async function startNewRecording() {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      const allTabs = await chrome.tabs.query({});
      const isRestricted = (url) => {
        if (!url || typeof url !== 'string') return true;
        const lower = url.toLowerCase();
        return (
          lower.startsWith('chrome://') ||
          lower.startsWith('chrome-extension://') ||
          lower.startsWith('chrome-untrusted://') ||
          lower.startsWith('edge://') ||
          lower.startsWith('brave://') ||
          lower.startsWith('opera://') ||
          lower.startsWith('opr://') ||
          lower.startsWith('vivaldi://') ||
          lower.startsWith('browser://') ||
          lower.startsWith('yandex://') ||
          lower.startsWith('arc://') ||
          lower.startsWith('devtools://') ||
          lower.startsWith('view-source:') ||
          lower.startsWith('about:') ||
          lower.startsWith('data:') ||
          lower.startsWith('blob:') ||
          lower.startsWith('javascript:') ||
          lower.includes('chromewebstore.google.com') ||
          lower.includes('chrome.google.com/webstore') ||
          lower.includes('microsoftedge.microsoft.com/addons') ||
          lower.includes('addons.opera.com') ||
          lower.includes('browser.yandex.ru/addons') ||
          lower.includes('browser.yandex.com/addons')
        );
      };
      const candidates = allTabs.filter(t => t && t.id && !isRestricted(t.url));
      if (candidates.length > 0) {
        candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) || (b.index || 0) - (a.index || 0));
        window.location.href = chrome.runtime.getURL(`record.html?tabId=${candidates[0].id}`);
        return;
      }
    }
  } catch (e) { }
  window.location.href = chrome.runtime.getURL('record.html');
}

function loadVideoFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*';
  input.onchange = async function (e) {
    const file = e.target.files[0];
    if (file) {
      await loadVideoFileDirectly(file);
    }
  };
  input.click();
}

async function loadVideoFileDirectly(file) {
  if (!file) return;

  // Clean up previous video and processor
  if (video && video.src) {
    const oldUrl = video.src;
    video.pause();
    video.src = '';
    video.srcObject = null;
    if (oldUrl.startsWith('blob:') || oldUrl.startsWith('data:')) {
      URL.revokeObjectURL(oldUrl);
    }
  }

  // Clean up any previous session's Face Cam stream when importing an external video file
  if (cameraVideo) {
    try { cameraVideo.pause(); } catch (_) { }
    if (cameraVideo._objectUrl) {
      URL.revokeObjectURL(cameraVideo._objectUrl);
    }
    cameraVideo.src = '';
    cameraVideo = null;
  }
  currentCameraBlob = null;
  cameraVideoLoaded = false;
  cameraOverlayEnabled = false;
  updateFaceCamUI();

  if (processor) {
    processor.cancel();
  }
  processor = new VideoProcessor();

  const url = URL.createObjectURL(file);
  cursorData = [];
  if (analyzer) {
    analyzer.cursorData = [];
  }
  videoLoaded = false;
  isPlaying = false;
  currentVideoBlob = file; // Store for export
  currentVideoTitle = file.name || 'Imported Video';
  updateTopbarProjectInfo(currentVideoTitle, 0);
  await loadVideo(url);
}
window.loadVideoFileDirectly = loadVideoFileDirectly;

// Helper to seek video and wait until the frame is decoded and ready in the buffer
function seekVideoTo(videoEl, targetTime) {
  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      videoEl.removeEventListener('seeked', onSeeked);
      videoEl.removeEventListener('error', onDone);
    };
    const onSeeked = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        setTimeout(resolve, 60); // 60ms frame buffer commit delay
      }
    };
    const onDone = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve();
      }
    };
    videoEl.addEventListener('seeked', onSeeked, { once: true });
    videoEl.addEventListener('error', onDone, { once: true });
    try {
      videoEl.currentTime = targetTime;
    } catch (e) {
      onDone();
    }
    setTimeout(onDone, 700);
  });
}

// Reliable helper to test if video stream actually contains visible pixels (not macOS blank capture)
function isVideoContentBlack(videoEl) {
  if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) return true;
  try {
    const offscreen = document.createElement('canvas');
    offscreen.width = 32;
    offscreen.height = 32;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
    offCtx.drawImage(videoEl, 0, 0, 32, 32);
    const imgData = offCtx.getImageData(0, 0, 32, 32).data;
    for (let i = 0; i < imgData.length; i += 4) {
      if (imgData[i] > 3 || imgData[i + 1] > 3 || imgData[i + 2] > 3) {
        return false; // Found visible content!
      }
    }
    return true; // All pixels black
  } catch (e) {
    return false;
  }
}

// Helper to test if canvas is currently blank/black
function isFrameBlack(sampleCtx) {
  if (!sampleCtx || !sampleCtx.canvas || sampleCtx.canvas.width === 0) return true;
  try {
    const w = sampleCtx.canvas.width;
    const h = sampleCtx.canvas.height;
    const points = [
      [Math.floor(w / 2), Math.floor(h / 2)],
      [Math.floor(w / 4), Math.floor(h / 4)],
      [Math.floor(3 * w / 4), Math.floor(h / 4)],
      [Math.floor(w / 4), Math.floor(3 * h / 4)],
      [Math.floor(3 * w / 4), Math.floor(3 * h / 4)]
    ];
    let nonBlackCount = 0;
    for (const [px, py] of points) {
      const p = sampleCtx.getImageData(px, py, 1, 1).data;
      if (p[0] > 3 || p[1] > 3 || p[2] > 3) {
        nonBlackCount++;
      }
    }
    return nonBlackCount === 0;
  } catch (e) {
    return false;
  }
}

function showBlackScreenNotice() {
  const notice = document.getElementById('blackScreenNotice');
  if (notice) {
    try {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
      const platform = (typeof navigator !== 'undefined' && (navigator.userAgentData?.platform || navigator.platform)) || '';
      const isMac = /mac|darwin/i.test(platform) || /macintosh|mac os x/i.test(ua);
      const isLinux = !isMac && (/linux/i.test(platform) || /linux|x11|wayland/i.test(ua));
      let bName = 'Chrome';
      if (/edg\//i.test(ua)) bName = 'Microsoft Edge';
      else if (/opr\/|opera/i.test(ua)) bName = 'Opera';
      else if (/yabrowser\//i.test(ua)) bName = 'Yandex Browser';
      else if (/vivaldi\//i.test(ua)) bName = 'Vivaldi';
      else if (/brave/i.test(ua) || (typeof navigator !== 'undefined' && navigator.brave)) bName = 'Brave';
      else if (/arc\//i.test(ua)) bName = 'Arc';

      const msgParagraph = notice.querySelector('.notice-content p');
      if (msgParagraph) {
        if (isMac) {
          msgParagraph.innerHTML =
            `macOS requires Screen Recording permission for ${bName}. Go to <strong>System Settings → Privacy &amp; Security → Screen Recording</strong>, turn ON <strong>${bName}</strong>, then restart ${bName}.`;
        } else {
          msgParagraph.innerHTML =
            `The captured video stream was blank. Try re-recording and selecting a specific <strong>${bName} Tab</strong> or <strong>Entire Screen</strong> in ${bName}’s share dialog${isLinux ? ' (on Linux Wayland, ensure PipeWire / xdg-desktop-portal is enabled)' : ''}.`;
        }
      }
    } catch (_) { }
    notice.classList.remove('hidden');
    const closeBtn = document.getElementById('closeBlackScreenNoticeBtn');
    if (closeBtn) {
      closeBtn.onclick = () => notice.classList.add('hidden');
    }
  }
}

async function loadVideo(url) {
  return new Promise((resolve, reject) => {
    // Clear any previous error handlers
    video.onerror = null;
    video.onloadeddata = null;

    // Set up error handler FIRST
    video.onerror = function (event) {
      console.error('[Editor] Video error event:', event);
      console.error('[Editor] Video error details:', {
        type: event.type,
        target: event.target,
        error: video.error
      });

      if (video.error) {
        const errorMsg = `Video load error: ${video.error.code} - ${video.error.message}`;
        console.error('[Editor]', errorMsg);
        reject(new Error(errorMsg));
      } else {
        reject(new Error('Video failed to load (unknown error)'));
      }
    };

    video.src = url;
    // Don't mute - allow audio playback in editor
    video.muted = false;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.preload = 'auto';

    video.onloadeddata = async function () {
      debugLog('[Editor] Video loaded:', video.videoWidth, 'x', video.videoHeight);
      videoLoaded = true;
      videoWidth = video.videoWidth || 1920;
      videoHeight = video.videoHeight || 1080;

      // Handle WebM Infinity duration issue
      let duration = video.duration;
      if (videoDuration > 0 && isFinite(videoDuration)) {
        duration = videoDuration;
        debugLog('[Editor] Using pre-established duration:', duration, 'seconds');
      } else if (!isFinite(duration) || duration <= 0) {
        debugLog('[Editor] Finding real duration via seek...');
        video.currentTime = Number.MAX_SAFE_INTEGER;

        await new Promise((res) => {
          video.onseeked = () => {
            duration = video.duration;
            res();
          };
          setTimeout(() => {
            duration = video.currentTime || 30;
            res();
          }, 1500);
        });

        // Reset to start
        video.currentTime = 0;
        await new Promise(res => {
          video.onseeked = res;
          setTimeout(res, 300);
        });
      }

      if (isFinite(duration) && duration > 0) {
        videoDuration = duration;
      }
      debugLog('[Editor] Video duration established:', videoDuration);

      // 1. Unhide videoFrame and hide loading/empty states FIRST so canvas has real layout dimensions!
      loadingOverlay.classList.add('hidden');
      emptyState.classList.add('hidden');
      videoFrame.classList.remove('hidden');

      // Setup UI (updateFrameSize correctly sizes previewCanvas and initializes ctx)
      updateBackground();
      updateFrameSize();
      updateTimelineRuler();
      generateTimeMarkers();
      drawTimelineAudioWaveform();
      analyzeZoom();
      renderBlurSegments();
      updateBlurUI();
      updateFaceCamUI();
      updateTrimUI();
      updateTopbarProjectInfo(currentVideoTitle, videoDuration);
      updateUndoRedoButtons();

      // Ensure the browser decodes and paints the first video frame
      // Automatically skip any initial encoder pre-roll black frames
      const dur = getVideoDuration() || videoDuration || video.duration || 0;
      let firstVisibleTime = 0.05;

      if (dur > 0.1) {
        // Try candidate timestamps: 0.05s, 0.12s, 0.25s, 0.5s, 1.0s
        const candidates = [0.05, 0.12, 0.25, 0.5, 1.0].filter(t => t < dur * 0.95);
        let foundContent = false;

        for (const t of candidates) {
          await seekVideoTo(video, t);
          renderPreviewFrame();
          if (!isVideoContentBlack(video)) {
            firstVisibleTime = t;
            foundContent = true;
            debugLog('[Editor] Found first non-black frame at:', t, 'seconds');
            break;
          }
        }

        // If all candidates in the first second were black, test the middle of the recording
        if (!foundContent && dur > 1.0) {
          await seekVideoTo(video, dur / 2);
          renderPreviewFrame();
          if (isVideoContentBlack(video)) {
            // Entire video is black -> macOS Screen Recording permission issue
            console.warn('[Editor] Entire recording is black! Likely macOS Screen Recording permission missing for Chrome');
            showBlackScreenNotice();
          } else {
            // Middle has content, so set firstVisibleTime to where content starts
            firstVisibleTime = dur / 2;
          }
        }
      } else {
        await seekVideoTo(video, 0.001);
        renderPreviewFrame();
      }

      // Position video at the first visible frame and await frame buffer commit
      await seekVideoTo(video, firstVisibleTime);

      // Initial timeline update
      updateTimeline();

      // Start render loop and force immediate first draw
      _forceRedraw = true;
      _hasDrawnValidFirstFrame = false;
      startRenderLoop();
      renderPreviewFrame();

      resolve();
    };

    // Add timeout to detect if video never loads
    let loadTimeout;
    const originalOnLoadedData = video.onloadeddata;
    video.onloadeddata = async function () {
      if (loadTimeout) {
        clearTimeout(loadTimeout);
        loadTimeout = null;
      }
      if (originalOnLoadedData) {
        await originalOnLoadedData();
      }
    };

    loadTimeout = setTimeout(() => {
      if (!videoLoaded) {
        console.error('[Editor] Video load timeout after 30 seconds');
        reject(new Error('Video load timeout - the video file may be corrupted or invalid. Please try recording again.'));
      }
    }, 30000); // 30 second timeout

    video.load();
    if (video.readyState >= 2) {
      if (loadTimeout) {
        clearTimeout(loadTimeout);
        loadTimeout = null;
      }
      originalOnLoadedData();
    }
  });
}

function updateTimelineRuler() {
  const dur = getVideoDuration();
  if (!dur || !isFinite(dur)) return;

  const ticks = timelineRuler.querySelectorAll('span');
  const numTicks = ticks.length;

  ticks.forEach((tick, i) => {
    const time = (i / (numTicks - 1)) * dur;
    tick.textContent = formatTimeWithSeconds(time);
  });
}

function generateTimeMarkers() {
  const dur = getVideoDuration();
  if (!timeMarkers || !video || !dur || !isFinite(dur)) return;

  timeMarkers.innerHTML = '';
  // OpenScreen-style dynamic high-density tick ruler across full width
  let markerCount = 8;
  if (dur <= 10) {
    markerCount = Math.max(5, Math.floor(dur));
  } else if (dur <= 30) {
    markerCount = Math.max(6, Math.floor(dur / 2.5));
  } else if (dur <= 60) {
    markerCount = 8;
  } else if (dur <= 180) {
    markerCount = 10;
  } else {
    markerCount = 12;
  }

  for (let i = 0; i <= markerCount; i++) {
    const marker = document.createElement('div');
    marker.className = 'time-marker';
    const time = (dur * i / markerCount);
    marker.textContent = formatTimeShort(time);
    timeMarkers.appendChild(marker);
  }
}

function drawTimelineAudioWaveform() {
  const canvas = document.getElementById('audioWaveformCanvas');
  const dur = getVideoDuration();
  if (!canvas || !video || !dur || !isFinite(dur) || dur <= 0) return;

  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (w <= 0 || h <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Create gradient matching OpenScreen audio track look
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(16, 185, 129, 0.75)');
  grad.addColorStop(0.5, 'rgba(5, 150, 105, 0.60)');
  grad.addColorStop(1, 'rgba(4, 120, 87, 0.40)');

  // Generate deterministic, natural voice waveform with speech pauses
  const step = 4;
  const points = Math.ceil(w / step);

  ctx.beginPath();
  ctx.moveTo(0, h);

  for (let i = 0; i <= points; i++) {
    const x = i * step;
    const norm = i / points;
    const slowMod = Math.sin(norm * 24) * 0.5 + 0.5;
    const fastMod = Math.sin(norm * 140) * 0.35 + Math.cos(norm * 280) * 0.25;
    const speechCadence = Math.sin(norm * 12) > -0.25 ? 1.0 : 0.12;
    const rawAmp = (slowMod * 0.6 + fastMod * 0.4) * speechCadence;
    const amp = Math.max(0.08, Math.min(0.95, rawAmp));
    const y = h - (amp * (h - 3));
    ctx.lineTo(x, y);
  }

  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Stroke top edge of waveform for crisp NLE outline
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const x = i * step;
    const norm = i / points;
    const slowMod = Math.sin(norm * 24) * 0.5 + 0.5;
    const fastMod = Math.sin(norm * 140) * 0.35 + Math.cos(norm * 280) * 0.25;
    const speechCadence = Math.sin(norm * 12) > -0.25 ? 1.0 : 0.12;
    const rawAmp = (slowMod * 0.6 + fastMod * 0.4) * speechCadence;
    const amp = Math.max(0.08, Math.min(0.95, rawAmp));
    const y = h - (amp * (h - 3));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function formatTimeWithSeconds(s) {
  if (!isFinite(s)) return '00:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function formatTimeWithDecimals(s) {
  if (!isFinite(s)) return '00:00.00';
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2);
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(5, '0');
}

function updateBackground() {
  if (settings.backgroundImage) {
    // Use uploaded image
    videoBackground.style.background = `url(${settings.backgroundImage}) center/cover`;
    videoBackground.style.display = 'block';
  } else if (settings.background === 'hidden') {
    videoBackground.style.display = 'none';
  } else {
    // Use gradient or solid color
    const bg = backgrounds[settings.background] || backgrounds['grad-1'];
    videoBackground.style.background = bg;
    videoBackground.style.display = 'block';
  }

  // Recalculate video window size when background changes (padding changes)
  if (videoLoaded) {
    updateFrameSize();
  }
}

function getEffectiveBrowserUIHeight(h = videoHeight) {
  // If clean browser is disabled (user wants original browser tabs), do not crop
  if (settings.cleanBrowser === false) return 0;
  // Tab/Browser and Monitor/Screen recordings contain the full surface — never crop top chrome
  if (displaySurface === 'browser' || displaySurface === 'tab' || displaySurface === 'monitor' || displaySurface === 'screen') {
    return 0;
  }

  if (Number.isFinite(settings.browserTopBarHeight) && settings.browserTopBarHeight > 0 && displaySurface === 'window') {
    return Math.min(Math.round(h * 0.15), Math.round(settings.browserTopBarHeight));
  }

  const hasChromeInteraction = Array.isArray(cursorData) && (
    cursorData.length >= 2 ||
    cursorData.some(d => d && (d.type === 'click' || d.type === 'doubleclick' || d.type === 'mousedown' || d.type === 'scroll' || d.type === 'wheel' || (d.timestamp && d.timestamp > 0)))
  );
  const sampleWithWm = (hasChromeInteraction && cursorData)
    ? (cursorData.find(d => d && d.timestamp > 0 && d.windowMetrics && d.windowMetrics.topBarHeight > 0 && d.windowMetrics.screenHeight > 0) ||
      cursorData.find(d => d && d.windowMetrics && d.windowMetrics.topBarHeight > 0 && d.windowMetrics.screenHeight > 0) ||
      cursorData.find(d => d && d.windowMetrics))
    : null;
  const wm = sampleWithWm ? sampleWithWm.windowMetrics : null;

  if (wm && wm.innerHeight && wm.outerHeight) {
    const videoAspect = (videoWidth > 0 && videoHeight > 0) ? (videoWidth / videoHeight) : (wm.outerWidth / wm.outerHeight);
    const winAspect = wm.outerWidth / wm.outerHeight;
    const hasClickOrScroll = Array.isArray(cursorData) && cursorData.some(d =>
      d && (d.type === 'click' || d.type === 'doubleclick' || d.type === 'mousedown' || d.type === 'scroll' || d.type === 'wheel')
    );

    // Explicit window recording of a Chrome window: crop topBarHeight proportionally
    if (displaySurface === 'window') {
      if (Math.abs(videoAspect - winAspect) < 0.08 || hasClickOrScroll) {
        const topBar = wm.topBarHeight !== undefined ? wm.topBarHeight : Math.max(0, Math.min(120, wm.outerHeight - wm.innerHeight));
        if (topBar > 0) {
          return Math.min(Math.round(h * 0.15), Math.round((topBar / wm.outerHeight) * h));
        }
      }
      return 0;
    }

    const tabAspect = wm.innerWidth / wm.innerHeight;
    const screenAspect = (wm.screenWidth && wm.screenHeight) ? (wm.screenWidth / wm.screenHeight) : (16 / 9);

    // When displaySurface is unknown, if aspect matches Tab or Screen, do not crop
    if (Math.abs(videoAspect - tabAspect) < 0.035 || Math.abs(videoAspect - screenAspect) < 0.02) {
      return 0;
    }

    if (Math.abs(videoAspect - winAspect) < 0.035) {
      const topBar = wm.topBarHeight !== undefined ? wm.topBarHeight : Math.max(0, Math.min(120, wm.outerHeight - wm.innerHeight));
      if (topBar > 0) {
        return Math.min(Math.round(h * 0.15), Math.round((topBar / wm.outerHeight) * h));
      }
    }
  }

  // Default: native non-Chrome windows, monitor recordings, or unknown desktop recordings should NEVER have their top clipped
  return 0;
}

function updateFrameSize() {
  if (!videoLoaded) return;

  const container = document.querySelector('.preview-area');
  const maxW = container.clientWidth - 48;
  const maxH = container.clientHeight - 48;

  // Calculate the target aspect ratio based on selection
  let targetRatio;
  if (settings.aspectRatio === 'native') {
    targetRatio = videoWidth / videoHeight;
  } else {
    const [w, h] = settings.aspectRatio.split(':').map(Number);
    targetRatio = w / h;
  }

  // Calculate frame dimensions (the outer container with background)
  let frameW, frameH;
  if (targetRatio >= 1) {
    frameW = Math.min(maxW, maxH * targetRatio);
    frameH = frameW / targetRatio;
  } else {
    frameH = Math.min(maxH, maxW / targetRatio);
    frameW = frameH * targetRatio;
  }

  videoFrame.style.width = frameW + 'px';
  videoFrame.style.height = frameH + 'px';

  // Calculate source video dimensions (possibly cropped for browser UI)
  let sourceHeight = videoHeight;
  const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
  if (browserUIHeight > 0) {
    sourceHeight = videoHeight - browserUIHeight;
  }
  const sourceAspect = videoWidth / sourceHeight;

  // Calculate video window size to fit within frame (with padding)
  // The video window should be centered and maintain the source video's aspect ratio
  const padding = settings.background === 'hidden' ? 0 : (settings.padding ?? 28);
  const availableW = Math.max(10, frameW - (padding * 2));
  const availableH = Math.max(10, frameH - (padding * 2));

  const headerH = (settings.showMacWindowHeader !== false) ? 32 : 0;
  const availContentH = Math.max(10, availableH - headerH);

  let contentW, contentH;
  if (sourceAspect > (availableW / availContentH)) {
    // Video is wider than available space - fit to width
    contentW = availableW;
    contentH = availableW / sourceAspect;
  } else {
    // Video is taller than available space - fit to height
    contentH = availContentH;
    contentW = availContentH * sourceAspect;
  }

  const windowW = Math.round(contentW);
  const windowH = Math.round(contentH + headerH);

  // Apply video window dimensions
  videoWindow.style.width = windowW + 'px';
  videoWindow.style.height = windowH + 'px';
  videoWindow.style.borderRadius = (settings.background === 'hidden' ? 0 : (settings.borderRadius ?? 14)) + 'px';

  // Ensure video window is centered (CSS transform might not be applied yet)
  videoWindow.style.transform = 'translate(-50%, -50%)';

  // Canvas should match source video dimensions (we'll draw to it at source resolution)
  if (previewCanvas.width !== videoWidth || previewCanvas.height !== sourceHeight) {
    previewCanvas.width = videoWidth;
    previewCanvas.height = sourceHeight;
    ctx = previewCanvas.getContext('2d', { alpha: false, colorSpace: 'srgb', willReadFrequently: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  requestPreviewRedraw();
}

function analyzeZoom() {
  debugLog('[Editor] analyzeZoom called');

  if (!analyzer || !settings.applyZoom) {
    zoomSegments = [];
    updateZoomUI();
    return;
  }

  const clicks = cursorData.filter(d => d.type === 'click' || d.type === 'doubleclick');
  debugLog('[Editor] Clicks to analyze:', clicks.length);

  const currentDur = getVideoDuration() || videoDuration || (video && isFinite(video.duration) ? video.duration : 0) || 0;
  analyzer.ZOOM_LEVEL = zoomDepths[settings.zoomDepth];
  const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
  zoomSegments = analyzer.analyzeClicks(cursorData, videoWidth, videoHeight, displaySurface, currentDur, browserUIHeight);
  debugLog('[Editor] Found', zoomSegments.length, 'zoom segments across duration:', currentDur);

  updateZoomUI();
}

function reanalyzeZoom() {
  analyzeZoom();
}

function updateZoomUI() {
  if (analyzer && typeof analyzer.invalidatePathCache === 'function') {
    analyzer.invalidatePathCache();
  }
  const badgeText = zoomSegments.length + (zoomSegments.length === 1 ? ' zoom' : ' zooms');
  const badge = document.getElementById('zoomCountBadge');
  if (badge) {
    badge.textContent = badgeText;
  }
  const timelineBadge = document.getElementById('timelineZoomCountBadge');
  if (timelineBadge) {
    timelineBadge.textContent = badgeText;
  }

  const zoomCountEl = document.getElementById('zoomCount');
  if (zoomCountEl) zoomCountEl.textContent = zoomSegments.length;
  updateZoomList();
  renderZoomSegments();
  renderClickMarkers();
  requestPreviewRedraw();
}

let activeContextMenuSegIndex = -1;
let activeQuickZoomSegIndex = -1;

function openQuickZoomPopover(segIndex, anchorEl, clientX, clientY) {
  if (segIndex < 0 || segIndex >= zoomSegments.length) return;
  activeQuickZoomSegIndex = segIndex;
  closeTimelineContextMenu();

  const popover = document.getElementById('quickZoomPopover');
  if (!popover) return;

  const seg = zoomSegments[segIndex];
  const rawLevel = (seg.zoomLevel || zoomDepths[settings.zoomDepth] || 1.75);
  const level = Number(rawLevel.toFixed(2));

  const numInput = document.getElementById('quickZoomNumberInput');
  const slider = document.getElementById('quickZoomSlider');
  const toggleBtn = document.getElementById('quickZoomToggleModeBtn');

  if (numInput) numInput.value = level.toFixed(2);
  if (slider) slider.value = Math.max(1.10, Math.min(3.00, level)).toFixed(2);

  if (toggleBtn) {
    const isFixed = seg.mode === 'fixed';
    toggleBtn.innerHTML = isFixed
      ? `${studioIcon('pin', 12, '', 'color:#d8b4fe;margin-right:4px;')} Fixed Spot`
      : `${studioIcon('target', 12, '', 'color:#a5b4fc;margin-right:4px;')} Follow Cursor`;
    toggleBtn.style.color = isFixed ? '#d8b4fe' : '#a5b4fc';
    toggleBtn.style.borderColor = isFixed ? 'rgba(168, 85, 247, 0.4)' : 'rgba(99, 102, 241, 0.4)';
  }

  // Highlight active preset chip if matching
  document.querySelectorAll('.quick-preset-btn').forEach(btn => {
    const v = parseFloat(btn.dataset.val);
    const isMatch = Math.abs(v - level) < 0.03;
    btn.classList.toggle('active', isMatch);
  });

  popover.style.display = 'block';

  // Compute optimal position
  const popW = popover.offsetWidth || 280;
  const popH = popover.offsetHeight || 260;
  let posX = 0;
  let posY = 0;

  if (anchorEl && anchorEl.getBoundingClientRect) {
    const rect = anchorEl.getBoundingClientRect();
    posX = rect.left + (rect.width / 2) - (popW / 2);
    posY = rect.top - popH - 10;
    // If not enough room above, place below
    if (posY < 10) {
      posY = rect.bottom + 10;
    }
  } else if (typeof clientX === 'number' && typeof clientY === 'number') {
    posX = clientX - (popW / 2);
    posY = clientY - popH - 12;
    if (posY < 10) posY = clientY + 12;
  }

  // Keep safely inside viewport
  posX = Math.max(12, Math.min(window.innerWidth - popW - 12, posX));
  posY = Math.max(12, Math.min(window.innerHeight - popH - 12, posY));

  popover.style.left = `${posX}px`;
  popover.style.top = `${posY}px`;

  // Focus and select number input
  if (numInput) {
    setTimeout(() => {
      numInput.focus();
      numInput.select();
    }, 50);
  }

  selectZoom(segIndex);
}
window.openQuickZoomPopover = openQuickZoomPopover;

function closeQuickZoomPopover() {
  const popover = document.getElementById('quickZoomPopover');
  if (popover) popover.style.display = 'none';
  activeQuickZoomSegIndex = -1;
}
window.closeQuickZoomPopover = closeQuickZoomPopover;

function setSegmentZoomLevel(segIndex, newLevel, shouldSaveState = false) {
  if (segIndex < 0 || segIndex >= zoomSegments.length) return;
  const clamped = Math.max(1.05, Math.min(3.50, parseFloat(newLevel) || 1.75));
  const rounded = parseFloat(clamped.toFixed(2));

  if (shouldSaveState) saveState();

  const seg = zoomSegments[segIndex];
  seg.zoomLevel = rounded;

  // Invalidate any follow camera path cache for this segment
  if (analyzer && analyzer.invalidatePathCache) {
    analyzer.invalidatePathCache();
  }

  // Sync quick popover inputs if open
  const numInput = document.getElementById('quickZoomNumberInput');
  const slider = document.getElementById('quickZoomSlider');
  if (numInput && document.activeElement !== numInput) {
    numInput.value = rounded.toFixed(2);
  }
  if (slider && document.activeElement !== slider) {
    slider.value = Math.max(1.10, Math.min(3.00, rounded)).toFixed(2);
  }

  // Highlight active preset chip
  document.querySelectorAll('.quick-preset-btn').forEach(btn => {
    const v = parseFloat(btn.dataset.val);
    btn.classList.toggle('active', Math.abs(v - rounded) < 0.03);
  });

  // Sync inspector inputs
  const inspInput = document.getElementById('inspectorCustomZoomInput');
  const depthSelect = document.getElementById('selectedSegmentDepth');
  if (inspInput && document.activeElement !== inspInput) {
    inspInput.value = rounded.toFixed(2);
  }
  if (depthSelect) {
    const options = ['1.25', '1.40', '1.50', '1.75', '2.00', '2.20', '2.50', '2.80'];
    const matching = options.find(o => Math.abs(parseFloat(o) - rounded) < 0.02);
    depthSelect.value = matching || 'custom';
  }

  renderZoomSegments();
  updateZoomList();
  requestPreviewRedraw();
}
window.setSegmentZoomLevel = setSegmentZoomLevel;

function openTimelineContextMenu(segIndex, clientX, clientY, contextType = 'segment') {
  activeContextMenuSegIndex = segIndex;
  closeQuickZoomPopover();

  const menu = document.getElementById('timelineContextMenu');
  if (!menu) return;

  const titleEl = document.getElementById('contextMenuTitle');
  const toggleBtn = document.getElementById('contextMenuToggleMode');
  const toggleText = document.getElementById('contextMenuToggleModeText');
  const deleteBtn = document.getElementById('contextMenuDelete');
  const editZoomBtn = document.getElementById('contextMenuEditZoom');
  const chipsSection = menu.querySelector('.context-zoom-chips')?.parentElement;

  if (segIndex >= 0 && segIndex < zoomSegments.length) {
    const seg = zoomSegments[segIndex];
    const isFixed = seg.mode === 'fixed';
    const level = (seg.zoomLevel || zoomDepths[settings.zoomDepth] || 1.75).toFixed(2);

    if (titleEl) titleEl.textContent = `Zoom Segment #${segIndex + 1} (${level}×)`;
    if (toggleText) toggleText.innerHTML = isFixed
      ? `${studioIcon('target', 12, '', 'color:#a5b4fc;margin-right:4px;')} Switch to Follow Cursor`
      : `${studioIcon('pin', 12, '', 'color:#d8b4fe;margin-right:4px;')} Switch to Fixed Spot`;
    if (toggleBtn) toggleBtn.style.display = 'flex';
    if (deleteBtn) deleteBtn.style.display = 'flex';
    if (editZoomBtn) {
      editZoomBtn.style.display = 'flex';
      const labelSpan = editZoomBtn.querySelector('span');
      if (labelSpan) labelSpan.innerHTML = `${studioIcon('zoom', 12, '', 'margin-right:4px;')} Edit Zoom Amount (${level}×)...`;
    }
    if (chipsSection) chipsSection.style.display = 'block';

    // Highlight matching chip
    menu.querySelectorAll('.context-zoom-chip').forEach(chip => {
      const cv = parseFloat(chip.dataset.zoom);
      const isMatch = Math.abs(cv - parseFloat(level)) < 0.04;
      chip.style.borderColor = isMatch ? 'var(--accent)' : 'rgba(255, 255, 255, 0.12)';
      chip.style.background = isMatch ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.08)';
      chip.style.color = isMatch ? '#fff' : 'var(--text-secondary)';
    });
  } else {
    // Empty timeline / editor canvas outside a zoom segment
    if (titleEl) titleEl.textContent = 'Editor & Timeline Actions';
    if (toggleText) toggleText.innerHTML = `${studioIcon('pin', 12, '', 'color:#d8b4fe;margin-right:4px;')} Add Fixed Zoom at Playhead`;
    if (toggleBtn) toggleBtn.style.display = 'flex';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (editZoomBtn) {
      editZoomBtn.style.display = 'flex';
      const labelSpan = editZoomBtn.querySelector('span');
      if (labelSpan) labelSpan.innerHTML = `${studioIcon('target', 12, '', 'color:#a5b4fc;margin-right:4px;')} Add Zoom at Playhead (Follow)`;
    }
    if (chipsSection) chipsSection.style.display = 'none';
  }

  menu.style.display = 'block';

  // Position menu
  const menuW = menu.offsetWidth || 210;
  const menuH = menu.offsetHeight || 220;
  let posX = clientX;
  let posY = clientY;

  if (posX + menuW > window.innerWidth - 10) {
    posX = window.innerWidth - menuW - 10;
  }
  if (posY + menuH > window.innerHeight - 10) {
    posY = window.innerHeight - menuH - 10;
  }

  menu.style.left = `${Math.max(10, posX)}px`;
  menu.style.top = `${Math.max(10, posY)}px`;
}
window.openTimelineContextMenu = openTimelineContextMenu;

function closeTimelineContextMenu() {
  const menu = document.getElementById('timelineContextMenu');
  if (menu) menu.style.display = 'none';
  activeContextMenuSegIndex = -1;
}
window.closeTimelineContextMenu = closeTimelineContextMenu;

function closeAllZoomFlyouts() {
  closeTimelineContextMenu();
  closeQuickZoomPopover();
}
window.closeAllZoomFlyouts = closeAllZoomFlyouts;

function setupZoomEditControls() {
  const numInput = document.getElementById('quickZoomNumberInput');
  const slider = document.getElementById('quickZoomSlider');
  const stepDownBtn = document.getElementById('quickZoomStepDown');
  const stepUpBtn = document.getElementById('quickZoomStepUp');
  const doneBtn = document.getElementById('quickZoomDoneBtn');
  const closeBtn = document.getElementById('closeQuickZoomBtn');
  const toggleModeBtn = document.getElementById('quickZoomToggleModeBtn');

  // Popover stepper down
  stepDownBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeQuickZoomSegIndex < 0 || activeQuickZoomSegIndex >= zoomSegments.length) return;
    const cur = parseFloat(numInput?.value) || 1.75;
    const nextVal = Math.max(1.05, Math.round((cur - 0.05) * 100) / 100);
    setSegmentZoomLevel(activeQuickZoomSegIndex, nextVal, true);
  });

  // Popover stepper up
  stepUpBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeQuickZoomSegIndex < 0 || activeQuickZoomSegIndex >= zoomSegments.length) return;
    const cur = parseFloat(numInput?.value) || 1.75;
    const nextVal = Math.min(3.00, Math.round((cur + 0.05) * 100) / 100);
    setSegmentZoomLevel(activeQuickZoomSegIndex, nextVal, true);
  });

  // Popover number input
  let _quickNumSavedState = false;
  numInput?.addEventListener('focus', () => { _quickNumSavedState = false; });
  numInput?.addEventListener('input', function () {
    if (activeQuickZoomSegIndex < 0 || activeQuickZoomSegIndex >= zoomSegments.length) return;
    const val = parseFloat(this.value);
    if (isFinite(val) && val >= 1.05 && val <= 3.50) {
      if (!_quickNumSavedState) {
        saveState();
        _quickNumSavedState = true;
      }
      setSegmentZoomLevel(activeQuickZoomSegIndex, val, false);
    }
  });
  numInput?.addEventListener('change', function () {
    _quickNumSavedState = false;
  });
  numInput?.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      closeQuickZoomPopover();
    }
  });

  // Popover slider
  let _quickSliderSavedState = false;
  slider?.addEventListener('mousedown', () => { _quickSliderSavedState = false; });
  slider?.addEventListener('input', function () {
    if (activeQuickZoomSegIndex < 0 || activeQuickZoomSegIndex >= zoomSegments.length) return;
    const val = parseFloat(this.value);
    if (!_quickSliderSavedState) {
      saveState();
      _quickSliderSavedState = true;
    }
    setSegmentZoomLevel(activeQuickZoomSegIndex, val, false);
  });
  slider?.addEventListener('change', function () {
    _quickSliderSavedState = false;
  });

  // Popover preset buttons
  document.querySelectorAll('.quick-preset-btn').forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (activeQuickZoomSegIndex < 0 || activeQuickZoomSegIndex >= zoomSegments.length) return;
      const val = parseFloat(this.dataset.val);
      if (isFinite(val)) {
        setSegmentZoomLevel(activeQuickZoomSegIndex, val, true);
      }
    });
  });

  // Popover toggle mode button
  toggleModeBtn?.addEventListener('click', function (e) {
    e.stopPropagation();
    if (activeQuickZoomSegIndex < 0 || activeQuickZoomSegIndex >= zoomSegments.length) return;
    saveState();
    const seg = zoomSegments[activeQuickZoomSegIndex];
    seg.mode = (seg.mode === 'fixed') ? 'follow' : 'fixed';
    if (seg.mode === 'fixed') ensureSegmentFixedCoords(seg);
    selectZoom(activeQuickZoomSegIndex);
    updateZoomUI();
    requestPreviewRedraw();
    const isFixed = seg.mode === 'fixed';
    this.innerHTML = isFixed
      ? `${studioIcon('pin', 12, '', 'color:#d8b4fe;margin-right:4px;')} Fixed Spot`
      : `${studioIcon('target', 12, '', 'color:#a5b4fc;margin-right:4px;')} Follow Cursor`;
    this.style.color = isFixed ? '#d8b4fe' : '#a5b4fc';
    this.style.borderColor = isFixed ? 'rgba(168, 85, 247, 0.4)' : 'rgba(99, 102, 241, 0.4)';
    showToast(isFixed ? 'Switched to Fixed Spot mode' : 'Switched to Follow Cursor mode');
  });

  doneBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeQuickZoomPopover();
  });
  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeQuickZoomPopover();
  });

  // Context menu preset chips
  document.querySelectorAll('.context-zoom-chip').forEach(chip => {
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      const targetZoom = parseFloat(this.dataset.zoom);
      if (activeContextMenuSegIndex >= 0 && activeContextMenuSegIndex < zoomSegments.length) {
        saveState();
        setSegmentZoomLevel(activeContextMenuSegIndex, targetZoom, false);
        showToast(`Zoom set to ${targetZoom.toFixed(2)}×`);
      }
      closeTimelineContextMenu();
    });
  });

  // Context menu edit zoom
  document.getElementById('contextMenuEditZoom')?.addEventListener('click', function (e) {
    e.stopPropagation();
    if (activeContextMenuSegIndex >= 0 && activeContextMenuSegIndex < zoomSegments.length) {
      const idx = activeContextMenuSegIndex;
      const menu = document.getElementById('timelineContextMenu');
      const clientX = parseInt(menu?.style.left || '100') + 20;
      const clientY = parseInt(menu?.style.top || '100') + 20;
      closeTimelineContextMenu();
      openQuickZoomPopover(idx, null, clientX, clientY);
    } else {
      closeTimelineContextMenu();
      addZoomAtCurrentTime('follow');
      showToast('Added Follow Zoom at Playhead');
    }
  });

  // Context menu toggle mode
  document.getElementById('contextMenuToggleMode')?.addEventListener('click', function (e) {
    e.stopPropagation();
    if (activeContextMenuSegIndex >= 0 && activeContextMenuSegIndex < zoomSegments.length) {
      saveState();
      const seg = zoomSegments[activeContextMenuSegIndex];
      seg.mode = (seg.mode === 'fixed') ? 'follow' : 'fixed';
      if (seg.mode === 'fixed') ensureSegmentFixedCoords(seg);
      selectZoom(activeContextMenuSegIndex);
      updateZoomUI();
      requestPreviewRedraw();
      showToast(seg.mode === 'fixed' ? 'Switched to Fixed Spot mode' : 'Switched to Follow Cursor mode');
    } else {
      addZoomAtCurrentTime('fixed');
      showToast('Added Fixed Spot Zoom at Playhead');
    }
    closeTimelineContextMenu();
  });

  // Context menu split
  document.getElementById('contextMenuSplit')?.addEventListener('click', function (e) {
    e.stopPropagation();
    closeTimelineContextMenu();
    splitAtPlayhead();
  });

  // Context menu delete
  document.getElementById('contextMenuDelete')?.addEventListener('click', function (e) {
    e.stopPropagation();
    if (activeContextMenuSegIndex >= 0 && activeContextMenuSegIndex < zoomSegments.length) {
      saveState();
      zoomSegments.splice(activeContextMenuSegIndex, 1);
      if (selectedZoomIndex === activeContextMenuSegIndex) {
        deselectAllZooms();
      } else if (selectedZoomIndex > activeContextMenuSegIndex) {
        selectedZoomIndex--;
      }
      updateZoomUI();
      showToast(`${studioIcon('trash', 16)} Deleted zoom segment`);
    }
    closeTimelineContextMenu();
  });

  // Preview canvas context menu
  const pCanvas = document.getElementById('previewCanvas');
  pCanvas?.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    e.stopPropagation();
    const currentMs = (video && isFinite(video.currentTime)) ? (video.currentTime * 1000) : 0;
    let segIdx = selectedZoomIndex;
    if (segIdx < 0 || segIdx >= zoomSegments.length || currentMs < zoomSegments[segIdx].startTime || currentMs > zoomSegments[segIdx].endTime) {
      segIdx = zoomSegments.findIndex(s => currentMs >= s.startTime && currentMs <= s.endTime);
    }
    if (segIdx >= 0 && segIdx < zoomSegments.length) {
      selectZoom(segIdx);
      openTimelineContextMenu(segIdx, e.clientX, e.clientY, 'segment');
    } else {
      openTimelineContextMenu(-1, e.clientX, e.clientY, 'editor');
    }
  });

  // Timeline track context menu
  const tlTrack = document.getElementById('timeline');
  tlTrack?.addEventListener('contextmenu', function (e) {
    if (e.target.closest('.zoom-segment-pill')) return; // handled by pill listener
    e.preventDefault();
    e.stopPropagation();
    openTimelineContextMenu(-1, e.clientX, e.clientY, 'timeline');
  });

  // Dismiss context menu & popover on outside click or escape
  window.addEventListener('mousedown', function (e) {
    const cMenu = document.getElementById('timelineContextMenu');
    if (cMenu && cMenu.style.display !== 'none' && !cMenu.contains(e.target)) {
      closeTimelineContextMenu();
    }
    const qPopover = document.getElementById('quickZoomPopover');
    if (qPopover && qPopover.style.display !== 'none' && !qPopover.contains(e.target) && !e.target.closest('.zoom-pill-level-badge') && !e.target.closest('.zoom-list-level-btn')) {
      closeQuickZoomPopover();
    }
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeAllZoomFlyouts();
    }
  });
}

function renderZoomSegments() {
  const layer = document.getElementById('zoomSegmentsLayer');
  const totalDuration = getVideoDuration();
  if (!layer || !video || !isFinite(totalDuration) || totalDuration <= 0) return;

  layer.innerHTML = '';

  zoomSegments.forEach((seg, idx) => {
    const startSec = Math.max(0, seg.startTime / 1000);
    const endSec = Math.min(totalDuration, seg.endTime / 1000);
    if (endSec <= startSec) return;

    const leftPct = (startSec / totalDuration) * 100;
    const widthPct = Math.max(1.5, ((endSec - startSec) / totalDuration) * 100);

    const isFixed = seg.mode === 'fixed';
    const pill = document.createElement('div');
    pill.className = `zoom-segment-pill${isFixed ? ' mode-fixed' : ''}${idx === selectedZoomIndex ? ' selected' : ''}`;
    pill.style.left = `${leftPct}%`;
    pill.style.width = `${widthPct}%`;
    pill.dataset.index = idx;

    const rawLevel = (seg.zoomLevel || zoomDepths[settings.zoomDepth] || 1.75);
    const level = rawLevel.toFixed(2).replace(/\.00$/, '').replace(/(\.[1-9])0$/, '$1');
    const modeIcon = seg.mode === 'fixed'
      ? studioIcon('pin', 11, '', 'color:#ffffff;vertical-align:-1px;')
      : studioIcon('zoom', 11, '', 'color:#ffffff;vertical-align:-1px;');
    pill.title = `Zoom ${level}× [${seg.mode || 'follow'}] (${formatTimeShort(startSec)} - ${formatTimeShort(endSec)}) • Double-click or right-click to edit zoom amount`;

    // Left drag handle (adjusts start time)
    const handleLeft = document.createElement('div');
    handleLeft.className = 'zoom-handle zoom-handle-left';
    handleLeft.title = 'Drag to adjust zoom start time';
    handleLeft.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      selectZoom(idx);
      startDrag(e, 'handle-left', idx);
    });
    pill.appendChild(handleLeft);

    // Label with interactive mode icon & interactive zoom amount badge
    const label = document.createElement('span');
    label.className = 'zoom-pill-label';
    const iconSpan = `<span class="zoom-pill-mode-icon" title="Click to toggle Follow/Fixed">${modeIcon}</span>`;
    const levelSpan = `<span class="zoom-pill-level-badge" data-index="${idx}" title="Click or double-click to edit zoom (${level}×)">${level}×</span>`;
    label.innerHTML = widthPct > 4 ? `${iconSpan} ${levelSpan}` : `${iconSpan}`;

    const modeIconEl = label.querySelector('.zoom-pill-mode-icon');
    if (modeIconEl) {
      modeIconEl.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        saveState();
        seg.mode = (seg.mode === 'fixed') ? 'follow' : 'fixed';
        if (seg.mode === 'fixed') {
          ensureSegmentFixedCoords(seg);
        }
        selectZoom(idx);
        renderZoomSegments();
        updateZoomList();
        requestPreviewRedraw();
        showToast(seg.mode === 'fixed' ? 'Switched to Fixed Spot mode' : 'Switched to Follow Cursor mode');
      });
    }

    const levelBadgeEl = label.querySelector('.zoom-pill-level-badge');
    if (levelBadgeEl) {
      const openEditor = (e) => {
        e.stopPropagation();
        e.preventDefault();
        selectZoom(idx);
        openQuickZoomPopover(idx, levelBadgeEl, e.clientX, e.clientY);
      };
      levelBadgeEl.addEventListener('click', openEditor);
      levelBadgeEl.addEventListener('dblclick', openEditor);
    }
    pill.appendChild(label);

    // Delete button (hover/selected - centered on top border safely away from handles)
    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'zoom-pill-delete';
    deleteBtn.title = 'Delete this zoom';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveState();
      zoomSegments.splice(idx, 1);
      if (selectedZoomIndex === idx) {
        deselectAllZooms();
      } else if (selectedZoomIndex > idx) {
        selectedZoomIndex--;
      }
      updateZoomUI();
    });
    pill.appendChild(deleteBtn);

    // Right drag handle (adjusts end time)
    const handleRight = document.createElement('div');
    handleRight.className = 'zoom-handle zoom-handle-right';
    handleRight.title = 'Drag to adjust zoom end time';
    handleRight.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      selectZoom(idx);
      startDrag(e, 'handle-right', idx);
    });
    pill.appendChild(handleRight);

    // Drag entire segment or select
    pill.addEventListener('mousedown', (e) => {
      if (e.target.closest('.zoom-handle') || e.target.closest('.zoom-pill-delete') || e.target.closest('.zoom-pill-mode-icon') || e.target.closest('.zoom-pill-level-badge')) return;
      if (e.button === 2) return; // Right-click handled by contextmenu
      e.stopPropagation();
      selectZoom(idx);
      startDrag(e, 'segment', idx);
    });

    // Right-click context menu on segment pill
    pill.addEventListener('contextmenu', (e) => {
      e.stopPropagation();
      e.preventDefault();
      selectZoom(idx);
      openTimelineContextMenu(idx, e.clientX, e.clientY, 'segment');
    });

    // Double-click pill to open quick zoom editor
    pill.addEventListener('dblclick', (e) => {
      if (e.target.closest('.zoom-handle') || e.target.closest('.zoom-pill-delete') || e.target.closest('.zoom-pill-mode-icon')) return;
      e.stopPropagation();
      e.preventDefault();
      selectZoom(idx);
      openQuickZoomPopover(idx, pill, e.clientX, e.clientY);
    });

    layer.appendChild(pill);
  });
}

function getDeduplicatedClicks(data) {
  if (!data || data.length === 0) return [];
  const raw = data.filter(d => d && (d.type === 'click' || d.type === 'doubleclick' || d.type === 'mousedown'));
  if (raw.length === 0) return [];
  raw.sort((a, b) => a.timestamp - b.timestamp);
  const result = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (result.length > 0) {
      const prev = result[result.length - 1];
      const dt = Math.abs(c.timestamp - prev.timestamp);
      if (dt < 250) {
        const prevNx = prev.normalizedX !== undefined ? prev.normalizedX : ((prev.x || 0) / Math.max(1, prev.viewportWidth || videoWidth || 1920));
        const prevNy = prev.normalizedY !== undefined ? prev.normalizedY : ((prev.y || 0) / Math.max(1, prev.viewportHeight || videoHeight || 1080));
        const curNx = c.normalizedX !== undefined ? c.normalizedX : ((c.x || 0) / Math.max(1, c.viewportWidth || videoWidth || 1920));
        const curNy = c.normalizedY !== undefined ? c.normalizedY : ((c.y || 0) / Math.max(1, c.viewportHeight || videoHeight || 1080));
        const normDist = Math.hypot(curNx - prevNx, curNy - prevNy);
        if (dt < 40 || normDist < 0.035) {
          if (c.type === 'click' || c.type === 'doubleclick') {
            result[result.length - 1] = c;
          }
          continue;
        }
      }
    }
    result.push(c);
  }
  return result;
}

function renderClickMarkers() {
  const layer = document.getElementById('clickMarkersLayer');
  const totalDuration = getVideoDuration();
  if (!layer || !cursorData || !isFinite(totalDuration) || totalDuration <= 0) return;

  layer.innerHTML = '';
  let clicks = getDeduplicatedClicks(cursorData);

  // For long recordings with hundreds of clicks, sample to at most ~180 visible markers
  // to keep the timeline 60fps fast and prevent DOM thrashing
  if (clicks.length > 180) {
    const step = clicks.length / 180;
    const sampled = [];
    for (let i = 0; i < 180; i++) {
      sampled.push(clicks[Math.floor(i * step)]);
    }
    clicks = sampled;
  }

  clicks.forEach((click) => {
    const clickSec = click.timestamp / 1000;
    if (clickSec < 0 || clickSec > totalDuration) return;

    const leftPct = (clickSec / totalDuration) * 100;
    const marker = document.createElement('div');
    const isRight = click.button === 2 || click.buttonType === 'right';
    marker.className = 'timeline-click-marker' + (isRight ? ' right-click' : '');
    marker.style.left = `${leftPct}%`;
    const label = isRight ? 'Right-click' : (click.type === 'doubleclick' ? 'Double-click' : 'Click');
    marker.title = `${label} at ${formatTimeShort(clickSec)} • Click to seek`;

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      if (video && isFinite(totalDuration)) {
        video.currentTime = Math.max(0, Math.min(totalDuration, clickSec - 0.04));
        updateTimeline();
        requestPreviewRedraw();
      }
    });

    layer.appendChild(marker);
  });
}

function updateSegmentModeButtons(mode) {
  const effectiveMode = (typeof mode === 'string') ? mode : 'follow';
  const followBtn = document.getElementById('segModeFollowBtn');
  const fixedBtn = document.getElementById('segModeFixedBtn');
  if (effectiveMode === 'fixed') {
    if (fixedBtn) {
      fixedBtn.classList.add('active');
      fixedBtn.style.background = 'rgba(168, 85, 247, 0.22)';
      fixedBtn.style.borderColor = 'rgba(192, 132, 252, 0.55)';
      fixedBtn.style.color = '#e9d5ff';
    }
    if (followBtn) {
      followBtn.classList.remove('active');
      followBtn.style.background = 'transparent';
      followBtn.style.borderColor = 'transparent';
      followBtn.style.color = 'var(--text-secondary)';
    }
  } else {
    if (followBtn) {
      followBtn.classList.add('active');
      followBtn.style.background = 'rgba(99, 102, 241, 0.22)';
      followBtn.style.borderColor = 'rgba(129, 140, 248, 0.55)';
      followBtn.style.color = '#c7d2fe';
    }
    if (fixedBtn) {
      fixedBtn.classList.remove('active');
      fixedBtn.style.background = 'transparent';
      fixedBtn.style.borderColor = 'transparent';
      fixedBtn.style.color = 'var(--text-secondary)';
    }
  }
}
window.updateSegmentModeButtons = updateSegmentModeButtons;

function ensureSegmentFixedCoords(seg) {
  if (!seg) return;
  if (seg.centerX === undefined || seg.centerY === undefined) {
    const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
    const srcY = browserUIHeight > 0 ? browserUIHeight : 0;
    const srcH = browserUIHeight > 0 ? (videoHeight - browserUIHeight) : videoHeight;
    const cur = (analyzer && cursorData && cursorData.length > 0)
      ? analyzer.getCursorAtTime((video && isFinite(video.currentTime)) ? video.currentTime * 1000 : seg.startTime, videoWidth, videoHeight, displaySurface)
      : null;
    const firstPos = seg.positions?.[0];
    seg.centerX = cur ? cur.x : (firstPos?.x ?? (videoWidth / 2));
    seg.centerY = cur ? cur.y : (firstPos?.y ?? (srcY + srcH / 2));
    seg.normalizedX = seg.centerX / Math.max(1, videoWidth);
    seg.normalizedY = seg.centerY / Math.max(1, videoHeight);
  }
}
window.ensureSegmentFixedCoords = ensureSegmentFixedCoords;

function selectZoom(index, options = {}) {
  selectedZoomIndex = index;
  const shouldSeek = options.seek !== false;

  // Highlight active pill on timeline without destroying DOM elements!
  document.querySelectorAll('.zoom-segment-pill').forEach((p, idx) => {
    p.classList.toggle('selected', idx === index);
  });

  updateZoomList();

  const inspector = document.getElementById('selectedZoomInspector');
  const timeRangeEl = document.getElementById('inspectorTimeRange');
  const depthSelect = document.getElementById('selectedSegmentDepth');
  const focalRow = document.getElementById('inspectorFocalPositionRow');

  if (index >= 0 && index < zoomSegments.length) {
    const seg = zoomSegments[index];
    if (shouldSeek && !isDragging && !isDraggingFocalPoint && video) {
      const segDur = Math.max(1, seg.endTime - seg.startTime);
      const inDur = Math.min(analyzer?.TRANSITION_IN || 650, segDur * 0.35);
      const outDur = Math.min(analyzer?.TRANSITION_OUT || 700, segDur * 0.35);
      const plateauStart = seg.startTime + inDur;
      const plateauEnd = Math.max(plateauStart, seg.endTime - outDur);
      const curMs = Number.isFinite(video.currentTime) ? (video.currentTime * 1000) : -1;

      // Seek into the zoomed plateau if playhead is currently outside it (e.g. at seg.startTime where zoom is 1.0x)
      if (curMs < plateauStart - 10 || curMs > plateauEnd + 10) {
        const firstClickT = (seg.positions && seg.positions[0] && Number.isFinite(seg.positions[0].timestamp))
          ? seg.positions[0].timestamp
          : (plateauStart + 40);
        const targetMs = Math.max(plateauStart, Math.min(plateauEnd, firstClickT));
        video.currentTime = targetMs / 1000;
      }
    }

    if (inspector) {
      inspector.style.display = 'block';
      if (timeRangeEl) {
        const durSec = ((seg.endTime - seg.startTime) / 1000).toFixed(1);
        timeRangeEl.textContent = `${formatTimeShort(seg.startTime / 1000)} - ${formatTimeShort(seg.endTime / 1000)} (${durSec}s)`;
      }
      const segLevel = (seg.zoomLevel || zoomDepths[settings.zoomDepth] || 1.75);
      const customInp = document.getElementById('inspectorCustomZoomInput');
      if (customInp && document.activeElement !== customInp) {
        customInp.value = (+segLevel.toFixed(2)).toString();
      }
      if (depthSelect) {
        const optionsList = ['1.25', '1.40', '1.50', '1.75', '2.00', '2.20', '2.50', '2.80'];
        const matching = optionsList.find(o => Math.abs(parseFloat(o) - segLevel) < 0.02);
        depthSelect.value = matching || 'custom';
      }
      const modeSelect = document.getElementById('selectedSegmentMode');
      if (modeSelect) {
        modeSelect.value = seg.mode || 'follow';
      }
      updateSegmentModeButtons(seg.mode || 'follow');
      if (focalRow) {
        focalRow.style.display = (seg.mode === 'fixed') ? 'block' : 'none';
      }
      updateZoomInspectorCoords(seg);
      previewCanvas?.classList.toggle('focal-target-mode', seg.mode === 'fixed');
    }
  } else {
    if (inspector) inspector.style.display = 'none';
    previewCanvas?.classList.remove('focal-target-mode');
  }
  requestPreviewRedraw();
}
window.selectZoom = selectZoom;

function updateZoomInspectorCoords(seg) {
  const coordsText = document.getElementById('inspectorCoordsText');
  if (coordsText && seg) {
    const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
    const srcY = browserUIHeight > 0 ? browserUIHeight : 0;
    const srcH = Math.max(1, videoHeight - srcY);
    const pctX = Math.round(Math.max(0, Math.min(1, (seg.centerX ?? (videoWidth / 2)) / Math.max(1, videoWidth))) * 100);
    const pctY = Math.round(Math.max(0, Math.min(1, ((seg.centerY ?? (srcY + srcH / 2)) - srcY) / srcH)) * 100);
    coordsText.textContent = `X: ${pctX}%  Y: ${pctY}%`;
  }
}

function duplicateSelectedZoom() {
  if (selectedZoomIndex < 0 || selectedZoomIndex >= zoomSegments.length) return;
  saveState();
  const orig = zoomSegments[selectedZoomIndex];
  const dur = Math.max(250, orig.endTime - orig.startTime);
  const totalDurMs = Math.max(dur, (getVideoDuration() || 0) * 1000);
  const newStart = Math.max(0, Math.min(totalDurMs - dur, orig.endTime + 500));
  const newSegment = {
    ...JSON.parse(JSON.stringify(orig)),
    startTime: newStart,
    endTime: newStart + dur
  };
  zoomSegments.push(newSegment);
  zoomSegments.sort((a, b) => a.startTime - b.startTime);
  selectedZoomIndex = zoomSegments.findIndex(s => s === newSegment);
  updateZoomUI();
  selectZoom(selectedZoomIndex);
}

function setZoomFocalPreset(spot) {
  if (selectedZoomIndex < 0 || selectedZoomIndex >= zoomSegments.length) return;
  saveState();
  const seg = zoomSegments[selectedZoomIndex];
  seg.mode = 'fixed';
  const modeSelect = document.getElementById('selectedSegmentMode');
  if (modeSelect) modeSelect.value = 'fixed';
  updateSegmentModeButtons('fixed');
  const focalRow = document.getElementById('inspectorFocalPositionRow');
  if (focalRow) focalRow.style.display = 'block';
  previewCanvas?.classList.add('focal-target-mode');

  const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
  const srcY = browserUIHeight > 0 ? browserUIHeight : 0;
  const srcH = browserUIHeight > 0 ? (videoHeight - browserUIHeight) : videoHeight;

  // Use 0.08 / 0.92 for edge & corner presets so the camera reaches the full clamped edge up to 3.0x zoom
  if (spot === 'center') {
    seg.centerX = videoWidth * 0.5;
    seg.centerY = srcY + srcH * 0.5;
  } else if (spot === 'left') {
    seg.centerX = videoWidth * 0.08;
    seg.centerY = srcY + srcH * 0.5;
  } else if (spot === 'right') {
    seg.centerX = videoWidth * 0.92;
    seg.centerY = srcY + srcH * 0.5;
  } else if (spot === 'top-left') {
    seg.centerX = videoWidth * 0.08;
    seg.centerY = srcY + srcH * 0.08;
  } else if (spot === 'top-right') {
    seg.centerX = videoWidth * 0.92;
    seg.centerY = srcY + srcH * 0.08;
  } else if (spot === 'bottom-left') {
    seg.centerX = videoWidth * 0.08;
    seg.centerY = srcY + srcH * 0.92;
  } else if (spot === 'bottom-right') {
    seg.centerX = videoWidth * 0.92;
    seg.centerY = srcY + srcH * 0.92;
  }
  seg.normalizedX = seg.centerX / Math.max(1, videoWidth);
  seg.normalizedY = seg.centerY / Math.max(1, videoHeight);
  if (analyzer && typeof analyzer.invalidatePathCache === 'function') {
    analyzer.invalidatePathCache();
  }
  updateZoomInspectorCoords(seg);
  selectZoom(selectedZoomIndex);
  requestPreviewRedraw();
}

function deselectAllZooms() {
  selectedZoomIndex = -1;
  document.querySelectorAll('.zoom-segment-pill').forEach(p => p.classList.remove('selected'));
  updateZoomList();
  const inspector = document.getElementById('selectedZoomInspector');
  if (inspector) inspector.style.display = 'none';
  previewCanvas?.classList.remove('focal-target-mode');
  requestPreviewRedraw();
}

function deleteSelectedZoom() {
  if (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length) {
    saveState();
    zoomSegments.splice(selectedZoomIndex, 1);
    deselectAllZooms();
    updateZoomUI();
    showToast('Deleted zoom segment');
  }
}

let _toastTimeout = null;
function showToast(message, durationMs = 2400) {
  const toast = document.getElementById('editorToast');
  if (!toast) return;
  const timeoutMs = (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) ? durationMs : 2800;
  toast.style.pointerEvents = '';
  toast.innerHTML = message;
  toast.classList.remove('hidden');
  if (_toastTimeout) clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, timeoutMs);
}

function splitAtPlayhead() {
  if (!video || !videoLoaded) {
    showToast('No video loaded to split');
    return;
  }
  const dur = getVideoDuration();
  if (dur <= 0) return;

  const currentMs = Math.round(video.currentTime * 1000);

  // 1. Search for an existing zoom segment enclosing current playhead (with at least 150ms margins)
  const segIdx = zoomSegments.findIndex(s => currentMs >= (s.startTime + 150) && currentMs <= (s.endTime - 150));

  if (segIdx >= 0) {
    saveState();
    const orig = zoomSegments[segIdx];
    const origEnd = orig.endTime;

    // Resolve camera/cursor focus at the split point so the second half has accurate center coordinates
    let splitX = orig.centerX;
    let splitY = orig.centerY;
    let splitNormX = orig.normalizedX;
    let splitNormY = orig.normalizedY;
    const vw = (video && video.videoWidth) || videoWidth || 1920;
    const vh = (video && video.videoHeight) || videoHeight || 1080;
    const browserUIHeight = getEffectiveBrowserUIHeight(vh);
    if ((orig.mode || 'follow') === 'follow' && analyzer) {
      const zState = analyzer.getZoomAtTime(currentMs, zoomSegments, vw, vh, browserUIHeight);
      if (zState && Number.isFinite(zState.x) && Number.isFinite(zState.y)) {
        splitX = zState.x;
        splitY = zState.y;
        splitNormX = vw > 0 ? Math.max(0, Math.min(1, splitX / vw)) : 0.5;
        splitNormY = vh > 0 ? Math.max(0, Math.min(1, splitY / vh)) : 0.5;
      }
    }

    // Partition click positions cleanly across the split boundary
    let origPositions = undefined;
    let newPositions = undefined;
    if (Array.isArray(orig.positions) && orig.positions.length > 0) {
      const getPt = (p) => (p.timestamp !== undefined ? p.timestamp : (p.time !== undefined ? p.time : 0));
      const leftPos = orig.positions.filter(p => getPt(p) <= currentMs);
      const rightPos = orig.positions.filter(p => getPt(p) >= currentMs);
      origPositions = leftPos.length > 0 ? leftPos : [orig.positions[0]];
      newPositions = rightPos.length > 0 ? rightPos : [orig.positions[orig.positions.length - 1]];
      orig.positions = origPositions;
    }

    // First segment ends at current playhead
    orig.endTime = currentMs;

    // Second segment starts at current playhead
    const newSeg = {
      startTime: currentMs,
      endTime: origEnd,
      zoomLevel: orig.zoomLevel || 1.75,
      mode: orig.mode || 'follow',
      centerX: splitX,
      centerY: splitY,
      normalizedX: splitNormX,
      normalizedY: splitNormY,
      _isSplitContinuation: true,
      ...(newPositions ? { positions: newPositions } : {})
    };

    if (analyzer && typeof analyzer.invalidatePathCache === 'function') {
      analyzer.invalidatePathCache();
    }

    zoomSegments.splice(segIdx + 1, 0, newSeg);
    selectZoom(segIdx + 1);
    updateZoomUI();
    showToast(`Split zoom segment at ${formatTimeShort(currentMs / 1000)} (S)`);
    return;
  }

  // 2. If playhead is over a segment but within 150ms of its edges
  const edgeIdx = zoomSegments.findIndex(s => currentMs >= s.startTime && currentMs <= s.endTime);
  if (edgeIdx >= 0) {
    showToast('Playhead too close to segment edge to split (<0.15s)');
    return;
  }

  // 3. If outside existing zoom segments, create a new zoom cut at playhead
  saveState();
  addZoomAtCurrentTime('follow');
  showToast(`Created new zoom cut at ${formatTimeShort(video.currentTime)}`);
}

function updateZoomList() {
  const zoomList = document.getElementById('zoomList');
  if (!zoomList) return;

  if (zoomSegments.length === 0) {
    zoomList.innerHTML = '<p style="color: var(--text-muted); font-size: 11px; padding: 10px; text-align: center;">No zoom points. Click "+ Add Zoom" or "Re-analyze".</p>';
    return;
  }

  zoomList.innerHTML = '';
  const MAX_LIST_ITEMS = 60;
  const renderList = zoomSegments.slice(0, MAX_LIST_ITEMS);
  renderList.forEach((seg, i) => {
    const duration = ((seg.endTime - seg.startTime) / 1000).toFixed(1);
    const rawLevel = (seg.zoomLevel || zoomDepths[settings.zoomDepth] || 1.75);
    const level = rawLevel.toFixed(2).replace(/\.00$/, '').replace(/(\.[1-9])0$/, '$1');
    const isSelected = (i === selectedZoomIndex);
    const isFixed = seg.mode === 'fixed';

    const item = document.createElement('div');
    item.className = `zoom-list-item${isSelected ? ' selected' : ''}`;
    item.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: ${isSelected ? 'rgba(99, 102, 241, 0.14)' : 'var(--bg-main)'};
      border: 1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'};
      border-radius: 8px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      font-size: 12px;
    `;

    const modeBadge = `
      <button type="button" class="zoom-mode-toggle-btn" data-index="${i}" title="Mode: ${isFixed ? 'Fixed Spot' : 'Follow Cursor'}. Click to switch to ${isFixed ? 'Follow' : 'Fixed Spot'}." style="
        font-size: 10px;
        background: ${isFixed ? 'rgba(168, 85, 247, 0.2)' : 'rgba(99, 102, 241, 0.2)'};
        color: ${isFixed ? '#d8b4fe' : '#a5b4fc'};
        border: 1px solid ${isFixed ? 'rgba(168, 85, 247, 0.45)' : 'rgba(99, 102, 241, 0.45)'};
        padding: 2px 7px;
        border-radius: 5px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: all 0.15s ease;
      ">
        ${isFixed ? studioIcon('pin', 10, '', 'color:#d8b4fe;') : studioIcon('target', 10, '', 'color:#a5b4fc;')}
        <span>${isFixed ? 'Fixed' : 'Follow'}</span>
      </button>
    `;

    const levelBadge = `
      <button type="button" class="zoom-list-level-btn" data-index="${i}" title="Click or double-click to edit zoom amount (${level}×)" style="
        font-size: 10px;
        background: rgba(16, 185, 129, 0.16);
        color: #10b981;
        border: 1px solid rgba(16, 185, 129, 0.35);
        padding: 1px 6px;
        border-radius: 4px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
        display: inline-flex;
        align-items: center;
        gap: 2px;
      ">
        <span>${level}×</span>
        <span style="display: inline-flex; align-items: center; opacity: 0.7;">${studioIcon('pencil', 10)}</span>
      </button>
    `;

    item.innerHTML = `
      <div style="display: flex; gap: 6px; align-items: center;">
        <span style="font-weight: 600; color: var(--text-primary); font-family: monospace;">${formatTimeShort(seg.startTime / 1000)}</span>
        ${levelBadge}
        ${modeBadge}
        <span style="font-size: 11px; color: var(--text-muted);">${duration}s</span>
      </div>
      <button class="zoom-delete-btn" data-index="${i}" title="Delete zoom" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 14px; line-height: 1;">×</button>
    `;

    // Right-click context menu on zoom list item
    item.addEventListener('contextmenu', (e) => {
      e.stopPropagation();
      e.preventDefault();
      selectZoom(i);
      openTimelineContextMenu(i, e.clientX, e.clientY, 'segment');
    });

    // Double-click item to edit zoom level
    item.addEventListener('dblclick', (e) => {
      if (e.target.closest('.zoom-delete-btn') || e.target.closest('.zoom-mode-toggle-btn')) return;
      e.stopPropagation();
      e.preventDefault();
      selectZoom(i);
      openQuickZoomPopover(i, item, e.clientX, e.clientY);
    });

    item.addEventListener('click', (e) => {
      const levelBtn = e.target.closest('.zoom-list-level-btn');
      if (levelBtn) {
        e.stopPropagation();
        e.preventDefault();
        selectZoom(i);
        openQuickZoomPopover(i, levelBtn, e.clientX, e.clientY);
        return;
      }
      const modeBtn = e.target.closest('.zoom-mode-toggle-btn');
      if (modeBtn) {
        e.stopPropagation();
        saveState();
        const newMode = (seg.mode === 'fixed') ? 'follow' : 'fixed';
        seg.mode = newMode;
        if (newMode === 'fixed') {
          ensureSegmentFixedCoords(seg);
        }
        selectZoom(i);
        updateZoomUI();
        requestPreviewRedraw();
        return;
      }
      if (e.target.classList.contains('zoom-delete-btn')) {
        e.stopPropagation();
        saveState();
        zoomSegments.splice(i, 1);
        if (selectedZoomIndex === i) {
          deselectAllZooms();
        } else if (selectedZoomIndex > i) {
          selectedZoomIndex--;
        }
        updateZoomUI();
        return;
      }
      selectZoom(i);
    });

    zoomList.appendChild(item);
  });

  if (zoomSegments.length > MAX_LIST_ITEMS) {
    const note = document.createElement('p');
    note.style.cssText = 'color: var(--text-muted); font-size: 11px; padding: 8px 10px; text-align: center;';
    note.textContent = `Showing first ${MAX_LIST_ITEMS} of ${zoomSegments.length} zooms (use timeline to interact with all zooms)`;
    zoomList.appendChild(note);
  }
}

function addZoomAtCurrentTime(mode = 'follow') {
  if (typeof mode !== 'string') mode = 'follow';
  if (!videoLoaded) return;

  saveState();

  const time = video.currentTime * 1000;
  const zoomLevel = zoomDepths[settings.zoomDepth] || 1.75;

  const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
  const srcY = browserUIHeight > 0 ? browserUIHeight : 0;
  const srcH = browserUIHeight > 0 ? (videoHeight - browserUIHeight) : videoHeight;

  // Center on nearest cursor position if available, else center of visible content
  let normX = 0.5;
  let normY = (srcY + srcH * 0.5) / Math.max(1, videoHeight);
  if (cursorData && cursorData.length > 0) {
    let minDiff = Infinity;
    let closestCursor = null;
    for (const c of cursorData) {
      const diff = Math.abs(c.timestamp - time);
      if (diff < minDiff) {
        minDiff = diff;
        closestCursor = c;
      }
    }
    if (closestCursor && minDiff < 5000) { // within 5s
      const coords = ZoomAnalyzer.getPointSourceCoords(closestCursor, videoWidth, videoHeight, displaySurface);
      normX = coords.normX;
      normY = coords.normY;
    }
  }

  const centerX = normX * videoWidth;
  const centerY = normY * videoHeight;

  // Start segment with lead-in before current playhead so the preview immediately displays the zoomed plateau
  const totalDurMs = Math.max(0, (getVideoDuration() || 0) * 1000);
  const leadIn = Math.min(analyzer?.TRANSITION_IN || 650, Math.max(0, time));
  const segStart = Math.max(0, time - leadIn);
  const rawEnd = segStart + 3000;
  const segEnd = totalDurMs > 500 ? Math.min(totalDurMs, Math.max(segStart + 900, rawEnd)) : rawEnd;

  // Create segment structure compatible with the analyzer
  const newSegment = {
    startTime: segStart,
    endTime: segEnd,
    positions: [{
      x: centerX,
      y: centerY,
      normalizedX: normX,
      normalizedY: normY,
      timestamp: time
    }],
    zoomLevel: zoomLevel,
    clickCount: 1,
    centerX: centerX,
    centerY: centerY,
    normalizedX: normX,
    normalizedY: normY,
    startCursorX: centerX,
    startCursorY: centerY,
    mode: mode === 'fixed' ? 'fixed' : 'follow'
  };

  zoomSegments.push(newSegment);
  zoomSegments.sort((a, b) => a.startTime - b.startTime);
  if (analyzer && typeof analyzer.invalidatePathCache === 'function') {
    analyzer.invalidatePathCache();
  }

  // Select the new segment
  selectedZoomIndex = zoomSegments.findIndex(s => s === newSegment);

  debugLog('[Editor] Added zoom segment:', newSegment);
  debugLog('[Editor] Total zoom segments:', zoomSegments.length);

  updateZoomUI();
  selectZoom(selectedZoomIndex);
}
window.addZoomAtCurrentTime = addZoomAtCurrentTime;

function resetTimeline() {
  saveState();
  // Just reset trim handles to start and end
  trimHandles = { start: 0, end: 1 };
  if (video && video.duration) {
    video.currentTime = 0;
  }
  if (isPlaying) {
    video.pause();
    isPlaying = false;
    updatePlayButton();
  }
  updateTrimUI();
  if (playheadElement) {
    playheadElement.style.left = '0%';
  }
  if (timelinePlayhead) {
    timelinePlayhead.style.left = '0%';
  }
  requestPreviewRedraw();
}

function togglePlay() {
  if (!videoLoaded) return;

  if (isPlaying) {
    video.pause();
    isPlaying = false;
  } else {
    // Start playback from trimmed start position
    const dur = getVideoDuration();
    const trimStartTime = trimHandles.start * dur;
    const trimEndTime = trimHandles.end * dur;

    // If current time is outside trimmed range, jump to start
    if (video.currentTime < trimStartTime || video.currentTime >= trimEndTime) {
      video.currentTime = trimStartTime;
    }

    video.play();
    isPlaying = true;
  }
  updatePlayButton();
}

function updatePlayButton() {
  if (isPlaying) {
    playBtn.innerHTML = '<svg class="studio-icon studio-icon-md fill-current" viewBox="0 0 24 24"><use href="#icon-pause"></use></svg>';
  } else {
    playBtn.innerHTML = '<svg class="studio-icon studio-icon-md fill-current" viewBox="0 0 24 24"><use href="#icon-play"></use></svg>';
  }
}

function updateTimeline() {
  const dur = getVideoDuration();
  if (!video || !dur || !isFinite(dur)) return;

  // Calculate playhead position as percentage of full video
  const percent = (video.currentTime / dur) * 100;

  // Update playhead position (new widget)
  if (playheadElement) {
    playheadElement.style.left = Math.max(0, Math.min(100, percent)) + '%';
  }

  // Update playhead position (legacy)
  if (timelinePlayhead) {
    timelinePlayhead.style.left = Math.max(0, Math.min(100, percent)) + '%';
  }

  // Update progress bar
  if (timelineProgressFill) {
    timelineProgressFill.style.width = Math.max(0, Math.min(100, percent)) + '%';
  }

  // Update time display in header
  if (timeDisplay) {
    timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(dur)}`;
  }

  // Update active zoom badge in timeline header
  const activeIndicator = document.getElementById('activeZoomIndicator');
  if (activeIndicator) {
    if (settings.applyZoom && zoomSegments.length > 0 && analyzer) {
      const currentMsTime = video.currentTime * 1000;
      const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
      const zoomState = analyzer.getZoomAtTime(currentMsTime, zoomSegments, videoWidth, videoHeight, browserUIHeight);
      if (zoomState.active && zoomState.level > 1.01) {
        activeIndicator.innerHTML = `${studioIcon('zoom', 11, '', 'margin-right:3px;')} ${zoomState.level.toFixed(2)}× Zoom`;
        activeIndicator.style.display = 'inline-flex';
      } else {
        activeIndicator.style.display = 'none';
      }
    } else {
      activeIndicator.style.display = 'none';
    }
  }

  // Update time display with milliseconds
  const currentMs = Math.floor((video.currentTime % 1) * 100);
  const totalMs = Math.floor((video.duration % 1) * 100);

  if (currentTimeEl) currentTimeEl.textContent = formatTime(video.currentTime);
  if (currentTimeMsEl) currentTimeMsEl.textContent = String(currentMs).padStart(2, '0');
  // Use canonical duration to avoid showing Infinity for un-patched WebM
  const canonicalDur = getVideoDuration();
  if (totalTimeEl) totalTimeEl.textContent = formatTime(canonicalDur || video.duration);
  if (totalTimeMsEl) {
    const totalMsFromCanonical = Math.floor(((canonicalDur || video.duration) % 1) * 100);
    totalTimeMsEl.textContent = String(isFinite(totalMsFromCanonical) ? totalMsFromCanonical : 0).padStart(2, '0');
  }

  // Update topbar zoom status indicator
  const topbarZoomStatus = document.getElementById('topbarZoomStatus');
  const topbarZoomLevel = document.getElementById('topbarZoomLevel');
  if (topbarZoomStatus && topbarZoomLevel) {
    if (settings.applyZoom && zoomSegments.length > 0 && analyzer) {
      const currentMsTime2 = video.currentTime * 1000;
      const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
      const zoomState2 = analyzer.getZoomAtTime(currentMsTime2, zoomSegments, videoWidth, videoHeight, browserUIHeight);
      if (zoomState2.active && zoomState2.level > 1.01) {
        topbarZoomLevel.textContent = zoomState2.level.toFixed(2) + '×';
        topbarZoomStatus.style.display = 'inline-flex';
      } else {
        topbarZoomStatus.style.display = 'none';
      }
    } else {
      topbarZoomStatus.style.display = 'none';
    }
  }
}

function formatTime(s) {
  if (!isFinite(s)) return '00:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function formatTimeShort(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

// Render loop - applies zoom effect cleanly to preview canvas
// Smooth lerp state for preview zoom (so manual zoom additions animate in)
let _previewZoomScale = 1.0, _previewNormX = 0.5, _previewNormY = 0.5;
let _lastRenderedVideoTime = -1;
let _lastClickEffectActive = false;
let _hasDrawnValidFirstFrame = false;
let _forceRedraw = true;

function requestPreviewRedraw() {
  _forceRedraw = true;
  updateFocusTargetOverlay();
}

function updateFocusTargetOverlay(sx, sy, sw, sh) {
  const overlay = document.getElementById('focusTargetOverlay');
  if (!overlay) return;

  const seg = (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length)
    ? zoomSegments[selectedZoomIndex]
    : null;
  if (!seg || seg.mode !== 'fixed' || !videoLoaded || videoWidth <= 0 || videoHeight <= 0) {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
    return;
  }

  if (sx === undefined || sy === undefined || sw === undefined || sh === undefined) {
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = videoWidth;
    let sourceHeight = videoHeight;
    const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
    if (browserUIHeight > 0) {
      sourceY = browserUIHeight;
      sourceHeight = Math.max(1, videoHeight - browserUIHeight);
    }

    let targetZoomScale = 1.0;
    let targetVideoX = sourceX + (sourceWidth / 2);
    let targetVideoY = sourceY + (sourceHeight / 2);
    if (settings.applyZoom && zoomSegments.length > 0 && analyzer) {
      const timestamp = (video && Number.isFinite(video.currentTime)) ? (video.currentTime * 1000) : seg.startTime;
      const zoomState = analyzer.getZoomAtTime(timestamp, zoomSegments, videoWidth, videoHeight, browserUIHeight);
      if (zoomState.active && zoomState.level > 1.005) {
        targetZoomScale = zoomState.level;
        targetVideoX = zoomState.x;
        targetVideoY = zoomState.y;
      }
    }

    const targetNormX = Math.max(0, Math.min(1, (targetVideoX - sourceX) / Math.max(1, sourceWidth)));
    const targetNormY = Math.max(0, Math.min(1, (targetVideoY - sourceY) / Math.max(1, sourceHeight)));
    _previewZoomScale = targetZoomScale;
    _previewNormX = targetNormX;
    _previewNormY = targetNormY;

    const cropW = sourceWidth / Math.max(1, _previewZoomScale);
    const cropH = sourceHeight / Math.max(1, _previewZoomScale);
    let cropX = (_previewNormX * sourceWidth) - (cropW / 2);
    let cropY = (_previewNormY * sourceHeight) - (cropH / 2);
    cropX = Math.max(0, Math.min(sourceWidth - cropW, cropX));
    cropY = Math.max(0, Math.min(sourceHeight - cropH, cropY));

    sx = sourceX + cropX;
    sy = sourceY + cropY;
    sw = cropW;
    sh = cropH;
  }

  const targetX = seg.centerX ?? (videoWidth / 2);
  const targetY = seg.centerY ?? (videoHeight / 2);
  const rawNormX = (targetX - sx) / Math.max(1, sw);
  const rawNormY = (targetY - sy) / Math.max(1, sh);
  const padNormX = (previewCanvas && previewCanvas.width > 24) ? (12 / previewCanvas.width) : 0.02;
  const padNormY = (previewCanvas && previewCanvas.height > 24) ? (12 / previewCanvas.height) : 0.02;
  const normX = Math.max(padNormX, Math.min(1 - padNormX, rawNormX));
  const normY = Math.max(padNormY, Math.min(1 - padNormY, rawNormY));

  const headerH = (settings.showMacWindowHeader !== false) ? 32 : 0;
  const winW = (videoWindow && (parseFloat(videoWindow.style.width) || videoWindow.clientWidth)) || (previewCanvas ? previewCanvas.clientWidth : 0) || 1;
  const winH = (videoWindow && (parseFloat(videoWindow.style.height) || videoWindow.clientHeight)) || ((previewCanvas ? previewCanvas.clientHeight : 0) + headerH) || 1;
  const canvasCssW = Math.max(1, winW);
  const canvasCssH = Math.max(1, winH - headerH);

  const leftPx = normX * canvasCssW;
  const topPx = headerH + (normY * canvasCssH);

  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  overlay.style.left = `${leftPx.toFixed(2)}px`;
  overlay.style.top = `${topPx.toFixed(2)}px`;
  overlay.dataset.normX = normX.toFixed(4);
  overlay.dataset.normY = normY.toFixed(4);
  overlay.dataset.videoX = String(Math.round(targetX));
  overlay.dataset.videoY = String(Math.round(targetY));
}
window.updateFocusTargetOverlay = updateFocusTargetOverlay;

function renderPreviewFrame() {
  if (!videoLoaded || !ctx || !previewCanvas) return false;

  // Video must have readyState >= 2 (HAVE_CURRENT_DATA) to decode a valid frame
  if (video.readyState < 2) return false;

  // Calculate source dimensions (possibly cropped)
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = videoWidth;
  let sourceHeight = videoHeight;

  const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
  if (browserUIHeight > 0) {
    // Auto-crop browser UI from top (address bar + tabs)
    sourceY = browserUIHeight;
    sourceHeight = Math.max(1, videoHeight - browserUIHeight);
  }

  // Zoom calculation — smooth lerp towards target for animated preview transitions
  let targetZoomScale = 1.0;
  let targetVideoX = sourceX + (sourceWidth / 2);
  let targetVideoY = sourceY + (sourceHeight / 2);
  if (settings.applyZoom && zoomSegments.length > 0 && analyzer) {
    const timestamp = video.currentTime * 1000;
    const zoomState = analyzer.getZoomAtTime(timestamp, zoomSegments, videoWidth, videoHeight, browserUIHeight);
    if (zoomState.active && zoomState.level > 1.005) {
      targetZoomScale = zoomState.level;
      targetVideoX = zoomState.x;
      targetVideoY = zoomState.y;
    }
  }

  // Calculate target normalized positions relative to visible source area
  const targetNormX = Math.max(0, Math.min(1, (targetVideoX - sourceX) / sourceWidth));
  const targetNormY = Math.max(0, Math.min(1, (targetVideoY - sourceY) / sourceHeight));

  // 1:1 match between live preview and exported video — camera coordinates are pre-smoothed by ZoomAnalyzer
  _previewZoomScale = targetZoomScale;
  _previewNormX = targetNormX;
  _previewNormY = targetNormY;

  // Calculate crop rectangle inside source video
  const cropW = sourceWidth / _previewZoomScale;
  const cropH = sourceHeight / _previewZoomScale;
  let cropX = (_previewNormX * sourceWidth) - (cropW / 2);
  let cropY = (_previewNormY * sourceHeight) - (cropH / 2);
  cropX = Math.max(0, Math.min(sourceWidth - cropW, cropX));
  cropY = Math.max(0, Math.min(sourceHeight - cropH, cropY));

  const sx = sourceX + cropX;
  const sy = sourceY + cropY;
  const sw = cropW;
  const sh = cropH;

  // Clear canvas buffer before drawing new frame
  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

  // Draw video to canvas with direct hardware-accelerated high-quality smoothing
  ctx.filter = 'none';
  if (settings.sharpening) {
    ctx.filter = 'contrast(1.04) saturate(1.08) brightness(1.01)';
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, previewCanvas.width, previewCanvas.height);
  ctx.filter = 'none';

  // Composite Manual Blur regions over the video frame (supports Zoom-Synced & Screen-Locked modes)
  drawBlurRegionsOnPreview(sx, sy, sw, sh, sourceX, sourceY, sourceWidth, sourceHeight);

  // Draw click effects on canvas preview
  if (settings.clickStyle !== 'none') {
    drawClickEffectsOnCanvas(sx, sy, sw, sh);
  }

  // Draw cursor highlight on preview (OpenScreen-style halo, spotlight, ring, or dot)
  if (settings.cursorHighlight && analyzer) {
    drawCursorDotOnPreview(sx, sy, sw, sh);
  }

  // Composite Face Cam bubble (supports Smart Dodge, Floating 1:1, and Zoom-With-Screen modes)
  drawWebcamOnPreview(sx, sy, sw, sh, sourceX, sourceY, sourceWidth, sourceHeight);

  // Draw selection handles for active Manual Blur region or active Draw-Blur drag rectangle
  drawBlurSelectionOverlayOnPreview();
  if (_activeDrawBlurPreviewRect && ctx) {
    const rx = Math.min(_activeDrawBlurPreviewRect.startX, _activeDrawBlurPreviewRect.curX);
    const ry = Math.min(_activeDrawBlurPreviewRect.startY, _activeDrawBlurPreviewRect.curY);
    const rw = Math.max(4, Math.abs(_activeDrawBlurPreviewRect.curX - _activeDrawBlurPreviewRect.startX));
    const rh = Math.max(4, Math.abs(_activeDrawBlurPreviewRect.curY - _activeDrawBlurPreviewRect.startY));
    ctx.save();
    ctx.fillStyle = 'rgba(6, 182, 212, 0.18)';
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
  }

  // Draw focal target indicator on preview canvas if a fixed spot zoom is selected
  if (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length) {
    const seg = zoomSegments[selectedZoomIndex];
    if (seg && seg.mode === 'fixed') {
      drawFocalTargetOnPreview(seg, sx, sy, sw, sh);
    }
  }
  updateFocusTargetOverlay(sx, sy, sw, sh);

  // Keep window centered with rock-solid stability (no CSS transform scale distortion)
  videoWindow.style.transform = 'translate(-50%, -50%)';

  if (!isVideoContentBlack(video)) {
    _hasDrawnValidFirstFrame = true;
  }
  return true;
}

/**
 * Draw interactive Screen Studio signature purple focal target dot on preview canvas for fixed-spot zooms
 */
function drawFocalTargetOnPreview(seg, sx, sy, sw, sh) {
  if (!ctx || !previewCanvas) return;
  const targetX = seg.centerX ?? (videoWidth / 2);
  const targetY = seg.centerY ?? (videoHeight / 2);

  const rawCanvasX = ((targetX - sx) / Math.max(1, sw)) * previewCanvas.width;
  const rawCanvasY = ((targetY - sy) / Math.max(1, sh)) * previewCanvas.height;

  // Keep target handle grabbable inside canvas bounds even when placed at extreme corners or when current camera crop is far from the fixed spot
  const canvasX = Math.max(12, Math.min(previewCanvas.width - 12, rawCanvasX));
  const canvasY = Math.max(12, Math.min(previewCanvas.height - 12, rawCanvasY));

  ctx.save();

  // Screen Studio Purple Focal Target Dot
  const pulse = Math.sin(Date.now() / 240) * 2.5;
  const radius = 20 + pulse;

  // 1. Ambient breathing purple aura
  const glowGrad = ctx.createRadialGradient(canvasX, canvasY, 4, canvasX, canvasY, radius * 1.85);
  glowGrad.addColorStop(0, 'rgba(168, 85, 247, 0.45)');
  glowGrad.addColorStop(0.55, 'rgba(168, 85, 247, 0.16)');
  glowGrad.addColorStop(1, 'rgba(168, 85, 247, 0)');
  ctx.beginPath();
  ctx.arc(canvasX, canvasY, radius * 1.85, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  // 2. Outer glowing violet target ring
  ctx.beginPath();
  ctx.arc(canvasX, canvasY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = '#a855f7';
  ctx.shadowBlur = 12;
  ctx.stroke();

  // 3. Inner concentric ring
  ctx.beginPath();
  ctx.arc(canvasX, canvasY, 8.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 0;
  ctx.stroke();

  // 4. Center solid purple bullseye dot
  ctx.beginPath();
  ctx.arc(canvasX, canvasY, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 5;
  ctx.fill();

  // 5. Precision crosshair ticks
  ctx.beginPath();
  ctx.moveTo(canvasX - radius - 7, canvasY);
  ctx.lineTo(canvasX - radius + 3, canvasY);
  ctx.moveTo(canvasX + radius - 3, canvasY);
  ctx.lineTo(canvasX + radius + 7, canvasY);
  ctx.moveTo(canvasX, canvasY - radius - 7);
  ctx.lineTo(canvasX, canvasY - radius + 3);
  ctx.moveTo(canvasX, canvasY + radius - 3);
  ctx.lineTo(canvasX, canvasY + radius + 7);
  ctx.strokeStyle = '#f3e8ff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();

  // 6. Screen Studio-style floating target badge (clamped inside canvas so edge/corner targets never clip)
  const labelText = 'Focal Target (drag to position)';
  ctx.font = '600 11px system-ui, -apple-system, sans-serif';
  const textMetrics = ctx.measureText(labelText);
  const badgeW = textMetrics.width + 18;
  const badgeH = 24;
  const badgeX = Math.max(8, Math.min(previewCanvas.width - badgeW - 8, canvasX - badgeW / 2));
  const belowY = canvasY + radius + 10;
  const aboveY = canvasY - radius - badgeH - 10;
  const badgeY = (belowY + badgeH > previewCanvas.height - 8)
    ? Math.max(8, aboveY)
    : Math.max(8, belowY);

  ctx.fillStyle = 'rgba(15, 10, 30, 0.92)';
  ctx.strokeStyle = 'rgba(168, 85, 247, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
  } else {
    ctx.rect(badgeX, badgeY, badgeW, badgeH);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f3e8ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowBlur = 0;
  ctx.fillText(labelText, badgeX + badgeW / 2, badgeY + badgeH / 2);

  ctx.restore();
}

let isDraggingFocalPoint = false;
let isDraggingWebcamBubble = false;
let webcamHasMovedDuringDrag = false;
let webcamDragStartClientX = 0;
let webcamDragStartClientY = 0;
let isResizingWebcamBubble = false;
let webcamHasResizedDuringDrag = false;
let webcamResizeStartClientX = 0;
let webcamResizeStartClientY = 0;
let webcamDragOffsetX = 0;
let webcamDragOffsetY = 0;
let webcamResizeCenterX = 0;
let webcamResizeCenterY = 0;
let webcamResizeStartRadius = 50;
let webcamResizeStartScale = 1.0;
let isResizingBlurBox = false;
let blurResizeCorner = null;
let blurDragStartCanvasX = 0;
let blurDragStartCanvasY = 0;
let _activeDrawBlurPreviewRect = null;
let focalDragStartMouseX = 0;
let focalDragStartMouseY = 0;
let focalDragStartCenterX = 0;
let focalDragStartCenterY = 0;
let focalDragCanvasWidth = 1;
let focalDragCanvasHeight = 1;
let focalDragCropW = 1;
let focalDragCropH = 1;

function isPointInsideWebcamBubble(px, py, rect) {
  if (!rect) return false;
  if (rect.shape === 'circular') {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return Math.hypot(px - cx, py - cy) <= (rect.width / 2);
  }
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

function setupCanvasFocalInteractions() {
  if (!previewCanvas) return;

  function getCanvasCssDimensions() {
    const rect = previewCanvas.getBoundingClientRect();
    const headerH = (settings.showMacWindowHeader !== false) ? 32 : 0;
    const fallbackW = (videoWindow && parseFloat(videoWindow.style.width)) || previewCanvas.width || 1;
    const fallbackH = Math.max(1, ((videoWindow && parseFloat(videoWindow.style.height)) || (previewCanvas.height + headerH)) - headerH);
    return {
      rect,
      width: rect.width > 0 ? rect.width : fallbackW,
      height: rect.height > 0 ? rect.height : fallbackH
    };
  }

  function getCanvasCoords(e) {
    const { rect, width, height } = getCanvasCssDimensions();
    const scaleX = previewCanvas.width / Math.max(1, width);
    const scaleY = previewCanvas.height / Math.max(1, height);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function getSourceAndCropMetrics() {
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = videoWidth;
    let sourceHeight = videoHeight;
    const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
    if (browserUIHeight > 0) {
      sourceY = browserUIHeight;
      sourceHeight = Math.max(1, videoHeight - browserUIHeight);
    }
    const cropW = sourceWidth / Math.max(1, _previewZoomScale);
    const cropH = sourceHeight / Math.max(1, _previewZoomScale);
    let cropX = (_previewNormX * sourceWidth) - (cropW / 2);
    let cropY = (_previewNormY * sourceHeight) - (cropH / 2);
    cropX = Math.max(0, Math.min(sourceWidth - cropW, cropX));
    cropY = Math.max(0, Math.min(sourceHeight - cropH, cropY));
    return {
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      sx: sourceX + cropX,
      sy: sourceY + cropY,
      sw: cropW,
      sh: cropH
    };
  }

  function canvasToVideoCoords(canvasX, canvasY) {
    const m = getSourceAndCropMetrics();
    const videoX = m.sx + (canvasX / Math.max(1, previewCanvas.width)) * m.sw;
    const videoY = m.sy + (canvasY / Math.max(1, previewCanvas.height)) * m.sh;
    return {
      x: Math.max(0, Math.min(videoWidth, videoX)),
      y: Math.max(m.sourceY, Math.min(videoHeight, videoY)),
      sx: m.sx,
      sy: m.sy,
      sw: m.sw,
      sh: m.sh
    };
  }

  function applyCanvasRectToBlurRegion(reg, canvasRect) {
    const cw = Math.max(1, previewCanvas.width);
    const ch = Math.max(1, previewCanvas.height);
    if (reg.mode === 'screen') {
      reg.x = Math.max(0, Math.min(0.98, canvasRect.x / cw));
      reg.y = Math.max(0, Math.min(0.98, canvasRect.y / ch));
      reg.width = Math.max(0.02, Math.min(1 - reg.x, canvasRect.width / cw));
      reg.height = Math.max(0.02, Math.min(1 - reg.y, canvasRect.height / ch));
    } else {
      const m = getSourceAndCropMetrics();
      const srcX = m.sx + (canvasRect.x / cw) * m.sw;
      const srcY = m.sy + (canvasRect.y / ch) * m.sh;
      const srcW = (canvasRect.width / cw) * m.sw;
      const srcH = (canvasRect.height / ch) * m.sh;
      reg.x = Math.max(0, Math.min(0.98, (srcX - m.sourceX) / Math.max(1, m.sourceWidth)));
      reg.y = Math.max(0, Math.min(0.98, (srcY - m.sourceY) / Math.max(1, m.sourceHeight)));
      reg.width = Math.max(0.02, Math.min(1 - reg.x, srcW / Math.max(1, m.sourceWidth)));
      reg.height = Math.max(0.02, Math.min(1 - reg.y, srcH / Math.max(1, m.sourceHeight)));
    }
  }

  function findBlurHitAtCanvasPoint(cx, cy) {
    // 1. Check corner handles of currently selected blur first
    if (selectedBlurIndex >= 0) {
      const selRect = _lastRenderedBlurScreenRects.find(r => r.index === selectedBlurIndex);
      if (selRect) {
        const handleRadius = 14;
        const corners = [
          { name: 'nw', x: selRect.x, y: selRect.y },
          { name: 'ne', x: selRect.x + selRect.width, y: selRect.y },
          { name: 'sw', x: selRect.x, y: selRect.y + selRect.height },
          { name: 'se', x: selRect.x + selRect.width, y: selRect.y + selRect.height }
        ];
        for (const c of corners) {
          if (Math.hypot(cx - c.x, cy - c.y) <= handleRadius) {
            return { type: 'corner', corner: c.name, index: selectedBlurIndex, rect: selRect };
          }
        }
      }
    }
    // 2. Check inside any rendered blur box (top-most first)
    for (let i = _lastRenderedBlurScreenRects.length - 1; i >= 0; i--) {
      const r = _lastRenderedBlurScreenRects[i];
      if (cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) {
        return { type: 'body', index: r.index, rect: r };
      }
    }
    return null;
  }

  function handleFocalTargetMouseDown(e) {
    if (!videoLoaded || videoWidth <= 0) return;
    if (e.button === 2) return; // Right click handled by context menu
    if (e.currentTarget && e.currentTarget.id === 'focusTargetOverlay') {
      e.stopPropagation();
    }

    const clickedOverlayDirectly = Boolean(e.currentTarget && e.currentTarget.id === 'focusTargetOverlay');
    const cCoords = getCanvasCoords(e);

    // 1. If Draw Blur Mode is active, start drawing a new blur rectangle directly on canvas
    if (!clickedOverlayDirectly && isDrawBlurMode) {
      _activeDrawBlurPreviewRect = {
        startX: cCoords.x,
        startY: cCoords.y,
        curX: cCoords.x,
        curY: cCoords.y
      };
      previewCanvas.style.cursor = 'crosshair';
      e.preventDefault();
      requestPreviewRedraw();
      return;
    }

    // 2. Check if user clicked on the Face Cam resize handle or bubble on the preview canvas
    const hasActiveWebcam = (cameraVideoLoaded || demoWebcamEnabled) && settings.showWebcam !== false;
    if (!clickedOverlayDirectly && _lastWebcamRect && hasActiveWebcam) {
      if (
        Number.isFinite(_lastWebcamRect.handleX) &&
        Number.isFinite(_lastWebcamRect.handleY) &&
        Math.hypot(cCoords.x - _lastWebcamRect.handleX, cCoords.y - _lastWebcamRect.handleY) <= 16
      ) {
        isResizingWebcamBubble = true;
        webcamHasResizedDuringDrag = false;
        webcamResizeStartClientX = e.clientX;
        webcamResizeStartClientY = e.clientY;
        webcamResizeCenterX = _lastWebcamRect.x + _lastWebcamRect.width / 2;
        webcamResizeCenterY = _lastWebcamRect.y + _lastWebcamRect.height / 2;
        webcamResizeStartRadius = Math.max(18, Math.hypot(cCoords.x - webcamResizeCenterX, cCoords.y - webcamResizeCenterY));
        webcamResizeStartScale = Number(settings.webcamScale) || 1.0;
        previewCanvas.style.cursor = 'nwse-resize';
        e.preventDefault();
        return;
      }
      if (isPointInsideWebcamBubble(cCoords.x, cCoords.y, _lastWebcamRect)) {
        isDraggingWebcamBubble = true;
        webcamHasMovedDuringDrag = false;
        webcamDragStartClientX = e.clientX;
        webcamDragStartClientY = e.clientY;
        webcamDragOffsetX = cCoords.x - _lastWebcamRect.x;
        webcamDragOffsetY = cCoords.y - _lastWebcamRect.y;
        previewCanvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
    }

    // 3. Check if user clicked on a Manual Blur box or its resize handles
    if (!clickedOverlayDirectly && _lastRenderedBlurScreenRects.length > 0) {
      const blurHit = findBlurHitAtCanvasPoint(cCoords.x, cCoords.y);
      if (blurHit) {
        saveState();
        selectBlur(blurHit.index, { seek: false });
        blurDragStartCanvasX = cCoords.x;
        blurDragStartCanvasY = cCoords.y;
        blurDragInitialRect = { ...blurHit.rect };
        if (blurHit.type === 'corner') {
          isResizingBlurBox = true;
          blurResizeCorner = blurHit.corner;
          previewCanvas.style.cursor = (blurHit.corner === 'nw' || blurHit.corner === 'se') ? 'nwse-resize' : 'nesw-resize';
        } else {
          isDraggingBlurBox = true;
          previewCanvas.style.cursor = 'move';
        }
        e.preventDefault();
        requestPreviewRedraw();
        return;
      }
    }

    // 4. Auto-resolve active zoom segment under playhead or selected
    const currentMs = video.currentTime * 1000;
    let segIdx = selectedZoomIndex;
    if (segIdx < 0 || segIdx >= zoomSegments.length) {
      segIdx = zoomSegments.findIndex(s => currentMs >= s.startTime && currentMs <= s.endTime);
    }

    if (segIdx < 0 || segIdx >= zoomSegments.length) return;
    const seg = zoomSegments[segIdx];

    // Only allow focal point repositioning on canvas when segment is explicitly in Fixed Spot mode
    if (seg.mode !== 'fixed') return;

    // Save undo state BEFORE mutating seg.centerX / seg.centerY
    saveState();
    isDraggingFocalPoint = true;
    selectZoom(segIdx, { seek: false });
    previewCanvas.style.cursor = 'grabbing';

    focalDragStartMouseX = e.clientX;
    focalDragStartMouseY = e.clientY;

    const { width: cssW, height: cssH } = getCanvasCssDimensions();
    const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
    const sourceHeight = Math.max(1, videoHeight - browserUIHeight);
    focalDragCanvasWidth = Math.max(1, cssW);
    focalDragCanvasHeight = Math.max(1, cssH);
    focalDragCropW = videoWidth / Math.max(1, _previewZoomScale);
    focalDragCropH = sourceHeight / Math.max(1, _previewZoomScale);

    // Calculate clicked video point
    const clickVideoCoords = canvasToVideoCoords(cCoords.x, cCoords.y);

    // Check if the user grabbed near the existing purple target handle; if so, drag smoothly from current center without jumping
    const curTargetX = seg.centerX ?? (videoWidth / 2);
    const curTargetY = seg.centerY ?? (videoHeight / 2);
    const rawTargetCanvasX = ((curTargetX - clickVideoCoords.sx) / Math.max(1, clickVideoCoords.sw)) * previewCanvas.width;
    const rawTargetCanvasY = ((curTargetY - clickVideoCoords.sy) / Math.max(1, clickVideoCoords.sh)) * previewCanvas.height;
    const clampedTargetCanvasX = Math.max(12, Math.min(previewCanvas.width - 12, rawTargetCanvasX));
    const clampedTargetCanvasY = Math.max(12, Math.min(previewCanvas.height - 12, rawTargetCanvasY));
    const distToHandle = clickedOverlayDirectly ? 0 : Math.hypot(cCoords.x - clampedTargetCanvasX, cCoords.y - clampedTargetCanvasY);

    if (distToHandle > 32) {
      // Clicked elsewhere on canvas — jump target to clicked position
      seg.centerX = clickVideoCoords.x;
      seg.centerY = clickVideoCoords.y;
      seg.normalizedX = clickVideoCoords.x / Math.max(1, videoWidth);
      seg.normalizedY = clickVideoCoords.y / Math.max(1, videoHeight);
    }
    focalDragStartCenterX = seg.centerX ?? clickVideoCoords.x;
    focalDragStartCenterY = seg.centerY ?? clickVideoCoords.y;
    if (analyzer && typeof analyzer.invalidatePathCache === 'function') {
      analyzer.invalidatePathCache();
    }

    updateZoomInspectorCoords(seg);
    requestPreviewRedraw();
  }

  previewCanvas.addEventListener('mousedown', handleFocalTargetMouseDown);
  const focusTargetOverlayEl = document.getElementById('focusTargetOverlay');
  if (focusTargetOverlayEl) {
    focusTargetOverlayEl.addEventListener('mousedown', handleFocalTargetMouseDown);
  }

  window.addEventListener('mousemove', (e) => {
    // 1. Handle active Draw-Blur drag rectangle
    if (_activeDrawBlurPreviewRect) {
      const cCoords = getCanvasCoords(e);
      _activeDrawBlurPreviewRect.curX = Math.max(0, Math.min(previewCanvas.width, cCoords.x));
      _activeDrawBlurPreviewRect.curY = Math.max(0, Math.min(previewCanvas.height, cCoords.y));
      requestPreviewRedraw();
      return;
    }

    // 2a. Handle On-Canvas Webcam Bubble Resizing
    if (isResizingWebcamBubble && _lastWebcamRect) {
      if (!webcamHasResizedDuringDrag) {
        if (Math.hypot(e.clientX - webcamResizeStartClientX, e.clientY - webcamResizeStartClientY) < 4) {
          return;
        }
        saveState();
        webcamHasResizedDuringDrag = true;
      }
      const cCoords = getCanvasCoords(e);
      const curRadius = Math.max(12, Math.hypot(cCoords.x - webcamResizeCenterX, cCoords.y - webcamResizeCenterY));
      const rawScale = webcamResizeStartScale * (curRadius / Math.max(12, webcamResizeStartRadius));
      const snappedScale = Math.max(0.60, Math.min(1.60, Math.round(rawScale * 20) / 20));
      settings.webcamScale = snappedScale;
      _webcamDodgeX = null;
      _webcamDodgeY = null;
      updateFaceCamUI();
      requestPreviewRedraw();
      return;
    }

    // 2b. Handle Free-Form Webcam Bubble Dragging anywhere on the canvas
    if (isDraggingWebcamBubble && _lastWebcamRect) {
      if (!webcamHasMovedDuringDrag) {
        if (Math.hypot(e.clientX - webcamDragStartClientX, e.clientY - webcamDragStartClientY) < 4) {
          return;
        }
        saveState();
        webcamHasMovedDuringDrag = true;
      }
      const cCoords = getCanvasCoords(e);
      const cw = Math.max(1, previewCanvas.width);
      const ch = Math.max(1, previewCanvas.height);
      const pad = Math.max(10, Math.round(Math.min(cw, ch) * 0.032));
      const sizeMap = { small: 0.14, medium: 0.19, large: 0.25 };
      const sizeRatio = sizeMap[settings.webcamSize] || sizeMap.medium;
      const scaleMult = Math.max(0.5, Math.min(1.8, Number(settings.webcamScale) || 1.0));
      const baseDim = Math.max(1, Math.min(cw, ch));
      const baseCamSide = Math.max(36, Math.round(baseDim * sizeRatio * scaleMult));
      const availW = Math.max(1, cw - baseCamSide - pad * 2);
      const availH = Math.max(1, ch - baseCamSide - pad * 2);

      let targetLeft = cCoords.x - webcamDragOffsetX;
      let targetTop = cCoords.y - webcamDragOffsetY;
      if (settings.webcamZoomMode === 'zoom-with-screen' && _previewZoomScale > 1.04) {
        const m = getSourceAndCropMetrics();
        if (m.sw > 0 && m.sh > 0 && m.sourceWidth > 0 && m.sourceHeight > 0) {
          const bubbleSrcX = m.sx + (targetLeft / cw) * m.sw;
          const bubbleSrcY = m.sy + (targetTop / ch) * m.sh;
          targetLeft = ((bubbleSrcX - m.sourceX) / m.sourceWidth) * cw;
          targetTop = ((bubbleSrcY - m.sourceY) / m.sourceHeight) * ch;
        }
      }
      const normX = Math.max(0, Math.min(1, (targetLeft - pad) / availW));
      const normY = Math.max(0, Math.min(1, (targetTop - pad) / availH));

      settings.webcamPosition = 'custom';
      settings.webcamCustomX = normX;
      settings.webcamCustomY = normY;
      _webcamDodgeX = null;
      _webcamDodgeY = null;

      updateFaceCamUI();
      requestPreviewRedraw();
      return;
    }

    // 3. Handle Manual Blur Box Dragging or Corner Resizing
    if ((isDraggingBlurBox || isResizingBlurBox) && selectedBlurIndex >= 0 && selectedBlurIndex < blurRegions.length && blurDragInitialRect) {
      const cCoords = getCanvasCoords(e);
      const dx = cCoords.x - blurDragStartCanvasX;
      const dy = cCoords.y - blurDragStartCanvasY;
      const reg = blurRegions[selectedBlurIndex];
      const cw = previewCanvas.width;
      const ch = previewCanvas.height;
      const minPx = 28;

      let nextRect = { ...blurDragInitialRect };
      if (isDraggingBlurBox) {
        nextRect.x = Math.max(0, Math.min(cw - nextRect.width, blurDragInitialRect.x + dx));
        nextRect.y = Math.max(0, Math.min(ch - nextRect.height, blurDragInitialRect.y + dy));
      } else if (isResizingBlurBox) {
        let left = blurDragInitialRect.x;
        let top = blurDragInitialRect.y;
        let right = blurDragInitialRect.x + blurDragInitialRect.width;
        let bottom = blurDragInitialRect.y + blurDragInitialRect.height;

        if (blurResizeCorner.includes('w')) {
          left = Math.max(0, Math.min(right - minPx, left + dx));
        }
        if (blurResizeCorner.includes('e')) {
          right = Math.min(cw, Math.max(left + minPx, right + dx));
        }
        if (blurResizeCorner.includes('n')) {
          top = Math.max(0, Math.min(bottom - minPx, top + dy));
        }
        if (blurResizeCorner.includes('s')) {
          bottom = Math.min(ch, Math.max(top + minPx, bottom + dy));
        }
        nextRect = {
          x: left,
          y: top,
          width: Math.max(minPx, right - left),
          height: Math.max(minPx, bottom - top)
        };
      }

      applyCanvasRectToBlurRegion(reg, nextRect);
      requestPreviewRedraw();
      return;
    }

    // 4. Dynamic cursor feedback when hovering over preview canvas
    if (!isDraggingFocalPoint) {
      if (isDrawBlurMode) {
        previewCanvas.style.cursor = 'crosshair';
        return;
      }

      const cCoords = getCanvasCoords(e);
      const hasActiveWebcam = (cameraVideoLoaded || demoWebcamEnabled) && settings.showWebcam !== false;
      if (_lastWebcamRect && hasActiveWebcam) {
        if (
          Number.isFinite(_lastWebcamRect.handleX) &&
          Number.isFinite(_lastWebcamRect.handleY) &&
          Math.hypot(cCoords.x - _lastWebcamRect.handleX, cCoords.y - _lastWebcamRect.handleY) <= 16
        ) {
          previewCanvas.style.cursor = 'nwse-resize';
          return;
        }
        if (isPointInsideWebcamBubble(cCoords.x, cCoords.y, _lastWebcamRect)) {
          previewCanvas.style.cursor = 'grab';
          return;
        }
      }

      if (_lastRenderedBlurScreenRects.length > 0) {
        const blurHit = findBlurHitAtCanvasPoint(cCoords.x, cCoords.y);
        if (blurHit) {
          if (blurHit.type === 'corner') {
            previewCanvas.style.cursor = (blurHit.corner === 'nw' || blurHit.corner === 'se') ? 'nwse-resize' : 'nesw-resize';
          } else {
            previewCanvas.style.cursor = 'move';
          }
          return;
        }
      }

      const currentMs = (video && isFinite(video.currentTime)) ? (video.currentTime * 1000) : 0;
      const activeIdx = (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length)
        ? selectedZoomIndex
        : zoomSegments.findIndex(s => currentMs >= s.startTime && currentMs <= s.endTime);

      if (activeIdx >= 0 && zoomSegments[activeIdx].mode === 'fixed') {
        previewCanvas.style.cursor = 'crosshair';
      } else {
        previewCanvas.style.cursor = 'default';
      }
    }

    if (!isDraggingFocalPoint) return;
    if (selectedZoomIndex < 0 || selectedZoomIndex >= zoomSegments.length) return;
    const seg = zoomSegments[selectedZoomIndex];

    // Calculate stable linear delta scaled to video crop dimensions
    const deltaX = e.clientX - focalDragStartMouseX;
    const deltaY = e.clientY - focalDragStartMouseY;
    const scaleX = focalDragCropW / focalDragCanvasWidth;
    const scaleY = focalDragCropH / focalDragCanvasHeight;
    const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
    const minY = browserUIHeight > 0 ? browserUIHeight : 0;

    const newX = Math.max(0, Math.min(videoWidth, focalDragStartCenterX + deltaX * scaleX));
    const newY = Math.max(minY, Math.min(videoHeight, focalDragStartCenterY + deltaY * scaleY));

    seg.centerX = newX;
    seg.centerY = newY;
    seg.normalizedX = newX / Math.max(1, videoWidth);
    seg.normalizedY = newY / Math.max(1, videoHeight);
    if (analyzer && typeof analyzer.invalidatePathCache === 'function') {
      analyzer.invalidatePathCache();
    }

    updateZoomInspectorCoords(seg);
    requestPreviewRedraw();
  });

  window.addEventListener('mouseup', () => {
    if (_activeDrawBlurPreviewRect) {
      const rx = Math.min(_activeDrawBlurPreviewRect.startX, _activeDrawBlurPreviewRect.curX);
      const ry = Math.min(_activeDrawBlurPreviewRect.startY, _activeDrawBlurPreviewRect.curY);
      const rw = Math.abs(_activeDrawBlurPreviewRect.curX - _activeDrawBlurPreviewRect.startX);
      const rh = Math.abs(_activeDrawBlurPreviewRect.curY - _activeDrawBlurPreviewRect.startY);
      _activeDrawBlurPreviewRect = null;
      isDrawBlurMode = false;
      syncDrawBlurModeButtonUI();

      if (rw > 12 && rh > 12) {
        const tempReg = { mode: 'content', x: 0.35, y: 0.35, width: 0.25, height: 0.16 };
        applyCanvasRectToBlurRegion(tempReg, { x: rx, y: ry, width: rw, height: rh });
        addBlurRegion({
          x: tempReg.x,
          y: tempReg.y,
          width: tempReg.width,
          height: tempReg.height,
          mode: 'content'
        });
      } else {
        addBlurRegion();
      }
      requestPreviewRedraw();
      return;
    }

    if (isResizingWebcamBubble) {
      const didResize = webcamHasResizedDuringDrag;
      isResizingWebcamBubble = false;
      webcamHasResizedDuringDrag = false;
      previewCanvas.style.cursor = 'default';
      if (didResize) {
        updateFaceCamUI();
        requestPreviewRedraw();
        showToast(`${studioIcon('camera', 16)} Webcam scale set to ${Math.round((Number(settings.webcamScale) || 1) * 100)}%`);
      }
    }
    if (isDraggingWebcamBubble) {
      const didMove = webcamHasMovedDuringDrag;
      isDraggingWebcamBubble = false;
      webcamHasMovedDuringDrag = false;
      previewCanvas.style.cursor = 'default';
      if (didMove) {
        updateFaceCamUI();
        requestPreviewRedraw();
        const pctX = Math.round((settings.webcamCustomX ?? 0.82) * 100);
        const pctY = Math.round((settings.webcamCustomY ?? 0.80) * 100);
        showToast(`${studioIcon('camera', 16)} Webcam positioned at X: ${pctX}%, Y: ${pctY}%`);
      }
    }
    if (isDraggingBlurBox || isResizingBlurBox) {
      isDraggingBlurBox = false;
      isResizingBlurBox = false;
      blurResizeCorner = null;
      blurDragInitialRect = null;
      previewCanvas.style.cursor = 'default';
      updateBlurList();
    }
    if (isDraggingFocalPoint) {
      isDraggingFocalPoint = false;
      previewCanvas.style.cursor = 'crosshair';
      updateZoomList();
      if (selectedZoomIndex >= 0 && selectedZoomIndex < zoomSegments.length) {
        const seg = zoomSegments[selectedZoomIndex];
        const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
        const srcY = browserUIHeight > 0 ? browserUIHeight : 0;
        const srcH = Math.max(1, videoHeight - srcY);
        const pctX = Math.round(Math.max(0, Math.min(1, (seg.centerX ?? (videoWidth / 2)) / Math.max(1, videoWidth))) * 100);
        const pctY = Math.round(Math.max(0, Math.min(1, ((seg.centerY ?? (srcY + srcH / 2)) - srcY) / srcH)) * 100);
        showToast(`Locked Fixed Spot: X: ${pctX}%, Y: ${pctY}%`);
      }
    }
  });
}

/**
 * Render OpenScreen-grade Cursor Highlight (Halo, Spotlight, Ring, or Dot) onto a 2D canvas context.
 * Shared between the live Preview Canvas, the Interactive Sidebar Sandbox, and 1:1 mirrored in VideoProcessor export.
 */
function renderCursorHighlightPrimitive(targetCtx, canvasX, canvasY, viewportX, viewportY, viewportW, viewportH, opts = {}) {
  if (!targetCtx) return;
  const style = opts.style || 'halo';
  const color = opts.color || '#ffab00';
  const scale = Number.isFinite(opts.scale) ? opts.scale : 1.0;
  const k = Number.isFinite(opts.k) && opts.k > 0 ? opts.k : 1.0;
  const vx = Number.isFinite(opts.vx) ? opts.vx : 0;
  const vy = Number.isFinite(opts.vy) ? opts.vy : 0;

  // 1. Spotlight mode: softly dim surrounding viewport outside the cursor spotlight beam
  if (style === 'spotlight') {
    const spotR = Math.max(18, 62 * scale * k);
    targetCtx.save();
    const spotGrad = targetCtx.createRadialGradient(canvasX, canvasY, spotR * 0.25, canvasX, canvasY, spotR * 1.45);
    spotGrad.addColorStop(0, 'rgba(6, 8, 14, 0)');
    spotGrad.addColorStop(0.55, hexToRgba(color, 0.16));
    spotGrad.addColorStop(0.78, 'rgba(6, 8, 14, 0.28)');
    spotGrad.addColorStop(1, 'rgba(6, 8, 14, 0.36)');
    targetCtx.fillStyle = spotGrad;
    targetCtx.fillRect(viewportX, viewportY, viewportW, viewportH);

    // Crisp illuminated rim around spotlight aperture
    targetCtx.beginPath();
    targetCtx.arc(canvasX, canvasY, spotR * 0.65, 0, Math.PI * 2);
    targetCtx.strokeStyle = hexToRgba(color, 0.65);
    targetCtx.lineWidth = Math.max(1.5, 2.2 * k);
    targetCtx.stroke();
    targetCtx.restore();
  }

  // 2. Velocity-oriented kinetic motion trail (OpenScreen / Screen Studio feel)
  const speed = Math.hypot(vx, vy);
  if (speed > 2.0) {
    const trailAngle = Math.atan2(vy, vx);
    const trailLength = Math.min(32, speed * 1.4) * k;
    targetCtx.save();
    targetCtx.translate(canvasX, canvasY);
    targetCtx.rotate(trailAngle);

    const trailGrad = targetCtx.createLinearGradient(-trailLength, 0, 0, 0);
    trailGrad.addColorStop(0, hexToRgba(color, 0));
    trailGrad.addColorStop(1, hexToRgba(color, 0.38));

    targetCtx.beginPath();
    targetCtx.ellipse(-trailLength / 2, 0, Math.max(1, trailLength / 2), Math.max(1.5, 4.2 * scale * k), 0, 0, Math.PI * 2);
    targetCtx.fillStyle = trailGrad;
    targetCtx.fill();
    targetCtx.restore();
  }

  targetCtx.save();

  if (style === 'ring') {
    const ringR = Math.max(8, 22 * scale * k);
    // High-contrast outer dark shadow ring so it stands out on pure white pages
    targetCtx.beginPath();
    targetCtx.arc(canvasX, canvasY, ringR, 0, Math.PI * 2);
    targetCtx.strokeStyle = 'rgba(0, 0, 0, 0.48)';
    targetCtx.lineWidth = Math.max(3, 4.8 * k);
    targetCtx.stroke();

    // Main colored precision ring
    targetCtx.beginPath();
    targetCtx.arc(canvasX, canvasY, ringR, 0, Math.PI * 2);
    targetCtx.strokeStyle = hexToRgba(color, 0.95);
    targetCtx.lineWidth = Math.max(2, 2.8 * k);
    targetCtx.shadowColor = hexToRgba(color, 0.65);
    targetCtx.shadowBlur = 8 * k;
    targetCtx.stroke();
  } else if (style === 'dot') {
    const glowR = Math.max(6, 15 * scale * k);
    const grad = targetCtx.createRadialGradient(canvasX, canvasY, 0, canvasX, canvasY, glowR);
    grad.addColorStop(0, hexToRgba(color, 0.92));
    grad.addColorStop(0.55, hexToRgba(color, 0.42));
    grad.addColorStop(1, hexToRgba(color, 0));
    targetCtx.beginPath();
    targetCtx.arc(canvasX, canvasY, glowR, 0, Math.PI * 2);
    targetCtx.fillStyle = grad;
    targetCtx.fill();
  } else {
    // Default 'halo' (and 'spotlight' center): OpenScreen-style Studio Halo
    const outerR = Math.max(10, 28 * scale * k);
    const midR = Math.max(6, 17 * scale * k);

    // Soft radial ambient halo fill
    const grad = targetCtx.createRadialGradient(canvasX, canvasY, 0, canvasX, canvasY, outerR);
    grad.addColorStop(0, hexToRgba(color, 0.52));
    grad.addColorStop(0.55, hexToRgba(color, 0.28));
    grad.addColorStop(0.85, hexToRgba(color, 0.10));
    grad.addColorStop(1, hexToRgba(color, 0));
    targetCtx.beginPath();
    targetCtx.arc(canvasX, canvasY, outerR, 0, Math.PI * 2);
    targetCtx.fillStyle = grad;
    targetCtx.fill();

    // Subtle crisp halo ring for instant visibility on both light & dark UIs
    targetCtx.beginPath();
    targetCtx.arc(canvasX, canvasY, midR, 0, Math.PI * 2);
    targetCtx.strokeStyle = hexToRgba(color, 0.78);
    targetCtx.lineWidth = Math.max(1.25, 1.8 * k);
    targetCtx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    targetCtx.shadowBlur = 4 * k;
    targetCtx.stroke();
  }

  // Center tactile cursor pip (high contrast white core with dark shadow + colored border)
  const innerR = Math.max(2.5, 5.2 * scale * k);
  targetCtx.beginPath();
  targetCtx.arc(canvasX, canvasY, innerR, 0, Math.PI * 2);
  targetCtx.fillStyle = 'rgba(255, 255, 255, 0.98)';
  targetCtx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  targetCtx.shadowBlur = 5 * k;
  targetCtx.fill();

  targetCtx.lineWidth = Math.max(1, 1.4 * k);
  targetCtx.strokeStyle = hexToRgba(color, 0.95);
  targetCtx.stroke();

  targetCtx.restore();
}

/**
 * Draw OpenScreen-style Cursor Highlight on the preview canvas.
 * Shows where the user's cursor was at the current video time (with automatic fallback to zoom focal point).
 */
function drawCursorDotOnPreview(sx, sy, sw, sh) {
  if (!ctx || !previewCanvas || !analyzer) return;

  const timestamp = (video && Number.isFinite(video.currentTime)) ? (video.currentTime * 1000) : 0;
  const cursorPos = (typeof analyzer.resolveCursorHighlightPos === 'function')
    ? analyzer.resolveCursorHighlightPos(timestamp, videoWidth, videoHeight, displaySurface, zoomSegments)
    : analyzer.getCursorAtTime(timestamp, videoWidth, videoHeight, displaySurface);
  if (!cursorPos) return;

  const cropSx = (sw !== undefined && sw > 0) ? sx : 0;
  const cropSy = (sh !== undefined && sh > 0) ? sy : 0;
  const cropSw = (sw !== undefined && sw > 0) ? sw : previewCanvas.width;
  const cropSh = (sh !== undefined && sh > 0) ? sh : previewCanvas.height;

  // Convert cursor position from source video space to canvas space
  const canvasX = ((cursorPos.x - cropSx) / cropSw) * previewCanvas.width;
  const canvasY = ((cursorPos.y - cropSy) / cropSh) * previewCanvas.height;

  // Scale proportionally to canvas width (1920px baseline) and user size multiplier
  const baseK = Math.max(0.5, previewCanvas.width / 1920);
  const sizeMult = Math.max(0.5, Math.min(2.5, Number(settings.cursorHighlightSize) || 1.0));
  const k = baseK * sizeMult;
  const margin = 80 * k;

  // Only draw if within visible canvas bounds
  if (canvasX < -margin || canvasX > previewCanvas.width + margin || canvasY < -margin || canvasY > previewCanvas.height + margin) return;

  // Tactile click recoil physics (OpenScreen / Screen Studio feel)
  let scale = 1.0;
  const recentClick = Array.isArray(cursorData) && cursorData.find(d =>
    d && (d.type === 'click' || d.type === 'doubleclick' || d.type === 'mousedown') &&
    timestamp >= d.timestamp - 40 && timestamp <= d.timestamp + 190
  );
  if (recentClick) {
    const elapsed = timestamp - (recentClick.timestamp - 40);
    const progress = Math.min(1, Math.max(0, elapsed / 230));
    scale = 1.0 - 0.24 * Math.sin(progress * Math.PI) * Math.exp(-progress * 1.8);
  }

  // Compute velocity in 1920-normalized space for kinetic motion trail
  let vx = 0;
  let vy = 0;
  const prevCursor = analyzer.getCursorAtTime(Math.max(0, timestamp - 20), videoWidth, videoHeight, displaySurface);
  if (prevCursor) {
    const prevX = ((prevCursor.x - cropSx) / cropSw) * previewCanvas.width;
    const prevY = ((prevCursor.y - cropSy) / cropSh) * previewCanvas.height;
    vx = (canvasX - prevX) / baseK;
    vy = (canvasY - prevY) / baseK;
  }

  renderCursorHighlightPrimitive(
    ctx,
    canvasX,
    canvasY,
    0,
    0,
    previewCanvas.width,
    previewCanvas.height,
    {
      style: settings.cursorHighlightStyle || 'halo',
      color: settings.cursorHighlightColor || '#ffab00',
      scale,
      k,
      vx,
      vy
    }
  );
}

function startRenderLoop() {
  function render() {
    if (!videoLoaded || !ctx) {
      animationFrameId = requestAnimationFrame(render);
      return;
    }

    // Check if click ripple animations are active right now (80ms anticipation + 520ms radiation)
    const nowMs = video.currentTime * 1000;
    const clicksActive = settings.clickEnabled !== false && settings.clickStyle !== 'none' && cursorData.some(d =>
      (d.type === 'click' || d.type === 'doubleclick' || d.type === 'mousedown') &&
      nowMs >= d.timestamp - 100 && nowMs < d.timestamp + 650
    );

    // Check target zoom scale
    let targetZoomScale = 1.0;
    if (settings.applyZoom && zoomSegments.length > 0 && analyzer) {
      const timestamp = video.currentTime * 1000;
      const browserUIHeight = getEffectiveBrowserUIHeight(videoHeight);
      const zoomState = analyzer.getZoomAtTime(timestamp, zoomSegments, videoWidth, videoHeight, browserUIHeight);
      if (zoomState.active && zoomState.level > 1.01) {
        targetZoomScale = zoomState.level;
      }
    }
    const zoomLerpSettled = Math.abs(_previewZoomScale - targetZoomScale) < 0.002;
    const timeUnchanged = Math.abs(video.currentTime - _lastRenderedVideoTime) < 0.001;

    // Skip redraw ONLY when:
    // 1. Paused
    // 2. We have already rendered at least one valid frame
    // 3. No explicit force-redraw requested
    // 4. Video time hasn't changed
    // 5. No click animations active or ending
    // 6. Zoom lerp and Smart Dodge webcam lerp have both fully settled
    if (!isPlaying && _hasDrawnValidFirstFrame && !_forceRedraw && timeUnchanged && !clicksActive && !_lastClickEffectActive && zoomLerpSettled && _webcamDodgeSettled) {
      animationFrameId = requestAnimationFrame(render);
      return;
    }

    const drawn = renderPreviewFrame();
    if (drawn) {
      _forceRedraw = false;
      _lastClickEffectActive = clicksActive;
      _lastRenderedVideoTime = video.currentTime;
    }

    // Smooth 60 FPS playhead & badge updates during playback
    if (isPlaying) {
      updateTimeline();
    }

    animationFrameId = requestAnimationFrame(render);
  }

  render();
}

function drawClickEffectsOnCanvas(sx, sy, sw, sh) {
  if (settings.clickEnabled === false || settings.clickStyle === 'none' || !cursorData || cursorData.length === 0) return;

  const timestamp = video.currentTime * 1000;
  const previewBeforeMs = 80;  // 80ms anticipation
  const durationAfterMs = 520; // 520ms radiating pulse
  const totalWindow = previewBeforeMs + durationAfterMs; // 600ms total

  const allClicks = getDeduplicatedClicks(cursorData);
  const clicks = allClicks.filter(d =>
    timestamp >= d.timestamp - previewBeforeMs &&
    timestamp < d.timestamp + durationAfterMs
  );

  const cropSx = (sw !== undefined && sw > 0) ? sx : 0;
  const cropSy = (sh !== undefined && sh > 0) ? sy : 0;
  const cropSw = (sw !== undefined && sw > 0) ? sw : previewCanvas.width;
  const cropSh = (sh !== undefined && sh > 0) ? sh : previewCanvas.height;

  const activeColor = settings.customClickColor || clickColors[settings.clickColor] || '#ffffff';

  clicks.forEach(click => {
    const timeFromClick = timestamp - click.timestamp;
    const progress = (timeFromClick + previewBeforeMs) / totalWindow;

    // Resolve exact source coordinates using unified resolver
    const clickCoords = ZoomAnalyzer.getPointSourceCoords(click, videoWidth, videoHeight, displaySurface);

    // Map to canvas coordinates based on active zoom crop [cropSx, cropSy, cropSw, cropSh]
    const x = ((clickCoords.x - cropSx) / cropSw) * previewCanvas.width;
    const y = ((clickCoords.y - cropSy) / cropSh) * previewCanvas.height;

    if (x >= -120 && x <= previewCanvas.width + 120 && y >= -120 && y <= previewCanvas.height + 120) {
      drawRippleOnContext(ctx, x, y, progress, click, {
        style: settings.clickStyle || 'ripple',
        waves: settings.clickWaves || 'double',
        force: settings.clickForce || 'moderate',
        color: activeColor
      });
    }
  });
}

function hexToRgba(hex, alpha) {
  if (!hex || typeof hex !== 'string') return `rgba(16, 185, 129, ${alpha})`;
  const short = hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i, (_, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(short);
  if (!result) return `rgba(16, 185, 129, ${alpha})`;
  return `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`;
}

/**
 * Universal Click Ripple Rendering Engine
 * Renders high-end multi-wave pulses with ease-out cubic dispersion,
 * tactile focal anchors, and distinctive right-click indicators.
 */
function drawRippleOnContext(targetCtx, x, y, progress, click, opts) {
  if (!targetCtx || progress < 0 || progress > 1) return;

  const style = opts?.style || 'ripple';
  if (style === 'none') return;

  const wavesType = opts?.waves || 'double';
  const force = opts?.force || 'moderate';
  const baseColor = opts?.color || '#ffffff';

  // Detect click types for visual distinction
  const isRightClick = click && (click.button === 2 || click.buttonType === 'right');
  const isMiddleClick = click && (click.button === 1 || click.buttonType === 'middle');
  const isDoubleClick = click && (click.type === 'doubleclick' || click.buttonType === 'double');

  // Right click uses a distinctive warm amber/coral accent so viewers never confuse button presses
  let ringColor = baseColor;
  if (isRightClick) {
    const isAlreadyAmber = baseColor.toLowerCase() === '#f59e0b' || baseColor.toLowerCase() === '#f97316';
    ringColor = isAlreadyAmber ? '#ef4444' : '#f59e0b';
  } else if (isMiddleClick) {
    ringColor = '#8b5cf6'; // Violet accent for middle click
  }

  // Force & spread configurations
  const forceConfig = {
    weak: { maxRadius: 55, alpha: 0.8, stroke: 0.85 },
    moderate: { maxRadius: 85, alpha: 1.0, stroke: 1.0 },
    strong: { maxRadius: 125, alpha: 1.25, stroke: 1.25 }
  };
  const config = forceConfig[force] || forceConfig.moderate;

  const anticipateWindow = 80 / 600; // ~0.1333 anticipation fraction

  targetCtx.save();

  if (progress < anticipateWindow) {
    // Phase 1: Pre-click anticipation (0 -> 80ms)
    // Tactile focal dot condenses inward showing exact press location
    const antProgress = progress / anticipateWindow;
    const antAlpha = antProgress * 0.75 * config.alpha;
    const antRadius = 4 + antProgress * 5;

    // Ambient pre-glow
    const glowGrad = targetCtx.createRadialGradient(x, y, 0, x, y, antRadius * 2.2);
    glowGrad.addColorStop(0, hexToRgba(ringColor, antAlpha * 0.6));
    glowGrad.addColorStop(1, hexToRgba(ringColor, 0));
    targetCtx.beginPath();
    targetCtx.arc(x, y, antRadius * 2.2, 0, Math.PI * 2);
    targetCtx.fillStyle = glowGrad;
    targetCtx.fill();

    // Condensed focal point
    targetCtx.beginPath();
    targetCtx.arc(x, y, antRadius, 0, Math.PI * 2);
    targetCtx.fillStyle = hexToRgba(ringColor, antAlpha);
    targetCtx.fill();

    targetCtx.restore();
    return;
  }

  // Phase 2: Post-click radiating pulse (80ms -> 600ms)
  const t = (progress - anticipateWindow) / (1 - anticipateWindow); // 0 to 1

  // Define wave delays based on selected wave profile
  let waveDefs = [{ delay: 0.0, weight: 1.0 }];
  if (wavesType === 'double') {
    waveDefs = [
      { delay: 0.0, weight: 1.0 },
      { delay: 0.18, weight: 0.72 }
    ];
  } else if (wavesType === 'triple') {
    waveDefs = [
      { delay: 0.0, weight: 1.0 },
      { delay: 0.14, weight: 0.78 },
      { delay: 0.28, weight: 0.52 }
    ];
  }

  if (isDoubleClick && wavesType === 'single') {
    waveDefs.push({ delay: 0.22, weight: 0.85 });
  }

  // 1. Expanding Multi-Wave Shockwaves (for 'ripple', 'both', 'ring')
  if (style === 'ripple' || style === 'both' || style === 'ring') {
    waveDefs.forEach((wave, idx) => {
      if (t < wave.delay) return;
      const wp = (t - wave.delay) / (1 - wave.delay);
      if (wp > 1) return;

      // Screenforge-grade ease-out cubic radial dispersion
      const easeRadius = 1 - Math.pow(1 - wp, 3);
      const startRadius = 6;
      const r = startRadius + (config.maxRadius - startRadius) * easeRadius;

      // Wave opacity: rapid attack in first 14%, smooth power decay
      const attack = Math.min(1, wp / 0.14);
      const decay = Math.pow(1 - wp, 1.5);
      const waveAlpha = Math.max(0, attack * decay * 0.95 * wave.weight * config.alpha);
      if (waveAlpha <= 0.01) return;

      // Soft ambient aura / fill for leading wave
      if (idx === 0 && (style === 'ripple' || style === 'both')) {
        const auraAlpha = waveAlpha * 0.18;
        if (auraAlpha > 0.01) {
          const auraGrad = targetCtx.createRadialGradient(x, y, 0, x, y, r);
          auraGrad.addColorStop(0, hexToRgba(ringColor, auraAlpha * 1.5));
          auraGrad.addColorStop(0.65, hexToRgba(ringColor, auraAlpha * 0.5));
          auraGrad.addColorStop(1, hexToRgba(ringColor, 0));
          targetCtx.beginPath();
          targetCtx.arc(x, y, r, 0, Math.PI * 2);
          targetCtx.fillStyle = auraGrad;
          targetCtx.fill();
        }
      }

      // Main concentric shockwave ring
      targetCtx.beginPath();
      targetCtx.arc(x, y, r, 0, Math.PI * 2);

      // Drop glow behind pulse ring for high contrast
      targetCtx.shadowColor = hexToRgba(ringColor, Math.min(1, waveAlpha * 0.8));
      targetCtx.shadowBlur = 6 * config.stroke;

      // Line width tapers gracefully as pulse expands
      const baseWidth = (style === 'ring') ? 3.5 : 2.8;
      targetCtx.lineWidth = Math.max(1, (baseWidth - wp * 1.5) * config.stroke);

      // If right click, style wave 2 with dashed lines for instant clarity
      if (isRightClick && idx === 1) {
        targetCtx.setLineDash([5, 4]);
      } else {
        targetCtx.setLineDash([]);
      }

      targetCtx.strokeStyle = hexToRgba(ringColor, waveAlpha);
      targetCtx.stroke();

      // Crisp inner highlight ring on wave 1
      if (idx === 0 && wp < 0.6) {
        const innerHighlightAlpha = waveAlpha * 0.45;
        targetCtx.beginPath();
        targetCtx.arc(x, y, Math.max(1, r - 1.5), 0, Math.PI * 2);
        targetCtx.strokeStyle = hexToRgba('#ffffff', innerHighlightAlpha);
        targetCtx.lineWidth = 1;
        targetCtx.stroke();
      }
    });
  }

  targetCtx.shadowBlur = 0;
  targetCtx.setLineDash([]);

  // 2. Central Focal Anchor / Glow Orb (for 'ripple', 'both', 'orb')
  const anchorDecay = Math.pow(Math.max(0, 1 - t / 0.55), 1.8);
  const anchorAlpha = anchorDecay * config.alpha;

  if (anchorAlpha > 0.02) {
    const isOrbDominant = (style === 'orb' || style === 'both');
    const orbRadius = isOrbDominant
      ? (26 * config.stroke * (0.8 + (1 - t) * 0.4))
      : (12 * config.stroke * (0.7 + (1 - t) * 0.5));

    // Radial gradient glow
    const anchorGrad = targetCtx.createRadialGradient(x, y, 0, x, y, Math.max(1, orbRadius));
    anchorGrad.addColorStop(0, hexToRgba('#ffffff', Math.min(1, anchorAlpha * 1.3)));
    anchorGrad.addColorStop(0.3, hexToRgba(ringColor, anchorAlpha * 0.95));
    anchorGrad.addColorStop(0.7, hexToRgba(ringColor, anchorAlpha * 0.4));
    anchorGrad.addColorStop(1, hexToRgba(ringColor, 0));

    targetCtx.beginPath();
    targetCtx.arc(x, y, Math.max(1, orbRadius), 0, Math.PI * 2);
    targetCtx.fillStyle = anchorGrad;
    targetCtx.fill();

    // Crisp central focal pip
    const pipRadius = Math.max(1.5, orbRadius * 0.25);
    targetCtx.beginPath();
    targetCtx.arc(x, y, pipRadius, 0, Math.PI * 2);
    targetCtx.fillStyle = hexToRgba('#ffffff', Math.min(1, anchorAlpha * 1.4));
    targetCtx.fill();
  }

  // 3. Right-Click Distinctive Badge (viewers see exactly what's pressed)
  if (isRightClick && t < 0.6) {
    const rcAlpha = Math.min(1, (1 - t / 0.6)) * 0.9 * config.alpha;
    targetCtx.save();
    targetCtx.fillStyle = hexToRgba('#f59e0b', rcAlpha);
    targetCtx.strokeStyle = hexToRgba('#ffffff', rcAlpha * 0.9);
    targetCtx.lineWidth = 1;
    targetCtx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    targetCtx.textAlign = 'center';
    targetCtx.textBaseline = 'middle';

    const badgeY = y - 18 - (1 - Math.pow(1 - t, 2)) * 6;
    const badgeW = 16;
    const badgeH = 13;
    const badgeR = 3;

    targetCtx.beginPath();
    if (typeof targetCtx.roundRect === 'function') {
      targetCtx.roundRect(x - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH, badgeR);
    } else {
      targetCtx.rect(x - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH);
    }
    targetCtx.fill();
    targetCtx.stroke();

    targetCtx.fillStyle = hexToRgba('#111827', rcAlpha);
    targetCtx.fillText('R', x, badgeY + 0.5);
    targetCtx.restore();
  }

  targetCtx.restore();
}

// Backward-compatibility wrapper for any legacy callers
function drawOrbClick(x, y, progress) {
  drawRippleOnContext(ctx, x, y, progress, null, {
    style: settings.clickStyle || 'ripple',
    waves: settings.clickWaves || 'double',
    force: settings.clickForce || 'moderate',
    color: settings.customClickColor || clickColors[settings.clickColor] || '#ffffff'
  });
}

/**
 * Interactive Live Ripple Sandbox in sidebar
 * Lets users immediately click or right-click to test waves and styling
 */
function setupRippleSandbox() {
  const testArea = document.getElementById('rippleTestArea');
  const canvas = document.getElementById('rippleTestCanvas');
  if (!testArea || !canvas) return;

  const testCtx = canvas.getContext('2d');
  let activeSandboxClicks = [];
  let sandboxAnimId = null;

  function resizeCanvas() {
    const rect = testArea.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width || 400;
    const h = rect.height || 110;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (testCtx.resetTransform) {
      testCtx.resetTransform();
    } else {
      testCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    testCtx.scale(dpr, dpr);
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function triggerSandboxClick(e) {
    e.preventDefault();
    const rect = testArea.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const button = e.button; // 0: left, 1: middle, 2: right
    const buttonType = button === 2 ? 'right' : (button === 1 ? 'middle' : 'left');

    const clickObj = {
      timestamp: performance.now(),
      x,
      y,
      button,
      buttonType,
      type: 'click'
    };

    activeSandboxClicks.push(clickObj);

    const placeholder = testArea.querySelector('.ripple-test-placeholder');
    if (placeholder) {
      placeholder.style.opacity = '0.25';
    }

    if (!sandboxAnimId) {
      animateSandbox();
    }
  }

  testArea.addEventListener('click', triggerSandboxClick);
  testArea.addEventListener('contextmenu', triggerSandboxClick);

  function animateSandbox() {
    const now = performance.now();
    const totalWindow = 600;
    const previewBeforeMs = 80;

    const rect = testArea.getBoundingClientRect();
    testCtx.clearRect(0, 0, rect.width, rect.height);

    activeSandboxClicks = activeSandboxClicks.filter(c => (now - c.timestamp) < (totalWindow - previewBeforeMs));

    if (activeSandboxClicks.length === 0) {
      sandboxAnimId = null;
      const placeholder = testArea.querySelector('.ripple-test-placeholder');
      if (placeholder) placeholder.style.opacity = '1';
      return;
    }

    const activeColor = settings.customClickColor || clickColors[settings.clickColor] || '#ffffff';

    activeSandboxClicks.forEach(c => {
      const elapsed = now - c.timestamp;
      const progress = (elapsed + previewBeforeMs) / totalWindow;

      drawRippleOnContext(testCtx, c.x, c.y, progress, c, {
        style: settings.clickStyle || 'ripple',
        waves: settings.clickWaves || 'double',
        force: settings.clickForce || 'moderate',
        color: activeColor
      });
    });

    sandboxAnimId = requestAnimationFrame(animateSandbox);
  }
}

// Show export modal
function exportVideo(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

  try {
    const modal = document.getElementById('exportModal');
    if (!modal) {
      console.error('[Editor] exportModal not found in DOM');
      return;
    }

    const resSelect = document.getElementById('exportResolution');
    if (resSelect && (!resSelect.value || resSelect.value === '1080p')) {
      const w = (typeof videoWidth === 'number' && videoWidth > 0) ? videoWidth : (video?.videoWidth || 1920);
      const h = (typeof videoHeight === 'number' && videoHeight > 0) ? videoHeight : (video?.videoHeight || 1080);
      if (w >= 2560 || h >= 1440) {
        resSelect.value = '4k';
      }
    }

    modal.classList.remove('hidden');
    modal.style.cssText = 'position: fixed !important; inset: 0 !important; z-index: 999999 !important; display: flex !important; align-items: center !important; justify-content: center !important; background: rgba(3, 4, 8, 0.78) !important;';

    const content = modal.querySelector('.modal-content');
    if (content) {
      content.style.cssText = 'position: relative !important; z-index: 1000000 !important; display: block !important;';
    }

    console.log('[Editor] Export modal opened');

    updateExportEstimate();
  } catch (err) {
    console.error('[Editor] Error opening export modal:', err);
  }
}

if (typeof window !== 'undefined') {
  window.exportVideo = exportVideo;
}

// Track if export is processing
let isExportProcessing = false;

// Setup export modal events
function setupExportModal() {
  const modal = document.getElementById('exportModal');
  const closeBtn = document.getElementById('closeExportModal');
  const cancelBtn = document.getElementById('cancelExport');
  const confirmBtn = document.getElementById('confirmExport');
  const resolutionSelect = document.getElementById('exportResolution');
  const formatSelect = document.getElementById('exportFormat');
  const qualitySelect = document.getElementById('exportQuality');
  const backdrop = modal?.querySelector('.modal-backdrop');

  const closeModal = () => {
    // Don't allow closing while processing
    if (isExportProcessing) {
      return;
    }
    modal?.classList.add('hidden');
    if (modal) modal.style.display = 'none';
  };

  closeBtn?.addEventListener('click', (e) => {
    e?.stopPropagation();
    closeModal();
  });
  cancelBtn?.addEventListener('click', (e) => {
    e?.stopPropagation();
    closeModal();
  });

  // Only allow backdrop click to close if not processing
  backdrop?.addEventListener('click', (e) => {
    if (!isExportProcessing && e.target === backdrop) {
      closeModal();
    }
  });

  resolutionSelect?.addEventListener('change', updateExportEstimate);
  formatSelect?.addEventListener('change', updateExportEstimate);
  qualitySelect?.addEventListener('change', updateExportEstimate);

  confirmBtn?.addEventListener('click', (e) => {
    doExport();
  });
}

function updateExportEstimate() {
  // This function is no longer needed since we removed the estimate text
  // Keeping it for compatibility but it does nothing
}

// Centralized Discord Support & Feature Requests Invite URL
const DISCORD_INVITE_URL = 'https://discord.gg/gwATujg6yq';
if (typeof window !== 'undefined') {
  window.DISCORD_INVITE_URL = DISCORD_INVITE_URL;
}

function syncEditorDiscordLinks() {
  document.querySelectorAll('[data-discord-link="true"]').forEach((el) => {
    el.setAttribute('href', DISCORD_INVITE_URL);
  });
}

function getRuntimeEnvSummary() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  let browserName = 'Chromium';
  if (/edg\//i.test(ua)) browserName = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browserName = 'Opera';
  else if (/yabrowser\//i.test(ua)) browserName = 'Yandex';
  else if (/vivaldi\//i.test(ua)) browserName = 'Vivaldi';
  else if (/brave/i.test(ua) || (typeof navigator !== 'undefined' && navigator.brave)) browserName = 'Brave';
  else if (/arc\//i.test(ua)) browserName = 'Arc';
  else if (/chrome/i.test(ua)) browserName = 'Chrome';
  const plat = (typeof navigator !== 'undefined' && (navigator.userAgentData?.platform || navigator.platform)) || '';
  const osLabel = /mac|darwin/i.test(plat) || /macintosh/i.test(ua)
    ? 'macOS'
    : (/win/i.test(plat) || /windows/i.test(ua) ? 'Windows' : (/linux/i.test(plat) || /linux/i.test(ua) ? 'Linux' : 'Desktop'));
  return { browserName, osLabel };
}

function showDiscordModal(options = {}) {
  const modal = document.getElementById('discordModal');
  if (!modal) return;
  syncEditorDiscordLinks();

  const mode = options.mode || 'support'; // 'milestone' | 'crash' | 'support'
  const isCrash = mode === 'crash';
  const banner = document.getElementById('discordModalBanner');
  const badge = document.getElementById('discordModalBadge');
  const title = document.getElementById('discordModalTitle');
  const subtitle = document.getElementById('discordModalSubtitle');
  const exportSummaryBox = document.getElementById('discordExportSummary');
  const exportFileEl = document.getElementById('discordExportFileName');
  const exportMetaEl = document.getElementById('discordExportMeta');
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
    if (isCrash) {
      badge.textContent = 'Issue Detected — Instant Support';
    } else if (mode === 'milestone') {
      const cnt = options.exportCount || 3;
      badge.textContent = `Creator Milestone • Download #${cnt}`;
    } else {
      badge.textContent = 'CursorDemo Community';
    }
  }

  if (title) {
    title.textContent = options.title || (isCrash
      ? 'Something Crashed or Didn\'t Work? Join Our Discord!'
      : 'Join our Discord for Support & Feature Requests');
  }

  if (subtitle) {
    subtitle.textContent = options.subtitle || (isCrash
      ? 'We detected an unexpected issue in Studio Editor. Join our Discord for fast troubleshooting and fixes from the team.'
      : 'Chat directly with the developers, get fast troubleshooting, and vote on upcoming studio features.');
  }

  if (joinBtnText) {
    joinBtnText.textContent = isCrash
      ? 'Join Discord for Instant Support & Fixes →'
      : 'Join Discord for Support & Feature Requests →';
  }

  if (exportSummaryBox) {
    if (!isCrash && options.fileName) {
      exportSummaryBox.classList.remove('hidden');
      if (exportFileEl) {
        exportFileEl.textContent = options.fileName;
        exportFileEl.setAttribute('title', options.fileName);
      }
      if (exportMetaEl) {
        const cntTag = `Export #${options.exportCount || 3}`;
        const fmtTag = (options.format || 'MP4').toUpperCase();
        const resTag = (options.width >= 3840 || options.height >= 2160)
          ? '4K'
          : (options.width >= 2560 || options.height >= 1440)
            ? '2K'
            : `${options.height || 1080}p`;
        const sizeTag = options.sizeMB ? ` • ${options.sizeMB} MB` : '';
        exportMetaEl.textContent = `${cntTag} • ${resTag} • ${fmtTag}${sizeTag}`;
      }
    } else {
      exportSummaryBox.classList.add('hidden');
    }
  }

  if (crashBox) {
    if (isCrash) {
      crashBox.classList.remove('hidden');
      if (crashTitle) {
        crashTitle.textContent = options.reason
          ? `Diagnostic Report (${options.reason})`
          : 'Issue Detected — Diagnostic Info';
      }
      if (crashSummary) {
        crashSummary.textContent = options.summary || options.error ||
          'Something crashed or didn\'t work as expected. Copy the details below and share them in our Discord #support channel for a quick fix.';
      }
      if (crashDetails) {
        const env = getRuntimeEnvSummary();
        const diagLines = [
          options.details || options.error || options.summary || 'Unexpected editor error',
          `Browser: ${env.browserName} (${env.osLabel})`,
          `Video: ${videoWidth || 1920}x${videoHeight || 1080}, Surface: ${displaySurface || 'unknown'}, Cursor pts: ${(cursorData && cursorData.length) || 0}`,
          `Timestamp: ${new Date().toISOString()}`
        ];
        crashDetails.textContent = diagLines.join('\n');
      }
    } else {
      crashBox.classList.add('hidden');
    }
  }

  if (feedbackInput) {
    feedbackInput.value = options.prefillFeedback || '';
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
    } catch (_) { }
  }
}

let _editorCrashModalShown = false;

function setupDiscordModal() {
  syncEditorDiscordLinks();
  const modal = document.getElementById('discordModal');
  if (!modal) return;

  document.getElementById('closeDiscordModal')?.addEventListener('click', () => closeDiscordModal(false));
  document.getElementById('discordModalBackdrop')?.addEventListener('click', () => closeDiscordModal(false));
  document.getElementById('discordMaybeLaterBtn')?.addEventListener('click', () => closeDiscordModal(false));
  document.getElementById('discordDontAskBtn')?.addEventListener('click', () => closeDiscordModal(true));

  const copyBtn = document.getElementById('discordCopyErrorBtn');
  copyBtn?.addEventListener('click', async () => {
    const detailsEl = document.getElementById('discordCrashDetails');
    const feedbackEl = document.getElementById('discordFeedbackInput');
    const payload = [
      detailsEl ? detailsEl.textContent : '',
      feedbackEl && feedbackEl.value.trim() ? `\nUser Note:\n${feedbackEl.value.trim()}` : ''
    ].filter(Boolean).join('\n');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(payload);
      }
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy Error Details';
      }, 2000);
    } catch (_) { }
  });

  document.getElementById('discordModalJoinBtn')?.addEventListener('click', () => {
    const detailsEl = document.getElementById('discordCrashDetails');
    const feedbackEl = document.getElementById('discordFeedbackInput');
    const combined = [
      feedbackEl && feedbackEl.value.trim() ? feedbackEl.value.trim() : '',
      detailsEl && !document.getElementById('discordCrashBox')?.classList.contains('hidden') ? detailsEl.textContent : ''
    ].filter(Boolean).join('\n\n');
    if (combined) {
      try {
        localStorage.setItem('cursordemo.lastDiscordNote', combined);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(combined).catch(() => { });
        }
      } catch (_) { }
    }
    setTimeout(() => {
      closeDiscordModal(false);
      showToast('Opening CursorDemo Discord — welcome!');
    }, 150);
  });

  // Check if a previous export crashed or was interrupted before completing
  try {
    const staleExport = localStorage.getItem('cursordemo.exportInProgress');
    if (staleExport) {
      localStorage.removeItem('cursordemo.exportInProgress');
      let parsed = null;
      try { parsed = JSON.parse(staleExport); } catch (_) { }
      setTimeout(() => {
        showDiscordModal({
          mode: 'crash',
          reason: 'interrupted-export',
          title: 'Previous Export Interrupted — Need Support?',
          summary: 'It looks like your last video export crashed or closed before finishing. Try a lower resolution/WebM format, or join our Discord for help.',
          details: `Interrupted Export: ${parsed ? `${parsed.resolution || ''} ${parsed.format || ''}` : 'unknown'} at ${parsed?.startedAt ? new Date(parsed.startedAt).toISOString() : 'previous session'}`
        });
      }, 450);
    }
  } catch (_) { }

  // Global uncaught error & unhandled rejection fallback in Studio Editor
  window.addEventListener('error', (event) => {
    const msg = event?.message || '';
    if (!msg || msg.includes('ResizeObserver')) return;
    if (_editorCrashModalShown) return;
    _editorCrashModalShown = true;
    showDiscordModal({
      mode: 'crash',
      reason: 'editor-runtime-error',
      summary: 'Something crashed or didn\'t work as expected in Studio Editor. Join our Discord for instant troubleshooting.',
      details: `Error: ${msg}\nSource: ${event?.filename || 'editor.js'}:${event?.lineno || 0}`
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const msg = event?.reason?.message || String(event?.reason || '');
    if (!msg || msg.includes('AbortError')) return;
    if (_editorCrashModalShown) return;
    _editorCrashModalShown = true;
    showDiscordModal({
      mode: 'crash',
      reason: 'editor-unhandled-rejection',
      summary: 'An asynchronous studio operation failed unexpectedly. Join our Discord community for instant help.',
      details: `UnhandledRejection: ${msg}`
    });
  });
}

if (typeof window !== 'undefined') {
  window.showDiscordModal = showDiscordModal;
  window.closeDiscordModal = closeDiscordModal;
}

let selectedReviewRating = 5;

const REVIEW_RATING_CAPTIONS = {
  5: '5/5 — Love CursorDemo Studio!',
  4: '4/5 — Great screen recorder!',
  3: '3/5 — Good, could be even better',
  2: '2/5 — Had some issues',
  1: '1/5 — Needs improvement'
};

function getChromeStoreReviewUrl() {
  let extId = 'YOUR_EXTENSION_ID';
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.id === 'string' && chrome.runtime.id.trim()) {
      extId = chrome.runtime.id.trim();
    }
  } catch (_) { }
  return `https://chromewebstore.google.com/detail/cursordemo-screen-recorder/${extId}/reviews`;
}

function getFeedbackIssueUrl(rating) {
  const base = 'https://github.com/cursordemo/cursordemo-screen-recorder/issues';
  const feedbackInput = document.getElementById('reviewFeedbackInput');
  const text = feedbackInput && typeof feedbackInput.value === 'string' ? feedbackInput.value.trim() : '';
  if (!text) return base;
  const title = encodeURIComponent(`[Feedback ${rating}/5] ${text.slice(0, 64)}`);
  const body = encodeURIComponent(`**Rating:** ${rating}/5\n\n**Feedback / Feature Request:**\n${text}`);
  return `${base}/new?title=${title}&body=${body}`;
}

function updateReviewModalRatingUI(rating) {
  const stars = document.querySelectorAll('#reviewStarsContainer .review-star-btn');
  const caption = document.getElementById('reviewRatingCaption');
  const feedbackWrap = document.getElementById('reviewFeedbackWrap');
  const ctaBtn = document.getElementById('reviewModalCtaBtn');

  stars.forEach((btn) => {
    const btnRating = parseInt(btn.getAttribute('data-rating') || '5', 10);
    const isActive = btnRating <= rating;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });

  if (caption) {
    caption.textContent = REVIEW_RATING_CAPTIONS[rating] || REVIEW_RATING_CAPTIONS[5];
  }

  if (feedbackWrap) {
    feedbackWrap.classList.toggle('hidden', rating >= 4);
  }

  if (ctaBtn) {
    if (rating >= 4) {
      ctaBtn.innerHTML = `${studioIcon('star', 16)} Leave a Quick Chrome Web Store Review →`;
      ctaBtn.setAttribute('href', getChromeStoreReviewUrl());
    } else {
      ctaBtn.textContent = 'Share Feedback & Suggestions →';
      ctaBtn.setAttribute('href', getFeedbackIssueUrl(rating));
    }
  }
}

function showPostDownloadModal(summary = {}) {
  const modal = document.getElementById('reviewModal');
  if (!modal) return;

  const fileNameEl = document.getElementById('reviewExportFileName');
  const metaEl = document.getElementById('reviewExportMeta');
  const subtitleEl = document.getElementById('reviewModalSubtitle');
  const feedbackInput = document.getElementById('reviewFeedbackInput');

  if (feedbackInput) {
    feedbackInput.value = '';
  }

  if (fileNameEl && summary.fileName) {
    fileNameEl.textContent = summary.fileName;
    fileNameEl.setAttribute('title', summary.fileName);
  }

  if (metaEl) {
    const resTag = (summary.width >= 3840 || summary.height >= 2160)
      ? '4K Ultra HD'
      : (summary.width >= 2560 || summary.height >= 1440)
        ? '2K QHD'
        : (summary.width >= 1920 || summary.height >= 1080)
          ? '1080p HD'
          : `${summary.width || 1920}×${summary.height || 1080}`;
    const fmtTag = (summary.format || 'MP4').toUpperCase();
    const fpsTag = `${summary.fps || 60} FPS`;
    const sizeTag = summary.sizeMB ? ` • ${summary.sizeMB} MB` : '';
    metaEl.textContent = `${resTag} • ${fmtTag} • ${fpsTag}${sizeTag}`;
  }

  if (subtitleEl) {
    const count = summary.exportCount || 1;
    subtitleEl.textContent = count === 1
      ? 'First studio video exported • Saved to Downloads'
      : `Saved to your computer • Export #${count} complete`;
  }

  selectedReviewRating = 5;
  updateReviewModalRatingUI(selectedReviewRating);
  modal.classList.remove('hidden');
}

function closePostDownloadModal(dismissPermanently = false) {
  const modal = document.getElementById('reviewModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  if (dismissPermanently) {
    try {
      localStorage.setItem('cursordemo.reviewPromptDismissed', 'true');
      localStorage.setItem('cursordemo.reviewPromptShown', 'true');
    } catch (_) { }
  }
}

function setupReviewModal() {
  const modal = document.getElementById('reviewModal');
  if (!modal) return;

  const closeBtn = document.getElementById('closeReviewModal');
  const backdrop = document.getElementById('reviewModalBackdrop');
  const maybeLaterBtn = document.getElementById('reviewMaybeLaterBtn');
  const dontAskBtn = document.getElementById('reviewDontAskBtn');
  const ctaBtn = document.getElementById('reviewModalCtaBtn');
  const exportAgainBtn = document.getElementById('reviewExportAgainBtn');
  const newRecordingBtn = document.getElementById('reviewNewRecordingBtn');
  const starsContainer = document.getElementById('reviewStarsContainer');
  const starBtns = document.querySelectorAll('#reviewStarsContainer .review-star-btn');
  const feedbackInput = document.getElementById('reviewFeedbackInput');

  starBtns.forEach((btn) => {
    btn.addEventListener('mouseenter', () => {
      const hoverRating = parseInt(btn.getAttribute('data-rating') || '5', 10);
      updateReviewModalRatingUI(hoverRating);
    });
    btn.addEventListener('click', () => {
      selectedReviewRating = parseInt(btn.getAttribute('data-rating') || '5', 10);
      updateReviewModalRatingUI(selectedReviewRating);
    });
  });

  starsContainer?.addEventListener('mouseleave', () => {
    updateReviewModalRatingUI(selectedReviewRating);
  });

  feedbackInput?.addEventListener('input', () => {
    if (selectedReviewRating <= 3 && ctaBtn) {
      ctaBtn.setAttribute('href', getFeedbackIssueUrl(selectedReviewRating));
    }
  });

  closeBtn?.addEventListener('click', () => closePostDownloadModal(false));
  backdrop?.addEventListener('click', () => closePostDownloadModal(false));
  maybeLaterBtn?.addEventListener('click', () => closePostDownloadModal(false));
  dontAskBtn?.addEventListener('click', () => closePostDownloadModal(true));

  ctaBtn?.addEventListener('click', () => {
    if (feedbackInput && feedbackInput.value.trim()) {
      try {
        localStorage.setItem('cursordemo.lastUserFeedback', feedbackInput.value.trim());
      } catch (_) { }
      if (selectedReviewRating <= 3) {
        ctaBtn.setAttribute('href', getFeedbackIssueUrl(selectedReviewRating));
      }
    }
    setTimeout(() => {
      closePostDownloadModal(true);
      showToast('Thank you for supporting CursorDemo Studio!');
    }, 150);
  });

  exportAgainBtn?.addEventListener('click', () => {
    closePostDownloadModal(false);
    exportVideo();
  });

  newRecordingBtn?.addEventListener('click', () => {
    closePostDownloadModal(false);
    startNewRecording();
  });
}

async function doExport() {
  const modal = document.getElementById('exportModal');
  const confirmBtn = document.getElementById('confirmExport');
  const closeBtn = document.getElementById('closeExportModal');
  const cancelBtn = document.getElementById('cancelExport');
  const resolution = document.getElementById('exportResolution')?.value || '1080p';
  const format = document.getElementById('exportFormat')?.value || 'webm';
  const quality = document.getElementById('exportQuality')?.value || 'high';

  if (!processor || typeof processor.processVideo !== 'function') {
    console.error('[Editor] VideoProcessor not available');
    alert('Video processor not initialized. Please refresh the page.');
    return;
  }

  // Set processing flag to prevent modal dismissal
  isExportProcessing = true;

  // Pause preview video to avoid performance impact during export
  // The video processor uses its own separate video element
  if (video && !video.paused) {
    video.pause();
    isPlaying = false;
    updatePlayButton();
    debugLog('[Editor] Paused preview video for export');
  }

  // Disable close buttons during processing
  if (closeBtn) closeBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Initializing...';

    let blob = (currentVideoBlob && currentVideoBlob.size > 0) ? currentVideoBlob : null;
    if (!blob) {
      if (video && video.src && video.src.startsWith('blob:')) {
        try {
          blob = await fetch(video.src).then(r => r.blob());
        } catch (fetchErr) {
          debugLog('[Editor] fetch(video.src) failed, attempting fallback recovery:', fetchErr);
        }
      }
    }

    // Fallback recovery: if in-memory blob or blob URL failed/revoked, recover directly from IndexedDB
    if (!blob || blob.size === 0) {
      let vidId = currentVideoId;
      if (!vidId) {
        try {
          vidId = new URLSearchParams(window.location.search).get('videoId');
        } catch (_) { }
      }
      if (!vidId) {
        try {
          if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
            const st = await chrome.storage.local.get(['lastVideoMetadata']);
            vidId = st?.lastVideoMetadata?.videoId || null;
          }
        } catch (_) { }
      }
      if (vidId) {
        try {
          debugLog('[Editor] Recovering video blob from IndexedDB for ID:', vidId);
          const recovered = await retrieveVideoFromIndexedDB(vidId);
          if (recovered && recovered.size > 0) {
            blob = recovered;
            currentVideoBlob = recovered;
            debugLog('[Editor] Successfully recovered video blob from IndexedDB:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
          }
        } catch (idbErr) {
          console.warn('[Editor] IndexedDB recovery error:', idbErr);
        }
      }
    }

    if (!blob || blob.size === 0) {
      throw new Error('Video source is unavailable or empty. Please reload the recording.');
    }

    debugLog('[Editor] Video blob size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

    // Even width/height — fewer encoder artifacts (H.264 / VP9) at 1440p and 4K
    const snapEven = (n) => {
      const v = Math.max(2, Math.round(Number(n) || 0));
      return v - (v % 2);
    };

    const resolutions = {
      'original': { width: snapEven(videoWidth + (settings.background === 'hidden' ? 0 : ((settings.padding ?? 28) * 2))), height: snapEven(videoHeight + (settings.background === 'hidden' ? 0 : ((settings.padding ?? 28) * 2))) },
      '4k': { width: 3840, height: 2160 },
      '1440p': { width: 2560, height: 1440 },
      '1080p': { width: 1920, height: 1080 },
      '720p': { width: 1280, height: 720 },
      '480p': { width: 854, height: 480 }
    };

    const bitrates = {
      'maximum': 220000000, // 220 Mbps base for 1080p maximum (ultra master quality)
      'high': 150000000,    // 150 Mbps base for 1080p high
      'medium': 75000000,   // 75 Mbps base for 1080p medium
      'low': 40000000       // 40 Mbps base for 1080p low
    };

    const targetRes = resolutions[resolution] || resolutions['4k'] || resolutions['1080p'];
    const targetBitrate = bitrates[quality] || bitrates['maximum'];

    // Apply aspect ratio to export dimensions
    let exportWidth = targetRes.width;
    let exportHeight = targetRes.height;

    if (settings.aspectRatio === 'native') {
      if (resolution !== 'original') {
        const nativeAspect = videoWidth / videoHeight;
        if (nativeAspect >= 1) {
          exportHeight = snapEven(targetRes.height);
          exportWidth = snapEven(exportHeight * nativeAspect);
        } else {
          exportWidth = snapEven(targetRes.width);
          exportHeight = snapEven(exportWidth / nativeAspect);
        }
      }
    } else {
      // Calculate aspect ratio
      const [aspectW, aspectH] = settings.aspectRatio.split(':').map(Number);
      const targetAspectRatio = aspectW / aspectH;
      const currentAspectRatio = targetRes.width / targetRes.height;

      // Adjust dimensions to match selected aspect ratio
      // Maintain the dimension that results in higher total pixels (better quality)
      if (Math.abs(targetAspectRatio - currentAspectRatio) > 0.01) {
        // Calculate both options and choose the one with more pixels
        const option1Width = Math.round(targetRes.height * targetAspectRatio);
        const option1Height = targetRes.height;
        const option1Pixels = option1Width * option1Height;

        const option2Width = targetRes.width;
        const option2Height = Math.round(targetRes.width / targetAspectRatio);
        const option2Pixels = option2Width * option2Height;

        // Choose the option with more pixels (better quality)
        if (option1Pixels >= option2Pixels) {
          exportWidth = option1Width;
          exportHeight = option1Height;
        } else {
          exportWidth = option2Width;
          exportHeight = option2Height;
        }

        debugLog('[Editor] Applied aspect ratio', settings.aspectRatio, 'to export dimensions:',
          exportWidth, 'x', exportHeight, '(original:', targetRes.width, 'x', targetRes.height + ')');
      }
    }

    exportWidth = snapEven(exportWidth);
    exportHeight = snapEven(exportHeight);

    // Scale bitrate based on actual export resolution
    const scaleFactor = (exportWidth * exportHeight) / (1920 * 1080);
    let resolutionMultiplier = scaleFactor;
    if (resolution === '4k') {
      resolutionMultiplier = Math.max(scaleFactor, 4.5);
    }
    if (resolutionMultiplier < 0.5) {
      resolutionMultiplier = 0.5;
    }
    let finalBitrate = Math.round(targetBitrate * resolutionMultiplier);

    // Cap bitrate to browser-safe maximum based on format
    let MAX_SAFE_BITRATE = 250000000; // 250 Mbps default for VP9/WebM

    if (format === 'mp4') {
      MAX_SAFE_BITRATE = 200000000; // 200 Mbps for H.264/MP4 (high profile level 5.1/5.2)
    }

    if (finalBitrate > MAX_SAFE_BITRATE) {
      finalBitrate = MAX_SAFE_BITRATE;
    }

    // Ensure trim handles have valid values
    const trimStart = (trimHandles && isFinite(trimHandles.start)) ? trimHandles.start : 0;
    const trimEnd = (trimHandles && isFinite(trimHandles.end)) ? trimHandles.end : 1;

    debugLog('[Editor] Export settings:', {
      resolution,
      aspectRatio: settings.aspectRatio,
      format,
      quality,
      exportDimensions: { width: exportWidth, height: exportHeight },
      finalBitrate: (finalBitrate / 1000000).toFixed(1) + ' Mbps',
      trim: [trimStart, trimEnd]
    });

    const selectedFps = parseInt(document.getElementById('exportFps')?.value || '60');

    const exportSettings = {
      background: settings.backgroundImage || (backgrounds[settings.background] || backgrounds['grad-1']),
      backgroundImage: settings.backgroundImage, // Pass image separately for video processor
      padding: settings.background === 'hidden' ? 0 : (settings.padding ?? 28),
      borderRadius: settings.background === 'hidden' ? 0 : (settings.borderRadius ?? 14),
      trimStart: trimStart,
      trimEnd: trimEnd,
      clickEnabled: settings.clickEnabled !== false,
      clickStyle: (settings.clickEnabled === false) ? 'none' : (settings.clickStyle || 'ripple'),
      clickWaves: settings.clickWaves || 'double',
      clickColor: settings.customClickColor || clickColors[settings.clickColor] || '#ffffff',
      clickForce: settings.clickForce || 'moderate',
      showWebcam: Boolean(((cameraVideoLoaded && currentCameraBlob) || demoWebcamEnabled) && settings.showWebcam !== false),
      cameraBlob: (cameraVideoLoaded && currentCameraBlob && settings.showWebcam !== false) ? currentCameraBlob : null,
      demoWebcamEnabled: Boolean(demoWebcamEnabled && settings.showWebcam !== false),
      webcamPosition: settings.webcamPosition || 'bottom-right',
      webcamCustomX: Number.isFinite(settings.webcamCustomX) ? settings.webcamCustomX : null,
      webcamCustomY: Number.isFinite(settings.webcamCustomY) ? settings.webcamCustomY : null,
      webcamSize: settings.webcamSize || 'medium',
      webcamScale: settings.webcamScale ?? 1.0,
      webcamShape: settings.webcamShape || 'circular',
      webcamBorderStyle: settings.webcamBorderStyle || 'glow',
      webcamShadow: settings.webcamShadow !== false,
      webcamFlip: settings.webcamFlip !== false,
      webcamZoomMode: (settings.webcamZoomMode === 'floating') ? 'float' : (settings.webcamZoomMode || 'float'),
      blurRegions: Array.isArray(blurRegions) ? JSON.parse(JSON.stringify(blurRegions)) : [],
      cleanBrowser: settings.cleanBrowser !== false,
      showBrowserFrame: !settings.cleanBrowser,
      showMacWindowHeader: settings.showMacWindowHeader !== false,
      windowTitle: currentVideoTitle || 'CursorDemo Screen Recording',
      showShadow: settings.showShadow,
      outputWidth: exportWidth,
      outputHeight: exportHeight,
      bitrate: finalBitrate,
      format: format,
      quality: quality,
      fps: selectedFps,
      maxFps: selectedFps,
      sharpening: settings.sharpening !== false,
      antiAlias: true,
      knownDuration: getVideoDuration(),
      displaySurface: displaySurface,
      cameraStyle: settings.cameraStyle,
      adaptiveEdgeZoom: settings.adaptiveEdgeZoom !== false,
      cursorHighlight: !!settings.cursorHighlight,
      cursorHighlightStyle: settings.cursorHighlightStyle || 'halo',
      cursorHighlightColor: settings.cursorHighlightColor || '#ffab00',
      cursorHighlightSize: Number(settings.cursorHighlightSize) || 1.0,
      applyZoom: settings.applyZoom !== false,
      useWebCodecs: false
    };

    debugLog('[Editor] Starting export...');

    try {
      localStorage.setItem('cursordemo.exportInProgress', JSON.stringify({
        startedAt: Date.now(),
        resolution,
        format,
        width: exportWidth,
        height: exportHeight
      }));
    } catch (_) { }

    // Show export progress overlay
    const progressOverlay = document.getElementById('exportProgressOverlay');
    const progressFill = document.getElementById('exportProgressFill');
    const progressPct = document.getElementById('exportProgressPct');
    const progressStatus = document.getElementById('exportProgressStatus');

    // Close the export settings modal and show progress overlay
    modal.classList.add('hidden');
    if (modal) modal.style.display = 'none';
    if (progressOverlay) {
      progressOverlay.classList.remove('hidden');
      progressOverlay.style.display = 'flex';
    }

    const exportZoomSegments = settings.applyZoom ? zoomSegments : [];
    const processed = await processor.processVideo(
      blob,
      exportZoomSegments,
      function (progress) {
        const pct = Math.round(progress);
        confirmBtn.innerHTML = 'Processing ' + pct + '%';
        if (progressFill) progressFill.style.width = pct + '%';
        if (progressPct) progressPct.textContent = pct + '%';
        if (progressStatus) {
          if (pct < 30) progressStatus.textContent = 'Processing frames...';
          else if (pct < 60) progressStatus.textContent = 'Applying zoom & effects...';
          else if (pct < 90) progressStatus.textContent = 'Encoding video...';
          else progressStatus.textContent = 'Finalizing...';
        }
      },
      exportSettings,
      cursorData
    );

    debugLog('[Editor] Processing complete');

    if (!processed || !processed.size || processed.size === 0) {
      throw new Error('Exported video file is empty or corrupted (0 bytes).');
    }

    debugLog('[Editor] Output size:', (processed.size / 1024 / 1024).toFixed(2), 'MB');

    let mimeType = (processed && processed.type) ? processed.type : '';
    let fileExtension = mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';

    if (progressFill) progressFill.style.width = '100%';
    if (progressPct) progressPct.textContent = '100%';
    if (progressStatus) progressStatus.textContent = 'Saving your file...';
    confirmBtn.innerHTML = 'Saving...';
    const url = URL.createObjectURL(processed);
    const downloadFileName = `cursordemo-${Date.now()}.${fileExtension}`;
    const outputSizeMB = (processed.size / 1024 / 1024).toFixed(2);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up: revoke object URL after 60s so native "Save As" folder dialogs have plenty of time
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60000);

    if (progressStatus) progressStatus.textContent = 'Download started!';
    confirmBtn.innerHTML = `${studioIcon('check', 18)} Export Complete!`;

    try {
      localStorage.removeItem('cursordemo.exportInProgress');
    } catch (_) { }

    let exportCount = 1;
    let isReviewDismissed = false;
    let isDiscordDismissed = false;
    let discordPromptShown = false;
    try {
      exportCount = (parseInt(localStorage.getItem('cursordemo.exportCount') || localStorage.getItem('cursorfly.exportCount') || '0', 10) || 0) + 1;
      localStorage.setItem('cursordemo.exportCount', String(exportCount));
      isReviewDismissed = (
        localStorage.getItem('cursordemo.reviewPromptDismissed') === 'true' ||
        localStorage.getItem('cursorfly.reviewPromptDismissed') === 'true'
      );
      isDiscordDismissed = localStorage.getItem('cursordemo.discordPromptDismissed') === 'true';
      discordPromptShown = localStorage.getItem('cursordemo.discordPromptShown') === 'true';
      if (exportCount >= 1 && !isReviewDismissed) {
        localStorage.setItem('cursordemo.reviewPromptShown', 'true');
      }
      if (exportCount >= 3 && !isDiscordDismissed && !discordPromptShown) {
        localStorage.setItem('cursordemo.discordPromptShown', 'true');
      }
    } catch (err) { /* storage unavailable */ }

    const shouldShowDiscordMilestone = exportCount === 3 || (exportCount >= 3 && !isDiscordDismissed && !discordPromptShown);

    setTimeout(() => {
      // Re-enable close buttons and hide progress overlay
      isExportProcessing = false;
      if (closeBtn) closeBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
      if (progressOverlay) progressOverlay.classList.add('hidden');

      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `${studioIcon('export', 18)} Export`;

      if (shouldShowDiscordMilestone) {
        showDiscordModal({
          mode: 'milestone',
          exportCount,
          fileName: downloadFileName,
          format: fileExtension.toUpperCase(),
          width: exportWidth,
          height: exportHeight,
          fps: selectedFps,
          sizeMB: outputSizeMB
        });
      } else if (exportCount >= 1 && !isReviewDismissed) {
        showPostDownloadModal({
          fileName: downloadFileName,
          format: fileExtension.toUpperCase(),
          width: exportWidth,
          height: exportHeight,
          fps: selectedFps,
          sizeMB: outputSizeMB,
          exportCount
        });
      } else {
        showToast(`${studioIcon('check', 16)} Downloaded ${downloadFileName} (${outputSizeMB} MB)`);
      }
    }, 2000);

  } catch (e) {
    console.error('[Editor] Export error:', e);
    try {
      localStorage.removeItem('cursordemo.exportInProgress');
    } catch (_) { }

    // Re-enable close buttons on error
    isExportProcessing = false;
    if (closeBtn) closeBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;

    // Hide progress overlay on error
    const progressOverlay = document.getElementById('exportProgressOverlay');
    if (progressOverlay) progressOverlay.classList.add('hidden');

    const errText = (e && e.message) ? e.message : String(e || 'Unknown export error');
    let friendlyHint = 'Video export failed: ' + errText;
    if (errText.includes('VideoEncoder')) {
      friendlyHint += ' — Tip: Try WebM format or 1080p resolution.';
    } else if (errText.includes('duration')) {
      friendlyHint += ' — Tip: The video stream metadata may be incomplete.';
    }

    showDiscordModal({
      mode: 'crash',
      reason: 'export-failed',
      title: 'Export Failed or Crashed — Join Discord for Support',
      summary: friendlyHint,
      details: `ExportError (${resolution}, ${format}, ${quality}): ${errText}\n${e?.stack || ''}`
    });

    confirmBtn.disabled = false;
    confirmBtn.innerHTML = `${studioIcon('export', 18)} Export`;
  }
}

function uploadBackground() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = function (e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function (ev) {
        settings.backgroundImage = ev.target.result;
        settings.background = 'image'; // Set background type to image
        updateBackground();
      };
      reader.readAsDataURL(file);
    }
  };
  input.click();
}

window.addEventListener('beforeunload', function () {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
});

window.addEventListener('resize', function () {
  updateFrameSize();
  generateTimeMarkers();
  drawTimelineAudioWaveform();
});
