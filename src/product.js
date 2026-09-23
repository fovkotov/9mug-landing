import { play } from "cuelume";
import { ensureDeviceOrientationOnEntry } from "./device-orientation-permission.js";
import "./product.css";
import "./components/ProductViewer.css";
import { HERO_INTERACTION_MODE } from "./hero/hero-mode.js";
import { setupLegacySlidesHero } from "./hero/legacy-slides-hero.js";
import {
  createMugFrameImages,
  createProductViewer,
  preloadMugFrameImages
} from "./components/ProductViewer.js";
import { setupScratchRevealVideo } from "./scratch-reveal-video.js";
import { createScratchLabelLayer } from "./scratch-label.js";
import { goToCheckout, isInCart, subscribeCart, toggleItem } from "./cart.js";
import { trackListeners } from "./route-signal.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isMobileViewport = () => window.matchMedia("(max-width: 900px)").matches;
const baseUrl = import.meta.env.BASE_URL ?? "/";

function resolvePublicAssetPath(path) {
  if (!path) return "";
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  if (!path.startsWith("/")) return path;
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}${path}`;
}

const MUG_CENTER_KEY = "c26";
const CART_PRODUCT_ID = "mug";
const MUG_GRID = { cols: 10, rows: 5 };

const mugFrameImagesDesktop = createMugFrameImages(
  resolvePublicAssetPath,
  "/media/mug_frames",
  MUG_GRID
);
const mugFrameImagesMobile = createMugFrameImages(
  resolvePublicAssetPath,
  "/media/mug_frames_mobile",
  MUG_GRID
);
const mugFrameImagesBlackDesktop = createMugFrameImages(
  resolvePublicAssetPath,
  "/media/mug_frames_black",
  MUG_GRID
);
const mugFrameImagesBlackMobile = createMugFrameImages(
  resolvePublicAssetPath,
  "/media/mug_frames_black_mobile",
  MUG_GRID
);

let mugColor = "white";

function currentMugFrameImages() {
  if (mugColor === "black") {
    return isMobileViewport() ? mugFrameImagesBlackMobile : mugFrameImagesBlackDesktop;
  }
  return isMobileViewport() ? mugFrameImagesMobile : mugFrameImagesDesktop;
}

function currentOffColorMugFrameImages() {
  if (mugColor === "black") {
    return isMobileViewport() ? mugFrameImagesMobile : mugFrameImagesDesktop;
  }
  return isMobileViewport() ? mugFrameImagesBlackMobile : mugFrameImagesBlackDesktop;
}
const mugHeroLoaderSrc = resolvePublicAssetPath("/media/mug-loader-mark.png");
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

let mugFramesWarmup = null;
let addToCartBtn = null;
let bagStatusText = null;
let scrollVideoSection = null;
let scrollVideo = null;
let heroPanel = null;
let productViewerRoot = null;
let legacyHeroRoot = null;
let heroDesktopImage = null;
let heroMobileImage = null;
let heroDragSlider = null;
let metaSwitcher = null;
let metaSwitchFirst = null;
let metaSwitchSecond = null;
let colorBarLabel = null;
let mugSwitchButtons = [];
let scrollVideoPrimed = false;
let scratchSection = null;
let scratchCanvas = null;
let scratchReveal = null;
let scratchVideoApi = { prime() {}, destroy() {} };
let pageRoot = document;

function syncColorSwapImages() {
  pageRoot.querySelectorAll("[data-src-white][data-src-black]").forEach((img) => {
    const raw = img.getAttribute(mugColor === "black" ? "data-src-black" : "data-src-white");
    const next = resolvePublicAssetPath(raw ?? "");
    if (next && img.getAttribute("src") !== next) img.setAttribute("src", next);
  });
}

function prepareScratchUnderlay() {
  const underlay = pageRoot.querySelector("#scratchUnderlay");
  if (!underlay) return;

  const rawSrc = underlay.getAttribute("src") ?? "";
  const resolvedSrc = resolvePublicAssetPath(rawSrc);
  if (resolvedSrc && underlay.getAttribute("src") !== resolvedSrc) {
    underlay.setAttribute("src", resolvedSrc);
  }
}

function prepareScrollVideo() {
  if (!scrollVideo) return;

  const rawSrc = scrollVideo.getAttribute("src") ?? "";
  const resolvedSrc = resolvePublicAssetPath(rawSrc);
  if (resolvedSrc && scrollVideo.getAttribute("src") !== resolvedSrc) {
    scrollVideo.setAttribute("src", resolvedSrc);
  }

  scrollVideo.preload = "auto";
  scrollVideo.muted = true;
  scrollVideo.playsInline = true;
  scrollVideo.loop = false;
  scrollVideo.load();
  scrollVideo.pause();
  scrollVideo.currentTime = 0;
  scrollVideo.addEventListener("loadedmetadata", syncScrollVideoFrame);
}

function setBagUiState() {
  const bagSelected = isInCart(CART_PRODUCT_ID);
  if (bagStatusText) {
    bagStatusText.classList.toggle("is-visible", bagSelected);
  }
  if (addToCartBtn) {
    addToCartBtn.classList.toggle("is-added", bagSelected);
    if (bagSelected) {
      addToCartBtn.removeAttribute("aria-pressed");
      addToCartBtn.setAttribute("aria-label", "Checkout, $300");
    } else {
      addToCartBtn.setAttribute("aria-pressed", "false");
      addToCartBtn.setAttribute("aria-label", "Add to cart, $300");
    }
  }
  const cartBarUi = pageRoot.querySelector(".cart-bar-ui");
  cartBarUi?.classList.toggle("is-added", bagSelected);
  const label = pageRoot.querySelector(".cart-label");
  if (label) {
    label.textContent = bagSelected ? "Checkout" : "Add to cart";
  }
}

function setupDirectionalProductHero() {
  if (!heroPanel || !productViewerRoot) return;

  if (legacyHeroRoot) legacyHeroRoot.hidden = true;
  productViewerRoot.hidden = false;
  heroPanel.dataset.heroMode = "directional";
  heroPanel.classList.add("is-directional-hero");

  const viewer = createProductViewer(productViewerRoot, {
    images: currentMugFrameImages(),
    transitionDuration: 0,
    // 10×5 look-around: H ±202.5° step 45°, V ±20° step 10°.
    deadZoneHalfWidth: 0.14,
    deadZoneHalfHeight: 0.19,
    sideFarBoundary: 0.7,
    horizontalSensitivity: 1.05,
    verticalSensitivity: 0.95,
    // Gyro-only: ~0.7 needs more |gamma| (~29°) before outer columns.
    orientationHorizontalSensitivity: 0.7,
    maxGamma: 20,
    maxBeta: 16,
    gridCols: 10,
    gridRows: 5,
    centerKey: MUG_CENTER_KEY,
    // Invert look-up / look-down: top row ↔ underside, center stays.
    flipVerticalFrames: true,
    showZones: false,
    waitForAllFrames: true,
    loaderSrc: mugHeroLoaderSrc
  });

  // Ensure the page-entry warmup stays referenced / in flight.
  void mugFramesWarmup;
  return viewer;
}

function setupProductHero() {
  const useLegacy = HERO_INTERACTION_MODE === "legacy-slides";

  if (useLegacy) {
    if (productViewerRoot) productViewerRoot.hidden = true;
    if (legacyHeroRoot) legacyHeroRoot.hidden = false;
    heroPanel?.classList.remove("is-directional-hero");
    if (heroPanel) heroPanel.dataset.heroMode = "legacy-slides";

    return setupLegacySlidesHero({
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
  }

  return setupDirectionalProductHero();
}

function setupScratchPanel() {
  if (!scratchSection || !scratchCanvas) return;

  const ctx = scratchCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const labelLayer = createScratchLabelLayer(scratchSection, scratchCanvas, ctx);
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
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    ctx.drawImage(coverImage, 0, 0, scratchCanvas.width, scratchCanvas.height);
    labelLayer.clearMask();
    labelLayer.paintLabel();
    lastPoint = null;
  }

  function redrawCoverPreservingMask() {
    if (!coverReady || scratchCanvas.width <= 0 || scratchCanvas.height <= 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    ctx.drawImage(coverImage, 0, 0, scratchCanvas.width, scratchCanvas.height);
    labelLayer.paintLabel();
    labelLayer.applyMask();
  }

  labelLayer.setOnChange(redrawCoverPreservingMask);

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
    const from = lastPoint;
    labelLayer.punch((target) => {
      if (from) {
        // Sweep a vertical blade strip between positions so motion stays a line, not a dot trail.
        target.beginPath();
        target.moveTo(from.x, from.y);
        target.lineTo(point.x, point.y);
        target.lineTo(point.x + bladeWidth, point.y);
        target.lineTo(point.x + bladeWidth, point.y + bladeHeight);
        target.lineTo(from.x + bladeWidth, from.y + bladeHeight);
        target.lineTo(from.x, from.y + bladeHeight);
        target.closePath();
        target.fill();
      } else {
        target.fillRect(point.x, point.y, bladeWidth, bladeHeight);
      }
    });
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

  let scratchObserver = null;
  if ("IntersectionObserver" in window) {
    scratchObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        armScratchAssets();
        scratchObserver?.disconnect();
      },
      { rootMargin: "240px 0px" }
    );
    scratchObserver.observe(scratchSection);
  } else {
    armScratchAssets();
  }

  return () => {
    cancelAnimationFrame(resizeFrame);
    scratchObserver?.disconnect();
    labelLayer.destroy();
    scratchCursor?.remove();
    coverImage.onload = null;
    coverImage.onerror = null;
    coverImage.src = "";
    ctx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    scratchCanvas.width = 0;
    scratchCanvas.height = 0;
  };
}

function syncScrollVideoFrame() {
  if (!scrollVideoSection || !scrollVideo) return;
  if (!Number.isFinite(scrollVideo.duration) || scrollVideo.duration <= 0) return;

  const rect = scrollVideoSection.getBoundingClientRect();
  const scrollRange = scrollVideoSection.offsetHeight - window.innerHeight;
  if (scrollRange <= 0) return;

  const scrolled = clamp(-rect.top, 0, scrollRange);
  const progress = scrolled / scrollRange;
  const targetTime = scrollVideo.duration * progress;

  if (Math.abs(scrollVideo.currentTime - targetTime) > 0.033) {
    scrollVideo.currentTime = targetTime;
  }
}

function primeScrollVideo() {
  scratchVideoApi.prime();
  if (scrollVideoPrimed || !scrollVideo) return;
  scrollVideoPrimed = true;

  scrollVideo
    .play()
    .then(() => {
      scrollVideo.pause();
      syncScrollVideoFrame();
    })
    .catch(() => {
      // ignored - browser may still block without direct gesture.
    });
}

function playButtonTick() {
  play("tick");
}

function syncColorSwitcherUi() {
  const isBlack = mugColor === "black";
  if (colorBarLabel) {
    colorBarLabel.textContent = isBlack ? "Black" : "White";
    colorBarLabel.setAttribute("aria-label", isBlack ? "Toggle color to White" : "Toggle color to Black");
  }
  metaSwitchFirst?.classList.toggle("is-active", !isBlack);
  metaSwitchFirst?.setAttribute("aria-pressed", isBlack ? "false" : "true");
  metaSwitchSecond?.classList.toggle("is-active", isBlack);
  metaSwitchSecond?.setAttribute("aria-pressed", isBlack ? "true" : "false");
}

function toggleBagState() {
  playButtonTick();
  if (isInCart(CART_PRODUCT_ID)) {
    goToCheckout();
    return;
  }
  toggleItem(CART_PRODUCT_ID);
}

export function init(root) {
  pageRoot = root || document;
  ensureDeviceOrientationOnEntry();

  const ac = new AbortController();
  addToCartBtn = root.querySelector("#addToCart");
  bagStatusText = document.querySelector("#bagStatusText");
  scrollVideoSection = root.querySelector("#scrollVideoSection");
  scrollVideo = root.querySelector("#scrollVideo");
  heroPanel = root.querySelector(".panel-hero");
  productViewerRoot = root.querySelector("#productViewerRoot");
  legacyHeroRoot = root.querySelector("#legacyHeroRoot");
  heroDesktopImage = root.querySelector("#heroDesktopImage");
  heroMobileImage = root.querySelector("#heroMobileImage");
  heroDragSlider = root.querySelector("#heroDragSlider");
  metaSwitcher = root.querySelector("#metaSwitcher");
  metaSwitchFirst = root.querySelector("#metaSwitchFirst");
  metaSwitchSecond = root.querySelector("#metaSwitchSecond");
  colorBarLabel = root.querySelector("#colorBarLabel") || root.querySelector(".color-bar-label");
  mugSwitchButtons = [...root.querySelectorAll(".mug-switcher-btn")];
  mugColor = "white";
  syncColorSwitcherUi();
  syncColorSwapImages();
  scratchSection = root.querySelector("#scratchSection");
  scratchCanvas = root.querySelector("#scratchCanvas");
  scratchReveal = root.querySelector("#scratchReveal");
  prepareScratchUnderlay();
  scrollVideoPrimed = false;

  mugFramesWarmup = preloadMugFrameImages(currentMugFrameImages(), { signal: ac.signal });
  void mugFramesWarmup.then(() => {
    if (ac.signal.aborted) return;
    void preloadMugFrameImages(currentOffColorMugFrameImages(), { signal: ac.signal });
  });
  scratchVideoApi = setupScratchRevealVideo(scratchReveal, resolvePublicAssetPath);

  let hero = null;
  let scratchCleanup = () => {};
  let unsubscribe = () => {};
  let rafId = 0;
  let heroIsMobile = isMobileViewport();

  trackListeners(ac.signal, () => {
    prepareScrollVideo();
    hero = setupProductHero();
    scratchCleanup = setupScratchPanel() || (() => {});
    setBagUiState();
    unsubscribe = subscribeCart(setBagUiState);
    addToCartBtn?.addEventListener("click", () => {
      toggleBagState();
    });
    window.addEventListener("pointerdown", primeScrollVideo, { once: true });
    window.addEventListener("touchstart", primeScrollVideo, { once: true, passive: true });
    window.addEventListener("wheel", primeScrollVideo, { once: true, passive: true });
    window.addEventListener("keydown", primeScrollVideo, { once: true });

    const remountHero = () => {
      hero?.destroy?.();
      if (productViewerRoot) productViewerRoot.replaceChildren();
      mugFramesWarmup = preloadMugFrameImages(currentMugFrameImages(), { signal: ac.signal });
      hero = setupProductHero();
    };

    const swapHeroFramesIfNeeded = () => {
      const nextMobile = isMobileViewport();
      if (nextMobile === heroIsMobile) return;
      heroIsMobile = nextMobile;
      remountHero();
    };
    window.addEventListener("resize", swapHeroFramesIfNeeded);
    window.addEventListener("orientationchange", swapHeroFramesIfNeeded);

    const setMugColor = (next) => {
      if (next !== "white" && next !== "black") return;
      if (next === mugColor) return;
      mugColor = next;
      syncColorSwitcherUi();
      syncColorSwapImages();
      playButtonTick();
      remountHero();
    };
    metaSwitchFirst?.addEventListener("click", () => setMugColor("white"));
    metaSwitchSecond?.addEventListener("click", () => setMugColor("black"));
    colorBarLabel?.addEventListener("click", () => {
      setMugColor(mugColor === "black" ? "white" : "black");
    });

    const tick = () => {
      syncScrollVideoFrame();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });

  return () => {
    cancelAnimationFrame(rafId);
    unsubscribe();
    hero?.destroy?.();
    scratchCleanup();
    scratchVideoApi.destroy();
    if (scrollVideo) {
      scrollVideo.pause();
      scrollVideo.removeAttribute("src");
      scrollVideo.load();
    }
    ac.abort();
  };
}
