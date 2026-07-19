import Lenis from "lenis";
import { play } from "cuelume";
import "./styles.css";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isMobileViewport = () => window.matchMedia("(max-width: 900px)").matches;

const topNav = document.querySelector("#topNav");
const metaLeft = document.querySelector(".meta-left");
const radioBtn = document.querySelector("#radioBtn");
const noiseBtn = document.querySelector("#noiseBtn");
const radioPlayer = document.querySelector("#radioPlayer");

const scrollVideoSection = document.querySelector("#scrollVideoSection");
const scrollVideoDesktop = document.querySelector("#scrollVideo");
const scrollVideoMobile = document.querySelector("#scrollVideoMobile");
const heroPanel = document.querySelector(".panel-hero");
const heroDesktopImage = document.querySelector("#heroDesktopImage");
const heroMobileImage = document.querySelector("#heroMobileImage");
const mugSwitcher = document.querySelector("#mugSwitcher");
const mugSwitchButtons = [...document.querySelectorAll(".mug-switcher-btn")];

const contrastTargets = [...document.querySelectorAll(".contrast-target")];

const lenis = new Lenis({
  smoothWheel: true,
  wheelMultiplier: 1,
  lerp: 0.09
});

const sampleCanvas = document.createElement("canvas");
sampleCanvas.width = 8;
sampleCanvas.height = 8;
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

const radioTracks = ["/audio/track-1.mp3", "/audio/track-2.mp3", "/audio/track-3.mp3"];
let currentTrackIndex = 0;
let radioEnabled = false;

let noiseEnabled = false;
let audioContext = null;
let noiseNode = null;
let noiseGain = null;
let brownNoiseLastOut = 0;
let currentHeroSlideIndex = 0;

const scrollVideos = [scrollVideoDesktop, scrollVideoMobile].filter(Boolean);
for (const video of scrollVideos) {
  video.pause();
  video.currentTime = 0;
}

const heroSlides = mugSwitchButtons.map((button, index) => ({
  index,
  desktopSrc: button.dataset.desktopSrc ?? heroDesktopImage?.getAttribute("src") ?? "",
  mobileSrc: button.dataset.mobileSrc ?? heroMobileImage?.getAttribute("src") ?? "",
  button
}));

function getActiveScrollVideo() {
  return isMobileViewport() ? scrollVideoMobile : scrollVideoDesktop;
}

function playTrack(index) {
  radioPlayer.src = radioTracks[index];
  radioPlayer.volume = 0.39;
  return radioPlayer.play();
}

function setRadioUiState() {
  radioBtn.classList.toggle("is-active", radioEnabled);
  radioBtn.classList.toggle("is-muted", !radioEnabled);
}

function updateNoiseUiState() {
  noiseBtn.classList.toggle("is-active", noiseEnabled);
  noiseBtn.classList.toggle("is-muted", !noiseEnabled);
}

function updateHeroIndicator(index, total) {
  if (!heroPanel) return;
  const styles = getComputedStyle(heroPanel);
  const minLine = parseFloat(styles.getPropertyValue("--indicator-min-line")) || 12;
  const maxLine = parseFloat(styles.getPropertyValue("--indicator-max-line")) || 40;
  const hasMultipleSlides = total > 1;
  const progress = hasMultipleSlides ? index / (total - 1) : 0;
  const left = minLine + (maxLine - minLine) * progress;
  const right = maxLine - (maxLine - minLine) * progress;

  heroPanel.style.setProperty("--indicator-left-line", `${left}px`);
  heroPanel.style.setProperty("--indicator-right-line", `${right}px`);
}

function setImageSourceWithFallback(target, source, fallback) {
  if (!target) return;
  const nextSource = source || fallback;
  if (!nextSource) return;

  target.onerror = null;
  target.src = nextSource;

  if (source && fallback && source !== fallback) {
    target.onerror = () => {
      target.onerror = null;
      target.src = fallback;
    };
  }
}

