// 活用ドリル（v1.16.0）
//   #/katsuyo … 2つのタブ
//     ドリル  … 10問の短いラウンド。形を選んで、4つの中から正しい活用を素早く選ぶ
//                グループ（五段・一段・不規則／い・な）・て形・た形・ない形・形容詞・受け身・使役
//     ルール図 … 色で覚える活用の地図（う・つ・る→って など）。ドリルの答えも同じ色で出る
//
// 選択肢は「よくある間違い」から作る（帰る→帰て、きれい→きれくない、書く→書かさせる …）。
// 正しい別の言い方（簡単でした・簡単ではない など）は選択肢に入れない。答えはすべて普通形。
// 自分のカードの語は、品詞・型 の型（五段・一段・サ変・カ変）をいちばんに使い、型がなくて迷う語は出さない。
// 間違えた組み合わせ（語×形）ほど次のラウンドに多く出る（箱 0〜4 の簡単な間隔反復）。
// 基本語（仕事でよく使う動詞・形容詞）に、自分のカードの動詞・形容詞も混ぜられる。
// データはこのスマホの中（meta の katsuyo）だけ。

/* ============================== 活用のルール ============================== */

const ROWS = { う: 'わいうえお', く: 'かきくけこ', ぐ: 'がぎぐげご', す: 'さしすせそ', つ: 'たちつてと', ぬ: 'なにぬねの', ぶ: 'ばびぶべぼ', む: 'まみむめも', る: 'らりるれろ' };
const TE = { う: 'って', つ: 'って', る: 'って', む: 'んで', ぶ: 'んで', ぬ: 'んで', く: 'いて', ぐ: 'いで', す: 'して' };
const FAM = { う: 'tte', つ: 'tte', る: 'tte', む: 'nde', ぶ: 'nde', ぬ: 'nde', く: 'ite', ぐ: 'ite', す: 'shite' };
const ROW_I = 'いきぎしじちぢにひびぴみり';
const ROW_E = 'えけげせぜてでねへべぺめれ';
// る で終わり、い段・え段＋る に見えるのに五段の動詞（語末で判定するので複合語にも効く）
const GODAN_RU = ['帰る', '入る', '知る', '要る', '切る', '走る', '限る', '減る', '蹴る', '滑る', '握る', '参る', '遮る', '焦る', '喋る', 'しゃべる', '練る', '茂る', '散る', '照る', '湿る', '覆る', '翻る', '陥る', '甦る', '蘇る', '罵る', '捻る', '嘲る', '混じる', '交じる', '耽る', '弄る', '限る'];
// 漢字1字＋る の一段動詞（読みがないと段が分からないもの）
const ICHI_KANJI = ['見る', '居る', '着る', '寝る', '出る', '得る', '似る', '煮る', '経る', '射る', '診る', '鋳る'];

export const FORMS = {
  group:  { label: 'グループ', en: 'which group?', chip: 'グループ' },
  te:     { label: 'て形', en: '-te (and… / please…)', chip: 'て形' },
  ta:     { label: 'た形', en: 'past (did)', chip: 'た形' },
  nai:    { label: 'ない形', en: 'negative (don’t)', chip: 'ない形' },
  pass:   { label: '受け身', en: 'passive (be done by)', chip: '受け身' },
  caus:   { label: '使役', en: 'causative (make / let do)', chip: '使役' },
  agroup: { label: 'い？な？', en: 'い- or な-adjective?', chip: '形容詞' },
  aneg:   { label: '否定', en: 'is not', chip: '形容詞' },
  apast:  { label: '過去', en: 'was', chip: '形容詞' },
  apneg:  { label: '過去の否定', en: 'was not', chip: '形容詞' },
  ate:    { label: 'て形（形容詞）', en: '-te (…and)', chip: '形容詞' },
  pot:    { label: '可能形', en: 'can do', chip: '可能形' },
  nd:     { label: '〜んです', en: 'explaining (it’s that…)', chip: 'んです' },
  ndta:   { label: '〜んです（過去）', en: 'explaining, past', chip: 'んです' },
  and:    { label: '〜んです（形容詞）', en: 'explaining', chip: 'んです' },
  andta:  { label: '〜んです（形容詞・過去）', en: 'explaining, past', chip: 'んです' },
};
export const CHIPS = ['グループ', 'て形', 'た形', 'ない形', '形容詞', '受け身', '使役', '可能形', 'んです'];
const VERB_FORMS = ['group', 'te', 'ta', 'nai', 'pass', 'caus', 'pot', 'nd', 'ndta'];
const ADJ_FORMS = ['agroup', 'aneg', 'apast', 'apneg', 'ate', 'and', 'andta'];
const GROUP_OPTS = ['五段（う動詞）', '一段（る動詞）', '不規則（する・来る）'];
const AGROUP_OPTS = ['い形容詞', 'な形容詞'];

const isVerb = g => g === '5' || g === '1' || g === 's' || g === 'k';
const kuruStem = w => w.replace(/(来る|くる)$/, '');     // 持ってくる → 持って
const suruStem = w => w.replace(/する$/, '');
// いい（＝よい）とその複合語だけが よ で活用する。かわいい は普通の い形容詞（かわいくない）
const YOI = /^いい$|[がのはも]いい$|(かっこ|格好|気持ち|心地|ちょうど|丁度)いい$/;
export const isYoi = w => YOI.test(w);
const iStem = w => (isYoi(w) ? w.slice(0, -2) + 'よ' : w.slice(0, -1));   // いい → よ（よくない・よかった）
const isIku = w => /(行く|いく)$/.test(w);
// ある の否定は「ない」（あらない ではない）。〜てある・〜である も同じ
const ARU = /^(ある|有る|在る)$|[てで]ある$/;
export const isAru = w => ARU.test(w);
const aruNai = w => w.replace(/(ある|有る|在る)$/, 'ない');
// 問う・請う・乞う の て形は「うて」（問うて・問うた）
const isTou = w => /(問う|請う|乞う)$/.test(w);
/** ます形の語幹（書き・食べ・確認し・き） */
const masuStem = ({ w, g }) => (g === '5' ? w.slice(0, -1) + (ROWS[w.slice(-1)] || ROWS.る)[1] : g === '1' ? w.slice(0, -1) : g === 's' ? suruStem(w) + 'し' : kuruStem(w) + 'き');

/** 正しい形。word = { w, g }。g は 5 | 1 | s | k | i | na */
export function conj(word, form) {
  const { w, g } = word;
  const last = w.slice(-1), s5 = w.slice(0, -1);
  const a = ROWS[last]?.[0];
  const toTa = t => t.replace(/て$/, 'た').replace(/で$/, 'だ');
  switch (form) {
    case 'group': return GROUP_OPTS[g === '5' ? 0 : g === '1' ? 1 : 2];
    case 'agroup': return AGROUP_OPTS[g === 'i' ? 0 : 1];
    case 'te': case 'ta': {
      let t;
      if (g === '5') t = isIku(w) ? s5 + 'って' : isTou(w) ? s5 + 'うて' : s5 + TE[last];
      else if (g === '1') t = s5 + 'て';
      else if (g === 's') t = suruStem(w) + 'して';
      else t = kuruStem(w) + 'きて';
      return form === 'ta' ? toTa(t) : t;
    }
    case 'nai': return g === '5' && isAru(w) ? aruNai(w) : g === '5' ? s5 + a + 'ない' : g === '1' ? s5 + 'ない' : g === 's' ? suruStem(w) + 'しない' : kuruStem(w) + 'こない';
    case 'pass': return g === '5' ? s5 + a + 'れる' : g === '1' ? s5 + 'られる' : g === 's' ? suruStem(w) + 'される' : kuruStem(w) + 'こられる';
    case 'caus': return g === '5' ? s5 + a + 'せる' : g === '1' ? s5 + 'させる' : g === 's' ? suruStem(w) + 'させる' : kuruStem(w) + 'こさせる';
    case 'aneg': return g === 'i' ? iStem(w) + 'くない' : w + 'じゃない';
    case 'apast': return g === 'i' ? iStem(w) + 'かった' : w + 'だった';
    case 'apneg': return g === 'i' ? iStem(w) + 'くなかった' : w + 'じゃなかった';
    case 'ate': return g === 'i' ? iStem(w) + 'くて' : w + 'で';
    case 'pot': return g === '5' ? s5 + ROWS[last][3] + 'る' : g === '1' ? s5 + 'られる' : g === 's' ? suruStem(w) + 'できる' : kuruStem(w) + 'こられる';
    case 'nd': return w + 'んです';
    case 'ndta': return conj(word, 'ta') + 'んです';
    case 'and': return g === 'i' ? w + 'んです' : w + 'なんです';
    case 'andta': return g === 'i' ? conj(word, 'apast') + 'んです' : w + 'だったんです';
  }
  return '';
}

