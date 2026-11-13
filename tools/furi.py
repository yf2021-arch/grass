"""ふりがな列を使って、AivisSpeech の読み間違いを直す（make_audio.py・make_card_audio.py から使う）

ふりがな列の書き方（アプリの js/furi.js と同じ）：  親友=しんゆう、悩み=なやみ、打ち明けた=うちあけた

やること
  1. 文をそのまま audio_query に渡し、エンジンが読んだ音（カタカナ）を取る
  2. ふりがな列の語のうち、その文に出てくる語の読みが、エンジンの音の中にあるかを見る
  3. なかった語（読み間違えた語）だけ、かなに置き換えて読ませる。合っている語は漢字のまま（アクセントが崩れにくい）

  例：入力値が空です → エンジン「ニュウリョクアタイガソラデス」
      入力値=にゅうりょくち・空=から が見つからない → 「にゅうりょくちがからです」で作る
  読みが合っている文は、文がそのままなので、前に作った音声をそのまま使う（作り直さない）
"""

import hashlib
import json
import re

KANJI = re.compile(r'[㐀-䶿一-鿿豈-﫿々〆ヶ]')
KANA = re.compile(r'[ぁ-ゖァ-ヺー]')


def to_hira(s):
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in str(s))


def to_kata(s):
    return ''.join(chr(ord(c) + 0x60) if 'ぁ' <= c <= 'ゖ' else c for c in str(s))


def parse_furi(raw):
    """「親友=しんゆう、悩み=なやみ」→ [('親友', 'しんゆう'), …]"""
    out, seen = [], set()
    for item in re.split(r'[、,，;；|｜\n\r\t 　]+', str(raw or '')):
        m = re.match(r'^(.+?)[=＝](.+)$', item)
        if not m:
            continue
        w, r = m.group(1).strip(), to_hira(m.group(2).strip())
        if w and r and KANJI.search(w) and w not in seen:
            seen.add(w)
            out.append((w, r))
    return out


def variants(pairs):
    """後ろのかなを外した形（打ち明けた → 打ち明）も候補にする。長い語から"""
    out = []
    for w, r in pairs:
        out.append((w, r, True))
        s, y = w, r
        while len(s) > 1 and KANA.match(s[-1]) and not KANJI.match(s[-1]):
            if y[-1:] != to_hira(s[-1]):
                break
            s, y = s[:-1], y[:-1]
            if not y:
                break
            if KANJI.match(s[-1]):
                out.append((s, y, False))
    return sorted(out, key=lambda v: (-len(v[0]), not v[2]))


def segment(text, pairs):
    """文を [文字列 | (語, 読み)] に分ける（js/furi.js の segment と同じ）"""
    if not text or not pairs:
        return [text] if text else []
    vs = variants(pairs)
    out, plain, i = [], '', 0
    while i < len(text):
        hit = next((v for v in vs if text.startswith(v[0], i)), None)     # 「その時」のように、かなで始まる語もある
        if hit:
            if plain:
                out.append(plain)
                plain = ''
            out.append((hit[0], hit[1]))
            i += len(hit[0])
        else:
            plain += text[i]
            i += 1
    if plain:
        out.append(plain)
    return out


# 長音や「おう／えい」の書き方の違いで、同じ音を違うと判断しないように比べる
#   きょうじゅう は キョウジュウ・キョージュー のどちらにも合う。せんせい は センセイ・センセー・センセエ に合う
_ROWS = {
    'ア': 'アカガサザタダナハバパマヤャラワァ', 'イ': 'イキギシジチヂニヒビピミリィ',
    'ウ': 'ウクグスズツヅヌフブプムユュルゥヴ', 'エ': 'エケゲセゼテデネヘベペメレェ',
    'オ': 'オコゴソゾトドノホボポモヨョロヲォ',
}
_VOWEL = {ch: v for v, chars in _ROWS.items() for ch in chars}


def _kata(s):
    s = to_kata(s).replace('ヲ', 'オ').replace('ヅ', 'ズ').replace('ヂ', 'ジ')
    return ''.join(ch for ch in s if '\u30a1' <= ch <= '\u30fa' or ch == 'ー')


def sound_pattern(reading):
    """読み（かな）から、長音の書き方のゆれを許す正規表現を作る"""
    out, prev = [], None
    for ch in _kata(reading):
        alts = None
        if ch == 'ー' and prev:
            alts = {prev, 'ー'}
        elif prev and (ch == prev or (ch == 'ウ' and prev == 'オ') or (ch == 'イ' and prev == 'エ')):
            alts = {ch, 'ー', prev}
        out.append('(?:' + '|'.join(sorted(alts)) + ')' if alts else re.escape(ch))
        if ch != 'ー':
            prev = _VOWEL.get(ch) if ch not in 'ッン' else None
    return ''.join(out)


def sound_in(reading, heard):
    """エンジンの音（heard）の中に、その読みがあるか"""
    pat = sound_pattern(reading)
    return bool(pat) and re.search(pat, _kata(heard)) is not None


def engine_sound(query):
    """audio_query の結果から、エンジンが読んだ音（カタカナ）"""
    return ''.join(m.get('text', '') for ph in query.get('accent_phrases') or [] for m in ph.get('moras') or [])


def wrong_words(text, pairs, heard):
    """文に出てくるふりがなの語のうち、エンジンの音に読みが見つからない語"""
    out = []
    for seg in segment(text, pairs):
        if isinstance(seg, tuple) and not sound_in(seg[1], heard) and seg not in out:
            out.append(seg)
    return out


def respell(text, pairs, words):
    """読み間違えた語だけ、かなに置き換えた文"""
    bad = {w for w, _ in words}
    return ''.join(seg if isinstance(seg, str) else (seg[1] if seg[0] in bad else seg[0]) for seg in segment(text, pairs))


class Checker:
    """文ごとに「どの語をかなにするか」を決める。結果はファイルに覚え、同じ文は次からエンジンに聞かない"""

    def __init__(self, query_fn, cache_path=None):
        self.query_fn = query_fn                 # text -> audio_query の結果
        self.cache_path = cache_path
        self.cache = {}
        self.fixed = []                          # (元の文, 置き換えた語)
        if cache_path:
            try:
                self.cache = json.loads(cache_path.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                self.cache = {}

    def spoken(self, text, raw_furi, speaker):
        pairs = parse_furi(raw_furi)
        used = [s for s in segment(text, pairs) if isinstance(s, tuple)]
        if not used:
            return text
        key = hashlib.sha1(f'{text}|{used}|{speaker}'.encode('utf-8')).hexdigest()[:16]
        if key not in self.cache:
            words = wrong_words(text, pairs, engine_sound(self.query_fn(text)))
            self.cache[key] = [list(w) for w in words]
        words = [tuple(w) for w in self.cache[key]]
        if not words:
            return text
        self.fixed.append((text, words))
        return respell(text, pairs, words)

    def save(self):
        if self.cache_path:
            self.cache_path.write_text(json.dumps(self.cache, ensure_ascii=False, indent=0), encoding='utf-8')

    def report(self):
        if not self.fixed:
            return ''
        words = []
        for _, ws in self.fixed:
            words += [f'{w}（{r}）' for w, r in ws if f'{w}（{r}）' not in words]
        return f'エンジンが読み間違えたので、ふりがなの読みで作った語：{"、".join(words[:20])}{" ほか" if len(words) > 20 else ""}'
