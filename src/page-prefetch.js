import "./view-transitions.css";

// Pages worth warming. product-classic.html is an unlinked variant, so it is
// left out. checkout.html is the cart destination.
//
// prefetch, never prerender: prerendering mat.html would run src/mat.js, whose
// top-level preloadMugFrameImages() pulls all 25 mat frames before anyone asks
// for that page.
const PAGES = ["./index.html", "./shop.html", "./product.html", "./mat.html", "./checkout.html"];

function currentPath() {
  const { pathname } = window.location;
  return pathname.endsWith("/") ? `${pathname}index.html` : pathname;
}

function isWorthPrefetching() {
  const connection = navigator.connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return !String(connection.effectiveType ?? "").includes("2g");
}

function addPrefetchLinks() {
  if (!isWorthPrefetching()) return;

  const here = currentPath();
  for (const page of PAGES) {
    // Relative href so the /<repo>/ base on GitHub Pages keeps resolving.
    if (new URL(page, document.baseURI).pathname === here) continue;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = page;
    document.head.append(link);
  }
}

function whenIdle(run) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 3000 });
    return;
  }
  window.setTimeout(run, 1000);
}

if (document.readyState === "complete") {
  whenIdle(addPrefetchLinks);
} else {
  window.addEventListener("load", () => whenIdle(addPrefetchLinks), { once: true });
}
