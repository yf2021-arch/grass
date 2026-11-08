// 散歩モード（v1.9.0）：画面を見ずに、手を使わずに聞く
//   #/walk … 設定 → 始める → あとはイヤホンのボタンかロック画面で操作
//
// 流すもの（どれを入れるか選べる）
//   単語   … カードの音声パック（このスマホだけ）。例文 → 表現 → 例文。例文の音声がないカードは 表現 → 表現
//   話す   … data/chunks.json と自分の文。文 → 間（あとについて言う）→ 文
//   聴解   … 練習で一度でも答えた聴解問題だけ（まだ解いていない問題は入れない：初回の結果を守るため）
//            会話と質問 → 選択肢（あれば）→ 間 → 正解（「正解は2番。〜」の音声があれば）
//
// 操作：画面のボタン、またはイヤホン・ロック画面（Media Session）
//   再生／一時停止 ・ 前の曲＝今の項目をもう一度 ・ 次の曲＝次の項目へ
// 間（無音）も音声ファイルとして鳴らす。タイマーを使わないので、画面を消しても止まりにくい。
// 散歩モードは復習の評価・練習の初回結果・書き取りには何も記録しない（散歩した時間だけ meta の walkLog に残す）。

const KINDS = [['card', '単語'], ['speak', '話す'], ['quiz', '聴解']];
const SIZES = [10, 20, 40];
const GAPS = [2, 4, 6];
const LOG_MAX = 400;

