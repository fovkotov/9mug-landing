/**
 * Shared DeviceOrientation permission helpers.
 * iOS requires requestPermission() inside a user gesture — call this
 * when the user taps a link that navigates to the product page, or on
 * the first interaction after a silent check on page entry.
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

function isMobileInteractionContext() {
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none)").matches ||
    window.matchMedia("(max-width: 900px)").matches ||
    !finePointer
  );
}

/**
 * Brief silent probe: if orientation events already fire, access is available.
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function probeOrientationEvents(timeoutMs = 350) {
  if (!orientationApiAvailable()) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("deviceorientation", onOrient, true);
      window.removeEventListener("deviceorientationabsolute", onOrient, true);
      resolve(value);
    };

    const onOrient = (event) => {
      if (event.beta != null || event.gamma != null || event.alpha != null) {
        finish(true);
      }
    };

    window.addEventListener("deviceorientation", onOrient, true);
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Silent permission state check (no UI).
 * @returns {Promise<"granted" | "denied" | "prompt" | "unavailable">}
 */
export async function getDeviceOrientationPermissionState() {
  if (!orientationApiAvailable()) return "unavailable";

  // Android / browsers without a permission gate.
  if (!needsOrientationPermission()) {
    return "granted";
  }

  // Permissions API where supported (mostly Chromium).
  if (navigator.permissions?.query) {
    for (const name of ["gyroscope", "accelerometer"]) {
      try {
        const status = await navigator.permissions.query({ name });
        if (status.state === "granted") return "granted";
        if (status.state === "denied") return "denied";
      } catch {
        // Name may be unsupported — keep probing.
      }
    }
  }

  if (await probeOrientationEvents(350)) return "granted";

  return "prompt";
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
 * Check silently, then request if needed.
 * @returns {Promise<"granted" | "denied" | "unavailable">}
 */
export async function ensureDeviceOrientationPermission() {
  const state = await getDeviceOrientationPermissionState();
  if (state === "granted") return "granted";
  if (state === "unavailable") return "unavailable";
  return requestDeviceOrientationPermission();
}

let silentGestureBound = false;

/**
 * On product/mat page entry: silently check motion access; if missing,
 * request it (immediately when possible, otherwise on the first tap —
 * required by iOS). No visible UI.
 */
export function ensureDeviceOrientationOnEntry() {
  if (typeof window === "undefined") return;
  if (!isMobileInteractionContext() || !orientationApiAvailable()) return;

  void (async () => {
    const state = await getDeviceOrientationPermissionState();
    if (state === "granted" || state === "unavailable") return;

    const result = await requestDeviceOrientationPermission();
    if (result === "granted") return;

    if (silentGestureBound) return;
    silentGestureBound = true;

    const onFirstGesture = () => {
      window.removeEventListener("pointerdown", onFirstGesture, true);
      window.removeEventListener("touchstart", onFirstGesture, true);
      void requestDeviceOrientationPermission();
    };

    window.addEventListener("pointerdown", onFirstGesture, true);
    window.addEventListener("touchstart", onFirstGesture, { capture: true, passive: true });
  })();
}

/**
 * Intercept product/mat page links: ask for motion access during the same tap,
 * then continue navigation. Required on iOS so DeviceOrientation can start
 * without a second permission gesture on the destination page.
 */
export function bindProductOrientationHandoff(
  selector = 'a[href*="product.html"], a[href*="product-classic.html"], a[href*="mat.html"]'
) {
  const links = document.querySelectorAll(selector);
  if (!links.length) return;

  for (const link of links) {
    if (link.dataset.orientationHandoffBound === "true") continue;
    link.dataset.orientationHandoffBound = "true";

    link.addEventListener("click", (event) => {
      if (!isMobileInteractionContext() || !orientationApiAvailable()) return;

      event.preventDefault();
      const href = link.href;

      void (async () => {
        await requestDeviceOrientationPermission();
        window.location.href = href;
      })();
    });
  }
}
