// BJT 対策（v1.6.0・練習は v1.7.0）
//   #/bjt … 4つのタブ
//     練習     … アプリの中で解ける非公式の問題集（js/quiz.js）
//     記録     … 模試・練習の結果（部ごとの正解・未回答・時間）を残し、部ごとの推移を見る
//     間違い   … 間違えた問題の原因を記録し、次の日に見直す。分からなかった表現は REGISTER: でカードにする
//     タイマー … 紙の問題集で解くときのペース計。1問ごとの時間を測り、目安を超えたら知らせる
//
// データはこのスマホの中（meta の bjtScores・bjtMistakes）だけ。公式問題の本文は入れない（問題番号と短い表現だけ）。
// 「バックアップ」で全部を JSON にしてコピーでき、「復元」で戻せる。
// 正解率は点数に換算しない（BJT は 0〜800 点の尺度得点で、正解率から点数は出せない）。

import { createQuiz } from './quiz.js';

const PARTS = [
  { k: '聴解', n: 25, min: 45 },
  { k: '聴読解', n: 25, min: 30 },
  { k: '読解', n: 30, min: 30 },
];
const CAUSES = ['聞き取れない語', '意図・言外の意味', '条件・期限・担当', '図表・資料', '敬語・場面', '語彙・文法', '時間切れ', 'その他'];
const LIMITS = [60, 90, 120];

