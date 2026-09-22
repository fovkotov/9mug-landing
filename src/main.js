import "./styles.css";
import { getLenis, onScroll, prefersReducedMotion, scrollTo } from "./scroll.js";

const slowEaseInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * Bumped on every home destroy. In-flight play() callbacks from a previous
 * visit capture the old value and must not pause the video a newer visit owns.
 */
let panelVideoGeneration = 0;

function setupPanelVideo(root, signal) {
  const section = root.querySelector("#section-mug");
  const video = root.querySelector("#homeVideo");
  if (!section || !video) return () => {};

  const generation = ++panelVideoGeneration;
  let rafId = 0;
  let observer = null;
  let holdingPause = false;
  let desiredPlaying = false;
  let wasInView = false;
  let strayPauses = 0;
  const timers = new Set();

  const alive = () => generation === panelVideoGeneration && !signal.aborted;

  const sectionInView = () => {
    const rect = section.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight || 1;
    const visible = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
    return visible > viewport * 0.55;
  };

  const clearScheduled = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const pauseOwned = () => {
    desiredPlaying = false;
    if (video.paused) return;
    holdingPause = true;
    video.pause();
    holdingPause = false;
  };

  const syncPlayback = () => {
    if (!alive()) return;
    const visible = sectionInView();
    if (visible && !wasInView) strayPauses = 0;
    wasInView = visible;

    if (!visible) {
      strayPauses = 0;
      pauseOwned();
      return;
    }

    if (!video.paused && !video.ended) {
      desiredPlaying = true;
      return;
    }

    desiredPlaying = true;
    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.loop = true;
    const token = generation;
    const pending = video.play();
    if (!pending || typeof pending.then !== "function") return;
    pending
      .then(() => {
        // Captured token: a previous visit must not pause the video this visit started.
        if (token !== panelVideoGeneration) return;
        if (!alive() || desiredPlaying) return;
        holdingPause = true;
        if (!video.paused) video.pause();
        holdingPause = false;
      })
      .catch((error) => {
        if (token !== panelVideoGeneration || !alive()) return;
        if (error?.name === "NotAllowedError") desiredPlaying = false;
      });
  };

  const schedule = () => {
    if (!alive()) return;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      syncPlayback();
    });
  };

  const later = (delay, resetBudget) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!alive()) return;
      if (resetBudget) strayPauses = 0;
      schedule();
    }, delay);
    timers.add(id);
  };

  // The root view-transition hides the live tree and Chrome pauses the video.
  // Scroll position often does not change on the way back, so nothing else
  // asks it to play again after the snapshot is gone.
  const kick = () => {
    if (!alive()) return;
    strayPauses = 0;
    schedule();
    later(80, true);
    later(420, true);
  };

  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver(() => schedule(), {
      threshold: [0, 0.25, 0.5, 0.75, 1]
    });
    observer.observe(section);
  }

  const offScroll = onScroll(schedule);
  window.addEventListener("resize", schedule, { signal });
  window.addEventListener("spa:settled", kick, { signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState !== "visible") return;
      kick();
    },
    { signal }
  );
  video.addEventListener(
    "pause",
    () => {
      if (!alive() || holdingPause || !desiredPlaying || !sectionInView()) return;
      if (strayPauses >= 8) return;
      strayPauses += 1;
      later(120, false);
    },
    { signal }
  );
  video.addEventListener("canplay", schedule, { signal });

  kick();

  return () => {
    panelVideoGeneration += 1;
    desiredPlaying = false;
    holdingPause = true;
    clearScheduled();
    observer?.disconnect();
    observer = null;
    offScroll();
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
