/* Dev-only check (not part of the deliverable page).
 * Loads tutorials.js and app.js against a stub DOM and verifies:
 *   1. tutorials.js is in sync with docs/tutorials/*.md,
 *   2. every page renders with no markdown left unconverted,
 *   3. every heading and sidebar section anchor resolves,
 *   4. every cross-page link points at an anchor that exists,
 *   5. every "Load into canvas" block is a config the app accepts.
 * Run: node tools/tutorials-test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'tutorials');

/* ---------- stub DOM ---------- */
const cache = new Map();
function fakeEl(sel) {
  const el = {
    sel, dataset: {}, style: {}, value: '', textContent: '', innerHTML: '', checked: false, files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    setPointerCapture() {}, focus() {}, select() {}, click() {},
    querySelector() { return fakeEl(sel + ' *'); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }; },
    closest() { return null; }
  };
  return el;
}
function q(sel) { if (!cache.has(sel)) cache.set(sel, fakeEl(sel)); return cache.get(sel); }
global.document = {
  querySelector: q, querySelectorAll: () => [], createElement: () => fakeEl('created'),
  addEventListener() {}, body: fakeEl('body'), elementFromPoint: () => null
};
global.window = global;
global.addEventListener = () => {};
global.requestAnimationFrame = () => {};
Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: () => Promise.resolve() } }, configurable: true });
global.confirm = () => true;
global.prompt = () => null;
global.Blob = class {};
global.URL = { createObjectURL: () => '', revokeObjectURL: () => {} };
global.FileReader = class {};

/* ---------- load the bundle, then app.js ---------- */
new Function(fs.readFileSync(path.join(ROOT, 'tutorials.js'), 'utf8'))();
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')
  + '\nglobalThis.__api = { mdToHtml, mdInline, TUT_SLUG, tutPages, tutLoadable, tutHl, validate };\n';
new Function(src)();
const A = globalThis.__api;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '\n       ' + extra : '')); }
}

/* ---------- 1. bundle is in sync ---------- */
console.log('\nBundle');
let sync = true, syncErr = '';
try { execFileSync(process.execPath, [path.join(__dirname, 'build-tutorials.cjs'), '--check'], { stdio: 'pipe' }); }
catch (e) { sync = false; syncErr = String(e.stderr || e.message).trim(); }
ok(sync, 'tutorials.js matches docs/tutorials/*.md', syncErr);

const pages = A.tutPages();
const mdFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.md'));
ok(pages.length === mdFiles.length, 'bundle has one page per markdown file ('
  + pages.length + ' vs ' + mdFiles.length + ')');
ok(pages[0] && pages[0].file === 'README.md', 'the index is the first page');
ok(pages.every(p => p.title && p.nav && p.md), 'every page has a title, nav label and body');

