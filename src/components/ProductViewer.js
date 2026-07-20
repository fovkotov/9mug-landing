/**
 * Directional product hero viewer.
 *
 * Vanilla mountable component with the same contract as <ProductViewer />:
 *   images, transitionDuration, deadZoneRadius,
 *   horizontalSensitivity, verticalSensitivity
 *
 * Interaction updates run through requestAnimationFrame and only mutate
 * image opacity — no React state / layout thrash during pointer move.
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

function preloadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function normalizeImages(images = {}) {
  const normalized = {};
  for (const key of DIRECTION_KEYS) {
    if (images[key]) normalized[key] = images[key];
  }
  return normalized;
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
  const transitionDuration = clamp(options.transitionDuration ?? 200, 150, 250);
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
  root.style.setProperty("--product-viewer-duration", `${transitionDuration}ms`);
  root.setAttribute("data-ready", "false");

  const stage = document.createElement("div");
  stage.className = "product-viewer__stage";
  root.append(stage);

  for (const key of DIRECTION_KEYS) {
    const src = images[key];
    if (!src) continue;

    const img = document.createElement("img");
    img.className = "product-viewer__frame";
    img.alt = "";
    img.draggable = false;
    img.decoding = "async";
    img.src = src;
    img.dataset.direction = key;
    img.style.opacity = key === "center" ? "1" : "0";
    stage.append(img);
    layerNodes.set(key, img);
  }

  function setActiveDirection(nextKey) {
    if (!layerNodes.has(nextKey) || nextKey === activeKey) return;
    const previous = layerNodes.get(activeKey);
    const next = layerNodes.get(nextKey);
    if (previous) previous.style.opacity = "0";
    if (next) next.style.opacity = "1";
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
      // Prefer direction alignment, then distance to the direction tip.
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
    const sources = DIRECTION_KEYS.map((key) => images[key]).filter(Boolean);
    await Promise.all(sources.map(preloadImage));
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
