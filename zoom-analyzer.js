/**
 * CursorDemo Screen Recorder
 * Copyright (c) 2026 CursorDemo Contributors
 * GitHub: https://github.com/cursordemo/cursordemo-screen-recorder
 *
 * Licensed under the MIT License.
 */

// Zoom Analyzer - Cinematic click-anticipating zoom for demo recordings
// Zooms in before first click, stays zoomed and PANS between clicks,
// only zooms out if 5+ seconds gap before next click

class ZoomAnalyzer {
  static get DEFAULTS() {
    return {
      shallow: 1.40,
      moderate: 1.75,
      deep: 2.20,
      maximum: 2.80
    };
  }

  constructor(options = {}) {
    // Zoom settings
    this.ZOOM_LEVEL = Number.isFinite(options.zoomLevel)
      ? options.zoomLevel
      : (Number.isFinite(options.ZOOM_LEVEL) ? options.ZOOM_LEVEL : 1.75); // Cinematic, clear magnification
    this.SCROLL_ZOOM_LEVEL = 1.40;   // Smooth zoom for scroll interactions
    
    // Timing
    this.ANTICIPATE_TIME = 1000;    // Start zooming 1.0s before click
    this.HOLD_AFTER_CLICK = 750;    // Hold zoom after click so action is clearly visible
    this.TRANSITION_IN = 650;       // Snappy, smooth zoom-in duration (ms)
    this.TRANSITION_OUT = 700;      // Natural deceleration zoom-out duration (ms)
    this.PAN_DURATION = 750;        // Maximum time to pan between clicks (ms)
    
    // Gap and pacing thresholds
    this.ZOOM_OUT_GAP = 3500;       // 3.5 seconds idle gap triggers zoom out
    this.MAX_SEGMENT_DURATION = 10000; // 10s max duration for a continuous zoom segment
    this.MAX_CLICKS_PER_SEGMENT = 8;  // Up to 8 interactions before zooming out to establish overview
    
    // Scroll burst grouping: aggregate rapid scroll events within this window (ms)
    this.SCROLL_BURST_WINDOW = 800;
    this.displaySurface = options.displaySurface || null;
    this.cameraStyle = options.cameraStyle || 'smooth';
    this.adaptiveEdgeZoom = options.adaptiveEdgeZoom !== undefined ? !!options.adaptiveEdgeZoom : true; // Progressive edge/corner focal boost & boundary tracking
  }

