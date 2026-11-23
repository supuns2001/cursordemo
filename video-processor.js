/**
 * CursorDemo Screen Recorder
 * Copyright (c) 2026 CursorDemo Contributors
 * GitHub: https://github.com/cursordemo/cursordemo-screen-recorder
 *
 * Licensed under the MIT License.
 */

// Video Processor - Stable Reverted Version (MediaRecorder)
// This version uses standard MediaRecorder for maximum compatibility

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

class VideoProcessor {
  constructor(videoBlob = null, cursorData = [], zoomSegments = [], settings = null) {
    this.canvas = null;
    this.ctx = null;
    this.video = null;
    this.videoBlob = videoBlob;
    this.outputStream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.analyzer = null;
    this.zoomAnalyzer = null;
    this.webcamVideo = null;
    this.webcamStream = null;
    this.cursorData = Array.isArray(cursorData) ? cursorData : [];
    this.zoomSegments = Array.isArray(zoomSegments) ? zoomSegments : [];
    
    // WebCodecs (disabled for stability)
    this.videoEncoder = null;
    this.useWebCodecs = false;
    this.encodedChunks = [];
    this.frameCount = 0;
    this.targetFps = 30;
    
    // Frame rate control for smooth playback
    this.minFps = 60; // Minimum target FPS for 1080p
    this.frameTiming = {
      lastFrameTime: 0,
      frameInterval: 1000 / 60, // ~16.67ms for 60fps
      actualFps: 0,
      frameCount: 0,
      lastFpsUpdate: 0
    };
    this.previousFrame = null; // For frame interpolation
    
    this.settings = {
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      backgroundImage: null,
      padding: 32,
      borderRadius: 12,
      trimStart: 0,
      clickStyle: 'ripple',
      clickWaves: 'double',
      clickColor: '#ffffff',
      clickForce: 'moderate',
      clickSize: 40,
      showWebcam: false,
      webcamPosition: 'bottom-right',
      webcamCustomX: null,
      webcamCustomY: null,
      webcamZoomMode: 'float',
      webcamSize: 'medium',
      webcamScale: 1.0,
      webcamShape: 'circular',
      webcamBorderStyle: 'glow',
      webcamShadow: true,
      webcamFlip: false,
      showCursor: true,
      cursorSize: 20,
      sharpening: true,
      antiAlias: true,
      cleanBrowser: true, // true = crop tabs / clean browser; false = show original browser tabs
      showBrowserFrame: false, // legacy mirror
      showMacWindowHeader: true, // true = show macOS window titlebar with traffic lights
      showShadow: true // true = show shadow effect, false = hide shadow
    };

    if (settings && typeof settings === 'object') {
      this.settings = { ...this.settings, ...settings };
      if (this.settings.cleanBrowser !== undefined) {
        this.settings.showBrowserFrame = !this.settings.cleanBrowser;
      } else if (this.settings.showBrowserFrame !== undefined) {
        this.settings.cleanBrowser = !this.settings.showBrowserFrame;
      }
    }

    this.displaySurface = this.settings.displaySurface || null;
    const ZA = (typeof ZoomAnalyzer !== 'undefined')
      ? ZoomAnalyzer
      : (typeof require === 'function' ? (() => { try { return require('./zoom-analyzer.js'); } catch (_) { return null; } })() : null);
    if (ZA) {
      this.analyzer = new ZA(this.settings || {});
      this.analyzer.cursorData = this.cursorData || [];
      this.analyzer.displaySurface = this.displaySurface;
      this.analyzer.cameraStyle = this.settings.cameraStyle || 'smooth';
      this.analyzer.adaptiveEdgeZoom = this.settings.adaptiveEdgeZoom !== false;
      this.zoomAnalyzer = this.analyzer;
    }
    
    this.backgroundImageElement = null; // Preloaded background image
    this.activeClicks = [];
    debugLog('[VideoProcessor] Initialized (Stable Mode)');
  }

