// Grass — 画面と操作
// 画面：#/today 今日・#/review 復習・#/done 完了・#/inbox 受信箱・#/search 検索・#/card/ID 詳細・#/settings 設定

import * as store from './store.js';
import * as srs from './srs.js';
import { syncNow, testConnection, cleanUrl, cleanToken } from './sync.js';
import { demoCards } from './demo.js';

const app = document.getElementById('app');

const DEFAULT_SETTINGS = { apiUrl: '', token: '', newPerDay: 5, rootFirst: true, demo: false };

const S = {
  cards: [],
  settings: { ...DEFAULT_SETTINGS },
  intervals: srs.DEFAULT_INTERVALS,
  sync: null,
  syncing: false,
  outbox: 0,
  log: [],
  daily: { date: srs.todayStr(), newDone: 0 },
  session: null,
  ui: {
    inboxTab: 'todo',
    skipped: [],
    search: { q: '', kind: 'すべて', status: 'すべて', tag: null, moreTags: false },
    detailPanels: {},
    connMsg: null,
  },
};

/* ============================== 小さな道具 ============================== */

const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const val = (card, key) => String(card?.[key] ?? '').trim();
const items = s => String(s ?? '').split('｜').map(x => x.trim()).filter(Boolean);
const byId = id => S.cards.find(c => c.ID === id);
const configured = () => !!(S.settings.apiUrl && S.settings.token);
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function mdLabel(str) {
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}月${Number(m[3])}日` : '';
}

function timeLabel(ms) {
  if (!ms) return '未同期';
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return srs.todayStr(d) === srs.todayStr() ? `今日 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

const ICON = {
  sync: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>',
  focus: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>',
  chevron: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  back: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  close: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  bulb: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V15h7v-1.1A6 6 0 0 0 12 3z"/></svg>',
  bag: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2"/><path d="M3.5 12.5h17"/></svg>',
  check: '<svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  search: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
  lock: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  home: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5L12 4l8 6.5V20h-5v-6H9v6H4z"/></svg>',
  inbox: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/></svg>',
  find: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
  gear: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
};

/* ============================== データの読み込み ============================== */

async function loadAll() {
  const [cards, settings, intervals, sync, outbox, log, daily] = await Promise.all([
    store.getAll('cards'),
    store.get('meta', 'settings'),
    store.get('meta', 'intervals'),
    store.get('meta', 'sync'),
    store.count('outbox'),
    store.getAll('log'),
    store.get('meta', 'daily'),
  ]);
  S.cards = cards;
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  S.intervals = Array.isArray(intervals) && intervals.length ? intervals : srs.DEFAULT_INTERVALS;
  S.sync = sync || null;
  S.outbox = outbox;
  const since = srs.addDays(srs.todayStr(), -6);
  S.log = log.filter(e => e.date >= since);
  const today = srs.todayStr();
  S.daily = daily && daily.date === today ? daily : { date: today, newDone: 0 };
}

async function saveSettings(patch) {
  S.settings = { ...S.settings, ...patch };
  await store.put('meta', S.settings, 'settings');
}

async function bumpNewDone(n = 1) {
  const today = srs.todayStr();
  if (S.daily.date !== today) S.daily = { date: today, newDone: 0 };
  S.daily.newDone += n;
  await store.put('meta', S.daily, 'daily');
}

/** 進捗をスマホに保存（デモ中以外は送信待ちにも積む） */
async function applyProgress(card, progress) {
  await store.saveProgress(card, progress, { queue: !S.settings.demo });
  const i = S.cards.findIndex(c => c.ID === card.ID);
  if (i >= 0) S.cards[i] = { ...card, ...progress };
  if (!S.settings.demo) S.outbox += 1;
}

/* ============================== 同期 ============================== */

