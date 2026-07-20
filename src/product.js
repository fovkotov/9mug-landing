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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isMobileViewport = () => window.matchMedia("(max-width: 900px)").matches;
const baseUrl = import.meta.env.BASE_URL ?? "/";
const syncScrollVideoToPageScroll = true;

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
const priceToggle = document.querySelector("#priceToggle");
const priceToggleIcon = document.querySelector("#priceToggleIcon");
const bagStatusText = document.querySelector("#bagStatusText");
const pricePlusIconSource = resolvePublicAssetPath("/media/price-plus.svg");
const priceCheckIconSource = resolvePublicAssetPath("/media/price-check-crisp.png");

const scrollVideoSection = document.querySelector("#scrollVideoSection");
const scrollVideoDesktop = document.querySelector("#scrollVideo");
const scrollVideoMobile = document.querySelector("#scrollVideoMobile");
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
let lastScrollY = window.scrollY;

let noiseEnabled = false;
let audioContext = null;
let noiseNode = null;
let noiseGain = null;
let brownNoiseLastOut = 0;
let scrollVideosPrimed = false;
const scratchSection = document.querySelector("#scratchSection");
const scratchCanvas = document.querySelector("#scratchCanvas");
const scratchCursorSource = resolvePublicAssetPath("/media/scratch/cursor.png");
const scratchCoverSources = {
  desktop: {
    "1x": resolvePublicAssetPath("/media/scratch/cover-desktop-1x.webp"),
    "2x": resolvePublicAssetPath("/media/scratch/cover-desktop.webp")
  },
  mobile: {
    "1x": resolvePublicAssetPath("/media/scratch/cover-mobile-1x.webp"),
    "2x": resolvePublicAssetPath("/media/scratch/cover-mobile.webp")
  }
};

const scrollVideos = [scrollVideoDesktop, scrollVideoMobile].filter(Boolean);

function prepareScrollVideos() {
  for (const video of scrollVideos) {
    const rawSrc = video.getAttribute("src") ?? "";
    const resolvedSrc = resolvePublicAssetPath(rawSrc);
    if (resolvedSrc && video.getAttribute("src") !== resolvedSrc) {
      video.setAttribute("src", resolvedSrc);
    }

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.load();
    video.pause();
    video.currentTime = 0;
    video.addEventListener("loadedmetadata", syncScrollVideoFrame);
  }
}

prepareScrollVideos();

