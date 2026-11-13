// ふりがな（v1.18.0）
//   カードの「ふりがな」列・話すチャンクの furi に、語ごとの読みを書く：
//     親友=しんゆう、悩み=なやみ、打ち明けた=うちあけた
//   区切りは 、 , ； ; ｜ 改行 空白。「=」は全角「＝」でもよい。
//   文の中のその語にルビを付ける。読みはふだん隠しておき、語をタップするとその語だけ出る。
//   「ふ」ボタン（setAll）で、全部出したままにもできる（このスマホに保存）。
//   送りがなは読みと突き合わせて、漢字の上にだけ読みを付ける（打ち明けた → 打(う)ち明(あ)けた）。
//   活用した形にも合う：「打ち明けた」の行は「打ち明ける」にも付く（後ろのかなを外して探す）。
//
//   音声（tools/make_card_audio.py・make_audio.py）も同じ列を使い、エンジンが読み間違えた語だけ かなで読ませる。

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヶ]/;
const KANA = /[ぁ-ゖァ-ヺー]/;
const ALL_KEY = 'furiAll';
const KEEP_MS = 30 * 60 * 1000;        // タップで出した読みは、同じカード（文）の上で30分だけ覚える

const escHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const toHira = s => String(s).replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));

/** 「親友=しんゆう、悩み=なやみ」→ [{ w: '親友', r: 'しんゆう' }, …]（漢字のない語・読みのない語は捨てる） */
export function parseFuri(raw) {
  const out = [];
  const seen = new Set();
  String(raw ?? '').split(/[、,，;；|｜\n\r\t 　]+/).forEach(item => {
    const m = item.match(/^(.+?)[=＝](.+)$/);
    if (!m) return;
    const w = m[1].trim();
    const r = toHira(m[2].trim());
    if (!w || !r || !KANJI.test(w) || seen.has(w)) return;
    seen.add(w);
    out.push({ w, r });
  });
  return out;
}

/** 語の形のゆれ：後ろのかな（送りがな・活用語尾）を1文字ずつ外した形も、読みの後ろが同じなら候補にする */
export function variants(pairs) {
  const list = [];
  pairs.forEach(({ w, r }) => {
    list.push({ w, r, full: w });
    let s = w;
    let y = r;
    while (s.length > 1 && KANA.test(s[s.length - 1]) && !KANJI.test(s[s.length - 1])) {
      const tail = toHira(s[s.length - 1]);
      if (y[y.length - 1] !== tail) break;
      s = s.slice(0, -1);
      y = y.slice(0, -1);
      if (!y) break;
      if (KANJI.test(s[s.length - 1])) list.push({ w: s, r: y, full: w });
    }
  });
  // 長い語から先に当てる（「今日中」を「今日」より先に）
  // 同じ長さなら、書いたままの語を外した形より先に
  return list.sort((a, b) => b.w.length - a.w.length || (b.w === b.full) - (a.w === a.full));
}

/** 文を [文字列 | { w, r }] に分ける */
export function segment(text, pairs) {
  const s = String(text ?? '');
  if (!s || !pairs?.length) return s ? [s] : [];
  const vs = variants(pairs);
  const out = [];
  let plain = '';
  let i = 0;
  while (i < s.length) {
    const hit = vs.find(v => s.startsWith(v.w, i));     // 「その時」のように、かなで始まる語もある
    if (hit) {
      if (plain) { out.push(plain); plain = ''; }
      out.push({ w: hit.w, r: hit.r });
      i += hit.w.length;
    } else {
      plain += s[i];
      i += 1;
    }
  }
  if (plain) out.push(plain);
  return out;
}

/** 送りがなを読みと突き合わせる：打ち明けた / うちあけた → [['打','う'],['ち'],['明','あ'],['けた']]。合わなければ語全体に1つ */
export function align(w, r) {
  const runs = w.match(/[㐀-䶿一-鿿豈-﫿々〆ヶ]+|[^㐀-䶿一-鿿豈-﫿々〆ヶ]+/g) || [w];
  if (runs.length === 1) return [[w, r]];
  const re = new RegExp('^' + runs.map(x => (KANJI.test(x[0]) ? '(.+?)' : `(${toHira(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`)).join('') + '$');
  const m = toHira(r).match(re);
  if (!m) return [[w, r]];
  return runs.map((x, k) => (KANJI.test(x[0]) ? [x, m[k + 1]] : [x]));
}

/* ------------------------------ 表示 ------------------------------ */

const revealed = new Map();        // "ctx|語" → 出した時刻

function isOpen(key) {
  const t = revealed.get(key);
  if (!t) return false;
  if (Date.now() - t > KEEP_MS) { revealed.delete(key); return false; }
  return true;
}

/** 文を HTML にする（エスケープ済み）。ctx はカードやチャンクの ID（タップで出した読みを覚える単位） */
export function furiHtml(text, pairs, ctx = '') {
  return segment(text, pairs).map(seg => {
    if (typeof seg === 'string') return escHtml(seg);
    const key = `${ctx}|${seg.w}`;
    const inner = align(seg.w, seg.r).map(([base, rt]) =>
      (rt ? `<ruby>${escHtml(base)}<rt>${escHtml(rt)}</rt></ruby>` : escHtml(base))).join('');
    return `<span class="fw${isOpen(key) ? ' on' : ''}" data-fk="${escHtml(key)}" role="button" tabindex="0" aria-label="${escHtml(seg.w)}の読みを出す">${inner}</span>`;
  }).join('');
}

/** その語に読みがあるか（「ふ」ボタンを出すかどうか） */
export function hasFuri(text, pairs) {
  return segment(text, pairs).some(seg => typeof seg !== 'string');
}

export function allOn() {
  try { return localStorage.getItem(ALL_KEY) === '1'; } catch { return false; }
}

export function setAll(on) {
  try { localStorage.setItem(ALL_KEY, on ? '1' : '0'); } catch { /* 保存できなくても、今だけ切り替える */ }
  document.documentElement.classList.toggle('furi-all', !!on);
}

/** 「ふ」ボタン（全部の読みを出す／隠す） */
export function furiToggle() {
  const on = allOn();
  return `<button class="furi-btn" data-furi-all aria-pressed="${on}" aria-label="${on ? 'ふりがなを隠す' : 'ふりがなを全部出す'}">ふ</button>`;
}

/** 一度だけ呼ぶ：タップで読みを出す・「ふ」ボタン。ほかの操作（data-act）より先に受け取る */
export function initFuri(root = document) {
  document.documentElement.classList.toggle('furi-all', allOn());
  const onTap = e => {
    const all = e.target.closest?.('[data-furi-all]');
    if (all) {
      e.preventDefault();
      e.stopPropagation();
      setAll(!allOn());
      const on = allOn();
      document.querySelectorAll('[data-furi-all]').forEach(b => {
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', on ? 'ふりがなを隠す' : 'ふりがなを全部出す');
      });
      return;
    }
    const w = e.target.closest?.('.fw');
    if (!w || allOn()) return;
    e.preventDefault();
    e.stopPropagation();
    const key = w.dataset.fk;
    const open = !isOpen(key);
    if (open) revealed.set(key, Date.now()); else revealed.delete(key);
    root.querySelectorAll('.fw').forEach(x => { if (x.dataset.fk === key) x.classList.toggle('on', open); });
  };
  root.addEventListener('click', onTap, true);
  root.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('fw')) onTap(e);
  }, true);
}
