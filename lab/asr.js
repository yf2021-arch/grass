// 実験ページ（lab/asr.html）：声を文字にする速さ・ブラウザの音声認識・マイクの音質を、Grass のスマホで測る。
// アプリ本体（index.html）とは別。アプリのデータ（IndexedDB）には触らない。結果はレポート（JSON）にして、コピーして Slack に貼ってもらう。

import { createWhisper, WH_MODELS, decodeForWhisper } from '../js/whisper.js';
import { compareSay } from '../js/voice.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sec = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}秒`);
const now = () => performance.now();

const SENTENCES = [
  { id: 'short', label: '短い文（3〜5秒）', text: '昨日はログイン画面の修正を行いました。' },
  { id: 'long', label: '長い文（15〜20秒）', text: '来週の月曜日までに、三つの画面の修正を終わらせて、テストの結果を田中さんに送ってください。そのあとで、お客様からの質問に答える資料を、二十ページほどにまとめる予定です。' },
];

// マイクの設定（Kairos の案）。順番はランダムにして A・B・C と呼ぶ
const PRESETS = [
  { id: 'P1', name: '処理すべてオン（今のアプリ）', c: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
  { id: 'P2', name: '雑音抑制だけオフ', c: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } },
  { id: 'P3', name: '処理すべてオフ', c: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
];
const APP_CONSTRAINTS = PRESETS[0].c;

// Whisper small は、Grass のスマホ（Android・8GB）でブラウザごと落ちた（2026-11-12）ので、ここでは測らない
const ENGINES = [
  { key: 'moonshine', on: true, warn: '' },
  { key: 'base', on: true, warn: '' },
];
const SAVE_KEY = 'grass-lab-asr-report';

const REPORT = { page: 'grass-lab-asr', v: 2, at: new Date().toISOString(), env: null, sr: null, asr: {}, mic: null };
// ブラウザが落ちても結果が残るように、前回の結果（1・2）を読み戻す
try {
  const old = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (old && old.v === REPORT.v) { REPORT.sr = old.sr || null; REPORT.asr = old.asr || {}; }
} catch (e) { /* 読めなければ新しく始める */ }

/* ---------------- レポート ---------------- */

function summary() {
  const L = [];
  const e = REPORT.env;
  if (e) L.push(`端末: ${e.ua}`, `コア ${e.cores} · メモリ ${e.memoryGB ?? '?'}GB · crossOriginIsolated ${e.crossOriginIsolated} · SharedArrayBuffer ${e.sharedArrayBuffer}`);
  const s = REPORT.sr;
  if (s) L.push(`1. ブラウザ音声認識: ${s.ok ? `使える「${s.text}」` : `使えない（${s.error || s.reason}）`}`);
  for (const [sid, r] of Object.entries(REPORT.asr)) {
    L.push(`2. ${sid}（録音 ${r.audioSec}秒・変換 ${r.decodeMs}ms）`);
    for (const x of r.runs || []) {
      if (x.error) { L.push(`   ${x.engine}: エラー ${x.error}`); continue; }
      if (!x.run1) { L.push(`   ${x.engine}: 測定中`); continue; }
      L.push(`   ${x.engine}${x.repo ? ` [${x.repo} ${x.dtype}]` : ''}: 初回準備 ${x.prepMs}ms${x.downloaded ? '（ダウンロード込み）' : '（キャッシュから）'} · 1回目 読込${x.run1.loadMs}+文字${x.run1.ms}ms · 2回目 文字${x.run2?.ms ?? '—'}ms · 一致 ${x.run1.score}%「${x.run1.text}」`);
    }
  }
  const m = REPORT.mic;
  if (m?.choice) L.push(`3. マイク: いちばん聞きやすい＝${m.choice}（${m.choicePreset}）· ビットレート ${m.bitrate || '端末まかせ'}`);
  if (m?.takes) for (const t of m.takes) L.push(t.metrics ? `   ${t.label}=${t.preset}: 雑音 ${t.metrics.noiseDb}dB · 声 ${t.metrics.speechDb}dB · SN比 ${t.metrics.snrDb}dB · 音割れ ${t.metrics.clipPct}%` : `   ${t.label}=${t.preset}: ${t.error ? `エラー ${t.error}` : 'まだ録音していない'}`);
  return L.join('\n');
}

function renderReport() {
  $('report').value = `${summary()}\n\n${JSON.stringify(REPORT, null, 1)}`;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: REPORT.v, sr: REPORT.sr, asr: REPORT.asr })); } catch (e) { /* 保存できなくても続ける */ }
}