function setHeroSlide(index) {
  if (!heroSlides.length) return;
  const boundedIndex = clamp(index, 0, heroSlides.length - 1);
  const slide = heroSlides[boundedIndex];
  const fallbackSlide = heroSlides[0];

  currentHeroSlideIndex = boundedIndex;
  setImageSourceWithFallback(heroDesktopImage, slide.desktopSrc, fallbackSlide.desktopSrc);
  setImageSourceWithFallback(heroMobileImage, slide.mobileSrc, fallbackSlide.mobileSrc);

  for (const item of heroSlides) {
    const isActive = item.index === boundedIndex;
    item.button.classList.toggle("is-active", isActive);
    item.button.setAttribute("aria-pressed", String(isActive));
  }

  updateHeroIndicator(boundedIndex, heroSlides.length);
  updateUiContrast();
}

function hydrateMugControls() {
  if (!mugSwitcher) return;

  for (const item of heroSlides) {
    const previewImage = item.button.querySelector("img");
    if (previewImage) {
      previewImage.addEventListener(
        "error",
        () => {
          item.button.classList.add("is-fallback");
          previewImage.remove();
          if (!item.button.querySelector(".mug-switcher-dot")) {
            const dot = document.createElement("span");
            dot.className = "mug-switcher-dot";
            item.button.append(dot);
          }
        },
        { once: true }
      );
    } else {
      item.button.classList.add("is-fallback");
    }

    item.button.addEventListener("click", () => {
      if (currentHeroSlideIndex === item.index) return;
      playButtonTick();
      setHeroSlide(item.index);
    });
  }

  setHeroSlide(currentHeroSlideIndex);
}

function parseObjectPosition(token) {
  const normalized = token.trim().toLowerCase();
  if (normalized === "left" || normalized === "top") return 0;
  if (normalized === "right" || normalized === "bottom") return 1;
  if (normalized === "center") return 0.5;
  if (normalized.endsWith("%")) return clamp(parseFloat(normalized) / 100, 0, 1);
  const asNumber = parseFloat(normalized);
  if (Number.isFinite(asNumber)) return clamp(asNumber, 0, 1);
  return 0.5;
}

function getObjectFitTransform(media, sourceWidth, sourceHeight) {
  const rect = media.getBoundingClientRect();
  const style = getComputedStyle(media);
  const objectPosition = style.objectPosition.split(/\s+/);
  const positionX = parseObjectPosition(objectPosition[0] ?? "50%");
  const positionY = parseObjectPosition(objectPosition[1] ?? objectPosition[0] ?? "50%");

  const containerRatio = rect.width / rect.height;
  const sourceRatio = sourceWidth / sourceHeight;
  let renderWidth = rect.width;
  let renderHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (sourceRatio > containerRatio) {
    renderHeight = rect.height;
    renderWidth = rect.height * sourceRatio;
    offsetX = (rect.width - renderWidth) * positionX;
  } else {
    renderWidth = rect.width;
    renderHeight = rect.width / sourceRatio;
    offsetY = (rect.height - renderHeight) * positionY;
  }

  return {
    rect,
    renderWidth,
    renderHeight,
    offsetX,
    offsetY
  };
}

function sampleLuminanceFromMedia(media, viewportX, viewportY) {
  const isVideo = media.tagName === "VIDEO";
  const sourceWidth = isVideo ? media.videoWidth : media.naturalWidth;
  const sourceHeight = isVideo ? media.videoHeight : media.naturalHeight;

  if (!sourceWidth || !sourceHeight) return null;

  const fit = getObjectFitTransform(media, sourceWidth, sourceHeight);
  const localX = viewportX - fit.rect.left - fit.offsetX;
  const localY = viewportY - fit.rect.top - fit.offsetY;
  const sourceX = clamp((localX / fit.renderWidth) * sourceWidth, 0, sourceWidth - 1);
  const sourceY = clamp((localY / fit.renderHeight) * sourceHeight, 0, sourceHeight - 1);

  const sampleSize = 6;
  const sx = clamp(sourceX - sampleSize / 2, 0, sourceWidth - sampleSize);
  const sy = clamp(sourceY - sampleSize / 2, 0, sourceHeight - sampleSize);

  sampleCtx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);
  sampleCtx.drawImage(media, sx, sy, sampleSize, sampleSize, 0, 0, 8, 8);
  const imageData = sampleCtx.getImageData(0, 0, 8, 8).data;

  let totalLuma = 0;
  let pixels = 0;
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i] / 255;
    const g = imageData[i + 1] / 255;
    const b = imageData[i + 2] / 255;
    totalLuma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    pixels += 1;
  }

  return pixels ? totalLuma / pixels : null;
}

