/*
 * ChatGPT response DOM -> Obsidian-flavoured Markdown.
 *
 * ChatGPT (2026) renders answers with the "DIL" renderer: formatting lives in
 * data attributes (data-d-default-strong, data-d-font-style=italic, ...) rather
 * than <strong>/<em>, which is why the built-in copy loses it. Older chats use
 * plain semantic HTML inside `.markdown`; both are handled here.
 *
 * Rule of thumb: known components have handlers, every other element is
 * transparent (its children are rendered), so wrapper divs/spans added by
 * future UI changes do not break the output.
 *
 * Runs in the browser (content script) and in Node + jsdom (tests).
 */
(function (root) {
  'use strict';

  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV',
    'FIGURE', 'FIGCAPTION', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DL', 'DT', 'DD', 'DETAILS', 'SUMMARY',
  ]);
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'BUTTON', 'INPUT', 'TEXTAREA',
    'SELECT', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'USE',
  ]);
  const STRONG_WEIGHTS = new Set(['bold', 'semibold', 'extrabold', 'black']);

  const comp = (el) => (el.getAttribute && el.getAttribute('data-d-component')) || '';
  const widget = (el) => (el.getAttribute && el.getAttribute('data-client-defined-widget')) || '';
  const tag = (el) => (el.tagName || '').toUpperCase();

  function isSkipped(el) {
    const t = tag(el);
    if (SKIP_TAGS.has(t) && !isCheckbox(el)) return true;
    if (el.getAttribute('data-markdown-copy') === 'exclude') return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.hasAttribute('data-d-image-loading')) return true;
    if (el.hidden) return true;
    return false;
  }

  function isCheckbox(el) {
    return el.getAttribute && (el.getAttribute('role') === 'checkbox' || comp(el) === 'checkbox' ||
      (tag(el) === 'INPUT' && el.getAttribute('type') === 'checkbox'));
  }

  function isChecked(el) {
    return el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked' ||
      (tag(el) === 'INPUT' && el.checked === true);
  }

  function isMath(el) {
    return comp(el) === 'math' || (el.classList && (el.classList.contains('katex') || el.classList.contains('katex-display')));
  }

  function isBlockMath(el) {
    return el.hasAttribute('data-d-block') || (el.classList && el.classList.contains('katex-display')) ||
      !!(el.closest && el.closest('.katex-display'));
  }

  function isBlock(el) {
    if (isMath(el)) return isBlockMath(el);
    if (el.hasAttribute('data-d-inline')) return false;
    if (comp(el) === 'caption') return true;
    return BLOCK_TAGS.has(tag(el));
  }

  // ---------- text helpers ----------

  function escapeText(s) {
    return s
      .replace(/[ \t\n\r\f]+/g, ' ') // HTML whitespace collapsing, as the browser renders it
      .replace(/\u00a0/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/([*`$~])/g, '\\$1')
      .replace(/(^|[^\w])_|_(?=[^\w]|$)/g, (m) => m.replace('_', '\\_'))
      .replace(/<(?=[A-Za-z/!])/g, '\\<');
  }

  // Escape characters that would turn a paragraph's first characters into block syntax.
  function escapeLineStart(s) {
    return s
      .replace(/^(\s*)(#{1,6}\s)/, '$1\\$2')
      .replace(/^(\s*)>/, '$1\\>')
      .replace(/^(\s*)([-+]\s)/, '$1\\$2')
      .replace(/^(\s*)(\d+)([.)]\s)/, '$1$2\\$3');
  }

  // Collapse runs of spaces across inline nodes (as rendered) but keep "  \n" hard breaks.
  function tidyInline(s) {
    return s.replace(/ {2,}(?!\n)/g, ' ').replace(/(^|[^ ]) \n/g, '$1\n').replace(/\n /g, '\n');
  }

  // Blank line between blocks, except consecutive task items (keeps the list tight).
  function joinBlocks(blocks) {
    let out = '';
    for (const b of blocks) {
      if (!b) continue;
      const tight = /^- \[[ x]\] [^\n]*$/.test(b) && /(^|\n)- \[[ x]\] [^\n]*$/.test(out);
      out += (out ? (tight ? '\n' : '\n\n') : '') + b;
    }
    return out;
  }

  function wrap(inner, delim) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    if (!m[2]) return inner;
    return m[1] + delim + m[2] + delim + m[3];
  }

  function codeSpan(text) {
    text = text.replace(/\n/g, ' ');
    const runs = text.match(/`+/g) || [];
    const n = runs.reduce((a, r) => Math.max(a, r.length), 0) + 1;
    const fence = '`'.repeat(n);
    const pad = /^`|`$/.test(text) ? ' ' : '';
    return fence + pad + text + pad + fence;
  }

  function codeFence(code, lang) {
    const runs = code.match(/`{3,}/g) || [];
    const n = Math.max(3, runs.reduce((a, r) => Math.max(a, r.length + 1), 0));
    const fence = '`'.repeat(n);
    return fence + (lang || '') + '\n' + code.replace(/\n+$/, '') + '\n' + fence;
  }

  function cleanUrl(href, baseUrl) {
    if (!href) return '';
    let u;
    try { u = new URL(href, baseUrl || 'https://chatgpt.com/'); } catch (_) { return href; }
    if (!/^(https?|mailto|tel):$/.test(u.protocol)) return '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(k)) u.searchParams.delete(k);
    }
    let s = u.toString();
    if (u.search === '' ) s = s.replace(/\?$/, '');
    return s.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  /** Visible text with line breaks, for code sources (jsdom has no innerText). */
  function blockText(el) {
    if (typeof el.innerText === 'string') return el.innerText;
    let out = '';
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.textContent;
        else if (c.nodeType === 1) {
          if (tag(c) === 'BR') { out += '\n'; continue; }
          const blockish = tag(c) === 'DIV' || tag(c) === 'P' || (c.getAttribute('style') || '').includes('display: block');
          if (blockish && out && !out.endsWith('\n')) out += '\n';
          walk(c);
          if (blockish && !out.endsWith('\n')) out += '\n';
        }
      }
    })(el);
    return out;
  }

  function mathTex(el) {
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    return (ann ? ann.textContent : el.textContent).trim();
  }

  function codeLanguage(label) {
    const l = (label || '').trim().toLowerCase();
    if (!l || l === 'plain text' || l === 'text' || l === 'plaintext') return '';
    const map = {
      'c++': 'cpp', 'c#': 'csharp', 'f#': 'fsharp', 'objective-c': 'objectivec',
      'shell': 'sh', 'bash': 'bash', 'zsh': 'zsh', 'powershell': 'powershell',
      'javascript': 'javascript', 'typescript': 'typescript', 'jsx': 'jsx', 'tsx': 'tsx',
      'html': 'html', 'css': 'css', 'json': 'json', 'yaml': 'yaml', 'markdown': 'markdown',
      'sql': 'sql', 'python': 'python', 'go': 'go', 'rust': 'rust', 'mermaid': 'mermaid',
    };
    return map[l] || l.replace(/\s+/g, '-');
  }

  function firstText(el) {
    const walker = el.ownerDocument.createTreeWalker(el, 4 /* SHOW_TEXT */);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.textContent.trim();
      if (t) return t;
    }
    return '';
  }

  function plainText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // ---------- converter ----------

  class Converter {
    constructor(ctx) {
      this.ctx = Object.assign({
        image: async (img) => img.getAttribute('src') || null,
        rasterize: async () => null,
        baseUrl: 'https://chatgpt.com/',
      }, ctx || {});
    }

    async image(img, alt) {
      if (!img) return '';
      const ref = await this.ctx.image(img);
      if (!ref) return '';
      return '![' + (alt || img.getAttribute('alt') || '').replace(/[\[\]\n]/g, ' ').trim() + '](' + ref + ')';
    }

    async raster(el, alt, kind) {
      const ref = await this.ctx.rasterize(el, kind);
      if (!ref) return null;
      return '![' + (alt || '').replace(/[\[\]\n]/g, ' ').trim() + '](' + ref + ')';
    }

    // ----- blocks -----

    /** Render the children of `el` as an array of Markdown blocks. */
    async blocks(el, st) {
      const out = [];
      let buf = '';
      const flush = () => {
        const t = tidyInline(buf).trim();
        if (t) out.push(escapeLineStart(t));
        buf = '';
      };
      for (const c of el.childNodes) {
        if (c.nodeType === 3) { buf += escapeText(c.textContent); continue; }
        if (c.nodeType !== 1 || isSkipped(c)) continue;
        if (isBlock(c) || this.isBlockWidget(c)) {
          flush();
          const b = await this.block(c, st);
          if (Array.isArray(b)) out.push(...b.filter(Boolean));
          else if (b) out.push(b);
        } else {
          buf += await this.inline(c, st);
        }
      }
      flush();
      return out;
    }

    isBlockWidget(el) {
      return !!widget(el) || el.hasAttribute('data-chatgpt-mermaid-preview') ||
        (comp(el) === 'box' && !el.hasAttribute('data-d-inline')) || comp(el) === 'image' ||
        comp(el) === 'table' || comp(el) === 'divider';
    }

    async block(el, st) {
      st = st || {};
      const t = tag(el);
      const c = comp(el);
      const w = widget(el);

      if (isMath(el)) return '$$\n' + mathTex(el) + '\n$$';
      if (w === 'code_block' || el.hasAttribute('data-code-block')) return this.codeWidget(el);
      if (el.hasAttribute('data-chatgpt-mermaid-preview')) return this.mermaid(el);
      if (w === 'visualization') return this.visualization(el);
      if (w) return this.blocks(el, st); // unknown widget: best effort text
      if (c === 'divider' || t === 'HR') return '---';
      if (c === 'image') return this.image(el.querySelector('img'));
      if (c === 'caption') { const s = await this.inlineChildren(el, st); return s.trim() ? wrap(s.trim(), '*') : ''; }
      if (c === 'box') return this.box(el, st);
      if (/^H[1-6]$/.test(t)) {
        const s = (await this.inlineChildren(el, st)).replace(/\s*\n\s*/g, ' ').trim();
        return s ? '#'.repeat(+t[1]) + ' ' + s : '';
      }
      if (t === 'UL' || t === 'OL') return this.list(el, st);
      if (t === 'LI') return this.listItemFallback(el, st);
      if (t === 'BLOCKQUOTE') {
        const inner = joinBlocks(await this.blocks(el, st));
        return inner ? inner.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n') : '';
      }
      if (t === 'PRE') return this.pre(el);
      if (t === 'TABLE' || c === 'table') {
        const table = t === 'TABLE' ? el : el.querySelector('table');
        return table ? this.table(table, st) : this.blocks(el, st);
      }
      if (t === 'P') {
        if (this.singleCheckbox(el)) return this.taskLine(el, st);
        const s = (await this.inlineChildren(el, st)).trim();
        return s ? escapeLineStart(s) : '';
      }
      // Generic container (div, section, ...).
      if (this.singleCheckbox(el)) return this.taskLine(el, st);
      return this.blocks(el, st);
    }

    // A container holding exactly one checkbox (and no nested list) is a task item.
    singleCheckbox(el) {
      const boxes = el.querySelectorAll('[role="checkbox"], [data-d-component="checkbox"], input[type="checkbox"]');
      if (boxes.length !== 1) return null;
      if (el.querySelector('ul, ol')) return null;
      return boxes[0];
    }

    async taskLine(el, st) {
      const box = this.singleCheckbox(el);
      const text = (await this.inlineChildren(el, Object.assign({}, st, { skip: box })))
        .replace(/\s+/g, ' ').trim();
      const line = '[' + (isChecked(box) ? 'x' : ' ') + '] ' + text;
      return st && st.inListItem ? line : '- ' + line;
    }

    async codeWidget(el) {
      if (el.querySelector('[data-chatgpt-mermaid-preview]')) {
        return this.mermaid(el.querySelector('[data-chatgpt-mermaid-preview]'));
      }
      let code = null;
      const holder = el.hasAttribute('data-chatgpt-copy-code') ? el : el.querySelector('[data-chatgpt-copy-code]');
      if (holder) code = holder.getAttribute('data-chatgpt-copy-code').replace(/^\n+/, '');
      if (code == null) {
        const src = el.querySelector('[data-code-block-source]') || el.querySelector('[role="textbox"]') ||
          el.querySelector('code') || el.querySelector('pre');
        code = src ? blockText(src).replace(/^\n/, '') : '';
      }
      const header = el.querySelector('[data-markdown-copy="exclude"]');
      const lang = header ? codeLanguage(firstText(header)) : '';
      return codeFence(code, lang);
    }

    async mermaid(el) {
      const pane = el.querySelector('[data-code-block-preview-pane]') || el;
      const img = await this.raster(pane, 'Mermaid diagram', 'mermaid');
      return img || '*[Mermaid diagram — không chụp được ảnh]*';
    }

    async visualization(el) {
      const title = firstText(el);
      const img = await this.raster(el, title || 'Chart', 'chart');
      if (img) return img;
      return this.blocks(el, {});
    }

    // Visual layout inside a card (diagram arrows, grids, drawings). Icons inside
    // buttons/excluded UI chrome do not count.
    hasVisual(el) {
      const cands = el.querySelectorAll('img[data-d-component="svg"], svg:not([data-d-component="icon"]), [data-d-component="grid"], [data-d-component="row"]');
      return [...cands].some((c) => !c.closest('button, [data-markdown-copy="exclude"], [data-d-component="image"]'));
    }

    async box(el, st) {
      // Image wrapper boxes: let the image component handle it (original image file).
      if (el.querySelector('[data-d-component="image"]') && !this.hasVisual(el)) {
        return this.blocks(el, st);
      }
      // Checklist cards: keep as Markdown tasks (interactive in Obsidian).
      if (el.querySelector('[role="checkbox"], [data-d-component="checkbox"]')) {
        return this.blocks(el, st);
      }
      if (this.hasVisual(el)) {
        const cap = el.querySelector('[data-d-component="caption"]');
        const alt = (cap ? plainText(cap) : '') || firstText(el) || 'Diagram';
        const img = await this.raster(el, alt.slice(0, 120), 'diagram');
        if (img) return img;
      }
      // Plain card: render its content as a callout.
      const inner = joinBlocks(await this.blocks(el, st));
      return inner;
    }

    async pre(el) {
      const code = el.querySelector('code') || el;
      const m = /(?:^|\s)language-([\w+#.-]+)/.exec(code.getAttribute('class') || '');
      return codeFence(code.textContent, m ? codeLanguage(m[1]) : '');
    }

    async list(el, st) {
      const ordered = tag(el) === 'OL';
      let n = ordered ? (parseInt(el.getAttribute('start'), 10) || 1) : 0;
      const items = [];
      for (const li of el.children) {
        if (tag(li) !== 'LI') continue;
        const marker = ordered ? (n++) + '.' : '-';
        const body = await this.listItemBody(li, st);
        const pad = ' '.repeat(marker.length + 1);
        const lines = body.split('\n');
        items.push(marker + ' ' + lines[0] + (lines.length > 1 ? '\n' + lines.slice(1).map((l) => (l ? pad + l : '')).join('\n') : ''));
      }
      return items.join('\n');
    }

    async listItemBody(li, st) {
      const sub = Object.assign({}, st, { inListItem: true });
      const box = this.singleCheckbox(li);
      if (box) {
        // Task item: checkbox + label; nested content (if any) is rare.
        return this.taskLine(li, sub);
      }
      const bs = await this.blocks(li, sub);
      return bs.join('\n');
    }

    async listItemFallback(li, st) {
      return '- ' + (await this.listItemBody(li, st));
    }

    async table(table, st) {
      const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
      if (!rows.length) return '';
      const grid = [];
      const aligns = [];
      for (const tr of rows) {
        const cells = [];
        for (const cell of tr.children) {
          if (tag(cell) !== 'TD' && tag(cell) !== 'TH') continue;
          const bs = await this.blocks(cell, Object.assign({}, st, { inTable: true }));
          let s = bs.join('<br>').replace(/\n/g, '<br>').replace(/\|/g, '\\|').trim();
          cells.push(s);
          const i = cells.length - 1;
          if (aligns[i] == null) {
            const a = cell.getAttribute('data-d-align') || cell.getAttribute('align') ||
              ((cell.getAttribute('style') || '').match(/text-align:\s*(\w+)/) || [])[1] || '';
            aligns[i] = a;
          }
        }
        grid.push(cells);
      }
      const width = Math.max(...grid.map((r) => r.length));
      const fmt = (r) => '| ' + Array.from({ length: width }, (_, i) => r[i] || '').join(' | ') + ' |';
      const sep = '| ' + Array.from({ length: width }, (_, i) => {
        const a = (aligns[i] || '').toLowerCase();
        if (a === 'center') return ':---:';
        if (a === 'end' || a === 'right') return '---:';
        if (a === 'start' || a === 'left') return ':---';
        return '---';
      }).join(' | ') + ' |';
      return [fmt(grid[0]), sep, ...grid.slice(1).map(fmt)].join('\n');
    }

    // ----- inline -----

    async inlineChildren(el, st) {
      let s = '';
      for (const c of el.childNodes) {
        if (st && st.skip === c) continue;
        if (c.nodeType === 3) s += escapeText(c.textContent);
        else if (c.nodeType === 1 && !isSkipped(c)) {
          if (st && st.skip && c.contains(st.skip) && c !== st.skip) {
            s += await this.inlineChildren(c, st);
            continue;
          }
          if (isBlock(c) || this.isBlockWidget(c)) {
            // Block inside inline context (e.g. <p> inside a table cell or label).
            const b = await this.block(c, st);
            const txt = Array.isArray(b) ? b.join('\n') : (b || '');
            if (txt) s += (s && !/\n$/.test(s) ? '\n' : '') + txt + '\n';
          } else {
            s += await this.inline(c, st);
          }
        }
      }
      return tidyInline(s).replace(/\n+$/, '');
    }

    async inline(el, st) {
      const t = tag(el);
      const c = comp(el);
      if (isCheckbox(el)) return '[' + (isChecked(el) ? 'x' : ' ') + '] ';
      if (isMath(el)) return isBlockMath(el) ? '$$' + mathTex(el) + '$$' : '$' + mathTex(el) + '$';
      if (t === 'BR') return st && st.inTable ? '<br>' : '  \n';
      if (t === 'IMG') {
        if (el.closest('[data-d-component="favicon"]')) return '';
        return this.image(el);
      }
      if (c === 'popover-trigger') {
        if (el.querySelector('a[href]')) return this.inlineChildren(el, st);
        const badge = el.querySelector('[data-d-component="badge"]');
        if (badge) {
          const label = plainText(badge);
          return label ? ' (' + escapeText(label) + ')' : '';
        }
        return this.inlineChildren(el, st);
      }
      if (t === 'CODE' || c === 'code') return codeSpan(el.textContent);
      if (t === 'A') {
        const text = (await this.inlineChildren(el, st)).trim();
        const href = cleanUrl(el.getAttribute('href'), this.ctx.baseUrl);
        if (!href) return text;
        if (!text) return '<' + href + '>';
        return '[' + text.replace(/\n/g, ' ') + '](' + href + ')';
      }

      let s = await this.inlineChildren(el, st);
      const strike = el.getAttribute('data-d-text-decoration') === 'line-through' || t === 'DEL' || t === 'S' || t === 'STRIKE';
      const em = el.getAttribute('data-d-font-style') === 'italic' || t === 'EM' || t === 'I';
      const strong = el.hasAttribute('data-d-default-strong') || t === 'STRONG' || t === 'B' ||
        (t === 'SPAN' && STRONG_WEIGHTS.has(el.getAttribute('data-d-weight') || ''));
      if (strong) s = wrap(s, '**');
      if (em) s = wrap(s, '*');
      if (strike) s = wrap(s, '~~');
      if (t === 'MARK') s = wrap(s, '==');
      if (t === 'SUB') s = s ? '<sub>' + s + '</sub>' : s;
      if (t === 'SUP') s = s ? '<sup>' + s + '</sup>' : s;
      return s;
    }
  }

  async function toMarkdown(rootEl, ctx) {
    const conv = new Converter(ctx);
    const blocks = await conv.blocks(rootEl, {});
    return joinBlocks(blocks).replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /** Response roots that belong to the same turn as `anchor` (an element in the turn). */
  function findResponseRoots(container) {
    const dil = [...container.querySelectorAll('[data-dil-response]')]
      .filter((r) => !r.parentElement.closest('[data-dil-response]'))
      .filter((r) => r.textContent.trim() || r.querySelector('img, svg'));
    if (dil.length) return dil;
    const legacy = [...container.querySelectorAll('[data-message-author-role="assistant"] .markdown')];
    return legacy;
  }

  const api = { toMarkdown, findResponseRoots, Converter, _internal: { escapeText, codeFence, codeSpan, cleanUrl, codeLanguage } };
  root.CGE = root.CGE || {};
  root.CGE.converter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
