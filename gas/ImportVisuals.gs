/**
 * 既存カードに「イメージ図」（AC列。言語＝AA・語根・つながり＝AB の次）を入れる — 一度だけ実行すれば十分です。
 *
 * 使い方：
 *   1. スプレッドシートの「拡張機能 > Apps Script」を開く
 *   2. 「ファイル ＋ > スクリプト」で ImportVisuals という名前のファイルを作り、この中身を貼って保存
 *   3. 上の関数の選択で grassImportVisuals を選び「実行」（初回は権限の許可が出ます）
 *
 * することは2つだけです：
 *   - 01_知識カード の見出しに「イメージ図」がなければ、いちばん右の次の列に作る
 *   - GitHub Pages の data/visuals.json を読み、ID が一致し、イメージ図が空のカードにだけ書く
 *     （入っているセルは、visuals.json の版（rev）のほうが新しいときだけ置き換えます。何度実行しても安全です）
 */
const GRASS_VISUALS_URL = 'https://yf2021-arch.github.io/grass/data/visuals.json';

function grassImportVisuals() {
  const res = UrlFetchApp.fetch(GRASS_VISUALS_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('visuals.json を読めません（' + res.getResponseCode() + '）');
  }
  const visuals = JSON.parse(res.getContentText()).cards || {};

  const sheet = SpreadsheetApp.getActive().getSheetByName('01_知識カード');
  if (!sheet) throw new Error('01_知識カード が見つかりません');

  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const idCol = header.indexOf('ID') + 1;
  if (!idCol) throw new Error('見出し「ID」が見つかりません');
  let visCol = header.indexOf('イメージ図') + 1;
  if (!visCol) {
    visCol = lastCol + 1;
    sheet.getRange(1, visCol).setValue('イメージ図');
  }

  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return;
  const ids = sheet.getRange(2, idCol, rows, 1).getValues();
  const cells = sheet.getRange(2, visCol, rows, 1);
  const current = cells.getValues();
  let written = 0;
  const next = current.map((row, i) => {
    const id = String(ids[i][0]).trim();
    const cur = String(row[0]).trim();
    if (!visuals[id]) return [row[0]];
    if (cur) {
      // 既に入っている絵は、同梱の絵のほうが新しい版（rev）のときだけ置き換える
      let curRev = 1;
      try { curRev = Number(JSON.parse(cur).rev) || 1; } catch (e) { return [row[0]]; }
      if ((Number(visuals[id].rev) || 1) <= curRev) return [row[0]];
    }
    written += 1;
    return [JSON.stringify(visuals[id])];
  });
  cells.setNumberFormat('@').setValues(next);   // 文字列のまま保存（数値や日付に変換させない）

  const msg = 'イメージ図を ' + written + ' 枚に書きました（列 ' + sheet.getRange(1, visCol).getA1Notation().replace(/\d+/, '') + '）';
  Logger.log(msg);
  try { SpreadsheetApp.getActive().toast(msg, 'Grass', 8); } catch (e) { /* エディタから実行したとき */ }
}
