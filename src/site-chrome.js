import { getCart, subscribeCart } from "./cart.js";
import "./site-chrome.css";

const PRACTICE_LABEL = "Everything is practice";
const LANG_KEY = "9pra-lang";
const LANGS = {
  en: { label: "EN", name: "English" },
  ru: { label: "RU", name: "Russian" }
};

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

function readLang() {
  try {
    const value = localStorage.getItem(LANG_KEY);
    if (value === "en" || value === "ru") return value;
  } catch {
    // Private mode can reject storage reads.
  }
  return "en";
}

function applyLang(lang) {
  const code = lang === "ru" ? "ru" : "en";
  const button = document.querySelector(".nav-lang");
  const entry = LANGS[code];
  if (button) {
    button.textContent = entry.label;
    button.dataset.lang = code;
    button.setAttribute("aria-label", entry.name);
    button.lang = code;
  }
  document.documentElement.lang = code;
}

function bindLangToggle() {
  const button = document.querySelector(".nav-lang");
  if (!button || button.dataset.bound === "1") return;
  button.dataset.bound = "1";
  applyLang(readLang());
  button.addEventListener("click", () => {
    const next = button.dataset.lang === "ru" ? "en" : "ru";
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // Keep the visible toggle even when storage is blocked.
    }
    applyLang(next);
  });
}

export function setupSiteChrome() {
  bindCartNav();
  bindLangToggle();
  if (document.querySelector(".nav-practice")) return;

  const navLeft = document.querySelector(".nav-left");
  if (!navLeft) return;

  const label = document.createElement("p");
  label.className = "nav-practice";
  label.textContent = PRACTICE_LABEL;
  navLeft.append(label);
}

setupSiteChrome();
