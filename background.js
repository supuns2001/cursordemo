/**
 * CursorDemo Screen Recorder
 * Copyright (c) 2026 CursorDemo Contributors
 * GitHub: https://github.com/cursordemo/cursordemo-screen-recorder
 *
 * Licensed under the MIT License.
 */

// Background Service Worker
let isRecording = false;
let isPaused = false;
let cursorData = [];
let recordingStartTime = 0;
let recordingTabId = null;
let storedVideoData = null;
let videoStoredInIndexedDB = false;
let recordedVideoWidth = 0;
let recordedVideoHeight = 0;
let recordedVideoDuration = 0;
let videoDataReady = false;
let cursorDataReady = false;
let cameraOverlayEnabled = false;
let injectInTabCameraOverlay = false;
let recordedCameraVideoId = null;
let recordedDisplaySurface = 'monitor';
let cameraFrameData = null; // Store latest camera frame from record.html
let previousRecordingTabId = null; // Track previous tab to remove overlay when switching

// Utility function to detect unsupported websites across all Chromium browsers
// (Chrome, Brave, Edge, Opera, Vivaldi, Yandex, Arc, Chromium)
function isUnsupportedWebsite(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();

  // Browser internal schemes across all Chromium variants
  const internalSchemes = [
    'chrome://',
    'chrome-extension://',
    'chrome-untrusted://',
    'chrome-search://',
    'devtools://',
    'edge://',
    'brave://',
    'opera://',
    'opr://',
    'vivaldi://',
    'browser://', // Yandex Browser internal scheme
    'yandex://',
    'arc://',
    'about:',
    'view-source:',
    'data:',
    'javascript:'
  ];
  for (const scheme of internalSchemes) {
    if (lower.startsWith(scheme)) return true;
  }

  // Extension web stores (scripting is blocked by browser security policy)
  if (lower.includes('chrome.google.com/webstore')) return true;
  if (lower.includes('chromewebstore.google.com')) return true;
  if (lower.includes('microsoftedge.microsoft.com/addons')) return true;
  if (lower.includes('addons.opera.com')) return true;
  if (lower.includes('browser.yandex.') && lower.includes('/addons')) return true;

  return false;
}

// Update extension icon to show recording state
async function updateRecordingIcon(recording, paused = false) {
  try {
    if (recording) {
      if (paused) {
        // Show paused state
        await chrome.action.setBadgeText({ text: '⏸' });
        await chrome.action.setBadgeBackgroundColor({ color: '#ffa500' }); // Orange
        await chrome.action.setTitle({ title: 'CursorDemo - Recording paused. Click to stop recording.' });
      } else {
        // Show active recording
        await chrome.action.setBadgeText({ text: '●' });
        await chrome.action.setBadgeBackgroundColor({ color: '#dc3545' }); // Red
        await chrome.action.setTitle({ title: 'CursorDemo - Recording in progress. Click to stop recording.' });
      }
    } else {
      // Clear badge and reset localized title
      const defaultTitle = (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function')
        ? (chrome.i18n.getMessage('extActionTitle') || chrome.i18n.getMessage('extTitle') || 'CursorDemo — Free Screen Recorder with Automatic Zoom')
        : 'CursorDemo — Free Screen Recorder with Automatic Zoom';
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: defaultTitle });
    }
  } catch (error) {
    console.warn('[Background] Could not update icon:', error);
  }
}

let stateInitPromise = null;

// Background throttled snapshot sync to prevent any data loss across worker lifecycles
let cursorSyncTimer = null;
function scheduleCursorStorageSync() {
  if (cursorSyncTimer) return;
  cursorSyncTimer = setTimeout(() => {
    cursorSyncTimer = null;
    if (isRecording && cursorData.length > 0) {
      // In very long recordings (>25,000 points), snapshot recent points to chrome.storage.local
      // Full array is kept in-memory and transferred directly to editor via IPC / IndexedDB
      const snapshot = (cursorData.length > 25000) ? cursorData.slice(-15000) : cursorData;
      chrome.storage.local.set({
        cursorData_snapshot: snapshot,
        cursorData_timestamp: Date.now(),
        recordingStartTime: recordingStartTime,
        lastKnownWindowMetrics: lastKnownWindowMetrics
      }).catch(() => {});
    }
  }, 5000);
}

// Unified cursor data processor (used by both persistent Port and one-off sendMessage)
let lastKnownWindowMetrics = null;
let activeMonitorSpanBg = null;
let cachedDisplaysBg = null;

const COMMON_DISPLAY_WIDTHS_BG = [
  3840, 3440, 3008, 2880, 2560, 1920, 1800, 1728, 1680, 1600, 1536, 1512, 1470, 1440, 1366, 1280
];
const TIER1_DISPLAY_WIDTHS_BG = new Set([3840, 3440, 2560, 1920, 1728, 1512, 1440]);
const DISPLAY_WIDTH_TO_HEIGHTS_BG = {
  3840: [2160, 2400],
  3440: [1440],
  3008: [1692],
  2880: [1800, 1620],
  2560: [1440, 1600, 1080],
  1920: [1080, 1200],
  1800: [1169],
  1728: [1117],
  1680: [1050],
  1600: [900, 1200],
  1536: [864, 960, 1024],
  1512: [982],
  1470: [956],
  1440: [900],
  1366: [768],
  1280: [720, 800]
};
const COMMON_DISPLAY_HEIGHTS_BG = [
  2400, 2160, 1800, 1692, 1600, 1440, 1200, 1117, 1080, 1050, 982, 900, 864, 800, 768, 720
];

