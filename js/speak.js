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
//
// 声で答える（v1.12.0・look モードだけ）：js/voice.js
//   顔を上げたらマイクが聞き始め、黙ったら自動で答えへ進む。話し始めまでの秒数（onset）も記録する。
//   ふだんは録音して「自分の声 → お手本」で聞き比べる（どの端末でも動く）。
//   「文字でも確かめる」をオンにすると音声認識（Google の音声サービスが必要）。失敗したら理由を覚えて録音に戻す。
//   録音はメモリの中だけ。保存も送信もしない。
//   Whisper（v1.13.0・js/whisper.js）：録音をスマホの中で文字にして、答えの文と比べる。聞き比べと両方使える。
//     モデルは「話す」画面からダウンロード（初回だけ）。音声認識（Google）より優先する。

import { createVoice, compareSay, srSupported, micSupported } from './voice.js';
import { createWhisper, decodeForWhisper, WH_MODELS, WH_LIMITS, appModels, DEFAULT_WH_MODEL } from './whisper.js';

const DRILL_SIZE = 5;
const LOG_MAX = 3000;
const AUDIO_CACHE = 'grass-audio';
const AUDIO_DIR = 'data/audio/';
const MINE = '自分の文';

const SR_MSG = {
  'network': 'Google の音声サービスにつながりません',
  'service-not-allowed': '音声認識のサービスがありません',
  'no-service': '音声認識のサービスがありません',
  'not-allowed': 'マイクか音声認識が許可されていません',
  'language-not-supported': '日本語の音声認識がありません',
  'audio-capture': 'マイクを使えません',
  'timeout': '音声認識が始まりません',
  'unsupported': 'このブラウザには音声認識がありません',
};

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
    voice: { on: false, sr: false, srState: null, micErr: null,   // srState: { ok, reason, at }
      wh: false, whModel: DEFAULT_WH_MODEL, whBytes: 0, whDl: null, whErr: null,  // whDl: { loaded, total }
      whFiles: {}, whVerified: {}, whStatus: null },  // whFiles: モデルごとの読み込んだファイル名。whVerified: 実際に文字にできた日時
  };
  const voice = createVoice();
  const whisper = createWhisper();
  let player = null;
  let playerUrl = null;

  /* ---------------- 読み込み・保存 ---------------- */

  async function load() {
    const [log, stuck, vo] = await Promise.all([store.get('meta', 'speakLog'), store.get('meta', 'stuck'), store.get('meta', 'speakVoice')]);
    SP.log = Array.isArray(log) ? log : [];
    SP.stuck = Array.isArray(stuck) ? stuck : [];
    if (vo && typeof vo === 'object') {
      SP.voice = { ...SP.voice, on: !!vo.on, sr: !!vo.sr && srSupported(), srState: vo.srState || null,
        // v1.14.0：標準を Moonshine に変えた。前の版で選んでいたモデル（base・small）は、一度だけ Moonshine に切り替える
        wh: !!vo.wh, whModel: (vo.whModelV || 0) >= 2 && WH_MODELS[vo.whModel] && !WH_MODELS[vo.whModel].lab ? vo.whModel : DEFAULT_WH_MODEL,
        whFiles: vo.whFiles && typeof vo.whFiles === 'object' ? vo.whFiles : {}, whVerified: vo.whVerified && typeof vo.whVerified === 'object' ? vo.whVerified : {} };
    }
    refreshWhStatus();
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

  // deck の付いた素材（例：アプリ紹介）は「すべて」に混ぜず、自分のチップで選んだときだけ、最初から順に通しで出す
  const inFilter = (c, fn) => (fn === 'すべて' ? !c.deck : fn === MINE ? c.mine : c.fn === fn);
  const isDeck = fn => fn !== 'すべて' && fn !== MINE && SP.chunks.some(c => c.deck && c.fn === fn);

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
  const saveVoice = () => store.put('meta', { on: SP.voice.on, sr: SP.voice.sr, srState: SP.voice.srState, wh: SP.voice.wh, whModel: SP.voice.whModel, whModelV: 2, whFiles: SP.voice.whFiles, whVerified: SP.voice.whVerified }, 'speakVoice');
  const whReady = () => SP.voice.on && SP.voice.wh && SP.voice.whBytes > 0;
  const baseReady = () => !!SP.voice.whStatusByModel?.base?.ready;
  whisper.purgeRetired().catch(() => {});      // Whisper small（約400MB）が端末に残っていれば消す（v1.14.0）

  /** モデルのファイルが全部そろっているかを確かめる（読み込みのとき実際に使ったファイルの一覧で） */
  async function refreshWhStatus() {
    const v = SP.voice;
    v.whStatusByModel = v.whStatusByModel || {};
    for (const [key] of appModels()) {
      v.whStatusByModel[key] = await whisper.cacheStatus(key, v.whFiles[WH_MODELS[key].id]);
    }
    v.whStatus = v.whStatusByModel[v.whModel];
    v.whBytes = v.whStatus?.ready ? (v.whStatus.bytes || 1) : 0;
    if (location.hash.startsWith('#/speak')) renderSpeakKeep();
  }
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
    if (isDeck(fn)) return pool.map(c => c.id);          // 発表の練習：順番どおり全部
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
  /** wait: true なら、鳴り終わるまで待つ（聴解で、会話 → 選択肢と続けて鳴らすとき） */
  async function playClip(chunkId, key, text, { wait = false, rate = 1 } = {}) {
    const file = SP.audio.files[`${chunkId}:${key}`];
    if (file) {
      try {
        const res = await fetch(AUDIO_DIR + encodeURIComponent(file));
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (player) player.pause();
        if (playerUrl) URL.revokeObjectURL(playerUrl);
        playerUrl = URL.createObjectURL(blob);
        const p = new Audio(playerUrl);
        p.playbackRate = rate;              // 0.8 倍など（音の高さは変えない）
        p.preservesPitch = true;
        player = p;
        const done = wait ? new Promise(res => { p.onended = () => res(true); p.onpause = () => res(!p.ended ? false : true); p.onerror = () => res(false); }) : null;
        await p.play();
        countCached().then(() => {});
        return done ? await done : true;
      } catch (e) { /* オフラインで未キャッシュなど → 端末の読み上げへ */ }
    }
    if (cardAudio?.has(chunkId, key)) {
      if (player) player.pause();
      if (await cardAudio.play(chunkId, key)) return true;
    }
    return text ? say(text) : false;
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
    voice.release();
    const st = weekStats();
    const fns = ['すべて', ...(SP.mine.length ? [MINE] : []), ...new Set(SP.chunks.map(c => c.fn).filter(f => f && f !== MINE))];
    const chips = fns.map(f =>
      `<button class="chip" aria-pressed="${SP.filter === f}" data-act="sp-filter" data-v="${esc(f)}">${esc(f)}</button>`).join('');
    const count = SP.chunks.filter(c => inFilter(c, SP.filter)).length;
    const n = isDeck(SP.filter) ? count : Math.min(DRILL_SIZE, count);

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
        ${voiceSwitches()}
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

  function voiceSwitches() {
    if (!micSupported()) return '';
    const v = SP.voice;
    const st = v.srState;
    let srNote = 'Google の音声サービスが必要です。最初の1問で、この端末で使えるか確かめます（録音の聞き比べはなくなります）';
    if (st && st.ok) srNote = 'この端末で使えます。聞き取った文を答えと比べます（録音の聞き比べはなくなります）';
    if (st && !st.ok) srNote = `この端末では使えませんでした（${SR_MSG[st.reason] || st.reason}）。録音で聞き比べます。オンにすると、もう一度試します`;
    return `
        <div class="group flush voice-box">
          <label class="line">
            <span class="t"><b>声で答える</b><span>顔を上げたらマイクが聞き、黙ると自動で答えへ。録音して、お手本と聞き比べます</span></span>
            <span class="switch"><input type="checkbox" data-act="sp-voice" ${v.on ? 'checked' : ''}><span></span></span>
          </label>
          ${v.on ? whLine() : ''}
          ${v.on && !v.wh && srSupported() ? `
          <label class="line">
            <span class="t"><b>文字でも確かめる（音声認識）</b><span>${esc(srNote)}</span></span>
            <span class="switch"><input type="checkbox" data-act="sp-sr" ${v.sr ? 'checked' : ''}><span></span></span>
          </label>` : ''}
          ${v.micErr ? `<p class="msg err voice-err">${esc(v.micErr)}</p>` : ''}
        </div>`;
  }

  const mb = n => `${Math.round(n / 1e6)}MB`;

  function whLine() {
    const v = SP.voice;
    const m = WH_MODELS[v.whModel];
    let panel = '';
    if (v.wh) {
      const chips = appModels().map(([k, x]) =>
        `<button class="chip" aria-pressed="${v.whModel === k}" data-act="sp-wh-model" data-v="${k}" ${v.whDl ? 'disabled' : ''}>${esc(x.name)}</button>`).join('');
      let state;
      if (v.whDl) {
        const pct = v.whDl.total ? Math.round((v.whDl.loaded / v.whDl.total) * 100) : 0;
        state = `<p class="small wh-prog">ダウンロード中… ${pct}%${v.whDl.total ? `（${mb(v.whDl.loaded)} / ${mb(v.whDl.total)}）` : ''}。この画面を離れても続きます</p>`;
      } else if (v.whBytes > 0) {
        const verified = v.whVerified[m.id];
        state = `<p class="msg ok">このスマホに入っています${v.whBytes > 1 ? `（${mb(v.whBytes)}）` : ''}${v.whStatus?.full ? `・ファイル ${v.whStatus.checked}個を確認` : ''}。${verified
          ? `${mdShort(verified)}に文字にできました。オフラインでも使えます`
          : 'まだ一度も文字にしていません。最初の1回で、本当に使えるかを確かめます'} · ${esc(m.note)}</p>
          <button class="text-btn" data-act="sp-wh-del">このモデルをスマホから消す</button>`;
      } else if (v.whStatus?.full && v.whStatus.missing?.length) {
        state = `<p class="msg err">ファイルが ${v.whStatus.missing.length}個 足りません（消えたか、ダウンロードが途中で止まりました）。オフラインでは使えません</p>
          <button class="outline" data-act="sp-wh-dl">もう一度ダウンロード（${esc(m.approx)}・Wi-Fi で）</button>`;
      } else {
        state = `<button class="outline" data-act="sp-wh-dl">モデルをダウンロード（${esc(m.approx)}・Wi-Fi で）</button>
          <p class="small">初回だけです。${esc(m.note)}</p>`;
      }
      const warn = m.credit ? `<p class="small wh-credit">${esc(m.credit)}</p>` : '';
      panel = `
          <div class="wh-panel">
            <div class="frow" role="group" aria-label="モデル">${chips}</div>
            ${warn}${state}
            ${v.whErr ? `<p class="msg err">${esc(v.whErr)}</p>` : ''}
          </div>`;
    }
    return `
          <label class="line">
            <span class="t"><b>文字でも確かめる（スマホの中で）</b><span>録音をスマホの中で文字にして、答えの文と比べます。録音は送信しません（Google のサービスもいりません）</span></span>
            <span class="switch"><input type="checkbox" data-act="sp-wh" ${v.wh ? 'checked' : ''}><span></span></span>
          </label>${panel}`;
  }

  async function downloadWhisper() {
    const v = SP.voice;
    if (v.whDl) return;
    const key = v.whModel;
    v.whDl = { loaded: 0, total: 0 };
    v.whErr = null;
    renderSpeakKeep();
    try {
      const r = await whisper.load(key, p => {
        v.whDl = { loaded: p.loaded, total: p.total };
        const el = app.querySelector('.wh-prog');
        if (el && p.total) el.textContent = `ダウンロード中… ${Math.round((p.loaded / p.total) * 100)}%（${mb(p.loaded)} / ${mb(p.total)}）。この画面を離れても続きます`;
      });
      if (r.files.length) { v.whFiles[WH_MODELS[key].id] = r.files; saveVoice(); }
    } catch (e) {
      v.whErr = `ダウンロードできませんでした（${e.message}）。電波のよいところで、もう一度どうぞ`;
    }
    v.whDl = null;
    await refreshWhStatus();
    if (location.hash.startsWith('#/speak')) renderSpeakKeep();
  }

  function renderSpeakKeep() {
    if (!location.hash.startsWith('#/speak')) return;
    const top = app.querySelector('.scroll')?.scrollTop || 0;
    renderSpeak();
    app.querySelector('.scroll')?.scrollTo(0, top);
  }

  async function onChange(el) {
    if (el.dataset.act === 'sp-voice') {
      SP.voice.on = el.checked;
      SP.voice.micErr = null;
      if (!el.checked) voice.release();
    } else if (el.dataset.act === 'sp-wh') {
      SP.voice.wh = el.checked;
      SP.voice.whErr = null;
    } else if (el.dataset.act === 'sp-sr') {
      SP.voice.sr = el.checked;
      if (el.checked && SP.voice.srState && !SP.voice.srState.ok) SP.voice.srState = null;   // もう一度試す
    } else return false;
    await saveVoice();
    renderSpeakKeep();
    return true;
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
    if (mode === 'look' && whReady()) {   // 先に読み込んでおく（最初の1問を速く）。失敗したら、文字にするときにもう一度試し、そこで理由を出す
      const id = WH_MODELS[SP.voice.whModel].id;   // 読み込み中にモデルを変えても、結果は読み込んだモデルの名前で残す
      whisper.load(SP.voice.whModel).then(r => { if (r.files.length) { SP.voice.whFiles[id] = r.files; saveVoice(); } }).catch(() => {});
    }
    SP.drill = { mode, ids, i: 0, phase: 'front', t0: 0, ms: 0, peeks: 0, peeking: false, results: [], startedAt: Date.now() };
    go('#/drill');
  }

  /** ほかの画面から、決まった文だけで練習を始める（生の日本語 → 話す） */
  function startWith(ids, mode = 'scene') {
    const list = ids.filter(id => chunkById(id));
    if (!list.length) return;
    SP.drill = { mode, ids: list, i: 0, phase: 'front', t0: 0, ms: 0, peeks: 0, peeking: false, results: [], startedAt: Date.now() };
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
            ${micRow(d)}
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
          ${d.rec ? voiceResult(d) : `<p class="timer">${d.mode === 'scene' ? '答えを見るまで' : '顔を上げてから'} <b>${secLabel(d.ms)}</b>${d.mode === 'look' && d.peeks ? ` · 見た回数 ${d.peeks}` : ''}</p>`}
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

  /* ---------------- 声で答える ---------------- */

  function micRow(d) {
    if (!d.vstate) return d.voiceMsg ? `<p class="msg err" style="text-align:center">${esc(d.voiceMsg)}</p>` : '';
    const label = d.vstate === 'opening' ? 'マイクを準備中…'
      : d.vkind === 'sr' ? '聞いています（音声認識）'
      : '聞いています · 言い終わって少し黙ると、答えへ';
    return `
      <div class="mic ${d.vkind === 'sr' ? 'sr' : ''}" aria-live="off">
        <span class="mic-dot" aria-hidden="true"></span>
        ${d.vkind === 'rec' ? '<span class="mic-meter" aria-hidden="true"><i></i></span>' : ''}
        <span class="mic-t">${esc(label)}</span>
      </div>
      ${d.vkind === 'sr' ? `<p class="heard-live">${esc(d.heardLive || '')}</p>` : ''}
      ${d.voiceMsg ? `<p class="small" style="text-align:center">${esc(d.voiceMsg)}</p>` : ''}`;
  }

  const useSr = () => SP.voice.sr && !SP.voice.wh && srSupported() && !(SP.voice.srState && !SP.voice.srState.ok);

  /** 「顔を上げる」のタップの中で呼ぶ（音声認識はタップの中で始める必要がある） */
  function beginVoice(d) {
    voice.prepare();
    d.vstate = 'opening';
    if (useSr()) {
      d.vkind = 'sr';
      d.vstate = 'on';
      d.take = voice.recognize({
        onText: t => {
          if (SP.drill !== d) return;
          d.heardLive = t;
          const el = app.querySelector('.heard-live');
          if (el) el.textContent = t;
        },
        onEnd: res => {
          if (!SP.voice.srState?.ok) { SP.voice.srState = { ok: true, at: Date.now() }; saveVoice(); }
          finishVoice(d, res);
        },
        onFail: reason => {
          SP.voice.srState = { ok: false, reason, at: Date.now() };
          SP.voice.sr = false;
          saveVoice();
          if (SP.drill !== d || d.phase !== 'hidden') return;
          d.voiceMsg = `音声認識を使えません（${SR_MSG[reason] || reason}）。録音に切り替えました`;
          startRecording(d);
        },
      });
      return;
    }
    startRecording(d);
  }

  async function startRecording(d) {
    d.vkind = 'rec';
    d.vstate = 'opening';
    d.take = null;
    if (SP.drill === d && d.phase === 'hidden') renderDrill();
    try {
      const take = await voice.record({
        onLevel: lv => {
          const el = app.querySelector('.mic-meter i');
          if (el) el.style.transform = `scaleX(${Math.max(0.04, lv).toFixed(3)})`;
        },
        onEnd: res => finishVoice(d, res),
      });
      if (SP.drill !== d || d.phase !== 'hidden') { take.cancel(); return; }
      d.take = take;
      d.vstate = 'on';
      if (!take.hasAnalyser) d.voiceMsg = '言い終わったら「言えた」を押してください';
    } catch (e) {
      d.vstate = null;
      d.take = null;
      d.voiceMsg = e?.name === 'NotAllowedError'
        ? 'マイクが許可されていません。Chrome とスマホの設定で、マイクを許可してください'
        : `マイクを使えません（${e?.name || e}）`;
      SP.voice.micErr = d.voiceMsg;
    }
    if (SP.drill === d && d.phase === 'hidden') renderDrill();
  }

  // 1回の答え（attempt）ごとに、録音と文字にした結果を持つ。次の文に進んでも、結果はその答えの記録に入る。
  let attemptSeq = 0;
  let whTicker = 0;
  const WH_RUNNING = ['queued', 'decoding', 'loading', 'transcribing'];
  const whRunning = att => WH_RUNNING.includes(att?.wh);

  function finishVoice(d, res) {
    if (SP.drill !== d || d.phase !== 'hidden') { if (res?.url) URL.revokeObjectURL(res.url); return; }
    const c = chunkById(d.ids[d.i]);
    d.take = null;
    d.vstate = null;
    d.ms = Math.max(0, (res.endAt || performance.now()) - d.t0);
    d.onset = res.onsetAt ? Math.max(0, res.onsetAt - d.t0) : null;
    const att = { aid: ++attemptSeq, chunkId: c?.id, say: c?.say || '', kind: res.kind, url: res.url || null, blob: res.blob || null,
      text: res.text || '', res, wh: null, whErr: null, t0: 0, timings: {}, entry: null };
    d.rec = att;
    if (res.kind === 'sr') att.cmp = compareSay(att.say, res.text || '');
    if (res.kind === 'rec' && att.blob && whReady()) {
      if (res.onsetAt == null) att.wh = 'none';
      else runWhisper(att);
    }
    SP.voice.micErr = null;
    d.peeking = false;
    d.phase = 'back';
    renderDrill();
    app.querySelector('.scroll')?.scrollTo(0, 0);
  }

  /** 表示中の答えなら描き直す（スクロール位置はそのまま） */
  function paintAttempt(att) {
    const d = SP.drill;
    if (!d || d.rec !== att || d.phase !== 'back' || !location.hash.startsWith('#/drill')) return;
    const top = app.querySelector('.scroll')?.scrollTop || 0;
    renderDrill();
    app.querySelector('.scroll')?.scrollTo(0, top);
  }

  /** 文字にしている間、経過秒数を1秒ごとに書きかえる。遅い目安を越えたら、やめる・base でやり直すを出す */
  function tickWhisper() {
    clearInterval(whTicker);
    whTicker = setInterval(() => {
      const att = SP.drill?.rec;
      if (!whRunning(att)) { clearInterval(whTicker); whTicker = 0; return; }
      const sec = Math.floor((performance.now() - att.t0) / 1000);
      const el = app.querySelector('.wh-elapsed');
      if (el) el.textContent = `${sec}秒`;
      const slow = performance.now() - att.t0 > (WH_LIMITS.slowMs[att.model] || 20000);
      if (slow && !att.slowShown) { att.slowShown = true; paintAttempt(att); }
    }, 1000);
  }

  async function runWhisper(att, { whole = false, model = SP.voice.whModel } = {}) {
    if (!att.blob && !att.url) return;
    const res = att.res;
    att.wh = 'decoding';
    att.whErr = null;
    att.whCode = '';
    att.model = model;
    att.t0 = performance.now();
    att.slowShown = false;
    att.timings = {};
    att.whole = whole;
    const run = att.run = (att.run || 0) + 1;   // やめた・やり直したあとに、古い結果で上書きしない
    const abort = att.abort = new AbortController();   // この答えだけをやめるため（ほかの答えの処理は止めない）
    paintAttempt(att);
    tickWhisper();
    try {
      const d0 = performance.now();
      const from = whole ? 0 : Math.max(0, (res.onsetAt - res.startAt) / 1000 - 0.35);
      const to = whole ? Infinity : (res.endAt - res.startAt) / 1000 + 0.5;
      const pcm = await decodeForWhisper(att.blob || att.url, from, to);
      att.timings.decodeMs = performance.now() - d0;
      if (att.run !== run || att.wh === 'cancelled') return;
      const out = await whisper.transcribe(model, pcm, {
        signal: abort.signal,
        onStage: m => {
          if (att.run !== run || att.wh === 'cancelled') return;
          att.wh = m.stage === 'load' ? 'loading' : m.stage === 'infer' ? 'transcribing' : 'queued';
          if (m.loadMs) att.timings.loadMs = m.loadMs;
          paintAttempt(att);
        },
      });
      if (att.run !== run || att.wh === 'cancelled') return;
      att.text = out.text;
      att.timings.inferMs = out.ms;
      if (out.loadMs) att.timings.loadMs = out.loadMs;
      att.cmp = out.text ? compareSay(att.say, out.text) : null;
      att.wh = 'done';
      SP.voice.whVerified[WH_MODELS[model].id] = Date.now();
      saveVoice();
      // もう次の文に進んでいたら、その答えの記録に一致率を書き足す（結果をなくさない）
      if (att.entry && att.cmp) { att.entry.match = Math.round(att.cmp.score * 100) / 100; att.entry.late = true; saveLog().catch(() => {}); }
    } catch (e) {
      if (att.run !== run || att.wh === 'cancelled') return;
      att.wh = 'error';
      att.whCode = e.code || 'failed';
      att.whErr = e.message;
    } finally {
      if (att.run === run) {
        if (SP.drill?.rec !== att) { att.blob = null; att.res = null; }   // 画面から外れた答えの録音は、ここで手放す
        paintAttempt(att);
      }
    }
  }

  const whSec = ms => `${Math.max(1, Math.round(ms / 1000))}秒`;
  function whTimings(t) {
    const parts = [];
    if (t.loadMs) parts.push(`読み込み ${whSec(t.loadMs)}`);
    if (t.inferMs) parts.push(`文字に ${whSec(t.inferMs)}`);
    return parts.join(' · ');
  }

  function textBlock(r) {
    if (!r.text) return '<p class="small">文字にできませんでした</p>';
    const t = r.timings ? whTimings(r.timings) : '';
    const engine = r.model === 'base' ? 'Whisper base' : 'Moonshine';
    return `<p class="heard"><span>聞き取り${r.kind === 'rec' ? `（${engine}${t ? ` · ${t}` : ''}）` : ''}</span>${esc(r.text)}</p>
           <p class="diff" aria-label="答えの文で、聞き取れなかった文字に印">${r.cmp.marks.map(m => (m.ok ? esc(m.ch) : `<mark>${esc(m.ch)}</mark>`)).join('')}</p>
           <p class="small">文字の一致（目安）${Math.round(r.cmp.score * 100)}%${r.cmp.extra > 0 ? ` · 余分な文字 ${r.cmp.extra}` : ''} · 印は聞き取りになかった文字。聞き取った文字の比較で、発音の良し悪しではありません。漢字とかなの違いでも印が付きます</p>`;
  }

  function voiceResult(d) {
    const r = d.rec;
    if (!r) return '';
    const times = d.onset != null
      ? `<p class="timer">話し始めまで <b>${secLabel(d.onset)}</b> · 言い終わるまで <b>${secLabel(d.ms)}</b>${d.peeks ? ` · 見た回数 ${d.peeks}` : ''}</p>`
      : `<p class="timer">声を聞き取れませんでした · ${secLabel(d.ms)}${d.peeks ? ` · 見た回数 ${d.peeks}` : ''}</p>`;
    let body = '';
    if (r.kind === 'sr') {
      body = textBlock(r);
    } else if (r.url) {
      const wh = whStateHtml(r);
      body = `
        <div class="cmp-row">
          <button class="outline quiet" data-act="sp-mine">${ICON.speaker}自分の声</button>
          <button class="outline" data-act="sp-cmp">自分 → お手本</button>
        </div>${wh}`;
    }
    return `<section class="voice-res">${times}${body}</section>`;
  }

  function whStateHtml(r) {
    // Moonshine でうまくいかなかったとき、Whisper base が端末にあれば、そちらでやり直せる
    const toBase = r.model !== 'base' && baseReady()
      ? '<button class="outline quiet" data-act="sp-wh-retry" data-v="base">Whisper base でやり直す</button>' : '';
    if (whRunning(r)) {
      const label = { queued: '前の文を文字にし終わるのを待っています…', decoding: '録音を読み込んでいます…',
        loading: 'モデルを読み込んでいます…（初めてや、しばらく使っていないときは時間がかかります）', transcribing: '文字にしています…（スマホの中で）' }[r.wh];
      const sec = Math.floor((performance.now() - r.t0) / 1000);
      const slow = r.slowShown ? '<p class="small">時間がかかっています。このまま待つか、やめられます。結果はあとからでも、この答えの記録に入ります</p>' : '';
      return `<div class="wh-run" role="status"><p class="small">${label} <span class="wh-elapsed">${sec}秒</span></p>${slow}
        <div class="cmp-row"><button class="outline quiet" data-act="sp-wh-cancel">やめる</button>${r.slowShown ? toBase : ''}</div></div>`;
    }
    if (r.wh === 'done') return textBlock(r);
    if (r.wh === 'none') {
      return `<div class="wh-none"><p class="small">声を見つけられませんでした（声が小さい・まわりがうるさい、など）。そのため文字にしていません</p>
        <div class="cmp-row"><button class="outline quiet" data-act="sp-wh-anyway">それでも文字にする</button></div></div>`;
    }
    if (r.wh === 'cancelled') {
      return `<div class="wh-none"><p class="small">文字にするのをやめました</p>
        <div class="cmp-row"><button class="outline quiet" data-act="sp-wh-retry">もう一度文字にする</button>${toBase}</div></div>`;
    }
    if (r.wh === 'error') {
      const why = { timeout: '時間がかかりすぎたので止めました', crashed: '文字にする処理が止まりました（メモリが足りないのかもしれません）' }[r.whCode] || '文字にできませんでした';
      return `<div class="wh-err"><p class="msg err">${why}（${esc(r.whErr || '')}）</p>
        <div class="cmp-row"><button class="outline quiet" data-act="sp-wh-retry">もう一度</button>${toBase}</div></div>`;
    }
    return '';
  }

  let minePlayer = null;
  function playMine(url) {
    return new Promise(res => {
      if (player) player.pause();
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      minePlayer?.pause();
      const p = new Audio(url);
      minePlayer = p;
      p.onended = () => res(true);
      p.onerror = () => res(false);
      p.onpause = () => res(p.ended);
      p.play().catch(() => res(false));
    });
  }

  function dropRec(d) {
    minePlayer?.pause();
    if (d?.rec?.url) URL.revokeObjectURL(d.rec.url);
    if (d?.rec) { d.rec.url = null; if (!whRunning(d.rec)) { d.rec.blob = null; d.rec.res = null; } }   // 文字にしている途中なら、録音はその処理が終わるまで持っておく
    if (d) { d.rec = null; d.take?.cancel(); d.take = null; d.vstate = null; d.voiceMsg = null; d.heardLive = ''; d.onset = null; }
  }

  async function rateDrill(ok) {
    const d = SP.drill;
    if (!d || d.busy) return;
    d.busy = true;
    const c = chunkById(d.ids[d.i]);
    const entry = { date: todayStr(), id: c.id, mode: d.mode, ms: Math.round(d.ms), peeks: d.peeks, ok, at: Date.now() };
    if (d.rec) { entry.voice = d.rec.kind; if (d.onset != null) entry.onset = Math.round(d.onset); if (d.rec.cmp) entry.match = Math.round(d.rec.cmp.score * 100) / 100; d.rec.entry = entry; }
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
    dropRec(d);
    SP.ui.ttsMsg = null;
    renderDrill();
    app.querySelector('.scroll')?.scrollTo(0, 0);
  }

  function renderDrillDone() {
    const d = SP.drill;
    voice.release();
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
    'sp-home': () => { dropRec(SP.drill); SP.drill = null; voice.release(); go('#/speak'); },
    'sp-quit': () => { dropRec(SP.drill); SP.drill = null; voice.release(); go('#/speak'); },
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
      dropRec(d);
      if (SP.voice.on && micSupported()) beginVoice(d);
      renderDrill();
    },
    'sp-peek': () => {
      const d = SP.drill;
      if (d.peeking) return;
      d.peeks += 1;
      d.peeking = true;
      d.take?.hold(1500 + 1200);     // 見ている間と見たあと少しは、黙っていても終わらせない
      renderDrill();
      setTimeout(() => {
        if (SP.drill === d && d.phase === 'hidden') { d.peeking = false; renderDrill(); }
      }, 1500);
    },
    'sp-said': () => {
      const d = SP.drill;
      if (d.take) { d.take.stop(); return; }          // 録音・認識を止める → finishVoice が答えへ進める
      if (d.vstate === 'opening') { dropRec(d); }
      d.ms = performance.now() - d.t0;
      d.peeking = false;
      d.phase = 'back';
      renderDrill();
      app.querySelector('.scroll')?.scrollTo(0, 0);
    },
    'sp-rate': el => rateDrill(el.dataset.ok === '1'),
    'sp-mine': () => { const u = SP.drill?.rec?.url; if (u) playMine(u); },
    'sp-wh-cancel': () => { const att = SP.drill?.rec; if (!whRunning(att)) return; att.wh = 'cancelled'; att.abort?.abort(); paintAttempt(att); },
    'sp-wh-retry': el => { const att = SP.drill?.rec; if (att && !whRunning(att)) runWhisper(att, { whole: !!att.whole, model: el.dataset.v || SP.voice.whModel }); },
    'sp-wh-anyway': () => { const att = SP.drill?.rec; if (att && att.wh === 'none') runWhisper(att, { whole: true }); },
    'sp-cmp': async () => {
      const d = SP.drill;
      const c = chunkById(d?.ids[d.i]);
      if (!d?.rec?.url || !c) return;
      const done = await playMine(d.rec.url);
      if (!done || SP.drill !== d || d.phase !== 'back') return;
      await new Promise(r => setTimeout(r, 350));
      const ok = await playClip(c.id, 'say', c.say);
      if (!ok && SP.ui.ttsMsg == null) {
        SP.ui.ttsMsg = 'この文のお手本の音声がまだありません';
        const top = app.querySelector('.scroll')?.scrollTop || 0;
        renderDrill();
        app.querySelector('.scroll')?.scrollTo(0, top);
      }
    },
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
    'sp-wh-dl': () => downloadWhisper(),
    'sp-wh-model': async el => {
      if (SP.voice.whDl || SP.voice.whModel === el.dataset.v) return;
      SP.voice.whModel = el.dataset.v;
      SP.voice.whErr = null;
      await refreshWhStatus();
      await saveVoice();
      renderSpeakKeep();
    },
    'sp-wh-del': async () => {
      await whisper.remove(SP.voice.whModel);
      delete SP.voice.whVerified[WH_MODELS[SP.voice.whModel].id];
      saveVoice();
      await refreshWhStatus();
      renderSpeakKeep();
    },
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
    onChange,
    todayCount,
    playClip,
    hasClip,
    startWith,
    chunkSay: id => chunkById(id)?.say || '',
    clipUrl: (id, key) => (SP.audio.files[`${id}:${key}`] ? AUDIO_DIR + encodeURIComponent(SP.audio.files[`${id}:${key}`]) : null),
    chunks: () => SP.chunks,
    stopClip: () => { if (player) player.pause(); minePlayer?.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); },
    releaseMic: () => voice.release(),
    openCount: () => openStuck().length,
    inDrill: () => !!SP.drill,
    _state: SP,            // テスト用
  };
}