function hexToLuminance(hexColor) {
  const hex = hexColor.replace("#", "").trim();
  if (hex.length !== 6) return 1;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function setUiColorByLuminance(luma) {
  const contrastWithWhite = 1.05 / (luma + 0.05);
  const contrastWithBlack = (luma + 0.05) / 0.05;
  const shouldUseWhite = contrastWithWhite > contrastWithBlack;

  document.body.classList.toggle("ui-light", shouldUseWhite);
  document.body.classList.toggle("ui-dark", !shouldUseWhite);
}

function getVisibleMediaInTarget(target) {
  const candidates = [...target.querySelectorAll(".panel-media, .panel-video")];
  return candidates.find((element) => getComputedStyle(element).display !== "none") ?? null;
}

function getActiveContrastTarget() {
  const probeY = 28;
  const probeX = window.innerWidth * 0.85;

  let active = contrastTargets.find((target) => {
    const rect = target.getBoundingClientRect();
    return rect.top <= probeY && rect.bottom >= probeY;
  });

  if (!active) {
    active = contrastTargets.reduce((closest, candidate) => {
      const rect = candidate.getBoundingClientRect();
      const distance = Math.abs(rect.top - probeY);
      if (!closest || distance < closest.distance) {
        return { node: candidate, distance };
      }
      return closest;
    }, null)?.node;
  }

  if (!active) return null;

  return {
    node: active,
    probeX,
    probeY
  };
}

function updateUiContrast() {
  const active = getActiveContrastTarget();
  if (!active) return;

  const type = active.node.dataset.contrastType;
  if (type === "color") {
    setUiColorByLuminance(hexToLuminance(active.node.dataset.contrastColor ?? "#ffffff"));
    return;
  }

  if (type === "media" || type === "video") {
    const media = getVisibleMediaInTarget(active.node);
    if (!media) return;
    const luma = sampleLuminanceFromMedia(media, active.probeX, active.probeY);
    if (luma !== null) setUiColorByLuminance(luma);
  }
}

function syncScrollVideoFrame() {
  const activeVideo = getActiveScrollVideo();
  if (!activeVideo || !activeVideo.duration) return;

  const rect = scrollVideoSection.getBoundingClientRect();
  const scrollRange = scrollVideoSection.offsetHeight - window.innerHeight;
  if (scrollRange <= 0) return;

  const scrolled = clamp(-rect.top, 0, scrollRange);
  const progress = scrolled / scrollRange;
  const targetTime = activeVideo.duration * progress;

  if (Math.abs(activeVideo.currentTime - targetTime) > 0.033) {
    activeVideo.currentTime = targetTime;
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

function unlockVideoSeeking() {
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

radioBtn.addEventListener("click", async () => {
  playButtonTick();
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
});

noiseBtn.addEventListener("click", () => {
  playButtonTick();
  if (!noiseEnabled) {
    enableBrownNoise();
  } else {
    disableBrownNoise();
  }
});

window.addEventListener("pointerdown", unlockVideoSeeking, { once: true });
window.addEventListener("resize", updateUiContrast);

document.body.classList.add("ui-dark");
setRadioUiState();
updateNoiseUiState();
hydrateMugControls();

function raf(time) {
  lenis.raf(time);
  syncScrollVideoFrame();
  updateUiContrast();
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);

// Keep fixed controls color in sync with nav color.
const styleObserver = new MutationObserver(() => {
  const isLight = document.body.classList.contains("ui-light");
  topNav.classList.toggle("is-light", isLight);
  topNav.classList.toggle("is-dark", !isLight);
  metaLeft.classList.toggle("is-light", isLight);
  metaLeft.classList.toggle("is-dark", !isLight);
});

styleObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ["class"]
});
