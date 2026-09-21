/**
 * While `run` is synchronous, every addEventListener is tied to `signal`
 * so a route destroy drops window/document/element listeners together.
 * Listeners that already pass their own signal are left alone.
 */
export function trackListeners(signal, run) {
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (options && typeof options === "object" && options.signal) {
      return original.call(this, type, listener, options);
    }
    const extra = typeof options === "boolean" ? { capture: options } : { ...(options ?? {}) };
    extra.signal = signal;
    return original.call(this, type, listener, extra);
  };
  try {
    return run();
  } finally {
    EventTarget.prototype.addEventListener = original;
  }
}
