// BJT 対策の「練習」タブ（v1.7.0）：アプリの中で解ける問題集
//
// 問題
//   data/quiz/bjt.json … Robert と Kairos が作ったオリジナルの非公式問題（公開）。BJT の過去問・本番の問題ではない
//   自分で読み込んだ問題 … 「問題を読み込む」に JSON を貼る。このスマホの中（meta の bjtQuizUser）だけに入る
//   基礎リスニング … data/chunks.json の 30 文と公開の音声から自動で作る（1文を聞いて場面を選ぶ）
//
// 1問の形（answer は 0 から数える）
//   { id, author, part:'聴解'|'聴読解'|'読解', rev, status:'draft'|'reviewed', group, cause, situation,
//     script:[{sp:'男'|'女', t}]（聴解）, passage（読解）, question, options:[4つ], answer, why:[4つ] }
//
// 聴解の会話は、PC の AivisSpeech で作った音声（tools/make_audio.py が data/audio/ に「ID:q」として入れる）を鳴らす。
// 音声がまだない問題は「音声待ち」として出さない（スクリプトだけで聴解の代わりにはしない）。
// スクリプトは答えたあとにだけ見せる。
//
// 記録（meta の bjtQuizLog）：{ id, group, rev, part, status, ok, first, date, at }
//   first … 同じグループ（言い換え問題も同じグループ）を初めて解いたとき。正解率はこの「初回」だけで出す（覚えた答えを実力と混ぜない）
//   審査前（draft）の問題は解けるが、正解率には入れない。正解率は点数（0〜800）に換算しない。

const QUIZ_URL = 'data/quiz/bjt.json';
const LOG_MAX = 5000;
const LISTEN = ['聴解', '聴読解'];
const BASIC = '基礎リスニング';
const FILTERS = ['すべて', '聴解', '読解', BASIC];
const SIZES = [5, 10];
const LETTERS = ['A', 'B', 'C', 'D'];