export function createBjt({ app, esc, go, nav, store, todayStr, ICON, audio = { has: () => false, play: async () => false } }) {
  const B = {
    scores: [],     // { id, date, src, part, ok, n, blank, min, at }
    mistakes: [],   // { id, date, part, q, causes:[], expr, memo, at, reviewedAt, sent }
    tab: 'quiz',
    ui: { part: '読解', notePart: 'すべて', copied: null, backup: null, restoreMsg: null, prefill: null, timerPart: '読解', limit: 90 },
    timer: null,    // { part, n, min, limit, start, qStart, times:[], paused, pausedAt, done }
  };
  let tick = null;

  const keepScroll = fn => {
    const top = app.querySelector('.scroll')?.scrollTop || 0;
    fn();
    app.querySelector('.scroll')?.scrollTo(0, top);
  };

  const quiz = createQuiz({
    app, esc, store, todayStr, audio, causes: CAUSES, keepScroll,
    rerender: () => renderBjt(),
    addMistake: async m => {
      B.mistakes.push({ id: newId('mi'), date: todayStr(), ...m, at: Date.now(), reviewedAt: null, sent: false });
      B.ui.copied = null;
      await saveMistakes();
    },
  });

  /* ---------------- 読み込み・保存 ---------------- */

  async function load() {
    const [s, m] = await Promise.all([store.get('meta', 'bjtScores'), store.get('meta', 'bjtMistakes')]);
    B.scores = Array.isArray(s) ? s : [];
    B.mistakes = Array.isArray(m) ? m : [];
    await quiz.load();
  }
  const saveScores = () => store.put('meta', B.scores, 'bjtScores');
  const saveMistakes = () => store.put('meta', B.mistakes, 'bjtMistakes');
  const newId = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  /** 見直し待ち：前の日までに記録して、まだ見直していないもの */
  const dueReview = () => B.mistakes.filter(m => !m.reviewedAt && m.date < todayStr());
  const pct = (ok, n) => (n ? Math.round((ok / n) * 100) : 0);

  /* ---------------- 画面 ---------------- */

  function renderBjt() {
    const tabs = [['quiz', '練習'], ['log', '記録'], ['note', `間違い${dueReview().length ? ` · ${dueReview().length}` : ''}`], ['timer', 'タイマー']]
      .map(([k, l]) => `<button class="seg-btn" role="tab" aria-selected="${B.tab === k}" data-act="bjt-tab" data-v="${k}">${esc(l)}</button>`).join('');
    const body = B.tab === 'quiz' ? quiz.render() : B.tab === 'log' ? logTab() : B.tab === 'note' ? noteTab() : timerTab();
    app.innerHTML = `
      <div class="screen">
        <div class="scroll">
          <header class="top">
            <div><p class="date">目標 480点（J2 上位・高度人材ポイント 15点）</p><h1>BJT 対策</h1></div>
          </header>
          <div class="seg" role="tablist">${tabs}</div>
          <main class="home bjt">${body}</main>
        </div>
        ${nav('bjt')}
      </div>`;
    if (B.tab === 'timer') startTick();
  }

  /* ---- 記録 ---- */

  function partTiles() {
    return PARTS.map(p => {
      const list = B.scores.filter(s => s.part === p.k);
      const last = list[list.length - 1];
      const prev = list[list.length - 2];
      let trend = '';
      if (last && prev) {
        const d = pct(last.ok, last.n) - pct(prev.ok, prev.n);
        trend = d > 0 ? `<small class="up">↑${d}</small>` : d < 0 ? `<small class="down">↓${-d}</small>` : '<small>±0</small>';
      }
      const spark = list.slice(-8).map(s => `<i style="height:${Math.max(6, pct(s.ok, s.n))}%"></i>`).join('');
      return `
        <div class="tile bjt-tile">
          <span>${p.k}</span>
          <b>${last ? `${pct(last.ok, last.n)}<small>%</small>${trend}` : '—'}</b>
          <div class="spark" aria-hidden="true">${spark}</div>
          <small class="sub">${list.length ? `${list.length}回 · 最新 ${esc(last.date.slice(5))}` : 'まだ記録なし'}</small>
        </div>`;
    }).join('');
  }

  function logTab() {
    const pf = B.ui.prefill || {};
    const part = pf.part || B.ui.part;
    const def = PARTS.find(p => p.k === part);
    const lastSrc = B.scores.length ? B.scores[B.scores.length - 1].src : '公式 模擬テスト＆ガイド';
    const radios = PARTS.map(p => `
      <label class="pick"><input type="radio" name="part" value="${p.k}" ${p.k === part ? 'checked' : ''} data-act="bjt-part"><span>${p.k}</span></label>`).join('');
    const rows = B.scores.slice().reverse().slice(0, 30).map(s => `
      <li class="bjt-row">
        <span class="t"><b>${esc(s.part)} ${s.ok}/${s.n}（${pct(s.ok, s.n)}%）</b>
          <span>${esc(s.date)} · 未回答 ${s.blank} · ${s.min ? `${s.min}分` : '時間なし'}${s.src ? ` · ${esc(s.src)}` : ''}</span></span>
        <button class="mini quiet" data-act="bjt-del-score" data-id="${esc(s.id)}" aria-label="削除">${ICON.close}</button>
      </li>`).join('');
    return `
      <section class="card-box" aria-label="部ごとの推移">
        <p class="label">部ごとの正解率（最新）</p>
        <div class="tiles three">${partTiles()}</div>
        <p class="caption" style="margin:0">正解率は点数ではありません（BJT は尺度得点なので換算しません）。同じ問題の解き直しは記録せず、まだ解いていない問題で測ります。</p>
      </section>

      <section class="card-box" aria-label="結果を記録">
        <p class="label">結果を記録${pf.fromTimer ? ' · タイマーの結果から' : ''}</p>
        <form class="bjt-form" data-form="bjt-score">
          <div class="picks" role="radiogroup" aria-label="部">${radios}</div>
          <div class="grid2">
            <label class="field">日付<input type="date" name="date" value="${esc(pf.date || todayStr())}"></label>
            <label class="field">教材・回<input name="src" value="${esc(pf.src || lastSrc)}" autocomplete="off"></label>
            <label class="field">正解<input type="number" name="ok" inputmode="numeric" min="0" max="${def.n}" required value="${pf.ok ?? ''}"></label>
            <label class="field">問題数<input type="number" name="n" inputmode="numeric" min="1" value="${pf.n || def.n}"></label>
            <label class="field">未回答<input type="number" name="blank" inputmode="numeric" min="0" value="${pf.blank ?? 0}"></label>
            <label class="field">時間（分）<input type="number" name="min" inputmode="numeric" min="0" value="${pf.min ?? def.min}"></label>
          </div>
          <button class="primary ink" type="submit">記録する</button>
        </form>
      </section>

      ${rows ? `<section class="card-box" aria-label="記録の一覧"><p class="label">これまでの記録</p><ul class="bjt-list">${rows}</ul></section>` : ''}

      ${backupBox()}`;
  }

  function backupBox() {
    const bk = B.ui.backup;
    return `
      <section class="group" aria-label="バックアップ">
        <div class="kv"><span>バックアップ</span><b>記録 ${B.scores.length}・間違い ${B.mistakes.length}・練習 ${quiz.exportData().quizLog.length}</b></div>
        <p class="small">この画面のデータはスマホの中だけにあります。ときどきバックアップをコピーして、メモや Google ドライブに貼っておいてください。</p>
        <button class="outline quiet" data-act="bjt-backup">バックアップをコピー</button>
        ${bk ? `<p class="msg ${bk.ok ? 'ok' : 'err'}">${bk.ok ? 'コピーしました。' : '自動でコピーできません。下の文を長押ししてコピーしてください。'}</p>${bk.ok ? '' : `<textarea class="export" readonly rows="5">${esc(bk.text)}</textarea>`}` : ''}
        <form data-form="bjt-restore" class="stuck-answer">
          <label class="field">復元（バックアップの文を貼り付け）<textarea name="json" rows="2" class="export"></textarea></label>
          <button class="outline quiet" type="submit">復元する（今のデータに追加）</button>
        </form>
        ${B.ui.restoreMsg ? `<p class="msg ${B.ui.restoreMsg.ok ? 'ok' : 'err'}">${esc(B.ui.restoreMsg.text)}</p>` : ''}
      </section>`;
  }

  /* ---- 間違い ---- */

  function noteTab() {
    const due = dueReview();
    const dueHtml = due.length ? `
      <section class="card-box due" aria-label="見直し待ち">
        <p class="label">見直し待ち ${due.length}件</p>
        <p class="scene" style="font-size:14px">① 教材の音声や本文で、その問題をもう一度確かめる → ② 分からなかった表現を声に出して言う → ③ 自分の仕事の場面で1文作って言う</p>
        <ul class="bjt-list">${due.map(m => mistakeRow(m, true)).join('')}</ul>
      </section>` : '';

    const parts = ['すべて', ...PARTS.map(p => p.k)];
    const filt = parts.map(p => `<button class="chip" aria-pressed="${B.ui.notePart === p}" data-act="bjt-note-part" data-v="${esc(p)}">${esc(p)}</button>`).join('');
    const list = B.mistakes.filter(m => B.ui.notePart === 'すべて' || m.part === B.ui.notePart).slice().reverse();

    const counts = CAUSES.map(c => [c, B.mistakes.filter(m => (m.causes || []).includes(c)).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
    const max = counts.length ? counts[0][1] : 1;
    const causeBars = counts.length ? `
      <section class="card-box" aria-label="原因の多い順">
        <p class="label">原因の多い順（全 ${B.mistakes.length}件）</p>
        <ul class="cause-bars">${counts.map(([c, n]) => `<li><span>${esc(c)}</span><i style="width:${Math.round((n / max) * 100)}%"></i><b>${n}</b></li>`).join('')}</ul>
      </section>` : '';

    const radios = PARTS.map(p => `<label class="pick"><input type="radio" name="part" value="${p.k}" ${p.k === B.ui.part ? 'checked' : ''}><span>${p.k}</span></label>`).join('');
    const causeChecks = CAUSES.map(c => `<label class="pick"><input type="checkbox" name="cause" value="${esc(c)}"><span>${esc(c)}</span></label>`).join('');

    const unsent = B.mistakes.filter(m => m.expr && !m.sent);
    const copied = B.ui.copied;
    return `
      ${dueHtml}
      <section class="card-box" aria-label="間違いを記録">
        <p class="label">間違いを記録</p>
        <form class="bjt-form" data-form="bjt-mistake">
          <div class="picks" role="radiogroup" aria-label="部">${radios}</div>
          <label class="field">問題番号・出典<input name="q" placeholder="例：模試1 聴解 12" autocomplete="off"></label>
          <fieldset class="picks wrap"><legend class="small">原因（いくつでも）</legend>${causeChecks}</fieldset>
          <label class="field">聞き取れなかった・分からなかった表現<input name="expr" placeholder="例：差し支えなければ" autocomplete="off"></label>
          <label class="field">メモ<input name="memo" placeholder="例：断りを「検討します」と言っていた" autocomplete="off"></label>
          <button class="primary ink" type="submit">記録する</button>
        </form>
        <p class="caption" style="margin:0">問題文はそのまま写さず、問題番号と短い表現だけにします。</p>
      </section>

      ${causeBars}

      ${unsent.length ? `
        <section class="group" aria-label="表現をカードに">
          <div class="kv"><span>カードにしていない表現</span><b>${unsent.length}件</b></div>
          <button class="outline" data-act="bjt-copy">表現をまとめてコピー（REGISTER:）</button>
          ${copied ? `<p class="msg ${copied.ok ? 'ok' : 'err'}">${copied.ok ? 'コピーしました。Claude に貼り付けて送ると、カードになります。' : '自動でコピーできません。下の文を長押ししてコピーしてください。'}</p>
            ${copied.ok ? '' : `<textarea class="export" readonly rows="5">${esc(copied.text)}</textarea>`}
            <button class="text-btn" data-act="bjt-sent">送った分を片付ける</button>` : ''}
        </section>` : ''}

      ${B.mistakes.length ? `
        <section class="card-box" aria-label="間違いの一覧">
          <p class="label">間違いの一覧</p>
          <div class="frow" role="group" aria-label="部で絞る">${filt}</div>
          ${list.length ? `<ul class="bjt-list">${list.map(m => mistakeRow(m, false)).join('')}</ul>` : '<p class="small">この部の記録はまだありません。</p>'}
        </section>` : ''}`;
  }

  function mistakeRow(m, dueMode) {
    return `
      <li class="bjt-row">
        <span class="t"><b>${esc(m.part)}${m.q ? ` · ${esc(m.q)}` : ''}</b>
          ${(m.causes || []).length ? `<span class="causes">${m.causes.map(c => `<em>${esc(c)}</em>`).join('')}</span>` : ''}
          ${m.expr ? `<span>表現：${esc(m.expr)}</span>` : ''}
          ${m.memo ? `<span class="muted">${esc(m.memo)}</span>` : ''}
          <small>${esc(m.date)}${m.reviewedAt ? ' · 見直し済み' : ''}</small></span>
        <span class="stuck-btns">
          ${dueMode ? `<button class="mini" data-act="bjt-reviewed" data-id="${esc(m.id)}">見直した</button>` : ''}
          <button class="mini quiet" data-act="bjt-del-mistake" data-id="${esc(m.id)}" aria-label="削除">${ICON.close}</button>
        </span>
      </li>`;
  }

  /* ---- タイマー ---- */

  const mmss = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function timerTab() {
    const t = B.timer;
    if (!t) {
      const parts = PARTS.map(p => `<button class="chip" aria-pressed="${B.ui.timerPart === p.k}" data-act="bjt-timer-part" data-v="${p.k}">${p.k}（${p.n}問・${p.min}分）</button>`).join('');
      const limits = LIMITS.map(s => `<button class="chip" aria-pressed="${B.ui.limit === s}" data-act="bjt-limit" data-v="${s}">${s}秒</button>`).join('');
      return `
        <section class="card-box" aria-label="ペース・タイマー">
          <p class="label">ペース・タイマー（問題集で解くとき）</p>
          <p class="scene" style="font-size:14px">1問終わるごとに「次の問題」を押します。1問にかかった時間が目安を超えたら知らせます。読解は 30問で30分なので、平均1問1分です。</p>
          <div class="frow" role="group" aria-label="部">${parts}</div>
          <p class="small" style="margin:0">1問の目安</p>
          <div class="frow" role="group" aria-label="1問の目安">${limits}</div>
          <p class="caption" style="margin:0">本番の画面で前の問題に戻れるかは、公式の CBT 体験で確かめてください。戻れないなら、目安を超えた問題は「選んで次へ」が基本です。</p>
          <button class="primary" data-act="bjt-timer-start">スタート</button>
        </section>`;
    }
    if (t.done) {
      const over = t.times.filter(x => x > t.limit * 1000).length;
      const max = Math.max(...t.times, 1);
      const total = t.times.reduce((a, b) => a + b, 0);
      const bars = t.times.map((x, i) => `<li class="${x > t.limit * 1000 ? 'over' : ''}"><span>${i + 1}</span><i style="width:${Math.round((x / max) * 100)}%"></i><b>${mmss(x)}</b></li>`).join('');
      return `
        <section class="card-box" aria-label="タイマーの結果">
          <p class="label">${esc(t.part)} · 結果</p>
          <div class="tiles three">
            <div class="tile"><span>解いた</span><b>${t.times.length}<small>/${t.n}</small></b></div>
            <div class="tile"><span>目安超え</span><b class="${over ? 'down' : ''}">${over}</b></div>
            <div class="tile"><span>合計</span><b>${mmss(total)}</b></div>
          </div>
          ${t.times.length < t.n ? `<p class="msg err">時間内に解けなかった問題：${t.n - t.times.length}問</p>` : ''}
          <ul class="q-bars">${bars}</ul>
          <button class="primary ink" data-act="bjt-timer-record">結果を記録に入れる（正解数は自分で入力）</button>
          <button class="text-btn" data-act="bjt-timer-reset">もう一度</button>
        </section>`;
    }
    return `
      <section class="card-box timer-run" aria-label="計測中">
        <p class="label">${esc(t.part)} · 1問の目安 ${t.limit}秒</p>
        <div class="timer-big"><span>残り</span><b data-t="left">--:--</b></div>
        <div class="timer-q"><span data-t="qn">${t.times.length + 1} / ${t.n} 問目</span><b data-t="qt">0:00</b></div>
        <p class="msg err" data-t="warn" hidden>目安を超えました。選んで次へ進みましょう</p>
        <button class="primary" data-act="bjt-next">次の問題</button>
        <div class="grid2">
          <button class="outline quiet" data-act="bjt-pause">${t.paused ? '再開' : '一時停止'}</button>
          <button class="outline quiet" data-act="bjt-finish">終了</button>
        </div>
      </section>`;
  }

  function elapsed(t) {
    const now = t.paused ? t.pausedAt : Date.now();
    return { total: now - t.start, q: now - t.qStart };
  }

  function updateTimerDom() {
    const t = B.timer;
    if (!t || t.done) return;
    const el = s => app.querySelector(`[data-t="${s}"]`);
    if (!el('left')) return;              // ほかの画面にいる
    const e = elapsed(t);
    const left = t.min * 60000 - e.total;
    el('left').textContent = mmss(left);
    el('left').classList.toggle('down', left < 5 * 60000);
    el('qt').textContent = mmss(e.q);
    const over = e.q > t.limit * 1000;
    el('qt').classList.toggle('down', over);
    el('warn').hidden = !over;
    if (left <= 0) finishTimer();
  }

  function startTick() {
    if (tick) return;
    tick = setInterval(() => {
      if (!B.timer || B.timer.done) { clearInterval(tick); tick = null; return; }
      updateTimerDom();
    }, 250);
    updateTimerDom();
  }

  function finishTimer() {
    const t = B.timer;
    if (!t || t.done) return;
    t.done = true;
    if (tick) { clearInterval(tick); tick = null; }
    if (location.hash.startsWith('#/bjt')) renderBjt();
  }

  /* ---------------- フォーム ---------------- */

  async function onSubmit(form) {
    const f = form.dataset.form;
    if (f === 'bjt-score') {
      const fd = new FormData(form);
      const part = fd.get('part') || B.ui.part;
      const n = Math.max(1, Number(fd.get('n')) || PARTS.find(p => p.k === part).n);
      B.scores.push({
        id: newId('sc'), date: fd.get('date') || todayStr(), src: String(fd.get('src') || '').trim(), part,
        ok: Math.min(n, Math.max(0, Number(fd.get('ok')) || 0)), n,
        blank: Math.max(0, Number(fd.get('blank')) || 0), min: Math.max(0, Number(fd.get('min')) || 0), at: Date.now(),
      });
      B.scores.sort((a, b) => (a.date === b.date ? a.at - b.at : a.date < b.date ? -1 : 1));
      B.ui.part = part;
      B.ui.prefill = null;
      await saveScores();
      renderBjt();
      return true;
    }
    if (f === 'bjt-mistake') {
      const fd = new FormData(form);
      const part = fd.get('part') || B.ui.part;
      const causes = fd.getAll('cause').map(String);
      const q = String(fd.get('q') || '').trim();
      const expr = String(fd.get('expr') || '').trim();
      const memo = String(fd.get('memo') || '').trim();
      if (!q && !expr && !memo && !causes.length) return true;
      B.mistakes.push({ id: newId('mi'), date: todayStr(), part, q, causes, expr, memo, at: Date.now(), reviewedAt: null, sent: false });
      B.ui.part = part;
      B.ui.copied = null;
      await saveMistakes();
      renderBjt();
      return true;
    }
    if (f === 'bjt-quiz-import') return quiz.onImport(form);
    if (f === 'bjt-restore') {
      const text = String(new FormData(form).get('json') || '').trim();
      try {
        const data = JSON.parse(text);
        if (data.app !== 'grass-bjt') throw new Error('Grass の BJT バックアップではありません');
        const have = new Set([...B.scores, ...B.mistakes].map(x => x.id));
        const s = (data.scores || []).filter(x => x && x.id && !have.has(x.id));
        const m = (data.mistakes || []).filter(x => x && x.id && !have.has(x.id));
        B.scores.push(...s);
        B.scores.sort((a, b) => (a.date === b.date ? a.at - b.at : a.date < b.date ? -1 : 1));
        B.mistakes.push(...m);
        B.mistakes.sort((a, b) => a.at - b.at);
        await Promise.all([saveScores(), saveMistakes()]);
        const q = await quiz.importData(data);
        B.ui.restoreMsg = { ok: true, text: `記録 ${s.length}件・間違い ${m.length}件・練習の記録 ${q.logs}件・書き取り ${q.dicts}件を追加しました（同じものは追加しません）` };
      } catch (e) {
        B.ui.restoreMsg = { ok: false, text: e instanceof SyntaxError ? '貼り付けた文が読めません。バックアップの文を全部貼ってください' : e.message };
      }
      renderBjt();
      return true;
    }
    return false;
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* 下の手動コピーへ */ }
    return false;
  }

  /* ---------------- 操作 ---------------- */

  const actions = {
    ...quiz.actions,
    'bjt-tab': el => { B.tab = el.dataset.v; renderBjt(); },
    'bjt-part': el => {                           // 部を変えたら、問題数と時間の初期値も変える
      B.ui.part = el.value;
      if (B.ui.prefill?.fromTimer) return;
      const def = PARTS.find(p => p.k === el.value);
      const form = el.form;
      if (form && def) { form.n.value = def.n; form.min.value = def.min; form.ok.max = def.n; }
    },
    'bjt-del-score': async el => { B.scores = B.scores.filter(s => s.id !== el.dataset.id); await saveScores(); keepScroll(renderBjt); },
    'bjt-del-mistake': async el => { B.mistakes = B.mistakes.filter(m => m.id !== el.dataset.id); await saveMistakes(); keepScroll(renderBjt); },
    'bjt-reviewed': async el => {
      const m = B.mistakes.find(x => x.id === el.dataset.id);
      if (m) m.reviewedAt = Date.now();
      await saveMistakes();
      keepScroll(renderBjt);
    },
    'bjt-note-part': el => { B.ui.notePart = el.dataset.v; keepScroll(renderBjt); },
    'bjt-copy': async () => {
      const list = B.mistakes.filter(m => m.expr && !m.sent);
      const text = [
        'REGISTER:',
        'BJT の練習で聞き取れなかった・分からなかったビジネス日本語の表現です。場面と例文付きでカードにしてください。',
        ...list.map(m => `- ${m.expr}${m.memo ? `（メモ：${m.memo}）` : ''}`),
      ].join('\n');
      const ok = await copyText(text);
      B.ui.copied = { ok, text, ids: list.map(m => m.id) };
      keepScroll(renderBjt);
    },
    'bjt-sent': async () => {
      const ids = new Set(B.ui.copied?.ids || []);
      B.mistakes.forEach(m => { if (ids.has(m.id)) m.sent = true; });
      B.ui.copied = null;
      await saveMistakes();
      keepScroll(renderBjt);
    },
    'bjt-backup': async () => {
      const text = JSON.stringify({ app: 'grass-bjt', version: 1, exportedAt: new Date().toISOString(), scores: B.scores, mistakes: B.mistakes, ...quiz.exportData() });
      const ok = await copyText(text);
      B.ui.backup = { ok, text };
      keepScroll(renderBjt);
    },
    'bjt-timer-part': el => { B.ui.timerPart = el.dataset.v; renderBjt(); },
    'bjt-limit': el => { B.ui.limit = Number(el.dataset.v); renderBjt(); },
    'bjt-timer-start': () => {
      const p = PARTS.find(x => x.k === B.ui.timerPart);
      const now = Date.now();
      B.timer = { part: p.k, n: p.n, min: p.min, limit: B.ui.limit, start: now, qStart: now, times: [], paused: false, pausedAt: 0, done: false };
      renderBjt();
    },
    'bjt-next': () => {
      const t = B.timer;
      if (!t || t.done || t.paused) return;
      const now = Date.now();
      t.times.push(now - t.qStart);
      t.qStart = now;
      if (t.times.length >= t.n) { finishTimer(); return; }
      const qn = app.querySelector('[data-t="qn"]');
      if (qn) qn.textContent = `${t.times.length + 1} / ${t.n} 問目`;
      updateTimerDom();
    },
    'bjt-pause': () => {
      const t = B.timer;
      if (!t || t.done) return;
      if (t.paused) {                             // 止めていた時間を足して、計測を続ける
        const gap = Date.now() - t.pausedAt;
        t.start += gap;
        t.qStart += gap;
        t.paused = false;
      } else {
        t.paused = true;
        t.pausedAt = Date.now();
      }
      renderBjt();
    },
    'bjt-finish': () => finishTimer(),
    'bjt-timer-reset': () => { B.timer = null; renderBjt(); },
    'bjt-timer-record': () => {
      const t = B.timer;
      const total = t.times.reduce((a, b) => a + b, 0);
      B.ui.prefill = { fromTimer: true, part: t.part, n: t.n, blank: t.n - t.times.length, min: Math.max(1, Math.round(total / 60000)), date: todayStr() };
      B.ui.part = t.part;
      B.timer = null;
      B.tab = 'log';
      renderBjt();
      app.querySelector('[data-form="bjt-score"] [name="ok"]')?.focus();
    },
  };

  return {
    load,
    renderBjt,
    actions,
    onSubmit,
    dueCount: () => dueReview().length,
    timerRunning: () => !!B.timer && !B.timer.done,
    quizActive: () => quiz.inSession(),
    _state: B,
  };
}
