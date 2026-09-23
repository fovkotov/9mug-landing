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
let ran = false;

export function cancelPageTypewriter() {
  const stop = stopPage;
  stopPage = () => {};
  stop();
}

/**
 * One pass per full document load: header chrome, then `#page` copy.
 * Call after the page module has finished init so dynamic labels are present.
 */
export function typePageOnLoad(page) {
  if (ran) return;
  ran = true;

  const shell = document.querySelector(".top-nav");
  if (shell) typewrite(shell, { skipSelector: PAGE_SKIP });

  if (!page?.isConnected) return;
  cancelPageTypewriter();
  const stop = typewrite(page, { skipSelector: PAGE_SKIP });
  stopPage = typeof stop === "function" ? stop : () => {};
}