let syncTimer = null;
function scheduleSync(delay = 2500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

async function runSync() {
  if (!configured() || S.settings.demo || S.syncing) return;
  S.syncing = true;
  refreshSyncBits();
  await syncNow(S.settings);
  S.syncing = false;
  await loadAll();
  const r = route().name;
  if (r === 'review') refreshSyncBits();   // 復習中は画面を作り直さない
  else render();
}

function syncStatus() {
  if (S.settings.demo) return { dot: 'off', text: 'デモ中 · シートとは同期しません' };
  if (!configured()) return { dot: 'off', text: '未接続 · 設定でシートとつなぐ' };
  if (S.syncing) return { dot: 'wait', text: '同期中…' };
  const unsent = `未送信 ${S.outbox}`;
  if (S.sync && S.sync.ok === false) return { dot: 'err', text: `同期できません · ${unsent}` };
  return { dot: S.outbox ? 'wait' : 'ok', text: `同期済み ${S.sync?.at ? timeLabel(S.sync.at).replace('今日 ', '') : '—'} · ${unsent}` };
}

function refreshSyncBits() {
  const st = syncStatus();
  document.querySelectorAll('[data-sync-line]').forEach(el => {
    el.innerHTML = `<span class="dot ${st.dot}" aria-hidden="true"></span>${esc(st.text)}`;
  });
  document.querySelectorAll('[data-sync-btn]').forEach(el => el.classList.toggle('spin', S.syncing));
}

/* ============================== ルーティング ============================== */

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  return { name: name || 'today', arg: decodeURIComponent(rest.join('/')) };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function nav(current) {
  const item = (name, label, icon) =>
    `<a href="#/${name}" ${current === name ? 'aria-current="page"' : ''}>${icon}${label}</a>`;
  return `<nav class="nav" aria-label="メイン">${item('today', '今日', ICON.home)}${item('inbox', '受信箱', ICON.inbox)}${item('search', '検索', ICON.find)}${item('settings', '設定', ICON.gear)}</nav>`;
}

function render() {
  const r = route();
  const screens = { today: renderToday, review: renderReview, done: renderDone, inbox: renderInbox, search: renderSearch, card: renderDetail, settings: renderSettings };
  (screens[r.name] || renderToday)(r.arg);
  refreshSyncBits();
}

/* ============================== 今日 ============================== */

function sessionPreview(extraNew = 0) {
  return srs.buildSession(S.cards, {
    today: srs.todayStr(),
    newPerDay: S.settings.newPerDay,
    newDoneToday: S.daily.newDone,
    extraNew,
  });
}

function weekBars() {
  const today = srs.todayStr();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = srs.addDays(today, -i);
    const n = S.log.filter(e => e.date === d).length;
    const [y, m, dd] = d.split('-').map(Number);
    days.push({ label: i === 0 ? '今日' : WEEK[new Date(y, m - 1, dd).getDay()], n });
  }
  return days;
}

