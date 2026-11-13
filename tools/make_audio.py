#!/usr/bin/env python3
"""話す練習の音声を AivisSpeech で作る（PC で実行）

使い方
  1. AivisSpeech を起動しておく（エンジンが http://127.0.0.1:10101 で動きます）
  2. 声の一覧を見る：      python tools/make_audio.py --list
  3. 声を選んで音声を作る：python tools/make_audio.py --speaker 番号

  - data/chunks.json の「答え」と「言い換え3つ」を、1文ずつ音声にします（30個 × 4 = 120ファイル）
    チャンクの furi（親友=しんゆう、…）の語をエンジンが読み間違えた文だけ、その語をかなにして作ります
  - data/quiz/bjt.json の聴解の会話も、1問1ファイルにします（会話 → 少し間 → 質問）。
    選択肢も「1番。〜」と読んだファイルを別に作ります（本番の聴解は選択肢も音声だけなので）。
    男の声は --speaker2 で選べます（なければ同じ声で読みます）
  - 出力は data/audio/。ファイル名に「文＋声＋速さ」から作った短い記号が付くので、
    文を直したり声を変えたりすると、その文だけ作り直されます（同じものはスキップ）
  - 使わなくなった古いファイルは削除します
  - ffmpeg があれば小さな MP3（全部で数MB）、なければ WAV（少し大きい）にします
  - 必要なのは Python 3.8 以上だけです（追加のインストールは不要）

オプション
  --speed 0.9     話す速さ（1.0 が標準。聞き取り練習なら 0.9 前後もおすすめ）
  --engine URL    エンジンの場所（標準：http://127.0.0.1:10101）
  --only ch-05    一部だけ作る（試すとき。カンマ区切りで複数可。K001 など問題の ID も可）
  --speaker2 番号 聴解の会話で「男」の役に使う声（--speaker は「女」の役と質問の読み上げ）

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
import wave
from io import BytesIO
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHUNKS = ROOT / 'data' / 'chunks.json'
OUT = ROOT / 'data' / 'audio'
MANIFEST = OUT / 'manifest.json'
QUIZ = ROOT / 'data' / 'quiz' / 'bjt.json'
LINE_GAP = 0.3        # 会話の発言と発言のあいだに足す無音（秒）
QUESTION_GAP = 1.0    # 会話のあと、質問を読むまでの無音（秒）
OPTION_GAP = 0.8      # 選択肢と選択肢のあいだの無音（秒）


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
                return sp.get('name', ''), st.get('name', ''), sp
    return None, None, None


sys.path.insert(0, str(Path(__file__).resolve().parent))
from furi import Checker  # noqa: E402


def texts(chunk):
    yield 'say', chunk['say']
    for i, v in enumerate(chunk.get('v', []), 1):
        yield f'v{i}', v['t']


# 音声の頭に入れる無音（秒）。スマホやイヤホンは再生の最初が少し切れることがあるので、
# 切れても言葉が欠けないように余白を入れる（エンジンの標準は 0.1 秒）
LEAD_SILENCE = 0.4
LEAD_TAG = 'lead40'          # 余白を変えたら、ここも変えると全部作り直す


def synth(engine, text, style_id, speed):
    query = request(engine, '/audio_query', params={'text': text, 'speaker': style_id})
    query['speedScale'] = speed
    query['prePhonemeLength'] = max(float(query.get('prePhonemeLength') or 0), LEAD_SILENCE)
    query['outputStereo'] = False
    return request(engine, '/synthesis', params={'speaker': style_id}, body=query, raw=True)


def join_wavs(parts):
    """[(WAV, 前に入れる無音の秒数)] をつないで1つの WAV にする"""
    out = BytesIO()
    params = None
    frames = []
    for data, gap in parts:
        with wave.open(BytesIO(data), 'rb') as w:
            p = w.getparams()
            if params is None:
                params = p
            elif (p.nchannels, p.sampwidth, p.framerate) != (params.nchannels, params.sampwidth, params.framerate):
                sys.exit('声によって音声の形式が違うため、つなげません。同じ種類の声を選んでください。')
            silence = b'\x00' * int(gap * p.framerate) * p.nchannels * p.sampwidth
            frames.append(silence + w.readframes(w.getnframes()))
    with wave.open(out, 'wb') as w:
        w.setnchannels(params.nchannels)
        w.setsampwidth(params.sampwidth)
        w.setframerate(params.framerate)
        w.writeframes(b''.join(frames))
    return out.getvalue()


def quiz_items():
    """聴解（会話のある問題）だけ"""
    if not QUIZ.exists():
        return []
    items = json.loads(QUIZ.read_text(encoding='utf-8')).get('items', [])
    return [q for q in items if q.get('part') in ('聴解', '聴読解') and q.get('script')]


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
    ap.add_argument('--speaker2', type=int, help='聴解の会話で「男」の役に使う声（なければ --speaker と同じ）')
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

    name, style, sp = style_name(sp_list, args.speaker)
    if name is None:
        sys.exit(f'番号 {args.speaker} の声が見つかりません。--list で確認してください。')

    male = args.speaker2 if args.speaker2 is not None else args.speaker
    male_name = name
    if args.speaker2 is not None:
        male_name, male_style, _ = style_name(sp_list, args.speaker2)
        if male_name is None:
            sys.exit(f'番号 {args.speaker2} の声が見つかりません。--list で確認してください。')
    voice = {'男': male, '女': args.speaker}

    chunks = json.loads(CHUNKS.read_text(encoding='utf-8'))['chunks']
    quiz = quiz_items()
    if quiz and args.speaker2 is None:
        print('※ 聴解の会話は、男女とも同じ声で読みます（男の声を使うなら --speaker2 番号）')
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
    jobs = [(c['id'], k, t, None) for c in chunks for k, t in texts(c)]
    furi = {c['id']: c.get('furi') or '' for c in chunks}     # ふりがな：エンジンが読み間違えた語だけ、かなで読ませる
    checker = Checker(lambda t: request(args.engine, '/audio_query', params={'text': t, 'speaker': args.speaker}))
    for q in quiz:                     # 聴解：会話の各発言（話し手の声で）＋ 質問
        lines = [(voice.get(l.get('sp'), args.speaker), l['t'], LINE_GAP if i else 0) for i, l in enumerate(q['script'])]
        lines.append((args.speaker, q['question'], QUESTION_GAP))
        jobs.append((q['id'], 'q', ' / '.join(t for _, t, _ in lines), lines))
        if q.get('part') == '聴解' and len(q.get('options') or []) == 4:   # 本番の聴解は選択肢も音声 → 「1番。〜」を別ファイルに（聴読解は文字）
            opts = [(args.speaker, f'{i + 1}番。{o}', OPTION_GAP if i else 0) for i, o in enumerate(q['options'])]
            jobs.append((q['id'], 'o', ' / '.join(t for _, t, _ in opts), opts))
        if q.get('part') == '聴解' and isinstance(q.get('answer'), int):   # 散歩モードで流す「正解は2番。〜」
            a = q['answer']
            ans = [(args.speaker, f"正解は{a + 1}番。{q['options'][a]}", 0)]
            jobs.append((q['id'], 'a', ans[0][1], ans))
    for n, (cid, key, text, lines) in enumerate(jobs, 1):
        ref = f'{cid}:{key}'
        if only and cid not in only:
            if ref in old:
                files[ref] = old[ref]          # 対象外は前の結果をそのまま残す
            continue
        if lines is None and furi.get(cid):
            text = checker.spoken(text, furi[cid], args.speaker)
        sig = text if lines is None else '|'.join(f'{v}:{t}' for v, t, _ in lines) + {'q': f'|gap{LINE_GAP},{QUESTION_GAP}', 'o': f'|gap{OPTION_GAP}'}.get(key, '')
        tag = hashlib.sha1(f'{sig}|{args.speaker}|{args.speed}|{LEAD_TAG}'.encode('utf-8')).hexdigest()[:8]
        fname = f'{cid}-{key}.{tag}.{ext}'
        dest = OUT / fname
        files[ref] = fname
        if dest.exists():
            skipped += 1
            continue
        print(f'[{n}/{len(jobs)}] {text}')
        if lines is None:
            wav = synth(args.engine, text, args.speaker, args.speed)
        else:
            wav = join_wavs([(synth(args.engine, t, v, args.speed), gap) for v, t, gap in lines])
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
        'speaker': {'id': args.speaker, 'name': name, 'style': style,
                    'uuid': sp.get('speaker_uuid', ''), 'version': sp.get('version', '')},   # 使ったモデルを後から特定できるように
        'speed': args.speed,
        'speaker2': ({'id': args.speaker2, 'name': male_name} if args.speaker2 is not None else None),
        'credit': f'音声：AivisSpeech（{name}{"・" + male_name if args.speaker2 is not None and male_name != name else ""}）',
        'files': files,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    total = sum((OUT / f).stat().st_size for f in set(files.values()) if (OUT / f).exists())
    print(f'\n完了：作成 {made}・そのまま {skipped}・削除 {removed}。'
          f'{len(files)}ファイル、合計 {total / 1024 / 1024:.1f}MB（{OUT}）')
    if checker.report():
        print(checker.report())
    print('声のモデルのライセンスを確認し、必要なら README のクレジットを直してください。')


if __name__ == '__main__':
    main()
