// オフラインでも開けるように、アプリ本体をキャッシュする。
// アプリを更新したら VERSION を上げる（古いキャッシュは自動で消える）。

const VERSION = 'grass-v1.17.0';
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
  './js/voice.js',
  './js/whisper.js',
  './js/whisper-worker.js',
  './js/bjt.js',
  './js/katsuyo.js',
  './js/quiz.js',
  './js/walk.js',
  './js/raw.js',
  './data/raw/clips.json',
  './js/cardaudio.js',
  './data/visuals.json',
  './data/chunks.json',
  './data/quiz/bjt.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const FONT_CACHE = 'grass-fonts';
const AUDIO_CACHE = 'grass-audio';
const CARD_AUDIO_CACHE = 'grass-audio-cards';
const LIB_CACHE = 'grass-lib';                  // Whisper のライブラリ（jsDelivr・版の付いたファイルなので、取り直さない）
const MODEL_CACHE = 'transformers-cache';       // Whisper のモデル（Transformers.js が入れる）。アプリを更新しても消さない   // カードの音声（スマホに読み込んだもの）。絶対に消さない   // 話す練習の音声。アプリを更新しても残す（古いファイルはアプリ側が片付ける）

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => ![VERSION, FONT_CACHE, AUDIO_CACHE, CARD_AUDIO_CACHE, LIB_CACHE, MODEL_CACHE].includes(k)).map(k => caches.delete(k))))
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

  // Whisper のライブラリ（jsDelivr・版を固定した URL）は、キャッシュ優先
  // （ONNX Runtime の .wasm 本体 27MB は Transformers.js が transformers-cache に入れるので、ここでは .mjs と .js だけ。二重に持たない）
  const lib = url.hostname === 'cdn.jsdelivr.net'
    && (url.pathname.startsWith('/npm/@huggingface/transformers@') || url.pathname.startsWith('/npm/onnxruntime-web@'))
    && /\.m?js$/.test(url.pathname);
  if (lib) {
    event.respondWith(
      caches.open(LIB_CACHE).then(async cache => {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.status === 200) cache.put(req, res.clone());
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