function renderToday() {
  const now = new Date();
  const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日（${WEEK[now.getDay()]}）`;
  const inboxCount = S.cards.filter(c => c['状態'] === '受信箱').length;
  const p = sessionPreview();
  const total = p.queue.length;
  const reviews = S.log.length;
  const usedWeek = S.log.filter(e => e.used).length;

  let main;
  if (!S.cards.length && !S.settings.demo) {
    main = `
      <section class="card-box" aria-label="はじめに">
        <div class="sec">
          <p class="label">はじめに</p>
          <p class="meaning" style="font-size:18px">スプレッドシートとつなぐと、カードがこのスマホに届きます。</p>
          <p class="scene" style="font-size:14px">接続前に、デモのカードで流れを試すこともできます。</p>
        </div>
        <a class="primary" href="#/settings">シートとつなぐ</a>
        <button class="text-btn" data-act="demo-on">デモデータで試す</button>
      </section>`;
  } else {
    const startBlock = total
      ? `<button class="primary" data-act="start">${ICON.focus}集中して始める</button>
         <p class="caption">始めるとナビを隠して、1枚ずつ表示します</p>`
      : `<p class="scene" style="text-align:center">今日の分は終わりました。</p>
         ${inboxCount ? '<button class="primary ink" data-act="start-extra">受信箱から3枚学ぶ</button>' : ''}`;
    main = `
      <section class="card-box" aria-label="今日のセッション">
        <div style="display:flex;flex-direction:column;gap:6px">
          <p class="label">今日のセッション</p>
          <p class="big"><b>${total}</b><span>枚 · 約${Math.max(1, Math.round(total * 0.5))}分</span></p>
        </div>
        <div class="tiles">
          <div class="tile"><span>復習</span><b>${p.due.length}</b></div>
          <div class="tile"><span>新しく学ぶ</span><b>${p.fresh.length}</b></div>
        </div>
        ${startBlock}
      </section>`;
  }

  const bars = weekBars().map(d => {
    const h = d.n === 0 ? 4 : Math.min(48, 8 + d.n * 3);
    return `<div class="bar-col"><div class="bar-wrap"><div class="bar ${d.n ? '' : 'zero'}" style="height:${h}px"></div></div><span>${d.label}</span></div>`;
  }).join('');

  app.innerHTML = `
    <div class="screen">
      <div class="scroll">
        <header class="top">
          <div><p class="date">${dateLabel}</p><h1>今日</h1></div>
          <button class="icon-btn" data-act="sync" data-sync-btn aria-label="今すぐ同期">${ICON.sync}</button>
        </header>
        <p class="sync-line" data-sync-line></p>
        ${S.sync && S.sync.ok === false && configured() && !S.settings.demo ? `<p class="banner err">${esc(S.sync.error)}。評価はスマホに保存されています。</p>` : ''}
        <main class="home">
          ${main}
          <a class="row-link" href="#/inbox">
            <span class="t"><b>受信箱</b><span>毎日${S.settings.newPerDay}枚を優先度順・古い順で追加</span></span>
            <span class="n">${inboxCount}枚 ${ICON.chevron}</span>
          </a>
          <section class="week" aria-label="今週の記録">
            <div class="week-head"><h2>今週の記録</h2><span>復習 ${reviews} · 職場で使えた ${usedWeek}</span></div>
            <div class="bars">${bars}</div>
          </section>
        </main>
      </div>
      ${nav('today')}
    </div>`;
}

/* ============================== 復習 ============================== */

function startSession(extraNew = 0) {
  const p = sessionPreview(extraNew);
  if (!p.queue.length) { go('#/today'); return; }
  S.session = {
    ids: p.queue.map(c => c.ID),
    newIds: new Set(p.fresh.map(c => c.ID)),
    i: 0,
    flipped: false,
    hint: null,
    used: false,
    panels: null,
    startedAt: Date.now(),
    counts: { good: 0, partial: 0, again: 0 },
    mastered: 0,
    usedCount: 0,
    summary: null,
  };
  go('#/review');
}

function hintsFor(card) {
  const list = [];
  if (val(card, '根源イメージ')) list.push({ label: '根源イメージ', text: val(card, '根源イメージ') });
  if (val(card, '英語の意味')) list.push({ label: 'English', text: val(card, '英語の意味'), en: true });
  return list;
}

function reviewHeader(card) {
  const ss = S.session;
  const n = ss.ids.length;
  const pct = Math.round((ss.i / n) * 1000) / 10;
  const isNew = ss.newIds.has(card.ID);
  const kind = val(card, '主分類');
  const right = ss.flipped
    ? `<button class="used" data-act="used" aria-pressed="${ss.used}" aria-label="職場で使えた">${ICON.bag}<span>${ss.used ? '使えた' : ''}</span></button>`
    : `<span style="display:flex;gap:4px;padding-right:8px">${isNew ? '<span class="pill new">新規</span>' : ''}${kind ? `<span class="pill">${esc(kind)}</span>` : ''}</span>`;
  return `
    <header class="rv-head">
      <div class="rv-bar">
        <button class="close" data-act="quit" aria-label="セッションを中断">${ICON.close}</button>
        <span class="counter">${ss.i + 1} / ${n}</span>
        ${right}
      </div>
      <div class="progress" aria-hidden="true"><div style="width:${pct}%"></div></div>
    </header>`;
}

function renderReview() {
  if (!S.session || S.session.summary) { S.session = null; startSession(); return; }
  const ss = S.session;
  const card = byId(ss.ids[ss.i]);
  if (!card) { nextCard(); return; }

  if (!ss.flipped) {
    const hints = hintsFor(card);
    if (ss.hint === null) ss.hint = S.settings.rootFirst && hints[0]?.label === '根源イメージ' ? 1 : 0;
    const shown = hints.slice(0, ss.hint).map((h, k) => `
      <div class="hint">
        <span>${k === 0 && h.label === '根源イメージ' ? ICON.bulb : ''}ヒント ${k + 1} · ${h.label}</span>
        <p ${h.en ? 'lang="en"' : ''}>${esc(h.text)}</p>
      </div>`).join('');
    const nextHint = hints[ss.hint];
    const hintBtn = nextHint
      ? `<button class="hint-btn ${ss.hint ? 'quiet' : ''}" data-act="hint">${ss.hint ? 'まだ出ない？ ' : ''}ヒント ${ss.hint + 1} · ${nextHint.label}${ss.hint ? '' : 'を見る'}</button>`
      : '';
    const scene = val(card, '使用場面・語感');
    app.innerHTML = `
      <div class="screen plain">
        ${reviewHeader(card)}
        <main class="scroll front">
          <section class="sec"><h2>意味</h2><p class="meaning">${esc(val(card, '日本語の意味') || '（意味が未入力です）')}</p></section>
          ${scene ? `<section class="sec"><h2>場面</h2><p class="scene">${esc(scene)}</p></section>` : ''}
          <section class="hints" aria-label="ヒント">${shown}${hintBtn}</section>
        </main>
        <footer class="rv-foot">
          <p>日本語で言ってみてから、答えを見る</p>
          <button class="reveal" data-act="flip">答えを見る</button>
        </footer>
      </div>`;
    return;
  }

  if (!ss.panels) ss.panels = defaultPanels(card);
  const s = srs.stageOf(card);
  const labels = [...S.intervals.map(String), '定着'];
  const mastered = card['状態'] === '定着';
  const chips = labels.map((l, i) => {
    let cls = '';
    if (mastered) cls = i < labels.length - 1 ? 'past' : 'now';
    else if (i < s) cls = 'past';
    else if (i === s) cls = 'now';
    else if (i === s + 1) cls = 'next';
    const text = cls === 'now' && i < S.intervals.length ? `${l}日` : l;
    return `<span class="${cls}">${esc(text)}</span>`;
  }).join('');
  const now = S.intervals[Math.min(s, S.intervals.length - 1)];

  app.innerHTML = `
    <div class="screen plain">
      ${reviewHeader(card)}
      <main class="scroll back">${backBody(card, ss.panels)}</main>
      <footer class="rate-foot">
        <div class="stages" aria-label="復習の段階：今は${now}日">${chips}</div>
        <div class="rates">
          <button class="btn-again" data-act="rate" data-r="again"><b>忘れた</b><small>${srs.previewLabel(card, 'again', S.intervals)}</small></button>
          <button class="btn-mid" data-act="rate" data-r="partial"><b>あいまい</b><small>${srs.previewLabel(card, 'partial', S.intervals)}</small></button>
          <button class="btn-good" data-act="rate" data-r="good"><b>できた</b><small>${srs.previewLabel(card, 'good', S.intervals)}</small></button>
        </div>
      </footer>
    </div>`;
}

function defaultPanels(card) {
  const fresh = items(card['合わない使い方']).length > 0;
  return { misuse: !fresh, memo: false, roots: false, colloc: false };
}

function exampleHtml(card) {
  const ex = val(card, '自分の例文');
  if (!ex) return '';
  const hit = srs.findHighlight(ex, val(card, '表現'));
  if (!hit) return `<p class="example">${esc(ex)}</p>`;
  const [a, b] = hit;
  return `<p class="example">${esc(ex.slice(0, a))}<mark>${esc(ex.slice(a, b))}</mark>${esc(ex.slice(b))}</p>`;
}

function panel(key, title, body, open, warn = false) {
  return `
    <section class="panel ${warn ? 'warn' : ''}">
      <button data-act="panel" data-k="${key}" aria-expanded="${open}">${title}<span class="pm" aria-hidden="true">${open ? '−' : '＋'}</span></button>
      ${open ? `<div class="body">${body}</div>` : ''}
    </section>`;
}

function misuseLines(list) {
  return list.map(raw => {
    const t = raw.replace(/^[✗✕×]\s*/, '');
    const [wrong, ...rest] = t.split('→');
    const right = rest.join('→').trim();
    return `<p><span class="ng-c">✕</span> ${esc(wrong.trim())}</p>${right ? `<p><span class="ok-c">→</span> ${esc(right)}</p>` : ''}`;
  }).join('');
}

function backBody(card, panels) {
  const reading = [val(card, '読み'), val(card, '品詞・型')].filter(Boolean).join(' · ');
  const fit = items(card['よく合う組み合わせ']);
  const ng = items(card['合わない使い方']);
  const syn = items(card['類義語との違い']);
  const memo = val(card, '誤用・発見');
  const roots = [val(card, '語源・成り立ち'), val(card, '根源イメージ')].filter(Boolean);
  const en = val(card, '英語の近似表現');
  const out = [];

  if (ng.length) {
    out.push(`
      <section class="panel fit">
        <h3>合う使い方・合わない使い方</h3>
        ${fit.length ? `<p class="fit-line"><b class="ok-c">合う</b><span>${esc(fit.join('／'))}</span></p>` : ''}
        <div class="body" style="padding:0">${misuseLines(ng)}</div>
      </section>`);
    if (memo) out.push(panel('memo', '発見メモ', `<p>${esc(memo)}</p>`, panels.memo));
  } else if (memo) {
    out.push(panel('misuse', '誤用・発見', `<p>${esc(memo)}</p>`, panels.misuse, true));
  }
  if (roots.length) out.push(panel('roots', '語源・根源', roots.map(r => `<p>${esc(r)}</p>`).join(''), panels.roots));
  if (syn.length || (fit.length && !ng.length) || en) {
    const parts = [];
    if (fit.length && !ng.length) parts.push(`<p>${esc(fit.join('／'))}</p>`);
    if (syn.length) {
      parts.push(`<div class="syn">${syn.map(x => {
        const k = x.search(/[：:]/);
        return k > 0 ? `<div><b>${esc(x.slice(0, k))}</b><span>${esc(x.slice(k + 1).trim())}</span></div>` : `<div><span>${esc(x)}</span></div>`;
      }).join('')}</div>`);
    }
    if (en) parts.push(`<p class="note" lang="en">English: ${esc(en)}</p>`);
    out.push(panel('colloc', '組み合わせ・類義語', parts.join(''), panels.colloc));
  }

  const source = val(card, '出典');
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <h1 class="word">${esc(val(card, '表現'))}</h1>
      ${reading ? `<p class="reading">${esc(reading)}</p>` : ''}
    </div>
    ${exampleHtml(card)}
    <div class="panels">${out.join('')}</div>
    ${source ? `<p class="source">出典：${esc(source)}</p>` : ''}`;
}

