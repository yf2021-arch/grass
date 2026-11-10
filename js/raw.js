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

// 自分で追加した YouTube の場面（候補）に出す、どの場面にも使える問い
const GENERIC_QS = ['だれが、だれに話していますか。', '何について話していますか。', 'いちばん大事だと思った一言は何でしたか。'];
const CAPTION_KIND = { manual: '字幕（人が作成）', auto: '自動字幕・未確認', unknown: '種類不明・未確認' };

/** YouTube の URL（共有された文の中にあってもよい）から、動画 ID と開始秒を取り出す */
export function parseYouTube(text) {
  const s = String(text || '');
  const m = s.match(/https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s]*?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})[^\s]*/);
  if (!m) return null;
  const url = m[0];
  let start = 0;
  const t = url.match(/[?&](?:t|start)=([0-9hms]+)/);
  if (t) {
    const v = t[1];
    if (/^\d+$/.test(v)) start = Number(v);
    else {
      const h = v.match(/(\d+)h/); const mi = v.match(/(\d+)m/); const se = v.match(/(\d+)s/);
      start = (h ? Number(h[1]) * 3600 : 0) + (mi ? Number(mi[1]) * 60 : 0) + (se ? Number(se[1]) : 0);
    }
  }
  return { videoId: m[1], start, url: `https://www.youtube.com/watch?v=${m[1]}` };
}