$('copy').addEventListener('click', async () => {
  renderReport();
  try { await navigator.clipboard.writeText($('report').value); $('copy-msg').textContent = 'コピーしました。Slack のスレッドに貼ってください。'; } catch (e) {
    $('report').select();
    $('copy-msg').textContent = '自動でコピーできませんでした。下の文字を長押しして、すべて選択 → コピーしてください。';
  }
});

/* ---------------- 0. 端末 ---------------- */

(async () => {
  const SRC = window.SpeechRecognition || window.webkitSpeechRecognition;
  let storage = null;
  try { const s = await navigator.storage?.estimate?.(); if (s) storage = { usageMB: Math.round(s.usage / 1e6), quotaMB: Math.round(s.quota / 1e6) }; } catch (e) { /* */ }
  REPORT.env = {
    ua: navigator.userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform,
    brands: navigator.userAgentData?.brands?.map(b => `${b.brand} ${b.version}`).join(', ') || null,
    cores: navigator.hardwareConcurrency || null,
    memoryGB: navigator.deviceMemory || null,
    crossOriginIsolated: !!window.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    webgpu: !!navigator.gpu,
    speechRecognition: !!SRC,
    mediaRecorder: !!window.MediaRecorder,
    storage,
  };
  $('env').textContent = Object.entries(REPORT.env).map(([k, v]) => `${k}: ${typeof v === 'object' && v ? JSON.stringify(v) : v}`).join('\n');
  renderReport();
})();

/* ---------------- 1. ブラウザの音声認識 ---------------- */

$('sr-go').addEventListener('click', () => {
  const out = $('sr-out');
  out.hidden = false;
  const SRC = window.SpeechRecognition || window.webkitSpeechRecognition;
  const t0 = now();
  const events = [];
  const log = (ev, extra = '') => { events.push({ t: Math.round(now() - t0), ev, extra }); out.textContent = events.map(x => `${String(x.t).padStart(5)}ms  ${x.ev}${x.extra ? `  ${x.extra}` : ''}`).join('\n'); };
  const res = { supported: !!SRC, ok: false, text: '', error: null, reason: null, events };
  REPORT.sr = res;
  if (!SRC) { res.reason = 'このブラウザに SpeechRecognition がない'; log('unsupported'); renderReport(); return; }
  $('sr-go').disabled = true;
  let r;
  try {
    r = new SRC();
    r.lang = 'ja-JP';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
  } catch (e) { res.error = e.name || String(e); log('constructor-error', res.error); $('sr-go').disabled = false; renderReport(); return; }
  ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch'].forEach(n => { r[`on${n}`] = () => log(n); });
  r.onresult = e => {
    let t = '';
    for (let i = 0; i < e.results.length; i += 1) t += e.results[i][0]?.transcript || '';
    res.text = t;
    if (t) res.ok = true;
    log('result', `${e.results[e.results.length - 1]?.isFinal ? 'final' : 'interim'}「${t}」`);
  };
  r.onerror = e => { res.error = e.error || 'error'; log('error', `${e.error}${e.message ? ` (${e.message})` : ''}`); };
  const timer = setTimeout(() => { log('timeout-10s'); try { r.abort(); } catch (e) { /* */ } }, 10000);
  r.onend = () => {
    clearTimeout(timer);
    log('end');
    if (!res.ok && !res.error) res.reason = events.some(x => x.ev === 'audiostart') ? '音は届いたが、文字が返らなかった' : 'マイクの開始まで進まなかった';
    out.insertAdjacentText('beforeend', `\n\n→ ${res.ok ? `使えます：「${res.text}」` : `使えません（${res.error || res.reason}）`}`);
    $('sr-go').disabled = false;
    renderReport();
  };
  try { r.start(); log('start() called'); } catch (e) { res.error = e.name || String(e); log('start-error', res.error); clearTimeout(timer); $('sr-go').disabled = false; renderReport(); }
});