  /**
   * Boundary clamp helper (OpenScreen focusUtils.ts compatible).
   * Preserves 1:1 linear focus tracking across [min, max] and reaches the exact edge
   * at min and max without nonlinear mid-zone warping.
   */
  static softClampToRange(value, min, max) {
    if (min >= max) return (min + max) * 0.5;
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Logarithmic (geometric) scale interpolation ported from OpenScreen (mathUtils.ts).
   * Keeps perceived zoom speed constant across magnification levels.
   */
  static scaleLerp(startScale, endScale, t) {
    const clampedT = Math.max(0, Math.min(1, t));
    if (clampedT <= 0) return startScale;
    if (clampedT >= 1) return endScale;
    const safeStart = Math.max(1.0, startScale);
    const safeEnd = Math.max(1.0, endScale);
    if (Math.abs(safeEnd - safeStart) < 1e-5) return safeEnd;
    return Math.exp(Math.log(safeStart) + (Math.log(safeEnd) - Math.log(safeStart)) * clampedT);
  }

  /**
   * Resolve valid camera focus coordinates constrained to the zoom viewport bounds
   * (ported from OpenScreen crates/compositor/src/regions.rs clamp_focus_to_scale).
   * Preserves full zoom magnification at edges and corners while keeping the crop window
   * strictly inside [0, videoWidth] x [cropTop, videoHeight] with 1:1 linear precision.
   */
  resolveFocusCoords(rawX, rawY, scale, videoWidth = 1920, videoHeight = 1080, cropTop = 0, useSoft = this.adaptiveEdgeZoom) {
    const crop = Math.max(0, Math.min(videoHeight * 0.4, cropTop || 0));
    const visibleH = Math.max(1, videoHeight - crop);
    const safeScale = Math.max(1.0, scale || 1.0);

    const rawFx = videoWidth > 0 ? Math.max(0, Math.min(1, rawX / videoWidth)) : 0.5;
    const rawFy = visibleH > 0 ? Math.max(0, Math.min(1, (rawY - crop) / visibleH)) : 0.5;

    const marginX = Math.min(0.5, 1 / (2 * safeScale));
    const marginY = Math.min(0.5, 1 / (2 * safeScale));
    const minX = marginX;
    const maxX = 1 - marginX;
    const minY = marginY;
    const maxY = 1 - marginY;

    const fx = useSoft
      ? ZoomAnalyzer.softClampToRange(rawFx, minX, maxX)
      : Math.max(minX, Math.min(maxX, rawFx));
    const fy = useSoft
      ? ZoomAnalyzer.softClampToRange(rawFy, minY, maxY)
      : Math.max(minY, Math.min(maxY, rawFy));

    return {
      fx,
      fy,
      x: fx * videoWidth,
      y: crop + fy * visibleH
    };
  }

  /**
   * Adaptive Boundary & Corner Focal Boost
   * Preserves full zoom magnification across the interior and progressively boosts
   * magnification when the cursor/click enters the outer boundary margins (left, right,
   * top, bottom edges and all 4 corners). This shrinks the half-viewport clamp window
   * (curHalfW / curHalfH) as the cursor moves toward 0% or 100%, allowing the camera
   * center to continuously pan and follow the cursor all the way to extreme edges and corners.
   */
  getAdaptiveBoundaryZoom(curX, curY, baseZoom, videoWidth = 1920, videoHeight = 1080, cropTop = 0) {
    if (!Number.isFinite(baseZoom) || baseZoom <= 1.0) return 1.0;
    if (!this.adaptiveEdgeZoom) return Math.max(1.05, +baseZoom.toFixed(3));

    const crop = Math.max(0, Math.min(videoHeight * 0.4, cropTop || 0));
    const visibleH = Math.max(1, videoHeight - crop);
    const normX = videoWidth > 0 ? Math.max(0, Math.min(1, curX / videoWidth)) : 0.5;
    const normY = visibleH > 0 ? Math.max(0, Math.min(1, (curY - crop) / visibleH)) : 0.5;

    const baseMargin = Math.min(0.48, 1 / (2 * Math.max(1.05, baseZoom)));
    if (baseMargin <= 1e-4) return Math.max(1.05, +baseZoom.toFixed(3));

    const penX = Math.max(0, (baseMargin - normX) / baseMargin, (normX - (1 - baseMargin)) / baseMargin);
    const penY = Math.max(0, (baseMargin - normY) / baseMargin, (normY - (1 - baseMargin)) / baseMargin);

    if (penX <= 0 && penY <= 0) {
      return Math.max(1.05, +baseZoom.toFixed(3));
    }

    const maxPen = Math.max(penX, penY);
    const minPen = Math.min(penX, penY);
    const u = Math.min(1, maxPen + 0.25 * minPen);
    // Strictly monotonic blend (45% linear + 55% smoothstep) so camera continues moving at every point in [0, baseMargin]
    const eased = 0.45 * u + 0.55 * (u * u * (3 - 2 * u));
    const cornerBonus = 0.06 * minPen;
    const boostRatio = (0.28 + cornerBonus) * eased;
    const boosted = Math.min(3.5, baseZoom * (1 + boostRatio));
    return Math.max(1.05, +boosted.toFixed(3));
  }

  /**
   * Resolve exact raw video pixel coordinates (0..videoWidth, 0..videoHeight)
   * for any cursor or click point across all capture surfaces (Tab, Window, Monitor).
   */
  static getPointSourceCoords(point, videoWidth = 1920, videoHeight = 1080, displaySurface = null) {
    if (!point) return { x: videoWidth / 2, y: videoHeight / 2, normX: 0.5, normY: 0.5 };

    const wm = point.windowMetrics || null;
    let surface = displaySurface || point.displaySurface || null;

    // Detect actual capture surface using aspect ratios and dimension scaling
    if (wm && wm.innerWidth && wm.innerHeight && videoWidth > 0 && videoHeight > 0) {
      const videoAspect = videoWidth / videoHeight;
      const tabAspect = wm.innerWidth / wm.innerHeight;
      const winAspect = (wm.outerWidth && wm.outerHeight) ? (wm.outerWidth / wm.outerHeight) : 0;
      const screenAspect = (wm.screenWidth && wm.screenHeight) ? (wm.screenWidth / wm.screenHeight) : 0;

      const diffTab = Math.abs(videoAspect - tabAspect);
      const diffWin = winAspect ? Math.abs(videoAspect - winAspect) : 999;
      const diffScreen = screenAspect ? Math.abs(videoAspect - screenAspect) : 999;

      const dpr = wm.devicePixelRatio || 1;
      const isScaledMonitorCapture = wm.screenWidth && wm.screenHeight &&
        diffScreen < 0.025 &&
        videoWidth >= Math.min(wm.screenWidth, 1280);
      const matchesScreenDims = wm.screenWidth && wm.screenHeight && (
        (Math.abs(videoWidth - wm.screenWidth) < 24 && Math.abs(videoHeight - wm.screenHeight) < 24) ||
        (Math.abs(videoWidth - wm.screenWidth * dpr) < 24 && Math.abs(videoHeight - wm.screenHeight * dpr) < 24) ||
        isScaledMonitorCapture
      );
      const isSmallerTab = (wm.screenWidth && wm.screenHeight)
        ? (wm.innerWidth < wm.screenWidth - 24 || wm.innerHeight < wm.screenHeight - 24)
        : true;
      const isSmallerWin = (wm.screenWidth && wm.screenHeight && wm.outerWidth && wm.outerHeight)
        ? (wm.outerWidth < wm.screenWidth - 24 || wm.outerHeight < wm.screenHeight - 24)
        : true;
      const matchesTabDims = (
        (Math.abs(videoWidth - wm.innerWidth) < 24 && Math.abs(videoHeight - wm.innerHeight) < 24) ||
        (Math.abs(videoWidth - wm.innerWidth * dpr) < 24 && Math.abs(videoHeight - wm.innerHeight * dpr) < 24)
      );
      const matchesWinDims = wm.outerWidth && wm.outerHeight && (
        (Math.abs(videoWidth - wm.outerWidth) < 24 && Math.abs(videoHeight - wm.outerHeight) < 24) ||
        (Math.abs(videoWidth - wm.outerWidth * dpr) < 24 && Math.abs(videoHeight - wm.outerHeight * dpr) < 24)
      );

      // If surface was defaulted to 'monitor' but video dimensions explicitly match a smaller tab or window,
      // override to prevent window-offset coordinate skew on non-fullscreen browser recordings.
      // Never override 'monitor' merely because a 16:9 Chrome window happens to be open when videoWidth/Height
      // is a fallback (1920x1080) or monitor stream on a 16:10 MacBook display.
      if (surface === 'monitor' || surface === 'screen') {
        if (!matchesScreenDims) {
          if (matchesTabDims && !matchesWinDims && isSmallerTab) {
            surface = 'browser';
          } else if (matchesWinDims && !matchesTabDims && isSmallerWin) {
            surface = 'window';
          } else if (diffScreen > 0.04 && !(videoWidth === 1920 && videoHeight === 1080 && !matchesTabDims && !matchesWinDims)) {
            if (matchesTabDims && diffTab <= diffWin) {
              surface = 'browser';
            } else if (matchesWinDims) {
              surface = 'window';
            }
          }
        }
      }

      // If explicit surface was not set, resolve true surface from aspect ratios:
      if (!surface) {
        const matchesScreen = diffScreen < 0.015 && matchesScreenDims;
        const matchesTab = diffTab < 0.035;
        const matchesWin = diffWin < 0.035;

        if (matchesScreen) {
          surface = 'monitor';
        } else if (matchesTab && diffTab <= diffWin) {
          surface = 'browser';
        } else if (matchesWin) {
          surface = 'window';
        } else if (diffTab < 0.06) {
          surface = 'browser';
        } else {
          // In browser extensions, recordings of web apps are window or tab
          // Defaulting to window or browser ensures 0.0-1.0 coordinate coverage without edge cropping
          surface = (diffTab < diffWin) ? 'browser' : 'window';
        }
      }
    }

    let normX = null;
    let normY = null;

    // 1. Tab / Webpage Viewport Capture
    if (surface === 'browser' || surface === 'tab') {
      if (point.normTabX !== undefined && !isNaN(point.normTabX) &&
          point.normTabY !== undefined && !isNaN(point.normTabY)) {
        normX = point.normTabX;
        normY = point.normTabY;
      }
    }

    // 2. Window Capture (with browser header / tabs / borders)
    else if (surface === 'window') {
      if (point.normWindowX !== undefined && !isNaN(point.normWindowX) &&
          point.normWindowY !== undefined && !isNaN(point.normWindowY)) {
        normX = point.normWindowX;
        normY = point.normWindowY;
      }
    }

    // 3. Monitor / Full Desktop Capture
    else if (surface === 'monitor' || surface === 'screen') {
      if (point.normScreenX !== undefined && !isNaN(point.normScreenX) &&
          point.normScreenY !== undefined && !isNaN(point.normScreenY)) {
        normX = point.normScreenX;
        normY = point.normScreenY;
      }
    }

    // Fallbacks if surface-specific coords are missing:
    if (normX === null) {
      if (point.normTabX !== undefined && !isNaN(point.normTabX) &&
          point.normTabY !== undefined && !isNaN(point.normTabY)) {
        normX = point.normTabX;
        normY = point.normTabY;
      } else if (point.normWindowX !== undefined && !isNaN(point.normWindowX) &&
                 point.normWindowY !== undefined && !isNaN(point.normWindowY)) {
        normX = point.normWindowX;
        normY = point.normWindowY;
      } else if (point.normScreenX !== undefined && !isNaN(point.normScreenX) &&
                 point.normScreenY !== undefined && !isNaN(point.normScreenY)) {
        normX = point.normScreenX;
        normY = point.normScreenY;
      } else if (point.normalizedX !== undefined && !isNaN(point.normalizedX) &&
                 point.normalizedY !== undefined && !isNaN(point.normalizedY)) {
        normX = point.normalizedX;
        normY = point.normalizedY;
      } else if (point.viewportX !== undefined && !isNaN(point.viewportX) &&
                 point.viewportY !== undefined && !isNaN(point.viewportY) &&
                 point.viewportX >= 0 && point.viewportX <= 1 &&
                 point.viewportY >= 0 && point.viewportY <= 1) {
        normX = point.viewportX;
        normY = point.viewportY;
      } else if (point.viewportWidth && point.viewportWidth > 0 && point.viewportHeight && point.viewportHeight > 0) {
        normX = (point.x ?? 0) / point.viewportWidth;
        normY = (point.y ?? 0) / point.viewportHeight;
      } else if (point.x !== undefined && point.y !== undefined) {
        if (videoWidth > 10 && videoHeight > 10 && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 && (!Number.isInteger(point.x) || !Number.isInteger(point.y))) {
          normX = point.x;
          normY = point.y;
        } else {
          normX = videoWidth > 0 ? point.x / videoWidth : 0.5;
          normY = videoHeight > 0 ? point.y / videoHeight : 0.5;
        }
      } else {
        normX = 0.5;
        normY = 0.5;
      }
    }

    // Clamp normalized coordinates to valid video bounds [0, 1] without arbitrary margin clipping
    normX = Math.max(0, Math.min(1, normX));
    normY = Math.max(0, Math.min(1, normY));

    return {
      x: normX * videoWidth,
      y: normY * videoHeight,
      normX,
      normY
    };
  }

  getPointSourceCoords(point, videoWidth = 1920, videoHeight = 1080) {
    return ZoomAnalyzer.getPointSourceCoords(point, videoWidth, videoHeight, this.displaySurface);
  }

  /**
   * Intelligent Demo Zoom Pacing for loaded videos or native OS window recordings without cursor telemetry.
   * Generates rhythmic, professional zoom moments across the video duration
   * focusing smoothly on focal quadrants (primary content, workspace, controls).
   */
  generatePacedDemoZooms(videoDurationSec = 30, videoWidth = 1920, videoHeight = 1080, cropTop = 0) {
    const duration = Math.max(1.5, videoDurationSec || 5);
    const crop = Math.max(0, Math.min(videoHeight * 0.4, cropTop || 0));
    const visibleH = Math.max(1, videoHeight - crop);
    const segments = [];

    // Short clip handling (< 10s, e.g., quick Window / Entire Screen test of a native app):
    if (duration < 10) {
      const totalMs = duration * 1000;
      const leadInMs = Math.round(Math.min(1500, Math.max(250, totalMs * 0.16)));
      const endMarginMs = Math.round(Math.min(1200, Math.max(250, totalMs * 0.14)));
      const segDur = Math.max(1000, Math.round(totalMs - leadInMs - endMarginMs));
      const cx = Math.round(0.46 * videoWidth);
      const cy = Math.round(crop + 0.44 * visibleH);
      segments.push({
        startTime: leadInMs,
        endTime: Math.min(Math.round(totalMs), leadInMs + segDur),
        zoomLevel: this.ZOOM_LEVEL || 1.35,
        centerX: cx,
        centerY: cy,
        startCursorX: cx,
        startCursorY: cy,
        positions: [{ x: cx, y: cy, timestamp: Math.round(leadInMs + segDur * 0.35) }],
        clickCount: 1,
        mode: 'fixed',
        isAutoPaced: true
      });
      console.log('[ZoomAnalyzer] ✅ Generated short-clip paced zoom segment for', duration.toFixed(1) + 's video');
      return segments;
    }
    
    // Establishing shot: hold full overview at 1.0x at start
    const startLeadInMs = Math.min(12000, Math.max(2500, duration * 0.04 * 1000));
    let cursor = startLeadInMs;
    const endMarginMs = Math.min(12000, Math.max(3000, duration * 0.03 * 1000));
    const maxEndMs = Math.max(cursor + 4000, duration * 1000 - endMarginMs);
    
    // Adaptive zoom duration & rest interval scaled to total video length:
    let segDuration = 5200;
    let restDuration = 4500;
    
    if (duration <= 90) {
      // 0 - 1.5 minutes: short demo pace (~1 zoom every 10s)
      segDuration = 5000;
      restDuration = 4500;
    } else if (duration <= 300) {
      // 1.5 - 5 minutes: product walkthrough pace (~1 zoom every 22s)
      segDuration = 5500;
      restDuration = 16000;
    } else if (duration <= 900) {
      // 5 - 15 minutes: tutorial pace (~1 zoom every 45s)
      segDuration = 6000;
      restDuration = 38000;
    } else if (duration <= 3600) {
      // 15 - 60 minutes: presentation pace (~1 zoom every 2-3 minutes)
      segDuration = 6500;
      restDuration = 120000;
    } else {
      // > 1 hour (up to 10 hours): chapter highlight pace (~24 highlight chapters)
      segDuration = 7000;
      const targetZooms = 24;
      restDuration = Math.max(120000, Math.floor((duration * 1000) / targetZooms) - segDuration);
    }
    
    const MAX_AUTO_PACED_ZOOMS = 32; // Absolute safety cap: never flood timeline or DOM
    
    const focalPoints = [
      { normX: 0.38, normY: 0.38 }, // Upper-left primary content
      { normX: 0.50, normY: 0.46 }, // Center workspace
      { normX: 0.65, normY: 0.40 }, // Right-side action/inspector panel
      { normX: 0.42, normY: 0.52 }  // Feature detail / modal area
    ];
    
    let focalIdx = 0;
    while (cursor + 4200 <= maxEndMs && segments.length < MAX_AUTO_PACED_ZOOMS) {
      const actualSegDur = Math.min(segDuration, maxEndMs - cursor);
      if (actualSegDur < 3000) break;
      
      const focal = focalPoints[focalIdx % focalPoints.length];
      focalIdx++;
      
      const cx = Math.round(focal.normX * videoWidth);
      const cy = Math.round(crop + focal.normY * visibleH);
      
      segments.push({
        startTime: Math.round(cursor),
        endTime: Math.round(cursor + actualSegDur),
        zoomLevel: this.ZOOM_LEVEL || 1.35,
        centerX: cx,
        centerY: cy,
        startCursorX: cx,
        startCursorY: cy,
        positions: [{ x: cx, y: cy, timestamp: Math.round(cursor + 800) }],
        clickCount: 1,
        mode: 'fixed',
        isAutoPaced: true
      });
      
      cursor += actualSegDur + restDuration;
    }
    
    console.log('[ZoomAnalyzer] ✅ Generated', segments.length, 'cinematic paced zoom segments across', (duration / 60).toFixed(1) + ' min video');
    return segments;
  }

  /**
   * Analyze cursor data - creates smart, pacing-aware zoom segments.
   * Stays zoomed and pans between clicks if they are close in time AND space.
   * Zooms out cleanly when:
   *  1. Gap to next click >= ZOOM_OUT_GAP (3.5s)
   *  2. Segment duration reaches MAX_SEGMENT_DURATION (6.5s) to avoid viewer fatigue in long recordings
   *  3. Clicks per segment reaches MAX_CLICKS_PER_SEGMENT (4) to reset context
   *  4. Clicks jump across the display (>28% screen width) to avoid jarring cross-screen pans
   *  5. Telemetry is missing: smoothly generates paced demo zooms across video duration
   */
  analyzeClicks(cursorData, videoWidth = 1920, videoHeight = 1080, displaySurface = null, videoDurationSec = 0, cropTop = 0) {
    this.cursorData = cursorData || [];
    this.displaySurface = displaySurface || this.displaySurface || null;
    this.invalidatePathCache();
    const crop = Math.max(0, Math.min(videoHeight * 0.4, cropTop || 0));
    const jumpThreshold = videoWidth * 0.28;
    console.log('[ZoomAnalyzer] Analyzing', (cursorData || []).length, 'cursor events, video duration:', videoDurationSec);
    console.log('[ZoomAnalyzer] Video dimensions:', videoWidth, 'x', videoHeight, 'Display surface:', this.displaySurface);
    
    // Sort raw clicks by timestamp and deduplicate rapid double-clicks / mousedown pairs
    // Exclude any clicks originating on the injected camera overlay element
    const rawClicks = (cursorData || []).filter(d => {
      if (d.type !== 'click' && d.type !== 'doubleclick' && d.type !== 'mousedown') return false;
      const elId = d.elementInfo?.id || d.target?.id;
      if (
        elId === 'cursordemo-camera-overlay' ||
        elId === 'cursordemo-camera-image' ||
        elId === 'cursorfly-camera-overlay' ||
        elId === 'cursorfly-camera-image'
      ) return false;
      return true;
    });
    rawClicks.sort((a, b) => a.timestamp - b.timestamp);

    let dedupedClicks = [];
    for (let i = 0; i < rawClicks.length; i++) {
      const c = rawClicks[i];
      const pCur = ZoomAnalyzer.getPointSourceCoords(c, videoWidth, videoHeight, this.displaySurface);
      if (dedupedClicks.length > 0) {
        const prev = dedupedClicks[dedupedClicks.length - 1];
        const dt = c.timestamp - prev.timestamp;
        const pPrev = ZoomAnalyzer.getPointSourceCoords(prev, videoWidth, videoHeight, this.displaySurface);
        const normDist = Math.hypot(
          (pCur.x - pPrev.x) / Math.max(1, videoWidth),
          (pCur.y - pPrev.y) / Math.max(1, videoHeight)
        );
        if (dt < 40 || (dt < 300 && normDist < 0.035)) {
          continue;
        }
      }
      dedupedClicks.push({ ...c });
    }

    // Filter out accidental trailing stop-recording click in the final 80ms
    if (videoDurationSec > 2 && dedupedClicks.length > 1) {
      const cutoffMs = (videoDurationSec * 1000) - 80;
      const filtered = dedupedClicks.filter(c => c.timestamp <= cutoffMs);
      if (filtered.length > 0) {
        dedupedClicks = filtered;
      }
    }

    // Aggregate scroll events into burst groups (each burst = one soft-zoom anchor)
    const scrollEvents = (cursorData || []).filter(d => d.type === 'scroll' || d.type === 'wheel');
    const scrollAnchors = [];
    if (scrollEvents.length > 0) {
      scrollEvents.sort((a, b) => a.timestamp - b.timestamp);
      let burstStart = scrollEvents[0];
      let burstEnd = scrollEvents[0];
      for (let i = 1; i < scrollEvents.length; i++) {
        const s = scrollEvents[i];
        if (s.timestamp - burstEnd.timestamp <= this.SCROLL_BURST_WINDOW) {
          burstEnd = s;
        } else {
          // Emit anchor at midpoint of burst
          const mid = burstStart.timestamp + (burstEnd.timestamp - burstStart.timestamp) / 2;
          scrollAnchors.push({ ...burstStart, timestamp: mid, type: 'scroll_burst', _isScrollBurst: true });
          burstStart = s;
          burstEnd = s;
        }
      }
      const mid = burstStart.timestamp + (burstEnd.timestamp - burstStart.timestamp) / 2;
      scrollAnchors.push({ ...burstStart, timestamp: mid, type: 'scroll_burst', _isScrollBurst: true });
    }

    // Detect cursor hover/dwell pauses AND active cursor exploration (edges, corners, UI tours)
    // both when no clicks exist AND during un-clicked cursor-movement periods before/between/after clicks.
    const track = this._getPositionTrack() || [];
    const dwellAnchors = [];
    const firstTrackT = track.length > 0 ? (track[0].timestamp || 0) : 0;
    const lastTrackT = track.length > 0 ? (track[track.length - 1].timestamp || 0) : 0;
    const trackSpanMs = Math.max(0, lastTrackT - firstTrackT);
    const hasMeaningfulTrackCoverage = !videoDurationSec || videoDurationSec < 3 ||
      (trackSpanMs >= videoDurationSec * 1000 * 0.30);

    if (track.length >= 2 && (hasMeaningfulTrackCoverage || dedupedClicks.length > 0 || scrollAnchors.length > 0)) {
      const primaryAnchors = [...dedupedClicks, ...scrollAnchors];
      const isNearPrimary = (ts, windowMs = 1150) =>
        primaryAnchors.some(a => Math.abs((a.timestamp || 0) - ts) < windowMs);

      // 1. Detect hover/dwell pauses where cursor settles on a UI region
      let dwellStart = null;
      for (let i = 0; i < track.length; i++) {
        const pt = track[i];
        if (!dwellStart) {
          dwellStart = pt;
          continue;
        }
        const coords = ZoomAnalyzer.getPointSourceCoords(pt, videoWidth, videoHeight, this.displaySurface);
        const startCoords = ZoomAnalyzer.getPointSourceCoords(dwellStart, videoWidth, videoHeight, this.displaySurface);
        const dist = Math.hypot(coords.x - startCoords.x, coords.y - startCoords.y);
        if (dist <= 55) {
          const elapsed = pt.timestamp - dwellStart.timestamp;
          if (elapsed >= 650) {
            const mid = Math.round(dwellStart.timestamp + elapsed * 0.5);
            if (!isNearPrimary(mid, 1150) && !dwellAnchors.some(a => Math.abs(a.timestamp - mid) < 1500)) {
              dwellAnchors.push({ ...dwellStart, timestamp: mid, type: 'dwell', _isDwell: true });
            }
            dwellStart = pt;
          }
        } else {
          dwellStart = pt;
        }
      }

      // 2. Detect active cursor exploration (moving to left/right/top/bottom edges, corners, or across UI)
      // during periods without clicks so cursor-follow works seamlessly whether the user clicks or just moves the mouse.
      let lastRefPt = track[0];
      let lastRefCoords = ZoomAnalyzer.getPointSourceCoords(lastRefPt, videoWidth, videoHeight, this.displaySurface);
      for (let i = 1; i < track.length; i++) {
        const pt = track[i];
        const coords = ZoomAnalyzer.getPointSourceCoords(pt, videoWidth, videoHeight, this.displaySurface);
        if (pt.type === 'click' || pt.type === 'doubleclick' || pt.type === 'mousedown' || isNearPrimary(pt.timestamp, 1050)) {
          lastRefPt = pt;
          lastRefCoords = coords;
          continue;
        }
        const dt = pt.timestamp - (lastRefPt.timestamp || 0);
        if (dt >= 1150) {
          const moveDist = Math.hypot(coords.x - lastRefCoords.x, coords.y - lastRefCoords.y);
          const isEdgeOrCorner = coords.normX <= 0.24 || coords.normX >= 0.76 || coords.normY <= 0.24 || coords.normY >= 0.76;
          const minMoveThreshold = isEdgeOrCorner
            ? Math.min(65, Math.max(24, videoWidth * 0.045))
            : Math.min(125, Math.max(45, videoWidth * 0.085));
          if (moveDist >= minMoveThreshold) {
            const ts = Math.max(250, Math.round(pt.timestamp));
            if (!dwellAnchors.some(a => Math.abs(a.timestamp - ts) < 1200)) {
              dwellAnchors.push({ ...pt, timestamp: ts, type: 'dwell', _isDwell: true });
              lastRefPt = pt;
              lastRefCoords = coords;
            }
          }
        }
      }

      // 3. Fallback for short continuous cursor-only recordings
      if (dedupedClicks.length === 0 && scrollAnchors.length === 0 && dwellAnchors.length === 0 && track.length >= 2 && trackSpanMs >= 400 && hasMeaningfulTrackCoverage) {
        const midIdx = Math.floor(track.length * 0.5);
        const midPt = track[midIdx];
        if (midPt) {
          dwellAnchors.push({
            ...midPt,
            timestamp: Math.max(300, midPt.timestamp || Math.round((firstTrackT + lastTrackT) * 0.5)),
            type: 'dwell',
            _isDwell: true
          });
        }
      }
    }

    console.log('[ZoomAnalyzer] Found', dedupedClicks.length, 'clicks,', scrollAnchors.length, 'scroll bursts,', dwellAnchors.length, 'dwell/exploration anchors');

    if (dedupedClicks.length === 0 && scrollAnchors.length === 0 && dwellAnchors.length === 0) {
      if (videoDurationSec && videoDurationSec >= 1.5) {
        console.log('[ZoomAnalyzer] No cursor telemetry found; generating intelligent paced demo zooms for', videoDurationSec, 's video');
        return this.generatePacedDemoZooms(videoDurationSec, videoWidth, videoHeight, crop);
      }
      console.log('[ZoomAnalyzer] No interactions found');
      return [];
    }

    // Merge scroll anchors and exploration/dwell anchors
    const clicks = [...dedupedClicks];
    for (const anchor of scrollAnchors) {
      const tooCloseToClick = dedupedClicks.some(c => Math.abs(c.timestamp - anchor.timestamp) < this.ANTICIPATE_TIME);
      if (!tooCloseToClick) {
        clicks.push(anchor);
      }
    }
    for (const anchor of dwellAnchors) {
      const tooClose = clicks.some(c => Math.abs(c.timestamp - anchor.timestamp) < this.ANTICIPATE_TIME);
      if (!tooClose) {
        clicks.push(anchor);
      }
    }
    clicks.sort((a, b) => a.timestamp - b.timestamp);

    // Group interactions into segments based on gap rule and maximum duration
    const segments = [];
    let currentSegment = null;
    const MAX_AUTO_SEGMENTS = 80; // Sensible upper limit on auto zoom cuts to prevent viewer fatigue and keep UI responsive
    
    for (let i = 0; i < clicks.length; i++) {
      if (segments.length >= MAX_AUTO_SEGMENTS) {
        console.log('[ZoomAnalyzer] Reached maximum auto-detected zoom segments cap (' + MAX_AUTO_SEGMENTS + ') for long session');
        break;
      }
      const click = clicks[i];
      const nextClick = clicks[i + 1];
      const clickTime = click.timestamp;
      
      // Get exact source coordinates (scroll bursts: use the real pointer
      // position from the move track, not the scroll event's stored value)
      let coords = ZoomAnalyzer.getPointSourceCoords(click, videoWidth, videoHeight, this.displaySurface);
      if (click._isScrollBurst) {
        const live = this.getCursorAtTime(clickTime, videoWidth, videoHeight, this.displaySurface);
        if (live) coords = { x: live.x, y: live.y, normX: videoWidth > 0 ? live.x / videoWidth : 0.5, normY: videoHeight > 0 ? live.y / videoHeight : 0.5 };
      }
      
      const clampedY = Math.max(crop, Math.min(videoHeight, coords.y));
      const position = {
        x: coords.x,
        y: clampedY,
        normalizedX: coords.normX,
        normalizedY: videoHeight > 0 ? clampedY / videoHeight : coords.normY,
        timestamp: clickTime,
        _isDwell: !!click._isDwell,
        _isScrollBurst: !!click._isScrollBurst
      };
      
      if (!currentSegment) {
        // Lead-in zoom anticipation: start transition smoothly before click
        // If click is very close to start of video, gracefully clamp lead-in so video doesn't open fully zoomed
        const isFirstSegment = segments.length === 0;
        const maxAnticipate = isFirstSegment 
          ? Math.min(this.ANTICIPATE_TIME, Math.max(300, clickTime)) 
          : this.ANTICIPATE_TIME;
        let segStartTime = Math.max(0, clickTime - maxAnticipate);

        // Ensure strictly non-overlapping timeline segments:
        // Guarantee at least 250ms of full-screen (1.0x) view between consecutive zoom segments
        if (segments.length > 0) {
          const prevSeg = segments[segments.length - 1];
          if (segStartTime < prevSeg.endTime + 250) {
            segStartTime = prevSeg.endTime + 250;
          }
        }

        // Anchor start cursor position cleanly
        let startCursorX = position.x;
        let startCursorY = position.y;
        if (cursorData && cursorData.length > 0) {
          const nearest = this.getCursorAtTime(segStartTime, videoWidth, videoHeight, this.displaySurface);
          if (nearest) {
            startCursorX = nearest.x;
            startCursorY = nearest.y;
          }
        }

        // Preserve full nominal zoom magnification across clicks and cursor exploration
        const segZoomLevel = click._isScrollBurst 
          ? this.SCROLL_ZOOM_LEVEL 
          : this.ZOOM_LEVEL;

        currentSegment = {
          startTime: segStartTime,
          positions: [position],
          zoomLevel: segZoomLevel,
          clickCount: 1,
          startCursorX,
          startCursorY,
          centerX: position.x,
          centerY: position.y,
          normalizedX: position.normalizedX,
          normalizedY: position.normalizedY,
          isScrollBurst: !!click._isScrollBurst,
          isDwell: !!click._isDwell,
          mode: 'follow'
        };
        console.log('[ZoomAnalyzer] Starting segment at click', i + 1,
                    isFirstSegment ? '(first segment lead-in)' : '',
                    '- segment from', (currentSegment.startTime / 1000).toFixed(2) + 's');
      } else {
        // Add click/anchor to current segment without degrading zoomLevel at edges/corners
        currentSegment.positions.push(position);
        currentSegment.clickCount++;
        if (!click._isScrollBurst && currentSegment.zoomLevel < this.ZOOM_LEVEL) {
          currentSegment.zoomLevel = this.ZOOM_LEVEL;
        }
        if (!click._isDwell) {
          currentSegment.isDwell = false;
        }
      }
      
      // Decide whether to end this segment:
      let shouldZoomOut = false;
      const gapToNext = nextClick ? (nextClick.timestamp - clickTime) : Infinity;

      if (!nextClick) {
        // Last anchor ends the segment
        shouldZoomOut = true;
      } else {
        // Condition 1: Natural pause / idle gap >= ZOOM_OUT_GAP (3.5s)
        if (gapToNext >= this.ZOOM_OUT_GAP) {
          shouldZoomOut = true;
        }
        
        // Condition 2: Max segment duration (prevents endless zooming in very long recordings)
        const segDurationSoFar = clickTime - currentSegment.startTime;
        if (segDurationSoFar >= this.MAX_SEGMENT_DURATION || currentSegment.clickCount >= this.MAX_CLICKS_PER_SEGMENT) {
          shouldZoomOut = true;
        }
      }
      
      if (shouldZoomOut) {
        // Extend hold if cursor continues actively moving immediately after the last anchor in this segment
        let activeTrailHoldMs = this.HOLD_AFTER_CLICK;
        if (!nextClick && track.length > 1) {
          for (let k = track.length - 1; k >= 0; k--) {
            const tp = track[k];
            if (tp.timestamp <= clickTime) break;
            if (tp.timestamp - clickTime <= 1800) {
              const tc = ZoomAnalyzer.getPointSourceCoords(tp, videoWidth, videoHeight, this.displaySurface);
              if (Math.hypot(tc.x - coords.x, tc.y - coords.y) > 36) {
                activeTrailHoldMs = Math.max(activeTrailHoldMs, (tp.timestamp - clickTime) + 450);
                break;
              }
            }
          }
        }

        // End segment - hold after click/anchor, then smoothly zoom out
        let proposedEndTime = clickTime + activeTrailHoldMs + this.TRANSITION_OUT;
        
        // If there's an upcoming next click, prevent overlapping into the next segment
        if (nextClick) {
          const nextClickTime = nextClick.timestamp;
          const maxAllowedEnd = nextClickTime - this.ANTICIPATE_TIME - 250;
          if (proposedEndTime > maxAllowedEnd) {
            const mid = (clickTime + nextClickTime) / 2;
            proposedEndTime = Math.max(clickTime + this.HOLD_AFTER_CLICK + 200, mid - 150);
          }
        }
        
        currentSegment.endTime = proposedEndTime;
        segments.push(currentSegment);
        console.log('[ZoomAnalyzer] Ending segment after click', i + 1,
                    '- hold until', ((clickTime + activeTrailHoldMs) / 1000).toFixed(2) + 's,',
                    'zoom out complete at', (currentSegment.endTime / 1000).toFixed(2) + 's',
                    '(' + currentSegment.clickCount + ' anchors in segment)');
        currentSegment = null;
      } else {
        console.log('[ZoomAnalyzer] Anchor', i + 1, '- staying zoomed, will follow/pan to next',
                    '(gap: ' + (gapToNext / 1000).toFixed(2) + 's)');
      }
    }
    
    // Handle any remaining segment
    if (currentSegment) {
      const lastClick = currentSegment.positions[currentSegment.positions.length - 1];
      currentSegment.endTime = lastClick.timestamp + this.HOLD_AFTER_CLICK + this.TRANSITION_OUT;
      segments.push(currentSegment);
    }
    
    // Clamp segment boundaries if video duration is known
    if (videoDurationSec && videoDurationSec > 0) {
      const maxMs = videoDurationSec * 1000;
      for (const seg of segments) {
        if (seg.endTime > maxMs) {
          seg.endTime = Math.max(seg.startTime + 500, maxMs);
        }
      }
    }
    
    console.log('[ZoomAnalyzer] ✅ Created', segments.length, 'zoom segments from', clicks.length, 'clicks');
    
    return segments;
  }

  /**
   * Compute the clamped plateau camera state (scale + focus coordinates) for a segment at `timestamp`.
   */
  _getSegmentPlateauState(segment, timestamp, videoWidth = 1920, videoHeight = 1080, crop = 0) {
    const visibleH = Math.max(1, videoHeight - crop);
    const centerX = videoWidth / 2;
    const centerY = crop + (visibleH / 2);
    const positions = segment.positions || [];
    const firstClickPosition = positions.length > 0 ? positions[0] : null;
    const mode = segment.mode || 'follow';
    let targetPlateauZoom = Math.max(1.01, segment.zoomLevel || segment.zoom || this.ZOOM_LEVEL);
    let rawX = centerX;
    let rawY = centerY;

    if (mode === 'fixed') {
      rawX = segment.centerX ?? (segment.normalizedX !== undefined ? segment.normalizedX * videoWidth : (firstClickPosition ? firstClickPosition.x : centerX));
      rawY = segment.centerY ?? (segment.normalizedY !== undefined ? segment.normalizedY * videoHeight : (firstClickPosition ? firstClickPosition.y : centerY));
      if (this.adaptiveEdgeZoom) {
        targetPlateauZoom = this.getAdaptiveBoundaryZoom(rawX, rawY, targetPlateauZoom, videoWidth, videoHeight, crop);
      }
    } else {
      const cam = this.getFollowCameraAt(segment, timestamp, videoWidth, videoHeight, crop);
      if (cam) {
        rawX = cam.x;
        rawY = cam.y;
        if (cam.zoom !== undefined && Number.isFinite(cam.zoom) && cam.zoom > 1.01) {
          targetPlateauZoom = cam.zoom;
        }
      } else if (positions.length > 1) {
        const pos = this.getPositionAtTime(timestamp, positions);
        rawX = pos.x;
        rawY = pos.y;
        if (this.adaptiveEdgeZoom) {
          targetPlateauZoom = this.getAdaptiveBoundaryZoom(rawX, rawY, targetPlateauZoom, videoWidth, videoHeight, crop);
        }
      } else {
        rawX = firstClickPosition ? firstClickPosition.x : (segment.centerX ?? centerX);
        rawY = firstClickPosition ? firstClickPosition.y : (segment.centerY ?? centerY);
        if (this.adaptiveEdgeZoom) {
          targetPlateauZoom = this.getAdaptiveBoundaryZoom(rawX, rawY, targetPlateauZoom, videoWidth, videoHeight, crop);
        }
      }
    }

    // Preserve 1:1 linear focus precision across [minX, maxX] and exact boundary clamping at [0, minX] / [maxX, 1].
    const resolved = this.resolveFocusCoords(rawX, rawY, targetPlateauZoom, videoWidth, videoHeight, crop, this.adaptiveEdgeZoom);

    return {
      scale: targetPlateauZoom,
      fx: resolved.fx,
      fy: resolved.fy,
      x: resolved.x,
      y: resolved.y,
      rawX,
      rawY
    };
  }

  /**
   * Synchronize consecutive connected follow segments so splitting a follow segment
   * preserves exact spring-damper position and velocity across the split boundary.
   */
  _syncConnectedFollowSegments(zoomSegments, videoWidth, videoHeight, cropTop = 0, connectedGapMs = 120) {
    if (!this.cursorData || this.cursorData.length === 0 || !Array.isArray(zoomSegments) || zoomSegments.length < 2) {
      return;
    }
    const crop = Math.max(0, Math.min(videoHeight * 0.4, cropTop || 0));
    for (let i = 0; i < zoomSegments.length; i++) {
      const seg = zoomSegments[i];
      const prev = i > 0 ? zoomSegments[i - 1] : null;
      const next = i < zoomSegments.length - 1 ? zoomSegments[i + 1] : null;
      const durSeg = Math.max(1, seg.endTime - seg.startTime);

      const isConnectedFromPrev = !!(
        prev &&
        (seg.mode || 'follow') === 'follow' &&
        (prev.mode || 'follow') === 'follow' &&
        (seg.startTime - prev.endTime) >= -50 &&
        (seg.startTime - prev.endTime) <= connectedGapMs
      );
      const isConnectedToNext = !!(
        next &&
        (seg.mode || 'follow') === 'follow' &&
        (next.mode || 'follow') === 'follow' &&
        (next.startTime - seg.endTime) >= -50 &&
        (next.startTime - seg.endTime) <= connectedGapMs
      );

      if (isConnectedFromPrev) {
        const durPrev = Math.max(1, prev.endTime - prev.startTime);
        seg._prevBridge = {
          bridgeStart: prev.endTime - Math.min(340, durPrev * 0.30),
          bridgeEnd: seg.startTime + Math.min(340, durSeg * 0.30),
          fromScale: Math.max(1.01, prev.zoomLevel || prev.zoom || this.ZOOM_LEVEL),
          toScale: Math.max(1.01, seg.zoomLevel || seg.zoom || this.ZOOM_LEVEL)
        };
      } else {
        seg._prevBridge = null;
      }

      if (isConnectedToNext) {
        const durNext = Math.max(1, next.endTime - next.startTime);
        seg._nextBridge = {
          bridgeStart: seg.endTime - Math.min(340, durSeg * 0.30),
          bridgeEnd: next.startTime + Math.min(340, durNext * 0.30),
          fromScale: Math.max(1.01, seg.zoomLevel || seg.zoom || this.ZOOM_LEVEL),
          toScale: Math.max(1.01, next.zoomLevel || next.zoom || this.ZOOM_LEVEL),
          nextStartTime: next.startTime
        };
      } else {
        seg._nextBridge = null;
      }

      if (isConnectedFromPrev) {
        const prevEntry = this._getFollowPathEntry(prev, videoWidth, videoHeight, crop);
        seg._prevFollowEndState = (prevEntry && prevEntry.path) ? prevEntry.path.endState : null;
      } else if (seg._prevFollowEndState) {
        seg._prevFollowEndState = null;
      }
    }
  }

  /**
   * Get zoom state for a specific timestamp.
   * Implements OpenScreen's homothetic camera interpolation and connected-region pan transitions:
   * - Preserves 100% of zoom magnification at left, right, top, bottom edges and all 4 corners.
   * - Interpolates camera center along cx(s) = 0.5 + (fx - 0.5) * (1 - 1/s) / (1 - 1/S) so zoom-in
   *   and zoom-out never suffer from intermediate crop-clamp kinks or sideways drift.
   * - Smoothly bridges split or touching segments (gap <= 120ms) without yo-yoing to 1.0x, while
   *   preserving full-screen 1.0x overview cuts when segments are separated by >= 250ms.
   */
  getZoomAtTime(timestamp, zoomSegments, videoWidth = 1920, videoHeight = 1080, cropTop = 0) {
    const crop = Math.max(0, Math.min(videoHeight * 0.4, cropTop || 0));
    const visibleH = Math.max(1, videoHeight - crop);
    const defaultCenterX = videoWidth / 2;
    const defaultCenterY = crop + (visibleH / 2);

    if (!zoomSegments || zoomSegments.length === 0) {
      return { active: false, level: 1.0, x: defaultCenterX, y: defaultCenterY, focusX: 0.5, focusY: 0.5, targetZoom: 1.0, strength: 0 };
    }

    const CONNECTED_GAP_MS = 120;
    this._syncConnectedFollowSegments(zoomSegments, videoWidth, videoHeight, crop, CONNECTED_GAP_MS);

    // 1. Check for connected/chained transition between consecutive segments (e.g. split segments or touching zooms)
    for (let i = 0; i < zoomSegments.length - 1; i++) {
      const segA = zoomSegments[i];
      const segB = zoomSegments[i + 1];
      const gap = segB.startTime - segA.endTime;
      if (gap >= -50 && gap <= CONNECTED_GAP_MS) {
        const durA = Math.max(1, segA.endTime - segA.startTime);
        const durB = Math.max(1, segB.endTime - segB.startTime);
        const leadA = Math.min(340, durA * 0.30);
        const tailB = Math.min(340, durB * 0.30);
        const bridgeStart = segA.endTime - leadA;
        const bridgeEnd = segB.startTime + tailB;

        if (timestamp >= bridgeStart && timestamp <= bridgeEnd && bridgeEnd > bridgeStart) {
          const bothFollow = (segA.mode || 'follow') === 'follow' && (segB.mode || 'follow') === 'follow';
          const panProgress = (timestamp - bridgeStart) / (bridgeEnd - bridgeStart);
          const panT = this.easeConnectedPan(panProgress);

          let currentZoomLevel;
          let interpX;
          let interpY;

          if (bothFollow && this.cursorData && this.cursorData.length > 0) {
            const scaleA = Math.max(1.01, segA.zoomLevel || segA.zoom || this.ZOOM_LEVEL);
            const scaleB = Math.max(1.01, segB.zoomLevel || segB.zoom || this.ZOOM_LEVEL);
            currentZoomLevel = ZoomAnalyzer.scaleLerp(scaleA, scaleB, panT);
            const activeSeg = timestamp < segB.startTime ? segA : segB;
            const cam = this.getFollowCameraAt(activeSeg, timestamp, videoWidth, videoHeight, crop);
            if (cam) {
              interpX = cam.x;
              interpY = cam.y;
            } else {
              const stateA = this._getSegmentPlateauState(segA, Math.min(timestamp, segA.endTime), videoWidth, videoHeight, crop);
              const stateB = this._getSegmentPlateauState(segB, Math.max(timestamp, segB.startTime), videoWidth, videoHeight, crop);
              interpX = stateA.rawX + (stateB.rawX - stateA.rawX) * panT;
              interpY = stateA.rawY + (stateB.rawY - stateA.rawY) * panT;
            }
          } else {
            const stateA = this._getSegmentPlateauState(segA, Math.min(timestamp, segA.endTime), videoWidth, videoHeight, crop);
            const stateB = this._getSegmentPlateauState(segB, Math.max(timestamp, segB.startTime), videoWidth, videoHeight, crop);
            currentZoomLevel = ZoomAnalyzer.scaleLerp(stateA.scale, stateB.scale, panT);
            const bothFixed = (segA.mode === 'fixed') && (segB.mode === 'fixed');
            if (bothFixed) {
              interpX = stateA.rawX + (stateB.rawX - stateA.rawX) * panT;
              interpY = stateA.rawY + (stateB.rawY - stateA.rawY) * panT;
            } else {
              interpX = stateA.x + (stateB.x - stateA.x) * panT;
              interpY = stateA.y + (stateB.y - stateA.y) * panT;
            }
          }

          const resolved = this.resolveFocusCoords(interpX, interpY, currentZoomLevel, videoWidth, videoHeight, crop, this.adaptiveEdgeZoom);

          return {
            active: currentZoomLevel > 1.005,
            level: Math.max(1.0, currentZoomLevel),
            x: resolved.x,
            y: resolved.y,
            focusX: resolved.fx,
            focusY: resolved.fy,
            targetZoom: currentZoomLevel,
            strength: 1.0
          };
        }
      }
    }

    // 2. Locate active segment containing `timestamp`
    let segIndex = -1;
    let low = 0;
    let high = zoomSegments.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const seg = zoomSegments[mid];
      if (timestamp < seg.startTime) {
        high = mid - 1;
      } else if (timestamp > seg.endTime) {
        low = mid + 1;
      } else {
        segIndex = mid;
        break;
      }
    }

    if (segIndex < 0) {
      for (let i = 0; i < zoomSegments.length; i++) {
        if (timestamp >= zoomSegments[i].startTime && timestamp <= zoomSegments[i].endTime) {
          segIndex = i;
          break;
        }
      }
    }

    if (segIndex < 0) {
      return { active: false, level: 1.0, x: defaultCenterX, y: defaultCenterY, focusX: 0.5, focusY: 0.5, targetZoom: 1.0, strength: 0 };
    }

    const segment = zoomSegments[segIndex];
    const prevSeg = segIndex > 0 ? zoomSegments[segIndex - 1] : null;
    const nextSeg = segIndex < zoomSegments.length - 1 ? zoomSegments[segIndex + 1] : null;
    const connectedFromPrev = !!(prevSeg && (segment.startTime - prevSeg.endTime) >= -50 && (segment.startTime - prevSeg.endTime) <= CONNECTED_GAP_MS);
    const connectedToNext = !!(nextSeg && (nextSeg.startTime - segment.endTime) >= -50 && (nextSeg.startTime - segment.endTime) <= CONNECTED_GAP_MS);

    const segmentDuration = Math.max(1, segment.endTime - segment.startTime);
    const inDuration = connectedFromPrev ? 0 : Math.min(this.TRANSITION_IN, segmentDuration * 0.35);
    const outDuration = connectedToNext ? 0 : Math.min(this.TRANSITION_OUT, segmentDuration * 0.35);
    const inEnd = segment.startTime + inDuration;
    const outStart = Math.max(inEnd, segment.endTime - outDuration);

    const plateau = this._getSegmentPlateauState(segment, timestamp, videoWidth, videoHeight, crop);

    let strength = 1.0;
    if (inDuration > 0 && timestamp < inEnd) {
      const inElapsed = Math.max(0, timestamp - segment.startTime);
      const inProgress = Math.min(1, inElapsed / inDuration);
      strength = this.easeSpring(inProgress);
    } else if (outDuration > 0 && timestamp > outStart) {
      const outElapsed = Math.max(0, timestamp - outStart);
      const actualOutDur = Math.max(1, segment.endTime - outStart);
      const outProgress = Math.min(1, outElapsed / actualOutDur);
      strength = 1.0 - this.easeSpring(outProgress);
    }

    const currentZoomLevel = ZoomAnalyzer.scaleLerp(1.0, plateau.scale, strength);

    // Homothetic camera center trajectory:
    // Guarantees cx in [1/(2*currentZoomLevel), 1 - 1/(2*currentZoomLevel)] at every instant of zoom-in/out
    const denom = 1 - (1 / Math.max(1.0001, plateau.scale));
    const numer = 1 - (1 / Math.max(1.0, currentZoomLevel));
    const alpha = denom > 1e-5 ? Math.max(0, Math.min(1, numer / denom)) : strength;

    const cx = 0.5 + (plateau.fx - 0.5) * alpha;
    const cy = 0.5 + (plateau.fy - 0.5) * alpha;

    const finalX = Math.max(0, Math.min(videoWidth, cx * videoWidth));
    const finalY = Math.max(crop, Math.min(videoHeight, crop + cy * visibleH));

    return {
      active: currentZoomLevel > 1.005,
      level: Math.max(1.0, currentZoomLevel),
      x: finalX,
      y: finalY,
      focusX: cx,
      focusY: cy,
      targetZoom: plateau.scale,
      strength
    };
  }

