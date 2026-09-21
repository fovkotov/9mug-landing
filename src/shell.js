import "./chrome.css";
import "./styles.css";
import "./shop.css";
import "./product.css";
import "./mat.css";
import "./checkout.css";
import "./view-transitions.css";
import { setupMobileMenu } from "./mobile-menu.js";
import { bindProductOrientationHandoff } from "./device-orientation-permission.js";
import { initRadio } from "./radio.js";
import { startScroll } from "./scroll.js";
import { startRouter } from "./router.js";

function ensureAnnouncer() {
  let announcer = document.querySelector("#routeAnnouncer");
  if (announcer) return announcer;
  announcer = document.createElement("div");
  announcer.id = "routeAnnouncer";
  announcer.className = "visually-hidden";
  announcer.setAttribute("aria-live", "polite");
  document.body.append(announcer);
  return announcer;
}

function boot() {
  if (document.documentElement.dataset.spaShell === "1") return;
  document.documentElement.dataset.spaShell = "1";
  initRadio();
  startScroll();
  setupMobileMenu();
  bindProductOrientationHandoff();
  startRouter(ensureAnnouncer());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
