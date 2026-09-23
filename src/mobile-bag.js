import { play } from "cuelume";
import { addQty, getCart, goToCheckout, subscribeCart } from "./cart.js";
import { typewrite } from "./typewriter.js";
import "./mobile-bag.css";

const baseUrl = import.meta.env.BASE_URL ?? "/";

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

/** Matches `bag-checkout-grow` (0.4s). Typing starts on animationend; this is only a fallback. */
const BAR_GROW_MS = 400;

const minusIconSrc = resolvePublicAssetPath("/media/bag/minus.svg");
const plusIconSrc = resolvePublicAssetPath("/media/bag/plus.svg");

function renderItems(bag) {
  const items = bag.querySelector("[data-bag-items]");
  const total = bag.querySelector("[data-bag-total]");
  if (!items || !total) return;

  const cart = getCart();
  bag.classList.toggle("is-empty", cart.lines.length === 0);
  total.textContent = formatMoney(cart.total);
  const label = bag.querySelector(".mobile-bag__checkout-label");
  if (label) label.textContent = "Checkout";

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
    <div class="mobile-bag__panel" data-lenis-prevent>
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
  let stopTyping = () => {};
  let stopBarTyping = () => {};
  let barTimer = 0;
  const closeBtn = bag.querySelector("[data-bag-close]");

  function blankBarText() {
    const total = bag.querySelector("[data-bag-total]");
    const label = bag.querySelector(".mobile-bag__checkout-label");
    if (total) total.textContent = "";
    if (label) label.textContent = "";
  }

  function fillBarText() {
    const total = bag.querySelector("[data-bag-total]");
    const label = bag.querySelector(".mobile-bag__checkout-label");
    if (total) total.textContent = formatMoney(getCart().total);
    if (label) label.textContent = "Checkout";
  }

  function cancelBarCopy() {
    window.clearTimeout(barTimer);
    barTimer = 0;
    stopBarTyping();
    stopBarTyping = () => {};
    bag.classList.remove("is-checkout-copy");
  }

  function startBarType() {
    window.clearTimeout(barTimer);
    barTimer = 0;
    if (!open || prefersReducedMotion() || bag.classList.contains("is-empty")) return;
    if (bag.classList.contains("is-checkout-copy")) return;
    fillBarText();
    bag.classList.add("is-checkout-copy");
    const checkout = bag.querySelector("[data-bag-checkout]");
    stopBarTyping = typewrite(checkout, { skipSelector: "[aria-hidden='true']" });
  }

  function expectBarGrow() {
    window.clearTimeout(barTimer);
    barTimer = 0;
    stopBarTyping();
    stopBarTyping = () => {};
    if (!open || prefersReducedMotion() || bag.classList.contains("is-empty")) return;
    bag.classList.remove("is-checkout-copy");
    blankBarText();
    barTimer = window.setTimeout(startBarType, BAR_GROW_MS + 40);
  }

  function onBarGrowEnd(event) {
    if (event.animationName !== "bag-checkout-grow") return;
    const target = event.target;
    if (!(target instanceof Element) || !target.classList.contains("mobile-bag__checkout-shape")) return;
    startBarType();
  }

  function syncBagLink() {
    bagLink.setAttribute("aria-expanded", String(open));
    bagLink.setAttribute("aria-controls", "mobileBag");
  }

  function finishClose() {
    bag.classList.remove("is-closing", "is-checkout-ready", "is-instant", "is-checkout-copy");
    bag.inert = true;
    bag.setAttribute("aria-hidden", "true");
  }

  function setOpen(next) {
    if (open === next) return;

    stopTyping();
    stopTyping = () => {};
    cancelBarCopy();
    open = next;
    document.body.classList.toggle("is-mobile-bag-open", next);
    syncBagLink();

    if (next) {
      bag.inert = false;
      bag.setAttribute("aria-hidden", "false");
      renderItems(bag);
      bag.classList.add("is-open");
      stopTyping = typewrite(bag, {
        skipSelector: ".mobile-bag__close, .mobile-bag__checkout, [aria-hidden='true']"
      });
      expectBarGrow();
      closeBtn?.focus({ preventScroll: true });
      onChange?.();
      return;
    }

    bag.classList.remove("is-open");
    finishClose();
    bagLink.focus({ preventScroll: true });
    onChange?.();
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

  bag.querySelector(".mobile-bag__scrim")?.addEventListener("click", (event) => {
    if (event.target.closest(".mobile-bag__panel")) return;
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

  bag.addEventListener("animationend", onBarGrowEnd);

  subscribeCart(() => {
    if (!open) return;
    const wasEmpty = bag.classList.contains("is-empty");
    const waiting = barTimer !== 0 && !bag.classList.contains("is-checkout-copy");
    stopTyping();
    stopTyping = () => {};
    if (bag.classList.contains("is-checkout-copy")) {
      stopBarTyping();
      stopBarTyping = () => {};
    }
    renderItems(bag);
    if (bag.classList.contains("is-empty")) {
      cancelBarCopy();
      return;
    }
    if (wasEmpty) {
      expectBarGrow();
      return;
    }
    if (waiting && !prefersReducedMotion()) blankBarText();
  });

  syncBagLink();

  return {
    isOpen: () => open,
    open: openBag,
    close: closeBag
  };
}
