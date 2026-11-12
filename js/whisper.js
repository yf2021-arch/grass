// スマホの中の Whisper（v1.13.0）
//   録音した声を、端末の中で文字にする。Google のサービスもサーバーもいらない。
//   モデルは初回だけダウンロード（Wi-Fi で）。その後はオフラインでも動く。
//   処理は js/whisper-worker.js（別スレッド）で行う。

// v1.14.0：標準は Moonshine（Grass のスマホで、6秒の文が約1.5秒・Whisper base は約10秒。精度は同じくらい）。
//   Whisper small は Grass のスマホ（Android・8GB）でブラウザごと落ちたので、外した。
export const WH_MODELS = {
  // 日本語専用・27M パラメータ。話した長さだけ計算する（Whisper のような30秒の枠がない）。
  // Moonshine AI Community License（個人の非商用は可・"Powered by Moonshine AI" を表示）。
  // Hugging Face の変換版はコミュニティのもの。最初の候補がなければ次を使う（いまは wmoto-ai のものが使われる）。
  moonshine: {
    id: 'onnx-community/moonshine-tiny-ja-ONNX', alt: ['wmoto-ai/moonshine-tiny-ja-ONNX'], kind: 'moonshine',
    name: '速い（Moonshine）', approx: '約30MB', note: '1文が1〜2秒ほどで文字になります',
    credit: 'Powered by Moonshine AI（Moonshine AI Community License・個人の非商用）',
  },
  base: { id: 'Xenova/whisper-base', kind: 'whisper', name: '遅い（Whisper base）', approx: '約80MB', note: 'スマホでは1文に10秒ほどかかります' },
};
export const DEFAULT_WH_MODEL = 'moonshine';
// 選べなくなったモデル。端末のキャッシュに残っていれば消す（small は約400MB）
const RETIRED_REPOS = ['Xenova/whisper-small'];

/** 「話す」の画面で選べるモデル（実験のものを除く） */
export const appModels = () => Object.entries(WH_MODELS).filter(([, m]) => !m.lab);

/**
 * 読み込みの候補（リポジトリ × 精度）。q8 だけ。
 * fp32（大きい）には自動で落とさない：スマホで small が落ちたように、大きいモデルはブラウザごと落ちることがあるため（Kairos のレビュー・2026-11-12）
 */
function candidates(key) {
  const m = WH_MODELS[key];
  return [m.id, ...(m.alt || [])].map(model => ({ model, dtype: 'q8' }));
}
const MODEL_FILES = ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const TF_CACHE = 'transformers-cache';

// 時間の目安（v1.13.1）。遅い端末と「止まった」を分けるため、2段階にする。
//   slowMs を過ぎたら「時間がかかっています」と出し、やめる／base でやり直すを選べるようにする（処理は続ける）。
//   limitMs を過ぎたら Worker を止めて、エラーとして返す（画面が「文字にしています…」のままにならない）。
// 端末で測った数字がまだないので、余裕を大きく取っている。設定（localStorage の whLimits）で変えられる。
export const WH_LIMITS = {
  slowMs: { base: 20000, moonshine: 10000 },
  loadLimitMs: 300000,                       // モデルの読み込み（初回のコンパイルを含む）
  runLimitMs: { base: 120000, moonshine: 60000 }, // 1文を文字にする
};
try { Object.assign(WH_LIMITS, JSON.parse(localStorage.getItem('whLimits') || '{}')); } catch (e) { /* 既定のまま */ }

/** code: 'timeout'（時間切れ）| 'cancelled'（やめた）| 'crashed'（Worker が落ちた）| 'failed'（エラーが返った） */
export class WhisperError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function createWhisper() {
  let worker = null;
  let seq = 0;
  let loaded = null;              // Worker の中で読み込み済みのモデル ID
  let queue = Promise.resolve();  // 文字にする処理は1つずつ（同じ Worker で同時に走らせない）
  const pending = new Map();      // id → { resolve, reject, onProgress, onStage, timer }

