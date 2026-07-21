import Lenis from "lenis";
import { play } from "cuelume";
import { bindProductOrientationHandoff } from "./device-orientation-permission.js";
import "./shop.css";

const baseUrl = import.meta.env.BASE_URL ?? "/";
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const lenis = prefersReducedMotion
  ? null
  : new Lenis({
      smoothWheel: true,
      wheelMultiplier: 1,
      syncTouch: true,
      touchMultiplier: 1.1,
      lerp: 0.09
    });

function resolvePublicAssetPath(path) {
  if (!path) return "";
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  if (!path.startsWith("/")) return path;
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}${path}`;
}

const radioBtn = document.querySelector("#radioBtn");
const noiseBtn = document.querySelector("#noiseBtn");
const radioIcon = document.querySelector("#radioIcon");
const radioPlayer = document.querySelector("#radioPlayer");
const priceToggle = document.querySelector("#priceToggle");
const priceToggleIcon = document.querySelector("#priceToggleIcon");
const bagStatusText = document.querySelector("#bagStatusText");

const radioTracks = ["/audio/track-1.mp3", "/audio/track-2.mp3", "/audio/track-3.mp3"].map(
  resolvePublicAssetPath
);
const radioPlayIconSource = resolvePublicAssetPath("/media/radio-icon-play.png");
const radioPauseIconSource = resolvePublicAssetPath("/media/radio-icon-pause.png");
const pricePlusIconSource = resolvePublicAssetPath("/media/price-plus.svg");
const priceCheckIconSource = resolvePublicAssetPath("/media/price-check-crisp.png");

let currentTrackIndex = 0;
let radioEnabled = false;
let noiseEnabled = false;
let activeAudioControl = "radio";
let bagSelected = false;

let audioContext = null;
let noiseNode = null;
let noiseGain = null;
let brownNoiseLastOut = 0;

function playButtonTick() {
  try {
    play("tick");
  } catch {
    // Sound feedback is optional if the sample is unavailable.
  }
}

function setRadioUiState() {
  const isRadioActive = activeAudioControl === "radio";
  radioBtn?.classList.toggle("is-active", isRadioActive);
  radioBtn?.classList.toggle("is-muted", !isRadioActive);

  if (radioIcon) {
    const isAnyAudioEnabled = radioEnabled || noiseEnabled;
    radioIcon.src = isAnyAudioEnabled ? radioPauseIconSource : radioPlayIconSource;
  }
}

function updateNoiseUiState() {
  const isNoiseActive = activeAudioControl === "noise";
  noiseBtn?.classList.toggle("is-active", isNoiseActive);
  noiseBtn?.classList.toggle("is-muted", !isNoiseActive);
}

function setBagUiState() {
  if (priceToggleIcon) {
    priceToggleIcon.src = bagSelected ? priceCheckIconSource : pricePlusIconSource;
  }
  bagStatusText?.classList.toggle("is-visible", bagSelected);
  priceToggle?.setAttribute("aria-pressed", String(bagSelected));
}

function ensureNoiseGraph() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {
      // Ignored: user interaction may still be required on some browsers.
    });
  }

  if (!noiseNode) {
    noiseNode = audioContext.createScriptProcessor(2048, 1, 1);
    noiseGain = audioContext.createGain();
    noiseGain.gain.value = 0.2;

    noiseNode.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      for (let i = 0; i < output.length; i += 1) {
        const white = Math.random() * 2 - 1;
        brownNoiseLastOut = (brownNoiseLastOut + 0.02 * white) / 1.02;
        output[i] = brownNoiseLastOut * 3.5;
      }
    };

    noiseNode.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
  }
}

function enableBrownNoise() {
  ensureNoiseGraph();
  if (!audioContext || !noiseGain) return;
  noiseGain.gain.setTargetAtTime(0.2, audioContext.currentTime, 0.03);
  noiseEnabled = true;
  updateNoiseUiState();
}

function disableBrownNoise() {
  if (!audioContext || !noiseGain) return;
  noiseGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.03);
  noiseEnabled = false;
  updateNoiseUiState();
}

function playTrack(index) {
  if (!radioPlayer) return Promise.reject(new Error("No radio player found"));
  radioPlayer.src = radioTracks[index];
  radioPlayer.volume = 0.39;
  return radioPlayer.play();
}

async function toggleRadioPlayback() {
  if (!radioPlayer) return;
  playButtonTick();
  activeAudioControl = "radio";

  if (noiseEnabled) {
    disableBrownNoise();
  }

  radioEnabled = !radioEnabled;

  if (radioEnabled) {
    try {
      await playTrack(currentTrackIndex);
    } catch {
      radioEnabled = false;
    }
  } else {
    radioPlayer.pause();
  }

  setRadioUiState();
  updateNoiseUiState();
}

function toggleNoisePlayback() {
  playButtonTick();
  activeAudioControl = "noise";

  if (radioEnabled && radioPlayer) {
    radioEnabled = false;
    radioPlayer.pause();
  }

  if (!noiseEnabled) {
    enableBrownNoise();
  } else {
    disableBrownNoise();
  }

  setRadioUiState();
}

function toggleBagState() {
  playButtonTick();
  bagSelected = !bagSelected;
  setBagUiState();
}

if (radioPlayer) {
  radioPlayer.addEventListener("ended", async () => {
    if (!radioEnabled) return;
    currentTrackIndex = (currentTrackIndex + 1) % radioTracks.length;
    try {
      await playTrack(currentTrackIndex);
    } catch {
      radioEnabled = false;
      setRadioUiState();
    }
  });
}

radioBtn?.addEventListener("click", () => {
  toggleRadioPlayback();
});

noiseBtn?.addEventListener("click", () => {
  toggleNoisePlayback();
});

radioIcon?.addEventListener("click", () => {
  if (activeAudioControl === "noise") {
    toggleNoisePlayback();
    return;
  }
  toggleRadioPlayback();
});

priceToggle?.addEventListener("click", () => {
  toggleBagState();
});

priceToggleIcon?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleBagState();
});

priceToggle?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleBagState();
});

setRadioUiState();
updateNoiseUiState();
setBagUiState();

const sectionLinks = [...document.querySelectorAll("[data-section-link]")];
const homeSections = sectionLinks
  .map((link) => {
    const id = link.getAttribute("href")?.slice(1);
    const section = id ? document.getElementById(id) : null;
    return section ? { link, section } : null;
  })
  .filter(Boolean);

const slowEaseInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function setActiveSectionLink(activeLink) {
  for (const { link } of homeSections) {
    link.classList.toggle("is-active", link === activeLink);
  }
}

function getActiveSectionIndex() {
  if (!homeSections.length) return 0;

  const viewportCenter = window.innerHeight * 0.5;
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  homeSections.forEach(({ section }, index) => {
    const rect = section.getBoundingClientRect();
    const sectionCenter = rect.top + rect.height / 2;
    const distance = Math.abs(sectionCenter - viewportCenter);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function syncSectionIndicators() {
  if (!homeSections.length) return;
  const activeIndex = getActiveSectionIndex();
  setActiveSectionLink(homeSections[activeIndex].link);
}

function scrollToSection(section) {
  if (!section) return;

  if (lenis) {
    lenis.scrollTo(section, {
      duration: 0.6,
      easing: slowEaseInOut
    });
    return;
  }

  section.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
}

for (const { link, section } of homeSections) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setActiveSectionLink(link);
    scrollToSection(section);
  });
}

syncSectionIndicators();

if (lenis) {
  lenis.on("scroll", syncSectionIndicators);

  const raf = (time) => {
    lenis.raf(time);
    requestAnimationFrame(raf);
  };

  requestAnimationFrame(raf);
} else {
  window.addEventListener("scroll", syncSectionIndicators, { passive: true });
}

window.addEventListener("resize", syncSectionIndicators);
bindProductOrientationHandoff();