export function createWalk({ app, esc, nav, store, todayStr, ICON, cards, isDue, cardAudio, clipUrl, chunks, quizItems }) {
  const W = {
    settings: { card: true, speak: true, quiz: true, scope: 'due', n: 20, gap: 4, speed: 1, loop: false, text: true },
    log: [],
    run: null,       // { items, i, j, token, startedAt, playing }
  };
  const el = typeof Audio !== 'undefined' ? new Audio() : null;
  const silence = new Map();
  let objUrl = null;

  async function load() {
    const [s, l] = await Promise.all([store.get('meta', 'walkSettings'), store.get('meta', 'walkLog')]);
    if (s && typeof s === 'object') Object.assign(W.settings, s);
    W.log = Array.isArray(l) ? l : [];
    if (el) {
      el.preload = 'auto';
      el.addEventListener('ended', () => advance());
      el.addEventListener('error', () => { if (W.run?.playing) advance(); });
    }
  }
  const saveSettings = () => store.put('meta', W.settings, 'walkSettings');

  /* ---------------- 無音 ---------------- */

  /** n 秒の無音 WAV（8kHz・8bit・モノラル）。一度作ったら使い回す */
  function silenceUrl(sec) {
    if (silence.has(sec)) return silence.get(sec);
    const rate = 8000;
    const n = Math.round(rate * sec);
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, n, true);
    new Uint8Array(buf, 44).fill(128);
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    silence.set(sec, url);
    return url;
  }

  /* ---------------- 流すものを集める ---------------- */

  const shuffle = a => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };
  const val = (c, k) => String(c?.[k] ?? '').trim();
  const pub = (id, key) => ({ t: 'clip', get: async () => clipUrl(id, key) });
  const priv = (id, key) => ({ t: 'clip', get: async () => cardAudio.url(id, key), own: true });
  const gap = sec => ({ t: 'gap', sec });

  function cardItems() {
    const st = W.settings.scope;
    return cards()
      .filter(c => c.ID && cardAudio.has(c.ID, 'w'))
      .filter(c => (st === 'due' ? isDue(c) : ['復習中', '使える'].includes(val(c, '状態'))))
      .map(c => {
        const ex = cardAudio.has(c.ID, 'ex');
        const steps = ex
          ? [priv(c.ID, 'ex'), gap(1.5), priv(c.ID, 'w'), gap(1.5), priv(c.ID, 'ex')]
          : [priv(c.ID, 'w'), gap(2), priv(c.ID, 'w')];
        return { kind: '単語', title: val(c, '表現'), sub: val(c, '日本語の意味') || val(c, '英語の意味'), steps };
      });
  }

  function speakItems() {
    return chunks()
      .filter(c => c.id && c.say && clipUrl(c.id, 'say'))
      .map(c => ({ kind: '話す', title: c.say, sub: c.scene || '', steps: [pub(c.id, 'say'), gap(3), pub(c.id, 'say')] }));
  }

  function quizWalkItems() {
    return quizItems()
      .filter(x => clipUrl(x.id, 'q'))
      .map(x => {
        const steps = [pub(x.id, 'q')];
        if (clipUrl(x.id, 'o')) steps.push(gap(1), pub(x.id, 'o'));
        steps.push(gap(4));                        // 頭の中で答える間
        if (clipUrl(x.id, 'a')) steps.push(pub(x.id, 'a'));
        return { kind: '聴解', title: `${x.id} · ${x.question}`, sub: `正解：${x.answer + 1}番 ${x.options[x.answer]}`, steps };
      });
  }

  /** 単語・話す・聴解を交互に並べる */
  function buildList() {
    const s = W.settings;
    const lists = [s.card && shuffle(cardItems()), s.speak && shuffle(speakItems()), s.quiz && shuffle(quizWalkItems())].filter(l => l && l.length);
    const out = [];
    for (let k = 0; out.length < s.n && lists.some(l => k < l.length); k += 1) {
      for (const l of lists) if (k < l.length && out.length < s.n) out.push(l[k]);
    }
    return out.map(it => ({ ...it, steps: [...it.steps, gap(s.gap)] }));
  }

  const counts = () => ({ card: cardItems().length, speak: speakItems().length, quiz: quizWalkItems().length });

  /* ---------------- 再生 ---------------- */

  const here = () => location.hash.startsWith('#/walk');

  async function playStep() {
    const r = W.run;
    if (!r || !el) return;
    const my = (r.token += 1);
    const item = r.items[r.i];
    if (!item) { finish(); return; }
    const st = item.steps[r.j];
    if (!st) { r.i += 1; r.j = 0; return playStep(); }
    if (r.j === 0) { setMeta(); if (here()) updateDom(); }
    let url = null;
    if (st.t === 'gap') url = silenceUrl(st.sec);
    else {
      try { url = await st.get(); } catch (e) { url = null; }
      if (my !== r.token || W.run !== r) { if (st.own && url) URL.revokeObjectURL(url); return; }   // 途中で操作された
      if (st.own && url) { if (objUrl) URL.revokeObjectURL(objUrl); objUrl = url; }
    }
    if (!url) { r.j += 1; return playStep(); }        // 音声がない部分は飛ばす
    el.src = url;
    el.playbackRate = st.t === 'gap' ? 1 : W.settings.speed;
    el.preservesPitch = true;
    try {
      await el.play();
      r.playing = true;
    } catch (e) {
      r.playing = false;                               // 自動再生が止められた：画面の再生ボタンで続ける
    }
    syncState();
  }

  function advance() {
    const r = W.run;
    if (!r || !r.playing) return;
    r.j += 1;
    playStep();
  }

  function start() {
    const items = buildList();
    if (!items.length || !el) return;
    W.run = { items, i: 0, j: 0, token: 0, startedAt: Date.now(), playing: false };
    setHandlers();
    render();
    playStep();
  }

  function again() { const r = W.run; if (!r) return; r.j = 0; r.playing = true; playStep(); }
  function next() { const r = W.run; if (!r) return; r.i += 1; r.j = 0; r.playing = true; playStep(); }
  function back() {                                     // 画面の「前へ」：ひとつ前の項目
    const r = W.run;
    if (!r) return;
    r.i = Math.max(0, r.i - 1); r.j = 0; r.playing = true; playStep();
  }

  function toggle() {
    const r = W.run;
    if (!r || !el) return;
    if (r.playing) { el.pause(); r.playing = false; syncState(); }
    else if (el.src && !el.ended) { el.play().then(() => { r.playing = true; syncState(); }).catch(() => {}); }
    else { r.playing = true; playStep(); }
  }

  async function stop(done = false) {
    const r = W.run;
    if (!r) return;
    el?.pause();
    r.token += 1;
    const ms = Date.now() - r.startedAt;
    if (ms > 15000) {
      W.log.push({ date: todayStr(), items: Math.min(r.i + (done ? 0 : 1), r.items.length), ms, at: Date.now() });
      await store.put('meta', W.log.slice(-LOG_MAX), 'walkLog');
    }
    W.run = null;
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    if ('mediaSession' in navigator) { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; }
    if (here()) render();
  }

  function finish() {
    const r = W.run;
    if (!r) return;
    if (W.settings.loop && r.items.length) { r.i = 0; r.j = 0; playStep(); return; }
    stop(true);
  }

  /* ---------------- イヤホン・ロック画面 ---------------- */

  function setHandlers() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { /* 対応していない操作 */ } };
    set('play', () => toggle());
    set('pause', () => toggle());
    set('previoustrack', () => again());
    set('nexttrack', () => next());
    set('stop', () => stop());
  }

  function setMeta() {
    const r = W.run;
    if (!r || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const it = r.items[r.i];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: W.settings.text ? it.title : `${it.kind} ${r.i + 1}`,
      artist: `Grass 散歩モード · ${it.kind}`,
      album: `${r.i + 1} / ${r.items.length}`,
      artwork: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }

  function syncState() {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = W.run?.playing ? 'playing' : 'paused';
    if (here()) updateDom();
  }

  /* ---------------- 画面 ---------------- */

  const todayMin = () => Math.round(W.log.filter(e => e.date === todayStr()).reduce((s, e) => s + e.ms, 0) / 60000);

  function render() {
    app.innerHTML = `
      <div class="screen">
        <div class="scroll">
          <header class="top">
            <div><p class="date">画面を消しても続きます · 今日 ${todayMin()}分</p><h1>散歩モード</h1></div>
          </header>
          <main class="home walk">${W.run ? playerView() : setupView()}</main>
        </div>
        ${nav('walk')}
      </div>`;
  }

  function setupView() {
    const s = W.settings;
    const c = counts();
    const chip = (act, v, on, label) => `<button class="chip" aria-pressed="${on}" data-act="${act}" data-v="${esc(String(v))}">${esc(label)}</button>`;
    const kinds = KINDS.map(([k, l]) => chip('walk-kind', k, s[k], `${l}（${c[k]}）`)).join('');
    const total = (s.card ? c.card : 0) + (s.speak ? c.speak : 0) + (s.quiz ? c.quiz : 0);
    const n = Math.min(total, s.n);
    const hints = [];
    if (!cardAudio.count()) hints.push('単語：カードの音声パックがまだありません（設定 → 音声パックを読み込む）');
    else if (s.card && !c.card) hints.push(s.scope === 'due' ? '単語：今日の復習で音声のあるカードがありません。「学習中ぜんぶ」にすると増えます' : '単語：音声のあるカードがありません');
    if (s.quiz && !c.quiz) hints.push('聴解：BJT 対策の「練習」で一度答えた問題だけが入ります（まだ解いていない問題は、初回の結果を守るため入れません）');
    return `
      <section class="card-box" aria-label="流すもの">
        <p class="label">流すもの</p>
        <div class="frow wrap" role="group" aria-label="種類">${kinds}</div>
        ${s.card ? `<div class="frow wrap" role="group" aria-label="単語の範囲">${chip('walk-scope', 'due', s.scope === 'due', '単語：今日の復習')}${chip('walk-scope', 'all', s.scope === 'all', '単語：学習中ぜんぶ')}</div>` : ''}
        <p class="small" style="margin:0">単語は 例文 → 表現 → 例文、話すは 文 → 間 → 文、聴解は 会話 → 選択肢 → 間 → 正解 の順に流れます。</p>
        ${hints.map(h => `<p class="caption" style="margin:0;text-align:left">${esc(h)}</p>`).join('')}
      </section>
      <section class="card-box" aria-label="流し方">
        <p class="label">流し方</p>
        <div class="frow" role="group" aria-label="数">${SIZES.map(v => chip('walk-n', v, s.n === v, `${v}個`)).join('')}</div>
        <div class="frow" role="group" aria-label="項目のあいだ">${GAPS.map(v => chip('walk-gap', v, s.gap === v, `あいだ ${v}秒`)).join('')}</div>
        <div class="frow wrap" role="group" aria-label="速さとくり返し">
          ${chip('walk-speed', 1, s.speed === 1, '原速')}${chip('walk-speed', 0.8, s.speed === 0.8, '0.8倍')}
          ${chip('walk-loop', 1, s.loop, '最後まで行ったら最初から')}
        </div>
        <button class="primary" data-act="walk-start" ${n ? '' : 'disabled'}>${n ? `始める（${n}個 · 約${Math.max(1, Math.round((n * (18 + s.gap)) / 60))}分）` : '流せるものがありません'}</button>
        <p class="caption" style="margin:0;text-align:left">イヤホンのボタン・ロック画面で：再生／一時停止、前の曲＝もう一度、次の曲＝次へ。散歩モードは復習の評価や練習の結果には何も記録しません。</p>
      </section>`;
  }

  function playerView() {
    const r = W.run;
    const it = r.items[Math.min(r.i, r.items.length - 1)];
    const s = W.settings;
    return `
      <section class="card-box walk-now" aria-label="再生中">
        <p class="label" data-w="pos">${r.i + 1} / ${r.items.length} · ${esc(it.kind)}</p>
        <p class="walk-title" data-w="title">${s.text ? esc(it.title) : '（文字を隠しています）'}</p>
        <p class="small walk-sub" data-w="sub">${s.text ? esc(it.sub) : ''}</p>
        <div class="walk-ctrl">
          <button class="outline" data-act="walk-back" aria-label="前の項目">前へ</button>
          <button class="primary" data-act="walk-toggle" data-w="toggle">${r.playing ? '一時停止' : '再生'}</button>
          <button class="outline" data-act="walk-next" aria-label="次の項目">次へ</button>
        </div>
        <button class="outline" data-act="walk-again">今の項目をもう一度</button>
        <div class="frow wrap">
          <button class="chip" aria-pressed="${!s.text}" data-act="walk-text">文字を隠す</button>
          <button class="chip" aria-pressed="${s.speed === 0.8}" data-act="walk-speed" data-v="${s.speed === 0.8 ? 1 : 0.8}">0.8倍</button>
        </div>
        <button class="text-btn" data-act="walk-stop">終わる</button>
      </section>`;
  }

  /** 項目が変わったときだけ、文字とボタンを書きかえる（画面を作り直さない） */
  function updateDom() {
    const r = W.run;
    const q = k => app.querySelector(`[data-w="${k}"]`);
    if (!r || !q('pos')) return;
    const it = r.items[Math.min(r.i, r.items.length - 1)];
    q('pos').textContent = `${r.i + 1} / ${r.items.length} · ${it.kind}`;
    q('title').textContent = W.settings.text ? it.title : '（文字を隠しています）';
    q('sub').textContent = W.settings.text ? it.sub : '';
    q('toggle').textContent = r.playing ? '一時停止' : '再生';
  }

  /* ---------------- 操作 ---------------- */

  const setS = async (k, v) => { W.settings[k] = v; await saveSettings(); render(); };
  const actions = {
    'walk-kind': el2 => setS(el2.dataset.v, !W.settings[el2.dataset.v]),
    'walk-scope': el2 => setS('scope', el2.dataset.v),
    'walk-n': el2 => setS('n', Number(el2.dataset.v)),
    'walk-gap': el2 => setS('gap', Number(el2.dataset.v)),
    'walk-speed': el2 => {
      W.settings.speed = Number(el2.dataset.v);
      saveSettings();
      if (el && W.run) el.playbackRate = W.settings.speed;
      render();
    },
    'walk-loop': () => setS('loop', !W.settings.loop),
    'walk-text': () => { W.settings.text = !W.settings.text; saveSettings(); setMeta(); render(); },
    'walk-start': () => start(),
    'walk-toggle': () => toggle(),
    'walk-next': () => next(),
    'walk-back': () => back(),
    'walk-again': () => again(),
    'walk-stop': () => stop(),
  };

  return { load, render, actions, active: () => !!W.run, todayMin, _state: W };
}
