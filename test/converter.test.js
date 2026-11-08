// Fixtures mirror the DIL markup observed on chatgpt.com (Nov 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { toMarkdown, findResponseRoots } = require('../src/converter.js');

function root(html, inject) {
  const dom = new JSDOM('<!doctype html><body><div data-dil-response="" data-dil-message-id="m1"></div></body>');
  const r = dom.window.document.querySelector('[data-dil-response]');
  r.innerHTML = html;
  // React builds <p><div>…</div></p> nests that the HTML parser would split.
  // Setting innerHTML on the <p> itself (fragment parsing) keeps them, like the live DOM.
  for (const [sel, inner] of Object.entries(inject || {})) r.querySelector(sel).innerHTML = inner;
  return r;
}

const md = (html, ctx) => toMarkdown(root(html), ctx);

test('bold, italic, bold-italic, strike, inline code (DIL attributes)', async () => {
  const out = await md(`
    <p data-d-text-flow="" data-d-component="text">
      <span data-d-stream-run="">This paragraph demonstrates </span>
      <span data-d-component="text" data-d-default-strong="" data-d-inline=""><span data-d-stream-run="">bold text</span></span><span data-d-stream-run="">, </span>
      <span data-d-component="text" data-d-font-style="italic" data-d-inline=""><span data-d-stream-run="">italic text</span></span><span data-d-stream-run="">, </span>
      <span data-d-component="text" data-d-font-style="italic" data-d-inline=""><span data-d-component="text" data-d-default-strong=""><span>bold italic</span></span></span><span>, </span>
      <span data-d-component="text" data-d-text-decoration="line-through"><span>gone</span></span><span>, </span>
      <code data-d-component="code"><span>inline code</span></code><span>.</span>
    </p>`);
  assert.equal(out, 'This paragraph demonstrates **bold text**, *italic text*, ***bold italic***, ~~gone~~, `inline code`.\n');
});

test('whitespace inside emphasis is moved outside the delimiters', async () => {
  const out = await md('<p data-d-component="text">a<span data-d-default-strong=""> b </span>c</p>');
  assert.equal(out, 'a **b** c\n');
});

test('links: popover link keeps href, strips utm_*; citation badge becomes (label)', async () => {
  const out = await toMarkdown(root('<p id="p" data-d-component="text"></p>', { '#p': `<span>See </span>
      <span data-d-component="popover-trigger" data-d-inline-text="" role="presentation">
        <a href="https://example.com/a?utm_source=chatgpt.com&x=1"><span data-d-text-decoration="underline-dotted">the docs</span><span><svg data-d-component="icon"></svg></span></a>
      </span><span> now</span>
      <span data-d-component="popover-trigger" role="button"><span data-d-component="box" data-d-inline=""><div data-d-component="badge"><span><div data-d-component="favicon"><img src="https://www.google.com/s2/favicons?domain=mdn"></div></span><span><span>MDN</span></span></div></span></span>` }));
  assert.equal(out, 'See [the docs](https://example.com/a?x=1) now (MDN)\n');
});

test('headings', async () => {
  const out = await md(`
    <h1 data-d-component="title" data-d-size="xl"><span>Title</span></h1>
    <h2 data-d-component="title">Sub <span data-d-default-strong="">bold</span></h2>
    <h3 data-d-component="title">Third</h3>`);
  assert.equal(out, '# Title\n\n## Sub **bold**\n\n### Third\n');
});

test('nested bullet list (3 levels) and numbered list', async () => {
  const li = (text, nested = '') => `<li data-d-component="list-item"><div><div data-d-list-item-content=""><p data-d-component="text"><span>${text}</span></p>${nested}</div></div></li>`;
  const ul = (items) => `<ul data-d-component="list" data-d-marker="bullet">${items}</ul>`;
  const out = await md(
    ul(li('Level 1', ul(li('Level 2', ul(li('Level 3a') + li('Level 3b')))))) +
    `<ol data-d-component="list" data-d-marker="number">${li('One')}${li('Two')}</ol>`
  );
  assert.equal(out, '- Level 1\n  - Level 2\n    - Level 3a\n    - Level 3b\n\n1. One\n2. Two\n');
});

test('ordered list honours start attribute', async () => {
  const out = await md('<ol start="4"><li><p>Four</p></li><li><p>Five</p></li></ol>');
  assert.equal(out, '4. Four\n5. Five\n');
});

