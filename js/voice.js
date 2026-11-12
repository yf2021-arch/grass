// 声で答える（v1.12.0。Whisper で文字にするのは js/whisper.js・v1.13.0）
//
// 2つのやり方があり、1回の答えではどちらか一方だけを使う（Android ではマイクの取り合いになり、同時には使えない）。
//
//   録音（record）… getUserMedia + MediaRecorder。Google のサービスがいらないので、中国版のシステムでも動く。
//     音の大きさを見て、話し始め（onset）と言い終わり（無音が続いたら終わり）を自動で見つける。
//     録音はメモリの中だけ。保存も送信もしない。
//   音声認識（recognize）… Web Speech API。Android の Chrome は Google の音声サービスに送って文字にするので、
//     Google のサービスがない端末では、すぐ失敗するか、何も起きない。失敗の理由は呼び出し側に返す。

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

const TICK = 50;              // 音の大きさを見る間隔（ms）
const ONSET_FRAMES = 3;       // 続けて3回（150ms）声があれば「話し始め」
const MIN_VOICE = 400;        // これより短い音は、咳や物音として扱う
const SILENCE = 1600;         // 話したあと、これだけ黙ったら「言い終わり」
const MAX_TAKE = 20000;       // 1回の最長
const SR_START_TIMEOUT = 5000;

export const srSupported = () => !!SR;
export const micSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

