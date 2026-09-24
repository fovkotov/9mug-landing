import "./screen-loader.css";

const ICON_FILES = ["01.svg", "02.svg", "03.svg", "04.svg"];
const CYCLE_MS = 1000;

const SKIP_ANCESTOR = [
  ".screen-loader",
  ".product-viewer__loader",
  ".cart-bar",
  ".cart-bar-ui",
  ".hero-cursor",
  ".scratch-cursor",
  ".audio-controls",
  ".bag-group",
  ".nav-mobile-center"
].join(", ");

const HOST_SELECTOR = ".image-grid-cell, .scroll-video-sticky, .home-panel, .panel";

function publicUrl(path) {
  const base = import.meta.env.BASE_URL || "/";
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return `${normalized}${path.replace(/^\//, "")}`;
}

const ICONS = ICON_FILES.map((file) => publicUrl(`media/loader/${file}`));

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const loaderIcons = new Set();
const settledHosts = new WeakSet();
const watchedMedia = new WeakMap();

let iconIndex = 0;
let cycleTimer = 0;
let scanFrame = 0;
let pageRoot = null;

function prefersReducedMotion() {
  return reducedMotion.matches;
}

function currentIconSrc() {
  return prefersReducedMotion() ? ICONS[0] : ICONS[iconIndex];
}

function stopCycle() {
  if (!cycleTimer) return;
  window.clearInterval(cycleTimer);
  cycleTimer = 0;
}

function ensureCycle() {
  if (prefersReducedMotion() || cycleTimer || loaderIcons.size === 0) return;
  cycleTimer = window.setInterval(() => {
    iconIndex = (iconIndex + 1) % ICONS.length;
    const src = ICONS[iconIndex];
    for (const icon of loaderIcons) icon.src = src;
  }, CYCLE_MS);
}

function isContentMedia(el) {
  if (!(el instanceof HTMLImageElement || el instanceof HTMLVideoElement)) return false;
  if (el.classList.contains("screen-loader__icon")) return false;
  if (el.closest(SKIP_ANCESTOR)) return false;
  return Boolean(el.closest("#page"));
}

function isShown(el) {
  if (el.closest("[hidden]")) return false;
  if (el.classList.contains("product-viewer__frame") && !el.classList.contains("is-active")) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (Number.parseFloat(style.opacity) === 0) return false;
  return true;
}

function isSettled(el) {
  if (el instanceof HTMLImageElement) {
    if (!el.getAttribute("src") && !el.currentSrc) return false;
    if (el.complete && el.naturalWidth > 0) return true;
    return el.complete && el.naturalWidth === 0;
  }
  if (el instanceof HTMLVideoElement) {
    if (el.error) return true;
    return el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  }
  return true;
}

function hostFor(el) {
  return el.closest(HOST_SELECTOR);
}

function visibleContentMedia(host) {
  return [...host.querySelectorAll("img, video")].filter((el) => isContentMedia(el) && isShown(el));
}

function shouldHold(host, visible) {
  if (visible.length > 0) return false;
  return Boolean(host.querySelector("#productViewerRoot, .product-viewer-root, .product-viewer"));
}

function ensurePosition(host) {
  if (getComputedStyle(host).position !== "static") return;
  host.classList.add("is-loader-host");
}

function ensureLoader(host) {
  ensurePosition(host);
  let loader = host.querySelector(":scope > .screen-loader");
  if (!loader) {
    loader = document.createElement("div");
    loader.className = "screen-loader";
    loader.setAttribute("data-screen-loader", "");
    loader.setAttribute("aria-hidden", "true");
    const icon = document.createElement("img");
    icon.className = "screen-loader__icon";
    icon.alt = "";
    icon.draggable = false;
    icon.decoding = "sync";
    icon.src = currentIconSrc();
    loader.append(icon);
    host.append(loader);
  }
  const icon = loader.querySelector(".screen-loader__icon");
  if (icon instanceof HTMLImageElement && !loaderIcons.has(icon)) {
    if (!icon.getAttribute("src")) icon.src = currentIconSrc();
    loaderIcons.add(icon);
  }
  ensureCycle();
  return loader;
}