  /**
   * Catmull-Rom Cubic Spline with Fritsch-Carlson Monotone Tangent Clamping
   * Smooth continuous-curvature curve between p1 and p2 using control points p0 and p3.
   * Monotone tangent clamping mathematically guarantees zero overshoot or self-intersecting loops.
   */
  static catmullRom(p0, p1, p2, p3, t) {
    const chord = p2 - p1;
    let m1 = (p2 - p0) * 0.5;
    let m2 = (p3 - p1) * 0.5;
    
    // Fritsch-Carlson monotone tangent limits
    if (Math.abs(chord) < 1e-4) {
      m1 = 0;
      m2 = 0;
    } else {
      const maxSlope = Math.abs(chord) * 1.5;
      if (Math.abs(m1) > maxSlope) m1 = Math.sign(m1) * maxSlope;
      if (Math.abs(m2) > maxSlope) m2 = Math.sign(m2) * maxSlope;
    }
    
    // Cubic Hermite basis
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    
    return h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2;
  }

  /**
   * Clean, time-sorted cursor position track (cached).
   * - Supports both standard array format `[{ x, y, timestamp, type }, ...]` and
   *   object format `{ moves: [...], clicks: [...] }`.
   * - Scroll/wheel events are excluded when move/click samples exist: the pointer
   *   doesn't move while scrolling, and their position may be a stale/default value.
   * - Sorted by timestamp, since async messages can arrive out of order.
   */
  _getPositionTrack() {
    const rawData = this.cursorData;
    if (!rawData) return null;
    let data = rawData;
    if (!Array.isArray(rawData) && typeof rawData === 'object') {
      const moves = Array.isArray(rawData.moves) ? rawData.moves : [];
      const clicks = Array.isArray(rawData.clicks) ? rawData.clicks : [];
      data = moves.concat(clicks);
    }
    if (!Array.isArray(data) || data.length === 0) return null;
    if (this._trackRef === rawData && this._trackLen === data.length && this._track) return this._track;

    const isCameraOverlayEvent = (d) => {
      const elId = d?.elementInfo?.id || d?.target?.id;
      return (
        elId === 'cursordemo-camera-overlay' ||
        elId === 'cursordemo-camera-image' ||
        elId === 'cursorfly-camera-overlay' ||
        elId === 'cursorfly-camera-image'
      );
    };
    const hasPos = (d) => d.x !== undefined || d.normTabX !== undefined ||
      d.normScreenX !== undefined || d.normWindowX !== undefined || d.normalizedX !== undefined;
    let track = data.filter(d => d && Number.isFinite(d.timestamp) &&
      d.type !== 'scroll' && d.type !== 'wheel' && !isCameraOverlayEvent(d) && hasPos(d));
    if (track.length === 0) track = data.filter(d => d && Number.isFinite(d.timestamp) && !isCameraOverlayEvent(d));

    let sorted = true;
    for (let i = 1; i < track.length; i++) {
      if (track[i].timestamp < track[i - 1].timestamp) { sorted = false; break; }
    }
    if (!sorted) track = track.slice().sort((a, b) => a.timestamp - b.timestamp);

    this._track = track;
    this._trackRef = rawData;
    this._trackLen = data.length;
    return track;
  }

