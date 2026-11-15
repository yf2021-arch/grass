/**
 * 拾った文の待ち行列（アプリ v1.22.0）
 *
 * アプリの「生の日本語」で字幕の行を ＋ で拾うと、マイドライブ / pwa / picks に JSON を1つ置く。
 * Claude の予定タスクがこのフォルダを読み、単語カード／話すチャンクを作ってシートに登録し、ファイルをゴミ箱へ入れる。
 * 手動で Claude に頼んだとき・アプリで消したときは、アプリが pickDone でファイルを外す（あとで二重に作られない）。
 *
 * Web アプリ（どれもトークンが要る）
 *   置く … { "action": "pickPut", "pick": { "app": "grass-pick", "id": "PK-…", "kind": "auto|word|speak", "text": "…", ... } }
 *          同じ id があれば中身を新しくする → { ok, name, updated }
 *   外す … { "action": "pickDone", "id": "PK-…" } → { ok, removed }
 *   一覧 … { "action": "pickList" } → { ok, ids: ["PK-…", …] }（まだ待っているもの）
 *
 * 登録スクリプト本体には、doPost に1行だけ足す（ほかの action と同じ場所）：
 *   if (/^pick/.test(action)) return pickApi_(action, payload);
 * 足したら「デプロイ > デプロイを管理 > 編集 > 新バージョン」で公開し直す（URL は変わらない）。
 */

const PICK = {
  PATH: ['pwa', 'picks'],
  ID: /^PK-[a-z0-9]{6,20}$/,
  MAX_BYTES: 20000,
  MAX_PENDING: 200,
};

function pickFolder_() {
  let folder = DriveApp.getRootFolder();
  PICK.PATH.forEach(name => {
    const it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

function pickApi_(action, payload) {
  if (action === 'pickPut') return pickPutApi_(payload);
  if (action === 'pickDone') return pickDoneApi_(payload);
  if (action === 'pickList') return pickListApi_();
  return json_({ ok: false, error: `不明な action：${action}` });
}

function pickPutApi_(payload) {
  const p = payload.pick;
  if (!p || p.app !== 'grass-pick' || !PICK.ID.test(String(p.id || '')) || !String(p.text || '').trim()) {
    return json_({ ok: false, error: '拾った文の形ではありません' });
  }
  const body = JSON.stringify(p, null, 1);
  if (body.length > PICK.MAX_BYTES) return json_({ ok: false, error: '文が長すぎます' });
  const name = `pick-${p.id}.json`;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: '別の処理中です。少し待ってください' });
  try {
    const folder = pickFolder_();
    const same = folder.getFilesByName(name);
    if (same.hasNext()) {
      same.next().setContent(body);
      return json_({ ok: true, name, updated: true });
    }
    let n = 0;
    const it = folder.getFiles();
    while (it.hasNext()) { it.next(); n += 1; }
    if (n >= PICK.MAX_PENDING) return json_({ ok: false, error: `待っている文が多すぎます（${PICK.MAX_PENDING} まで）` });
    const file = folder.createFile(name, body, 'application/json');
    file.setDescription(`${String(p.kind || 'auto')} · ${String(p.text).slice(0, 60)}`);
    return json_({ ok: true, name, updated: false });
  } finally {
    lock.releaseLock();
  }
}

function pickDoneApi_(payload) {
  const id = String(payload.id || '');
  if (!PICK.ID.test(id)) return json_({ ok: false, error: 'ID が正しくありません' });
  const it = pickFolder_().getFilesByName(`pick-${id}.json`);
  let removed = 0;
  while (it.hasNext()) { it.next().setTrashed(true); removed += 1; }
  return json_({ ok: true, removed });
}

function pickListApi_() {
  const ids = [];
  const it = pickFolder_().getFiles();
  while (it.hasNext()) {
    const m = /^pick-(PK-[a-z0-9]+)\.json$/.exec(it.next().getName());
    if (m) ids.push(m[1]);
  }
  return json_({ ok: true, ids });
}