/** よくある間違い（先頭ほど「ありがちな」間違い）。正しい形と重なるものは後で除く */
function wrongForms(word, form) {
  const { w, g } = word;
  const last = w.slice(-1), s5 = w.slice(0, -1);
  const row = ROWS[last] || ROWS.る;
  const a = row[0], i = row[1], e = row[3];
  const toTa = t => t.replace(/て$/, 'た').replace(/で$/, 'だ');
  if (form === 'te' || form === 'ta') {
    let c;
    if (g === 's') { const st = suruStem(w); c = [st + 'すって', st + 'しって', st + 'すて', st + 'さして']; }
    else if (g === 'k') { const st = kuruStem(w); c = [st + 'くって', st + 'こて', st + 'きって', st + 'くて']; }
    else {
      const pri = g === '1' ? [s5 + 'って'] : isIku(w) ? [s5 + 'いて'] : last === 'る' ? [s5 + 'て'] : [];
      c = [...pri, ...['って', 'んで', 'いて', 'いで', 'して'].map(x => s5 + x), s5 + i + 'て', s5 + 'て'];
    }
    return form === 'ta' ? c.map(toTa) : c;
  }
  if (form === 'nai') {
    if (g === 's') { const st = suruStem(w); return [st + 'さない', st + 'すない', st + 'せない']; }
    if (g === 'k') { const st = kuruStem(w); return [st + 'きない', st + 'くない', st + 'こらない']; }
    if (g === '5' && isAru(w)) return [s5 + 'らない', s5 + 'ない', s5 + 'りない', s5 + 'れない'];   // あらない（いちばん多い間違い）
    const pri = g === '1' ? [s5 + 'らない'] : last === 'う' ? [s5 + 'あない'] : last === 'る' ? [s5 + 'ない'] : [];
    return [...pri, s5 + a + 'ない', s5 + 'ない', s5 + i + 'ない', s5 + e + 'ない', s5 + 'らない'];
  }
  if (form === 'pass' || form === 'caus') {
    if (g === 's') { const st = suruStem(w); return form === 'pass' ? [st + 'させる', st + 'できる', st + 'しれる', st + 'すられる'] : [st + 'される', st + 'しせる', st + 'さられる', st + 'させられる']; }
    if (g === 'k') { const st = kuruStem(w); return form === 'pass' ? [st + 'こさせる', st + 'これる', st + 'きられる', st + 'くられる'] : [st + 'こられる', st + 'きさせる', st + 'くさせる', st + 'こせる']; }
    const ua = last === 'う' ? [s5 + 'あれる', s5 + 'あせる'] : [];
    if (form === 'pass') {
      const pri = g === '1' ? [s5 + 'れる', s5 + 'させる'] : [s5 + a + 'せる', s5 + e + 'る'];
      return [...pri, ...ua, s5 + a + 'れる', s5 + a + 'られる', s5 + 'られる', s5 + 'れる', s5 + i + 'れる', s5 + 'させる'];
    }
    const pri = g === '1' ? [s5 + 'せる', s5 + 'られる'] : [s5 + a + 'させる', s5 + a + 'れる'];
    return [...pri, ...ua, s5 + a + 'せる', s5 + 'させる', s5 + i + 'せる', s5 + 'せる', s5 + a + 'せられる'];
  }
  if (form === 'pot') {
    // ら抜き（食べれる・これる）は話し言葉で使われるので、間違いの選択肢には入れない
    if (g === 's') { const st = suruStem(w); return [st + 'される', st + 'させる', st + 'しれる', st + 'すれる', st + 'できれる']; }
    if (g === 'k') { const st = kuruStem(w); return [st + 'こさせる', st + 'きられる', st + 'くられる', st + 'こされる']; }
    if (g === '1') return [s5 + 'させる', s5 + 'られれる', s5 + 'らせる', s5 + 'りれる'];
    return [s5 + a + 'れる', s5 + e + 'られる', s5 + a + 'られる', s5 + i + 'れる', s5 + 'られる', s5 + e + 'れる'];   // 書かれる（受け身と混ぜる）・書けられる
  }
  if (form === 'nd' || form === 'ndta') {
    const ms = masuStem(word);
    if (form === 'nd') return [w + 'なんです', w + 'だんです', ms + 'んです', w + 'んだです'];
    const ta = conj(word, 'ta');
    return [ta + 'なんです', ta + 'だんです', w + 'たんです', ms + 'たんです', ta + 'んだです'];
  }
  if (form === 'and' || form === 'andta') {
    const st = w.slice(0, -1);
    const wi = g === 'na' && w.endsWith('い') ? w.slice(0, -1) : null;
    if (g === 'i') return form === 'and'
      ? [w + 'なんです', w + 'だんです', st + 'くんです', w + 'のんです']
      : [w + 'だったんです', conj(word, 'apast') + 'なんです', st + 'くかったんです', w + 'かったんです'];
    return form === 'and'
      ? [w + 'んです', w + 'だんです', w + 'のんです', w + 'ななんです']                     // 簡単んです（な を落とす）
      : [...(wi ? [wi + 'かったんです'] : []), w + 'なだったんです', w + 'かったんです', w + 'だったなんです', w + 'なかったんです'];
  }
  if (g === 'i') {
    const st = w.slice(0, -1);          // いい → い（いくない・いかった：いちばん多い間違い）。普通の い形容詞では正しい形と同じなので除かれる
    const yo = iStem(w);
    return {
      aneg: [st + 'くない', w + 'じゃない', w + 'くない', yo + 'ない', st + 'じゃない'],
      apast: [st + 'かった', w + 'だった', w + 'かった', yo + 'くかった', st + 'だった'],
      apneg: [st + 'くなかった', w + 'じゃなかった', w + 'くなかった', yo + 'かったない', yo + 'くないだった'],
      ate: [st + 'くて', w + 'で', w + 'くて', yo + 'て', yo + 'くで'],
    }[form] || [];
  }
  const wi = w.endsWith('い') ? w.slice(0, -1) : null;   // きれい・嫌い を い形容詞のように活用してしまう
  return {
    aneg: [...(wi ? [wi + 'くない'] : []), w + 'くない', w + 'ない', w + 'だじゃない', w + 'なくない'],
    apast: [...(wi ? [wi + 'かった'] : []), w + 'かった', w + 'だかった', w + 'なかった', w + 'だだった'],
    apneg: [...(wi ? [wi + 'くなかった'] : []), w + 'くなかった', w + 'じゃないだった', w + 'だじゃなかった', w + 'じゃない'],
    ate: [...(wi ? [wi + 'くて'] : []), w + 'くて', w + 'て', w + 'だて', w + 'なで'],
  }[form] || [];
}

/** 4択（グループは3択・い/なは2択）。answer は正解の位置 */
export function makeOptions(word, form, rnd = Math.random) {
  if (form === 'group') return { options: GROUP_OPTS.slice(), answer: GROUP_OPTS.indexOf(conj(word, form)) };
  if (form === 'agroup') return { options: AGROUP_OPTS.slice(), answer: AGROUP_OPTS.indexOf(conj(word, form)) };
  const right = conj(word, form);
  const pool = [...new Set(wrongForms(word, form))].filter(x => x && x !== right);
  const picked = pool.length ? [pool[0]] : [];
  const rest = pool.slice(1);
  while (picked.length < 3 && rest.length) picked.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);
  const options = [right, ...picked];
  for (let k = options.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [options[k], options[j]] = [options[j], options[k]]; }
  return { options, answer: options.indexOf(right) };
}