test('task list from DIL checkboxes', async () => {
  const item = (checked, text) => `<li data-d-component="list-item"><div><div data-d-list-item-content=""><div data-d-has-label="" data-d-orientation="left"><button role="checkbox" aria-checked="${checked}" data-d-component="checkbox" data-state="${checked ? 'checked' : 'unchecked'}"><span></span></button><label><span>${text}</span></label></div></div></div></li>`;
  const out = await md(`<ul data-d-component="list">${item(true, 'Done thing')}${item(false, 'Todo thing')}</ul>`);
  assert.equal(out, '- [x] Done thing\n- [ ] Todo thing\n');
});

test('checklist card (box with checkboxes, no list) becomes tasks', async () => {
  const row = (text) => `<div data-d-component="row"><div data-d-has-label=""><button role="checkbox" aria-checked="false" data-d-component="checkbox"></button><label><span>${text}</span></label></div></div>`;
  const out = await md(`<div data-d-component="box"><p data-d-component="text"><span data-d-default-strong="">Readiness</span></p>${row('Capture errors')}${row('Upload source maps')}</div>`);
  assert.equal(out, '**Readiness**\n\n- [ ] Capture errors\n- [ ] Upload source maps\n');
});

test('blockquote with several paragraphs', async () => {
  const out = await md('<blockquote data-d-component="blockquote"><p data-d-component="text">Line one</p><p data-d-component="text">Line two</p></blockquote>');
  assert.equal(out, '> Line one\n>\n> Line two\n');
});

test('table with alignment, pipes escaped', async () => {
  const cell = (t, a, tagName = 'td') => `<${tagName} data-d-component="table-cell" data-d-align="${a}"><p data-d-component="text">${t}</p></${tagName}>`;
  const out = await md(`
    <div data-d-component="table" data-d-column-sizing="auto"><div data-d-table-viewport="true"><table><tbody>
      <tr data-d-component="table-row">${cell('Left', 'start', 'th')}${cell('Center', 'center', 'th')}${cell('Right', 'end', 'th')}</tr>
      <tr data-d-component="table-row">${cell('<span data-d-default-strong="">Py</span>', 'start')}${cell('a|b', 'center')}${cell('95', 'end')}</tr>
    </tbody></table></div></div>`);
  assert.equal(out, '| Left | Center | Right |\n| :--- | :---: | ---: |\n| **Py** | a\\|b | 95 |\n');
});

test('code block widget: raw code from data-chatgpt-copy-code, language from header', async () => {
  const code = 'from dataclasses import dataclass\n\n@dataclass\nclass User:\n    name: str';
  const out = await md(`
    <div data-client-defined-widget="code_block"><div data-chatgpt-copy-code="${code.replace(/"/g, '&quot;')}">
      <div data-code-block="true" data-markdown-copy="code-block">
        <div data-markdown-copy="exclude"><svg></svg>Python<div data-code-block-controls="true"><button aria-label="Copy code"></button><button aria-label="Run code">Run</button></div></div>
        <div><div role="textbox" aria-label="Edit code"><br><span>from</span> ...</div></div>
      </div></div></div>`);
  assert.equal(out, '```python\n' + code + '\n```\n');
});

test('code block widget without copy attribute falls back to source text', async () => {
  const out = await md(`
    <div data-client-defined-widget="code_block"><div data-code-block="true">
      <div data-markdown-copy="exclude"><div>Plain text</div><div data-code-block-controls="true"><button>Copy</button></div></div>
      <div data-code-block-source="true"><code><span><div>line 1</div><div>line \`2\`</div></span></code></div>
    </div></div>`);
  assert.equal(out, '```\nline 1\nline `2`\n```\n');
});

test('code containing ``` uses a longer fence', async () => {
  const code = 'echo ```\n';
  const out = await md(`<div data-client-defined-widget="code_block"><div data-chatgpt-copy-code="${code}"><div data-markdown-copy="exclude"><div>Bash</div></div></div></div>`);
  assert.equal(out, '````bash\necho ```\n````\n');
});

test('math: inline and block from KaTeX annotation', async () => {
  const katex = (tex) => `<span><span><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span aria-hidden="true">garbage</span></span>`;
  const out = await md(`
    <p data-d-component="text"><span>Energy </span><span data-d-component="math" data-d-inline="">${katex('E=mc^2')}</span><span>.</span></p>
    <div data-d-component="math" data-d-block="" dir="ltr">${katex('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')}</div>`);
  assert.equal(out, 'Energy $E=mc^2$.\n\n$$\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$\n');
});

test('divider, caption, literal $ and * are escaped', async () => {
  const out = await md(`
    <p data-d-component="text">Costs $5 and 2*3</p>
    <div data-d-component="divider"></div>
    <span data-d-component="caption">Figure note</span>`);
  assert.equal(out, 'Costs \\$5 and 2\\*3\n\n---\n\n*Figure note*\n');
});