  /** Deduplicated click moments (mousedown+click pairs merged) from the position track. */
  _getClickMoments(videoWidth, videoHeight) {
    const track = this._getPositionTrack() || [];
    const key = track.length + '|' + videoWidth + '|' + videoHeight + '|' + (this.displaySurface || '');
    if (this._clickMomentsKey === key && this._clickMomentsRef === track) return this._clickMoments;
    const out = [];
    for (const d of track) {
      if (d.type !== 'click' && d.type !== 'doubleclick' && d.type !== 'mousedown') continue;
      const p = ZoomAnalyzer.getPointSourceCoords(d, videoWidth, videoHeight, this.displaySurface);
      if (out.length) {
        const prev = out[out.length - 1];
        const dt = d.timestamp - prev.t;
        const normDist = Math.hypot(
          (p.x - prev.x) / Math.max(1, videoWidth),
          (p.y - prev.y) / Math.max(1, videoHeight)
        );
        if (dt < 40 || (dt < 300 && normDist < 0.035)) continue;
      }
      out.push({ t: d.timestamp, x: p.x, y: p.y });
    }
    this._clickMoments = out;
    this._clickMomentsKey = key;
    this._clickMomentsRef = track;
    return out;
  }

  /**
   * Sample cursor coordinates at a given timestamp
   * Uses Catmull-Rom Cubic Spline Interpolation for silky continuous-curvature motion,
   * and smooth ease-in-out bridging across longer pauses (250ms–2000ms) so the cursor
   * highlight glides naturally into the next move/click without teleporting.
   */
  getCursorAtTime(timestamp, videoWidth = 1920, videoHeight = 1080, displaySurface = null) {
    const track = this._getPositionTrack();
    if (!track || track.length === 0) return null;
    const surface = displaySurface || this.displaySurface || null;
    let low = 0;
    let high = track.length - 1;
    let idx = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (track[mid].timestamp <= timestamp) {
        idx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (idx < 0) idx = 0;
    const c1 = track[idx];
    const p1 = ZoomAnalyzer.getPointSourceCoords(c1, videoWidth, videoHeight, surface);
    
    // Smoothly interpolate between adjacent cursor points when within a realistic interval (<250ms)
    if (idx < track.length - 1) {
      const c2 = track[idx + 1];
      const dt = c2.timestamp - c1.timestamp;
      if (dt > 0 && dt <= 250 && timestamp >= c1.timestamp && timestamp <= c2.timestamp) {
        const t = (timestamp - c1.timestamp) / dt;
        
        // Control points for Catmull-Rom spline
        let c0 = (idx > 0) ? track[idx - 1] : c1;
        if (c1.timestamp - c0.timestamp > 300) c0 = c1; // Clamped if preceded by pause
        
        let c3 = (idx + 2 < track.length) ? track[idx + 2] : c2;
        if (c3.timestamp - c2.timestamp > 300) c3 = c2; // Clamped if followed by pause
        
        const p0 = ZoomAnalyzer.getPointSourceCoords(c0, videoWidth, videoHeight, surface);
        const p2 = ZoomAnalyzer.getPointSourceCoords(c2, videoWidth, videoHeight, surface);
        const p3 = ZoomAnalyzer.getPointSourceCoords(c3, videoWidth, videoHeight, surface);
        
        let x = ZoomAnalyzer.catmullRom(p0.x, p1.x, p2.x, p3.x, t);
        let y = ZoomAnalyzer.catmullRom(p0.y, p1.y, p2.y, p3.y, t);
        
        // Tremor suppression deadband (Screen Studio / Cursorful feel):
        // Micro-displacements under 1.8px (sensor noise / stationary hand tremor)
        // are gently stabilized using linear progression to prevent spline vibration at rest.
        const segmentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (segmentDist < 1.8) {
          x = p1.x + (p2.x - p1.x) * t;
          y = p1.y + (p2.y - p1.y) * t;
        }
        
        x = Math.max(0, Math.min(videoWidth, x));
        y = Math.max(0, Math.min(videoHeight, y));
        
        return {
          x,
          y,
          normX: videoWidth > 0 ? x / videoWidth : 0.5,
          normY: videoHeight > 0 ? y / videoHeight : 0.5
        };
      } else if (dt > 250 && dt <= 2200 && timestamp >= c1.timestamp && timestamp <= c2.timestamp) {
        // When the user pauses between points (or only click events were recorded),
        // hold steady at p1 and glide smoothly over the last ~240ms into p2 so cursor highlight never teleports.
        const p2 = ZoomAnalyzer.getPointSourceCoords(c2, videoWidth, videoHeight, surface);
        const glideWindow = Math.min(260, Math.max(120, dt * 0.45));
        const glideStart = c2.timestamp - glideWindow;
        if (timestamp > glideStart) {
          const u = Math.max(0, Math.min(1, (timestamp - glideStart) / Math.max(1, glideWindow)));
          const easeU = 0.5 - 0.5 * Math.cos(Math.PI * u);
          const x = Math.max(0, Math.min(videoWidth, p1.x + (p2.x - p1.x) * easeU));
          const y = Math.max(0, Math.min(videoHeight, p1.y + (p2.y - p1.y) * easeU));
          return {
            x,
            y,
            normX: videoWidth > 0 ? x / videoWidth : 0.5,
            normY: videoHeight > 0 ? y / videoHeight : 0.5
          };
        }
      }
    }

    return {
      x: p1.x,
      y: p1.y,
      normX: p1.normX,
      normY: p1.normY
    };
  }

  /**
   * Resolve cursor position specifically for Cursor Highlight rendering (Preview & Export).
   * Falls back to active/nearest zoom segment focal target or viewport center when no
   * cursor telemetry exists (e.g., imported video file or native desktop app recording).
   */
  resolveCursorHighlightPos(timestamp, videoWidth = 1920, videoHeight = 1080, displaySurface = null, zoomSegments = null) {
    if (!this.cursorData || this.cursorData.length === 0) {
      return null;
    }
    const pos = this.getCursorAtTime(timestamp, videoWidth, videoHeight, displaySurface);
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      return pos;
    }
    return null;
  }