  async processVideo(videoBlob, zoomSegments, onProgress = null, settings = null, cursorData = []) {
    debugLog('[VideoProcessor] Starting processing...');
    
    // Invalidate stale cached deduplicated clicks for this processing run
    this._dedupedClicks = null;
    this._dedupedRef = null;
    
    if (settings) {
      this.settings = { ...this.settings, ...settings };
      if (this.settings.cleanBrowser !== undefined) {
        this.settings.showBrowserFrame = !this.settings.cleanBrowser;
      } else if (this.settings.showBrowserFrame !== undefined) {
        this.settings.cleanBrowser = !this.settings.showBrowserFrame;
      }
      if (this.settings.cleanBrowser) {
        debugLog('[VideoProcessor] Browser UI will be auto-cropped from top (Clean Browser enabled)');
      }
      
      // Preload background image if provided
      if (this.settings.backgroundImage && this.settings.backgroundImage.startsWith('data:image/')) {
        await this.preloadBackgroundImage(this.settings.backgroundImage);
      } else {
        this.backgroundImageElement = null;
      }
    }
    
    this.displaySurface = this.settings.displaySurface || null;
    this.analyzer = new ZoomAnalyzer(this.settings || {});
    this.analyzer.displaySurface = this.displaySurface;
    this.analyzer.cameraStyle = this.settings.cameraStyle || 'smooth';
    this.analyzer.adaptiveEdgeZoom = this.settings.adaptiveEdgeZoom !== false;
    this.cursorData = Array.isArray(cursorData) ? cursorData : [];
    this.zoomSegments = Array.isArray(zoomSegments) ? zoomSegments : [];
    this.analyzer.cursorData = this.cursorData;
    this.zoomAnalyzer = this.analyzer;

    return new Promise(async (resolve, reject) => {
      try {
        // Create video element with maximum quality settings
        this.video = document.createElement('video');
        this.video.src = URL.createObjectURL(videoBlob);
        // Keep unmuted - Web Audio API needs unmuted video to capture audio
        // We prevent playback by not connecting to audioContext.destination
        this.video.muted = false;
        this.video.preload = 'auto';
        // Ensure video loads at full resolution
        this.video.playsInline = true;
        this.video.setAttribute('playsinline', 'true');
        
        await new Promise((res, rej) => {
          this.video.onloadedmetadata = res;
          this.video.onerror = rej;
          setTimeout(() => rej(new Error('Video load timeout')), 10000);
        });

        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;
        let fullDuration = this.video.duration;
        
        debugLog('[VideoProcessor] Video loaded:', videoWidth, 'x', videoHeight);
        
        // Handle WebM Infinity duration - use known duration if available or detect via seek
        if (this.settings.knownDuration && isFinite(this.settings.knownDuration) && this.settings.knownDuration > 0) {
          fullDuration = this.settings.knownDuration;
          debugLog('[VideoProcessor] Using known video duration from settings:', fullDuration, 'seconds');
        } else if (!isFinite(fullDuration) || fullDuration <= 0 || fullDuration === Infinity) {
          debugLog('[VideoProcessor] Invalid duration detected:', fullDuration, '- finding real duration...');
          this.video.currentTime = Number.MAX_SAFE_INTEGER;
          await new Promise(res => {
            let resolved = false;
            const resolveOnce = (value) => {
              if (!resolved) {
                resolved = true;
                fullDuration = value;
                res();
              }
            };
            this.video.onseeked = () => {
              const detectedDuration = this.video.duration;
              if (isFinite(detectedDuration) && detectedDuration > 0) {
                resolveOnce(detectedDuration);
              }
            };
            setTimeout(() => {
              const detectedDuration = this.video.currentTime || this.video.duration;
              if (isFinite(detectedDuration) && detectedDuration > 0) {
                resolveOnce(detectedDuration);
              } else {
                resolveOnce(30); // Fallback
              }
            }, 2000);
          });
          this.video.currentTime = 0;
          await new Promise(res => {
            this.video.onseeked = res;
            setTimeout(res, 500);
          });
        }
        
        debugLog('[VideoProcessor] Detected video duration:', fullDuration, 'seconds');
        
        const trimStart = isFinite(this.settings.trimStart) ? this.settings.trimStart : 0;
        const trimEnd = isFinite(this.settings.trimEnd) ? this.settings.trimEnd : 1;
        const startTime = Math.max(0, fullDuration * trimStart);
        const endTime = Math.min(fullDuration, fullDuration * trimEnd);
        const duration = endTime - startTime;
        
        debugLog('[VideoProcessor] Trim settings - start:', trimStart, 'end:', trimEnd);
        debugLog('[VideoProcessor] Processing range:', startTime.toFixed(2), 'to', endTime.toFixed(2), 
                    'duration:', duration.toFixed(2), 'seconds');

        const padding = this.settings.padding;
        const requestedWidth = this.settings.outputWidth || videoWidth;
        const requestedHeight = this.settings.outputHeight || videoHeight;

        // Even dimensions: H.264 / VP9 encoders are happiest with even width & height (fewer glitches)
        const snapEven = (n) => {
          const v = Math.max(2, Math.round(Number(n) || 0));
          return v - (v % 2);
        };

        // Resolution calculation: if outputWidth & outputHeight are provided from user's selection,
        // use them as the exact total canvas dimensions (preserving standard 4K, 1440p, 1080p standards).
        let outputWidth, outputHeight;
        if (this.settings.outputWidth && this.settings.outputHeight) {
          outputWidth = snapEven(this.settings.outputWidth);
          outputHeight = snapEven(this.settings.outputHeight);
        } else {
          outputWidth = snapEven(videoWidth + (padding * 2));
          outputHeight = snapEven(videoHeight + (padding * 2));
        }

        const availableContentWidth = Math.max(2, outputWidth - (padding * 2));
        const availableContentHeight = Math.max(2, outputHeight - (padding * 2));

        this.outputWidth = outputWidth;
        this.outputHeight = outputHeight;
        this.availableContentWidth = availableContentWidth;
        this.availableContentHeight = availableContentHeight;
        this.outputVideoWidth = availableContentWidth;
        this.outputVideoHeight = availableContentHeight;
        const outputVideoWidth = availableContentWidth;
        const outputVideoHeight = availableContentHeight;
        this.sourceVideoWidth = videoWidth;
        this.sourceVideoHeight = videoHeight;
        
        this.canvas = document.createElement('canvas');
        // Ensure canvas is at exact output resolution for 100% quality
        this.canvas.width = outputWidth;
        this.canvas.height = outputHeight;
        debugLog('[VideoProcessor] Canvas created at exact output standard resolution:', this.canvas.width, 'x', this.canvas.height);
        
        // Get 2D context with sRGB color space and maximum quality
        this.ctx = this.canvas.getContext('2d', { 
          alpha: false, 
          colorSpace: 'srgb',
          desynchronized: false, // Synchronized presentation for captureStream
          willReadFrequently: false // Optimize for write operations
        });
        
        // Maximum quality rendering settings for 100% quality export
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
        // Ensure pixel-perfect rendering
        this.ctx.textBaseline = 'top';
        this.ctx.textAlign = 'left';

        // Setup webcam/camera overlay if enabled (but don't set up audio yet - will do after audio context)
        if (this.settings.showWebcam) {
          await this.setupWebcamVideo();
        }

        const userFps = this.settings.fps ?? 60;
        const userMaxFps = this.settings.maxFps ?? 60;
        const targetFps = Math.max(24, Math.min(60, userFps, userMaxFps));
        const captureFps = targetFps;
        this.targetFps = targetFps;
        this.frameTiming.frameInterval = 1000 / targetFps;
        
        // Maximum Quality Bitrate Settings - Optimized for 100% quality
        let bitrate = this.settings.bitrate;
        if (!bitrate) {
          const pixels = outputWidth * outputHeight;
          const quality = this.settings.quality || 'maximum';
          const qualityMultipliers = { 'low': 1.0, 'medium': 2.0, 'high': 3.5, 'maximum': 5.0 };
          const qualityMult = qualityMultipliers[quality] || 5.0;
          const pixelRatio = pixels / (1920 * 1080);
          const baseBitrate = 80000000; // 80 Mbps base for 1080p
          bitrate = Math.round(baseBitrate * pixelRatio * qualityMult);
          
          // For 1080p, ensure minimum 160 Mbps for artifact-free quality
          if (pixels >= 1920 * 1080 * 0.9 && pixels < 2560 * 1440) {
            bitrate = Math.max(bitrate, 160000000);
            debugLog('[VideoProcessor] 1080p detected - using ultra-high bitrate:', (bitrate / 1000000).toFixed(1), 'Mbps');
          }

          // 1440p / 2K class canvas
          if (pixels >= 2560 * 1440 * 0.88 && pixels < 3840 * 2160 * 0.88) {
            bitrate = Math.max(bitrate, 200000000);
            debugLog('[VideoProcessor] 1440p/2K output - boosted bitrate:', (bitrate / 1000000).toFixed(1), 'Mbps');
          }
          
          // For 4K, use maximum browser capability
          if (pixels >= 3840 * 2160 * 0.9) {
            bitrate = Math.max(bitrate, 240000000);
            debugLog('[VideoProcessor] 4K detected - using maximum bitrate:', (bitrate / 1000000).toFixed(1), 'Mbps');
          }
          
          const minBitrateForQuality = Math.max(25000000, Math.round(outputWidth * outputHeight * 0.015));
          bitrate = Math.max(minBitrateForQuality, bitrate);
        } else {
          const minBitrateForQuality = Math.max(25000000, Math.round(outputWidth * outputHeight * 0.015));
          bitrate = Math.max(minBitrateForQuality, bitrate);
          debugLog('[VideoProcessor] Using provided bitrate:', (bitrate / 1000000).toFixed(1), 'Mbps');
        }

        debugLog('[VideoProcessor] Target FPS:', targetFps, 'Bitrate:', (bitrate/1000000).toFixed(1), 'Mbps');
        
        // Force MediaRecorder for stability
        this.useWebCodecs = false;
        
        this.outputStream = this.canvas.captureStream(captureFps);
        
        // FIX: Extract audio from source video and add to output stream
        // Canvas captureStream only captures video, so we need to add audio separately
        // Use Web Audio API to capture audio from the video element
        let audioContext = null;
        let audioSource = null;
        let audioDestination = null;
        
        try {
          // Check if video has audio (by checking if it can play audio)
          // Create audio context with cross-platform compatibility
          // Support both standard AudioContext and webkitAudioContext (Safari/older browsers)
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) {
            throw new Error('AudioContext not supported');
          }
          audioContext = new AudioContextClass({
            // Use optimal sample rate for quality (default is usually 44.1kHz or 48kHz)
            sampleRate: 48000 // 48kHz for high-quality audio
          });
          this.audioContext = audioContext;
          audioSource = audioContext.createMediaElementSource(this.video);
          this.audioSource = audioSource;
          audioDestination = audioContext.createMediaStreamDestination();
          this.audioDestination = audioDestination;
          
          // Connect video audio to destination stream for capture
          audioSource.connect(audioDestination);
          // DO NOT connect to audioContext.destination - we don't want audio playing through speakers
          // Audio will be captured via audioDestination but won't be audible during export
          
          // Keep video unmuted - Web Audio API needs unmuted video to capture audio
          // We prevent playback by NOT connecting to audioContext.destination
          this.video.muted = false;
          debugLog('[VideoProcessor] Video unmuted for audio capture (but not connected to speakers)');
          
          // Resume audio context if suspended (required for audio capture)
          if (audioContext.state === 'suspended') {
            await audioContext.resume();
            debugLog('[VideoProcessor] Audio context resumed');
          }
          
          const audioTracks = audioDestination.stream.getAudioTracks();
          debugLog('[VideoProcessor] Audio tracks from Web Audio API:', audioTracks.length);
          
          // Add audio tracks to output stream
          audioTracks.forEach(track => {
            if (track.readyState === 'live') {
              this.outputStream.addTrack(track);
              debugLog('[VideoProcessor] Added audio track to output stream:', track.label);
            }
          });
          
          // Now set up camera audio mixing if camera overlay is enabled
          if (this.settings.showWebcam && this.webcamStream && this.webcamStream.getAudioTracks().length > 0) {
            await this.setupCameraAudio();
          }
        } catch (error) {
          console.warn('[VideoProcessor] ⚠️ Cannot extract audio via Web Audio API:', error);
          // Even if screen audio fails, try to set up camera audio if enabled
          if (this.settings.showWebcam && this.webcamStream && this.webcamStream.getAudioTracks().length > 0) {
            try {
              // Create audio context just for camera
              const AudioContextClass = window.AudioContext || window.webkitAudioContext;
              if (AudioContextClass) {
                this.audioContext = new AudioContextClass({ sampleRate: 48000 });
                this.audioDestination = this.audioContext.createMediaStreamDestination();
                await this.setupCameraAudio();
              }
            } catch (cameraAudioError) {
              console.warn('[VideoProcessor] Could not set up camera-only audio:', cameraAudioError);
            }
          }
        }
        
        const format = this.settings.format || 'webm';
        let mimeType;
        
        // Check if we have audio tracks to include
        const hasAudio = this.outputStream.getAudioTracks().length > 0;
        debugLog('[VideoProcessor] Output stream has audio:', hasAudio);
        
        const isCodecSupported = (codec) => {
          try {
            return typeof MediaRecorder !== 'undefined' &&
              typeof MediaRecorder.isTypeSupported === 'function' &&
              MediaRecorder.isTypeSupported(codec);
          } catch (_) {
            return false;
          }
        };

        const mp4Codecs = hasAudio 
          ? [
              'video/mp4;codecs=avc1.640034,mp4a.40.2', // H.264 High Profile Level 5.2 + AAC
              'video/mp4;codecs=avc1.640033,mp4a.40.2', // H.264 High Profile Level 5.1 + AAC (4K / 60fps)
              'video/mp4;codecs=avc1.640032,mp4a.40.2', // H.264 High Profile Level 5.0 + AAC
              'video/mp4;codecs=avc1.640028,mp4a.40.2', // H.264 High Profile Level 4.0 + AAC
              'video/mp4;codecs=avc1.4d401f,mp4a.40.2',
              'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
              'video/mp4;codecs=avc1,mp4a.40.2',
              'video/mp4;codecs=avc1',
              'video/mp4'
            ]
          : [
              'video/mp4;codecs=avc1.640034',
              'video/mp4;codecs=avc1.640033',
              'video/mp4;codecs=avc1.640032',
              'video/mp4;codecs=avc1.640028',
              'video/mp4;codecs=avc1.4d401f',
              'video/mp4;codecs=avc1.42E01E',
              'video/mp4;codecs=avc1',
              'video/mp4'
            ];

        const webmCodecs = hasAudio
          ? [
              'video/webm;codecs=vp09.02.10.10,opus', // VP9 Profile 2 (10-bit)
              'video/webm;codecs=vp09.00.10.08,opus', // VP9 Profile 0 (8-bit)
              'video/webm;codecs=vp9,opus',
              'video/webm;codecs=vp8,opus',
              'video/webm;codecs=vp9',
              'video/webm;codecs=vp8',
              'video/webm'
            ]
          : [
              'video/webm;codecs=vp09.02.10.10',
              'video/webm;codecs=vp09.00.10.08',
              'video/webm;codecs=vp9',
              'video/webm;codecs=vp8',
              'video/webm'
            ];

        const orderedCodecs = format === 'mp4'
          ? [...mp4Codecs, ...webmCodecs]
          : [...webmCodecs, ...mp4Codecs];

        for (const codec of orderedCodecs) {
          if (isCodecSupported(codec)) {
            mimeType = codec;
            debugLog('[VideoProcessor] Selected codec:', codec, hasAudio ? '(with audio)' : '(video only)');
            break;
          }
        }
        
        debugLog('[VideoProcessor] Using MIME:', mimeType);
        debugLog('[VideoProcessor] Canvas resolution:', outputWidth, 'x', outputHeight);
        debugLog('[VideoProcessor] Output video resolution:', this.outputVideoWidth, 'x', this.outputVideoHeight);
        
        // MediaRecorder options - use highest quality settings
        // Optimized for cross-platform compatibility (Chrome on Mac/Windows/Linux)
        const recorderOptions = {
          ...(mimeType ? { mimeType: mimeType } : {}),
          videoBitsPerSecond: bitrate
        };
        
        // Add audio bitrate if we have audio tracks
        if (this.outputStream.getAudioTracks().length > 0) {
          recorderOptions.audioBitsPerSecond = 320000; // 320 kbps for broadcast studio-quality audio
          debugLog('[VideoProcessor] Audio bitrate set to 320 kbps (broadcast studio quality)');
          
          // Log audio track settings for quality verification
          const audioTracks = this.outputStream.getAudioTracks();
          audioTracks.forEach((track, i) => {
            const settings = track.getSettings();
            debugLog(`[VideoProcessor] Audio track ${i + 1} quality settings:`, {
              sampleRate: settings.sampleRate,
              channelCount: settings.channelCount,
              echoCancellation: settings.echoCancellation,
              noiseSuppression: settings.noiseSuppression,
              autoGainControl: settings.autoGainControl
            });
          });
        }
        
        // Cap bitrate to browser-safe maximum before creating MediaRecorder
        // Different codecs have different limits:
        // - VP9/WebM: Can handle up to ~250 Mbps
        // - H.264/MP4: Can handle up to ~200 Mbps in modern Chromium
        let MAX_SAFE_BITRATE = 250000000; // 250 Mbps default for VP9/WebM
        
        if (recorderOptions.mimeType && (recorderOptions.mimeType.includes('mp4') || recorderOptions.mimeType.includes('avc1'))) {
          MAX_SAFE_BITRATE = 200000000; // 200 Mbps for MP4 (high profile level 5.1/5.2)
        }
        
        if (bitrate > MAX_SAFE_BITRATE) {
          bitrate = MAX_SAFE_BITRATE;
          recorderOptions.videoBitsPerSecond = bitrate;
        }
        
        try {
          this.mediaRecorder = new MediaRecorder(this.outputStream, recorderOptions);
        } catch (err1) {
          console.warn('[VideoProcessor] High-bitrate MediaRecorder init failed, retrying with 25 Mbps cap:', err1.message);
          try {
            const safeOptions = {
              ...(recorderOptions.mimeType ? { mimeType: recorderOptions.mimeType } : {}),
              videoBitsPerSecond: Math.min(bitrate || 25000000, 25000000)
            };
            this.mediaRecorder = new MediaRecorder(this.outputStream, safeOptions);
          } catch (err2) {
            console.warn('[VideoProcessor] Capped MediaRecorder init failed, retrying with default options:', err2.message);
            this.mediaRecorder = new MediaRecorder(this.outputStream);
          }
        }
        
        // Log the actual settings being used
        debugLog('[VideoProcessor] MediaRecorder created with:', {
          mimeType: this.mediaRecorder.mimeType || recorderOptions.mimeType || 'default',
          bitrate: (bitrate / 1000000).toFixed(1) + ' Mbps',
          canvasSize: outputWidth + 'x' + outputHeight,
          videoSize: this.outputVideoWidth + 'x' + this.outputVideoHeight,
          fps: captureFps
        });
        
        this.chunks = [];
        let totalDataSize = 0;
        let emptyChunkCount = 0;
        let lastChunkTime = Date.now();
        
        this.mediaRecorder.ondataavailable = (e) => {
          const now = Date.now();
          const timeSinceLastChunk = now - lastChunkTime;
          lastChunkTime = now;
          
          if (e.data && e.data.size > 0) {
            this.chunks.push(e.data);
            totalDataSize += e.data.size;
            emptyChunkCount = 0; // Reset empty chunk counter on successful chunk
            
            if (this.chunks.length % 10 === 0) {
              debugLog('[VideoProcessor] Chunks:', this.chunks.length, 'Total data:', (totalDataSize / 1024 / 1024).toFixed(2), 'MB');
            }
          } else {
            // Empty chunks can occur normally (MediaRecorder fires periodically)
            // But frequent empty chunks indicate a problem
            emptyChunkCount++;
            if (emptyChunkCount <= 3) {
              // First few empty chunks are normal, just log at debug level
              debugLog('[VideoProcessor] Received empty data chunk (normal during startup)');
            } else if (emptyChunkCount === 4) {
              // After 3 empty chunks, warn - might indicate an issue
              console.warn('[VideoProcessor] Multiple empty data chunks received - this may indicate encoding issues');
            }
          }
        };
        
        this.mediaRecorder.onerror = (event) => {
          console.error('[VideoProcessor] MediaRecorder error:', event.error);
        };
        
        this.mediaRecorder.onstart = () => {
          debugLog('[VideoProcessor] MediaRecorder started successfully');
        };
        
        this.mediaRecorder.onstop = () => {
          debugLog('[VideoProcessor] MediaRecorder stopped, total chunks:', this.chunks.length);
        };

        // Seek to start and ensure video is ready
        this.video.currentTime = startTime;
        await new Promise((res) => {
          const timeout = setTimeout(res, 5000);
          this.video.onseeked = () => {
            clearTimeout(timeout);
            res();
          };
          // Also wait for canplay to ensure video is ready
          this.video.oncanplay = () => {
            clearTimeout(timeout);
            res();
          };
        });

        // Seek recorded Face Cam video to matching startTime if present
        if (this.webcamVideo && !this.webcamStream) {
          try {
            const camDur = (isFinite(this.webcamVideo.duration) && this.webcamVideo.duration > 0)
              ? this.webcamVideo.duration
              : Infinity;
            const safeMaxTime = isFinite(camDur) ? Math.max(0, camDur - 0.02) : startTime;
            this.webcamVideo.currentTime = Math.max(0, Math.min(safeMaxTime, startTime));
            await new Promise((res) => {
              const timeout = setTimeout(res, 1500);
              this.webcamVideo.onseeked = () => {
                clearTimeout(timeout);
                res();
              };
              this.webcamVideo.oncanplay = () => {
                clearTimeout(timeout);
                res();
              };
            });
          } catch (camSeekErr) {
            console.warn('[VideoProcessor] Could not seek recorded Face Cam video:', camSeekErr);
          }
        }
        
        // Video is unmuted for audio capture, but audio won't play through speakers
        // because we don't connect audioSource to audioContext.destination
        debugLog('[VideoProcessor] Video ready for processing (audio capture enabled, speakers disabled)');
        
        debugLog('[VideoProcessor] Starting at:', startTime, 'Ending at:', endTime, 'Duration:', duration);

        // Start video playback to ensure audio is flowing through Web Audio API
        // The video must be playing for audio to be captured
        if (this.video.paused) {
          debugLog('[VideoProcessor] Starting video playback for audio capture');
          await this.video.play().catch(e => console.warn('[VideoProcessor] Play error:', e));
        }
        if (this.webcamVideo && this.webcamVideo.paused && !this.webcamVideo.ended) {
          await this.webcamVideo.play().catch(() => {});
        }
        
        const recorderTimeslice = 200;
        this.mediaRecorder.start(recorderTimeslice);
        debugLog('[VideoProcessor] MediaRecorder started with', (bitrate / 1000000).toFixed(1), 'Mbps bitrate,', recorderOptions.mimeType, 'codec');

        // Process frames
        await this.processFrames(zoomSegments, videoWidth, videoHeight, startTime, endTime, targetFps, onProgress);

        // Stop video and remove pause guard
        if (this._pauseGuard && this.video) {
          this.video.removeEventListener('pause', this._pauseGuard);
          this._pauseGuard = null;
        }
        this.video.pause();
        if (this.webcamVideo) {
          try { this.webcamVideo.pause(); } catch (_) {}
        }
        
        // Ensure we get all data before stopping and cleanly await onstop
        if (this.mediaRecorder.state === 'recording') {
            debugLog('[VideoProcessor] Requesting final data and stopping MediaRecorder...');
            this.mediaRecorder.requestData();
            await new Promise(res => {
              const timeout = setTimeout(() => {
                debugLog('[VideoProcessor] Stop wait fallback timeout reached');
                res();
              }, 6000);
              this.mediaRecorder.onstop = () => {
                clearTimeout(timeout);
                debugLog('[VideoProcessor] MediaRecorder stopped successfully, total chunks:', this.chunks.length);
                res();
              };
              this.mediaRecorder.stop();
            });
        }
        
        debugLog('[VideoProcessor] Total chunks collected:', this.chunks.length);
        
        let blob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType || 'video/webm' });

        if (!blob || blob.size === 0) {
          throw new Error('Exported video is empty (0 bytes generated). MediaRecorder may have failed to encode frames.');
        }

        // If export is WebM, patch EBML duration header with exact export duration
        if (blob.type.includes('webm') && duration > 0) {
          try {
            blob = await this.fixWebmDurationBlob(blob, duration * 1000);
            debugLog('[VideoProcessor] ✅ Patched exported WebM with duration:', duration.toFixed(2), 'seconds');
          } catch (fixErr) {
            debugLog('[VideoProcessor] Could not patch WebM duration:', fixErr);
          }
        }

        const blobSizeMB = blob.size / 1024 / 1024;
        const blobSizeKB = blob.size / 1024;
        debugLog('[VideoProcessor] Final blob:', blobSizeMB.toFixed(2), 'MB');
        
        
        URL.revokeObjectURL(this.video.src);
        this.cleanupWebcam();
        this.cleanupAudio();
        
        // Clean up video element
        if (this.video) {
          this.video.pause();
          this.video.src = '';
          this.video.srcObject = null;
          this.video = null;
        }
        
        // Clean up MediaRecorder
        if (this.mediaRecorder) {
          this.mediaRecorder = null;
        }
        
        // Clean up canvas
        if (this.canvas) {
          const ctx = this.canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          }
          this.canvas = null;
          this.ctx = null;
        }
        