function resolveMonitorOriginBg({
  screenWidth,
  screenHeight,
  availLeft,
  availTop,
  availWidth,
  availHeight,
  windowLeft,
  windowTop,
  outerWidth,
  outerHeight,
  monitorX,
  monitorY
}) {
  const sw = screenWidth > 0 ? screenWidth : 1920;
  const sh = screenHeight > 0 ? screenHeight : 1080;
  const winW = (outerWidth > 0 && outerWidth <= sw + 64) ? Math.min(outerWidth, sw) : 0;
  const winH = (outerHeight > 0 && outerHeight <= sh + 64) ? Math.min(outerHeight, sh) : 0;

  if (Array.isArray(cachedDisplaysBg) && cachedDisplaysBg.length > 0) {
    const refX = Number.isFinite(monitorX) ? monitorX : (Number.isFinite(windowLeft) ? windowLeft + winW * 0.5 : NaN);
    const refY = Number.isFinite(monitorY) ? monitorY : (Number.isFinite(windowTop) ? windowTop + winH * 0.5 : NaN);
    if (Number.isFinite(refX) && Number.isFinite(refY)) {
      for (const d of cachedDisplaysBg) {
        const b = d && d.bounds;
        if (b && refX >= b.left && refX < b.left + b.width && refY >= b.top && refY < b.top + b.height) {
          return { originX: b.left, originY: b.top };
        }
      }
    }
  }

  let minX = Number.isFinite(windowLeft) ? windowLeft : (Number.isFinite(monitorX) ? monitorX : 0);
  let maxX = minX + winW;
  if (Number.isFinite(monitorX) && Math.max(maxX, monitorX) - Math.min(minX, monitorX) <= sw + 16) {
    minX = Math.min(minX, monitorX);
    maxX = Math.max(maxX, monitorX);
  }

  let minY = Number.isFinite(windowTop) ? windowTop : (Number.isFinite(monitorY) ? monitorY : 0);
  let maxY = minY + winH;
  if (Number.isFinite(monitorY) && Math.max(maxY, monitorY) - Math.min(minY, monitorY) <= sh + 16) {
    minY = Math.min(minY, monitorY);
    maxY = Math.max(maxY, monitorY);
  }

  if (
    activeMonitorSpanBg &&
    activeMonitorSpanBg.sw === sw &&
    activeMonitorSpanBg.sh === sh &&
    Math.max(activeMonitorSpanBg.maxX, maxX) - Math.min(activeMonitorSpanBg.minX, minX) <= sw + 16 &&
    Math.max(activeMonitorSpanBg.maxY, maxY) - Math.min(activeMonitorSpanBg.minY, minY) <= sh + 16
  ) {
    activeMonitorSpanBg.minX = Math.min(activeMonitorSpanBg.minX, minX);
    activeMonitorSpanBg.maxX = Math.max(activeMonitorSpanBg.maxX, maxX);
    activeMonitorSpanBg.minY = Math.min(activeMonitorSpanBg.minY, minY);
    activeMonitorSpanBg.maxY = Math.max(activeMonitorSpanBg.maxY, maxY);
    minX = activeMonitorSpanBg.minX;
    maxX = activeMonitorSpanBg.maxX;
    minY = activeMonitorSpanBg.minY;
    maxY = activeMonitorSpanBg.maxY;
  } else {
    activeMonitorSpanBg = { sw, sh, minX, maxX, minY, maxY };
  }

  const minOriginX = maxX - sw;
  const maxOriginX = minX;
  const minOriginY = maxY - sh;
  const maxOriginY = minY;

  let originX = null;
  const hasAvailLeft = typeof availLeft === 'number' && Number.isFinite(availLeft);
  const dockW = (typeof availWidth === 'number' && availWidth > 0 && availWidth <= sw) ? (sw - availWidth) : 0;

  if (hasAvailLeft) {
    if (availLeft >= 0 && availLeft <= Math.max(dockW, 96) && 0 >= minOriginX - Math.max(dockW, 96) && 0 <= maxOriginX + 8) {
      originX = 0;
    } else if (dockW > 0 && ((Number.isFinite(monitorX) && monitorX < availLeft) || (Number.isFinite(windowLeft) && windowLeft < availLeft)) && (availLeft - dockW) >= minOriginX - 16 && (availLeft - dockW) <= maxOriginX + 16) {
      originX = availLeft - dockW;
    } else if (availLeft >= minOriginX - 32 && availLeft <= maxOriginX + 32) {
      originX = availLeft;
    }
  }

  if (originX === null) {
    if (0 >= minOriginX && 0 <= maxOriginX) {
      originX = 0;
    } else if (minX < 0 && -sw >= minOriginX - 16 && -sw <= maxOriginX + 16) {
      originX = -sw;
    } else {
      const gridX = Math.floor(minX / sw) * sw;
      const candSet = new Set();
      if (gridX !== 0 && gridX >= minOriginX - 8 && gridX <= maxOriginX + 8) candSet.add(gridX);
      for (const cw of COMMON_DISPLAY_WIDTHS_BG) {
        for (const c of [cw, -cw]) {
          if (c >= minOriginX - 8 && c <= maxOriginX + 8) candSet.add(c);
        }
      }
      if (Math.abs(minX) >= sw + 1200) {
        for (const cw1 of [3840, 3440, 2560, 1920, 1728, 1512, 1440]) {
          for (const cw2 of [3840, 3440, 2560, 1920, 1728, 1512, 1440]) {
            for (const c of [cw1 + cw2, -(cw1 + cw2)]) {
              if (c >= minOriginX - 8 && c <= maxOriginX + 8) candSet.add(c);
            }
          }
        }
      }
      const candidates = Array.from(candSet);
      if (candidates.length === 0) {
        originX = (maxOriginX - minOriginX <= 96)
          ? Math.max(minOriginX, Math.min(maxOriginX, minX))
          : Math.round((minOriginX + maxOriginX) * 0.5);
      } else if (candidates.length === 1) {
        originX = Math.max(minOriginX, Math.min(maxOriginX, candidates[0]));
      } else {
        const centerMidX = (minOriginX + maxOriginX) * 0.5;
        let bestC = candidates[0];
        let bestScore = Infinity;
        for (const c of candidates) {
          if ((c === gridX || TIER1_DISPLAY_WIDTHS_BG.has(Math.abs(c))) && Math.abs(minX - c) <= 8) {
            bestC = c;
            break;
          }
          if (c === gridX && Math.abs(maxX - (gridX + sw)) <= 12) {
            bestC = c;
            break;
          }
          const edgeDist = c >= 0 ? Math.max(0, minX - c) : Math.max(0, (c + sw) - maxX);
          const centerDist = Math.abs(c - centerMidX);
          const sameResBonus = (c === gridX) ? 160 : 0;
          const tier1Bonus = TIER1_DISPLAY_WIDTHS_BG.has(Math.abs(c)) ? 110 : 0;
          const subGridPenalty = (c > 0 && gridX > 0 && gridX >= minOriginX - 8 && gridX <= maxOriginX + 8 && c < gridX) ? 250 : 0;
          const score = edgeDist * 0.65 + centerDist * 0.35 - sameResBonus - tier1Bonus + subGridPenalty;
          if (score < bestScore) {
            bestScore = score;
            bestC = c;
          }
        }
        originX = Math.max(minOriginX, Math.min(maxOriginX, bestC));
      }
    }
  }

  let originY = null;
  const hasAvailTop = typeof availTop === 'number' && Number.isFinite(availTop);
  const dockH = (typeof availHeight === 'number' && availHeight > 0 && availHeight <= sh) ? (sh - availHeight) : 0;

  if (hasAvailTop) {
    if (availTop >= 0 && availTop <= Math.max(dockH, 64) && 0 >= minOriginY - Math.max(dockH, 64) && 0 <= maxOriginY + 8) {
      originY = 0;
    } else if (dockH > 0 && (availTop - dockH) >= minOriginY - 16 && (availTop - dockH) <= maxOriginY + 16 && (monitorY < availTop || windowTop < availTop)) {
      originY = availTop - dockH;
    } else if (availTop >= minOriginY - 32 && availTop <= maxOriginY + 32) {
      originY = availTop;
    }
  }

  if (originY === null) {
    if (0 >= minOriginY && 0 <= maxOriginY) {
      originY = 0;
    } else if (minY < 0 && originX === 0 && -sh >= minOriginY - 16 && -sh <= maxOriginY + 16) {
      originY = -sh;
    } else {
      const gridY = Math.floor(minY / sh) * sh;
      const candYMap = new Map();
      const addCandY = (val, bonus) => {
        if (val >= minOriginY - 8 && val <= maxOriginY + 8) {
          candYMap.set(val, Math.max(candYMap.get(val) || 0, bonus));
        }
      };
      if (gridY !== 0) addCandY(gridY, 70);
      addCandY(-sh, 65);
      const adjW = Math.abs(originX);
      const matchedHeights = DISPLAY_WIDTH_TO_HEIGHTS_BG[adjW] || [];
      for (const h of matchedHeights) {
        addCandY(h - sh, 90);
        addCandY(Math.round((h - sh) * 0.5), 75);
        addCandY(h, 80);
      }
      for (const h of COMMON_DISPLAY_HEIGHTS_BG) {
        addCandY(h - sh, 35);
        addCandY(Math.round((h - sh) * 0.5), 25);
        addCandY(h, 30);
      }
      if (candYMap.size === 0) {
        originY = (maxOriginY - minOriginY <= 120)
          ? Math.max(minOriginY, Math.min(maxOriginY, minY))
          : Math.round((minOriginY + maxOriginY) * 0.5);
      } else {
        const centerMidY = (minOriginY + maxOriginY) * 0.5;
        let bestCY = null;
        let bestScoreY = Infinity;
        for (const [cy, bonus] of candYMap.entries()) {
          if (Math.abs(minY - cy) <= 12 && bonus >= 65) {
            bestCY = cy;
            break;
          }
          const centerDist = Math.abs(cy - centerMidY);
          const topMargin = Math.max(0, minY - cy);
          const score = centerDist * 0.65 + topMargin * 0.35 - bonus;
          if (score < bestScoreY) {
            bestScoreY = score;
            bestCY = cy;
          }
        }
        originY = Math.max(minOriginY, Math.min(maxOriginY, bestCY));
      }
    }
  }

  return { originX, originY };
}

