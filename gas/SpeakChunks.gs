/**
 * Grass 話す練習のチャンク（v1.5.0）
 *
 * 自分で拾った文（SPEAK:）を「02_話すチャンク」シートに保存し、学習アプリ（PWA）に渡す。
 * 公開リポジトリの data/chunks.json（架空の30個）とは別に、職場の文はここだけに置く。
 *
 * 受け取り方は登録スクリプトと同じ2つ：
 *   1. Web アプリ … { "action": "chunks", "token": "...", "chunks": [ {...} ] }
 *   2. Drive の Grass_Inbox … JSON に "chunks": [ {...} ] を入れる（"cards" と同じファイルでもよい）
 * 1行の形（キーはシートの見出し名）：
 *   { "機能": "説明", "場面": "…", "言う": "…", "型": "…", "説明": "…",
 *     "言い換え1": "…", "違い1": "…", "言い換え2": "…", "違い2": "…", "言い換え3": "…", "違い3": "…", "出典": "…",
 *     "ふりがな": "親友=しんゆう、打ち明けた=うちあけた" }   ← v1.18.0：漢字の語の読み。アプリのタップで出す読みと、音声の読み間違い直しに使う
 * ID（SP-0001）・登録日時・更新日時・使う はこのスクリプトが入れる。同じ「言う」があれば重複として追加しない。
 * 「使う」を × にした行は、アプリに出さない。
 *
 * 登録スクリプト本体には、次の3か所だけ手を入れる（README を参照）：
 *   doPost … if (action === 'chunks') return registerChunksApi_(payload);
 *   pull_  … 返す値に chunks: pullChunks_() を足す
 *   processInbox … payload.chunks があれば registerChunks_ に渡す
 */

const CHUNK = {
  SHEET: '02_話すチャンク',
  HEADERS: ['ID', '登録日時', '更新日時', '機能', '場面', '言う', '型', '説明',
    '言い換え1', '違い1', '言い換え2', '違い2', '言い換え3', '違い3', '出典', '使う', 'ふりがな'],
  PREFIX: 'SP',
  MAX_PER_REQUEST: 30,
  OFF: ['×', '✕', 'x', 'false', 'いいえ', '0'],
};

/** シートがなければ作り、足りない見出しを右に足す */
function chunkSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CHUNK.SHEET);
  if (!sh) {
    sh = ss.insertSheet(CHUNK.SHEET);
    sh.getRange(1, 1, 1, CHUNK.HEADERS.length).setValues([CHUNK.HEADERS]);
    sh.setFrozenRows(1);
    return sh;
  }
  const headers = getHeaders_(sh);
  CHUNK.HEADERS.forEach(name => {
    if (!headers.includes(name)) {
      sh.getRange(1, headers.length + 1).setValue(name);
      headers.push(name);
    }
  });
  return sh;
}

/** Web アプリの入口（doPost から呼ぶ） */
function registerChunksApi_(payload) {
  const chunks = payload.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return json_({ ok: false, error: 'chunks が空です' });
  if (chunks.length > CHUNK.MAX_PER_REQUEST) {
    return json_({ ok: false, error: `一度に送れるのは ${CHUNK.MAX_PER_REQUEST} 個までです` });
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: '別の登録処理中です。少し待って再送してください' });
  try {
    return json_({ ok: true, results: registerChunks_(chunks, 'API') });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

/** チャンクを登録し、結果の配列を返す。呼び出し側でロックを取っておくこと */
function registerChunks_(chunks, origin) {
  const sheet = chunkSheet_();
  const headers = getHeaders_(sheet);
  const sayCol = headers.indexOf('言う');
  const idCol = headers.indexOf('ID');
  const existing = {};
  let maxId = 0;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().forEach(r => {
      const id = String(r[idCol] || '');
      const m = id.match(/^SP-(\d+)$/);
      if (m) maxId = Math.max(maxId, Number(m[1]));
      if (r[sayCol]) existing[normalize_(r[sayCol])] = id;
    });
  }

  const now = formatNow_();
  const rows = [];
  const results = [];
  chunks.forEach(chunk => {
    const say = String((chunk && chunk['言う']) || '').trim();
    const label = say.length > 40 ? say.slice(0, 40) + '…' : say;
    if (!say) {
      results.push({ 表現: '', 結果: 'エラー', ID: '', メッセージ: '話すチャンク：「言う」が空です' });
      return;
    }
    const key = normalize_(say);
    if (existing[key]) {
      results.push({ 表現: label, 結果: '重複', ID: existing[key], メッセージ: '話すチャンク：同じ文があるため追加しませんでした' });
      return;
    }
    const id = `${CHUNK.PREFIX}-${String(++maxId).padStart(4, '0')}`;
    rows.push(headers.map(h => {
      if (h === 'ID') return id;
      if (h === '登録日時' || h === '更新日時') return now;
      if (h === '使う') return '○';
      return toCell_(chunk[h]);
    }));
    existing[key] = id;
    const unknown = Object.keys(chunk).filter(k => !headers.includes(k));
    results.push({
      表現: label, 結果: '登録完了', ID: id,
      メッセージ: `話すチャンク${unknown.length ? `：未知の項目を無視：${unknown.join(', ')}` : ''}`,
    });
  });

  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  writeLogs_(results.map(r => [now, origin, r.表現, r.結果, r.ID, r.メッセージ]));
  return results;
}

/** アプリ用：data/chunks.json と同じ形で返す。シートがなければ空 */
function pullChunks_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CHUNK.SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = getHeaders_(sheet);
  const col = name => headers.indexOf(name);
  const get = (r, name) => (col(name) < 0 ? '' : String(r[col(name)] == null ? '' : r[col(name)]).trim());
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .filter(r => get(r, 'ID') && get(r, '言う') && !CHUNK.OFF.includes(get(r, '使う').toLowerCase()))
    .map(r => ({
      id: get(r, 'ID'),
      fn: get(r, '機能') || '自分の文',
      scene: get(r, '場面'),
      say: get(r, '言う'),
      pattern: get(r, '型'),
      note: get(r, '説明'),
      v: [1, 2, 3].map(i => ({ t: get(r, `言い換え${i}`), n: get(r, `違い${i}`) })).filter(x => x.t),
      furi: get(r, 'ふりがな'),
      src: 'sheet',
    }));
}
