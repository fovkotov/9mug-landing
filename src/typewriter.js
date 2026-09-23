/** Brisk, still readable. Shared by every modal. */
export const TYPEWRITER_CHAR_MS = 22;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isHidden(element, root) {
  let node = element;
  while (node && node !== root) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Types `root`'s text nodes in tree order, one character at a time.
 * Mutates the text nodes in place so ancestors keep mix-blend-mode
 * (no opacity, transform, or filter wrappers).
 * Returns cancel(). Cancel restores the full strings and clears the timer.
 * prefers-reduced-motion leaves the text untouched.
 * `deferred` blanks immediately but waits for `cancel.start()` so a caller
 * can recapture text after init, or wait out a view transition.
 */
export function typewrite(root, { charMs = TYPEWRITER_CHAR_MS, skipSelector = "[aria-hidden='true']", deferred = false } = {}) {
  if (!root || prefersReducedMotion()) return () => {};

  const entries = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const text = current.nodeValue ?? "";
    const parent = current.parentElement;
    const skipped = !text.trim() || !parent || (skipSelector && parent.closest(skipSelector));
    if (!skipped && !isHidden(parent, root)) {
      entries.push({ node: current, text });
    }
    current = walker.nextNode();
  }

  if (!entries.length) return () => {};

  for (const entry of entries) entry.node.nodeValue = "";

  let index = 0;
  let count = 0;
  let timer = 0;
  let stopped = false;
  let started = false;

  const restore = () => {
    for (const entry of entries) {
      if (entry.node.isConnected) entry.node.nodeValue = entry.text;
    }
  };

  const tick = () => {
    if (stopped) return;
    const entry = entries[index];
    if (!entry?.node.isConnected) {
      index += 1;
      count = 0;
      if (index < entries.length) timer = window.setTimeout(tick, charMs);
      else stopped = true;
      return;
    }
    count += 1;
    entry.node.nodeValue = entry.text.slice(0, count);
    if (count >= entry.text.length) {
      index += 1;
      count = 0;
    }
    if (index < entries.length) timer = window.setTimeout(tick, charMs);
  };

  const begin = () => {
    if (stopped || started) return;
    started = true;
    timer = window.setTimeout(tick, charMs);
  };

  const cancel = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    restore();
  };

  if (deferred) cancel.start = begin;
  else begin();

  return cancel;
}