export function createQuiz({ app, esc, store, todayStr, audio, causes, addMistake, rerender, keepScroll }) {
  const Q = {
    builtin: [],
    user: [],
    chunks: [],
    log: [],
    session: null,
    ui: { filter: 'すべて', n: 5, once: true, mode: 'new', importMsg: null },
  };

  /* ---------------- 読み込み・保存 ---------------- */

  async function load() {
    const [u, l] = await Promise.all([store.get('meta', 'bjtQuizUser'), store.get('meta', 'bjtQuizLog')]);
    Q.user = Array.isArray(u) ? u.filter(valid) : [];
    Q.log = Array.isArray(l) ? l : [];
    try {
      const res = await fetch(QUIZ_URL, { cache: 'no-cache' });
      if (res.ok) Q.builtin = ((await res.json()).items || []).filter(valid);
    } catch (e) { /* オフラインで未キャッシュなら、読み込んだ問題だけ */ }
    try {
      const res = await fetch('data/chunks.json', { cache: 'no-cache' });
      if (res.ok) Q.chunks = (await res.json()).chunks || [];
    } catch (e) { /* 基礎リスニングなし */ }
  }
  const saveLog = () => store.put('meta', Q.log.slice(-LOG_MAX), 'bjtQuizLog');
  const saveUser = () => store.put('meta', Q.user, 'bjtQuizUser');

  /** 1問として使えるか（足りない項目があれば読み込まない） */
  function valid(x) {
    if (!x || typeof x !== 'object' || !x.id || !x.question) return false;
    if (!['聴解', '聴読解', '読解'].includes(x.part)) return false;
    if (!Array.isArray(x.options) || x.options.length !== 4 || x.options.some(o => !String(o || '').trim())) return false;
    if (!Number.isInteger(x.answer) || x.answer < 0 || x.answer > 3) return false;
    if (LISTEN.includes(x.part) && !(Array.isArray(x.script) && x.script.length && x.script.every(l => l && l.t))) return false;
    if (x.part === '読解' && !String(x.passage || '').trim()) return false;
    return true;
  }

  /** 組み込みの問題と読み込んだ問題。同じ ID なら rev が新しいほう */
  function allItems() {
    const map = new Map();
    for (const x of Q.builtin) map.set(x.id, { ...x, src: 'app' });
    for (const x of Q.user) {
      const have = map.get(x.id);
      if (!have || (Number(x.rev) || 1) >= (Number(have.rev) || 1)) map.set(x.id, { ...x, src: 'mine' });
    }
    return [...map.values()].map(x => ({ ...x, group: x.group || x.id, status: x.status === 'reviewed' ? 'reviewed' : 'draft' }));
  }

  /** 基礎リスニング：公開の音声がある文だけ */
  function basicItems() {
    return Q.chunks
      .filter(c => c.id && c.say && c.scene && audio.has(c.id, 'say'))
      .map(c => ({ id: `L-${c.id}`, part: BASIC, author: '自動', status: 'auto', group: `L-${c.id}`, chunk: c }));
  }

  const hasAudio = x => (x.part === BASIC ? true : !LISTEN.includes(x.part) || audio.has(x.id, 'q'));
  const inFilter = x => Q.ui.filter === 'すべて' || x.part === Q.ui.filter || (Q.ui.filter === '聴解' && x.part === '聴読解');

  function lastById() {
    const m = new Map();
    Q.log.forEach(e => m.set(e.id, e));
    return m;
  }

  /* ---------------- 集計 ---------------- */

  /** 部ごとの初回正解率（審査済みと自動の問題だけ） */
  function stats(part) {
    const first = Q.log.filter(e => e.first && e.status !== 'draft' && (part === '聴解' ? LISTEN.includes(e.part) : e.part === part));
    const ok = first.filter(e => e.ok).length;
    return { n: first.length, ok, pct: first.length ? Math.round((ok / first.length) * 100) : null };
  }

  /* ---------------- 問題を選ぶ ---------------- */

  const shuffle = a => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };

  /** 基礎リスニングの1問を組み立てる：聞いた文の場面＋ほかの文の場面3つ（なるべく同じ用途から） */
  function buildBasic(x) {
    const c = x.chunk;
    const others = Q.chunks.filter(o => o.id !== c.id && o.scene && o.scene !== c.scene);
    const same = shuffle(others.filter(o => o.fn === c.fn));
    const rest = shuffle(others.filter(o => o.fn !== c.fn));
    const picks = [...same, ...rest].slice(0, 3);
    const opts = shuffle([c, ...picks]);
    return {
      ...x,
      situation: '職場で、ある人が話しています。',
      question: 'この発言は、どの場面のものですか。',
      options: opts.map(o => o.scene),
      answer: opts.indexOf(c),
      why: opts.map(o => (o === c ? `正解。${c.note || ''}` : `この場面なら、たとえば「${o.say}」と言います。`)),
      scriptText: c.say,
      audioRef: [c.id, 'say'],
    };
  }

  function candidates() {
    const items = [...allItems(), ...basicItems()].filter(inFilter);
    return { ready: items.filter(hasAudio), waiting: items.filter(x => !hasAudio(x)) };
  }

  function pickSession() {
    const last = lastById();
    let pool = candidates().ready;
    if (Q.ui.mode === 'wrong') pool = pool.filter(x => last.has(x.id) && !last.get(x.id).ok);
    const ranked = shuffle(pool).sort((a, b) => {
      const ea = last.get(a.id);
      const eb = last.get(b.id);
      if (!ea !== !eb) return ea ? 1 : -1;      // まだ解いていない問題が先
      return (ea?.at || 0) - (eb?.at || 0);     // 次に、前に解いてから時間がたったもの
    });
    const groups = new Set();
    const out = [];
    for (const x of ranked) {
      if (groups.has(x.group)) continue;        // 同じグループ（言い換え問題）は1回の練習に1問だけ
      groups.add(x.group);
      out.push(x.part === BASIC ? buildBasic(x) : x);
      if (out.length >= Q.ui.n) break;
    }
    return out;
  }

  /* ---------------- 画面 ---------------- */

  function render() {
    const s = Q.session;
    if (!s) return homeView();
    if (s.finished) return resultView();
    return questionView();
  }

  const disclaimer = `<p class="caption quiz-note">オリジナルの<b>非公式</b>練習問題です。BJT の過去問・本番の問題ではありません。正解率は点数（0〜800）に換算できません。</p>`;

  function homeView() {
    const tiles = [['聴解', '聴解'], ['読解', '読解'], [BASIC, '基礎リスニング']].map(([k, l]) => {
      const st = stats(k);
      return `<div class="tile"><span>${esc(l)}</span><b>${st.pct == null ? '—' : `${st.pct}<small>%</small>`}</b><small class="sub">${st.n ? `初回 ${st.ok}/${st.n}` : 'まだなし'}</small></div>`;
    }).join('');
    const chips = (list, cur, act, fmt = v => v) => list.map(v => `<button class="chip" aria-pressed="${cur === v}" data-act="${act}" data-v="${esc(String(v))}">${esc(fmt(v))}</button>`).join('');
    const { ready, waiting } = candidates();
    const last = lastById();
    const wrongN = ready.filter(x => last.has(x.id) && !last.get(x.id).ok).length;
    const avail = Q.ui.mode === 'wrong' ? wrongN : ready.length;
    const items = allItems();
    const draftN = items.filter(x => x.status === 'draft').length;
    const byAuthor = [...items.reduce((m, x) => m.set(x.author || '不明', (m.get(x.author || '不明') || 0) + 1), new Map())]
      .map(([a, n]) => `${esc(a)} ${n}`).join('・');
    const listenWait = waiting.filter(x => LISTEN.includes(x.part)).length;
    const msg = Q.ui.importMsg;

    return `
      ${disclaimer}
      <section class="card-box" aria-label="初回の正解率">
        <p class="label">初回の正解率（審査済みの問題だけ）</p>
        <div class="tiles three">${tiles}</div>
        <p class="caption" style="margin:0">同じ問題・言い換え問題の2回目以降は数えません。覚えた答えを実力と混ぜないためです。</p>
      </section>

      <section class="card-box" aria-label="練習を始める">
        <p class="label">練習する</p>
        <div class="frow" role="group" aria-label="部">${chips(FILTERS, Q.ui.filter, 'quiz-filter')}</div>
        <div class="frow" role="group" aria-label="出し方">
          ${chips(['new', 'wrong'], Q.ui.mode, 'quiz-mode', v => (v === 'new' ? 'まだ解いていない問題から' : `間違えた問題（${wrongN}）`))}
        </div>
        <div class="frow" role="group" aria-label="問題数">${chips(SIZES, Q.ui.n, 'quiz-n', v => `${v}問`)}</div>
        <button class="chip toggle" aria-pressed="${Q.ui.once}" data-act="quiz-once">音声は1回だけ（本番と同じ）</button>
        <button class="primary" data-act="quiz-start" ${avail ? '' : 'disabled'}>${avail ? `始める（${Math.min(avail, Q.ui.n)}問）` : 'この条件の問題はありません'}</button>
        ${listenWait ? `<p class="caption" style="margin:0">聴解の会話問題 ${listenWait}問は音声待ちです。PC の AivisSpeech で作ると解けるようになります（tools/make_audio.py）。</p>` : ''}
      </section>

      <section class="group" aria-label="問題集">
        <div class="kv"><span>問題集</span><b>${items.length}問＋基礎リスニング ${basicItems().length}問</b></div>
        <p class="small">${byAuthor || 'まだ問題がありません'}${draftN ? ` · 審査前 ${draftN}問（解けますが、正解率には入れません）` : ''}</p>
        <form data-form="bjt-quiz-import" class="stuck-answer">
          <label class="field">問題を読み込む（JSON を貼り付け）<textarea name="json" rows="2" class="export" placeholder='{"app":"grass-quiz","items":[…]}'></textarea></label>
          <button class="outline quiet" type="submit">読み込む（同じ ID は rev が新しいほうに）</button>
        </form>
        ${msg ? `<p class="msg ${msg.ok ? 'ok' : 'err'}">${esc(msg.text)}</p>` : ''}
      </section>`;
  }

  function badge(x) {
    if (x.status === 'auto') return '<em class="qb">自動</em>';
    return x.status === 'reviewed' ? '<em class="qb ok">審査済み</em>' : '<em class="qb">審査前</em>';
  }

  function questionView() {
    const s = Q.session;
    const x = s.items[s.i];
    const answered = s.choice != null && s.answered;
    const listen = x.part === BASIC || LISTEN.includes(x.part);
    const lock = listen && Q.ui.once && s.played > 0 && !answered;

    const playBtn = listen ? `
      <button class="${answered ? 'outline' : 'primary'} listen-big" data-act="quiz-play" ${lock || s.playing ? 'disabled' : ''}>
        ${s.playing ? '再生中…' : lock ? '再生しました（1回だけ）' : answered ? 'もう一度聞く' : s.played ? 'もう一度聞く' : '▶ 音声を聞く'}
      </button>` : '';

    const opts = x.options.map((o, i) => {
      let cls = '';
      if (answered) cls = i === x.answer ? 'right' : i === s.choice ? 'wrong' : 'dim';
      return `
        <li>
          <button class="opt ${cls}" data-act="quiz-pick" data-v="${i}" aria-pressed="${s.choice === i}" ${answered ? 'disabled' : ''}>
            <span class="k">${LETTERS[i]}</span><span class="o">${esc(o)}</span>
          </button>
          ${answered && x.why?.[i] ? `<p class="why">${esc(x.why[i])}</p>` : ''}
        </li>`;
    }).join('');

    const script = answered && listen ? `
      <div class="q-script" aria-label="スクリプト">
        <p class="label">スクリプト</p>
        ${x.part === BASIC ? `<p>${esc(x.scriptText)}</p>` : x.script.map(l => `<p>${l.sp ? `<b>${esc(l.sp)}：</b>` : ''}${esc(l.t)}</p>`).join('')}
      </div>` : '';

    const ok = answered && s.choice === x.answer;
    const noted = s.noted.has(x.id);
    const pick = s.causes || [];
    const causeChips = causes.map(c => `<button class="chip" aria-pressed="${pick.includes(c)}" data-act="quiz-cause" data-v="${esc(c)}">${esc(c)}</button>`).join('');
    const after = answered ? `
      <p class="msg ${ok ? 'ok' : 'err'}">${ok ? '正解です。' : `不正解。正解は ${LETTERS[x.answer]} です。`}</p>
      ${script}
      ${!ok ? `
        <div class="q-noteb">
          ${noted ? '<p class="msg ok">間違いノートに入れました。明日「間違い」タブで見直します。</p>' : `
            <p class="small" style="margin:0">原因（いくつでも）</p>
            <div class="frow wrap" role="group" aria-label="原因">${causeChips}</div>
            <label class="field">分からなかった表現（あれば）<input data-q="expr" autocomplete="off" placeholder="例：差し支えなければ"></label>
            <button class="outline" data-act="quiz-note">間違いノートに入れる</button>`}
        </div>` : ''}
      <button class="primary ink" data-act="quiz-next">${s.i + 1 < s.items.length ? '次へ' : '結果を見る'}</button>` : `
      <button class="primary ink" data-act="quiz-submit" ${s.choice == null ? 'disabled' : ''}>答える</button>`;

    return `
      <section class="card-box quiz" aria-label="問題">
        <div class="q-head">
          <span><b>${s.i + 1} / ${s.items.length}</b> · ${esc(x.part)} · ${esc(x.id)} ${badge(x)}</span>
          <button class="text-btn" data-act="quiz-quit">やめる</button>
        </div>
        ${x.situation ? `<p class="scene">${esc(x.situation)}</p>` : ''}
        ${playBtn}
        ${x.part === '読解' ? `<div class="passage">${esc(x.passage)}</div>` : ''}
        <p class="q-text">${esc(x.question)}</p>
        <ol class="opts">${opts}</ol>
        ${after}
      </section>
      ${disclaimer}`;
  }

  function resultView() {
    const s = Q.session;
    const okN = s.results.filter(r => r.ok).length;
    const firstN = s.results.filter(r => r.first && r.status !== 'draft');
    const rows = s.results.map(r => `
      <li class="bjt-row">
        <span class="t"><b>${r.ok ? '○' : '×'} ${esc(r.id)} · ${esc(r.part)}</b><span>${esc(r.question)}</span></span>
      </li>`).join('');
    return `
      <section class="card-box" aria-label="結果">
        <p class="label">結果</p>
        <div class="tiles three">
          <div class="tile"><span>正解</span><b>${okN}<small>/${s.results.length}</small></b></div>
          <div class="tile"><span>初回（集計対象）</span><b>${firstN.filter(r => r.ok).length}<small>/${firstN.length}</small></b></div>
          <div class="tile"><span>間違い</span><b class="${okN < s.results.length ? 'down' : ''}">${s.results.length - okN}</b></div>
        </div>
        <ul class="bjt-list">${rows}</ul>
        <button class="primary" data-act="quiz-again">続けて練習する</button>
        ${okN < s.results.length ? '<button class="outline" data-act="quiz-retry">間違えた問題をやり直す</button>' : ''}
        <button class="text-btn" data-act="quiz-quit">練習のトップへ</button>
      </section>
      ${disclaimer}`;
  }

  /* ---------------- 操作 ---------------- */

  const scrollTop = () => app.querySelector('.scroll')?.scrollTo(0, 0);
  const stay = () => keepScroll(rerender);

  function start() {
    const items = pickSession();
    if (!items.length) return;
    Q.session = { items, i: 0, choice: null, answered: false, played: 0, playing: false, results: [], noted: new Set(), causes: [] };
    rerender();
    scrollTop();
  }

  async function play() {
    const s = Q.session;
    if (!s || s.playing) return;
    const x = s.items[s.i];
    if (Q.ui.once && s.played > 0 && !s.answered) return;
    const [id, key] = x.audioRef || [x.id, 'q'];
    s.playing = true;
    stay();
    const ok = await audio.play(id, key, x.part === BASIC ? x.scriptText : '');
    s.playing = false;
    if (ok) s.played += 1;
    stay();
  }

  async function submit() {
    const s = Q.session;
    if (!s || s.choice == null || s.answered) return;
    const x = s.items[s.i];
    const ok = s.choice === x.answer;
    const first = !Q.log.some(e => e.group === x.group);
    const entry = { id: x.id, group: x.group, rev: x.rev || 1, part: x.part, status: x.status, ok, first, date: todayStr(), at: Date.now() };
    Q.log.push(entry);
    s.results.push({ ...entry, question: x.question });
    s.answered = true;
    s.causes = x.cause && causes.includes(x.cause) ? [x.cause] : [];
    await saveLog();
    stay();
  }

  async function note() {
    const s = Q.session;
    if (!s) return;
    const x = s.items[s.i];
    const expr = String(app.querySelector('[data-q="expr"]')?.value || '').trim();
    await addMistake({
      part: x.part === BASIC ? '聴解' : x.part,
      q: `練習 ${x.id}`,
      causes: s.causes.slice(),
      expr,
      memo: `${x.question} → 正解：${x.options[x.answer]}`,
    });
    s.noted.add(x.id);
    stay();
  }

  function next() {
    const s = Q.session;
    if (!s) return;
    if (s.i + 1 >= s.items.length) s.finished = true;
    else Object.assign(s, { i: s.i + 1, choice: null, answered: false, played: 0, playing: false, causes: [] });
    rerender();
    scrollTop();
  }

  const actions = {
    'quiz-filter': el => { Q.ui.filter = el.dataset.v; stay(); },
    'quiz-mode': el => { Q.ui.mode = el.dataset.v; stay(); },
    'quiz-n': el => { Q.ui.n = Number(el.dataset.v); stay(); },
    'quiz-once': () => { Q.ui.once = !Q.ui.once; stay(); },
    'quiz-start': () => start(),
    'quiz-play': () => play(),
    'quiz-pick': el => { if (Q.session && !Q.session.answered) { Q.session.choice = Number(el.dataset.v); stay(); } },
    'quiz-submit': () => submit(),
    'quiz-cause': el => {
      const s = Q.session;
      if (!s) return;
      const c = el.dataset.v;
      s.causes = s.causes.includes(c) ? s.causes.filter(v => v !== c) : [...s.causes, c];
      stay();
    },
    'quiz-note': () => note(),
    'quiz-next': () => next(),
    'quiz-quit': () => { Q.session = null; rerender(); scrollTop(); },
    'quiz-again': () => { Q.ui.mode = 'new'; start(); },
    'quiz-retry': () => { Q.ui.mode = 'wrong'; start(); },
  };

  /** 「問題を読み込む」：{app:'grass-quiz', items:[…]} か、問題の配列か、1問だけ */
  async function onImport(form) {
    const text = String(new FormData(form).get('json') || '').trim();
    try {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [data];
      const good = list.filter(valid);
      const bad = list.length - good.length;
      if (!good.length) throw new Error('使える問題がありませんでした（4つの選択肢・answer・本文かスクリプトが必要です）');
      let added = 0;
      let updated = 0;
      for (const x of good) {
        const i = Q.user.findIndex(u => u.id === x.id);
        if (i < 0) { Q.user.push(x); added += 1; } else if ((Number(x.rev) || 1) >= (Number(Q.user[i].rev) || 1)) { Q.user[i] = x; updated += 1; }
      }
      await saveUser();
      Q.ui.importMsg = { ok: true, text: `追加 ${added}問・更新 ${updated}問${bad ? `（読めなかった ${bad}問は飛ばしました）` : ''}` };
    } catch (e) {
      Q.ui.importMsg = { ok: false, text: e instanceof SyntaxError ? '貼り付けた文が JSON として読めません' : e.message };
    }
    stay();
    return true;
  }

  /** バックアップ用 */
  const exportData = () => ({ quizLog: Q.log, quizItems: Q.user });
  async function importData(data) {
    const haveLog = new Set(Q.log.map(e => `${e.id}|${e.at}`));
    const logs = (data.quizLog || []).filter(e => e && e.id && !haveLog.has(`${e.id}|${e.at}`));
    Q.log.push(...logs);
    Q.log.sort((a, b) => a.at - b.at);
    const haveItem = new Set(Q.user.map(x => x.id));
    const items = (data.quizItems || []).filter(x => valid(x) && !haveItem.has(x.id));
    Q.user.push(...items);
    await Promise.all([saveLog(), saveUser()]);
    return { logs: logs.length, items: items.length };
  }

  return { load, render, actions, onImport, exportData, importData, inSession: () => !!Q.session, _state: Q };
}
