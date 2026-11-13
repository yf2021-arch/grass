#!/usr/bin/env python3
"""活用ドリルの音声を AivisSpeech で、単語ごとに作る（PC で実行）

使い方
  1. AivisSpeech を起動しておく
  2. python tools/make_katsuyo_audio.py
       → 「話す」と同じ声（data/audio/manifest.json の声と速さ）で、全部の単語の音声を作る
  3. できた data/katsuyo-audio/ をリポジトリに入れて公開する（PR を作ってマージ）
  4. スマホの活用ドリルで「音声をまとめて入れる」（Wi-Fi で）。入れなくても、鳴らした音声から順に保存される

  - 単位は「単語」：1語ごとに、その語と、ドリルで答えになるすべての形（書く・書いて・書いた・書かない・
    書かれる・書かせる・書ける・書くんです・書いたんです …）を1文ずつ音声にします
  - 何を読むかは data/katsuyo-words.json（js/katsuyo.js から tools/export_katsuyo_words.mjs で作る）
  - 同じものはスキップするので、何度実行しても大丈夫。語や活用ルールが変わると、その文だけ作り直します
  - 読みの確認：エンジンの読みが「読み」と違うとき（開ける を あける と読む など）は、かなで作り直します

オプション
  --word 書く,読む   この語だけ作る（ほかの語の音声はそのまま残す）
  --redo 書く        この語の音声を、文が同じでも作り直す（たまたま崩れた音声を直す。スマホでも入れ替わる）
  --speaker 番号     声を変える（--list で番号を確認）。指定しなければ「話す」と同じ声
  --speed 1.0        話す速さ
  --list             声の一覧

基本語の音声だけを作ります（職場の内容を含まないので、公開リポジトリに置けます）。
自分のカードから混ぜた語は、この音声がないので、端末の読み上げ（あれば）を使います。
"""

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_audio import LEAD_TAG, speakers, style_name, request, to_mp3  # noqa: E402
from make_card_audio import make_query, norm_kana, query_kana  # noqa: E402,F401

ROOT = Path(__file__).resolve().parent.parent
WORDS = ROOT / 'data' / 'katsuyo-words.json'
OUT = ROOT / 'data' / 'katsuyo-audio'
MANIFEST = OUT / 'manifest.json'
SPEAK_MANIFEST = ROOT / 'data' / 'audio' / 'manifest.json'


def default_voice():
    """「話す」の音声と同じ声・速さ"""
    try:
        m = json.loads(SPEAK_MANIFEST.read_text(encoding='utf-8'))
        return m['speaker']['id'], float(m.get('speed') or 1.0)
    except (OSError, ValueError, KeyError, TypeError):
        return None, 1.0


