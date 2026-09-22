import { play } from "cuelume";
import "./shop.css";
import { onScroll, scrollTo } from "./scroll.js";

const baseUrl = import.meta.env.BASE_URL ?? "/";

function resolvePublicAssetPath(path) {
  if (!path) return "";
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  if (!path.startsWith("/")) return path;
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}${path}`;
}

const slowEaseInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function init(root) {
  const ac = new AbortController();
  const { signal } = ac;

  const priceToggle = root.querySelector("#priceToggle");
  const priceToggleIcon = root.querySelector("#priceToggleIcon");
  const pricePlusIconSource = resolvePublicAssetPath("/media/price-plus.svg");
  const priceCheckIconSource = resolvePublicAssetPath("/media/price-check-crisp.png");
  let bagSelected = false;

  function playButtonTick() {
    try {
      play("tick");
    } catch {
      // Optional click feedback.
    }
  }

  function setBagUiState() {
    priceToggle?.classList.toggle("is-selected", bagSelected);
    priceToggle?.setAttribute("aria-pressed", String(bagSelected));
    if (priceToggleIcon) {
      priceToggleIcon.src = bagSelected ? priceCheckIconSource : pricePlusIconSource;
    }
  }

  function toggleBagState() {
    playButtonTick();
    bagSelected = !bagSelected;
    setBagUiState();
  }

  priceToggle?.addEventListener("click", () => toggleBagState(), { signal });
  priceToggleIcon?.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      toggleBagState();
    },
    { signal }
  );
  priceToggle?.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleBagState();
    },
    { signal }
  );

  setBagUiState();

  const sectionLinks = [...root.querySelectorAll("[data-section-link]")];
  const homeSections = sectionLinks
    .map((link) => {
      const id = link.getAttribute("href")?.slice(1);
      const section = id ? root.querySelector(`#${CSS.escape(id)}`) : null;
      return section ? { link, section } : null;
    })
    .filter(Boolean);

  function setActiveSectionLink(activeLink) {
    for (const { link } of homeSections) {
      link.classList.toggle("is-active", link === activeLink);
    }
  }

  function getActiveSectionIndex() {
    if (!homeSections.length) return 0;

    const viewportCenter = window.innerHeight * 0.5;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    homeSections.forEach(({ section }, index) => {
      const rect = section.getBoundingClientRect();
      const sectionCenter = rect.top + rect.height / 2;
      const distance = Math.abs(sectionCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    return closestIndex;
  }

  function syncSectionIndicators() {
    if (!homeSections.length) return;
    const activeIndex = getActiveSectionIndex();
    setActiveSectionLink(homeSections[activeIndex].link);
  }

  function scrollToSection(section) {
    if (!section) return;
    scrollTo(section, { duration: 0.6, easing: slowEaseInOut });
  }

  for (const { link, section } of homeSections) {
    link.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        setActiveSectionLink(link);
        scrollToSection(section);
      },
      { signal }
    );
  }

  syncSectionIndicators();
  const offScroll = onScroll(syncSectionIndicators);
  window.addEventListener("resize", syncSectionIndicators, { signal });

  return () => {
    offScroll();
    ac.abort();
  };
}
