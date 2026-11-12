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
    await shot('rules');

    // stats are kept across a reload, and the Today row shows today's count
    await page.reload();
    await page.waitForSelector('[data-act="kt-start"]');
    assert.ok((await page.textContent('.kt-meta')).includes('今日 1'), 'today count kept');
    assert.equal(await page.locator('[data-act="kt-chip"][aria-pressed="true"]').count(), 5, 'chips kept');
    await page.goto(base + '/#/today');
    await page.waitForSelector('a[href="#/katsuyo"] .n');
    assert.match(await page.textContent('a[href="#/katsuyo"] .n'), /今日 1\d問/);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  console.log('ok — 活用ドリル UI');
} finally {
  await browser.close();
  server.close();
}
