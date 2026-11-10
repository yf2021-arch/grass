// 生の日本語（v1.10.0）：本物の素材（公式教材・YouTube など）の短い場面で、聞く → 確かめる
//   #/raw        … 素材の一覧
//   #/raw/<ID>   … 1つの場面：初めて聞く → 要点と理解度（初回は1回だけ記録）→ 確認（表現・文化メモ・話す）
//
// 素材（data/raw/clips.json）にはリンクと私たちのメモだけ。動画・音声は複製しない。
//   embed: 'youtube' … 公式の YouTube プレーヤーで、startSec〜endSec だけを流す（押したときに読み込む）
//   embed: 'none'    … 埋め込みできないサイト。公式サイトを開いて、時間を見て再生する
// 個人の記録（meta の rawLog・このスマホだけ）：{ [ID]: { draft, subs, first:{gist,score,subs,at}, check:{score,note,at}, opens, replays } }
//   初回の要点と理解度は、最初に「記録」した時点で固定。聞き直しや確認では変わらない。未記入は null。
//   公式サイトを開いただけでは「聞いた」にしない。字幕を見てしまったら、その条件も記録する。

const SCORES = [
  [0, 'ほとんど分からない'],
  [1, '少し分かった'],
  [2, 'だいたい分かった'],
  [3, 'ほぼ全部分かった'],
];

