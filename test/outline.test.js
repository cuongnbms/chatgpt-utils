// Fixtures mirror the turn markup observed on chatgpt.com (Nov 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { collectOutline } = require('../src/outline.js');

function doc(html) {
  return new JSDOM('<!doctype html><body><main>' + html + '</main></body>').window.document;
}

const turn = (question, answer) => `
  <div data-turn-key="${Math.random()}">
    ${question == null ? '' : `<div data-user-message-bubble="true"><div><div>${question}</div></div></div>`}
    <div data-dil-response="" data-dil-message-id="x">${answer}</div>
    <div><button aria-label="Copy"></button></div>
  </div>`;

const simplify = (outline) => outline.map((g) => ({
  q: g.question && g.question.text,
  items: g.items.map((i) => i.level + ':' + i.text),
}));

test('groups H1–H3 headings under each user question, in document order', () => {
  const d = doc(
    turn('Error tracking là gì?', '<h1 data-d-component="title">Topic 1</h1><p>x</p><h2>1. Định nghĩa</h2><h3>1.1 <span data-d-default-strong="">Chi tiết</span></h3><h4>bỏ qua</h4>') +
    turn('So sánh với logging', '<h2>Logging</h2><h2>Monitoring</h2>')
  );
  assert.deepEqual(simplify(collectOutline(d)), [
    { q: 'Error tracking là gì?', items: ['1:Topic 1', '2:1. Định nghĩa', '3:1.1 Chi tiết'] },
    { q: 'So sánh với logging', items: ['2:Logging', '2:Monitoring'] },
  ]);
});

test('items keep a reference to the live heading element', () => {
  const d = doc(turn('Q', '<h2 id="target">Phần A</h2>'));
  const [g] = collectOutline(d);
  assert.equal(g.items[0].el, d.getElementById('target'));
  assert.equal(g.question.el, d.querySelector('[data-user-message-bubble]'));
});

test('question text: first line only, whitespace collapsed, truncated to 60 chars', () => {
  const long = 'a'.repeat(80);
  const d = doc(turn('Dòng   một\nDòng hai', '<h2>X</h2>') + turn(long, '<h2>Y</h2>'));
  const out = collectOutline(d);
  assert.equal(out[0].question.text, 'Dòng một');
  assert.equal(out[1].question.text, 'a'.repeat(59) + '…');
});

test('maxLevel option limits heading depth', () => {
  const d = doc(turn('Q', '<h1>A</h1><h2>B</h2><h3>C</h3>'));
  assert.deepEqual(simplify(collectOutline(d, { maxLevel: 2 }))[0].items, ['1:A', '2:B']);
});

test('ignores empty headings and headings inside excluded UI chrome', () => {
  const d = doc(turn('Q', '<h2> </h2><div data-markdown-copy="exclude"><h3>UI</h3></div><h2>Real</h2>'));
  assert.deepEqual(simplify(collectOutline(d))[0].items, ['2:Real']);
});

test('a turn without headings still appears (question is a jump target)', () => {
  const d = doc(turn('Chỉ hỏi ngắn', '<p>trả lời ngắn</p>'));
  assert.deepEqual(simplify(collectOutline(d)), [{ q: 'Chỉ hỏi ngắn', items: [] }]);
});

test('a turn with no user bubble has question = null', () => {
  const d = doc(turn(null, '<h2>Intro</h2>'));
  assert.deepEqual(simplify(collectOutline(d)), [{ q: null, items: ['2:Intro'] }]);
});

test('legacy markup: data-message-author-role user/assistant articles', () => {
  const d = doc(`
    <article data-testid="conversation-turn-1"><div data-message-author-role="user"><div>Câu hỏi cũ</div></div></article>
    <article data-testid="conversation-turn-2"><div data-message-author-role="assistant"><div class="markdown"><h2>Trả lời</h2></div></div></article>`);
  assert.deepEqual(simplify(collectOutline(d)), [{ q: 'Câu hỏi cũ', items: ['2:Trả lời'] }]);
});

test('ignores the previous conversation that ChatGPT keeps mounted but hidden', () => {
  // Observed after switching chats: the old thread stays in the DOM inside
  // <div style="display: none !important;">.
  const d = doc(
    `<div class="relative h-full min-h-0" style="display: none !important;">${turn('Câu hỏi cũ', '<h2>Cũ</h2>')}</div>` +
    `<div class="relative h-full min-h-0">${turn('Câu hỏi mới', '<h2>Mới</h2>')}</div>`
  );
  assert.deepEqual(simplify(collectOutline(d)), [{ q: 'Câu hỏi mới', items: ['2:Mới'] }]);
});

test('ignores headings inside cards/widgets (e.g. stat numbers in a box)', () => {
  const d = doc(turn('Q', '<h2>1. Error Tracking là gì?</h2><div data-d-component="box"><div data-d-component="grid"><h2 data-d-component="title">1,284</h2><h2>326</h2></div></div><div data-client-defined-widget="visualization"><h3>Chart</h3></div><h2>2. Tiếp</h2>'));
  assert.deepEqual(simplify(collectOutline(d))[0].items, ['2:1. Error Tracking là gì?', '2:2. Tiếp']);
});

test('flattenOutline: questions always shown, headings filtered by the H1/H2/H3 level', () => {
  const { flattenOutline } = require('../src/outline.js');
  const d = doc(turn('Q1', '<h1>A</h1><h2>A.1</h2><h3>A.1.1</h3><h2>A.2</h2>') + turn('Q2', '<h2>B</h2>'));
  const groups = collectOutline(d);
  const show = (lv) => flattenOutline(groups, lv).map((e) => (e.level ? e.level + ':' : 'Q:') + e.text);
  assert.deepEqual(show(1), ['Q:Q1', '1:A', 'Q:Q2']);
  assert.deepEqual(show(2), ['Q:Q1', '1:A', '2:A.1', '2:A.2', 'Q:Q2', '2:B']);
  assert.deepEqual(show(3), ['Q:Q1', '1:A', '2:A.1', '3:A.1.1', '2:A.2', 'Q:Q2', '2:B']);
});
