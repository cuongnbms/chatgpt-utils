/*
 * Conversation outline: a floating panel listing each user question and the
 * H1–H3 headings of the answers, for quick navigation.
 *
 * collectOutline() is DOM-only (tested with jsdom); the panel part runs in the
 * content script and is refreshed by content.js's MutationObserver.
 */
(function (root) {
  'use strict';

  const conv = (root.CGE && root.CGE.converter) ||
    (typeof require === 'function' ? require('./converter.js') : null);

  const USER_SELECTOR = '[data-user-message-bubble="true"], [data-message-author-role="user"]';
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function questionText(el, max) {
    const raw = (el.innerText !== undefined && el.innerText !== '' ? el.innerText : el.textContent) || '';
    const first = raw.split('\n').map(clean).find(Boolean) || '';
    return first.length > max ? first.slice(0, max - 1) + '…' : first;
  }

  // ChatGPT keeps the previous conversation mounted inside a display:none
  // container after an in-app navigation; only rendered content belongs here.
  function isRendered(el) {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility();
    return !el.closest('[hidden], [style*="display: none"], [style*="display:none"]'); // jsdom
  }

  // Headings that are part of a card/diagram/chart (stat numbers, card titles), not the answer's structure.
  const NON_OUTLINE_CONTAINER = '[data-d-component="box"], [data-client-defined-widget], [data-markdown-copy="exclude"]';

  function outermost(els) {
    return els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
  }

  /**
   * @param {Document|Element} doc
   * @param {{maxLevel?: number, questionLength?: number}} [opts]
   * @returns {{question: {text: string, el: Element}|null, items: {level: number, text: string, el: Element}[]}[]}
   */
  function collectOutline(doc, opts) {
    const maxLevel = (opts && opts.maxLevel) || 3;
    const qMax = (opts && opts.questionLength) || 60;
    const users = outermost([...doc.querySelectorAll(USER_SELECTOR)]).filter(isRendered).map((el) => ({ kind: 'user', el }));
    const responses = conv.findResponseRoots(doc).filter(isRendered).map((el) => ({ kind: 'response', el }));
    const units = [...users, ...responses].sort((a, b) =>
      a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & 4 /* FOLLOWING */ ? -1 : 1);

    const groups = [];
    let cur = null;
    for (const u of units) {
      if (u.kind === 'user') {
        cur = { question: { text: questionText(u.el, qMax), el: u.el }, items: [] };
        groups.push(cur);
        continue;
      }
      if (!cur) {
        cur = { question: null, items: [] };
        groups.push(cur);
      }
      for (const h of u.el.querySelectorAll(HEADING_SELECTOR)) {
        const level = +h.tagName[1];
        if (level > maxLevel) continue;
        if (h.closest(NON_OUTLINE_CONTAINER)) continue;
        const text = clean(h.textContent);
        if (!text) continue;
        cur.items.push({ level, text, el: h });
      }
    }
    return groups;
  }

  /** Flat list for the panel: every question, plus headings up to `level` (1–3). */
  function flattenOutline(groups, level) {
    const out = [];
    for (const g of groups) {
      if (g.question) out.push({ level: 0, text: g.question.text || '(question)', el: g.question.el });
      for (const it of g.items) if (it.level <= level) out.push(it);
    }
    return out;
  }

  // ---------------------------------------------------------------- panel UI

  const KEY_COLLAPSED = 'cge.outline.collapsed';
  const KEY_LEVEL = 'cge.outline.level';
  const TOP_OFFSET = 72; // keep the target below ChatGPT's sticky header

  function scrollParent(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollToEl(el) {
    const sc = scrollParent(el);
    const isRoot = sc === document.scrollingElement || sc === document.documentElement;
    const top = isRoot ? 0 : sc.getBoundingClientRect().top;
    const delta = el.getBoundingClientRect().top - top - TOP_OFFSET;
    sc.scrollTo({ top: sc.scrollTop + delta, behavior: 'smooth' });
  }

  function isDarkPage() {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor || '');
    if (!m) return matchMedia('(prefers-color-scheme: dark)').matches;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  }

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; top: 72px; right: 16px; z-index: 40; font: 13px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    .panel { width: 264px; max-height: calc(100vh - 160px); display: flex; flex-direction: column;
      border-radius: 14px; border: 1px solid var(--bd); background: var(--bg); color: var(--fg);
      box-shadow: 0 6px 24px rgba(0,0,0,.10); overflow: hidden; }
    .head { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 12px; border-bottom: 1px solid var(--bd); font-weight: 600; }
    .head span { flex: 1; }
    .btn { all: unset; cursor: pointer; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px; color: var(--muted); }
    .btn:hover { background: var(--hover); color: var(--fg); }
    .lv { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--hover); }
    .lvb { all: unset; cursor: pointer; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 6px; color: var(--muted); }
    .lvb:hover { color: var(--fg); }
    .lvb.on { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
    .list { overflow-y: auto; padding: 6px; overscroll-behavior: contain; }
    .item { all: unset; box-sizing: border-box; display: block; width: 100%; cursor: pointer; padding: 4px 8px; border-radius: 7px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
    .item:hover { background: var(--hover); color: var(--fg); }
    .item.q { color: var(--fg); font-weight: 600; margin-top: 6px; }
    .item.q:first-child { margin-top: 0; }
    .item.q::before { content: "Q"; display: inline-block; font-size: 10px; font-weight: 700; padding: 0 4px; margin-right: 6px;
      border-radius: 4px; background: var(--chip); color: var(--fg); vertical-align: 1px; }
    .item.l1 { padding-left: 14px; color: var(--fg); }
    .item.l2 { padding-left: 24px; }
    .item.l3 { padding-left: 36px; font-size: 12.5px; }
    .item.active { background: var(--active); color: var(--fg); }
    .fab { all: unset; cursor: pointer; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px;
      border: 1px solid var(--bd); background: var(--bg); color: var(--fg); box-shadow: 0 4px 16px rgba(0,0,0,.12); }
    .fab:hover { background: var(--hover); }
    .light { --bg: #ffffff; --fg: #0d0d0d; --muted: #5d5d5d; --bd: #e5e5e5; --hover: #f2f2f2; --active: #e8eefc; --chip: #ececec; }
    .dark  { --bg: #262626; --fg: #ececec; --muted: #a8a8a8; --bd: #3a3a3a; --hover: #333333; --active: #2f3a52; --chip: #3a3a3a; }
  `;
  const ICON_LIST = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>';
  const ICON_CLOSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 6l6 6-6 6"/><path d="M5 6l6 6-6 6"/></svg>';

  const state = { host: null, shadow: null, collapsed: null, level: null, groups: [], entries: [], signature: '', activeIdx: -1, raf: 0 };

  function storageGet(key) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(key, (r) => resolve(r ? r[key] : undefined)); } catch (_) { resolve(undefined); }
    });
  }
  function storageSet(key, v) {
    try { chrome.storage.local.set({ [key]: v }); } catch (_) { /* extension reloaded */ }
  }

  function ensureHost() {
    if (state.host && state.host.isConnected) return;
    state.host = document.createElement('div');
    state.host.id = 'cge-outline-host';
    state.shadow = state.host.attachShadow({ mode: 'open' });
    document.body.appendChild(state.host);
    state.signature = '';
  }

  function render() {
    const s = state.shadow;
    const theme = isDarkPage() ? 'dark' : 'light';
    if (state.collapsed) {
      s.innerHTML = '<style>' + CSS + '</style><div class="wrap ' + theme + '"><button class="fab" title="Open outline" aria-label="Open outline">' + ICON_LIST + '</button></div>';
      s.querySelector('.fab').onclick = () => setCollapsed(false);
      return;
    }
    s.innerHTML = '<style>' + CSS + '</style><div class="wrap ' + theme + '"><div class="panel">' +
      '<div class="head"><span>Outline</span><div class="lv" role="group" aria-label="Heading level">' +
      [1, 2, 3].map((n) => '<button class="lvb' + (n === state.level ? ' on' : '') + '" data-lv="' + n + '" aria-pressed="' + (n === state.level) + '" title="Show up to H' + n + '">H' + n + '</button>').join('') +
      '</div><button class="btn close" title="Collapse" aria-label="Collapse outline">' + ICON_CLOSE + '</button></div>' +
      '<div class="list" role="navigation" aria-label="Outline"></div></div></div>';
    s.querySelector('.btn.close').onclick = () => setCollapsed(true);
    s.querySelectorAll('.lvb').forEach((b) => { b.onclick = () => setLevel(+b.dataset.lv); });
    const list = s.querySelector('.list');
    state.entries.forEach((e, i) => {
      const b = document.createElement('button');
      b.className = 'item ' + (e.level ? 'l' + e.level : 'q');
      b.textContent = e.text;
      b.title = e.text;
      b.onclick = () => scrollToEl(e.el);
      b.dataset.idx = String(i);
      list.appendChild(b);
    });
    state.activeIdx = -1;
    updateActive();
  }

  function setCollapsed(v) {
    state.collapsed = v;
    storageSet(KEY_COLLAPSED, v);
    render();
  }

  function setLevel(lv) {
    if (lv === state.level) return;
    state.level = lv;
    storageSet(KEY_LEVEL, lv);
    state.entries = flattenOutline(state.groups, lv);
    state.signature = signatureOf(state.entries);
    render();
  }

  function signatureOf(entries) {
    return entries.map((e) => e.level + e.text).join('\u0001') + '|' + state.level + '|' + (isDarkPage() ? 'd' : 'l');
  }

  function updateActive() {
    state.raf = 0;
    if (state.collapsed || !state.shadow || !state.entries.length) return;
    const first = state.entries.find((e) => e.el.isConnected);
    if (!first) return;
    const sc = scrollParent(first.el);
    const isRoot = sc === document.scrollingElement || sc === document.documentElement;
    const box = isRoot ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect();
    // Same offset scrollToEl() uses, plus slack, so a jumped-to heading becomes active.
    const threshold = box.top + TOP_OFFSET + 24;
    const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
    let idx = 0;
    for (let i = 0; i < state.entries.length; i++) {
      const el = state.entries[i].el;
      if (!el.isConnected) continue;
      const top = el.getBoundingClientRect().top;
      // At the very bottom, later headings can never reach the threshold: take the last visible one.
      if (top <= threshold || (atBottom && top < box.bottom)) idx = i; else break;
    }
    if (idx === state.activeIdx) return;
    state.activeIdx = idx;
    const items = state.shadow.querySelectorAll('.item');
    items.forEach((it) => it.classList.toggle('active', it.dataset.idx === String(idx)));
    const active = items[idx];
    const list = state.shadow.querySelector('.list');
    if (active && list) {
      const a = active.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      if (a.top < l.top || a.bottom > l.bottom) list.scrollTop += a.top - l.top - l.height / 3;
    }
  }

  function onScroll() {
    if (!state.raf) state.raf = requestAnimationFrame(updateActive);
  }

  /** Rebuild from the current DOM; cheap when nothing changed. */
  async function refresh() {
    if (!document.body) return;
    const groups = collectOutline(document);
    if (flattenOutline(groups, 3).length < 2) {
      if (state.host) { state.host.remove(); state.host = null; }
      state.entries = [];
      return;
    }
    if (state.collapsed === null) {
      const saved = await storageGet(KEY_COLLAPSED);
      state.collapsed = saved === undefined ? window.innerWidth < 1100 : !!saved;
    }
    if (state.level === null) {
      const saved = await storageGet(KEY_LEVEL);
      state.level = [1, 2, 3].includes(saved) ? saved : 3;
    }
    state.groups = groups;
    state.entries = flattenOutline(groups, state.level); // always refresh element refs (React may remount nodes)
    const signature = signatureOf(state.entries);
    ensureHost();
    if (signature !== state.signature) {
      state.signature = signature;
      render();
    } else {
      updateActive();
    }
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
  }

  const api = { collectOutline, flattenOutline, refresh };
  root.CGE = root.CGE || {};
  root.CGE.outline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
