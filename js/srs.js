// 復習のルール（03_設定 に合わせる）
//   復習段階 s は「今の間隔」の番号：間隔 = intervals[s]
//   できた   → s+1。最後の間隔を越えたら「定着」
//   あいまい → 3日後（段階はそのまま）
//   忘れた   → 翌日、段階は 0 に戻る

export const DEFAULT_INTERVALS = [1, 3, 7, 14, 30, 60];
export const RESULT_LABEL = { good: '正解', partial: '部分正解', again: '不正解' };
export const ACTIVE = ['復習中', '使える'];

export function todayStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return todayStr(dt);
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

export function stageOf(card) {
  const s = Number(card['復習段階']);
  return Number.isFinite(s) && s >= 0 ? Math.floor(s) : 0;
}

/** 評価後の進捗を返す（カードは変更しない） */
export function nextProgress(card, result, { today = todayStr(), intervals = DEFAULT_INTERVALS, used = false } = {}) {
  const s = stageOf(card);
  let stage = s;
  let next;
  let status = card['状態'] === '使える' ? '使える' : '復習中';

  if (result === 'good') {
    stage = s + 1;
    if (stage >= intervals.length) {
      status = '定着';
      stage = intervals.length;
      next = '';
    } else {
      next = addDays(today, intervals[stage]);
    }
  } else if (result === 'partial') {
    next = addDays(today, 3);
  } else {
    stage = 0;
    next = addDays(today, 1);
  }
  if (used && status !== '定着') status = '使える';

  return {
    '状態': status,
    '次回復習日': next,
    '復習段階': stage,
    '最終結果': RESULT_LABEL[result],
  };
}

/** 評価ボタンの下に出す「いつ戻ってくるか」 */
export function previewLabel(card, result, intervals = DEFAULT_INTERVALS) {
  const s = stageOf(card);
  if (result === 'again') return '明日';
  if (result === 'partial') return '3日後';
  const n = s + 1;
  if (n >= intervals.length) return '定着';
  return `${intervals[n]}日後`;
}

export function isDue(card, today = todayStr()) {
  if (!ACTIVE.includes(card['状態'])) return false;
  const d = card['次回復習日'];
  return !d || d <= today;
}

const PRIO = { A: 0, B: 1, C: 2 };
/** 受信箱の並び：優先度順 → 古い順 */
export function inboxOrder(a, b) {
  const pa = PRIO[a['優先度']] ?? 3;
  const pb = PRIO[b['優先度']] ?? 3;
  if (pa !== pb) return pa - pb;
  return String(a['登録日時']).localeCompare(String(b['登録日時'])) || String(a.ID).localeCompare(String(b.ID));
}

/** 今日のセッション：期限の来た復習＋受信箱からの新規（1日の上限まで） */
export function buildSession(cards, { today = todayStr(), newPerDay = 5, newDoneToday = 0, extraNew = 0 } = {}) {
  const due = cards.filter(c => isDue(c, today))
    .sort((a, b) => String(a['次回復習日']).localeCompare(String(b['次回復習日'])));
  const room = Math.max(0, newPerDay - newDoneToday) + extraNew;
  const fresh = cards.filter(c => c['状態'] === '受信箱').sort(inboxOrder).slice(0, room);
  return { due, fresh, queue: [...due, ...fresh] };
}

/** 次回復習日の表示 */
export function nextLabel(card, today = todayStr()) {
  const st = card['状態'];
  if (st === '受信箱') return '未開始';
  if (st === '保留') return '保留中';
  if (st === '定着') return '—';
  const d = card['次回復習日'];
  if (!d) return '今日';
  const n = daysBetween(today, d);
  if (n <= 0) return '今日';
  if (n === 1) return '明日';
  return `${n}日後`;
}

/** 例文の中で表現が使われている部分を探す（活用形も少しだけ含める） */
export function findHighlight(sentence, expr) {
  if (!sentence || !expr) return null;
  const base = String(expr).replace(/^[～〜~]/, '').split(/[／/]/)[0].trim();
  if (!base) return null;
  const isKana = ch => /[ぁ-ゟ]/.test(ch);
  for (let len = base.length; len >= 1; len--) {
    const stem = base.slice(0, len);
    if (len < base.length && len < 2 && !/[一-鿿]/.test(stem)) break;
    const i = sentence.indexOf(stem);
    if (i < 0) continue;
    let end = i + stem.length;
    if (len < base.length) {
      let k = 0;
      while (end < sentence.length && k < 4 && isKana(sentence[end])) { end++; k++; }
    }
    return [i, end];
  }
  return null;
}
