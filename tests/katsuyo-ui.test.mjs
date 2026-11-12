// node tests/katsuyo-ui.test.mjs — needs Playwright + Chromium.
// 活用ドリル end to end: the Today link, a full 10-question round (right answers auto-advance,
// wrong ones wait for 次へ and show the rule row; 止めて読む keeps a right answer open), the result
// screen, retry of the misses, the 選ぶ前に答えを言う step,
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
    // 選ぶ前に答えを言う: options stay hidden until 選択肢を見る
    if (await page.locator('[data-act="kt-home"]').count()) await page.click('[data-act="kt-home"]');
    await page.click('[data-act="kt-say"]');
    await page.click('[data-act="kt-start"]');
    await page.waitForSelector('[data-act="kt-show"]');
    assert.equal(await page.locator('[data-act="kt-pick"]').count(), 0);
    await shot('say');
    await page.click('[data-act="kt-show"]');
    assert.ok(await page.locator('[data-act="kt-pick"]').count() >= 2);
    await page.click('[data-act="kt-quit"]');
    await page.click('[data-act="kt-say"]');
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