/** "1:23"・"83"・"01:02:03" → 秒 */
const toSec = v => {
  const p = String(v || '').trim().split(':').map(Number);
  if (!p.length || p.some(n => !Number.isFinite(n) || n < 0)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
};

const SCORES = [
  [0, 'ほとんど分からない'],
  [1, '少し分かった'],
  [2, 'だいたい分かった'],
  [3, 'ほぼ全部分かった'],
];

export function createRaw({ app, esc, nav, store, go, startChunks, chunkSay }) {
  const R = { clips: [], cands: [], log: {}, ui: { score: null, checkScore: null }, add: null, yt: null, ytReady: null };

  async function load() {
    const [l, cs] = await Promise.all([store.get('meta', 'rawLog'), store.get('meta', 'rawCands')]);
    R.log = l && typeof l === 'object' ? l : {};
    R.cands = Array.isArray(cs) ? cs : [];
    try {
      const res = await fetch('data/raw/clips.json', { cache: 'no-cache' });
      if (res.ok) R.clips = ((await res.json()).clips || []).filter(c => c && c.id && c.url);
    } catch (e) { /* オフラインで未キャッシュ */ }
  }
  const save = () => store.put('meta', R.log, 'rawLog');
  const saveCands = () => store.put('meta', R.cands, 'rawCands');

  /** 候補（このスマホだけ）を、素材と同じ形にして使う */
  const fromCand = k => ({
    id: k.id, cand: true, title: k.title || 'YouTube の場面', provider: 'youtube', url: k.url, videoId: k.videoId,
    startSec: k.start, endSec: k.end, embed: 'youtube', level: '自分の候補（メモなし）',
    copyright: '動画の権利は投稿者にあります。YouTube 公式プレーヤーで再生しています。この候補はこのスマホの中だけにあります。',
    firstQs: GENERIC_QS, cues: k.cues || null, captionKind: k.captionKind || null,
  });
  const findClip = id => R.clips.find(x => x.id === id) || (R.cands.find(k => k.id === id) && fromCand(R.cands.find(k => k.id === id)));
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
    const mine = R.cands.map(k => `
        <a class="row-link" href="#/raw/${encodeURIComponent(k.id)}">
          <span class="t"><b>${esc(k.title || 'YouTube の場面')}</b>
            <span>${esc(span({ startSec: k.start, endSec: k.end }))}${k.cues ? ` · ${esc(CAPTION_KIND[k.captionKind] || CAPTION_KIND.unknown)}` : ''}</span></span>
          <span class="n">${esc(stateOf(k.id))}</span>
        </a>`).join('');
    return `
      <p class="caption" style="text-align:left;margin:0 16px 12px">本物の日本語の短い場面を、まず字幕なしで聞き、要点と理解度を記録してから確かめます。素材はリンクだけで、動画は公式のサイト・プレーヤーで見ます。</p>
      <section class="group" aria-label="素材">${rows || '<p class="small" style="padding:16px">素材を読み込めませんでした。電波のあるところで一度開いてください。</p>'}</section>
      <section class="group" aria-label="自分の候補">
        <div class="kv"><span>自分の候補（このスマホだけ）</span><b>${R.cands.length}</b></div>
        ${mine}
        <a class="row-link" href="#/raw/add"><span class="t"><b>＋ YouTube の場面を追加</b><span>リンクを貼る・YouTube から「共有 → Grass」・学習パックを読み込む</span></span><span class="n">›</span></a>
      </section>`;
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
    const c = findClip(id);
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
        <label class="field">聞き取れなかったところ（あれば）<input data-raw="cnote" autocomplete="off" placeholder="例：「なるべく」が聞こえなかった" value="${esc(R.ui.cnote || '')}"></label>
        <button class="outline" data-act="raw-check" data-id="${esc(c.id)}" ${cs == null ? 'disabled' : ''}>確認後の理解度を記録する</button>
      </section>`;

    const kind = CAPTION_KIND[c.captionKind] || CAPTION_KIND.unknown;
    const cues = c.cues?.length ? `
      <section class="card-box" aria-label="字幕">
        <p class="label">字幕（押すとそこから再生）· ${esc(kind)}</p>
        ${c.captionKind !== 'manual' ? '<p class="caption" style="margin:0;text-align:left">自動字幕には聞き間違いがあります。文化の話として読む前に、音で確かめてください。</p>' : ''}
        <ol class="raw-cues">${c.cues.map(q => `<li><button class="raw-cue" data-act="raw-cue" data-id="${esc(c.id)}" data-s="${q.s}"><span class="k">${esc(mmss(Math.floor(q.s)))}</span><span>${esc(q.t)}</span></button></li>`).join('')}</ol>
      </section>` : '';
    const candBox = c.cand ? `
      <section class="card-box" aria-label="候補">
        <p class="label">この候補のメモ</p>
        <p class="small" style="margin:0">表現・文化メモはまだありません。「学習リクエストをコピー」して Slack に貼ると、Robert と Kairos がメモを作ります（字幕の全文は入りません）。</p>
        <button class="outline" data-act="raw-req" data-id="${esc(c.id)}">学習リクエストをコピー</button>
        <button class="text-btn" data-act="raw-del" data-id="${esc(c.id)}">この候補を削除</button>
        <p class="msg ok" id="raw-req-msg" hidden></p>
      </section>` : '';

    return `${head}${lockedBox}
      <section class="card-box" aria-label="聞き直す">
        <p class="label">2. 聞き直して確かめる（字幕・スクリプトを使ってよい）</p>
        ${playerBox(c, r)}
        ${c.scene ? `<p class="scene" style="margin:0">${esc(c.scene)}</p>` : ''}
        <ol class="raw-qs ans">${qa}</ol>
      </section>
      ${cues}
      ${ex ? `<section class="card-box" aria-label="表現"><p class="label">拾った表現</p><ul class="raw-ex">${ex}</ul></section>` : ''}
      ${cu}${hu}
      ${sp ? `<section class="group" aria-label="話す">${sp}</section>` : ''}
      ${candBox}${checkBox}${copy}`;
  }

  /* ---------------- 候補を追加 ---------------- */

  function renderAdd() {
    const a = R.add || {};
    const dur = a.videoId && a.end > a.start ? a.end - a.start : null;
    const warn = dur != null && (dur < 20 || dur > 120) ? `<p class="msg err" style="margin:0">いまは ${dur}秒です。30〜90秒くらいがおすすめです。</p>` : '';
    return `
      <section class="card-box" aria-label="リンク">
        <p class="label">1. YouTube のリンク</p>
        <p class="small" style="margin:0">YouTube アプリの「共有 → Grass」でも、ここに貼り付けてもかまいません。</p>
        <label class="field">リンク<input data-raw="url" value="${esc(a.raw || a.url || '')}" autocomplete="off" inputmode="url" placeholder="https://youtu.be/..."></label>
        <label class="field">名前（あとで分かるように・空でも可）<input data-raw="title" value="${esc(a.title || '')}" autocomplete="off"></label>
        <button class="outline" data-act="raw-parse">読み込む</button>
        ${a.error ? `<p class="msg err" style="margin:0">${esc(a.error)}</p>` : ''}
      </section>
      ${a.videoId ? `
      <section class="card-box" aria-label="場面">
        <p class="label">2. 場面の始まりと終わりに印を付ける</p>
        <p class="small" style="margin:0">動画を流して、始まりで「ここから」、終わりで「ここまで」。時間を直接直してもかまいません（動画は切り取りもダウンロードもしません）。</p>
        <div class="raw-player" id="raw-yt" aria-label="動画"></div>
        <button class="primary" data-act="raw-yt" data-id="add">▶ 動画を流す</button>
        <p class="msg err" id="raw-yt-err" hidden></p>
        <div class="grid2">
          <button class="outline" data-act="raw-mark" data-v="start">ここから</button>
          <button class="outline" data-act="raw-mark" data-v="end">ここまで</button>
        </div>
        <div class="grid2">
          <label class="field">始まり<input data-raw="s" value="${esc(mmss(a.start || 0))}" inputmode="numeric"></label>
          <label class="field">終わり<input data-raw="e" value="${esc(a.end ? mmss(a.end) : '')}" inputmode="numeric" placeholder="例 1:30"></label>
        </div>
        ${dur != null ? `<p class="small" style="margin:0">長さ ${dur}秒</p>` : ''}
        ${warn}
        <button class="primary ink" data-act="raw-save" ${dur ? '' : 'disabled'}>候補に入れる</button>
      </section>` : ''}
      <section class="card-box" aria-label="学習パック">
        <p class="label">学習パックを読み込む（PC の字幕助手から）</p>
        <label class="field">ファイル<input type="file" data-raw="packfile" accept="application/json,.json"></label>
        <label class="field">または中身を貼り付け<textarea data-raw="pack" rows="2" class="export" placeholder='{"app":"grass-rawpack",...}'></textarea></label>
        <button class="outline" data-act="raw-pack">読み込む</button>
        ${R.ui.packMsg ? `<p class="msg ${R.ui.packMsg.ok ? 'ok' : 'err'}" style="margin:0">${esc(R.ui.packMsg.text)}</p>` : ''}
      </section>
      <p class="caption quiz-note">候補・字幕の文・メモは、このスマホの中だけに保存されます（公開されません）。</p>`;
  }

  /** 学習パック（grass-rawpack v1）を候補にする。同じ動画・同じ範囲は1つにまとめる */
  function addPack(pack) {
    if (!pack || pack.app !== 'grass-rawpack' || !/^[A-Za-z0-9_-]{11}$/.test(pack.videoId || '')) throw new Error('学習パックの形ではありません');
    const start = Math.max(0, Math.floor(Number(pack.start) || 0));
    const end = Math.floor(Number(pack.end) || 0);
    if (!(end > start)) throw new Error('場面の時間（start・end）が正しくありません');
    const cues = (Array.isArray(pack.cues) ? pack.cues : [])
      .map(q => ({ s: Number(q.s), e: Number(q.e), t: String(q.t || '').trim() }))
      .filter(q => Number.isFinite(q.s) && q.t && q.s >= start - 1 && q.s <= end + 1)
      .slice(0, 200);
    const key = `${pack.videoId}|${start}|${end}`;
    const have = R.cands.find(k => `${k.videoId}|${k.start}|${k.end}` === key);
    const item = {
      id: have?.id || `C-${Date.now().toString(36)}`, videoId: pack.videoId, url: `https://www.youtube.com/watch?v=${pack.videoId}`,
      title: String(pack.title || '').slice(0, 120), start, end, lang: pack.lang || null,
      captionKind: ['manual', 'auto'].includes(pack.captionKind) ? pack.captionKind : 'unknown',
      cues: cues.length ? cues : null, source: 'pack', at: Date.now(),
    };
    if (have) Object.assign(have, item); else R.cands.push(item);
    return { item, updated: !!have, cues: cues.length };
  }

  /** YouTube アプリの「共有 → Grass」で開かれたとき（manifest の share_target） */
  function takeShare() {
    const q = new URLSearchParams(location.search);
    if (!q.has('url') && !q.has('text') && !q.has('title')) return false;
    const all = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
    const y = parseYouTube(all);
    R.add = y ? { ...y, raw: y.url, title: (q.get('title') || '').slice(0, 120), end: 0 } : { raw: all, error: 'YouTube のリンクが見つかりませんでした' };
    history.replaceState(null, '', `${location.pathname}#/raw/add`);
    return true;
  }

  function render(arg) {
    stopYt();                                          // 画面を作り直すときだけ（点数を選ぶ・字幕スイッチは作り直さない）
    const id = arg ? decodeURIComponent(arg) : '';
    if (id && R.ui.id !== id) R.ui = { id, score: null, checkScore: null, cnote: '' };
    app.innerHTML = `
      <div class="screen">
        <div class="scroll">
          <header class="top"><div><p class="date">本物の素材で、聞く → 確かめる</p><h1>生の日本語</h1></div></header>
          <main class="home raw">${id === 'add' ? renderAdd() : id ? renderClip(id) : renderList()}</main>
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

  const showYtMsg = text => {
    const err = document.getElementById('raw-yt-err');
    if (err) { err.textContent = text; err.hidden = false; }
  };

  async function playYt(c, from = null) {
    const here = () => location.hash === `#/raw/${encodeURIComponent(c.id)}` && document.getElementById('raw-yt')?.isConnected;
    if (!here()) return;
    const ok = await loadYtApi();
    if (!here()) return;                                // 読み込みを待つあいだに画面を離れた
    if (!ok || !window.YT?.Player) {
      R.ytReady = null;
      showYtMsg('プレーヤーを読み込めませんでした（通信を確認してください）。「YouTube で開く」から見られます。');
      return;
    }
    const at = from ?? c.startSec;
    if (R.yt) { R.yt.seekTo(at, true); R.yt.playVideo(); return; }
    const box = document.getElementById('raw-yt');
    let started = false;
    const vars = { start: Math.floor(at), playsinline: 1, rel: 0, cc_load_policy: 0 };
    if (c.endSec && c.id !== 'add') vars.end = c.endSec;      // 候補の追加画面では最後まで流せる
    R.yt = new window.YT.Player(box, {
      videoId: c.videoId,
      playerVars: vars,
      events: {
        onReady: e => { if (from != null) e.target.seekTo(from, true); e.target.playVideo(); },
        onStateChange: e => { if (e.data === 1) started = true; },   // 1 = 再生中
        onError: e => showYtMsg([101, 150].includes(e.data)
          ? 'この動画は、ほかのサイトでの再生が許可されていません。「YouTube で開く」から見てください。'
          : 'プレーヤーでエラーが起きました。「YouTube で開く」から見られます。'),
      },
    });
    setTimeout(() => {                                  // 自動再生が止められたとき：プレーヤーの ▶ を押してもらう
      if (!started && here() && R.yt) showYtMsg('再生が始まらないときは、プレーヤーの ▶ を直接押してください。');
    }, 5000);
  }

  function stopYt() {
    if (R.yt) { try { R.yt.destroy(); } catch (e) { /* もう消えている */ } R.yt = null; }
  }
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/raw/')) stopYt(); });

  /* ---------------- 操作 ---------------- */

  /** 書きかけの要点は、打つたびに保存（公式サイトへ行って戻っても、再読み込みしても続きから） */
  let saveTimer = null;
  app.addEventListener('input', e => {
    if (e.target.dataset?.raw === 'cnote') { R.ui.cnote = e.target.value; return; }
    if (e.target.dataset?.raw !== 'gist') return;
    rec(e.target.dataset.id).draft = e.target.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  });

  app.addEventListener('change', async e => {
    if (e.target.dataset?.raw !== 'packfile' || !e.target.files?.[0]) return;
    try {
      const r = addPack(JSON.parse(await e.target.files[0].text()));
      await saveCands();
      R.ui.packMsg = { ok: true, text: `${r.updated ? '更新' : '追加'}しました（字幕 ${r.cues}行）` };
    } catch (err) {
      R.ui.packMsg = { ok: false, text: err instanceof SyntaxError ? 'ファイルが JSON として読めません' : err.message };
    }
    render('add');
  });

  const keepTop = fn => {
    const top = app.querySelector('.scroll')?.scrollTop || 0;
    fn();
    app.querySelector('.scroll')?.scrollTo(0, top);
  };
  const again = () => keepTop(() => render(R.ui.id));
  const pick = (act, el, btnSel) => {
    app.querySelectorAll(`[data-act="${act}"]`).forEach(b => b.setAttribute('aria-pressed', String(b === el)));
    const btn = app.querySelector(btnSel);
    if (btn) btn.disabled = false;
  };
  const clip = id => findClip(id);
  const addClip = () => (R.add?.videoId ? { id: 'add', videoId: R.add.videoId, startSec: R.add.start || 0, endSec: 0 } : null);
  const readAddInputs = () => {
    if (!R.add) R.add = {};
    const v = k => app.querySelector(`[data-raw="${k}"]`)?.value;
    if (v('url') != null) R.add.raw = v('url');
    if (v('title') != null) R.add.title = v('title').trim().slice(0, 120);
    const s = toSec(v('s'));
    const e = toSec(v('e'));
    if (s != null && R.add.videoId) R.add.start = s;
    if (e != null && v('e') !== '' && R.add.videoId) R.add.end = e;
  };
  const copyText = async text => {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
  };

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
      if (el.dataset.id === 'add') { readAddInputs(); const c = addClip(); if (c) playYt(c, R.add.start || 0); return; }
      const c = clip(el.dataset.id);
      if (!c) return;
      const r = rec(c.id);
      if (r.first) { r.replays += 1; save(); }
      playYt(c);
    },
    // 点数と字幕スイッチは、その場で表示だけ変える（画面を作り直さないので、再生中のプレーヤーも入力中の文も消えない）
    'raw-score': el => { R.ui.score = Number(el.dataset.v); pick('raw-score', el, '[data-act="raw-first"]'); },
    'raw-cscore': el => { R.ui.checkScore = Number(el.dataset.v); pick('raw-cscore', el, '[data-act="raw-check"]'); },
    'raw-subs': async el => { const r = rec(el.dataset.id); r.subs = !r.subs; el.setAttribute('aria-pressed', String(r.subs)); await save(); },
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
    'raw-cue': el => {
      const c = clip(el.dataset.id);
      if (!c) return;
      const sec = Number(el.dataset.s);
      if (R.yt) { R.yt.seekTo(sec, true); R.yt.playVideo(); } else playYt(c, sec);
      document.getElementById('raw-yt')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    'raw-parse': () => {
      readAddInputs();
      const y = parseYouTube(R.add.raw);
      stopYt();
      R.add = y ? { ...y, raw: R.add.raw, title: R.add.title || '', end: 0 } : { raw: R.add.raw, title: R.add.title, error: 'YouTube のリンクが見つかりませんでした（youtu.be/… または youtube.com/watch?v=…）' };
      render('add');
    },
    'raw-mark': el => {
      readAddInputs();
      if (!R.yt?.getCurrentTime) { const m = document.getElementById('raw-yt-err'); if (m) { m.textContent = '先に「▶ 動画を流す」で再生してください。'; m.hidden = false; } return; }
      const t = Math.floor(R.yt.getCurrentTime());
      if (el.dataset.v === 'start') R.add.start = t; else R.add.end = t;
      const inp = app.querySelector(`[data-raw="${el.dataset.v === 'start' ? 's' : 'e'}"]`);
      if (inp) inp.value = mmss(t);
      const btn = app.querySelector('[data-act="raw-save"]');
      if (btn) btn.disabled = !(R.add.end > (R.add.start || 0));
    },
    'raw-save': async () => {
      readAddInputs();
      const a = R.add;
      if (!a?.videoId || !(a.end > (a.start || 0))) return;
      const res = addPack({ app: 'grass-rawpack', videoId: a.videoId, title: a.title, start: a.start || 0, end: a.end, cues: [] });
      res.item.source = 'link';
      await saveCands();
      R.add = null;
      stopYt();
      go(`#/raw/${encodeURIComponent(res.item.id)}`);
    },
    'raw-pack': async () => {
      const text = String(app.querySelector('[data-raw="pack"]')?.value || '').trim();
      try {
        const r = addPack(JSON.parse(text));
        await saveCands();
        R.ui.packMsg = { ok: true, text: `${r.updated ? '更新' : '追加'}しました（字幕 ${r.cues}行）` };
      } catch (e) {
        R.ui.packMsg = { ok: false, text: e instanceof SyntaxError ? '貼り付けた文が JSON として読めません' : e.message };
      }
      again();
    },
    'raw-req': async el => {
      const k = R.cands.find(x => x.id === el.dataset.id);
      if (!k) return;
      const req = { app: 'grass-raw-request', version: 1, videoId: k.videoId, url: `${k.url}&t=${k.start}s`, title: k.title || '', start: k.start, end: k.end, captionKind: k.captionKind || null, cueLines: k.cues?.length || 0 };
      const ok = await copyText(JSON.stringify(req));
      const m = document.getElementById('raw-req-msg');
      if (m) { m.textContent = ok ? 'コピーしました。Slack のスレッドに貼ってください。' : JSON.stringify(req); m.hidden = false; }
    },
    'raw-del': async el => {
      R.cands = R.cands.filter(k => k.id !== el.dataset.id);
      delete R.log[el.dataset.id];
      await Promise.all([saveCands(), save()]);
      stopYt();
      go('#/raw');
    },
  };

  const exportData = () => ({ rawLog: R.log, rawCands: R.cands });
  async function importData(data) {
    let n = 0;
    for (const k of Array.isArray(data?.rawCands) ? data.rawCands : []) {
      if (k?.videoId && !R.cands.some(x => x.id === k.id)) R.cands.push(k);
    }
    await saveCands();
    for (const [id, v] of Object.entries(data?.rawLog || {})) {
      if (!R.log[id] || (!R.log[id].first && v?.first)) { R.log[id] = v; n += 1; }
    }
    await save();
    return n;
  }

  return { load, render, actions, takeShare, doneCount, count: () => R.clips.length, exportData, importData, _state: R };
}
