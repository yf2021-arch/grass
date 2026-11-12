// node tests/katsuyo.test.mjs — 活用ドリルの活用ルール（ブラウザ不要）
//   - 正しい形（て・た・ない・受け身・使役・形容詞）
//   - 選択肢：正解は1つだけ・重複なし・正解と同じ間違いはない
//   - 自分のカードからの語（品詞・型 と 読み から段を決める）
import assert from 'node:assert/strict';
import { conj, makeOptions, wordFromCard, ruGroup, BASE_WORDS, formsFor, frameOf, rulePath } from '../js/katsuyo.js';

const V = (w, g) => ({ w, g });
const cases = [
  [V('書く', '5'), { te: '書いて', ta: '書いた', nai: '書かない', pass: '書かれる', caus: '書かせる' }],
  [V('行く', '5'), { te: '行って', ta: '行った', nai: '行かない', caus: '行かせる' }],
  [V('急ぐ', '5'), { te: '急いで', ta: '急いだ', nai: '急がない' }],
  [V('話す', '5'), { te: '話して', ta: '話した', nai: '話さない', caus: '話させる' }],
  [V('待つ', '5'), { te: '待って', ta: '待った', nai: '待たない', pass: '待たれる' }],
  [V('言う', '5'), { te: '言って', ta: '言った', nai: '言わない', pass: '言われる', caus: '言わせる' }],
  [V('読む', '5'), { te: '読んで', ta: '読んだ', nai: '読まない', pass: '読まれる' }],
  [V('呼ぶ', '5'), { te: '呼んで', ta: '呼んだ', nai: '呼ばない', pass: '呼ばれる' }],
  [V('死ぬ', '5'), { te: '死んで', ta: '死んだ', nai: '死なない' }],
  [V('帰る', '5'), { te: '帰って', ta: '帰った', nai: '帰らない', caus: '帰らせる' }],
  [V('食べる', '1'), { te: '食べて', ta: '食べた', nai: '食べない', pass: '食べられる', caus: '食べさせる' }],
  [V('見る', '1'), { te: '見て', nai: '見ない', pass: '見られる', caus: '見させる' }],
  [V('する', 's'), { te: 'して', ta: 'した', nai: 'しない', pass: 'される', caus: 'させる' }],
  [V('確認する', 's'), { te: '確認して', nai: '確認しない', pass: '確認される', caus: '確認させる' }],
  [V('来る', 'k'), { te: 'きて', ta: 'きた', nai: 'こない', pass: 'こられる', caus: 'こさせる' }],
  [V('持ってくる', 'k'), { te: '持ってきて', nai: '持ってこない' }],
  [V('高い', 'i'), { aneg: '高くない', apast: '高かった', apneg: '高くなかった', ate: '高くて' }],
  [V('いい', 'i'), { aneg: 'よくない', apast: 'よかった', apneg: 'よくなかった', ate: 'よくて' }],
  [V('かっこいい', 'i'), { aneg: 'かっこよくない', apast: 'かっこよかった' }],
  [V('都合がいい', 'i'), { apast: '都合がよかった' }],
  [V('簡単', 'na'), { aneg: '簡単じゃない', apast: '簡単だった', apneg: '簡単じゃなかった', ate: '簡単で' }],
  [V('きれい', 'na'), { aneg: 'きれいじゃない', apast: 'きれいだった' }],
];
let n = 0;
for (const [word, forms] of cases) for (const [f, want] of Object.entries(forms)) { assert.equal(conj(word, f), want, `${word.w} ${f}`); n++; }

