// node tests/voice-vad.test.mjs — needs Playwright + Chromium.
// 声で答える：話し始め・言い終わりの見つけ方（js/voice.js の record()）を、Chromium の偽マイクに合成した音を流して確かめる（v1.16.1）。
// 音の大きさは Grass のスマホ（マイクの処理すべてオフ）で測った値に合わせる：雑音 -49dB・声 -30dB（p90）。
//   A 声 -30dB → 話し始め・言い終わりを見つけて、自動で終わる
//   B 声 -36dB（小さめ）→ 同じく見つける（v1.15.0 より前のしきい値では見落とした）
//   C 物音（250ms）のあとに声 → 話し始めは声のところ（物音ではない）
//   D 物音だけ → 声と間違えず、自動で終わらない
//   E 話し終わったあと、まわりがうるさくなる（-35dB）→ 言い終わりは声の終わり。うるさいままでも数秒で終わる
//   F ずっとうるさい（-28dB）→ 声と間違えて勝手に終わらない（「言えた」で止める）
//   G 雑音だけ（-38dB）→ 自動で終わらない
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.GRASS_PLAYWRIGHT || 'playwright');
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SR = 48000;
const LEN = 30;   // 偽マイクはファイルを繰り返すので、長めにする
const amp = db => 10 ** (db / 20);

let seed = 1;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { const u = Math.max(rand(), 1e-9); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };

function noise(buf, fromSec, db) { const a = amp(db); for (let i = Math.floor(fromSec * SR); i < buf.length; i += 1) buf[i] += gauss() * a; }
function burst(buf, atSec, ms, db) { const a = amp(db); const i0 = Math.floor(atSec * SR); for (let i = 0; i < SR * ms / 1000; i += 1) buf[i0 + i] += gauss() * a; }
/** 声の代わり：200ms 鳴って 80ms 休む音節を並べる（ことばの切れ目は 250ms）。RMS が db になるようにする */
function speech(buf, fromSec, toSec, db) {
  const a = amp(db) * Math.SQRT2 / 1.2;   // 正弦波＋倍音の RMS を db に合わせる
  let t = fromSec;
  let n = 0;
  while (t < toSec) {
    const f0 = 140 + 40 * Math.sin(n);
    for (let i = 0; i < SR * 0.2; i += 1) {
      const s = i / SR;
      const env = Math.min(1, s / 0.02, (0.2 - s) / 0.02);
      buf[Math.floor(t * SR) + i] += a * env * (Math.sin(2 * Math.PI * f0 * s) + 0.6 * Math.sin(4 * Math.PI * f0 * s) + 0.3 * Math.sin(6 * Math.PI * f0 * s)) / 1.2;
    }
    n += 1;
    t += 0.28 + (n % 5 === 0 ? 0.17 : 0);
  }
}
function wav(file, buf) {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i += 1) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
const make = fill => { const b = new Float32Array(SR * LEN); fill(b); return b; };

const CASES = [
  { id: 'A', wait: 12000, buf: make(b => { noise(b, 0, -49); speech(b, 1.5, 6.5, -30); }),
    check: r => { assert.equal(r.reason, 'silence'); assert.ok(Math.abs(r.onset - 1.5) < 0.8, `onset ${r.onset}`); assert.ok(Math.abs(r.end - 6.5) < 0.8, `end ${r.end}`); } },
  { id: 'B', wait: 12000, buf: make(b => { noise(b, 0, -49); speech(b, 1.5, 6.5, -36); }),
    check: r => { assert.equal(r.reason, 'silence'); assert.ok(Math.abs(r.onset - 1.5) < 0.8, `onset ${r.onset}`); } },
  { id: 'C', wait: 12000, buf: make(b => { noise(b, 0, -49); burst(b, 0.8, 250, -20); speech(b, 2.5, 7.0, -30); }),
    check: r => { assert.equal(r.reason, 'silence'); assert.ok(r.onset > 1.9, `onset ${r.onset} should be the speech, not the bang at 0.8 s`); } },
  { id: 'D', wait: 12000, buf: make(b => { noise(b, 0, -49); for (const t of [1, 4, 7, 10]) burst(b, t, 250, -20); }),
    check: r => assert.ok(r.timeout, `bangs alone must not end the take: ${JSON.stringify(r)}`) },
  { id: 'E', wait: 14000, buf: make(b => { noise(b, 0, -49); speech(b, 1.5, 6.5, -30); noise(b, 7.5, -35); }),
    check: r => { assert.equal(r.reason, 'silence'); assert.ok(r.end < 7.4, `end ${r.end} should be the end of speech, not the noise`); } },
  { id: 'F', wait: 10000, buf: make(b => { noise(b, 0, -28); speech(b, 1.5, 6.5, -30); }),
    check: r => assert.ok(r.timeout, `loud steady noise must not end the take by itself: ${JSON.stringify(r)}`) },
  { id: 'G', wait: 12000, buf: make(b => { noise(b, 0, -38); }),
    check: r => assert.ok(r.timeout, `noise alone must not end the take: ${JSON.stringify(r)}`) },
];

const PAGE = `<!DOCTYPE html><meta charset="utf-8"><script type="module">
import { createVoice } from '/js/voice.js';
window.run = waitMs => new Promise(async res => {
  const v = createVoice();
  v.prepare();
  const take = await v.record({ onEnd: r => res({ onset: r.onsetAt == null ? null : (r.onsetAt - r.startAt) / 1000, end: (r.endAt - r.startAt) / 1000, reason: r.reason }) });
  setTimeout(() => { take.cancel(); res({ timeout: true }); }, waitMs);
});
window.ready = true;
</script>`;
const types = { '.js': 'text/javascript', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__vad.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  const file = path.join(root, url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grass-vad-'));
let failed = 0;
try {
  for (const c of CASES) {
    const file = path.join(dir, `${c.id}.wav`);
    wav(file, c.buf);
    const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`, '--autoplay-policy=no-user-gesture-required'] });
    try {
      const ctx = await browser.newContext();
      await ctx.grantPermissions(['microphone'], { origin: base });
      await ctx.addInitScript(() => localStorage.setItem('micConstraints', JSON.stringify({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })));
      const page = await ctx.newPage();
      await page.goto(`${base}/__vad.html`);
      await page.waitForFunction(() => window.ready);
      const r = await page.evaluate(w => window.run(w), c.wait);
      try { c.check(r); console.log(`ok ${c.id}`, JSON.stringify(r)); } catch (e) { failed += 1; console.log(`FAIL ${c.id}`, e.message); }
    } finally { await browser.close(); }
  }
} finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
if (failed) { console.log(`FAIL voice-vad (${failed})`); process.exit(1); }
console.log('PASS voice-vad');
