import { play } from "cuelume";
import { typewrite } from "./typewriter.js";
import "./mobile-menu.css";
import "./site-chrome.js";
import "./page-prefetch.js";
import { setupMobileBag } from "./mobile-bag.js";
import { toggleRadioIconPlayback } from "./radio.js";

function playTick() {
  try {
    play("tick");
  } catch {
    // Optional click feedback.
  }
}

function upgradeToggle() {
  const el = document.querySelector(".nav-mobile-center");
  if (!el) return null;
  if (el.tagName === "BUTTON") return el;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "mobileMenuBtn";
  btn.className = "nav-mobile-center";
  btn.setAttribute("aria-label", "Open menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "mobileMenu");
  btn.innerHTML =
    '<span class="nav-menu-icon" aria-hidden="true"><span></span><span></span></span>';
  el.replaceWith(btn);
  return btn;
}

function ensureOverlay() {
  let menu = document.querySelector("#mobileMenu");
  if (menu) return menu;

  const online = (document.querySelector(".nav-online")?.textContent?.trim() || "9 online").replace(
    /Online/g,
    "online"
  );
  const horse = document.querySelector(".horse-icon")?.getAttribute("src") || "/media/online-icon-figma.png";
  const playSrc =
    document.querySelector("#radioIcon")?.getAttribute("src") || "/media/radio-icon-play.png";
  const shopHref = document.querySelector(".nav-status")?.getAttribute("href") || "./shop.html";

  menu = document.createElement("div");
  menu.id = "mobileMenu";
  menu.className = "mobile-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-modal", "true");
  menu.setAttribute("aria-hidden", "true");
  menu.inert = true;
  menu.innerHTML = `
    <div class="mobile-menu__panel">
      <p class="mobile-menu__aside">Everything is&nbsp;practice</p>
      <button type="button" class="mobile-menu__audio-label" data-menu-radio>Radio</button>
      <button type="button" class="mobile-menu__play" data-menu-play aria-label="Play or pause">
        <img alt="" src="${playSrc}" width="68" height="70" />
      </button>
      <button type="button" class="mobile-menu__audio-label" data-menu-noise>Noise</button>
      <a class="mobile-menu__online" href="${shopHref}" aria-label="Open shop">
        <img alt="" src="${horse}" width="29" height="32" />
        <span>${online}</span>
      </a>
      <a class="mobile-menu__about" href="#">About</a>
    </div>
  `;
  document.body.append(menu);
  return menu;
}

function syncAudioUi(menu) {
  const radioBtn = document.querySelector("#radioBtn");
  const noiseBtn = document.querySelector("#noiseBtn");
  const radioIcon = document.querySelector("#radioIcon");
  const menuRadio = menu.querySelector("[data-menu-radio]");
  const menuNoise = menu.querySelector("[data-menu-noise]");
  const menuPlayImg = menu.querySelector("[data-menu-play] img");

  menuRadio?.classList.toggle("is-muted", radioBtn?.classList.contains("is-muted"));
  menuNoise?.classList.toggle("is-muted", noiseBtn?.classList.contains("is-muted"));
  if (menuPlayImg && radioIcon?.src) {
    menuPlayImg.src = radioIcon.src;
  }
}