export function createVoice() {
  let ctx = null;
  let stream = null;
  let analyser = null;
  let buf = null;
  let take = null;

  /** タップの処理の中で（await より前に）呼ぶ。音の解析を始められるようにしておく */
  function prepare() {
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      if (!ctx && AC) ctx = new AC();
      ctx?.resume?.().catch(() => {});
    } catch (e) { ctx = null; }
  }

  async function openMic() {
    if (stream && stream.getAudioTracks().some(t => t.readyState === 'live')) return;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    analyser = null;
    if (ctx) {
      try {
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        buf = new Float32Array(analyser.fftSize);
      } catch (e) { analyser = null; }
    }
  }

  function level() {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i += 1) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /** マイクだけを閉じる（1回の録音が終わるたび。音の解析用の AudioContext は残して、次はすぐ始められるようにする） */
  function closeMic() {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    analyser = null;
  }

  /** 全部閉じる（練習が終わったら・画面を離れたら） */
  function release() {
    if (take) take.cancel();
    take = null;
    closeMic();
  }

  /* ---------------- 録音 ---------------- */

  /**
   * 録音を始める。終わると onEnd({ kind:'rec', url, onsetAt, endAt, reason }) が1回だけ呼ばれる。
   * 時刻はどれも performance.now()。onsetAt は声が出なければ null。
   * マイクが使えないときは例外（NotAllowedError など）を投げる。
   */
  async function record({ onLevel = () => {}, onEnd = () => {} } = {}) {
    if (take) take.cancel();
    await openMic();
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find(m => window.MediaRecorder.isTypeSupported?.(m)) || '';
    let rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch (e) { closeMic(); throw e; }
    const parts = [];
    rec.ondataavailable = e => { if (e.data?.size) parts.push(e.data); };

    const t0 = performance.now();
    let floor = 0.01;
    let run = 0;
    let onsetAt = null;
    let voiced = 0;
    let lastVoice = 0;
    let holdUntil = 0;
    let done = false;
    let reason = 'tap';

    const finish = why => {
      if (done) return;
      done = true;
      reason = why;
      clearInterval(timer);
      if (rec.state !== 'inactive') rec.stop(); else emit();
    };
    let emitted = false;
    const emit = () => {
      if (emitted) return;
      emitted = true;
      // 録音が終わったら、毎回マイクを閉じる（答えを見ている間にマイクが使われたままにならないように）
      if (take === me) take = null;
      if (!take) closeMic();
      if (reason === 'cancel') return;
      const blob = new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' });
      const url = blob.size ? URL.createObjectURL(blob) : null;
      onEnd({ kind: 'rec', url, blob: blob.size ? blob : null, startAt: t0, onsetAt, endAt: lastVoice || performance.now(), reason });
    };
    rec.onstop = emit;
    rec.onerror = () => { done = true; clearInterval(timer); reason = reason === 'cancel' ? 'cancel' : 'error'; emit(); };

    const timer = setInterval(() => {
      const now = performance.now();
      const rms = level();
      // 雑音の大きさを少しずつ追いかける（静かになればすぐ下げ、うるさくなればゆっくり上げる）
      floor = rms < floor ? rms : floor + (rms - floor) * 0.003;
      const thr = Math.max(0.02, floor * 3);
      onLevel(Math.min(1, rms / 0.25));
      if (rms > thr) {
        run += 1;
        if (run >= ONSET_FRAMES && onsetAt == null) onsetAt = now - (ONSET_FRAMES - 1) * TICK;
        if (onsetAt != null) { voiced += TICK; lastVoice = now; }
      } else run = 0;
      if (now - t0 > MAX_TAKE) { finish('max'); return; }
      if (now < holdUntil) return;
      if (onsetAt != null && voiced >= MIN_VOICE && now - Math.max(lastVoice, holdUntil) > SILENCE) finish('silence');
    }, TICK);

    try { rec.start(); } catch (e) { clearInterval(timer); closeMic(); throw e; }
    const me = {
      kind: 'rec',
      stop: () => finish('tap'),
      cancel: () => finish('cancel'),
      hold: ms => { holdUntil = performance.now() + ms; },   // 「ちらっと見る」の間は、黙っていても終わらせない
      hasAnalyser: !!analyser,
    };
    take = me;
    return me;
  }

  /* ---------------- 音声認識 ---------------- */

  /**
   * 音声認識を始める。タップの処理の中で（await より前に）呼ぶ。
   * 文字になれば onEnd({ kind:'sr', text, onsetAt, endAt })、使えなければ onFail(理由) が1回だけ呼ばれる。
   */
  function recognize({ lang = 'ja-JP', onText = () => {}, onEnd = () => {}, onFail = () => {} } = {}) {
    if (take) take.cancel();
    if (!SR) { onFail('unsupported'); return null; }
    const t0 = performance.now();
    let r = null;
    let started = false;
    let done = false;
    let finalText = '';
    let interim = '';
    let onsetAt = null;
    let endAt = 0;
    let quietTimer = null;
    let holdUntil = 0;
    let stopping = false;

    const text = () => (finalText + interim).trim();
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(startTimer);
      clearTimeout(quietTimer);
      try { r.abort(); } catch (e) { /* もう止まっている */ }
      if (take === me) take = null;
      onEnd({ kind: 'sr', text: text(), onsetAt, endAt: endAt || performance.now() });
    };
    const fail = why => {
      if (done) return;
      done = true;
      clearTimeout(startTimer);
      clearTimeout(quietTimer);
      try { r.abort(); } catch (e) { /* もう止まっている */ }
      if (take === me) take = null;
      onFail(why);
    };
    const quietLater = () => {
      clearTimeout(quietTimer);
      const wait = Math.max(SILENCE, holdUntil - performance.now() + SILENCE);
      quietTimer = setTimeout(() => { if (text()) end(); }, wait);
    };

    const startOne = () => {
      r = new SR();
      r.lang = lang;
      r.interimResults = true;
      r.continuous = true;
      r.maxAlternatives = 1;
      r.onaudiostart = () => { started = true; };
      r.onstart = () => { started = true; };
      r.onspeechstart = () => { if (onsetAt == null) onsetAt = performance.now(); };
      r.onresult = e => {
        started = true;
        let f = '';
        let i = '';
        for (let k = 0; k < e.results.length; k += 1) {
          const t = e.results[k][0]?.transcript || '';
          if (e.results[k].isFinal) f += t; else i += t;
        }
        // Android は、区切りごとに新しい認識を始め直すので、前の確定分に足していく
        finalText = (r._base || '') + f;
        interim = i;
        if (onsetAt == null) onsetAt = performance.now();
        endAt = performance.now();
        onText(text());
        quietLater();
      };
      r.onerror = e => {
        const err = e.error || 'error';
        if (err === 'no-speech' || err === 'aborted') return;   // onend で始め直す／終える
        if (!started || ['network', 'service-not-allowed', 'not-allowed', 'language-not-supported', 'audio-capture'].includes(err)) fail(err);
      };
      r.onend = () => {
        if (done) return;
        if (!started) { fail('no-service'); return; }
        if (stopping) { end(); return; }
        // 何も聞き取れていなければ、最長まで始め直す（考えている間に切れないように）
        if ((!text() || performance.now() < holdUntil) && performance.now() - t0 < MAX_TAKE) {
          const base = finalText;
          try { startOne(); r._base = base; } catch (e) { end(); }
          return;
        }
        end();
      };
      r.start();
    };

    const startTimer = setTimeout(() => { if (!started) fail('timeout'); }, SR_START_TIMEOUT);
    try { startOne(); } catch (e) { fail(e.name || 'error'); return null; }

    const me = {
      kind: 'sr',
      stop: () => { if (!done) { stopping = true; try { r.stop(); } catch (e) { /* */ } setTimeout(end, 700); } },
      cancel: () => { if (!done) { done = true; clearTimeout(startTimer); clearTimeout(quietTimer); try { r.abort(); } catch (e) { /* */ } if (take === me) take = null; } },
      hold: ms => { holdUntil = performance.now() + ms; if (text()) quietLater(); },
    };
    take = me;
    return me;
  }

  return { prepare, record, recognize, release, active: () => !!take, micOpen: () => !!stream?.getAudioTracks().some(t => t.readyState === 'live') };
}

