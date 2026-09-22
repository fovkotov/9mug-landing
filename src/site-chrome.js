import { getCart, subscribeCart } from "./cart.js";
import "./site-chrome.css";

const PRACTICE_LABEL = "Everything is practice";

let unsubscribeCartNav = null;

function syncCartNav(cart = getCart()) {
  const count = Number(cart?.count) || 0;
  const link = document.querySelector(".nav-link-bag");
  if (link) link.textContent = count > 0 ? `Cart (${count})` : "Cart";

  const status = document.querySelector("#bagStatusText");
  if (!status) return;
  status.textContent = "";
  status.classList.remove("is-visible");
}

function bindCartNav() {
  unsubscribeCartNav?.();
  syncCartNav();
  unsubscribeCartNav = subscribeCart(syncCartNav);
}

export function setupSiteChrome() {
  bindCartNav();
  if (document.querySelector(".nav-practice")) return;

  const navLeft = document.querySelector(".nav-left");
  if (!navLeft) return;

  const label = document.createElement("p");
  label.className = "nav-practice";
  label.textContent = PRACTICE_LABEL;
  navLeft.append(label);
}

setupSiteChrome();
