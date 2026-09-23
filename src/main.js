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
  const rawSrc = video.getAttribute("src") || "";
  let rafId = 0;
  let observer = null;
  let resizeObserver = null;
  let frameCallback = 0;
  let holdingPause = false;
  let holdingSeek = false;
  let desiredPlaying = false;
  let wasInView = false;
  let forcePresent = false;
  let showEpoch = 0;
  let shownEpoch = -1;
  let armedEpoch = -1;
  let nudgesThisEpoch = 0;
  let remounts = 0;
  let reloads = 0;
  let strayPauses = 0;
  const timers = new Set();

  const alive = () => generation === panelVideoGeneration && !signal.aborted;

  const sectionInView = () => {
    const rect = section.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight || 1;
    const visible = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
    return visible > viewport * 0.55;
  };

  const resolvedSrc = () => {
    if (!rawSrc) return "";
    try {
      return new URL(rawSrc, document.baseURI).href;
    } catch {
      return rawSrc;
    }
  };

  const cancelFrame = () => {
    if (frameCallback && typeof video.cancelVideoFrameCallback === "function") {
      video.cancelVideoFrameCallback(frameCallback);
    }
    frameCallback = 0;
  };

  const clearScheduled = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    cancelAnimationFrame(rafId);
    rafId = 0;
    cancelFrame();
  };

  const sourceBroken = () => {
    if (!video.getAttribute("src")) return true;
    if (video.error) return true;
    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) return true;
    return !video.currentSrc && video.readyState === 0 && video.networkState !== HTMLMediaElement.NETWORK_LOADING;
  };

  // Page swaps adopt a fresh <video> out of DOMParser. That node can sit at
  // NETWORK_NO_SOURCE with an empty currentSrc, and a view transition can
  // detach the compositor layer while play() has already flipped paused to
  // false. Put the element back and restart selection when the surface is gone.
  const ensureMounted = () => {
    const misplaced = video.parentElement !== section;
    const unsized = video.offsetWidth < 2 && section.offsetWidth > 2;
    if ((misplaced || unsized) && remounts < 4) {
      remounts += 1;
      const dim = section.querySelector(".home-video-dim");
      section.insertBefore(video, dim);
    }
    if (!sourceBroken() || reloads >= 4) return;
    const next = resolvedSrc();
    if (!next) return;
    reloads += 1;
    shownEpoch = -1;
    video.src = next;
  };

  const pauseOwned = () => {
    desiredPlaying = false;
    if (video.paused) return;
    holdingPause = true;
    video.pause();
    holdingPause = false;
  };

  const primeAttributes = () => {
    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.loop = true;
    video.preload = "auto";
  };

  const nudgeFrame = () => {
    if (video.readyState < 2 || video.videoWidth === 0) return false;
    const duration = video.duration;
    const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    let next = time + 0.034;
    if (Number.isFinite(duration) && duration > 0.1 && next >= duration) next = 0;
    holdingSeek = true;
    try {
      video.currentTime = next;
      return true;
    } catch {
      return false;
    } finally {
      holdingSeek = false;
    }
  };

  const armFrame = () => {
    if (typeof video.requestVideoFrameCallback !== "function") return;
    if (armedEpoch === showEpoch && frameCallback) return;
    const epoch = showEpoch;
    const token = generation;
    cancelFrame();
    armedEpoch = epoch;
    frameCallback = video.requestVideoFrameCallback(() => {
      frameCallback = 0;
      if (token !== panelVideoGeneration || !alive()) return;
      if (epoch !== showEpoch) return;
      if (video.readyState < 2 || video.videoWidth === 0) return;
      shownEpoch = epoch;
    });
  };

  const startPlay = () => {
    primeAttributes();
    if (!video.paused && !video.ended && video.readyState >= 2) return;
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

  const syncPlayback = () => {
    if (!alive()) return;
    const visible = sectionInView();

    if (!visible) {
      if (wasInView) {
        showEpoch += 1;
        nudgesThisEpoch = 0;
        forcePresent = true;
      }
      wasInView = false;
      strayPauses = 0;
      pauseOwned();
      return;
    }

    if (!wasInView) strayPauses = 0;
    wasInView = true;
    ensureMounted();

    const hasFrame = video.readyState >= 2 && video.videoWidth > 0;
    const hasBox = video.offsetWidth > 0 && video.offsetHeight > 0;
    const playing = !video.paused && !video.ended;
    const frameShown = shownEpoch === showEpoch;

    if (playing && hasFrame && hasBox && frameShown && !forcePresent) {
      desiredPlaying = true;
      return;
    }

    desiredPlaying = true;
    if (hasFrame && hasBox && forcePresent && nudgesThisEpoch < 2) {
      nudgesThisEpoch += 1;
      if (nudgeFrame()) forcePresent = false;
      // The seek is what puts pixels back. Wait for a frame from after it,
      // not from the blank layer the view transition already presented.
      armedEpoch = -1;
    }
    startPlay();
    armFrame();
  };

  const schedule = () => {
    if (!alive()) return;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      syncPlayback();
    });
  };

  const later = (delay, { resetBudget = false, reloadIfEmpty = false } = {}) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!alive()) return;
      if (resetBudget) strayPauses = 0;
      // Still no decoded frame well after settle: selection never started, or
      // the view-transition blanked a clip that play() left "unpaused".
      if (
        reloadIfEmpty &&
        sectionInView() &&
        video.readyState === 0 &&
        video.networkState !== HTMLMediaElement.NETWORK_LOADING &&
        reloads < 4 &&
        rawSrc
      ) {
        reloads += 1;
        shownEpoch = -1;
        const next = resolvedSrc();
        if (next) video.src = next;
      }
      if (sectionInView() && shownEpoch !== showEpoch) forcePresent = true;
      schedule();
    }, delay);
    timers.add(id);
  };

  // The root view-transition hides the live tree. Chrome pauses the clip, and
  // even when play() leaves paused false the captured layer is often blank:
  // currentTime advances over a black section. Scroll usually does not move
  // on the way back, so settle/loadeddata/canplay have to present a frame.
  const kick = () => {
    if (!alive()) return;
    strayPauses = 0;
    showEpoch += 1;
    nudgesThisEpoch = 0;
    forcePresent = true;
    schedule();
    later(80, { resetBudget: true });
    later(420, { resetBudget: true, reloadIfEmpty: true });
  };

  const onMediaReady = () => {
    if (!alive()) return;
    schedule();
  };

  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver(() => schedule(), {
      threshold: [0, 0.25, 0.5, 0.75, 1]
    });
    observer.observe(section);
  }

  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(() => schedule());
    resizeObserver.observe(section);
  }

  const offScroll = onScroll(schedule);
  window.addEventListener("resize", schedule, { signal });
  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) kick();
    },
    { signal }
  );
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
      if (!alive() || holdingPause || holdingSeek || !desiredPlaying || !sectionInView()) return;
      if (strayPauses >= 8) return;
      strayPauses += 1;
      later(120);
    },
    { signal }
  );
  video.addEventListener("loadeddata", onMediaReady, { signal });
  video.addEventListener("canplay", onMediaReady, { signal });
  video.addEventListener(
    "error",
    () => {
      if (!alive()) return;
      shownEpoch = -1;
      if (reloads < 4 && rawSrc) {
        reloads += 1;
        const next = resolvedSrc();
        if (next) video.src = next;
      }
      schedule();
    },
    { signal }
  );

  kick();

  return () => {
    panelVideoGeneration += 1;
    desiredPlaying = false;
    holdingPause = true;
    forcePresent = false;
    clearScheduled();
    observer?.disconnect();
    observer = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
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