async function rate(result) {
  const ss = S.session;
  if (!ss || ss.busy) return;           // 2回タップで1枚飛ばさないように
  const card = byId(ss.ids[ss.i]);
  if (!card) return;
  ss.busy = true;
  try {
    const wasNew = card['状態'] === '受信箱';
    const progress = srs.nextProgress(card, result, { today: srs.todayStr(), intervals: S.intervals, used: ss.used });
    await applyProgress(card, progress);
    if (wasNew) await bumpNewDone();
    const entry = { date: srs.todayStr(), id: card.ID, result, used: ss.used, at: Date.now() };
    await store.add('log', entry);
    S.log.push(entry);
    ss.counts[result] += 1;
    if (progress['状態'] === '定着' && card['状態'] !== '定着') ss.mastered += 1;
    if (ss.used) ss.usedCount += 1;
  } catch (e) {
    ss.busy = false;
    alert(`保存できませんでした：${e.message}`);
    return;
  }
  ss.busy = false;
  nextCard();
}

function nextCard() {
  const ss = S.session;
  ss.i += 1;
  ss.flipped = false;
  ss.hint = null;
  ss.used = false;
  ss.panels = null;
  if (ss.i >= ss.ids.length) {
    ss.summary = { ms: Date.now() - ss.startedAt };
    scheduleSync(300);
    go('#/done');
  } else {
    render();
    app.querySelector('.scroll')?.scrollTo(0, 0);
  }
}

/* ============================== 完了 ============================== */