/** 答えの「通り道」：色（fam）とルールの短い説明 */
export function rulePath(word, form) {
  const { w, g } = word;
  const last = w.slice(-1);
  const a = ROWS[last]?.[0];
  const trap = trapNote(word);
  if (form === 'group' || form === 'agroup') {
    if (g === '5') {
      if (last !== 'る') return { fam: 'g5', rule: '「る」以外で終わる → 五段', trap };
      if (GODAN_RU.some(x => w.endsWith(x))) return { fam: 'g5', rule: '例外：い段・え段＋る なのに五段', trap };
      const prev = /\p{Script=Han}|々/u.test(w.slice(-2, -1)) ? (word.r || '').slice(-2, -1) : w.slice(-2, -1);
      return { fam: 'g5', rule: `${rowOf(prev) ? rowOf(prev) + '段' : 'あ・う・お段'}＋る → 五段`, trap };
    }
    if (g === '1') return { fam: 'ichi', rule: 'い段・え段＋る → 一段', trap };
    if (g === 's' || g === 'k') return { fam: 'irr', rule: g === 's' ? '〜する → 不規則' : '来る → 不規則', trap };
    return { fam: g === 'i' ? 'iadj' : 'naadj', rule: g === 'i' ? '名詞の前で「〜い」→ い形容詞' : '名詞の前で「〜な」→ な形容詞', trap };
  }
  const ta = form === 'ta';
  if (form === 'te' || ta) {
    const T = s => (ta ? s.replace(/て$/, 'た').replace(/で$/, 'だ') : s);
    if (g === '5' && isIku(w)) return { fam: 'irr', rule: `例外：行く → 行${T('って')}`, trap };
    if (g === '5' && isTou(w)) return { fam: 'irr', rule: `例外：問う → 問う${T('て')}`, trap };
    if (g === '5') return { fam: FAM[last], rule: `五段：${famKeys(last)} → ${T(TE[last])}`, trap };
    if (g === '1') return { fam: 'ichi', rule: `一段：る → ${T('て')}`, trap };
    if (g === 's') return { fam: 'irr', rule: `する → ${T('して')}`, trap };
    return { fam: 'irr', rule: `来る → ${T('きて')}（来${T('て')}）`, trap };
  }
  if (form === 'nai' || form === 'pass' || form === 'caus') {
    const end = { nai: ['ない', 'ない', 'しない', 'こない'], pass: ['れる', 'られる', 'される', 'こられる'], caus: ['せる', 'させる', 'させる', 'こさせる'] }[form];
    if (g === '5' && form === 'nai' && isAru(w)) return { fam: 'irr', rule: '例外：ある → ない', trap };
    if (g === '5') return { fam: 'arow', rule: `五段：${last} → ${a}＋${end[0]}${last === 'う' ? '（う は「わ」）' : ''}`, trap };
    if (g === '1') return { fam: 'ichi', rule: `一段：る → ${end[1]}`, trap };
    if (g === 's') return { fam: 'irr', rule: `する → ${end[2]}`, trap: form === 'caus' ? '〜させていただきます ＝「〜してもいいですか」の丁寧な言い方' : trap };
    return { fam: 'irr', rule: `来る → ${end[3]}`, trap };
  }
  if (form === 'pot') {
    if (g === '5') return { fam: 'erow', rule: `五段：${last} → ${ROWS[last][3]}＋る`, trap: trap || `受け身（${w.slice(0, -1) + a}れる）と混ぜない。可能は え段＋る` };
    if (g === '1') return { fam: 'ichi', rule: '一段：る → られる', trap: trap || 'ら抜き（見れる・食べれる）は話し言葉で聞くが、仕事・試験では 見られる・食べられる' };
    if (g === 's') return { fam: 'irr', rule: 'する → できる', trap };
    return { fam: 'irr', rule: '来る → こられる', trap: 'ら抜き（来れる）は話し言葉。仕事・試験では 来られる（こられる）' };
  }
  if (form === 'nd' || form === 'ndta') return { fam: 'nd', rule: form === 'nd' ? '普通形 ＋ んです' : 'た形 ＋ んです', trap };
  if (form === 'and' || form === 'andta') {
    const past = form === 'andta';
    if (g === 'i') return { fam: 'iadj', rule: past ? 'い形容詞：かった ＋ んです' : 'い形容詞 ＋ んです', trap };
    return { fam: 'naadj', rule: past ? 'な形容詞：だった ＋ んです' : 'な形容詞 ＋ な ＋ んです', trap: past ? trap : `な を忘れない：${w}なんです（名詞も 会議なんです）` };
  }
  const yoi = isYoi(w);
  const ia = { aneg: 'くない', apast: 'かった', apneg: 'くなかった', ate: 'くて' }[form];
  const na = { aneg: 'じゃない', apast: 'だった', apneg: 'じゃなかった', ate: 'で' }[form];
  if (g === 'i') return { fam: 'iadj', rule: yoi ? `例外：いい → よ${ia}` : `い形容詞：い → ${ia}`, trap };
  return { fam: 'naadj', rule: `な形容詞：＋${na}`, trap };
}
const famKeys = last => ({ tte: 'う・つ・る', nde: 'む・ぶ・ぬ', ite: last === 'ぐ' ? 'ぐ' : 'く', shite: 'す' }[FAM[last]]);
const rowOf = ch => (ROW_I.includes(ch) ? 'い' : ROW_E.includes(ch) ? 'え' : '');
const DAN = { あ: 'あかがさざただなはばぱまやらわ', い: 'いきぎしじちぢにひびぴみり', う: 'うくぐすずつづぬふぶぷむゆる', え: 'えけげせぜてでねへべぺめれ', お: 'おこごそぞとどのほぼぽもよろを' };
const danOf = ch => { for (const [k, v] of Object.entries(DAN)) if (v.includes(ch)) return k + '段'; return ''; };

function trapNote({ w, g }) {
  if (g === '5' && w.endsWith('る') && GODAN_RU.some(x => w.endsWith(x))) return `${w} は い段・え段＋る に見えますが五段：${conj({ w, g }, 'te')}・${conj({ w, g }, 'nai')}`;
  if (g === '5' && isIku(w)) return 'く で終わっても 行く だけは「行って・行った」';
  if (g === 'na' && w.endsWith('い')) return `「い」で終わっても な形容詞（${w}な〜）：${w}じゃない`;
  if (g === '5' && isAru(w)) return 'ある の否定は「ない」だけ（あらない とは言わない）';
  if (g === 'i' && isYoi(w)) return 'いい は「よい」の形で活用：よくない・よかった';
  return '';
}

/* ============================== 基本語 ============================== */

// 語|読み|グループ|英語|目的語・主語|フラグ（n＝自然に起きること・受け身・使役・可能なし／v＝自動詞・受け身なし／x＝可能形なし）|受け身の文（＿が答え）
const BANK = `
書く|かく|5|write|報告書を
行く|いく|5|go|取引先に|v
聞く|きく|5|ask; listen|担当者に
置く|おく|5|put|資料を
開く|ひらく|5|hold (a meeting)|説明会を||来月、説明会が＿。
働く|はたらく|5|work|本社で|v
届く|とどく|5|arrive|荷物が|n
急ぐ|いそぐ|5|hurry||v
防ぐ|ふせぐ|5|prevent|ミスを
話す|はなす|5|talk|部長と|v
出す|だす|5|submit|書類を
渡す|わたす|5|hand over|資料を
直す|なおす|5|fix|間違いを
探す|さがす|5|look for|資料を
待つ|まつ|5|wait for|返事を
持つ|もつ|5|hold; carry|名刺を
経つ|たつ|5|(time) pass|時間が|n
使う|つかう|5|use|システムを||このシステムは多くの会社で＿。
言う|いう|5|say|意見を
会う|あう|5|meet|お客様に|v
払う|はらう|5|pay|費用を
手伝う|てつだう|5|help|準備を
送る|おくる|5|send|メールを
作る|つくる|5|make|資料を
取る|とる|5|take|休みを
守る|まもる|5|keep (a deadline)|期限を
断る|ことわる|5|turn down|依頼を
頑張る|がんばる|5|do one’s best||v
終わる|おわる|5|end|会議が|n
溜まる|たまる|5|pile up|仕事が|n
帰る|かえる|5|go home||v
入る|はいる|5|enter|会議室に|v
知る|しる|5|know|結果を|x|この会社は海外でも＿。
要る|いる|5|need|お金が|n
切る|きる|5|hang up; cut|電話を||話の途中で電話を＿。
走る|はしる|5|run||v
限る|かぎる|5|limit|人数を||参加できる人数が＿。
減る|へる|5|decrease|売上が|n
参る|まいる|5|go; come (humble)|会場に|n
読む|よむ|5|read|契約書を||この本は多くの人に＿。
頼む|たのむ|5|ask (a favor)|仕事を
休む|やすむ|5|take a day off|会社を
進む|すすむ|5|move forward|計画が|n
呼ぶ|よぶ|5|call|タクシーを
選ぶ|えらぶ|5|choose|担当者を
学ぶ|まなぶ|5|learn|敬語を
見る|みる|1|look at|資料を
出る|でる|1|attend; leave|会議に|v
食べる|たべる|1|eat|昼ご飯を
決める|きめる|1|decide|日程を
調べる|しらべる|1|look into|原因を
伝える|つたえる|1|tell; pass on|結果を
教える|おしえる|1|teach|やり方を
考える|かんがえる|1|think about|対策を
答える|こたえる|1|answer|質問に
始める|はじめる|1|start|会議を
続ける|つづける|1|continue|作業を
届ける|とどける|1|deliver|書類を
確かめる|たしかめる|1|check|数字を
鍛える|きたえる|1|train; build up|体を
起きる|おきる|1|get up|早く|v
借りる|かりる|1|borrow|会議室を
遅れる|おくれる|1|be late|会議に|n
忘れる|わすれる|1|forget|資料を
受ける|うける|1|take (training)|研修を
辞める|やめる|1|quit|会社を
集める|あつめる|1|collect|データを
任せる|まかせる|1|leave (it) to|仕事を
認める|みとめる|1|admit; approve|ミスを
変える|かえる|1|change|予定を
着る|きる|1|wear|スーツを
いる|いる|1|be; stay|会社に|n
する|する|s|do|仕事を
来る|くる|k|come|会社に|v
確認する|かくにんする|s|confirm|内容を
連絡する|れんらくする|s|contact|お客様に
説明する|せつめいする|s|explain|計画を
報告する|ほうこくする|s|report|結果を
相談する|そうだんする|s|consult|上司に|v
出張する|しゅっちょうする|s|go on a business trip|大阪に|v
対応する|たいおうする|s|deal with|問い合わせに
準備する|じゅんびする|s|prepare|資料を
参加する|さんかする|s|take part|会議に|v
持ってくる|もってくる|k|bring|資料を
ある|ある|5|there is; have|会議が|n
高い|たかい|i|expensive; high|値段が
安い|やすい|i|cheap|費用が
忙しい|いそがしい|i|busy|今週は
難しい|むずかしい|i|difficult|この案件は
早い|はやい|i|early; quick|返事が
遅い|おそい|i|late; slow|対応が
多い|おおい|i|many|問い合わせが
少ない|すくない|i|few; little|時間が
新しい|あたらしい|i|new|システムが
詳しい|くわしい|i|detailed|説明が
厳しい|きびしい|i|strict; tight|締め切りが
正しい|ただしい|i|correct|数字が
細かい|こまかい|i|detailed; fussy|部長は
長い|ながい|i|long|会議が
悪い|わるい|i|bad|天気が
面白い|おもしろい|i|interesting|話が
いい|いい|i|good|結果が
都合がいい|つごうがいい|i|convenient (for me)|木曜日は
かっこいい|かっこいい|i|cool|デザインが
簡単|かんたん|na|easy|手続きは
大切|たいせつ|na|important|準備が
必要|ひつよう|na|necessary|確認が
便利|べんり|na|handy|このツールは
丁寧|ていねい|na|polite; careful|説明が
大変|たいへん|na|tough|今月は
重要|じゅうよう|na|important|この点は
適切|てきせつ|na|appropriate|対応が
無理|むり|na|impossible|明日までは
十分|じゅうぶん|na|enough|時間が
明確|めいかく|na|clear|目標が
曖昧|あいまい|na|vague|指示が
静か|しずか|na|quiet|オフィスが
暇|ひま|na|free (not busy)|今日は
好き|すき|na|like|この仕事が
きれい|きれい|na|clean; pretty|会議室が
嫌い|きらい|na|dislike|会議が
有名|ゆうめい|na|famous|この会社は
元気|げんき|na|well; lively|みんな
`.trim().split('\n').map(line => {
  const [w, r, g, en, o = '', f = '', p = ''] = line.split('|');
  return { w, r, g, en, o, n: f.includes('n'), v: f.includes('v') || f.includes('n'), x: f.includes('x'), p };
});
export const BASE_WORDS = BANK;