function reconcileCrossOriginCursorPoint(dataPoint, wm) {
  if (!dataPoint || !dataPoint.isCrossOriginSubframe || !wm) return;
  const rawSX = Number.isFinite(dataPoint.rawScreenX) ? dataPoint.rawScreenX : dataPoint.screenX;
  const rawSY = Number.isFinite(dataPoint.rawScreenY) ? dataPoint.rawScreenY : dataPoint.screenY;
  if (Number.isFinite(rawSX) && Number.isFinite(rawSY) && wm.outerWidth > 0 && wm.outerHeight > 0) {
    const winLeft = wm.screenX || 0;
    const winTop = wm.screenY || 0;
    const winX = Math.max(0, Math.min(wm.outerWidth, rawSX - winLeft));
    const winY = Math.max(0, Math.min(wm.outerHeight, rawSY - winTop));
    const topChrome = Math.max(0, Math.min(120, wm.topBarHeight !== undefined ? wm.topBarHeight : (wm.outerHeight - (wm.innerHeight || wm.outerHeight))));
    const leftChrome = (typeof wm.leftChromeWidth === 'number' && Number.isFinite(wm.leftChromeWidth))
      ? Math.max(0, Math.min(wm.outerWidth, wm.leftChromeWidth))
      : Math.max(0, Math.min(32, (wm.outerWidth - (wm.innerWidth || wm.outerWidth)) * 0.5));
    const tabW = wm.innerWidth || wm.outerWidth;
    const tabH = wm.innerHeight || Math.max(1, wm.outerHeight - topChrome);
    const tabX = Math.max(0, Math.min(tabW, winX - leftChrome));
    const tabY = Math.max(0, Math.min(tabH, winY - topChrome));

    dataPoint.x = tabX;
    dataPoint.y = tabY;
    dataPoint.windowX = winX;
    dataPoint.windowY = winY;
    dataPoint.viewportWidth = tabW;
    dataPoint.viewportHeight = tabH;
    dataPoint.normTabX = tabW > 0 ? Math.max(0, Math.min(1, tabX / tabW)) : 0.5;
    dataPoint.normTabY = tabH > 0 ? Math.max(0, Math.min(1, tabY / tabH)) : 0.5;
    dataPoint.normalizedX = dataPoint.normTabX;
    dataPoint.normalizedY = dataPoint.normTabY;
    dataPoint.normWindowX = Math.max(0, Math.min(1, winX / wm.outerWidth));
    dataPoint.normWindowY = Math.max(0, Math.min(1, winY / wm.outerHeight));

    const screenW = wm.screenWidth || 0;
    const screenH = wm.screenHeight || 0;
    if (screenW > 0 && screenH > 0) {
      const { originX: availLeft, originY: availTop } = resolveMonitorOriginBg({
        screenWidth: screenW,
        screenHeight: screenH,
        availLeft: wm.availLeft,
        availTop: wm.availTop,
        availWidth: wm.availWidth,
        availHeight: wm.availHeight,
        windowLeft: winLeft,
        windowTop: winTop,
        outerWidth: wm.outerWidth,
        outerHeight: wm.outerHeight,
        monitorX: rawSX,
        monitorY: rawSY
      });
      const localMonitorX = Math.max(0, Math.min(screenW, rawSX - availLeft));
      const localMonitorY = Math.max(0, Math.min(screenH, rawSY - availTop));
      dataPoint.screenX = localMonitorX;
      dataPoint.screenY = localMonitorY;
      dataPoint.normScreenX = Math.max(0, Math.min(1, localMonitorX / screenW));
      dataPoint.normScreenY = Math.max(0, Math.min(1, localMonitorY / screenH));
    }

    dataPoint.windowMetrics = wm;
    dataPoint._reconciledWithTopMetrics = true;
  }
}

function updateTopWindowMetrics(wm) {
  if (!wm || !(wm.outerWidth > 0) || !(wm.outerHeight > 0)) return;
  const prev = lastKnownWindowMetrics || {};
  // Do not let a synthetic chrome.windows.get fallback overwrite real content-script metrics
  if (wm._isFallback && prev.screenWidth > 0 && !prev._isFallback) {
    return;
  }
  const merged = {
    ...prev,
    ...wm,
    _isFallback: Boolean(wm._isFallback && (prev._isFallback !== false)),
    sideBorderWidth: 0,
    screenWidth: (wm.screenWidth > 0 ? wm.screenWidth : prev.screenWidth) || 0,
    screenHeight: (wm.screenHeight > 0 ? wm.screenHeight : prev.screenHeight) || 0,
    availWidth: (wm.availWidth > 0 ? wm.availWidth : prev.availWidth) || 0,
    availHeight: (wm.availHeight > 0 ? wm.availHeight : prev.availHeight) || 0,
    availLeft: (wm.availLeft !== undefined) ? wm.availLeft : prev.availLeft,
    availTop: (wm.availTop !== undefined) ? wm.availTop : prev.availTop,
    devicePixelRatio: (!wm._isFallback && wm.devicePixelRatio > 0)
      ? wm.devicePixelRatio
      : (prev.devicePixelRatio || wm.devicePixelRatio || 1)
  };
  lastKnownWindowMetrics = merged;
  if (cursorData.length > 0) {
    for (let i = 0; i < cursorData.length; i++) {
      const pt = cursorData[i];
      if (pt && pt.isCrossOriginSubframe && !pt._reconciledWithTopMetrics) {
        reconcileCrossOriginCursorPoint(pt, merged);
      }
    }
  }
}

