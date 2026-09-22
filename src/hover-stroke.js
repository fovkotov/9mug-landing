import "./hover-stroke.css";

const STORAGE_KEY = "hoverStroke:v1";
const DEFAULTS = { enabled: true, radius: 6, stroke: 4, core: 0, falloff: 1.5 };
const FIELDS = [
  { key: "radius", label: "Radius", min: 2, max: 60, step: 1, unit: "px" },
  { key: "stroke", label: "Stroke", min: 0, max: 8, step: 0.25, unit: "px" },
  { key: "core", label: "Core", min: 0, max: 90, step: 1, unit: "%" },
  { key: "falloff", label: "Falloff", min: 0.3, max: 4, step: 0.1, unit: "" }
];
const MASK_STEPS = 8;
const SKIP_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION", "SCRIPT", "STYLE", "VIDEO", "AUDIO", "IMG", "SVG"]);

const desktopQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
const active = new Set();
const eligibility = new WeakMap();

let settings = loadSettings();
let pointerX = 0;
let pointerY = 0;
let hasPointer = false;
let framePending = false;
let panel = null;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return { ...DEFAULTS, ...(saved && typeof saved === "object" ? saved : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

function applyGlobals() {
  const root = document.documentElement.style;
  const core = Math.min(Math.max(settings.core, 0), 99);
  const stops = [];
  for (let i = 0; i <= MASK_STEPS; i += 1) {
    const t = i / MASK_STEPS;
    const alpha = Math.pow(1 - t, settings.falloff);
    stops.push(`rgba(0,0,0,${alpha.toFixed(3)}) ${(core + (100 - core) * t).toFixed(2)}%`);
  }
  root.setProperty("--hs-r", `${settings.radius}px`);
  root.setProperty("--hs-w", `${settings.stroke}px`);
  root.setProperty("--hs-stops", stops.join(", "));
}

function parseColor(value) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return { rgb: "0, 0, 0", alpha: 1 };
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { rgb: parts.slice(0, 3).join(", "), alpha: parts.length > 3 ? parts[3] : 1 };
}

function isEligible(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.childElementCount > 0 || SKIP_TAGS.has(el.tagName)) return false;
  if (!el.textContent.trim()) return false;
  if (el.closest("[data-hs-ignore]")) return false;
  if (active.has(el)) return true;
  let ok = eligibility.get(el);
  if (ok === undefined) {
    ok = getComputedStyle(el, "::after").content === "none";
    eligibility.set(el, ok);
  }
  return ok;
}

function collectHosts(x, y, radius) {
  const hosts = new Set();
  const points = [
    [x, y],
    [x - radius, y],
    [x + radius, y],
    [x, y - radius],
    [x, y + radius]
  ];
  for (const [px, py] of points) {
    for (const el of document.elementsFromPoint(px, py)) {
      if (isEligible(el)) hosts.add(el);
    }
  }
  return hosts;
}

function activate(el) {
  if (active.has(el)) return;
  const style = getComputedStyle(el);
  const { rgb, alpha } = parseColor(style.color);
  el.style.setProperty("--hs-rgb", rgb);
  el.style.setProperty("--hs-a", String(alpha));
  el.dataset.hsText = el.textContent;
  el.classList.add("hs-host");
  if (style.position === "static") el.classList.add("hs-host--rel");
  active.add(el);
}

function deactivate(el) {
  el.classList.remove("hs-host", "hs-host--rel");
  el.style.removeProperty("--hs-x");
  el.style.removeProperty("--hs-y");
  el.style.removeProperty("--hs-rgb");
  el.style.removeProperty("--hs-a");
  delete el.dataset.hsText;
  active.delete(el);
}

function clearAll() {
  for (const el of [...active]) deactivate(el);
}

