/**
 * Directional product hero viewer.
 *
 * Desktop: mouse look-around.
 * Mobile: DeviceOrientation (calibrated) with touch-drag fallback.
 *
 * Interaction updates only set target orientation; rendering runs in rAF.
 */

import {
  ensureDeviceOrientationPermission,
  needsOrientationPermission,
  orientationApiAvailable
} from "../device-orientation-permission.js";

const DEFAULT_GRID_COLS = 5;
const DEFAULT_GRID_ROWS = 5;
const CENTER_KEY = "c13";

function makeDirectionKeys(cols, rows) {
  return Array.from({ length: cols * rows }, (_, i) => {
    return `c${String(i + 1).padStart(2, "0")}`;
  });
}

/** Keys c01…c25 in row-major order — default 5×5 used by the mat hero. */
const DIRECTION_KEYS = makeDirectionKeys(DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS);

function makeCellAngles(cols, rows, hVals, vVals) {
  const map = {};
  let n = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      n += 1;
      map[`c${String(n).padStart(2, "0")}`] = {
        col,
        row,
        h: hVals[col],
        v: vVals[row]
      };
    }
  }
  return map;
}

/** Default 5×5 angles (mat). Mug passes its own grid via createProductViewer options. */
const CELL_ANGLES = makeCellAngles(
  DEFAULT_GRID_COLS,
  DEFAULT_GRID_ROWS,
  [-90, -45, 0, 45, 90],
  [90, 45, 0, -45, -90]
);

function cellKey(col, row, cols = DEFAULT_GRID_COLS) {
  return `c${String(row * cols + col + 1).padStart(2, "0")}`;
}

/** Screen top/bottom swapped; middle row (center) stays. */
function frameRowForScreenRow(row, flipVertical = true, rows = DEFAULT_GRID_ROWS) {
  return flipVertical ? rows - 1 - row : row;
}

