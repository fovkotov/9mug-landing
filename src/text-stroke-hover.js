import "./text-stroke-hover.css";

const STORAGE_KEY = "text-stroke-hover:v3";
const DESKTOP_QUERY = "(min-width: 901px) and (pointer: fine)";
const DEFAULTS = { enabled: true, maxStroke: 6.2, radius: 80, falloff: 1 };
const SVG_NS = "http://www.w3.org/2000/svg";
const FIELD_STOPS = 16;
const PRESS_SCALE = 0.5;
const PRESS_MS = 180;
const MAX_STROKE = 10;
const MAX_RINGS = 20;
const MIN_DIRECTIONS = 16;
const DIRECTION_SPACING = 0.8;
const SKIP_TAGS = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "VIDEO",
  "AUDIO",
  "IMG",
  "SVG",
  "CANVAS",
  "IFRAME",
  "BR",
  "WBR"
]);
const TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "radio",
  "range",
  "reset",
  "submit"
]);

const desktopQuery = window.matchMedia(DESKTOP_QUERY);
const active = new Set();
const afterOk = new WeakMap();
const filters = new Map();

let defs = null;
let filterSeq = 0;
let fieldHref = "";

let settings = loadSettings();
let cache = [];
let cacheDirty = true;
let pointerX = 0;
let pointerY = 0;
let hasPointer = false;
let framePending = false;
let panel = null;
let pressedLink = null;
let pressFrom = 1;
let pressTo = 1;
let pressStart = 0;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

function loadSettings() {
  const next = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return next;
    if (typeof saved.enabled === "boolean") next.enabled = saved.enabled;
    next.maxStroke = num(saved.maxStroke, DEFAULTS.maxStroke, 0, MAX_STROKE);
    next.radius = num(saved.radius, DEFAULTS.radius, 0, 80);
    next.falloff = num(saved.falloff, DEFAULTS.falloff, 0.4, 4);
  } catch {
    return { ...DEFAULTS };
  }
  return next;
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode and full storage can reject the write.
  }
}

/* strength = (1 - distance / radius) ^ falloff — 1 at the pointer, 0 at the radius edge.
   The field is a radial alpha image; a pixel next to a glyph is painted when its distance to the
   outline is at most strength * maxStroke / 2, so the stroke width follows the pointer continuously. */
function buildFieldHref(falloff) {
  const stops = [];
  for (let i = 0; i <= FIELD_STOPS; i += 1) {
    const t = i / FIELD_STOPS;
    const alpha = (1 - t) ** falloff;
    stops.push(`<stop offset='${t.toFixed(4)}' stop-color='black' stop-opacity='${alpha.toFixed(4)}'/>`);
  }
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'>" +
    `<defs><radialGradient id='g' cx='100' cy='100' r='100' gradientUnits='userSpaceOnUse'>${stops.join("")}</radialGradient></defs>` +
    "<rect width='200' height='200' fill='url(#g)'/></svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function ringCount(outward) {
  return clamp(Math.ceil(outward * Math.max(1, window.devicePixelRatio || 1) * 2), 4, MAX_RINGS);
}

/* Rings of text-shadow copies around the glyph; gray encodes closeness to the outline
   (white on the glyph, black at maxStroke / 2) and nearer rings paint on top.
   Gray, not a color channel: macOS color management mixes pure channels when converting to P3. */
function buildDistanceShadows(outward) {
  if (outward <= 0) return "none";
  const rings = ringCount(outward);
  const shadows = [];
  for (let j = 1; j <= rings; j += 1) {
    const r = (outward * j) / rings;
    const gray = Math.round(255 * (1 - j / rings));
    const directions = Math.max(MIN_DIRECTIONS, Math.ceil((Math.PI * 2 * r) / DIRECTION_SPACING));
    for (let k = 0; k < directions; k += 1) {
      const a = (Math.PI * 2 * k) / directions;
      shadows.push(`${(Math.cos(a) * r).toFixed(3)}px ${(Math.sin(a) * r).toFixed(3)}px 0 rgb(${gray},${gray},${gray})`);
    }
  }
  return shadows.join(",");
}

