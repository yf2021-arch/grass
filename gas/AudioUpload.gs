/** Private audio pack upload. Add after doPost's existing token check:
 * if (/^audioUpload/.test(action)) return audioUploadApi_(action, payload);
 * Destination is fixed to My Drive/pwa/audio/grass-card-audio.pack.
 * Audio is sent in 1 MiB chunks; an existing file is updated in place.
 */
const AUDIO_UPLOAD = { NAME: 'grass-card-audio.pack', MAX: 250 * 1024 * 1024, PREFIX: 'grassAudioUpload_' };

function audioUploadFolder_() {
  let folder = DriveApp.getRootFolder();
  ['pwa', 'audio'].forEach(name => {
    const it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

function audioUploadApi_(action, payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: '別のアップロード処理中です。少し待ってください。' });
  try {
    const props = PropertiesService.getScriptProperties();
    if (action === 'audioUploadStart') {
      const size = Number(payload.size);
      if (!Number.isInteger(size) || size < 12 || size > AUDIO_UPLOAD.MAX) throw new Error('音声パックは250MBまでです。');
      // Only one uploader can replace this fixed destination at a time.
      const all = props.getProperties();
      for (const key in all) {
        if (!key.startsWith(AUDIO_UPLOAD.PREFIX)) continue;
        const old = JSON.parse(all[key]);
        if (!old.done && Date.now() - old.at < 10 * 60 * 1000) throw new Error('別の音声アップロードが進行中です。10分後に再試行してください。');
        props.deleteProperty(key);
      }
      const folder = audioUploadFolder_();
      const files = folder.getFilesByName(AUDIO_UPLOAD.NAME);
      const file = files.hasNext() ? files.next() : null;
      const endpoint = 'https://www.googleapis.com/upload/drive/v3/files' + (file ? '/' + encodeURIComponent(file.getId()) : '') + '?uploadType=resumable&fields=id,name,size,webViewLink';
      const res = UrlFetchApp.fetch(endpoint, {
        method: file ? 'patch' : 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(size) },
        payload: JSON.stringify(file ? {} : { name: AUDIO_UPLOAD.NAME, parents: [folder.getId()] }), muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) throw new Error('Drive のアップロード開始に失敗しました（' + res.getResponseCode() + '）。');
      const headers = res.getAllHeaders();
      const url = headers.Location || headers.location;
      if (!/^https:\/\/(?:www\.)?googleapis\.com\/upload\/drive\//.test(String(url))) throw new Error('Drive の保存先を確認できません。');
      const id = Utilities.getUuid();
      props.setProperty(AUDIO_UPLOAD.PREFIX + id, JSON.stringify({ url, size, next: 0, at: Date.now() }));
      return json_({ ok: true, session: id, folder: 'pwa/audio' });
    }
    if (!['audioUploadChunk', 'audioUploadStatus'].includes(action)) throw new Error('未対応の音声操作です。');
    const id = String(payload.session || '');
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('アップロードIDが正しくありません。');
    const key = AUDIO_UPLOAD.PREFIX + id;
    const raw = props.getProperty(key);
    if (!raw) throw new Error('アップロードの期限が切れました。更新をもう一度実行してください。');
    const session = JSON.parse(raw);
    if (session.done) return json_({ ok: true, done: true, next: session.size, url: session.fileUrl });
    const offset = Number(payload.offset);
    let bytes = [];
    if (action === 'audioUploadChunk') {
      if (!Number.isInteger(offset) || offset < 0 || offset >= session.size) throw new Error('送信位置が正しくありません。');
      if (String(payload.data || '').length > 1500000) throw new Error('送信する音声が大きすぎます。');
      bytes = Utilities.base64Decode(String(payload.data || ''));
      if (!bytes.length || offset + bytes.length > session.size || (offset + bytes.length < session.size && bytes.length % 262144 !== 0)) throw new Error('送信する音声の長さが正しくありません。');
      if (offset < session.next) return json_({ ok: true, next: session.next, done: false });
      if (offset !== session.next) throw new Error('送信位置が一致しません。');
    }
    const range = action === 'audioUploadStatus' ? 'bytes */' + session.size : 'bytes ' + offset + '-' + (offset + bytes.length - 1) + '/' + session.size;
    const res = UrlFetchApp.fetch(session.url, { method: 'put', contentType: 'application/octet-stream', headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Range': range,
    }, payload: bytes, muteHttpExceptions: true, followRedirects: false });
    const code = res.getResponseCode();
    if (code === 200 || code === 201) {
      const file = JSON.parse(res.getContentText());
      if (Number(file.size) !== session.size) throw new Error('Drive の音声サイズが一致しません。');
      session.done = true;
      session.fileUrl = file.webViewLink || 'https://drive.google.com/file/d/' + file.id + '/view';
      session.next = session.size;
    } else if (code === 308) {
      const h = res.getAllHeaders();
      const m = /bytes=0-(\d+)/.exec(String(h.Range || h.range || ''));
      session.next = m ? Number(m[1]) + 1 : 0;
    } else throw new Error('Drive の音声送信に失敗しました（' + code + '）。');
    session.at = Date.now();
    props.setProperty(key, JSON.stringify(session));
    return json_({ ok: true, next: session.next, done: !!session.done, url: session.fileUrl || null });
  } catch (e) { return json_({ ok: false, error: e.message }); }
  finally { lock.releaseLock(); }
}

/** Run once in the editor if Google asks to authorize Drive upload requests. */
function grassAuthorizeAudioUpload() {
  audioUploadFolder_();
  const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName)', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error('Drive の接続を確認してください。');
}