/* ---------------- 録音（共通） ---------------- */

async function openRecorder(constraints, bitrate) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.() || {};
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => window.MediaRecorder.isTypeSupported?.(m)) || '';
  const opts = {};
  if (mime) opts.mimeType = mime;
  if (bitrate) opts.audioBitsPerSecond = bitrate;
  const rec = new MediaRecorder(stream, opts);
  const parts = [];
  rec.ondataavailable = e => { if (e.data?.size) parts.push(e.data); };
  const t0 = now();
  rec.start();
  const done = new Promise(res => {
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      res({ blob: new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' }), settings, mime: rec.mimeType || mime, ms: now() - t0, bitrate: rec.audioBitsPerSecond || null });
    };
  });
  return { stop: () => { if (rec.state !== 'inactive') rec.stop(); return done; }, done };
}

/* ---------------- 2. 速さ ---------------- */

const engineBox = $('engines');
engineBox.innerHTML = ENGINES.map(e => `
  <label class="chk"><input type="checkbox" data-engine="${e.key}" ${e.on ? 'checked' : ''}>
  ${esc(WH_MODELS[e.key].name)}（${esc(WH_MODELS[e.key].approx)}）${e.warn ? `<span class="small"> · ${esc(e.warn)}</span>` : ''}</label>`).join('');
const selectedEngines = () => [...engineBox.querySelectorAll('input[data-engine]:checked')].map(i => i.dataset.engine);

$('sentences').innerHTML = SENTENCES.map(s => `
  <div class="sent" data-sid="${s.id}">
    <p><b>${esc(s.label)}</b></p>
    <p class="say">${esc(s.text)}</p>
    <div class="row"><button class="primary" data-act="rec" data-sid="${s.id}">録音する</button></div>
    <p class="small" data-out="status"></p>
    <div data-out="table"></div>
  </div>`).join('<hr style="border:0;border-top:1px solid var(--line);margin:6px 0">');

let busy = false;
const recs = {};   // sid → recorder

document.addEventListener('click', async e => {
  const b = e.target.closest('button[data-act="rec"]');
  if (!b) return;
  const sid = b.dataset.sid;
  const box = document.querySelector(`.sent[data-sid="${sid}"]`);
  const status = box.querySelector('[data-out="status"]');
  if (recs[sid]) {                                    // 止める → 文字にする
    const r = await recs[sid].stop();
    delete recs[sid];
    b.classList.remove('rec');
    b.textContent = 'もう一度録音する';
    await runEngines(sid, r, box);
    return;
  }
  if (busy) { status.textContent = 'ほかの処理が終わるまで待ってください'; return; }
  try {
    recs[sid] = await openRecorder(APP_CONSTRAINTS, 0);
    b.classList.add('rec');
    b.textContent = '言い終わったら押す（止める）';
    status.textContent = '録音中… 上の文を読んでください';
  } catch (err) { status.textContent = `マイクを使えません（${err.name || err}）`; }
});

