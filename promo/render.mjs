// 宣伝動画を作る：node promo/render.mjs [--lang ja|zh|en] [--stills] [--only id,id] [--aivis http://127.0.0.1:10101 --speaker 番号]
//
//   - 画面は promo/promo.html（台本 promo/script.json から、時刻ごとに描く）。Playwright で1コマずつ撮って、
//     場面ごとに1本の MP4 にし、つないで、音楽（ここで作る静かな和音）を付ける
//   - --stills：各場面のいちばん情報が多い瞬間を JPEG で promo/out/stills/ に出すだけ（確認用・速い）
//   - --aivis：PC で AivisSpeech を起動しておくと、各場面の say をナレーションにして重ねる（場面の長さも合わせる）
//   - 必要なもの：Node 18+、Playwright（npx playwright install chromium）、ffmpeg
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GRASS_PLAYWRIGHT || 'playwright');
const DIR = path.dirname(new URL(import.meta.url).pathname);
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? (process.argv[i + 1] ?? true) : d; };
const has = k => process.argv.includes(`--${k}`);
const lang = arg('lang', 'ja');
const only = (arg('only', '') || '').split(',').filter(Boolean);
const OUT = path.join(DIR, 'out');
const voiceDir = arg('voice-dir');                 // AivisSpeech で作った <場面id>.wav のフォルダ（make_kotogusa_voice.ps1 の出力）
const TMP = path.join(OUT, `tmp-${lang}${voiceDir || arg('aivis') ? '-voice' : ''}`);
fs.mkdirSync(TMP, { recursive: true });
const FPS = 30;

function run(cmd, args, input = null) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => (code === 0 ? res() : rej(new Error(`${cmd} ${code}\n${err.slice(-2000)}`))));
    if (input) input(p.stdin);
  });
}

// ---------- 静かな和音（外部の音源なし・著作権なし） ----------
function music(seconds, revealAt, file) {
  const sr = 44100, n = Math.ceil(seconds * sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const add = (buf, i0, len, f, amp, att, rel, pan = 0) => {
    for (let k = 0; k < len && i0 + k < n; k++) {
      const t = k / sr;
      const env = Math.min(1, t / att) * Math.min(1, (len - k) / (rel * sr));
      const v = amp * env * (Math.sin(2 * Math.PI * f * t) + 0.18 * Math.sin(4 * Math.PI * f * t));
      L[i0 + k] += v * (1 - pan); R[i0 + k] += v * (1 + pan);
    }
  };
  const pluck = (i0, f, amp, pan) => {
    for (let k = 0; k < sr * 1.4 && i0 + k < n; k++) {
      const t = k / sr, v = amp * Math.exp(-t * 4.5) * Math.min(1, t * 400) * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t * 9));
      L[i0 + k] += v * (1 - pan); R[i0 + k] += v * (1 + pan);
    }
  };
  // 壁の場面：Am – F – C – G（低く、ゆっくり）。ことぐさ以降：C – G – Am – F（明るく、はじく音つき）
  const dark = [[45, 57, 60, 64], [41, 53, 57, 60], [48, 55, 60, 64], [43, 55, 59, 62]];
  const light = [[48, 60, 64, 67, 71], [43, 55, 62, 67, 71], [45, 57, 60, 64, 67], [41, 57, 60, 65, 69]];
  const bar = 3.2;
  for (let t = 0, k = 0; t < revealAt; t += bar, k++) {
    const len = Math.min(bar + 1.2, revealAt + 0.6 - t);
    dark[k % 4].forEach((m, j) => add(L, Math.round(t * sr), Math.round(len * sr), hz(m), j ? 0.05 : 0.07, 1.0, 1.0, (j % 2 ? 0.3 : -0.3)));
  }
  [84, 88, 91, 96].forEach((m, j) => pluck(Math.round((revealAt + j * 0.09) * sr), hz(m), 0.09, j % 2 ? 0.4 : -0.4));   // ことぐさ：鈴
  for (let t = revealAt, k = 0; t < seconds; t += bar, k++) {
    const ch = light[k % 4];
    ch.forEach((m, j) => add(L, Math.round(t * sr), Math.round((bar + 1.2) * sr), hz(m), j ? 0.04 : 0.065, 0.6, 1.0, (j % 2 ? 0.25 : -0.25)));
    for (let b = 0; b < 8; b++) {
      const at = t + b * (bar / 8);
      if (at > seconds - 1.5) break;
      const m = ch[1 + (b % (ch.length - 1))] + 12;
      pluck(Math.round(at * sr), hz(m), b % 4 === 0 ? 0.05 : 0.032, b % 2 ? 0.35 : -0.35);
    }
  }
  // 終わり 2 秒で消す・ピークをそろえる
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const f = Math.min(1, (n - i) / (2 * sr), i / (0.5 * sr));
    L[i] *= f; R[i] *= f; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const g = 0.5 / (peak || 1);
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

// ---------- AivisSpeech のナレーション（任意） ----------
function wavSeconds(wav) {
  const rate = wav.readUInt32LE(28);           // bytes per second
  const i = wav.indexOf('data');
  return (wav.readUInt32LE(i + 4) || (wav.length - (i + 8))) / rate;
}

