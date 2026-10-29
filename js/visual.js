// イメージ図：カードの「イメージ図」列（AC列。見出し名で探す）の JSON から、絵（SVG）を組み立てる。
// 型は motion / body / kanji / timeline / contrast / scale の6つ。
// ラベル a・b・label は絵の下に HTML で出す（SVG の中に文字を入れない）。
// シートのイメージ図列が空のカードは、data/visuals.json（既存カード用）を使う。

const W = 240;
const H = 120;

/* ---------------- 描画の道具 ---------------- */

const r1 = n => Math.round(n * 10) / 10;

function line(x1, y1, x2, y2, c = 'i', extra = '') {
  return `<path d="M${x1} ${y1}L${x2} ${y2}" class="s-${c}${extra}"/>`;
}

function head(x1, y1, x2, y2, c) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const L = 7;
  const p = d => `${r1(x2 - L * Math.cos(a + d))} ${r1(y2 - L * Math.sin(a + d))}`;
  return `<path d="M${p(0.5)}L${x2} ${y2}L${p(-0.5)}" class="s-${c}"/>`;
}

function arrow(x1, y1, x2, y2, c = 'a', dash = false) {
  return line(x1, y1, x2, y2, c, dash ? ' dash' : '') + head(x1, y1, x2, y2, c);
}

/** 曲線の矢印：M x1 y1 Q cx cy x2 y2 */
function qarrow(x1, y1, cx, cy, x2, y2, c = 'a', dash = false) {
  return `<path d="M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}" class="s-${c}${dash ? ' dash' : ''}"/>` + head(cx, cy, x2, y2, c);
}

