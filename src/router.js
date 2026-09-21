import { getScrollY, onScroll, resizeScroll, scrollToY } from "./scroll.js";

const LOADERS = {
  "index.html": () => import("./main.js"),
  "shop.html": () => import("./shop.js"),
  "product.html": () => import("./product.js"),
  "product-classic.html": () => import("./product-classic.js"),
  "mat.html": () => import("./mat.js"),
  "checkout.html": () => import("./checkout.js")
};

const SHELL_BODY_CLASSES = ["is-mobile-menu-open", "is-mobile-bag-open"];

let currentDestroy = () => {};
let navGeneration = 0;
let navigating = false;

export function routeFile(url) {
  const path = url.pathname.replace(/\/+$/, "");
  const last = path.split("/").filter(Boolean).pop() || "";
  if (!last || !last.includes(".")) return "index.html";
  return last;
}

function sameDocument(url) {
  const here = new URL(window.location.href);
  return url.pathname === here.pathname && url.search === here.search;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function syncDocumentChrome(doc) {
  if (doc.title) document.title = doc.title;
  const keep = SHELL_BODY_CLASSES.filter((name) => document.body.classList.contains(name));
  document.body.className = doc.body?.className || "";
  for (const name of keep) document.body.classList.add(name);
}

function focusPage(page) {
  if (!page) return;
  page.tabIndex = -1;
  page.focus({ preventScroll: true });
}

function announce(announcer) {
  if (!announcer) return;
  announcer.textContent = "";
  announcer.textContent = document.title;
}

async function mount(file, page, { focus }) {
  const load = LOADERS[file];
  if (!load || !page) return;
  const mod = await load();
  if (typeof mod.init !== "function") return;
  const destroy = await mod.init(page);
  currentDestroy = typeof destroy === "function" ? destroy : () => {};
  if (focus) focusPage(page);
  resizeScroll();
}

function swapPage(nextPage, doc) {
  const current = document.querySelector("#page");
  if (!current || !nextPage) return null;
  try {
    currentDestroy();
  } catch (error) {
    console.error(error);
  }
  currentDestroy = () => {};
  current.replaceWith(nextPage);
  syncDocumentChrome(doc);
  return document.querySelector("#page");
}

async function navigate(url, { pop = false, announcer } = {}) {
  const generation = ++navGeneration;
  const file = routeFile(url);
  if (!LOADERS[file]) {
    window.location.assign(url.href);
    return;
  }

  if (!pop) {
    const leaving = { ...(history.state || {}), spa: true, scrollY: getScrollY() };
    history.replaceState(leaving, "");
    history.pushState({ spa: true, scrollY: 0 }, "", `${url.pathname}${url.search}${url.hash}`);
  }

  navigating = true;
  try {
    let html = "";
    try {
      const response = await fetch(url.href, { credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      html = await response.text();
    } catch {
      if (generation !== navGeneration) return;
      window.location.assign(url.href);
      return;
    }
    if (generation !== navGeneration) return;

    const doc = new DOMParser().parseFromString(html, "text/html");
    const nextPage = doc.querySelector("#page");
    if (!nextPage || !document.querySelector("#page")) {
      window.location.assign(url.href);
      return;
    }

    let mod;
    try {
      mod = await LOADERS[file]();
    } catch (error) {
      console.error(error);
      if (generation !== navGeneration) return;
      window.location.assign(url.href);
      return;
    }
    if (generation !== navGeneration) return;

    const apply = () => {
      const page = swapPage(nextPage, doc);
      const y = pop ? Number(history.state?.scrollY) || 0 : 0;
      scrollToY(y);
      if (page && typeof mod.init === "function") {
        const destroy = mod.init(page);
        currentDestroy = typeof destroy === "function" ? destroy : () => {};
        focusPage(page);
      }
      resizeScroll();
      announce(announcer);
    };

    if (!prefersReducedMotion() && typeof document.startViewTransition === "function") {
      const transition = document.startViewTransition(() => {
        apply();
      });
      await transition.finished.catch(() => {});
    } else {
      apply();
    }
  } finally {
    if (generation === navGeneration) navigating = false;
  }
}

function onClick(event, announcer) {
  if (event.defaultPrevented) return;
  if (event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const link = event.target?.closest?.("a[href]");
  if (!link) return;
  if (link.target && link.target !== "_self") return;
  if (link.hasAttribute("download")) return;

  const raw = link.getAttribute("href") || "";
  if (!raw || raw.startsWith("#")) return;

  let url;
  try {
    url = new URL(link.href, window.location.href);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) return;

  const file = routeFile(url);
  if (!LOADERS[file]) return;
  if (sameDocument(url)) {
    if (url.hash) return;
    event.preventDefault();
    return;
  }

  event.preventDefault();
  void navigate(url, { announcer });
}

function onPop(announcer) {
  const url = new URL(window.location.href);
  if (!LOADERS[routeFile(url)]) {
    window.location.reload();
    return;
  }
  void navigate(url, { pop: true, announcer });
}

export function startRouter(announcer) {
  if (document.documentElement.dataset.spaRouter === "1") return;
  document.documentElement.dataset.spaRouter = "1";
  history.scrollRestoration = "manual";

  if (!history.state?.spa) {
    history.replaceState({ spa: true, scrollY: getScrollY() }, "");
  }

  const page = document.querySelector("#page");
  const file = routeFile(new URL(window.location.href));
  void mount(file, page, { focus: false });

  onScroll(() => {
    if (navigating) return;
    const state = history.state;
    if (!state?.spa) return;
    const scrollY = getScrollY();
    if (state.scrollY === scrollY) return;
    history.replaceState({ ...state, scrollY }, "");
  });

  document.addEventListener("click", (event) => onClick(event, announcer), true);
  window.addEventListener("popstate", () => onPop(announcer));
}
