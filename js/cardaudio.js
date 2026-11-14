import { skipLead } from './lead.js';
// カードの音声（v1.4.0）：このスマホの中だけに置く
//   PC の tools/make_card_audio.py が作った「音声パック」（.pack）を、設定から読み込む。
//   音声は Cache Storage の grass-audio-cards に入れ、ネットには出さない（公開リポジトリにも置かない）。
//
// パックの形：'GRASSPK1'（8バイト）＋ ヘッダ長（4バイト・リトルエンディアン）＋ ヘッダ JSON ＋ 音声データ
//   ヘッダ.files：{ "カードID:キー": { name, text, off, len } }
//   キー：w（表現）・ex（自分の例文）・okN（合わない使い方の正しい言い方）・cN（よく合う組み合わせ）

const CACHE = 'grass-audio-cards';
const PREFIX = 'local-audio/';
const MAGIC = 'GRASSPK1';

export function createCardAudio({ store }) {
  const A = { header: null };
  let player = null;
  let playerUrl = null;

  async function load() {
    A.header = (await store.get('meta', 'cardAudio')) || null;
  }

  const has = (id, key) => !!A.header?.files?.[`${id}:${key}`];
  const count = () => Object.keys(A.header?.files || {}).length;
  const info = () => A.header;

  function parse(buf) {
    const bytes = new Uint8Array(buf);
    const magic = new TextDecoder().decode(bytes.slice(0, 8));
    if (magic !== MAGIC) throw new Error('Grass の音声パックではありません');
    const hlen = new DataView(buf).getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + hlen)));
    return { header, base: 12 + hlen };
  }

  /** パックを読み込み、前の音声と入れ替える。返り値：読み込んだ個数 */
  async function importPack(file, onProgress = () => {}) {
    if (!('caches' in window)) throw new Error('このブラウザでは音声を保存できません');
    const buf = await file.arrayBuffer();
    const { header, base } = parse(buf);
    const type = header.type || 'audio/mpeg';
    const cache = await caches.open(CACHE);
    const want = new Set();
    const entries = Object.values(header.files || {});
    let n = 0;
    for (const f of entries) {
      if (base + f.off + f.len > buf.byteLength) throw new Error('パックが途中で切れています。もう一度コピーしてください');
      const url = PREFIX + encodeURIComponent(f.name);
      want.add(new URL(url, location.href).href);
      if (!(await cache.match(url))) {
        const blob = new Blob([buf.slice(base + f.off, base + f.off + f.len)], { type });
        await cache.put(url, new Response(blob, { headers: { 'Content-Type': type } }));
      }
      n += 1;
      if (n % 20 === 0) onProgress(n, entries.length);
    }
    for (const req of await cache.keys()) if (!want.has(req.url)) await cache.delete(req);
    const slim = { ...header, files: Object.fromEntries(Object.entries(header.files).map(([k, v]) => [k, { name: v.name }])), loadedAt: Date.now() };
    await store.put('meta', slim, 'cardAudio');
    A.header = slim;
    try { await navigator.storage?.persist?.(); } catch (e) { /* 任意 */ }
    return n;
  }

  async function clear() {
    if ('caches' in window) await caches.delete(CACHE);
    await store.put('meta', null, 'cardAudio');
    A.header = null;
  }

  /** 鳴らす。成功したら true */
  async function play(id, key) {
    const f = A.header?.files?.[`${id}:${key}`];
    if (!f || !('caches' in window)) return false;
    try {
      const cache = await caches.open(CACHE);
      const res = await cache.match(PREFIX + encodeURIComponent(f.name));
      if (!res) return false;
      const blob = await res.blob();
      if (player) player.pause();
      if (playerUrl) URL.revokeObjectURL(playerUrl);
      playerUrl = URL.createObjectURL(blob);
      player = new Audio(playerUrl);
      skipLead(player);                    // 頭の無音を短くする（v1.19.0）
      await player.play();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 散歩モード用：音声の一時 URL（使い終わったら呼び出し側で revoke する）。なければ null */
  async function url(id, key) {
    const f = A.header?.files?.[`${id}:${key}`];
    if (!f || !('caches' in window)) return null;
    try {
      const res = await (await caches.open(CACHE)).match(PREFIX + encodeURIComponent(f.name));
      return res ? URL.createObjectURL(await res.blob()) : null;
    } catch (e) {
      return null;
    }
  }

  return { load, has, count, info, importPack, clear, play, url };
}
