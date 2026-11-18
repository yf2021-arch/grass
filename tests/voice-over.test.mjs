// node tests/voice-over.test.mjs
// Synthetic Web Speech API tests; no microphone, Google service, or network required.
import assert from 'node:assert/strict';

const instances = [];
class FakeRecognition {
  constructor() { this._base = ''; instances.push(this); }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() {}
  result(transcript, isFinal = true) {
    this.onresult?.({ results: [{ 0: { transcript }, isFinal }] });
  }
  close() { this.onend?.(); }
}
globalThis.window = { SpeechRecognition: FakeRecognition };
const { createVoice } = await import('../js/voice.js');

const v = createVoice();
let outcome = null;
let failures = [];
let take = v.recognize({
  endCommand: true, keepListening: true, maxTakeMs: 6000,
  onEnd: r => { outcome = r; },
  onFail: e => { failures.push(e); },
});
instances.at(-1).result('まずテーブルを参照します。');
await new Promise(r => setTimeout(r, 1800));
assert.equal(outcome, null, 'ordinary 1.6-second pause must not stop long-form practice');
instances.at(-1).result('まずテーブルを参照します。 オーバー。', false);
assert.equal(outcome, null, 'interim recognition must not trigger an end command');
instances.at(-1).result('まずテーブルを参照します。 オーバー。', true);
assert.equal(outcome.reason, 'over');
assert.equal(outcome.text, 'まずテーブルを参照します。', 'command must be removed from transcript');
assert.deepEqual(failures, []);

outcome = null;
take = v.recognize({ endCommand: true, keepListening: true, maxTakeMs: 4000, onEnd: r => { outcome = r; } });
const first = instances.at(-1);
first.result('影響範囲を確認します。');
first.close();
assert.notEqual(first, instances.at(-1), 'browser session should restart after a pause');
instances.at(-1).result('最後に整合性を確認します。 オーバー');
assert.equal(outcome?.reason, 'over');
assert.match(outcome.text, /影響範囲/);
assert.match(outcome.text, /整合性/);

outcome = null;
take = v.recognize({ endCommand: true, keepListening: true, maxTakeMs: 4000, onEnd: r => { outcome = r; } });
instances.at(-1).result('少し長く話してみます。');
take.stop();
assert.equal(outcome.reason, 'manual', 'manual fallback works');

outcome = null;
take = v.recognize({ endCommand: true, keepListening: true, maxTakeMs: 120, onEnd: r => { outcome = r; } });
await new Promise(r => setTimeout(r, 200));
assert.equal(outcome?.reason, 'max', 'hard safety cap still applies');
console.log('PASS voice-over');