// 選択肢：基本語のすべての 語×形 で、正解がちょうど1つ・重複なし・4択（グループ3・い/な2）
let opts = 0;
for (const word of BASE_WORDS) for (const f of formsFor(word)) {
  for (let k = 0; k < 5; k++) {
    const { options, answer } = makeOptions(word, f);
    const want = f === 'group' ? 3 : f === 'agroup' ? 2 : 4;
    assert.equal(options.length, want, `${word.w} ${f} options ${options}`);
    assert.equal(new Set(options).size, options.length, `${word.w} ${f} duplicate ${options}`);
    assert.equal(options[answer], conj(word, f), `${word.w} ${f}`);
    assert.equal(options.filter(o => o === conj(word, f)).length, 1);
    opts++;
  }
  assert.ok(rulePath(word, f).rule, `${word.w} ${f} rule`);
  const fr = frameOf(word, f);
  if (fr) assert.equal((fr.match(/＿/g) || []).length, 1, `${word.w} ${f} frame`);
}
// よくある間違いが選択肢に必ず入る
assert.ok(makeOptions(V('帰る', '5'), 'te').options.includes('帰て'));
assert.ok(makeOptions(V('食べる', '1'), 'te').options.includes('食べって'));
assert.ok(makeOptions(V('行く', '5'), 'te').options.includes('行いて'));
assert.ok(makeOptions(V('きれい', 'na'), 'aneg').options.includes('きれくない'));
assert.ok(makeOptions(V('いい', 'i'), 'apast').options.includes('いかった'));
assert.ok(makeOptions(V('書く', '5'), 'caus').options.includes('書かさせる'));
assert.ok(makeOptions(V('言う', '5'), 'nai').options.includes('言あない'));

// る動詞の段
assert.equal(ruGroup('帰る'), '5');
assert.equal(ruGroup('気に入る'), '5');
assert.equal(ruGroup('変える', 'かえる'), '1');
assert.equal(ruGroup('着る'), '1');
assert.equal(ruGroup('鍛える'), '1');
assert.equal(ruGroup('溜まる'), '5');
assert.equal(ruGroup('取る', 'とる'), '5');
assert.equal(ruGroup('居る'), '1');
assert.equal(ruGroup('閉じる', 'とじる'), '1');
assert.equal(ruGroup('練る'), '5');
assert.equal(ruGroup('寝る'), '1');
assert.equal(ruGroup('得る'), '1');

// 自分のカード
const card = (表現, 読み, 品詞) => ({ ID: 'x', 表現, 読み, '品詞・型': 品詞, 英語の意味: 'to test; try' });
assert.deepEqual(pick(wordFromCard(card('鍛える', 'きたえる', '動詞（他動詞）'))), { w: '鍛える', g: '1' });
assert.deepEqual(pick(wordFromCard(card('溜まる', 'たまる', '動詞（自動詞）'))), { w: '溜まる', g: '5' });
assert.deepEqual(pick(wordFromCard(card('腹落ちする', 'はらおちする', '動詞（自動詞・サ変）'))), { w: '腹落ちする', g: 's' });
assert.deepEqual(pick(wordFromCard(card('経つ', 'たつ', '動詞'))), { w: '経つ', g: '5' });
assert.deepEqual(pick(wordFromCard(card('曖昧な', 'あいまい', '形容動詞'))), { w: '曖昧', g: 'na' });
assert.deepEqual(pick(wordFromCard(card('とんでもない', 'とんでもない', '形容詞'))), { w: 'とんでもない', g: 'i' });
assert.equal(wordFromCard(card('一旦', 'いったん', '副詞')), null);
assert.equal(wordFromCard(card('経って', 'たって', '動詞')), null);
assert.equal(wordFromCard(card('腹に落ちる', '', '文型・連語')), null);
assert.deepEqual(pick(wordFromCard(card('見極める', '', '動詞'))), { w: '見極める', g: '1' });
assert.equal(wordFromCard(card('映る', '', '動詞')), null);   // 漢字＋る で読みがない → 段が分からないので出さない
assert.equal(conj(wordFromCard(card('とんでもない', '', '形容詞')), 'apast'), 'とんでもなかった');
function pick(x) { return x && { w: x.w, g: x.g }; }

console.log(`ok — ${n} forms, ${opts} option sets, ${BASE_WORDS.length} base words`);
