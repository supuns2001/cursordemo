/**
 * CursorDemo Screen Recorder
 * Copyright (c) 2026 CursorDemo Contributors
 * GitHub: https://github.com/cursordemo/cursordemo-screen-recorder
 *
 * Licensed under the MIT License.
 */

// Content Script - Tracks cursor movements, clicks, and keystrokes
// Injection guard to prevent duplicate declarations
if (window.__SCREEN_RECORDER_CONTENT_INJECTED__) {
  console.log('[Content] Already injected, skipping');
} else {
  window.__SCREEN_RECORDER_CONTENT_INJECTED__ = true;
  console.log('[Content] Script loaded on:', window.location.href);

  let isTracking = false;
  let lastSendTime = 0;
  let lastScrollSendTime = 0; // separate from mouse-move throttle so scrolls aren't dropped
  let clickCount = 0;
  let moveCount = 0;
  // Track last known mouse position for scroll-burst zoom centering and physical screen coords
  let lastMouseX = null;
  let lastMouseY = null;
  let lastMouseScreenX = null;
  let lastMouseScreenY = null;
  let lastMouseDownTs = 0;
  let lastMouseDownX = null;
  let lastMouseDownY = null;
  let lastClickTs = 0;
  let lastClickX = null;
  let lastClickY = null;
  let lastSentMetrics = null;
  let windowGeometryPollInterval = null;
  const SEND_INTERVAL = 16; // 60Hz smooth cursor capture rate (clicks always sent immediately)
  
  // Store handlers for visibility and focus events so they can be removed
  let visibilityChangeHandler = null;
  let focusHandler = null;
  let urlCheckInterval = null;
  let cursorStreamPort = null;
  const PASSIVE = { passive: true };
  const PASSIVE_CAPTURE = { passive: true, capture: true };
  
  // Helper function to check if extension context is still valid
  function isExtensionContextValid() {
    try {
      // Try to access chrome.runtime.id - this will throw if context is invalidated
      return Boolean(chrome && chrome.runtime && chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

  // Persistent streaming port for high-frequency cursor tracking (avoids message port exhaustion & closed port errors)
  function ensureCursorStreamPort() {
    if (cursorStreamPort) return cursorStreamPort;
    if (!isExtensionContextValid()) return null;
    try {
      cursorStreamPort = chrome.runtime.connect({ name: 'cursordemo-cursor-stream' });
      cursorStreamPort.onDisconnect.addListener(() => {
        cursorStreamPort = null;
        if (isTracking && isExtensionContextValid()) {
          setTimeout(ensureCursorStreamPort, 500);
        }
      });
      return cursorStreamPort;
    } catch (e) {
      cursorStreamPort = null;
      return null;
    }
  }
  
  // Helper function to safely call Chrome APIs with error handling
  function safeChromeCall(apiCall, errorCallback) {
    if (!isExtensionContextValid()) {
      const error = new Error('Extension context invalidated');
      if (errorCallback) errorCallback(error);
      return Promise.reject(error);
    }
    
    try {
      const result = apiCall();
      // If it's a promise, add error handling
      if (result && typeof result.catch === 'function') {
        return result.catch((error) => {
          const errorMsg = error?.message || String(error);
          // ONLY stop tracking on true extension invalidation, NEVER on transient message port closure!
          if (errorMsg.includes('Extension context invalidated') || 
              errorMsg.includes('context invalidated')) {
            console.warn('[Content] Extension context invalidated, stopping tracking');
            stopTracking();
          }
          if (errorCallback) errorCallback(error);
          throw error;
        });
      }
      return result;
    } catch (error) {
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes('Extension context invalidated') || 
          errorMsg.includes('context invalidated')) {
        console.warn('[Content] Extension context invalidated, stopping tracking');
        stopTracking();
      }
      if (errorCallback) errorCallback(error);
      return Promise.reject(error);
    }
  }

  /**
   * Unified Physical Coordinate Resolver
   * Maps cursor position to true 0.0-1.0 coordinates across monitor, window, and tab spaces.
   * Completely avoids arbitrary sideBorderWidth halving which previously caused left-side stickiness
   * and prevented auto-zoom from reaching right-side panels.
   */
  let activeMonitorSpan = null;

  const COMMON_DISPLAY_WIDTHS = [
    3840, 3440, 3008, 2880, 2560, 1920, 1800, 1728, 1680, 1600, 1536, 1512, 1470, 1440, 1366, 1280
  ];
  const TIER1_DISPLAY_WIDTHS = new Set([3840, 3440, 2560, 1920, 1728, 1512, 1440]);
  const DISPLAY_WIDTH_TO_HEIGHTS = {
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
  const COMMON_DISPLAY_HEIGHTS = [
    2400, 2160, 1800, 1692, 1600, 1440, 1200, 1117, 1080, 1050, 982, 900, 864, 800, 768, 720
  ];

  function resolveMonitorOrigin({
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
      activeMonitorSpan &&
      activeMonitorSpan.sw === sw &&
      activeMonitorSpan.sh === sh &&
      Math.max(activeMonitorSpan.maxX, maxX) - Math.min(activeMonitorSpan.minX, minX) <= sw + 16 &&
      Math.max(activeMonitorSpan.maxY, maxY) - Math.min(activeMonitorSpan.minY, minY) <= sh + 16
    ) {
      activeMonitorSpan.minX = Math.min(activeMonitorSpan.minX, minX);
      activeMonitorSpan.maxX = Math.max(activeMonitorSpan.maxX, maxX);
      activeMonitorSpan.minY = Math.min(activeMonitorSpan.minY, minY);
      activeMonitorSpan.maxY = Math.max(activeMonitorSpan.maxY, maxY);
      minX = activeMonitorSpan.minX;
      maxX = activeMonitorSpan.maxX;
      minY = activeMonitorSpan.minY;
      maxY = activeMonitorSpan.maxY;
    } else {
      activeMonitorSpan = { sw, sh, minX, maxX, minY, maxY };
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
        for (const cw of COMMON_DISPLAY_WIDTHS) {
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
            if ((c === gridX || TIER1_DISPLAY_WIDTHS.has(Math.abs(c))) && Math.abs(minX - c) <= 8) {
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
            const tier1Bonus = TIER1_DISPLAY_WIDTHS.has(Math.abs(c)) ? 110 : 0;
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
        const matchedHeights = DISPLAY_WIDTH_TO_HEIGHTS[adjW] || [];
        for (const h of matchedHeights) {
          addCandY(h - sh, 90);
          addCandY(Math.round((h - sh) * 0.5), 75);
          addCandY(h, 80);
        }
        for (const h of COMMON_DISPLAY_HEIGHTS) {
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

  function calculateCoordinates(clientX, clientY, rawScreenX, rawScreenY) {
    // If tracking inside a same-origin iframe, accumulate frame offsets up to the top viewport
    let topClientX = clientX;
    let topClientY = clientY;
    let rootWin = window;
    try {
      let curWin = window;
      while (curWin && curWin !== curWin.parent && curWin.frameElement) {
        const rect = curWin.frameElement.getBoundingClientRect();
        topClientX += rect.left;
        topClientY += rect.top;
        curWin = curWin.parent;
        rootWin = curWin;
      }
    } catch (_) {
      // Cross-origin frame boundary; handled below via hardware screen coordinates + top window metrics
    }

    let isCrossOriginSubframe = false;
    try {
      isCrossOriginSubframe = (rootWin !== window.top);
    } catch (_) {
      isCrossOriginSubframe = true;
    }

    const viewportWidth = rootWin.innerWidth || document.documentElement?.clientWidth || 1920;
    const viewportHeight = rootWin.innerHeight || document.documentElement?.clientHeight || 1080;
    const windowLeft = (rootWin.screenX !== undefined) ? rootWin.screenX : (rootWin.screenLeft || 0);
    const windowTop = (rootWin.screenY !== undefined) ? rootWin.screenY : (rootWin.screenTop || 0);
    const outerWidth = rootWin.outerWidth || viewportWidth;
    const outerHeight = rootWin.outerHeight || viewportHeight;
    const screenObj = rootWin.screen || window.screen || {};
    const screenWidth = screenObj.width || 1920;
    const screenHeight = screenObj.height || 1080;

    // Check if reliable hardware monitor coordinates exist on this event
    const hasScreen = rawScreenX !== undefined && rawScreenX !== null && Number.isFinite(rawScreenX) &&
                      rawScreenY !== undefined && rawScreenY !== null && Number.isFinite(rawScreenY) &&
                      (rawScreenX !== 0 || rawScreenY !== 0 || (topClientX === 0 && topClientY === 0));

    // Cap fallback browser chrome height at 120px so docked DevTools never skews windowY downward.
    // When in the top frame without docked DevTools/sidebar, always use exact (outerHeight - viewportHeight)
    // so normWindowY and topBarHeight are 100% consistent and immune to stale window.screenY offsets.
    // Also measure left sidebar width (`lastMeasuredLeftChrome`) when Opera, Vivaldi, Brave, Edge, or Yandex
    // has a left sidebar / vertical tab bar open (`outerWidth - viewportWidth > 24`).
    const widthDelta = Math.max(0, outerWidth - viewportWidth);
    const hasDockedDevTools = !isCrossOriginSubframe &&
      (widthDelta > 24 || (outerHeight - viewportHeight) > 150);
    const fallbackTopChrome = isCrossOriginSubframe
      ? Math.min(120, Math.max(0, Math.round(outerHeight * 0.08)))
      : (hasDockedDevTools && lastMeasuredTopChrome !== null
          ? lastMeasuredTopChrome
          : Math.max(0, Math.min(120, outerHeight - viewportHeight)));
    const fallbackLeftChrome = (!isCrossOriginSubframe && hasDockedDevTools)
      ? (lastMeasuredLeftChrome !== null ? lastMeasuredLeftChrome : (widthDelta > 24 && widthDelta <= 120 ? widthDelta : 0))
      : 0;
    const scaledClientX = (!isCrossOriginSubframe && !hasDockedDevTools && viewportWidth > 0 && outerWidth > 0)
      ? (topClientX / viewportWidth) * outerWidth
      : topClientX;

    let windowX = Math.max(0, Math.min(outerWidth, fallbackLeftChrome + scaledClientX));
    let windowY = Math.max(0, Math.min(outerHeight, fallbackTopChrome + topClientY));

    if (hasScreen && (isCrossOriginSubframe || hasDockedDevTools)) {
      const screenRelWinX = rawScreenX - windowLeft;
      const screenRelWinY = rawScreenY - windowTop;
      if (screenRelWinX >= -24 && screenRelWinX <= outerWidth + 24 &&
          screenRelWinY >= -24 && screenRelWinY <= outerHeight + 24) {
        windowX = Math.max(0, Math.min(outerWidth, screenRelWinX));
        windowY = Math.max(0, Math.min(outerHeight, screenRelWinY));
        if (!isCrossOriginSubframe) {
          const measuredChromeY = Math.round(screenRelWinY - topClientY);
          if (measuredChromeY >= 0 && measuredChromeY <= 160) {
            lastMeasuredTopChrome = measuredChromeY;
          }
          const measuredChromeX = Math.round(screenRelWinX - topClientX);
          const maxLeftSideWidth = Math.max(24, (outerWidth - viewportWidth) + 16);
          if (measuredChromeX >= 0 && measuredChromeX <= maxLeftSideWidth) {
            lastMeasuredLeftChrome = measuredChromeX;
          }
        }
      }
    }

    // If inside a cross-origin subframe with hardware screen coords, derive top-viewport clientX/Y
    // from windowX/Y instead of the small subframe's local clientX/Y.
    const effectiveViewportW = isCrossOriginSubframe ? outerWidth : viewportWidth;
    const effectiveViewportH = isCrossOriginSubframe ? Math.max(1, outerHeight - fallbackTopChrome) : viewportHeight;
    if (isCrossOriginSubframe && hasScreen) {
      topClientX = Math.max(0, Math.min(effectiveViewportW, windowX - fallbackLeftChrome));
      topClientY = Math.max(0, Math.min(effectiveViewportH, windowY - fallbackTopChrome));
    }

    const monitorX = hasScreen ? rawScreenX : (windowLeft + windowX);
    const monitorY = hasScreen ? rawScreenY : (windowTop + windowY);

    // Resolve monitor origin for multi-monitor setups (including mixed-resolution and non-grid vertical offsets)
    const { originX: availLeft, originY: availTop } = resolveMonitorOrigin({
      screenWidth,
      screenHeight,
      availLeft: screenObj.availLeft,
      availTop: screenObj.availTop,
      availWidth: screenObj.availWidth,
      availHeight: screenObj.availHeight,
      windowLeft,
      windowTop,
      outerWidth,
      outerHeight,
      monitorX,
      monitorY
    });

    const localMonitorX = Math.max(0, Math.min(screenWidth, monitorX - availLeft));
    const localMonitorY = Math.max(0, Math.min(screenHeight, monitorY - availTop));

    // 1. Normalized tab/viewport coordinate (0.0 to 1.0)
    const normTabX = effectiveViewportW > 0 ? Math.max(0, Math.min(1, topClientX / effectiveViewportW)) : 0.5;
    const normTabY = effectiveViewportH > 0 ? Math.max(0, Math.min(1, topClientY / effectiveViewportH)) : 0.5;

    // 2. Normalized browser window coordinate (0.0 to 1.0)
    // Reaches 0.0 at the extreme left edge and 1.0 at the extreme right edge
    const normWindowX = outerWidth > 0 ? Math.max(0, Math.min(1, windowX / outerWidth)) : normTabX;
    const normWindowY = outerHeight > 0 ? Math.max(0, Math.min(1, windowY / outerHeight)) : normTabY;

    // 3. Normalized monitor/desktop coordinate (0.0 to 1.0)
    const normScreenX = screenWidth > 0 ? Math.max(0, Math.min(1, localMonitorX / screenWidth)) : normTabX;
    const normScreenY = screenHeight > 0 ? Math.max(0, Math.min(1, localMonitorY / screenHeight)) : normTabY;

    return {
      clientX: topClientX,
      clientY: topClientY,
      rawScreenX: hasScreen ? rawScreenX : null,
      rawScreenY: hasScreen ? rawScreenY : null,
      isCrossOriginSubframe,
      windowX,
      windowY,
      screenX: localMonitorX,
      screenY: localMonitorY,
      normTabX,
      normTabY,
      normWindowX,
      normWindowY,
      normScreenX,
      normScreenY,
      viewportWidth: effectiveViewportW,
      viewportHeight: effectiveViewportH,
      outerWidth,
      outerHeight,
      windowLeft,
      windowTop,
      screenWidth,
      screenHeight,
      availLeft,
      availTop
    };
  }

  let lastMeasuredTopChrome = null;
  let lastMeasuredLeftChrome = null;

  function buildTopWindowMetrics() {
    let isTopFrame = false;
    try {
      isTopFrame = (window === window.top);
    } catch (_) {
      isTopFrame = false;
    }
    if (!isTopFrame) return null;
    const innerW = window.innerWidth || document.documentElement?.clientWidth || 1920;
    const innerH = window.innerHeight || document.documentElement?.clientHeight || 1080;
    const outerW = window.outerWidth || innerW;
    const outerH = window.outerHeight || innerH;
    const winLeft = (window.screenX !== undefined) ? window.screenX : (window.screenLeft || 0);
    const winTop = (window.screenY !== undefined) ? window.screenY : (window.screenTop || 0);
    const screenObj = window.screen || (typeof screen !== 'undefined' ? screen : {}) || {};
    const screenW = screenObj.width || 1920;
    const screenH = screenObj.height || 1080;
    const { originX: availLeft, originY: availTop } = resolveMonitorOrigin({
      screenWidth: screenW,
      screenHeight: screenH,
      availLeft: screenObj.availLeft,
      availTop: screenObj.availTop,
      availWidth: screenObj.availWidth,
      availHeight: screenObj.availHeight,
      windowLeft: winLeft,
      windowTop: winTop,
      outerWidth: outerW,
      outerHeight: outerH,
      monitorX: winLeft + outerW * 0.5,
      monitorY: winTop + outerH * 0.5
    });
    const widthDelta = Math.max(0, outerW - innerW);
    const hasDockedDevTools = widthDelta > 24 || (outerH - innerH) > 150;
    const topBarHeight = (hasDockedDevTools && lastMeasuredTopChrome !== null)
      ? lastMeasuredTopChrome
      : Math.max(0, Math.min(120, outerH - innerH));
    const leftChromeWidth = hasDockedDevTools
      ? (lastMeasuredLeftChrome !== null ? lastMeasuredLeftChrome : (widthDelta > 24 && widthDelta <= 120 ? widthDelta : 0))
      : 0;
    return {
      screenX: winLeft,
      screenY: winTop,
      outerWidth: outerW,
      outerHeight: outerH,
      innerWidth: innerW,
      innerHeight: innerH,
      topBarHeight,
      leftChromeWidth,
      sideBorderWidth: 0,
      screenWidth: screenW,
      screenHeight: screenH,
      availWidth: screenObj.availWidth || screenW,
      availHeight: screenObj.availHeight || screenH,
      availLeft,
      availTop,
      screenAvailLeft: availLeft,
      screenAvailTop: availTop,
      devicePixelRatio: window.devicePixelRatio || 1
    };
  }

  function syncTopWindowMetrics(force = false) {
    if (force !== true && lastSentMetrics && document.visibilityState === 'hidden') return;
    const wm = buildTopWindowMetrics();
    if (!wm) return;
    lastSentMetrics = wm;
    const payload = {
      action: 'syncWindowMetrics',
      type: 'windowMetricsSync',
      isCrossOriginSubframe: false,
      windowMetrics: wm,
      timestamp: Date.now()
    };
    const port = ensureCursorStreamPort();
    if (port) {
      try {
        port.postMessage(payload);
        return;
      } catch (_) {
        cursorStreamPort = null;
      }
    }
    safeChromeCall(() => chrome.runtime.sendMessage(payload), () => {}).catch(() => {});
  }

  function checkTopWindowGeometryChanged() {
    if (!isTracking || document.visibilityState === 'hidden') return;
    let isTopFrame = false;
    try {
      isTopFrame = (window === window.top);
    } catch (_) {
      isTopFrame = false;
    }
    if (!isTopFrame) return;
    const innerW = window.innerWidth || document.documentElement?.clientWidth || 1920;
    const innerH = window.innerHeight || document.documentElement?.clientHeight || 1080;
    const outerW = window.outerWidth || innerW;
    const outerH = window.outerHeight || innerH;
    const winLeft = (window.screenX !== undefined) ? window.screenX : (window.screenLeft || 0);
    const winTop = (window.screenY !== undefined) ? window.screenY : (window.screenTop || 0);
    if (!lastSentMetrics ||
        lastSentMetrics.screenX !== winLeft ||
        lastSentMetrics.screenY !== winTop ||
        lastSentMetrics.outerWidth !== outerW ||
        lastSentMetrics.outerHeight !== outerH ||
        lastSentMetrics.innerWidth !== innerW ||
        lastSentMetrics.innerHeight !== innerH ||
        (lastMeasuredTopChrome !== null && lastSentMetrics.topBarHeight !== lastMeasuredTopChrome) ||
        (lastMeasuredLeftChrome !== null && lastSentMetrics.leftChromeWidth !== lastMeasuredLeftChrome)) {
      syncTopWindowMetrics();
    }
  }

  function removeLegacyDomCameraOverlays() {
    try {
      const legacyIds = ['cursordemo-camera-overlay', 'cursorfly-camera-overlay', 'cameraPreviewOverlay'];
      for (const id of legacyIds) {
        const el = document.getElementById(id);
        if (el) {
          el.remove();
        }
      }
    } catch (e) {}
  }

  // Start tracking cursor
  function startTracking() {
    removeLegacyDomCameraOverlays();
    if (isTracking) {
      console.log('[Content] Already tracking');
      moveCount = 0;
      lastSentMetrics = null;
      syncTopWindowMetrics(true);
      return;
    }
    
    console.log('[Content] 🎯 Starting cursor tracking...');
    isTracking = true;
    clickCount = 0;
    moveCount = 0;
    lastSentMetrics = null;
    ensureCursorStreamPort();
    syncTopWindowMetrics(true);

    if (windowGeometryPollInterval) {
      clearInterval(windowGeometryPollInterval);
    }
    windowGeometryPollInterval = setInterval(checkTopWindowGeometryChanged, 250);
    
    // Track mouse movements on window with capture so stopPropagation cannot block cursor tracking
    window.addEventListener('mousemove', handleMouseMove, PASSIVE_CAPTURE);
    window.addEventListener('pointermove', handleMouseMove, PASSIVE_CAPTURE);
    window.addEventListener('pointerover', handleMouseMove, PASSIVE_CAPTURE);
    window.addEventListener('mouseover', handleMouseMove, PASSIVE_CAPTURE);
    document.addEventListener('mousemove', handleMouseMove, PASSIVE);
    window.addEventListener('resize', syncTopWindowMetrics, PASSIVE);
    
    // Track clicks & presses - use capture phase on window and document
    window.addEventListener('click', handleClick, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('pointerdown', handleMouseDown, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    
    // Track double clicks
    window.addEventListener('dblclick', handleDoubleClick, true);
    document.addEventListener('dblclick', handleDoubleClick, true);

    // Track right clicks (context menu) and middle clicks
    window.addEventListener('contextmenu', handleContextMenu, true);
    window.addEventListener('auxclick', handleAuxClick, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('auxclick', handleAuxClick, true);
    
    // Track scroll (both scroll and wheel events for cross-browser coverage)
    window.addEventListener('scroll', handleScroll, PASSIVE_CAPTURE);
    window.addEventListener('wheel', handleScroll, PASSIVE_CAPTURE);
    document.addEventListener('scroll', handleScroll, PASSIVE_CAPTURE);
    document.addEventListener('wheel', handleScroll, PASSIVE_CAPTURE);
    
    // Global recording hotkeys inside the recorded tab
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keydown', handleKeyDown, true);

    // If pointer coordinates were already known prior to startTracking, emit an initial move point
    if (Number.isFinite(lastMouseX) && Number.isFinite(lastMouseY)) {
      sendCursorData({
        clientX: lastMouseX,
        clientY: lastMouseY,
        screenX: lastMouseScreenX,
        screenY: lastMouseScreenY,
        button: 0
      }, 'move');
    }
    
    console.log('[Content] ✅ Cursor and keystroke tracking ACTIVE (window + document capture)');
  }

  let mouseMoveTimeout = null;
  let pendingMove = null;
  let lastDispatchedClientX = null;
  let lastDispatchedClientY = null;

  function handleMouseMove(event) {
    if (!isTracking) return;
    
    // Always update last known position (for scroll-burst zoom centering and physical tracking)
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
    }
    if (Number.isFinite(event.screenX) && Number.isFinite(event.screenY) && (event.screenX !== 0 || event.screenY !== 0)) {
      lastMouseScreenX = event.screenX;
      lastMouseScreenY = event.screenY;
    }
    
    const now = Date.now();
    
    // Throttle cursor data sending for smooth 60Hz tracking with trailing-edge flush
    if (now - lastSendTime < SEND_INTERVAL) {
      // Ignore companion mousemove/pointermove firing at the exact same coordinates just dispatched
      if (!pendingMove && event.clientX === lastDispatchedClientX && event.clientY === lastDispatchedClientY) {
        return;
      }
      // Remember the most recent position; the trailing flush must send the
      // latest point, not the first one seen in this throttle window.
      pendingMove = {
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button || 0
      };
      if (!mouseMoveTimeout) {
        const wait = Math.max(1, SEND_INTERVAL - (now - lastSendTime));
        mouseMoveTimeout = setTimeout(() => {
          mouseMoveTimeout = null;
          const move = pendingMove;
          pendingMove = null;
          if (isTracking && move) {
            lastSendTime = Date.now();
            lastDispatchedClientX = move.clientX;
            lastDispatchedClientY = move.clientY;
            moveCount++;
            sendCursorData(move, 'move');
          }
        }, wait);
      }
      return;
    }
    
    if (mouseMoveTimeout) {
      clearTimeout(mouseMoveTimeout);
      mouseMoveTimeout = null;
    }
    pendingMove = null;
    
    lastSendTime = now;
    lastDispatchedClientX = event.clientX;
    lastDispatchedClientY = event.clientY;
    moveCount++;
    sendCursorData(event, 'move');
  }

  function updateLastMouse(event) {
    if (event) {
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
      }
      if (Number.isFinite(event.screenX) && Number.isFinite(event.screenY) && (event.screenX !== 0 || event.screenY !== 0)) {
        lastMouseScreenX = event.screenX;
        lastMouseScreenY = event.screenY;
      }
    }
    if (mouseMoveTimeout) {
      clearTimeout(mouseMoveTimeout);
      mouseMoveTimeout = null;
    }
    pendingMove = null;
  }

  function isCameraOverlayTarget(event) {
    if (!event || !event.target) return false;
    const t = event.target;
    if (t.id === 'cursordemo-camera-overlay' || t.id === 'cursordemo-camera-image') return true;
    if (typeof t.closest === 'function') {
      try {
        if (t.closest('#cursordemo-camera-overlay, [data-cursordemo-ignore="true"]')) return true;
      } catch (_) {}
    }
    return false;
  }

  function handleMouseDown(event) {
    if (!isTracking || isCameraOverlayTarget(event)) return;
    const now = Date.now();
    // Prevent duplicate firing if both pointerdown and mousedown (or window + document) are received for the same interaction
    if (now - lastMouseDownTs < 20 && event.clientX === lastMouseDownX && event.clientY === lastMouseDownY && event.type === 'mousedown') {
      return;
    }
    lastMouseDownTs = now;
    lastMouseDownX = event.clientX;
    lastMouseDownY = event.clientY;
    updateLastMouse(event);
    const b = event.button || 0;
    sendCursorData(event, 'mousedown', { button: b, buttonType: b === 2 ? 'right' : (b === 1 ? 'middle' : 'left') });
  }

  function handleClick(event) {
    if (!isTracking || isCameraOverlayTarget(event)) return;
    const now = Date.now();
    if (now - lastClickTs < 20 && event.clientX === lastClickX && event.clientY === lastClickY) return;
    lastClickTs = now;
    lastClickX = event.clientX;
    lastClickY = event.clientY;
    updateLastMouse(event);
    clickCount++;
    const b = event.button || 0;
    const bType = b === 2 ? 'right' : (b === 1 ? 'middle' : 'left');
    console.log('[Content] 🖱️ Click #' + clickCount + ' (' + bType + ') at:', event.clientX, event.clientY);
    sendCursorData(event, 'click', { button: b, buttonType: bType });
  }

  function handleContextMenu(event) {
    if (!isTracking || isCameraOverlayTarget(event)) return;
    updateLastMouse(event);
    clickCount++;
    console.log('[Content] 🖱️ Right Click #' + clickCount + ' at:', event.clientX, event.clientY);
    sendCursorData(event, 'click', { button: 2, buttonType: 'right' });
  }

  function handleAuxClick(event) {
    if (!isTracking || event.button !== 1 || isCameraOverlayTarget(event)) return;
    updateLastMouse(event);
    clickCount++;
    console.log('[Content] 🖱️ Middle Click #' + clickCount + ' at:', event.clientX, event.clientY);
    sendCursorData(event, 'click', { button: 1, buttonType: 'middle' });
  }

  function handleDoubleClick(event) {
    if (!isTracking || isCameraOverlayTarget(event)) return;
    updateLastMouse(event);
    console.log('[Content] 🖱️🖱️ Double click at:', event.clientX, event.clientY);
    sendCursorData(event, 'doubleclick', { button: event.button || 0, buttonType: 'double' });
  }

  function handleScroll(event) {
    if (!isTracking) return;
    
    // Wheel events carry the real pointer position; keep it current
    if (event && event.type === 'wheel') {
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
      }
      if (Number.isFinite(event.screenX) && Number.isFinite(event.screenY) && (event.screenX !== 0 || event.screenY !== 0)) {
        lastMouseScreenX = event.screenX;
        lastMouseScreenY = event.screenY;
      }
    }

    if (!Number.isFinite(lastMouseX) || !Number.isFinite(lastMouseY)) return;
    
    const now = Date.now();
    // Allow scroll events at most every 80ms to avoid flooding
    if (now - lastScrollSendTime < 80) return;
    
    lastScrollSendTime = now;
    
    sendCursorData(
      {
        clientX: lastMouseX,
        clientY: lastMouseY,
        screenX: lastMouseScreenX,
        screenY: lastMouseScreenY,
        button: 0
      },
      'scroll',
      {
        scrollX: window.scrollX,
        scrollY: window.scrollY
      }
    );
  }

  function handleKeyDown(event) {
    if (!isTracking) return;
    
    // Alt+Shift+S (Option+Shift+S on Mac) - Stop Recording
    if (event.altKey && event.shiftKey && (event.code === 'KeyS' || event.key === 'S' || event.key === 's')) {
      event.preventDefault();
      event.stopPropagation();
      console.log('[Content] ⏹️ Stop recording shortcut triggered (Alt+Shift+S)');
      safeChromeCall(() => chrome.runtime.sendMessage({ action: 'shortcutStopRecording' }), () => {});
      return;
    }
    
    // Alt+Shift+P (Option+Shift+P on Mac) - Toggle Pause/Resume Recording
    if (event.altKey && event.shiftKey && (event.code === 'KeyP' || event.key === 'P' || event.key === 'p')) {
      event.preventDefault();
      event.stopPropagation();
      console.log('[Content] ⏸️ Pause/Resume shortcut triggered (Alt+Shift+P)');
      safeChromeCall(() => chrome.runtime.sendMessage({ action: 'shortcutTogglePause' }), () => {});
      return;
    }
  }

  function sendCursorData(event, type, extraData = {}) {
    const coords = calculateCoordinates(event.clientX, event.clientY, event.screenX, event.screenY);
    
    // Get element info for click context (safely without text content)
    let elementInfo = null;
    if (type === 'click' || type === 'doubleclick' || type === 'mousedown') {
      const target = event.target;
      elementInfo = {
        tagName: target?.tagName?.toLowerCase(),
        className: target?.className?.toString().slice(0, 50),
        id: target?.id
      };
    }
    
    // Attach top-frame windowMetrics on every top-level cursor event so multi-window ("Entire Screen")
    // and "Window" captures always carry exact window geometry even after syncRecordingStartTime or window switches
    let windowMetrics = null;
    if (!coords.isCrossOriginSubframe) {
      const widthDelta = Math.max(0, coords.outerWidth - coords.viewportWidth);
      const hasDockedDevTools = widthDelta > 24 ||
                                (coords.outerHeight - coords.viewportHeight) > 150;
      const topBarHeight = (hasDockedDevTools && lastMeasuredTopChrome !== null)
        ? lastMeasuredTopChrome
        : Math.max(0, Math.min(120, coords.outerHeight - coords.viewportHeight));
      const leftChromeWidth = hasDockedDevTools
        ? (lastMeasuredLeftChrome !== null ? lastMeasuredLeftChrome : (widthDelta > 24 && widthDelta <= 120 ? widthDelta : 0))
        : 0;
      const screenObj = window.screen || (typeof screen !== 'undefined' ? screen : {}) || {};
      windowMetrics = {
        screenX: coords.windowLeft,
        screenY: coords.windowTop,
        outerWidth: coords.outerWidth,
        outerHeight: coords.outerHeight,
        innerWidth: coords.viewportWidth,
        innerHeight: coords.viewportHeight,
        topBarHeight,
        leftChromeWidth,
        sideBorderWidth: 0,
        screenWidth: coords.screenWidth,
        screenHeight: coords.screenHeight,
        availWidth: screenObj.availWidth || coords.screenWidth,
        availHeight: screenObj.availHeight || coords.screenHeight,
        availLeft: coords.availLeft,
        availTop: coords.availTop,
        screenAvailLeft: coords.availLeft,
        screenAvailTop: coords.availTop,
        devicePixelRatio: window.devicePixelRatio || 1
      };
      lastSentMetrics = windowMetrics;
    }
    
    const data = {
      action: 'cursorMove',
      x: coords.clientX,
      y: coords.clientY,
      button: event.button !== undefined ? event.button : 0,
      buttonType: event.button === 2 ? 'right' : (event.button === 1 ? 'middle' : 'left'),
      ...extraData,
      normalizedX: coords.normTabX,
      normalizedY: coords.normTabY,
      screenX: coords.screenX,
      screenY: coords.screenY,
      windowX: coords.windowX,
      windowY: coords.windowY,
      normTabX: coords.normTabX,
      normTabY: coords.normTabY,
      normWindowX: coords.normWindowX,
      normWindowY: coords.normWindowY,
      normScreenX: coords.normScreenX,
      normScreenY: coords.normScreenY,
      ...(coords.isCrossOriginSubframe ? {
        isCrossOriginSubframe: true,
        rawScreenX: coords.rawScreenX,
        rawScreenY: coords.rawScreenY
      } : {}),
      ...(windowMetrics ? { windowMetrics } : {}),
      devicePixelRatio: window.devicePixelRatio || 1,
      type: type,
      timestamp: Date.now(),
      viewportWidth: coords.viewportWidth,
      viewportHeight: coords.viewportHeight,
      elementInfo: elementInfo
    };
    
    // Preferred: Stream directly over persistent Port (instant, zero overhead, never closes)
    const port = ensureCursorStreamPort();
    if (port) {
      try {
        port.postMessage(data);
        if (type === 'click' || type === 'doubleclick' || type === 'mousedown') {
          console.log('[Content] 🖱️ ' + type + ' streamed via port:', data.x, data.y);
        }
        return;
      } catch (err) {
        cursorStreamPort = null;
        // Fall through to sendMessage
      }
    }
    
    // Fallback: one-off sendMessage
    safeChromeCall(() => chrome.runtime.sendMessage(data), (error) => {
      // Ignored - transient drop is acceptable, listeners stay active!
    }).then(response => {
      if ((type === 'click' || type === 'doubleclick' || type === 'mousedown') && response) {
        console.log('[Content] ' + type + ' sent to background, response:', response);
      }
    }).catch(() => {
      // Error already handled in safeChromeCall
    });
  }

  function stopTracking() {
    if (!isTracking) return;
    
    console.log('[Content] 🛑 Stopping cursor tracking. Total clicks:', clickCount, 'Total moves:', moveCount);
    isTracking = false;

    if (windowGeometryPollInterval) {
      clearInterval(windowGeometryPollInterval);
      windowGeometryPollInterval = null;
    }

    if (cursorStreamPort) {
      try {
        cursorStreamPort.disconnect();
      } catch (e) {}
      cursorStreamPort = null;
    }

    if (mouseMoveTimeout) {
      clearTimeout(mouseMoveTimeout);
      mouseMoveTimeout = null;
    }
    // Remove event listeners on both window and document with EXACT same options as addEventListener
    window.removeEventListener('mousemove', handleMouseMove, PASSIVE_CAPTURE);
    window.removeEventListener('pointermove', handleMouseMove, PASSIVE_CAPTURE);
    window.removeEventListener('pointerover', handleMouseMove, PASSIVE_CAPTURE);
    window.removeEventListener('mouseover', handleMouseMove, PASSIVE_CAPTURE);
    document.removeEventListener('mousemove', handleMouseMove, PASSIVE);
    window.removeEventListener('resize', syncTopWindowMetrics, PASSIVE);
    
    window.removeEventListener('click', handleClick, true);
    window.removeEventListener('mousedown', handleMouseDown, true);
    window.removeEventListener('pointerdown', handleMouseDown, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('mousedown', handleMouseDown, true);
    
    window.removeEventListener('dblclick', handleDoubleClick, true);
    document.removeEventListener('dblclick', handleDoubleClick, true);
    
    window.removeEventListener('contextmenu', handleContextMenu, true);
    window.removeEventListener('auxclick', handleAuxClick, true);
    document.removeEventListener('contextmenu', handleContextMenu, true);
    document.removeEventListener('auxclick', handleAuxClick, true);
    
    window.removeEventListener('scroll', handleScroll, PASSIVE_CAPTURE);
    window.removeEventListener('wheel', handleScroll, PASSIVE_CAPTURE);
    document.removeEventListener('scroll', handleScroll, PASSIVE_CAPTURE);
    document.removeEventListener('wheel', handleScroll, PASSIVE_CAPTURE);
    
    window.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('keydown', handleKeyDown, true);
  }

  // Always active tab focus, visibility, and storage listeners to resume tracking across all windows/tabs
  function checkAndResumeTracking() {
    if (!isExtensionContextValid()) return;
    try {
      chrome.storage.local.get(['isRecording'], (result) => {
        if (chrome.runtime?.lastError) return;
        if (result && result.isRecording) {
          if (!isTracking) {
            console.log('[Content] 🔄 Active recording detected, starting tracking');
            startTracking();
          } else if (document.visibilityState === 'visible') {
            syncTopWindowMetrics();
          }
        } else if ((!result || !result.isRecording) && isTracking) {
          console.log('[Content] ⏹️ Recording ended in storage, stopping tracking');
          stopTracking();
        }
      });
    } catch (e) {}
  }

  try {
    if (isExtensionContextValid() && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.isRecording) return;
        if (changes.isRecording.newValue) {
          if (!isTracking) {
            console.log('[Content] 🟢 Recording started in storage, arming tracking immediately');
            startTracking();
          } else if (document.visibilityState === 'visible') {
            syncTopWindowMetrics();
          }
        } else if (isTracking) {
          console.log('[Content] 🔴 Recording stopped in storage, stopping tracking');
          stopTracking();
        }
      });
    }
  } catch (e) {}

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAndResumeTracking();
    }
  });
  window.addEventListener('focus', checkAndResumeTracking);

  // Periodic heartbeat guard: check every 2.5s to ensure tracking stays active during entire recording
  setInterval(checkAndResumeTracking, 2500);

  // Listen for messages from background/record page
  try {
    if (isExtensionContextValid()) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[Content] Received message:', message.action);
        
        if (message.action === 'startTracking') {
          startTracking();
          sendResponse({ success: true, windowMetrics: buildTopWindowMetrics() });
        }
        
        if (message.action === 'stopTracking') {
          stopTracking();
          sendResponse({ success: true });
        }

        if (message.action === 'getWindowMetrics') {
          sendResponse({ success: true, windowMetrics: buildTopWindowMetrics() });
          return true;
        }
        
        // Handle ping from background script
        if (message.action === 'ping') {
          sendResponse({ success: true, windowMetrics: buildTopWindowMetrics() });
          return true;
        }
        
        return true;
      });
    }
  } catch (error) {
    console.warn('[Content] Could not set up message listener:', error);
  }

  // Auto-start tracking if recording is already in progress
  safeChromeCall(() => chrome.storage.local.get(['isRecording']), () => {}).then(result => {
    if (result && result.isRecording) {
      console.log('[Content] Recording in progress, auto-starting tracking');
      startTracking();
    }
  }).catch(() => {
    // Extension context may be invalid
  });
  
  // Detect navigation events and notify background script
  // This helps track clicks across page navigations
  let lastUrl = window.location.href;
  
  // Monitor URL changes (for SPA navigation)
  const checkUrlChange = () => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      console.log('[Content] URL changed to:', currentUrl);
      
      // Notify background script about navigation
      safeChromeCall(() => chrome.runtime.sendMessage({
        action: 'pageNavigated',
        url: currentUrl,
        timestamp: Date.now()
      }), () => {}).catch(() => {
        // Ignore errors
      });
      
      // Re-check if recording is active and restart tracking
      safeChromeCall(() => chrome.storage.local.get(['isRecording']), () => {}).then(result => {
        if (result && result.isRecording && !isTracking) {
          console.log('[Content] Recording active after navigation, re-starting tracking');
          startTracking();
        }
      }).catch(() => {});
    }
  };
  
  // Check for URL changes periodically (for SPA navigation)
  urlCheckInterval = setInterval(checkUrlChange, 500);
  
  // Also listen for popstate (back/forward navigation)
  window.addEventListener('popstate', () => {
    setTimeout(checkUrlChange, 100);
  });
  
  // Listen for pushstate/replacestate (programmatic navigation)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    originalPushState.apply(history, args);
    setTimeout(checkUrlChange, 100);
  };
  
  history.replaceState = function(...args) {
    originalReplaceState.apply(history, args);
    setTimeout(checkUrlChange, 100);
  };
}
