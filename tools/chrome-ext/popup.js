// Grass 字幕助手（MV3・activeTab + scripting）
// ボタンを押したときだけ、今のタブ（YouTube の動画ページ）を読む。cookie・履歴・隠れた API・音声には触れない。

const $ = id => document.getElementById(id);
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const toSec = v => {
  const p = String(v || '').trim().split(':').map(Number);
  if (!p.length || p.some(n => !Number.isFinite(n) || n < 0)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
};
let page = null;   // { videoId, title, now }
let pack = null;

async function inTab(fn, args = []) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/(www\.)?youtube\.com\/watch/.test(tab.url || '')) throw new Error('YouTube の動画ページ（youtube.com/watch）で開いてください');
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fn, args });
  return res.result;
}

/* ---- ページの中で動く関数（このページの見えている部分だけを読む） ---- */

function readPage() {
  const v = document.querySelector('video');
  const id = new URL(location.href).searchParams.get('v');
  const title = (document.querySelector('h1.ytd-watch-metadata, h1 yt-formatted-string')?.textContent || document.title).trim();
  return { videoId: id, title, now: v ? v.currentTime : 0 };
}

function readTranscript() {
  const toS = t => String(t).trim().split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
  const segs = [...document.querySelectorAll('ytd-transcript-segment-renderer')];
  const cues = segs.map(el => ({
    s: toS(el.querySelector('.segment-timestamp')?.textContent || ''),
    t: (el.querySelector('.segment-text')?.textContent || '').replace(/\s+/g, ' ').trim(),
  })).filter(c => c.t && Number.isFinite(c.s));
  const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id*="transcript"]');
  const lang = (panel?.querySelector('yt-sort-filter-sub-menu-renderer, #footer')?.textContent || '').replace(/\s+/g, ' ').trim();
  return { cues, lang, panelOpen: !!segs.length };
}

/* ---- ポップアップ ---- */

async function init() {
  try {
    page = await inTab(readPage);
    $('info').innerHTML = '';
    const b = document.createElement('b'); b.textContent = page.title || page.videoId;
    const m = document.createElement('div'); m.className = 'muted'; m.textContent = `動画 ${page.videoId} · 今 ${mmss(page.now)}`;
    $('info').append(b, m);
    $('s').value = mmss(Math.floor(page.now));
    $('e').value = mmss(Math.floor(page.now) + 60);
  } catch (e) {
    $('info').innerHTML = `<span class="err"></span>`; $('info').firstChild.textContent = e.message;
    ['ns', 'ne', 'read'].forEach(id => { $(id).disabled = true; });
  }
}

async function nowTo(field) {
  const p = await inTab(readPage);
  $(field).value = mmss(Math.floor(p.now));
}

async function read() {
  const start = toSec($('s').value);
  const end = toSec($('e').value);
  const prev = $('prev');
  prev.hidden = false;
  pack = null; $('save').disabled = true; $('copy').disabled = true;
  if (start == null || end == null || end <= start) { prev.innerHTML = '<span class="err">始まりと終わりの時間を確かめてください</span>'; return; }
  const r = await inTab(readTranscript);
  if (!r.panelOpen) { prev.innerHTML = '<span class="err">文字起こしパネルが見つかりません。「文字起こしを表示」を開いてから、もう一度押してください。字幕のない動画では使えません。</span>'; return; }
  const all = r.cues.map((c, i) => ({ ...c, e: r.cues[i + 1]?.s ?? c.s + 5 }));
  const cues = all.filter(c => c.s >= start - 1 && c.s <= end);
  const kind = /自動|auto-generated|automatically/i.test(r.lang) ? 'auto' : r.lang ? 'unknown' : 'unknown';
  $('len').textContent = `${end - start}秒 · ${cues.length}行`;
  if (!cues.length) { prev.innerHTML = '<span class="err">この範囲に字幕がありません（不完全なまま保存はしません）</span>'; return; }
  pack = { app: 'grass-rawpack', version: 1, videoId: page.videoId, url: `https://www.youtube.com/watch?v=${page.videoId}`, title: page.title, lang: r.lang || null, captionKind: kind, start, end, cues, takenAt: new Date().toISOString() };
  prev.innerHTML = `<div class="muted">${kind === 'auto' ? '自動字幕（未確認）' : '字幕の種類：分からない（未確認）'}${r.lang ? ` · ${r.lang}` : ''}</div><ol></ol>`;
  const ol = prev.querySelector('ol');
  cues.forEach(c => { const li = document.createElement('li'); li.textContent = `${mmss(c.s)} ${c.t}`; ol.append(li); });
  $('save').disabled = false; $('copy').disabled = false;
}

function saveFile() {
  if (!pack) return;
  const blob = new Blob([JSON.stringify(pack, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grass-rawpack-${pack.videoId}-${pack.start}-${pack.end}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$('ns').onclick = () => nowTo('s').catch(e => alertBox(e));
$('ne').onclick = () => nowTo('e').catch(e => alertBox(e));
$('read').onclick = () => read().catch(e => alertBox(e));
$('save').onclick = saveFile;
$('copy').onclick = async () => { if (pack) { await navigator.clipboard.writeText(JSON.stringify(pack)); $('copy').textContent = 'コピーしました'; } };
function alertBox(e) { const p = $('prev'); p.hidden = false; p.innerHTML = '<span class="err"></span>'; p.firstChild.textContent = e.message || String(e); }
init();