function dismissLoader(host) {
  const loader = host.querySelector(":scope > .screen-loader");
  if (!loader) return;
  const icon = loader.querySelector(".screen-loader__icon");
  if (icon) loaderIcons.delete(icon);
  loader.remove();
  if (loaderIcons.size === 0) stopCycle();
}

function watchMedia(el) {
  const src = el.currentSrc || el.getAttribute("src") || "";
  if (watchedMedia.get(el) === src) return;
  watchedMedia.set(el, src);
  const finish = () => {
    if ((el.currentSrc || el.getAttribute("src") || "") !== src) return;
    watchedMedia.delete(el);
    const paint = () => scheduleScan();
    if (typeof el.decode === "function") {
      el.decode().then(
        () => requestAnimationFrame(() => requestAnimationFrame(paint)),
        () => requestAnimationFrame(() => requestAnimationFrame(paint))
      );
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(paint));
  };
  if (isSettled(el)) finish();
  el.addEventListener("load", finish, { once: true });
  el.addEventListener("loadeddata", finish, { once: true });
  el.addEventListener("error", finish, { once: true });
}

function syncHost(host) {
  const viewerHost = Boolean(host.querySelector("#productViewerRoot, .product-viewer-root, .product-viewer"));
  if (settledHosts.has(host)) {
    if (viewerHost) return;
    const again = visibleContentMedia(host);
    if (again.length === 0 || again.every(isSettled)) return;
    settledHosts.delete(host);
  }

  const visible = visibleContentMedia(host);
  const pending = visible.filter((el) => !isSettled(el));

  if (visible.length > 0 && pending.length === 0) {
    settledHosts.add(host);
    dismissLoader(host);
    return;
  }

  if (pending.length === 0 && !shouldHold(host, visible)) {
    dismissLoader(host);
    return;
  }

  ensureLoader(host);
  for (const el of pending) watchMedia(el);
}

function scan() {
  if (!pageRoot) return;
  const hosts = new Set();
  for (const el of pageRoot.querySelectorAll("img, video")) {
    if (!isContentMedia(el)) continue;
    const host = hostFor(el);
    if (host) hosts.add(host);
  }
  for (const viewer of pageRoot.querySelectorAll("#productViewerRoot, .product-viewer-root")) {
    const host = viewer.closest(".panel, .home-panel") || viewer;
    hosts.add(host);
  }
  for (const host of hosts) syncHost(host);
}

function scheduleScan() {
  if (scanFrame) return;
  scanFrame = window.requestAnimationFrame(() => {
    scanFrame = 0;
    scan();
  });
}

function framesWereRebuilt(records) {
  const hosts = new Set();
  for (const record of records) {
    const removedFrame = [...record.removedNodes].some((node) => {
      if (node.nodeType !== 1) return false;
      return (
        node.classList?.contains("product-viewer__frame") ||
        Boolean(node.querySelector?.(".product-viewer__frame"))
      );
    });
    if (!removedFrame) continue;
    const target = record.target;
    const host = target.closest?.(".panel, .home-panel") || target;
    if (host) hosts.add(host);
  }
  return hosts;
}

function onMutations(records) {
  for (const host of framesWereRebuilt(records)) settledHosts.delete(host);
  scheduleScan();
}

reducedMotion.addEventListener("change", () => {
  if (prefersReducedMotion()) {
    stopCycle();
    iconIndex = 0;
    for (const icon of loaderIcons) icon.src = ICONS[0];
    return;
  }
  ensureCycle();
});

export function bindContentLoaders(doc = document) {
  const root = doc.querySelector("#page");
  if (!root || root.dataset.contentLoaderBound === "1") return;
  root.dataset.contentLoaderBound = "1";
  pageRoot = root;
  const observer = new MutationObserver(onMutations);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "class", "hidden"]
  });
  scan();
}
