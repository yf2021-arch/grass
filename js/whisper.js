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

export function createWhisper() {
  let worker = null;
  let seq = 0;
  const pending = new Map();      // id → { resolve, reject, onProgress }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const m = e.data || {};
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') { p.onProgress?.(m); return; }
      pending.delete(m.id);
      if (m.type === 'ok') p.resolve(m); else p.reject(new Error(m.error || 'whisper error'));
    };
    worker.onerror = e => {
      const err = new Error(e.message || 'Whisper を起動できません');
      pending.forEach(p => p.reject(err));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  }

  function call(msg, onProgress, transfer = []) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      ensureWorker().postMessage({ ...msg, id }, transfer);
    });
  }

  /** モデルを読み込む（なければダウンロード）。onProgress({ loaded, total }) */
  async function load(key, onProgress) {
    const model = WH_MODELS[key]?.id;
    if (!model) throw new Error(`unknown model ${key}`);
    try { await navigator.storage?.persist?.(); } catch (e) { /* 消されにくくするだけ */ }
    await call({ type: 'load', model }, onProgress);
  }

  /** 16kHz・モノラルの Float32Array を文字にする → { text, ms } */
  async function transcribe(key, audio) {
    const model = WH_MODELS[key]?.id;
    const r = await call({ type: 'run', model, audio }, null, [audio.buffer]);
    return { text: cleanText(r.text), ms: r.ms };
  }

  /** モデルのファイルが端末のキャッシュにそろっているか → 合計バイト数（なければ 0） */
  async function cachedBytes(key) {
    const model = WH_MODELS[key]?.id;
    if (!model || !('caches' in window)) return 0;
    try {
      const cache = await caches.open(TF_CACHE);
      let bytes = 0;
      for (const f of MODEL_FILES) {
        const hit = await cache.match(`https://huggingface.co/${model}/resolve/main/${f}`);
        if (!hit) return 0;
        bytes += Number(hit.headers.get('content-length')) || 0;
      }
      return bytes || 1;
    } catch (e) { return 0; }
  }

  /** モデルを端末から消す */
  async function remove(key) {
    const model = WH_MODELS[key]?.id;
    if (worker) { worker.terminate(); worker = null; pending.forEach(p => p.reject(new Error('cancelled'))); pending.clear(); }
    if (!model || !('caches' in window)) return;
    const cache = await caches.open(TF_CACHE);
    for (const req of await cache.keys()) {
      if (req.url.includes(`/${model}/`)) await cache.delete(req);
    }
  }

  return { load, transcribe, cachedBytes, remove };
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
