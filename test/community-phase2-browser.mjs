/* 실제 server/와 임시 DB로 새 소식·권한·상태·화면을 검증한다.
 * 실행 환경: PLAYWRIGHT_MODULE, AXE_SOURCE, PNG_MODULE은 외부 시험 도구의 경로.
 * 웹폰트는 차단하지 않으며 운영 서버·운영 DB를 사용하지 않는다.
 */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { NOTICE_COVERS } from '../server/community.js';
const require = createRequire(import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const axe = await readFile(process.env.AXE_SOURCE || require.resolve('axe-core/axe.min.js'), 'utf8');
const { PNG } = require(process.env.PNG_MODULE || 'pngjs');
const artifacts = process.env.COMMUNITY_CAPTURE_DIR || '/tmp/community-phase2-ui-20261020';
await mkdir(artifacts, { recursive: true });
const errors = [], checks = [], contrast = [], fontRequests = new Set();
async function measureContrast(page, audit) {
  const targets = audit.incomplete.flatMap(item => item.nodes.map(node => node.target));
  if (!targets.length) return [];
  const viewportOnly = await page.locator('dialog[open]').count() > 0;
  await page.evaluate(() => { scrollTo(0, 0); for (const dialog of document.querySelectorAll('dialog[open]')) dialog.scrollTop = 0; });
  const texts = await page.evaluate(({ targets, viewportOnly }) => targets.flatMap(target => {
    const element = document.querySelector(target[0]);
    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const rect of range.getClientRects()) nodes.push({ target, color: getComputedStyle(text.parentElement).color, box: { x: rect.x + (viewportOnly ? 0 : scrollX), y: rect.y + (viewportOnly ? 0 : scrollY), width: rect.width, height: rect.height } });
    }
    return nodes;
  }), { targets, viewportOnly });
  const style = await page.addStyleTag({ content: '*{-webkit-text-fill-color:transparent!important;text-shadow:none!important}' });
  let background;
  try { background = PNG.sync.read(await page.screenshot({ fullPage: !viewportOnly })); }
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

