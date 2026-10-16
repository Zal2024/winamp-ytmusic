const KEY_THEME = "winampThemeOn";
const KEY_AUDIO = "winampAudioOnly";
const KEY_SKIN = "winampSkin";
const KEY_SMOOTH = "winampVizSmooth";

const theme = document.getElementById("theme");
const audio = document.getElementById("audio");
const skin = document.getElementById("skin");
const smooth = document.getElementById("smooth");
const smoothVal = document.getElementById("smooth-val");
const presetBtns = document.querySelectorAll(".preset-btn");

function applyPopupSkin(skinName) {
  document.documentElement.setAttribute("data-wa-skin", skinName || "classic");
}

function updateSmoothUI(val) {
  const num = Math.max(0, Math.min(100, Math.round(Number(val ?? 65))));
  if (smooth) {
    smooth.value = String(num);
    smooth.style.setProperty("--slider-pct", num + "%");
  }
  if (smoothVal) {
    smoothVal.textContent = num + "%";
  }
  presetBtns.forEach((btn) => {
    const presetNum = Number(btn.getAttribute("data-smooth"));
    btn.classList.toggle("is-active", presetNum === num);
  });
}

chrome.storage.local.get(
  [KEY_THEME, KEY_AUDIO, KEY_SKIN, KEY_SMOOTH],
  (res) => {
    theme.checked = res[KEY_THEME] !== false; // default ON
    audio.checked = res[KEY_AUDIO] !== false; // default ON
    const currentSkin = res[KEY_SKIN] || "classic";
    if (skin) {
      skin.value = currentSkin;
    }
    applyPopupSkin(currentSkin);
    const currentSmooth =
      res[KEY_SMOOTH] !== undefined ? Number(res[KEY_SMOOTH]) : 65;
    updateSmoothUI(currentSmooth);
  }
);

theme.addEventListener("change", () =>
  chrome.storage.local.set({ [KEY_THEME]: theme.checked })
);

audio.addEventListener("change", () =>
  chrome.storage.local.set({ [KEY_AUDIO]: audio.checked })
);

if (skin) {
  skin.addEventListener("change", () => {
    applyPopupSkin(skin.value);
    chrome.storage.local.set({ [KEY_SKIN]: skin.value });
  });
}

if (smooth) {
  smooth.addEventListener("input", () => {
    const num = Math.max(0, Math.min(100, Math.round(Number(smooth.value))));
    updateSmoothUI(num);
    chrome.storage.local.set({ [KEY_SMOOTH]: num });
  });
}

presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const num = Math.max(
      0,
      Math.min(100, Math.round(Number(btn.getAttribute("data-smooth"))))
    );
    updateSmoothUI(num);
    chrome.storage.local.set({ [KEY_SMOOTH]: num });
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (KEY_THEME in changes) {
    theme.checked = changes[KEY_THEME].newValue !== false;
  }
  if (KEY_AUDIO in changes) {
    audio.checked = changes[KEY_AUDIO].newValue !== false;
  }
  if (KEY_SKIN in changes) {
    const newSkin = changes[KEY_SKIN].newValue || "classic";
    if (skin) skin.value = newSkin;
    applyPopupSkin(newSkin);
  }
  if (KEY_SMOOTH in changes) {
    const newSmooth =
      changes[KEY_SMOOTH].newValue !== undefined
        ? Number(changes[KEY_SMOOTH].newValue)
        : 65;
    updateSmoothUI(newSmooth);
  }
});