/** 自分のカード（表現・読み・品詞・型）から活用できる動詞・形容詞を作る。作れないものは null */
export function wordFromCard(card) {
  const val = k => String(card?.[k] ?? '').trim();
  const first = s => s.replace(/（[^）]*）|\([^)]*\)/g, '').split(/[・／/、,，｜|\s]/).map(x => x.trim()).filter(Boolean)[0] || '';
  let w = first(val('表現'));
  const r = first(val('読み'));
  const pos = val('品詞・型');
  if (!w || !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]{1,10}$/u.test(w)) return null;
  const en = val('英語の意味').split(/[;；,，、｜/]/)[0].trim().slice(0, 28);
  const base = { r, en, o: '', n: false, v: true, mine: true, id: card.ID };
  if (/形容動詞|な形容詞/.test(pos)) return { ...base, w: w.replace(/な$/, ''), g: 'na' };
  if (/形容詞/.test(pos)) return w.endsWith('い') ? { ...base, w, g: 'i' } : null;
  if (!/動詞/.test(pos)) return null;
  const last = w.slice(-1);
  const ok = g => ({ ...base, w, g });
  // 1) カードに書いてある型がいちばん確か（出来る＝一段、こする＝五段 など）
  if (/サ変/.test(pos)) return w.endsWith('する') && w.length > 2 ? ok('s') : null;
  if (/カ変/.test(pos)) return /(来る|くる)$/.test(w) ? ok('k') : null;
  if (/一段/.test(pos)) return last === 'る' ? ok('1') : null;
  if (/五段/.test(pos)) return ROWS[last] ? ok('5') : null;
  // 2) 型がないときは、はっきり分かるものだけ。迷う語は出さない（間違った答えを教えないため）
  if (w.endsWith('する')) return /[^\p{Script=Hiragana}]/u.test(suruStem(w)) ? ok('s') : null;   // 確認する・腹落ちする（こする・かする は五段のことがある）
  if (isKuru(w, r, base.en)) return ok('k');
  if (w === 'くる') return null;                           // 来る？繰る？ 分からない
  if (!ROWS[last]) return null;
  const g = last === 'る' ? ruGroup(w, r) : '5';
  return g ? ok(g) : null;
}

/** カ変（来る）：来る そのもの、〜て来る・〜でくる、読みが「…くる」の 〜来る、意味が come の くる。出来る（できる）は含めない */
function isKuru(w, r, en) {
  if (w === '来る' || /[てで](来る|くる)$/.test(w)) return true;
  if (w.endsWith('来る')) return r.endsWith('くる') && !r.endsWith('できる');
  return w === 'くる' && /\bcome/i.test(en || '');
}

/** る で終わる動詞の段：例外 → 漢字1字＋る → 直前のかな（なければ読み） */
export function ruGroup(w, r = '') {
  if (GODAN_RU.some(x => w.endsWith(x))) return '5';
  if (ICHI_KANJI.some(x => w.endsWith(x))) return '1';
  let prev = w.slice(-2, -1);
  if (/\p{Script=Han}|々/u.test(prev)) {
    if (!r.endsWith('る')) return null;
    prev = r.slice(-2, -1);
  }
  return ROW_I.includes(prev) || ROW_E.includes(prev) ? '1' : '5';
}

/** 例文の枠（＿ に答えが入る）。空ならラベルだけ出す */
export function frameOf(word, form) {
  if (form === 'group' || form === 'agroup') return '';
  if (word.mine) return { te: '＿、…', ta: 'もう＿。', nai: '＿と、困る。', pot: '一人で＿？', nd: '実は、＿。', ndta: '実は、＿。', and: '実は、＿。', andta: '実は、＿。' }[form] || '';
  const o = word.o || '';
  if (form === 'nd' || form === 'and' || form === 'andta') return `実は、${o}＿。`;
  if (form === 'ndta') return `実は、もう${o}＿。`;
  if (!isVerb(word.g)) return form === 'ate' ? `${o}＿、…` : `${o}＿。`;
  if (form === 'pot') return `一人で${o}＿？`;
  if (form === 'te') return word.n ? `${o}＿、…` : `${o}＿ください。`;
  if (form === 'ta') return `もう${o}＿。`;
  if (form === 'nai') return `${o}＿と、困る。`;
  if (form === 'pass') return word.p || '部長に＿。';
  if (form === 'caus') return `部下に${o}＿。`;
  return '';
}

/** この語で出せる形 */
export function formsFor(word) {
  if (!isVerb(word.g)) return ADJ_FORMS;
  // 可能形：自然に起きること（届く・経つ）、ある、知る（知れる は別の意味）は出さない
  return VERB_FORMS.filter(f => !(f === 'pass' && word.v) && !(f === 'caus' && word.n) && !(f === 'pot' && (word.n || word.x || isAru(word.w))));
}

/** 単語ごとの読み上げる文（語そのもの＋すべての答えの形）と、その読み（かな）。
 *  tools/export_katsuyo_words.mjs が data/katsuyo-words.json に書き出し、PC の音声ツールが読む */
export function audioTexts(words = BASE_WORDS) {
  return words.map(word => {
    const seen = new Map();
    const add = (t, yomi) => { if (t && !seen.has(t)) seen.set(t, yomi); };
    add(word.w, word.r || '');
    for (const f of formsFor(word)) {
      if (f === 'group' || f === 'agroup') continue;
      add(conj(word, f), word.r ? conj({ ...word, w: word.r }, f) : '');
    }
    return { w: word.w, r: word.r || '', texts: [...seen].map(([t, yomi]) => ({ t, yomi })) };
  });
}

/* ============================== 画面 ============================== */

const KA_DIR = 'data/katsuyo-audio/';          // AivisSpeech で作った音声（基本語。公開してよい内容だけ）
const KA_CACHE = 'grass-audio-katsuyo';

const ROUND = 10;
const LIMIT_S = 8;                       // この秒数より速いほど＋点（時間切れはなし）
const LIMIT_SAY_S = 12;                  // 「先に言う」のときは考える時間を足す
const AUTO_MS = 2500;                    // 正解のあと自動で次へ（「止めて読む」で止まる）
const BOX_W = [6, 3, 1.5, 0.7, 0.35];   // 箱ごとの出やすさ（間違えると箱 0 に戻る）

