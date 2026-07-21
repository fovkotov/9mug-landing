/**
 * Directional product hero viewer.
 *
 * Desktop: mouse look-around.
 * Mobile: DeviceOrientation (calibrated) with touch-drag fallback.
 *
 * Interaction updates only set target orientation; rendering runs in rAF.
 */

const DIRECTION_KEYS = [
  "center",
  "left",
  "farLeft",
  "right",
  "farRight",
  "up",
  "down",
  "upLeft",
  "upRight",
  "downLeft",
  "downRight"
];

const ZONE_LABELS = {
  center: "center",
  left: "left",
  farLeft: "far_left",
  right: "right",
  farRight: "far_right",
  up: "up",
  down: "down",
  upLeft: "up_left",
  upRight: "up_right",
  downLeft: "down_left",
  downRight: "down_right"
};

const ZONE_COLORS = {
  center: [255, 255, 255],
  left: [80, 160, 255],
  farLeft: [40, 100, 220],
  right: [255, 150, 80],
  farRight: [230, 90, 40],
  up: [120, 220, 140],
  down: [220, 120, 200],
  upLeft: [90, 200, 200],
  upRight: [200, 200, 90],
  downLeft: [180, 120, 255],
  downRight: [255, 120, 160]
};

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

function needsOrientationPermission() {
  return (
    orientationApiAvailable() &&
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  );
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

function orientationApiAvailable() {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
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
  let activeKey = "center";
  let zoneCanvas = null;
  let zoneCtx = null;
  let zoneLabelLayer = null;
  let zoneResizeObserver = null;
  let motionGate = null;
  let motionGateButton = null;

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
    img.classList.toggle("is-active", key === "center");
    stage.append(img);
    layerNodes.set(key, img);
  }

  function firstAvailable(...keys) {
    for (const key of keys) {
      if (availableKeys.includes(key)) return key;
    }
    return availableKeys.includes("center") ? "center" : availableKeys[0];
  }

  /** Axis-aligned rectangular zones (shared by mouse / orientation / touch). */
  function pickDirection(nx, ny) {
    const inMidBand = Math.abs(ny) <= deadZoneHalfHeight;

    if (inMidBand) {
      if (nx < -sideFarBoundary) return firstAvailable("farLeft", "left", "center");
      if (nx < -deadZoneHalfWidth) return firstAvailable("left", "farLeft", "center");
      if (nx <= deadZoneHalfWidth) return firstAvailable("center");
      if (nx <= sideFarBoundary) return firstAvailable("right", "farRight", "center");
      return firstAvailable("farRight", "right", "center");
    }

    if (ny < -deadZoneHalfHeight) {
      if (nx < -deadZoneHalfWidth) return firstAvailable("upLeft", "up", "left", "center");
      if (nx > deadZoneHalfWidth) return firstAvailable("upRight", "up", "right", "center");
      return firstAvailable("up", "center");
    }

    if (nx < -deadZoneHalfWidth) return firstAvailable("downLeft", "down", "left", "center");
    if (nx > deadZoneHalfWidth) return firstAvailable("downRight", "down", "right", "center");
    return firstAvailable("down", "center");
  }

  function computeNormalizedFromLocal(localX, localY, width, height) {
    const maxX = Math.max(width / 2, 1);
    const maxY = Math.max(height / 2, 1);
    return {
      x: clamp((localX / maxX) * horizontalSensitivity, -1.75, 1.75),
      y: clamp((localY / maxY) * verticalSensitivity, -1.2, 1.2)
    };
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

    const previous = layerNodes.get(activeKey);
    const next = layerNodes.get(nextKey);
    previous?.classList.remove("is-active");
    next?.classList.add("is-active");
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

    const imageData = zoneCtx.createImageData(cols, rows);
    const data = imageData.data;
    const centroids = Object.fromEntries(availableKeys.map((key) => [key, { x: 0, y: 0, n: 0 }]));

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
        const color = ZONE_COLORS[key] || [200, 200, 200];
        const index = (row * cols + col) * 4;
        data[index] = color[0];
        data[index + 1] = color[1];
        data[index + 2] = color[2];
        data[index + 3] = key === "center" ? 48 : 72;

        const bucket = centroids[key];
        if (bucket) {
          bucket.x += px;
          bucket.y += py;
          bucket.n += 1;
        }
      }
    }

    zoneCtx.putImageData(imageData, 0, 0);

    if (!zoneLabelLayer) return;
    zoneLabelLayer.replaceChildren();

    for (const key of availableKeys) {
      const bucket = centroids[key];
      if (!bucket || bucket.n === 0) continue;

      const label = document.createElement("span");
      label.className = "product-viewer__zone-label";
      label.dataset.key = key;
      label.textContent = ZONE_LABELS[key] || key;
      label.style.left = `${(bucket.x / bucket.n / width) * 100}%`;
      label.style.top = `${(bucket.y / bucket.n / height) * 100}%`;
      label.classList.toggle("is-active", key === activeKey);
      zoneLabelLayer.append(label);
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

  function hideMotionGate() {
    if (!motionGate) return;
    motionGate.hidden = true;
    root.classList.remove("has-motion-gate");
  }

  function showMotionGate(mode = "ask") {
    if (!motionGate || !motionGateButton) return;
    motionGate.hidden = false;
    root.classList.add("has-motion-gate");
    if (mode === "denied") {
      motionGate.dataset.state = "denied";
      motionGateButton.textContent = "Движение недоступно — листай пальцем";
    } else if (mode === "loading") {
      motionGate.dataset.state = "loading";
      motionGateButton.textContent = "Запрос доступа…";
      motionGateButton.disabled = true;
    } else {
      motionGate.dataset.state = "ask";
      motionGateButton.disabled = false;
      motionGateButton.textContent = needsOrientationPermission()
        ? "Разрешить доступ к движению"
        : "Включить движение";
    }
  }

  async function requestOrientationPermission() {
    if (!orientationApiAvailable()) {
      return false;
    }

    // Android / desktop browsers: no permission prompt API.
    if (!needsOrientationPermission()) {
      orientationPermission = "granted";
      return true;
    }

    try {
      const requests = [DeviceOrientationEvent.requestPermission()];
      if (
        typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function"
      ) {
        requests.push(DeviceMotionEvent.requestPermission());
      }

      const results = await Promise.all(requests);
      const granted = results.every((result) => result === "granted");
      orientationPermission = granted ? "granted" : "denied";
      return granted;
    } catch (error) {
      // Do not permanently lock out on transient gesture errors.
      console.warn("Device orientation permission failed", error);
      orientationPermission = "unknown";
      return false;
    }
  }

  async function enableOrientationMode() {
    if (prefersMouse || orientationActive || destroyed || orientationRequesting) return false;

    orientationRequesting = true;
    showMotionGate("loading");

    const granted = await requestOrientationPermission();
    orientationRequesting = false;

    if (!granted) {
      touchEnabled = true;
      root.setAttribute("data-input", "touch");
      showMotionGate(orientationPermission === "denied" ? "denied" : "ask");
      // Keep a short denied hint, then allow using the page.
      if (orientationPermission === "denied") {
        window.setTimeout(() => hideMotionGate(), 1800);
      }
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
    hideMotionGate();
    startOrientationListening();
    ensureLoop();
    return true;
  }

  function setupMotionGate() {
    if (!mobileInput || !orientationApiAvailable()) {
      if (mobileInput) {
        root.setAttribute("data-input", "touch");
      }
      return;
    }

    motionGate = document.createElement("div");
    motionGate.className = "product-viewer__motion-gate";
    motionGate.dataset.state = "ask";

    const copy = document.createElement("p");
    copy.className = "product-viewer__motion-gate-copy";
    copy.textContent = "Чтобы кружка реагировала на наклон телефона, нужен доступ к движению устройства.";

    motionGateButton = document.createElement("button");
    motionGateButton.type = "button";
    motionGateButton.className = "product-viewer__motion-gate-btn";
    motionGateButton.textContent = needsOrientationPermission()
      ? "Разрешить доступ к движению"
      : "Включить движение";

    // Must stay inside a direct user gesture for iOS permission dialogs.
    motionGateButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void enableOrientationMode();
    });

    motionGate.append(copy, motionGateButton);
    root.append(motionGate);
    root.classList.add("has-motion-gate");
  }

  // —— Touch fallback ——
  function handleTouchPointerDown(event) {
    if (prefersMouse || !touchEnabled || !canInteract()) return;
    if (event.pointerType === "mouse") return;
    // Don't start a drag when tapping the permission button.
    if (event.target?.closest?.(".product-viewer__motion-gate")) return;

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
    }
    ensureLoop();
  }

  setupZoneOverlay();
  setupVisibility();
  setupMotionGate();

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
 * Semantic image map helper — filenames map 1:1 to keys.
 * Swap the folder/basePath to replace the product later.
 */
export function createMugFrameImages(resolvePath, basePath = "/media/mug_frames") {
  const fileMap = {
    center: "center.webp",
    left: "left.webp",
    farLeft: "far_left.webp",
    right: "right.webp",
    farRight: "far_right.webp",
    up: "up.webp",
    down: "down.webp",
    upLeft: "up_left.webp",
    upRight: "up_right.webp",
    downLeft: "down_left.webp",
    downRight: "down_right.webp"
  };

  const images = {};
  for (const [key, fileName] of Object.entries(fileMap)) {
    const absolute = `${basePath.replace(/\/$/, "")}/${fileName}`;
    images[key] = typeof resolvePath === "function" ? resolvePath(absolute) : absolute;
  }
  return images;
}
