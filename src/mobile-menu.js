import { play } from "cuelume";
import "./mobile-menu.css";
import "./site-chrome.js";
import { setupMobileBag } from "./mobile-bag.js";

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

  const online = document.querySelector(".nav-online")?.textContent?.trim() || "9 online";
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
      <a class="mobile-menu__about" href="#">About</a>
      <button type="button" class="mobile-menu__play" data-menu-play aria-label="Play or pause">
        <img alt="" src="${playSrc}" width="68" height="70" />
      </button>
      <button type="button" class="mobile-menu__audio-label" data-menu-radio>Radio</button>
      <button type="button" class="mobile-menu__audio-label" data-menu-noise>Noise</button>
      <p class="mobile-menu__aside">Everything is&nbsp;practice</p>
      <a class="mobile-menu__online" href="${shopHref}" aria-label="Open shop">
        <span>${online}</span>
        <img alt="" src="${horse}" width="29" height="32" />
      </a>
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
  const btn = upgradeToggle();
  const menu = ensureOverlay();
  if (!btn || !menu) return;

  let open = false;
  let bagApi = null;

  const blockPageScroll = (event) => {
    if (event.target.closest?.(".mobile-bag__items")) return;
    event.preventDefault();
  };

  function isBagOpen() {
    return Boolean(bagApi?.isOpen());
  }

  function syncScrollLock() {
    const locked = open || isBagOpen();
    document.documentElement.style.overflow = locked ? "hidden" : "";
    document.body.style.overflow = locked ? "hidden" : "";
    document.removeEventListener("touchmove", blockPageScroll);
    document.removeEventListener("wheel", blockPageScroll);
    if (locked) {
      document.addEventListener("touchmove", blockPageScroll, { passive: false });
      document.addEventListener("wheel", blockPageScroll, { passive: false });
    }
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

  function syncToggleUi() {
    const anyOpen = open || isBagOpen();
    btn.setAttribute("aria-expanded", String(anyOpen));
    btn.setAttribute(
      "aria-label",
      open ? "Close menu" : isBagOpen() ? "Close bag" : "Open menu"
    );
  }

  function setOpen(next, { instant = false } = {}) {
    if (open === next) return;
    open = next;

    document.body.classList.toggle("is-mobile-menu-open", next);
    applyOpenClass(menu, next, instant);
    syncToggleUi();
    syncScrollLock();

    if (next) syncAudioUi(menu);
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
    document.querySelector("#radioIcon")?.click();
    requestAnimationFrame(() => syncAudioUi(menu));
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
    bagApi?.close({ instant: true });
  });

  const radioIcon = document.querySelector("#radioIcon");
  if (radioIcon) {
    const observer = new MutationObserver(() => syncAudioUi(menu));
    observer.observe(radioIcon, { attributes: true, attributeFilter: ["src"] });
  }
}
