/**
 * Previous product-page first-screen interaction (slide click / drag / custom cursor).
 * Kept intact so it can be restored via HERO_INTERACTION_MODE = "legacy-slides".
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function setupLegacySlidesHero({
  heroPanel,
  heroDesktopImage,
  heroMobileImage,
  heroDragSlider,
  metaSwitcher,
  metaSwitchFirst,
  metaSwitchSecond,
  mugSwitchButtons,
  resolvePublicAssetPath,
  isMobileViewport,
  playButtonTick
}) {
  if (!heroPanel) return { destroy() {} };

  const heroCursorArrowSource = resolvePublicAssetPath("/media/hero-cursor-custom.png");
  const heroSlideSources = [
    { desktopSrc: "/media/hero-desktop.png", mobileSrc: "/media/hero-mobile.png" },
    { desktopSrc: "/media/hero-switch-2.png", mobileSrc: "/media/hero-switch-2.png" },
    { desktopSrc: "/media/hero-switch-4.png", mobileSrc: "/media/hero-switch-4.png" },
    { desktopSrc: "/media/hero-switch-5.png", mobileSrc: "/media/hero-switch-5.png" }
  ];

  const heroSlides = heroSlideSources.map((slide, index) => ({
    index,
    desktopSrc: resolvePublicAssetPath(slide.desktopSrc),
    mobileSrc: resolvePublicAssetPath(slide.mobileSrc),
    button: mugSwitchButtons[index] ?? null
  }));

  let currentHeroSlideIndex = 0;
  let heroCursorEnabled = false;
  let heroCursorVisible = false;
  let heroCursorDirection = "next";
  let heroCursor = null;
  let isHeroSliderDragging = false;

  function updateHeroIndicator(index, total) {
    const styles = getComputedStyle(heroPanel);
    const minLine = parseFloat(styles.getPropertyValue("--indicator-min-line")) || 12;
    const maxLine = parseFloat(styles.getPropertyValue("--indicator-max-line")) || 40;
    const hasMultipleSlides = total > 1;
    const progress = hasMultipleSlides ? index / (total - 1) : 0;
    const left = maxLine - (maxLine - minLine) * progress;
    const right = minLine + (maxLine - minLine) * progress;

    heroPanel.style.setProperty("--indicator-left-line", `${left}px`);
    heroPanel.style.setProperty("--indicator-right-line", `${right}px`);
  }

  function setMetaSwitcherState(index) {
    if (!metaSwitcher || !metaSwitchFirst || !metaSwitchSecond) return;

    const isFirstActive = index === 0;
    const isSecondActive = !isFirstActive;

    metaSwitchFirst.classList.toggle("is-active", isFirstActive);
    metaSwitchSecond.classList.toggle("is-active", isSecondActive);
    metaSwitchFirst.setAttribute("aria-pressed", String(isFirstActive));
    metaSwitchSecond.setAttribute("aria-pressed", String(isSecondActive));
  }

  function setImageSourceWithFallback(target, source, fallback) {
    if (!target) return;
    const nextSource = source || fallback;
    if (!nextSource) return;

    target.onerror = null;
    target.src = nextSource;

    if (source && fallback && source !== fallback) {
      target.onerror = () => {
        target.onerror = null;
        target.src = fallback;
      };
    }
  }

  function setHeroSlide(index) {
    if (!heroSlides.length) return;
    const boundedIndex = clamp(index, 0, heroSlides.length - 1);
    const slide = heroSlides[boundedIndex];
    const fallbackSlide = heroSlides[0];

    currentHeroSlideIndex = boundedIndex;
    setImageSourceWithFallback(heroDesktopImage, slide.desktopSrc, fallbackSlide.desktopSrc);
    setImageSourceWithFallback(heroMobileImage, slide.mobileSrc, fallbackSlide.mobileSrc);

    for (const item of heroSlides) {
      const isActive = item.index === boundedIndex;
      if (!item.button) continue;
      item.button.classList.toggle("is-active", isActive);
      item.button.setAttribute("aria-pressed", String(isActive));
    }

    updateHeroIndicator(boundedIndex, heroSlides.length);
    setMetaSwitcherState(boundedIndex);
    syncHeroDragSliderFromIndex();
  }

  function getWrappedHeroSlideIndex(index) {
    if (!heroSlides.length) return 0;
    return ((index % heroSlides.length) + heroSlides.length) % heroSlides.length;
  }

  function setHeroDragSliderProgress(progress) {
    const boundedProgress = clamp(progress, 0, 1);
    const styles = getComputedStyle(heroPanel);
    const minLine = parseFloat(styles.getPropertyValue("--indicator-min-line")) || 12;
    const maxLine = parseFloat(styles.getPropertyValue("--indicator-max-line")) || 40;
    const left = maxLine - (maxLine - minLine) * boundedProgress;
    const right = minLine + (maxLine - minLine) * boundedProgress;

    heroPanel.style.setProperty("--indicator-left-line", `${left}px`);
    heroPanel.style.setProperty("--indicator-right-line", `${right}px`);
  }

  function syncHeroDragSliderFromIndex() {
    if (!heroDragSlider || heroSlides.length < 2) return;
    const progress = currentHeroSlideIndex / (heroSlides.length - 1);
    setHeroDragSliderProgress(progress);
    heroDragSlider.setAttribute("aria-valuenow", String(currentHeroSlideIndex + 1));
  }

  function getHeroSliderProgressFromClientX(clientX) {
    if (!heroDragSlider) return 0;
    const rect = heroDragSlider.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }

  function applyHeroSliderProgress(progress, { snapToStep = false } = {}) {
    if (heroSlides.length < 2) return;

    const nextProgress = clamp(progress, 0, 1);
    setHeroDragSliderProgress(nextProgress);

    const nextSlideIndex = Math.round(nextProgress * (heroSlides.length - 1));
    if (nextSlideIndex !== currentHeroSlideIndex) {
      setHeroSlide(nextSlideIndex);
    }

    if (snapToStep) {
      syncHeroDragSliderFromIndex();
    }
  }

  function setupHeroDragSlider() {
    if (!heroDragSlider || heroSlides.length < 2) return;

    const handlePointerMove = (event) => {
      if (!isHeroSliderDragging) return;
      applyHeroSliderProgress(getHeroSliderProgressFromClientX(event.clientX));
    };

    const stopDragging = () => {
      if (!isHeroSliderDragging) return;
      isHeroSliderDragging = false;
      heroDragSlider.classList.remove("is-dragging");
      syncHeroDragSliderFromIndex();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };

    heroDragSlider.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      isHeroSliderDragging = true;
      heroDragSlider.classList.add("is-dragging");
      applyHeroSliderProgress(getHeroSliderProgressFromClientX(event.clientX));
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
    });

    heroDragSlider.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const offset = event.key === "ArrowLeft" ? -1 : 1;
      setHeroSlide(getWrappedHeroSlideIndex(currentHeroSlideIndex + offset));
    });

    syncHeroDragSliderFromIndex();
  }

  function getHeroCursorModeEnabled() {
    const supportsFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    return Boolean(heroPanel) && heroSlides.length > 1 && !isMobileViewport() && supportsFinePointer;
  }

  function setHeroCursorDirection(direction) {
    if (!heroCursor) return;
    heroCursorDirection = direction;
    heroCursor.dataset.direction = direction;
  }

  function setHeroCursorVisibility(visible) {
    if (!heroCursor) return;
    heroCursorVisible = visible;
    heroPanel.classList.toggle("has-hero-cursor", visible && heroCursorEnabled);
  }

  function updateHeroCursorPosition(clientX, clientY) {
    if (!heroCursor) return;
    const rect = heroPanel.getBoundingClientRect();
    const relativeX = clamp(clientX - rect.left, 0, rect.width);
    const relativeY = clamp(clientY - rect.top, 0, rect.height);

    heroCursor.style.setProperty("--cursor-x", `${relativeX}px`);
    heroCursor.style.setProperty("--cursor-y", `${relativeY}px`);

    const nextDirection = relativeX < rect.width / 2 ? "prev" : "next";
    if (nextDirection !== heroCursorDirection) {
      setHeroCursorDirection(nextDirection);
    }
  }

  function updateHeroCursorDefaultPosition() {
    if (!heroCursor) return;
    const rect = heroPanel.getBoundingClientRect();
    const startX = rect.width * 0.78;
    const startY = rect.height * 0.5;
    heroCursor.style.setProperty("--cursor-x", `${startX}px`);
    heroCursor.style.setProperty("--cursor-y", `${startY}px`);
  }

  function handleHeroPointerEnter(event) {
    if (!heroCursorEnabled) return;
    updateHeroCursorPosition(event.clientX, event.clientY);
    setHeroCursorVisibility(true);
  }

  function handleHeroPointerMove(event) {
    if (!heroCursorEnabled) return;
    updateHeroCursorPosition(event.clientX, event.clientY);
    if (!heroCursorVisible) {
      setHeroCursorVisibility(true);
    }
  }

  function handleHeroPointerLeave() {
    if (!heroCursorEnabled) return;
    setHeroCursorVisibility(false);
  }

  function handleHeroPanelClick(event) {
    if (!heroCursorEnabled || !heroSlides.length) return;

    const rect = heroPanel.getBoundingClientRect();
    const relativeX = clamp(event.clientX - rect.left, 0, rect.width);
    const direction = relativeX < rect.width / 2 ? "prev" : "next";
    const offset = direction === "prev" ? -1 : 1;
    const targetSlide = getWrappedHeroSlideIndex(currentHeroSlideIndex + offset);

    if (targetSlide === currentHeroSlideIndex) return;

    playButtonTick();
    setHeroSlide(targetSlide);
  }

  function setHeroCursorMode() {
    const shouldEnable = getHeroCursorModeEnabled();
    heroCursorEnabled = shouldEnable;
    heroPanel.classList.toggle("is-hero-cursor-enabled", shouldEnable);

    if (!shouldEnable) {
      setHeroCursorVisibility(false);
      return;
    }

    setHeroCursorDirection("next");
    updateHeroCursorDefaultPosition();
  }

  function setupHeroCursor() {
    if (heroCursor) return;

    heroCursor = document.createElement("span");
    heroCursor.className = "hero-cursor";
    heroCursor.setAttribute("aria-hidden", "true");

    const heroCursorImage = document.createElement("img");
    heroCursorImage.alt = "";

    if (heroCursorArrowSource) {
      heroCursorImage.addEventListener(
        "error",
        () => {
          heroCursorImage.remove();
          heroCursor?.classList.add("is-fallback");
        },
        { once: true }
      );
      heroCursorImage.src = heroCursorArrowSource;
      heroCursor.append(heroCursorImage);
    } else {
      heroCursor.classList.add("is-fallback");
    }

    heroPanel.append(heroCursor);

    heroPanel.addEventListener("pointerenter", handleHeroPointerEnter);
    heroPanel.addEventListener("pointermove", handleHeroPointerMove);
    heroPanel.addEventListener("pointerleave", handleHeroPointerLeave);
    heroPanel.addEventListener("click", handleHeroPanelClick);
    window.addEventListener("resize", setHeroCursorMode);
    window.addEventListener("orientationchange", setHeroCursorMode);

    setHeroCursorMode();
  }

  function setupMetaSwitcher() {
    if (!metaSwitcher || !metaSwitchFirst || !metaSwitchSecond || heroSlides.length < 2) return;

    metaSwitchFirst.addEventListener("click", () => {
      if (currentHeroSlideIndex === 0) return;
      playButtonTick();
      setHeroSlide(0);
    });

    metaSwitchSecond.addEventListener("click", () => {
      if (currentHeroSlideIndex === 1) return;
      playButtonTick();
      setHeroSlide(1);
    });
  }

  for (const item of heroSlides) {
    if (!item.button) continue;
    const previewImage = item.button.querySelector("img");
    if (previewImage) {
      previewImage.addEventListener(
        "error",
        () => {
          item.button.classList.add("is-fallback");
          previewImage.remove();
          if (!item.button.querySelector(".mug-switcher-dot")) {
            const dot = document.createElement("span");
            dot.className = "mug-switcher-dot";
            item.button.append(dot);
          }
        },
        { once: true }
      );
    } else {
      item.button.classList.add("is-fallback");
    }

    item.button.addEventListener("click", () => {
      if (currentHeroSlideIndex === item.index) return;
      playButtonTick();
      setHeroSlide(item.index);
    });
  }

  heroPanel.classList.add("is-legacy-slides-hero");
  setHeroSlide(currentHeroSlideIndex);
  setupHeroDragSlider();
  setupHeroCursor();
  setupMetaSwitcher();

  return {
    destroy() {
      heroPanel.classList.remove(
        "is-legacy-slides-hero",
        "is-hero-cursor-enabled",
        "has-hero-cursor"
      );
      window.removeEventListener("resize", setHeroCursorMode);
      window.removeEventListener("orientationchange", setHeroCursorMode);
      heroPanel.removeEventListener("pointerenter", handleHeroPointerEnter);
      heroPanel.removeEventListener("pointermove", handleHeroPointerMove);
      heroPanel.removeEventListener("pointerleave", handleHeroPointerLeave);
      heroPanel.removeEventListener("click", handleHeroPanelClick);
      heroCursor?.remove();
    }
  };
}