async function seedWindowMetricsFromTab(tabId) {
  if (!tabId || !chrome.tabs?.get) return;
  try {
    if (chrome.system?.display?.getInfo) {
      chrome.system.display.getInfo().then((displays) => {
        if (Array.isArray(displays) && displays.length > 0) {
          cachedDisplaysBg = displays;
        }
      }).catch(() => {});
    }
    if (chrome.tabs?.sendMessage) {
      const resp = await chrome.tabs.sendMessage(tabId, { action: 'getWindowMetrics' }).catch(() => null);
      if (resp && resp.windowMetrics) {
        updateTopWindowMetrics(resp.windowMetrics);
        return;
      }
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    let win = null;
    if (tab.windowId !== undefined && chrome.windows?.get) {
      win = await chrome.windows.get(tab.windowId).catch(() => null);
    }
    if (!lastKnownWindowMetrics && (win || (tab.width && tab.height))) {
      const outerW = (win && win.width) || tab.width || 1920;
      const outerH = (win && win.height) || tab.height || 1080;
      const innerW = tab.width || outerW;
      const innerH = tab.height || outerH;
      updateTopWindowMetrics({
        _isFallback: true,
        screenX: (win && win.left) || 0,
        screenY: (win && win.top) || 0,
        outerWidth: outerW,
        outerHeight: outerH,
        innerWidth: innerW,
        innerHeight: innerH,
        topBarHeight: Math.max(0, Math.min(120, outerH - innerH)),
        devicePixelRatio: 1
      });
    }
  } catch (_) {}
}

if (typeof chrome !== 'undefined' && chrome.windows?.onBoundsChanged?.addListener) {
  chrome.windows.onBoundsChanged.addListener((win) => {
    if (!isRecording || !win || !(win.width > 0) || !(win.height > 0)) return;
    if (win.focused === false && lastKnownWindowMetrics) return;
    const prev = lastKnownWindowMetrics || {};
    const topChrome = prev.topBarHeight !== undefined ? prev.topBarHeight : Math.min(120, Math.round(win.height * 0.08));
    updateTopWindowMetrics({
      ...prev,
      screenX: (win.left !== undefined) ? win.left : (prev.screenX || 0),
      screenY: (win.top !== undefined) ? win.top : (prev.screenY || 0),
      outerWidth: win.width,
      outerHeight: win.height,
      innerWidth: (prev.outerWidth && prev.innerWidth)
        ? Math.max(1, win.width - Math.max(0, prev.outerWidth - prev.innerWidth))
        : win.width,
      innerHeight: Math.max(1, win.height - topChrome),
      topBarHeight: topChrome
    });
    if (recordingTabId) {
      seedWindowMetricsFromTab(recordingTabId);
    }
  });
}

function processCursorData(dataPoint) {
  if (!isRecording || isPaused || !dataPoint) return false;

  if (dataPoint.action === 'syncWindowMetrics' || dataPoint.type === 'windowMetricsSync') {
    if (dataPoint.windowMetrics && !dataPoint.isCrossOriginSubframe) {
      updateTopWindowMetrics(dataPoint.windowMetrics);
    }
    return true;
  }

  let effectiveStartTime = recordingStartTime;
  if (!effectiveStartTime || effectiveStartTime <= 0) {
    effectiveStartTime = Date.now();
    recordingStartTime = effectiveStartTime;
    chrome.storage.local.set({ recordingStartTime: effectiveStartTime }).catch(() => {});
  }

  const rawTs = dataPoint.timestamp || Date.now();
  const exactTimestamp = Math.max(0, rawTs - effectiveStartTime);

  if (dataPoint.windowMetrics && !dataPoint.isCrossOriginSubframe) {
    updateTopWindowMetrics(dataPoint.windowMetrics);
  } else if (lastKnownWindowMetrics) {
    dataPoint.windowMetrics = lastKnownWindowMetrics;
  }

  // If this event originated from a cross-origin iframe, reconcile its coordinates
  // against the top-level tab's windowMetrics so normTabX/Y and normWindowX/Y are exact.
  if (dataPoint.isCrossOriginSubframe && lastKnownWindowMetrics) {
    reconcileCrossOriginCursorPoint(dataPoint, lastKnownWindowMetrics);
  }

  const data = {
    ...dataPoint,
    timestamp: exactTimestamp
  };
  delete data.action;

  cursorData.push(data);

  if (dataPoint.type === 'click' || dataPoint.type === 'doubleclick') {
    console.log('[Background] 🖱️ Click #' + cursorData.filter(d => d.type === 'click').length + ' stored:', 
                'x:', data.x, 'y:', data.y,
                'normTab:', data.normTabX?.toFixed(3), data.normTabY?.toFixed(3),
                'normWindow:', data.normWindowX?.toFixed(3), data.normWindowY?.toFixed(3),
                'normScreen:', data.normScreenX?.toFixed(3), data.normScreenY?.toFixed(3),
                'timestamp:', data.timestamp);
  }

  scheduleCursorStorageSync();
  return true;
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // Handle camera frame updates from record.html
  if (message.action === 'updateCameraFrame') {
    // Store the latest camera frame from record.html
    cameraFrameData = message.frameData;
    // Broadcast to recording tab only if recording is active, in-tab overlay is enabled, and tab ID is set
    if (isRecording && cameraOverlayEnabled && injectInTabCameraOverlay && recordingTabId && cameraFrameData) {
      chrome.tabs.sendMessage(recordingTabId, {
        action: 'updateCameraFrame',
        frameData: cameraFrameData
      }).then(() => {
      }).catch((error) => {
        // Only log errors if recording is still active (avoid spam when recording stops)
        if (isRecording && cameraOverlayEnabled && injectInTabCameraOverlay) {
        }
      });
    }
    sendResponse({ success: true });
    return true;
  }
  
  // Handle requests for camera frame
  if (message.action === 'getCameraFrame') {
    sendResponse({ frameData: cameraFrameData });
    return true;
  }
  
  // New flow: Record page handles the stream, just need to track state
  if (message.action === 'startRecordingWithMediaStream') {
    console.log('[Background] startRecordingWithMediaStream called');
    console.log('[Background] tabId:', message.tabId, 'displaySurface:', message.displaySurface);
    
    // Update state
    isRecording = true;
    isPaused = false;
    cursorData = [];
    lastKnownWindowMetrics = null;
    recordingStartTime = Date.now();
    videoDataReady = false;
    cursorDataReady = false;
    storedVideoData = null;
    recordedCameraVideoId = null;
    videoStoredInIndexedDB = false;
    cameraFrameData = null;
    cameraOverlayEnabled = message.cameraOverlayEnabled || false;
    injectInTabCameraOverlay = Boolean(message.injectInTabCameraOverlay);
    recordedDisplaySurface = message.displaySurface || 'monitor';
    previousRecordingTabId = recordingTabId; // Store previous tab before updating
    recordingTabId = (message.tabId && !isNaN(message.tabId)) ? message.tabId : null;
    if (recordingTabId) {
      seedWindowMetricsFromTab(recordingTabId);
    } else {
      findBestTargetTabId().then((bestId) => {
        if (bestId && isRecording && !recordingTabId) {
          recordingTabId = bestId;
          chrome.storage.local.set({ recordingTabId: bestId }).catch(() => {});
          seedWindowMetricsFromTab(bestId);
        }
      }).catch(() => {});
    }

    // Ensure content script is injected and tracking across all open tabs in all windows
    // (critical for Window and Entire Screen capture modes)
    injectContentScriptToAllTabs().catch(() => {});
    
    chrome.storage.local.set({ 
      isRecording: true, 
      isPaused: false, 
      cameraOverlayEnabled: Boolean(cameraOverlayEnabled),
      injectInTabCameraOverlay: Boolean(injectInTabCameraOverlay),
      displaySurface: recordedDisplaySurface,
      recordingStartTime: recordingStartTime || Date.now(),
      recordingTabId: recordingTabId,
      cursorData_snapshot: []
    }).catch(err => {
      console.warn('[Background] Error saving start state to storage:', err);
    });
    
    // Update icon to show recording state
    updateRecordingIcon(true, false);
    
    // Inject fallback DOM camera overlay into the recording tab ONLY when requested
    // (By default, webcam is recorded as a separate synchronized stream and composited on top of Auto-Zoom in Editor/Export)
    if (cameraOverlayEnabled && injectInTabCameraOverlay) {
      // Remove overlay from previous tab if it exists
      if (previousRecordingTabId && previousRecordingTabId !== recordingTabId) {
        removeCameraOverlayFromTab(previousRecordingTabId);
      }
      
      // Inject immediately (no delay)
      injectCameraOverlayToRecordingTab(recordingTabId);
      
      // Send the latest frame immediately and repeatedly until confirmed (in case frames were sent before recordingTabId was set)
      if (cameraFrameData) {
        let attempts = 0;
        const maxAttempts = 10;
        const sendLatestFrame = () => {
          if (attempts < maxAttempts && isRecording && cameraOverlayEnabled && injectInTabCameraOverlay && recordingTabId) {
            chrome.tabs.sendMessage(recordingTabId, {
              action: 'updateCameraFrame',
              frameData: cameraFrameData
            }).then(() => {
              // Success - frame sent
            }).catch(() => {
              // Tab might not be ready yet, retry
              attempts++;
              setTimeout(sendLatestFrame, 200);
            });
          }
        };
        // Start sending after a short delay to ensure overlay is injected
        setTimeout(sendLatestFrame, 300);
      }
    } else {
      // Defensive cleanup: ensure no stale #cursordemo-camera-overlay remains on any tab
      removeCameraOverlayFromAllTabs().catch(() => {});
    }
    
    sendResponse({ success: true });
    return true;
  }
  
  // Update recording start time to sync with MediaRecorder start
  if (message.action === 'syncRecordingStartTime') {
    console.log('[Background] Syncing recording start time');
    // Preserve the most recent initial cursor move point at timestamp 0 so initial cursor
    // position and windowMetrics are not lost if the user doesn't move immediately after t=0
    const oldCursorData = cursorData.length;
    let initialPoint = null;
    for (let i = cursorData.length - 1; i >= 0; i--) {
      const pt = cursorData[i];
      if (pt && (pt.type === 'move' || pt.x !== undefined)) {
        initialPoint = {
          ...pt,
          type: 'move',
          timestamp: 0
        };
        break;
      }
    }
    cursorData = initialPoint ? [initialPoint] : [];
    recordingStartTime = Date.now();
    chrome.storage.local.set({
      recordingStartTime: recordingStartTime,
      cursorData_snapshot: cursorData
    }).catch(() => {});
    console.log('[Background] Recording start time synced, cleared', oldCursorData, 'early cursor data points (preserved initial point:', Boolean(initialPoint), ')');
    sendResponse({ success: true, newStartTime: recordingStartTime });
    return true;
  }
  
  // Legacy: Start recording with desktopCapture
  if (message.action === 'startRecording') {
    startRecording(message.tabId, message.settings)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.action === 'stopRecording') {
    stopRecording()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.action === 'pauseRecording') {
    pauseRecording()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.action === 'resumeRecording') {
    resumeRecording()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.action === 'cursorMove' || message.action === 'syncWindowMetrics') {
    const handleCursorMsg = () => {
      if (!isRecording) {
        sendResponse({ success: false, error: 'Not recording' });
        return;
      }
      if (isPaused) {
        sendResponse({ success: false, error: 'Recording paused' });
        return;
      }
      processCursorData(message);
      sendResponse({ success: true, cursorDataLength: cursorData.length });
    };
    if (!isRecording && stateInitPromise) {
      stateInitPromise.then(handleCursorMsg).catch(handleCursorMsg);
      return true;
    }
    handleCursorMsg();
    return;
  }
  
  if (message.action === 'recordingStopped') {
    console.log('[Background] Recording stopped, cursor data length:', cursorData.length);
    
    isRecording = false;
    isPaused = false;
    injectInTabCameraOverlay = false;
    cameraFrameData = null;
    const tabToCleanup = recordingTabId; // Store before clearing
    const previousTabToCleanup = previousRecordingTabId; // Store previous tab too
    recordingTabId = null;
    previousRecordingTabId = null;
    
    chrome.storage.local.set({ isRecording: false, isPaused: false, cameraOverlayEnabled: false, injectInTabCameraOverlay: false });
    
    // Remove camera overlay from all tabs and specifically from recording tab
    // Use Promise.all to ensure both complete
    Promise.all([
      removeCameraOverlayFromAllTabs(),
      tabToCleanup ? removeCameraOverlayFromTab(tabToCleanup) : Promise.resolve(),
      previousTabToCleanup ? removeCameraOverlayFromTab(previousTabToCleanup) : Promise.resolve()
    ]).then(() => {
    }).catch((error) => {
      console.warn('[Background] Error during overlay cleanup:', error);
    });
    
    // Update icon to clear recording state
    updateRecordingIcon(false);
    
    if (cursorSyncTimer) {
      clearTimeout(cursorSyncTimer);
      cursorSyncTimer = null;
    }
    saveCursorData();
    cursorDataReady = true;
    
    console.log('[Background] ✅ Recording stopped. Video ready:', videoDataReady, 'Cursor ready:', cursorDataReady);
    
    sendResponse({ success: true });
    return true; // Keep channel open for async operations
  }
  
  if (message.action === 'storeVideoBlob') {
    console.log('[Background] Storing video blob, size:', message.size);
    console.log('[Background] Video dimensions:', message.width, 'x', message.height, 'Duration:', message.duration);
    
    if (message.useIndexedDB && message.videoId) {
      // Large video stored in IndexedDB - store reference
      storedVideoData = message.videoId; // Store ID as reference
      videoStoredInIndexedDB = true;
      console.log('[Background] Video stored in IndexedDB with ID:', message.videoId);
    } else {
      // Small video - store data directly
      storedVideoData = message.videoData;
      videoStoredInIndexedDB = false;
    }
    
    recordedCameraVideoId = message.cameraVideoId || null;
    recordedVideoWidth = message.width || 1280;
    recordedVideoHeight = message.height || 720;
    recordedVideoDuration = message.duration || 0;
    recordedDisplaySurface = message.displaySurface || 'monitor';
    cameraOverlayEnabled = message.cameraOverlayEnabled || false;
    videoDataReady = true;
    console.log('[Background] ✅ Video data stored! Duration:', recordedVideoDuration, 'Surface:', recordedDisplaySurface);
    console.log('[Background] Camera overlay enabled:', cameraOverlayEnabled, 'cameraVideoId:', recordedCameraVideoId);

    // Persist session metadata to chrome.storage.local so editor can recover if SW restarts
    chrome.storage.local.set({
      lastVideoMetadata: {
        videoId: (message.useIndexedDB && message.videoId) ? message.videoId : null,
        cameraVideoId: recordedCameraVideoId,
        videoStoredInIndexedDB: !!(message.useIndexedDB && message.videoId),
        videoWidth: recordedVideoWidth,
        videoHeight: recordedVideoHeight,
        videoDuration: recordedVideoDuration,
        displaySurface: recordedDisplaySurface,
        cameraOverlayEnabled: cameraOverlayEnabled,
        timestamp: Date.now()
      }
    }).catch(() => {});

    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'getRecordingData') {
    (async () => {
      let finalCursorData = cursorData;
      let finalVideoData = storedVideoData;
      let finalCameraVideoId = recordedCameraVideoId;
      let finalVideoStoredInIndexedDB = videoStoredInIndexedDB;
      let finalWidth = recordedVideoWidth;
      let finalHeight = recordedVideoHeight;
      let finalDuration = recordedVideoDuration;
      let finalDisplaySurface = recordedDisplaySurface;
      let finalCamera = cameraOverlayEnabled;

      // Recover state from chrome.storage.local if SW restarted
      if (!finalVideoData || finalCursorData.length === 0) {
        try {
          const stored = await chrome.storage.local.get(['cursorData_snapshot', 'lastVideoMetadata']);
          if (stored.cursorData_snapshot && finalCursorData.length === 0) {
            finalCursorData = stored.cursorData_snapshot;
          }
          if (stored.lastVideoMetadata && !finalVideoData) {
            finalVideoData = stored.lastVideoMetadata.videoId;
            finalCameraVideoId = stored.lastVideoMetadata.cameraVideoId || null;
            finalVideoStoredInIndexedDB = stored.lastVideoMetadata.videoStoredInIndexedDB;
            finalWidth = stored.lastVideoMetadata.videoWidth;
            finalHeight = stored.lastVideoMetadata.videoHeight;
            finalDuration = stored.lastVideoMetadata.videoDuration || 0;
            finalDisplaySurface = stored.lastVideoMetadata.displaySurface || 'monitor';
            finalCamera = stored.lastVideoMetadata.cameraOverlayEnabled;
          }
        } catch (e) {}
      }

      const clicks = finalCursorData.filter(d => d.type === 'click' || d.type === 'doubleclick');
      console.log('[Background] getRecordingData: sending', finalCursorData.length, 'cursor events,', clicks.length, 'clicks, duration:', finalDuration);

      sendResponse({
        success: true,
        cursorData: finalCursorData,
        videoData: finalVideoData,
        cameraVideoId: finalCameraVideoId,
        videoWidth: finalWidth,
        videoHeight: finalHeight,
        displaySurface: finalDisplaySurface,
        duration: finalDuration,
        videoDataReady: !!finalVideoData,
        cursorDataReady: true,
        cameraOverlayEnabled: finalCamera,
        videoStoredInIndexedDB: finalVideoStoredInIndexedDB
      });
    })();
    return true;
  }
  
  if (message.action === 'getRecordingStatus') {
    sendResponse({
      isRecording: isRecording,
      isPaused: isPaused
    });
    return true;
  }
  
  // Shortcut triggered from content script: Alt+Shift+S to stop recording
  if (message.action === 'shortcutStopRecording') {
    console.log('[Background] Received shortcutStopRecording from content script');
    (async () => {
      const recordPageUrl = chrome.runtime.getURL('record.html');
      let notifiedRecordTab = false;
      try {
        const allTabs = await chrome.tabs.query({});
        const recordTabs = allTabs.filter(t => t.url && t.url.startsWith(recordPageUrl));
        for (const recordTab of recordTabs) {
          try {
            await chrome.tabs.sendMessage(recordTab.id, { action: 'recordingStopped' });
            notifiedRecordTab = true;
          } catch (_) {}
        }
      } catch (_) {}
      if (!notifiedRecordTab) {
        chrome.runtime.sendMessage({ action: 'recordingStopped' }).catch(() => {});
      }
    })();
    sendResponse({ success: true });
    return true;
  }

  // Shortcut triggered from content script: Alt+Shift+P to pause/resume recording
  if (message.action === 'shortcutTogglePause') {
    console.log('[Background] Received shortcutTogglePause from content script');
    if (isRecording) {
      if (isPaused) {
        resumeRecording();
      } else {
        pauseRecording();
      }
    }
    sendResponse({ success: true, isPaused: isPaused });
    return true;
  }

  // Handle navigation notification from content script
  if (message.action === 'pageNavigated' && isRecording && sender.tab?.id === recordingTabId) {
    console.log('[Background] Page navigation detected from content script');
    // The tab.onUpdated listener will handle re-injection, but we can also do it here
    reinjectContentScript(sender.tab.id).catch(() => {});
    sendResponse({ success: true });
    return true;
  }
  
  // Handle ping from content script
  if (message.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }
});

