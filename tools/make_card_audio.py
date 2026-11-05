#!/usr/bin/env python3
"""知識カードの音声を AivisSpeech で作り、スマホに読み込む「音声パック」を1つ作る（PC で実行）

カードの例文には職場の内容が入ることがあるので、音声もパックも公開リポジトリには入れません。
できた .pack ファイルをスマホに移し、アプリの「設定 > カードの音声 > 音声パックを読み込む」で読み込みます。
PC に残る .pack が、そのままバックアップになります。

使い方
  1. AivisSpeech を起動する
  2. 初めてのとき：python tools/make_card_audio.py --speaker 番号
     （声の番号・速さ・API の URL は grass-card-audio/config.json に覚えます。TOKEN を覚えるかは聞きます）
  3. 2回目から（シートにカードや話すの文が増えたとき）：
       python tools/make_card_audio.py
     または tools/音声を更新.bat（Windows）／ tools/音声を更新.command（Mac）をダブルクリック
     → 新しい文・直した文だけ音声を作り、パックを作り直します。前回からの変化も表示します
  試すときは --limit 10（先頭から10枚だけ）

カードの読み込み元（どちらか）
  - シートの API（標準）：URL と TOKEN を聞かれるので、10_API設定 から貼る。
    毎回聞かれたくないときは、環境変数 GRASS_API_URL と GRASS_TOKEN に入れておく（ファイルには保存しません）
  - CSV：01_知識カード を「ファイル > ダウンロード > CSV」で保存して --csv ファイル名

音声にする部分（1枚あたり 3〜8 個）
  w   … 表現（「読み」のかなから作る。漢字の読み間違いを避けるため）
  ex  … 自分の例文
  okN … 合わない使い方の「→」のあとの正しい言い方だけ（✕ の間違いは音声にしない）
  cN  … よく合う組み合わせ（｜ で区切った1つずつ）
  言語が en のカードは作りません（AivisSpeech は日本語専用）

話すの自分の文（02_話すチャンク・ID は SP-xxxx。シートの API から読むときだけ）
  say … 答えの文
  vN  … 言い換え（1〜3）
  アプリの「話す」で 🔊 を押すと、このパックの音声が鳴ります（公開の data/audio/ には入れません）

オプション
  --speed 0.9      話す速さ
  --limit 10       先頭から N 枚だけ（試すとき）
  --ids A,B        指定した ID だけ
  --out フォルダ   出力先（標準：./grass-card-audio。リポジトリの外がおすすめ）
"""

import argparse
import csv
import getpass
import hashlib
import json
import os
import re
import shutil
import struct
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_audio import speakers, style_name, synth, to_mp3  # noqa: E402

PACK_MAGIC = b'GRASSPK1'
SEP = '｜'