        // Clean up output stream
        if (this.outputStream) {
          this.outputStream.getTracks().forEach(track => track.stop());
          this.outputStream = null;
        }
        
        resolve(blob);

      } catch (error) {
        console.error('[VideoProcessor] Error:', error);
        this.cleanupWebcam();
        this.cleanupAudio();
        
        // Clean up on error — release video blob URL and canvas to prevent memory leaks
        if (this.video) {
          if (this.video.src && this.video.src.startsWith('blob:')) {
            try { URL.revokeObjectURL(this.video.src); } catch (_) {}
          }
          this.video.pause();
          this.video.src = '';
          this.video.srcObject = null;
          this.video = null;
        }
        if (this.canvas) {
          const ctx = this.canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          }
          this.canvas = null;
          this.ctx = null;
        }
        if (this.mediaRecorder) {
          try {
            if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
          } catch (_) {}
          this.mediaRecorder = null;
        }
        if (this.outputStream) {
          this.outputStream.getTracks().forEach(track => track.stop());
          this.outputStream = null;
        }
        
        reject(error);
      }
    });
  }

  async processFrames(zoomSegments, videoWidth, videoHeight, startTime, endTime, fps, onProgress) {
    const duration = endTime - startTime;
    const padding = this.settings.padding;
    const radius = this.settings.borderRadius;
    
    const outWidth = this.outputVideoWidth || videoWidth;
    const outHeight = this.outputVideoHeight || videoHeight;
    const outputVideoWidth = outWidth;
    const outputVideoHeight = outHeight;
    const srcWidth = this.sourceVideoWidth || videoWidth;
    const srcHeight = this.sourceVideoHeight || videoHeight;

    return new Promise((resolve) => {
      let isProcessing = true;
      let lastProgress = 0;
      let frameIndex = 0;
      
      // Frame rate control variables - strict 60fps output
      const targetFrameInterval = this.frameTiming.frameInterval; // ms per frame (~16.67ms for 60fps)
      let lastFrameTimestamp = performance.now();
      let lastVideoTime = startTime;
      let frameTimeoutId = null;
      // Initialize to current time since first frame is drawn immediately
      // It will be incremented by targetFrameInterval after first frame, scheduling second frame correctly
      let nextFrameTime = performance.now();
      let frameStartTime = performance.now(); // Track when frame drawing started
      
      // Store previous frame for interpolation/filler frames
      let previousFrameData = null;
      let previousVideoTime = startTime;
      let lastDrawnVideoTime = startTime;
      
      
      // Calculate static layout dimensions once outside the 60fps loop
      let sourceX = 0;
      let sourceY = 0;
      let sourceWidth = srcWidth;
      let sourceHeight = srcHeight;
      let effectiveAspectRatio = srcWidth / srcHeight;
      
      const browserUIHeight = this.getEffectiveBrowserUIHeight(srcHeight);
      if (browserUIHeight > 0) {
        sourceX = 0;
        sourceY = browserUIHeight;
        sourceWidth = Math.max(1, srcWidth);
        sourceHeight = Math.max(1, srcHeight - browserUIHeight);
        effectiveAspectRatio = sourceWidth / sourceHeight;
      }
      
      const contentAreaWidth = this.availableContentWidth || Math.max(2, this.canvas.width - (padding * 2));
      const contentAreaHeight = this.availableContentHeight || Math.max(2, this.canvas.height - (padding * 2));

      // macOS Window Header Bar height (scaled to export resolution)
      const macHeaderHeight = (this.settings.showMacWindowHeader !== false) 
        ? Math.min(42, Math.max(26, Math.round(contentAreaWidth * 0.022) + 14)) 
        : 0;
      const availVideoH = Math.max(10, contentAreaHeight - macHeaderHeight);
      const contentAspectRatio = contentAreaWidth / availVideoH;
      
      let baseDrawWidth, baseDrawHeight;
      if (effectiveAspectRatio > contentAspectRatio) {
        baseDrawWidth = contentAreaWidth;
        baseDrawHeight = baseDrawWidth / effectiveAspectRatio;
      } else {
        baseDrawHeight = availVideoH;
        baseDrawWidth = baseDrawHeight * effectiveAspectRatio;
      }

      // Video content dimensions (maintains 100% undistorted native aspect ratio)
      const videoDrawW = Math.round(baseDrawWidth);
      const videoDrawH = Math.round(baseDrawHeight);

      // Window Frame dimensions (combining macOS header + video content)
      const windowW = videoDrawW;
      const windowH = videoDrawH + macHeaderHeight;
      const windowX = Math.round(padding + (contentAreaWidth - windowW) / 2);
      const windowY = Math.round(padding + (contentAreaHeight - windowH) / 2);
      const videoY = windowY + macHeaderHeight;

      // Pre-render the static backdrop (background + dual-layer photorealistic shadow) once
      // Eliminates 45ms per frame of Gaussian blur and gradient computation, guaranteeing 0 dropped frames at 60 FPS
      const backdropCanvas = document.createElement('canvas');
      backdropCanvas.width = this.canvas.width;
      backdropCanvas.height = this.canvas.height;
      const bCtx = backdropCanvas.getContext('2d', { alpha: true });
      bCtx.imageSmoothingEnabled = true;
      bCtx.imageSmoothingQuality = 'high';
      
      this.drawBackground(bCtx);
      
      if (this.settings.showShadow !== false && padding > 0) {
        bCtx.save();
        // Layer 1: Ambient soft ground diffusion
        bCtx.shadowColor = 'rgba(0, 0, 0, 0.22)';
        bCtx.shadowBlur = Math.round(padding * 0.65) + 12;
        bCtx.shadowOffsetY = Math.round(padding * 0.25) + 4;
        bCtx.shadowOffsetX = 0;
        bCtx.fillStyle = '#000000';
        bCtx.beginPath();
        this.roundRect(bCtx, windowX, windowY, windowW, windowH, radius);
        bCtx.fill();
        
        // Layer 2: Deep key directional elevation shadow
        bCtx.shadowColor = 'rgba(0, 0, 0, 0.38)';
        bCtx.shadowBlur = Math.round(padding * 1.4) + 22;
        bCtx.shadowOffsetY = Math.round(padding * 0.7) + 12;
        bCtx.beginPath();
        this.roundRect(bCtx, windowX, windowY, windowW, windowH, radius);
        bCtx.fill();
        bCtx.restore();
      }

      const drawFrame = async () => {
        if (!isProcessing) return;
        
        const frameStart = performance.now();
        const elapsed = frameStart - lastFrameTimestamp;
        
        // Check if we've reached the end time - don't stop on video.ended, only on reaching endTime
        // This ensures we process the full trimmed duration even if video naturally ends
        const currentTime = this.video.currentTime;
        const hasReachedEnd = (currentTime >= endTime - 0.05) || this.video.ended;
        
        if (hasReachedEnd) {
          debugLog('[VideoProcessor] Reached end time:', endTime, 'at currentTime:', currentTime);
          isProcessing = false;
          if (frameTimeoutId) clearTimeout(frameTimeoutId);
          if (onProgress) onProgress(100);
          resolve();
          return;
        }
        
        const currentVideoTime = this.video.currentTime;
        const timestamp = currentVideoTime * 1000;
        const zoomState = (this.settings.applyZoom === false || !this.analyzer)
          ? { active: false, level: 1.0 }
          : this.analyzer.getZoomAtTime(timestamp, zoomSegments, srcWidth, srcHeight, browserUIHeight);

        if (this.settings.background === 'transparent' || this.settings.background === 'hidden' || this.settings.background === null) {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        // Draw pre-rendered background and photorealistic shadows in a single sub-millisecond GPU pass
        this.ctx.drawImage(backdropCanvas, 0, 0);

        // Calculate zoom crop parameters relative to visible source area
        const zoomScale = (zoomState.active && zoomState.level > 1.005) ? zoomState.level : 1.0;
        const targetVideoX = (zoomState.active && zoomState.level > 1.005) ? zoomState.x : (sourceX + (sourceWidth / 2));
        const targetVideoY = (zoomState.active && zoomState.level > 1.005) ? zoomState.y : (sourceY + (sourceHeight / 2));

        const normX = Math.max(0, Math.min(1, (targetVideoX - sourceX) / sourceWidth));
        const normY = Math.max(0, Math.min(1, (targetVideoY - sourceY) / sourceHeight));

        const cropW = sourceWidth / zoomScale;
        const cropH = sourceHeight / zoomScale;
        let cropX = (normX * sourceWidth) - (cropW / 2);
        let cropY = (normY * sourceHeight) - (cropH / 2);
        cropX = Math.max(0, Math.min(sourceWidth - cropW, cropX));
        cropY = Math.max(0, Math.min(sourceHeight - cropH, cropY));

        const sx = sourceX + cropX;
        const sy = sourceY + cropY;
        const sw = cropW;
        const sh = cropH;

        // Draw video clipped to window frame with rounded corners
        this.ctx.save();
        this.ctx.shadowColor = 'transparent';
        this.ctx.beginPath();
        this.roundRect(this.ctx, windowX, windowY, windowW, windowH, radius);
        this.ctx.clip();
        
        this.ctx.filter = 'none';
        if (this.settings.sharpening) {
          this.ctx.filter = 'contrast(1.04) saturate(1.08) brightness(1.01)';
        }
        const wasSmoothingEnabled = this.ctx.imageSmoothingEnabled;
        const wasSmoothingQuality = this.ctx.imageSmoothingQuality;
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
        this.ctx.drawImage(
          this.video,
          sx, sy, sw, sh,
          windowX, videoY, windowW, videoDrawH
        );
        
        this.ctx.filter = 'none';
        this.ctx.imageSmoothingEnabled = wasSmoothingEnabled;
        this.ctx.imageSmoothingQuality = wasSmoothingQuality;

        // Draw Manual Blur regions inside video viewport (supports Zoom-Synced & Screen-Locked modes)
        this.drawBlurRegions(timestamp, windowX, videoY, windowW, videoDrawH, sx, sy, sw, sh, sourceX, sourceY, sourceWidth, sourceHeight);
        
        // Draw click animations inside video viewport
        this.drawClickEffects(timestamp, windowX, videoY, windowW, videoDrawH, sx, sy, sw, sh, srcWidth, srcHeight);
        
        // Optional cursor halo inside video viewport (mirrors editor preview)
        if (this.settings.cursorHighlight) {
          this.drawCursorHighlight(timestamp, windowX, videoY, windowW, videoDrawH, sx, sy, sw, sh, srcWidth, srcHeight);
        }
        
        // Draw macOS Window Title Bar Header if enabled (sits at top of window frame above video)
        if (this.settings.showMacWindowHeader !== false && macHeaderHeight > 0) {
          this.drawMacWindowHeader(windowX, windowY, windowW, macHeaderHeight, radius);
        }
        
        this.ctx.restore();

        // Draw crisp subtle window border when background is visible
        if (padding > 0) {
          this.ctx.save();
          this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.roundRect(this.ctx, windowX + 0.5, windowY + 0.5, windowW - 1, windowH - 1, radius);
          this.ctx.stroke();
          this.ctx.restore();
        }

        // Draw webcam overlay if enabled (composited on top of zoomed video viewport, with Smart Dodge / Zoom-With-Screen support)
        if (this.settings.showWebcam && (this.webcamVideo || this.settings.demoWebcamEnabled)) {
          if (this.webcamVideo && !this.webcamStream && isFinite(this.video.currentTime)) {
            const camDur = (isFinite(this.webcamVideo.duration) && this.webcamVideo.duration > 0)
              ? this.webcamVideo.duration
              : Infinity;
            const safeMaxTime = isFinite(camDur) ? Math.max(0, camDur - 0.02) : this.video.currentTime;
            const targetCamTime = Math.max(0, Math.min(safeMaxTime, this.video.currentTime));
            const isAtCamEnd = isFinite(camDur) && this.video.currentTime >= Math.max(0, camDur - 0.05);
            if (isAtCamEnd) {
              if (!this.webcamVideo.paused) {
                try { this.webcamVideo.pause(); } catch (_) {}
              }
              if (Math.abs((this.webcamVideo.currentTime || 0) - targetCamTime) > 0.04 && !this.webcamVideo.seeking) {
                try { this.webcamVideo.currentTime = targetCamTime; } catch (_) {}
              }
            } else {
              if (this.webcamVideo.playbackRate !== this.video.playbackRate) {
                this.webcamVideo.playbackRate = this.video.playbackRate;
              }
              if (Math.abs((this.webcamVideo.currentTime || 0) - targetCamTime) > 0.15 && !this.webcamVideo.seeking) {
                try {
                  this.webcamVideo.currentTime = targetCamTime;
                } catch (_) {}
              }
              if (this.webcamVideo.paused && !this.video.paused && !this.webcamVideo.ended) {
                this.webcamVideo.play().catch(() => {});
              }
            }
          }
          this.drawWebcam(
            windowX, videoY, windowW, videoDrawH,
            sx, sy, sw, sh,
            sourceX, sourceY, sourceWidth, sourceHeight,
            zoomScale, normX, normY, radius
          );
        }
        
        // Update frame timing stats
        this.frameTiming.frameCount++;
        const fpsUpdateInterval = 1000; // Update FPS calculation every second
        const currentTimeForFps = performance.now();
        if (currentTimeForFps - this.frameTiming.lastFpsUpdate >= fpsUpdateInterval) {
          this.frameTiming.actualFps = (this.frameTiming.frameCount * 1000) / (currentTimeForFps - this.frameTiming.lastFpsUpdate);
          this.frameTiming.frameCount = 0;
          this.frameTiming.lastFpsUpdate = currentTimeForFps;
        }
        
        // Progress
        const progress = ((this.video.currentTime - startTime) / duration) * 100;
        if (onProgress && progress - lastProgress > 1) {
          onProgress(Math.min(99, progress));
          lastProgress = progress;
        }
        
        // Debug logging for duration tracking
        if (frameIndex % 300 === 0) { // Log every 300 frames (~10 seconds at 30fps)
          debugLog('[VideoProcessor] Frame', frameIndex, '- currentTime:', this.video.currentTime.toFixed(2), 
                      '/ endTime:', endTime.toFixed(2), '- progress:', progress.toFixed(1) + '%');
        }
        
        frameIndex++;
        const frameEndTime = performance.now();
        const frameExecutionTime = frameEndTime - frameStart;
        lastFrameTimestamp = frameEndTime;
        
        // Schedule next frame with precise timing
        // Calculate when the next frame should start (based on target interval)
        nextFrameTime = nextFrameTime + targetFrameInterval;
        const currentPerformanceTime = performance.now();
        const timeUntilNextFrame = nextFrameTime - currentPerformanceTime;
        
        // Cap execution time to prevent spikes from breaking timing (max 2x target interval)
        const cappedExecutionTime = Math.min(frameExecutionTime, targetFrameInterval * 2);
        
        // Adjust delay to account for execution time, but maintain strict timing
        const adjustedDelay = Math.max(0, timeUntilNextFrame);
        
        // Use setTimeout with precise timing
        // If we're behind schedule (negative delay), schedule immediately to catch up
        if (adjustedDelay <= 0) {
          // We're behind - schedule immediately to catch up
          frameTimeoutId = setTimeout(() => {
            drawFrame();
          }, 0);
          // Reset nextFrameTime to current time to prevent drift
          nextFrameTime = currentPerformanceTime + targetFrameInterval;
        } else {
          frameTimeoutId = setTimeout(() => {
            drawFrame();
          }, adjustedDelay);
        }
      };
      
      // Don't stop on video.ended - only stop when we reach endTime
      // This ensures we process the full trimmed duration
      this.video.onended = () => {
        const currentTime = this.video.currentTime;
        debugLog('[VideoProcessor] Video ended event at:', currentTime, 'target endTime:', endTime);
        if (isProcessing) {
          debugLog('[VideoProcessor] Stopping - reached end of stream');
          isProcessing = false;
          if (frameTimeoutId) clearTimeout(frameTimeoutId);
          if (onProgress) onProgress(100);
          resolve();
        }
      };
      
      // Let video play normally, but control output frame rate
      this.video.playbackRate = 1.0;
      
      // Ensure video doesn't pause during processing
      // Keep a named reference so we can remove it on cleanup
      this._pauseGuard = () => {
        if (isProcessing && this.video && this.video.currentTime < endTime) {
          debugLog('[VideoProcessor] Video paused during processing, resuming...');
          this.video.play().catch(e => console.warn('[VideoProcessor] Resume error:', e));
        }
      };
      this.video.addEventListener('pause', this._pauseGuard);
      
      // Initialize frame timing
      this.frameTiming.lastFrameTime = performance.now();
      this.frameTiming.lastFpsUpdate = performance.now();
      this.frameTiming.frameCount = 0;
      
      // Start video playback
      this.video.play().then(() => {
        debugLog('[VideoProcessor] Video playback started, processing frames from', startTime, 'to', endTime);
        // Start frame loop with precise timing
        drawFrame();
      }).catch(err => {
        console.error('[VideoProcessor] Play error:', err);
        resolve();
      });
    });
  }

  // Helper methods
  async preloadBackgroundImage(imageDataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.backgroundImageElement = img;
        resolve();
      };
      img.onerror = reject;
      img.src = imageDataUrl;
    });
  }

  drawBackground(targetCtx = this.ctx) {
    // Handle image background (from upload) - use preloaded image
    if (this.backgroundImageElement) {
      targetCtx.drawImage(this.backgroundImageElement, 0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    
    const bg = this.settings.background;
    
    // Handle gradient backgrounds - parse CSS gradient string
    if (bg && typeof bg === 'string' && bg.includes('gradient')) {
      // Parse linear-gradient CSS string
      const gradMatch = bg.match(/linear-gradient\(([^)]+)\)/);
      if (gradMatch) {
        let x0 = 0, y0 = 0, x1 = this.canvas.width, y1 = this.canvas.height;
        const angleMatch = bg.match(/(\d+)deg/);
        if (angleMatch) {
          const angle = (parseFloat(angleMatch[1]) - 90) * (Math.PI / 180);
          const cx = this.canvas.width / 2;
          const cy = this.canvas.height / 2;
          const len = Math.sqrt(cx * cx + cy * cy);
          x0 = cx - Math.cos(angle) * len;
          y0 = cy - Math.sin(angle) * len;
          x1 = cx + Math.cos(angle) * len;
          y1 = cy + Math.sin(angle) * len;
        }
        const grad = targetCtx.createLinearGradient(x0, y0, x1, y1);
        // Extract color stops (hex, rgb, rgba, hsl)
        const colorStops = gradMatch[1].match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/g);
        if (colorStops && colorStops.length >= 2) {
          colorStops.forEach((col, idx) => {
            grad.addColorStop(idx / (colorStops.length - 1), col);
          });
          targetCtx.fillStyle = grad;
        } else {
          // Fallback to default gradient
          grad.addColorStop(0, '#667eea');
          grad.addColorStop(1, '#764ba2');
          targetCtx.fillStyle = grad;
        }
      } else {
        // Fallback to default gradient if parsing fails
        const grad = targetCtx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
        grad.addColorStop(0, '#667eea');
        grad.addColorStop(1, '#764ba2');
        targetCtx.fillStyle = grad;
      }
    } else if (bg === 'transparent' || bg === 'hidden' || bg === null) {
      targetCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    } else {
      // Solid color background
      targetCtx.fillStyle = bg || '#1a1a2e';
    }
    targetCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  roundRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  getEffectiveBrowserUIHeight(h = (this.video?.videoHeight || 1080)) {
    // If clean browser is disabled (user unchecked the box), show original browser tabs: return 0
    if (this.settings.cleanBrowser === false) return 0;
    if (this.settings.showBrowserFrame === true && this.settings.cleanBrowser === undefined) return 0;
    // Tab/Browser and Monitor/Screen recordings contain the full surface — never crop top chrome
    if (this.displaySurface === 'browser' || this.displaySurface === 'tab' || this.displaySurface === 'monitor' || this.displaySurface === 'screen') {
      return 0;
    }

    if (Number.isFinite(this.settings.browserTopBarHeight) && this.settings.browserTopBarHeight > 0 && this.displaySurface === 'window') {
      return Math.min(Math.round(h * 0.15), Math.round(this.settings.browserTopBarHeight));
    }

    const hasChromeInteraction = Array.isArray(this.cursorData) && (
      this.cursorData.length >= 2 ||
      this.cursorData.some(d => d && (d.type === 'click' || d.type === 'doubleclick' || d.type === 'mousedown' || d.type === 'scroll' || d.type === 'wheel' || (d.timestamp && d.timestamp > 0)))
    );
    const sampleWithWm = (hasChromeInteraction && this.cursorData)
      ? (this.cursorData.find(d => d && d.timestamp > 0 && d.windowMetrics && d.windowMetrics.topBarHeight > 0 && d.windowMetrics.screenHeight > 0) ||
         this.cursorData.find(d => d && d.windowMetrics && d.windowMetrics.topBarHeight > 0 && d.windowMetrics.screenHeight > 0) ||
         this.cursorData.find(d => d && d.windowMetrics && d.windowMetrics.topBarHeight > 0) ||
         this.cursorData.find(d => d && d.windowMetrics))
      : null;
    const wm = sampleWithWm ? sampleWithWm.windowMetrics : null;

    if (wm && wm.innerHeight && wm.outerHeight) {
      const vWidth = this.video?.videoWidth || 1920;
      const vHeight = this.video?.videoHeight || 1080;
      const videoAspect = (vWidth > 0 && vHeight > 0) ? (vWidth / vHeight) : (wm.outerWidth / wm.outerHeight);
      const winAspect = wm.outerWidth / wm.outerHeight;
      const hasClickOrScroll = Array.isArray(this.cursorData) && this.cursorData.some(d =>
        d && (d.type === 'click' || d.type === 'doubleclick' || d.type === 'mousedown' || d.type === 'scroll' || d.type === 'wheel')
      );

      // Explicit window recording of a Chrome window: crop topBarHeight proportionally
      if (this.displaySurface === 'window') {
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

  hexToRgba(hex, alpha) {
    if (!hex || typeof hex !== 'string') return `rgba(16, 185, 129, ${alpha})`;
    // Expand 3-digit shorthand (#rgb -> #rrggbb)
    const short = hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i, (_, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(short);
    if (!result) return `rgba(16, 185, 129, ${alpha})`;
    return `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`;
  }
  
  drawMacWindowHeader(windowX, windowY, windowW, headerHeight = 32, radius = 12) {
    this.ctx.save();
    
    // Draw header background (sleek macOS Sequoia/Sonoma obsidian bar)
    const headerGrad = this.ctx.createLinearGradient(windowX, windowY, windowX, windowY + headerHeight);
    headerGrad.addColorStop(0, '#1f2026');
    headerGrad.addColorStop(1, '#16171c');
    this.ctx.fillStyle = headerGrad;
    this.ctx.fillRect(windowX, windowY, windowW, headerHeight);
    
    // Draw subtle top highlight line
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.fillRect(windowX, windowY, windowW, 1);

    // Draw subtle bottom separator line
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    this.ctx.fillRect(windowX, windowY + headerHeight - 1, windowW, 1);
    
    // Draw traffic light circles (🔴 Close, 🟡 Minimize, 🟢 Zoom)
    const dotDiameter = Math.min(12, Math.max(9, Math.round(headerHeight * 0.36)));
    const dotRadius = dotDiameter / 2;
    const dotGap = Math.round(dotDiameter * 0.65);
    const startX = windowX + Math.round(headerHeight * 0.48);
    const centerY = windowY + Math.round(headerHeight * 0.5);
    
    const dots = [
      { fill: '#ff5f56', border: '#e0443e' }, // Close (Red)
      { fill: '#febc2e', border: '#dea123' }, // Minimize (Yellow)
      { fill: '#28c840', border: '#1aab29' }  // Zoom (Green)
    ];
    
    dots.forEach((dot, idx) => {
      const cx = startX + idx * (dotDiameter + dotGap);
      this.ctx.beginPath();
      this.ctx.arc(cx, centerY, dotRadius, 0, Math.PI * 2);
      this.ctx.fillStyle = dot.fill;
      this.ctx.fill();
      this.ctx.lineWidth = 1;
      this.ctx.strokeStyle = dot.border;
      this.ctx.stroke();
    });

    // Draw window title centered
    const titleText = (this.settings.windowTitle || 'CursorDemo Screen Recording');
    const fontSize = Math.min(13, Math.max(10, Math.round(headerHeight * 0.36)));
    this.ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif`;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(titleText, windowX + windowW / 2, centerY);
    
    this.ctx.restore();
  }

  drawCursorHighlight(timestamp, windowX, windowY, windowW, windowH, sx, sy, sw, sh, srcWidth, srcHeight) {
    if (!this.analyzer || !(sw > 0) || !(sh > 0)) return;
    const videoWidth = srcWidth || windowW;
    const videoHeight = srcHeight || windowH;
    const pos = (typeof this.analyzer.resolveCursorHighlightPos === 'function')
      ? this.analyzer.resolveCursorHighlightPos(timestamp, videoWidth, videoHeight, this.displaySurface, this.zoomSegments)
      : this.analyzer.getCursorAtTime(timestamp, videoWidth, videoHeight, this.displaySurface);
    if (!pos) return;

    const style = this.settings.cursorHighlightStyle || 'halo';
    const color = this.settings.cursorHighlightColor || '#ffab00';
    const sizeMult = Math.max(0.5, Math.min(2.5, Number(this.settings.cursorHighlightSize) || 1.0));
    const baseK = Math.max(0.5, windowW / 1920);
    const k = baseK * sizeMult;
    const margin = 80 * k;

    const x = windowX + ((pos.x - sx) / sw) * windowW;
    const y = windowY + ((pos.y - sy) / sh) * windowH;
    if (x < windowX - margin || x > windowX + windowW + margin || y < windowY - margin || y > windowY + windowH + margin) return;

    const ctx = this.ctx;
    let scale = 1.0;
    const recentClick = Array.isArray(this.cursorData) && this.cursorData.find(d =>
      d && (d.type === 'click' || d.type === 'doubleclick' || d.type === 'mousedown') &&
      timestamp >= d.timestamp - 40 && timestamp <= d.timestamp + 190
    );
    if (recentClick) {
      const progress = Math.min(1, Math.max(0, (timestamp - (recentClick.timestamp - 40)) / 230));
      scale = 1.0 - 0.24 * Math.sin(progress * Math.PI) * Math.exp(-progress * 1.8);
    }

    let vx = 0;
    let vy = 0;
    const prev = this.analyzer.getCursorAtTime(Math.max(0, timestamp - 20), videoWidth, videoHeight, this.displaySurface);
    if (prev) {
      const px = windowX + ((prev.x - sx) / sw) * windowW;
      const py = windowY + ((prev.y - sy) / sh) * windowH;
      vx = (x - px) / baseK;
      vy = (y - py) / baseK;
    }

    // 1. Spotlight mode: softly dim surrounding viewport outside the cursor beam
    if (style === 'spotlight') {
      const spotR = Math.max(18, 62 * scale * k);
      ctx.save();
      const spotGrad = ctx.createRadialGradient(x, y, spotR * 0.25, x, y, spotR * 1.45);
      spotGrad.addColorStop(0, 'rgba(6, 8, 14, 0)');
      spotGrad.addColorStop(0.55, this.hexToRgba(color, 0.16));
      spotGrad.addColorStop(0.78, 'rgba(6, 8, 14, 0.28)');
      spotGrad.addColorStop(1, 'rgba(6, 8, 14, 0.36)');
      ctx.fillStyle = spotGrad;
      ctx.fillRect(windowX, windowY, windowW, windowH);

      ctx.beginPath();
      ctx.arc(x, y, spotR * 0.65, 0, Math.PI * 2);
      ctx.strokeStyle = this.hexToRgba(color, 0.65);
      ctx.lineWidth = Math.max(1.5, 2.2 * k);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Velocity-oriented kinetic motion trail
    const speed = Math.hypot(vx, vy);
    if (speed > 2.0) {
      const trailLength = Math.min(32, speed * 1.4) * k;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(vy, vx));
      const trailGrad = ctx.createLinearGradient(-trailLength, 0, 0, 0);
      trailGrad.addColorStop(0, this.hexToRgba(color, 0));
      trailGrad.addColorStop(1, this.hexToRgba(color, 0.38));
      ctx.beginPath();
      ctx.ellipse(-trailLength / 2, 0, Math.max(1, trailLength / 2), Math.max(1.5, 4.2 * scale * k), 0, 0, Math.PI * 2);
      ctx.fillStyle = trailGrad;
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    if (style === 'ring') {
      const ringR = Math.max(8, 22 * scale * k);
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.48)';
      ctx.lineWidth = Math.max(3, 4.8 * k);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = this.hexToRgba(color, 0.95);
      ctx.lineWidth = Math.max(2, 2.8 * k);
      ctx.shadowColor = this.hexToRgba(color, 0.65);
      ctx.shadowBlur = 8 * k;
      ctx.stroke();
    } else if (style === 'dot') {
      const glowR = Math.max(6, 15 * scale * k);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, glowR);
      grad.addColorStop(0, this.hexToRgba(color, 0.92));
      grad.addColorStop(0.55, this.hexToRgba(color, 0.42));
      grad.addColorStop(1, this.hexToRgba(color, 0));
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    } else {
      const outerR = Math.max(10, 28 * scale * k);
      const midR = Math.max(6, 17 * scale * k);

      const grad = ctx.createRadialGradient(x, y, 0, x, y, outerR);
      grad.addColorStop(0, this.hexToRgba(color, 0.52));
      grad.addColorStop(0.55, this.hexToRgba(color, 0.28));
      grad.addColorStop(0.85, this.hexToRgba(color, 0.10));
      grad.addColorStop(1, this.hexToRgba(color, 0));
      ctx.beginPath();
      ctx.arc(x, y, outerR, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, midR, 0, Math.PI * 2);
      ctx.strokeStyle = this.hexToRgba(color, 0.78);
      ctx.lineWidth = Math.max(1.25, 1.8 * k);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 4 * k;
      ctx.stroke();
    }

    // Center high-contrast cursor pip
    const innerR = Math.max(2.5, 5.2 * scale * k);
    ctx.beginPath();
    ctx.arc(x, y, innerR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 5 * k;
    ctx.fill();

    ctx.lineWidth = Math.max(1, 1.4 * k);
    ctx.strokeStyle = this.hexToRgba(color, 0.95);
    ctx.stroke();
    ctx.restore();
  }

  getDeduplicatedClicks(data = this.cursorData) {
    if (!data || data.length === 0) return [];
    if (data === this.cursorData && this._dedupedClicks && this._dedupedRef === this.cursorData) {
      return this._dedupedClicks;
    }
    const raw = data.filter(d => d && (d.type === 'click' || d.type === 'doubleclick' || d.type === 'mousedown'));
    if (raw.length === 0) return [];
    raw.sort((a, b) => a.timestamp - b.timestamp);
    const vW = this.video?.videoWidth || 1920;
    const vH = this.video?.videoHeight || 1080;
    const hasZA = typeof ZoomAnalyzer !== 'undefined' && typeof ZoomAnalyzer.getPointSourceCoords === 'function';
    const result = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (result.length > 0) {
        const prev = result[result.length - 1];
        const dt = Math.abs(c.timestamp - prev.timestamp);
        let normDist = 0;
        if (hasZA) {
          const pCur = ZoomAnalyzer.getPointSourceCoords(c, vW, vH, this.displaySurface);
          const pPrev = ZoomAnalyzer.getPointSourceCoords(prev, vW, vH, this.displaySurface);
          normDist = Math.hypot(
            (pCur.x - pPrev.x) / Math.max(1, vW),
            (pCur.y - pPrev.y) / Math.max(1, vH)
          );
        } else {
          const prevNx = prev.normalizedX !== undefined ? prev.normalizedX : ((prev.x || 0) / Math.max(1, prev.viewportWidth || vW));
          const prevNy = prev.normalizedY !== undefined ? prev.normalizedY : ((prev.y || 0) / Math.max(1, prev.viewportHeight || vH));
          const curNx = c.normalizedX !== undefined ? c.normalizedX : ((c.x || 0) / Math.max(1, c.viewportWidth || vW));
          const curNy = c.normalizedY !== undefined ? c.normalizedY : ((c.y || 0) / Math.max(1, c.viewportHeight || vH));
          normDist = Math.hypot(curNx - prevNx, curNy - prevNy);
        }
        if (dt < 40 || (dt < 250 && normDist < 0.035)) {
          if (c.type === 'click' || c.type === 'doubleclick') {
            result[result.length - 1] = c;
          }
          continue;
        }
      }
      result.push(c);
    }
    if (data === this.cursorData) {
      this._dedupedClicks = result;
      this._dedupedRef = this.cursorData;
    }
    return result;
  }

  drawClickEffects(timestamp, windowX, windowY, windowW, windowH, sx, sy, sw, sh, srcWidth, srcHeight) {
    if (this.settings.clickEnabled === false || this.settings.clickStyle === 'none' || !this.cursorData) return;
    const videoWidth = srcWidth || windowW;
    const videoHeight = srcHeight || windowH;
    const scaleK = (windowW > 0 && videoWidth > 0) ? (windowW / videoWidth) : 1;
    const previewBeforeMs = 80;  // 80ms anticipation
    const durationAfterMs = 520; // 520ms radiating pulse
    const totalWindow = previewBeforeMs + durationAfterMs;
    const allClicks = this.getDeduplicatedClicks();
    const clicks = allClicks.filter(d => timestamp >= d.timestamp - previewBeforeMs && timestamp < d.timestamp + durationAfterMs);
    
    const cropSx = (sw !== undefined && sw > 0) ? sx : 0;
    const cropSy = (sh !== undefined && sh > 0) ? sy : 0;
    const cropSw = (sw !== undefined && sw > 0) ? sw : videoWidth;
    const cropSh = (sh !== undefined && sh > 0) ? sh : videoHeight;
    const margin = 120 * scaleK;

    clicks.forEach(click => {
      const timeFromClick = timestamp - click.timestamp;
      const progress = (timeFromClick + previewBeforeMs) / totalWindow; // Normalize to 0-1
      
      // Resolve exact source coordinates using unified resolver
      const clickCoords = ZoomAnalyzer.getPointSourceCoords(click, videoWidth, videoHeight, this.displaySurface);
      
      // Map from visible source crop [cropSx, cropSy, cropSw, cropSh] to window destination [windowX, windowY, windowW, windowH]
      const x = windowX + ((clickCoords.x - cropSx) / cropSw) * windowW;
      const y = windowY + ((clickCoords.y - cropSy) / cropSh) * windowH;
      
      if (x >= windowX - margin && x <= windowX + windowW + margin && y >= windowY - margin && y <= windowY + windowH + margin) {
        this.drawRippleClick(x, y, progress, click, scaleK);
      }
    });
  }

  drawRippleClick(x, y, progress, click, scaleK = 1) {
    if (progress < 0 || progress > 1) return;
    
    const style = this.settings.clickStyle || 'ripple';
    if (style === 'none') return;
    
    const k = (Number.isFinite(scaleK) && scaleK > 0) ? scaleK : 1;
    const wavesType = this.settings.clickWaves || 'double';
    const force = this.settings.clickForce || 'moderate';
    
    // Get selected color - resolve presets or direct hex
    const colorPresets = {
      green: '#10b981',
      emerald: '#10b981',
      blue: '#3b82f6',
      purple: '#8b5cf6',
      pink: '#ec4899',
      orange: '#f97316',
      red: '#ef4444',
      cyan: '#06b6d4',
      amber: '#f59e0b',
      white: '#ffffff'
    };
    const rawColor = this.settings.customClickColor || this.settings.clickColor || '#ffffff';
    let baseColor = (rawColor && rawColor.startsWith('#')) ? rawColor : (colorPresets[rawColor] || '#ffffff');
    
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
    
    // Force & spread configurations (scaled proportionally to output window width)
    const forceConfig = {
      weak: { maxRadius: 55 * k, alpha: 0.8, stroke: 0.85 * k },
      moderate: { maxRadius: 85 * k, alpha: 1.0, stroke: 1.0 * k },
      strong: { maxRadius: 125 * k, alpha: 1.25, stroke: 1.25 * k }
    };
    const config = forceConfig[force] || forceConfig.moderate;
    
    const anticipateWindow = 80 / 600; // ~0.1333 anticipation fraction
    
    this.ctx.save();
    
    if (progress < anticipateWindow) {
      // Phase 1: Pre-click anticipation (0 -> 80ms)
      const antProgress = progress / anticipateWindow;
      const antAlpha = antProgress * 0.75 * config.alpha;
      const antRadius = (4 + antProgress * 5) * k;
      
      const glowGrad = this.ctx.createRadialGradient(x, y, 0, x, y, antRadius * 2.2);
      glowGrad.addColorStop(0, this.hexToRgba(ringColor, antAlpha * 0.6));
      glowGrad.addColorStop(1, this.hexToRgba(ringColor, 0));
      this.ctx.beginPath();
      this.ctx.arc(x, y, antRadius * 2.2, 0, Math.PI * 2);
      this.ctx.fillStyle = glowGrad;
      this.ctx.fill();
      
      this.ctx.beginPath();
      this.ctx.arc(x, y, antRadius, 0, Math.PI * 2);
      this.ctx.fillStyle = this.hexToRgba(ringColor, antAlpha);
      this.ctx.fill();
      
      this.ctx.restore();
      return;
    }
    
    // Phase 2: Post-click radiating pulse (80ms -> 600ms)
    const t = (progress - anticipateWindow) / (1 - anticipateWindow); // 0 to 1
    
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
    
    // 1. Expanding Multi-Wave Shockwaves
    if (style === 'ripple' || style === 'both' || style === 'ring') {
      waveDefs.forEach((wave, idx) => {
        if (t < wave.delay) return;
        const wp = (t - wave.delay) / (1 - wave.delay);
        if (wp > 1) return;
        
        // Screenforge-grade ease-out cubic radial dispersion
        const easeRadius = 1 - Math.pow(1 - wp, 3);
        const startRadius = 6 * k;
        const r = startRadius + (config.maxRadius - startRadius) * easeRadius;
        
        // Rapid attack, smooth power decay
        const attack = Math.min(1, wp / 0.14);
        const decay = Math.pow(1 - wp, 1.5);
        const waveAlpha = Math.max(0, attack * decay * 0.95 * wave.weight * config.alpha);
        if (waveAlpha <= 0.01) return;
        
        // Soft ambient aura for leading wave
        if (idx === 0 && (style === 'ripple' || style === 'both')) {
          const auraAlpha = waveAlpha * 0.18;
          if (auraAlpha > 0.01) {
            const auraGrad = this.ctx.createRadialGradient(x, y, 0, x, y, r);
            auraGrad.addColorStop(0, this.hexToRgba(ringColor, auraAlpha * 1.5));
            auraGrad.addColorStop(0.65, this.hexToRgba(ringColor, auraAlpha * 0.5));
            auraGrad.addColorStop(1, this.hexToRgba(ringColor, 0));
            this.ctx.beginPath();
            this.ctx.arc(x, y, r, 0, Math.PI * 2);
            this.ctx.fillStyle = auraGrad;
            this.ctx.fill();
          }
        }
        
        this.ctx.beginPath();
        this.ctx.arc(x, y, r, 0, Math.PI * 2);
        
        this.ctx.shadowColor = this.hexToRgba(ringColor, Math.min(1, waveAlpha * 0.8));
        this.ctx.shadowBlur = 6 * config.stroke;
        
        const baseWidth = (style === 'ring') ? 3.5 : 2.8;
        this.ctx.lineWidth = Math.max(0.75, (baseWidth - wp * 1.5) * config.stroke);
        
        if (isRightClick && idx === 1) {
          this.ctx.setLineDash([5 * k, 4 * k]);
        } else {
          this.ctx.setLineDash([]);
        }
        
        this.ctx.strokeStyle = this.hexToRgba(ringColor, waveAlpha);
        this.ctx.stroke();
        
        if (idx === 0 && wp < 0.6) {
          const innerHighlightAlpha = waveAlpha * 0.45;
          this.ctx.beginPath();
          this.ctx.arc(x, y, Math.max(1, r - 1.5 * k), 0, Math.PI * 2);
          this.ctx.strokeStyle = this.hexToRgba('#ffffff', innerHighlightAlpha);
          this.ctx.lineWidth = Math.max(0.75, 1 * k);
          this.ctx.stroke();
        }
      });
    }
    
    this.ctx.shadowBlur = 0;
    this.ctx.setLineDash([]);
    
    // 2. Central Focal Anchor / Glow Orb
    const anchorDecay = Math.pow(Math.max(0, 1 - t / 0.55), 1.8);
    const anchorAlpha = anchorDecay * config.alpha;
    
    if (anchorAlpha > 0.02) {
      const isOrbDominant = (style === 'orb' || style === 'both');
      const orbRadius = isOrbDominant 
        ? (26 * config.stroke * (0.8 + (1 - t) * 0.4))
        : (12 * config.stroke * (0.7 + (1 - t) * 0.5));
      
      const anchorGrad = this.ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, orbRadius));
      anchorGrad.addColorStop(0, this.hexToRgba('#ffffff', Math.min(1, anchorAlpha * 1.3)));
      anchorGrad.addColorStop(0.3, this.hexToRgba(ringColor, anchorAlpha * 0.95));
      anchorGrad.addColorStop(0.7, this.hexToRgba(ringColor, anchorAlpha * 0.4));
      anchorGrad.addColorStop(1, this.hexToRgba(ringColor, 0));
      
      this.ctx.beginPath();
      this.ctx.arc(x, y, Math.max(1, orbRadius), 0, Math.PI * 2);
      this.ctx.fillStyle = anchorGrad;
      this.ctx.fill();
      
      const pipRadius = Math.max(1.5 * k, orbRadius * 0.25);
      this.ctx.beginPath();
      this.ctx.arc(x, y, pipRadius, 0, Math.PI * 2);
      this.ctx.fillStyle = this.hexToRgba('#ffffff', Math.min(1, anchorAlpha * 1.4));
      this.ctx.fill();
    }
    
    // 3. Right-Click Distinctive Badge
    if (isRightClick && t < 0.6) {
      const rcAlpha = Math.min(1, (1 - t / 0.6)) * 0.9 * config.alpha;
      this.ctx.save();
      this.ctx.fillStyle = this.hexToRgba('#f59e0b', rcAlpha);
      this.ctx.strokeStyle = this.hexToRgba('#ffffff', rcAlpha * 0.9);
      this.ctx.lineWidth = Math.max(0.75, 1 * k);
      this.ctx.font = `bold ${Math.max(7, Math.round(9 * k))}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      
      const badgeY = y - (18 + (1 - Math.pow(1 - t, 2)) * 6) * k;
      const badgeW = 16 * k;
      const badgeH = 13 * k;
      const badgeR = 3 * k;
      
      this.ctx.beginPath();
      if (typeof this.ctx.roundRect === 'function') {
        this.ctx.roundRect(x - badgeW/2, badgeY - badgeH/2, badgeW, badgeH, badgeR);
      } else {
        this.ctx.rect(x - badgeW/2, badgeY - badgeH/2, badgeW, badgeH);
      }
      this.ctx.fill();
      this.ctx.stroke();
      
      this.ctx.fillStyle = this.hexToRgba('#111827', rcAlpha);
      this.ctx.fillText('R', x, badgeY + 0.5 * k);
      this.ctx.restore();
    }
    
    this.ctx.restore();
  }

  // Backward-compatibility wrapper for legacy calls
  drawOrbClick(x, y, progress) {
    this.drawRippleClick(x, y, progress, null);
  }



  /**
   * Render Manual Blur regions during video export (supports Zoom-Synced 'content' and Screen-Locked 'screen' modes,
   * plus 'gaussian' Frosted Glass, 'pixelate' Mosaic, and 'solid' Redacted styles).
   */
  drawBlurRegions(timestampMs, viewportX, viewportY, viewportW, viewportH, sx, sy, sw, sh, sourceX, sourceY, sourceWidth, sourceHeight) {
    const blurRegions = this.settings.blurRegions;
    if (!Array.isArray(blurRegions) || blurRegions.length === 0 || !this.ctx || !this.video) return;

    const activeRegions = blurRegions.filter(reg => {
      if (!reg) return false;
      if (reg.fullVideo) return true;
      return timestampMs >= (reg.startTime || 0) && timestampMs <= (reg.endTime || 0);
    });
    if (activeRegions.length === 0) return;

    const scaleFactor = Math.max(0.4, viewportW / 1280);

    activeRegions.forEach(reg => {
      const rx = Math.max(0, Math.min(0.98, Number(reg.x) || 0));
      const ry = Math.max(0, Math.min(0.98, Number(reg.y) || 0));
      const rw = Math.max(0.02, Math.min(1 - rx, Number(reg.width) || 0.25));
      const rh = Math.max(0.02, Math.min(1 - ry, Number(reg.height) || 0.14));

      let rectX, rectY, rectW, rectH;
      if (reg.mode === 'screen') {
        rectX = viewportX + rx * viewportW;
        rectY = viewportY + ry * viewportH;
        rectW = rw * viewportW;
        rectH = rh * viewportH;
      } else {
        const srcX = (sourceX || 0) + rx * (sourceWidth || sw);
        const srcY = (sourceY || 0) + ry * (sourceHeight || sh);
        const srcW = rw * (sourceWidth || sw);
        const srcH = rh * (sourceHeight || sh);
        const cropSw = Math.max(1, sw);
        const cropSh = Math.max(1, sh);
        rectX = viewportX + ((srcX - sx) / cropSw) * viewportW;
        rectY = viewportY + ((srcY - sy) / cropSh) * viewportH;
        rectW = (srcW / cropSw) * viewportW;
        rectH = (srcH / cropSh) * viewportH;
      }

      // Skip if completely outside viewport
      if (
        rectX + rectW < viewportX ||
        rectX > viewportX + viewportW ||
        rectY + rectH < viewportY ||
        rectY > viewportY + viewportH
      ) {
        return;
      }

      const style = reg.style || 'gaussian';
      const intensity = Math.max(4, Math.min(64, Number(reg.intensity) || 18));
      const rawRadius = Number(reg.radius ?? 14);
      const radius = rawRadius >= 900
        ? Math.min(rectW, rectH) / 2
        : Math.min(rectW / 2, rectH / 2, Math.round(rawRadius * scaleFactor));

      this.ctx.save();
      this.ctx.beginPath();
      if (radius > 0) {
        this.roundRect(this.ctx, rectX, rectY, rectW, rectH, radius);
      } else {
        this.ctx.rect(rectX, rectY, rectW, rectH);
      }
      this.ctx.clip();

      if (style === 'solid') {
        this.ctx.fillStyle = '#090c14';
        this.ctx.fillRect(rectX, rectY, rectW, rectH);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        this.ctx.lineWidth = 1.5;
        const step = Math.max(10, Math.round(14 * scaleFactor));
        for (let d = -rectH; d < rectW + rectH; d += step) {
          this.ctx.beginPath();
          this.ctx.moveTo(rectX + d, rectY);
          this.ctx.lineTo(rectX + d - rectH, rectY + rectH);
          this.ctx.stroke();
        }
      } else if (style === 'pixelate') {
        if (!this._blurMosaicCanvas) {
          this._blurMosaicCanvas = document.createElement('canvas');
        }
        const blockPx = Math.max(4, Math.round(intensity * 0.7 * scaleFactor));
        const mw = Math.max(2, Math.min(240, Math.ceil(rectW / blockPx)));
        const mh = Math.max(2, Math.min(240, Math.ceil(rectH / blockPx)));
        this._blurMosaicCanvas.width = mw;
        this._blurMosaicCanvas.height = mh;
        const mctx = this._blurMosaicCanvas.getContext('2d');
        mctx.imageSmoothingEnabled = true;

        const subSx = sx + ((rectX - viewportX) / Math.max(1, viewportW)) * sw;
        const subSy = sy + ((rectY - viewportY) / Math.max(1, viewportH)) * sh;
        const subSw = Math.max(1, (rectW / Math.max(1, viewportW)) * sw);
        const subSh = Math.max(1, (rectH / Math.max(1, viewportH)) * sh);
        mctx.drawImage(this.video, subSx, subSy, subSw, subSh, 0, 0, mw, mh);

        const prevSmooth = this.ctx.imageSmoothingEnabled;
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.drawImage(this._blurMosaicCanvas, 0, 0, mw, mh, rectX, rectY, rectW, rectH);
        this.ctx.imageSmoothingEnabled = prevSmooth;
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
        this.ctx.fillRect(rectX, rectY, rectW, rectH);
      } else {
        const blurPx = Math.max(3, Math.round(intensity * scaleFactor));
        this.ctx.filter = `blur(${blurPx}px)`;
        this.ctx.drawImage(this.video, sx, sy, sw, sh, viewportX, viewportY, viewportW, viewportH);
        this.ctx.filter = 'none';
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
        this.ctx.fillRect(rectX, rectY, rectW, rectH);
      }

      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
      this.ctx.restore();
    });
  }

  getOrRenderDemoWebcamCanvas(timeSec = 0) {
    if (!this._demoWebcamCanvas) {
      this._demoWebcamCanvas = document.createElement('canvas');
      this._demoWebcamCanvas.width = 360;
      this._demoWebcamCanvas.height = 360;
    }
    const c = this._demoWebcamCanvas;
    const dctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;

    const bgGrad = dctx.createLinearGradient(0, 0, w, h);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(0.5, '#1e1b4b');
    bgGrad.addColorStop(1, '#064e3b');
    dctx.fillStyle = bgGrad;
    dctx.fillRect(0, 0, w, h);

    const glowX = w * 0.5;
    const glowY = h * 0.42;
    const rad = dctx.createRadialGradient(glowX, glowY, 10, glowX, glowY, 150);
    rad.addColorStop(0, 'rgba(16, 185, 129, 0.36)');
    rad.addColorStop(1, 'rgba(16, 185, 129, 0)');
    dctx.fillStyle = rad;
    dctx.fillRect(0, 0, w, h);

    const headBob = 0;
    dctx.fillStyle = '#334155';
    dctx.beginPath();
    dctx.ellipse(w * 0.5, h * 0.92 + headBob * 0.5, w * 0.34, h * 0.24, 0, Math.PI, 0, false);
    dctx.fill();

    dctx.fillStyle = '#f8fafc';
    dctx.beginPath();
    dctx.arc(w * 0.5, h * 0.44 + headBob, w * 0.17, 0, Math.PI * 2);
    dctx.fill();

    dctx.strokeStyle = '#10b981';
    dctx.lineWidth = 4;
    dctx.beginPath();
    dctx.arc(w * 0.5, h * 0.44 + headBob, w * 0.2, Math.PI * 1.1, Math.PI * 1.9);
    dctx.stroke();

    dctx.fillStyle = 'rgba(6, 78, 59, 0.85)';
    dctx.fillRect(w * 0.24, h * 0.78, w * 0.52, 26);
    dctx.fillStyle = '#a7f3d0';
    dctx.font = '700 13px -apple-system, BlinkMacSystemFont, sans-serif';
    dctx.textAlign = 'center';
    dctx.textBaseline = 'middle';
    dctx.fillText('LIVE STUDIO CAM', w * 0.5, h * 0.78 + 13);
    return c;
  }

  drawWebcam(
    arg1, arg2, arg3, arg4,
    sx, sy, sw, sh,
    sourceX, sourceY, sourceWidth, sourceHeight,
    zoomScale = 1.0, zoomNormX = 0.5, zoomNormY = 0.5, windowRadius = 14
  ) {
    const hasRecordedVideo = Boolean(this.webcamVideo && this.webcamVideo.videoWidth && this.webcamVideo.videoHeight);
    if (!hasRecordedVideo && !this.settings.demoWebcamEnabled) return;

    // Support both 4+-arg (viewportX, viewportY, viewportW, viewportH, ...) and legacy 3-arg (padding, videoWidth, videoHeight)
    let viewportX, viewportY, viewportW, viewportH;
    if (typeof arg4 === 'number') {
      viewportX = arg1;
      viewportY = arg2;
      viewportW = arg3;
      viewportH = arg4;
    } else {
      const padding = arg1 || 0;
      viewportX = padding;
      viewportY = padding;
      viewportW = arg2 || (this.canvas ? this.canvas.width - padding * 2 : 1920);
      viewportH = arg3 || (this.canvas ? this.canvas.height - padding * 2 : 1080);
    }

    // 1:1 square sizing & margin matching editor.js computeWebcamOverlayMetrics 1:1
    const sizeRatios = { small: 0.14, medium: 0.19, large: 0.25 };
    const sizeRatio = sizeRatios[this.settings.webcamSize] || 0.19;
    const customScale = Math.max(0.5, Math.min(1.8, Number(this.settings.webcamScale) || 1.0));
    const baseDim = Math.max(1, Math.min(viewportW, viewportH));
    let camSide = Math.max(36, Math.round(baseDim * sizeRatio * customScale));
    const margin = Math.max(10, Math.round(baseDim * 0.032));

    const pos = this.settings.webcamPosition || 'bottom-right';
    let localX = viewportW - camSide - margin;
    let localY = viewportH - camSide - margin;

    if (pos === 'custom' && Number.isFinite(this.settings.webcamCustomX) && Number.isFinite(this.settings.webcamCustomY)) {
      const availW = Math.max(1, viewportW - camSide - margin * 2);
      const availH = Math.max(1, viewportH - camSide - margin * 2);
      localX = Math.round(margin + Math.max(0, Math.min(1, this.settings.webcamCustomX)) * availW);
      localY = Math.round(margin + Math.max(0, Math.min(1, this.settings.webcamCustomY)) * availH);
    } else if (pos === 'top-left') {
      localX = margin;
      localY = margin;
    } else if (pos === 'top-right') {
      localX = viewportW - camSide - margin;
      localY = margin;
    } else if (pos === 'bottom-left') {
      localX = margin;
      localY = viewportH - camSide - margin;
    }

    const rawZoomMode = this.settings.webcamZoomMode || 'float';
    const zoomMode = (rawZoomMode === 'floating') ? 'float' : rawZoomMode;
    let dodged = false;

    if (zoomScale > 1.04) {
      if (zoomMode === 'zoom-with-screen' && typeof sw === 'number' && sw > 0 && typeof sh === 'number' && sh > 0) {
        const srcW = Math.max(1, sourceWidth || viewportW);
        const srcH = Math.max(1, sourceHeight || viewportH);
        const srcX0 = sourceX || 0;
        const srcY0 = sourceY || 0;
        const bubbleSrcX = srcX0 + (localX / Math.max(1, viewportW)) * srcW;
        const bubbleSrcY = srcY0 + (localY / Math.max(1, viewportH)) * srcH;
        const bubbleSrcSide = (camSide / Math.max(1, viewportW)) * srcW;
        localX = Math.round(((bubbleSrcX - (sx || 0)) / sw) * viewportW);
        localY = Math.round(((bubbleSrcY - (sy || 0)) / sh) * viewportH);
        camSide = Math.max(36, Math.round((bubbleSrcSide / sw) * viewportW));
        this._isWebcamCurrentlyDodged = false;
      } else if (zoomMode === 'smart-dodge') {
        const bubbleCenterX = localX + camSide / 2;
        const bubbleCenterY = localY + camSide / 2;

        let focusX = NaN;
        let focusY = NaN;
        if (this.analyzer && this.cursorData && this.cursorData.length > 0 && this.video && sw > 0 && sh > 0) {
          const vW = this.video.videoWidth || sourceWidth || viewportW;
          const vH = this.video.videoHeight || sourceHeight || viewportH;
          const cPos = this.analyzer.getCursorAtTime((this.video.currentTime || 0) * 1000, vW, vH, this.displaySurface);
          if (cPos) {
            focusX = ((cPos.x - (sx || 0)) / sw) * viewportW;
            focusY = ((cPos.y - (sy || 0)) / sh) * viewportH;
          }
        }

        if (Number.isFinite(focusX) && Number.isFinite(focusY)) {
          const bubbleNormX = bubbleCenterX / Math.max(1, viewportW);
          const distToCursor = Math.hypot(focusX - bubbleCenterX, focusY - bubbleCenterY);
          const threshold = this._isWebcamCurrentlyDodged ? (camSide * 0.90) : (camSide * 0.62);

          if (distToCursor < threshold) {
            dodged = true;
            this._isWebcamCurrentlyDodged = true;
            const shrinkSide = Math.max(36, Math.round(camSide * 0.88));
            if (bubbleNormX >= 0.5) {
              localX = margin;
            } else {
              localX = viewportW - shrinkSide - margin;
            }
            camSide = shrinkSide;
            localY = Math.max(margin, Math.min(viewportH - camSide - margin, localY));
          } else {
            this._isWebcamCurrentlyDodged = false;
          }
        } else {
          this._isWebcamCurrentlyDodged = false;
        }
      } else {
        this._isWebcamCurrentlyDodged = false;
      }
    } else {
      this._isWebcamCurrentlyDodged = false;
    }

    const targetX = viewportX + localX;
    const targetY = viewportY + localY;
    const targetW = camSide;

    if (
      zoomMode !== 'smart-dodge' ||
      typeof this._webcamDodgeX !== 'number' ||
      typeof this._webcamDodgeY !== 'number' ||
      typeof this._webcamDodgeScale !== 'number'
    ) {
      this._webcamDodgeX = targetX;
      this._webcamDodgeY = targetY;
      this._webcamDodgeScale = targetW;
    } else {
      const smooth = 0.22;
      this._webcamDodgeX += (targetX - this._webcamDodgeX) * smooth;
      this._webcamDodgeY += (targetY - this._webcamDodgeY) * smooth;
      this._webcamDodgeScale += (targetW - this._webcamDodgeScale) * smooth;
    }

    const x = Math.round(this._webcamDodgeX);
    const y = Math.round(this._webcamDodgeY);
    const webcamWidth = Math.max(36, Math.round(this._webcamDodgeScale));
    const webcamHeight = webcamWidth;

    // Center-crop the source camera frame to a 1:1 square
    const camSource = hasRecordedVideo
      ? this.webcamVideo
      : this.getOrRenderDemoWebcamCanvas(this.video ? this.video.currentTime : 0);
    const vw = Math.max(1, hasRecordedVideo ? this.webcamVideo.videoWidth : camSource.width);
    const vh = Math.max(1, hasRecordedVideo ? this.webcamVideo.videoHeight : camSource.height);
    const sSize = Math.min(vw, vh);
    const camSx = (vw - sSize) / 2;
    const camSy = (vh - sSize) / 2;

    const shape = this.settings.webcamShape || 'circular';
    const circleRadius = webcamWidth / 2;
    const roundedRadius = Math.round(webcamWidth * 0.22);

    const traceBubblePath = () => {
      this.ctx.beginPath();
      if (shape === 'circular') {
        this.ctx.arc(x + webcamWidth / 2, y + webcamHeight / 2, circleRadius, 0, Math.PI * 2);
      } else if (shape === 'rounded') {
        this.roundRect(this.ctx, x, y, webcamWidth, webcamHeight, roundedRadius);
      } else {
        this.ctx.rect(x, y, webcamWidth, webcamHeight);
      }
      this.ctx.closePath();
    };

    // Clip to window viewport if zoom-with-screen is active so zoomed-in camera doesn't spill outside video frame
    this.ctx.save();
    if (zoomMode === 'zoom-with-screen') {
      this.ctx.beginPath();
      this.roundRect(this.ctx, viewportX, viewportY, viewportW, viewportH, windowRadius || 0);
      this.ctx.clip();
    }

    // 1. Backing shape with ambient drop shadow
    this.ctx.save();
    traceBubblePath();
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    this.ctx.shadowBlur = Math.max(10, Math.round(webcamWidth * 0.14));
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = Math.max(4, Math.round(webcamWidth * 0.05));
    this.ctx.fillStyle = '#0f172a';
    this.ctx.fill();
    this.ctx.restore();

    // 2. Clipped 1:1 center-cropped camera frame
    this.ctx.save();
    traceBubblePath();
    this.ctx.clip();
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    if (this.settings.webcamFlip !== false && hasRecordedVideo) {
      this.ctx.translate(x + webcamWidth, y);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(camSource, camSx, camSy, sSize, sSize, 0, 0, webcamWidth, webcamHeight);
    } else {
      this.ctx.drawImage(camSource, camSx, camSy, sSize, sSize, x, y, webcamWidth, webcamHeight);
    }
    this.ctx.restore();

    // 3. Crisp studio border ring (emerald glow when Smart-Dodging)
    this.ctx.save();
    this.ctx.shadowColor = 'transparent';
    traceBubblePath();
    const borderWidth = Math.max(2, Math.round(webcamWidth * 0.024));
    this.ctx.strokeStyle = dodged
      ? 'rgba(16, 185, 129, 0.95)'
      : 'rgba(255, 255, 255, 0.92)';
    this.ctx.lineWidth = borderWidth;
    this.ctx.stroke();

    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.24)';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
    this.ctx.restore();

    this.ctx.restore();
  }

  // Setup webcam video: prefer recorded synchronized cameraBlob from editor if available
  async setupWebcamVideo() {
    try {
      const recordedCamBlob = this.settings.cameraBlob || this.settings.webcamBlob;
      if (recordedCamBlob && recordedCamBlob.size > 0) {
        this.webcamStream = null;
        this.webcamVideo = document.createElement('video');
        this.webcamObjectUrl = URL.createObjectURL(recordedCamBlob);
        this.webcamVideo.src = this.webcamObjectUrl;
        this.webcamVideo.muted = true;
        this.webcamVideo.playsInline = true;
        this.webcamVideo.preload = 'auto';

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => resolve(), 5000);
          this.webcamVideo.onloadeddata = () => {
            clearTimeout(timeout);
            resolve();
          };
          this.webcamVideo.onloadedmetadata = () => {
            if (this.webcamVideo.readyState >= 2) {
              clearTimeout(timeout);
              resolve();
            }
          };
          this.webcamVideo.onerror = (err) => {
            clearTimeout(timeout);
            reject(err);
          };
          this.webcamVideo.load();
        });
        debugLog('[VideoProcessor] Loaded recorded Face Cam blob for export:', this.webcamVideo.videoWidth, 'x', this.webcamVideo.videoHeight);
        return;
      }

      if (this.settings.demoWebcamEnabled) {
        this.webcamStream = null;
        this.webcamVideo = null;
        debugLog('[VideoProcessor] Using synthetic Studio Preview Cam for export');
        return;
      }

      // Fallback: request live camera if no recorded camera blob was supplied
      const constraints = {
        video: { 
          width: { ideal: 720, max: 1280 },
          height: { ideal: 720, max: 1280 },
          facingMode: 'user' 
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
      
      this.webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.webcamVideo = document.createElement('video');
      this.webcamVideo.srcObject = this.webcamStream;
      this.webcamVideo.muted = true; // Mute playback, but audio will be captured
      await this.webcamVideo.play();
      debugLog('[VideoProcessor] Camera video set up, audio tracks:', this.webcamStream.getAudioTracks().length);
    } catch (e) { 
      console.warn('[VideoProcessor] Could not set up camera:', e);
      this.settings.showWebcam = false; 
    }
  }
  
  // Setup camera audio mixing with screen audio
  async setupCameraAudio() {
    if (!this.webcamStream || !this.audioContext) {
      return;
    }
    
    const audioTracks = this.webcamStream.getAudioTracks();
    if (audioTracks.length === 0) {
      debugLog('[VideoProcessor] Camera has no audio tracks');
      return;
    }
    
    try {
      debugLog('[VideoProcessor] Setting up camera audio mixing');
      
      // Create source for camera audio
      const cameraAudioSource = this.audioContext.createMediaStreamSource(this.webcamStream);
      
      // If we have screen audio, mix them together
      if (this.audioSource && this.audioDestination) {
        // Create gain nodes to control volume of each source
        const cameraGain = this.audioContext.createGain();
        const screenGain = this.audioContext.createGain();
        cameraGain.gain.value = 1.0; // Camera audio level
        screenGain.gain.value = 1.0; // Screen audio level
        
        // Disconnect existing audio source from destination
        this.audioSource.disconnect();
        this.audioSource.connect(screenGain);
        
        // Connect camera audio through gain
        cameraAudioSource.connect(cameraGain);
        
        // Create a merger to properly mix both sources into mono (both channels get mixed audio)
        // This ensures both camera and screen audio are heard in both left and right channels
        const merger = this.audioContext.createChannelMerger(2);
        
        // Create a gain node to combine both sources before sending to merger
        const mixerGain = this.audioContext.createGain();
        mixerGain.gain.value = 1.0;
        
        // Connect both sources to the mixer
        cameraGain.connect(mixerGain);
        screenGain.connect(mixerGain);
        
        // Connect mixer to both channels of merger (mono mix to stereo output)
        mixerGain.connect(merger, 0, 0); // Left channel
        mixerGain.connect(merger, 0, 1); // Right channel
        
        // Connect merger to destination
        merger.connect(this.audioDestination);
        
        // Store mixer reference for cleanup
        this.audioMixer = mixerGain;
        
        // Store references for cleanup
        this.cameraAudioSource = cameraAudioSource;
        this.audioMerger = merger;
        this.cameraGain = cameraGain;
        this.screenGain = screenGain;
        
        debugLog('[VideoProcessor] Camera audio mixed with screen audio (mono mix to stereo)');
      } else {
        // No screen audio, just use camera audio
        if (!this.audioDestination) {
          this.audioDestination = this.audioContext.createMediaStreamDestination();
        }
        cameraAudioSource.connect(this.audioDestination);
        this.cameraAudioSource = cameraAudioSource;
        debugLog('[VideoProcessor] Using camera audio only (no screen audio)');
      }
      
      // Add/update audio tracks in output stream
      const oldAudioTracks = this.outputStream.getAudioTracks();
      oldAudioTracks.forEach(track => {
        this.outputStream.removeTrack(track);
      });
      
      const newAudioTracks = this.audioDestination.stream.getAudioTracks();
      newAudioTracks.forEach(track => {
        if (track.readyState === 'live') {
          this.outputStream.addTrack(track);
          debugLog('[VideoProcessor] Added audio track to output stream');
        }
      });
      
      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        debugLog('[VideoProcessor] Audio context resumed for camera audio');
      }
    } catch (audioError) {
      console.warn('[VideoProcessor] Could not set up camera audio mixing:', audioError);
      // Continue without camera audio mixing
    }
  }

  cleanupAudio() {
    if (this.audioSource) {
      try {
        this.audioSource.disconnect();
        this.audioSource = null;
      } catch (e) {
        console.warn('[VideoProcessor] Error disconnecting audio source:', e);
      }
    }
    if (this.cameraAudioSource) {
      try {
        this.cameraAudioSource.disconnect();
        this.cameraAudioSource = null;
      } catch (e) {
        console.warn('[VideoProcessor] Error disconnecting camera audio source:', e);
      }
    }
    if (this.audioMixer) {
      try {
        this.audioMixer.disconnect();
        this.audioMixer = null;
      } catch (e) {
        console.warn('[VideoProcessor] Error disconnecting audio mixer:', e);
      }
    }
    if (this.cameraGain) {
      try {
        this.cameraGain.disconnect();
        this.cameraGain = null;
      } catch (e) {
        console.warn('[VideoProcessor] Error disconnecting camera gain:', e);
      }
    }
    if (this.screenGain) {
      try {
        this.screenGain.disconnect();
        this.screenGain = null;
      } catch (e) {
        console.warn('[VideoProcessor] Error disconnecting screen gain:', e);
      }
    }
    if (this.audioMerger) {
      try {
        this.audioMerger.disconnect();
        this.audioMerger = null;
      } catch (e) {
        console.warn('[VideoProcessor] Error disconnecting audio merger:', e);
      }
    }
    if (this.audioDestination) {
      try {
        this.audioDestination.disconnect();
        this.audioDestination = null;
      } catch (e) {
        console.warn('[VideoProcessor] Error disconnecting audio destination:', e);
      }
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
        this.audioContext = null;
      } catch (e) {
        console.warn('[VideoProcessor] Error closing audio context:', e);
      }
    }
  }

  cleanupWebcam() {
    if (this.webcamStream) { 
      this.webcamStream.getTracks().forEach(t => t.stop()); 
      this.webcamStream = null; 
    }
    if (this.webcamVideo) {
      try { this.webcamVideo.pause(); } catch (_) {}
      this.webcamVideo.src = '';
      this.webcamVideo.srcObject = null; 
      this.webcamVideo = null; 
    }
    if (this.webcamObjectUrl) {
      try { URL.revokeObjectURL(this.webcamObjectUrl); } catch (_) {}
      this.webcamObjectUrl = null;
    }
    // Clean up camera audio source if it exists
    if (this.cameraAudioSource) {
      try {
        this.cameraAudioSource.disconnect();
        this.cameraAudioSource = null;
      } catch (e) {
        console.warn('[VideoProcessor] Error disconnecting camera audio source:', e);
      }
    }
    if (this.audioMerger) {
      try {
        this.audioMerger.disconnect();
        this.audioMerger = null;
      } catch (e) {
        console.warn('[VideoProcessor] Error disconnecting audio merger:', e);
      }
    }
  }

  async fixWebmDurationBlob(blob, durationMs) {
    if (!blob || !blob.type.includes('webm') || durationMs <= 0) {
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
      let timecodeScale = 1000000;
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

      const durElem = new Uint8Array(11);
      durElem[0] = 0x44;
      durElem[1] = 0x89;
      durElem[2] = 0x88;
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
      console.warn('[VideoProcessor] Could not patch duration header:', err);
      return blob;
    }
  }

  cancel() {
    if (this.video) this.video.pause();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
    this.cleanupWebcam();
    this.cleanupAudio();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoProcessor;
}