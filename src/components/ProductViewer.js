/**
 * Directional product hero viewer.
 *
 * Desktop: mouse look-around.
 * Mobile: DeviceOrientation (calibrated) with touch-drag fallback.
 *
 * Interaction updates only set target orientation; rendering runs in rAF.
 */

import {
  needsOrientationPermission,
  orientationApiAvailable,
  requestDeviceOrientationPermission
} from "../device-orientation-permission.js";

/** 5×5 look-around grid — one unique frame / angle pair per cell. */
const GRID_SIZE = 5;
const CENTER_KEY = "c13";

/** Keys c01…c25 in row-major order (1 = top-left, 13 = center, 25 = bottom-right). */
const DIRECTION_KEYS = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
  return `c${String(i + 1).padStart(2, "0")}`;
});

/** Mug yaw/pitch degrees for each cell (col → H, row → V; bottom row = −30°). */
const CELL_ANGLES = (() => {
  const hVals = [-30, -15, 0, 15, 30];
  const vVals = [30, 15, 0, -15, -30];
  const map = {};
  let n = 0;
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      n += 1;
      map[`c${String(n).padStart(2, "0")}`] = { col, row, h: hVals[col], v: vVals[row] };
    }
  }
  return map;
})();

function cellKey(col, row) {
  return `c${String(row * GRID_SIZE + col + 1).padStart(2, "0")}`;
}

function zoneColorForKey(key) {
  const meta = CELL_ANGLES[key];
  if (!meta) return [200, 200, 200];
  const t = meta.col / (GRID_SIZE - 1);
  const u = meta.row / (GRID_SIZE - 1);
  return [
    Math.round(40 + t * 200),
    Math.round(100 + (1 - Math.abs(t - 0.5) * 2) * 100),
    Math.round(220 - u * 140)
  ];
}

const MAX_GAMMA_DEG = 20;
const MAX_BETA_DEG = 12;
const ORIENT_LERP = 0.14;
const TOUCH_RELEASE_LERP = 0.12;
const MOUSE_LERP = 1;
const SNAP_EPSILON = 0.004;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(current, target, amount) {
  return current + (target - current) * amount;
}

function supportsFinePointer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function isMobileInteraction() {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  return coarse || noHover || narrow || !supportsFinePointer();
}

function normalizeImages(images = {}) {
  const normalized = {};
  for (const key of DIRECTION_KEYS) {
    if (images[key]) normalized[key] = images[key];
  }
  return normalized;
}

function injectPreloadLink(src) {
  if (!src || !document.head) return;
  if (document.head.querySelector(`link[data-mug-frame-preload="true"][href="${src}"]`)) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = src;
  link.dataset.mugFramePreload = "true";
  document.head.append(link);
}

async function decodeImageSource(src) {
  if (!src) return null;
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  try {
    await image.decode();
  } catch {
    if (!image.complete) {
      await new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    }
  }
  return image;
}

/**
 * Start fetching + decoding every frame as early as possible (page entry).
 * Safe to call before mounting ProductViewer.
 */
export function preloadMugFrameImages(images = {}) {
  const normalized = normalizeImages(images);
  const sources = DIRECTION_KEYS.map((key) => normalized[key]).filter(Boolean);

  for (const src of sources) {
    injectPreloadLink(src);
  }

  return Promise.all(sources.map(decodeImageSource));
}

async function waitForFramePainted(img) {
  if (!img) return;
  if (!img.complete || img.naturalWidth === 0) {
    await new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    });
  }
  try {
    await img.decode();
  } catch {
    // Ignore decode failures; load event already settled.
  }
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   images: Record<string, string>,
 *   transitionDuration?: number,
 *   deadZoneHalfWidth?: number,
 *   deadZoneHalfHeight?: number,
 *   sideFarBoundary?: number,
 *   deadZoneRadius?: number,
 *   horizontalSensitivity?: number,
 *   verticalSensitivity?: number,
 *   showZones?: boolean,
 *   maxGamma?: number,
 *   maxBeta?: number
 * }} options
 */