// Keep-alive heartbeat connection and cursor stream to keep Service Worker alive during recording in MV3
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'cursordemo-recorder-keepalive') {
    console.log('[Background] 💓 Keep-alive connection established from recorder');
    port.onMessage.addListener((msg) => {
      if (msg.action === 'ping') {
        port.postMessage({ action: 'pong', timestamp: Date.now() });
      }
    });
    port.onDisconnect.addListener(() => {
      console.log('[Background] Keep-alive port disconnected');
    });
  } else if (port.name === 'cursordemo-cursor-stream') {
    console.log('[Background] 🖱️ Cursor stream port connected from content script');
    port.onMessage.addListener((msg) => {
      if (msg && (msg.action === 'cursorMove' || msg.action === 'syncWindowMetrics' || msg.x !== undefined || msg.type)) {
        if (!isRecording && stateInitPromise) {
          stateInitPromise.then(() => processCursorData(msg)).catch(() => {});
        } else {
          processCursorData(msg);
        }
      }
    });
    port.onDisconnect.addListener(() => {
      console.log('[Background] Cursor stream port disconnected');
    });
  }
});

// Legacy: Start recording using desktopCapture
async function startRecording(tabId, settings) {
  try {
    console.log('[Background] startRecording called with tabId:', tabId);
    
    if (isRecording) {
      throw new Error('Recording already in progress');
    }
    
    const tab = await chrome.tabs.get(tabId);
    console.log('[Background] Got tab:', tab.id, tab.url);
    
    if (isUnsupportedWebsite(tab.url)) {
      throw new Error('Cannot record from Chrome system pages.');
    }
    
    console.log('[Background] Showing screen picker...');
    const streamId = await new Promise((resolve, reject) => {
      chrome.desktopCapture.chooseDesktopMedia(
        ['screen', 'window', 'tab'],
        tab,
        (streamId) => {
          if (!streamId) {
            reject(new Error('User cancelled screen capture'));
            return;
          }
          resolve(streamId);
        }
      );
    });
    
    if (!streamId) {
      throw new Error('No stream ID received');
    }
    
    console.log('[Background] Got streamId:', streamId);
    
    recordingTabId = tabId;
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['recorder.js']
      });
      console.log('[Background] Recorder script injected');
    } catch (error) {
      console.error('[Background] Failed to inject recorder script:', error);
      throw new Error('Failed to start recording: ' + error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'startRecordingInTab',
      streamId: streamId,
      settings: settings
    });
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to start recording in tab');
    }
    
    isRecording = true;
    isPaused = false;
    cursorData = [];
    lastKnownWindowMetrics = null;
    seedWindowMetricsFromTab(tabId);
    recordingStartTime = Date.now();
    videoDataReady = false;
    cursorDataReady = false;
    storedVideoData = null;
    videoStoredInIndexedDB = false;
    
    await chrome.storage.local.set({ isRecording: true, isPaused: false });
    
    // Update icon to show recording state
    updateRecordingIcon(true, false);
    
    if (settings.trackCursor) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          files: ['content.js']
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        await chrome.tabs.sendMessage(tabId, { action: 'startTracking' });
        console.log('[Background] Cursor tracking enabled');
      } catch (error) {
        console.warn('[Background] Could not enable cursor tracking:', error);
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('[Background] Error starting recording:', error);
    return { success: false, error: error.message };
  }
}

