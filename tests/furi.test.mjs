// node tests/furi.test.mjs — ふりがな（ブラウザ不要）
//   - 「語=よみ」の読み取り・送りがなの突き合わせ・活用した形にも付く・長い語が先
//   - 音声側（tools/furi.py）と同じ分け方になるか（python3 があれば）
//   - data/chunks.json の furi が、文の中の語に実際に当たっているか
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseFuri, segment, align, furiHtml, hasFuri } from '../js/furi.js';

// 読み取り
const p = parseFuri('親友=しんゆう、悩み=なやみ, 打ち明けた＝ウチアケタ；ひらがな=ひらがな 空=から');
assert.deepEqual(p, [
  { w: '親友', r: 'しんゆう' }, { w: '悩み', r: 'なやみ' }, { w: '打ち明けた', r: 'うちあけた' }, { w: '空', r: 'から' },
]);
assert.deepEqual(parseFuri(''), []);
assert.deepEqual(parseFuri('親友=しんゆう、親友=しんとも'), [{ w: '親友', r: 'しんゆう' }], '同じ語は最初の読み');

// 送りがな
assert.deepEqual(align('打ち明けた', 'うちあけた'), [['打', 'う'], ['ち'], ['明', 'あ'], ['けた']]);
assert.deepEqual(align('親友', 'しんゆう'), [['親友', 'しんゆう']]);
assert.deepEqual(align('お願い', 'おねがい'), [['お'], ['願', 'ねが'], ['い']]);
assert.deepEqual(align('テスト環境', 'てすとかんきょう'), [['テスト'], ['環境', 'かんきょう']]);
assert.deepEqual(align('打ち明けた', 'まったくちがう'), [['打ち明けた', 'まったくちがう']], '合わなければ語全体に1つ');

// 文の中で
const words = s => segment(s, parseFuri(s.furi ?? '')).filter(x => typeof x !== 'string');
const seg = (text, furi) => segment(text, parseFuri(furi)).map(x => (typeof x === 'string' ? x : `[${x.w}:${x.r}]`)).join('');
assert.equal(seg('親友に悩みを打ち明けた。', '親友=しんゆう、悩み=なやみ、打ち明けた=うちあけた'),
  '[親友:しんゆう]に[悩み:なやみ]を[打ち明けた:うちあけた]。');
assert.equal(seg('悩みを打ち明ける', '悩み=なやみ、打ち明けた=うちあけた'), '[悩み:なやみ]を[打ち明:うちあ]ける', '活用した形にも付く');
assert.equal(seg('この作業は今日中に終わる見込みです。', '今日=きょう、今日中=きょうじゅう、作業=さぎょう'),
  'この[作業:さぎょう]は[今日中:きょうじゅう]に終わる見込みです。', '長い語が先');
assert.equal(seg('入力値が空です', '入力値=にゅうりょくち、空=から'), '[入力値:にゅうりょくち]が[空:から]です');
assert.equal(seg('その時までに、3時に', 'その時=そのとき、時=じ'), '[その時:そのとき]までに、3[時:じ]に', 'かなで始まる語');
assert.equal(seg('空く', '空=から、空く=あく'), '[空く:あく]', '書いたままの語が先');
assert.equal(seg('読みのない文', ''), '読みのない文');
// ほかの熟語の一部には付けない（JP-0086：置く=おく が 位置・配置 の「置」に付いていた）
assert.equal(seg('物をある位置に置く。物理配置から考える。置き場所', '置く=おく'), '物をある位置に[置く:おく]。物理配置から考える。[置:お]き場所');
assert.equal(seg('名前の前に', '前=まえ'), '名前の[前:まえ]に', '漢字1字は熟語の中に付けない');
assert.equal(seg('リリース後と承認後', '後=ご'), 'リリース[後:ご]と承認後');
assert.equal(seg('承認後に開始', '承認=しょうにん、後=ご'), '[承認:しょうにん][後:ご]に開始', '隣が読みのある語なら付く');
assert.equal(seg('一度声に出す。手段と手', '一度=いちど、声=こえ、手=て'), '[一度:いちど][声:こえ]に出す。手段と[手:て]');
assert.equal(seg('一文に', '一=いち、文=ぶん'), '[一:いち][文:ぶん]に');
assert.equal(seg('3時と10時', '時=じ'), '3[時:じ]と10[時:じ]', '数字の後ろは付く');
assert.equal(seg('散らばった情報', '散らばった=ちらばった'), '[散らばった:ちらばった]情報', '書いたままの語は後ろに漢字があっても付く');
assert.equal(words({ furi: '' }).length, 0);

