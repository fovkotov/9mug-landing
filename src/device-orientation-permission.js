/**
 * Shared DeviceOrientation permission helpers.
 * iOS requires requestPermission() inside a user gesture — call this
 * when the user taps a link that navigates to the product page.
 */

export function orientationApiAvailable() {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
}

export function needsOrientationPermission() {
  return (
    orientationApiAvailable() &&
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  );
}

/**
 * @returns {Promise<"granted" | "denied" | "unavailable">}
 */
export async function requestDeviceOrientationPermission() {
  if (!orientationApiAvailable()) return "unavailable";

  if (!needsOrientationPermission()) {
    return "granted";
  }

  try {
    const requests = [DeviceOrientationEvent.requestPermission()];
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      requests.push(DeviceMotionEvent.requestPermission());
    }

    const results = await Promise.all(requests);
    return results.every((result) => result === "granted") ? "granted" : "denied";
  } catch (error) {
    console.warn("Device orientation permission failed", error);
    return "denied";
  }
}

/**
 * Intercept product-page links: ask for motion access during the same tap,
 * then continue navigation.
 */
export function bindProductOrientationHandoff(
  selector = 'a[href*="product.html"]'
) {
  const links = document.querySelectorAll(selector);
  if (!links.length) return;

  for (const link of links) {
    link.addEventListener("click", (event) => {
      // Desktop mouse look doesn't need sensors.
      const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      const mobile =
        window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(hover: none)").matches ||
        window.matchMedia("(max-width: 900px)").matches ||
        !finePointer;

      if (!mobile || !orientationApiAvailable()) return;

      event.preventDefault();
      const href = link.href;

      void (async () => {
        await requestDeviceOrientationPermission();
        window.location.href = href;
      })();
    });
  }
}
