// Whisper をスマホの中で動かす（v1.13.0）。js/whisper.js から使う。画面が固まらないように、別スレッド（Worker）で動かす。
//   ライブラリ：Hugging Face Transformers.js 4.3.2（Apache-2.0）と ONNX Runtime は jsDelivr から（版を固定）、モデルは Hugging Face から取る。
//   どれも一度取ったら端末のキャッシュ（grass-lib・transformers-cache）に入り、次からは通信しない。

import { pipeline, env, Tensor } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr = null;          // 読み込んだパイプライン
let asrModel = null;     // そのモデルの ID（呼び出し側が使う名前。実際に読んだリポジトリは info に）
let info = null;         // { repo, dtype } 実際に読み込んだもの
let loading = null;      // { model, promise }
let files = [];          // 読み込みに使ったファイル（キャッシュがそろっているかを、あとで確かめるため）

/** モデルの本体（onnx）が端末のキャッシュにもうあるか。Transformers.js の 'download' はキャッシュから読むときにも出るので、自分で確かめる */
async function inCache(repo, dtype) {
  try {
    const cache = await caches.open('transformers-cache');
    const suffix = dtype === 'q8' ? '_quantized' : dtype === 'fp32' ? '' : `_${dtype}`;
    const base = `https://huggingface.co/${repo}/resolve/main/onnx/`;
    return !!(await cache.match(`${base}encoder_model${suffix}.onnx`)) && !!(await cache.match(`${base}decoder_model_merged${suffix}.onnx`));
  } catch (e) { return false; }
}

// cands：[{ model: リポジトリ, dtype }]。前から順に試し、読めたものを使う（v1.13.2・Moonshine の実験用）
async function load(model, reqId, cands) {
  if (asr && asrModel === model) return asr;
  if (loading && loading.model === model) return loading.promise;
  if (asr) { try { await asr.dispose?.(); } catch (e) { /* */ } asr = null; asrModel = null; info = null; }
  const list = cands && cands.length ? cands : [{ model, dtype: 'q8' }];
  const promise = (async () => {
    let lastErr = null;
    for (const c of list) {
      const seen = new Set();
      let net = false;          // ネットから取るか（キャッシュから読むだけでも progress は出るので、区別する）
      try {
        net = !(await inCache(c.model, c.dtype));
        const p = await pipeline('automatic-speech-recognition', c.model, {
          device: 'wasm',
          dtype: { encoder_model: c.dtype, decoder_model_merged: c.dtype },
          progress_callback: ev => {
            if (ev.status === 'progress_total') self.postMessage({ type: 'progress', id: reqId, model, loaded: ev.loaded, total: ev.total, net });
            if (ev.status === 'done' && ev.file) seen.add(ev.file);
          },
        });
        const inputs = s => { try { return p.model?.sessions?.[s]?.inputNames || null; } catch (e) { return null; } };
        info = { repo: c.model, dtype: c.dtype, net, encoderInputs: inputs('model'), decoderInputs: inputs('decoder_model_merged') };
        asr = p; asrModel = model; files = [...seen];
        return p;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('model not found');
  })();
  loading = { model, promise };
  try { return await promise; } finally { if (loading?.promise === promise) loading = null; }
}

/** モデルごとの、文字にするときの指定 */
function genOptions(kind, audio) {
  if (kind === 'moonshine') {
    // Transformers.js の既定は「1秒あたり6トークン」（英語向け）。日本語は1秒に8文字ほど話すので、足りないと文の途中で切れる
    const sec = audio.length / 16000;
    const opts = { max_new_tokens: Math.ceil(sec * 13) + 8 };
    // 新しい書き出しの Moonshine は、エンコーダーに attention_mask の入力がある（モデルの中では使わない・互換のため）。
    // Transformers.js は Moonshine には attention_mask を渡さないので、全部 1 のものをこちらで渡す（v1.13.2）
    // generate() はモデルの forward_params にある名前しか通さない（Moonshine は input_values・decoder_input_ids・past_key_values だけ）ので、足しておく。
    // デコーダーに encoder_attention_mask の入力があれば、Transformers.js が同じものを渡す（Python の Transformers と同じ使い方）
    const model = asr?.model;
    if (model?.sessions?.model?.inputNames?.includes('attention_mask')) {
      if (Array.isArray(model.forward_params) && !model.forward_params.includes('attention_mask')) model.forward_params = [...model.forward_params, 'attention_mask'];
      opts.attention_mask = new Tensor('int64', new BigInt64Array(audio.length).fill(1n), [1, audio.length]);
    }
    return opts;
  }
  return { language: 'japanese', task: 'transcribe', return_timestamps: false };
}

self.onmessage = async e => {
  const m = e.data || {};
  try {
    if (m.type === 'load') {
      const t0 = performance.now();
      await load(m.model, m.id, m.cands);
      self.postMessage({ type: 'ok', id: m.id, model: m.model, files, info, ms: performance.now() - t0 });
    } else if (m.type === 'run') {
      const needLoad = !(asr && asrModel === m.model);
      if (needLoad) self.postMessage({ type: 'stage', id: m.id, stage: 'load', model: m.model });
      const l0 = performance.now();
      const p = await load(m.model, m.id, m.cands);
      const loadMs = needLoad ? performance.now() - l0 : 0;
      self.postMessage({ type: 'stage', id: m.id, stage: 'infer', model: m.model, loadMs });
      const t0 = performance.now();
      const out = await p(m.audio, genOptions(m.kind, m.audio));
      self.postMessage({ type: 'ok', id: m.id, model: m.model, info, text: (Array.isArray(out) ? out[0]?.text : out?.text) || '', ms: performance.now() - t0, loadMs });
    } else if (m.type === 'unload') {
      if (asr) { try { await asr.dispose?.(); } catch (err) { /* */ } }
      asr = null; asrModel = null;
      self.postMessage({ type: 'ok', id: m.id });
    }
  } catch (err) {
    self.postMessage({ type: 'err', id: m.id, error: String(err?.message || err) });
  }
};
