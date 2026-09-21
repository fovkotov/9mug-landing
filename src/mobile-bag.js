import { play } from "cuelume";
import { addQty, getCart, goToCheckout, subscribeCart } from "./cart.js";
import "./mobile-bag.css";

const baseUrl = import.meta.env.BASE_URL ?? "/";
const CLOSE_MS = 500;
const DESKTOP_CLOSE_MS = 900;
const DESKTOP_MQ = "(min-width: 901px)";

function resolvePublicAssetPath(path) {
  if (!path) return "";
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  if (!path.startsWith("/")) return path;
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}${path}`;
}

function playTick() {
  try {
    play("tick");
  } catch {
    // Optional click feedback.
  }
}

function formatMoney(value) {
  return `$${value}`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function closeDuration() {
  if (prefersReducedMotion()) return 200;
  const desktop = window.matchMedia(DESKTOP_MQ).matches;
  const checkoutReady = document.querySelector("#mobileBag")?.classList.contains("is-checkout-ready");
  if (desktop && checkoutReady) return DESKTOP_CLOSE_MS;
  return CLOSE_MS;
}

const minusIconSrc = resolvePublicAssetPath("/media/bag/minus.svg");
const plusIconSrc = resolvePublicAssetPath("/media/bag/plus.svg");

function renderItems(bag) {
  const items = bag.querySelector("[data-bag-items]");
  const total = bag.querySelector("[data-bag-total]");
  if (!items || !total) return;

  const cart = getCart();
  bag.classList.toggle("is-empty", cart.lines.length === 0);
  total.textContent = formatMoney(cart.total);

  if (!cart.lines.length) {
    items.innerHTML = `<p class="mobile-bag__empty">Cart is empty</p>`;
    return;
  }

  items.innerHTML = cart.lines
    .map(
      (line) => `
      <article class="mobile-bag__item" data-bag-item="${line.id}">
        <img class="mobile-bag__image" src="${line.image}" alt="" />
        <div class="mobile-bag__row">
          <div class="mobile-bag__meta">
            <span class="mobile-bag__price">${formatMoney(line.price)}</span>
            <span class="mobile-bag__name">${line.name}</span>
          </div>
          <div class="mobile-bag__qty">
            <button type="button" class="mobile-bag__qty-btn" data-bag-minus data-id="${line.id}" aria-label="Decrease quantity">
              <img class="mobile-bag__qty-icon" src="${minusIconSrc}" alt="" width="10" height="1" draggable="false" />
            </button>
            <span class="mobile-bag__qty-value">${line.qty}</span>
            <button type="button" class="mobile-bag__qty-btn" data-bag-plus data-id="${line.id}" aria-label="Increase quantity">
              <img class="mobile-bag__qty-icon" src="${plusIconSrc}" alt="" width="10" height="10" draggable="false" />
            </button>
          </div>
        </div>
      </article>
    `
    )
    .join("");
}

function ensureOverlay() {
  let bag = document.querySelector("#mobileBag");
  if (bag) return bag;

  const checkoutSrc = resolvePublicAssetPath("/media/bag-checkout-shape.svg");
  const checkoutDesktopSrc = resolvePublicAssetPath("/media/bag-checkout-shape-desktop.svg");

  bag = document.createElement("div");
  bag.id = "mobileBag";
  bag.className = "mobile-bag is-empty";
  bag.setAttribute("role", "dialog");
  bag.setAttribute("aria-modal", "true");
  bag.setAttribute("aria-label", "Cart");
  bag.setAttribute("aria-hidden", "true");
  bag.inert = true;
  bag.innerHTML = `
    <div class="mobile-bag__scrim" aria-hidden="true"></div>
    <div class="mobile-bag__panel">
      <button type="button" class="mobile-bag__close" data-bag-close aria-label="Close cart">
        <span class="mobile-bag__close-icon" aria-hidden="true">
          <span></span>
          <span></span>
        </span>
      </button>
      <div class="mobile-bag__items" data-bag-items></div>
      <button type="button" class="mobile-bag__checkout" data-bag-checkout aria-label="Checkout">
        <span class="mobile-bag__checkout-wedge" aria-hidden="true">
          <img class="mobile-bag__checkout-shape mobile-bag__checkout-shape--mobile" src="${checkoutSrc}" alt="" draggable="false" />
          <img class="mobile-bag__checkout-shape mobile-bag__checkout-shape--desktop" src="${checkoutDesktopSrc}" alt="" draggable="false" />
        </span>
        <span class="mobile-bag__total" data-bag-total>$0</span>
        <span class="mobile-bag__checkout-label">Checkout</span>
      </button>
    </div>
  `;
  document.body.append(bag);
  renderItems(bag);
  return bag;
}

export function setupMobileBag({ isMenuOpen, closeMenu, onChange } = {}) {
  const bag = ensureOverlay();
  const bagLink = document.querySelector(".nav-link-bag");
  if (!bag || !bagLink) {
    return {
      isOpen: () => false,
      open() {},
      close() {}
    };
  }

  let open = false;
  let animTimer = 0;
  let checkoutTimer = 0;
  const closeBtn = bag.querySelector("[data-bag-close]");

  function syncBagLink() {
    bagLink.setAttribute("aria-expanded", String(open));
    bagLink.setAttribute("aria-controls", "mobileBag");
  }

  function finishClose() {
    bag.classList.remove("is-closing", "is-checkout-ready");
    bag.inert = true;
    bag.setAttribute("aria-hidden", "true");
  }

  function armCheckout() {
    window.clearTimeout(checkoutTimer);
    bag.classList.remove("is-checkout-ready");
    if (bag.classList.contains("is-empty")) return;
    const desktop = window.matchMedia(DESKTOP_MQ).matches;
    if (!desktop || bag.classList.contains("is-instant") || prefersReducedMotion()) {
      bag.classList.add("is-checkout-ready");
      return;
    }
    checkoutTimer = window.setTimeout(() => {
      if (!open || bag.classList.contains("is-empty")) return;
      bag.classList.add("is-checkout-ready");
    }, CLOSE_MS);
  }

  function setOpen(next, { instant = false } = {}) {
    const closing = bag.classList.contains("is-closing");
    if (open === next && !closing) return;

    window.clearTimeout(animTimer);
    window.clearTimeout(checkoutTimer);
    open = next;
    document.body.classList.toggle("is-mobile-bag-open", next);
    syncBagLink();

    if (next) {
      bag.classList.remove("is-closing");
      bag.inert = false;
      bag.setAttribute("aria-hidden", "false");
      renderItems(bag);

      bag.classList.toggle("is-instant", instant);
      bag.classList.add("is-open");
      armCheckout();

      closeBtn?.focus({ preventScroll: true });
      onChange?.();
      return;
    }

    bag.classList.toggle("is-instant", instant);

    if (instant) {
      bag.classList.remove("is-open");
      finishClose();
      bagLink.focus({ preventScroll: true });
      onChange?.();
      return;
    }

    bag.classList.add("is-closing");
    bag.classList.remove("is-open");
    onChange?.();
    animTimer = window.setTimeout(() => {
      finishClose();
      bagLink.focus({ preventScroll: true });
    }, closeDuration());
  }

  function openBag() {
    if (isMenuOpen?.()) closeMenu?.({ instant: true });
    setOpen(true);
  }

  function closeBag(opts) {
    setOpen(false, opts);
  }

  bagLink.addEventListener("click", (event) => {
    event.preventDefault();
    playTick();
    if (open) {
      closeBag();
      return;
    }
    openBag();
  });

  closeBtn?.addEventListener("click", () => {
    playTick();
    closeBag();
  });

  bag.querySelector("[data-bag-items]")?.addEventListener("click", (event) => {
    const minus = event.target.closest("[data-bag-minus]");
    const plus = event.target.closest("[data-bag-plus]");
    const control = minus || plus;
    if (!control) return;
    const id = control.getAttribute("data-id");
    if (!id) return;
    playTick();
    addQty(id, minus ? -1 : 1);
  });

  bag.querySelector("[data-bag-checkout]")?.addEventListener("click", () => {
    playTick();
    goToCheckout();
  });

  subscribeCart(() => {
    if (open) renderItems(bag);
  });

  syncBagLink();

  return {
    isOpen: () => open,
    open: openBag,
    close: closeBag
  };
}
