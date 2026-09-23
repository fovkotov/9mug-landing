import { typewrite } from "./typewriter.js";

/**
 * Page copy only. Modals own their strings: skip the bag and the mobile menu
 * so a page pass cannot blank them when they open. The bag total and checkout
 * label have their own typer (SVG grows, then the copy types).
 * Cart prices on the page sit in an aria-hidden mirror, so this list does not
 * use the modal default of skipping every aria-hidden node.
 */
const PAGE_SKIP = [
  "#mobileBag",
  "#mobileMenu",
  ".mobile-bag__total",
  ".mobile-bag__checkout-label",
  "input",
  "textarea",
  "select",
  "option",
  "script",
  "style",
  "noscript",
  ".visually-hidden",
  "[data-tsh-ignore]"
].join(", ");

let stopPage = () => {};
let shellTyped = false;

export function cancelPageTypewriter() {
  const stop = stopPage;
  stopPage = () => {};
  stop();
}

/** Blank the current page immediately. `flushPageType` starts the 22ms timer. */
export function beginPageType(page) {
  cancelPageTypewriter();
  if (!page?.isConnected) return;
  const stop = typewrite(page, { skipSelector: PAGE_SKIP, deferred: true });
  stopPage = typeof stop === "function" ? stop : () => {};
}

export function flushPageType() {
  if (typeof stopPage.start === "function") stopPage.start();
}

/** Header, radio, and cart label. Once per full load — never on a route swap. */
export function typeShellOnce() {
  if (shellTyped) return;
  shellTyped = true;
  const shell = document.querySelector(".top-nav");
  if (!shell) return;
  typewrite(shell, { skipSelector: PAGE_SKIP });
}
