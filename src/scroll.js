import Lenis from "lenis";

let lenis = null;
let rafId = 0;
let started = false;

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function getLenis() {
  return lenis;
}

export function getScrollY() {
  if (lenis) return lenis.scroll;
  return window.scrollY || 0;
}

export function startScroll() {
  if (started) return;
  started = true;
  if (prefersReducedMotion()) return;

  lenis = new Lenis({
    smoothWheel: true,
    wheelMultiplier: 1,
    syncTouch: true,
    touchMultiplier: 1.1,
    lerp: 0.09
  });

  const loop = (time) => {
    lenis.raf(time);
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

export function scrollTo(target, options = {}) {
  if (lenis) {
    lenis.scrollTo(target, options);
    return;
  }

  if (typeof target === "number") {
    window.scrollTo(0, target);
    return;
  }

  target?.scrollIntoView?.({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start"
  });
}

export function scrollToY(y) {
  scrollTo(y, { immediate: true, force: true });
}

export function resizeScroll() {
  lenis?.resize();
}

export function onScroll(fn) {
  if (lenis) {
    lenis.on("scroll", fn);
    return () => lenis.off("scroll", fn);
  }
  window.addEventListener("scroll", fn, { passive: true });
  return () => window.removeEventListener("scroll", fn);
}

export function stopScrollLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}
