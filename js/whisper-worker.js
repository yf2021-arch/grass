// Whisper をスマホの中で動かす（v1.13.0）。js/whisper.js から使う。画面が固まらないように、別スレッド（Worker）で動かす。
//   ライブラリ：Hugging Face Transformers.js 4.3.2（Apache-2.0）と ONNX Runtime は jsDelivr から（版を固定）、モデルは Hugging Face から取る。
//   どれも一度取ったら端末のキャッシュ（grass-lib・transformers-cache）に入り、次からは通信しない。

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr = null;          // 読み込んだパイプライン
let asrModel = null;     // そのモデルの ID
let loading = null;      // { model, promise }
let files = [];          // 読み込みに使ったファイル（キャッシュがそろっているかを、あとで確かめるため）

async function load(model, reqId) {
  if (asr && asrModel === model) return asr;
  if (loading && loading.model === model) return loading.promise;
  if (asr) { try { await asr.dispose?.(); } catch (e) { /* */ } asr = null; asrModel = null; }
  const seen = new Set();
  const promise = pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback: p => {
      if (p.status === 'progress_total') self.postMessage({ type: 'progress', id: reqId, model, loaded: p.loaded, total: p.total });
      if (p.status === 'done' && p.file) seen.add(p.file);
    },
  }).then(p => { asr = p; asrModel = model; loading = null; files = [...seen]; return p; },
    e => { loading = null; throw e; });
  loading = { model, promise };
  return promise;
}

self.onmessage = async e => {
  const m = e.data || {};
  try {
    if (m.type === 'load') {
      const t0 = performance.now();
      await load(m.model, m.id);
      self.postMessage({ type: 'ok', id: m.id, model: m.model, files, ms: performance.now() - t0 });
    } else if (m.type === 'run') {
      const needLoad = !(asr && asrModel === m.model);
      if (needLoad) self.postMessage({ type: 'stage', id: m.id, stage: 'load', model: m.model });
      const l0 = performance.now();
      const p = await load(m.model, m.id);
      const loadMs = needLoad ? performance.now() - l0 : 0;
      self.postMessage({ type: 'stage', id: m.id, stage: 'infer', model: m.model, loadMs });
      const t0 = performance.now();
      const out = await p(m.audio, { language: 'japanese', task: 'transcribe', return_timestamps: false });
      self.postMessage({ type: 'ok', id: m.id, model: m.model, text: (Array.isArray(out) ? out[0]?.text : out?.text) || '', ms: performance.now() - t0, loadMs });
    } else if (m.type === 'unload') {
      if (asr) { try { await asr.dispose?.(); } catch (err) { /* */ } }
      asr = null; asrModel = null;
      self.postMessage({ type: 'ok', id: m.id });
    }
  } catch (err) {
    self.postMessage({ type: 'err', id: m.id, error: String(err?.message || err) });
  }
};