async function stopRecording() {
  try {
    console.log('[Background] Stopping recording...');
    
    if (!isRecording) {
      return { success: false, error: 'No active recording' };
    }
    
    if (recordingTabId) {
      try {
        const tab = await chrome.tabs.get(recordingTabId).catch(() => null);
        
        if (tab) {
          await chrome.tabs.sendMessage(recordingTabId, {
            action: 'stopRecordingInTab'
          });
          console.log('[Background] Stop message sent');
        } else {
          await handleRecordingStoppedLocally();
        }
      } catch (error) {
        console.warn('[Background] Could not communicate with tab:', error.message);
        await handleRecordingStoppedLocally();
      }
    } else {
      await handleRecordingStoppedLocally();
    }
    
    return { success: true };
  } catch (error) {
    console.error('[Background] Error stopping recording:', error);
    await handleRecordingStoppedLocally();
    return { success: true };
  }
}

async function handleRecordingStoppedLocally() {
  console.log('[Background] Handling recording stop locally');
  
  if (cursorData.length > 0) {
    await saveCursorData();
  }
  
  isRecording = false;
  isPaused = false;
  injectInTabCameraOverlay = false;
  cameraFrameData = null;
  const tabToCleanup = recordingTabId; // Store before clearing
  const previousTabToCleanup = previousRecordingTabId; // Store previous tab too
  recordingTabId = null;
  previousRecordingTabId = null;
  
  await chrome.storage.local.set({ isRecording: false, isPaused: false, cameraOverlayEnabled: false, injectInTabCameraOverlay: false });
  
  // Remove camera overlay from all tabs and specifically from recording tab
  await Promise.all([
    removeCameraOverlayFromAllTabs(),
    tabToCleanup ? removeCameraOverlayFromTab(tabToCleanup) : Promise.resolve(),
    previousTabToCleanup ? removeCameraOverlayFromTab(previousTabToCleanup) : Promise.resolve()
  ]).catch((error) => {
    console.warn('[Background] Error during overlay cleanup:', error);
  });
  
  
  // Update icon to clear recording state
  updateRecordingIcon(false);
}

async function pauseRecording() {
  if (isRecording && !isPaused && recordingTabId) {
    try {
      await chrome.tabs.sendMessage(recordingTabId, { action: 'pauseRecordingInTab' });
      isPaused = true;
      await chrome.storage.local.set({ isPaused: true });
      // Update icon to show paused state
      updateRecordingIcon(true, true);
    } catch (error) {
      isPaused = true;
      await chrome.storage.local.set({ isPaused: true });
      // Update icon to show paused state
      updateRecordingIcon(true, true);
    }
  }
}

async function resumeRecording() {
  if (isRecording && isPaused && recordingTabId) {
    try {
      await chrome.tabs.sendMessage(recordingTabId, { action: 'resumeRecordingInTab' });
      isPaused = false;
      await chrome.storage.local.set({ isPaused: false });
      // Update icon to show active recording state
      updateRecordingIcon(true, false);
    } catch (error) {
      isPaused = false;
      await chrome.storage.local.set({ isPaused: false });
      // Update icon to show active recording state
      updateRecordingIcon(true, false);
    }
  }
}

async function saveCursorData() {
  console.log('[Background] Cursor data ready for editor, length:', cursorData.length);
  try {
    await chrome.storage.local.set({
      cursorData_snapshot: cursorData,
      cursorData_ready: true,
      cursorData_timestamp: Date.now()
    });
    console.log('[Background] Successfully persisted cursorData_snapshot to chrome.storage.local');
  } catch (err) {
    console.warn('[Background] Failed to persist cursorData_snapshot:', err);
  }
}

// Inject camera overlay into the recording tab only when in-tab fallback overlay is explicitly enabled
async function injectCameraOverlayToRecordingTab(tabId) {
  try {
    if (!isRecording || !cameraOverlayEnabled || !injectInTabCameraOverlay) {
      return;
    }
    
    if (!tabId) {
      console.log('[Background] Invalid tab ID:', tabId);
      return;
    }
    
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      console.log('[Background] Recording tab not found:', tabId);
      return;
    }
    
    
    // Skip internal and restricted browser pages across all Chromium variants
    if (tab.url && isUnsupportedWebsite(tab.url)) {
      console.log('[Background] Cannot inject camera overlay into restricted page:', tab.url);
      return;
    }
    
    // Retry injection with minimal delays to ensure page is ready
    let injected = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Minimal wait - only on retries
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // Check if tab is still valid
        const currentTab = await chrome.tabs.get(tabId).catch(() => null);
        if (!currentTab) {
          console.log('[Background] Tab no longer exists:', tabId);
          return;
        }
        
        
        // Inject content script to show camera overlay
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: injectCameraOverlayScript,
          args: []
        });
        
        console.log('[Background] Camera overlay injected into recording tab:', tabId, '(attempt', attempt + 1 + ')');
        injected = true;
        
        
        break;
      } catch (error) {
        console.warn('[Background] Camera overlay injection attempt', attempt + 1, 'failed:', error.message);
        if (attempt === 2) {
        }
      }
    }
    
    if (injected) {
      // Listen for tab updates (navigation) to re-inject overlay (only add once)
      if (!chrome.tabs.onUpdated.hasListener(handleRecordingTabUpdateForCameraOverlay)) {
        chrome.tabs.onUpdated.addListener(handleRecordingTabUpdateForCameraOverlay);
      }
    }
  } catch (error) {
    console.error('[Background] Error injecting camera overlay:', error);
  }
}

// Handle recording tab updates (navigation) for camera overlay
async function handleRecordingTabUpdateForCameraOverlay(tabId, changeInfo, tab) {
  
  if (!isRecording || !cameraOverlayEnabled || !injectInTabCameraOverlay || tabId !== recordingTabId) {
    return;
  }
  if (changeInfo.status !== 'complete') return;
  
  // Skip internal and restricted browser pages across all Chromium variants
  if (tab.url && isUnsupportedWebsite(tab.url)) {
    return;
  }
  
  try {
    // Check if overlay already exists
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => !!document.getElementById('cursordemo-camera-overlay')
    });
    
    if (!results[0]?.result) {
      // Inject immediately (no delay)
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: injectCameraOverlayScript,
        args: []
      });
      console.log('[Background] Camera overlay re-injected after navigation in recording tab:', tabId);
      
      // Send latest frame immediately after re-injection
      if (cameraFrameData) {
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, {
            action: 'updateCameraFrame',
            frameData: cameraFrameData
          }).catch(() => {
            // Tab might not be ready yet, that's okay - periodic requests will handle it
          });
        }, 300);
      }
    }
  } catch (error) {
    console.log('[Background] Could not re-inject camera overlay after navigation:', error.message);
  }
}

// Function to inject camera overlay (runs in page context)
function injectCameraOverlayScript() {
  try {
    
    // Check if overlay already exists
    if (document.getElementById('cursordemo-camera-overlay')) {
      console.log('[CameraOverlay] Overlay already exists');
      return;
    }
    
    // Wait for body to be ready
    if (!document.body) {
      console.warn('[CameraOverlay] Document body not ready, waiting...');
      setTimeout(injectCameraOverlayScript, 100);
      return;
    }
    
    // Create overlay container with host-page-immune 1:1 circular geometry and studio border
    const overlay = document.createElement('div');
    overlay.id = 'cursordemo-camera-overlay';
    overlay.setAttribute('data-cursordemo-ignore', 'true');
    overlay.style.cssText = `
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      width: 160px !important;
      height: 160px !important;
      min-width: 160px !important;
      min-height: 160px !important;
      max-width: 160px !important;
      max-height: 160px !important;
      aspect-ratio: 1 / 1 !important;
      box-sizing: border-box !important;
      padding: 0 !important;
      margin: 0 !important;
      border-radius: 50% !important;
      overflow: hidden !important;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.48), 0 2px 8px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(0, 0, 0, 0.18) !important;
      border: 2.5px solid rgba(255, 255, 255, 0.9) !important;
      z-index: 2147483647 !important;
      background: #0b0d14 !important;
      pointer-events: none !important;
      transition: opacity 0.2s ease-in-out !important;
      opacity: 1 !important;
    `;
    
    // Use an img element updated with 1:1 center-cropped frames from record.html
    const img = document.createElement('img');
    img.id = 'cursordemo-camera-image';
    img.style.cssText = `
      display: block !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 100% !important;
      min-height: 100% !important;
      max-width: 100% !important;
      max-height: 100% !important;
      aspect-ratio: 1 / 1 !important;
      object-fit: cover !important;
      object-position: center center !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      transform: scaleX(-1) !important;
    `;
    
    // Handle image load errors
    img.onerror = () => {
      console.warn('[CameraOverlay] Image load error, will retry on next frame');
    };
    
    overlay.appendChild(img);
    document.body.appendChild(overlay);
    
    // Track last frame to avoid unnecessary updates and ensure flicker-free transitions
    let lastFrameData = null;
    
    console.log('[CameraOverlay] Overlay created and appended to body');
    
    // Listen for camera frame updates from background script
    // Store listener reference for cleanup (prevent duplicate listeners)
    if (window.__cameraOverlayMessageListener) {
      chrome.runtime.onMessage.removeListener(window.__cameraOverlayMessageListener);
    }
    
    const messageListener = (message, sender, sendResponse) => {
      if (message.action === 'updateCameraFrame' && message.frameData) {
        if (lastFrameData !== message.frameData) {
          lastFrameData = message.frameData;
          img.src = message.frameData;
        }
      }
      return true;
    };
    
    window.__cameraOverlayMessageListener = messageListener;
    chrome.runtime.onMessage.addListener(messageListener);
    
    // Request initial frame from background script and set up periodic fallback requests
    const requestFrame = () => {
      chrome.runtime.sendMessage({ action: 'getCameraFrame' }, (response) => {
        if (chrome.runtime.lastError) {
          return;
        }
        if (response && response.frameData && response.frameData !== lastFrameData) {
          lastFrameData = response.frameData;
          img.src = response.frameData;
        }
      });
    };
    
    // Request initial frame immediately
    requestFrame();
    
    // Periodic fallback check in case message push was missed
    const frameRequestInterval = setInterval(() => {
      const currentOverlay = document.getElementById('cursordemo-camera-overlay');
      if (currentOverlay) {
        requestFrame();
      } else {
        clearInterval(frameRequestInterval);
        window.__cameraOverlayFrameRequestInterval = null;
      }
    }, 200);
    
    // Store interval for cleanup
    window.__cameraOverlayFrameRequestInterval = frameRequestInterval;
  } catch (error) {
    console.error('[CameraOverlay] Error in injection script:', error);
  }
}


