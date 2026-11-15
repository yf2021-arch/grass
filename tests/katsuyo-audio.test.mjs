import assert from 'node:assert/strict';
import { createRewardAudio } from '../js/katsuyo-audio.js';

let spoken = [];
globalThis.window = { speechSynthesis: { getVoices: () => [], cancel() {}, speak(u) { spoken.push(u); } } };
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const reward = createRewardAudio();
let finished = false;
const speech = reward.play('書いて').then(ok => { finished = true; return ok; });
assert.equal(spoken[0].text, '書いて');
assert.equal(spoken[0].lang, 'ja-JP', 'request Japanese even before voices are enumerated');
await Promise.resolve();
assert.equal(finished, false, 'playback starting must not advance the drill');
spoken[0].onend();
assert.equal(await speech, true);

const interrupted = reward.play('読んだ');
reward.stop();
assert.equal(await interrupted, false, 'leaving the drill releases the pending reward');
let audio;
globalThis.Audio = class {
  constructor(url) { this.url = url; audio = this; }
  play() { return Promise.resolve(); }
  pause() {}
};
const recording = reward.play('食べない', '/audio/example.mp3');
assert.equal(audio.url, '/audio/example.mp3');
audio.onended();
assert.equal(await recording, true);
globalThis.Audio = class { play() { return Promise.reject(new Error('missing recording')); } pause() {} };
const fallback = reward.play('来た', '/missing.mp3');
await Promise.resolve(); await Promise.resolve();
assert.equal(spoken.at(-1).text, '来た');
spoken.at(-1).onend();
assert.equal(await fallback, true);
window.speechSynthesis = null;
assert.equal(await reward.play('書いた'), false, 'unsupported audio cannot block the drill');
console.log('PASS reward audio: automatic Japanese speech, completion, cancellation, recording and fallback');

// Exercise the real correct-answer action with the old saved voice=false setting.
const { createKatsuyo, BASE_WORDS, FORMS, conj } = await import('../js/katsuyo.js');
window.addEventListener = () => {};
window.speechSynthesis = { getVoices: () => [], cancel() {}, speak(u) { spoken.push(u); } };
globalThis.location = { hash: '#/katsuyo' };
globalThis.fetch = async () => ({ ok: false });
const app = { innerHTML: '', querySelector: () => null };
const drill = createKatsuyo({ app, esc: String, nav: () => '', ICON: {}, todayStr: () => '2026-11-15', store: {
  get: async () => ({ voice: false, auto: true, mine: false }), put: async () => {},
} });
await drill.load();
drill.actions['kt-start']();
const word = BASE_WORDS.find(w => w.w === app.innerHTML.match(/class="w">([^<]+)/)[1]);
const label = app.innerHTML.match(/class="kt-form"><span>([^<]+)/)[1];
const form = Object.keys(FORMS).find(f => FORMS[f].label === label);
const right = conj(word, form);
const options = [...app.innerHTML.matchAll(/data-act="kt-pick" data-v="(\d+)"[^>]*>([^<]+)/g)];
const answer = options.find(m => m[2] === right)[1];
const picking = drill.actions['kt-pick']({ dataset: { v: answer } });
assert.equal(spoken.at(-1).text, right, 'a correct choice automatically speaks despite a saved disabled preference');
assert.match(app.innerHTML, /kt-fb ok/);
spoken.at(-1).onend();
await picking;
drill.actions['kt-quit']();
console.log('PASS correct-answer action: automatic reward with legacy settings');