async function narrate(engine, speaker, text, file) {
  const q = await (await fetch(`${engine}/audio_query?${new URLSearchParams({ text, speaker })}`, { method: 'POST' })).json();
  q.prePhonemeLength = 0.1; q.postPhonemeLength = 0.2;
  const res = await fetch(`${engine}/synthesis?${new URLSearchParams({ speaker })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
  if (!res.ok) throw new Error(`AivisSpeech ${res.status}`);
  const wav = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, wav);
  return wavSeconds(wav);
}

// ---------- 撮影 ----------
const types = { '.html': 'text/html', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const f = path.join(DIR, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', e => console.error('page:', e.message));
  await page.goto(`http://localhost:${server.address().port}/promo.html`);
  const scenes = await page.evaluate(l => window.prepare(l), lang);

  // ナレーションがあれば、場面の長さをそれに合わせる（言い終わって 0.7 秒は残す）
  const engine = arg('aivis'), speaker = arg('speaker');
  const voice = {};
  if (voiceDir && !has('stills')) {
    for (const [i, s] of scenes.entries()) {
      const file = path.join(voiceDir, `${s.id}.wav`);
      if (!fs.existsSync(file)) continue;
      const sec = wavSeconds(fs.readFileSync(file));
      voice[i] = { file, sec };
      s.dur = Math.max(s.dur, 0.5 + sec + 0.7);
      console.log(`声 ${s.id}: ${sec.toFixed(1)}秒 → 場面 ${s.dur.toFixed(1)}秒`);
    }
  } else if (engine && !has('stills')) {
    if (!speaker) throw new Error('--aivis には --speaker 番号 も付けてください');
    for (const [i, s] of scenes.entries()) {
      if (!s.say) continue;
      const file = path.join(TMP, `say-${i}.wav`);
      const sec = await narrate(engine, speaker, s.say, file);
      voice[i] = { file, sec };
      s.dur = Math.max(s.dur, 0.5 + sec + 0.7);
      console.log(`声 ${s.id}: ${sec.toFixed(1)}秒 → 場面 ${s.dur.toFixed(1)}秒`);
    }
  }

  if (has('stills')) {
    fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true });
    for (const [i, s] of scenes.entries()) {
      if (only.length && !only.includes(s.id)) continue;
      for (const at of [0.72]) {
        await page.evaluate(([i, t, d]) => window.show(i, t, d), [i, s.dur * at, s.dur]);
        await page.screenshot({ path: path.join(OUT, 'stills', `${lang}-${String(i).padStart(2, '0')}-${s.id}.jpg`), type: 'jpeg', quality: 92 });
      }
    }
    console.log(`stills → ${path.join(OUT, 'stills')}`);
  } else {
    const parts = [];
    for (const [i, s] of scenes.entries()) {
      const name = path.join(TMP, `scene-${s.id}.mp4`);
      parts.push(name);
      if (only.length && !only.includes(s.id) && fs.existsSync(name)) continue;
      const frames = Math.round(s.dur * FPS);
      const tmp = name.replace(/\.mp4$/, '.part.mp4');
      const t0 = Date.now();
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), tmp], async stdin => {
        for (let f = 0; f < frames; f++) {
          await page.evaluate(([i, t, d]) => window.show(i, t, d), [i, f / FPS, s.dur]);
          const jpg = await page.screenshot({ type: 'jpeg', quality: 92 });
          if (!stdin.write(jpg)) await new Promise(r => stdin.once('drain', r));
        }
        stdin.end();
      });
      fs.renameSync(tmp, name);
      console.log(`${s.id}: ${frames}コマ ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
    }
    const list = path.join(TMP, 'list.txt');
    fs.writeFileSync(list, parts.map(p => `file '${p}'`).join('\n'));
    const video = path.join(TMP, 'video.mp4');
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);

    const total = scenes.reduce((t, s) => t + s.dur, 0);
    const starts = scenes.map((_, i) => scenes.slice(0, i).reduce((t, s) => t + s.dur, 0));
    const revealAt = starts[scenes.findIndex(s => s.id === 'reveal')] ?? total / 3;
    const bgm = path.join(TMP, 'music.wav');
    music(total, revealAt, bgm);
    const out = arg('out', path.join(OUT, `kotogusa-${lang}${engine || voiceDir ? '-voice' : ''}.mp4`));
    const vs = Object.entries(voice);
    if (vs.length) {
      const ins = vs.flatMap(([, v]) => ['-i', v.file]);
      const delays = vs.map(([i], k) => `[${k + 2}:a]aresample=44100,adelay=${Math.round((starts[i] + 0.5) * 1000)}:all=1[v${k}]`).join(';');
      const mix = `[1:a]volume=0.45[m];${delays};[m]${vs.map((_, k) => `[v${k}]`).join('')}amix=inputs=${vs.length + 1}:normalize=0,alimiter=limit=0.95[a]`;
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', bgm, ...ins, '-filter_complex', mix, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', out]);
    } else {
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', bgm, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', out]);
    }
    console.log(`完成：${out}（${total.toFixed(1)}秒）`);
  }
} finally {
  await browser.close();
  server.close();
}