def main():
    ap = argparse.ArgumentParser(description='活用ドリルの音声を AivisSpeech で単語ごとに作る')
    ap.add_argument('--engine', default='http://127.0.0.1:10101')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--speaker', type=int)
    ap.add_argument('--speed', type=float)
    ap.add_argument('--word', default='', help='この語だけ（カンマ区切り）')
    ap.add_argument('--redo', default='', help='この語を作り直す（カンマ区切り）')
    args = ap.parse_args()

    sp_list = speakers(args.engine)
    if args.list:
        for sp in sp_list:
            for st in sp.get('styles', []):
                print(f"  {st.get('id'):>12}  {sp.get('name', '')} / {st.get('name', '')}")
        return
    dv, dspeed = default_voice()
    speaker = args.speaker if args.speaker is not None else dv
    speed = args.speed if args.speed is not None else dspeed
    if speaker is None:
        sys.exit('声が決まりません。--list で番号を調べて --speaker 番号 を付けてください。')
    name, style, sp = style_name(sp_list, speaker)
    if name is None:
        sys.exit(f'番号 {speaker} の声が見つかりません。--list で確認してください。')

    words = json.loads(WORDS.read_text(encoding='utf-8'))['words']
    pick = lambda s: [x.strip() for x in s.split(',') if x.strip()]
    only, redo_now = set(pick(args.word)), set(pick(args.redo))
    unknown = (only | redo_now) - {w['w'] for w in words}
    if unknown:
        sys.exit(f'基本語にない語です：{"・".join(sorted(unknown))}（data/katsuyo-words.json を確認）')
    if redo_now:
        only |= redo_now

    OUT.mkdir(parents=True, exist_ok=True)
    use_mp3 = shutil.which('ffmpeg') is not None
    ext = 'mp3' if use_mp3 else 'wav'
    if not use_mp3:
        print('※ ffmpeg が見つからないので WAV で保存します（MP3 より大きくなります）')
    old = {}
    if MANIFEST.exists():
        try:
            old = json.loads(MANIFEST.read_text(encoding='utf-8'))
        except ValueError:
            old = {}
    old_words = old.get('words', {})
    redo = dict(old.get('redo', {}))
    for w in redo_now:
        redo[w] = redo.get(w, 0) + 1

    out_words, made, skipped, kana = {}, 0, 0, []
    for i, word in enumerate(words, 1):
        w = word['w']
        if only and w not in only:
            if w in old_words:
                out_words[w] = old_words[w]          # 対象外の語は前の音声をそのまま
            continue
        files, n_new = {}, 0
        for item in word['texts']:
            t, yomi = item['t'], item.get('yomi', '')
            tag = hashlib.sha1(f'{t}|{yomi}|{speaker}|{speed}|{LEAD_TAG}|redo{redo.get(w, 0)}'.encode('utf-8')).hexdigest()[:10]
            fname = f'k-{tag}.{ext}'
            files[t] = fname
            dest = OUT / fname
            if dest.exists():
                skipped += 1
                continue
            q, switched = make_query(args.engine, t, speaker, speed, yomi)
            if switched:
                kana.append(f'{t}（{yomi}）')
            wav = request(args.engine, '/synthesis', params={'speaker': speaker}, body=q, raw=True)
            if use_mp3:
                to_mp3(wav, dest)
            else:
                dest.write_bytes(wav)
            made += 1
            n_new += 1
        out_words[w] = files
        print(f'[{i}/{len(words)}] {w}：{len(files)}文' + (f'（新しく {n_new}）' if n_new else '（そのまま）'))

    files_all = {}
    for files in out_words.values():
        for t, f in files.items():
            files_all.setdefault(t, f)
    removed = 0
    if not only:                                       # 全部作ったときだけ、使わなくなった音声を消す
        keep = {f for files in out_words.values() for f in files.values()}   # 同じ字で読みが違う文（出させる：ださせる／でさせる）は両方残す
        for p in OUT.iterdir():
            if p.is_file() and p.suffix in ('.mp3', '.wav') and p.name not in keep:
                p.unlink()
                removed += 1

    manifest = {
        'engine': 'AivisSpeech',
        'speaker': {'id': speaker, 'name': name, 'style': style, 'uuid': sp.get('speaker_uuid', ''), 'version': sp.get('version', '')},
        'speed': speed,
        'credit': f'音声：AivisSpeech（{name}）',
        'redo': redo,
        'words': out_words,
        'files': files_all,          # 文 → ファイル（語が分からないとき用）。アプリはまず words[語][文] を見る
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    all_names = {f for files in out_words.values() for f in files.values()}
    total = sum((OUT / f).stat().st_size for f in all_names if (OUT / f).exists())
    print(f'\n完了：{len(out_words)}語・{len(all_names)}ファイル。作成 {made}・そのまま {skipped}・削除 {removed}。合計 {total / 1024 / 1024:.1f}MB')
    if kana:
        print(f'かなで読み直したもの（{len(kana)}）：' + '、'.join(kana[:30]) + (' …' if len(kana) > 30 else ''))
    print('聞いて変なものがあれば：python tools/make_katsuyo_audio.py --redo 語')


if __name__ == '__main__':
    main()
