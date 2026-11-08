/*
 * Render a live DOM element to a PNG data URL without third-party code:
 * clone it, inline every computed style, wrap it in an SVG <foreignObject>
 * and draw that onto a canvas.
 *
 * Cross-origin <img> inside the element would taint the canvas, so such
 * images are swapped for data URLs provided by `inlineImage` (or dropped).
 */
(function (root) {
  'use strict';

  const DROP_SELECTOR = [
    'button:not([role="checkbox"])',
    '[data-markdown-copy="exclude"]',
    '[data-block-actions]',
    '[data-d-image-loading]',
    'script', 'style:not(svg style)', 'iframe',
  ].join(',');

  function copyStyles(src, dst) {
    const cs = getComputedStyle(src);
    let css = '';
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      css += p + ':' + cs.getPropertyValue(p) + ';';
    }
    dst.setAttribute('style', css);
    dst.removeAttribute('class');
  }

  /**
   * @param {Element} el
   * @param {{scale?: number, background?: string, inlineImage?: (url: string) => Promise<string|null>}} opts
   * @returns {Promise<{dataUrl: string, width: number, height: number}>}
   */
  async function rasterize(el, opts) {
    opts = opts || {};
    const rect = el.getBoundingClientRect();
    const width = Math.ceil(Math.max(rect.width, el.scrollWidth || 0));
    const height = Math.ceil(Math.max(rect.height, el.scrollHeight || 0));
    if (!width || !height) throw new Error('element has no size (not rendered)');

    const clone = el.cloneNode(true);
    const src = [el, ...el.querySelectorAll('*')];
    const dst = [clone, ...clone.querySelectorAll('*')];
    for (let i = 0; i < src.length && i < dst.length; i++) copyStyles(src[i], dst[i]);

    clone.style.margin = '0';
    clone.querySelectorAll(DROP_SELECTOR).forEach((n) => n.remove());

    // Images: data: URLs are safe; everything else must be inlined or removed.
    for (const img of [...clone.querySelectorAll('img')]) {
      const s = img.getAttribute('src') || '';
      img.removeAttribute('srcset');
      if (s.startsWith('data:')) continue;
      const inlined = opts.inlineImage ? await opts.inlineImage(s).catch(() => null) : null;
      if (inlined) img.setAttribute('src', inlined);
      else img.remove();
    }
    // SVG <use href="/sprite.svg#id"> references cannot load inside an image.
    clone.querySelectorAll('use').forEach((u) => {
      const h = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
      if (h && !h.startsWith('#')) u.remove();
    });

    const background = opts.background || getComputedStyle(document.body).backgroundColor || '#ffffff';
    const xml = new XMLSerializer().serializeToString(clone);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      '<foreignObject x="0" y="0" width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="background:' + background + ';width:' + width + 'px;height:' + height + 'px">' +
      xml + '</div></foreignObject></svg>';

    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();

    // At least 2x so diagrams stay sharp on retina screens and when zoomed in Obsidian.
    const scale = opts.scale || Math.max(2, Math.min(3, window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  }

  root.CGE = root.CGE || {};
  root.CGE.rasterize = rasterize;
})(globalThis);