// HTML：エスケープ・ルビ・タップの印
const html = furiHtml('<b>親友</b>に', parseFuri('親友=しんゆう'), 'JP-1');
assert.equal(html, '&lt;b&gt;<span class="fw" data-fk="JP-1|親友" role="button" tabindex="0" aria-label="親友の読みを出す"><ruby>親友<rt>しんゆう</rt></ruby></span>&lt;/b&gt;に');
assert.ok(furiHtml('打ち明けた', parseFuri('打ち明けた=うちあけた')).includes('<ruby>打<rt>う</rt></ruby>ち<ruby>明<rt>あ</rt></ruby>けた'));
assert.equal(furiHtml('a&b', []), 'a&amp;b');
assert.ok(hasFuri('親友', parseFuri('親友=しんゆう')));
assert.ok(!hasFuri('友達', parseFuri('親友=しんゆう')));

// data/chunks.json：furi の語はどれも、そのチャンクの文のどこかに当たる（書き間違い・古い語がない）
const chunks = JSON.parse(readFileSync(new URL('../data/chunks.json', import.meta.url), 'utf8')).chunks;
for (const c of chunks) {
  assert.ok(c.furi, `${c.id}: furi がない`);
  const texts = [c.scene, c.say, c.pattern, c.note, ...(c.v || []).map(v => v.t)].filter(Boolean);
  const pairs = parseFuri(c.furi);
  const hit = new Set(texts.flatMap(t => segment(t, pairs).filter(x => typeof x !== 'string').map(x => x.w)));
  const unused = pairs.filter(({ w, r }) => ![...hit].some(h => w.startsWith(h) && align(h, r)));
  assert.deepEqual(unused.map(x => x.w), [], `${c.id}: 文のどこにも当たらない語`);
}
const ch29 = chunks.find(c => c.id === 'ch-29');
assert.equal(segment(ch29.say, parseFuri(ch29.furi)).filter(x => typeof x !== 'string').map(x => `${x.w}=${x.r}`).join('、'), '入力値=にゅうりょくち、空=から');

// 音声側（tools/furi.py）も同じに分ける
try {
  const py = `
import json, sys
sys.path.insert(0, 'tools')
from furi import parse_furi, segment, wrong_words, respell, sound_in
cases = json.loads(sys.stdin.read())
out = []
for text, furi in cases:
    out.append([s if isinstance(s, str) else [s[0], s[1]] for s in segment(text, parse_furi(furi))])
pairs = parse_furi('入力値=にゅうりょくち、空=から、今日中=きょうじゅう、先生=せんせい')
heard = 'ニュウリョクアタイガソラデス'
ww = wrong_words('入力値が空です', pairs, heard)
out.append([list(w) for w in ww])
out.append(respell('入力値が空です', pairs, ww))
out.append(wrong_words('今日中に先生へ', pairs, 'キョージューニセンセーエ'))
out.append([sound_in('きょうじゅう', 'キョージュー'), sound_in('せんせい', 'センセエ'), sound_in('うちあけた', 'ナヤミヲウチアケタ'), sound_in('おおきい', 'オーキー'), sound_in('から', 'ソラ')])
print(json.dumps(out, ensure_ascii=False))`;
  const cases = [
    ['親友に悩みを打ち明ける', '親友=しんゆう、悩み=なやみ、打ち明けた=うちあけた'],
    ['この作業は今日中に', '今日=きょう、今日中=きょうじゅう、作業=さぎょう'],
    ['その時までに、3時に', 'その時=そのとき、時=じ'],
    ['物をある位置に置く。物理配置から', '置く=おく'],
    ['名前の前に承認後', '前=まえ、後=ご'],
  ];
  const res = JSON.parse(execFileSync('python3', ['-c', py], { input: JSON.stringify(cases), encoding: 'utf8' }));
  cases.forEach(([text, furi], k) => {
    const js = segment(text, parseFuri(furi)).map(x => (typeof x === 'string' ? x : [x.w, x.r]));
    assert.deepEqual(res[k], js, `tools/furi.py と js/furi.js の分け方が違う：${text}`);
  });
  assert.deepEqual(res[5], [['入力値', 'にゅうりょくち'], ['空', 'から']], '読み間違えた語');
  assert.equal(res[6], 'にゅうりょくちがからです');
  assert.deepEqual(res[7], [], '長音の書き方が違うだけなら、合っている');
  assert.deepEqual(res[8], [true, true, true, true, false], '長音・を の直後の語');
} catch (e) {
  if (e.code === 'ENOENT') console.log('（python3 がないので、音声側の確認は飛ばしました）');
  else throw e;
}

console.log('furi: ok');