  /** Worker を止めて、待っているものをすべて失敗にする（止まったとき・やめたとき） */
  function reset(code, message) {
    const err = new WhisperError(code, message);
    const list = [...pending.values()];
    pending.clear();
    list.forEach(p => { clearTimeout(p.timer); p.reject(err); });
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
    worker = null;
    loaded = null;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const m = e.data || {};
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') { p.onProgress?.(m); return; }
      if (m.type === 'stage') { if (m.stage === 'infer' && m.model) loaded = m.model; p.onStage?.(m); return; }
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.type === 'ok') { if (m.model) loaded = m.model; p.resolve(m); } else p.reject(new WhisperError('failed', m.error || 'whisper error'));
    };
    worker.onerror = e => { e.preventDefault?.(); reset('crashed', e.message || 'Whisper が止まりました（メモリ不足かもしれません）'); };
    worker.onmessageerror = () => reset('crashed', 'Whisper とのやりとりに失敗しました');
    return worker;
  }

  function call(msg, { onProgress, onStage, limitMs, onId } = {}, transfer = []) {
    const id = ++seq;
    onId?.(id);
    return new Promise((resolve, reject) => {
      const timer = limitMs ? setTimeout(() => reset('timeout', `${Math.round(limitMs / 1000)}秒たっても終わらないので止めました`), limitMs) : 0;
      pending.set(id, { resolve, reject, onProgress, onStage, timer });
      try { ensureWorker().postMessage({ ...msg, id }, transfer); } catch (e) { pending.delete(id); clearTimeout(timer); reject(new WhisperError('crashed', e.message)); }
    });
  }

  /** モデルを読み込む（なければダウンロード）。onProgress({ loaded, total }) → { files: [読み込んだファイル名] } */
  async function load(key, onProgress) {
    const model = WH_MODELS[key]?.id;
    if (!model) throw new Error(`unknown model ${key}`);
    try { await navigator.storage?.persist?.(); } catch (e) { /* 消されにくくするだけ */ }
    const r = await call({ type: 'load', model, kind: WH_MODELS[key].kind, cands: candidates(key) }, { onProgress, limitMs: WH_LIMITS.loadLimitMs });
    return { files: r.files || [], ms: r.ms, info: r.info || null };
  }

  /**
   * 16kHz・モノラルの Float32Array を文字にする → { text, ms（文字にする時間）, loadMs（読み込みが要ったとき） }
   * onStage({ stage: 'queued' | 'load' | 'infer' }) で、いま何をしているかを知らせる。
   * signal（AbortSignal）で、この1件だけをやめられる：
   *   順番待ちのあいだ → Worker には送らない（前の処理はそのまま続く）
   *   処理中 → Worker ごと止める（WASM の計算は途中で止められないため）。順番待ちのものは新しい Worker で続く
   */
  function transcribe(key, audio, { onStage, signal } = {}) {
    const model = WH_MODELS[key]?.id;
    const cancelled = () => new WhisperError('cancelled', 'やめました');
    if (signal?.aborted) return Promise.reject(cancelled());
    onStage?.({ stage: 'queued' });
    let reqId = null;
    const job = queue.then(async () => {
      if (signal?.aborted) throw cancelled();          // 順番待ちのあいだにやめた → 送らない
      const needLoad = loaded !== model;
      onStage?.({ stage: needLoad ? 'load' : 'infer' });
      const limitMs = (needLoad ? WH_LIMITS.loadLimitMs : 0) + (WH_LIMITS.runLimitMs[key] || 120000);
      const r = await call({ type: 'run', model, kind: WH_MODELS[key].kind, cands: candidates(key), audio }, { onStage, limitMs, onId: id => { reqId = id; } }, [audio.buffer]);
      return { text: cleanText(r.text), ms: r.ms, loadMs: r.loadMs || 0, info: r.info || null };
    });
    queue = job.catch(() => {});
    if (!signal) return job;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (reqId != null && pending.has(reqId)) reset('cancelled', 'やめました');   // 処理中のこの1件を止める
        else reject(cancelled());                                                  // 順番待ち：すぐに終わったことにする
      };
      signal.addEventListener('abort', onAbort, { once: true });
      job.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  /** 今の処理をすべてやめる（Worker ごと止める。モデルを消すときなど） */
  function cancel() { if (pending.size) reset('cancelled', 'やめました'); }

  /** Worker を閉じる（読み込んだモデルもメモリから消える。次の処理は読み込みからやり直し） */
  function dispose() { reset('cancelled', 'やめました'); }

  /** ファイル名のリスト（files）がすべて端末のキャッシュにあるか → { ready, bytes, missing } */
  async function cacheStatus(key, files) {
    const m = WH_MODELS[key];
    const list = files && files.length ? files : MODEL_FILES;
    if (!m || !('caches' in window)) return { ready: false, bytes: 0, missing: list };
    try {
      const cache = await caches.open(TF_CACHE);
      let first = null;
      // 候補のリポジトリのどれかに、ファイルが全部そろっていればよい（Moonshine は2つ目の候補が使われている）
      for (const repo of [m.id, ...(m.alt || [])]) {
        let bytes = 0;
        const missing = [];
        for (const f of list) {
          const hit = await cache.match(`https://huggingface.co/${repo}/resolve/main/${f}`);
          if (!hit) missing.push(f); else bytes += Number(hit.headers.get('content-length')) || 0;
        }
        const st = { ready: !missing.length, bytes, missing, checked: list.length, full: !!(files && files.length), repo };
        if (st.ready) return st;
        if (!first) first = st;
      }
      return first;
    } catch (e) { return { ready: false, bytes: 0, missing: list }; }
  }

  /** 互換用：そろっていれば合計バイト数（わからなければ 1）、なければ 0 */
  async function cachedBytes(key, files) {
    const st = await cacheStatus(key, files);
    return st.ready ? (st.bytes || 1) : 0;
  }

  /** 選べなくなったモデル（Whisper small）のファイルを、端末のキャッシュから消す → 消した数 */
  async function purgeRetired() {
    if (!('caches' in window)) return 0;
    try {
      const cache = await caches.open(TF_CACHE);
      let n = 0;
      for (const req of await cache.keys()) {
        if (RETIRED_REPOS.some(r => req.url.includes(`/${r}/`))) { await cache.delete(req); n += 1; }
      }
      return n;
    } catch (e) { return 0; }
  }

  /** モデルを端末から消す */
  async function remove(key) {
    const model = WH_MODELS[key]?.id;
    reset('cancelled', 'cancelled');
    if (!model || !('caches' in window)) return;
    const cache = await caches.open(TF_CACHE);
    const repos = [model, ...(WH_MODELS[key].alt || [])];
    for (const req of await cache.keys()) {
      if (repos.some(r => req.url.includes(`/${r}/`))) await cache.delete(req);
    }
  }

  return { load, transcribe, cancel, dispose, cacheStatus, cachedBytes, remove, purgeRetired, get loadedModel() { return loaded; } };
}

