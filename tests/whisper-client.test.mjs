// node tests/whisper-client.test.mjs — the Whisper client never waits forever:
// stalls time out, crashes and message errors reject every pending call, cancel works,
// stages are reported, and runs are serialized. Uses a fake Worker (no model, no network).
import assert from 'node:assert/strict';
const workers = [];
class FakeWorker {
  constructor() { this.sent = []; this.terminated = false; workers.push(this); }
  postMessage(m) { this.sent.push(m); FakeWorker.behave?.(this, m); }
  terminate() { this.terminated = true; }
  reply(m) { this.onmessage?.({ data: m }); }
}
globalThis.Worker = FakeWorker;
globalThis.localStorage = { getItem: () => JSON.stringify({ slowMs: { base: 50, small: 50 }, loadLimitMs: 200, runLimitMs: { base: 150, small: 150 } }) };
const { createWhisper, WH_LIMITS } = await import('../js/whisper.js');
assert.equal(WH_LIMITS.runLimitMs.base, 150, 'limits can be tuned via localStorage');
const pcm = () => new Float32Array(16000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1. normal run: stages load → infer, result, timings
FakeWorker.behave = (w, m) => {
  if (m.type === 'run') setTimeout(() => { w.reply({ type: 'stage', id: m.id, stage: 'load', model: m.model }); w.reply({ type: 'stage', id: m.id, stage: 'infer', model: m.model, loadMs: 30 }); w.reply({ type: 'ok', id: m.id, model: m.model, text: 'こんにちは', ms: 12, loadMs: 30 }); }, 5);
};
let wh = createWhisper();
const stages = [];
let out = await wh.transcribe('base', pcm(), { onStage: s => stages.push(s.stage) });
assert.deepEqual(stages, ['queued', 'load', 'load', 'infer'], 'stages reported');
assert.equal(out.text, 'こんにちは'); assert.equal(out.loadMs, 30);
assert.equal(wh.loadedModel, 'Xenova/whisper-base');

// 2. stall: no reply → times out, worker terminated, next call gets a fresh worker
FakeWorker.behave = () => {};
const before = workers.length;
await assert.rejects(wh.transcribe('base', pcm()), e => e.code === 'timeout');
assert.equal(workers.at(-1).terminated, true, 'stalled worker is terminated');
assert.equal(wh.loadedModel, null, 'model must be reloaded after a reset');
FakeWorker.behave = (w, m) => { if (m.type === 'run') setTimeout(() => w.reply({ type: 'ok', id: m.id, model: m.model, text: 'もう一度', ms: 5 }), 5); };
out = await wh.transcribe('base', pcm());
assert.equal(out.text, 'もう一度'); assert.ok(workers.length > before, 'recovers with a new worker');

// 3. crash: onerror rejects every pending call (queued work proceeds on a fresh worker)
wh = createWhisper();
FakeWorker.behave = (w, m) => { if (m.type === 'load') setTimeout(() => w.onerror?.({ message: 'out of memory', preventDefault() {} }), 5); };
const a = wh.load('small');
await assert.rejects(a, e => e.code === 'crashed' && /out of memory/.test(e.message));

// 4. messageerror also rejects
wh = createWhisper();
FakeWorker.behave = (w, m) => { if (m.type === 'run') setTimeout(() => w.onmessageerror?.({}), 5); };
await assert.rejects(wh.transcribe('base', pcm()), e => e.code === 'crashed');

// 5. cancel rejects with cancelled and terminates
wh = createWhisper();
FakeWorker.behave = () => {};
const c = wh.transcribe('small', pcm());
await sleep(10); wh.cancel();
await assert.rejects(c, e => e.code === 'cancelled');
assert.equal(workers.at(-1).terminated, true);

// 6. runs are serialized: the second is not sent until the first finishes
wh = createWhisper();
const order = [];
FakeWorker.behave = (w, m) => { if (m.type === 'run') { order.push('start' + w.sent.length); setTimeout(() => { order.push('end' + w.sent.length); w.reply({ type: 'ok', id: m.id, model: m.model, text: 'x', ms: 1 }); }, 20); } };
await Promise.all([wh.transcribe('base', pcm()), wh.transcribe('base', pcm())]);
assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2'], 'one transcription at a time');

// 7. an error reply leaves the worker usable
wh = createWhisper();
FakeWorker.behave = (w, m) => { if (m.type === 'run') setTimeout(() => w.reply({ type: 'err', id: m.id, error: 'bad audio' }), 5); };
await assert.rejects(wh.transcribe('base', pcm()), e => e.code === 'failed' && e.message === 'bad audio');
// 8. A active + B queued, cancel B: A finishes, B is never sent to the worker
wh = createWhisper();
let runs = 0;
FakeWorker.behave = (w, m) => { if (m.type === 'run') { runs++; setTimeout(() => w.reply({ type: 'ok', id: m.id, model: m.model, text: 'A', ms: 1 }), 60); } };
const abortB = new AbortController();
const jobA = wh.transcribe('base', pcm());
const jobB = wh.transcribe('base', pcm(), { signal: abortB.signal });
await sleep(10);
abortB.abort();
await assert.rejects(jobB, e => e.code === 'cancelled', 'queued B rejects at once');
assert.equal((await jobA).text, 'A', 'active A is not affected');
await sleep(80);
assert.equal(runs, 1, 'cancelled B was never dispatched');
assert.equal(workers.at(-1).terminated, false, 'worker kept: nothing active was cancelled');

// 9. cancel the active A: A rejects, the worker is replaced, queued B still runs and completes
wh = createWhisper();
runs = 0;
FakeWorker.behave = (w, m) => { if (m.type === 'run') { runs++; const text = runs === 1 ? null : 'B'; if (text) setTimeout(() => w.reply({ type: 'ok', id: m.id, model: m.model, text, ms: 1 }), 10); } };
const abortA = new AbortController();
const activeA = wh.transcribe('base', pcm(), { signal: abortA.signal });
const queuedB = wh.transcribe('base', pcm());
await sleep(10);
const firstWorker = workers.at(-1);
abortA.abort();
await assert.rejects(activeA, e => e.code === 'cancelled');
assert.equal(firstWorker.terminated, true, 'stopping an active run needs a new worker');
assert.equal((await queuedB).text, 'B', 'queued B continues on a fresh worker');
assert.equal(runs, 2);

// 10. aborted before calling: rejected without queueing
const pre = new AbortController(); pre.abort();
await assert.rejects(wh.transcribe('base', pcm(), { signal: pre.signal }), e => e.code === 'cancelled');
console.log('PASS whisper-client');
