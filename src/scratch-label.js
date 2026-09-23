/**
 * Paints `.scratch-label` onto the scratch canvas and keeps an erase mask.
 * Live strokes already punch the canvas with destination-out; the mask stores
 * those same strokes so a later text update (typewriter) is punched back out.
 */

export function createScratchLabelLayer(section, canvas, ctx) {
  const mask = document.createElement("canvas");
  const maskCtx = mask.getContext("2d", { alpha: true });
  let onChange = () => {};
  let stopped = false;

  const host = section.querySelector(".scratch-label");
  const observer = host
    ? new MutationObserver(() => {
        if (!stopped) onChange();
      })
    : null;
  if (host && observer) {
    observer.observe(host, { subtree: true, characterData: true, childList: true });
  }

  const emit = () => {
    if (!stopped) onChange();
  };
  const handleFonts = () => emit();
  document.fonts?.ready?.then(emit);
  document.fonts?.addEventListener?.("loadingdone", handleFonts);

  function labelSpan() {
    return section.querySelector(".scratch-label span") || host;
  }

  function paintLabel() {
    const span = labelSpan();
    if (!span || !canvas.width || !canvas.height) return;
    const text = span.textContent ?? "";
    if (!text) return;

    const style = getComputedStyle(span);
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width > 0 ? canvas.width / canvasRect.width : 1;
    const scaleY = canvasRect.height > 0 ? canvas.height / canvasRect.height : 1;
    let cx = canvas.width / 2;
    let cy = canvas.height / 2;
    if (canvasRect.width > 0 && canvasRect.height > 0) {
      const spanRect = span.getBoundingClientRect();
      if (spanRect.width > 0 && spanRect.height > 0) {
        cx = (spanRect.left + spanRect.width / 2 - canvasRect.left) * scaleX;
        cy = (spanRect.top + spanRect.height / 2 - canvasRect.top) * scaleY;
      }
    }

    const fontSize = (parseFloat(style.fontSize) || 17) * scaleY;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = style.color || "#ffffff";
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tracking = parseFloat(style.letterSpacing);
    if ("letterSpacing" in ctx) {
      ctx.letterSpacing = Number.isFinite(tracking) ? `${tracking * scaleX}px` : "0px";
    }
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  function applyMask() {
    if (!maskCtx || !mask.width || !mask.height) return;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  }

  function clearMask() {
    mask.width = canvas.width;
    mask.height = canvas.height;
  }

  function punch(draw) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    draw(ctx);
    ctx.restore();

    if (!maskCtx || !mask.width || !mask.height) return;
    maskCtx.save();
    maskCtx.globalCompositeOperation = "source-over";
    maskCtx.fillStyle = "#000";
    draw(maskCtx);
    maskCtx.restore();
  }

  return {
    paintLabel,
    applyMask,
    clearMask,
    punch,
    setOnChange(fn) {
      onChange = typeof fn === "function" ? fn : () => {};
    },
    destroy() {
      stopped = true;
      onChange = () => {};
      observer?.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", handleFonts);
      mask.width = 0;
      mask.height = 0;
    }
  };
}
