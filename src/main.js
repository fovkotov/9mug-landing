import "./styles.css";
import { getLenis, onScroll, prefersReducedMotion, scrollTo } from "./scroll.js";

const slowEaseInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function setupPanelVideo(root, signal) {
  const section = root.querySelector("#section-mug");
  const video = root.querySelector("#homeVideo");
  if (!section || !video) return () => {};

  video.defaultMuted = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.loop = true;

  const sectionInView = () => {
    const rect = section.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight || 1;
    const visible = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
    return visible > viewport * 0.55;
  };

  const sync = () => {
    if (signal.aborted) return;
    if (!sectionInView()) {
      if (!video.paused) video.pause();
      return;
    }
    if (!video.paused && !video.ended) return;
    const pending = video.play();
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  };

  let observer = null;
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver(() => sync(), {
      threshold: [0, 0.25, 0.55, 0.75, 1]
    });
    observer.observe(section);
  } else {
    window.addEventListener("scroll", sync, { passive: true, signal });
  }

  window.addEventListener("resize", sync, { signal });
  sync();

  return () => {
    observer?.disconnect();
    if (!video.paused) video.pause();
  };
}

export function init(root) {
  const ac = new AbortController();
  const { signal } = ac;
  const releaseVideo = setupPanelVideo(root, signal);

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
    if (getLenis()) {
      scrollTo(section, {
        duration: 0.6,
        easing: slowEaseInOut
      });
      return;
    }
    section.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
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
    releaseVideo();
    offScroll();
    ac.abort();
  };
}
