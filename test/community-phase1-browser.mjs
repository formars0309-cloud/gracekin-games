/* 정적 파일과 모의 응답으로 두 게임의 화면·접근성·자원 분리를 확인한다.
 * 실행: PLAYWRIGHT_MODULE=모듈경로 AXE_SOURCE=axe.min.js경로 PNG_MODULE=pngjs경로 node test/community-phase1-browser.mjs
 * 운영 서버·실제 계정에 접근하지 않는다. 웹폰트 요청은 그대로 통과시킨다.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { GRAIN_REWARD_POLICY } from '../server/grain-policy.js';
const require = createRequire(import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const axe = await readFile(process.env.AXE_SOURCE || require.resolve('axe-core/axe.min.js'), 'utf8');
const { PNG } = require(process.env.PNG_MODULE || 'pngjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = process.env.COMMUNITY_CAPTURE_DIR || '/tmp/community-phase1-20261020';
await mkdir(artifacts, { recursive: true });
const errors = [], wrongImages = [], fontRequests = new Set(), checks = [], contrast = [];
// 그림·그라데이션·깎은 버튼은 자동 판정이 보류될 수 있어 실제 렌더 배경을 따로 잰다.
async function measureContrast(page, audit) {
  const targets = audit.incomplete.flatMap(item => item.nodes.map(node => node.target));
  if (!targets.length) return [];
  await page.evaluate(() => scrollTo(0, 0));
  const texts = await page.evaluate(targets => targets.flatMap(target => {
    const element = document.querySelector(target[0]);
    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const rect of range.getClientRects()) nodes.push({ target, color: getComputedStyle(text.parentElement).color, box: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height } });
    }
    return nodes;
  }), targets);
  const style = await page.addStyleTag({ content: '*{-webkit-text-fill-color:transparent!important;text-shadow:none!important}' });
  let background;
  try { background = PNG.sync.read(await page.screenshot({ fullPage: true })); }
  finally { await style.evaluate(node => node.remove()); }
  const luminance = rgb => rgb.map(value => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  return texts.map(({ target, color, box }) => {
    const foreground = luminance(color.match(/[\d.]+/g).slice(0, 3).map(Number));
    let minimum = Infinity;
    for (let y = Math.max(0, Math.ceil(box.y)); y < Math.min(background.height, box.y + box.height); y += 2) {
      for (let x = Math.max(0, Math.ceil(box.x)); x < Math.min(background.width, box.x + box.width); x += 2) {
        const pixel = (y * background.width + x) * 4;
        const light = luminance([...background.data.subarray(pixel, pixel + 3)]);
        minimum = Math.min(minimum, (Math.max(foreground, light) + 0.05) / (Math.min(foreground, light) + 0.05));
      }
    }
    assert.ok(minimum >= 4.5, `${target}: 실제 배경 대비 ${minimum.toFixed(2)}:1`);
    return { target, minimum };
  });
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname}${pathname.endsWith('/') ? 'index.html' : ''}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('허용 범위 밖 주소');
    const contents = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    response.end(contents);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext();
  for (const game of ['gyeongguk', 'slimeline']) {
    for (const width of [1440, 390, 320]) {
      for (const signedIn of [false, true]) {
        for (const kind of ['notice', 'free', 'empty']) {
          const board = kind === 'empty' ? game === 'gyeongguk' ? 'deck' : 'guide' : kind;
          const label = `${game}-${width}-${signedIn ? 'member' : 'guest'}-${kind}`;
          const page = await context.newPage();
          await page.setViewportSize({ width, height: 900 });
          page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
          page.on('console', message => { if (message.type() === 'error') errors.push(`${label}: ${message.text()}`); });
          page.on('request', request => {
            const url = request.url();
            if (/fonts\.(googleapis|gstatic)\.com/.test(url)) fontRequests.add(url);
            const opposite = game === 'gyeongguk' ? /\/assets\/(slimeline\/|slime-front\.png)/ : /\/assets\/gyeongguk\//;
            if (opposite.test(url)) wrongImages.push(url);
          });
          const user = signedIn ? { id: '화면검수', name: '화면검수', canWriteCommunity: true } : null;
          await page.route('**/api/**', async route => {
            const url = new URL(route.request().url());
            let data;
            switch (url.pathname) {
              case '/api/community/session': data = { user }; break;
              case '/api/account/summary': data = { user: user ? { name: user.name, grainBalance: 1200 } : null }; break;
              case '/api/account/config': data = { grainRewardPolicy: GRAIN_REWARD_POLICY }; break;
              case '/api/account/grain': data = { rewardEligibility: 'eligible' }; break;
              case '/api/grain/attendance': data = { awarded: false }; break;
              case '/api/community/known-issues': data = { issues: [] }; break;
              case '/api/community/posts': {
                const post = { id: '모의글', game, board, title: '한 판을 마치고 나누는 이야기', body: '함께 게임을 즐기며 발견한 작은 즐거움과 다음 판에 해 보고 싶은 이야기를 나눕니다.', author: { id: '다른회원', name: '길동무' }, createdAt: '2026-10-19T03:00:00Z', commentCount: 1 };
                data = { posts: kind === 'free' ? [post] : [], total: kind === 'free' ? 1 : 0, page: 1, pageSize: 20 }; break;
              }
              default: throw new Error(`모의 응답 누락: ${url.pathname}`);
            }
            await route.fulfill({ json: data });
          });
          await page.route('https://cloud.umami.is/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
          await page.goto(`${origin}/community/?game=${game}&board=${board}`);
          await page.waitForFunction(() => !document.querySelector('#list-status').hidden ? false : document.querySelector('#session-label').textContent.includes('로그인하면'));
          await page.evaluate(() => document.fonts.ready);
          await page.locator('#quick-links').scrollIntoViewIfNeeded();
          await page.locator('.news-card').first().scrollIntoViewIfNeeded();
          await page.locator('.news-card img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
          await page.evaluate(() => scrollTo(0, 0));
          const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
          assert.ok(dimensions.document <= dimensions.viewport, `${label}: 가로 넘침 ${JSON.stringify(dimensions)}`);
          assert.equal(await page.locator('.news-card').count(), 3, `${label}: 카드 중복`);
          assert.equal(await page.locator('#latest-news').isVisible(), kind !== 'notice');
          assert.equal(await page.locator('#first-visit a').count(), 3);
          assert.equal(await page.locator('#quick-links a').count(), 4);
          assert.equal(await page.locator('.grain-details').getAttribute('open'), null);
          assert.equal(await page.locator('#game-switcher [aria-current=page]').textContent(), game === 'gyeongguk' ? '경국지계' : '슬라임 라인');
          assert.equal(await page.locator('#member-bar').isVisible(), !signedIn);
          if (kind === 'empty') assert.equal(await page.locator('#empty-state').isVisible(), true);
          const text = (await page.locator('body').innerText()).replaceAll('← 이전', '').replaceAll('다음 →', '').replaceAll('← 목록으로', '');
          assert.doesNotMatch(text, /[↗→＋←]/);
          const preloads = await page.locator('link[rel=preload][as=image]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
          assert.deepEqual(preloads, [`/assets/${game}/hero.webp`, `/assets/${game}/title.png`]);
          // 키보드만으로 시작 링크와 게임 전환, 카드 영역, 접기 안내에 진입한다.
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement.classList.contains('studio-link')), true);
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement.closest('#game-switcher') !== null), true);
          const cards = page.locator('.news-cards').filter({ has: page.locator('.news-card') }).first();
          await cards.focus();
          if (width < 651) {
            const before = await cards.evaluate(node => node.scrollLeft);
            await page.keyboard.press('ArrowRight');
            await page.waitForFunction(() => document.activeElement.scrollLeft > 0);
            assert.ok(await cards.evaluate(node => node.scrollLeft) > before);
            await cards.evaluate(node => { node.scrollLeft = 0; });
          }
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement.className), 'news-card');
          await page.locator('.grain-details summary').focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('#grain-policy-summary').isVisible(), true);
          await page.keyboard.press('Enter');
          await page.emulateMedia({ reducedMotion: 'reduce' });
          assert.equal(await page.locator('#board-tabs a').first().evaluate(node => getComputedStyle(node).transitionDuration), '0s');
          assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
          await page.addScriptTag({ content: axe });
          const audit = await page.evaluate(() => axe.run(document, { runOnly: ['color-contrast'] }));
          assert.equal(audit.violations.length, 0, `${label}: 대비 실패 ${JSON.stringify(audit.violations.map(item => item.nodes.map(node => ({ target: node.target, summary: node.failureSummary }))))}`);
          contrast.push({ label, failures: audit.violations, rendered: await measureContrast(page, audit) });
          await page.evaluate(async () => { document.activeElement.blur(); for (const region of document.querySelectorAll('.news-cards')) region.scrollTo({ left: 0, behavior: 'instant' }); scrollTo(0, 0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
          assert.ok(await cards.evaluate(node => node.scrollLeft <= 6 && node.firstElementChild.getBoundingClientRect().left >= node.getBoundingClientRect().left));
          await page.screenshot({ path: resolve(artifacts, `${label}.png`), fullPage: true });
          if (kind === 'notice' && !signedIn) {
            for (const post of ['feedback', 'rules']) {
              await page.goto(`${origin}/community/?game=${game}&board=notice&post=${post}`);
              await page.locator('#article-view').waitFor();
              await page.evaluate(() => document.fonts.ready);
              assert.ok(await page.locator('#article-body li').count() >= 5);
              const size = await page.evaluate(() => document.documentElement.scrollWidth);
              assert.ok(size <= width, `${label}-${post}: 가로 넘침`);
              await page.addScriptTag({ content: axe });
              const audit = await page.evaluate(() => axe.run(document, { runOnly: ['color-contrast'] }));
              assert.equal(audit.violations.length, 0, `${label}-${post}: 대비 실패`);
              contrast.push({ label: `${game}-${width}-${post}`, failures: audit.violations, rendered: await measureContrast(page, audit) });
              await page.screenshot({ path: resolve(artifacts, `${game}-${width}-${post}.png`), fullPage: true });
            }
          }
          checks.push(`${label}: 가로 넘침·카드·동선·키보드·움직임·대비 통과`);
          await page.close();
          console.log(checks.at(-1));
        }
      }
    }
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(wrongImages.length, 0, JSON.stringify(wrongImages));
  assert.ok(fontRequests.size > 0, '실제 웹폰트 요청이 없음');
  console.log(`화면 ${checks.length}개 검증 통과, 콘솔 오류 0, 반대 게임 그림 요청 0, 웹폰트 요청 ${fontRequests.size}종`);
} finally {
  await writeFile(resolve(artifacts, 'browser-report.json'), JSON.stringify({ checks, errors, wrongImages, fontRequests: [...fontRequests], contrast }, null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
