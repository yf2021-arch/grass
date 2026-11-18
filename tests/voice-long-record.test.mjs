// node tests/voice-long-record.test.mjs
// Regression: long-form practice ignores pauses, respects manual stop and custom cap.
import assert from 'node:assert/strict';
globalThis.window = { MediaRecorder: class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  state = 'inactive';
  mimeType = 'audio/webm';
  start() { this.state = 'recording'; this.onstart?.(); }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], {type: 'audio/webm'}) });
    this.onstop?.();
  }
} };
globalThis.navigator = { mediaDevices: { getUserMedia: async () => ({
  getTracks: () => [{ stop() {} }],
  getAudioTracks: () => [{ readyState: 'live' }],
}) } };
const { createVoice } = await import('../js/voice.js');
const v = createVoice();
let result;
let take = await v.record({ autoStopSilence: false, maxTakeMs: 5000, onEnd: r => {result=r;} });
await new Promise(r => setTimeout(r, 2000));
assert.equal(result, undefined, 'long-form must not stop on a 1.6s thinking pause');
take.stop();
await new Promise(r => setTimeout(r, 30));
assert.equal(result?.reason, 'tap');
assert.ok(result.blob.size > 0);
assert.ok(result.endAt >= result.startAt);
result = undefined;
take = await v.record({ autoStopSilence: false, maxTakeMs: 250, onEnd: r => {result=r;} });
await new Promise(r => setTimeout(r, 400));
assert.equal(result?.reason, 'max', 'long-form still has a safety maximum');
v.release();
console.log('PASS long-form record');
