import Lenis from "lenis";
import { play } from "cuelume";
import { ensureDeviceOrientationOnEntry } from "./device-orientation-permission.js";
import "./mat.css";
import "./components/ProductViewer.css";
import {
  createMugFrameImages,
  createProductViewer,
  preloadMugFrameImages
} from "./components/ProductViewer.js";

// Silent motion-permission check as soon as the mat page opens.
ensureDeviceOrientationOnEntry();

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

const matFrameImages = createMugFrameImages(resolvePublicAssetPath, "/media/mat_frames", {
  extension: "webp"
});
const matFramesWarmup = preloadMugFrameImages(matFrameImages);

const radioBtn = document.querySelector("#radioBtn");
const radioIcon = document.querySelector("#radioIcon");
const noiseBtn = document.querySelector("#noiseBtn");
const radioPlayer = document.querySelector("#radioPlayer");
const radioPlayIconSource = resolvePublicAssetPath("/media/radio-icon-play.png");
const radioPauseIconSource = resolvePublicAssetPath("/media/radio-icon-pause.png");
const addToCartBtn = document.querySelector("#addToCart");
const bagStatusText = document.querySelector("#bagStatusText");
const heroPanel = document.querySelector(".panel-hero");
const productViewerRoot = document.querySelector("#productViewerRoot");

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

const cutMatSection = document.querySelector("#cutMatSection");
const cutMatStage = document.querySelector("#cutMatStage");
const cutCursorSource = resolvePublicAssetPath("/media/mat/cut-cursor.png");

function playButtonTick() {
  play("tick");
}

