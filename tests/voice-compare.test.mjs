// node tests/voice-compare.test.mjs — compareSay: overlap of recognized text, not pronunciation.
import assert from 'node:assert/strict';
globalThis.window = {};                       // voice.js reads window.SpeechRecognition at load
const { compareSay } = await import('../js/voice.js');
const pct = (t, h) => Math.round(compareSay(t, h).score * 100);
const say = '会議の資料を送ります。';
assert.equal(pct(say, '会議の資料を送ります'), 100, 'same text (punctuation ignored)');
assert.ok(pct(say, '会議の資料を送ります。会議の資料を送ります。') < 75, 'saying it twice is not 100%');
assert.equal(compareSay(say, '会議の資料を送ります。会議の資料を送ります。').extra, 10, 'extra characters are counted (10 = the repeated sentence)');
assert.ok(pct(say, '会議資料を送ります') < 100 && pct(say, '会議資料を送ります') > 85, 'a dropped particle costs a little');
assert.ok(pct(say, '会議の資料を見ます') < 85, 'a changed word costs more');
assert.ok(pct('カタカナ', 'かたかな') === 100, 'katakana and hiragana compare equal');
assert.equal(pct(say, ''), 0, 'silence / nothing heard');
assert.ok(pct(say, 'ご視聴ありがとうございました') < 20, 'unrelated hallucination scores low');
const marks = compareSay('送ります。', '送ります').marks;
assert.deepEqual(marks.map(m => m.ok), [true, true, true, true, true], 'punctuation is never marked missing');
console.log('PASS voice-compare');
