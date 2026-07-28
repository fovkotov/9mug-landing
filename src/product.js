import Lenis from "lenis";
import { play } from "cuelume";
import "./product.css";
import "./components/ProductViewer.css";
import { HERO_INTERACTION_MODE } from "./hero/hero-mode.js";
import { setupLegacySlidesHero } from "./hero/legacy-slides-hero.js";
import {
  createMugFrameImages,
  createProductViewer,
  preloadMugFrameImages
} from "./components/ProductViewer.js";

const isMobileViewport = () => window.matchMedia("(max-width: 900px)").matches;
const baseUrl = import.meta.env.BASE_URL ?? "/";
function resolvePublicAssetPath(path) {
  if (!path) return "";
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  if (!path.startsWith("/")) return path;
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}${path}`;
}

// Kick off mug-frame download + decode immediately on product page entry.
const mugFrameImages = createMugFrameImages(resolvePublicAssetPath, "/media/mug_frames");
const mugFramesWarmup = preloadMugFrameImages(mugFrameImages);

const radioBtn = document.querySelector("#radioBtn");
const radioIcon = document.querySelector("#radioIcon");
const noiseBtn = document.querySelector("#noiseBtn");
const radioPlayer = document.querySelector("#radioPlayer");
const radioPlayIconSource = resolvePublicAssetPath("/media/radio-icon-play.png");
const radioPauseIconSource = resolvePublicAssetPath("/media/radio-icon-pause.png");
const addToCartBtn = document.querySelector("#addToCart");
const bagStatusText = document.querySelector("#bagStatusText");

const scrollVideoSection = document.querySelector("#scrollVideoSection");
const scrollVideo = document.querySelector("#scrollVideo");
const heroPanel = document.querySelector(".panel-hero");
const productViewerRoot = document.querySelector("#productViewerRoot");
const legacyHeroRoot = document.querySelector("#legacyHeroRoot");
const heroDesktopImage = document.querySelector("#heroDesktopImage");
const heroMobileImage = document.querySelector("#heroMobileImage");
const heroDragSlider = document.querySelector("#heroDragSlider");
const metaSwitcher = document.querySelector("#metaSwitcher");
const metaSwitchFirst = document.querySelector("#metaSwitchFirst");
const metaSwitchSecond = document.querySelector("#metaSwitchSecond");
const mugSwitchButtons = [...document.querySelectorAll(".mug-switcher-btn")];

const lenis = new Lenis({
  smoothWheel: true,
  wheelMultiplier: 1,
  syncTouch: true,
  touchMultiplier: 1.1,
  lerp: 0.09
});

const radioTracks = ["/audio/track-1.mp3", "/audio/track-2.mp3", "/audio/track-3.mp3"].map(
  resolvePublicAssetPath
);
let currentTrackIndex = 0;
let radioEnabled = false;
let activeAudioControl = "radio";
let bagSelected = false;

let noiseEnabled = false;
let audioContext = null;
let noiseNode = null;
let noiseGain = null;
let brownNoiseLastOut = 0;
let endVideoPrimed = false;

function prepareEndVideo() {
  if (!scrollVideo) return;

  const rawSrc = scrollVideo.getAttribute("src") ?? "";
  const resolvedSrc = resolvePublicAssetPath(rawSrc);
  if (resolvedSrc && scrollVideo.getAttribute("src") !== resolvedSrc) {
    scrollVideo.setAttribute("src", resolvedSrc);
  }

  scrollVideo.preload = "auto";
  scrollVideo.muted = true;
  scrollVideo.playsInline = true;
  scrollVideo.loop = true;
  scrollVideo.load();
}

prepareEndVideo();

function playTrack(index) {
  radioPlayer.src = radioTracks[index];
  radioPlayer.volume = 0.39;
  return radioPlayer.play();
}

function setRadioUiState() {
  const isRadioActive = activeAudioControl === "radio";
  radioBtn.classList.toggle("is-active", isRadioActive);
  radioBtn.classList.toggle("is-muted", !isRadioActive);
  if (radioIcon) {
    const isAnyAudioEnabled = radioEnabled || noiseEnabled;
    radioIcon.src = isAnyAudioEnabled ? radioPauseIconSource : radioPlayIconSource;
  }
}

function updateNoiseUiState() {
  const isNoiseActive = activeAudioControl === "noise";
  noiseBtn.classList.toggle("is-active", isNoiseActive);
  noiseBtn.classList.toggle("is-muted", !isNoiseActive);
}

function setBagUiState() {
  if (bagStatusText) {
    bagStatusText.classList.toggle("is-visible", bagSelected);
  }
  if (addToCartBtn) {
    addToCartBtn.classList.toggle("is-added", bagSelected);
    addToCartBtn.setAttribute("aria-pressed", String(bagSelected));
    const label = addToCartBtn.querySelector(".cart-label");
    if (label) {
      label.textContent = bagSelected ? "In cart" : "Add to cart";
    }
  }
}

function setupDirectionalProductHero() {
  if (!heroPanel || !productViewerRoot) return;

  if (legacyHeroRoot) legacyHeroRoot.hidden = true;
  productViewerRoot.hidden = false;
  heroPanel.dataset.heroMode = "directional";
  heroPanel.classList.add("is-directional-hero");

  createProductViewer(productViewerRoot, {
    images: mugFrameImages,
    transitionDuration: 0,
    // Rectangular mid-band: far_left | left | center | right | far_right
    deadZoneHalfWidth: 0.28,
    deadZoneHalfHeight: 0.19,
    sideFarBoundary: 0.7,
    horizontalSensitivity: 1.05,
    verticalSensitivity: 0.95,
    maxGamma: 20,
    maxBeta: 12,
    showZones: false
  });

  // Ensure the page-entry warmup stays referenced / in flight.
  void mugFramesWarmup;
}

function setupProductHero() {
  const useLegacy = HERO_INTERACTION_MODE === "legacy-slides";

  if (useLegacy) {
    if (productViewerRoot) productViewerRoot.hidden = true;
    if (legacyHeroRoot) legacyHeroRoot.hidden = false;
    heroPanel?.classList.remove("is-directional-hero");
    if (heroPanel) heroPanel.dataset.heroMode = "legacy-slides";

    setupLegacySlidesHero({
      heroPanel,
      heroDesktopImage,
      heroMobileImage,
      heroDragSlider,
      metaSwitcher,
      metaSwitchFirst,
      metaSwitchSecond,
      mugSwitchButtons,
      resolvePublicAssetPath,
      isMobileViewport,
      playButtonTick
    });
    return;
  }

  setupDirectionalProductHero();
}

function setupEndVideoPlayback() {
  if (!scrollVideo) return;

  const playVideo = () => {
    scrollVideo.play().catch(() => {
      // Autoplay may still be blocked until a gesture.
    });
  };

  const pauseVideo = () => {
    scrollVideo.pause();
  };

  if ("IntersectionObserver" in window && scrollVideoSection) {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio > 0.35) {
          playVideo();
        } else {
          pauseVideo();
        }
      },
      { threshold: [0, 0.35, 0.7] }
    );
    observer.observe(scrollVideoSection);
  } else {
    playVideo();
  }
}

function ensureNoiseGraph() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
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

function primeEndVideo() {
  if (endVideoPrimed || !scrollVideo) return;
  endVideoPrimed = true;

  scrollVideo
    .play()
    .then(() => {
      if (!scrollVideoSection) return;
      const rect = scrollVideoSection.getBoundingClientRect();
      const visible =
        rect.bottom > 0 && rect.top < window.innerHeight && rect.height > 0;
      if (!visible) {
        scrollVideo.pause();
      }
    })
    .catch(() => {
      // ignored - browser may still block without direct gesture.
    });
}

function playButtonTick() {
  play("tick");
}

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

async function toggleRadioPlayback() {
  playButtonTick();
  activeAudioControl = "radio";

  // Radio and noise are mutually exclusive.
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

  // Radio and noise are mutually exclusive.
  if (radioEnabled) {
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

radioBtn.addEventListener("click", () => {
  toggleRadioPlayback();
});

radioIcon?.addEventListener("click", () => {
  if (activeAudioControl === "noise") {
    toggleNoisePlayback();
    return;
  }
  toggleRadioPlayback();
});

noiseBtn.addEventListener("click", () => {
  toggleNoisePlayback();
});

function toggleBagState() {
  playButtonTick();
  bagSelected = !bagSelected;
  setBagUiState();
}

addToCartBtn?.addEventListener("click", () => {
  toggleBagState();
});

window.addEventListener("pointerdown", primeEndVideo, { once: true });
window.addEventListener("touchstart", primeEndVideo, { once: true, passive: true });
window.addEventListener("wheel", primeEndVideo, { once: true, passive: true });
window.addEventListener("keydown", primeEndVideo, { once: true });

setRadioUiState();
updateNoiseUiState();
setBagUiState();
setupProductHero();
setupEndVideoPlayback();

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);