export function createKatsuyo({ app, esc, nav, store, todayStr, ICON, cards = () => [], say = null, canSay = () => null }) {
  const K = {
    tab: 'play',
    chips: ['て形', 'た形', 'ない形'],
    mine: true,
    say: false,     // 選択肢を見る前に、答えを言う（頭の中・声で）。正解のあと「言えた／言えなかった」を自分で付ける
    auto: true,     // 正解なら 2.5秒で自動的に次へ
    timed: true,    // 速さで＋点（タイマーの帯を出す）。オフなら時間を気にせず練習
    voice: true,    // 正解したら、その形を読み上げる（AivisSpeech の音声。なければ端末の日本語の声）
    clips: {},      // 文 → 音声ファイル名（data/katsuyo-audio/manifest.json）
    clipWords: {},  // 語 → 文 → ファイル名（同じ字で読みが違う文：出させる＝ださせる／でさせる）
    credit: '',
    cached: 0,
    dl: null,       // まとめてダウンロードの進み具合
    stats: {},      // `${w}|${form}` → { b, ok, ng, at }
    hist: {},       // form → [1,0,…]（最近 40 回）
    best: 0,
    days: {},       // 日付 → 問題数
    session: null,
  };
  let advanceTimer = null;

  /* ---------- 音声（単語ごとに PC で作ったファイル） ---------- */

  async function loadClips() {
    try {
      const res = await fetch(`${KA_DIR}manifest.json`, { cache: 'no-cache' });
      if (res.ok) { const m = await res.json(); K.clips = m.files || {}; K.clipWords = m.words || {}; K.credit = m.credit || ''; }
    } catch { /* 音声なし */ }
    await countClips(true);
  }

  async function countClips(prune = false) {
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open(KA_CACHE);
      const want = new Set(allClipNames());
      let n = 0;
      for (const req of await cache.keys()) {
        const name = decodeURIComponent(new URL(req.url).pathname.split('/').pop());
        if (want.has(name)) n += 1;
        else if (prune && want.size) await cache.delete(req);      // 作り直して使わなくなった音声
      }
      K.cached = n;
    } catch { /* キャッシュが使えない */ }
  }

  const allClipNames = () => [...new Set([...Object.values(K.clips), ...Object.values(K.clipWords).flatMap(m => Object.values(m))])];
  const clipTotal = () => allClipNames().length;
  let player = null, playerUrl = null;

  /** 音声ファイルがあればそれを、なければ端末の日本語の声で読む */
  async function playText(t, w = '') {
    const f = K.clipWords[w]?.[t] || K.clips[t];
    if (f) {
      try {
        const res = await fetch(KA_DIR + encodeURIComponent(f));
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (player) player.pause();
        if (playerUrl) URL.revokeObjectURL(playerUrl);
        playerUrl = URL.createObjectURL(blob);
        player = new Audio(playerUrl);
        await player.play();
        return true;
      } catch { /* オフラインでまだ入っていない など → 端末の声へ */ }
    }
    return say ? say(t) : false;
  }

  async function downloadClips() {
    const names = allClipNames();
    if (!names.length || K.dl?.running) return;
    K.dl = { running: true, done: 0, total: names.length, failed: 0 };
    render();
    const cache = 'caches' in window ? await caches.open(KA_CACHE) : null;
    for (const name of names) {
      const url = KA_DIR + encodeURIComponent(name);
      try {
        if (!(cache && await cache.match(url))) {
          const res = await fetch(url);
          if (!res.ok) throw new Error(String(res.status));
          if (cache && !(await cache.match(url))) await cache.put(url, res.clone());
          await res.arrayBuffer();
        }
      } catch { K.dl.failed += 1; }
      K.dl.done += 1;
      if (K.dl.done % 20 === 0) render();
    }
    K.dl.running = false;
    await countClips();
    render();
  }

  async function load() {
    loadClips();                                   // 起動を待たせない
    const d = await store.get('meta', 'katsuyo');
    if (d && typeof d === 'object') {
      K.stats = d.stats || {}; K.hist = d.hist || {}; K.best = d.best || 0; K.days = d.days || {};
      if (Array.isArray(d.chips) && d.chips.length) K.chips = d.chips.filter(c => CHIPS.includes(c));
      if (typeof d.mine === 'boolean') K.mine = d.mine;
      if (typeof d.say === 'boolean') K.say = d.say;
      if (typeof d.auto === 'boolean') K.auto = d.auto;
      if (typeof d.timed === 'boolean') K.timed = d.timed;
      if (typeof d.voice === 'boolean') K.voice = d.voice;
    }
  }
  const save = () => store.put('meta', { stats: K.stats, hist: K.hist, best: K.best, days: pruneDays(K.days), chips: K.chips, mine: K.mine, say: K.say, auto: K.auto, timed: K.timed, voice: K.voice }, 'katsuyo');
  const pruneDays = d => Object.fromEntries(Object.entries(d).sort().slice(-60));

  const myWords = () => {
    const seen = new Set(BANK.map(b => b.w));
    const out = [];
    for (const c of cards() || []) {
      const x = wordFromCard(c);
      if (x && !seen.has(x.w)) { seen.add(x.w); out.push(x); }
    }
    return out;
  };

  /* ---------- 出題 ---------- */

  function buildRound(only = null) {
    const forms = new Set(Object.keys(FORMS).filter(f => K.chips.includes(FORMS[f].chip)));
    let pairs;
    if (only) pairs = only;
    else {
      const words = [...BANK, ...(K.mine ? myWords() : [])];
      pairs = [];
      for (const word of words) for (const f of formsFor(word)) if (forms.has(f)) pairs.push({ word, form: f });
    }
    const weight = ({ word, form }) => {
      const s = K.stats[`${word.w}|${form}`];
      let x = s ? BOX_W[Math.min(s.b, 4)] : 3;
      if (word.mine) x *= 1.5;
      if (form === 'group' || form === 'agroup') x *= trapNote(word) ? 1.4 : 0.6;
      return x;
    };
    const picked = [];
    const used = new Set();
    const pool = pairs.slice();
    while (picked.length < Math.min(ROUND, pairs.length) && pool.length) {
      const avail = pool.filter(p => !used.has(p.word.w));
      const from = avail.length ? avail : pool;
      const total = from.reduce((t, p) => t + weight(p), 0);
      let r = Math.random() * total, k = 0;
      while (k < from.length - 1 && (r -= weight(from[k])) > 0) k++;
      const p = from[k];
      picked.push(p); used.add(p.word.w);
      pool.splice(pool.indexOf(p), 1);
    }
    return picked.map(p => ({ ...p, ...makeOptions(p.word, p.form) }));
  }

  function start(only = null) {
    clearTimeout(advanceTimer);
    const items = buildRound(only);
    if (!items.length) return;
    K.session = { items, i: 0, choice: null, shown: !K.say, hold: false, t0: Date.now(), score: 0, streak: 0, maxStreak: 0, results: [], done: false };
    render();
  }

  /** 語×形 の結果を残す（箱・正解率・苦手） */
  function record(x, ok) {
    const key = `${x.word.w}|${x.form}`;
    const st = K.stats[key] || { b: 0, ok: 0, ng: 0 };
    K.stats[key] = { b: ok ? Math.min(st.b + 1, 4) : 0, ok: st.ok + (ok ? 1 : 0), ng: st.ng + (ok ? 0 : 1), at: Date.now() };
    K.hist[x.form] = (K.hist[x.form] || []).concat(ok ? 1 : 0).slice(-40);
  }

  function autoNext(s) {
    if (!K.auto) return;
    const at = s.i;
    advanceTimer = setTimeout(() => { if (K.session === s && s.i === at && !s.hold && location.hash.startsWith('#/katsuyo')) next(); }, AUTO_MS);
  }

  async function pick(v) {
    const s = K.session;
    if (!s || s.choice != null || s.done) return;
    const x = s.items[s.i];
    const sec = (Date.now() - s.t0) / 1000;
    const ok = v === x.answer;
    s.choice = v;
    const lim = K.say ? LIMIT_SAY_S : LIMIT_S;
    const bonus = ok && K.timed ? Math.max(0, Math.round(((lim - sec) / lim) * 5)) : 0;
    const pts = ok ? 10 + bonus : 0;
    s.streak = ok ? s.streak + 1 : 0;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
    s.score += pts;
    s.results.push({ word: x.word, form: x.form, ok, sec, chose: x.options[v], right: x.options[x.answer], bonus, pts });
    // 先に言うモードで選べたときは、言えたかどうかを聞いてから記録する（選べても言えなかった語を戻すため）
    s.self = ok && K.say ? 'ask' : null;
    if (!s.self) record(x, ok);
    K.days[todayStr()] = (K.days[todayStr()] || 0) + 1;
    render();
    if (ok && K.voice) sayForm(x);
    await save();
    if (ok && !s.self) autoNext(s);
  }

  /** 答えの形を読み上げる（グループの問題は語そのもの） */
  function sayForm(x) {
    playText(x.form === 'group' || x.form === 'agroup' ? x.word.w : x.options[x.answer], x.word.w).catch(() => {});
  }

  async function selfCheck(said) {
    const s = K.session;
    if (!s || s.self !== 'ask') return;
    const x = s.items[s.i];
    const r = s.results[s.results.length - 1];
    r.said = said;
    record(x, said);
    s.self = 'done';
    if (said) { await save(); return next(); }
    s.score -= r.pts; r.pts = 0;
    s.streak = 0;
    s.hold = true;
    render();
    await save();
  }

  async function next() {
    const s = K.session;
    if (!s) return;
    clearTimeout(advanceTimer);
    if (s.i + 1 >= s.items.length) {
      s.done = true;
      if (s.score > K.best) { s.newBest = true; K.best = s.score; }
      await save();
    } else Object.assign(s, { i: s.i + 1, choice: null, shown: !K.say, hold: false, self: null, t0: Date.now() });
    render();
  }

  /* ---------- 描画 ---------- */

  function render() {
    if (!location.hash.startsWith('#/katsuyo')) return;
    const s = K.session;
    let body;
    if (s && !s.done) body = questionView(s);
    else if (s && s.done) body = endView(s);
    else body = K.tab === 'rules' ? rulesView() : homeView();
    const tabs = !s || s.done ? `<div class="seg" role="tablist">${[['play', 'ドリル'], ['rules', 'ルール図']]
      .map(([k, l]) => `<button class="seg-btn" role="tab" aria-selected="${K.tab === k}" data-act="kt-tab" data-v="${k}">${l}</button>`).join('')}</div>` : '';
    app.innerHTML = `
      <div class="screen">
        <div class="scroll">
          <header class="top">
            <div><p class="date">て・た・ない・形容詞・受け身・使役・可能・んです</p><h1>活用ドリル</h1></div>
            ${s && !s.done ? `<button class="text-btn" data-act="kt-quit">やめる</button>` : ''}
          </header>
          ${tabs}
          <main class="home katsuyo">${body}</main>
        </div>
        ${nav('katsuyo')}
      </div>`;
  }

  const acc = f => { const h = K.hist[f] || []; return h.length ? Math.round((h.reduce((a, b) => a + b, 0) / h.length) * 100) : null; };
  const chipAcc = c => {
    const fs = Object.keys(FORMS).filter(f => FORMS[f].chip === c);
    const h = fs.flatMap(f => K.hist[f] || []);
    return h.length ? { p: Math.round((h.reduce((a, b) => a + b, 0) / h.length) * 100), n: h.length } : null;
  };

  function homeView() {
    const mine = myWords();
    const chips = CHIPS.map(c => `<button class="chip" aria-pressed="${K.chips.includes(c)}" data-act="kt-chip" data-v="${esc(c)}">${esc(c)}</button>`).join('');
    const bars = CHIPS.map(c => {
      const a = chipAcc(c);
      return `<div class="kt-bar"><span class="l">${esc(c)}</span><span class="track"><i style="width:${a ? a.p : 0}%" class="${a && a.p < 70 ? 'low' : ''}"></i></span><span class="p">${a ? `${a.p}%` : '—'}</span></div>`;
    }).join('');
    const weak = Object.entries(K.stats).filter(([, v]) => v.b === 0 && v.ng > 0).sort((a, b) => b[1].ng - a[1].ng || b[1].at - a[1].at).slice(0, 6);
    const allWords = [...BANK, ...mine];
    const weakRows = weak.map(([k]) => {
      const [w, f] = k.split('|');
      const word = allWords.find(x => x.w === w);
      if (!word || !FORMS[f]) return '';
      const rp = rulePath(word, f);
      return `<li><span class="kt-w">${esc(w)}</span><span class="kt-f">${esc(FORMS[f].label)}</span><b class="fam-${rp.fam}">${esc(conj(word, f))}</b></li>`;
    }).join('');
    const today = K.days[todayStr()] || 0;
    return `
      <section class="kt-hero">
        <p class="kt-lead">10問 · ${K.timed ? '速く選ぶほど＋点 · ' : ''}間違えた形ほど次にまた出ます</p>
        <div class="kt-chips" role="group" aria-label="練習する形">${chips}</div>
        <button class="chip toggle" aria-pressed="${K.mine}" data-act="kt-mine">自分のカードも混ぜる（${mine.length}語）</button>
        <div class="kt-chips" role="group" aria-label="進め方">
          <button class="chip" aria-pressed="${K.say}" data-act="kt-set" data-v="say">選ぶ前に答えを言う</button>
          <button class="chip" aria-pressed="${K.auto}" data-act="kt-set" data-v="auto">正解なら自動で次へ</button>
          <button class="chip" aria-pressed="${K.timed}" data-act="kt-set" data-v="timed">速さで＋点</button>
          <button class="chip" aria-pressed="${K.voice}" data-act="kt-set" data-v="voice">正解を読み上げ</button>
        </div>
        ${clipLine()}
        <button class="primary ink kt-start" data-act="kt-start" ${K.chips.length ? '' : 'disabled'}>スタート</button>
        <p class="kt-meta">今日 ${today}問 · ベスト ${K.best}点</p>
      </section>
      <section class="kt-panel"><h2>形ごとの正解率（最近 40 問）</h2>${bars}</section>
      ${weakRows ? `<section class="kt-panel"><div class="kt-head"><h2>苦手（最近まちがえた）</h2><button class="text-btn" data-act="kt-weak">これだけ練習</button></div><ul class="kt-weak">${weakRows}</ul></section>` : ''}`;
  }

  /** 音声の状態：まとめて入れるボタン／声がないときの案内 */
  function clipLine() {
    if (!K.voice) return '';
    const total = clipTotal();
    if (K.dl?.running) return `<p class="kt-note">音声を入れています… ${K.dl.done} / ${K.dl.total}</p>`;
    if (total) {
      const left = total - K.cached;
      const fail = K.dl?.failed ? `（${K.dl.failed}個は入らなかったので、もう一度）` : '';
      return left > 0
        ? `<button class="text-btn kt-dl" data-act="kt-dl">音声をまとめて入れる（あと ${left}・Wi-Fi で）</button>${fail ? `<p class="kt-note">${fail}</p>` : ''}`
        : `<p class="kt-note">音声：${total}個 すべてスマホに入っています（オフラインでも鳴ります）</p>`;
    }
    return canSay() === false ? '<p class="kt-note">まだドリル用の音声がなく、このスマホには日本語の読み上げ音声もないため、音は出ません。</p>' : '';
  }

  function wordHead(word) {
    return `<div class="kt-word"><span class="w">${esc(word.w)}</span><span class="r">${word.r && word.r !== word.w ? esc(word.r) + ' · ' : ''}${esc(word.en || '')}${word.mine ? ' · <span class="mine">自分のカード</span>' : ''}</span></div>`;
  }

  function questionView(s) {
    const x = s.items[s.i];
    const F = FORMS[x.form];
    const answered = s.choice != null;
    const frame = frameOf(x.word, x.form);
    const ok = answered && s.choice === x.answer;
    const rp = rulePath(x.word, x.form);
    const right = x.options[x.answer];
    const two = x.options.length <= 3;
    const opts = x.options.map((o, i) => {
      const cls = answered ? (i === x.answer ? 'right' : i === s.choice ? 'wrong' : 'dim') : '';
      return `<button class="kt-opt ${cls}" data-act="kt-pick" data-v="${i}" ${answered ? 'disabled' : ''}>${esc(o)}</button>`;
    }).join('');
    const filled = frame ? frame.replace('＿', `<b class="fam-${rp.fam}">${esc(x.form === 'group' || x.form === 'agroup' ? '' : right)}</b>`) : '';
    const blank = frame ? esc(frame).replace('＿', '<span class="kt-blank">？</span>') : '';
    const fb = answered ? `
      <div class="kt-fb ${ok ? 'ok' : 'ng'}" role="status">
        <p class="kt-verdict">${verdict(s, ok, right)}</p>
        <div class="kt-path">${say || clipTotal() ? `<button class="icon-btn kt-play" data-act="kt-play" aria-label="読み上げ">${ICON.speaker}</button>` : ''}<span>${esc(x.word.w)}</span><span class="kt-rule fam-${rp.fam}">${esc(rp.rule)}</span>${x.form === 'group' || x.form === 'agroup' ? '' : `<b>${esc(right)}</b>`}</div>
        ${filled ? `<p class="kt-sent">${filled.split(/(<b[^>]*>.*?<\/b>)/).map((p, i) => (i % 2 ? p : esc(p))).join('')}</p>` : ''}
        ${rp.trap ? `<p class="kt-trap">⚠ ${esc(rp.trap)}</p>` : ''}
        ${ok ? '' : ruleRow(rp.fam, x.form, x.word)}
        ${s.self === 'ask'
          ? `<p class="kt-ask">選ぶ前に、この形を言えましたか？</p>
             <div class="grid2"><button class="outline quiet" data-act="kt-said" data-v="0">言えなかった</button><button class="primary ink kt-said" data-act="kt-said" data-v="1">言えた</button></div>`
          : ok && K.auto && !s.hold
            ? `<div class="kt-auto"><button class="text-btn" data-act="kt-hold">止めて読む</button><button class="outline quiet" data-act="kt-next">次へ<i style="animation-duration:${AUTO_MS}ms"></i></button></div>`
            : `<button class="primary ink" data-act="kt-next">${s.i + 1 >= s.items.length ? '結果を見る' : '次へ'}</button>`}
      </div>` : '';
    return `
      <div class="kt-top"><span>${s.i + 1} / ${s.items.length}</span><span>${s.score}点${s.streak > 1 ? ` · ${s.streak}連続` : ''}</span></div>
      ${answered || !K.timed ? '' : `<div class="kt-timer" aria-hidden="true"><i style="animation-duration:${K.say ? LIMIT_SAY_S : LIMIT_S}s"></i></div>`}
      <section class="kt-q">
        <p class="kt-form"><span>${esc(F.label)}</span><span class="en">${esc(F.en)}</span></p>
        ${wordHead(x.word)}
        ${blank && !answered ? `<p class="kt-frame">${blank}</p>` : ''}
      </section>
      ${s.shown || answered
        ? `<div class="kt-opts ${two ? 'col' : ''}">${opts}</div>`
        : `<div class="kt-say"><p>答えを言ってから（頭の中で・声に出して）</p><button class="primary ink" data-act="kt-show">選択肢を見る</button></div>`}
      ${fb}`;
  }

  const missed = r => !r.ok || r.said === false;

  function verdict(s, ok, right) {
    if (!ok) return `答え：${esc(right)}`;
    const r = s.results[s.results.length - 1];
    if (r.said === false) return `言えなかった → もう一度出します：${esc(right)}`;
    const pts = r.pts ? ` ＋${r.pts}` : '';
    return s.self === 'ask' ? `選べました${pts}` : `正解${pts}${s.streak > 1 ? ` · ${s.streak}連続` : ''}`;
  }

  function endView(s) {
    const n = s.results.length, ok = s.results.filter(r => !missed(r)).length;
    const miss = s.results.filter(missed);
    const rows = miss.map(r => {
      const rp = rulePath(r.word, r.form);
      return `<li><div><span class="kt-w">${esc(r.word.w)}</span><span class="kt-f">${esc(FORMS[r.form].label)}</span></div>
        <div class="kt-miss">${r.ok ? '言えなかった' : `<s>${esc(r.chose)}</s>`} → <b class="fam-${rp.fam}">${esc(r.right)}</b></div>
        <div class="kt-rule-s fam-${rp.fam}">${esc(rp.rule)}</div></li>`;
    }).join('');
    const avg = n ? (s.results.reduce((t, r) => t + r.sec, 0) / n).toFixed(1) : 0;
    return `
      <section class="kt-end">
        <p class="kt-score">${s.score}<small>点</small></p>
        <p class="kt-meta">${s.newBest ? 'ベスト更新！ · ' : `ベスト ${K.best}点 · `}正解 ${ok}/${n} · 最長 ${s.maxStreak}連続 · 平均 ${avg}秒</p>
      </section>
      ${rows ? `<section class="kt-panel"><h2>間違えたもの</h2><ul class="kt-misses">${rows}</ul></section>` : '<p class="kt-lead">全問正解。次は形を増やすか、受け身・使役を混ぜてみましょう。</p>'}
      ${miss.length ? `<button class="primary ink" data-act="kt-retry">間違えた ${miss.length}問だけもう一回</button>` : ''}
      <button class="${miss.length ? 'outline' : 'primary ink'}" data-act="kt-start">もう一回（10問）</button>
      <button class="text-btn" data-act="kt-home">形を選び直す</button>`;
  }

  /* ---------- ルール図 ---------- */

  const TE_ROWS = [
    { fam: 'tte', keys: ['う', 'つ', 'る'], te: 'って', ta: 'った', ex: '使って・待って・送って' },
    { fam: 'nde', keys: ['む', 'ぶ', 'ぬ'], te: 'んで', ta: 'んだ', ex: '読んで・呼んで・死んで' },
    { fam: 'ite', keys: ['く'], te: 'いて', ta: 'いた', ex: '書いて（⚠ 行く → 行って）' },
    { fam: 'ite', keys: ['ぐ'], te: 'いで', ta: 'いだ', ex: '急いで・防いで' },
    { fam: 'shite', keys: ['す'], te: 'して', ta: 'した', ex: '話して・出して' },
    { fam: 'ichi', keys: ['一段 る'], te: 'て', ta: 'た', ex: '食べて・見て・決めて' },
    { fam: 'irr', keys: ['する', '来る'], te: 'して／きて', ta: 'した／きた', ex: '確認して・来て（きて）' },
  ];

  function ruleRow(fam, form, word = null) {
    if (form === 'pot') return `${danStrip('pot')}<div class="kt-map kt-mini">${aRowTable('pot')}</div>`;
    if (form === 'nd' || form === 'ndta' || form === 'and' || form === 'andta') return ndFormula();
    if (form === 'te' || form === 'ta') {
      const r = TE_ROWS.filter(x => x.fam === fam);
      if (!r.length) return '';
      return `<div class="kt-map kt-mini">${r.map(x => teRow(x, form === 'ta')).join('')}</div>`;
    }
    if (form === 'nai' || form === 'pass' || form === 'caus') return `${danStrip(form)}<div class="kt-map kt-mini">${aRowTable(form)}</div>`;
    if (form === 'group' || form === 'agroup') return form === 'group' ? groupTree(word) : adjTable();
    return adjTable();
  }

  const teRow = (x, ta) => `
    <div class="kt-mrow fam-${x.fam}">
      <span class="keys">${x.keys.map(k => `<i>${esc(k)}</i>`).join('')}</span>
      <span class="arr">→</span>
      <b>${esc(ta ? x.ta : x.te)}</b>
      <span class="ex">${esc(x.ex)}</span>
    </div>`;

  function aRowTable(only = null) {
    const cols = [['nai', 'ない'], ['pass', '受け身'], ['caus', '使役'], ['pot', '可能']].filter(([k]) => !only || k === only);
    const rows = only === 'pot' ? [
      ['erow', '五段', '書く → 書<u>け</u>', ['', '', '', '書ける']],
      ['erow', '五段 う', '言う → 言<u>え</u>', ['', '', '', '言える']],
      ['ichi', '一段', '食べる → 食べ', ['', '', '', '食べられる']],
      ['irr', 'する', '確認する', ['', '', '', '確認できる']],
      ['irr', '来る', 'くる', ['', '', '', 'こられる']],
    ] : [
      ['arow', '五段', '書く → 書<u>か</u>／<u>け</u>', ['書かない', '書かれる', '書かせる', '書ける']],
      ['arow', '五段 う', '言う → 言<u>わ</u>／<u>え</u>', ['言わない', '言われる', '言わせる', '言える']],
      ['ichi', '一段', '食べる → 食べ', ['食べない', '食べられる', '食べさせる', '食べられる']],
      ['irr', 'する', '確認する', ['確認しない', '確認される', '確認させる', '確認できる']],
      ['irr', '来る', 'くる', ['こない', 'こられる', 'こさせる', 'こられる']],
    ];
    const idx = cols.map(([k]) => ['nai', 'pass', 'caus', 'pot'].indexOf(k));
    return `
      <table class="kt-table">
        <thead><tr><th></th>${cols.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(([fam, g, stem, out]) => `<tr class="fam-${fam}"><th><span class="g">${g}</span><span class="s">${stem}</span></th>${idx.map(i => `<td>${esc(out[i])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
  }

  /** かなのタイル。key 番目の字に色と「〇段」 */
  function tiles(kana, key) {
    return `<span class="kt-kana">${[...kana].map((c, i) => i === key
      ? `<i class="hl">${esc(c)}<small>${esc(danOf(c))}</small></i>`
      : `<i>${esc(c)}</i>`).join('')}</span>`;
  }

  /** 五段？一段？の判断を図にする。word を渡すと、その語の通り道だけ明るく、決め手の段にその語の読みを出す */
  function groupTree(word = null) {
    const steps = [
      { q: 'する・来る？', yes: 'はい', leaf: ['irr', '不規則', 'する・来る・確認する'], down: 'いいえ' },
      { q: '最後の字は<br>「る」？', yes: 'いいえ', leaf: ['g5', '五段', '書く・読む・話す・待つ'], down: 'はい' },
      { q: 'る の前の音は？', yes: 'あ・う・お段', leaf: ['g5', '五段', `${tiles('とる', 0)}${tiles('つくる', 1)}${tiles('おわる', 1)}`],
        down: `い段・え段 ${tiles('みる', 0)}${tiles('たべる', 1)}` },
      { q: '例外の語？', yes: 'はい', leaf: ['g5', '五段（例外）', '帰る・入る・知る・要る・切る・走る・限る・減る'], down: 'いいえ' },
    ];
    let d = -1;
    if (word) {
      const { w, g } = word;
      d = g === 's' || g === 'k' ? 0 : g === '1' ? 4 : !w.endsWith('る') ? 1 : GODAN_RU.some(x => w.endsWith(x)) ? 3 : 2;
    }
    const st = (i, part) => (d < 0 ? '' : part === 'q' ? (i <= d ? 'on' : 'off') : part === 'down' ? (i < d ? 'on' : 'off') : i === d ? 'on' : 'off');
    const r = word?.r || '';
    const mine = word && r.endsWith('る') && r.length > 1 ? `<span class="kt-this">${esc(word.w)}：${tiles(r, r.length - 2)}</span>` : '';
    const html = steps.map((x, i) => `
      <div class="kt-tstep">
        <div class="kt-tq ${st(i, 'q')}">${x.q}</div>
        <div class="kt-tarr fam-${x.leaf[0]} ${st(i, 'leaf')}"><span>${x.yes}</span></div>
        <div class="kt-tleaf fam-${x.leaf[0]} ${st(i, 'leaf')}"><b>${x.leaf[1]}</b><span class="ex">${x.leaf[2]}</span>${d === i ? mine : ''}</div>
      </div>
      <div class="kt-tdown ${st(i, 'down')}"><span>${x.down}</span></div>`).join('');
    return `
      <div class="kt-tree ${d < 0 ? '' : 'focus'}">
        <div class="kt-tstart">辞書形から ↓</div>
        ${html}
        <div class="kt-tleaf kt-tend fam-ichi ${d < 0 ? '' : d === 4 ? 'on' : 'off'}"><b>一段</b><span class="ex">見る・食べる・決める・起きる</span>${d === 4 ? mine : ''}</div>
      </div>`;
  }

  /** 五段の「段の移動」：書く の く が か・き・け・こ に動く */
  function danStrip(form = null) {
    const cols = [
      ['か', 'ない<br>れる<br>せる', 'arow', ['nai', 'pass', 'caus']],
      ['き', 'ます', '', []],
      ['く', '辞書形', 'base', []],
      ['け', 'る<br>可能', 'erow', ['pot']],
      ['こ', 'う<br>意向', '', []],
    ];
    return `
      <div class="kt-dan ${form ? 'focus' : ''}">
        <span class="stem">書</span>
        ${cols.map(([k, l, fam, fs]) => `<span class="k ${fam ? 'fam-' + fam : ''} ${form && fs.includes(form) ? 'on' : form ? 'off' : ''}"><b>${k}</b><small>${l}</small></span>`).join('')}
      </div>`;
  }

  /** 〜んです：普通形＋んです。な形容詞・名詞は な が入る */
  const ndFormula = () => `
    <div class="kt-nd">
      <div class="f fam-nd"><span class="box">普通形</span><span class="plus">＋</span><b>んです</b><small>行くんです・行ったんです・行かないんです</small></div>
      <div class="f fam-iadj"><span class="box">い形容詞</span><span class="plus">＋</span><b>んです</b><small>高いんです・高かったんです</small></div>
      <div class="f fam-naadj"><span class="box">な形容詞・名詞</span><span class="plus">＋</span><b class="na">な</b><span class="plus">＋</span><b>んです</b><small>簡単なんです・会議なんです（過去：簡単だったんです）</small></div>
    </div>`;

  const adjTable = () => `
    <table class="kt-table">
      <thead><tr><th></th><th>否定</th><th>過去</th><th>過去の否定</th><th>て形</th></tr></thead>
      <tbody>
        <tr class="fam-iadj"><th><span class="g">い</span><span class="s">高<u>い</u></span></th><td>高くない</td><td>高かった</td><td>高くなかった</td><td>高くて</td></tr>
        <tr class="fam-iadj"><th><span class="g">⚠ いい</span><span class="s">→ よ</span></th><td>よくない</td><td>よかった</td><td>よくなかった</td><td>よくて</td></tr>
        <tr class="fam-naadj"><th><span class="g">な</span><span class="s">簡単</span></th><td>簡単じゃない</td><td>簡単だった</td><td>簡単じゃなかった</td><td>簡単で</td></tr>
        <tr class="fam-naadj"><th><span class="g">⚠ な</span><span class="s">きれい</span></th><td>きれいじゃない</td><td>きれいだった</td><td>きれいじゃなかった</td><td>きれいで</td></tr>
      </tbody>
    </table>
    <p class="kt-note">きれい・嫌い・有名 は「い」で終わっても な形容詞（きれいな部屋）。</p>`;

  function rulesView() {
    return `
      <section class="kt-panel">
        <h2>て形・た形：語の最後の字で決まる</h2>
        <p class="kt-chant">うつる → って ・ むぶぬ → んで ・ く → いて ・ ぐ → いで ・ す → して</p>
        <div class="kt-map">${TE_ROWS.map(x => teRow(x, false)).join('')}</div>
        <p class="kt-note">た形は て → た、で → だ にするだけ（書いて → 書いた・読んで → 読んだ）。</p>
      </section>
      <section class="kt-panel">
        <h2>ない・受け身・使役は「あ段」、可能は「え段」</h2>
        ${danStrip()}
        <div class="kt-scroll">${aRowTable()}</div>
        <p class="kt-note">使役の よくある間違い：書<s>かさせる</s> → 書かせる（さ を入れない）。<br>〜させていただきます ＝ 丁寧に「〜します」：確認させていただきます。<br>一段の可能は 受け身と同じ形（食べられる）。ら抜き（食べれる）は話し言葉。</p>
      </section>
      <section class="kt-panel">
        <h2>五段？一段？ 上から順に</h2>
        ${groupTree()}
      </section>
      <section class="kt-panel">
        <h2>〜んです：説明・理由</h2>
        ${ndFormula()}
        <p class="kt-note">「実は、明日休むんです」のように、事情や理由を伝えるときの言い方。かたい文章では 〜のです。</p>
      </section>
      <section class="kt-panel">
        <h2>い形容詞・な形容詞</h2>
        <div class="kt-scroll">${adjTable()}</div>
      </section>
      ${K.credit ? `<p class="kt-note">${esc(K.credit)}</p>` : ''}`;
  }

  /* ---------- 操作 ---------- */

  const actions = {
    'kt-tab': el => { K.tab = el.dataset.v; K.session = null; render(); },
    'kt-chip': async el => {
      const c = el.dataset.v;
      K.chips = K.chips.includes(c) ? K.chips.filter(x => x !== c) : CHIPS.filter(x => x === c || K.chips.includes(x));
      render(); await save();
    },
    'kt-mine': async () => { K.mine = !K.mine; render(); await save(); },
    'kt-set': async el => { const k = el.dataset.v; if (['say', 'auto', 'timed', 'voice'].includes(k)) { K[k] = !K[k]; render(); await save(); } },
    'kt-said': el => selfCheck(el.dataset.v === '1'),
    'kt-dl': () => downloadClips(),
    'kt-play': () => { const x = K.session?.items[K.session.i]; if (x) sayForm(x); },
    'kt-show': () => { if (K.session) { K.session.shown = true; render(); } },
    'kt-hold': () => { if (K.session) { K.session.hold = true; clearTimeout(advanceTimer); render(); } },
    'kt-start': () => start(),
    'kt-pick': el => pick(Number(el.dataset.v)),
    'kt-next': () => next(),
    'kt-quit': () => { clearTimeout(advanceTimer); K.session = null; render(); },
    'kt-home': () => { K.session = null; K.tab = 'play'; render(); },
    'kt-retry': () => {
      const miss = K.session?.results.filter(missed).map(r => ({ word: r.word, form: r.form })) || [];
      if (miss.length) start(miss);
    },
    'kt-weak': () => {
      const words = [...BANK, ...myWords()];
      const weak = Object.entries(K.stats).filter(([, v]) => v.b === 0 && v.ng > 0).sort((a, b) => b[1].ng - a[1].ng).slice(0, ROUND)
        .map(([k]) => { const [w, f] = k.split('|'); const word = words.find(x => x.w === w); return word && FORMS[f] ? { word, form: f } : null; }).filter(Boolean);
      if (weak.length) start(weak);
    },
  };

  return {
    render, actions, load,
    todayCount: () => K.days[todayStr()] || 0,
    playing: () => !!(K.session && !K.session.done),
  };
}
