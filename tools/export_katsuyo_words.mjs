// node tools/export_katsuyo_words.mjs
// 活用ドリルの基本語について、単語ごとに「読み上げる文（語＋すべての答えの形）と読み」を
// data/katsuyo-words.json に書き出す。PC の tools/make_katsuyo_audio.py がこれを読んで音声を作る。
// js/katsuyo.js の基本語や活用ルールを変えたら、これを実行してからコミットする（テストが古さを見つける）。
import fs from 'node:fs';
import path from 'node:path';
import { audioTexts } from '../js/katsuyo.js';

export function build() {
  return { note: 'tools/export_katsuyo_words.mjs が js/katsuyo.js から作る。手で直さない', words: audioTexts() };
}
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'katsuyo-words.json');
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const data = build();
  fs.writeFileSync(out, JSON.stringify(data, null, 1) + '\n');
  const n = data.words.reduce((t, w) => t + w.texts.length, 0);
  console.log(`${data.words.length}語・${n}文 → data/katsuyo-words.json`);
}
