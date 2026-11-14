// 音声の頭の無音（v1.19.0）
//   tools/make_audio.py・make_card_audio.py は、音声の頭に 0.4 秒の無音を入れて作る
//   （スマホやイヤホンで再生の最初が切れても、言葉が欠けないように）。
//   再生するときに、その一部を飛ばして待ち時間を短くする。作り直しはいらない。
//   残す長さは設定で選ぶ（このスマホに保存）：0.4（そのまま）／0.2（標準）／0.1 秒。
//   最初の言葉が切れるなら 0.4 に戻す（Bluetooth のイヤホンは切れやすい）。
export const LEAD_SEC = 0.4;
export const LEAD_CHOICES = [0.4, 0.2, 0.1];
const KEY = 'audioLead';
const DEFAULT = 0.2;

/** 残す無音の長さ（秒） */
export function leadKeep() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return LEAD_CHOICES.includes(v) ? v : DEFAULT;
  } catch { return DEFAULT; }
}

export function setLeadKeep(sec) {
  try { localStorage.setItem(KEY, String(sec)); } catch { /* 保存できなくても、今だけ使う */ }
}

/** 頭の無音を入れて作った音声を、play() の前に呼ぶ。飛ばす分だけ再生位置を進める */
export function skipLead(audio) {
  const skip = Math.max(0, LEAD_SEC - leadKeep());
  if (!audio || !skip) return;
  try { audio.currentTime = skip; } catch { /* 位置を変えられなければ、頭から鳴らす */ }
}