export function createRaw({ app, esc, nav, store, go, startChunks, chunkSay }) {
  const R = { clips: [], log: {}, ui: { score: null, checkScore: null }, yt: null, ytReady: null };

  async function load() {
    const l = await store.get('meta', 'rawLog');
    R.log = l && typeof l === 'object' ? l : {};
    try {
      const res = await fetch('data/raw/clips.json', { cache: 'no-cache' });
      if (res.ok) R.clips = ((await res.json()).clips || []).filter(c => c && c.id && c.url);
    } catch (e) { /* オフラインで未キャッシュ */ }
  }
  const save = () => store.put('meta', R.log, 'rawLog');
  const rec = id => (R.log[id] ||= { draft: '', subs: false, first: null, check: null, opens: 0, replays: 0 });
  const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const span = c => `${mmss(c.startSec)}〜${mmss(c.endSec)}（${c.endSec - c.startSec}秒）`;
  const stateOf = id => (R.log[id]?.check ? '確認済み' : R.log[id]?.first ? '初回済み' : '未');
  const doneCount = () => R.clips.filter(c => R.log[c.id]?.first).length;

  /* ---------------- 一覧 ---------------- */

  function renderList() {
    const rows = R.clips.map(c => {
      const st = stateOf(c.id);
      const hide = c.transferFor && !R.log[c.id]?.first;
      return `
        <a class="row-link" href="#/raw/${encodeURIComponent(c.id)}">
          <span class="t"><b>${esc(c.id)} · ${hide ? 'テスト用の場面（内容は伏せています）' : esc(c.title)}</b>
            <span>${esc(span(c))} · ${c.embed === 'youtube' ? 'アプリ内で再生' : '公式サイトで再生'}</span></span>
          <span class="n">${esc(st)}</span>
        </a>`;
    }).join('');
    return `
      <p class="caption" style="text-align:left;margin:0 16px 12px">本物の日本語の短い場面を、まず字幕なしで聞き、要点と理解度を記録してから確かめます。素材はリンクだけで、動画は公式のサイト・プレーヤーで見ます。</p>
      <section class="group" aria-label="素材">${rows || '<p class="small" style="padding:16px">素材を読み込めませんでした。電波のあるところで一度開いてください。</p>'}</section>`;
  }

  /* ---------------- 1つの場面 ---------------- */

  function playerBox(c, r) {
    if (c.embed === 'youtube' && c.videoId) {
      return `
        <div class="raw-player" id="raw-yt" aria-label="動画"></div>
        <div class="grid2">
          <button class="primary" data-act="raw-yt" data-id="${esc(c.id)}">▶ 場面を再生（${c.endSec - c.startSec}秒）</button>
          <button class="outline" data-act="raw-open" data-id="${esc(c.id)}">YouTube で開く</button>
        </div>
        <p class="msg err" id="raw-yt-err" hidden>プレーヤーを読み込めませんでした。「YouTube で開く」から見てください。</p>`;
    }
    return `
      <button class="primary" data-act="raw-open" data-id="${esc(c.id)}">公式サイトを開く</button>
      <p class="small" style="margin:0"><b>${esc(span(c))}</b></p>
      ${c.howto ? `<p class="small" style="margin:0">${esc(c.howto)}</p>` : ''}
      ${r.opens ? `<p class="caption" style="margin:0;text-align:left">開いた回数 ${r.opens}。書きかけの要点は保存されています。</p>` : ''}`;
  }

  function renderClip(id) {
    const c = R.clips.find(x => x.id === id);
    if (!c) return `<section class="card-box"><p class="scene">この素材は見つかりません。</p><a class="text-btn" href="#/raw">一覧へ</a></section>`;
    const r = rec(id);
    const head = `
      <section class="card-box raw-head">
        <p class="label">${esc(c.id)} · ${esc(c.level || '')}</p>
        <p class="raw-title">${c.transferFor && !r.first ? 'テスト用の場面' : esc(c.title)}</p>
        <p class="small" style="margin:0">${esc(span(c))}</p>
      </section>`;
    const copy = `<p class="caption quiz-note">${esc(c.copyright || '')}</p>`;

    if (!r.first) {
      const sc = R.ui.score;
      return `${head}
        <section class="card-box" aria-label="初めて聞く">
          <p class="label">1. 初めて聞く（字幕はオフ）</p>
          <p class="small" style="margin:0">サイトの字幕はアプリから消せません。最初は字幕をオフにして聞いてください。</p>
          ${playerBox(c, r)}
          <ol class="raw-qs">${(c.firstQs || []).map(q => `<li>${esc(q)}</li>`).join('')}</ol>
          <label class="field">要点を一行で（ひらがなでOK）<textarea data-raw="gist" data-id="${esc(c.id)}" rows="2" class="export" autocomplete="off">${esc(r.draft || '')}</textarea></label>
          <p class="small" style="margin:0">どのくらい分かりましたか</p>
          <div class="frow wrap" role="group" aria-label="理解度">${SCORES.map(([v, l]) => `<button class="chip" aria-pressed="${sc === v}" data-act="raw-score" data-v="${v}">${v} ${esc(l)}</button>`).join('')}</div>
          <button class="chip toggle" aria-pressed="${!!r.subs}" data-act="raw-subs" data-id="${esc(c.id)}">字幕を見てしまった</button>
          <button class="primary ink" data-act="raw-first" data-id="${esc(c.id)}" ${sc == null ? 'disabled' : ''}>初回の結果を記録する</button>
          <p class="caption" style="margin:0;text-align:left">記録すると、要点と理解度は固定されます。そのあとで、答え・表現・文化メモが見られます。</p>
        </section>${copy}`;
    }

    const f = r.first;
    const lockedBox = `
      <section class="card-box" aria-label="初回の結果">
        <p class="label">初回の結果（固定）</p>
        <p style="margin:0">${f.gist ? esc(f.gist) : '<span class="muted">（要点は空欄）</span>'}</p>
        <p class="small" style="margin:0">理解度 ${f.score}・${esc(SCORES[f.score][1])}${f.subs ? ' · 字幕あり' : ' · 字幕なし'} · ${esc(new Date(f.at).toLocaleDateString('ja-JP'))}</p>
      </section>`;
    const qa = (c.firstQs || []).map((q, i) => `<li><b>${esc(q)}</b><br>${esc(c.answers?.[i] || '')}</li>`).join('');
    const ex = (c.expressions || []).map(e => `<li><b>${esc(e.t)}</b><p class="small">${esc(e.note || '')}</p></li>`).join('');
    const cu = c.culture ? `
      <section class="card-box" aria-label="文化メモ">
        <p class="label">文化メモ</p>
        <p class="small" style="margin:0"><b>① 場面にある根拠</b><br>${esc(c.culture.evidence || '')}</p>
        <p class="small" style="margin:0"><b>② AI の解釈</b><br>${esc(c.culture.ai || '')}</p>
        <p class="small" style="margin:0"><b>③ ほかの可能性</b><br>${esc(c.culture.other || '')}</p>
      </section>` : '';
    const hu = c.humor ? `
      <section class="card-box" aria-label="笑い">
        <p class="label">笑いのツボ</p>
        <p class="small" style="margin:0"><b>前振り</b> ${esc(c.humor.setup || '')}<br><b>予想</b> ${esc(c.humor.expect || '')}<br><b>ずれ</b> ${esc(c.humor.gap || '')}</p>
      </section>` : '';
    const sp = (c.speakIds || []).map(sid => `<button class="row-link" data-act="raw-speak" data-v="${esc(sid)}"><span class="t"><b>${esc(chunkSay(sid) || sid)}</b><span>「話す」で言ってみる</span></span><span class="n">›</span></button>`).join('');
    const ck = r.check;
    const cs = R.ui.checkScore;
    const checkBox = ck ? `
      <section class="card-box" aria-label="確認後">
        <p class="label">確認後の理解度</p>
        <p style="margin:0">${ck.score}・${esc(SCORES[ck.score][1])}</p>
        ${ck.note ? `<p class="small" style="margin:0">${esc(ck.note)}</p>` : ''}
      </section>` : `
      <section class="card-box" aria-label="確認後">
        <p class="label">3. 字幕・スクリプトで確かめたあと</p>
        <div class="frow wrap" role="group" aria-label="確認後の理解度">${SCORES.map(([v, l]) => `<button class="chip" aria-pressed="${cs === v}" data-act="raw-cscore" data-v="${v}">${v} ${esc(l)}</button>`).join('')}</div>
        <label class="field">聞き取れなかったところ（あれば）<input data-raw="cnote" autocomplete="off" placeholder="例：「なるべく」が聞こえなかった"></label>
        <button class="outline" data-act="raw-check" data-id="${esc(c.id)}" ${cs == null ? 'disabled' : ''}>確認後の理解度を記録する</button>
      </section>`;

    return `${head}${lockedBox}
      <section class="card-box" aria-label="聞き直す">
        <p class="label">2. 聞き直して確かめる（字幕・スクリプトを使ってよい）</p>
        ${playerBox(c, r)}
        ${c.scene ? `<p class="scene" style="margin:0">${esc(c.scene)}</p>` : ''}
        <ol class="raw-qs ans">${qa}</ol>
      </section>
      ${ex ? `<section class="card-box" aria-label="表現"><p class="label">拾った表現</p><ul class="raw-ex">${ex}</ul></section>` : ''}
      ${cu}${hu}
      ${sp ? `<section class="group" aria-label="話す">${sp}</section>` : ''}
      ${checkBox}${copy}`;
  }

  function render(arg) {
    stopYt();
    const id = arg ? decodeURIComponent(arg) : '';
    if (id && R.ui.id !== id) R.ui = { id, score: null, checkScore: null };
    app.innerHTML = `
      <div class="screen">
        <div class="scroll">
          <header class="top"><div><p class="date">本物の素材で、聞く → 確かめる</p><h1>生の日本語</h1></div></header>
          <main class="home raw">${id ? renderClip(id) : renderList()}</main>
        </div>
        ${nav('raw')}
      </div>`;
  }

  /* ---------------- YouTube（公式の IFrame API） ---------------- */

  function loadYtApi() {
    if (window.YT?.Player) return Promise.resolve(true);
    if (R.ytReady) return R.ytReady;
    R.ytReady = new Promise(resolve => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(true); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(!!window.YT?.Player), 10000);
    });
    return R.ytReady;
  }

  async function playYt(c) {
    const box = document.getElementById('raw-yt');
    const err = document.getElementById('raw-yt-err');
    if (!box) return;
    const ok = await loadYtApi();
    if (!ok || !window.YT?.Player) { R.ytReady = null; if (err) err.hidden = false; return; }
    if (R.yt) { R.yt.seekTo(c.startSec, true); R.yt.playVideo(); return; }
    R.yt = new window.YT.Player(box, {
      videoId: c.videoId,
      playerVars: { start: c.startSec, end: c.endSec, playsinline: 1, rel: 0, cc_load_policy: 0 },
      events: {
        onReady: e => e.target.playVideo(),
        onError: () => { if (err) err.hidden = false; },
      },
    });
  }

  function stopYt() {
    if (R.yt) { try { R.yt.destroy(); } catch (e) { /* もう消えている */ } R.yt = null; }
  }
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/raw/')) stopYt(); });

  /* ---------------- 操作 ---------------- */

  /** 書きかけの要点は、打つたびに保存（公式サイトへ行って戻っても、再読み込みしても続きから） */
  let saveTimer = null;
  app.addEventListener('input', e => {
    if (e.target.dataset?.raw !== 'gist') return;
    rec(e.target.dataset.id).draft = e.target.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  });

  const keepTop = fn => {
    const top = app.querySelector('.scroll')?.scrollTop || 0;
    fn();
    app.querySelector('.scroll')?.scrollTo(0, top);
  };
  const again = () => keepTop(() => render(R.ui.id));
  const clip = id => R.clips.find(x => x.id === id);

  const actions = {
    'raw-open': async el => {
      const c = clip(el.dataset.id);
      if (!c) return;
      const r = rec(c.id);
      const ta = app.querySelector('[data-raw="gist"]');
      if (ta) r.draft = ta.value;
      r.opens += 1;
      if (r.first) r.replays += 1;
      await save();                                   // 外へ行く前に、書きかけと回数を保存
      const url = c.embed === 'youtube' && c.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(c.videoId)}&t=${c.startSec}s` : c.url;
      window.open(url, '_blank', 'noopener');
      again();
    },
    'raw-yt': async el => {
      const c = clip(el.dataset.id);
      if (!c) return;
      const r = rec(c.id);
      if (r.first) { r.replays += 1; save(); }
      playYt(c);
    },
    'raw-score': el => { R.ui.score = Number(el.dataset.v); again(); },
    'raw-cscore': el => { R.ui.checkScore = Number(el.dataset.v); again(); },
    'raw-subs': async el => { const r = rec(el.dataset.id); r.subs = !r.subs; await save(); again(); },
    'raw-first': async el => {
      const r = rec(el.dataset.id);
      if (r.first || R.ui.score == null) return;       // 初回は1回だけ
      const ta = app.querySelector('[data-raw="gist"]');
      const gist = String(ta ? ta.value : r.draft || '').trim();
      r.first = { gist: gist || null, score: R.ui.score, subs: !!r.subs, at: Date.now() };
      r.draft = '';
      await save();
      stopYt();
      render(R.ui.id);
      app.querySelector('.scroll')?.scrollTo(0, 0);
    },
    'raw-check': async el => {
      const r = rec(el.dataset.id);
      if (!r.first || r.check || R.ui.checkScore == null) return;
      const note = String(app.querySelector('[data-raw="cnote"]')?.value || '').trim();
      r.check = { score: R.ui.checkScore, note: note || null, at: Date.now() };
      await save();
      again();
    },
    'raw-speak': el => startChunks([el.dataset.v]),
  };

  const exportData = () => ({ rawLog: R.log });
  async function importData(data) {
    let n = 0;
    for (const [id, v] of Object.entries(data?.rawLog || {})) {
      if (!R.log[id] || (!R.log[id].first && v?.first)) { R.log[id] = v; n += 1; }
    }
    await save();
    return n;
  }

  return { load, render, actions, doneCount, count: () => R.clips.length, exportData, importData, _state: R };
}