  /**
   * Smoothed cursor sample: symmetric 7-tap Gaussian window (±150ms) over the
   * spline-interpolated cursor path. Because recordings are processed after
   * capture, the window can include future samples, so it removes hand jitter
   * without adding lag.
   */
  getSteadicamCursorAtTime(timestamp, videoWidth = 1920, videoHeight = 1080, displaySurface = null) {
    if (!this.cursorData || this.cursorData.length === 0) return null;

    const centerSample = this.getCursorAtTime(timestamp, videoWidth, videoHeight, displaySurface);
    if (!centerSample) return null;
    if (this.cursorData.length <= 2) return centerSample;

    const offsets = [-150, -100, -50, 0, 50, 100, 150];
    const weights = [0.06, 0.12, 0.19, 0.26, 0.19, 0.12, 0.06];

    let sumX = 0;
    let sumY = 0;
    let totalWeight = 0;
    for (let i = 0; i < offsets.length; i++) {
      const sample = this.getCursorAtTime(timestamp + offsets[i], videoWidth, videoHeight, displaySurface);
      if (sample) {
        sumX += sample.x * weights[i];
        sumY += sample.y * weights[i];
        totalWeight += weights[i];
      }
    }
    if (totalWeight <= 0) return centerSample;

    return {
      x: Math.max(0, Math.min(videoWidth, sumX / totalWeight)),
      y: Math.max(0, Math.min(videoHeight, sumY / totalWeight))
    };
  }