// Remove camera overlay from a specific tab
async function removeCameraOverlayFromTab(tabId) {
  if (!tabId) return;
  
  try {
    
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // Remove message listener to prevent memory leaks
        if (window.__cameraOverlayMessageListener) {
          try {
            chrome.runtime.onMessage.removeListener(window.__cameraOverlayMessageListener);
          } catch (e) {
            // Ignore errors
          }
          window.__cameraOverlayMessageListener = null;
        }
        
        // Clear frame request interval
        if (window.__cameraOverlayFrameRequestInterval) {
          clearInterval(window.__cameraOverlayFrameRequestInterval);
          window.__cameraOverlayFrameRequestInterval = null;
        }
        
        // Remove overlay immediately (no fade-out delay to ensure cleanup)
        const overlay = document.getElementById('cursordemo-camera-overlay');
        if (overlay) {
          const img = document.getElementById('cursordemo-camera-image');
          if (img) {
            img.src = '';
            img.onerror = null; // Remove error handler
          }
          overlay.remove();
          console.log('[CameraOverlay] Overlay removed from tab');
        }
        
        // Also clear any stored frame data
        if (window.__lastFrameData) {
          window.__lastFrameData = null;
        }
      }
    });
  } catch (error) {
    // Tab may not be scriptable or may have been closed
    console.log('[Background] Could not remove camera overlay from tab', tabId, ':', error.message);
  }
}

// Remove camera overlay from all tabs
async function removeCameraOverlayFromAllTabs() {
  try {
    
    const tabs = await chrome.tabs.query({});
    console.log('[Background] Removing camera overlay from', tabs.length, 'tabs');
    
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Remove message listener
            if (window.__cameraOverlayMessageListener) {
              try {
                chrome.runtime.onMessage.removeListener(window.__cameraOverlayMessageListener);
              } catch (e) {
                // Ignore errors
              }
              window.__cameraOverlayMessageListener = null;
            }
            
            // Clear frame request interval
            if (window.__cameraOverlayFrameRequestInterval) {
              clearInterval(window.__cameraOverlayFrameRequestInterval);
              window.__cameraOverlayFrameRequestInterval = null;
            }
            
            // Remove overlay immediately
            const overlay = document.getElementById('cursordemo-camera-overlay');
            if (overlay) {
              const img = document.getElementById('cursordemo-camera-image');
              if (img) {
                img.src = '';
                img.onerror = null;
              }
              overlay.remove();
              console.log('[CameraOverlay] Overlay removed from tab', tab.id);
            }
            
            // Clear stored frame data
            if (window.__lastFrameData) {
              window.__lastFrameData = null;
            }
          }
        });
      } catch (error) {
        // Some tabs may not be scriptable
        console.log('[Background] Could not remove camera overlay from tab', tab.id, ':', error.message);
      }
    }
    
    // Remove listener
    if (chrome.tabs.onUpdated.hasListener(handleRecordingTabUpdateForCameraOverlay)) {
      chrome.tabs.onUpdated.removeListener(handleRecordingTabUpdateForCameraOverlay);
    }
    
    // Reset state
    previousRecordingTabId = null;
  } catch (error) {
    console.error('[Background] Error removing camera overlay:', error);
  }
}

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[Background] Extension icon clicked');
  console.log('[Background] Current tab:', tab.id, tab.url);
  
  // If currently recording, stop
  if (isRecording) {
    console.log('[Background] Recording in progress, stopping...');
    
    // Notify the record page first (before stopping, so it can handle cleanup)
    const recordPageUrl = chrome.runtime.getURL('record.html');
    let notifiedRecordTab = false;
    try {
      const allTabs = await chrome.tabs.query({});
      const recordTabs = allTabs.filter(t => t.url && t.url.startsWith(recordPageUrl));
      
      for (const recordTab of recordTabs) {
        try {
          await chrome.tabs.sendMessage(recordTab.id, { action: 'recordingStopped' });
          console.log('[Background] Notified record page tab:', recordTab.id);
          notifiedRecordTab = true;
        } catch (e) {
          console.log('[Background] Could not notify record tab:', e.message);
        }
      }
    } catch (e) {
      console.log('[Background] Could not find record tabs:', e.message);
    }
    
    // Stop recording directly only if no record tab was found to handle it gracefully
    if (!notifiedRecordTab) {
      await stopRecording();
    }
    return;
  }
  
  // Check if we can access the current tab; if restricted, find the best open scriptable tab
  const extBaseUrl = chrome.runtime.getURL('');
  const originTabId = (tab?.id && (!tab?.url || !tab.url.startsWith(extBaseUrl))) ? tab.id : null;
  let targetTabId = tab?.id;
  
  if (!targetTabId || !tab?.url || isUnsupportedWebsite(tab.url)) {
    console.log('[Background] Current tab is restricted or extension page, resolving best scriptable tab');
    targetTabId = await findBestTargetTabId(tab?.windowId);
  }
  
  // Open recording page directly (include originTabId so Entire Screen / Window recordings can switch away from record.html even when only internal tabs are open)
  const queryParts = [];
  if (targetTabId) queryParts.push(`tabId=${targetTabId}`);
  if (originTabId) queryParts.push(`originTabId=${originTabId}`);
  const recordUrl = chrome.runtime.getURL(queryParts.length > 0 ? `record.html?${queryParts.join('&')}` : 'record.html');
  await chrome.tabs.create({ url: recordUrl, pinned: true });
});

// Find the most recently accessed scriptable tab across windows when active tab is restricted
async function findBestTargetTabId(preferredWindowId = null) {
  try {
    const allTabs = await chrome.tabs.query({});
    const candidates = allTabs.filter(t => t && t.id && t.url && !isUnsupportedWebsite(t.url));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const aPrefWin = (preferredWindowId !== null && a.windowId === preferredWindowId) ? 1 : 0;
      const bPrefWin = (preferredWindowId !== null && b.windowId === preferredWindowId) ? 1 : 0;
      if (aPrefWin !== bPrefWin) return bPrefWin - aPrefWin;
      const aAccess = a.lastAccessed || 0;
      const bAccess = b.lastAccessed || 0;
      if (aAccess !== bAccess) return bAccess - aAccess;
      const aActive = a.active ? 1 : 0;
      const bActive = b.active ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return (b.index || 0) - (a.index || 0);
    });
    return candidates[0].id;
  } catch (e) {
    return null;
  }
}

// Inject and start cursor tracking across all open scriptable tabs in all windows
async function injectContentScriptToAllTabs() {
  if (!isRecording) return;
  try {
    const allTabs = await chrome.tabs.query({});
    const scriptableTabs = allTabs.filter(t => t && t.id && t.url && !isUnsupportedWebsite(t.url));
    await Promise.allSettled(scriptableTabs.map(t => reinjectContentScript(t.id)));
  } catch (e) {
    console.warn('[Background] Error injecting content script to all tabs:', e?.message || e);
  }
}

