import "./chrome.css";
import "./styles.css";
import "./shop.css";
import "./product.css";
import "./mat.css";
import "./checkout.css";
import "./footer.css";
import "./view-transitions.css";
import { setupMobileMenu } from "./mobile-menu.js";
import { bindProductOrientationHandoff } from "./device-orientation-permission.js";
import { initRadio } from "./radio.js";
import { startScroll } from "./scroll.js";
import { initTextStrokeHover } from "./text-stroke-hover.js";
import { beginPageType, flushPageType, typeShellOnce } from "./page-typewriter.js";

const PAGE_MODULES = {
  "index.html": () => import("./main.js"),
  "shop.html": () => import("./shop.js"),
  "product.html": () => import("./product.js"),
  "product-classic.html": () => import("./product-classic.js"),
  "mat.html": () => import("./mat.js"),
  "checkout.html": () => import("./checkout.js")
};

function currentPageFile() {
  const path = window.location.pathname.replace(/\/+$/, "");
  const last = path.split("/").filter(Boolean).pop() || "";
  if (!last || !last.includes(".")) return "index.html";
  return last;
}

async function bootCurrentPage() {
  const load = PAGE_MODULES[currentPageFile()];
  const page = document.querySelector("#page");
  if (!load || !page) return;
  const mod = await load();
  if (typeof mod.init === "function") await mod.init(page);
  beginPageType(page);
  flushPageType();
}

function boot() {
  if (document.documentElement.dataset.shellBound === "1") return;
  document.documentElement.dataset.shellBound = "1";
  initRadio();
  startScroll();
  setupMobileMenu();
  bindProductOrientationHandoff();
  initTextStrokeHover();
  typeShellOnce();
  void bootCurrentPage();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
