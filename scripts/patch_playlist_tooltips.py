# Patcher for Button Pressed States, Tooltips, and Winamp Playlist Editor
import os

repo_dir = r'C:\Users\User1\winamp-ytmusic'
css_path = os.path.join(repo_dir, 'winamp.css')
js_path = os.path.join(repo_dir, 'content.js')

with open(css_path, 'r', encoding='utf-8') as f:
    css = f.read()

CSS_ADDITIONS = """
/* ====================  WINAMP 2.x ENHANCEMENTS  =================== */

/* Transport glyphs active / pressed translation (Requirement: 1px pressed-down displacement) */
html.winamp-ytm-on ytmusic-player-bar .left-controls-buttons yt-icon-button:active yt-icon,
html.winamp-ytm-on ytmusic-player-bar #play-pause-button:active yt-icon,
html.winamp-ytm-on ytmusic-player-bar .wa-stop-btn:active .wa-stop-icon,
html.winamp-ytm-on ytmusic-player-bar[is-playing] #play-pause-button yt-icon,
html.winamp-ytm-on ytmusic-player-bar #play-pause-button.is-playing yt-icon,
html.winamp-ytm-on ytmusic-player-bar #play-pause-button[data-wa-playstate="playing"] yt-icon,
html.winamp-ytm-on ytmusic-player-bar:has(.winamp-viz.is-playing) #play-pause-button yt-icon,
html.winamp-ytm-on ytmusic-player-bar #play-pause-button[aria-label*="Pause"] yt-icon,
html.winamp-ytm-on ytmusic-player-bar #play-pause-button[title*="Pause"] yt-icon {
  transform: translate(1px, 1px) !important;
}

/* Toggle glyphs active translation */
html.winamp-ytm-on ytmusic-player-bar #right-controls [data-wa-btn="rep"]:active::after,
html.winamp-ytm-on ytmusic-player-bar #right-controls [data-wa-btn="rep"].is-on::after,
html.winamp-ytm-on ytmusic-player-bar[data-wa-repeat="on"] #right-controls [data-wa-btn="rep"]::after,
html.winamp-ytm-on ytmusic-player-bar #right-controls [data-wa-btn="pl"]:active::after,
html.winamp-ytm-on ytmusic-player-bar #right-controls [data-wa-btn="pl"].is-on::after {
  transform: translate(1px, calc(-50% + 1px)) !important;
}

/* Transport & Toggle button hover highlight */
html.winamp-ytm-on ytmusic-player-bar .left-controls-buttons yt-icon-button:hover,
html.winamp-ytm-on ytmusic-player-bar #play-pause-button:hover,
html.winamp-ytm-on ytmusic-player-bar .wa-stop-btn:hover,
html.winamp-ytm-on ytmusic-player-bar #right-controls [data-wa-btn]:hover {
  filter: brightness(1.1) !important;
}

/* Classic Winamp 2.x retro tooltips */
.wa-tooltip,
html.winamp-ytm-on tp-yt-paper-tooltip #tooltip {
  background: #ffffcc !important;
  color: #000000 !important;
  border: 1px solid #000000 !important;
  font-family: Tahoma, 'Segoe UI', Arial, sans-serif !important;
  font-size: 11px !important;
  font-weight: normal !important;
  line-height: 1.2 !important;
  padding: 1px 4px !important;
  border-radius: 0 !important;
  box-shadow: 1px 1px 0 rgba(0, 0, 0, 0.4) !important;
  pointer-events: none !important;
  white-space: nowrap !important;
  z-index: 10000000 !important;
}

/* Queue track numbering counter (1. Artist - Song) */
html.winamp-ytm-on #queue,
html.winamp-ytm-on ytmusic-player-queue {
  counter-reset: wa-pl-counter !important;
}
html.winamp-ytm-on ytmusic-player-queue-item {
  counter-increment: wa-pl-counter !important;
}
html.winamp-ytm-on ytmusic-player-queue-item .song-info::before {
  content: counter(wa-pl-counter) ". " !important;
  color: var(--wa-led-green) !important;
  font-family: "Lucida Console", "Consolas", monospace !important;
  font-size: 10px !important;
  font-weight: 700 !important;
  line-height: 16px !important;
  margin-right: 4px !important;
  flex-shrink: 0 !important;
}
html.winamp-ytm-on ytmusic-player-queue-item:hover .song-info::before,
html.winamp-ytm-on ytmusic-player-queue-item[selected] .song-info::before,
html.winamp-ytm-on ytmusic-player-queue-item[play-button-state="playing"] .song-info::before {
  color: #ffffff !important;
}

/* Winamp Playlist Editor Frame */
html.winamp-ytm-on ytmusic-player-page #side-panel {
  background: var(--wa-chassis) !important;
  border: 1px solid #10111a !important;
  box-shadow: inset 1px 1px 0 #4c4f6f, inset -1px -1px 0 #0d0e16, 0 1px 0 #000000 !important;
  display: flex !important;
  flex-direction: column !important;
  box-sizing: border-box !important;
  padding: 0 !important;
}
html.winamp-ytm-on .wa-pl-titlebar {
  margin: 0 !important;
  border-bottom: 1px solid var(--wa-btn-outline) !important;
  flex-shrink: 0 !important;
}
html.winamp-ytm-on .wa-pl-footer {
  flex-shrink: 0 !important;
  margin-top: auto !important;
}
"""

if '/* ====================  WINAMP 2.x ENHANCEMENTS  =================== */' not in css:
    css += '\n' + CSS_ADDITIONS
    with open(css_path, 'w', encoding='utf-8') as f:
        f.write(css)
    styles_path = os.path.join(repo_dir, 'styles.css')
    with open(styles_path, 'w', encoding='utf-8') as f:
        f.write(css)
    print('winamp.css & styles.css updated')
else:
    print('CSS already contains enhancements')
