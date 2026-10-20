c = open('winamp.css', encoding='utf-8', newline='').read()
nl = '\r\n'
marker = '/* Dotted Axis */'
assert marker in c
add = '''/* Authentic Winamp 2.x analyzer: one pixel-exact canvas (see drawSpectrum in content.js) */
html.winamp-ytm-on .wa-spec-canvas {
  position: absolute !important;
  left: 0 !important;
  bottom: 1px !important;
  width: 100% !important;
  height: 16px !important;
  display: block !important;
  image-rendering: pixelated !important;
  pointer-events: none !important;
}
html.winamp-ytm-on .wa-spectrum-axis {
  display: none !important;
}

'''.replace('\n', nl)
c = c.replace(marker, add + marker, 1)
open('winamp.css', 'w', encoding='utf-8', newline='').write(c)

s = open('content.js', encoding='utf-8', newline='').read().replace('\r\n', '\n')

# Observer: ignore our own / per-second churn; throttle ticks
old = '''  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => requestAnimationFrame(tick), 80);
  }'''
new = '''  let lastTickT = 0;
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
  }'''
assert old in s
s = s.replace(old, new, 1)
s = s.replace('const mo = new MutationObserver(schedule);', 'const mo = new MutationObserver(onMutations);', 1)
s = s.replace('setInterval(schedule, 500);', 'setInterval(schedule, 1000);', 1)

# Marquee: no per-tick layout reads; re-measure only on text change / every ~1s
a = s.index('  const marqueeState = new WeakMap();')
b = s.index('  setInterval(marqueeTick, 80);')
s = s[:a] + '''  const marqueeState = new WeakMap();
  let marqueeEls = [];
  let marqueeScan = 0;
  function marqueeTick() {
    if (document.hidden) return;
    if (marqueeScan-- <= 0) {
      marqueeScan = 12;
      marqueeEls = Array.from(document.querySelectorAll(
        'ytmusic-player-bar .content-info-wrapper .title, ytmusic-player-bar .content-info-wrapper .subtitle'));
    }
    for (const el of marqueeEls) {
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
''' + s[b:]
s = s.replace('setInterval(marqueeTick, 80);', 'setInterval(marqueeTick, 100);', 1)
open('content.js', 'w', encoding='utf-8', newline='').write(s.replace('\n', '\r\n'))
print('ok')
