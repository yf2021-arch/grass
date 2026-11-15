/**
 * 字幕の学習パックを Drive に保存する（字幕助手 0.4.0）
 *
 * Chrome 拡張「Grass 字幕助手」の「Drive に保存」から呼ばれる。
 * 学習パック（grass-rawpack）を、マイドライブの pwa/transcript/ フォルダに JSON ファイルとして置く。
 * フォルダがなければ作る。同じ名前のファイル（同じ動画・同じ範囲）があれば中身を新しくする。
 *
 * Web アプリ（どれもトークンが要る）
 *   保存 … { "action": "transcript", "pack": { "app": "grass-rawpack", ... } }
 *          → { ok, name: "grass-rawpack-<動画ID>-<始まり>-<終わり>.json", url, updated }
 *   一覧 … { "action": "transcriptList" }   → { ok, files: [{ id, name, note, updated, size }] }（新しい順・最大100）
 *   取得 … { "action": "transcriptGet", "id": "..." } → { ok, pack }（スマホの Grass が「Drive から読み込む」で使う）
 *
 * 登録スクリプト本体には、doPost に1行だけ足す（トークンを確かめたあと、ほかの action と同じ場所）：
 *   if (/^transcript/.test(action)) return transcriptApi_(action, payload);
 * 足したら「デプロイ > デプロイを管理 > 編集 > 新バージョン」で公開し直す（URL は変わらない）。
 */

const TRANSCRIPT = {
  PATH: ['pwa', 'transcript'],          // マイドライブからのフォルダ
  MAX_BYTES: 5 * 1024 * 1024,           // 5MB まで（1時間の動画の全字幕でも 1MB 未満）
};

/** マイドライブから順にフォルダをたどる。なければ作る */
function transcriptFolder_() {
  let folder = DriveApp.getRootFolder();
  TRANSCRIPT.PATH.forEach(name => {
    const it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

/** Web アプリの入口（doPost から呼ぶ） */
function transcriptApi_(action, payload) {
  if (action === 'transcript') return saveTranscriptApi_(payload);
  if (action === 'transcriptList') return listTranscriptsApi_();
  if (action === 'transcriptGet') return getTranscriptApi_(payload);
  return json_({ ok: false, error: `不明な action：${action}` });
}

/** 一覧：pwa/transcript の学習パック（新しい順） */
function listTranscriptsApi_() {
  const folder = transcriptFolder_();
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!/^grass-rawpack-.*\.json$/.test(f.getName())) continue;
    files.push({ id: f.getId(), name: f.getName(), note: f.getDescription() || '', updated: f.getLastUpdated().getTime(), size: f.getSize() });
  }
  files.sort((a, b) => b.updated - a.updated);
  return json_({ ok: true, folder: TRANSCRIPT.PATH.join('/'), files: files.slice(0, 100) });
}

/** 取得：1つの学習パック（pwa/transcript の中のファイルだけ） */
function getTranscriptApi_(payload) {
  const id = String(payload.id || '');
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return json_({ ok: false, error: 'ファイルの ID が正しくありません' });
  let file;
  try { file = DriveApp.getFileById(id); } catch (e) { return json_({ ok: false, error: 'ファイルが見つかりません' }); }
  const folder = transcriptFolder_();
  let inside = false;
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folder.getId()) inside = true;
  if (!inside) return json_({ ok: false, error: 'pwa/transcript の中のファイルではありません' });
  let pack;
  try { pack = JSON.parse(file.getBlob().getDataAsString('UTF-8')); } catch (e) { return json_({ ok: false, error: 'JSON として読めません' }); }
  return json_({ ok: true, name: file.getName(), pack });
}

/** 保存 */
function saveTranscriptApi_(payload) {
  const pack = payload.pack;
  if (!pack || pack.app !== 'grass-rawpack' || !/^[A-Za-z0-9_-]{11}$/.test(String(pack.videoId || ''))) {
    return json_({ ok: false, error: '学習パックの形ではありません' });
  }
  if (!Array.isArray(pack.cues) || pack.cues.length === 0) return json_({ ok: false, error: '字幕の行がありません' });
  const start = Math.max(0, Math.floor(Number(pack.start) || 0));
  const end = Math.max(0, Math.floor(Number(pack.end) || 0));
  const name = `grass-rawpack-${pack.videoId}-${start}-${end}.json`;
  const body = JSON.stringify(pack, null, 1);
  if (body.length > TRANSCRIPT.MAX_BYTES) return json_({ ok: false, error: 'パックが大きすぎます（5MB まで）' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: '別の処理中です。少し待って、もう一度押してください' });
  try {
    const folder = transcriptFolder_();
    const same = folder.getFilesByName(name);
    let file;
    let updated = false;
    if (same.hasNext()) {
      file = same.next();
      file.setContent(body);
      updated = true;
    } else {
      file = folder.createFile(name, body, 'application/json');
    }
    const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    file.setDescription(`${String(pack.title || '').slice(0, 80)} · ${mmss(start)}〜${mmss(end)} · ${pack.cues.length}行`);
    return json_({ ok: true, name, url: file.getUrl(), updated, folder: TRANSCRIPT.PATH.join('/') });
  } finally {
    lock.releaseLock();
  }
}