function renderDone() {
  const ss = S.session;
  if (!ss || !ss.summary) { go('#/today'); return; }
  const total = ss.counts.good + ss.counts.partial + ss.counts.again;
  const sec = Math.round(ss.summary.ms / 1000);
  const tomorrow = srs.addDays(srs.todayStr(), 1);
  const dueTomorrow = S.cards.filter(c => srs.ACTIVE.includes(c['状態']) && c['次回復習日'] && c['次回復習日'] <= tomorrow).length;
  const inboxLeft = S.cards.filter(c => c['状態'] === '受信箱').length;
  let send;
  if (S.settings.demo) send = '<span class="dot off" aria-hidden="true"></span>デモ（送信しません）';
  else if (!configured()) send = '<span class="dot off" aria-hidden="true"></span>未接続（スマホに保存済み）';
  else if (S.syncing) send = '<span class="dot wait" aria-hidden="true"></span>送信中…';
  else if (S.outbox) send = `<span class="dot wait" aria-hidden="true"></span>未送信 ${S.outbox}件（電波が戻ったら送ります）`;
  else send = '<span class="dot ok" aria-hidden="true"></span>送信済み';

  app.innerHTML = `
    <div class="screen plain">
      <main class="done">
        <div class="done-top">
          <div class="check" aria-hidden="true">${ICON.check}</div>
          <h1>今日の分、完了</h1>
          <p>${total}枚 · ${Math.floor(sec / 60)}分${sec % 60}秒</p>
        </div>
        <div class="res3">
          <div><b style="color:var(--good)">${ss.counts.good}</b><span>できた</span></div>
          <div><b style="color:var(--mid)">${ss.counts.partial}</b><span>あいまい</span></div>
          <div><b style="color:var(--bad)">${ss.counts.again}</b><span>忘れた</span></div>
        </div>
        <ul class="facts">
          <li><span>定着になった</span><b>${ss.mastered}枚</b></li>
          <li><span>職場で使えた</span><b>${ss.usedCount ? `+${ss.usedCount} → 状態「使える」` : '0'}</b></li>
          <li><span>明日の復習</span><b>${dueTomorrow}枚</b></li>
          <li class="muted"><span>シートへの送信</span><span style="display:flex;align-items:center;gap:6px">${send}</span></li>
        </ul>
      </main>
      <footer class="done-foot">
        <button class="primary ink" data-act="home">ホームに戻る</button>
        ${inboxLeft ? '<button class="text-btn" data-act="start-extra">まだ余裕がある？ 受信箱から3枚追加</button>' : ''}
      </footer>
    </div>`;
}

/* ============================== 受信箱 ============================== */

function inboxList() {
  const status = S.ui.inboxTab === 'held' ? '保留' : '受信箱';
  const list = S.cards.filter(c => c['状態'] === status).sort(srs.inboxOrder);
  const skipped = S.ui.skipped.filter(id => list.some(c => c.ID === id));
  const rest = list.filter(c => !skipped.includes(c.ID));
  return [...rest, ...skipped.map(byId)];
}

function renderInbox() {
  const list = inboxList();
  const todo = S.cards.filter(c => c['状態'] === '受信箱').length;
  const held = S.cards.filter(c => c['状態'] === '保留').length;
  const done = S.daily.date === srs.todayStr() ? S.daily.newDone : 0;
  const limit = S.settings.newPerDay;
  const pct = limit ? Math.min(100, (done / limit) * 100) : 100;
  const card = list[0];
  const isHeld = S.ui.inboxTab === 'held';

  let body;
  if (!card) {
    body = isHeld
      ? '<div class="empty"><h2>保留はありません</h2><p>受信箱で「保留」にしたカードがここに入ります。</p></div>'
      : '<div class="empty"><h2>受信箱は空です</h2><p>Claude に EXTRACT: や REGISTER: を送ると、<br>新しいカードがここに届きます。</p></div>';
  } else {
    const kind = val(card, '主分類');
    const prio = val(card, '優先度');
    const ex = val(card, '自分の例文');
    const added = mdLabel(val(card, '登録日時'));
    body = `
      <article class="icard">
        <div class="tags">${kind ? `<span class="pill">${esc(kind)}</span>` : ''}${prio ? `<span class="prio ${esc(prio)}">優先度 ${esc(prio)}</span>` : ''}</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <h2>${esc(val(card, '表現'))}</h2>
          <p class="reading">${esc(val(card, '読み'))}</p>
        </div>
        <p class="m">${esc(val(card, '日本語の意味'))}</p>
        ${ex ? `<p class="ex">${esc(ex)}</p>` : ''}
        <div class="meta"><span>出典：${esc(val(card, '出典') || '—')}</span>${added ? `<span>追加 ${added}</span>` : ''}</div>
      </article>
      <p class="hint-line">${isHeld ? '保留のカードは、自動では学習に入りません' : `判断しなくても、毎日${limit}枚が自動で「学ぶ」に入ります`}</p>`;
  }

  const buttons = card ? (isHeld
    ? `<div class="decide"><button class="skip" data-act="ib-skip">スキップ</button><button data-act="ib-unhold">受信箱に戻す</button><button class="learn" data-act="ib-learn">今日から学ぶ</button></div>`
    : `<div class="decide"><button class="skip" data-act="ib-skip">スキップ</button><button data-act="ib-hold">保留</button><button class="learn" data-act="ib-learn">今日から学ぶ</button></div>`)
    : '';

  app.innerHTML = `
    <div class="screen">
      <header class="list-head">
        <div class="title-row"><h1 class="page-title">受信箱</h1><span>優先度順 · 古い順</span></div>
        <div class="seg" role="tablist" aria-label="表示">
          <button role="tab" aria-selected="${!isHeld}" data-act="ib-tab" data-tab="todo">未判断 ${todo}</button>
          <button role="tab" aria-selected="${isHeld}" data-act="ib-tab" data-tab="held">保留 ${held}</button>
        </div>
        <div class="quota">
          <div class="quota-row"><span>今日の新規</span><b>${done} / ${limit}</b></div>
          <div class="quota-bar" aria-hidden="true"><div style="width:${pct}%"></div></div>
        </div>
      </header>
      <main class="inbox-main">${body}</main>
      ${buttons}
      ${nav('inbox')}
    </div>`;
}