function zoneColorForKey(key, cols = DEFAULT_GRID_COLS, rows = DEFAULT_GRID_ROWS) {
  const n = Number.parseInt(String(key).slice(1), 10);
  if (!Number.isFinite(n) || n < 1) return [200, 200, 200];
  const col = (n - 1) % cols;
  const row = Math.floor((n - 1) / cols);
  const t = cols > 1 ? col / (cols - 1) : 0;
  const u = rows > 1 ? row / (rows - 1) : 0;
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
  for (const [key, src] of Object.entries(images)) {
    if (src) normalized[key] = src;
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
 * Start fetching + decoding frames as early as possible (page entry).
 * Pass `keys` to warm only part of the grid, e.g. the center frame alone.
 * Safe to call before mounting ProductViewer.
 */
export function preloadMugFrameImages(images = {}, { keys } = {}) {
  const normalized = normalizeImages(images);
  const sources = (keys ? keys.map((key) => normalized[key]) : Object.values(normalized)).filter(
    Boolean
  );

  for (const src of sources) {
    injectPreloadLink(src);
  }

  return Promise.all(sources.map(decodeImageSource));
}

function isFramePainted(img) {
  return Boolean(img) && img.complete && img.naturalWidth > 0;
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
 *   maxBeta?: number,
 *   flipVerticalFrames?: boolean,
 *   gridCols?: number,
 *   gridRows?: number,
 *   centerKey?: string
 * }} options
 */
export function createProductViewer(root, options = {}) {
  if (!root) {
    throw new Error("ProductViewer requires a root element");
  }

  const images = normalizeImages(options.images);
  const gridCols = Math.max(1, Math.round(options.gridCols ?? DEFAULT_GRID_COLS));
  const gridRows = Math.max(1, Math.round(options.gridRows ?? DEFAULT_GRID_ROWS));
  const directionKeys = makeDirectionKeys(gridCols, gridRows);
  const centerCol = Math.floor(gridCols / 2);
  const centerRow = Math.floor(gridRows / 2);
  const centerKey = options.centerKey || cellKey(centerCol, centerRow, gridCols);
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
  // Mug frames are authored with screen Y flipped; mat frames are not.
  const flipVerticalFrames = options.flipVerticalFrames !== false;

  const prefersMouse = supportsFinePointer() && !isMobileInteraction();
  const mobileInput = !prefersMouse;

  let destroyed = false;
  let ready = false;
  let activeKey = centerKey;
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
  const availableKeys = directionKeys.filter((key) => Boolean(images[key]));

  root.classList.add("product-viewer");
  root.classList.toggle("has-zones", showZones);
  root.classList.toggle("is-mobile-input", mobileInput);
  root.setAttribute("data-ready", "false");
  root.setAttribute("data-input", prefersMouse ? "mouse" : "pending");

  const stage = document.createElement("div");
  stage.className = "product-viewer__stage";
  root.append(stage);

  for (const key of directionKeys) {
    const src = images[key];
    if (!src) continue;

    const isCenter = key === centerKey;
    if (isCenter) injectPreloadLink(src);

    const img = document.createElement("img");
    img.className = "product-viewer__frame";
    img.alt = "";
    img.draggable = false;
    img.decoding = isCenter ? "sync" : "async";
    img.loading = "eager";
    img.fetchPriority = isCenter ? "high" : "low";
    // Off-center frames stay parked until the center frame is on screen,
    // so the first paint never queues behind the rest of the grid.
    if (isCenter) img.src = src;
    else img.dataset.src = src;
    img.dataset.direction = key;
    img.classList.toggle("is-active", isCenter);
    img.setAttribute("aria-hidden", isCenter ? "false" : "true");
    stage.append(img);
    layerNodes.set(key, img);
  }

  function evenEdges(min, max, count) {
    if (count <= 1) return [min, max];
    const step = (max - min) / count;
    return Array.from({ length: count + 1 }, (_, i) => min + i * step);
  }

  function gridEdges() {
    return {
      xEdges: evenEdges(-horizontalSensitivity, horizontalSensitivity, gridCols),
      yEdges: evenEdges(-verticalSensitivity, verticalSensitivity, gridRows)
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

  /** Map normalized pointer → unique grid cell key. */
  function pickDirection(nx, ny) {
    const { xEdges, yEdges } = gridEdges();
    const col = binIndex(nx, xEdges);
    const row = binIndex(ny, yEdges);
    const key = cellKey(col, frameRowForScreenRow(row, flipVerticalFrames, gridRows), gridCols);
    return availableKeys.includes(key) ? key : firstAvailable(centerKey, availableKeys[0]);
  }

  function firstAvailable(...keys) {
    for (const key of keys) {
      if (key && availableKeys.includes(key)) return key;
    }
    return availableKeys.includes(centerKey) ? centerKey : availableKeys[0];
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
    return cellKey(col, frameRowForScreenRow(row, flipVerticalFrames, gridRows), gridCols);
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
    // Full tilt must reach outer 5×5 bands (top/bottom rows need |ny| past mid splits).
    return {
      x: gx * horizontalSensitivity,
      y: by * verticalSensitivity
    };
  }

  function setActiveDirection(nextKey) {
    if (!layerNodes.has(nextKey) || nextKey === activeKey) return;
    // Hold the current frame instead of flashing a cell that is still streaming.
    if (!isFramePainted(layerNodes.get(nextKey))) return;

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
        const color = zoneColorForKey(key, gridCols, gridRows);
        const index = (row * cols + col) * 4;
        data[index] = color[0];
        data[index + 1] = color[1];
        data[index + 2] = color[2];
        data[index + 3] = key === centerKey ? 48 : 78;
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
    for (let row = 0; row < gridRows; row += 1) {
      for (let col = 0; col < gridCols; col += 1) {
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
    const status = await ensureDeviceOrientationPermission();
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

    // Silent check → request if needed (Android starts immediately;
    // iOS reuses a prior grant or asks on the first tap).
    const started = await enableOrientationMode();
    if (started) return;

    if (needsOrientationPermission()) {
      bindFirstGestureOrientationRequest();
    }
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

  /** Nearest cells first, so the grid fills out around wherever the user looks. */
  function streamRemainingFrames() {
    const centerIndex = directionKeys.indexOf(activeKey);
    const centerCell = {
      col: centerIndex >= 0 ? centerIndex % gridCols : centerCol,
      row: centerIndex >= 0 ? Math.floor(centerIndex / gridCols) : centerRow
    };

    const pending = [...layerNodes]
      .filter(([, img]) => Boolean(img.dataset.src))
      .sort(([a], [b]) => {
        const distance = (key) => {
          const index = directionKeys.indexOf(key);
          const col = index % gridCols;
          const row = Math.floor(index / gridCols);
          return Math.abs(col - centerCell.col) + Math.abs(row - centerCell.row);
        };
        return distance(a) - distance(b);
      });

    for (const [, img] of pending) {
      const src = img.dataset.src;
      delete img.dataset.src;
      img.src = src;
      // A landed frame can unblock a cell the pointer is already resting on.
      void waitForFramePainted(img).then(() => {
        if (!destroyed) ensureLoop();
      });
    }
  }

  async function preload() {
    const primaryKey = firstAvailable(centerKey);
    await preloadMugFrameImages(images, { keys: [primaryKey] });
    if (destroyed) return;

    await waitForFramePainted(layerNodes.get(primaryKey));
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
    streamRemainingFrames();
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
 * Unique frame map — cell_01…cell_N (row-major).
 * Default 5×5 for the mat. Mug uses 10×5.
 */
export function createMugFrameImages(
  resolvePath,
  basePath = "/media/mug_frames",
  { extension = "webp", cols = DEFAULT_GRID_COLS, rows = DEFAULT_GRID_ROWS } = {}
) {
  const root = basePath.replace(/\/$/, "");
  const ext = String(extension || "webp").replace(/^\./, "");
  const images = {};
  for (const key of makeDirectionKeys(cols, rows)) {
    const absolute = `${root}/cell_${key.slice(1)}.${ext}`;
    images[key] = typeof resolvePath === "function" ? resolvePath(absolute) : absolute;
  }
  return images;
}

export { CELL_ANGLES, CENTER_KEY, DIRECTION_KEYS as MUG_FRAME_KEYS };