function update() {
  framePending = false;
  if (!settings.enabled || !hasPointer || !desktopQuery.matches || settings.stroke <= 0) {
    clearAll();
    return;
  }
  const radius = settings.radius;
  for (const el of collectHosts(pointerX, pointerY, radius)) activate(el);

  for (const el of [...active]) {
    if (!el.isConnected) {
      active.delete(el);
      continue;
    }
    const rect = el.getBoundingClientRect();
    const dx = Math.max(rect.left - pointerX, 0, pointerX - rect.right);
    const dy = Math.max(rect.top - pointerY, 0, pointerY - rect.bottom);
    if (dx * dx + dy * dy > radius * radius) {
      deactivate(el);
      continue;
    }
    if (el.dataset.hsText !== el.textContent) el.dataset.hsText = el.textContent;
    el.style.setProperty("--hs-x", `${pointerX - rect.left - el.clientLeft}px`);
    el.style.setProperty("--hs-y", `${pointerY - rect.top - el.clientTop}px`);
  }
}

function schedule() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(update);
}

function onPointerMove(event) {
  if (event.pointerType && event.pointerType !== "mouse") return;
  pointerX = event.clientX;
  pointerY = event.clientY;
  hasPointer = true;
  schedule();
}

function onPointerLeave() {
  hasPointer = false;
  schedule();
}

function formatValue(field, value) {
  const digits = field.step < 1 ? (field.step < 0.1 ? 2 : 1) : 0;
  return `${Number(value).toFixed(digits)}${field.unit}`;
}

function buildPanel() {
  const root = document.createElement("div");
  root.className = "hs-panel";
  root.dataset.hsIgnore = "";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Hover stroke settings");

  const rows = FIELDS.map(
    (field) => `
      <label class="hs-panel__row">
        <span class="hs-panel__label">${field.label}</span>
        <input type="range" data-key="${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" />
        <output class="hs-panel__value" data-output="${field.key}"></output>
      </label>`
  ).join("");

  root.innerHTML = `
    <div class="hs-panel__head">
      <span class="hs-panel__title">Hover stroke</span>
      <button type="button" class="hs-panel__close" data-action="close" aria-label="Close">×</button>
    </div>
    <label class="hs-panel__row hs-panel__row--toggle">
      <span class="hs-panel__label">Enabled</span>
      <input type="checkbox" data-key="enabled" />
    </label>
    ${rows}
    <div class="hs-panel__foot">
      <button type="button" class="hs-panel__reset" data-action="reset">Reset</button>
      <span class="hs-panel__hint">G — show / hide</span>
    </div>`;

  root.addEventListener("input", (event) => {
    const input = event.target;
    const key = input?.dataset?.key;
    if (!key) return;
    settings[key] = input.type === "checkbox" ? input.checked : Number(input.value);
    syncPanel();
    applyGlobals();
    saveSettings();
    schedule();
  });

  root.addEventListener("click", (event) => {
    const action = event.target?.closest?.("[data-action]")?.dataset.action;
    if (action === "close") togglePanel(false);
    if (action === "reset") {
      settings = { ...DEFAULTS };
      syncPanel();
      applyGlobals();
      saveSettings();
      schedule();
    }
  });

  document.body.append(root);
  return root;
}

function syncPanel() {
  if (!panel) return;
  panel.querySelector('[data-key="enabled"]').checked = settings.enabled;
  for (const field of FIELDS) {
    panel.querySelector(`[data-key="${field.key}"]`).value = String(settings[field.key]);
    panel.querySelector(`[data-output="${field.key}"]`).textContent = formatValue(field, settings[field.key]);
  }
}

function togglePanel(force) {
  if (!panel) panel = buildPanel();
  const open = typeof force === "boolean" ? force : panel.hidden;
  panel.hidden = !open;
  if (open) syncPanel();
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  return target.tagName === "INPUT" && !["range", "checkbox", "button"].includes(target.type);
}

function onKeyDown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (isTypingTarget(event.target)) return;
  const key = event.key?.toLowerCase();
  if (event.code === "KeyG" || key === "g" || key === "п") {
    event.preventDefault();
    togglePanel();
    return;
  }
  if (event.key === "Escape" && panel && !panel.hidden) togglePanel(false);
}

export function initHoverStroke() {
  if (document.documentElement.dataset.hoverStroke === "1") return;
  document.documentElement.dataset.hoverStroke = "1";
  applyGlobals();
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("spa:settled", schedule);
  window.addEventListener("keydown", onKeyDown);
}
