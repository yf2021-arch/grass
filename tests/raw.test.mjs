// Node-only regression coverage for citations, pick API recovery and returning to a transcript.
import assert from 'node:assert/strict';
import { createRaw } from '../js/raw.js';
import { compactTitle, compactUrl, sourceHtml } from '../js/source.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longTitle = '日本語の会話でよく使う表現を動画から覚えて仕事や毎日の暮らしでも自然に話せるようになるための詳しい解説 - YouTube';
assert.ok(Array.from(compactTitle(longTitle)).length <= 48);
assert.equal(compactTitle('短いタイトル - YouTube'), '短いタイトル');
assert.equal(compactTitle('😀'.repeat(60)), '😀'.repeat(47) + '…');
assert.equal(compactUrl('https://www.youtube.com/watch?v=abcdefghijk&t=1m23s&si=tracking'), 'https://youtu.be/abcdefghijk?t=83');
assert.equal(compactUrl('https://youtu.be/abcdefghijk?t=83'), 'https://youtu.be/abcdefghijk?t=83');
assert.equal(compactUrl('javascript:alert(1)'), null);
const source = sourceHtml(`${longTitle}（https://www.youtube.com/watch?v=abcdefghijk&t=83s）`, esc);
assert.match(source, /href="https:\/\/youtu.be\/abcdefghijk\?t=83"/);
assert.ok(!source.includes('watch?v='));
assert.ok(!sourceHtml('<img src=x onerror=alert(1)>', esc).includes('<img'));

const listeners = {};
globalThis.window = { addEventListener: (name, cb) => { listeners[name] = cb; } };
globalThis.location = { hash: '#/raw/C-test', search: '' };
globalThis.document = { getElementById: () => null };
let copied;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async t => { copied = t; } } } });
let scroller;
const events = {};
const app = {
  addEventListener: (name, cb) => { events[name] = cb; },
  querySelector: selector => selector === '.scroll' ? scroller : null,
  querySelectorAll: () => [],
  set innerHTML(v) { this.html = v; scroller = { scrollTop: 0, scrollTo(x, y) { this.scrollTop = y; } }; },
};
const data = new Map();
const store = { get: async (table, key) => structuredClone(data.get(key)), put: async (table, value, key) => { data.set(key, structuredClone(value)); } };
let api = false;
let mode = 'missing';
const calls = [];
globalThis.fetch = async (url, options) => {
  if (!options?.body) return { ok: true, json: async () => ({ clips: [] }) };
  const req = JSON.parse(options.body); calls.push(req);
  return { ok: true, json: async () => mode === 'missing' ? { ok: false, error: `不明な action です：${req.action}` }
    : mode === 'malformed' && req.action === 'pickList' ? { ok: true }
    : { ok: true, ids: ['PK-test001'] } };
};
const deps = { app, esc, nav: () => '', store, go: hash => { location.hash = hash; }, getSettings: () => api ? { apiUrl: 'https://example.test/exec', token: 'test' } : {} };
const raw = createRaw(deps);
await raw.load();
await raw.importData({ rawCands: [{ id: 'C-test', videoId: 'abcdefghijk', url: 'https://youtu.be/abcdefghijk', title: longTitle, start: 0, end: 200, cues: [{ s: 83, t: '仕事を見極める。' }] }], rawLog: { 'C-test': { first: { skipped: true }, replays: 0 } } });
raw.render('C-test');
scroller.scrollTop = 1234;
raw._state.yt = { getCurrentTime: () => 83.5, destroy() {} };
raw._state.ui.rate = 0.75;
// Capture the link click before navigation; then copy a pick and return.
events.click({ target: { closest: () => true } });
await raw.actions['raw-pick']({ dataset: { id: 'C-test', i: '0' }, setAttribute() {} });
location.hash = '#/raw/picks'; raw.render('picks');
assert.match(app.html, /元の字幕に戻る（01:23）/);
const pick = raw._state.picks[0];
await raw.actions['raw-pick-copy']({ dataset: { id: pick.id } });
assert.match(copied, /https:\/\/youtu.be\/abcdefghijk\?t=83/);
assert.ok(copied.split('出典：')[1].length < 100);
location.hash = '#/raw/C-test'; raw.render('C-test');
assert.equal(scroller.scrollTop, 1234);
assert.equal(raw._state.log['C-test'].resume.seconds, 83.5);
assert.match(app.html, /続きから再生（01:23）/);
assert.match(app.html, /aria-pressed="true" data-act="raw-rate" data-v="0.75"/);
// Origin, playback time and scroll survive a fresh instance (reload).
const reloaded = createRaw(deps); await reloaded.load();
location.hash = '#/raw/picks'; reloaded.render('picks');
assert.match(app.html, /元の字幕に戻る（01:23）/);
location.hash = '#/raw/C-test'; reloaded.render('C-test');
assert.equal(scroller.scrollTop, 1234);

// An old GAS deployment keeps picks locally and stops repeating unsupported actions.
api = true;
raw._state.picks = [{ id: 'PK-test001', text: '見極める', videoId: 'abcdefghijk', s: 83, title: longTitle, kind: 'auto', status: 'local' },
  { id: 'PK-test002', text: '確かめる', videoId: 'abcdefghijk', s: 90, kind: 'auto', status: 'local' }];
raw._state.pickSyncAt = Date.now(); location.hash = '#/raw/picks'; raw.render('picks');
await raw.actions['raw-pick-sync']();
assert.equal(calls.length, 1);
assert.ok(raw._state.picks.every(p => p.status === 'local'));
assert.match(app.html, /Google 側の「拾う」機能が未更新/);
assert.ok(!app.html.includes('不明な action'));
mode = 'ok'; await raw.actions['raw-pick-sync']();
assert.equal(raw._state.picks[0].status, 'queued');
assert.equal(raw._state.picks[1].status, 'done');
assert.equal(calls.find(r => r.action === 'pickPut' && r.pick.id === 'PK-test001').pick.url, 'https://youtu.be/abcdefghijk?t=83');
mode = 'malformed'; await raw.actions['raw-pick-sync']();
assert.equal(raw._state.picks[0].status, 'queued', 'bad API response must not mark pending work done');
assert.match(app.html, /待ち行列の応答を読めません/);
console.log('PASS: compact titles/citations, pick API failure/retry, transcript return and reload persistence');