async function inboxDecide(kind) {
  if (S.ui.deciding) return;            // 連打で別のカードを判断しないように
  const card = inboxList()[0];
  if (!card) return;
  S.ui.deciding = true;
  try {
    await decideCard(card, kind);
  } finally {
    S.ui.deciding = false;
  }
  if (kind !== 'skip') scheduleSync();
  render();
}

async function decideCard(card, kind) {
  S.ui.skipped = S.ui.skipped.filter(id => id !== card.ID);
  if (kind === 'skip') {
    S.ui.skipped.push(card.ID);
  } else if (kind === 'hold') {
    await applyProgress(card, { '状態': '保留' });
  } else if (kind === 'unhold') {
    await applyProgress(card, { '状態': '受信箱' });
  } else if (kind === 'learn') {
    await applyProgress(card, { '状態': '復習中', '次回復習日': srs.todayStr(), '復習段階': 0 });
    await bumpNewDone();
  }
}

/* ============================== 検索 ============================== */

function searchMatches() {
  const f = S.ui.search;
  const q = f.q.trim().toLowerCase();
  const fields = ['表現', '読み', '日本語の意味', '英語の意味', '自分の例文', '関連タグ', '使用場面・語感'];
  return S.cards.filter(c => {
    if (f.kind !== 'すべて' && val(c, '語種') !== f.kind) return false;
    if (f.status !== 'すべて' && val(c, '状態') !== f.status) return false;
    if (f.tag && !val(c, '関連タグ').split(/[,、]\s*/).map(t => t.trim()).includes(f.tag)) return false;
    if (!q) return true;
    return fields.some(k => val(c, k).toLowerCase().includes(q));
  }).sort((a, b) => String(b['登録日時']).localeCompare(String(a['登録日時'])));
}

function resultsHtml() {
  const list = searchMatches();
  const shown = list.slice(0, 200);
  const today = srs.todayStr();
  return `<p class="count">${list.length}件${list.length > shown.length ? '（先頭200件を表示）' : ''}</p>` +
    shown.map(c => `
      <a class="result" href="#/card/${encodeURIComponent(c.ID)}">
        <span class="l">
          <span class="w"><b>${esc(val(c, '表現'))}</b><span>${esc(val(c, '主分類'))}</span></span>
          <span>${esc(val(c, '日本語の意味'))}</span>
        </span>
        <span class="r"><span class="st s-${esc(val(c, '状態'))}">${esc(val(c, '状態') || '—')}</span><small>${srs.nextLabel(c, today)}</small></span>
      </a>`).join('');
}

function renderSearch() {
  const f = S.ui.search;
  const chip = (label, on, act, extra = '') =>
    `<button class="chip" aria-pressed="${on}" data-act="${act}" data-v="${esc(label)}" ${extra}>${esc(label)}</button>`;
  const kinds = ['すべて', ...new Set(S.cards.map(c => val(c, '語種')).filter(Boolean))];
  const statuses = ['すべて', '復習中', '使える', '定着', '受信箱', '保留'];
  const freq = new Map();
  S.cards.forEach(c => val(c, '関連タグ').split(/[,、]\s*/).map(t => t.trim()).filter(Boolean)
    .forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));
  const tags = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const visibleTags = f.moreTags ? tags : tags.slice(0, 3);
  if (f.tag && !visibleTags.includes(f.tag)) visibleTags.unshift(f.tag);

  app.innerHTML = `
    <div class="screen">
      <header class="list-head">
        <h1 class="page-title">検索</h1>
        <label class="search-box">${ICON.search}<span class="sr">言葉・意味・例文を検索</span>
          <input type="search" id="q" placeholder="言葉・意味・例文" value="${esc(f.q)}" autocomplete="off" enterkeyhint="search">
        </label>
        <div class="filters">
          <div class="frow"><span>語種</span>${kinds.map(k => chip(k, f.kind === k, 'f-kind')).join('')}</div>
          <div class="frow"><span>状態</span>${statuses.map(s => chip(s, f.status === s, 'f-status')).join('')}</div>
          ${tags.length ? `<div class="frow"><span>タグ</span>${visibleTags.map(t => chip(t, f.tag === t, 'f-tag')).join('')}
            ${tags.length > 3 ? `<button class="chip more" data-act="f-more">${f.moreTags ? '閉じる' : `＋ 他${tags.length - 3}`}</button>` : ''}</div>` : ''}
        </div>
      </header>
      <main class="scroll"><div class="results" id="results">${resultsHtml()}</div></main>
      ${nav('search')}
    </div>`;
}

