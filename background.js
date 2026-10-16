/* Winamp YouTube Music — service worker
 * Handles the Alt+W keyboard command by flipping the theme flag in storage.
 * content.js listens to storage changes and re-applies, so nothing else needed.
 */
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-theme") return;
  const { winampThemeOn = true } = await chrome.storage.local.get("winampThemeOn");
  await chrome.storage.local.set({ winampThemeOn: !winampThemeOn });
});
