// node tests/voice-playback.test.mjs — needs Playwright + Chromium.
// 声で答える：お手本などが鳴ったまま、次の文でマイクを開かない（v1.16.1・Kairos のレビュー）。
// マイクの処理をすべてオフにした（v1.15.0）ので、エコー除去がない。鳴ったままだと、その音が録音に入る。
// 音声ファイルの形式（mp3 など）に左右されないように、<audio> の play/pause を差し替えて「鳴っているか」を数える。
//   1文目：答えの画面でお手本を鳴らす → すぐ「言えた」→ 次の文ですぐ「顔を上げる」
//   → マイクを開くとき（getUserMedia）に、鳴っている <audio> が 0 で、端末の読み上げも止めていること
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.GRASS_PLAYWRIGHT || 'playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, serviceWorkers: 'block' });
  await ctx.grantPermissions(['microphone'], { origin: base });
  await ctx.addInitScript(() => {
    window.__playing = new Set();
    window.__micOpens = [];
    window.__ttsCancels = 0;
    HTMLMediaElement.prototype.play = function () { window.__playing.add(this); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { window.__playing.delete(this); };
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { get() { return !window.__playing.has(this); } });
    if ('speechSynthesis' in window) { const c = speechSynthesis.cancel.bind(speechSynthesis); speechSynthesis.cancel = () => { window.__ttsCancels += 1; c(); }; }
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async c => { window.__micOpens.push({ playing: window.__playing.size, ttsCancels: window.__ttsCancels }); return gum(c); };
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/#/speak');
  await page.waitForSelector('[data-act="sp-start"][data-mode="look"]');
  await page.evaluate(async () => {
    const db = await new Promise((ok, ng) => { const r = indexedDB.open('grass'); r.onsuccess = () => ok(r.result); r.onerror = ng; });
    await new Promise((ok, ng) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ on: true, sr: false, wh: false, whModelV: 2 }, 'speakVoice'); tx.oncomplete = ok; tx.onerror = ng; });
  });
  await page.reload();
  await page.click('[data-act="sp-start"][data-mode="look"]');
  let played = 0;
  for (let i = 0; i < 3; i += 1) {
    await page.click('[data-act="sp-lookup"]');
    await page.waitForFunction(n => window.__micOpens.length > n, i);
    const open = await page.evaluate(n => window.__micOpens[n], i);
    assert.equal(open.playing, 0, `card ${i + 1}: nothing may be playing when the microphone opens`);
    if (i > 0) assert.ok(open.ttsCancels >= i, `card ${i + 1}: speech synthesis is cancelled before the microphone opens`);
    await page.click('[data-act="sp-said"]');
    await page.waitForSelector('.voice-res');
    const tts = page.locator('[data-act="sp-tts"][data-k="say"]');
    if (await tts.count()) {
      await tts.click();
      played += await page.waitForFunction(() => window.__playing.size > 0, null, { timeout: 3000 }).then(() => 1, () => 0);
    }
    await page.click('[data-act="sp-rate"][data-ok="1"]');
  }
  assert.ok(played > 0, 'the model voice was actually playing before moving on (otherwise the test proves nothing)');
  assert.deepEqual(errors, []);
  console.log('PASS voice-playback');
} finally {
  await browser.close();
  server.close();
}
