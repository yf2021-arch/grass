import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const values = {};
const requests = [];
const folder = { getFoldersByName: () => ({ hasNext: () => true, next: () => folder }), getId: () => 'audio-folder',
  getFilesByName: () => ({ hasNext: () => true, next: () => ({ getId: () => 'existing-pack' }) }) };
const context = { json_: x => x, Date, Number, String, JSON, Error,
  DriveApp: { getRootFolder: () => folder },
  ScriptApp: { getOAuthToken: () => 'test-token' },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...values }), getProperty: k => values[k], setProperty: (k,v) => { values[k]=v; }, deleteProperty: k => { delete values[k]; } }) },
  Utilities: { getUuid: () => '12345678-1234-1234-1234-123456789abc', base64Decode: s => Array.from(Buffer.from(s,'base64')) },
  UrlFetchApp: { fetch: (url, options) => { requests.push({url,...options}); const n=requests.length;
    return { getResponseCode: () => n===2 ? 308 : 200,
      getAllHeaders: () => n===1 ? { Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=test' } : {Range:'bytes=0-262143'},
      getContentText: () => JSON.stringify({ id:'existing-pack',size:262148,webViewLink:'https://drive.google.com/file/d/existing-pack/view' }) };
  } },
};
vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../gas/AudioUpload.gs',import.meta.url),'utf8'),context);
assert.equal(context.audioUploadApi_('audioUploadStart',{size:-1}).ok,false);
const start=context.audioUploadApi_('audioUploadStart',{size:262148});assert.equal(start.ok,true);
assert.equal(requests[0].method,'patch','overwrite the existing pack rather than create another');
const chunk=context.audioUploadApi_('audioUploadChunk',{session:start.session,offset:0,data:Buffer.alloc(262144).toString('base64')});
assert.equal(chunk.next,262144);assert.equal(chunk.done,false);
const done=context.audioUploadApi_('audioUploadChunk',{session:start.session,offset:262144,data:Buffer.from('test').toString('base64')});
assert.equal(done.done,true);assert.equal(requests[2].headers['Content-Range'],'bytes 262144-262147/262148');
assert.equal(context.audioUploadApi_('audioUploadStatus',{session:start.session}).done,true,'a retry can recover a completed final chunk');
assert.equal(context.audioUploadApi_('audioUploadChunk',{session:'invalid'}).ok,false);
console.log('PASS Drive overwrite, chunk positions, completion recovery and validation');
