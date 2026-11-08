/*
 * Adds an "Export" button to every ChatGPT response's action bar.
 *   - Copy Markdown: images and diagrams embedded as base64 (self-contained).
 *   - Download .zip: <title>.md + attachments/*.png, ready to drop into a vault.
 *
 * Reads only the rendered DOM. It never calls ChatGPT's private API and never
 * touches the session/access token.
 */
(function () {
  'use strict';

  const { toMarkdown, findResponseRoots } = globalThis.CGE.converter;
  const { createZip } = globalThis.CGE.zip;
  const rasterize = globalThis.CGE.rasterize;

  const BTN_CLASS = 'cge-export-btn';
  const ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';

  // ---------- helpers ----------

  function slugify(s) {
    return (s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chatgpt';
  }

  function safeFileName(s) {
    return (s || 'ChatGPT').replace(/[\\/:*?"<>|#^\[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'ChatGPT';
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function dataUrlToBytes(dataUrl) {
    const m = /^data:([^;,]+)?((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(dataUrl);
    if (!m) return null;
    const mime = m[1] || 'application/octet-stream';
    if (m[3]) {
      const bin = atob(m[4]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { mime, bytes };
    }
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(m[4])) };
  }

  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

  async function fetchAsDataUrl(url) {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    let u;
    try { u = new URL(url, location.href); } catch (_) { return null; }
    if (u.protocol === 'blob:' || u.origin === location.origin) {
      const res = await fetch(u.href, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return blobToDataUrl(await res.blob());
    }
    const r = await chrome.runtime.sendMessage({ type: 'cge:fetch-image', url: u.href });
    if (!r || !r.ok) throw new Error((r && r.error) || 'fetch failed');
    return 'data:' + r.mime + ';base64,' + r.base64;
  }

  // ---------- assets ----------

  class Assets {
    /** @param {'embed'|'files'} mode */
    constructor(mode, slug) {
      this.mode = mode;
      this.slug = slug;
      this.files = [];
      this.byKey = new Map();
      this.warnings = [];
    }

    store(dataUrl, kind) {
      if (this.mode === 'embed') return dataUrl;
      const parsed = dataUrlToBytes(dataUrl);
      if (!parsed) return null;
      const ext = EXT[parsed.mime] || 'bin';
      const name = 'attachments/' + this.slug + '-' + (this.files.length + 1) + (kind ? '-' + kind : '') + '.' + ext;
      this.files.push({ name, data: parsed.bytes });
      return name;
    }

    async image(img) {
      const src = img.currentSrc || img.getAttribute('src') || '';
      if (!src) return null;
      if (this.byKey.has(src)) return this.byKey.get(src);
      let ref;
      try {
        ref = this.store(await fetchAsDataUrl(src), '');
      } catch (e) {
        this.warnings.push('Không tải được ảnh (giữ link gốc): ' + src.slice(0, 80));
        ref = /^https?:/.test(src) ? src : null;
      }
      this.byKey.set(src, ref);
      return ref;
    }

    async rasterize(el, kind) {
      try {
        const { dataUrl } = await rasterize(el, {
          inlineImage: (url) => fetchAsDataUrl(url).catch(() => null),
        });
        return this.store(dataUrl, kind);
      } catch (e) {
        console.warn('[ChatGPT Exporter] rasterize failed', e);
        this.warnings.push('Không chụp được ' + (kind || 'diagram') + ': ' + (e && e.message));
        return null;
      }
    }
  }

  // ---------- export ----------

  function turnTitle(roots) {
    for (const r of roots) {
      const h = r.querySelector('h1, h2, h3');
      if (h && h.textContent.trim()) return h.textContent.trim();
    }
    const t = document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim();
    return t && t !== 'ChatGPT' ? t : 'ChatGPT response';
  }

  async function buildMarkdown(roots, assets) {
    const ctx = {
      image: (img) => assets.image(img),
      rasterize: (el, kind) => assets.rasterize(el, kind),
      baseUrl: location.href,
    };
    const parts = [];
    for (const r of roots) parts.push((await toMarkdown(r, ctx)).trim());
    return parts.filter(Boolean).join('\n\n') + '\n';
  }

  function frontmatter(title) {
    const src = location.origin + location.pathname;
    const date = new Date().toISOString().slice(0, 10);
    return '---\ntitle: ' + JSON.stringify(title) + '\nsource: ' + src + '\nexported: ' + date + '\ntags:\n  - chatgpt\n---\n\n';
  }

  async function copyMarkdown(roots) {
    const assets = new Assets('embed', '');
    const mdPromise = buildMarkdown(roots, assets);
    try {
      // Hand the clipboard a promise so the click's user activation is still valid
      // when the (async) conversion finishes.
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': mdPromise.then((md) => new Blob([md], { type: 'text/plain' })) }),
      ]);
    } catch (e) {
      const md = await mdPromise;
      try {
        await navigator.clipboard.writeText(md);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = md;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw e;
      }
    }
    await mdPromise;
    return assets.warnings;
  }

  async function downloadZip(roots) {
    const rawTitle = turnTitle(roots);
    const title = safeFileName(rawTitle);
    const stamp = Date.now().toString(36).slice(-5);
    const assets = new Assets('files', slugify(title) + '-' + stamp);
    const md = frontmatter(rawTitle) + (await buildMarkdown(roots, assets));
    const zip = createZip([{ name: title + '.md', data: md }, ...assets.files]);
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = title + '.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return assets.warnings;
  }

  // ---------- UI ----------

  function toast(msg, isError) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483647;' +
      'padding:10px 16px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;max-width:80vw;white-space:pre-line;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.2);color:#fff;background:' + (isError ? '#b42318' : '#1f2937');
    document.body.appendChild(t);
    setTimeout(() => t.remove(), isError ? 6000 : 3000);
  }

  let openMenu = null;
  function closeMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
  }
  document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  function showMenu(btn, turn) {
    closeMenu();
    const dark = document.documentElement.classList.contains('dark') ||
      matchMedia('(prefers-color-scheme: dark)').matches && !document.documentElement.classList.contains('light');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.style.cssText = 'position:fixed;z-index:2147483647;min-width:240px;padding:6px;border-radius:12px;' +
      'font:14px/1.3 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.18);' +
      (dark ? 'background:#2f2f2f;color:#ececec;border:1px solid #444;' : 'background:#fff;color:#0d0d0d;border:1px solid #e5e5e5;');
    const items = [
      { label: 'Copy Markdown', hint: 'ảnh/diagram nhúng base64', run: copyMarkdown, done: 'Đã copy Markdown' },
      { label: 'Tải .zip cho Obsidian', hint: 'note .md + attachments/', run: downloadZip, done: 'Đã tải file .zip' },
    ];
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;font:inherit';
      b.innerHTML = '<div></div><div style="font-size:12px;opacity:.6"></div>';
      b.children[0].textContent = it.label;
      b.children[1].textContent = it.hint;
      b.onmouseenter = () => { b.style.background = dark ? '#424242' : '#f3f3f3'; };
      b.onmouseleave = () => { b.style.background = 'transparent'; };
      b.onclick = async () => {
        closeMenu();
        const roots = findResponseRoots(turn);
        if (!roots.length) return toast('Không tìm thấy nội dung response', true);
        try {
          const warnings = await it.run(roots);
          toast(it.done + (warnings.length ? '\n⚠ ' + warnings.join('\n⚠ ') : ''), false);
        } catch (e) {
          console.error('[ChatGPT Exporter]', e);
          toast('Export lỗi: ' + (e && e.message || e), true);
        }
      };
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    const mh = menu.offsetHeight;
    const top = r.bottom + 6 + mh > innerHeight ? r.top - 6 - mh : r.bottom + 6;
    menu.style.top = Math.max(8, top) + 'px';
    menu.style.left = Math.min(innerWidth - menu.offsetWidth - 8, Math.max(8, r.left)) + 'px';
    openMenu = menu;
  }

  function turnOf(root) {
    return root.closest('[data-turn-key]') ||
      root.closest('[data-testid^="conversation-turn"]') ||
      root.closest('article') ||
      root.parentElement;
  }

  function inject(turn) {
    if (turn.querySelector('.' + BTN_CLASS)) return;
    const roots = findResponseRoots(turn);
    if (!roots.length) return;
    const last = roots[roots.length - 1];
    const following = [...turn.querySelectorAll('button')].filter(
      (b) => !last.contains(b) && (last.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
    if (following.length < 2) return; // action bar not rendered yet (still streaming)
    const need = Math.min(3, following.length);
    let bar = following[0].parentElement;
    while (bar && bar !== turn && following.filter((b) => bar.contains(b)).length < need) bar = bar.parentElement;
    if (!bar || bar === turn) return;

    const ref = following[0];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS + ' ' + (ref.className || '');
    btn.setAttribute('aria-label', 'Export Markdown');
    btn.title = 'Export Markdown (Obsidian)';
    btn.innerHTML = ICON;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (openMenu) return closeMenu();
      showMenu(btn, turn);
    });
    bar.appendChild(btn);
  }

  function scan() {
    const roots = findResponseRoots(document);
    const turns = new Set(roots.map(turnOf).filter(Boolean));
    turns.forEach(inject);
  }

  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