// Function to re-inject content script into a tab
async function reinjectContentScript(tabId) {
  if (!isRecording || !tabId) {
    return;
  }
  
  try {
    const tab = await chrome.tabs.get(tabId);
    
    // Skip if it's an unsupported website
    if (!tab.url || isUnsupportedWebsite(tab.url)) {
      console.log('[Background] Skipping re-injection for unsupported website:', tab.url);
      return;
    }
    
    // Check if content script is already injected (by checking if we can send a message)
    try {
      const pingResp = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      // If ping succeeds, script is already there, just start tracking
      console.log('[Background] Content script already present, starting tracking on tab:', tabId);
      const startResp = await chrome.tabs.sendMessage(tabId, { action: 'startTracking' });
      const wm = (startResp && startResp.windowMetrics) || (pingResp && pingResp.windowMetrics);
      if (wm && (tabId === recordingTabId || tab.active || !lastKnownWindowMetrics)) {
        updateTopWindowMetrics(wm);
      }
      return;
    } catch (e) {
      // Script not present, need to inject
      console.log('[Background] Content script not present, injecting on tab:', tabId);
    }
    
    // Inject content script across all frames
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ['content.js']
    });
    
    // Wait for script to load
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Start tracking
    const startResp = await chrome.tabs.sendMessage(tabId, { action: 'startTracking' });
    if (startResp && startResp.windowMetrics && (tabId === recordingTabId || tab.active || !lastKnownWindowMetrics)) {
      updateTopWindowMetrics(startResp.windowMetrics);
    }
    console.log('[Background] ✅ Content script re-injected and tracking started on tab:', tabId);
  } catch (error) {
    console.warn('[Background] Failed to re-inject content script:', error.message);
  }
}

// Listen for tab updates (navigation, page loads across any tab/window during recording)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!isRecording) {
    return;
  }
  
  // When any scriptable page starts or finishes loading, ensure content script is active immediately
  if ((changeInfo.status === 'loading' || changeInfo.status === 'complete') && tab.url && !isUnsupportedWebsite(tab.url)) {
    console.log('[Background] Tab navigation (' + changeInfo.status + ') detected during recording, re-injecting content script:', tab.url);
    if (!recordingTabId || (tab.active && tabId === recordingTabId)) {
      recordingTabId = tabId;
    }
    await reinjectContentScript(tabId);
    
    // Re-inject camera overlay if enabled on the active recording tab
    if (changeInfo.status === 'complete' && cameraOverlayEnabled && injectInTabCameraOverlay && tabId === recordingTabId) {
      handleRecordingTabUpdateForCameraOverlay(tabId, changeInfo, tab);
    }
  }
});

// Listen for tab activation (tab switches across any window)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Only handle if we're recording
  if (!isRecording) {
    return;
  }
  
  const activeTabId = activeInfo.tabId;
  const tab = await chrome.tabs.get(activeTabId).catch(() => null);
  if (!tab || !tab.url || isUnsupportedWebsite(tab.url)) {
    // Do not overwrite recordingTabId with extension pages (record.html, editor.html) or chrome:// tabs
    return;
  }
  
  // If the active tab is the recording tab, ensure content script is injected
  if (activeTabId === recordingTabId) {
    console.log('[Background] Recording tab activated, ensuring content script is present');
    await reinjectContentScript(activeTabId);
    seedWindowMetricsFromTab(activeTabId);
    
    // Re-inject camera overlay if in-tab overlay is enabled (immediately, no delay)
    if (cameraOverlayEnabled && injectInTabCameraOverlay) {
      injectCameraOverlayToRecordingTab(activeTabId);
      
      // Send latest frame immediately after injection
      if (cameraFrameData) {
        setTimeout(() => {
          chrome.tabs.sendMessage(activeTabId, {
            action: 'updateCameraFrame',
            frameData: cameraFrameData
          }).catch(() => {});
        }, 300);
      }
    }
  } else {
    // User switched to a different scriptable tab during recording
    if (recordingTabId && recordingTabId !== activeTabId && cameraOverlayEnabled && injectInTabCameraOverlay) {
      await removeCameraOverlayFromTab(recordingTabId);
    }
    
    console.log('[Background] Tab switched during recording, updating tracking to new tab:', activeTabId);
    previousRecordingTabId = recordingTabId;
    recordingTabId = activeTabId;
    await reinjectContentScript(activeTabId);
    seedWindowMetricsFromTab(activeTabId);
    
    if (cameraOverlayEnabled && injectInTabCameraOverlay) {
      injectCameraOverlayToRecordingTab(activeTabId);
      
      if (cameraFrameData) {
        setTimeout(() => {
          chrome.tabs.sendMessage(activeTabId, {
            action: 'updateCameraFrame',
            frameData: cameraFrameData
          }).catch(() => {});
        }, 300);
      }
    }
  }
});

// Listen for window focus changes (essential when user selects a different Window or switches windows on Entire Screen)
if (typeof chrome !== 'undefined' && chrome.windows?.onFocusChanged?.addListener) {
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (!isRecording || windowId === undefined || windowId === chrome.windows.WINDOW_ID_NONE || windowId < 0) {
      return;
    }
    try {
      const activeTabs = await chrome.tabs.query({ active: true, windowId });
      const activeTab = activeTabs && activeTabs[0];
      if (!activeTab || !activeTab.id || !activeTab.url || isUnsupportedWebsite(activeTab.url)) {
        return;
      }
      const activeTabId = activeTab.id;
      if (recordingTabId && recordingTabId !== activeTabId && cameraOverlayEnabled && injectInTabCameraOverlay) {
        await removeCameraOverlayFromTab(recordingTabId);
      }
      previousRecordingTabId = recordingTabId;
      recordingTabId = activeTabId;
      await reinjectContentScript(activeTabId);
      seedWindowMetricsFromTab(activeTabId);
      if (cameraOverlayEnabled && injectInTabCameraOverlay) {
        injectCameraOverlayToRecordingTab(activeTabId);
        if (cameraFrameData) {
          setTimeout(() => {
            chrome.tabs.sendMessage(activeTabId, {
              action: 'updateCameraFrame',
              frameData: cameraFrameData
            }).catch(() => {});
          }, 300);
        }
      }
    } catch (e) {}
  });
}

// Centralized Discord Community & Support Invite URL
const CURSORDEMO_DISCORD_URL = 'https://discord.gg/gwATujg6yq';

// Open Welcome + Studio Capture page on fresh install
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled?.addListener) {
  chrome.runtime.onInstalled.addListener(async (details) => {
    try {
      await updateRecordingIcon(false);
      if (details && details.reason === 'install') {
        await chrome.storage.local.set({
          welcomeShownAt: Date.now(),
          showWelcomeBanner: true,
          discordUrl: CURSORDEMO_DISCORD_URL
        }).catch(() => {});
        const targetTabId = await findBestTargetTabId();
        const queryParts = ['welcome=1'];
        if (targetTabId) queryParts.push(`tabId=${targetTabId}`);
        const welcomeRecordUrl = chrome.runtime.getURL(`record.html?${queryParts.join('&')}`);
        await chrome.tabs.create({ url: welcomeRecordUrl, pinned: true });
      }
    } catch (err) {
      console.warn('[Background] onInstalled handler error:', err);
    }
  });
}

// Initialize state on startup (in case extension was reloaded or service worker woke up during recording)
stateInitPromise = (async () => {
  try {
    const result = await chrome.storage.local.get([
      'isRecording',
      'isPaused',
      'recordingStartTime',
      'recordingTabId',
      'cursorData_snapshot',
      'cameraOverlayEnabled',
      'injectInTabCameraOverlay',
      'displaySurface',
      'lastKnownWindowMetrics'
    ]);
    if (result.isRecording) {
      isRecording = true;
      isPaused = result.isPaused || false;
      if (result.recordingStartTime && result.recordingStartTime > 0) {
        recordingStartTime = result.recordingStartTime;
        console.log('[Background] Restored recordingStartTime:', recordingStartTime);
      }
      if (result.recordingTabId) {
        recordingTabId = result.recordingTabId;
      }
      if (result.cameraOverlayEnabled !== undefined) {
        cameraOverlayEnabled = result.cameraOverlayEnabled;
      }
      if (result.injectInTabCameraOverlay !== undefined) {
        injectInTabCameraOverlay = Boolean(result.injectInTabCameraOverlay);
      }
      if (result.displaySurface) {
        recordedDisplaySurface = result.displaySurface;
      }
      if (result.lastKnownWindowMetrics && !lastKnownWindowMetrics) {
        lastKnownWindowMetrics = result.lastKnownWindowMetrics;
      }
      if (result.cursorData_snapshot && Array.isArray(result.cursorData_snapshot) && cursorData.length === 0) {
        cursorData = result.cursorData_snapshot;
        console.log('[Background] Restored', cursorData.length, 'cursor points from storage snapshot');
      }
      await updateRecordingIcon(true, isPaused);
    } else {
      await updateRecordingIcon(false);
    }
  } catch (error) {
    console.warn('[Background] Could not initialize state:', error);
  }
})();