/* ---------------- 聞き取った文と、答えの文を比べる ---------------- */

const PUNCT = /[\s、。，．,.!?！？「」『』（）()［］[\]・…〜~"'“”‘’:：;；]/g;
const kataToHira = s => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const norm = s => kataToHira(String(s || '').normalize('NFKC')).replace(PUNCT, '').toLowerCase();

/**
 * 答えの文の1文字ずつに、聞き取った文に（順番どおり）あったかの印を付ける（最長共通部分列）。
 * これは「聞き取った文字がどれだけ重なったか」の目安で、発音の良さを測るものではない。
 * 漢字とかなの書き分けが違うだけでも「ない」になる。
 * score は、足りない文字（recall）と余分な文字（precision）の両方を見る（F1）。同じ文を2回言うと 100% にならない。
 * 戻り値：{ score, recall, precision, extra（余分な文字数）, marks: [{ ch, ok }] }（marks は句読点も含む、答えの文そのままの文字）
 */
export function compareSay(target, heard) {
  const chars = [...String(target || '')];
  const keep = chars.map(ch => norm(ch).length > 0);
  const a = chars.map((ch, i) => (keep[i] ? norm(ch) : '')).filter(Boolean);
  const b = [...norm(heard)];
  const n = a.length;
  const m = b.length;
  if (!n) return { score: 0, recall: 0, precision: 0, extra: m, marks: chars.map(ch => ({ ch, ok: true })) };
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hit = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { hit[i] = true; i += 1; j += 1; } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1; else j += 1;
  }
  let k = 0;
  const marks = chars.map((ch, i) => (keep[i] ? { ch, ok: hit[k++] } : { ch, ok: true }));
  const lcs = dp[0][0];
  const recall = lcs / n;
  const precision = m ? lcs / m : 0;
  const score = lcs ? (2 * lcs) / (n + m) : 0;
  return { score, recall, precision, extra: m - lcs, marks };
}