def load_config(out):
    try:
        return json.loads((out / 'config.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def save_config(out, conf):
    (out / 'config.json').write_text(json.dumps(conf, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def load_cards_api(conf):
    url = os.environ.get('GRASS_API_URL') or conf.get('api_url') or input('API URL（10_API設定 の URL）: ').strip()
    token = os.environ.get('GRASS_TOKEN') or conf.get('token') or getpass.getpass('TOKEN（入力は表示されません）: ').strip()
    body = json.dumps({'action': 'pull', 'token': token}).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'text/plain;charset=utf-8'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            data = json.loads(res.read().decode('utf-8'))
    except (OSError, ValueError) as e:
        sys.exit(f'シートの API につながりません。URL とネットを確認してください。\n詳細：{e}')
    if not data.get('ok'):
        sys.exit(f"シートから読めませんでした：{data.get('error', '不明なエラー')}（TOKEN が違うときは config.json の token を消してください）")
    return data['cards'], data.get('chunks') or [], url, token


def load_cards_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def val(card, key):
    return str(card.get(key) or '').strip()


def strip_note(s):
    """末尾の（説明）や (note) を取る"""
    return re.sub(r'\s*[（(][^（）()]*[）)]\s*$', '', s).strip()


def word_text(card):
    yomi = re.split(r'[／/、,・\s]', val(card, '読み'))[0].strip()
    if yomi:
        return yomi
    return re.split(r'[／/]', re.sub(r'^[～〜~]', '', val(card, '表現')))[0].strip()


def parts(card):
    """カードから (キー, 文) を順に返す。キーはアプリの表示順と合わせる"""
    w = word_text(card)
    if w:
        yield 'w', w
    ex = val(card, '自分の例文')
    if ex:
        yield 'ex', ex
    for i, item in enumerate([x.strip() for x in val(card, '合わない使い方').split(SEP) if x.strip()], 1):
        if '→' not in item:
            continue                      # 正しい言い方がない行は作らない（✕ だけの行）
        right = strip_note(item.split('→', 1)[1].strip())
        if right:
            yield f'ok{i}', right
    for i, item in enumerate([x.strip() for x in val(card, 'よく合う組み合わせ').split(SEP) if x.strip()], 1):
        t = re.sub(r'^[～〜~]', '', item).strip()
        if t:
            yield f'c{i}', t


def chunk_parts(chunk):
    """話すチャンクから (キー, 文) を返す。キーはアプリの 🔊（say・v1〜v3）と合わせる"""
    say = str(chunk.get('say') or '').strip()
    if say:
        yield 'say', say
    for i, v in enumerate(chunk.get('v') or [], 1):
        t = str((v or {}).get('t') or '').strip()
        if t:
            yield f'v{i}', t


def main():
    ap = argparse.ArgumentParser(description='知識カードの音声パックを作る')
    ap.add_argument('--engine', default='http://127.0.0.1:10101')
    ap.add_argument('--speaker', type=int, help='声のスタイル番号（python tools/make_audio.py --list で確認）')
    ap.add_argument('--speed', type=float, help='話す速さ（標準 1.0。一度指定すると覚えます）')
    ap.add_argument('--csv', help='01_知識カード の CSV（なければシートの API から読む）')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--ids', default='')
    ap.add_argument('--out', default='grass-card-audio')
    args = ap.parse_args()

    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    conf = load_config(out)
    if args.speaker is None:
        args.speaker = conf.get('speaker')
    if args.speed is None:
        args.speed = conf.get('speed', 1.0)

    sp_list = speakers(args.engine)
    if args.speaker is None:
        sys.exit('初めてのときは --speaker 番号 を指定してください（python tools/make_audio.py --list で一覧）')
    name, style, sp = style_name(sp_list, args.speaker)
    if name is None:
        sys.exit(f'番号 {args.speaker} の声が見つかりません')

    if args.csv:
        cards, chunks = load_cards_csv(args.csv), []
    else:
        cards, chunks, url, token = load_cards_api(conf)
        if conf.get('api_url') != url:
            conf['api_url'] = url
        if 'token' not in conf and not os.environ.get('GRASS_TOKEN'):
            ans = input('TOKEN をこの PC の config.json に覚えますか？ 次からは聞きません [y/N]: ').strip().lower()
            conf['token'] = token if ans in ('y', 'yes') else None
    conf['speaker'], conf['speed'] = args.speaker, args.speed
    save_config(out, conf)
    chunks = [c for c in chunks if str(c.get('id') or '').strip()]
    cards = [c for c in cards if val(c, 'ID') and val(c, '言語').lower() not in ('en', '英語')]
    ids = {x.strip() for x in args.ids.split(',') if x.strip()}
    if ids:
        cards = [c for c in cards if val(c, 'ID') in ids]
        chunks = [c for c in chunks if c['id'] in ids]
    if args.limit:
        cards = cards[:args.limit]

    clips = out / 'clips'
    clips.mkdir(parents=True, exist_ok=True)
    use_mp3 = shutil.which('ffmpeg') is not None
    ext = 'mp3' if use_mp3 else 'wav'

    files, made, skipped = {}, 0, 0
    jobs = [(val(c, 'ID'), k, t) for c in cards for k, t in parts(c)]
    jobs += [(c['id'], k, t) for c in chunks for k, t in chunk_parts(c)]
    for n, (cid, key, text) in enumerate(jobs, 1):
        tag = hashlib.sha1(f'{text}|{args.speaker}|{args.speed}'.encode('utf-8')).hexdigest()[:8]
        safe = re.sub(r'[^A-Za-z0-9_-]', '_', cid)
        fname = f'{safe}-{key}.{tag}.{ext}'
        files[f'{cid}:{key}'] = {'name': fname, 'text': text}
        dest = clips / fname
        if dest.exists():
            skipped += 1
            continue
        print(f'[{n}/{len(jobs)}] {cid} {key}: {text}')
        wav = synth(args.engine, text, args.speaker, args.speed)
        if use_mp3:
            to_mp3(wav, dest)
        else:
            dest.write_bytes(wav)
        made += 1

    # 使わなくなった音声を片付ける（今回のパックに入らないもの）
    keep = {info['name'] for info in files.values()}
    removed_clips = 0
    if not args.limit and not ids:          # 一部だけ作るときは消さない
        for p in clips.iterdir():
            if p.is_file() and p.name not in keep:
                p.unlink()
                removed_clips += 1

    # 前回のパックからの変化
    prev = {}
    try:
        prev = json.loads((out / 'last.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        pass
    now = {ref: info['name'] for ref, info in files.items()}
    added = [r for r in now if r not in prev]
    changed = [r for r in now if r in prev and prev[r] != now[r]]
    gone = [r for r in prev if r not in now]
    (out / 'last.json').write_text(json.dumps(now, ensure_ascii=False, indent=0), encoding='utf-8')

    # パックを作る：マジック 8バイト ＋ ヘッダ長（4バイト）＋ ヘッダ JSON ＋ 音声データを順に連結
    offset, blobs = 0, []
    for ref, info in files.items():
        data = (clips / info['name']).read_bytes()
        info['off'], info['len'] = offset, len(data)
        offset += len(data)
        blobs.append(data)
    header = {
        'version': 1,
        'made': time.strftime('%Y-%m-%d %H:%M'),
        'engine': 'AivisSpeech',
        'speaker': {'id': args.speaker, 'name': name, 'style': style,
                    'uuid': sp.get('speaker_uuid', ''), 'version': sp.get('version', '')},
        'speed': args.speed,
        'credit': f'音声：AivisSpeech（{name}）',
        'type': 'audio/mpeg' if use_mp3 else 'audio/wav',
        'cards': len(cards),
        'chunks': len(chunks),
        'files': files,
    }
    hb = json.dumps(header, ensure_ascii=False).encode('utf-8')
    pack = out / 'grass-card-audio.pack'
    with open(pack, 'wb') as f:
        f.write(PACK_MAGIC + struct.pack('<I', len(hb)) + hb)
        for b in blobs:
            f.write(b)
    print(f'\n完了：カード {len(cards)}枚・話すの自分の文 {len(chunks)}個・音声 {len(files)}個（作成 {made}・そのまま {skipped}・古い音声の削除 {removed_clips}）')
    if prev:
        new_ids = sorted({r.rsplit(':', 1)[0] for r in added})
        print(f'前回からの変化：追加 {len(added)}・変更 {len(changed)}・削除 {len(gone)}' + (f'（新しい ID：{", ".join(new_ids[:15])}{" ほか" if len(new_ids) > 15 else ""}）' if new_ids else ''))
        if not (added or changed or gone):
            print('変化はありません。スマホに読み込み直す必要はありません。')
    print(f'音声パック：{pack}（{pack.stat().st_size / 1024 / 1024:.1f}MB）')
    print('このファイルをスマホに移し、アプリの「設定 > カードの音声 > 音声パックを読み込む」で読み込んでください。')
    print('※ 公開リポジトリには入れないでください（例文に職場の内容が入ることがあります）')


if __name__ == '__main__':
    main()