async function runEngines(sid, rec, box) {
  const status = box.querySelector('[data-out="status"]');
  const tableEl = box.querySelector('[data-out="table"]');
  const target = SENTENCES.find(s => s.id === sid).text;
  const engines = selectedEngines();
  busy = true;
  document.querySelectorAll('button[data-act="rec"]').forEach(x => { x.disabled = true; });
  const result = { audioSec: null, decodeMs: null, bytes: rec.blob.size, mime: rec.mime, runs: [] };
  REPORT.asr[sid] = result;
  const draw = () => {
    tableEl.innerHTML = `<table><tr><th>モデル</th><th>準備</th><th>1回目</th><th>2回目</th><th>一致</th></tr>${result.runs.map(x => (x.error
      ? `<tr><td>${esc(x.engine)}</td><td colspan="4" class="bad">${esc(x.error)}</td></tr>`
      : `<tr><td>${esc(x.engine)}</td><td>${sec(x.prepMs)}<br><span class="small">${x.prepMs == null ? '' : x.downloaded ? 'DL込み' : 'キャッシュ'}</span></td><td>読込 ${sec(x.run1?.loadMs)}<br>文字 ${sec(x.run1?.ms)}</td><td>${sec(x.run2?.ms)}</td><td>${x.run1 ? `${x.run1.score}%` : '…'}</td></tr>
         ${x.run1 ? `<tr><td colspan="5" class="small">「${esc(x.run1.text)}」</td></tr>` : ''}`)).join('')}</table>`;
    renderReport();
  };
  try {
    const d0 = now();
    const pcm = await decodeForWhisper(rec.blob, 0, 30);
    result.decodeMs = Math.round(now() - d0);
    result.audioSec = Math.round((pcm.length / 16000) * 10) / 10;
    for (const key of engines) {
      const x = { engine: key, repo: null, dtype: null, prepMs: null, downloaded: false, run1: null, run2: null, error: null };
      result.runs.push(x);
      draw();
      try {
        // (a) 準備：ダウンロード（なければ）と最初の読み込み
        const prep = createWhisper();
        status.textContent = `${WH_MODELS[key].name}：準備中…`;
        const p0 = now();
        const ld = await prep.load(key, pr => {
          if (pr.total) status.textContent = `${WH_MODELS[key].name}：${pr.net ? 'ダウンロード' : '読み込み（スマホの中から）'} ${Math.round((pr.loaded / pr.total) * 100)}%`;
        });
        x.prepMs = Math.round(now() - p0);
        x.downloaded = !!ld.info?.net;
        x.repo = ld.info?.repo || null;
        x.dtype = ld.info?.dtype || null;
        x.inputs = ld.info ? { encoder: ld.info.encoderInputs, decoder: ld.info.decoderInputs?.filter(n => !n.startsWith('past_key_values')) } : null;
        prep.dispose();
        // (b) 新しい Worker で：1回目（キャッシュから読み込み＋文字に）・2回目（読み込み済み）
        const c = createWhisper();
        status.textContent = `${WH_MODELS[key].name}：1回目…`;
        const r1 = await c.transcribe(key, pcm.slice());
        const s1 = compareSay(target, r1.text);
        x.run1 = { loadMs: Math.round(r1.loadMs), ms: Math.round(r1.ms), text: r1.text, score: Math.round(s1.score * 100), recall: Math.round(s1.recall * 100), precision: Math.round(s1.precision * 100) };
        if (r1.info) { x.repo = r1.info.repo; x.dtype = r1.info.dtype; }
        draw();
        status.textContent = `${WH_MODELS[key].name}：2回目…`;
        const r2 = await c.transcribe(key, pcm.slice());
        x.run2 = { ms: Math.round(r2.ms), text: r2.text };
        c.dispose();
      } catch (err) {
        x.error = `${err.code ? `${err.code}: ` : ''}${err.message || err}`;
      }
      draw();
    }
    status.textContent = `終わりました（録音 ${result.audioSec}秒）。`;
  } catch (err) {
    status.textContent = `止まりました（${err.message || err}）`;
    result.error = String(err.message || err);
  }
  busy = false;
  document.querySelectorAll('button[data-act="rec"]').forEach(x => { x.disabled = false; });
  renderReport();
}

