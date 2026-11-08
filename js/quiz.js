// BJT 対策の「練習」タブ（v1.7.0・書き取りは v1.8.0）：アプリの中で解ける問題集
//
// 聴解の流れ（v1.8.0）：聞く（本番形式）→ 答える（初回の結果はここで記録・もう変えられない）
//   → 書き取り（ひらがなOK・スキップ可・練習の聞き直しは何回でも）→ 答え合わせ（正誤・選択肢・スクリプト）
//   → スクリプトと比べて目印を付ける（原因の決めつけはしない）→ 0.8倍／原速で聞き直し・シャドーイング
//   書き取りは meta の bjtDictLog（このスマホだけ・バックアップに入る）
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
const FILTERS = ['すべて', '聴解', '聴読解', '読解', BASIC];
const SIZES = [5, 10];
const LETTERS = ['1', '2', '3', '4'];
// 書き取りのあとに自分で付ける目印（原因の決めつけではなく、どこで崩れたかのメモ）
const DTAGS = ['聞き取れない語があった', '条件・否定を落とした', '誰が・いつを取り違えた', '聞き取れたが意味が分からない', '速くて追いつかなかった'];

export function createQuiz({ app, esc, store, todayStr, audio, causes, addMistake, rerender, keepScroll }) {
  const Q = {
    builtin: [],
    user: [],
    chunks: [],
    log: [],
    dict: [],       // 書き取り：{ id, at, date, text, tags:[], firstOk }
    session: null,
    ui: { filter: 'すべて', n: 5, once: true, exam: true, mode: 'new', importMsg: null },
  };

  /* ---------------- 読み込み・保存 ---------------- */

  async function load() {
    const [u, l, d] = await Promise.all([store.get('meta', 'bjtQuizUser'), store.get('meta', 'bjtQuizLog'), store.get('meta', 'bjtDictLog')]);
    Q.user = Array.isArray(u) ? u.filter(valid) : [];
    Q.log = Array.isArray(l) ? l : [];
    Q.dict = Array.isArray(d) ? d : [];
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
  const saveDict = () => store.put('meta', Q.dict.slice(-LOG_MAX), 'bjtDictLog');

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
      if (!have || (Number(x.rev) || 1) > (Number(have.rev) || 1)) map.set(x.id, { ...x, src: 'mine' });   // 同じ rev ならアプリの問題
    }
    return [...map.values()].map(x => ({ ...x, group: x.group || x.id, status: x.status === 'reviewed' ? 'reviewed' : 'draft' }));
  }

  /** 基礎リスニング：公開の音声がある文だけ */
  function basicItems() {
    return Q.chunks
      .filter(c => c.id && c.say && c.scene && audio.has(c.id, 'say'))
      .map(c => ({ id: `L-${c.id}`, part: BASIC, author: '自動', status: 'auto', group: `L-${c.id}`, chunk: c }));
  }

  /** 選択肢を音声で読むか（本番形式がオンで、選択肢の音声があるとき） */
  const examOpts = x => Q.ui.exam && x.part === '聴解' && audio.has(x.id, 'o');   // 聴読解の選択肢は本番でも文字
  const hasAudio = x => (x.part === BASIC ? true : !LISTEN.includes(x.part) || audio.has(x.id, 'q'));
  const inFilter = x => Q.ui.filter === 'すべて' || x.part === Q.ui.filter;

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
        <div class="frow wrap" role="group" aria-label="本番形式">
          <button class="chip toggle" aria-pressed="${Q.ui.once}" data-act="quiz-once">音声は1回だけ</button>
          <button class="chip toggle" aria-pressed="${Q.ui.exam}" data-act="quiz-exam">聴解の選択肢も音声だけ</button>
        </div>
        <p class="caption" style="margin:0;text-align:left">本番の聴解は、選択肢も画面に出ず音声で読まれます。両方オンが本番に近い形です。</p>
        <button class="primary" data-act="quiz-start" ${avail ? '' : 'disabled'}>${avail ? `始める（${Math.min(avail, Q.ui.n)}問）` : 'この条件の問題はありません'}</button>
        ${listenWait ? `<p class="caption" style="margin:0">聴解の会話問題 ${listenWait}問は音声待ちです。PC の AivisSpeech で作ると解けるようになります（tools/make_audio.py）。</p>` : ''}
      </section>

      <section class="group" aria-label="問題集">
        <div class="kv"><span>問題集</span><b>${items.length}問＋基礎リスニング ${basicItems().length}問</b></div>
        <p class="small">${byAuthor || 'まだ問題がありません'}${draftN ? ` · 審査前 ${draftN}問（解けますが、正解率には入れません）` : ''}</p>
        ${Q.dict.length ? `<p class="small" style="margin:0">書き取りの記録 ${Q.dict.length}件${dictTagSummary()}</p>` : ''}
        <form data-form="bjt-quiz-import" class="stuck-answer">
          <label class="field">問題を読み込む（JSON を貼り付け）<textarea name="json" rows="2" class="export" placeholder='{"app":"grass-quiz","items":[…]}'></textarea></label>
          <button class="outline quiet" type="submit">読み込む（同じ ID は rev が新しいほうに）</button>
        </form>
        ${msg ? `<p class="msg ${msg.ok ? 'ok' : 'err'}">${esc(msg.text)}</p>` : ''}
      </section>`;
  }

  /** 書き取りで付けた目印の多い順（上位2つ） */
  function dictTagSummary() {
    const n = new Map();
    Q.dict.forEach(d => (d.tags || []).forEach(t => n.set(t, (n.get(t) || 0) + 1)));
    const top = [...n].sort((a, b) => b[1] - a[1]).slice(0, 2);
    return top.length ? ` · 多い目印：${top.map(([t, c]) => `${esc(t)}（${c}）`).join('・')}` : '';
  }

  /** 聴読解・読解の資料（表）：{ caption, head:[…], rows:[[…]] } */
  function tableHtml(t) {
    const head = (t.head || []).map(h => `<th scope="col">${esc(h)}</th>`).join('');
    const rows = (t.rows || []).map(r => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('');
    return `<div class="q-table"><table>${t.caption ? `<caption>${esc(t.caption)}</caption>` : ''}${head ? `<thead><tr>${head}</tr></thead>` : ''}<tbody>${rows}</tbody></table></div>`;
  }

  function badge(x) {
    if (x.status === 'auto') return '<em class="qb">自動</em>';
    return x.status === 'reviewed' ? '<em class="qb ok">審査済み</em>' : '<em class="qb">審査前</em>';
  }

  function questionView() {
    const s = Q.session;
    const x = s.items[s.i];
    const locked = s.choice != null && s.answered;        // 答えた（初回の答えは記録済み・もう変えられない）
    const listen = x.part === BASIC || LISTEN.includes(x.part);
    const answered = locked && s.revealed;                // 答え合わせ済み（正誤・選択肢・スクリプトを出す）
    const dictPhase = locked && !s.revealed;              // 聴解：答えたあと、答え合わせの前に書き取る
    const lock = listen && Q.ui.once && s.played > 0 && !locked;
    const hide = examOpts(x) && !answered;      // 選択肢の文を隠して、番号だけ出す

    let playBtn = '';
    if (listen && !locked) {
      playBtn = `
      <button class="primary listen-big" data-act="quiz-play" ${lock || s.playing ? 'disabled' : ''}>
        ${s.playing ? '再生中…' : lock ? '再生しました（1回だけ）' : s.played ? 'もう一度聞く' : '▶ 音声を聞く'}
      </button>`;
    } else if (listen && dictPhase) {
      playBtn = `
      <button class="outline listen-big" data-act="quiz-play" data-v="1" ${s.playing ? 'disabled' : ''}>${s.playing ? '再生中…' : '音声をもう一度聞く（練習・何回でも）'}</button>`;
    } else if (listen) {
      playBtn = `
      <div class="grid2">
        <button class="outline" data-act="quiz-play" data-v="1" ${s.playing ? 'disabled' : ''}>${s.playing && s.rate === 1 ? '再生中…' : '原速で聞く'}</button>
        <button class="outline" data-act="quiz-play" data-v="0.8" ${s.playing ? 'disabled' : ''}>${s.playing && s.rate === 0.8 ? '再生中…' : '0.8倍で聞く'}</button>
      </div>`;
    }

    const opts = x.options.map((o, i) => {
      let cls = '';
      if (answered) cls = i === x.answer ? 'right' : i === s.choice ? 'wrong' : 'dim';
      return `
        <li>
          <button class="opt ${cls}" data-act="quiz-pick" data-v="${i}" aria-pressed="${s.choice === i}" ${locked ? 'disabled' : ''}>
            <span class="k">${LETTERS[i]}</span><span class="o">${hide ? '<span class="muted">（音声で聞く）</span>' : esc(o)}</span>
          </button>
          ${answered && x.why?.[i] ? `<p class="why">${esc(x.why[i])}</p>` : ''}
        </li>`;
    }).join('');

    const rec = s.dictId ? Q.dict.find(d => d.at === s.dictId) : null;
    const prev = Q.dict.filter(d => d.id === x.id && d.at !== s.dictId && d.text).slice(-1)[0];
    const tags = rec?.tags || [];
    const script = answered && listen ? `
      ${rec?.text ? `<div class="q-dict-mine"><p class="label">あなたの書き取り</p><p>${esc(rec.text)}</p></div>` : ''}
      <div class="q-script" aria-label="スクリプト">
        <p class="label">スクリプト</p>
        ${x.part === BASIC ? `<p>${esc(x.scriptText)}</p>` : x.script.map(l => `<p>${l.sp ? `<b>${esc(l.sp)}：</b>` : ''}${esc(l.t)}</p>`).join('')}
      </div>
      ${prev ? `<p class="small" style="margin:0">前回の書き取り（${esc(prev.date)}）：${esc(prev.text)}</p>` : ''}
      <div class="q-noteb">
        <p class="small" style="margin:0">スクリプトと比べて、当てはまるもの（いくつでも）</p>
        <div class="frow wrap" role="group" aria-label="どこで崩れたか">${DTAGS.map(t => `<button class="chip" aria-pressed="${tags.includes(t)}" data-act="quiz-dtag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <p class="caption" style="margin:0;text-align:left">意味が分かったら、スクリプトを見ながら音声に重ねて小さく言ってみましょう（シャドーイング）。0.8倍から始めて、原速へ。</p>
      </div>` : '';

    const dictBox = dictPhase ? `
      <div class="q-dict">
        <p class="label">書き取り（ひらがなでOK・スキップできます）</p>
        <p class="small" style="margin:0">大事だと思った1文か、聞き取れた要点を書いてください。何回聞き直しても、さっきの答え（初回の結果）は変わりません。</p>
        <textarea data-q="dict" rows="3" class="export" placeholder="例：きんがくはまだかくにんちゅうなので…" autocomplete="off">${esc(s.dict || '')}</textarea>
        <button class="primary ink" data-act="quiz-reveal">答え合わせ</button>
        <button class="text-btn" data-act="quiz-reveal" data-v="skip">書かずに答えを見る</button>
      </div>` : '';

    const ok = answered && s.choice === x.answer;
    const noted = s.noted.has(x.id);
    const pick = s.causes || [];
    const causeChips = causes.map(c => `<button class="chip" aria-pressed="${pick.includes(c)}" data-act="quiz-cause" data-v="${esc(c)}">${esc(c)}</button>`).join('');
    const after = answered ? `
      <p class="msg ${ok ? 'ok' : 'err'}">${ok ? '正解です。' : `不正解。正解は ${LETTERS[x.answer]}番です。`}</p>
      ${script}
      ${!ok ? `
        <div class="q-noteb">
          ${noted ? '<p class="msg ok">間違いノートに入れました。明日「間違い」タブで見直します。</p>' : `
            <p class="small" style="margin:0">原因（いくつでも）</p>
            <div class="frow wrap" role="group" aria-label="原因">${causeChips}</div>
            <label class="field">分からなかった表現（あれば）<input data-q="expr" autocomplete="off" placeholder="例：差し支えなければ"></label>
            <button class="outline" data-act="quiz-note">間違いノートに入れる</button>`}
        </div>` : ''}
      <button class="primary ink" data-act="quiz-next">${s.i + 1 < s.items.length ? '次へ' : '結果を見る'}</button>` : dictPhase ? dictBox : `
      <button class="primary ink" data-act="quiz-submit" ${s.choice == null || s.playing || (listen && s.played === 0) ? 'disabled' : ''}>答える</button>`;

    return `
      <section class="card-box quiz" aria-label="問題">
        <div class="q-head">
          <span><b>${s.i + 1} / ${s.items.length}</b> · ${esc(x.part)} · ${esc(x.id)} ${badge(x)}</span>
          <button class="text-btn" data-act="quiz-quit">やめる</button>
        </div>
        ${x.situation ? `<p class="scene">${esc(x.situation)}</p>` : ''}
        ${playBtn}
        ${s.audioError ? `<p class="msg err" role="alert">${esc(s.audioError)}</p>` : ''}
        ${x.table ? tableHtml(x.table) : ''}
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
  /** 書き取り中の文は、画面を描き直す前に拾っておく（再生ボタンを押しても消えないように） */
  const keepDraft = () => {
    const ta = app.querySelector('[data-q="dict"]');
    if (ta && Q.session) Q.session.dict = ta.value;
  };
  const stay = () => { keepDraft(); keepScroll(rerender); };

  function start() {
    const items = pickSession();
    if (!items.length) return;
    Q.session = { items, i: 0, choice: null, answered: false, revealed: false, firstOk: null, dict: '', dictId: null, rate: 1, played: 0, playing: false, results: [], noted: new Set(), causes: [] };
    rerender();
    scrollTop();
  }

  /** 答えたあとの練習の再生：会話（と質問）だけ。速さを選べる。初回の結果には関係しない */
  async function replay(rate) {
    const s = Q.session;
    if (!s || s.playing) return;
    const x = s.items[s.i];
    const [id, key] = x.audioRef || [x.id, 'q'];
    const my = (s.seq = (s.seq || 0) + 1);
    s.playing = true;
    s.rate = rate;
    s.audioError = '';
    stay();
    let ok = false;
    try { ok = await audio.play(id, key, x.part === BASIC ? x.scriptText : '', { wait: true, rate }); } catch (e) { /* 下で案内 */ }
    if (Q.session !== s || s.seq !== my) return;          // 途中で次の問題・やめるに進んだ：古い再生の結果は捨てる
    s.playing = false;
    if (!ok) s.audioError = '音声を再生できませんでした。もう一度試してください。';
    stay();
  }

  async function play(el) {
    const s = Q.session;
    if (!s || s.playing) return;
    if (s.answered) return replay(Number(el?.dataset.v) || 1);
    const x = s.items[s.i];
    if (Q.ui.once && s.played > 0 && !s.answered) return;
    const [id, key] = x.audioRef || [x.id, 'q'];
    const withOpts = examOpts(x);
    const my = (s.seq = (s.seq || 0) + 1);
    const live = () => Q.session === s && s.seq === my;
    s.playing = true;
    stay();
    s.audioError = '';
    let ok = false;
    try {
      ok = await audio.play(id, key, x.part === BASIC ? x.scriptText : '', { wait: true });   // 鳴り終わるまで答えられない
      if (ok && withOpts && live()) ok = await audio.play(x.id, 'o', '', { wait: true });   // 会話と質問のあとに選択肢
    } catch (e) { /* Show a retryable error rather than count a failed play. */ }
    if (!live()) return;                                   // 古い再生の結果で、今の問題の状態を変えない
    s.playing = false;
    if (ok) s.played += 1;
    else s.audioError = '音声を再生できませんでした。接続や音声データを確認して、もう一度試すか「やめる」で戻ってください。';
    if (Q.session === s) stay();
  }

  async function submit() {
    const s = Q.session;
    if (!s || s.choice == null || s.answered) return;
    const x = s.items[s.i];
    if (s.playing || ((x.part === BASIC || LISTEN.includes(x.part)) && s.played === 0)) return;
    const ok = s.choice === x.answer;
    const first = !Q.log.some(e => e.group === x.group);
    const entry = { id: x.id, group: x.group, rev: x.rev || 1, part: x.part, status: x.status, ok, first, date: todayStr(), at: Date.now() };
    Q.log.push(entry);
    s.results.push({ ...entry, question: x.question });
    s.answered = true;
    s.firstOk = ok;
    s.revealed = !(x.part === BASIC || LISTEN.includes(x.part));   // 聴解は書き取りのあとで答え合わせ
    s.causes = x.cause && causes.includes(x.cause) ? [x.cause] : [];
    await saveLog();
    stay();
    if (!s.revealed) app.querySelector('.q-dict')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function reveal(skip) {
    const s = Q.session;
    if (!s || !s.answered || s.revealed) return;
    keepDraft();
    const x = s.items[s.i];
    const text = skip ? '' : String(s.dict || '').trim();
    if (text) {
      const at = Date.now();
      Q.dict.push({ id: x.id, at, date: todayStr(), text, tags: [], firstOk: !!s.firstOk });
      s.dictId = at;
      await saveDict();
    }
    s.revealed = true;
    stay();
  }

  async function dtag(t) {
    const s = Q.session;
    if (!s || !s.revealed) return;
    const x = s.items[s.i];
    let rec = s.dictId ? Q.dict.find(d => d.at === s.dictId) : null;
    if (!rec) {                                           // 書き取らなかったときも、目印だけ残せる
      rec = { id: x.id, at: Date.now(), date: todayStr(), text: '', tags: [], firstOk: !!s.firstOk };
      Q.dict.push(rec);
      s.dictId = rec.at;
    }
    rec.tags = rec.tags.includes(t) ? rec.tags.filter(v => v !== t) : [...rec.tags, t];
    await saveDict();
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
    s.seq = (s.seq || 0) + 1;                             // 再生中の音声の結果を無効にして、止める
    audio.stop?.();
    if (s.i + 1 >= s.items.length) s.finished = true;
    else Object.assign(s, { i: s.i + 1, choice: null, answered: false, revealed: false, firstOk: null, dict: '', dictId: null, rate: 1, played: 0, playing: false, audioError: '', causes: [] });
    rerender();
    scrollTop();
  }

  const actions = {
    'quiz-filter': el => { Q.ui.filter = el.dataset.v; stay(); },
    'quiz-mode': el => { Q.ui.mode = el.dataset.v; stay(); },
    'quiz-n': el => { Q.ui.n = Number(el.dataset.v); stay(); },
    'quiz-once': () => { Q.ui.once = !Q.ui.once; stay(); },
    'quiz-exam': () => { Q.ui.exam = !Q.ui.exam; stay(); },
    'quiz-start': () => start(),
    'quiz-play': el => play(el),
    'quiz-reveal': el => reveal(el.dataset.v === 'skip'),
    'quiz-dtag': el => dtag(el.dataset.v),
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
    'quiz-quit': () => { audio.stop?.(); Q.session = null; rerender(); scrollTop(); },
    'quiz-again': () => { Q.ui.mode = 'new'; start(); },
    'quiz-retry': () => { Q.ui.mode = 'wrong'; start(); },
  };

  /** 「問題を読み込む」：{app:'grass-quiz', items:[…]}（questions:[…] も可）か、問題の配列か、1問だけ */
  async function onImport(form) {
    const text = String(new FormData(form).get('json') || '').trim();
    try {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : Array.isArray(data.questions) ? data.questions : [data];
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
  const exportData = () => ({ quizLog: Q.log, quizItems: Q.user, dictLog: Q.dict });
  async function importData(data) {
    const haveLog = new Set(Q.log.map(e => `${e.id}|${e.at}`));
    const logs = (data.quizLog || []).filter(e => e && e.id && !haveLog.has(`${e.id}|${e.at}`));
    Q.log.push(...logs);
    Q.log.sort((a, b) => a.at - b.at);
    const haveItem = new Set(Q.user.map(x => x.id));
    const items = (data.quizItems || []).filter(x => valid(x) && !haveItem.has(x.id));
    Q.user.push(...items);
    const haveDict = new Set(Q.dict.map(d => `${d.id}|${d.at}`));
    const dicts = (Array.isArray(data.dictLog) ? data.dictLog : []).filter(d => d && d.id && d.at && !haveDict.has(`${d.id}|${d.at}`));
    Q.dict.push(...dicts);
    Q.dict.sort((a, b) => a.at - b.at);
    await Promise.all([saveLog(), saveUser(), saveDict()]);
    return { logs: logs.length, items: items.length, dicts: dicts.length };
  }

  return { load, render, actions, onImport, exportData, importData, inSession: () => !!Q.session, _state: Q };
}
