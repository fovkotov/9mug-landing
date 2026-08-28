export function setupScratchRevealVideo(video, resolvePublicAssetPath) {
  if (!video) return () => {};

  const rawSrc = video.getAttribute("src") ?? "";
  const resolvedSrc = resolvePublicAssetPath(rawSrc);
  if (resolvedSrc && video.getAttribute("src") !== resolvedSrc) {
    video.setAttribute("src", resolvedSrc);
  }

  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.loop = true;
  video.preload = "auto";

  const tryPlay = () => {
    video.play().catch(() => {
      // Autoplay may wait for a gesture; callers also prime on input.
    });
  };

  const section = video.closest("#scratchSection") || video;
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          tryPlay();
        } else {
          video.pause();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(section);
  } else {
    tryPlay();
  }

  return tryPlay;
}
