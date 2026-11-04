#!/usr/bin/env python3
"""話す練習の音声を AivisSpeech で作る（PC で実行）

使い方
  1. AivisSpeech を起動しておく（エンジンが http://127.0.0.1:10101 で動きます）
  2. 声の一覧を見る：      python tools/make_audio.py --list
  3. 声を選んで音声を作る：python tools/make_audio.py --speaker 番号

  - data/chunks.json の「答え」と「言い換え3つ」を、1文ずつ音声にします（30個 × 4 = 120ファイル）
  - 出力は data/audio/。ファイル名に「文＋声＋速さ」から作った短い記号が付くので、
    文を直したり声を変えたりすると、その文だけ作り直されます（同じものはスキップ）
  - 使わなくなった古いファイルは削除します
  - ffmpeg があれば小さな MP3（全部で数MB）、なければ WAV（少し大きい）にします
  - 必要なのは Python 3.8 以上だけです（追加のインストールは不要）

オプション
  --speed 0.9     話す速さ（1.0 が標準。聞き取り練習なら 0.9 前後もおすすめ）
  --engine URL    エンジンの場所（標準：http://127.0.0.1:10101）
  --only ch-05    一部だけ作る（試すとき。カンマ区切りで複数可）

音声モデルのライセンス（ACML / ACML-NC / CC0 など）は、モデルごとに確認してください。
リポジトリは公開なので、音声の公開が認められているモデルを使います。
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / 'data' / 'chunks.json'
OUT = ROOT / 'data' / 'audio'
MANIFEST = OUT / 'manifest.json'


def request(engine, path, params=None, body=None, raw=False, timeout=120):
    url = engine.rstrip('/') + path
    if params:
        url += '?' + urllib.parse.urlencode(params)
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    method = 'GET' if (body is None and path == '/speakers') else 'POST'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        payload = res.read()
    return payload if raw else json.loads(payload.decode('utf-8'))


def speakers(engine):
    try:
        return request(engine, '/speakers')
    except (urllib.error.URLError, ConnectionError, OSError) as e:
        sys.exit(f'AivisSpeech のエンジンにつながりません（{engine}）。AivisSpeech を起動してから、もう一度実行してください。\n詳細：{e}')


def style_name(sp_list, style_id):
    for sp in sp_list:
        for st in sp.get('styles', []):
            if st.get('id') == style_id:
                return sp.get('name', ''), st.get('name', '')
    return None, None


def texts(chunk):
    yield 'say', chunk['say']
    for i, v in enumerate(chunk.get('v', []), 1):
        yield f'v{i}', v['t']


def synth(engine, text, style_id, speed):
    query = request(engine, '/audio_query', params={'text': text, 'speaker': style_id})
    query['speedScale'] = speed
    query['outputStereo'] = False
    return request(engine, '/synthesis', params={'speaker': style_id}, body=query, raw=True)


def to_mp3(wav_bytes, dest):
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / 'in.wav'
        src.write_bytes(wav_bytes)
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error', '-i', str(src), '-ac', '1', '-ar', '24000',
             '-codec:a', 'libmp3lame', '-b:a', '48k', str(dest)],
            check=True,
        )


def main():
    ap = argparse.ArgumentParser(description='話す練習の音声を AivisSpeech で作る')
    ap.add_argument('--engine', default='http://127.0.0.1:10101')
    ap.add_argument('--list', action='store_true', help='声（話者・スタイル）の一覧と番号を表示する')
    ap.add_argument('--speaker', type=int, help='使う声のスタイル番号（--list で確認）')
    ap.add_argument('--speed', type=float, default=1.0)
    ap.add_argument('--only', default='', help='一部の ID だけ作る（例：ch-01,ch-05）')
    args = ap.parse_args()

    sp_list = speakers(args.engine)

    if args.list or args.speaker is None:
        print('使える声（番号を --speaker に指定します）')
        for sp in sp_list:
            for st in sp.get('styles', []):
                print(f"  {st.get('id'):>12}  {sp.get('name', '')} / {st.get('name', '')}")
        if args.speaker is None and not args.list:
            print('\n例：python tools/make_audio.py --speaker 番号')
        return

    name, style = style_name(sp_list, args.speaker)
    if name is None:
        sys.exit(f'番号 {args.speaker} の声が見つかりません。--list で確認してください。')

    chunks = json.loads(CHUNKS.read_text(encoding='utf-8'))['chunks']
    only = {x.strip() for x in args.only.split(',') if x.strip()}
    OUT.mkdir(parents=True, exist_ok=True)
    use_mp3 = shutil.which('ffmpeg') is not None
    ext = 'mp3' if use_mp3 else 'wav'
    if not use_mp3:
        print('※ ffmpeg が見つからないので WAV で保存します（MP3 より大きくなります）')

    old = {}
    if MANIFEST.exists():
        try:
            old = json.loads(MANIFEST.read_text(encoding='utf-8')).get('files', {})
        except ValueError:
            old = {}

    files = {}
    made = skipped = 0
    jobs = [(c, k, t) for c in chunks for k, t in texts(c)]
    for n, (c, key, text) in enumerate(jobs, 1):
        ref = f"{c['id']}:{key}"
        if only and c['id'] not in only:
            if ref in old:
                files[ref] = old[ref]          # 対象外は前の結果をそのまま残す
            continue
        tag = hashlib.sha1(f'{text}|{args.speaker}|{args.speed}'.encode('utf-8')).hexdigest()[:8]
        fname = f"{c['id']}-{key}.{tag}.{ext}"
        dest = OUT / fname
        files[ref] = fname
        if dest.exists():
            skipped += 1
            continue
        print(f'[{n}/{len(jobs)}] {text}')
        wav = synth(args.engine, text, args.speaker, args.speed)
        if use_mp3:
            to_mp3(wav, dest)
        else:
            dest.write_bytes(wav)
        made += 1

    keep = set(files.values()) | {MANIFEST.name}
    removed = 0
    for p in OUT.iterdir():
        if p.is_file() and p.name not in keep and p.suffix in ('.mp3', '.wav'):
            p.unlink()
            removed += 1

    manifest = {
        'engine': 'AivisSpeech',
        'speaker': {'id': args.speaker, 'name': name, 'style': style},
        'speed': args.speed,
        'credit': f'音声：AivisSpeech（{name}）',
        'files': files,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    total = sum((OUT / f).stat().st_size for f in set(files.values()) if (OUT / f).exists())
    print(f'\n完了：作成 {made}・そのまま {skipped}・削除 {removed}。'
          f'{len(files)}ファイル、合計 {total / 1024 / 1024:.1f}MB（{OUT}）')
    print('声のモデルのライセンスを確認し、必要なら README のクレジットを直してください。')


if __name__ == '__main__':
    main()
