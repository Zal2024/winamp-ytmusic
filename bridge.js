// Runs in MAIN world - direct access to YouTube Music's Polymer elements & state
(() => {
  "use strict";

  function syncState() {
    const pb = document.querySelector('ytmusic-player-bar');
    if (!pb) return;

    // 1. Reflect shuffle state
    const isShuffleOn = Boolean(pb.shuffleOn || pb.isShuffleOn);
    const newShuffle = isShuffleOn ? 'on' : 'off';
    if (pb.getAttribute('data-wa-shuffle') !== newShuffle) {
      pb.setAttribute('data-wa-shuffle', newShuffle);
    }

    // 2. Reflect repeat state
    const repMode = pb.repeatMode_ || pb.repeatMode;
    const isRepeatOn = Boolean(repMode && repMode !== 'NONE');
    const newRepeat = isRepeatOn ? 'on' : 'off';
    if (pb.getAttribute('data-wa-repeat') !== newRepeat) {
      pb.setAttribute('data-wa-repeat', newRepeat);
    }

    // 3. Hook click on shuffle button so clicking anywhere on it triggers onShuffleButtonClick
    const shufBtn = pb.querySelector('.shuffle');
    if (shufBtn && !shufBtn.hasAttribute('data-wa-bridge-hook')) {
      shufBtn.setAttribute('data-wa-bridge-hook', '1');
      const handler = (e) => {
        // If YTM renamed its internal handler, let the native click through
        // instead of swallowing it and leaving shuffle dead
        if (typeof pb.onShuffleButtonClick !== 'function') {
          setTimeout(syncState, 50);
          return;
        }
        e.stopImmediatePropagation();
        e.preventDefault();
        pb.onShuffleButtonClick(new CustomEvent('click', { detail: 1, bubbles: true }));
        syncState();
      };
      shufBtn.addEventListener('click', handler, true);
      const inner = shufBtn.querySelector('button');
      if (inner) inner.addEventListener('click', handler, true);
    }
  }

  setInterval(syncState, 200);
  window.addEventListener('click', () => setTimeout(syncState, 50), true);
  document.addEventListener('DOMContentLoaded', syncState);
})();