function applyGlobals() {
  fieldHref = buildFieldHref(settings.falloff);
  document.documentElement.style.setProperty("--tsh-shadow", buildDistanceShadows(settings.maxStroke / 2));
  clearAll();
}

function ensureDefs() {
  if (defs?.isConnected) return defs;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  svg.dataset.tshIgnore = "";
  defs = document.createElementNS(SVG_NS, "defs");
  svg.append(defs);
  document.body.append(svg);
  return defs;
}

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/* grow = (closeness + strength - 1) sharpened to ~1 device pixel, i.e. distance <= strength * outward. */
function createFilter() {
  const id = `tsh-f-${(filterSeq += 1)}`;
  const rings = ringCount(settings.maxStroke / 2);
  const filter = svgEl("filter", {
    id,
    filterUnits: "userSpaceOnUse",
    primitiveUnits: "userSpaceOnUse",
    "color-interpolation-filters": "sRGB"
  });
  const image = svgEl("feImage", { href: fieldHref, preserveAspectRatio: "none", result: "field" });
  filter.append(image);
  filter.append(
    svgEl("feColorMatrix", {
      in: "SourceGraphic",
      type: "matrix",
      values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0",
      result: "close"
    })
  );
  filter.append(
    svgEl("feColorMatrix", {
      in: "SourceGraphic",
      type: "matrix",
      values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${rings} 0 0 0 ${1 - rings}`,
      result: "glyph"
    })
  );
  const sum = svgEl("feComposite", {
    in: "close",
    in2: "field",
    operator: "arithmetic",
    k1: 0,
    k2: 1,
    k3: 1,
    k4: -1,
    result: "sum"
  });
  filter.append(sum);
  const sharpen = svgEl("feComponentTransfer", { in: "sum", result: "grow" });
  sharpen.append(svgEl("feFuncA", { type: "linear", slope: rings, intercept: 0 }));
  filter.append(sharpen);
  const merge = svgEl("feMerge", { result: "shape" });
  merge.append(svgEl("feMergeNode", { in: "glyph" }));
  merge.append(svgEl("feMergeNode", { in: "grow" }));
  filter.append(merge);
  const flood = svgEl("feFlood", { "flood-color": "#000" });
  filter.append(flood);
  filter.append(svgEl("feComposite", { in2: "shape", operator: "in" }));
  ensureDefs().append(filter);
  return { id, filter, image, flood, sum, scale: 1 };
}

function canUseAfter(el) {
  if (active.has(el)) return true;
  let ok = afterOk.get(el);
  if (ok === undefined) {
    ok = getComputedStyle(el, "::after").content === "none";
    afterOk.set(el, ok);
  }
  return ok;
}

function isCandidate(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.childElementCount > 0 || SKIP_TAGS.has(el.tagName)) return false;
  if (!el.textContent.trim()) return false;
  if (el.closest("[data-tsh-ignore], svg, input, textarea, select")) return false;
  return canUseAfter(el);
}

function rebuildCache() {
  cache = [];
  if (!document.body) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (isCandidate(node)) cache.push(node);
    node = walker.nextNode();
  }
  cacheDirty = false;
}

function distToRect(x, y, rect) {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return dx * dx + dy * dy;
}

function deactivate(el) {
  el.classList.remove("tsh-host", "tsh-host--rel");
  el.style.removeProperty("--tsh-filter");
  delete el.dataset.tshText;
  filters.get(el)?.filter.remove();
  filters.delete(el);
  active.delete(el);
}

function clearAll() {
  for (const el of [...active]) deactivate(el);
}

function canRun() {
  return desktopQuery.matches && settings.enabled && hasPointer && settings.maxStroke > 0;
}

function isFormField(el) {
  if (!(el instanceof Element)) return false;
  if (el.isContentEditable) return true;
  return !!el.closest("input, textarea, select");
}

function isFormUnderPointer(x, y) {
  return isFormField(document.elementFromPoint(x, y));
}

function pressScaleAt(now) {
  const t = clamp((now - pressStart) / PRESS_MS, 0, 1);
  const eased = 1 - (1 - t) ** 3;
  return pressFrom + (pressTo - pressFrom) * eased;
}

function setPress(link) {
  const now = performance.now();
  const current = pressedLink && pressedLink === (link || pressedLink) ? pressScaleAt(now) : 1;
  if (link) pressedLink = link;
  pressFrom = current;
  pressTo = link ? PRESS_SCALE : 1;
  pressStart = now;
  schedule();
}

function onPointerDown(event) {
  if (event.pointerType === "touch" || event.button !== 0) return;
  if (!desktopQuery.matches) return;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (link) setPress(link);
}

function onPointerRelease() {
  if (pressedLink && pressTo !== 1) setPress(null);
}

function update() {
  framePending = false;
  const now = performance.now();
  const scale = pressedLink ? pressScaleAt(now) : 1;
  const pressAnimating = pressedLink && now - pressStart < PRESS_MS;
  if (pressedLink && !pressAnimating && pressTo === 1) pressedLink = null;
  if (!canRun() || isFormUnderPointer(pointerX, pointerY)) {
    clearAll();
    if (pressAnimating) schedule();
    return;
  }
  if (cacheDirty) rebuildCache();

  const limit = settings.radius * settings.radius;
  const hits = [];
  for (const el of cache) {
    if (!el.isConnected) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    if (distToRect(pointerX, pointerY, rect) > limit) continue;
    hits.push({
      el,
      x: pointerX - rect.left - el.clientLeft,
      y: pointerY - rect.top - el.clientTop,
      width: el.clientWidth || rect.width,
      height: el.clientHeight || rect.height,
      color: getComputedStyle(el).color,
      position: active.has(el) ? "" : getComputedStyle(el).position,
      text: el.textContent
    });
  }

  const keep = new Set();
  for (const hit of hits) {
    keep.add(hit.el);
    let fx = filters.get(hit.el);
    if (!fx) {
      fx = createFilter();
      filters.set(hit.el, fx);
    }
    const r = settings.radius;
    const pad = Math.ceil(settings.maxStroke / 2) + 4;
    fx.filter.setAttribute("x", -pad);
    fx.filter.setAttribute("y", -pad);
    fx.filter.setAttribute("width", hit.width + pad * 2);
    fx.filter.setAttribute("height", hit.height + pad * 2);
    fx.image.setAttribute("x", hit.x - r);
    fx.image.setAttribute("y", hit.y - r);
    fx.image.setAttribute("width", r * 2);
    fx.image.setAttribute("height", r * 2);
    fx.flood.setAttribute("flood-color", hit.color);
    const hostScale = pressedLink?.contains(hit.el) ? scale : 1;
    if (fx.scale !== hostScale) {
      fx.scale = hostScale;
      fx.sum.setAttribute("k3", hostScale);
    }
    if (hit.el.dataset.tshText !== hit.text) hit.el.dataset.tshText = hit.text;
    if (!active.has(hit.el)) {
      hit.el.style.setProperty("--tsh-filter", `url(#${fx.id})`);
      if (hit.position === "static") hit.el.classList.add("tsh-host--rel");
      hit.el.classList.add("tsh-host");
      active.add(hit.el);
    }
  }
  for (const el of [...active]) {
    if (!keep.has(el)) deactivate(el);
  }
  if (pressAnimating) schedule();
}

function schedule() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(update);
}

function onPointerMove(event) {
  if (event.pointerType === "touch") return;
  if (!desktopQuery.matches) return;
  pointerX = event.clientX;
  pointerY = event.clientY;
  hasPointer = true;
  schedule();
}

function onPointerLeave() {
  hasPointer = false;
  schedule();
}

function formatValue(key, value) {
  if (key === "maxStroke") return `${Number(value).toFixed(1)}px`;
  if (key === "radius") return `${Math.round(Number(value))}px`;
  return Number(value).toFixed(1);
}

function syncPanel() {
  if (!panel) return;
  panel.querySelector('[data-key="enabled"]').checked = settings.enabled;
  for (const key of ["maxStroke", "radius", "falloff"]) {
    panel.querySelector(`[data-key="${key}"]`).value = String(settings[key]);
    panel.querySelector(`[data-output="${key}"]`).textContent = formatValue(key, settings[key]);
  }
}

function buildPanel() {
  const root = document.createElement("div");
  root.className = "tsh-panel";
  root.dataset.tshIgnore = "";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Text stroke");
  root.innerHTML = `
    <div class="tsh-panel__head">
      <p class="tsh-panel__title">Text stroke</p>
      <button type="button" class="tsh-panel__close" data-action="close">Close</button>
    </div>
    <label class="tsh-panel__row tsh-panel__row--toggle">
      <span>On</span>
      <input type="checkbox" data-key="enabled" />
    </label>
    <label class="tsh-panel__row">
      <span>Stroke</span>
      <input type="range" data-key="maxStroke" min="0" max="${MAX_STROKE}" step="0.1" />
      <output class="tsh-panel__value" data-output="maxStroke"></output>
    </label>
    <label class="tsh-panel__row">
      <span>Radius</span>
      <input type="range" data-key="radius" min="0" max="80" step="1" />
      <output class="tsh-panel__value" data-output="radius"></output>
    </label>
    <label class="tsh-panel__row">
      <span>Falloff</span>
      <input type="range" data-key="falloff" min="0.4" max="4" step="0.1" />
      <output class="tsh-panel__value" data-output="falloff"></output>
    </label>
    <p class="tsh-panel__hint">G — show or hide</p>`;

  root.addEventListener("input", (event) => {
    const input = event.target;
    const key = input?.dataset?.key;
    if (!key || !(key in settings)) return;
    settings[key] = input.type === "checkbox" ? input.checked : Number(input.value);
    if (key === "maxStroke") settings.maxStroke = clamp(settings.maxStroke, 0, MAX_STROKE);
    if (key === "radius") settings.radius = clamp(settings.radius, 0, 80);
    if (key === "falloff") settings.falloff = clamp(settings.falloff, 0.4, 4);
    syncPanel();
    applyGlobals();
    saveSettings();
    schedule();
  });

  root.addEventListener("click", (event) => {
    if (event.target?.closest?.("[data-action='close']")) togglePanel(false);
  });

  document.body.append(root);
  return root;
}

function togglePanel(force) {
  if (!desktopQuery.matches) {
    if (panel) panel.hidden = true;
    return;
  }
  if (!panel) panel = buildPanel();
  const open = typeof force === "boolean" ? force : panel.hidden;
  panel.hidden = !open;
  if (open) syncPanel();
}

function isTypingTarget(target) {
  const el = target instanceof Element ? target : document.activeElement;
  if (!(el instanceof Element)) return false;
  if (el.closest("[data-tsh-ignore]")) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el.getAttribute("type") || "text").toLowerCase();
  return !TEXT_INPUT_TYPES.has(type);
}

