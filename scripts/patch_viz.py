import re
p = 'content.js'
s = open(p, encoding='utf-8', newline='').read().replace('\r\n', '\n')

def cut(s, start, end, new, incl_end=False):
    a = s.index(start)
    b = s.index(end, a) + (len(end) if incl_end else 0)
    return s[:a] + new + s[b:]

# 1. Recreate old DOM versions that lack the canvas
s = s.replace('if (viz && !viz.querySelector(".wa-lcd-main")) {',
              'if (viz && (!viz.querySelector(".wa-lcd-main") || !viz.querySelector(".wa-spec-canvas"))) {', 1)

# 2. Replace 16 DOM columns by a single canvas
s = cut(s, '        const barsContainer = document.createElement("div");',
        '        spec.appendChild(barsContainer);\n',
        '''        // Single canvas: authentic Winamp 2.x analyzer (pixel rows, vis palette, 1px peaks)
        const specCanvas = document.createElement("canvas");
        specCanvas.className = "wa-spec-canvas";
        specCanvas.height = 16;
        spec.appendChild(specCanvas);
''', incl_end=True)

# 3. Module-level palette + drawing
helper = '''
  // ---- Classic Winamp 2.x spectrum analyzer (viscolor.txt default palette) ----
  const VIS_COLORS = [
    [0, 0, 0], [24, 33, 41], [239, 49, 16], [206, 41, 16], [214, 90, 0],
    [214, 102, 0], [214, 115, 0], [198, 123, 8], [222, 165, 24], [214, 181, 33],
    [189, 222, 41], [148, 222, 33], [41, 206, 16], [50, 190, 16], [57, 181, 16],
    [49, 156, 8], [41, 148, 0], [24, 132, 8], [255, 255, 255], [214, 214, 222],
    [181, 189, 189], [160, 170, 175], [148, 156, 165], [150, 150, 150],
  ];
  // Row 0 = bottom (green) ... row 15 = top (red), like Winamp's bar gradient
  const SPEC_ROW_CSS = [];
  for (let r = 0; r < 16; r++) {
    const c = VIS_COLORS[17 - r];
    SPEC_ROW_CSS.push(`rgb(${c[0]},${c[1]},${c[2]})`);
  }
  const SPEC_PEAK_CSS = "rgb(150,150,150)";
  const specBarRows = new Array(16).fill(0);
  const specPeakRows = new Array(16).fill(0);
  const frameTargets = new Array(16).fill(0);
  let lastSpecSig = "";
  let lastFrameT = 0;

  function drawSpectrum(canvas, force) {
    const W = canvas.clientWidth || 111;
    let sized = false;
    if (canvas.width !== W || canvas.height !== 16) {
      canvas.width = W;
      canvas.height = 16;
      sized = true;
    }
    let sig = W + ":";
    for (let i = 0; i < 16; i++) {
      specBarRows[i] = Math.max(0, Math.min(16, Math.round(smoothBars[i] / 100 * 16)));
      specPeakRows[i] = peakHeights[i] > 3
        ? Math.max(0, Math.min(16, Math.round(peakHeights[i] / 100 * 16)))
        : 0;
      sig += specBarRows[i] + "," + specPeakRows[i] + ";";
    }
    if (!sized && !force && sig === lastSpecSig) return;
    lastSpecSig = sig;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, 16);
    const pitch = Math.max(2, Math.floor((W + 1) / 16));
    const bw = pitch - 1;
    const x0 = Math.max(0, Math.floor((W - (pitch * 16 - 1)) / 2));
    for (let r = 0; r < 16; r++) {
      ctx.fillStyle = SPEC_ROW_CSS[r];
      for (let i = 0; i < 16; i++) {
        if (specBarRows[i] > r) ctx.fillRect(x0 + i * pitch, 15 - r, bw, 1);
      }
    }
    ctx.fillStyle = SPEC_PEAK_CSS;
    for (let i = 0; i < 16; i++) {
      if (specPeakRows[i] > 0) ctx.fillRect(x0 + i * pitch, 16 - specPeakRows[i], bw, 1);
    }
  }

'''
s = s.replace('\n  function startVisualizerLoop() {', helper + '  function startVisualizerLoop() {', 1)

# 4. renderFrame head: throttle to ~30fps, use canvas
s = cut(s, '      const bars = viz.querySelectorAll(".wa-spec-bar");',
        '      const video = document.querySelector("video");',
        '''      const nowT = performance.now();
      if (document.hidden || nowT - lastFrameT < 33) {
        visualizerAnimId = requestAnimationFrame(renderFrame);
        return;
      }
      lastFrameT = nowT;
      const canvas = viz.querySelector(".wa-spec-canvas");
      if (!canvas) {
        visualizerAnimId = requestAnimationFrame(renderFrame);
        return;
      }

''')

# 5. Paused branch
s = cut(s, '      if (isPaused) {', '      // Detect if video source changed',
        '''      if (isPaused) {
        for (let i = 0; i < 16; i++) {
          smoothBars[i] = Math.max(0, smoothBars[i] * 0.85 - 1.5);
          peakHeights[i] = Math.max(0, peakHeights[i] - 2.5);
        }
        drawSpectrum(canvas);
        visualizerAnimId = requestAnimationFrame(renderFrame);
        return;
      }

''')

# 6. reuse targets array
s = s.replace('const targets = new Array(16).fill(0);', 'const targets = frameTargets;', 1)

# 7. final write loop -> canvas
s = cut(s, '        bars[i].style.setProperty("height", barPct + "%", "important");',
        '      visualizerAnimId = requestAnimationFrame(renderFrame);\n    }\n\n    visualizerAnimId = requestAnimationFrame(renderFrame);',
        '''      }
      drawSpectrum(canvas);

''')
# the removed text ended mid-loop; the loop's closing brace is re-added above

# 8. LCD clock: write only on change (avoids needless MutationObserver wakeups)
s = s.replace('digits.textContent = `${mins}:${secs}`;',
              'const txt = `${mins}:${secs}`;\n    if (digits.textContent !== txt) digits.textContent = txt;', 1)

open(p, 'w', encoding='utf-8', newline='').write(s.replace('\n', '\r\n'))
print('patched')