/** 録音（webm など）を 16kHz・モノラルにする。fromSec〜toSec だけ切り出す（前後の無音で Whisper が作り話をしないように） */
export async function decodeForWhisper(blobOrUrl, fromSec = 0, toSec = Infinity) {
  const blob = typeof blobOrUrl === 'string' ? await (await fetch(blobOrUrl)).blob() : blobOrUrl;
  const data = await blob.arrayBuffer();
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(1, 16000, 16000);
  const buf = await ctx.decodeAudioData(data);
  // decodeAudioData は 16kHz に変換して返す。チャンネルが2つなら平均する
  let pcm = buf.getChannelData(0);
  if (buf.numberOfChannels > 1) {
    const r = buf.getChannelData(1);
    const mix = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i += 1) mix[i] = (pcm[i] + r[i]) / 2;
    pcm = mix;
  }
  const a = Math.max(0, Math.floor(fromSec * buf.sampleRate));
  const b = Math.min(pcm.length, Math.ceil(Math.min(toSec, 30) * buf.sampleRate));
  return pcm.slice(a, Math.max(a, b));
}

// Whisper が無音や雑音のときに出しやすい決まり文句（動画の字幕で覚えたもの）
const JUNK = /^(ご視聴ありがとうございました|ご覧いただきありがとうございます|チャンネル登録(よろしくお願いします|お願いします)?)[。！!]*$/;

function cleanText(t) {
  const s = String(t || '').trim();
  return JUNK.test(s) ? '' : s;
}