export function setupMobileMenu() {
  if (document.documentElement.dataset.chromeBound === "1") return;
  document.documentElement.dataset.chromeBound = "1";

  const btn = upgradeToggle();
  const menu = ensureOverlay();
  if (!btn || !menu) return;

  let open = false;
  let bagApi = null;
  let stopTyping = () => {};

  let cartTouchY = null;

  const cartScroller = (event) => {
    const bag = event.target?.closest?.("#mobileBag");
    const node = bag?.querySelector("[data-bag-items]");
    return node instanceof HTMLElement ? node : null;
  };

  const wheelDeltaY = (event, scroller) => {
    let delta = event.deltaY || 0;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= scroller.clientHeight || window.innerHeight;
    return delta;
  };

  const cartCanScroll = (scroller, delta) => {
    if (!delta) return false;
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (max <= 1) return false;
    if (delta < 0 && scroller.scrollTop <= 0) return false;
    if (delta > 0 && scroller.scrollTop >= max - 1) return false;
    return true;
  };

  const blockPageScroll = (event) => {
    const inCart = Boolean(event.target?.closest?.(".mobile-bag__panel"));

    if (open && !(isBagOpen() && inCart)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!isBagOpen() || !inCart) return;

    const scroller = cartScroller(event);
    if (!scroller) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const onScroller = Boolean(event.target?.closest?.("[data-bag-items]"));

    if (event.type === "wheel") {
      const delta = wheelDeltaY(event, scroller);
      if (!onScroller) {
        if (cartCanScroll(scroller, delta)) scroller.scrollTop += delta;
        event.preventDefault();
      } else if (!cartCanScroll(scroller, delta)) {
        event.preventDefault();
      }
      event.stopPropagation();
      return;
    }

    if (event.type === "touchmove") {
      const y = event.touches?.[0]?.clientY;
      const delta = cartTouchY == null || y == null ? 0 : cartTouchY - y;
      if (y != null) cartTouchY = y;
      if (!onScroller || !cartCanScroll(scroller, delta)) event.preventDefault();
      event.stopPropagation();
    }
  };

  const trackCartTouch = (event) => {
    if (!isBagOpen()) return;
    if (!event.target?.closest?.(".mobile-bag__panel")) return;
    cartTouchY = event.touches?.[0]?.clientY ?? null;
  };

  function isBagOpen() {
    return Boolean(bagApi?.isOpen());
  }

  function syncScrollLock() {
    const menuLocked = open;
    document.documentElement.style.overflow = menuLocked ? "hidden" : "";
    document.body.style.overflow = menuLocked ? "hidden" : "";
    document.removeEventListener("touchstart", trackCartTouch);
    document.removeEventListener("touchmove", blockPageScroll);
    document.removeEventListener("wheel", blockPageScroll);
    if (menuLocked || isBagOpen()) {
      document.addEventListener("touchstart", trackCartTouch, { passive: true });
      document.addEventListener("touchmove", blockPageScroll, { passive: false });
      document.addEventListener("wheel", blockPageScroll, { passive: false });
    }
  }

  function applyOpenClass(el, next) {
    if (next) {
      el.inert = false;
      el.setAttribute("aria-hidden", "false");
      el.classList.add("is-open");
      return;
    }

    el.classList.remove("is-open");
    el.inert = true;
    el.setAttribute("aria-hidden", "true");
  }

  function syncToggleUi() {
    const anyOpen = open || isBagOpen();
    btn.setAttribute("aria-expanded", String(anyOpen));
    btn.setAttribute(
      "aria-label",
      open ? "Close menu" : isBagOpen() ? "Close cart" : "Open menu"
    );
  }

  function setOpen(next) {
    if (open === next) return;

    stopTyping();
    stopTyping = () => {};
    open = next;

    document.body.classList.toggle("is-mobile-menu-open", next);
    applyOpenClass(menu, next);
    syncToggleUi();
    syncScrollLock();

    if (!next) return;
    syncAudioUi(menu);
    stopTyping = typewrite(menu);
  }

  bagApi = setupMobileBag({
    isMenuOpen: () => open,
    closeMenu: (opts) => setOpen(false, opts),
    onChange: () => {
      syncToggleUi();
      syncScrollLock();
    }
  });

  btn.addEventListener("click", () => {
    playTick();
    if (isBagOpen()) {
      bagApi.close();
      return;
    }
    setOpen(!open);
  });

  menu.querySelector("[data-menu-radio]")?.addEventListener("click", () => {
    document.querySelector("#radioBtn")?.click();
    requestAnimationFrame(() => syncAudioUi(menu));
  });
  menu.querySelector("[data-menu-noise]")?.addEventListener("click", () => {
    document.querySelector("#noiseBtn")?.click();
    requestAnimationFrame(() => syncAudioUi(menu));
  });
  menu.querySelector("[data-menu-play]")?.addEventListener("click", () => {
    Promise.resolve(toggleRadioIconPlayback()).finally(() => syncAudioUi(menu));
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (isBagOpen()) {
      bagApi.close();
      return;
    }
    if (open) setOpen(false);
  });

  window.matchMedia("(max-width: 900px)").addEventListener("change", (event) => {
    if (event.matches) return;
    if (open) setOpen(false, { instant: true });
  });

  const radioIcon = document.querySelector("#radioIcon");
  if (radioIcon) {
    const observer = new MutationObserver(() => syncAudioUi(menu));
    observer.observe(radioIcon, { attributes: true, attributeFilter: ["src"] });
  }
}
