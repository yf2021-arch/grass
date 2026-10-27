// シートとの同期：①未送信の評価を送る → ②全カードを取り直す
// Apps Script は CORS の事前確認（OPTIONS）に答えられないので、text/plain で JSON を送る。

import * as store from './store.js';

const TIMEOUT_MS = 45000;
let running = null;

/** 貼り付けた URL から、空白・見えない文字を取り除き、/exec までの正しい形だけを取り出す */
export function cleanUrl(raw) {
  const s = String(raw ?? '').replace(/[\s​-‍⁠﻿]/g, '');
  const m = s.match(/https:\/\/script\.google\.com\/(?:a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec/);
  return m ? m[0] : s;
}

export function cleanToken(raw) {
  return String(raw ?? '').replace(/[\s​-‍⁠﻿]/g, '');
}

/** 失敗したときの切り分け：トークンなしの GET（doGet）が届くかどうか */
async function probe(url) {
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'follow' });
    const text = await res.text();
    return text.includes('grass-register') ? 'ok' : `status ${res.status}`;
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
}

async function call(settings, body) {
  const url = cleanUrl(settings.apiUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, token: cleanToken(settings.token) }),
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`サーバーの応答：${res.status}`);
    const data = await res.json().catch(() => { throw new Error('応答を読めません。URL を確認してください'); });
    if (!data.ok) throw new Error(data.error || '不明なエラー');
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('時間切れです。電波を確認してください');
    if (e instanceof TypeError) {
      const p = await probe(url);
      const tail = url.slice(-18);
      if (p === 'ok') throw new Error(`サーバーには届きますが、POST の応答を読めません［${e.message}］（…${tail}）`);
      throw new Error(`接続できません［POST: ${e.message} / GET: ${p}］（…${tail}）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 送信待ちを ID ごとに1件へまとめる（古い順に重ねるので、後の値が勝つ） */
export function collapse(entries) {
  const merged = new Map();
  entries.forEach(({ value }) => {
    const { at, ...rest } = value;
    merged.set(rest.ID, { ...(merged.get(rest.ID) || {}), ...rest });
  });
  return [...merged.values()];
}

async function pushOutbox(settings) {
  const entries = await store.getAllWithKeys('outbox');
  if (!entries.length) return 0;
  const updates = collapse(entries);
  await call(settings, { action: 'progress', updates });
  await store.deleteKeys('outbox', entries.map(e => e.key));
  return updates.length;
}

async function pull(settings) {
  const data = await call(settings, { action: 'pull' });
  // 送信に失敗して残っている評価があれば、その進捗をスマホ側の値で上書きしておく
  const pending = new Map(collapse(await store.getAllWithKeys('outbox')).map(u => [u.ID, u]));
  const cards = data.cards.map(c => (pending.has(c.ID) ? { ...c, ...pending.get(c.ID) } : c));
  await store.replaceCards(cards);
  if (Array.isArray(data.intervals) && data.intervals.length) await store.put('meta', data.intervals, 'intervals');
  return cards.length;
}

/** 同期する。同時に2回は走らない。結果を meta に記録する */
export function syncNow(settings) {
  if (running) return running;
  running = (async () => {
    try {
      const sent = await pushOutbox(settings);
      const total = await pull(settings);
      const state = { at: Date.now(), ok: true, sent, total };
      await store.put('meta', state, 'sync');
      return state;
    } catch (e) {
      const prev = (await store.get('meta', 'sync')) || {};
      const state = { ...prev, ok: false, error: e.message, failedAt: Date.now() };
      await store.put('meta', state, 'sync');
      return state;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** 設定画面の「接続を確認」用：取得だけ試す */
export async function testConnection(settings) {
  const data = await call(settings, { action: 'pull' });
  return data.cards.length;
}
