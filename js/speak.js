// 話す練習（v1.3.0／自分の文は v1.5.0）
//   #/speak … 話すのホーム：チャンク練習の入口と「詰まりメモ」
//   #/drill … 1問ずつの練習（ナビを隠す）
//
// モード
//   scene … 場面を見て日本語で言う → 答えを見る（答えを見るまでの秒数を記録）
//   look  … 文を読む → 顔を上げて言う（Read and Look Up。顔を上げてから「言えた」までの秒数と、見直した回数を記録）
//
// データ：素材は data/chunks.json（架空の職場場面・公開）＋ シート「02_話すチャンク」の自分の文（同期で meta の sheetChunks に入る・非公開）。
//   記録と詰まりメモはスマホの中（meta ストア）にだけ保存し、シートには送らない。
// 詰まりメモは「まとめてコピー」で REGISTER: の文にして、Claude に貼るとカードになる。
//
// 音声：tools/make_audio.py（PC の AivisSpeech）で作った data/audio/ のファイルを再生する。
//   一度取ったファイルは sw.js が grass-audio キャッシュに入れ、次からは通信しない（キャッシュ優先）。
//   ファイル名に文の記号が入るので、作り直した文だけが新しく取られる。
//   自分の文（SP-xxxx）の音声は、カードの音声パック（tools/make_card_audio.py・このスマホだけ）から鳴らす。
//   どちらもない文は端末の読み上げ、それもなければ案内を出す。

const DRILL_SIZE = 5;
const LOG_MAX = 3000;
const AUDIO_CACHE = 'grass-audio';
const AUDIO_DIR = 'data/audio/';
const MINE = '自分の文';

