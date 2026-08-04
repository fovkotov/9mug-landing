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

const drawMatSection = document.querySelector("#drawMatSection");
const drawMatStage = document.querySelector("#drawMatStage");
const drawCursorSource = resolvePublicAssetPath("/media/mat/draw-cursor.png");

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

function setupDrawMatPanel() {
  if (!drawMatSection || !drawMatStage) return;

  const paperNodes = [...drawMatStage.querySelectorAll(".draw-paper")];
  if (!paperNodes.length) return;

  const supportsFinePointer = () =>
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  let drawCursor = null;
  let zCounter = 10;
  let activePointerId = null;
  let gestureMode = "idle"; // idle | pending | draw | drag
  let activePaper = null;
  let lastDrawPoint = null;
  let pendingTimer = 0;
  let pointerOrigin = null;
  let lastClient = { x: 0, y: 0 };
  let dragOffset = { x: 0, y: 0 };

  const papers = paperNodes.map((el, index) => {
    const img = el.querySelector(".draw-paper-bg");
    const canvas = el.querySelector(".draw-paper-canvas");
    const rotateVar = getComputedStyle(el).getPropertyValue("--paper-rotate").trim();
    const rotation = Number.parseFloat(rotateVar) || 0;
    el.style.zIndex = String(index + 3);

    return {
      el,
      img,
      canvas,
      ctx: canvas?.getContext("2d", { alpha: true }) || null,
      rotation,
      hitCanvas: null,
      hitCtx: null,
      naturalWidth: 0,
      naturalHeight: 0,
      ready: false
    };
  });

  function getStageSize() {
    return {
      width: drawMatStage.clientWidth,
      height: drawMatStage.clientHeight
    };
  }

  function readPaperLayout(paper) {
    const stage = getStageSize();
    const left = paper.el.offsetLeft;
    const top = paper.el.offsetTop;
    const width = paper.el.offsetWidth;
    const height = paper.el.offsetHeight || width;
    return {
      left,
      top,
      width,
      height,
      stageWidth: stage.width,
      stageHeight: stage.height
    };
  }

  function setPaperPosition(paper, left, top) {
    const layout = readPaperLayout(paper);
    const maxLeft = Math.max(0, layout.stageWidth - layout.width * 0.35);
    const maxTop = Math.max(0, layout.stageHeight - layout.height * 0.35);
    const minLeft = -layout.width * 0.35;
    const minTop = -layout.height * 0.35;
    const nextLeft = clamp(left, minLeft, maxLeft);
    const nextTop = clamp(top, minTop, maxTop);
    paper.el.style.left = `${nextLeft}px`;
    paper.el.style.top = `${nextTop}px`;
  }

  function bringToFront(paper) {
    zCounter += 1;
    paper.el.style.zIndex = String(zCounter);
  }

  function syncCanvasSize(paper) {
    if (!paper.canvas || !paper.ctx || !paper.ready) return;
    const width = paper.el.clientWidth;
    const height = paper.img?.clientHeight || paper.el.clientHeight;
    if (width <= 0 || height <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = Math.round(width * dpr);
    const nextH = Math.round(height * dpr);
    if (paper.canvas.width === nextW && paper.canvas.height === nextH) return;

    // Preserve existing ink when resizing
    const prev = document.createElement("canvas");
    prev.width = paper.canvas.width;
    prev.height = paper.canvas.height;
    const prevCtx = prev.getContext("2d");
    if (prevCtx && paper.canvas.width && paper.canvas.height) {
      prevCtx.drawImage(paper.canvas, 0, 0);
    }

    paper.canvas.width = nextW;
    paper.canvas.height = nextH;
    paper.canvas.style.width = `${width}px`;
    paper.canvas.style.height = `${height}px`;
    paper.ctx.setTransform(1, 0, 0, 1, 0, 0);
    paper.ctx.clearRect(0, 0, nextW, nextH);
    if (prev.width && prev.height) {
      paper.ctx.drawImage(prev, 0, 0, nextW, nextH);
    }

    if (!paper.hitCanvas) {
      paper.hitCanvas = document.createElement("canvas");
      paper.hitCtx = paper.hitCanvas.getContext("2d", { willReadFrequently: true });
    }
    paper.hitCanvas.width = nextW;
    paper.hitCanvas.height = nextH;
    paper.hitCtx.clearRect(0, 0, nextW, nextH);
    paper.hitCtx.drawImage(paper.img, 0, 0, nextW, nextH);
  }

  function preparePaper(paper) {
    if (!paper.img || !paper.canvas) return;

    const arm = () => {
      paper.naturalWidth = paper.img.naturalWidth || paper.img.width;
      paper.naturalHeight = paper.img.naturalHeight || paper.img.height;
      paper.ready = true;
      syncCanvasSize(paper);
    };

    if (paper.img.complete && paper.img.naturalWidth) {
      arm();
      return;
    }

    paper.img.addEventListener("load", arm, { once: true });
  }

  function clientToPaperPoint(paper, clientX, clientY) {
    syncCanvasSize(paper);
    const layout = readPaperLayout(paper);
    const stageRect = drawMatStage.getBoundingClientRect();
    if (layout.width <= 0 || layout.height <= 0) return null;

    const stageX = clientX - stageRect.left;
    const stageY = clientY - stageRect.top;
    const originX = layout.left + layout.width / 2;
    const originY = layout.top + layout.height / 2;
    const dx = stageX - originX;
    const dy = stageY - originY;
    const rad = (-paper.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const ux = dx * cos - dy * sin;
    const uy = dx * sin + dy * cos;
    const localX = ux + layout.width / 2;
    const localY = uy + layout.height / 2;

    if (localX < -2 || localY < -2 || localX > layout.width + 2 || localY > layout.height + 2) {
      return null;
    }

    const scaleX = paper.canvas.width / layout.width;
    const scaleY = paper.canvas.height / layout.height;
    return {
      x: localX * scaleX,
      y: localY * scaleY,
      localX,
      localY,
      layout
    };
  }

  function alphaAt(paper, point) {
    if (!paper.hitCtx || !point) return 0;
    const x = clamp(Math.floor(point.x), 0, paper.canvas.width - 1);
    const y = clamp(Math.floor(point.y), 0, paper.canvas.height - 1);
    try {
      return paper.hitCtx.getImageData(x, y, 1, 1).data[3];
    } catch {
      return 0;
    }
  }

  function hitPaper(clientX, clientY) {
    const ordered = [...papers].sort(
      (a, b) => Number(b.el.style.zIndex || 0) - Number(a.el.style.zIndex || 0)
    );

    for (const paper of ordered) {
      if (!paper.ready) continue;
      const point = clientToPaperPoint(paper, clientX, clientY);
      if (!point) continue;
      if (alphaAt(paper, point) > 18) {
        return { paper, point };
      }
    }
    return null;
  }

  function strokeWidthFor(paper) {
    const base = isMobileViewport() ? 3.2 : 2.6;
    const dpr = paper.canvas.width / Math.max(1, paper.el.clientWidth);
    return base * dpr;
  }

  function drawStroke(paper, from, to) {
    if (!paper.ctx || !to) return;
    if (alphaAt(paper, to) <= 18) return;

    paper.ctx.save();
    paper.ctx.lineCap = "round";
    paper.ctx.lineJoin = "round";
    paper.ctx.strokeStyle = "rgba(22, 20, 18, 0.9)";
    paper.ctx.lineWidth = strokeWidthFor(paper);
    paper.ctx.beginPath();
    if (from && alphaAt(paper, from) > 18) {
      paper.ctx.moveTo(from.x, from.y);
      paper.ctx.lineTo(to.x, to.y);
    } else {
      paper.ctx.moveTo(to.x, to.y);
      paper.ctx.lineTo(to.x + 0.01, to.y + 0.01);
    }
    paper.ctx.stroke();
    paper.ctx.restore();
  }

  function setupDrawCursor() {
    if (drawCursor || !supportsFinePointer()) return;
    drawCursor = document.createElement("span");
    drawCursor.className = "draw-mat-cursor";
    drawCursor.setAttribute("aria-hidden", "true");
    const img = document.createElement("img");
    img.alt = "";
    img.src = drawCursorSource;
    img.draggable = false;
    drawCursor.append(img);
    drawMatSection.append(drawCursor);
  }

  function setDrawCursorVisibility(visible) {
    if (!drawCursor) return;
    drawMatSection.classList.toggle("has-draw-cursor", visible);
  }

  function updateDrawCursorPosition(clientX, clientY) {
    if (!drawCursor) return;
    const rect = drawMatSection.getBoundingClientRect();
    drawCursor.style.setProperty("--cursor-x", `${clamp(clientX - rect.left, 0, rect.width)}px`);
    drawCursor.style.setProperty("--cursor-y", `${clamp(clientY - rect.top, 0, rect.height)}px`);
  }

  function clearPendingTimer() {
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      pendingTimer = 0;
    }
  }

  function beginDrag(paper, clientX, clientY) {
    const layout = readPaperLayout(paper);
    const stageRect = drawMatStage.getBoundingClientRect();
    gestureMode = "drag";
    activePaper = paper;
    lastDrawPoint = null;
    bringToFront(paper);
    paper.el.classList.add("is-dragging");
    dragOffset = {
      x: clientX - stageRect.left - layout.left,
      y: clientY - stageRect.top - layout.top
    };
    playButtonTick();
  }

  function endGesture() {
    clearPendingTimer();
    if (activePaper) {
      activePaper.el.classList.remove("is-dragging");
    }
    gestureMode = "idle";
    activePaper = null;
    lastDrawPoint = null;
    pointerOrigin = null;
    activePointerId = null;
  }

  function handlePointerEnter(event) {
    setupDrawCursor();
    updateDrawCursorPosition(event.clientX, event.clientY);
    setDrawCursorVisibility(Boolean(drawCursor));
  }

  function handlePointerMove(event) {
    lastClient = { x: event.clientX, y: event.clientY };
    setupDrawCursor();
    updateDrawCursorPosition(event.clientX, event.clientY);
    if (!drawMatSection.classList.contains("has-draw-cursor") && drawCursor) {
      setDrawCursorVisibility(true);
    }

    if (activePointerId !== null && event.pointerId !== activePointerId) return;

    if (gestureMode === "pending" && pointerOrigin && activePaper) {
      const dx = event.clientX - pointerOrigin.x;
      const dy = event.clientY - pointerOrigin.y;
      if (Math.hypot(dx, dy) > 7) {
        clearPendingTimer();
        gestureMode = "draw";
        const point = clientToPaperPoint(activePaper, event.clientX, event.clientY);
        lastDrawPoint = point;
        drawStroke(activePaper, null, point);
      }
    }

    if (gestureMode === "draw" && activePaper) {
      const point = clientToPaperPoint(activePaper, event.clientX, event.clientY);
      if (point && alphaAt(activePaper, point) > 18) {
        drawStroke(activePaper, lastDrawPoint, point);
        lastDrawPoint = point;
      } else {
        lastDrawPoint = null;
      }
      return;
    }

    if (gestureMode === "drag" && activePaper) {
      const stageRect = drawMatStage.getBoundingClientRect();
      setPaperPosition(
        activePaper,
        event.clientX - stageRect.left - dragOffset.x,
        event.clientY - stageRect.top - dragOffset.y
      );
    }
  }

  function handlePointerLeave() {
    if (gestureMode === "idle") {
      setDrawCursorVisibility(false);
    }
  }

  function handlePointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const hit = hitPaper(event.clientX, event.clientY);
    if (!hit) return;

    event.preventDefault();
    drawMatSection.setPointerCapture?.(event.pointerId);
    activePointerId = event.pointerId;
    activePaper = hit.paper;
    pointerOrigin = { x: event.clientX, y: event.clientY };
    lastClient = { x: event.clientX, y: event.clientY };
    gestureMode = "pending";
    lastDrawPoint = hit.point;
    bringToFront(hit.paper);
    setupDrawCursor();
    updateDrawCursorPosition(event.clientX, event.clientY);
    setDrawCursorVisibility(Boolean(drawCursor));

    clearPendingTimer();
    pendingTimer = window.setTimeout(() => {
      if (gestureMode === "pending" && activePaper) {
        beginDrag(activePaper, lastClient.x, lastClient.y);
      }
    }, 220);
  }

  function handlePointerUp(event) {
    if (activePointerId !== null && event.pointerId !== activePointerId) return;

    if (gestureMode === "pending" && activePaper && lastDrawPoint) {
      // Tap: leave a small mark
      drawStroke(activePaper, null, lastDrawPoint);
    }

    if (drawMatSection.hasPointerCapture?.(event.pointerId)) {
      drawMatSection.releasePointerCapture(event.pointerId);
    }
    endGesture();
  }

  papers.forEach(preparePaper);

  let resizeFrame = 0;
  function handleResize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      papers.forEach((paper) => {
        if (paper.ready) syncCanvasSize(paper);
      });
    });
  }

  setupDrawCursor();

  drawMatSection.addEventListener("pointerenter", handlePointerEnter);
  drawMatSection.addEventListener("pointermove", handlePointerMove);
  drawMatSection.addEventListener("pointerleave", handlePointerLeave);
  drawMatSection.addEventListener("pointerdown", handlePointerDown);
  drawMatSection.addEventListener("pointerup", handlePointerUp);
  drawMatSection.addEventListener("pointercancel", handlePointerUp);
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);
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
setupDrawMatPanel();

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);
