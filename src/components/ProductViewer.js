/**
 * Directional product hero viewer.
 *
 * Vanilla mountable component with the same contract as <ProductViewer />:
 *   images, transitionDuration, deadZoneRadius,
 *   horizontalSensitivity, verticalSensitivity
 *
 * Interaction updates run through requestAnimationFrame and only mutate
 * z-index — frames stay fully painted to avoid decode flashes.
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

/** Direction tips in normalized cursor space (center handled by dead zone). */
const DIRECTION_VECTORS = {
  center: { x: 0, y: 0 },
  left: { x: -0.55, y: 0 },
  farLeft: { x: -1, y: 0 },
  right: { x: 0.55, y: 0 },
  farRight: { x: 1, y: 0 },
  up: { x: 0, y: -0.72 },
  down: { x: 0, y: 0.72 },
  upLeft: { x: -0.68, y: -0.68 },
  upRight: { x: 0.68, y: -0.68 },
  downLeft: { x: -0.68, y: 0.68 },
  downRight: { x: 0.68, y: 0.68 }
};

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function supportsFinePointer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
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
 *   deadZoneRadius?: number,
 *   horizontalSensitivity?: number,
 *   verticalSensitivity?: number,
 *   showZones?: boolean
 * }} options
 */
export function createProductViewer(root, options = {}) {
  if (!root) {
    throw new Error("ProductViewer requires a root element");
  }

  const images = normalizeImages(options.images);
  const deadZoneRadius = options.deadZoneRadius ?? 0.14;
  const horizontalSensitivity = options.horizontalSensitivity ?? 1;
  const verticalSensitivity = options.verticalSensitivity ?? 1;
  const showZones = Boolean(options.showZones);

  let destroyed = false;
  let ready = false;
  let activeKey = "center";
  let pointerInside = false;
  let latestPointer = null;
  let rafId = 0;
  let needsUpdate = false;
  let zoneCanvas = null;
  let zoneCtx = null;
  let zoneLabelLayer = null;
  let zoneResizeObserver = null;

  const layerNodes = new Map();
  const availableKeys = DIRECTION_KEYS.filter((key) => Boolean(images[key]));

  root.classList.add("product-viewer");
  root.classList.toggle("has-zones", showZones);
  root.setAttribute("data-ready", "false");

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

  function pickDirection(nx, ny) {
    const distance = Math.hypot(nx, ny);
    if (distance <= deadZoneRadius) return "center";

    let bestKey = "center";
    let bestScore = Number.POSITIVE_INFINITY;

    for (const key of availableKeys) {
      if (key === "center") continue;
      const vector = DIRECTION_VECTORS[key];
      const dx = nx - vector.x;
      const dy = ny - vector.y;
      const score = dx * dx + dy * dy;
      if (score < bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }

    return bestKey;
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

  function flushPointerUpdate() {
    rafId = 0;
    if (!ready || destroyed || !needsUpdate) return;
    needsUpdate = false;

    if (!pointerInside || !latestPointer) {
      setActiveDirection("center");
      return;
    }

    const { x, y } = computeNormalizedPointer(latestPointer.x, latestPointer.y);
    setActiveDirection(pickDirection(x, y));
  }

  function scheduleUpdate() {
    needsUpdate = true;
    if (rafId || !ready || destroyed) return;
    rafId = requestAnimationFrame(flushPointerUpdate);
  }

  function handlePointerEnter(event) {
    if (!supportsFinePointer()) return;
    pointerInside = true;
    latestPointer = { x: event.clientX, y: event.clientY };
    scheduleUpdate();
  }

  function handlePointerMove(event) {
    if (!supportsFinePointer()) return;
    pointerInside = true;
    latestPointer = { x: event.clientX, y: event.clientY };
    scheduleUpdate();
  }

  function handlePointerLeave() {
    pointerInside = false;
    latestPointer = null;
    scheduleUpdate();
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
    scheduleUpdate();
  }

  setupZoneOverlay();

  root.addEventListener("pointerenter", handlePointerEnter);
  root.addEventListener("pointermove", handlePointerMove);
  root.addEventListener("pointerleave", handlePointerLeave);

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
      zoneResizeObserver?.disconnect();
      window.removeEventListener("orientationchange", paintZoneOverlay);
      root.removeEventListener("pointerenter", handlePointerEnter);
      root.removeEventListener("pointermove", handlePointerMove);
      root.removeEventListener("pointerleave", handlePointerLeave);
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
