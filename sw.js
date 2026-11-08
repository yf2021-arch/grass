// オフラインでも開けるように、アプリ本体をキャッシュする。
// アプリを更新したら VERSION を上げる（古いキャッシュは自動で消える）。

const VERSION = 'grass-v1.8.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/srs.js',
  './js/sync.js',
  './js/demo.js',
  './js/visual.js',
  './js/speak.js',
  './js/bjt.js',
  './js/quiz.js',
  './js/cardaudio.js',
  './data/visuals.json',
  './data/chunks.json',
  './data/quiz/bjt.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const FONT_CACHE = 'grass-fonts';
const AUDIO_CACHE = 'grass-audio';
const CARD_AUDIO_CACHE = 'grass-audio-cards';   // カードの音声（スマホに読み込んだもの）。絶対に消さない   // 話す練習の音声。アプリを更新しても残す（古いファイルはアプリ側が片付ける）

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => ![VERSION, FONT_CACHE, AUDIO_CACHE, CARD_AUDIO_CACHE].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // シートとの通信（POST）は触らない
  const url = new URL(req.url);

  // Google Fonts：一度読んだら保存しておく
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // 音声：キャッシュ優先。ファイル名に文の記号が入っているので、一度取ったら取り直さない
  if (/\/data\/audio\/[^/]+\.(mp3|wav)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async cache => {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.status === 200) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // アプリ本体：まずネットから新しい版を取り、つながらないときはキャッシュを返す
  event.respondWith(
    caches.open(VERSION).then(async cache => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return (await cache.match('./index.html')) || new Response('', { status: 504 });
        return new Response('', { status: 504 });
      }
    }),
  );
});