const child = fork(new URL('./community-phase2-fixture.mjs', import.meta.url), { env: { PATH: process.env.PATH, NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
let browser;
const fixture = await Promise.race([
  once(child, 'message').then(([data]) => data),
  once(child, 'exit').then(() => { throw new Error('격리 시험 서버 준비 실패'); })
]);
const { origin, sessions } = fixture;
async function api(context, path, body, method = body ? 'POST' : 'GET', expected = 200) {
  const response = await context.request.fetch(`${origin}/api${path}`, { method, ...(body ? { data: body, headers: { origin } } : {}) });
  assert.equal(response.status(), expected, `${method} ${path}: HTTP ${response.status()}`);
  return response.json();
}
async function contextFor(role) {
  const context = await browser.newContext();
  if (sessions[role]) await context.addCookies(sessions[role].split('; ').map(pair => { const index = pair.indexOf('='); return { name: pair.slice(0, index), value: pair.slice(index + 1), url: origin }; }));
  await context.route('https://cloud.umami.is/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  return context;
}
async function pageFor(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) fontRequests.add(request.url()); });
  return page;
}
const path = (game, board = 'notice', post) => `${origin}/community/?${new URLSearchParams({ game, board, ...(post ? { post } : {}) })}`;
async function ready(page, address) {
  await page.goto(address);
  await page.waitForFunction(() => document.querySelector('#list-status').hidden && !document.querySelector('#session-label').textContent.includes('확인하고'));
  await page.evaluate(() => document.fonts.ready);
}
async function audit(page, label) {
  await page.evaluate(async () => { for (const image of document.images) if (!image.closest('[hidden]')) { image.loading = 'eager'; await image.decode().catch(() => {}); } });
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, dialog: [...document.querySelectorAll('dialog[open]')].some(node => node.scrollWidth > node.clientWidth) }));
  assert.ok(overflow.scroll <= overflow.width && !overflow.dialog, `${label}: 가로 넘침 ${JSON.stringify(overflow)}`);
  const text = (await page.locator('body').innerText()).replaceAll('← 이전', '').replaceAll('다음 →', '').replaceAll('← 목록으로', '');
  assert.doesNotMatch(text, /[↗→＋←]/);
  await page.addScriptTag({ content: axe });
  const result = await page.evaluate(() => axe.run(document, { runOnly: ['color-contrast'] }));
  assert.equal(result.violations.length, 0, `${label}: 대비 실패 ${JSON.stringify(result.violations.map(item => item.nodes.map(node => ({ target: node.target, summary: node.failureSummary }))))}`);
  await page.screenshot({ path: resolve(artifacts, `${label}.png`), fullPage: !await page.locator('dialog[open]').count() });
  contrast.push({ label, rendered: await measureContrast(page, result) });
  checks.push(label);
  console.log(`${label}: 통과`);
}
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const operator = await contextFor('operator'), member = await contextFor('member'), guest = await contextFor('guest');
  assert.equal((await api(operator, '/community/session')).user.isOperator, true);
  assert.equal((await api(member, '/community/session')).user.isOperator, false);
  const news = {}, own = {};
  for (const game of ['gyeongguk', 'slimeline']) {
    const fallback = await api(operator, '/community/posts', { game, board: 'notice', title: '기본 그림 새 소식', body: '대표 그림을 선택하지 않은 새 소식입니다.' }, 'POST', 201);
    assert.equal(fallback.post.cover, null);
    // 모든 서버 그림 키를 저장·읽기 경계에서 확인한다. 뒤의 UI 등록이 가장 최신이다.
    for (const cover of NOTICE_COVERS[game]) {
      const result = await api(operator, '/community/posts', { game, board: 'notice', title: `대표 그림 시험 ${cover}`, body: '대표 그림과 말머리 저장을 확인합니다.', category: 'guide', cover }, 'POST', 201);
      assert.equal(result.post.cover, cover);
      assert.equal(result.reward.pending, false);
    }
    await api(member, '/community/posts', { game, board: 'notice', title: '일반 회원 금지 시험', body: '등록하면 안 되는 새 소식입니다.' }, 'POST', 403);
    await api(guest, '/community/posts', { game, board: 'notice', title: '비회원 금지 시험', body: '등록하면 안 되는 새 소식입니다.' }, 'POST', 401);
    const page = await pageFor(operator);
    await ready(page, path(game, 'notice', fallback.post.id));
    assert.equal(await page.locator('#article-cover img').getAttribute('src'), `/assets/${game}/hero.webp`);
    assert.equal(await page.locator('#article-badge').innerText(), '새 소식');
    await ready(page, path(game));
    await page.locator('#write-post').click();
    assert.doesNotMatch(await page.locator('#editor-dialog').innerText(), /그레인|적립|보상/);
    await page.locator('#post-category').selectOption('devnote');
    await page.locator(`input[name=cover][value="${game === 'gyeongguk' ? 'tile-notice' : 'hero'}"]`).check();
    await page.locator('#post-title').fill(`${game === 'gyeongguk' ? '경국지계' : '슬라임 라인'} 개발 소식`);
    await page.locator('#post-body').fill('화면에서 직접 등록한 운영자 새 소식입니다. 말머리와 대표 그림, 작성자 표시를 확인합니다.');
    await Promise.all([page.waitForURL(url => url.searchParams.has('post')), page.locator('#post-submit').click()]);
    await page.locator('#article-title').waitFor();
    const id = new URL(page.url()).searchParams.get('post'); news[game] = id;
    const detail = await api(operator, `/community/posts/${id}?game=${game}`);
    assert.equal(detail.post.category, 'devnote');
    assert.equal(detail.post.cover, game === 'gyeongguk' ? 'tile-notice' : 'hero');
    assert.equal(detail.post.author.id, undefined);
    assert.equal(await page.locator('#article-badge').innerText(), '개발 노트');
    assert.equal(await page.locator('#article-author .operator-badge').innerText(), '운영자');
    assert.equal(await page.locator('.post-report-button').count(), 0);
    await page.locator('#edit-post').click();
    assert.equal(await page.locator('#post-category').inputValue(), 'devnote');
    assert.equal(await page.locator('input[name=cover]:checked').inputValue(), detail.post.cover);
    await page.locator('#post-title').fill(`${detail.post.title} 수정`);
    await Promise.all([page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(id)), page.locator('#post-submit').click()]);
    await page.waitForFunction(() => document.querySelector('#editor-dialog').open === false);
    await page.waitForLoadState();
    const edited = await api(operator, `/community/posts/${id}?game=${game}`);
    assert.equal(edited.post.cover, detail.post.cover); assert.equal(edited.post.category, 'devnote');
    // 댓글도 실제 API를 거쳐 운영자 표시와 본인 신고 숨김을 확인한다.
    await api(operator, `/community/posts/${id}/comments`, { body: '운영자가 남긴 댓글입니다.' }, 'POST', 201);
    await api(member, `/community/posts/${id}/comments`, { body: '일반 회원이 남긴 댓글입니다.' }, 'POST', 201);
    await ready(page, path(game, 'notice', id));
    for (const status of ['checking', 'solved', 'applied', '']) {
      await page.locator('#post-status-select').selectOption(status);
      await page.locator('#post-status-form button').click();
      await page.waitForFunction(() => document.querySelector('#article-status').textContent === '처리 상태를 저장했어요.' && !document.querySelector('#post-status-form button').disabled);
      const saved = await api(operator, `/community/posts/${id}?game=${game}`);
      assert.equal(saved.post.status, status || null); assert.equal(saved.post.updatedAt, edited.post.updatedAt);
    }
    await page.locator('#post-status-select').selectOption('checking'); await page.locator('#post-status-form button').click();
    await page.locator('#article-state-badge .status-badge').waitFor();
    own[game] = (await api(member, '/community/posts', { game, board: 'free', title: '내 글 신고 숨김 시험', body: '본인 글은 신고 버튼이 보이지 않아야 합니다.' }, 'POST', 201)).post.id;
    await api(operator, `/community/posts/${own[game]}/status?game=${game}`, { status: 'applied' }, 'PATCH');
    await page.close();
  }
  const offline = await contextFor('guest');
  // 실패 주입은 fetch 경계에서만 한다. 브라우저 콘솔에 의도적인 자원 오류를 만들지 않는다.
  await offline.addInitScript(() => { const original = window.fetch; window.fetch = (url, ...args) => String(url).startsWith('/api/') ? Promise.reject(new TypeError('시험용 서버 연결 실패')) : original(url, ...args); });
  for (const game of ['gyeongguk', 'slimeline']) {
    for (const width of [1440, 390, 320]) {
      const page = await pageFor(operator); await page.setViewportSize({ width, height: 900 });
      await ready(page, path(game));
      assert.equal(await page.locator('.news-card').count(), 3);
      assert.ok((await page.locator('.news-card').first().getAttribute('href')).includes(news[game]));
      const date = await page.locator('.news-card time').first().innerText();
      const data = await api(operator, `/community/posts/${news[game]}?game=${game}`);
      const expectedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(data.post.createdAt));
      assert.equal(date, expectedDate);
      assert.equal(await page.locator('.news-card .post-badge').first().innerText(), '개발 노트');
      const serverRows = page.locator('.post-row').filter({ hasText: '대표 그림 시험' });
      if (NOTICE_COVERS[game].length > 2) assert.ok(await serverRows.count() > 0);
      const links = await page.locator('#post-list a').evaluateAll(nodes => nodes.map(node => node.href));
      assert.equal(new Set(links).size, links.length, '카드·목록 중복');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
      const cards = page.locator('#post-list .news-cards'); await cards.focus();
      if (width < 651) { await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.activeElement.scrollLeft > 0); await cards.evaluate(node => node.scrollLeft = 0); }
      await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.className), 'news-card');
      await audit(page, `${game}-${width}-notice`);
      await ready(page, path(game, 'free'));
      assert.ok((await page.locator('#news-cards .news-card').first().getAttribute('href')).includes(news[game]));
      assert.equal(await page.locator('.post-row .status-badge').innerText(), '반영됨');
      await audit(page, `${game}-${width}-free`);
      await ready(page, path(game, 'notice', news[game]));
      assert.equal(await page.locator('#article-state-badge .status-badge').innerText(), '확인 중');
      assert.equal(await page.locator('#comment-list .operator-badge').count(), 1);
      assert.equal(await page.locator('#comment-list .comment-card').first().locator('.report-button').count(), 0);
      await page.locator('#post-status-select').focus(); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), '상태 저장');
      await audit(page, `${game}-${width}-article`);
      await page.locator('#edit-post').click();
      const radios = page.locator('input[name=cover]');
      await radios.first().focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('input[name=cover]:checked').inputValue(), NOTICE_COVERS[game][0]);
      await page.keyboard.press('ArrowLeft');
      // 원래 선택으로 돌려 초안 변경 여부를 유지한다.
      await page.locator(`input[name=cover][value="${data.post.cover}"]`).check();
      await audit(page, `${game}-${width}-editor`);
      await page.locator('#editor-cancel').click();
      await page.close();
      const memberPage = await pageFor(member); await memberPage.setViewportSize({ width, height: 900 });
      await ready(memberPage, path(game)); assert.equal(await memberPage.locator('#write-post').isVisible(), false);
      await ready(memberPage, path(game, 'notice', news[game])); assert.equal(await memberPage.locator('#post-status-form').isVisible(), false); assert.equal(await memberPage.locator('#post-owner-actions').isVisible(), false);
      assert.equal(await memberPage.locator('.post-report-button').count(), 1);
      assert.equal(await memberPage.locator('#comment-list .comment-card').last().locator('.report-button').count(), 0);
      await audit(memberPage, `${game}-${width}-member`);
      await ready(memberPage, path(game, 'free', own[game])); assert.equal(await memberPage.locator('.post-report-button').count(), 0);
      assert.equal(await memberPage.locator('#edit-post').isVisible(), true);
      await memberPage.close();
      const disconnected = await pageFor(offline); await disconnected.setViewportSize({ width, height: 900 });
      await ready(disconnected, path(game)); assert.equal(await disconnected.locator('.news-card').count(), 3);
      assert.equal(await disconnected.locator('#write-post').isVisible(), false);
      assert.equal(await disconnected.locator('#connection-status').isVisible(), true);
      await audit(disconnected, `${game}-${width}-offline`);
      await ready(disconnected, path(game, 'notice', 'rules'));
      assert.doesNotMatch(await disconnected.locator('#article-author').innerText(), /공개 전 초안/);
      await disconnected.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.ok(fontRequests.size > 0, '웹폰트 요청 누락');
  console.log(`실제 API 및 화면 ${checks.length}개 검증 통과, 콘솔 오류 0, 장식 화살표 0, 웹폰트 요청 ${fontRequests.size}종`);
} finally {
  await writeFile(resolve(artifacts, 'browser-report.json'), JSON.stringify({ checks, errors, contrast, fontRequests: [...fontRequests], serverPid: child.pid }, null, 2));
  await browser?.close();
  const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped;
}
