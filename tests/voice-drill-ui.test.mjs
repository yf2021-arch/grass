// node tests/voice-drill-ui.test.mjs — needs Playwright + Chromium.
// 声で答える with Whisper, end to end, with Chromium's fake microphone and a fake Whisper worker:
//   - the microphone is released after every take (no live tracks while reading the answer)
//   - a stalled transcription shows elapsed time, a "slow" prompt, then a timeout error with retry
//     (never an endless 「文字にしています…」), and retry recovers
//   - rating while Whisper is still running keeps the score: it lands on that card's log entry
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.GRASS_PLAYWRIGHT || 'playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg' };
let mode = 'ok';   // what the fake worker does with the next "run": ok | stall | slow
let runs = 0;      // how many transcriptions reached the worker
const FAKE_WORKER = `
self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'load') { self.postMessage({ type: 'ok', id: m.id, model: m.model, files: [] }); return; }
  if (m.type !== 'run') return;
  const mode = await (await fetch('/__whmode')).text();
  self.postMessage({ type: 'stage', id: m.id, stage: 'infer', model: m.model });
  if (mode === 'stall') return;
  setTimeout(() => self.postMessage({ type: 'ok', id: m.id, model: m.model, text: '今日は会議があります', ms: 40 }), mode === 'slow' ? 2500 : 150);
};`;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__whmode') { runs++; res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(mode); }
  if (url === '/js/whisper-worker.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(FAKE_WORKER); }
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, serviceWorkers: 'block' });
  await ctx.grantPermissions(['microphone'], { origin: base });
  await ctx.addInitScript(() => {
    localStorage.setItem('whLimits', JSON.stringify({ slowMs: { base: 1200, small: 1200 }, loadLimitMs: 3000, runLimitMs: { base: 3000, small: 3000 } }));
    window.__tracks = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async c => { const s = await gum(c); window.__tracks.push(...s.getTracks()); return s; };
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/#/speak');
  await page.waitForSelector('[data-act="sp-start"][data-mode="look"]');
  // settings: voice on + Whisper base "installed" (model files present in the cache)
  await page.evaluate(async () => {
    const db = await new Promise((ok, ng) => { const r = indexedDB.open('grass'); r.onsuccess = () => ok(r.result); r.onerror = ng; });
    await new Promise((ok, ng) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ on: true, sr: false, wh: true, whModel: 'base' }, 'speakVoice'); tx.oncomplete = ok; tx.onerror = ng; });
    const cache = await caches.open('transformers-cache');
    for (const f of ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'])
      await cache.put(`https://huggingface.co/Xenova/whisper-base/resolve/main/${f}`, new Response('x', { headers: { 'content-length': '1' } }));
  });
  await page.reload();
  const live = () => page.evaluate(() => window.__tracks.filter(t => t.readyState === 'live').length);
  async function answerOnce() {
    await page.click('[data-act="sp-lookup"]');
    await page.waitForSelector('[data-act="sp-said"]');
    await page.waitForFunction(() => window.__tracks.some(t => t.readyState === 'live'));
    await page.waitForTimeout(900);                       // the fake mic beeps; let some sound in
    await page.click('[data-act="sp-said"]');
    await page.waitForSelector('.voice-res');
    if (await page.locator('[data-act="sp-wh-anyway"]').count()) await page.click('[data-act="sp-wh-anyway"]');   // no onset → transcribe anyway
  }

  // 1. normal: result appears, microphone released while reading the answer
  mode = 'ok';
  await page.click('[data-act="sp-start"][data-mode="look"]');
  await answerOnce();
  await page.waitForSelector('.heard', { timeout: 5000 });
  assert.equal(await live(), 0, 'no live microphone track after the take');
  assert.match(await page.locator('.voice-res').innerText(), /文字の一致（目安）/);

  // 2. stall: elapsed time + slow prompt, then timeout error (not endless), retry recovers
  await page.click('[data-act="sp-rate"][data-ok="1"]');
  mode = 'stall';
  await answerOnce();
  await page.waitForSelector('.wh-elapsed');
  await page.waitForSelector('text=時間がかかっています', { timeout: 4000 });
  assert.equal(await page.locator('[data-act="sp-wh-cancel"]').count(), 1, 'cancel is offered while running');
  await page.waitForSelector('.wh-err', { timeout: 6000 });
  assert.match(await page.locator('.wh-err').innerText(), /時間がかかりすぎたので止めました/);
  mode = 'ok';
  await page.click('[data-act="sp-wh-retry"]');
  await page.waitForSelector('.heard', { timeout: 5000 });
  assert.equal(await live(), 0);

  // 3. cancel while running → cancelled state with retry
  await page.click('[data-act="sp-rate"][data-ok="1"]');
  mode = 'stall';
  await answerOnce();
  await page.waitForSelector('[data-act="sp-wh-cancel"]');
  await page.click('[data-act="sp-wh-cancel"]');
  await page.waitForSelector('text=文字にするのをやめました');

  // 4. rate while Whisper still runs: the score lands later on that card's log entry
  await page.click('[data-act="sp-rate"][data-ok="1"]');
  mode = 'slow';
  await answerOnce();
  await page.waitForSelector('.wh-run');
  await page.click('[data-act="sp-rate"][data-ok="0"]');   // move on before the result
  await page.waitForTimeout(3500);
  const last = await page.evaluate(async () => {
    const db = await new Promise(ok => { const r = indexedDB.open('grass'); r.onsuccess = () => ok(r.result); });
    return new Promise(ok => { const q = db.transaction('meta').objectStore('meta').get('speakLog'); q.onsuccess = () => ok(q.result.at(-1)); });
  });
  assert.equal(last.ok, false); assert.equal(last.late, true, 'late result is marked');
  assert.ok(last.match > 0, 'late Whisper score saved on the rated entry');

  // 5. A still transcribing, B queued behind it, cancel B: A's late score is kept, B never reaches the worker
  const readLog = () => page.evaluate(async () => {
    const db = await new Promise(ok => { const r = indexedDB.open('grass'); r.onsuccess = () => ok(r.result); });
    return new Promise(ok => { const q = db.transaction('meta').objectStore('meta').get('speakLog'); q.onsuccess = () => ok(q.result); });
  });
  await page.evaluate(() => { location.hash = '#/speak'; });   // a fresh drill (the first one has used its cards)
  await page.click('[data-act="sp-start"][data-mode="look"]');
  mode = 'slow';
  await answerOnce();                                     // A
  await page.waitForSelector('.wh-run');
  await page.click('[data-act="sp-rate"][data-ok="1"]');  // rate A while it is still running
  const before = runs;
  await page.click('[data-act="sp-lookup"]');
  await page.waitForSelector('[data-act="sp-said"]');
  await page.waitForTimeout(500);
  await page.click('[data-act="sp-said"]');               // B
  await page.waitForSelector('.voice-res');
  if (await page.locator('[data-act="sp-wh-anyway"]').count()) await page.click('[data-act="sp-wh-anyway"]');
  await page.waitForSelector('text=前の文を文字にし終わるのを待っています', { timeout: 3000 });
  await page.click('[data-act="sp-wh-cancel"]');          // cancel B only
  await page.waitForSelector('text=文字にするのをやめました');
  await page.waitForTimeout(3500);
  const log = await readLog();
  const aEntry = log.at(-1);
  assert.equal(aEntry.late, true, "A's late result still arrives after B is cancelled");
  assert.ok(aEntry.match > 0);
  assert.equal(runs, before, 'cancelled B never reached the worker');
  assert.deepEqual(errors, []);
  console.log('PASS voice-drill-ui');
} finally { await browser.close(); server.close(); }