const dot = (x, y, r = 7, c = 'a') => `<circle cx="${x}" cy="${y}" r="${r}" class="f-${c}"/>`;
const ring = (x, y, r, c = 'i', dash = false) => `<circle cx="${x}" cy="${y}" r="${r}" class="s-${c}${dash ? ' dash' : ''}"/>`;
const rect = (x, y, w, h, s = 'i', f = null, rx = 6, dash = false) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="s-${s}${f ? ` f-${f}` : ''}${dash ? ' dash' : ''}"/>`;
const path = (d, c = 'i', dash = false) => `<path d="${d}" class="s-${c}${dash ? ' dash' : ''}"/>`;
const fillPath = (d, f = 'a') => `<path d="${d}" class="f-${f}"/>`;
const cup = (x1, y1, x2, y2) => path(`M${x1} ${y1}V${y2}H${x2}V${y1}`, 'i');

/* ---------------- 動き（motion） ---------------- */

const MOTION = {
  // くっつく・接する
  tsuku: () => line(60, 94, 180, 94) + arrow(120, 16, 120, 62, 'a', true) + dot(120, 82, 11) +
    line(100, 74, 92, 68, 'a') + line(140, 74, 148, 68, 'a'),
  // 離れる
  hanareru: () => ring(108, 60, 9, 'f', true) + ring(132, 60, 9, 'f', true) +
    arrow(98, 60, 56, 60, 'f', true) + arrow(142, 60, 184, 60, 'f', true) + dot(40, 60, 11, 'i') + dot(200, 60, 11),
  // 近づく
  chikazuku: () => dot(36, 60, 11, 'i') + dot(204, 60, 11) + arrow(52, 60, 104, 60, 'f', true) + arrow(188, 60, 136, 60, 'f', true) +
    ring(120, 60, 4, 'a'),
  // 中から外へ出す
  dasu: () => cup(70, 48, 170, 104) + arrow(120, 92, 120, 36, 'a', true) + dot(120, 22, 11),
  // 外から中へ入る
  komu: () => cup(70, 40, 170, 104) + arrow(120, 6, 120, 72, 'a', true) + dot(120, 88, 11) +
    line(86, 74, 98, 82, 'a') + line(154, 74, 142, 82, 'a'),
  // 枠からはみ出す
  hamidasu: () => rect(50, 28, 120, 64) + rect(78, 44, 92, 32, 'a', 't', 8) + rect(170, 44, 46, 32, 'w', 'w', 8),
  // 枠の中に収まる
  osamaru: () => rect(50, 24, 140, 72) + rect(82, 44, 76, 32, 'a', 't', 8) +
    arrow(16, 60, 44, 60, 'f', true) + arrow(224, 60, 196, 60, 'f', true),
  // 型・枠にはめる
  hameru: () => path('M70 104V70H96V84H144V70H170V104Z', 'i') + rect(98, 22, 44, 30, 'a', 't', 4) + arrow(120, 54, 120, 78, 'a', true),
  // 容器に少しずつ溜まる
  tamaru: () => rect(62, 74, 116, 28, 'a', 't', 2) + cup(60, 40, 180, 104) + dot(104, 22, 5) + dot(120, 10, 5) + dot(136, 28, 5),
  // 縁を越えてこぼれる・あふれる
  koboreru: () => rect(82, 46, 76, 54, 'a', 't', 2) + cup(80, 44, 160, 102) + qarrow(158, 44, 178, 36, 184, 60, 'a') +
    dot(190, 78, 5) + dot(196, 98, 5),
  // 落ちる
  ochiru: () => line(30, 30, 92, 30) + ring(120, 22, 10, 'f', true) + arrow(120, 38, 120, 82, 'a', true) + dot(120, 96, 11) +
    line(60, 110, 180, 110, 'f'),
  // 穴に深く落ちこむ
  ochikomu: () => path('M20 36H86V108H154V36H220', 'i') + arrow(120, 6, 120, 76, 'a', true) + dot(120, 92, 11),
  // 基準線の上へ
  uwamawaru: () => line(16, 76, 224, 76, 'i', ' dash') + ring(120, 76, 7, 'f', true) + arrow(120, 68, 120, 42, 'a') + dot(120, 30, 10),
  // 基準線の下へ
  shitamawaru: () => line(16, 44, 224, 44, 'i', ' dash') + ring(120, 44, 7, 'f', true) + arrow(120, 52, 120, 78, 'a') + dot(120, 90, 10),
  // 線・限界を越えて先へ
  koeru: () => `<path d="M126 18V102" class="s-i thick"/>` + ring(70, 60, 10, 'f', true) + arrow(84, 60, 176, 60, 'a') + dot(194, 60, 11),
  // ばらばら → 一つにまとめる
  matomeru: () => dot(30, 34, 6, 'i') + dot(58, 94, 6, 'i') + dot(24, 76, 6, 'i') + dot(72, 54, 6, 'i') +
    arrow(92, 60, 126, 60, 'f') + ring(176, 60, 34, 'a') + dot(164, 48, 6) + dot(188, 50, 6) + dot(166, 72, 6) + dot(188, 72, 6),
  // 部品が組み合わさって全体になる
  kumitate: () => rect(18, 30, 26, 22, 'i', 'f', 3) + rect(54, 70, 26, 22, 'i', 'f', 3) + rect(30, 92, 22, 18, 'i', 'f', 3) +
    rect(70, 22, 22, 26, 'i', 'f', 3) + arrow(104, 60, 132, 60, 'f') + rect(144, 20, 80, 80, 'a', null, 8) +
    rect(152, 28, 30, 30, 'a', 't', 3) + rect(186, 28, 30, 30, 'a', 't', 3) + rect(152, 62, 30, 30, 'a', 't', 3) + rect(186, 62, 30, 30, 'a', 't', 3),
  // 輪で囲まれた一つのかたまり
  kakomu: () => `<circle cx="120" cy="60" r="44" class="s-a thick"/>` + dot(104, 46, 7, 'i') + dot(132, 44, 7, 'i') + dot(100, 74, 7, 'i') +
    dot(126, 70, 7, 'i') + dot(144, 60, 7, 'i'),
  // 一つ → ばらばらに散らばる
  chirabaru: () => ring(54, 60, 32, 'i') + dot(44, 50, 6, 'i') + dot(64, 50, 6, 'i') + dot(46, 70, 6, 'i') + dot(64, 70, 6, 'i') +
    arrow(98, 60, 128, 60, 'f') + dot(150, 26, 6) + dot(212, 34, 6) + dot(170, 96, 6) + dot(222, 86, 6),
  // まとまりに外から加える
  kuwaeru: () => ring(96, 60, 36, 'i') + dot(84, 48, 6, 'i') + dot(108, 50, 6, 'i') + dot(94, 74, 6, 'i') +
    arrow(190, 60, 132, 60, 'a', true) + dot(204, 60, 8),
  // 一つを分ける
  wakeru: () => rect(16, 38, 76, 44, 'i', 'f') + arrow(102, 60, 126, 60, 'f') +
    rect(136, 38, 24, 44, 'a', 't', 4) + rect(168, 38, 24, 44, 'a', 't', 4) + rect(200, 38, 24, 44, 'a', 't', 4),
  // 切る・断つ
  kiru: () => `<path d="M20 60H106M134 60H220" class="s-i thick"/>` + `<path d="M108 24L132 96" class="s-a thick"/>`,
  // 混ぜて一つにする
  mazeru: () => `<circle cx="44" cy="60" r="18" class="f-a"/><circle cx="88" cy="60" r="18" class="f-w"/>` + arrow(116, 60, 140, 60, 'f') +
    ring(186, 60, 30, 'i') + dot(174, 48, 6) + dot(196, 52, 6, 'w') + dot(178, 72, 6, 'w') + dot(198, 72, 6) + dot(186, 60, 5),
  // 二つが一つの大きなまとまりになる
  gappei: () => rect(18, 40, 40, 40, 'i') + rect(66, 40, 40, 40, 'w') + arrow(116, 60, 142, 60, 'f') + rect(152, 32, 72, 56, 'a', 't', 8),
  // 和集合：両方を全部含める
  wa: () => `<circle cx="100" cy="60" r="38" class="s-a f-t"/><circle cx="140" cy="60" r="38" class="s-a f-t"/>` +
    ring(100, 60, 38, 'a') + ring(140, 60, 38, 'a'),
  // 境界が薄くなる
  usureru: () => rect(14, 40, 30, 40, 'a', 't', 4) + `<path d="M56 30V90" class="s-i thick"/>` + rect(68, 40, 30, 40, 'w', 'w', 4) +
    arrow(108, 60, 132, 60, 'f') + rect(142, 40, 30, 40, 'a', 't', 4) + line(184, 30, 184, 90, 'f', ' dash') + rect(196, 40, 30, 40, 'w', 'w', 4),
  // 重ねる・積み上げる
  kasaneru: () => rect(70, 92, 100, 14, 'i', 'f', 4) + rect(76, 74, 88, 14, 'i', 'f', 4) + rect(82, 56, 76, 14, 'i', 'f', 4) +
    rect(88, 16, 64, 14, 'a', 't', 4) + arrow(120, 32, 120, 50, 'a'),
  // 入れ子
  ireko: () => rect(40, 10, 160, 100, 'i', null, 8) + rect(66, 28, 108, 64, 'i', null, 6) + rect(92, 46, 56, 28, 'a', 't', 4),
  // 上と下の間の層
  chuukan: () => rect(40, 16, 160, 24, 'f', 'f', 4) + rect(40, 48, 160, 24, 'a', 't', 4) + rect(40, 80, 160, 24, 'f', 'f', 4),
  // 外側へ広がる（拡大）
  hirogaru: () => rect(96, 44, 48, 32, 'i', null, 4, true) + rect(44, 14, 152, 92, 'a', null, 8) +
    arrow(96, 44, 58, 24, 'a') + arrow(144, 44, 182, 24, 'a') + arrow(96, 76, 58, 96, 'a') + arrow(144, 76, 182, 96, 'a'),
  // 内側へ縮む
  chijimu: () => rect(44, 14, 152, 92, 'f', null, 8, true) + rect(92, 42, 56, 36, 'a', 't', 4) +
    arrow(52, 22, 88, 40, 'a') + arrow(188, 22, 152, 40, 'a') + arrow(52, 98, 88, 80, 'a') + arrow(188, 98, 152, 80, 'a'),
  // 横へ展開する
  yokotenkai: () => rect(98, 38, 44, 44, 'a', 't', 6) + rect(38, 44, 32, 32, 'a', null, 6, true) + rect(170, 44, 32, 32, 'a', null, 6, true) +
    arrow(94, 60, 76, 60, 'a') + arrow(146, 60, 164, 60, 'a') + line(14, 60, 30, 60, 'f', ' dash') + line(210, 60, 226, 60, 'f', ' dash'),
  // 手がかりの点をたどる
  tadoru: () => path('M26 92L76 70L128 84L178 42', 'a', true) + dot(26, 92, 6, 'i') + dot(76, 70, 6, 'i') + dot(128, 84, 6, 'i') +
    dot(178, 42, 6, 'i') + arrow(184, 38, 216, 22, 'a'),
  // 前へ進む・届く
  susumu: () => dot(36, 64, 9, 'i') + arrow(52, 64, 178, 64, 'a') + line(196, 28, 196, 98) + fillPath('M196 28L220 37L196 46Z'),
  // 長い道を通らず、直接
  chokusen: () => path('M28 94C58 10 92 116 120 54S182 106 212 26', 'f', true) + arrow(36, 88, 202, 32, 'a') + dot(28, 94, 6, 'i') + ring(212, 26, 7, 'a'),
  // 目的までの複数の方法
  keiro: () => dot(28, 60, 7, 'i') + path('M36 56Q120 0 200 54', 'f') + path('M36 64Q120 120 200 66', 'f') + arrow(38, 60, 196, 60, 'a') +
    ring(212, 60, 10, 'a'),
  // みんなは回り道、一人だけ近道
  chikamichi: () => path('M30 92V24H210V80', 'f', true) + head(210, 60, 210, 80, 'f') + arrow(42, 96, 196, 96, 'a') + dot(30, 96, 6, 'i') +
    ring(210, 92, 8, 'a'),
  // 楽な道を見ながら、あえて別の道
  aete: () => dot(28, 60, 7, 'i') + path('M36 56Q110 20 204 26', 'f', true) + ring(214, 26, 6, 'f') +
    path('M36 64L70 92L100 70L130 98L160 76L190 98', 'a') + head(160, 76, 190, 98, 'a'),
  // 道が一本しか残っていない
  ippon: () => dot(30, 60, 7, 'i') + line(40, 56, 140, 22, 'f') + line(40, 64, 140, 98, 'f') +
    line(136, 14, 152, 30, 'w') + line(152, 14, 136, 30, 'w') + line(136, 90, 152, 106, 'w') + line(152, 90, 136, 106, 'w') +
    arrow(42, 60, 206, 60, 'a'),
  // 回って戻る・ループ
  mawaru: () => `<path d="M156 60A36 36 0 1 1 145.5 34.5" class="s-a"/>` + head(150, 40, 145.5, 34.5, 'a') + dot(84, 60, 7, 'i') +
    dot(120, 96, 7) ,
  // 穴・通路をふさぐ
  fusagu: () => line(16, 38, 224, 38) + line(16, 82, 224, 82) + rect(118, 38, 22, 44, 'a', 'a', 2) + arrow(30, 60, 104, 60, 'f', true),
  // 絡み合う
  karamu: () => path('M18 40C58 104 98 16 138 82S198 36 222 70', 'a') + path('M18 82C58 16 98 104 138 40S198 86 222 50', 'i'),
  // 揺れる・揺らす
  yureru: () => rect(78, 40, 44, 50, 'f', null, 6, true) + rect(118, 40, 44, 50, 'f', null, 6, true) + rect(98, 40, 44, 50, 'a', 't', 6) +
    qarrow(110, 26, 82, 14, 66, 28, 'a') + qarrow(130, 26, 158, 14, 174, 28, 'a'),
  // 先頭に従って動く（演奏者など）
  shitagau: () => dot(54, 60, 12, 'i') + [22, 46, 74, 98].map(y => line(68, 60, 172, y, 'f') + dot(184, y, y === 46 ? 9 : 6, y === 46 ? 'a' : 'i')).join('') +
    ring(184, 46, 15, 'a'),
  // 原因の種から結果の実へ
  inga: () => dot(40, 60, 7) + arrow(54, 60, 146, 60, 'a') + `<circle cx="180" cy="62" r="24" class="s-a f-t"/>` + line(180, 38, 188, 28, 'i'),
  // 軽く触れる
  fureru: () => line(50, 96, 190, 96) + rect(106, 22, 28, 70, 'i', null, 14) + line(98, 88, 90, 84, 'a') + line(142, 88, 150, 84, 'a'),
  // 二つの物体が接する
  sesshoku: () => rect(42, 38, 78, 44, 'i', 'f', 4) + rect(120, 38, 78, 44, 'a', 't', 4) + `<path d="M120 34V86" class="s-a thick"/>`,
  // 二つの輪郭が触れ合う一点
  sesshokuten: () => ring(88, 60, 32) + ring(152, 60, 32) + dot(120, 60, 6) + ring(120, 60, 13, 'a'),
  // ストンと落ちる
  suton: () => line(30, 24, 92, 24) + arrow(120, 14, 120, 76, 'a') + dot(120, 92, 11) + line(60, 106, 180, 106, 'i') +
    line(98, 104, 88, 94, 'w') + line(142, 104, 152, 94, 'w') + line(120, 104, 120, 112, 'w'),
  // 地図の上の一点
  ichi: () => [60, 120, 180].map(x => line(x, 14, x, 106, 'f', ' dash')).join('') + [30, 60, 90].map(y => line(30, y, 210, y, 'f', ' dash')).join('') +
    dot(180, 30, 8) + ring(180, 30, 15, 'a'),
  // それぞれの位置へ割り当てる
  kubaru: () => dot(34, 48, 6, 'i') + dot(48, 62, 6, 'i') + dot(34, 76, 6, 'i') + arrow(62, 62, 144, 28, 'f') + arrow(62, 62, 144, 60, 'f') +
    arrow(62, 62, 144, 92, 'f') + [16, 48, 80].map(y => rect(150, y, 52, 24, 'i', null, 4) + dot(176, y + 12, 6)).join(''),
  // 頭の中でふくらむ
  fukuramu: () => dot(40, 96, 5, 'i') + ring(70, 80, 9, 'a') + ring(110, 60, 16, 'a') + `<circle cx="172" cy="40" r="30" class="s-a f-t"/>`,
  // ある位置から見る
  shiten: () => dot(36, 60, 10) + line(48, 54, 196, 18, 'f') + line(48, 66, 196, 102, 'f') + rect(150, 42, 40, 36, 'i', 'f', 4),
  // 自然に内側へ縮む
  shibomu: () => rect(40, 12, 160, 96, 'f', null, 12, true) + rect(66, 28, 108, 64, 'f', null, 10, true) + rect(94, 44, 52, 32, 'a', 't', 6),
  // 流れに混ぜず別枠で
  betsu: () => arrow(20, 34, 220, 34, 'i') + line(20, 56, 220, 56, 'f', ' dash') + rect(80, 72, 80, 34, 'a', 't', 6),
  // ふたで押さえても、すき間からあふれる
  osaekirenai: () => rect(72, 52, 96, 50, 'a', 't', 2) + cup(70, 48, 170, 104) + `<path d="M62 44H158" class="s-i thick"/>` +
    arrow(110, 8, 110, 34, 'i') + qarrow(166, 46, 186, 36, 192, 58, 'a') + dot(196, 76, 5) + dot(200, 96, 5),
  // まとめて全部なくなる
  gossori: () => rect(30, 44, 180, 46, 'i', null, 8) + [62, 104, 146, 188].map(x => ring(x, 67, 9, 'f', true)).join('') +
    arrow(120, 38, 120, 8, 'w', true),
  // 並んでいたものが少しずつ離れる
  kairi: () => path('M18 50H96Q150 50 222 18', 'a') + path('M18 70H96Q150 70 222 102', 'i') + line(150, 44, 150, 76, 'f', ' dash') +
    line(206, 26, 206, 94, 'w', ' dash'),
  // ぐっと一気に
  gutto: () => line(20, 104, 222, 104, 'f') + `<path d="M20 94H104L128 26H222" class="s-a thick"/>` + dot(128, 26, 7),
  // 並行して進む
  heikou: () => arrow(26, 44, 214, 44, 'a') + arrow(26, 78, 214, 78, 'i'),
  // 二つが一緒に動く
  douki: () => path('M16 46Q46 14 76 46T136 46T196 46T226 40', 'a') + path('M16 84Q46 52 76 84T136 84T196 84T226 78', 'i'),
  // 本来の軌道からずれる
  zureru: () => line(16, 52, 224, 52, 'f', ' dash') + path('M16 52H106Q150 52 196 96', 'a') + head(160, 64, 196, 96, 'a') +
    dot(16, 52, 5, 'i'),
  // かみ合うはずがずれている
  kuichigau: () => path('M30 26H210', 'i') + path('M30 98H210', 'i') +
    [46, 90, 134, 178].map(x => rect(x, 26, 16, 26, 'i', 'f', 2)).join('') +
    [58, 102, 146, 190].map(x => rect(x, 72, 16, 26, 'a', 't', 2)).join('') + line(60, 56, 64, 68, 'w') + line(148, 56, 152, 68, 'w'),
  // 食い違いを直して一致させる
  sorou: () => rect(14, 38, 64, 14, 'i', 'f', 3) + rect(30, 66, 64, 14, 'w', 'w', 3) + arrow(108, 60, 132, 60, 'f') +
    rect(146, 38, 64, 14, 'a', 't', 3) + rect(146, 66, 64, 14, 'a', 't', 3) + line(146, 28, 146, 90, 'a', ' dash'),
  // すき間・並びの間に入る
  sashikomu: () => rect(20, 62, 30, 34, 'i', 'f', 4) + rect(60, 62, 30, 34, 'i', 'f', 4) + rect(150, 62, 30, 34, 'i', 'f', 4) +
    rect(190, 62, 30, 34, 'i', 'f', 4) + arrow(120, 6, 120, 52, 'a', true) + rect(104, 62, 32, 34, 'a', 't', 4),
  // たくさんの中から選び取る
  erabu: () => [44, 84, 164, 204].map(x => dot(x, 86, 8, 'f')).join('') + ring(124, 86, 8, 'a', true) + arrow(124, 74, 124, 46, 'a', true) +
    dot(124, 30, 10),
  // ぱっと光る
  hikaru: () => rect(30, 10, 180, 100, 'f', 'f', 12) +
    [0, 45, 90, 135, 180, 225, 270, 315].map(d => {
      const a = (d * Math.PI) / 180;
      const [i, o] = d % 90 === 0 ? [14, 34] : [14, 26];
      return line(r1(120 + i * Math.cos(a)), r1(60 + i * Math.sin(a)), r1(120 + o * Math.cos(a)), r1(60 + o * Math.sin(a)), 'a');
    }).join('') + dot(120, 60, 7),
  // 上から塗り替える
  uwagaki: () => rect(36, 28, 100, 64, 'w', 'w', 4) + rect(96, 28, 108, 64, 'a', 't', 4) + arrow(66, 104, 176, 104, 'a'),
  // 土台の上に積む
  dodai: () => rect(30, 86, 180, 20, 'i', 'f', 3) + rect(66, 60, 50, 24, 'a', 't', 3) + rect(124, 60, 50, 24, 'a', 't', 3) +
    rect(94, 34, 50, 24, 'a', 't', 3),
  // 別の所から一部を持ってくる
  utsusu: () => rect(16, 18, 70, 84, 'i', null, 4) + [34, 50, 66, 82].map(y => line(28, y, 74, y, y === 50 ? 'a' : 'f')).join('') +
    rect(154, 18, 70, 84, 'i', null, 4) + [34, 66, 82].map(y => line(166, y, 212, y, 'f')).join('') + `<path d="M166 50H212" class="s-a thick"/>` +
    qarrow(80, 46, 120, 10, 158, 46, 'a', true),
  // 一人が全体をまとめて動かす
  hikiiru: () => dot(58, 60, 12) + [22, 46, 74, 98].map(y => line(72, 60, 172, y, 'f') + dot(184, y, 7, 'i')).join(''),
  // 決めた位置に置く
  oku: () => line(150, 34, 150, 94, 'f', ' dash') + line(110, 64, 190, 64, 'f', ' dash') + qarrow(36, 30, 90, 14, 136, 54, 'a', true) +
    dot(150, 64, 9),
  // 複数の位置と関係
  haichi: () => line(54, 36, 148, 28, 'f') + line(148, 28, 188, 84, 'f') + line(54, 36, 108, 92, 'f') + line(108, 92, 188, 84, 'f') +
    dot(54, 36, 8) + dot(148, 28, 8) + dot(108, 92, 8) + dot(188, 84, 8, 'i'),
  // 角度・開き具合
  kakudo: () => line(50, 98, 214, 98) + line(50, 98, 196, 24, 'a') + `<path d="M110 98A60 60 0 0 0 103.5 71" class="s-a"/>` + dot(50, 98, 5, 'i'),
  // こすれ合って抵抗が生まれる
  kosureru: () => rect(60, 30, 120, 30, 'a', 't', 4) + rect(30, 62, 180, 30, 'i', 'f', 4) + arrow(186, 45, 220, 45, 'a') +
    path('M80 61l6-5 6 5 6-5 6 5 6-5 6 5 6-5 6 5 6-5 6 5 6-5 6 5', 'w'),
  // 天秤：一方を重く見る
  tenbin: () => fillPath('M120 64L106 100H134Z', 'f') + line(40, 46, 200, 82) + line(40, 46, 40, 26, 'f') + dot(40, 22, 8, 'i') +
    line(200, 82, 200, 62, 'f') + dot(200, 54, 15),
  // 縛りをゆるめる
  yurumeru: () => dot(56, 60, 10, 'i') + line(36, 40, 76, 80, 'w') + line(36, 80, 76, 40, 'w') + arrow(98, 60, 128, 60, 'f') +
    dot(182, 60, 10) + ring(182, 60, 32, 'f', true),
  // 勢いよく当てる・打つ
  tataku: () => rect(70, 86, 100, 20, 'i', 'f', 3) + rect(92, 72, 56, 14, 'w', 'w', 3) + rect(104, 26, 44, 24, 'a', 'a', 4) +
    line(148, 38, 206, 16) + line(96, 64, 86, 56, 'w') + line(152, 64, 162, 56, 'w'),
  // 背中を押す
  osu: () => `<path d="M24 60H96" class="s-a thick"/>` + head(80, 60, 100, 60, 'a') + dot(124, 60, 13, 'i') +
    line(150, 48, 182, 48, 'f') + line(150, 60, 196, 60, 'f') + line(150, 72, 182, 72, 'f'),
  // 働きかけが届いて効く
  kiku: () => ring(176, 60, 34, 'i') + ring(176, 60, 20, 'i') + dot(176, 60, 7) + arrow(24, 60, 156, 60, 'a') +
    line(196, 30, 204, 22, 'w') + line(206, 46, 218, 42, 'w'),
  // あったものが消える
  kieru: () => rect(30, 44, 180, 46, 'i', null, 8) + dot(62, 67, 9, 'i') + ring(104, 67, 9, 'f', true) + ring(146, 67, 9, 'f', true) +
    ring(188, 67, 9, 'f', true),
  // 次々と引き寄せてくっつける
  hikiyoseru: () => rect(96, 42, 48, 36, 'a', 't', 6) + arrow(30, 22, 90, 46, 'f') + arrow(30, 98, 90, 74, 'f') +
    arrow(210, 22, 150, 46, 'f') + arrow(210, 98, 150, 74, 'f') + dot(24, 20, 5, 'i') + dot(24, 100, 5, 'i') + dot(216, 20, 5, 'i') +
    dot(216, 100, 5, 'i') + dot(110, 54, 5, 'i') + dot(130, 66, 5, 'i'),
  // パーンとはじける
  hajikeru: () => path('M120 30L130 50L152 44L140 62L158 76L134 76L128 98L118 80L98 92L104 70L84 60L106 52Z', 'w') +
    [[60, 30, 84, 44], [180, 30, 158, 44], [56, 96, 82, 82], [184, 96, 160, 82], [120, 6, 120, 20]].map(([a, b, c, d]) => line(a, b, c, d, 'a')).join(''),
  // 波紋が広がる
  hamon: () => arrow(120, 4, 120, 46, 'a', true) + dot(120, 62, 6) + ring(120, 62, 20, 'a') + `<circle cx="120" cy="62" r="36" class="s-a op6"/>` +
    `<circle cx="120" cy="62" r="52" class="s-a op3"/>`,
  // 引っかかりなく通り抜ける
  nukeru: () => line(16, 40, 224, 40, 'f') + line(16, 80, 224, 80, 'f') + line(70, 60, 150, 60, 'a', ' dash') + arrow(150, 60, 172, 60, 'a') +
    dot(186, 60, 10),
  // 最初から最後まで一本で貫く
  tsuranuku: () => rect(36, 36, 34, 48, 'i', 'f', 4) + rect(103, 36, 34, 48, 'i', 'f', 4) + rect(170, 36, 34, 48, 'i', 'f', 4) +
    arrow(16, 60, 224, 60, 'a'),
  // どれもみな同じように
  narabi: () => [18, 64, 110, 156, 202].map(x =>
    path(`M${x} 56L${x + 10} 40L${x + 20} 56V88H${x}Z`, 'i') + rect(x + 4, 62, 12, 22, 'a', 'a', 1)).join(''),
};

/* ---------------- 体（body） ---------------- */

const PART = {
  atama: [120, 22], me: [125, 20], mimi: [131, 24], kuchi: [120, 29], mune: [120, 50], kokoro: [120, 50],
  hara: [120, 72], te: [156, 74], ashi: [133, 110], koshi: [120, 82],
};

function drawBody(spec) {
  const fig = ring(120, 22, 12) + rect(104, 38, 32, 46, 'i', null, 10) +
    line(104, 46, 84, 72) + line(136, 46, 156, 72) + line(112, 84, 108, 112) + line(128, 84, 132, 112);
  let mark = '';
  const part = spec.part;
  if (part === 'zenshin') {
    mark = path('M76 18l-10-4M76 40l-12 0M164 18l10-4M164 40l12 0M78 92l-12 4M162 92l12 4', 'a');
  } else if (part === 'maku') {
    mark = `<path d="M100 61Q120 50 140 61" class="s-a thick"/>` + line(176, 48, 196, 48, 'f') + line(176, 74, 196, 74, 'f');
  } else if (PART[part]) {
    const [x, y] = PART[part];
    const small = ['atama', 'me', 'mimi', 'kuchi'].includes(part);
    mark = dot(x, y, small ? 4 : 6) + ring(x, y, small ? 8 : 12, 'a');
  }
  if (spec.from && PART[spec.from] && PART[part]) {
    const [x1, y1] = PART[spec.from];
    const [x2, y2] = PART[part];
    mark += qarrow(x1 - 18, y1, x1 - 46, (y1 + y2) / 2, x2 - 18, y2, 'a', true);
  }
  return fig + mark;
}

/* ---------------- 時間軸（timeline） ---------------- */

const AXIS = (to = 222) => line(14, 70, to, 70, 'i') + head(14, 70, to, 70, 'i');

const TIMELINE = {
  // 一度止めて、あとで続ける
  pause: () => line(14, 70, 104, 70, 'i') + rect(112, 54, 6, 32, 'w', 'w', 1) + rect(124, 54, 6, 32, 'w', 'w', 1) +
    arrow(140, 70, 222, 70, 'f', true),
  // 越えたら戻れない
  gate: () => AXIS() + `<path d="M120 38V102" class="s-w thick"/>` + qarrow(178, 40, 150, 22, 128, 36, 'f', true) +
    line(146, 20, 158, 32, 'w') + line(158, 20, 146, 32, 'w') + dot(176, 70, 8),
  // 出来事のたびに
  each: () => AXIS() + [50, 110, 170].map(x => dot(x, 70, 6, 'w') + arrow(x, 78, x, 96, 'a') + rect(x - 12, 98, 24, 14, 'a', 't', 3)).join(''),
  // 期間が過ぎる
  span: () => AXIS() + line(50, 58, 50, 82, 'i') + `<path d="M190 56V84" class="s-a thick"/>` +
    path('M50 92V100H190V92', 'a') + qarrow(56, 46, 120, 24, 184, 46, 'a', true),
  // 本番の前に済ませる
  before: () => AXIS() + rect(48, 54, 46, 32, 'a', 't', 4) + rect(150, 50, 56, 40, 'i', 'f', 4) + arrow(98, 40, 146, 40, 'f', true),
  // 時間切れ
  end: () => line(14, 70, 180, 70, 'i') + rect(14, 62, 166, 16, 'f', 'f', 3) + `<path d="M184 46V94" class="s-w thick"/>` + dot(172, 70, 7, 'w'),
  // 今は払わず、後で返ってくる
  later: () => AXIS() + ring(52, 70, 8, 'i', true) + qarrow(60, 60, 120, 14, 180, 58, 'w', true) + rect(168, 60, 28, 22, 'w', 'w', 3),
  // 同じ単位を繰り返す
  repeat: () => AXIS() + [24, 74, 124, 174].map(x => rect(x, 56, 42, 28, 'a', 't', 4)).join(''),
  // 最初の部分
  start: () => AXIS() + rect(14, 58, 52, 24, 'a', 'a', 3) + rect(70, 58, 140, 24, 'f', 'f', 3),
  // 最後に足される時間
  extra: () => line(14, 70, 170, 70, 'i') + line(170, 54, 170, 86, 'i') + rect(174, 58, 40, 24, 'a', 't', 3) + head(14, 70, 222, 70, 'a') +
    qarrow(90, 50, 140, 24, 190, 52, 'f', true),
  // 今からその先へ（どうなる）
  future: () => line(14, 70, 110, 70, 'i') + dot(110, 70, 8) + path('M118 70L210 34M118 70L214 70M118 70L210 106', 'f', true) +
    ring(214, 34, 6, 'f') + ring(218, 70, 6, 'a') + ring(214, 106, 6, 'f'),
};

/* ---------------- 強弱（contrast） ---------------- */

function drawContrast(spec) {
  if (spec.pattern === 'split') {
    return rect(30, 20, 80, 80, 'a', 't', 8) + rect(130, 50, 80, 50, 'f', 'f', 8);
  }
  return [0, 1, 2, 3, 4, 5].map(i => {
    const x = 34 + i * 30;
    return i % 2 === 0 ? rect(x, 24, 20, 76, 'a', 'w', 3) : rect(x, 76, 20, 24, 'f', 'f', 3);
  }).join('') + line(24, 100, 216, 100, 'f');
}

/* ---------------- 程度（scale） ---------------- */

function drawScale(spec) {
  const pos = spec.pos;
  const bar = (y = 60) => rect(30, y - 8, 160, 16, 'f', 'f', 8) + line(190, y - 18, 190, y + 18, 'i');
  if (pos === 'rise') {
    return rect(30, 36, 150, 14, 'f', 'f', 7) + rect(30, 36, 110, 14, 'a', 't', 7) + arrow(144, 43, 176, 43, 'a') +
      rect(30, 76, 150, 14, 'f', 'f', 7) + rect(30, 76, 110, 14, 'w', 'w', 7) + arrow(144, 83, 176, 83, 'w') +
      qarrow(200, 46, 216, 62, 200, 80, 'f', true);
  }
  if (pos === 'beyond') {
    return bar() + arrow(196, 60, 208, 60, 'w', true) + dot(220, 60, 10, 'w');
  }
  if (pos === 'edge') {
    return bar() + rect(30, 52, 160, 16, 'a', 't', 8) + `<path d="M30 30V90" class="s-a"/>` + line(30, 30, 200, 30, 'a', ' dash') + dot(184, 60, 9);
  }
  const n = Math.max(0, Math.min(100, Number(pos) || 50));
  const x = 30 + (160 * n) / 100;
  return bar() + rect(30, 52, Math.max(16, x - 30), 16, 'a', 't', 8) + dot(r1(x), 60, 10);
}

/* ---------------- 読み取り ---------------- */

const TYPES = ['motion', 'body', 'kanji', 'timeline', 'contrast', 'scale'];

/** イメージ図列の文字列（またはオブジェクト）を、正しい形の spec にする。使えなければ null */
export function parseVisual(raw) {
  if (!raw) return null;
  let spec = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s.startsWith('{')) return null;
    try { spec = JSON.parse(s); } catch { return null; }
  }
  if (!spec || typeof spec !== 'object' || !TYPES.includes(spec.type)) return null;
  if (spec.type === 'motion' && !MOTION[spec.motion]) return null;
  if (spec.type === 'timeline' && !TIMELINE[spec.mark]) return null;
  if (spec.type === 'kanji' && !(Array.isArray(spec.parts) && spec.parts.length)) return null;
  return spec;
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function svgFor(spec) {
  if (spec.type === 'motion') return MOTION[spec.motion]();
  if (spec.type === 'body') return drawBody(spec);
  if (spec.type === 'timeline') return TIMELINE[spec.mark]();
  if (spec.type === 'contrast') return drawContrast(spec);
  if (spec.type === 'scale') return drawScale(spec);
  return '';
}

function labelsRow(spec) {
  const a = spec.a ? `<span>${esc(spec.a)}</span>` : '';
  const b = spec.b ? `<span class="to">${esc(spec.b)}</span>` : '';
  if (!a && !b) return '';
  const mid = a && b ? '<span class="arr" aria-hidden="true">→</span>' : '';
  return `<p class="v-labels">${a}${mid}${b}</p>`;
}

function kanjiHtml(spec, mini) {
  const tiles = spec.parts.map(p => `
    <span class="k-tile"><b>${esc(p.char)}</b>${mini ? '' : `<small>${esc(p.meaning)}</small>`}</span>`).join('<span class="k-plus" aria-hidden="true">＋</span>');
  return `<div class="k-row">${tiles}</div>${!mini && spec.scene ? `<p class="k-scene">＝ ${esc(spec.scene)}</p>` : ''}`;
}

/** 絵の HTML。mini は家族マップなど小さく出すとき（ラベルを省く） */
export function visualHtml(spec, { mini = false, alt = '' } = {}) {
  if (!spec) return '';
  const label = [spec.a, spec.b].filter(Boolean).join(' → ') || alt;
  if (spec.type === 'kanji') {
    return `<figure class="visual kanji ${mini ? 'mini' : ''}" aria-label="${esc(label || '漢字の成り立ち')}">${kanjiHtml(spec, mini)}</figure>`;
  }
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || 'イメージ図')}" class="v-svg">${svgFor(spec)}</svg>`;
  return `<figure class="visual ${mini ? 'mini' : ''}">${spec.label && !mini ? `<span class="v-chip">${esc(spec.label)}</span>` : ''}${svg}${mini ? '' : labelsRow(spec)}</figure>`;
}

export const MOTION_NAMES = Object.keys(MOTION);
export const TIMELINE_MARKS = Object.keys(TIMELINE);