test('image component -> ctx.image; favicons ignored', async () => {
  const out = await md(`
    <div data-d-component="box"><div data-d-component="box" data-d-clip="true"><div data-d-component="image" data-d-hover-zoom="">
      <img alt="Eiffel tower" src="https://images.openai.com/x.jpg"><div data-d-image-loading=""></div>
      <button data-d-component="pressable" aria-label="Open Eiffel tower"></button>
    </div></div></div>`, { image: async (img) => 'attachments/a-1.jpg' });
  assert.equal(out, '![Eiffel tower](attachments/a-1.jpg)\n');
});

test('diagram box, chart widget and mermaid preview are rasterized', async () => {
  const calls = [];
  const out = await md(`
    <div data-d-component="box"><span>Architecture</span><div data-d-component="grid"><div data-d-component="box">A</div><img data-d-component="svg" src="data:image/svg+xml,x"></div><span data-d-component="caption">Flow overview</span></div>
    <div data-client-defined-widget="visualization"><div><section><div><div>Error rate</div></div><svg></svg><ul><li>10:00 0.2%</li></ul></section></div></div>
    <div data-client-defined-widget="code_block"><div data-chatgpt-mermaid-preview=""><div data-block-actions="true" data-markdown-copy="exclude"><button>x</button></div><div data-code-block-preview-pane="mermaid"><div data-mermaid-render-status="ready"><svg aria-label="Mermaid diagram"></svg></div></div></div></div>`,
    { rasterize: async (el, kind) => { calls.push(kind); return `attachments/${kind}.png`; } });
  assert.deepEqual(calls, ['diagram', 'chart', 'mermaid']);
  assert.equal(out, '![Flow overview](attachments/diagram.png)\n\n![Error rate](attachments/chart.png)\n\n![Mermaid diagram](attachments/mermaid.png)\n');
});

test('rasterize failure falls back to text content', async () => {
  const out = await md('<div data-d-component="box"><div data-d-component="grid"><p data-d-component="text">Node A</p></div></div>',
    { rasterize: async () => null });
  assert.equal(out, 'Node A\n');
});

test('legacy semantic HTML (.markdown) is supported', async () => {
  const dom = new JSDOM(`<div data-message-author-role="assistant"><div class="markdown prose">
    <p>Hi <strong>bold</strong> <em>it</em> <del>x</del> <a href="https://a.b/c">link</a></p>
    <pre><div>python<button>Copy</button></div><div><code class="language-python">print(1)\n</code></div></pre>
    <table><thead><tr><th>A</th><th style="text-align:right">B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
    <span class="katex"><math><semantics><annotation encoding="application/x-tex">a^2</annotation></semantics></math></span>
  </div></div>`);
  const roots = findResponseRoots(dom.window.document);
  assert.equal(roots.length, 1);
  const out = await toMarkdown(roots[0]);
  assert.equal(out, 'Hi **bold** *it* ~~x~~ [link](https://a.b/c)\n\n```python\nprint(1)\n```\n\n| A | B |\n| --- | ---: |\n| 1 | 2 |\n\n$a^2$\n');
});

test('findResponseRoots skips empty DIL roots', async () => {
  const dom = new JSDOM('<div data-turn-key="t"><div data-dil-response=""></div><div data-dil-response=""><p>x</p></div></div>');
  assert.equal(findResponseRoots(dom.window.document).length, 1);
});

test('<br> becomes a hard line break; whitespace collapses like the browser', async () => {
  const out = await md('<p data-d-component="text">line   one<br>line\n   two</p>');
  assert.equal(out, 'line one  \nline two\n');
});

test('image card whose only svg is a button icon exports the image, not a screenshot', async () => {
  const calls = [];
  const out = await md(`
    <div data-d-component="box"><div data-d-component="box" data-d-clip="true"><div data-d-component="image" data-d-stream-media="">
      <img alt="Eiffel" src="https://images.openai.com/e.jpg"><div data-d-image-loading=""></div>
      <button data-d-component="pressable" aria-label="Open Eiffel"><svg><use href="/cdn/icons.svg#x"></use></svg></button>
    </div></div></div>`, { image: async () => 'attachments/e.jpg', rasterize: async (el, k) => { calls.push(k); return 'x.png'; } });
  assert.deepEqual(calls, []);
  assert.equal(out, '![Eiffel](attachments/e.jpg)\n');
});

test('copy-code attribute with a leading newline (editor blocks) is trimmed', async () => {
  const out = await md('<div data-client-defined-widget="code_block"><div data-chatgpt-copy-code="\nprint(1)\n"><div data-markdown-copy="exclude"><div>Python</div></div></div></div>');
  assert.equal(out, '```python\nprint(1)\n```\n');
});