function onKeyDown(event) {
  if (event.key === "Escape" && panel && !panel.hidden && !isTypingTarget(event.target)) {
    togglePanel(false);
    return;
  }
  if (event.code !== "KeyG") return;
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!desktopQuery.matches) return;
  if (isTypingTarget(event.target)) return;
  event.preventDefault();
  togglePanel();
}

export function initTextStrokeHover() {
  if (document.documentElement.dataset.textStrokeHover === "1") return;
  document.documentElement.dataset.textStrokeHover = "1";
  applyGlobals();
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("resize", () => {
    cacheDirty = true;
    if (!desktopQuery.matches) {
      hasPointer = false;
      clearAll();
      if (panel) panel.hidden = true;
    }
  });
  desktopQuery.addEventListener("change", () => {
    if (!desktopQuery.matches) {
      hasPointer = false;
      clearAll();
      if (panel) panel.hidden = true;
    }
  });
  document.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerRelease, { passive: true });
  window.addEventListener("pointercancel", onPointerRelease, { passive: true });
  window.addEventListener("blur", onPointerRelease);
  window.addEventListener("spa:settled", () => {
    pressedLink = null;
    pressTo = 1;
    cacheDirty = true;
    schedule();
  });
  if (document.body) {
    const observer = new MutationObserver(() => {
      cacheDirty = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  window.addEventListener("keydown", onKeyDown);
}