export function createSpeak({ app, esc, go, nav, store, todayStr, addDays, ICON, cardAudio = null }) {
  const SP = {
    chunks: [],
    base: [],       // data/chunks.json（公開の30個）
    mine: [],       // シートの自分の文
    log: [],        // { date, id, mode, ms, peeks, ok, at }
    stuck: [],      // { id, text, answer, at, sent }
    filter: 'すべて',
    drill: null,
    ui: { open: null, copied: null, showSent: false, ttsMsg: null, dl: null },
    audio: { files: {}, credit: '', cached: 0 },
  };
  let player = null;
  let playerUrl = null;

  /* ---------------- 読み込み・保存 ---------------- */

  async function load() {
    const [log, stuck] = await Promise.all([store.get('meta', 'speakLog'), store.get('meta', 'stuck')]);
    SP.log = Array.isArray(log) ? log : [];
    SP.stuck = Array.isArray(stuck) ? stuck : [];
    try {
      const res = await fetch('data/chunks.json', { cache: 'no-cache' });
      if (res.ok) SP.base = (await res.json()).chunks || [];
    } catch (e) { /* オフラインで未キャッシュなら、自分の文と詰まりメモだけ使える */ }
    await reloadMine();
    await loadAudio();
  }

  /** 同期のあとにも呼ぶ：シートの自分の文を読み直し、公開の素材とまとめる */
  async function reloadMine() {
    const mine = await store.get('meta', 'sheetChunks');
    SP.mine = (Array.isArray(mine) ? mine : [])
      .filter(c => c && c.id && c.say)
      .map(c => ({ ...c, mine: true, v: Array.isArray(c.v) ? c.v : [] }));
    const seen = new Set(SP.mine.map(c => c.id));
    SP.chunks = [...SP.base.filter(c => !seen.has(c.id)), ...SP.mine];
    if (SP.filter !== 'すべて' && SP.filter !== MINE && !SP.chunks.some(c => c.fn === SP.filter)) SP.filter = 'すべて';
    if (SP.filter === MINE && !SP.mine.length) SP.filter = 'すべて';
  }

  const inFilter = (c, fn) => fn === 'すべて' || (fn === MINE ? c.mine : c.fn === fn);

  /** data/audio/manifest.json を読み、キャッシュから古い音声を片付ける（音声がなくても動く） */
  async function loadAudio() {
    try {
      const res = await fetch(`${AUDIO_DIR}manifest.json`, { cache: 'no-cache' });
      if (res.ok) {
        const m = await res.json();
        SP.audio.files = m.files || {};
        SP.audio.credit = m.credit || '';
      }
    } catch (e) { /* 音声なし */ }
    await countCached(true);
  }

  async function countCached(prune = false) {
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open(AUDIO_CACHE);
      const keys = await cache.keys();
      const want = new Set(Object.values(SP.audio.files));
      let n = 0;
      for (const req of keys) {
        const name = decodeURIComponent(new URL(req.url).pathname.split('/').pop());
        if (want.has(name)) n += 1;
        else if (prune && Object.keys(SP.audio.files).length) await cache.delete(req);
      }
      SP.audio.cached = n;
    } catch (e) { /* キャッシュが使えない環境 */ }
  }

  const audioTotal = () => new Set(Object.values(SP.audio.files)).size;

  const saveLog = () => store.put('meta', SP.log.slice(-LOG_MAX), 'speakLog');
  const saveStuck = () => store.put('meta', SP.stuck, 'stuck');
  const chunkById = id => SP.chunks.find(c => c.id === id);

  /* ---------------- 集計 ---------------- */

  function weekStats() {
    const since = addDays(todayStr(), -6);
    const week = SP.log.filter(e => e.date >= since);
    const ok = week.filter(e => e.ok && e.ms > 0);
    const avg = ok.length ? ok.reduce((s, e) => s + e.ms, 0) / ok.length / 1000 : null;
    return { n: week.length, ok: ok.length, stuck: week.filter(e => !e.ok).length, avg };
  }

  const todayCount = () => SP.log.filter(e => e.date === todayStr()).length;
  const openStuck = () => SP.stuck.filter(s => !s.sent);

  /** 出す順：まだ練習していない → 前回「詰まった」 → 前回からいちばん時間がたった */
  function pick(n, fn) {
    const last = new Map();
    SP.log.forEach(e => last.set(e.id, e));
    const pool = SP.chunks.filter(c => inFilter(c, fn));
    const rank = c => {
      const e = last.get(c.id);
      if (!e) return [0, 0];
      return [e.ok ? 2 : 1, e.at];
    };
    return pool
      .map((c, i) => ({ c, r: rank(c), i }))
      .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i)
      .slice(0, n)
      .map(x => x.c.id);
  }

  const secLabel = ms => `${(ms / 1000).toFixed(1)}秒`;

  /* ---------------- 音声 ---------------- */

  /** 音声ファイルを丸ごと取ってから鳴らす（<audio> の部分取得だとキャッシュとかみ合わないため）。
   *  ファイルがなければ端末の読み上げ。どちらもなければ false */
  async function playClip(chunkId, key, text) {
    const file = SP.audio.files[`${chunkId}:${key}`];
    if (file) {
      try {
        const res = await fetch(AUDIO_DIR + encodeURIComponent(file));
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (player) player.pause();
        if (playerUrl) URL.revokeObjectURL(playerUrl);
        playerUrl = URL.createObjectURL(blob);
        player = new Audio(playerUrl);
        await player.play();
        countCached().then(() => {});
        return true;
      } catch (e) { /* オフラインで未キャッシュなど → 端末の読み上げへ */ }
    }
    if (cardAudio?.has(chunkId, key)) {
      if (player) player.pause();
      if (await cardAudio.play(chunkId, key)) return true;
    }
    return say(text);
  }

  const hasClip = (chunkId, key) => !!SP.audio.files[`${chunkId}:${key}`] || !!cardAudio?.has(chunkId, key);

  async function downloadAll() {
    const names = [...new Set(Object.values(SP.audio.files))];
    if (!names.length || SP.ui.dl?.running) return;
    SP.ui.dl = { running: true, done: 0, total: names.length, failed: 0 };
    renderSpeak();
    const cache = 'caches' in window ? await caches.open(AUDIO_CACHE) : null;
    for (const name of names) {
      const url = AUDIO_DIR + encodeURIComponent(name);
      try {
        const hit = cache && await cache.match(url);
        if (!hit) {
          const res = await fetch(url);               // sw.js がキャッシュに入れる
          if (!res.ok) throw new Error(String(res.status));
          if (cache && !(await cache.match(url))) await cache.put(url, res.clone());   // SW がまだ動いていない最初の起動でも保存
          await res.arrayBuffer();
        }
      } catch (e) { SP.ui.dl.failed += 1; }
      SP.ui.dl.done += 1;
      if (SP.ui.dl.done % 10 === 0 && location.hash.startsWith('#/speak')) renderSpeak();
    }
    SP.ui.dl.running = false;
    await countCached();
    if (location.hash.startsWith('#/speak')) renderSpeak();
  }

  /* ---------------- 読み上げ（端末に日本語の声があるときだけ） ---------------- */

  function jaVoice() {
    if (!('speechSynthesis' in window)) return null;
    return speechSynthesis.getVoices().find(v => /^ja(-|_|$)/i.test(v.lang)) || null;
  }

  function say(text) {
    if (!('speechSynthesis' in window)) return false;
    const voice = jaVoice();
    if (!voice) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.95;
    speechSynthesis.speak(u);
    return true;
  }

  /* ---------------- 話すのホーム ---------------- */

  function renderSpeak() {
    const st = weekStats();
    const fns = ['すべて', ...(SP.mine.length ? [MINE] : []), ...new Set(SP.chunks.map(c => c.fn).filter(f => f && f !== MINE))];
    const chips = fns.map(f =>
      `<button class="chip" aria-pressed="${SP.filter === f}" data-act="sp-filter" data-v="${esc(f)}">${esc(f)}</button>`).join('');
    const count = SP.chunks.filter(c => inFilter(c, SP.filter)).length;
    const n = Math.min(DRILL_SIZE, count);

    const drillBox = SP.chunks.length ? `
      <section class="card-box" aria-label="チャンク練習">
        <div style="display:flex;flex-direction:column;gap:6px">
          <p class="label">チャンク練習 · 職場の決まった言い方 ${SP.chunks.length}個${SP.mine.length ? `（自分の文 ${SP.mine.length}）` : ''}</p>
          <p class="scene" style="font-size:14px">先に日本語で言ってから、答えと言い換えを確かめる。</p>
        </div>
        <div class="tiles">
          <div class="tile"><span>今週の練習</span><b>${st.n}</b></div>
          <div class="tile"><span>平均の反応（言えた）</span><b>${st.avg == null ? '—' : `${st.avg.toFixed(1)}<small>秒</small>`}</b></div>
        </div>
        <div class="frow" role="group" aria-label="機能で選ぶ">${chips}</div>
        <button class="primary" data-act="sp-start" data-mode="scene" ${n ? '' : 'disabled'}>場面から言う（${n}問）</button>
        <button class="outline" data-act="sp-start" data-mode="look" ${n ? '' : 'disabled'}>読んで、顔を上げて言う（${n}問）</button>
        <p class="caption" style="margin:-6px 0 0">まだ練習していないもの → 前回詰まったもの → 久しぶりのもの、の順に出ます</p>
      </section>`
      : `<section class="card-box"><p class="scene">練習の素材を読み込めませんでした。電波のあるところで一度開いてください。</p></section>`;

    const open = openStuck();
    const sent = SP.stuck.filter(s => s.sent);
    const items = open.map(s => {
      const editing = SP.ui.open === s.id;
      return `
        <li class="stuck-item">
          <div class="stuck-row">
            <span class="t"><b>${esc(s.text)}</b>${s.answer ? `<span class="ok-c">→ ${esc(s.answer)}</span>` : ''}<small>${esc(mdShort(s.at))}</small></span>
            <span class="stuck-btns">
              <button class="mini" data-act="sp-edit" data-id="${esc(s.id)}" aria-expanded="${editing}">${s.answer ? '直す' : '言い方'}</button>
              <button class="mini quiet" data-act="sp-del" data-id="${esc(s.id)}" aria-label="削除">${ICON.close}</button>
            </span>
          </div>
          ${editing ? `
            <form class="stuck-answer" data-form="stuck-answer" data-id="${esc(s.id)}">
              <label class="field">分かった言い方（日本語）
                <input name="answer" value="${esc(s.answer || '')}" autocomplete="off" enterkeyhint="done">
              </label>
              <button class="outline quiet" type="submit">保存</button>
            </form>` : ''}
        </li>`;
    }).join('');

    const copied = SP.ui.copied;
    const exportBox = open.length ? `
      <button class="outline" data-act="sp-copy">まとめてコピー（REGISTER: ${open.length}件）</button>
      ${copied ? `
        <p class="msg ${copied.ok ? 'ok' : 'err'}">${copied.ok ? 'コピーしました。Claude に貼り付けて送ると、カードになります。' : '自動でコピーできません。下の文を長押ししてコピーしてください。'}</p>
        ${copied.ok ? '' : `<textarea class="export" readonly rows="6">${esc(copied.text)}</textarea>`}
        <button class="text-btn" data-act="sp-sent">送った分を片付ける</button>` : ''}` : '';

    app.innerHTML = `
      <div class="screen">
        <div class="scroll">
          <header class="top">
            <div><p class="date">言う → 確かめる → 言い直す</p><h1>話す</h1></div>
          </header>
          <main class="home">
            ${drillBox}
            <section class="card-box stuck" aria-label="詰まりメモ">
              <div style="display:flex;flex-direction:column;gap:6px">
                <p class="label">詰まりメモ</p>
                <p class="scene" style="font-size:14px">日本語で言えなかったことを、その場で一行だけ。中国語・英語で書いてもかまいません。止まらずに「〜みたいなもの」と言い換えて先へ進み、あとでここを見返します。</p>
              </div>
              <form class="stuck-add" data-form="stuck">
                <label class="sr" for="stuck-text">言えなかったこと</label>
                <input id="stuck-text" name="text" placeholder="例：处理卡住了，怎么说？" autocomplete="off" enterkeyhint="done">
                <button class="primary ink" type="submit">追加</button>
              </form>
              ${open.length ? `<ul class="stuck-list">${items}</ul>` : '<p class="small">まだありません。</p>'}
              ${exportBox}
              ${sent.length ? `<button class="text-btn" data-act="sp-show-sent" aria-expanded="${SP.ui.showSent}">送信済み ${sent.length}件${SP.ui.showSent ? 'を閉じる' : 'を見る'}</button>` : ''}
              ${SP.ui.showSent && sent.length ? `<ul class="stuck-list sent">${sent.slice().reverse().map(s => `
                <li class="stuck-item"><div class="stuck-row"><span class="t"><b>${esc(s.text)}</b>${s.answer ? `<span>→ ${esc(s.answer)}</span>` : ''}</span>
                <span class="stuck-btns"><button class="mini quiet" data-act="sp-del" data-id="${esc(s.id)}" aria-label="削除">${ICON.close}</button></span></div></li>`).join('')}</ul>` : ''}
            </section>
            ${audioRow()}
            <p class="small" style="text-align:center">記録と詰まりメモは、このスマホの中にだけ保存されます</p>
          </main>
        </div>
        ${nav('speak')}
      </div>`;
  }

  function audioRow() {
    const total = audioTotal();
    if (!total) return '';
    const dl = SP.ui.dl;
    const all = SP.audio.cached >= total;
    let status;
    if (dl?.running) status = `ダウンロード中… ${dl.done} / ${dl.total}`;
    else if (all) status = `全部このスマホに保存済み（${total}）`;
    else status = `保存済み ${SP.audio.cached} / ${total} · 押した音声から順に保存されます`;
    return `
      <section class="group audio-row" aria-label="音声">
        <div class="kv"><span>音声</span><b>${esc(status)}</b></div>
        ${dl && !dl.running && dl.failed ? `<p class="msg err">${dl.failed}件を取れませんでした。電波のあるところでもう一度どうぞ。</p>` : ''}
        ${!all && !dl?.running ? '<button class="outline quiet" data-act="sp-dl">音声をまとめてダウンロード（Wi-Fi のときに）</button>' : ''}
        ${SP.audio.credit ? `<p class="small">${esc(SP.audio.credit)}</p>` : ''}
      </section>`;
  }

  function mdShort(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  /* ---------------- 練習 ---------------- */

  function startDrill(mode) {
    const ids = pick(DRILL_SIZE, SP.filter);
    if (!ids.length) return;
    SP.drill = { mode, ids, i: 0, phase: 'front', t0: 0, ms: 0, peeks: 0, peeking: false, results: [], startedAt: Date.now() };
    go('#/drill');
  }

  function drillHead() {
    const d = SP.drill;
    const pct = Math.round((d.i / d.ids.length) * 1000) / 10;
    const c = chunkById(d.ids[d.i]);
    return `
      <header class="rv-head">
        <div class="rv-bar">
          <button class="close" data-act="sp-quit" aria-label="練習をやめる">${ICON.close}</button>
          <span class="counter">${d.i + 1} / ${d.ids.length}</span>
          <span style="display:flex;gap:4px;padding-right:8px"><span class="pill">${esc(c?.fn || '')}</span>${c?.mine ? `<span class="pill">${MINE}</span>` : ''}</span>
        </div>
        <div class="progress" aria-hidden="true"><div style="width:${pct}%"></div></div>
      </header>`;
  }

  function renderDrill() {
    const d = SP.drill;
    if (!d) { go('#/speak'); return; }
    if (d.i >= d.ids.length) { renderDrillDone(); return; }
    const c = chunkById(d.ids[d.i]);
    if (!c) { d.i += 1; renderDrill(); return; }

    if (d.phase === 'front') {
      if (!d.t0) d.t0 = performance.now();
      const body = d.mode === 'scene'
        ? `<section class="sec"><h2>場面</h2><p class="meaning">${esc(c.scene)}</p></section>`
        : `<section class="sec"><h2>読んで覚える</h2><p class="look-text">${esc(c.say)}</p></section>
           <section class="sec"><h2>場面</h2><p class="scene">${esc(c.scene)}</p></section>`;
      const foot = d.mode === 'scene'
        ? `<p>声に出して日本語で言ってから、答えを見る</p><button class="reveal" data-act="sp-reveal">答えを見る</button>`
        : `<p>覚えたら、画面から目を離す</p><button class="reveal" data-act="sp-lookup">顔を上げる</button>`;
      app.innerHTML = `
        <div class="screen plain">
          ${drillHead()}
          <main class="scroll front">${body}</main>
          <footer class="rv-foot">${foot}</footer>
        </div>`;
      return;
    }

    if (d.phase === 'hidden') {
      app.innerHTML = `
        <div class="screen plain">
          ${drillHead()}
          <main class="scroll front lookup">
            <div class="lookup-box" aria-live="polite">
              ${d.peeking ? `<p class="look-text">${esc(c.say)}</p>` : `<p class="lookup-say">顔を上げて、<br>だれかに話すつもりで言う</p>`}
            </div>
            <p class="small" style="text-align:center">言えなかったら、一度だけ見てもう一度${d.peeks ? `（見た回数 ${d.peeks}）` : ''}</p>
          </main>
          <footer class="rv-foot">
            <button class="outline quiet" data-act="sp-peek" ${d.peeking ? 'disabled' : ''}>ちらっと見る</button>
            <button class="reveal" data-act="sp-said">言えた</button>
          </footer>
        </div>`;
      return;
    }

    // 答え
    const playable = key => hasClip(c.id, key) || 'speechSynthesis' in window;
    const vars = (c.v || []).map((x, k) => `
      <li><div class="v-row"><p>${esc(x.t)}</p>${playable(`v${k + 1}`) ? `<button class="mini quiet play" data-act="sp-tts" data-k="v${k + 1}" aria-label="読み上げる">${ICON.speaker}</button>` : ''}</div><small>${esc(x.n)}</small></li>`).join('');
    app.innerHTML = `
      <div class="screen plain">
        ${drillHead()}
        <main class="scroll back drill-back">
          <div class="say-row">
            <h1 class="say">${esc(c.say)}</h1>
            ${playable('say') ? `<button class="icon-btn" data-act="sp-tts" data-k="say" aria-label="読み上げる">${ICON.speaker}</button>` : ''}
          </div>
          ${SP.ui.ttsMsg ? `<p class="small">${esc(SP.ui.ttsMsg)}</p>` : ''}
          <p class="timer">${d.mode === 'scene' ? '答えを見るまで' : '顔を上げてから'} <b>${secLabel(d.ms)}</b>${d.mode === 'look' && d.peeks ? ` · 見た回数 ${d.peeks}` : ''}</p>
          ${c.pattern ? `<section class="panel fit"><h3>型</h3><p class="pattern">${esc(c.pattern)}</p></section>` : ''}
          ${c.note ? `<p class="scene" style="font-size:15px">${esc(c.note)}</p>` : ''}
          ${vars ? `<section class="sec"><h2>1か所変えて、言い直す</h2><ul class="variants">${vars}</ul></section>` : ''}
        </main>
        <footer class="rate-foot">
          <div class="rates two">
            <button class="btn-again" data-act="sp-rate" data-ok="0"><b>詰まった</b><small>次の練習でまた出る</small></button>
            <button class="btn-good" data-act="sp-rate" data-ok="1"><b>言えた</b><small>あとで、もう一度</small></button>
          </div>
        </footer>
      </div>`;
  }

  async function rateDrill(ok) {
    const d = SP.drill;
    if (!d || d.busy) return;
    d.busy = true;
    const c = chunkById(d.ids[d.i]);
    const entry = { date: todayStr(), id: c.id, mode: d.mode, ms: Math.round(d.ms), peeks: d.peeks, ok, at: Date.now() };
    SP.log.push(entry);
    d.results.push(entry);
    try { await saveLog(); } catch (e) { /* 保存に失敗しても練習は続ける */ }
    d.busy = false;
    d.i += 1;
    d.phase = 'front';
    d.t0 = 0;
    d.ms = 0;
    d.peeks = 0;
    d.peeking = false;
    SP.ui.ttsMsg = null;
    renderDrill();
    app.querySelector('.scroll')?.scrollTo(0, 0);
  }

  function renderDrillDone() {
    const d = SP.drill;
    const ok = d.results.filter(r => r.ok);
    const avg = ok.length ? ok.reduce((s, r) => s + r.ms, 0) / ok.length : 0;
    const sec = Math.round((Date.now() - d.startedAt) / 1000);
    const stuck = d.results.filter(r => !r.ok).map(r => chunkById(r.id)).filter(Boolean);
    app.innerHTML = `
      <div class="screen plain">
        <main class="done">
          <div class="done-top">
            <div class="check" aria-hidden="true">${ICON.check}</div>
            <h1>練習、完了</h1>
            <p>${d.results.length}問 · ${Math.floor(sec / 60)}分${sec % 60}秒</p>
          </div>
          <div class="res3 two">
            <div><b style="color:var(--good)">${ok.length}</b><span>言えた</span></div>
            <div><b style="color:var(--bad)">${d.results.length - ok.length}</b><span>詰まった</span></div>
          </div>
          <ul class="facts">
            <li><span>平均の反応（言えた）</span><b>${ok.length ? secLabel(avg) : '—'}</b></li>
            ${stuck.length ? `<li class="muted"><span>次にまた出る</span><b style="font-weight:500">${esc(stuck.map(c => c.pattern || c.say).join('／'))}</b></li>` : ''}
          </ul>
        </main>
        <footer class="done-foot">
          <button class="primary ink" data-act="sp-again">もう${DRILL_SIZE}問</button>
          <button class="text-btn" data-act="sp-home">話すに戻る</button>
        </footer>
      </div>`;
  }

  /* ---------------- 詰まりメモ ---------------- */

  function exportText(list) {
    const lines = list.map(s => `- ${s.text}${s.answer ? ` → 分かった言い方：${s.answer}` : ''}`);
    return [
      'REGISTER:',
      '職場や日常で、日本語で言えなかったことです。日本語で言えるように、カードにしてください。',
      ...lines,
    ].join('\n');
  }

  async function copyStuck() {
    const text = exportText(openStuck());
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); ok = true; }
    } catch (e) { ok = false; }
    SP.ui.copied = { ok, text, ids: openStuck().map(s => s.id) };
    renderSpeak();
  }

  async function onSubmit(form) {
    if (form.dataset.form === 'stuck') {
      const text = form.text.value.trim();
      if (!text) return true;
      SP.stuck.push({ id: `st-${Date.now().toString(36)}`, text, answer: '', at: Date.now(), sent: false });
      SP.ui.copied = null;
      await saveStuck();
      renderSpeak();
      document.getElementById('stuck-text')?.focus();
      return true;
    }
    if (form.dataset.form === 'stuck-answer') {
      const s = SP.stuck.find(x => x.id === form.dataset.id);
      if (s) s.answer = form.answer.value.trim();
      SP.ui.open = null;
      SP.ui.copied = null;
      await saveStuck();
      renderSpeak();
      return true;
    }
    return false;
  }

  /* ---------------- 操作 ---------------- */

  const actions = {
    'sp-filter': el => { SP.filter = el.dataset.v; renderSpeak(); },
    'sp-start': el => startDrill(el.dataset.mode),
    'sp-again': () => startDrill(SP.drill?.mode || 'scene'),
    'sp-home': () => { SP.drill = null; go('#/speak'); },
    'sp-quit': () => { SP.drill = null; go('#/speak'); },
    'sp-reveal': () => {
      const d = SP.drill;
      d.ms = performance.now() - d.t0;
      d.phase = 'back';
      renderDrill();
      app.querySelector('.scroll')?.scrollTo(0, 0);
    },
    'sp-lookup': () => {
      const d = SP.drill;
      d.phase = 'hidden';
      d.t0 = performance.now();      // 顔を上げてから計る
      renderDrill();
    },
    'sp-peek': () => {
      const d = SP.drill;
      if (d.peeking) return;
      d.peeks += 1;
      d.peeking = true;
      renderDrill();
      setTimeout(() => {
        if (SP.drill === d && d.phase === 'hidden') { d.peeking = false; renderDrill(); }
      }, 1500);
    },
    'sp-said': () => {
      const d = SP.drill;
      d.ms = performance.now() - d.t0;
      d.peeking = false;
      d.phase = 'back';
      renderDrill();
      app.querySelector('.scroll')?.scrollTo(0, 0);
    },
    'sp-rate': el => rateDrill(el.dataset.ok === '1'),
    'sp-tts': async el => {
      const c = chunkById(SP.drill?.ids[SP.drill.i]);
      if (!c) return;
      const key = el.dataset.k || 'say';
      const text = key === 'say' ? c.say : c.v?.[Number(key.slice(1)) - 1]?.t;
      if (!text) return;
      const ok = await playClip(c.id, key, text);
      const msg = ok ? null : (hasClip(c.id, key)
        ? '音声を取れませんでした（オフラインで、まだ保存していない音声です）'
        : 'この文の音声はまだありません。この端末には日本語の読み上げ音声もありません');
      if (msg !== SP.ui.ttsMsg) {
        SP.ui.ttsMsg = msg;
        const top = app.querySelector('.scroll')?.scrollTop || 0;
        renderDrill();
        app.querySelector('.scroll')?.scrollTo(0, top);
      }
    },
    'sp-dl': () => downloadAll(),
    'sp-edit': el => { SP.ui.open = SP.ui.open === el.dataset.id ? null : el.dataset.id; renderSpeak(); },
    'sp-del': async el => {
      SP.stuck = SP.stuck.filter(s => s.id !== el.dataset.id);
      SP.ui.copied = null;
      await saveStuck();
      renderSpeak();
    },
    'sp-copy': () => copyStuck(),
    'sp-sent': async () => {
      const ids = new Set(SP.ui.copied?.ids || []);
      SP.stuck.forEach(s => { if (ids.has(s.id)) s.sent = true; });
      SP.ui.copied = null;
      await saveStuck();
      renderSpeak();
    },
    'sp-show-sent': () => { SP.ui.showSent = !SP.ui.showSent; renderSpeak(); },
  };

  return {
    load,
    reloadMine,
    renderSpeak,
    renderDrill,
    actions,
    onSubmit,
    todayCount,
    openCount: () => openStuck().length,
    inDrill: () => !!SP.drill,
    _state: SP,            // テスト用
  };
}