function getActiveScrollVideo() {
  return isMobileViewport() ? scrollVideoMobile : scrollVideoDesktop;
}

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
  if (priceToggleIcon) {
    priceToggleIcon.src = bagSelected ? priceCheckIconSource : pricePlusIconSource;
  }
  if (bagStatusText) {
    bagStatusText.classList.toggle("is-visible", bagSelected);
  }
  if (priceToggle) {
    priceToggle.setAttribute("aria-pressed", String(bagSelected));
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
    deadZoneRadius: 0.14,
    horizontalSensitivity: 1.05,
    verticalSensitivity: 0.95
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

function setupScratchPanel() {
  if (!scratchSection || !scratchCanvas) return;

  const ctx = scratchCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const coverImage = new Image();
  coverImage.decoding = "async";

  let scratchCursor = null;
  let coverReady = false;
  let isPointerInside = false;
  let lastPoint = null;
  let activeCoverSource = "";
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  const supportsFinePointer = () =>
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  function getCoverSource() {
    const density = (window.devicePixelRatio || 1) >= 1.5 ? "2x" : "1x";
    const set = isMobileViewport() ? scratchCoverSources.mobile : scratchCoverSources.desktop;
    return set[density] || set["1x"];
  }

  function getBladeSize() {
    // Match reference guide: thin vertical line from tip, ~full cursor height.
    const cursorHeight = isMobileViewport() ? 144 : 176;
    const cursorWidth = cursorHeight * (134 / 352);
    return {
      width: Math.max(2 * dpr, cursorWidth * 0.034 * dpr),
      height: cursorHeight * 0.93 * dpr
    };
  }

  function setScratchCursorVisibility(visible) {
    if (!scratchCursor) return;
    scratchSection.classList.toggle("has-scratch-cursor", visible);
  }

  function updateScratchCursorPosition(clientX, clientY) {
    if (!scratchCursor) return;
    const rect = scratchSection.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    scratchCursor.style.setProperty("--cursor-x", `${x}px`);
    scratchCursor.style.setProperty("--cursor-y", `${y}px`);
  }

  function setupScratchCursor() {
    if (scratchCursor || !supportsFinePointer()) return;

    scratchCursor = document.createElement("span");
    scratchCursor.className = "scratch-cursor";
    scratchCursor.setAttribute("aria-hidden", "true");

    const cursorImage = document.createElement("img");
    cursorImage.alt = "";
    cursorImage.src = scratchCursorSource;
    cursorImage.draggable = false;
    scratchCursor.append(cursorImage);
    scratchSection.append(scratchCursor);
  }

  function paintCover() {
    if (!coverReady) return;

    const width = scratchSection.clientWidth;
    const height = scratchSection.clientHeight;
    if (width <= 0 || height <= 0) return;

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scratchCanvas.width = Math.round(width * dpr);
    scratchCanvas.height = Math.round(height * dpr);
    scratchCanvas.style.width = `${width}px`;
    scratchCanvas.style.height = `${height}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    ctx.drawImage(coverImage, 0, 0, scratchCanvas.width, scratchCanvas.height);
    lastPoint = null;
  }

  function loadCoverImage() {
    const nextSource = getCoverSource();
    if (!nextSource) return;

    if (activeCoverSource === nextSource && coverReady && coverImage.complete) {
      paintCover();
      return;
    }

    coverReady = false;
    activeCoverSource = nextSource;
    coverImage.onload = () => {
      coverReady = true;
      paintCover();
    };
    coverImage.onerror = () => {
      coverReady = false;
    };
    coverImage.src = nextSource;
  }

  function getCanvasPoint(clientX, clientY) {
    const rect = scratchCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * scratchCanvas.width,
      y: ((clientY - rect.top) / rect.height) * scratchCanvas.height
    };
  }

  function scratchAt(point) {
    if (!point || !coverReady) return;

    const { width: bladeWidth, height: bladeHeight } = getBladeSize();
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";

    if (lastPoint) {
      // Sweep a vertical blade strip between positions so motion stays a line, not a dot trail.
      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(point.x, point.y);
      ctx.lineTo(point.x + bladeWidth, point.y);
      ctx.lineTo(point.x + bladeWidth, point.y + bladeHeight);
      ctx.lineTo(lastPoint.x + bladeWidth, lastPoint.y + bladeHeight);
      ctx.lineTo(lastPoint.x, lastPoint.y + bladeHeight);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(point.x, point.y, bladeWidth, bladeHeight);
    }

    ctx.restore();
    lastPoint = point;
  }

  function handlePointerEnter(event) {
    armScratchAssets();
    isPointerInside = true;
    setupScratchCursor();
    updateScratchCursorPosition(event.clientX, event.clientY);
    setScratchCursorVisibility(Boolean(scratchCursor));
    lastPoint = getCanvasPoint(event.clientX, event.clientY);
    scratchAt(lastPoint);
  }

  function handlePointerMove(event) {
    if (!isPointerInside) return;
    updateScratchCursorPosition(event.clientX, event.clientY);
    if (!scratchSection.classList.contains("has-scratch-cursor") && scratchCursor) {
      setScratchCursorVisibility(true);
    }
    scratchAt(getCanvasPoint(event.clientX, event.clientY));
  }

  function handlePointerLeave() {
    isPointerInside = false;
    lastPoint = null;
    setScratchCursorVisibility(false);
  }

  function handlePointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    scratchCanvas.setPointerCapture?.(event.pointerId);
    isPointerInside = true;
    setupScratchCursor();
    updateScratchCursorPosition(event.clientX, event.clientY);
    setScratchCursorVisibility(Boolean(scratchCursor));
    lastPoint = getCanvasPoint(event.clientX, event.clientY);
    scratchAt(lastPoint);
  }

  function handlePointerUp(event) {
    if (scratchCanvas.hasPointerCapture?.(event.pointerId)) {
      scratchCanvas.releasePointerCapture(event.pointerId);
    }
  }

  let assetsArmed = false;
  const armScratchAssets = () => {
    if (assetsArmed) return;
    assetsArmed = true;
    loadCoverImage();
  };

  let resizeFrame = 0;
  function handleResize() {
    if (!assetsArmed) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (activeCoverSource !== getCoverSource()) {
        loadCoverImage();
        return;
      }
      paintCover();
    });
  }

  scratchCanvas.addEventListener("pointerenter", handlePointerEnter);
  scratchCanvas.addEventListener("pointermove", handlePointerMove);
  scratchCanvas.addEventListener("pointerleave", handlePointerLeave);
  scratchCanvas.addEventListener("pointerdown", handlePointerDown);
  scratchCanvas.addEventListener("pointerup", handlePointerUp);
  scratchCanvas.addEventListener("pointercancel", handlePointerUp);
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);

  setupScratchCursor();

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        armScratchAssets();
        observer.disconnect();
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(scratchSection);
  } else {
    armScratchAssets();
  }
}

function syncScrollVideoFrame() {
  if (!syncScrollVideoToPageScroll) return;
  if (!scrollVideoSection) return;
  const activeVideo = getActiveScrollVideo();
  if (!activeVideo) return;
  if (!Number.isFinite(activeVideo.duration) || activeVideo.duration <= 0) return;

  const rect = scrollVideoSection.getBoundingClientRect();
  const scrollRange = scrollVideoSection.offsetHeight - window.innerHeight;
  if (scrollRange <= 0) return;

  const scrolled = clamp(-rect.top, 0, scrollRange);
  const cycleDistance = Math.max(window.innerHeight * 1.2, 1);
  const loopedScrolled = scrolled % cycleDistance;
  const progress = loopedScrolled / cycleDistance;
  const targetTime = activeVideo.duration * progress;

  if (Math.abs(activeVideo.currentTime - targetTime) > 0.033) {
    activeVideo.currentTime = targetTime;
  }
}

function maintainInfiniteScrollVideoSection() {
  if (!syncScrollVideoToPageScroll) return;
  if (!scrollVideoSection) return;

  const currentScrollY = window.scrollY;
  const isScrollingDown = currentScrollY > lastScrollY + 0.5;
  if (!isScrollingDown) {
    lastScrollY = currentScrollY;
    return;
  }

  const viewportHeight = window.innerHeight;
  const cycleDistance = Math.max(viewportHeight * 1.2, 1);
  const sectionTop = scrollVideoSection.offsetTop;
  const sectionBottom = sectionTop + scrollVideoSection.offsetHeight;
  const maxSectionScrollY = sectionBottom - viewportHeight;

  if (currentScrollY < sectionTop || currentScrollY > maxSectionScrollY) {
    lastScrollY = currentScrollY;
    return;
  }

  const wrapThreshold = maxSectionScrollY - cycleDistance * 0.5;
  if (currentScrollY < wrapThreshold) {
    lastScrollY = currentScrollY;
    return;
  }

  const wrappedScrollY = currentScrollY - cycleDistance;
  const minLoopScrollY = sectionTop + cycleDistance * 0.25;
  if (wrappedScrollY < minLoopScrollY) {
    lastScrollY = currentScrollY;
    return;
  }

  lenis.scrollTo(wrappedScrollY, { immediate: true });
  lastScrollY = wrappedScrollY;
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

function primeScrollVideos() {
  if (scrollVideosPrimed) return;
  scrollVideosPrimed = true;

  for (const video of scrollVideos) {
    video
      .play()
      .then(() => {
        video.pause();
      })
      .catch(() => {
        // ignored - browser may still block without direct gesture.
      });
  }
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

window.addEventListener("pointerdown", primeScrollVideos, { once: true });
window.addEventListener("touchstart", primeScrollVideos, { once: true, passive: true });
window.addEventListener("wheel", primeScrollVideos, { once: true, passive: true });
window.addEventListener("keydown", primeScrollVideos, { once: true });

setRadioUiState();
updateNoiseUiState();
setBagUiState();
setupProductHero();
setupScratchPanel();

function raf(time) {
  lenis.raf(time);
  maintainInfiniteScrollVideoSection();
  syncScrollVideoFrame();
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);