/* ---------------- 3. マイクの音質 ---------------- */

const MIC_SAY = SENTENCES[0].text;
$('mic-say').textContent = MIC_SAY;
const order = [...PRESETS].sort(() => Math.random() - 0.5);
const takes = order.map((p, i) => ({ label: 'ABC'[i], preset: p.id, presetName: p.name, constraints: p.c, url: null, settings: null, metrics: null }));
REPORT.mic = { order: takes.map(t => `${t.label}=${t.preset}`), bitrate: null, takes: [], choice: null, choicePreset: null };

function drawMic() {
  $('mic-recs').innerHTML = takes.map(t => `
    <div class="row" style="margin:6px 0">
      <button data-mic="rec" data-l="${t.label}" ${micBusy ? 'disabled' : ''}>${t.url ? `${t.label} を録り直す` : `${t.label} を録音`}</button>
      <button data-mic="play" data-l="${t.label}" ${t.url ? '' : 'disabled'}>▶ ${t.label}</button>
    </div>`).join('') + '<p class="big" id="mic-cue" aria-live="polite"></p>';
  const all = takes.every(t => t.url);
  $('mic-pick').hidden = !all || !!REPORT.mic.choice;
  if (all) $('mic-pick-row').innerHTML = takes.map(t => `<button data-mic="pick" data-l="${t.label}">${t.label}</button>`).join('');
}

let micBusy = false;
let player = null;

document.addEventListener('click', async e => {
  const b = e.target.closest('button[data-mic]');
  if (!b) return;
  const t = takes.find(x => x.label === b.dataset.l);
  if (b.dataset.mic === 'play') {
    player?.pause();
    player = new Audio(t.url);
    player.play().catch(() => {});
    return;
  }
  if (b.dataset.mic === 'pick') {
    REPORT.mic.choice = t.label;
    REPORT.mic.choicePreset = `${t.preset} ${t.presetName}`;
    revealMic();
    drawMic();
    renderReport();
    return;
  }
  if (b.dataset.mic !== 'rec' || micBusy || busy) return;
  micBusy = true;
  drawMic();
  const bitrate = Number($('mic-bitrate').value) || 0;
  REPORT.mic.bitrate = bitrate || null;
  const cue = () => $('mic-cue');
  try {
    const r = await openRecorder(t.constraints, bitrate);
    cue().textContent = `${t.label}：黙っていてください…`;
    await new Promise(res => setTimeout(res, 2000));
    cue().textContent = `${t.label}：読んでください ▶`;
    await new Promise(res => setTimeout(res, 6000));
    const out = await r.stop();
    cue().textContent = `${t.label}：録音しました`;
    if (t.url) URL.revokeObjectURL(t.url);
    t.url = URL.createObjectURL(out.blob);
    t.settings = out.settings;
    t.mime = out.mime;
    t.bitrate = out.bitrate;
    t.metrics = await analyze(out.blob);
    t.error = null;
  } catch (err) {
    t.error = `${err.name || ''} ${err.message || err}`.trim();
    cue().textContent = `${t.label}：うまくいきませんでした（${t.error}）`;
  }
  micBusy = false;
  REPORT.mic.takes = takes.map(x => ({ label: x.label, preset: x.preset, constraints: x.constraints, settings: x.settings, mime: x.mime, bitrate: x.bitrate, metrics: x.metrics, error: x.error || null }));
  drawMic();
  if (REPORT.mic.choice) revealMic();
  renderReport();
});

