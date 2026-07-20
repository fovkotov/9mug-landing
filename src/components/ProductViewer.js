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
 *   verticalSensitivity?: number
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

  let destroyed = false;
  let ready = false;
  let activeKey = "center";
  let pointerInside = false;
  let latestPointer = null;
  let rafId = 0;
  let needsUpdate = false;

  const layerNodes = new Map();

  root.classList.add("product-viewer");
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
    img.fetchPriority = key === "center" ? "high" : "high";
    img.src = src;
    img.dataset.direction = key;
    img.classList.toggle("is-active", key === "center");
    stage.append(img);
    layerNodes.set(key, img);
  }

  function setActiveDirection(nextKey) {
    if (!layerNodes.has(nextKey) || nextKey === activeKey) return;

    const previous = layerNodes.get(activeKey);
    const next = layerNodes.get(nextKey);
    previous?.classList.remove("is-active");
    next?.classList.add("is-active");
    activeKey = nextKey;
    root.dataset.direction = nextKey;
  }

  function pickDirection(nx, ny) {
    const distance = Math.hypot(nx, ny);
    if (distance <= deadZoneRadius) return "center";

    let bestKey = "center";
    let bestScore = Number.POSITIVE_INFINITY;

    for (const key of DIRECTION_KEYS) {
      if (key === "center" || !layerNodes.has(key)) continue;
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

  function computeNormalizedPointer(clientX, clientY) {
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }

    const localX = clientX - rect.left - rect.width / 2;
    const localY = clientY - rect.top - rect.height / 2;
    const maxX = Math.max(rect.width / 2, 1);
    const maxY = Math.max(rect.height / 2, 1);

    return {
      x: clamp((localX / maxX) * horizontalSensitivity, -1.75, 1.75),
      y: clamp((localY / maxY) * verticalSensitivity, -1.2, 1.2)
    };
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
    // Warm HTTP cache first, then decode every mounted frame before interaction.
    await preloadMugFrameImages(images);
    if (destroyed) return;

    await Promise.all([...layerNodes.values()].map(waitForFramePainted));
    if (destroyed) return;

    // Force a paint pass so every layer is composited before first switch.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (destroyed) return;

    ready = true;
    root.setAttribute("data-ready", "true");
    root.classList.add("is-ready");
    scheduleUpdate();
  }

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
