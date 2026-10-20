import os

js_path = r'C:\Users\User1\winamp-ytmusic\content.js'

with open(js_path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update ensureWinampTitleBars to add playlist titlebar
old_titlebars = """    // Ensure title bar on search results container"""

new_titlebars = """    // Ensure title bar on player page side panel (Playlist Editor)
    const sidePanel = document.querySelector('ytmusic-player-page #side-panel');
    if (sidePanel && !sidePanel.querySelector('.wa-pl-titlebar')) {
      const tb = document.createElement('div');
      tb.className = 'wa-window-titlebar wa-pl-titlebar';
      const bolt = document.createElement('span'); bolt.className = 'wa-lightning-bolt'; tb.appendChild(bolt);
      const grip1 = document.createElement('div'); grip1.className = 'wa-tb-grip'; tb.appendChild(grip1);
      const title = document.createElement('span'); title.className = 'wa-tb-title-text'; title.textContent = 'WINAMP PLAYLIST'; tb.appendChild(title);
      const grip2 = document.createElement('div'); grip2.className = 'wa-tb-grip'; tb.appendChild(grip2);
      const btns = document.createElement('div'); btns.className = 'wa-tb-btns';
      const closeBtn = document.createElement('span'); closeBtn.className = 'wa-tb-btn wa-close'; closeBtn.textContent = '✕'; btns.appendChild(closeBtn);
      tb.appendChild(btns);
      closeBtn.onclick = () => {
        const plBtn = document.querySelector('ytmusic-player-bar [data-wa-btn="pl"], ytmusic-player-bar .toggle-player-page-button');
        if (plBtn) plBtn.click();
      };
      sidePanel.prepend(tb);
    }

    // Ensure title bar on search results container"""

# 2. Update ensurePlaylistFooters to place footer at bottom of side-panel and add updatePlaylistReadout
old_footers = """  // ---- Winamp playlist footers (Requirement 1, 8) ---------------------------
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
  }"""

new_footers = """  // ---- Winamp playlist footers (Requirement 1, 8) ---------------------------
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
  }"""

# 3. Tooltips and LCD Action Hints
tooltips_code = """  // ---- Winamp 2.x Hover Tooltips & LCD Action Hints ------------------------
  let activeTooltipEl = null;
  let savedMarqueeTitle = null;
  let hoverHintActive = false;

  const HINTS = [
    { sel: '.previous-button', text: 'Previous Track (Z)', lcd: 'WINAMP: PREVIOUS TRACK' },
    { sel: '.rewind-button', text: 'Rewind 10s (Left)', lcd: 'WINAMP: REWIND 10S' },
    { sel: '#play-pause-button', text: 'Play / Pause (Space / C)', lcd: 'WINAMP: PLAY/PAUSE' },
    { sel: '.wa-stop-btn', text: 'Stop (V)', lcd: 'WINAMP: STOP' },
    { sel: '.fast-forward-button', text: 'Fast Forward 30s (Right)', lcd: 'WINAMP: FAST FORWARD' },
    { sel: '.next-button', text: 'Next Track (B)', lcd: 'WINAMP: NEXT TRACK' },
    { sel: '[data-wa-btn="rep"]', text: 'Toggle Repeat (R)', lcd: 'WINAMP: REPEAT' },
    { sel: '[data-wa-btn="shuf"]', text: 'Toggle Shuffle (S)', lcd: 'WINAMP: SHUFFLE' },
    { sel: '[data-wa-btn="vol"]', text: 'Volume', lcd: 'WINAMP: VOLUME' },
    { sel: '[data-wa-btn="pl"]', text: 'Toggle Playlist Window (Alt+E)', lcd: 'WINAMP: PLAYLIST' },
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

    if (lcd) {
      const titleEl = document.querySelector('ytmusic-player-bar .content-info-wrapper .title');
      if (titleEl) {
        if (!hoverHintActive) {
          hoverHintActive = true;
          savedMarqueeTitle = titleEl.textContent;
        }
        titleEl.textContent = lcd;
      }
    }
  }

  function hideTooltip() {
    if (activeTooltipEl) {
      activeTooltipEl.style.display = 'none';
    }
    if (hoverHintActive) {
      hoverHintActive = false;
      const titleEl = document.querySelector('ytmusic-player-bar .content-info-wrapper .title');
      if (titleEl && savedMarqueeTitle !== null) {
        titleEl.textContent = savedMarqueeTitle;
        savedMarqueeTitle = null;
      }
    }
  }

  function setupTooltips() {
    document.addEventListener('pointerover', (e) => {
      if (!state.themeOn) return;
      const pb = e.target.closest('ytmusic-player-bar');
      if (!pb) return;
      for (const h of HINTS) {
        const match = e.target.closest(h.sel);
        if (match) {
          let customLcd = h.lcd;
          let customText = h.text;
          if (h.sel === '#play-pause-button') {
            const isPlaying = pb.hasAttribute('is-playing') || match.classList.contains('is-playing');
            customText = isPlaying ? 'Pause (Space / C)' : 'Play (Space / X)';
            customLcd = isPlaying ? 'WINAMP: PAUSE' : 'WINAMP: PLAY';
          }
          showTooltip(match, customText, customLcd);
          return;
        }
      }
    }, true);

    document.addEventListener('pointerout', (e) => {
      const pb = e.target.closest('ytmusic-player-bar');
      if (pb) {
        const next = e.relatedTarget;
        if (!next || !next.closest('ytmusic-player-bar button, ytmusic-player-bar yt-icon-button, ytmusic-player-bar .wa-diamond-badge, ytmusic-player-bar .wa-stop-btn')) {
          hideTooltip();
        }
      }
    }, true);
  }
"""

# Check CRLF
is_crlf = '\r\n' in text
norm_text = text.replace('\r\n', '\n')

assert old_titlebars in norm_text, "old_titlebars not found"
norm_text = norm_text.replace(old_titlebars, new_titlebars)

assert old_footers in norm_text, "old_footers not found"
norm_text = norm_text.replace(old_footers, new_footers)

# Insert tooltips right before function start()
assert '  function start() {' in norm_text, "function start() not found"
norm_text = norm_text.replace('  function start() {', tooltips_code + '\n  function start() {')

# Call setupTooltips() inside start()
norm_text = norm_text.replace('    applyClasses();\n    schedule();', '    applyClasses();\n    schedule();\n    setupTooltips();')

# Call updatePlaylistReadout in 250ms interval
norm_text = norm_text.replace(
    'setInterval(() => { try { updateLcdTime(); } catch (e) {} }, 250);',
    'setInterval(() => { try { updateLcdTime(); updatePlaylistReadout(); } catch (e) {} }, 250);'
)

out_text = norm_text.replace('\n', '\r\n') if is_crlf else norm_text
with open(js_path, 'w', encoding='utf-8') as f:
    f.write(out_text)

print('Successfully patched content.js cleanly!')