/* ---------- 2. rendering ---------- */
console.log('\nRendering');
const rendered = new Map();
for (const p of pages) {
  const r = A.mdToHtml(p.md);
  rendered.set(p.file, r);

  ok(r.html.length > 0, p.file + ': renders');
  ok(!/[\u0000\u0001]/.test(r.html), p.file + ': no placeholder characters left in the output');
  ok(!/\*\*/.test(r.html), p.file + ': no unconverted bold markers');
  ok(!/\]\(/.test(r.html), p.file + ': no unconverted links');
  ok(!/^\s*\|/m.test(r.html), p.file + ': no unconverted table rows');
  ok(!/(^|\n)#{1,6} /.test(r.html), p.file + ': no unconverted headings');
  // a stray backtick would mean inline code was not paired up
  ok(!r.html.includes('`'), p.file + ': no stray backticks');

  const fences = (p.md.match(/```/g) || []).length;
  ok(r.codes.length === fences / 2, p.file + ': ' + r.codes.length + ' code block(s) for '
    + fences + ' fence markers');
  ok(r.codes.every(c => c.body.length > 0), p.file + ': no empty code blocks');

  // every heading in the source became a heading, and every id on the page is unique
  const heads = [...p.md.matchAll(/^(#{1,6}) (.+)$/gm)];
  const hTags = [...r.html.matchAll(/<h[1-6] id="([^"]*)"/g)].map(m => m[1]);
  ok(hTags.length === heads.length, p.file + ': all ' + heads.length + ' headings carry an id ('
    + hTags.length + ' found)');
  const ids = [...r.html.matchAll(/ id="([^"]*)"/g)].map(m => m[1]);
  const dupes = ids.filter((v, k) => ids.indexOf(v) !== k);
  ok(dupes.length === 0, p.file + ': every id on the page is unique', [...new Set(dupes)].join(' | '));

  // sidebar sections must resolve inside the rendered page
  const badToc = p.toc.filter(s => !r.html.includes('id="' + s.anchor + '"'));
  ok(badToc.length === 0, p.file + ': all ' + p.toc.length + ' sidebar sections resolve',
    badToc.map(s => s.text).join(' | '));
}

/* ---------- 3. cross-page links ---------- */
console.log('\nCross-page links');
let links = 0;
for (const [file, r] of rendered) {
  for (const m of r.html.matchAll(/<a class="xref" data-act="tutGo"(?: data-file="([^"]*)")?(?: data-anchor="([^"]*)")?>/g)) {
    links++;
    const targetFile = m[1] || file;
    const anchor = m[2];
    const target = rendered.get(targetFile);
    ok(!!target, file + ' -> ' + targetFile + ': target page is in the bundle');
    if (target && anchor) {
      ok(target.html.includes('id="' + anchor + '"'), file + ' -> ' + targetFile + '#' + anchor + ': anchor exists');
    }
  }
}
ok(links > 0, 'the pages link to each other (' + links + ' link(s))');

/* ---------- 4. loadable code blocks ---------- */
console.log('\nLoad into canvas');
let loadable = 0;
for (const [file, r] of rendered) {
  r.codes.forEach((c, i) => {
    const offered = A.tutLoadable(c);
    const shown = r.html.includes('data-act="tutLoad" data-i="' + i + '"');
    ok(offered === shown, file + ' block ' + (i + 1) + ': button matches loadability');
    if (!offered) return;
    loadable++;
    const v = A.validate(JSON.parse(c.body));
    ok(v.errors.length === 0, file + ' block ' + (i + 1) + ': loads with no errors', v.errors.join('; '));
    ok(!v.meta.breakout, file + ' block ' + (i + 1) + ': is not a breakout config');
  });
}
ok(loadable > 0, 'at least one block is offered for loading (' + loadable + ')');

// the breakout pages must never offer a load, since the canvas refuses them
for (const [file, r] of rendered) {
  if (!/breakout/.test(file)) continue;
  ok(!r.html.includes('data-act="tutLoad"'), file + ': offers no Load button (canvas refuses breakout)');
}
// nor should the empty skeleton in the index
ok(!A.tutLoadable({ lang: 'json', body: '{"profiles":{"layer_1_profiles":[]},"front_panel_ports":[],"connections":[]}' }),
  'the empty skeleton is not offered for loading');

/* ---------- 5. inline renderer edge cases ---------- */
console.log('\nInline renderer');
const cases = [
  ['plain text', 'plain text'],
  ['`a**b**c`', '<code>a**b**c</code>'],                       // no emphasis inside code
  ['**bold**', '<strong>bold</strong>'],
  ['a *word* b', 'a <em>word</em> b'],
  ['**bold with *italic* in it**', '<strong>bold with <em>italic</em> in it</strong>'],
  ['2 * 3 * 4', '2 * 3 * 4'],                                  // lone asterisks left alone
  ['<script>x</script>', '&lt;script&gt;x&lt;/script&gt;'],    // html is escaped
  ['[dead](https://example.com)', 'dead'],                     // unfollowable link degrades to text
  ['[go](01-passthrough-single.md#symmetric)', 'data-act="tutGo"']
];
for (const [input, expected] of cases) {
  const got = A.mdInline(input);
  ok(got.includes(expected), 'mdInline(' + JSON.stringify(input) + ')', 'got ' + JSON.stringify(got));
}

/* ---------- 6. numbered steps keep counting across an interruption ---------- */
console.log('\nOrdered lists');
{
  const r = A.mdToHtml('1. one\n2. two\n\n| a | b |\n| --- | --- |\n| c | d |\n\n3. three\n4. four\n');
  ok(r.html.includes('<ol>') && r.html.includes('<ol start="3">'),
    'a list resumed after a table continues from the authored number', r.html);
  ok(!/<ol start="1">/.test(r.html), 'and a list starting at 1 gets no start attribute');
}
for (const [file, r] of rendered) {
  // every <ol> after the first in a page should either start at 1 deliberately or carry start=
  const ols = [...r.html.matchAll(/<ol( start="(\d+)")?>/g)];
  const items = [...r.html.matchAll(/<ol( start="(\d+)")?>((?:(?!<\/ol>)[\s\S])*)<\/ol>/g)];
  ok(ols.length === items.length, file + ': every ordered list is closed');
}

/* ---------- 7. json highlighting ---------- */
console.log('\nCode highlighting');
const hl = A.tutHl('{ "name": "a", "n": 100, "ok": true, "z": null }');
ok(hl.includes('<i class="k">&quot;name&quot;</i>'), 'a key before a colon is marked as a key');
ok(hl.includes('<i class="s">&quot;a&quot;</i>'), 'a string value is marked as a string');
ok(hl.includes('<i class="n">100</i>'), 'a number is marked as a number');
ok(hl.includes('<i class="b">true</i>') && hl.includes('<i class="b">null</i>'), 'true and null are marked');
const inj = A.tutHl('{ "x": "<img src=x onerror=1>" }');
ok(!inj.includes('<img'), 'markup inside a block cannot escape into the page', inj);
for (const [file, r] of rendered) {
  for (const c of r.codes) {
    if (c.lang !== 'json') continue;
    // stripping the added tags must give back exactly the source text
    const back = A.tutHl(c.body).replace(/<\/?i[^>]*>/g, '')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    ok(back === c.body, file + ': highlighting a block preserves its text');
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