  /**
   * Camera feel presets for Follow mode.
   *  - deadZone: fraction of the visible half-frame the cursor may wander
   *    from the camera centre before the camera moves (tripod feel).
   *  - omega: spring angular frequency (rad/s). Higher = snappier catch-up.
   *  - recenterMs: when the cursor rests off-centre, how quickly the camera
   *    re-frames it (one gentle settle, not continuous drift).
   *  - restDelayMs: how long the cursor must be still before re-framing.
   */
  static get CAMERA_PRESETS() {
    return {
      smooth:  { deadZone: 0.10, omega: 7.5, recenterMs: 380, restDelayMs: 220 },
      focused: { deadZone: 0.06, omega: 9.5, recenterMs: 280, restDelayMs: 180 },
      tight:   { deadZone: 0.03, omega: 12.0, recenterMs: 200, restDelayMs: 130 }
    };
  }

  getCameraPreset() {
    const presets = ZoomAnalyzer.CAMERA_PRESETS;
    return presets[this.cameraStyle] || presets.smooth;
  }

  /**
   * Build (and cache) a deterministic camera path for a Follow-mode segment.
   *
   * The path is simulated at a fixed 120Hz step from the segment start, so
   * the result for any timestamp is identical whether you scrub, play, or
   * export — preview and export stay in sync.
   *
   * 1. Boundary-tapered dead zone: holds steady while hovering in the interior,
   *    and smoothly collapses to zero near screen edges/corners so the camera
   *    reaches 100% of the left, right, top, bottom edges and all 4 corners.
   * 2. Clamped target state: prevents unconstrained target drift beyond viewport
   *    margins so reversing direction from an edge responds immediately.
   * 3. Distance-adaptive critically-damped spring: calm on micro-movements,
   *    brisk catch-up on cross-screen pans.
   * 4. Offline click magnetism: anticipates upcoming clicks and holds steady
   *    across the click moment so buttons/menus at edges or corners are rock-solid.
   */
  _buildFollowPath(segment, videoWidth, videoHeight, cropTop = 0, initialState = null) {
    const preset = this.getCameraPreset();
    const STEP = 1000 / 120;
    const t0 = segment.startTime;
    const t1 = segment._nextBridge
      ? Math.max(segment.endTime, segment._nextBridge.nextStartTime)
      : segment.endTime;
    const steps = Math.max(1, Math.ceil((t1 - t0) / STEP) + 1);
    const level = Math.max(1.01, segment.zoomLevel || segment.zoom || this.ZOOM_LEVEL);

    const crop = Math.max(0, Math.min(videoHeight * 0.4, cropTop || 0));
    const visibleH = Math.max(1, videoHeight - crop);

    const getZoomAtStep = (timeMs) => {
      if (
        segment._prevBridge &&
        timeMs >= segment._prevBridge.bridgeStart &&
        timeMs <= segment._prevBridge.bridgeEnd &&
        segment._prevBridge.bridgeEnd > segment._prevBridge.bridgeStart
      ) {
        const p = (timeMs - segment._prevBridge.bridgeStart) / (segment._prevBridge.bridgeEnd - segment._prevBridge.bridgeStart);
        return ZoomAnalyzer.scaleLerp(segment._prevBridge.fromScale, segment._prevBridge.toScale, this.easeConnectedPan(p));
      }
      if (
        segment._nextBridge &&
        timeMs >= segment._nextBridge.bridgeStart &&
        timeMs <= segment._nextBridge.bridgeEnd &&
        segment._nextBridge.bridgeEnd > segment._nextBridge.bridgeStart
      ) {
        const p = (timeMs - segment._nextBridge.bridgeStart) / (segment._nextBridge.bridgeEnd - segment._nextBridge.bridgeStart);
        return ZoomAnalyzer.scaleLerp(segment._nextBridge.fromScale, segment._nextBridge.toScale, this.easeConnectedPan(p));
      }
      return level;
    };

    const sample = (t) => {
      const live = this.getSteadicamCursorAtTime(t, videoWidth, videoHeight, this.displaySurface);
      if (live) return live;
      if (segment.positions && segment.positions.length > 0) {
        return this.getPositionAtTime(t, segment.positions);
      }
      return {
        x: segment.centerX !== undefined ? segment.centerX : (segment.startCursorX || videoWidth / 2),
        y: segment.centerY !== undefined ? segment.centerY : (segment.startCursorY || (crop + visibleH / 2))
      };
    };

    // Collect click anchors within this segment for offline click magnetism
    // (exclude exploration/dwell and scroll waypoints so continuous cursor movement is never locked stationary)
    const segClicks = [];
    if (Array.isArray(segment.positions)) {
      for (const p of segment.positions) {
        if (p._isDwell || p.isDwell || p._isScrollBurst || p.isScrollBurst) continue;
        const pt = p.timestamp !== undefined ? p.timestamp : p.time;
        if (Number.isFinite(pt) && Number.isFinite(p.x) && Number.isFinite(p.y)) {
          segClicks.push({ t: pt, x: p.x, y: p.y });
        }
      }
    }
    const trackClicks = this._getClickMoments(videoWidth, videoHeight) || [];
    for (const tc of trackClicks) {
      if (tc.t >= t0 - 150 && tc.t <= t1 + 150) {
        if (!segClicks.some(sc => Math.abs(sc.t - tc.t) < 240)) {
          segClicks.push(tc);
        }
      }
    }
    segClicks.sort((a, b) => a.t - b.t);

    const initState = initialState || segment._prevFollowEndState || null;

    // Anchor initial camera target at the first click if it falls within the lead-in window
    // (and this segment is not a continuation of a split/connected follow segment),
    // so the zoom-in ramp glides straight into the click target without chasing pre-click cursor travel.
    const rawFirst = sample(t0);
    const leadInClick = (
      !initState &&
      !segment._isSplitContinuation &&
      segClicks.length > 0 &&
      segClicks[0].t >= t0 &&
      segClicks[0].t <= t0 + this.ANTICIPATE_TIME + 350
    )
      ? segClicks[0]
      : null;
    const first = leadInClick ? { x: leadInClick.x, y: leadInClick.y } : rawFirst;

    const baseZoom0 = getZoomAtStep(t0);
    const adaptiveZoom0 = this.adaptiveEdgeZoom
      ? this.getAdaptiveBoundaryZoom(first.x, first.y, baseZoom0, videoWidth, videoHeight, crop)
      : baseZoom0;
    let camZoom = (initState && Number.isFinite(initState.camZoom)) ? initState.camZoom : adaptiveZoom0;
    let prevHalfW = videoWidth / (2 * camZoom);
    let prevHalfH = visibleH / (2 * camZoom);

    let targetX = Math.max(prevHalfW, Math.min(videoWidth - prevHalfW, initState ? initState.targetX : first.x));
    let targetY = Math.max(crop + prevHalfH, Math.min(videoHeight - prevHalfH, initState ? initState.targetY : first.y));
    let camX = Math.max(prevHalfW, Math.min(videoWidth - prevHalfW, initState ? initState.camX : targetX));
    let camY = Math.max(crop + prevHalfH, Math.min(videoHeight - prevHalfH, initState ? initState.camY : targetY));
    let velX = initState ? (initState.velX || 0) : 0;
    let velY = initState ? (initState.velY || 0) : 0;
    let prevCur = (initState && initState.prevCur) ? initState.prevCur : rawFirst;
    let restMs = initState ? (initState.restMs || 0) : 0;

    const w = preset.omega;
    const dtSec = STEP / 1000;
    const recenterK = 1 - Math.exp(-STEP / preset.recenterMs);
    const zoomLerpK = 1 - Math.exp(-w * 1.35 * dtSec);
    const restDelay = preset.restDelayMs || 220;

    const xs = new Float32Array(steps);
    const ys = new Float32Array(steps);
    const zs = new Float32Array(steps);

    const leadMs = Math.min(160, 1000 / w);

    for (let i = 0; i < steps; i++) {
      if (i === 0 && initState && Math.abs((initState.t ?? t0) - t0) < STEP) {
        xs[0] = camX;
        ys[0] = camY;
        zs[0] = camZoom;
        continue;
      }

      const t = t0 + i * STEP;
      const baseStepZoom = getZoomAtStep(t);
      const now = sample(t);
      const ahead = sample(t + leadMs);
      const isMoving = Math.hypot(ahead.x - now.x, ahead.y - now.y) > 3;
      let curX = isMoving ? ahead.x : now.x;
      let curY = isMoving ? ahead.y : now.y;

      // Offline Click Magnetism: pull focus smoothly into upcoming/active click and hold steady
      let clickMagnetWeight = 0;
      let magnetClick = null;
      for (let k = 0; k < segClicks.length; k++) {
        const ck = segClicks[k];
        const dtClick = t - ck.t; // negative before click, positive after click
        let wCk = 0;
        if (k === 0 && leadInClick && ck === leadInClick) {
          // Keep lead-in click locked throughout the entire zoom-in anticipation and click hold
          // so pre-click cursor travel from another part of the screen never yanks the camera away.
          if (dtClick <= 220) {
            wCk = 1.0;
          } else if (dtClick > 220 && dtClick <= 420) {
            const u = 1 - (dtClick - 220) / 200;
            wCk = u * u * (3 - 2 * u);
          }
        } else {
          const preWindow = k > 0
            ? Math.min(600, Math.max(120, ck.t - (segClicks[k - 1].t + 180)))
            : 600;
          if (dtClick >= -preWindow && dtClick <= 0) {
            const u = (dtClick + preWindow) / preWindow; // 0 -> 1 as t approaches click
            wCk = u * u * (3 - 2 * u);
          } else if (dtClick > 0 && dtClick <= 220) {
            wCk = 1.0;
          } else if (dtClick > 220 && dtClick <= 420) {
            const u = 1 - (dtClick - 220) / 200;
            wCk = u * u * (3 - 2 * u);
          }
        }
        if (wCk > clickMagnetWeight) {
          clickMagnetWeight = wCk;
          magnetClick = ck;
        }
      }

      if (magnetClick && clickMagnetWeight > 0) {
        curX = curX + (magnetClick.x - curX) * clickMagnetWeight;
        curY = curY + (magnetClick.y - curY) * clickMagnetWeight;
      }

      const desiredZoom = this.adaptiveEdgeZoom
        ? this.getAdaptiveBoundaryZoom(curX, curY, baseStepZoom, videoWidth, videoHeight, crop)
        : baseStepZoom;
      camZoom = camZoom + (desiredZoom - camZoom) * zoomLerpK;

      const curHalfW = videoWidth / (2 * camZoom);
      const curHalfH = visibleH / (2 * camZoom);

      // When zooming IN across a connected bridge (curHalfW < prevHalfW) while the camera is pinned at a boundary clamp,
      // glide the clamped camera & target along the relaxing boundary margin so cropX/cropY stay 0.0 without lag or step jump.
      if (curHalfW < prevHalfW) {
        if (curX < prevHalfW && camX <= prevHalfW + 1.5) {
          const nextLeft = Math.max(curX, curHalfW);
          targetX = Math.min(targetX, nextLeft);
          camX = Math.min(camX, nextLeft);
        } else if (curX > videoWidth - prevHalfW && camX >= videoWidth - prevHalfW - 1.5) {
          const nextRight = Math.min(curX, videoWidth - curHalfW);
          targetX = Math.max(targetX, nextRight);
          camX = Math.max(camX, nextRight);
        }
      }
      if (curHalfH < prevHalfH) {
        if (curY < crop + prevHalfH && camY <= crop + prevHalfH + 1.5) {
          const nextTop = Math.max(curY, crop + curHalfH);
          targetY = Math.min(targetY, nextTop);
          camY = Math.min(camY, nextTop);
        } else if (curY > videoHeight - prevHalfH && camY >= videoHeight - prevHalfH - 1.5) {
          const nextBottom = Math.min(curY, videoHeight - curHalfH);
          targetY = Math.max(targetY, nextBottom);
          camY = Math.max(camY, nextBottom);
        }
      }

      const rawSafeX = curHalfW * preset.deadZone;
      const rawSafeY = curHalfH * preset.deadZone;

      // Taper deadzone smoothly to 0 near screen edges & corners AND during click magnetism
      // so the camera reaches 100% of left/right/top/bottom edges and corners without stopping short.
      const distLeftMargin = Math.max(0, curX - curHalfW);
      const distRightMargin = Math.max(0, (videoWidth - curHalfW) - curX);
      const edgeFactorX = rawSafeX > 0 ? Math.min(1, Math.min(distLeftMargin, distRightMargin) / rawSafeX) : 1;

      const distTopMargin = Math.max(0, (curY - crop) - curHalfH);
      const distBottomMargin = Math.max(0, (videoHeight - curHalfH) - curY);
      const edgeFactorY = rawSafeY > 0 ? Math.min(1, Math.min(distTopMargin, distBottomMargin) / rawSafeY) : 1;

      const magnetDamp = 1 - 0.85 * clickMagnetWeight;
      const curSafeX = rawSafeX * edgeFactorX * magnetDamp;
      const curSafeY = rawSafeY * edgeFactorY * magnetDamp;

      const curLeashX = curHalfW * 0.80;
      const curLeashY = curHalfH * 0.80;
      const curClampX = (x) => Math.max(curHalfW, Math.min(videoWidth - curHalfW, x));
      const curClampY = (y) => Math.max(crop + curHalfH, Math.min(videoHeight - curHalfH, y));

      // Deadzone target push
      if (curX > targetX + curSafeX) targetX = curX - curSafeX;
      else if (curX < targetX - curSafeX) targetX = curX + curSafeX;
      if (curY > targetY + curSafeY) targetY = curY - curSafeY;
      else if (curY < targetY - curSafeY) targetY = curY + curSafeY;

      const speed = Math.hypot(now.x - prevCur.x, now.y - prevCur.y) / STEP; // px per ms
      restMs = speed < 0.05 ? restMs + STEP : 0;

      // Gently re-frame when resting or when magnetizing onto a click
      if (restMs > restDelay || clickMagnetWeight > 0.25) {
        const pullK = Math.max(recenterK, clickMagnetWeight * 0.25);
        targetX += (curX - targetX) * pullK;
        targetY += (curY - targetY) * pullK;
      }
      prevCur = now;

      // Clamp target state immediately so it never accumulates unconstrained overshoot past viewport edges
      targetX = curClampX(targetX);
      targetY = curClampY(targetY);

      const anchorX = targetX;
      const anchorY = targetY;

      // Distance-adaptive + boundary-overrun critically-damped spring step:
      // When cursor is inside the outer boundary margin (e.g. left sidebar or corner),
      // boost convergence so the camera reaches the exact edge without asymptotic lag
      // while keeping targetX strictly clamped to prevent reverse-direction windup.
      const distToAnchor = Math.hypot(anchorX - camX, anchorY - camY);
      const overrunX = Math.max(0, curHalfW - curX, curX - (videoWidth - curHalfW));
      const overrunY = Math.max(0, (crop + curHalfH) - curY, curY - (videoHeight - curHalfH));
      const overrunRatio = Math.min(1, Math.hypot(overrunX, overrunY) / Math.max(60, Math.min(curHalfW, curHalfH) * 0.5));
      const distRatio = Math.min(1, distToAnchor / Math.max(120, videoWidth * 0.30));
      const wStep = w * (1 + 0.65 * distRatio + 1.15 * overrunRatio);
      const decayStep = Math.exp(-wStep * dtSec);

      const ox = camX - anchorX;
      const oy = camY - anchorY;
      const tx = (velX + wStep * ox) * dtSec;
      const ty = (velY + wStep * oy) * dtSec;
      camX = anchorX + (ox + tx) * decayStep;
      camY = anchorY + (oy + ty) * decayStep;
      velX = (velX - wStep * tx) * decayStep;
      velY = (velY - wStep * ty) * decayStep;

      // Safety leash against the magnetized target cursor so rapid moves never leave the viewport
      // without fighting click magnetism during lead-in or click holds.
      if (curX > camX + curLeashX) camX = curX - curLeashX;
      else if (curX < camX - curLeashX) camX = curX + curLeashX;
      if (curY > camY + curLeashY) camY = curY - curLeashY;
      else if (curY < camY - curLeashY) camY = curY + curLeashY;
      camX = curClampX(camX);
      camY = curClampY(camY);

      prevHalfW = curHalfW;
      prevHalfH = curHalfH;

      xs[i] = camX;
      ys[i] = camY;
      zs[i] = camZoom;
    }

    const exactIdx = (t1 - t0) / STEP;
    const eIdx0 = Math.min(steps - 1, Math.max(0, Math.floor(exactIdx)));
    const eIdx1 = Math.min(steps - 1, eIdx0 + 1);
    const eFrac = Math.max(0, Math.min(1, exactIdx - eIdx0));
    const endCamX = xs[eIdx0] + (xs[eIdx1] - xs[eIdx0]) * eFrac;
    const endCamY = ys[eIdx0] + (ys[eIdx1] - ys[eIdx0]) * eFrac;
    const endCamZoom = zs[eIdx0] + (zs[eIdx1] - zs[eIdx0]) * eFrac;

    const endState = {
      t: t1,
      camX: endCamX,
      camY: endCamY,
      targetX,
      targetY,
      velX,
      velY,
      restMs,
      prevCur: sample(t1),
      camZoom: endCamZoom
    };

    return { t0, step: STEP, xs, ys, zs, endState };
  }