export function createProductViewer(root, options = {}) {
  if (!root) {
    throw new Error("ProductViewer requires a root element");
  }

  const images = normalizeImages(options.images);
  const legacyRadius = options.deadZoneRadius ?? 0.14;
  const deadZoneHalfWidth = options.deadZoneHalfWidth ?? legacyRadius * 2;
  const deadZoneHalfHeight = options.deadZoneHalfHeight ?? legacyRadius * 1.35;
  const sideFarBoundary = Math.max(
    options.sideFarBoundary ?? deadZoneHalfWidth + 0.42,
    deadZoneHalfWidth + 0.08
  );
  const horizontalSensitivity = options.horizontalSensitivity ?? 1;
  const verticalSensitivity = options.verticalSensitivity ?? 1;
  const showZones = Boolean(options.showZones);
  const maxGamma = options.maxGamma ?? MAX_GAMMA_DEG;
  const maxBeta = options.maxBeta ?? MAX_BETA_DEG;

  const prefersMouse = supportsFinePointer() && !isMobileInteraction();
  const mobileInput = !prefersMouse;

  let destroyed = false;
  let ready = false;
  let activeKey = CENTER_KEY;
  let zoneCanvas = null;
  let zoneCtx = null;
  let zoneLabelLayer = null;
  let zoneResizeObserver = null;
  let firstGestureBound = false;

  // Shared look target in the same normalized space as desktop mouse.
  let targetX = 0;
  let targetY = 0;
  let smoothX = 0;
  let smoothY = 0;
  let lerpAmount = prefersMouse ? MOUSE_LERP : ORIENT_LERP;
  let rafId = 0;
  let loopRunning = false;

  // Desktop mouse
  let pointerInside = false;

  // Orientation
  let orientationActive = false;
  let orientationListening = false;
  let orientationPermission = "unknown";
  let orientationRequesting = false;
  let neutralBeta = null;
  let neutralGamma = null;
  let latestBeta = null;
  let latestGamma = null;

  // Touch fallback
  let touchDragging = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchOriginX = 0;
  let touchOriginY = 0;
  let touchEnabled = mobileInput;

  // Visibility gating
  let heroVisible = true;
  let pageVisible = document.visibilityState !== "hidden";
  let intersectionObserver = null;

  const layerNodes = new Map();
  const availableKeys = DIRECTION_KEYS.filter((key) => Boolean(images[key]));

  root.classList.add("product-viewer");
  root.classList.toggle("has-zones", showZones);
  root.classList.toggle("is-mobile-input", mobileInput);
  root.setAttribute("data-ready", "false");
  root.setAttribute("data-input", prefersMouse ? "mouse" : "pending");

  const stage = document.createElement("div");
  stage.className = "product-viewer__stage";
  root.append(stage);

  for (const key of DIRECTION_KEYS) {
    const src = images[key];
    if (!src) continue;

    injectPreloadLink(src);

    const img = document.createElement("img");
    img.className = "product-viewer__frame";
    img.alt = "";
    img.draggable = false;
    img.decoding = "sync";
    img.loading = "eager";
    img.fetchPriority = "high";
    img.src = src;
    img.dataset.direction = key;
    const isCenter = key === CENTER_KEY;
    img.classList.toggle("is-active", isCenter);
    img.setAttribute("aria-hidden", isCenter ? "false" : "true");
    stage.append(img);
    layerNodes.set(key, img);
  }

  function gridEdges() {
    const nyTop = -verticalSensitivity;
    const nyBottom = verticalSensitivity;
    const upHalfNy = (nyTop - deadZoneHalfHeight) / 2;
    const downHalfNy = (nyBottom + deadZoneHalfHeight) / 2;
    return {
      xEdges: [
        -horizontalSensitivity,
        -sideFarBoundary,
        -deadZoneHalfWidth,
        deadZoneHalfWidth,
        sideFarBoundary,
        horizontalSensitivity
      ],
      yEdges: [nyTop, upHalfNy, -deadZoneHalfHeight, deadZoneHalfHeight, downHalfNy, nyBottom]
    };
  }

  function binIndex(value, edges) {
    for (let i = 0; i < edges.length - 1; i += 1) {
      const lo = edges[i];
      const hi = edges[i + 1];
      if (i === edges.length - 2) {
        if (value >= lo && value <= hi) return i;
      } else if (value >= lo && value < hi) {
        return i;
      }
    }
    if (value < edges[0]) return 0;
    return edges.length - 2;
  }

  /** Map normalized pointer → unique 5×5 cell key (c01…c25). */
  function pickDirection(nx, ny) {
    const { xEdges, yEdges } = gridEdges();
    const col = binIndex(nx, xEdges);
    const row = binIndex(ny, yEdges);
    const key = cellKey(col, row);
    return availableKeys.includes(key) ? key : firstAvailable(CENTER_KEY, availableKeys[0]);
  }

  function firstAvailable(...keys) {
    for (const key of keys) {
      if (key && availableKeys.includes(key)) return key;
    }
    return availableKeys.includes(CENTER_KEY) ? CENTER_KEY : availableKeys[0];
  }

  function computeNormalizedFromLocal(localX, localY, width, height) {
    const maxX = Math.max(width / 2, 1);
    const maxY = Math.max(height / 2, 1);
    return {
      x: clamp((localX / maxX) * horizontalSensitivity, -1.75, 1.75),
      y: clamp((localY / maxY) * verticalSensitivity, -1.2, 1.2)
    };
  }

  /** Map a 5×5 overlay cell to its unique frame key. */
  function cellDirection(col, row) {
    return cellKey(col, row);
  }

  function computeNormalizedPointer(clientX, clientY) {
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }

    return computeNormalizedFromLocal(
      clientX - rect.left - rect.width / 2,
      clientY - rect.top - rect.height / 2,
      rect.width,
      rect.height
    );
  }

  /** Map relative degrees → same normalized space as desktop zones. */
  function orientationToNormalized(relGamma, relBeta) {
    const gx = clamp(relGamma, -maxGamma, maxGamma) / maxGamma;
    const by = clamp(relBeta, -maxBeta, maxBeta) / maxBeta;
    // 10° → ~0.5 (left/right), 20° → 1 (far_*). Vertical clears mid-band gently.
    return {
      x: gx * Math.max(sideFarBoundary + 0.2, 1),
      y: by * Math.max(deadZoneHalfHeight + 0.35, 0.55)
    };
  }

  function setActiveDirection(nextKey) {
    if (!layerNodes.has(nextKey) || nextKey === activeKey) return;

    for (const [key, node] of layerNodes) {
      const on = key === nextKey;
      node.classList.toggle("is-active", on);
      node.setAttribute("aria-hidden", on ? "false" : "true");
    }

    activeKey = nextKey;
    root.dataset.direction = nextKey;

    if (showZones && zoneLabelLayer) {
      for (const label of zoneLabelLayer.querySelectorAll(".product-viewer__zone-label")) {
        label.classList.toggle("is-active", label.dataset.key === nextKey);
      }
    }
  }

  function setTarget(nx, ny, nextLerp = lerpAmount) {
    targetX = nx;
    targetY = ny;
    lerpAmount = nextLerp;
    ensureLoop();
  }

  function canInteract() {
    return ready && !destroyed && heroVisible && pageVisible;
  }

  function renderFrame() {
    rafId = 0;
    if (destroyed || !ready) {
      loopRunning = false;
      return;
    }

    smoothX = lerp(smoothX, targetX, lerpAmount);
    smoothY = lerp(smoothY, targetY, lerpAmount);

    if (Math.abs(smoothX - targetX) < SNAP_EPSILON) smoothX = targetX;
    if (Math.abs(smoothY - targetY) < SNAP_EPSILON) smoothY = targetY;

    setActiveDirection(pickDirection(smoothX, smoothY));

    const settled =
      smoothX === targetX &&
      smoothY === targetY &&
      !(orientationActive && orientationListening) &&
      !pointerInside &&
      !touchDragging;

    if (settled && targetX === 0 && targetY === 0) {
      loopRunning = false;
      return;
    }

    // Keep looping while sensors/pointer are live or still easing.
    if (
      orientationActive &&
      orientationListening &&
      canInteract()
    ) {
      applyOrientationSample();
    }

    loopRunning = true;
    rafId = requestAnimationFrame(renderFrame);
  }

  function ensureLoop() {
    if (destroyed || !ready || loopRunning) return;
    loopRunning = true;
    rafId = requestAnimationFrame(renderFrame);
  }

  function paintZoneOverlay() {
    if (!showZones || !zoneCanvas || !zoneCtx || destroyed) return;

    const width = root.clientWidth;
    const height = root.clientHeight;
    if (width <= 0 || height <= 0) return;

    const sample = 4;
    const cols = Math.max(1, Math.ceil(width / sample));
    const rows = Math.max(1, Math.ceil(height / sample));

    zoneCanvas.width = cols;
    zoneCanvas.height = rows;
    zoneCanvas.style.width = `${width}px`;
    zoneCanvas.style.height = `${height}px`;

    const { xEdges, yEdges } = gridEdges();

    const imageData = zoneCtx.createImageData(cols, rows);
    const data = imageData.data;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const px = (col + 0.5) * sample;
        const py = (row + 0.5) * sample;
        const { x: nx, y: ny } = computeNormalizedFromLocal(
          px - width / 2,
          py - height / 2,
          width,
          height
        );
        const key = pickDirection(nx, ny);
        const color = zoneColorForKey(key);
        const index = (row * cols + col) * 4;
        data[index] = color[0];
        data[index + 1] = color[1];
        data[index + 2] = color[2];
        data[index + 3] = key === CENTER_KEY ? 48 : 78;
      }
    }

    zoneCtx.putImageData(imageData, 0, 0);

    if (!zoneLabelLayer) return;
    zoneLabelLayer.replaceChildren();

    const nxToPercent = (nx) =>
      ((nx / horizontalSensitivity) * 0.5 + 0.5) * 100;
    const nyToPercent = (ny) =>
      ((ny / verticalSensitivity) * 0.5 + 0.5) * 100;

    let section = 1;
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const key = cellDirection(col, row);
        if (!availableKeys.includes(key)) {
          section += 1;
          continue;
        }

        const cx = (xEdges[col] + xEdges[col + 1]) / 2;
        const cy = (yEdges[row] + yEdges[row + 1]) / 2;
        const label = document.createElement("span");
        label.className = "product-viewer__zone-label";
        label.dataset.key = key;
        label.dataset.section = String(section);
        label.textContent = String(section);
        label.style.left = `${nxToPercent(cx)}%`;
        label.style.top = `${nyToPercent(cy)}%`;
        label.classList.toggle("is-active", key === activeKey);
        zoneLabelLayer.append(label);
        section += 1;
      }
    }
  }

  function setupZoneOverlay() {
    if (!showZones) return;

    zoneCanvas = document.createElement("canvas");
    zoneCanvas.className = "product-viewer__zones";
    zoneCanvas.setAttribute("aria-hidden", "true");
    zoneCtx = zoneCanvas.getContext("2d", { alpha: true });

    zoneLabelLayer = document.createElement("div");
    zoneLabelLayer.className = "product-viewer__zone-labels";
    zoneLabelLayer.setAttribute("aria-hidden", "true");

    root.append(zoneCanvas, zoneLabelLayer);
    paintZoneOverlay();

    zoneResizeObserver = new ResizeObserver(() => {
      paintZoneOverlay();
    });
    zoneResizeObserver.observe(root);
    window.addEventListener("orientationchange", paintZoneOverlay);
  }

  // —— Desktop mouse ——
  function handlePointerEnter(event) {
    if (!prefersMouse || !canInteract()) return;
    pointerInside = true;
    const { x, y } = computeNormalizedPointer(event.clientX, event.clientY);
    setTarget(x, y, MOUSE_LERP);
  }

  function handlePointerMove(event) {
    if (!prefersMouse || !canInteract()) return;
    pointerInside = true;
    const { x, y } = computeNormalizedPointer(event.clientX, event.clientY);
    setTarget(x, y, MOUSE_LERP);
  }

  function handlePointerLeave() {
    if (!prefersMouse) return;
    pointerInside = false;
    setTarget(0, 0, ORIENT_LERP);
  }

  // —— Orientation ——
  function applyOrientationSample() {
    if (latestBeta == null || latestGamma == null) return;
    if (neutralBeta == null || neutralGamma == null) {
      neutralBeta = latestBeta;
      neutralGamma = latestGamma;
    }

    const relGamma = latestGamma - neutralGamma;
    const relBeta = latestBeta - neutralBeta;
    const mapped = orientationToNormalized(relGamma, relBeta);
    targetX = mapped.x;
    targetY = mapped.y;
    lerpAmount = ORIENT_LERP;
  }

  function handleDeviceOrientation(event) {
    if (!orientationActive || destroyed) return;
    if (!pageVisible || !heroVisible) return;
    if (typeof event.beta !== "number" || typeof event.gamma !== "number") return;

    latestBeta = event.beta;
    latestGamma = event.gamma;
    applyOrientationSample();
    ensureLoop();
  }

  function startOrientationListening() {
    if (orientationListening || destroyed || !orientationActive) return;
    window.addEventListener("deviceorientation", handleDeviceOrientation, true);
    // Some Android builds expose absolute orientation separately.
    window.addEventListener("deviceorientationabsolute", handleDeviceOrientation, true);
    orientationListening = true;
    root.setAttribute("data-input", "orientation");
    root.classList.add("has-orientation");
    ensureLoop();
  }

  function stopOrientationListening() {
    if (!orientationListening) return;
    window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
    window.removeEventListener("deviceorientationabsolute", handleDeviceOrientation, true);
    orientationListening = false;
  }

  async function enableOrientationMode() {
    if (prefersMouse || orientationActive || destroyed || orientationRequesting) return false;

    orientationRequesting = true;
    const status = await requestDeviceOrientationPermission();
    orientationRequesting = false;
    orientationPermission = status === "granted" ? "granted" : status === "denied" ? "denied" : "unknown";

    if (status !== "granted") {
      touchEnabled = true;
      root.setAttribute("data-input", "touch");
      return false;
    }

    orientationActive = true;
    // Keep touch as soft fallback if sensor stays silent.
    touchEnabled = true;
    neutralBeta = null;
    neutralGamma = null;
    latestBeta = null;
    latestGamma = null;
    root.setAttribute("data-input", "orientation");
    startOrientationListening();
    ensureLoop();
    return true;
  }

  function bindFirstGestureOrientationRequest() {
    if (!mobileInput || firstGestureBound || orientationActive || destroyed) return;
    firstGestureBound = true;

    const onFirstGesture = () => {
      window.removeEventListener("pointerdown", onFirstGesture, true);
      window.removeEventListener("touchstart", onFirstGesture, true);
      if (!orientationActive) {
        void enableOrientationMode();
      }
    };

    window.addEventListener("pointerdown", onFirstGesture, true);
    window.addEventListener("touchstart", onFirstGesture, { capture: true, passive: true });
  }

  async function bootstrapMobileOrientation() {
    if (!mobileInput || destroyed) return;

    if (!orientationApiAvailable()) {
      root.setAttribute("data-input", "touch");
      return;
    }

    // Android: no permission prompt — start on page entry.
    if (!needsOrientationPermission()) {
      await enableOrientationMode();
      return;
    }

    // iOS: permission is requested when tapping a link to this page.
    // If already granted (or handoff just happened), this resolves without a dialog.
    const started = await enableOrientationMode();
    if (started) return;

    // Direct open / refresh without prior grant: ask on the first tap.
    bindFirstGestureOrientationRequest();
    root.setAttribute("data-input", "touch");
  }

  // —— Touch fallback ——
  function handleTouchPointerDown(event) {
    if (prefersMouse || !touchEnabled || !canInteract()) return;
    if (event.pointerType === "mouse") return;

    touchDragging = true;
    touchStartX = event.clientX;
    touchStartY = event.clientY;
    touchOriginX = targetX;
    touchOriginY = targetY;
    root.classList.add("is-touch-dragging");
    root.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleTouchPointerMove(event) {
    if (!touchDragging || prefersMouse || !canInteract()) return;

    const rect = root.getBoundingClientRect();
    const dx = event.clientX - touchStartX;
    const dy = event.clientY - touchStartY;
    const nx = clamp(touchOriginX + (dx / Math.max(rect.width, 1)) * 2.2, -1.2, 1.2);
    const ny = clamp(touchOriginY + (dy / Math.max(rect.height, 1)) * 1.4, -0.9, 0.9);
    setTarget(nx, ny, ORIENT_LERP);
  }

  function handleTouchPointerUp(event) {
    if (!touchDragging) return;
    touchDragging = false;
    root.classList.remove("is-touch-dragging");
    if (root.hasPointerCapture?.(event.pointerId)) {
      root.releasePointerCapture(event.pointerId);
    }
    if (!orientationActive || latestBeta == null) {
      setTarget(0, 0, TOUCH_RELEASE_LERP);
    }
  }

  // —— Visibility ——
  function syncListeningState() {
    if (destroyed) return;
    const shouldListen = orientationActive && heroVisible && pageVisible;
    if (shouldListen) startOrientationListening();
    else stopOrientationListening();

    if (!shouldListen && !pointerInside && !touchDragging && !orientationActive) {
      setTarget(0, 0, ORIENT_LERP);
    } else if (shouldListen) {
      ensureLoop();
    }
  }

  function handleVisibilityChange() {
    pageVisible = document.visibilityState !== "hidden";
    syncListeningState();
  }

  function setupVisibility() {
    const observeTarget = root.closest(".panel-hero") || root;
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        heroVisible = Boolean(entry?.isIntersecting);
        syncListeningState();
      },
      { threshold: [0, 0.05, 0.2] }
    );
    intersectionObserver.observe(observeTarget);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  async function preload() {
    await preloadMugFrameImages(images);
    if (destroyed) return;

    await Promise.all([...layerNodes.values()].map(waitForFramePainted));
    if (destroyed) return;

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (destroyed) return;

    ready = true;
    root.setAttribute("data-ready", "true");
    root.classList.add("is-ready");
    paintZoneOverlay();

    if (mobileInput) {
      root.setAttribute("data-input", orientationActive ? "orientation" : "touch");
      void bootstrapMobileOrientation();
    }
    ensureLoop();
  }

  setupZoneOverlay();
  setupVisibility();

  if (prefersMouse) {
    root.addEventListener("pointerenter", handlePointerEnter);
    root.addEventListener("pointermove", handlePointerMove);
    root.addEventListener("pointerleave", handlePointerLeave);
  } else {
    root.addEventListener("pointerdown", handleTouchPointerDown, { passive: false });
    root.addEventListener("pointermove", handleTouchPointerMove, { passive: false });
    root.addEventListener("pointerup", handleTouchPointerUp);
    root.addEventListener("pointercancel", handleTouchPointerUp);
  }

  const preloadPromise = preload();

  return {
    root,
    ready: () => ready,
    whenReady: () => preloadPromise,
    getActiveDirection: () => activeKey,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(rafId);
      loopRunning = false;
      stopOrientationListening();
      zoneResizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("orientationchange", paintZoneOverlay);
      root.removeEventListener("pointerenter", handlePointerEnter);
      root.removeEventListener("pointermove", handlePointerMove);
      root.removeEventListener("pointerleave", handlePointerLeave);
      root.removeEventListener("pointerdown", handleTouchPointerDown);
      root.removeEventListener("pointermove", handleTouchPointerMove);
      root.removeEventListener("pointerup", handleTouchPointerUp);
      root.removeEventListener("pointercancel", handleTouchPointerUp);
      root.replaceChildren();
      layerNodes.clear();
    }
  };
}

/**
 * 5×5 unique frame map — cell_01.webp … cell_25.webp (row-major).
 * Angles: H −30…+30, V +30…−30 (bottom row shows mug underside).
 */
export function createMugFrameImages(resolvePath, basePath = "/media/mug_frames") {
  const root = basePath.replace(/\/$/, "");
  const images = {};
  for (const key of DIRECTION_KEYS) {
    const absolute = `${root}/cell_${key.slice(1)}.webp`;
    images[key] = typeof resolvePath === "function" ? resolvePath(absolute) : absolute;
  }
  return images;
}

export { CELL_ANGLES, CENTER_KEY, DIRECTION_KEYS as MUG_FRAME_KEYS };