/* ============================== カード詳細 ============================== */

function renderDetail(id) {
  const card = byId(id);
  if (!card) { go('#/search'); return; }
  if (!S.ui.detailPanels[id]) S.ui.detailPanels[id] = { ...defaultPanels(card), roots: true, colloc: true };
  const st = val(card, '状態');
  app.innerHTML = `
    <div class="screen plain">
      <header class="detail-head">
        <button class="close" data-act="back" aria-label="戻る">${ICON.back}</button>
        <span class="st s-${esc(st)}">${esc(st || '—')} · ${srs.nextLabel(card)}</span>
      </header>
      <main class="scroll back">
        ${backBody(card, S.ui.detailPanels[id])}
        <section class="sec"><h2>意味</h2><p class="scene">${esc(val(card, '日本語の意味'))}</p></section>
        ${val(card, '使用場面・語感') ? `<section class="sec"><h2>場面</h2><p class="scene">${esc(val(card, '使用場面・語感'))}</p></section>` : ''}
      </main>
    </div>`;
}

/* ============================== 設定 ============================== */

function renderSettings() {
  const st = S.sync;
  const intervals = S.intervals.join(' → ');
  const msg = S.ui.connMsg;
  const draft = S.ui.connDraft || S.settings;
  app.innerHTML = `
    <div class="screen">
      <header class="top" style="padding:28px 20px 6px"><h1>設定</h1></header>
      <main class="scroll settings">
        <section>
          <h2>同期</h2>
          <div class="group">
            <div class="kv"><span>最終同期</span><b>${S.settings.demo ? 'デモ中' : timeLabel(st?.at)}</b></div>
            <div class="kv"><span>未送信の評価</span><b>${S.outbox}件</b></div>
            <div class="kv"><span>カード</span><b>${S.cards.length}枚</b></div>
            ${st && st.ok === false && !S.settings.demo ? `<p class="msg err">${esc(st.error)}</p>` : ''}
            <button class="outline" data-act="sync" data-sync-btn ${configured() && !S.settings.demo ? '' : 'aria-disabled="true"'}>${ICON.sync}${S.syncing ? '同期中…' : '今すぐ同期'}</button>
          </div>
        </section>

        <section>
          <h2>学習</h2>
          <div class="group flush">
            <div class="line">
              <span class="t"><b>1日の新規カード</b><span>受信箱から優先度順・古い順</span></span>
              <span class="stepper">
                <button data-act="limit" data-d="-1" aria-label="減らす">−</button>
                <output aria-live="polite">${S.settings.newPerDay}</output>
                <button data-act="limit" data-d="1" aria-label="増やす">＋</button>
              </span>
            </div>
            <label class="line">
              <span class="t"><b>根源イメージを最初から表示</b><span>オフにすると、ヒントはボタンで開きます</span></span>
              <span class="switch"><input type="checkbox" data-act="rootFirst" ${S.settings.rootFirst ? 'checked' : ''}><span></span></span>
            </label>
          </div>
        </section>

        <section>
          <h2>復習の間隔（03_設定 より）</h2>
          <div class="group rules">
            <div><span class="ok-c">できた</span><span>${esc(intervals)}日 → 定着</span></div>
            <div><span style="color:var(--mid);font-weight:700">あいまい</span><span>3日後</span></div>
            <div><span style="color:var(--bad);font-weight:700">忘れた</span><span>明日（最初の段階に戻る）</span></div>
            <p class="small">変更はスプレッドシートの 03_設定 で行います（同期すると反映）</p>
          </div>
        </section>

        <section>
          <h2>接続</h2>
          <form class="group" data-form="conn">
            <label class="field">API URL
              <input type="url" name="apiUrl" value="${esc(draft.apiUrl)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" inputmode="url">
            </label>
            <label class="field">トークン
              <input type="password" name="token" value="${esc(draft.token)}" autocomplete="off">
            </label>
            <p class="small">どちらもスプレッドシートの 10_API設定 シートにあります。</p>
            ${msg ? `<p class="msg ${msg.ok ? 'ok' : 'err'}">${esc(msg.text)}</p>` : ''}
            <button class="outline" type="submit">保存して接続</button>
            <p class="small lock">${ICON.lock}このスマホにだけ保存されます</p>
          </form>
        </section>

        <section>
          <h2>デモ</h2>
          <div class="group">
            <p class="small">${S.settings.demo ? 'デモのカードを表示しています。評価はシートに送られません。' : '接続前に、デモのカードで流れを試せます。'}</p>
            <button class="outline quiet" data-act="${S.settings.demo ? 'demo-off' : 'demo-on'}">${S.settings.demo ? 'デモを終了' : 'デモデータで試す'}</button>
          </div>
        </section>
        <p class="small" style="text-align:center">Grass v1.0.1</p>
      </main>
      ${nav('settings')}
    </div>`;
}

