import { play } from "cuelume";
import { addQty, getCart, subscribeCart } from "./cart.js";
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

function applyOpenClass(el, next, instant) {
  if (next) {
    el.inert = false;
    el.setAttribute("aria-hidden", "false");
    if (instant) {
      const prev = el.style.transition;
      el.style.transition = "none";
      el.classList.add("is-open");
      void el.offsetHeight;
      el.style.transition = prev;
    } else {
      requestAnimationFrame(() => {
        el.classList.add("is-open");
      });
    }
    return;
  }

  if (instant) {
    const prev = el.style.transition;
    el.style.transition = "none";
    el.classList.remove("is-open");
    void el.offsetHeight;
    el.style.transition = prev;
  } else {
    el.classList.remove("is-open");
  }
  el.inert = true;
  el.setAttribute("aria-hidden", "true");
}

function renderItems(bag) {
  const items = bag.querySelector("[data-bag-items]");
  const total = bag.querySelector("[data-bag-total]");
  if (!items || !total) return;

  const cart = getCart();
  bag.classList.toggle("is-empty", cart.lines.length === 0);
  total.textContent = formatMoney(cart.total);

  if (!cart.lines.length) {
    items.innerHTML = `<p class="mobile-bag__empty">Bag is empty</p>`;
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
            <button type="button" class="mobile-bag__qty-btn" data-bag-minus data-id="${line.id}" aria-label="Decrease quantity"></button>
            <span class="mobile-bag__qty-value">${line.qty}</span>
            <button type="button" class="mobile-bag__qty-btn" data-bag-plus data-id="${line.id}" aria-label="Increase quantity">
              <span class="mobile-bag__plus-bar" aria-hidden="true"></span>
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

  bag = document.createElement("div");
  bag.id = "mobileBag";
  bag.className = "mobile-bag is-empty";
  bag.setAttribute("role", "dialog");
  bag.setAttribute("aria-modal", "true");
  bag.setAttribute("aria-label", "Bag");
  bag.setAttribute("aria-hidden", "true");
  bag.inert = true;
  bag.innerHTML = `
    <div class="mobile-bag__panel">
      <div class="mobile-bag__items" data-bag-items></div>
      <button type="button" class="mobile-bag__checkout" data-bag-checkout aria-label="Checkout">
        <img class="mobile-bag__checkout-shape" src="${checkoutSrc}" alt="" aria-hidden="true" draggable="false" />
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

  function setOpen(next, { instant = false } = {}) {
    if (open === next) return;
    open = next;
    document.body.classList.toggle("is-mobile-bag-open", next);
    applyOpenClass(bag, next, instant);
    if (next) renderItems(bag);
    onChange?.();
  }

  function isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function openBag() {
    if (!isMobile()) return;
    const switching = Boolean(isMenuOpen?.());
    if (switching) closeMenu?.({ instant: true });
    setOpen(true, { instant: switching });
  }

  function closeBag(opts) {
    setOpen(false, opts);
  }

  bagLink.addEventListener("click", (event) => {
    if (!isMobile()) return;
    event.preventDefault();
    playTick();
    if (open) {
      closeBag();
      return;
    }
    openBag();
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
  });

  subscribeCart(() => {
    if (open) renderItems(bag);
  });

  return {
    isOpen: () => open,
    open: openBag,
    close: closeBag
  };
}