function revealMic() {
  $('mic-reveal').hidden = false;
  $('mic-reveal').innerHTML = `<p>選んだもの：<b>${esc(REPORT.mic.choice)}</b></p>
    <table><tr><th></th><th>設定</th><th>雑音</th><th>声</th><th>SN比</th><th>音割れ</th></tr>
    ${takes.map(t => `<tr><td>${t.label}</td><td>${esc(t.presetName)}<br><span class="small">${esc(JSON.stringify({ ec: t.settings?.echoCancellation, ns: t.settings?.noiseSuppression, agc: t.settings?.autoGainControl, hz: t.settings?.sampleRate }))}</span></td>
      <td>${t.metrics?.noiseDb ?? '—'}dB</td><td>${t.metrics?.speechDb ?? '—'}dB</td><td>${t.metrics?.snrDb ?? '—'}dB</td><td>${t.metrics?.clipPct ?? '—'}%</td></tr>`).join('')}</table>
    <p class="small">雑音＝最初の黙っている部分の大きさ、声＝読んでいる部分の大きい方（上位10%）。SN比が大きいほど雑音が目立たない。音割れは 0% がよい。</p>`;
}

/** 録音を調べる：雑音の大きさ（最初の黙っている部分）・声の大きさ・SN比・音割れ */
async function analyze(blob) {
  const data = await blob.arrayBuffer();
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const buf = await new OAC(1, 1, 48000).decodeAudioData(data);
  const x = buf.getChannelData(0);
  const rate = buf.sampleRate;
  const frame = Math.round(rate * 0.02);
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i += 1) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
  const frames = [];
  for (let i = 0; i + frame <= x.length; i += frame) frames.push({ t: i / rate, v: rms(i, i + frame) });
  const db = v => Math.round(20 * Math.log10(Math.max(v, 1e-6)) * 10) / 10;
  const quiet = frames.filter(f => f.t >= 0.3 && f.t < 1.7).map(f => f.v).sort((a, b) => a - b);
  const loud = frames.filter(f => f.t >= 2.2).map(f => f.v).sort((a, b) => a - b);
  const noise = quiet.length ? quiet[Math.floor(quiet.length / 2)] : 0;
  const speech = loud.length ? loud[Math.floor(loud.length * 0.9)] : 0;
  let peak = 0;
  let clip = 0;
  for (let i = 0; i < x.length; i += 1) { const a = Math.abs(x[i]); if (a > peak) peak = a; if (a >= 0.99) clip += 1; }
  return {
    seconds: Math.round(buf.duration * 10) / 10,
    noiseDb: db(noise),
    speechDb: db(speech),
    snrDb: Math.round((db(speech) - db(noise)) * 10) / 10,
    peakDb: db(peak),
    clipPct: Math.round((clip / x.length) * 10000) / 100,
  };
}

// 前回の結果があれば表に出す（ブラウザが落ちたあとでも見られるように）
function drawSaved() {
  for (const [sid, r] of Object.entries(REPORT.asr)) {
    const box = document.querySelector(`.sent[data-sid="${sid}"]`);
    if (!box || !r?.runs) continue;
    box.querySelector('[data-out="status"]').textContent = `前回の結果（録音 ${r.audioSec ?? '?'}秒）。録音し直すと上書きします。`;
    box.querySelector('[data-out="table"]').innerHTML = `<table><tr><th>モデル</th><th>結果</th></tr>${r.runs.map(x => `<tr><td>${esc(x.engine)}</td><td class="${x.error ? 'bad' : ''}">${x.error ? esc(x.error) : x.run1 ? `1回目 ${sec(x.run1.ms)} · 2回目 ${sec(x.run2?.ms)} · ${x.run1.score}%「${esc(x.run1.text)}」` : '途中で止まった（ブラウザが落ちたかもしれません）'}</td></tr>`).join('')}</table>`;
  }
  if (REPORT.sr) { $('sr-out').hidden = false; $('sr-out').textContent = `前回：${REPORT.sr.ok ? `使える「${REPORT.sr.text}」` : `使えない（${REPORT.sr.error || REPORT.sr.reason}）`}`; }
}

drawSaved();
drawMic();
renderReport();
