// スマホの中の Whisper（v1.13.0）
//   録音した声を、端末の中で文字にする。Google のサービスもサーバーもいらない。
//   モデルは初回だけダウンロード（Wi-Fi で）。その後はオフラインでも動く。
//   処理は js/whisper-worker.js（別スレッド）で行う。

export const WH_MODELS = {
  base: { id: 'Xenova/whisper-base', name: 'ふつう（base）', approx: '約80MB', note: '1文が数秒〜10秒ほどで文字になります' },
  small: { id: 'Xenova/whisper-small', name: 'より正確（small）', approx: '約400MB', note: '遅く、1文に十数秒かかることがあります' },
};
const MODEL_FILES = ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const TF_CACHE = 'transformers-cache';

// 時間の目安（v1.13.1）。遅い端末と「止まった」を分けるため、2段階にする。
//   slowMs を過ぎたら「時間がかかっています」と出し、やめる／base でやり直すを選べるようにする（処理は続ける）。
//   limitMs を過ぎたら Worker を止めて、エラーとして返す（画面が「文字にしています…」のままにならない）。
// 端末で測った数字がまだないので、余裕を大きく取っている。設定（localStorage の whLimits）で変えられる。
export const WH_LIMITS = {
  slowMs: { base: 20000, small: 45000 },
  loadLimitMs: 300000,                       // モデルの読み込み（初回のコンパイルを含む）
  runLimitMs: { base: 120000, small: 240000 }, // 1文を文字にする
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

  function call(msg, { onProgress, onStage, limitMs } = {}, transfer = []) {
    const id = ++seq;
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
    const r = await call({ type: 'load', model }, { onProgress, limitMs: WH_LIMITS.loadLimitMs });
    return { files: r.files || [], ms: r.ms };
  }

  /**
   * 16kHz・モノラルの Float32Array を文字にする → { text, ms（文字にする時間）, loadMs（読み込みが要ったとき） }
   * onStage({ stage: 'queued' | 'load' | 'infer' }) で、いま何をしているかを知らせる。
   */
  function transcribe(key, audio, { onStage } = {}) {
    const model = WH_MODELS[key]?.id;
    onStage?.({ stage: 'queued' });
    const job = queue.then(async () => {
      const needLoad = loaded !== model;
      onStage?.({ stage: needLoad ? 'load' : 'infer' });
      const limitMs = (needLoad ? WH_LIMITS.loadLimitMs : 0) + (WH_LIMITS.runLimitMs[key] || 120000);
      const r = await call({ type: 'run', model, audio }, { onStage, limitMs }, [audio.buffer]);
      return { text: cleanText(r.text), ms: r.ms, loadMs: r.loadMs || 0 };
    });
    queue = job.catch(() => {});
    return job;
  }

  /** 今の処理をやめる（Worker ごと止める。次に使うときは読み込み直し） */
  function cancel() { if (pending.size) reset('cancelled', 'やめました'); }

  /** ファイル名のリスト（files）がすべて端末のキャッシュにあるか → { ready, bytes, missing } */
  async function cacheStatus(key, files) {
    const model = WH_MODELS[key]?.id;
    const list = files && files.length ? files : MODEL_FILES;
    if (!model || !('caches' in window)) return { ready: false, bytes: 0, missing: list };
    try {
      const cache = await caches.open(TF_CACHE);
      let bytes = 0;
      const missing = [];
      for (const f of list) {
        const hit = await cache.match(`https://huggingface.co/${model}/resolve/main/${f}`);
        if (!hit) missing.push(f); else bytes += Number(hit.headers.get('content-length')) || 0;
      }
      return { ready: !missing.length, bytes, missing, checked: list.length, full: !!(files && files.length) };
    } catch (e) { return { ready: false, bytes: 0, missing: list }; }
  }

  /** 互換用：そろっていれば合計バイト数（わからなければ 1）、なければ 0 */
  async function cachedBytes(key, files) {
    const st = await cacheStatus(key, files);
    return st.ready ? (st.bytes || 1) : 0;
  }

  /** モデルを端末から消す */
  async function remove(key) {
    const model = WH_MODELS[key]?.id;
    reset('cancelled', 'cancelled');
    if (!model || !('caches' in window)) return;
    const cache = await caches.open(TF_CACHE);
    for (const req of await cache.keys()) {
      if (req.url.includes(`/${model}/`)) await cache.delete(req);
    }
  }

  return { load, transcribe, cancel, cacheStatus, cachedBytes, remove, get loadedModel() { return loaded; } };
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
