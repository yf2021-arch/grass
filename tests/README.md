# Tests

Run from the repository root (Node 20+):

```bash
node tests/voice-compare.test.mjs     # text-overlap score (no browser)
node tests/whisper-client.test.mjs    # Whisper client: timeouts, crashes, cancel, queue (fake worker)
node tests/voice-drill-ui.test.mjs    # 声で答える end to end (Playwright + Chromium, fake mic, fake worker)
```

No model is downloaded and nothing is sent anywhere: the UI test replaces `js/whisper-worker.js`
with a small fake that answers, stalls or answers slowly.