  /** Invalidate the cached follow-camera paths (e.g. when browser UI crop or follow settings change). */
  invalidatePathCache() {
    this._pathCache = null;
    this._pathCacheCursorRef = null;
  }

  /** Retrieve or build cached follow-camera path entry for a segment. */
  _getFollowPathEntry(segment, videoWidth, videoHeight, cropTop = 0) {
    if (!this.cursorData || this.cursorData.length === 0) return null;

    if (this._pathCacheCursorRef !== this.cursorData || !this._pathCache) {
      this._pathCache = new WeakMap();
      this._pathCacheCursorRef = this.cursorData;
    }
    const crop = Math.max(0, Math.min(videoHeight * 0.4, cropTop || 0));
    const firstPos = (segment.positions && segment.positions[0]) ? `${segment.positions[0].x},${segment.positions[0].y}` : '';
    const initState = segment._prevFollowEndState || null;
    const initSig = initState
      ? `${initState.t.toFixed(1)},${initState.camX.toFixed(2)},${initState.camY.toFixed(2)},${initState.velX.toFixed(2)},${initState.velY.toFixed(2)},${(initState.camZoom || 1).toFixed(3)}`
      : (segment._isSplitContinuation ? 'split' : '');
    const prevBridgeSig = segment._prevBridge
      ? `${segment._prevBridge.bridgeStart.toFixed(1)}-${segment._prevBridge.bridgeEnd.toFixed(1)}:${segment._prevBridge.fromScale.toFixed(3)}->${segment._prevBridge.toScale.toFixed(3)}`
      : '';
    const nextBridgeSig = segment._nextBridge
      ? `${segment._nextBridge.bridgeStart.toFixed(1)}-${segment._nextBridge.bridgeEnd.toFixed(1)}:${segment._nextBridge.fromScale.toFixed(3)}->${segment._nextBridge.toScale.toFixed(3)}@${segment._nextBridge.nextStartTime}`
      : '';
    const sig = [
      segment.startTime, segment.endTime, segment.zoomLevel || segment.zoom || this.ZOOM_LEVEL,
      videoWidth, videoHeight, crop, this.displaySurface || '', this.cameraStyle || 'smooth',
      this.adaptiveEdgeZoom ? 1 : 0,
      this.cursorData.length,
      firstPos,
      initSig,
      prevBridgeSig,
      nextBridgeSig
    ].join('|');

    let entry = this._pathCache.get(segment);
    if (!entry || entry.sig !== sig) {
      entry = { sig, path: this._buildFollowPath(segment, videoWidth, videoHeight, crop, initState) };
      this._pathCache.set(segment, entry);
    }
    return entry;
  }

