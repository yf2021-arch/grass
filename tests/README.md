# Tests

Run from the repository root (Node 20+):

```bash
node tests/katsuyo.test.mjs          # 活用ドリル: conjugation rules, distractors, words from cards (no browser)
node tests/voice-compare.test.mjs     # text-overlap score (no browser)
node tests/whisper-client.test.mjs    # Whisper client: timeouts, crashes, cancel, queue (fake worker)
node tests/voice-drill-ui.test.mjs    # 声で答える end to end (Playwright + Chromium, fake mic, fake worker)
node tests/voice-vad.test.mjs         # speech start/end detection: quiet voice, bangs, room getting louder, loud noise (Playwright, synthetic fake-mic audio)
node tests/voice-playback.test.mjs    # nothing is playing when the mic opens (Playwright, fake <audio>)
```

No model is downloaded and nothing is sent anywhere. `voice-vad` generates its test audio itself
(levels measured on Grass's phone with mic processing off: noise −49 dB, voice −30 dB).  the UI test replaces `js/whisper-worker.js`
with a small fake that answers, stalls or answers slowly.
