const STORAGE_KEY = "9pra-bag";
const baseUrl = import.meta.env.BASE_URL ?? "/";

function resolvePublicAssetPath(path) {
  if (!path) return "";
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  if (!path.startsWith("/")) return path;
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}${path}`;
}

export const CATALOG = {
  mug: {
    id: "mug",
    name: "SHAPE 01",
    price: 300,
    image: resolvePublicAssetPath("/media/hero-desktop.png")
  },
  mat: {
    id: "mat",
    name: "MAT9",
    price: 300,
    image: resolvePublicAssetPath("/media/mat/hero.png")
  }
};

const listeners = new Set();

function readItems() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw;
  } catch {
    return {};
  }
}

function writeItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  const cart = getCart();
  listeners.forEach((fn) => fn(cart));
}

export function getCart() {
  const items = readItems();
  const lines = Object.entries(items)
    .map(([id, qty]) => {
      const product = CATALOG[id];
      const count = Number(qty) || 0;
      if (!product || count <= 0) return null;
      return {
        ...product,
        qty: count,
        lineTotal: product.price * count
      };
    })
    .filter(Boolean);

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    count: lines.reduce((sum, line) => sum + line.qty, 0)
  };
}

export function isInCart(id) {
  return (Number(readItems()[id]) || 0) > 0;
}

export function setQty(id, qty) {
  if (!CATALOG[id]) return;
  const items = readItems();
  const next = Math.max(0, Math.floor(Number(qty) || 0));
  if (next <= 0) delete items[id];
  else items[id] = next;
  writeItems(items);
}

export function addQty(id, delta) {
  const current = Number(readItems()[id]) || 0;
  setQty(id, current + delta);
}

export function toggleItem(id) {
  if (isInCart(id)) setQty(id, 0);
  else setQty(id, 1);
}

export function subscribeCart(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