  /** Camera centre for a Follow-mode segment at `timestamp` (cached). */
  getFollowCameraAt(segment, timestamp, videoWidth, videoHeight, cropTop = 0) {
    const entry = this._getFollowPathEntry(segment, videoWidth, videoHeight, cropTop);
    if (!entry || !entry.path) return null;

    const { t0, step, xs, ys, zs } = entry.path;
    const f = Math.max(0, Math.min(xs.length - 1, (timestamp - t0) / step));
    const i = Math.floor(f);
    const j = Math.min(xs.length - 1, i + 1);
    const a = f - i;
    return {
      x: xs[i] + (xs[j] - xs[i]) * a,
      y: ys[i] + (ys[j] - ys[i]) * a,
      zoom: (zs && zs.length > 0) ? (zs[i] + (zs[j] - zs[i]) * a) : undefined
    };
  }

  /**
   * Get smoothly interpolated position - purposeful camera panning between click locations
   */
  getPositionAtTime(timestamp, positions) {
    if (!positions || positions.length === 0) {
      return { x: 0, y: 0 };
    }
    
    if (positions.length === 1) {
      return { x: positions[0].x, y: positions[0].y };
    }
    
    const getTime = (p) => (p.timestamp !== undefined ? p.timestamp : (p.time !== undefined ? p.time : 0));

    // Before first click - stay at first position
    if (timestamp <= getTime(positions[0])) {
      return { x: positions[0].x, y: positions[0].y };
    }
    
    // After last click - stay at last position
    if (timestamp >= getTime(positions[positions.length - 1])) {
      const last = positions[positions.length - 1];
      return { x: last.x, y: last.y };
    }
    
    // Between clicks - smooth, purposeful pan
    for (let i = 0; i < positions.length - 1; i++) {
      const current = positions[i];
      const next = positions[i + 1];
      const currTime = getTime(current);
      const nextTime = getTime(next);
      
      if (timestamp >= currTime && timestamp <= nextTime) {
        const totalTime = nextTime - currTime;
        
        // Rapid clicks / double clicks stay stable without camera twitching
        if (totalTime < 350) {
          return { x: next.x, y: next.y };
        }
        
        const elapsed = timestamp - currTime;
        
        // Hold at current position to let viewer see interaction result, then pan
        const holdDuration = Math.min(this.HOLD_AFTER_CLICK, totalTime * 0.35);
        const remainingTime = Math.max(0, totalTime - holdDuration);
        // Distance-adaptive pan duration (Screen Studio Motion Law):
        // Short micro-pans (e.g. 60px) take ~420ms, while wide cross-screen pans (e.g. 1400px) take ~780ms.
        const dist = Math.hypot(next.x - current.x, next.y - current.y);
        const distFrac = Math.min(1, dist / 1100);
        const adaptivePan = 420 + 360 * this.cinematicEase(distFrac);
        const panDuration = Math.min(adaptivePan, remainingTime * 0.85);
        
        // Pan timing: starts after hold, settles before or at next click
        const panStart = holdDuration + (remainingTime - panDuration) * 0.25;
        const panEnd = panStart + panDuration;
        
        if (elapsed < panStart) {
          return { x: current.x, y: current.y };
        } else if (elapsed > panEnd) {
          return { x: next.x, y: next.y };
        } else {
          const panProgress = (elapsed - panStart) / panDuration;
          const eased = this. easeConnectedPan(panProgress);
          
          return {
            x: current.x + (next.x - current.x) * eased,
            y: current.y + (next.y - current.y) * eased
          };
        }
      }
    }
    
    // Fallback
    return { x: positions[0].x, y: positions[0].y };
  }

  // Easing functions
  /**
   * Critically-damped spring envelope ported from OpenScreen (mathUtils.ts easeSpring).
   * Starts smoothly with zero velocity kick and settles naturally without overshoot.
   */
  easeSpring(t) {
    const c = Math.max(0, Math.min(1, t));
    if (c <= 0) return 0;
    if (c >= 1) return 1;
    // Blend smootherstep start with critically-damped exponential settle (omega = 6.5)
    const expEnd = 1 - (1 + 6.5) * Math.exp(-6.5);
    const spring = (1 - (1 + 6.5 * c) * Math.exp(-6.5 * c)) / expEnd;
    const quintic = c * c * c * (c * (c * 6 - 15) + 10);
    // Smooth ramp-in over the first 25% so initial acceleration is gentle, then spring settle
    const blend = Math.min(1, c / 0.25);
    return quintic * (1 - blend * 0.55) + spring * (blend * 0.55);
  }

  /**
   * Connected pan easing ported from OpenScreen (mathUtils.ts easeConnectedPan).
   * Smooth cubic-bezier-like S-curve for panning between connected zoom regions.
   */
  easeConnectedPan(t) {
    const c = Math.max(0, Math.min(1, t));
    return c * c * c * (c * (c * 6 - 15) + 10);
  }

  /**
   * Ken Perlin's Smootherstep (quintic curve): 6t^5 - 15t^4 + 10t^3
   * Zero 1st derivative (velocity=0) and zero 2nd derivative (acceleration=0) at endpoints.
   * Completely eliminates camera jerk and sudden kicks at transitions.
   */
  smootherstep(t) {
    const c = Math.max(0, Math.min(1, t));
    return c * c * c * (c * (c * 6 - 15) + 10);
  }

  /**
   * Cinematic Camera Ease-In-Out
   * Blends Perlin smootherstep (65%) with smooth quartic (35%)
   * Produces the signature Screen Studio fluid camera drift.
   */
  cinematicEase(t) {
    const c = Math.max(0, Math.min(1, t));
    const s = c * c * c * (c * (c * 6 - 15) + 10);
    const q = c < 0.5 ? 8 * c * c * c * c : 1 - Math.pow(-2 * c + 2, 4) / 2;
    return s * 0.65 + q * 0.35;
  }

  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  
  easeInCubic(t) {
    return t * t * t;
  }
  
  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /** Smoother quartic ease-in-out for cinematic camera pans */
  easeInOutQuart(t) {
    return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
  }
  
  /** Sine ease-in-out: most natural/organic feeling — like a real camera operator */
  easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }

  /** Expo ease-out for snappy, buttery zoom-in feeling */
  easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  generateSummary(zoomSegments) {
    const totalZoomTime = zoomSegments.reduce((sum, seg) => 
      sum + (seg.endTime - seg.startTime), 0
    );
    
    const totalClicks = zoomSegments.reduce((sum, seg) => 
      sum + (seg.clickCount || 1), 0
    );

    return {
      totalSegments: zoomSegments.length,
      totalZoomTime,
      totalClicks
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZoomAnalyzer;
}
