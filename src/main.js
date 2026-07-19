import Lenis from "lenis";
import { play } from "cuelume";
import "./styles.css";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isMobileViewport = () => window.matchMedia("(max-width: 900px)").matches;
const baseUrl = import.meta.env.BASE_URL ?? "/";
const sectionVideoSource = new URL("../assets/veo-3.mp4", import.meta.url).href;
const syncScrollVideoToPageScroll = true;

function resolvePublicAssetPath(path) {
  if (!path) return "";
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  if (!path.startsWith("/")) return path;
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}${path}`;
}

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
const priceCheckIconSource = resolvePublicAssetPath("/media/price-check-white.png");

const scrollVideoSection = document.querySelector("#scrollVideoSection");
const sectionVideoDesktop = document.querySelector("#sectionVideo");
const sectionVideoMobile = document.querySelector("#sectionVideoMobile");
const scrollVideoDesktop = document.querySelector("#scrollVideo");
const scrollVideoMobile = document.querySelector("#scrollVideoMobile");
const heroPanel = document.querySelector(".panel-hero");
const heroDesktopImage = document.querySelector("#heroDesktopImage");
const heroMobileImage = document.querySelector("#heroMobileImage");
const mugSwitcher = document.querySelector("#mugSwitcher");
const mugSwitchButtons = [...document.querySelectorAll(".mug-switcher-btn")];

const lenis = new Lenis({
  smoothWheel: true,
  wheelMultiplier: 1,
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
let currentHeroSlideIndex = 0;
let scrollVideosPrimed = false;
let heroCursorEnabled = false;
let heroCursorVisible = false;
let heroCursorDirection = "next";
let heroCursor = null;
const heroCursorArrowSource = resolvePublicAssetPath("/media/hero-cursor-custom.png");

const sectionVideos = [sectionVideoDesktop, sectionVideoMobile].filter(Boolean);
const scrollVideos = [scrollVideoDesktop, scrollVideoMobile].filter(Boolean);

function prepareSectionVideos() {
  for (const video of sectionVideos) {
    video.setAttribute("src", sectionVideoSource);
    video.preload = "auto";
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.load();
    video.play().catch(() => {
      // ignored - some browsers may still require a gesture.
    });
  }
}

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

prepareSectionVideos();
prepareScrollVideos();

const heroSlides = mugSwitchButtons.map((button, index) => ({
  index,
  desktopSrc: resolvePublicAssetPath(
    button.dataset.desktopSrc ?? heroDesktopImage?.getAttribute("src") ?? ""
  ),
  mobileSrc: resolvePublicAssetPath(
    button.dataset.mobileSrc ?? heroMobileImage?.getAttribute("src") ?? ""
  ),
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
}

function getWrappedHeroSlideIndex(index) {
  if (!heroSlides.length) return 0;
  return ((index % heroSlides.length) + heroSlides.length) % heroSlides.length;
}

function getHeroCursorModeEnabled() {
  const supportsFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  return Boolean(heroPanel) && heroSlides.length > 1 && !isMobileViewport() && supportsFinePointer;
}

function setHeroCursorDirection(direction) {
  if (!heroCursor) return;
  heroCursorDirection = direction;
  heroCursor.dataset.direction = direction;
}

function setHeroCursorVisibility(visible) {
  if (!heroPanel || !heroCursor) return;
  heroCursorVisible = visible;
  heroPanel.classList.toggle("has-hero-cursor", visible && heroCursorEnabled);
}

function updateHeroCursorPosition(clientX, clientY) {
  if (!heroPanel || !heroCursor) return;
  const rect = heroPanel.getBoundingClientRect();
  const relativeX = clamp(clientX - rect.left, 0, rect.width);
  const relativeY = clamp(clientY - rect.top, 0, rect.height);

  heroCursor.style.setProperty("--cursor-x", `${relativeX}px`);
  heroCursor.style.setProperty("--cursor-y", `${relativeY}px`);

  const nextDirection = relativeX < rect.width / 2 ? "prev" : "next";
  if (nextDirection !== heroCursorDirection) {
    setHeroCursorDirection(nextDirection);
  }
}

function updateHeroCursorDefaultPosition() {
  if (!heroPanel || !heroCursor) return;
  const rect = heroPanel.getBoundingClientRect();
  const startX = rect.width * 0.78;
  const startY = rect.height * 0.5;
  heroCursor.style.setProperty("--cursor-x", `${startX}px`);
  heroCursor.style.setProperty("--cursor-y", `${startY}px`);
}

function handleHeroPointerEnter(event) {
  if (!heroCursorEnabled) return;
  updateHeroCursorPosition(event.clientX, event.clientY);
  setHeroCursorVisibility(true);
}

function handleHeroPointerMove(event) {
  if (!heroCursorEnabled) return;
  updateHeroCursorPosition(event.clientX, event.clientY);
  if (!heroCursorVisible) {
    setHeroCursorVisibility(true);
  }
}

function handleHeroPointerLeave() {
  if (!heroCursorEnabled) return;
  setHeroCursorVisibility(false);
}

function handleHeroPanelClick(event) {
  if (!heroCursorEnabled || !heroSlides.length) return;

  const rect = heroPanel.getBoundingClientRect();
  const relativeX = clamp(event.clientX - rect.left, 0, rect.width);
  const direction = relativeX < rect.width / 2 ? "prev" : "next";
  const offset = direction === "prev" ? -1 : 1;
  const targetSlide = getWrappedHeroSlideIndex(currentHeroSlideIndex + offset);

  if (targetSlide === currentHeroSlideIndex) return;

  playButtonTick();
  setHeroSlide(targetSlide);
}

function setHeroCursorMode() {
  if (!heroPanel) return;
  const shouldEnable = getHeroCursorModeEnabled();
  heroCursorEnabled = shouldEnable;
  heroPanel.classList.toggle("is-hero-cursor-enabled", shouldEnable);

  if (!shouldEnable) {
    setHeroCursorVisibility(false);
    return;
  }

  setHeroCursorDirection("next");
  updateHeroCursorDefaultPosition();
}

function setupHeroCursor() {
  if (!heroPanel || heroCursor) return;

  heroCursor = document.createElement("span");
  heroCursor.className = "hero-cursor";
  heroCursor.setAttribute("aria-hidden", "true");

  const heroCursorImage = document.createElement("img");
  heroCursorImage.alt = "";

  if (heroCursorArrowSource) {
    heroCursorImage.addEventListener(
      "error",
      () => {
        heroCursorImage.remove();
        heroCursor?.classList.add("is-fallback");
      },
      { once: true }
    );
    heroCursorImage.src = heroCursorArrowSource;
    heroCursor.append(heroCursorImage);
  } else {
    heroCursor.classList.add("is-fallback");
  }

  heroPanel.append(heroCursor);

  heroPanel.addEventListener("pointerenter", handleHeroPointerEnter);
  heroPanel.addEventListener("pointermove", handleHeroPointerMove);
  heroPanel.addEventListener("pointerleave", handleHeroPointerLeave);
  heroPanel.addEventListener("click", handleHeroPanelClick);
  window.addEventListener("resize", setHeroCursorMode);
  window.addEventListener("orientationchange", setHeroCursorMode);

  setHeroCursorMode();
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
  setupHeroCursor();
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

  for (const video of sectionVideos) {
    video.play().catch(() => {
      // ignored - browser may still block without direct gesture.
    });
  }

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
hydrateMugControls();

function raf(time) {
  lenis.raf(time);
  maintainInfiniteScrollVideoSection();
  syncScrollVideoFrame();
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);
