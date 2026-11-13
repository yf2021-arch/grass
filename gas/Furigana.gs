/**
 * ふりがな（v1.18.0）— 「ふりがな」列を作り、Claude が作った読みをまとめて書き込む
 *
 * 列の書き方（1セルに1行ぶん）：  親友=しんゆう、悩み=なやみ、打ち明けた=うちあけた
 *   - アプリ：文の中のその語に読みを付ける（ふだんは隠し、タップで出す）
 *   - 音声（tools/make_card_audio.py）：AivisSpeech がその語を読み間違えたときだけ、かなで読ませる
 *
 * 使い方：
 *   1. 「拡張機能 > Apps Script」で「ファイル ＋ > スクリプト」→ Furigana という名前で、この中身を貼って保存
 *   2. grassAddFuriColumns を一度実行 → 01_知識カード と 02_話すチャンク の右端に「ふりがな」列ができる
 *   3. 既存の行の読みは Claude が作り、Drive の Grass_Inbox に furi-○○.json を置く。
 *      grassFillFuri を実行すると、空のセルにだけ書き込む（入っているセルは変えない）。済んだファイルは名前の頭に「済_」が付く
 *      JSON の形：{ "furi": { "JP-0001": "親友=しんゆう、…", "SP-0003": "今日中=きょうじゅう" } }
 *      直したいセルも上書きするときは、JSON に "overwrite": true を入れる
 *   新しいカード・自分の文は、Claude のスキルが登録のときに「ふりがな」を入れる（この操作はいらない）
 */
const FURI = {
  HEADER: 'ふりがな',
  SHEETS: ['01_知識カード', '02_話すチャンク'],
  INBOX: 'Grass_Inbox',
};

/** 「ふりがな」列がなければ、いちばん右の次に作る。何度実行しても安全 */
function grassAddFuriColumns() {
  const made = FURI.SHEETS.map(name => {
    const sh = SpreadsheetApp.getActive().getSheetByName(name);
    if (!sh) return `${name}：シートがありません`;
    return furiCol_(sh).made ? `${name}：列を作りました` : `${name}：列はもうあります`;
  });
  Logger.log(made.join('\n'));
  return made;
}

/** Grass_Inbox の furi-*.json を読み、ID が一致する行の「ふりがな」を埋める */
function grassFillFuri() {
  const folders = DriveApp.getFoldersByName(FURI.INBOX);
  if (!folders.hasNext()) throw new Error(`Drive に ${FURI.INBOX} フォルダがありません`);
  const folder = folders.next();
  const files = folder.getFiles();
  const report = [];
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (!/^furi.*\.json$/i.test(name)) continue;
    let data;
    try {
      data = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
    } catch (e) {
      report.push(`${name}：JSON を読めません（${e.message}）`);
      continue;
    }
    const map = data.furi || {};
    const overwrite = data.overwrite === true;
    let written = 0;
    let kept = 0;
    const found = new Set();
    FURI.SHEETS.forEach(sheetName => {
      const sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
      if (!sh || sh.getLastRow() < 2) return;
      const { col } = furiCol_(sh);
      const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      const idCol = header.indexOf('ID') + 1;
      if (!idCol) return;
      const n = sh.getLastRow() - 1;
      const ids = sh.getRange(2, idCol, n, 1).getValues();
      const range = sh.getRange(2, col, n, 1);
      const cells = range.getValues();
      let changed = false;
      ids.forEach(([id], i) => {
        const v = map[String(id).trim()];
        if (typeof v !== 'string' || !v.trim()) return;
        found.add(String(id).trim());
        if (String(cells[i][0]).trim() && !overwrite) { kept += 1; return; }
        cells[i][0] = v.trim();
        written += 1;
        changed = true;
      });
      if (changed) range.setValues(cells);
    });
    const missing = Object.keys(map).filter(id => !found.has(id));
    report.push(`${name}：書き込み ${written}・入っていたのでそのまま ${kept}` +
      (missing.length ? `・ID が見つからない ${missing.length}（${missing.slice(0, 10).join(', ')}）` : ''));
    f.setName(`済_${name}`);
  }
  if (!report.length) report.push(`${FURI.INBOX} に furi で始まる .json がありません`);
  Logger.log(report.join('\n'));
  return report;
}

function furiCol_(sh) {
  const lastCol = sh.getLastColumn();
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const at = header.indexOf(FURI.HEADER) + 1;
  if (at) return { col: at, made: false };
  sh.getRange(1, lastCol + 1).setValue(FURI.HEADER);
  return { col: lastCol + 1, made: true };
}