async function saveConnection(form) {
  const apiUrl = cleanUrl(form.apiUrl.value);
  const token = cleanToken(form.token.value);
  S.ui.connDraft = { apiUrl, token };   // 失敗しても入力を消さない
  if (!/^https:\/\/script\.google\.com\/(?:a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(apiUrl)) {
    S.ui.connMsg = { ok: false, text: 'URL は https://script.google.com/macros/s/…/exec の形で入れてください' };
    render();
    return;
  }
  if (!token) {
    S.ui.connMsg = { ok: false, text: 'トークンを入れてください' };
    render();
    return;
  }
  S.ui.connMsg = { ok: true, text: '接続を確認しています…' };
  render();
  try {
    const n = await testConnection({ apiUrl, token });
    if (S.settings.demo) {
      await Promise.all([store.clear('cards'), store.clear('outbox'), store.clear('log')]);
    }
    await saveSettings({ apiUrl, token, demo: false });
    S.ui.connDraft = null;
    S.ui.connMsg = { ok: true, text: `つながりました（${n}枚）` };
    await runSync();
  } catch (e) {
    S.ui.connMsg = { ok: false, text: e.message };
    render();
  }
}

/* ============================== 操作 ============================== */

const actions = {
  start: () => startSession(),
  'start-extra': () => startSession(3),
  home: () => { S.session = null; go('#/today'); },
  quit: () => { S.session = null; scheduleSync(300); go('#/today'); },
  sync: () => { if (configured() && !S.settings.demo) runSync(); else go('#/settings'); },
  hint: () => { S.session.hint += 1; render(); },
  flip: () => { S.session.flipped = true; render(); app.querySelector('.scroll')?.scrollTo(0, 0); },
  used: () => { S.session.used = !S.session.used; render(); },
  rate: el => rate(el.dataset.r),
  panel: el => {
    const k = el.dataset.k;
    const r = route();
    const panels = r.name === 'card' ? S.ui.detailPanels[r.arg] : S.session.panels;
    panels[k] = !panels[k];
    const scroller = app.querySelector('.scroll');
    const top = scroller?.scrollTop || 0;
    render();
    app.querySelector('.scroll')?.scrollTo(0, top);
  },
  'ib-tab': el => { S.ui.inboxTab = el.dataset.tab; render(); },
  'ib-skip': () => inboxDecide('skip'),
  'ib-hold': () => inboxDecide('hold'),
  'ib-unhold': () => inboxDecide('unhold'),
  'ib-learn': () => inboxDecide('learn'),
  'f-kind': el => { S.ui.search.kind = el.dataset.v; render(); },
  'f-status': el => { S.ui.search.status = el.dataset.v; render(); },
  'f-tag': el => { S.ui.search.tag = S.ui.search.tag === el.dataset.v ? null : el.dataset.v; render(); },
  'f-more': () => { S.ui.search.moreTags = !S.ui.search.moreTags; render(); },
  back: () => { if (history.length > 1) history.back(); else go('#/search'); },
  limit: async el => {
    const n = Math.max(0, Math.min(20, S.settings.newPerDay + Number(el.dataset.d)));
    await saveSettings({ newPerDay: n });
    render();
  },
  'demo-on': async () => {
    await store.replaceCards(demoCards());
    await Promise.all([store.clear('outbox'), store.clear('log')]);
    await saveSettings({ demo: true });
    await store.put('meta', { date: srs.todayStr(), newDone: 0 }, 'daily');
    await loadAll();
    go('#/today');
  },
  'demo-off': async () => {
    await Promise.all([store.clear('cards'), store.clear('outbox'), store.clear('log')]);
    await saveSettings({ demo: false });
    await loadAll();
    if (configured()) runSync();
    go('#/today');
  },
};

app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});

app.addEventListener('change', async e => {
  if (e.target.dataset.act === 'rootFirst') {
    await saveSettings({ rootFirst: e.target.checked });
  }
});

app.addEventListener('input', e => {
  if (e.target.id === 'q') {
    S.ui.search.q = e.target.value;
    const box = document.getElementById('results');
    if (box) box.innerHTML = resultsHtml();
  }
});

app.addEventListener('submit', e => {
  const form = e.target.closest('[data-form="conn"]');
  if (form) { e.preventDefault(); saveConnection(form); }
});

window.addEventListener('hashchange', render);
window.addEventListener('online', () => runSync());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const today = srs.todayStr();
  if (S.daily.date !== today) { S.daily = { date: today, newDone: 0 }; if (route().name === 'today') render(); }
  const last = S.sync?.at || 0;
  if (Date.now() - last > 5 * 60 * 1000) runSync();
});

/* ============================== 起動 ============================== */

(async function boot() {
  try {
    await loadAll();
  } catch (e) {
    app.innerHTML = `<div class="empty"><h2>データを開けません</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  const r = route().name;
  if (r === 'review' || r === 'done') location.replace('#/today');
  render();
  if (configured() && !S.settings.demo) runSync();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || route().name === 'review') return;   // 復習の途中では再読み込みしない
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
