/* Winamp YouTube Music — content script
 * Toggles two independent <html> classes that the CSS keys off:
 *   .winamp-ytm-on     -> the Winamp skin
 *   .winamp-ytm-audio  -> audio-only (hide video surface + force "Song" mode)
 * State lives in chrome.storage.local so the popup, the keyboard command
 * (background.js) and this script all stay in sync.
 */
(() => {
  "use strict";

  const KEY_THEME = "winampThemeOn";
  const KEY_AUDIO = "winampAudioOnly";
  const KEY_SKIN = "winampSkin";
  const KEY_SMOOTH = "winampVizSmooth";
  const root = document.documentElement;

  let state = { themeOn: true, audioOnly: true, skin: "classic", vizSmooth: 65 };

  // Live Audio Analyzer state
  let audioCtx = null;
  let analyserNode = null;
  let audioStream = null;
  let audioSourceNode = null;
  let visualizerAnimId = null;
  let lastBoundVideo = null;
  let lastBoundSrc = "";
  let lastBoundTrackId = "";
  let zeroEnergyFrames = 0;
  let lastEngineAttemptT = 0;
  const peakHeights = new Array(16).fill(0);
  const peakHolds = new Array(16).fill(0);
  const smoothBars = new Array(16).fill(0);
  const rawBars = new Array(16).fill(0);
  const prevTargetBars = new Array(16).fill(0);
  const fastEnvDb = [
    -44, -45, -46, -46, -48, -49, -50, -50, -51, -52, -54, -56, -58, -64, -67, -70,
  ];
  const slowAvgDb = [
    -44, -45, -46, -46, -48, -49, -50, -50, -51, -52, -54, -56, -58, -64, -67, -70,
  ];
  let autoTurbulence = 0;
  let floatFreqArray = null;

  // 16 logarithmic frequency band edges from 32 Hz (sub-bass) to 16 kHz (air)
  // At 48,000 Hz sampleRate & fftSize = 4096, each FFT bin is 11.71875 Hz wide,
  // giving every single band strictly non-overlapping FFT bins.
  const FREQ_EDGES = [
    32, 55, 90, 140, 210, 310, 450, 650, 930, 1320, 1880, 2650, 3750,
    5300, 7600, 11000, 16000,
  ];
  // Per-band noise gate floor (dB) and high-headroom ceiling (dB)
  const BAND_GATE_DB = [
    -70, -70, -72, -74, -76, -78, -80, -82, -84, -86, -88, -90, -92, -94, -96, -98,
  ];
  const BAND_CEIL_DB = [
    -24, -25, -27, -29, -31, -33, -35, -37, -38, -39, -41, -43, -45, -48, -52, -56,
  ];

  // ---- bottom bar: classic <ytmusic-player-bar> or the wiz <ytmusic-miniplayer>
  // YTM serves the miniplayer as the player bar behind its "wiz miniplayer"
  // experiment; resolve whichever one is live and where our parts go in it.
  const MINI_SEL = "ytmusic-app-layout[is-wiz-miniplayer-enabled] ytmusic-miniplayer";
  const BAR_SEL = "ytmusic-player-bar, " + MINI_SEL;
  const TITLE_SEL =
    "ytmusic-player-bar .content-info-wrapper .title, " + MINI_SEL + " .ytmusicTrackInfoTitle";
  const SUBTITLE_SEL =
    "ytmusic-player-bar .content-info-wrapper .subtitle, " + MINI_SEL + " .ytmusicTrackInfoByline";
  const PLAY_SEL =
    "ytmusic-player-bar #play-pause-button, " + MINI_SEL + " .ytmusicPlayerControlsPlayPauseButton";

  function getBar() {
    return document.querySelector("ytmusic-player-bar") || document.querySelector(MINI_SEL);
  }

  function getBarParts() {
    const classic = document.querySelector("ytmusic-player-bar");
    if (classic) {
      const controls = classic.querySelector(".left-controls-buttons");
      return controls && {
        bar: classic,
        placeViz: (viz) => controls.insertAdjacentElement("afterend", viz),
        placeStats: (stats, viz) => viz.insertAdjacentElement("afterend", stats),
        playPause: controls.querySelector("#play-pause-button"),
        badgeHost: classic.querySelector("#right-controls"),
      };
    }
    const mini = document.querySelector(MINI_SEL);
    const left = mini && mini.querySelector(".ytMusicMiniPlayerLeftSection");
    return left && {
      bar: mini,
      placeViz: (viz) => left.insertAdjacentElement("afterbegin", viz),
      placeStats: (stats) => left.appendChild(stats),
      playPause: mini.querySelector(".ytmusicPlayerControlsPlayPauseButton"),
      badgeHost: mini.querySelector(".ytMusicMiniPlayerRightSection"),
    };
  }

  // ---- apply <html> classes & attributes ------------------------------------
  function applyClasses() {
    root.classList.toggle("winamp-ytm-on", state.themeOn);
    root.classList.toggle("winamp-ytm-audio", state.audioOnly);
    if (state.themeOn && state.skin) {
      root.setAttribute("data-wa-skin", state.skin);
    } else {
      root.removeAttribute("data-wa-skin");
    }
  }

  // ---- audio-only: switch YTM's Song/Video toggle to "Song" -----------------
  function forceAudio() {
    if (!state.audioOnly) return;
    const toggle = document.querySelector("ytmusic-av-toggle");
    if (!toggle) return;
    const videoSelected =
      toggle.getAttribute("is-video-playback-mode-selected") === "true";
    if (!videoSelected) return;
    const songBtn = toggle.querySelector(".song-button");
    if (songBtn) songBtn.click();
  }

  // ---- Winamp Main LCD Display (Visualizer + 7-Segment Clock + Clutterbar) ----
  function ensureViz() {
    const parts = getBarParts();
    if (!parts) return;
    const { bar } = parts;
    const existing = bar.querySelector("[data-winamp-viz]");
    if (state.themeOn) {
      let viz = existing;
      // Recreate if it's the old version without the authentic LCD subcomponents
      if (viz && (!viz.querySelector(".wa-lcd-main") || !viz.querySelector(".wa-spec-canvas"))) {
        viz.remove();
        viz = null;
      }
      if (!viz) {
        viz = document.createElement("div");
        viz.setAttribute("data-winamp-viz", "1");
        viz.className = "winamp-viz is-paused";

        // 1. Clutterbar column (O A I D V)
        const clutter = document.createElement("div");
        clutter.className = "wa-lcd-clutterbar";
        ["O", "A", "I", "D", "V"].forEach((letter) => {
          const s = document.createElement("span");
          s.textContent = letter;
          clutter.appendChild(s);
        });
        viz.appendChild(clutter);

        // 2. Main LCD Area
        const main = document.createElement("div");
        main.className = "wa-lcd-main";

        // 2a. Top row: Status indicators + 7-segment clock
        const top = document.createElement("div");
        top.className = "wa-lcd-top";

        const status = document.createElement("div");
        status.className = "wa-lcd-status";

        const dots = document.createElement("div");
        dots.className = "wa-lcd-dots";
        const dotG = document.createElement("span");
        dotG.className = "wa-dot-green";
        const dotR = document.createElement("span");
        dotR.className = "wa-dot-red";
        dots.appendChild(dotG);
        dots.appendChild(dotR);
        status.appendChild(dots);

        const modeIcon = document.createElement("div");
        modeIcon.className = "wa-lcd-mode-icon";
        const playIcon = document.createElement("span");
        playIcon.className = "wa-icon-play";
        playIcon.textContent = "▶";
        const pauseIcon = document.createElement("span");
        pauseIcon.className = "wa-icon-pause";
        pauseIcon.textContent = "==";
        modeIcon.appendChild(playIcon);
        modeIcon.appendChild(pauseIcon);
        status.appendChild(modeIcon);

        top.appendChild(status);

        const clock = document.createElement("div");
        clock.className = "wa-lcd-clock";
        const digits = document.createElement("span");
        digits.className = "wa-clock-digits";
        digits.textContent = "00:00";
        clock.appendChild(digits);
        top.appendChild(clock);

        main.appendChild(top);

        // 2b. Bottom row: Spectrum Analyzer with L-Axis and Peak Dashes
        const spec = document.createElement("div");
        spec.className = "wa-lcd-spectrum";

        const axis = document.createElement("div");
        axis.className = "wa-spectrum-axis";
        spec.appendChild(axis);

        // Single canvas: authentic Winamp 2.x analyzer (pixel rows, vis palette, 1px peaks)
        const specCanvas = document.createElement("canvas");
        specCanvas.className = "wa-spec-canvas";
        specCanvas.height = 16;
        spec.appendChild(specCanvas);

        main.appendChild(spec);
        viz.appendChild(main);

        parts.placeViz(viz);
      }

      // 3. Winamp Stop Button (|◀, ▶, ||, ■, ▶|)
      const playPauseBtn = parts.playPause;
      if (playPauseBtn && !bar.querySelector(".wa-stop-btn")) {
        const stopBtn = document.createElement("button");
        stopBtn.className = "wa-stop-btn";
        stopBtn.setAttribute("type", "button");
        stopBtn.setAttribute("title", "Stop");
        stopBtn.setAttribute("aria-label", "Stop");
        const stopIcon = document.createElement("span");
        stopIcon.className = "wa-stop-icon";
        stopBtn.appendChild(stopIcon);
        stopBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const v = document.querySelector("video");
          if (v) {
            v.pause();
            v.currentTime = 0;
            updatePlayState();
          }
        });
        playPauseBtn.insertAdjacentElement("afterend", stopBtn);
      }

      // 4. Winamp Audio Stats (192 kbps 48 kHz mono stereo)
      let stats = bar.querySelector(".wa-audio-stats");
      if (stats && !stats.querySelector(".is-mono")) {
        stats.remove();
        stats = null;
      }
      if (!stats) {
        stats = document.createElement("div");
        stats.className = "wa-audio-stats";
        const addSpan = (cls, txt) => {
          const s = document.createElement("span");
          s.className = cls;
          s.textContent = txt;
          stats.appendChild(s);
        };
        addSpan("val", "192");
        addSpan("lbl", "kbps");
        addSpan("val", "48");
        addSpan("lbl", "kHz");
        addSpan("mode is-mono", "mono");
        addSpan("mode is-stereo", "stereo");
        parts.placeStats(stats, viz);
      }
      updatePlayState();
      attachVideoListeners();
      startVisualizerLoop();
    } else {
      if (existing) existing.remove();
      const stats = bar.querySelector(".wa-audio-stats");
      if (stats) stats.remove();
      const stopBtn = bar.querySelector(".wa-stop-btn");
      if (stopBtn) stopBtn.remove();
      stopVisualizerLoop();
    }
  }

  function ensureAudioContextAndAnalyser() {
    if (!audioCtx) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      try {
        // Lock to 48kHz so high-sample-rate OS devices (e.g. 192kHz) don't collapse low-frequency FFT bins
        audioCtx = new AudioContextClass({ sampleRate: 48000 });
      } catch (e) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    if (!analyserNode) {
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.20;
      floatFreqArray = new Float32Array(analyserNode.frequencyBinCount);
    }
    return true;
  }

  // stop() never fires "ended", so this won't trigger the rebind listener below
  function stopTracksExcept(stream, keep) {
    if (!stream || !stream.getTracks) return;
    stream.getTracks().forEach((t) => {
      if (t !== keep) {
        try {
          t.stop();
        } catch (e) {}
      }
    });
  }

  function initAudioEngine(video, forceRebind = false) {
    if (!video) return;
    if (!ensureAudioContextAndAnalyser()) return;

    const curSrc = video.currentSrc || video.src || "";
    if (
      !forceRebind &&
      lastBoundVideo === video &&
      curSrc &&
      curSrc === lastBoundSrc &&
      lastBoundTrackId &&
      audioSourceNode
    ) {
      return;
    }

    try {
      // Release the old capture before asking for a new one: the element's captures share one
      // audio tap, and stopping an old track after the new one exists silences the new one too
      if (audioSourceNode) {
        try {
          audioSourceNode.disconnect();
        } catch (e) {}
        audioSourceNode = null;
      }
      stopTracksExcept(audioStream, null);
      audioStream = null;

      // Request a fresh captureStream when song changes or after decoder spin-up so we get the live audio track
      const stream = video.captureStream
        ? video.captureStream()
        : video.mozCaptureStream
        ? video.mozCaptureStream()
        : null;
      if (!stream || !stream.getAudioTracks) return;

      const tracks = stream.getAudioTracks();
      const liveTracks = tracks.filter(
        (t) => t.readyState === "live" && t.enabled
      );
      const latestTrack =
        liveTracks[liveTracks.length - 1] || tracks[tracks.length - 1] || null;
      if (!latestTrack || latestTrack.readyState !== "live") {
        stopTracksExcept(stream, null);
        return;
      }
      // Each captureStream() call spawns new tracks (video included); keep only the one we analyse
      stopTracksExcept(stream, latestTrack);

      audioStream = new MediaStream([latestTrack]);
      audioSourceNode = audioCtx.createMediaStreamSource(audioStream);
      audioSourceNode.connect(analyserNode);

      lastBoundVideo = video;
      lastBoundSrc = curSrc;
      lastBoundTrackId = latestTrack.id || "bound";
      zeroEnergyFrames = 0;

      latestTrack.addEventListener(
        "ended",
        () => {
          lastBoundTrackId = "";
          setTimeout(() => {
            const v = document.querySelector("video");
            if (v && !v.paused) initAudioEngine(v, true);
          }, 100);
        },
        { once: true }
      );

      startVisualizerLoop();
    } catch (err) {
      console.warn("[Winamp] Audio analyser init:", err);
    }
  }

  // ---- Authentic Winamp 2.x spectrum analyzer (16 levels, alternating scanlines, glowing white peaks) ----
  const SPEC_PALETTE = [
    // [Bright LED, Scanline (darkened for authentic CRT/LED grid)]
    ['rgb(0,224,0)',   'rgb(0,110,0)'],   // Level 0 (bottom)
    ['rgb(0,224,0)',   'rgb(0,110,0)'],   // Level 1
    ['rgb(30,230,0)',  'rgb(15,115,0)'],  // Level 2
    ['rgb(70,235,0)',  'rgb(35,120,0)'],  // Level 3
    ['rgb(130,240,0)', 'rgb(65,125,0)'],  // Level 4
    ['rgb(190,245,0)', 'rgb(95,130,0)'],  // Level 5
    ['rgb(240,245,0)', 'rgb(125,135,0)'], // Level 6
    ['rgb(255,235,0)', 'rgb(145,130,0)'], // Level 7
    ['rgb(255,200,0)', 'rgb(150,110,0)'], // Level 8
    ['rgb(255,160,0)', 'rgb(150,85,0)'],  // Level 9
    ['rgb(255,120,0)', 'rgb(150,65,0)'],  // Level 10
    ['rgb(255,70,0)',  'rgb(150,35,0)'],  // Level 11
    ['rgb(255,30,0)',  'rgb(150,15,0)'],  // Level 12
    ['rgb(255,0,0)',   'rgb(150,0,0)'],   // Level 13
    ['rgb(255,0,0)',   'rgb(150,0,0)'],   // Level 14
    ['rgb(255,0,0)',   'rgb(150,0,0)']    // Level 15 (top)
  ];
  const SPEC_PEAK_COLOR = '#ffffff';
  const frameTargets = new Array(16).fill(0);

  function drawSpectrum(canvas) {
    const W = canvas.clientWidth || 111;
    if (canvas.width !== W || canvas.height !== 16) {
      canvas.width = W;
      canvas.height = 16;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, 16);

    const bw = 5;
    const pitch = 6;
    const xOffset = Math.max(0, Math.floor((W - 95) / 2));

    // Authentic Winamp LCD dotted baseline along bottom (y = 15)
    ctx.fillStyle = 'rgb(0, 90, 0)';
    for (let i = 0; i < 16; i++) {
      const x0 = xOffset + i * pitch;
      for (let dx = 0; dx < bw; dx += 2) {
        ctx.fillRect(x0 + dx, 15, 1, 1);
      }
    }

    for (let i = 0; i < 16; i++) {
      const x0 = xOffset + i * pitch;
      const numRows = Math.max(0, Math.min(16, Math.round(smoothBars[i] / 100 * 16)));
      for (let r = 0; r < numRows; r++) {
        const y = 15 - r;
        ctx.fillStyle = (y % 2 === 1) ? SPEC_PALETTE[r][1] : SPEC_PALETTE[r][0];
        ctx.fillRect(x0, y, bw, 1);
      }
      // Floating pure white peak dash
      if (peakHeights[i] > 2) {
        const pkRow = Math.max(0, Math.min(15, Math.round(peakHeights[i] / 100 * 16)));
        const y_pk = 15 - pkRow;
        ctx.fillStyle = SPEC_PEAK_COLOR;
        ctx.fillRect(x0, y_pk, bw, 1);
      }
    }
  }

  function startVisualizerLoop() {
    if (visualizerAnimId) return;

    function renderFrame() {
      const viz = document.querySelector("[data-winamp-viz]");
      if (!viz || !state.themeOn) {
        visualizerAnimId = null;
        return;
      }

      if (document.hidden) {
        visualizerAnimId = requestAnimationFrame(renderFrame);
        return;
      }
      const canvas = viz.querySelector(".wa-spec-canvas");
      if (!canvas) {
        visualizerAnimId = requestAnimationFrame(renderFrame);
        return;
      }

      const video = document.querySelector("video");
      const isPaused = !video || video.paused;

      if (isPaused) {
        for (let i = 0; i < 16; i++) {
          smoothBars[i] = Math.max(0, smoothBars[i] * 0.85 - 1.5);
          peakHeights[i] = Math.max(0, peakHeights[i] - 2.5);
        }
        drawSpectrum(canvas);
        visualizerAnimId = requestAnimationFrame(renderFrame);
        return;
      }

      // Detect if video source changed or stream isn't bound yet
      if (video) {
        const curSrc = video.currentSrc || video.src || "";
        const nowMs = performance.now();
        // play/playing/loadeddata already rebind promptly; this is the throttled fallback
        // so a failing bind can't call captureStream() every frame
        const needsBind = (curSrc && curSrc !== lastBoundSrc) || !audioSourceNode;
        if (needsBind && nowMs - lastEngineAttemptT > 500) {
          lastEngineAttemptT = nowMs;
          initAudioEngine(video, true);
        }
        if (audioCtx && audioCtx.state === "suspended") {
          audioCtx.resume().catch(() => {});
        }
      }

      viz.classList.add("wa-real-audio");

      let hasLiveSignal = false;
      if (
        analyserNode &&
        floatFreqArray &&
        audioCtx &&
        audioCtx.state === "running"
      ) {
        analyserNode.getFloatFrequencyData(floatFreqArray);
        for (let b = 2; b < 180; b++) {
          if (floatFreqArray[b] > -98 && Number.isFinite(floatFreqArray[b])) {
            hasLiveSignal = true;
            break;
          }
        }
      }

      if (hasLiveSignal) {
        zeroEnergyFrames = 0;
      } else {
        zeroEnergyFrames++;
        // If playback is active and unmuted but captureStream was bound before the audio decoder was ready,
        // rebind a fresh stream once readyState >= 3. A few quick tries, then one every ~2s so a
        // dead binding (quiet intro, ad gap, same blob src across songs) still recovers; a retry
        // must not reset the silence count or the procedural fallback would flicker off
        const retryDue =
          zeroEnergyFrames < 120
            ? zeroEnergyFrames % 40 === 25
            : zeroEnergyFrames % 120 === 0;
        if (
          retryDue &&
          video &&
          video.readyState >= 3 &&
          !video.muted &&
          video.volume > 0 &&
          video.currentTime > 0.1
        ) {
          const silentFrames = zeroEnergyFrames;
          initAudioEngine(video, true);
          zeroEnergyFrames = silentFrames;
        }
      }

      const userSmooth =
        Math.max(0, Math.min(100, Number(state.vizSmooth ?? 65))) / 100;
      if (analyserNode) {
        const targetFftSmooth = 0.05 + userSmooth * 0.20;
        if (Math.abs(analyserNode.smoothingTimeConstant - targetFftSmooth) > 0.01) {
          analyserNode.smoothingTimeConstant = targetFftSmooth;
        }
      }

      const sr = (audioCtx && audioCtx.sampleRate) || 48000;
      const binWidth = analyserNode ? sr / analyserNode.fftSize : 11.71875;
      const timeMs =
        (video && video.currentTime
          ? video.currentTime
          : performance.now() / 1000) * 1000;

      // Only use procedural simulation if audio capture is genuinely unavailable after 120+ frames (~2 seconds)
      const useProceduralFallback =
        !hasLiveSignal && zeroEnergyFrames > 120;
      viz.dataset.waSignal = hasLiveSignal ? "live" : useProceduralFallback ? "sim" : "wait";

      const envAttack = 0.95;
      const envRelease = 0.78;

      if (!useProceduralFallback && floatFreqArray) {
        let prevEnd = 1;
        for (let i = 0; i < 16; i++) {
          // Strictly non-overlapping FFT bin slices so adjacent bars never read the same bin
          const bStart = Math.max(
            prevEnd + 1,
            Math.round(FREQ_EDGES[i] / binWidth)
          );
          const bEnd = Math.min(
            floatFreqArray.length - 1,
            Math.max(bStart, Math.round(FREQ_EDGES[i + 1] / binWidth))
          );
          prevEnd = bEnd;

          let maxDb = -120;
          let sumDb = 0;
          let count = 0;
          for (let b = bStart; b <= bEnd; b++) {
            const val = Number.isFinite(floatFreqArray[b])
              ? floatFreqArray[b]
              : -120;
            if (val > maxDb) maxDb = val;
            sumDb += val;
            count++;
          }
          const avgDb = count > 0 ? sumDb / count : maxDb;
          const rawEffDb = maxDb * 0.55 + avgDb * 0.45;

          // Pre-smooth per-band dB envelope scaled by user smoothing setting
          if (rawEffDb > BAND_GATE_DB[i]) {
            if (rawEffDb > fastEnvDb[i]) {
              fastEnvDb[i] =
                fastEnvDb[i] * (1 - envAttack) + rawEffDb * envAttack;
            } else {
              fastEnvDb[i] =
                fastEnvDb[i] * (1 - envRelease) + rawEffDb * envRelease;
            }
            slowAvgDb[i] = slowAvgDb[i] * 0.94 + fastEnvDb[i] * 0.06;
          } else {
            fastEnvDb[i] = fastEnvDb[i] * 0.85 + BAND_GATE_DB[i] * 0.15;
          }

          const effDb = fastEnvDb[i];

          // 1. Absolute noise-gate factor so true silence stays near 0%
          const absNorm = Math.max(
            0,
            Math.min(
              1,
              (effDb - BAND_GATE_DB[i]) / (BAND_CEIL_DB[i] - BAND_GATE_DB[i])
            )
          );
          const gateFactor = Math.min(1, Math.pow(absNorm, 0.75) * 1.2);

          // 2. Relative delta from the band's running mean:
          // - Steady background instrumentation sits around 28% (never pegged flat at 100%)
          // - Dips between syllables/beats glide down toward 6%–15%
          // - Vocal notes & beat hits (+1..+8 dB above running mean) rise smoothly to 75%–95%
          const isVocalBand = i >= 5 && i <= 12;
          const diffFromMean = effDb - slowAvgDb[i];
          const upSpan = isVocalBand ? 7.0 : 9.0;
          const downSpan = 8.5;
          let relNorm = 0.28;
          if (diffFromMean >= 0) {
            relNorm =
              0.28 +
              0.66 * Math.min(1, Math.pow(diffFromMean / upSpan, 0.95));
          } else {
            relNorm = 0.28 * Math.max(0.12, 1 + diffFromMean / downSpan);
          }

          rawBars[i] = relNorm * gateFactor;
        }
      } else if (useProceduralFallback) {
        const beatPhase = (timeMs / 460) * Math.PI * 2;
        const bassBoost = Math.max(0, Math.sin(beatPhase));
        for (let i = 0; i < 16; i++) {
          const mw = Math.sin(timeMs / 260 + i * 0.85) * 0.5 + 0.5;
          const hw = Math.sin(timeMs / 170 + i * 1.35) * 0.5 + 0.5;
          if (i < 4) {
            rawBars[i] = 0.2 + 0.6 * Math.pow(bassBoost, 2.2);
          } else if (i < 11) {
            rawBars[i] = 0.18 + 0.5 * Math.pow(mw, 1.7) + 0.15 * bassBoost;
          } else {
            rawBars[i] = 0.12 + 0.5 * Math.pow(hw, 1.9);
          }
        }
      } else {
        for (let i = 0; i < 16; i++) rawBars[i] = 0;
      }

      // 3. Measure frame-to-frame turbulence across all 16 bands to automatically damp hectic sections
      let frameDeltaSum = 0;
      const targets = frameTargets;
      const spatialWeight = 0.62 - userSmooth * 0.38;
      for (let i = 0; i < 16; i++) {
        const targetPct = Math.min(100, Math.max(0, rawBars[i] * 100));
        targets[i] = targetPct;
        frameDeltaSum += Math.abs(targetPct - prevTargetBars[i]);
        prevTargetBars[i] = targetPct;
      }

      const avgFrameDelta = frameDeltaSum / 16;
      // Smoothly track how hectic the audio currently is (0 = calm, 1 = very busy)
      const normJitter = Math.min(1, avgFrameDelta / 18);
      autoTurbulence = autoTurbulence * 0.9 + normJitter * 0.1;

      // Combine user smoothing slider (0..1) with automatic turbulence damping
      const effSmooth = Math.min(
        1,
        userSmooth * 0.78 + autoTurbulence * userSmooth * 0.35
      );
      const attackAlpha = 0.82 - effSmooth * 0.66;
      const releaseAlpha = 0.45 - effSmooth * 0.36;
      const maxFallPerFrame = 9.5 - effSmooth * 7.6;
      const peakHoldFrames = Math.round(6 + userSmooth * 14);
      const peakFallSpeed = 3.4 - userSmooth * 2.2;

      for (let i = 0; i < 16; i++) {
        const targetPct = targets[i];

        if (targetPct >= smoothBars[i]) {
          // Instant energetic punch: snaps to beat on the current frame
          smoothBars[i] = targetPct;
        } else {
          // Smooth, organic gravity decay matching Winamp 2.x needle physics
          smoothBars[i] = Math.max(targetPct, smoothBars[i] * 0.88 - 0.6);
        }
        const barPct = Math.min(100, Math.max(0, smoothBars[i]));

        // Peak physics: hold for ~160ms, then drop smoothly
        if (barPct >= peakHeights[i]) {
          peakHeights[i] = barPct;
          peakHolds[i] = 10;
        } else {
          if (peakHolds[i] > 0) {
            peakHolds[i]--;
          } else {
            peakHeights[i] = Math.max(barPct, peakHeights[i] - 1.1);
          }
        }
      }
      drawSpectrum(canvas);

      visualizerAnimId = requestAnimationFrame(renderFrame);
    }

    visualizerAnimId = requestAnimationFrame(renderFrame);
  }

  function stopVisualizerLoop() {
    if (visualizerAnimId) {
      cancelAnimationFrame(visualizerAnimId);
      visualizerAnimId = null;
    }
    const viz = document.querySelector("[data-winamp-viz]");
    if (viz) {
      viz.classList.remove("wa-real-audio");
    }
  }

  function resumeAudioOnGesture() {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    const video = document.querySelector("video");
    if (video && !video.paused) {
      initAudioEngine(video);
    }
  }
  document.addEventListener("pointerdown", resumeAudioOnGesture, { passive: true });
  document.addEventListener("keydown", resumeAudioOnGesture, { passive: true });

  function updateLcdTime() {
    const digits = document.querySelector(".wa-clock-digits");
    if (!digits) return;
    const video = document.querySelector("video");
    const curTime = video ? Math.floor(video.currentTime) : 0;
    const mins = String(Math.floor(curTime / 60)).padStart(2, "0");
    const secs = String(curTime % 60).padStart(2, "0");
    const txt = `${mins}:${secs}`;
    if (digits.textContent !== txt) digits.textContent = txt;
  }

  function updatePlayState() {
    const viz = document.querySelector("[data-winamp-viz]");
    const video = document.querySelector("video");
    const isPaused = video ? video.paused : true;

    if (viz) {
      viz.classList.toggle("is-paused", isPaused);
      viz.classList.toggle("is-playing", !isPaused);
    }

    const pb = getBar();
    if (pb) {
      pb.toggleAttribute("is-playing", !isPaused);
      pb.toggleAttribute("is-paused", isPaused);
    }

    const playPauseBtn = document.querySelector(PLAY_SEL);
    if (playPauseBtn) {
      playPauseBtn.classList.toggle("is-playing", !isPaused);
      playPauseBtn.classList.toggle("is-paused", isPaused);
      playPauseBtn.setAttribute("data-wa-playstate", isPaused ? "paused" : "playing");
      if (state.themeOn && playPauseBtn.hasAttribute("hidden")) {
        playPauseBtn.removeAttribute("hidden");
      }
    }

    // Winamp has no loading spinner; hide YTM's only while the skin is on,
    // and hand it back when the skin is turned off
    const spinner = document.querySelector("ytmusic-player-bar .spinner-container");
    if (spinner) {
      if (state.themeOn) {
        spinner.style.setProperty("display", "none", "important");
        spinner.setAttribute("data-wa-hidden", "1");
      } else if (spinner.hasAttribute("data-wa-hidden")) {
        spinner.style.removeProperty("display");
        spinner.removeAttribute("data-wa-hidden");
      }
    }

    updateLcdTime();
  }

  function attachVideoListeners() {
    const video = document.querySelector("video");
    if (video) {
      if (!video.hasAttribute("data-wa-listener")) {
        video.setAttribute("data-wa-listener", "1");
        video.addEventListener("timeupdate", updateLcdTime);
        video.addEventListener("play", () => {
          updatePlayState();
          initAudioEngine(video, true);
        });
        video.addEventListener("playing", () => {
          updatePlayState();
          initAudioEngine(video, true);
        });
        video.addEventListener("loadeddata", () => {
          initAudioEngine(video, true);
        });
        video.addEventListener("emptied", () => {
          lastBoundSrc = "";
          lastBoundTrackId = "";
        });
        video.addEventListener("pause", updatePlayState);
        video.addEventListener("ended", updatePlayState);
        video.addEventListener("seeked", updateLcdTime);
      }
      initAudioEngine(video);
    }
  }

  // ---- Winamp window title bars (Requirement 3) -----------------------------
  function ensureWinampTitleBars() {
    // 1. Clean up old injected fake buttons, grips, and bolts from shelf headers
    document.querySelectorAll(
      'ytmusic-carousel-shelf-basic-header-renderer .wa-lightning-bolt, ytmusic-carousel-shelf-basic-header-renderer .wa-tb-grip, ytmusic-carousel-shelf-basic-header-renderer .wa-tb-btns, ytmusic-shelf-renderer .wa-lightning-bolt, ytmusic-shelf-renderer .wa-tb-grip, ytmusic-shelf-renderer .wa-tb-btns, ytmusic-card-shelf-renderer .wa-lightning-bolt, ytmusic-card-shelf-renderer .wa-tb-grip, ytmusic-card-shelf-renderer .wa-tb-btns'
    ).forEach(el => el.remove());

    if (!state.themeOn) return;

    // Ensure title bar on player page side panel (Playlist Editor - no X close button per Winamp spec)
    const sidePanel = document.querySelector('ytmusic-player-page #side-panel');
    if (sidePanel) {
      sidePanel.querySelectorAll('.wa-tb-btns, .wa-close').forEach(el => el.remove());
      if (!sidePanel.querySelector('.wa-pl-titlebar')) {
        const tb = document.createElement('div');
        tb.className = 'wa-window-titlebar wa-pl-titlebar';
        const bolt = document.createElement('span'); bolt.className = 'wa-lightning-bolt'; tb.appendChild(bolt);
        const grip1 = document.createElement('div'); grip1.className = 'wa-tb-grip'; tb.appendChild(grip1);
        const title = document.createElement('span'); title.className = 'wa-tb-title-text'; title.textContent = 'WINAMP PLAYLIST'; tb.appendChild(title);
        const grip2 = document.createElement('div'); grip2.className = 'wa-tb-grip'; tb.appendChild(grip2);
        sidePanel.prepend(tb);
      }
    }

    // Ensure title bar on search results container
    const searchSection = document.querySelector('ytmusic-tabbed-search-results-renderer ytmusic-section-list-renderer');
    if (searchSection) {
      const contents = searchSection.querySelector('#contents');
      if (contents && !contents.querySelector('.wa-search-titlebar')) {
        const tb = document.createElement('div');
        tb.className = 'wa-window-titlebar wa-search-titlebar';
        const grip1 = document.createElement('div'); grip1.className = 'wa-tb-grip'; tb.appendChild(grip1);
        const title = document.createElement('span'); title.className = 'wa-tb-title-text'; title.textContent = 'WINAMP SEARCH RESULTS'; tb.appendChild(title);
        const grip2 = document.createElement('div'); grip2.className = 'wa-tb-grip'; tb.appendChild(grip2);
        contents.prepend(tb);
      }
    }
  }

  // ---- Winamp playlist footers (Requirement 1, 8) ---------------------------
  function ensurePlaylistFooters() {
    if (!state.themeOn) return;
    const searchContents = document.querySelector('ytmusic-tabbed-search-results-renderer ytmusic-section-list-renderer #contents');
    const sidePanel = document.querySelector('ytmusic-player-page #side-panel');

    // Clean up any stray misplaced footers inside the scrollable #queue list
    document.querySelectorAll('#queue .wa-pl-footer').forEach(f => f.remove());

    [searchContents, sidePanel].forEach(t => {
      if (!t || t.querySelector(':scope > .wa-pl-footer')) return;
      const f = document.createElement('div');
      f.className = 'wa-pl-footer';
      const grp = document.createElement('div');
      grp.className = 'wa-pl-btn-group';
      ['ADD', 'REM', 'SEL', 'MISC'].forEach(lbl => {
        const b = document.createElement('button');
        b.className = 'wa-btn wa-pl-btn';
        b.textContent = lbl;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (lbl === 'ADD') {
            const searchInput = document.querySelector('ytmusic-search-box input, #input.ytmusic-search-box');
            if (searchInput) {
              searchInput.focus();
              searchInput.select();
            }
          } else if (lbl === 'REM') {
            const selectedItem = document.querySelector('ytmusic-player-queue-item[selected]');
            const menuBtn = selectedItem ? selectedItem.querySelector('#menu') : null;
            if (menuBtn) menuBtn.click();
          } else if (lbl === 'SEL') {
            const items = document.querySelectorAll('ytmusic-player-queue-item');
            if (items.length > 0) {
              items[0].click();
            }
          } else if (lbl === 'MISC') {
            const tabs = document.querySelectorAll('ytmusic-player-page tp-yt-paper-tab');
            if (tabs.length > 1) {
              const curIdx = Array.from(tabs).findIndex(tab => tab.classList.contains('iron-selected'));
              const targetIdx = curIdx === 1 ? 0 : 1;
              tabs[targetIdx]?.click();
            }
          }
        });
        grp.appendChild(b);
      });
      f.appendChild(grp);
      const readout = document.createElement('div');
      readout.className = 'wa-pl-readout';
      const digits = document.createElement('span');
      digits.className = 'wa-pl-digits';
      digits.textContent = '01/01 00:00';
      readout.appendChild(digits);
      f.appendChild(readout);
      const opts = document.createElement('button');
      opts.className = 'wa-btn wa-pl-btn';
      opts.textContent = 'LIST OPTS';
      opts.addEventListener('click', (e) => {
        e.stopPropagation();
        const saveBtn = document.querySelector('ytmusic-player-page [data-wa-btn="save"], ytmusic-player-page ytmusic-tab-renderer #save-button');
        if (saveBtn) saveBtn.click();
      });
      f.appendChild(opts);
      t.appendChild(f);
    });

    updatePlaylistReadout();
  }

  function updatePlaylistReadout() {
    const digits = document.querySelectorAll('.wa-pl-digits');
    if (!digits.length) return;
    const items = Array.from(document.querySelectorAll('ytmusic-player-queue-item'));
    const total = items.length;
    let activeIdx = 0;
    let activeDur = '00:00';
    for (let i = 0; i < items.length; i++) {
      if (items[i].hasAttribute('selected') || items[i].getAttribute('play-button-state') === 'playing') {
        activeIdx = i + 1;
        const durEl = items[i].querySelector('.duration');
        if (durEl && durEl.textContent) activeDur = durEl.textContent.trim();
        break;
      }
    }
    const txt = total > 0 
      ? `${String(activeIdx || 1).padStart(2, '0')}/${String(total).padStart(2, '0')} ${activeDur}`
      : '00:00 / 00:00';
    digits.forEach(d => {
      if (d.textContent !== txt) d.textContent = txt;
    });
  }

  // ---- Clean doubled bullets (Requirement 2) -------------------------------
  function cleanDoubledBullets() {
    if (!state.themeOn) return;
    document.querySelectorAll('.subtitle, yt-formatted-string.subtitle, .complex-string').forEach(el => {
      if (el.children.length === 0 && el.textContent.includes('•')) {
        const cleaned = el.textContent.replace(/•\s*•+/g, '•').replace(/\s{2,}/g, ' ');
        if (cleaned !== el.textContent) el.textContent = cleaned;
      }
    });
  }

  // ---- Ad Sponsor formatting in marquee (Requirement 6) --------------------
  function formatAdBanner() {
    if (!state.themeOn) return;
    const pb = document.querySelector('ytmusic-player-bar');
    if (!pb) return;
    const isAd = pb.hasAttribute('is-advertisement');
    if (isAd) {
      const titleEl = pb.querySelector('.title, .text.ytmusic-player-bar');
      if (titleEl && !titleEl.querySelector('.wa-sponsored-badge')) {
        const txt = (titleEl.textContent || '').trim();
        if (txt.toUpperCase().includes('SPONSORED')) {
          titleEl.textContent = '';
          const sp = document.createElement('span');
          sp.className = 'wa-sponsored-badge';
          sp.textContent = 'SPONSORED';
          titleEl.appendChild(sp);
          const remainder = txt.replace(/SPONSORED/i, '').trim();
          if (remainder) titleEl.appendChild(document.createTextNode(' ' + remainder));
        }
      }
    }
  }

  // ---- Tag Winamp Elements & LED toggles (Requirement 6, 9) -----------------
  function tagWinampElements() {
    if (!state.themeOn) return;
    document.querySelectorAll('ytmusic-guide-entry-renderer').forEach(el => {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t.includes('home')) el.setAttribute('data-wa-icon', 'home');
      else if (t.includes('explore')) el.setAttribute('data-wa-icon', 'explore');
      else if (t.includes('library')) el.setAttribute('data-wa-icon', 'library');
    });
    document.querySelectorAll('ytmusic-chip-cloud-chip-renderer').forEach(c => {
      if ((c.textContent || '').trim().toLowerCase().includes('save')) {
        c.setAttribute('data-wa-btn', 'save');
      }
    });
    // Tag Winamp Buttons & LED toggles on right controls
    const pb = document.querySelector('ytmusic-player-bar');
    document.querySelectorAll('ytmusic-player-bar #right-controls yt-icon-button, ytmusic-player-bar #right-controls tp-yt-paper-icon-button').forEach(b => {
      const innerBtn = b.querySelector('button');
      const label = ((b.getAttribute('aria-label') || '') + ' ' +
                     (b.getAttribute('title') || '') + ' ' +
                     (innerBtn?.getAttribute('aria-label') || '') + ' ' +
                     (innerBtn?.getAttribute('title') || '') + ' ' +
                     b.className).toLowerCase();
      if (label.includes('fullscreen')) {
        b.setAttribute('data-wa-btn', 'fs');
      } else if (label.includes('queue') || label.includes('toggle-player-page') || b.classList.contains('toggle-player-page-button')) {
        b.setAttribute('data-wa-btn', 'pl');
        const playerPage = document.querySelector('ytmusic-player-page');
        const isOpen = playerPage && (
          playerPage.hasAttribute('player-page-open') ||
          playerPage.getAttribute('player-ui-state') === 'PLAYER_PAGE_OPEN' ||
          (playerPage.getAttribute('player-ui-state') && playerPage.getAttribute('player-ui-state').includes('OPEN'))
        );
        b.classList.toggle('is-on', Boolean(isOpen));
      } else if (label.includes('shuffle')) {
        b.setAttribute('data-wa-btn', 'shuf');
        const isShuffleOn = pb?.getAttribute('data-wa-shuffle') === 'on' ||
                            b.getAttribute('aria-pressed') === 'true' ||
                            innerBtn?.getAttribute('aria-pressed') === 'true' ||
                            (b.getAttribute('aria-label') || '').toLowerCase().includes('shuffle on') ||
                            (innerBtn?.getAttribute('aria-label') || '').toLowerCase().includes('shuffle on');
        b.classList.toggle('is-on', Boolean(isShuffleOn));
      } else if (label.includes('repeat')) {
        b.setAttribute('data-wa-btn', 'rep');
        const repMode = pb?.repeatMode_ || pb?.repeatMode;
        const isRepeatOn = Boolean(
          (repMode && repMode !== 'NONE') ||
          b.getAttribute('aria-pressed') === 'true' ||
          innerBtn?.getAttribute('aria-pressed') === 'true' ||
          (b.getAttribute('aria-label') || '').toLowerCase().includes('repeat all') ||
          (b.getAttribute('aria-label') || '').toLowerCase().includes('repeat one') ||
          (innerBtn?.getAttribute('aria-label') || '').toLowerCase().includes('repeat all') ||
          (innerBtn?.getAttribute('aria-label') || '').toLowerCase().includes('repeat one') ||
          (b.getAttribute('title') || '').toLowerCase().includes('repeat all') ||
          (b.getAttribute('title') || '').toLowerCase().includes('repeat one')
        );
        b.classList.toggle('is-on', isRepeatOn);
      } else if (label.includes('volume') || label.includes('mute')) {
        b.setAttribute('data-wa-btn', 'vol');
      } else if (label.includes('caption') || label.includes('subtitle')) {
        b.setAttribute('data-wa-btn', 'cc');
      } else if (label.includes('speed') || label.includes('playback-rate')) {
        b.setAttribute('data-wa-btn', 'spd');
      }
    });

    // Ensure Winamp Gold Lightning Diamond emblem on right edge of player bar
    const rightControls = getBarParts()?.badgeHost;
    if (rightControls && !rightControls.querySelector('.wa-diamond-badge')) {
      const diamond = document.createElement('div');
      diamond.className = 'wa-diamond-badge';
      diamond.setAttribute('title', "Winamp 2.x — It really whips the llama's ass!");
      rightControls.appendChild(diamond);
    }

    // Tag ad popup dialog (Requirement 7)
    const promo = document.querySelector('ytmusic-mealbar-promo-renderer, yt-mealbar-promo-renderer');
    if (promo && !promo.querySelector('.wa-promo-titlebar')) {
      const tb = document.createElement('div');
      tb.className = 'wa-window-titlebar wa-promo-titlebar';
      const bolt = document.createElement('span'); bolt.className = 'wa-lightning-bolt'; tb.appendChild(bolt);
      const grip1 = document.createElement('div'); grip1.className = 'wa-tb-grip'; tb.appendChild(grip1);
      const title = document.createElement('span'); title.className = 'wa-tb-title-text'; title.textContent = 'WINAMP - MUSIC PREMIUM'; tb.appendChild(title);
      const grip2 = document.createElement('div'); grip2.className = 'wa-tb-grip'; tb.appendChild(grip2);
      const btns = document.createElement('div'); btns.className = 'wa-tb-btns';
      const closeBtn = document.createElement('span'); closeBtn.className = 'wa-tb-btn wa-close'; closeBtn.textContent = '✕'; btns.appendChild(closeBtn);
      tb.appendChild(btns);
      promo.prepend(tb);
      closeBtn.onclick = () => {
        const dismiss = promo.querySelector('#dismiss-button button, [aria-label*="Dismiss"], [aria-label*="Close"]');
        if (dismiss) dismiss.click();
        else promo.remove();
      };
    }

    // Tag AV toggle and check disabled state (hide if video is disabled or audio-only active)
    const avToggle = document.querySelector('ytmusic-av-toggle');
    const avId = document.querySelector('#av-id');
    if (avToggle && avId) {
      const isToggleDisabled = avToggle.hasAttribute('toggle-disabled') || avToggle.hasAttribute('disabled');
      avId.toggleAttribute('data-wa-video-disabled', isToggleDisabled || state.audioOnly);
      avToggle.toggleAttribute('data-wa-video-disabled', isToggleDisabled || state.audioOnly);
    }
  }

  // ---- Winamp Top Bar Decor ------------------------------------------------
  function ensureWinampDecor() {
    // 1. Clean up any title-bar window buttons from nav bar
    const oldBtns = document.querySelectorAll('.wa-title-buttons');
    oldBtns.forEach(b => b.remove());

    // 2. Remove any loose duplicate lightning bolt from leftNav
    const oldBolt = document.querySelector('ytmusic-nav-bar .left-content > .wa-lightning-bolt, ytmusic-logo .wa-lightning-bolt');
    if (oldBolt) oldBolt.remove();

    if (!state.themeOn) {
      document.querySelectorAll('.wa-lightning-bolt, .wa-title-buttons, .wa-pl-footer, .wa-window-titlebar, .wa-stop-btn, .wa-diamond-badge').forEach(el => el.remove());
    }
  }

  function tick() {
    scheduled = false;
    const safeRun = fn => {
      try {
        fn();
      } catch (e) {
        /* never let one sub-task failure break others */
      }
    };
    safeRun(forceAudio);
    safeRun(ensureViz);
    safeRun(updatePlayState);
    safeRun(updateLcdTime);
    safeRun(attachVideoListeners);
    safeRun(ensureWinampTitleBars);
    safeRun(ensurePlaylistFooters);
    safeRun(cleanDoubledBullets);
    safeRun(formatAdBanner);
    safeRun(tagWinampElements);
    safeRun(ensureWinampDecor);
  }

  let scheduled = false;
  let debounceTimer = null;
  let lastTickT = 0;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    // At most ~4 full passes per second, however busy YouTube Music's DOM is
    const wait = Math.max(80, 250 - (performance.now() - lastTickT));
    debounceTimer = setTimeout(() => requestAnimationFrame(() => {
      lastTickT = performance.now();
      tick();
    }), wait);
  }
  const NOISE_SEL = "[data-winamp-viz], .wa-audio-stats, .time-info, .wa-pl-footer, .wa-stop-btn";
  function onMutations(records) {
    for (const r of records) {
      const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!t || !t.closest || !t.closest(NOISE_SEL)) { schedule(); return; }
    }
  }

  // ---- Winamp-style title marquee: pixel-stepped scroll for long titles ----
  const marqueeState = new WeakMap();
  let marqueeEls = [];
  let marqueeScan = 0;
  function marqueeTick() {
    if (document.hidden) return;
    if (marqueeScan-- <= 0) {
      marqueeScan = 12;
      marqueeEls = Array.from(document.querySelectorAll(TITLE_SEL + ', ' + SUBTITLE_SEL));
    }
    for (const el of marqueeEls) {
      // A hover hint is drawn over the title from its left edge; hold still meanwhile
      if (el.hasAttribute('data-wa-hint')) { el.scrollLeft = 0; continue; }
      let st = marqueeState.get(el);
      if (!st) { st = { dir: 1, wait: 12, text: null, max: 0, measure: 0 }; marqueeState.set(el, st); }
      if (st.measure-- <= 0 || st.text === null) {
        const txt = el.textContent;
        if (txt !== st.text) { st.text = txt; st.dir = 1; st.wait = 12; el.scrollLeft = 0; }
        st.max = el.scrollWidth - el.clientWidth;
        st.measure = 12;
      }
      if (st.max <= 1) {
        if (el.classList.contains('wa-marquee')) { el.classList.remove('wa-marquee'); el.scrollLeft = 0; }
        continue;
      }
      if (!el.classList.contains('wa-marquee')) el.classList.add('wa-marquee');
      if (st.wait > 0) { st.wait--; continue; }
      el.scrollLeft += st.dir;
      if (st.dir > 0 && el.scrollLeft >= st.max - 1) { st.dir = -1; st.wait = 12; }
      else if (st.dir < 0 && el.scrollLeft <= 0) { st.dir = 1; st.wait = 12; }
    }
  }
  setInterval(marqueeTick, 100);
  setInterval(() => { try { updateLcdTime(); updatePlaylistReadout(); } catch (e) {} }, 250);

  // ---- Winamp 2.x Hover Tooltips & LCD Action Hints ------------------------
  let activeTooltipEl = null;

  // Each hint matches both the classic player bar and the wiz miniplayer
  const HINTS = [
    { sel: '.previous-button, .ytmusicPlayerControlsPreviousButton', text: 'Previous Track', lcd: 'WINAMP: PREVIOUS TRACK' },
    { sel: '.rewind-button, .ytmusicPlayerControlsSeekBackwardButton', text: 'Rewind 10s', lcd: 'WINAMP: REWIND 10S' },
    { sel: PLAY_SEL, play: true },
    { sel: '.wa-stop-btn', text: 'Stop', lcd: 'WINAMP: STOP' },
    { sel: '.fast-forward-button, .ytmusicPlayerControlsSeekForwardButton', text: 'Fast Forward 30s', lcd: 'WINAMP: FAST FORWARD' },
    { sel: '.next-button, .ytmusicPlayerControlsNextButton', text: 'Next Track', lcd: 'WINAMP: NEXT TRACK' },
    { sel: '[data-wa-btn="rep"], .ytmusicPlayerControlsRepeatButton', text: 'Toggle Repeat', lcd: 'WINAMP: REPEAT' },
    { sel: '[data-wa-btn="shuf"], .ytmusicPlayerControlsShuffleButton', text: 'Toggle Shuffle', lcd: 'WINAMP: SHUFFLE' },
    { sel: '[data-wa-btn="vol"], .ytMusicMiniPlayerVolumeWrapper', text: 'Volume', lcd: 'WINAMP: VOLUME' },
    { sel: '[data-wa-btn="pl"]', text: 'Toggle Playlist Window', lcd: 'WINAMP: PLAYLIST' },
    { sel: '[data-wa-btn="fs"]', text: 'Toggle Fullscreen', lcd: 'WINAMP: FULLSCREEN' },
    { sel: '.wa-diamond-badge', text: "Winamp 2.x — It really whips the llama's ass!", lcd: 'WINAMP 2.x CLASSIC' }
  ];

  function showTooltip(el, text, lcd) {
    if (!state.themeOn) return;
    if (!activeTooltipEl) {
      activeTooltipEl = document.createElement('div');
      activeTooltipEl.className = 'wa-tooltip';
      document.body.appendChild(activeTooltipEl);
    }
    activeTooltipEl.textContent = text;
    activeTooltipEl.style.display = 'block';

    const rect = el.getBoundingClientRect();
    const tipRect = activeTooltipEl.getBoundingClientRect();
    let left = Math.max(4, Math.min(window.innerWidth - tipRect.width - 4, rect.left + (rect.width - tipRect.width) / 2));
    let top = rect.top - tipRect.height - 4;
    if (top < 0) top = rect.bottom + 4;

    activeTooltipEl.style.left = Math.round(left) + 'px';
    activeTooltipEl.style.top = Math.round(top) + 'px';

    // The LCD hint is painted over the title by CSS (attr(data-wa-hint)), so
    // YTM's own title nodes are never touched and keep updating underneath
    const titleEl = document.querySelector(TITLE_SEL);
    if (titleEl) {
      if (lcd) titleEl.setAttribute('data-wa-hint', lcd);
      else titleEl.removeAttribute('data-wa-hint');
    }
  }

  function hideTooltip() {
    if (activeTooltipEl) {
      activeTooltipEl.style.display = 'none';
    }
    document.querySelectorAll('[data-wa-hint]').forEach(el => el.removeAttribute('data-wa-hint'));
  }

  function setupTooltips() {
    document.addEventListener('pointerover', (e) => {
      if (!state.themeOn) return;
      const pb = e.target.closest(BAR_SEL);
      if (!pb) return;
      for (const h of HINTS) {
        const match = e.target.closest(h.sel);
        if (match) {
          let { text, lcd } = h;
          if (h.play) {
            const isPlaying = pb.hasAttribute('is-playing');
            text = isPlaying ? 'Pause (Space)' : 'Play (Space)';
            lcd = isPlaying ? 'WINAMP: PAUSE' : 'WINAMP: PLAY';
          }
          showTooltip(match, text, lcd);
          return;
        }
      }
      // Over a bar control without a hint: don't leave the last one showing
      hideTooltip();
    }, true);

    document.addEventListener('pointerout', (e) => {
      if (!e.target.closest(BAR_SEL)) return;
      const next = e.relatedTarget;
      if (!next || !next.closest(BAR_SEL)) hideTooltip();
    }, true);
  }

  function start() {
    applyClasses();
    schedule();
    setupTooltips();
    const mo = new MutationObserver(onMutations);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(schedule, 1000);
    window.addEventListener("yt-navigate-finish", schedule, true);
    document.addEventListener("yt-player-updated", schedule, true);
    document.addEventListener("play", () => {
      const viz = document.querySelector("[data-winamp-viz]");
      if (viz) viz.classList.remove("is-paused");
      schedule();
    }, true);
    document.addEventListener("pause", () => {
      const viz = document.querySelector("[data-winamp-viz]");
      if (viz) viz.classList.add("is-paused");
      schedule();
    }, true);

    // Delegated click handler: direct clicking on songs in queue or playlist to play immediately
    document.addEventListener(
      "click",
      (e) => {
        if (!state.themeOn) return;

        // 1. Up Next Queue items
        const queueItem = e.target.closest("ytmusic-player-queue-item");
        if (queueItem) {
          if (
            e.target.closest(
              'ytmusic-menu-renderer, button, [role="button"], #menu'
            )
          )
            return;
          const playBtn =
            queueItem.querySelector("#play-button") ||
            queueItem.querySelector(".play-button");
          if (playBtn) {
            playBtn.click();
          }
          return;
        }

        // 2. Responsive list items (playlist shelf / albums / search)
        const listItem = e.target.closest(
          "ytmusic-responsive-list-item-renderer"
        );
        if (listItem) {
          if (
            e.target.closest(
              'ytmusic-menu-renderer, button, [role="button"], a, #menu, yt-button-shape'
            )
          )
            return;
          const playBtn =
            listItem.querySelector("#play-button") ||
            listItem.querySelector(".play-button");
          if (playBtn) {
            playBtn.click();
          } else {
            const link = listItem.querySelector("a.yt-simple-endpoint");
            if (link) link.click();
          }
        }
      },
      true
    );
  }

  function loadState() {
    chrome.storage.local.get(
      [KEY_THEME, KEY_AUDIO, KEY_SKIN, KEY_SMOOTH],
      (res) => {
        state.themeOn = res[KEY_THEME] !== false;
        state.audioOnly = res[KEY_AUDIO] !== false;
        state.skin = res[KEY_SKIN] || "classic";
        state.vizSmooth =
          res[KEY_SMOOTH] !== undefined ? Number(res[KEY_SMOOTH]) : 65;
        applyClasses();
        tick();
      }
    );
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (KEY_THEME in changes)
      state.themeOn = changes[KEY_THEME].newValue !== false;
    if (KEY_AUDIO in changes)
      state.audioOnly = changes[KEY_AUDIO].newValue !== false;
    if (KEY_SKIN in changes)
      state.skin = changes[KEY_SKIN].newValue || "classic";
    if (KEY_SMOOTH in changes)
      state.vizSmooth =
        changes[KEY_SMOOTH].newValue !== undefined
          ? Number(changes[KEY_SMOOTH].newValue)
          : 65;
    applyClasses();
    tick();
  });

  applyClasses();
  loadState();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
