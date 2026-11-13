// node tests/katsuyo-ui.test.mjs — needs Playwright + Chromium.
// 活用ドリル end to end: the Today link, a full 10-question round (right answers auto-advance,
// wrong ones wait for 次へ and show the rule row; 止めて読む keeps a right answer open), the result
// screen, retry of the misses, the 選ぶ前に答えを言う step with its 言えた／言えなかった check,
// switching off auto-advance and the speed bonus,
// the rule map tab, and that stats survive a reload. SHOTS=dir saves screenshots.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.GRASS_PLAYWRIGHT || 'playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const shots = process.env.SHOTS;
const browser = await chromium.launch();
try {
  for (const scheme of shots ? ['light', 'dark'] : ['light']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: scheme, deviceScaleFactor: shots ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    // a fake Japanese voice: record what the app reads aloud
    await page.addInitScript(() => {
      window.__said = [];
      const voice = { lang: 'ja-JP', name: 'test' };
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [voice], cancel() {}, speak(u) { window.__said.push(u.text); }, addEventListener() {} } });
    });
    const lastSaid = () => page.evaluate(() => window.__said[window.__said.length - 1]);
    const shot = async name => { if (shots) await page.screenshot({ path: path.join(shots, `${scheme}-${name}.png`), fullPage: true }); };

    await page.goto(base + '/#/today');
    await page.waitForSelector('a[href="#/katsuyo"]');
    await page.click('a[href="#/katsuyo"]');
    await page.waitForSelector('[data-act="kt-start"]');
    await shot('home');
    // add 受け身 and 形容詞, then play
    await page.click('[data-act="kt-chip"][data-v="受け身"]');
    await page.click('[data-act="kt-chip"][data-v="形容詞"]');
    assert.equal(await page.locator('[data-act="kt-chip"][aria-pressed="true"]').count(), 5);
    await page.click('[data-act="kt-start"]');

    let wrong = 0, held = false, shotQ = false, shotNg = false, shotOk = false;
    for (let q = 1; q <= 10; q++) {
      await page.waitForFunction(n => document.querySelector('.kt-top span')?.textContent.startsWith(`${n} /`) && document.querySelector('[data-act="kt-pick"]:not([disabled])'), q);
      if (!shotQ) { await shot('question'); shotQ = true; }
      const n = await page.locator('[data-act="kt-pick"]').count();
      assert.ok(n >= 2 && n <= 4);
      const opts = await page.locator('[data-act="kt-pick"]').allTextContents();
      assert.equal(new Set(opts).size, opts.length, 'options are distinct');
      // pick the 1st option on odd questions, otherwise the last one — a mix of right and wrong
      await page.locator('[data-act="kt-pick"]').nth(q % 2 ? 0 : n - 1).click();
      await page.waitForSelector('.kt-fb');
      assert.equal(await page.locator('.kt-opt.right').count(), 1);
      if (await page.locator('.kt-fb.ok').count()) {           // a right answer is read aloud
        const right = await page.textContent('.kt-opt.right');
        const label = await page.textContent('.kt-form span');
        assert.equal(await lastSaid(), label === 'グループ' || label === 'い？な？' ? await page.textContent('.kt-word .w') : right);
      }
      if (await page.locator('.kt-fb.ng').count()) {
        wrong++;
        assert.ok(await page.locator('.kt-rule').count(), 'rule path shown');
        if (!shotNg) { await shot('wrong'); shotNg = true; }
        await page.click('[data-act="kt-next"]');
      } else {
        if (!shotOk) { await shot('right'); shotOk = true; }
        if (!held) {           // 止めて読む: the right answer stays on screen until 次へ
          held = true;
          await page.click('[data-act="kt-hold"]');
          await page.waitForTimeout(3000);
          assert.ok((await page.textContent('.kt-top span')).startsWith(`${q} /`), 'held answer did not advance');
          await page.click('[data-act="kt-next"]');
        }
      }
    }
    await page.waitForSelector('.kt-end');
    await shot('end');
    const end = await page.textContent('.kt-meta');
    assert.match(end, new RegExp(`正解 ${10 - wrong}/10`));
    if (wrong) {
      assert.equal(await page.locator('.kt-misses li').count(), wrong);
      await page.click('[data-act="kt-retry"]');
      await page.waitForFunction(w => document.querySelector('.kt-top span')?.textContent === `1 / ${w}`, wrong);
      await page.click('[data-act="kt-quit"]');
    }
    // the right option for the question on screen (base words only in this test)
    const rightIndex = () => page.evaluate(async () => {
      const m = await import('/js/katsuyo.js');
      const w = document.querySelector('.kt-word .w').textContent;
      const label = document.querySelector('.kt-form span').textContent;
      const form = Object.keys(m.FORMS).find(f => m.FORMS[f].label === label);
      const right = m.conj(m.BASE_WORDS.find(b => b.w === w), form);
      return [...document.querySelectorAll('[data-act="kt-pick"]')].findIndex(b => b.textContent === right);
    });
    if (await page.locator('[data-act="kt-home"]').count()) await page.click('[data-act="kt-home"]');

    // 選ぶ前に答えを言う: options stay hidden until 選択肢を見る; a right pick asks 言えた／言えなかった,
    // and 言えなかった takes the points back and sends the item to the misses
    await page.click('[data-act="kt-set"][data-v="say"]');
    await page.click('[data-act="kt-start"]');
    await page.waitForSelector('[data-act="kt-show"]');
    assert.equal(await page.locator('[data-act="kt-pick"]').count(), 0);
    await shot('say');
    await page.click('[data-act="kt-show"]');
    await page.locator('[data-act="kt-pick"]').nth(await rightIndex()).click();
    await page.waitForSelector('[data-act="kt-said"]');
    assert.equal(await page.locator('[data-act="kt-hold"]').count(), 0, 'no auto-advance while asking');
    await shot('selfcheck');
    await page.click('[data-act="kt-said"][data-v="0"]');
    await page.waitForSelector('[data-act="kt-next"]');
    assert.match(await page.textContent('.kt-verdict'), /言えなかった/);
    assert.match(await page.textContent('.kt-top'), /^1 \/ 10\s*0点/);
    await page.click('[data-act="kt-next"]');
    await page.click('[data-act="kt-show"]');
    await page.locator('[data-act="kt-pick"]').nth(await rightIndex()).click();
    await page.click('[data-act="kt-said"][data-v="1"]');          // 言えた → straight to the next question
    await page.waitForFunction(() => document.querySelector('.kt-top span')?.textContent.startsWith('3 /'));
    await page.click('[data-act="kt-quit"]');
    await page.click('[data-act="kt-set"][data-v="say"]');

    // 正解なら自動で次へ off + 速さで＋点 off: no timer bar, a right answer stays until 次へ, 10 points flat
    await page.click('[data-act="kt-set"][data-v="auto"]');
    await page.click('[data-act="kt-set"][data-v="timed"]');
    await page.click('[data-act="kt-start"]');
    await page.waitForSelector('[data-act="kt-pick"]');
    assert.equal(await page.locator('.kt-timer').count(), 0);
    await page.locator('[data-act="kt-pick"]').nth(await rightIndex()).click();
    await page.waitForSelector('.kt-fb.ok');
    assert.equal(await page.locator('[data-act="kt-hold"]').count(), 0);
    await page.waitForTimeout(3000);
    assert.ok((await page.textContent('.kt-top span')).startsWith('1 /'), 'stays without auto-advance');
    assert.match(await page.textContent('.kt-verdict'), /正解 ＋10$/);
    await page.click('[data-act="kt-quit"]');
    await page.click('[data-act="kt-set"][data-v="auto"]');
    await page.click('[data-act="kt-set"][data-v="timed"]');
    await page.click('[data-act="kt-tab"][data-v="rules"]');
    await page.waitForSelector('.kt-chant');
    assert.ok(await page.locator('.kt-mrow').count() >= 7);
    assert.equal(await page.locator('.kt-tree:not(.focus) .kt-tstep').count(), 4, 'group decision picture');
    assert.equal(await page.locator('.kt-dan .k').count(), 5, 'dan strip');
    assert.equal(await page.locator('.kt-nd .f').count(), 3, 'んです formula');
    await shot('rules');
    await page.locator('.kt-tree').scrollIntoViewIfNeeded();
    await shot('tree');

    // stats are kept across a reload, and the Today row shows today's count
    await page.reload();
    await page.waitForSelector('[data-act="kt-start"]');
    assert.ok((await page.textContent('.kt-meta')).includes('今日 1'), 'today count kept');
    assert.equal(await page.locator('[data-act="kt-chip"][aria-pressed="true"]').count(), 5, 'chips kept');
    await page.goto(base + '/#/today');
    await page.waitForSelector('a[href="#/katsuyo"] .n');
    assert.match(await page.textContent('a[href="#/katsuyo"] .n'), /今日 1\d問/);

    // グループ only: a wrong answer shows the decision picture with this word's path lit
    await page.goto(base + '/#/katsuyo');
    await page.waitForSelector('[data-act="kt-start"]');
    for (const c of ['て形', 'た形', 'ない形', '受け身', '形容詞']) await page.click(`[data-act="kt-chip"][data-v="${c}"]`);
    await page.click('[data-act="kt-chip"][data-v="グループ"]');
    await page.click('[data-act="kt-start"]');
    await page.waitForSelector('[data-act="kt-pick"]');
    const gi = await rightIndex();
    await page.locator('[data-act="kt-pick"]').nth(gi === 0 ? 1 : 0).click();
    await page.waitForSelector('.kt-fb.ng .kt-tree.focus');
    assert.equal(await page.locator('.kt-fb .kt-tleaf.on').count(), 1, 'one lit leaf');
    await shot('tree-focus');
    await page.click('[data-act="kt-quit"]');

    // 可能形 and んです: right answers, read aloud
    await page.click('[data-act="kt-chip"][data-v="グループ"]');
    await page.click('[data-act="kt-chip"][data-v="可能形"]');
    await page.click('[data-act="kt-chip"][data-v="んです"]');
    await page.click('[data-act="kt-start"]');
    for (let q = 1; q <= 3; q++) {
      await page.waitForFunction(n => document.querySelector('.kt-top span')?.textContent.startsWith(`${n} /`) && document.querySelector('[data-act="kt-pick"]:not([disabled])'), q);
      const label = await page.textContent('.kt-form span');
      assert.ok(['可能形', '〜んです', '〜んです（過去）', '〜んです（形容詞）', '〜んです（形容詞・過去）'].includes(label), label);
      await page.locator('[data-act="kt-pick"]').nth(await rightIndex()).click();
      await page.waitForSelector('.kt-fb.ok');
      assert.equal(await lastSaid(), await page.textContent('.kt-opt.right'));
      if (q === 1) await shot('new-form');
      await page.click('[data-act="kt-next"]');
    }
    await page.click('[data-act="kt-quit"]');

    // AivisSpeech clips (data/katsuyo-audio): a right answer plays the clip of that word, not the phone voice,
    // and 音声をまとめて入れる stores every clip
    const words = JSON.parse(fs.readFileSync(path.join(root, 'data/katsuyo-words.json'), 'utf8')).words;
    const manifest = { credit: '音声：AivisSpeech（テスト）', words: {}, files: {} };
    words.forEach((w, i) => { manifest.words[w.w] = {}; w.texts.forEach((t, j) => { const f = `k-${i}-${j}.wav`; manifest.words[w.w][t.t] = f; manifest.files[t.t] ??= f; }); });
    const wav = Buffer.concat([Buffer.from('RIFF$\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\xc0\x5d\0\0\x80\xbb\0\0\x02\0\x10\0data\0\0\0\0', 'latin1')]);
    const fetched = [];
    await page.route('**/data/katsuyo-audio/**', route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
      if (name === 'manifest.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) });
      fetched.push(name);
      return route.fulfill({ contentType: 'audio/wav', body: wav });
    });
    await page.evaluate(() => { window.__played = 0; HTMLMediaElement.prototype.play = function () { window.__played++; return Promise.resolve(); }; });
    await page.reload();
    await page.evaluate(() => { window.__played = 0; HTMLMediaElement.prototype.play = function () { window.__played++; return Promise.resolve(); }; });
    await page.waitForSelector('[data-act="kt-dl"]');
    const saidBefore = await page.evaluate(() => window.__said.length);
    await page.click('[data-act="kt-start"]');
    await page.waitForSelector('[data-act="kt-pick"]');
    const w0 = await page.textContent('.kt-word .w');
    await page.locator('[data-act="kt-pick"]').nth(await rightIndex()).click();
    await page.waitForSelector('.kt-fb.ok');
    const right0 = await page.textContent('.kt-opt.right');
    await page.waitForFunction(() => window.__played > 0);
    assert.equal(fetched[fetched.length - 1], manifest.words[w0][right0], 'clip of this word');
    assert.equal(await page.evaluate(() => window.__said.length), saidBefore, 'phone voice not used');
    await page.click('[data-act="kt-quit"]');
    await page.click('[data-act="kt-dl"]');
    await page.waitForFunction(() => /すべてスマホに入っています/.test(document.querySelector('.kt-hero')?.textContent || ''), null, { timeout: 60000 });
    const total = new Set(Object.values(manifest.words).flatMap(m => Object.values(m))).size;
    assert.match(await page.textContent('.kt-hero'), new RegExp(`音声：${total}個`));
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  console.log('ok — 活用ドリル UI');
} finally {
  await browser.close();
  server.close();
}