function setupDirectionalMatHero() {
  if (!heroPanel || !productViewerRoot) return;

  productViewerRoot.hidden = false;
  heroPanel.dataset.heroMode = "directional";
  heroPanel.classList.add("is-directional-hero");

  createProductViewer(productViewerRoot, {
    images: matFrameImages,
    transitionDuration: 0,
    deadZoneHalfWidth: 0.28,
    deadZoneHalfHeight: 0.19,
    sideFarBoundary: 0.7,
    horizontalSensitivity: 1.05,
    verticalSensitivity: 0.95,
    maxGamma: 20,
    maxBeta: 16,
    // Mat grid is authored top→bottom; swap the mug-style vertical flip.
    flipVerticalFrames: false,
    showZones: false
  });

  void matFramesWarmup;
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
  if (bagStatusText) {
    bagStatusText.classList.toggle("is-visible", bagSelected);
  }
  if (addToCartBtn) {
    addToCartBtn.classList.toggle("is-added", bagSelected);
    addToCartBtn.setAttribute("aria-pressed", String(bagSelected));
    addToCartBtn.setAttribute(
      "aria-label",
      bagSelected ? "In cart, $300" : "Add to cart, $300"
    );
  }
  const cartBarUi = document.querySelector(".cart-bar-ui");
  cartBarUi?.classList.toggle("is-added", bagSelected);
  const label = document.querySelector(".cart-label");
  if (label) {
    label.textContent = bagSelected ? "In cart" : "Add to cart";
  }
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

function drawCutObject(canvas, id) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (id === "scrap-eye") {
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.moveTo(18, 28);
    ctx.lineTo(w - 22, 18);
    ctx.lineTo(w - 14, h - 24);
    ctx.lineTo(26, h - 16);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#ebe6e2";
    ctx.beginPath();
    ctx.ellipse(w * 0.48, h * 0.5, w * 0.28, h * 0.26, -0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.5, Math.min(w, h) * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f2efec";
    ctx.beginPath();
    ctx.arc(w * 0.54, h * 0.44, Math.min(w, h) * 0.04, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (id === "scrap-tape") {
    ctx.save();
    ctx.translate(0, h * 0.15);
    ctx.fillStyle = "rgba(20, 20, 20, 0.88)";
    ctx.fillRect(8, 8, w - 16, h * 0.55);
    ctx.fillStyle = "rgba(236, 230, 224, 0.92)";
    for (let i = 0; i < 7; i += 1) {
      const x = 22 + i * ((w - 44) / 6);
      ctx.fillRect(x, 18, 3, h * 0.35);
    }
    ctx.restore();
    return;
  }

  // scrap-blade: slender craft-knife silhouette
  ctx.fillStyle = "#161616";
  ctx.beginPath();
  ctx.moveTo(w * 0.42, 8);
  ctx.lineTo(w * 0.62, 8);
  ctx.lineTo(w * 0.7, h * 0.42);
  ctx.lineTo(w * 0.58, h * 0.96);
  ctx.lineTo(w * 0.38, h * 0.96);
  ctx.lineTo(w * 0.3, h * 0.42);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ece8e4";
  ctx.beginPath();
  ctx.moveTo(w * 0.48, 14);
  ctx.lineTo(w * 0.56, 14);
  ctx.lineTo(w * 0.52, h * 0.38);
  ctx.closePath();
  ctx.fill();
}

function severCutObject(canvas) {
  if (!cutMatStage || canvas.classList.contains("is-severed")) return;

  const stageRect = cutMatStage.getBoundingClientRect();
  const rect = canvas.getBoundingClientRect();
  const left = rect.left - stageRect.left;
  const top = rect.top - stageRect.top;
  const width = rect.width;
  const height = rect.height;
  const transform = canvas.style.transform || "";

  const snapshot = canvas.toDataURL("image/png");

  const makeHalf = (side) => {
    const half = document.createElement("div");
    half.className = `cut-object-half is-${side}`;
    half.style.left = `${left}px`;
    half.style.top = `${top}px`;
    half.style.width = `${width}px`;
    half.style.height = `${height}px`;
    half.style.transform = transform;

    const img = document.createElement("img");
    img.src = snapshot;
    img.alt = "";
    img.draggable = false;
    img.style.clipPath =
      side === "left" ? "inset(0 50% 0 0)" : "inset(0 0 0 50%)";
    half.append(img);
    return half;
  };

  const leftHalf = makeHalf("left");
  const rightHalf = makeHalf("right");
  cutMatStage.append(leftHalf, rightHalf);

  canvas.classList.add("is-severed");

  requestAnimationFrame(() => {
    leftHalf.classList.add("is-left");
    rightHalf.classList.add("is-right");
  });

  window.setTimeout(() => {
    leftHalf.remove();
    rightHalf.remove();
  }, 900);
}

function setupCutMatPanel() {
  if (!cutMatSection || !cutMatStage) return;

  const objects = [...cutMatStage.querySelectorAll(".cut-object")];
  objects.forEach((canvas) => {
    drawCutObject(canvas, canvas.dataset.cutId || "");
  });

  const cutProgress = new Map(
    objects.map((canvas) => [canvas, { columns: new Set(), severed: false }])
  );

  let cutCursor = null;
  let isPointerInside = false;
  let lastPoint = null;

  const supportsFinePointer = () =>
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  function getBladeSize() {
    const cursorHeight = isMobileViewport() ? 144 : 176;
    const cursorWidth = cursorHeight * (134 / 352);
    return {
      width: Math.max(2, cursorWidth * 0.034),
      height: cursorHeight * 0.93
    };
  }

  function setupCutCursor() {
    if (cutCursor || !supportsFinePointer()) return;
    cutCursor = document.createElement("span");
    cutCursor.className = "cut-mat-cursor";
    cutCursor.setAttribute("aria-hidden", "true");
    const img = document.createElement("img");
    img.alt = "";
    img.src = cutCursorSource;
    img.draggable = false;
    cutCursor.append(img);
    cutMatSection.append(cutCursor);
  }

  function setCutCursorVisibility(visible) {
    if (!cutCursor) return;
    cutMatSection.classList.toggle("has-cut-cursor", visible);
  }

  function updateCutCursorPosition(clientX, clientY) {
    if (!cutCursor) return;
    const rect = cutMatSection.getBoundingClientRect();
    cutCursor.style.setProperty("--cursor-x", `${clamp(clientX - rect.left, 0, rect.width)}px`);
    cutCursor.style.setProperty("--cursor-y", `${clamp(clientY - rect.top, 0, rect.height)}px`);
  }

  function getSectionPoint(clientX, clientY) {
    const rect = cutMatSection.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      clientX,
      clientY
    };
  }

  function cutObjectAt(canvas, clientX, clientY, blade) {
    const state = cutProgress.get(canvas);
    if (!state || state.severed) return;

    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < -blade.width || localX > rect.width + blade.width) return;
    if (localY < -blade.height || localY > rect.height + blade.height) return;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const x = localX * scaleX;
    const y = localY * scaleY;
    const w = blade.width * scaleX;
    const h = blade.height * scaleY;

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, Math.max(2, w), h);
    ctx.restore();

    const col = clamp(Math.floor((localX / rect.width) * 12), 0, 11);
    state.columns.add(col);

    if (state.columns.size >= 7) {
      state.severed = true;
      severCutObject(canvas);
      playButtonTick();
    }
  }

  function cutAt(point) {
    if (!point) return;
    const blade = getBladeSize();

    objects.forEach((canvas) => {
      cutObjectAt(canvas, point.clientX, point.clientY, blade);
    });

    lastPoint = point;
  }

  function isOverSticker(event) {
    return Boolean(event.target?.closest?.(".mat-sticker-host"));
  }

  function handlePointerEnter(event) {
    if (isOverSticker(event)) {
      setCutCursorVisibility(false);
      return;
    }
    isPointerInside = true;
    setupCutCursor();
    updateCutCursorPosition(event.clientX, event.clientY);
    setCutCursorVisibility(Boolean(cutCursor));
    lastPoint = getSectionPoint(event.clientX, event.clientY);
    cutAt(lastPoint);
  }

  function handlePointerMove(event) {
    if (isOverSticker(event)) {
      isPointerInside = false;
      lastPoint = null;
      setCutCursorVisibility(false);
      return;
    }

    isPointerInside = true;
    setupCutCursor();
    updateCutCursorPosition(event.clientX, event.clientY);
    if (!cutMatSection.classList.contains("has-cut-cursor") && cutCursor) {
      setCutCursorVisibility(true);
    }
    cutAt(getSectionPoint(event.clientX, event.clientY));
  }

  function handlePointerLeave() {
    isPointerInside = false;
    lastPoint = null;
    setCutCursorVisibility(false);
  }

  function handlePointerDown(event) {
    if (isOverSticker(event)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cutMatSection.setPointerCapture?.(event.pointerId);
    isPointerInside = true;
    setupCutCursor();
    updateCutCursorPosition(event.clientX, event.clientY);
    setCutCursorVisibility(Boolean(cutCursor));
    lastPoint = getSectionPoint(event.clientX, event.clientY);
    cutAt(lastPoint);
  }

  function handlePointerUp(event) {
    if (cutMatSection.hasPointerCapture?.(event.pointerId)) {
      cutMatSection.releasePointerCapture(event.pointerId);
    }
  }

  setupCutCursor();

  cutMatSection.addEventListener("pointerenter", handlePointerEnter);
  cutMatSection.addEventListener("pointermove", handlePointerMove);
  cutMatSection.addEventListener("pointerleave", handlePointerLeave);
  cutMatSection.addEventListener("pointerdown", handlePointerDown);
  cutMatSection.addEventListener("pointerup", handlePointerUp);
  cutMatSection.addEventListener("pointercancel", handlePointerUp);
}

async function setupMatStickers() {
  const hosts = [
    document.querySelector("#matStickerA"),
    document.querySelector("#matStickerB")
  ].filter(Boolean);

  if (!hosts.length) return;

  const stickerPool = [
    {
      text: "9PRA",
      color: "#1a1a1a",
      material: { type: "holographic", intensity: 0.7, scale: 1.1 },
      tilt: -6
    },
    {
      text: "CUT",
      color: "#8b1e1e",
      material: { type: "glitter", intensity: 0.75, scale: 0.9 },
      tilt: 8
    },
    {
      text: "MAT",
      color: "#111827",
      material: { type: "reflective", intensity: 0.65, scale: 1 },
      tilt: -3
    },
    {
      text: "PRACTICE",
      color: "#1f2937",
      material: { type: "holographic", intensity: 0.8, scale: 0.85 },
      tilt: 5
    }
  ];

  const shuffled = [...stickerPool].sort(() => Math.random() - 0.5).slice(0, 2);
  let createSticker;

  try {
    // public/ assets cannot be imported via Vite module graph; load as a blob URL instead.
    const moduleUrl = resolvePublicAssetPath("/vendor/sticker-forge.es.js");
    const response = await fetch(moduleUrl);
    if (!response.ok) {
      throw new Error(`sticker-forge fetch failed: ${response.status}`);
    }
    const blobUrl = URL.createObjectURL(
      new Blob([await response.text()], { type: "text/javascript" })
    );
    const stickerModule = await import(/* @vite-ignore */ blobUrl);
    URL.revokeObjectURL(blobUrl);
    createSticker = stickerModule.createSticker;
  } catch (error) {
    console.warn("sticker-forge bundle failed to load", error);
  }

  await Promise.all(
    hosts.map(async (host, index) => {
      const pick = shuffled[index] || stickerPool[index];
      if (!createSticker) {
        host.textContent = pick.text;
        host.classList.add("is-fallback");
        return;
      }

      try {
        await createSticker(host, {
          source: {
            type: "text",
            text: pick.text,
            color: pick.color,
            fontFamily: "Arial Black, Arial Rounded MT Bold, sans-serif",
            fontWeight: 900
          },
          outline: { width: 14, color: "#ffffff" },
          shadow: {
            color: "#1a1520",
            opacity: 0.28,
            blur: 22,
            distance: 12,
            angle: 90
          },
          peel: {
            radius: 0.14,
            stiffness: 0.7,
            maxAngle: 3.4,
            release: "reset"
          },
          sound: { enabled: true, volume: 0.55 },
          back: { color: "#f4f1ec", gloss: 0.75, roughness: 0.25 },
          material: pick.material,
          tilt: pick.tilt,
          quality: "medium"
        });
      } catch (error) {
        console.warn("sticker-forge init failed", error);
        host.textContent = pick.text;
        host.classList.add("is-fallback");
      }
    })
  );
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

function playTrack(index) {
  radioPlayer.src = radioTracks[index];
  radioPlayer.volume = 0.39;
  return radioPlayer.play();
}

radioPlayer?.addEventListener("ended", async () => {
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

radioBtn?.addEventListener("click", () => {
  toggleRadioPlayback();
});

radioIcon?.addEventListener("click", () => {
  if (activeAudioControl === "noise") {
    toggleNoisePlayback();
    return;
  }
  toggleRadioPlayback();
});

noiseBtn?.addEventListener("click", () => {
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

setRadioUiState();
updateNoiseUiState();
setBagUiState();
setupDirectionalMatHero();
setupScratchPanel();
setupCutMatPanel();
void setupMatStickers();

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);
