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
    const host = document.querySelector(
      "ytmusic-player-bar .left-controls-buttons"
    );
    if (!host) return;
    const existing = host.parentElement.querySelector("[data-winamp-viz]");
    if (state.themeOn) {
      let viz = existing;
      // Recreate if it's the old version without the authentic LCD subcomponents
      if (viz && !viz.querySelector(".wa-lcd-main")) {
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

        const barsContainer = document.createElement("div");
        barsContainer.className = "wa-spectrum-bars";

        // 16 spectrum columns with peak dashes
        for (let i = 0; i < 16; i++) {
          const col = document.createElement("div");
          col.className = `wa-spec-col wa-col-${i}`;
          const peak = document.createElement("span");
          peak.className = "wa-spec-peak";
          const bar = document.createElement("span");
          bar.className = "wa-spec-bar";
          col.appendChild(peak);
          col.appendChild(bar);
          barsContainer.appendChild(col);
        }
        spec.appendChild(barsContainer);

        main.appendChild(spec);
        viz.appendChild(main);

        host.insertAdjacentElement("afterend", viz);
      }

      // 3. Winamp Stop Button (|◀, ▶, ||, ■, ▶|)
      const playPauseBtn = host.querySelector("#play-pause-button");
      if (playPauseBtn && !host.querySelector(".wa-stop-btn")) {
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
      let stats = host.parentElement.querySelector(".wa-audio-stats");
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
        viz.insertAdjacentElement("afterend", stats);
      }
      updatePlayState();
      attachVideoListeners();
      startVisualizerLoop();
    } else {
      if (existing) existing.remove();
      const stats = host.parentElement.querySelector(".wa-audio-stats");
      if (stats) stats.remove();
      const stopBtn = host.querySelector(".wa-stop-btn");
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
      analyserNode.fftSize = 4096;
      analyserNode.smoothingTimeConstant = 0.62;
      floatFreqArray = new Float32Array(analyserNode.frequencyBinCount);
    }
    return true;
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
        return;
      }

      if (audioSourceNode) {
        try {
          audioSourceNode.disconnect();
        } catch (e) {}
        audioSourceNode = null;
      }

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

  function startVisualizerLoop() {
    if (visualizerAnimId) return;

    function renderFrame() {
      const viz = document.querySelector("[data-winamp-viz]");
      if (!viz || !state.themeOn) {
        visualizerAnimId = null;
        return;
      }

      const bars = viz.querySelectorAll(".wa-spec-bar");
      const peaks = viz.querySelectorAll(".wa-spec-peak");
      if (bars.length < 16 || peaks.length < 16) {
        visualizerAnimId = requestAnimationFrame(renderFrame);
        return;
      }

      const video = document.querySelector("video");
      const isPaused = !video || video.paused;

      if (isPaused) {
        for (let i = 0; i < 16; i++) {
          smoothBars[i] = Math.max(0, smoothBars[i] * 0.85 - 1.5);
          bars[i].style.setProperty(
            "height",
            Math.round(smoothBars[i]) + "%",
            "important"
          );
          if (peakHeights[i] > 0) {
            peakHeights[i] = Math.max(0, peakHeights[i] - 2.5);
            peaks[i].style.setProperty(
              "bottom",
              Math.round(peakHeights[i]) + "%",
              "important"
            );
            peaks[i].style.setProperty(
              "opacity",
              peakHeights[i] > 1 ? "1" : "0",
              "important"
            );
          } else {
            peaks[i].style.setProperty("opacity", "0", "important");
          }
        }
        visualizerAnimId = requestAnimationFrame(renderFrame);
        return;
      }

      // Detect if video source changed or stream isn't bound yet
      if (video) {
        const curSrc = video.currentSrc || video.src || "";
        if ((curSrc && curSrc !== lastBoundSrc) || !audioSourceNode) {
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
        // rebind a fresh stream once readyState >= 3
        if (
          zeroEnergyFrames % 40 === 25 &&
          video &&
          video.readyState >= 3 &&
          !video.muted &&
          video.volume > 0 &&
          video.currentTime > 0.1
        ) {
          initAudioEngine(video, true);
        }
      }

      const userSmooth =
        Math.max(0, Math.min(100, Number(state.vizSmooth ?? 65))) / 100;
      if (analyserNode) {
        const targetFftSmooth = 0.12 + userSmooth * 0.72;
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

      const envAttack = 0.88 - userSmooth * 0.56;
      const envRelease = 0.72 - userSmooth * 0.56;

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
      const targets = new Array(16).fill(0);
      const spatialWeight = 0.62 - userSmooth * 0.38;
      for (let i = 0; i < 16; i++) {
        const left = i > 0 ? rawBars[i - 1] : rawBars[i];
        const right = i < 15 ? rawBars[i + 1] : rawBars[i];
        const neighborAvg = (left + right) * 0.5;
        const spatialDiff = rawBars[i] - neighborAvg;
        const contrasted = Math.max(
          0,
          Math.min(0.95, rawBars[i] + spatialDiff * spatialWeight)
        );
        const targetPct = contrasted * 100;
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
          smoothBars[i] =
            smoothBars[i] * (1 - attackAlpha) + targetPct * attackAlpha;
        } else {
          const expDecay =
            smoothBars[i] * (1 - releaseAlpha) + targetPct * releaseAlpha;
          const gravityFloor = smoothBars[i] - maxFallPerFrame;
          smoothBars[i] = Math.max(targetPct, Math.max(expDecay, gravityFloor));
        }
        const barPct = Math.min(100, Math.max(0, Math.round(smoothBars[i])));

        if (barPct >= peakHeights[i]) {
          peakHeights[i] = barPct;
          peakHolds[i] = peakHoldFrames;
        } else {
          if (peakHolds[i] > 0) {
            peakHolds[i]--;
          } else {
            peakHeights[i] = Math.max(barPct, peakHeights[i] - peakFallSpeed);
          }
        }

        bars[i].style.setProperty("height", barPct + "%", "important");
        peaks[i].style.setProperty(
          "bottom",
          Math.min(100, Math.round(peakHeights[i])) + "%",
          "important"
        );
        peaks[i].style.setProperty(
          "opacity",
          peakHeights[i] > 2 ? "1" : "0",
          "important"
        );
      }

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
    digits.textContent = `${mins}:${secs}`;
  }

  function updatePlayState() {
    const viz = document.querySelector("[data-winamp-viz]");
    const video = document.querySelector("video");
    const isPaused = video ? video.paused : true;

    if (viz) {
      viz.classList.toggle("is-paused", isPaused);
      viz.classList.toggle("is-playing", !isPaused);
    }

    const pb = document.querySelector("ytmusic-player-bar");
    if (pb) {
      pb.toggleAttribute("is-playing", !isPaused);
      pb.toggleAttribute("is-paused", isPaused);
    }

    const playPauseBtn = document.querySelector("ytmusic-player-bar #play-pause-button");
    if (playPauseBtn) {
      playPauseBtn.classList.toggle("is-playing", !isPaused);
      playPauseBtn.classList.toggle("is-paused", isPaused);
      playPauseBtn.setAttribute("data-wa-playstate", isPaused ? "paused" : "playing");
      if (playPauseBtn.hasAttribute("hidden")) {
        playPauseBtn.removeAttribute("hidden");
      }
    }

    const spinner = document.querySelector("ytmusic-player-bar .spinner-container");
    if (spinner) {
      spinner.style.setProperty("display", "none", "important");
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
    const queue = document.querySelector('ytmusic-player-page #queue, ytmusic-player-page ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_QUEUE"]');
    [searchContents, queue].forEach(t => {
      if (!t || t.querySelector('.wa-pl-footer')) return;
      const f = document.createElement('div');
      f.className = 'wa-pl-footer';
      const grp = document.createElement('div');
      grp.className = 'wa-pl-btn-group';
      ['ADD', 'REM', 'SEL', 'MISC'].forEach(lbl => {
        const b = document.createElement('button');
        b.className = 'wa-btn wa-pl-btn';
        b.textContent = lbl;
        grp.appendChild(b);
      });
      f.appendChild(grp);
      const readout = document.createElement('div');
      readout.className = 'wa-pl-readout';
      const digits = document.createElement('span');
      digits.className = 'wa-pl-digits';
      digits.textContent = '00:00 / 00:00';
      readout.appendChild(digits);
      f.appendChild(readout);
      const opts = document.createElement('button');
      opts.className = 'wa-btn wa-pl-btn';
      opts.textContent = 'LIST OPTS';
      f.appendChild(opts);
      t.appendChild(f);
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
    const rightControls = document.querySelector('ytmusic-player-bar #right-controls');
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
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => requestAnimationFrame(tick), 80);
  }

  function start() {
    applyClasses();
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, { childList: true, subtree: true });
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
