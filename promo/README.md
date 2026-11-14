# 宣伝動画「ことぐさ」

縦 1080×1920・30fps・約98秒。SNS（縦動画）とスマホで見る前提です。

- `script.json` … 台本。場面の順と長さ（`scenes`）と、言語ごとの文字（`langs.ja / zh / en`）
- `promo.html` … 画面。台本から、時刻ごとに1コマを描く（同じ時刻なら毎回同じ絵）
- `render.mjs` … 1コマずつ撮って場面ごとに MP4 にし、つないで、音楽を付ける
- `shots/ja/` … アプリの本物の画面（デモデータ・390×844 を3倍で撮影）

## 作る

```
node promo/render.mjs                 # 日本語 → promo/out/kotogusa-ja.mp4
node promo/render.mjs --lang zh       # 中国語（文字だけ切り替わる。アプリの画面は日本語のまま）
node promo/render.mjs --lang en       # 英語
node promo/render.mjs --stills        # 各場面の静止画だけ（確認用・数秒）
node promo/render.mjs --only walk,end # その場面だけ作り直して、つなぎ直す
```

必要なもの：Node 18 以上・Playwright（`npx playwright install chromium`）・ffmpeg・日本語／中国語のフォント（Noto Sans CJK）

## ナレーション（任意・AivisSpeech）

PC で AivisSpeech を起動して：

```
node promo/render.mjs --aivis http://127.0.0.1:10101 --speaker 1431611904   # 「まい」
```

各場面の `say` を読み上げて重ね、言い終わるまで場面を延ばします（音楽は小さくなります）。出力は `kotogusa-ja-voice.mp4`。

## 言語を足す・変える

- `script.json` の `langs` に、`ja` と同じ形で書き足す（`font` はその言語のフォント）
- 英語を学ぶ人向けに作るときは、アプリの画面も英語のカードで撮り直し、`shots/en/` に置いて `"shots": "en"` にする
- 場面を足すときは `scenes` に1行足し、`langs` の各言語に同じ `id` の文字を足す。画面の種類（`kind`）は
  hook・title・wall・reveal・feature（スマホ画面つき）・compare・badges・end

## 音

音楽は `render.mjs` の中で作る静かな和音とはじく音です（外部の音源なし）。壁の場面は暗く、「ことぐさ」から明るくなります。

## 画面について

`shots/ja/look-voice.jpg`（録音の聞き比べ）は、ブラウザの自動操作では録音できないため、アプリと同じ部品に例の聞き取り結果を入れて撮っています。ほかはデモデータでの実際の画面です。
