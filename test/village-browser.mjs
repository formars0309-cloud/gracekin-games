import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scenario, seedMember, request, delay } from './village-helpers.js';
import { VILLAGE_OPENS_AT } from '../server/village/policy.js';
import { VILLAGES } from '../server/village/age-group.js';

// 설치된 Playwright를 사용합니다. 별도 위치는 PLAYWRIGHT_MODULE로 지정할 수 있습니다.
let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright')); }
catch { console.log('건너뜀: Playwright가 없습니다. 설치한 환경에서 다시 실행해 주세요.'); process.exit(0); }
const output = resolve('reports/village-plaza'); await mkdir(output, { recursive: true });
const report = { passed: [], screenshots: [], errors: [] };
const pass = message => { report.passed.push(message); console.log(`통과: ${message}`); };
const waitUntil = async (predicate, label, timeout = 6000) => {
  const start = Date.now(); while (!predicate()) { if (Date.now() - start > timeout) throw new Error(`${label} 대기 만료`); await delay(40); }
};
const capture = async (page, name) => { await page.screenshot({ path: resolve(output, name), fullPage: true }); report.screenshots.push(name); };
async function memberContext(browser, app, member, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ko-KR', ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) });
  const [name, ...parts] = member.cookie.split('=');
  await context.addCookies([{ name, value: parts.join('='), url: app.origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  return { context, page };
}
await scenario(async ({ app, db, signup }) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, locale: 'ko-KR' });
    const alice = await signup('browser-one', { birthYear: null }), bob = await signup('browser-two', { birthYear: null });
    db.prepare('UPDATE user SET name=? WHERE id=?').run('작은새', alice.id); db.prepare('UPDATE user SET name=? WHERE id=?').run('달빛친구', bob.id);
    const pages = [await desktop.newPage(), await mobile.newPage()], received = [[], []], sent = [[], []];
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('websocket', socket => {
        socket.on('framereceived', frame => { try { received[index].push(JSON.parse(frame.payload)); } catch {} });
        socket.on('framesent', frame => { try { sent[index].push(JSON.parse(frame.payload)); } catch {} });
      });
      const cookie = [alice, bob][index].cookie.split(';').map(part => part.trim()).find(part => part.startsWith('gracekin.session_token='));
      await [desktop, mobile][index].addCookies([{ name: 'gracekin.session_token', value: cookie.slice(cookie.indexOf('=') + 1), url: app.origin, httpOnly: true, sameSite: 'Lax' }]);
      await page.goto(`${app.origin}/village/`, { waitUntil: 'networkidle' });
      await page.locator('#birthyear-dialog').waitFor({ state: 'visible' });
      assert.equal(sent[index].length, 0, '출생연도 확정 전에 소켓을 시작하면 안 됩니다.');
      assert.equal(await page.locator('#wardrobe-dialog').isVisible(), false);
      await page.locator('#birthyear-select').selectOption('2012');
      await capture(page, `${index ? 'mobile' : 'desktop'}-birthyear-select.png`);
      await page.locator('#birthyear-next').click();
      await page.locator('#birthyear-confirm').waitFor({ state: 'visible' });
      await capture(page, `${index ? 'mobile' : 'desktop'}-birthyear-confirm.png`);
      await page.locator('#birthyear-save').click();
      await page.locator('#wardrobe-dialog').waitFor({ state: 'visible' });
      assert.equal(await page.locator('input[name=skin]').count(), 4);
      await page.locator('input[name=outfit]').nth(index + 1).check({ force: true });
      const shot = `${index ? 'mobile' : 'desktop'}-wardrobe.png`; await page.screenshot({ path: resolve(output, shot), fullPage: true }); report.screenshots.push(shot);
      await page.locator('#wardrobe-save').click();
      await page.locator('#wardrobe-dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('#connection-status').textContent.includes('도착'));
      await page.locator('#village-game canvas').waitFor({ state: 'visible' });
      pass(`${index ? '390px 모바일' : '데스크톱'} 입장·3색 옷장 저장·캔버스 표시`);
    }
    await waitUntil(() => received[0].some(message => message.type === 'snapshot' && message.players.some(player => player.id === bob.id)), '서로의 입장');
    const canvas = pages[0].locator('#village-game canvas'), bounds = await canvas.boundingBox();
    // 화면의 내 캐릭터 옆 빈 바닥을 클릭해 실제 A* 이동 의도를 관측합니다.
    await canvas.click({ position: { x: bounds.width / 2 + 90, y: bounds.height / 2 + 35 } });
    await waitUntil(() => sent[0].some(message => message.type === 'move' && message.path?.length), '탭 이동 의도');
    await waitUntil(() => received[1].some(message => message.type === 'snapshot' && message.players.some(player => player.id === alice.id && (player.x !== 20 || player.y !== 20))), '상대에게 이동 반영');
    pass('클릭 A* 경로·서버 이동이 다른 브라우저에 반영');
    await pages[0].locator('#chat-input').fill('분수 광장에서 반가워요'); await pages[0].locator('#chat-send').click();
    await pages[1].locator('#chat-log').getByText('분수 광장에서 반가워요', { exact: false }).waitFor();
    await pages[1].locator('#chat-input').fill('모바일에서도 잘 보여요'); await pages[1].locator('#chat-send').click();
    await pages[0].locator('#chat-log').getByText('모바일에서도 잘 보여요', { exact: false }).waitFor();
    pass('두 브라우저 양방향 채팅·기록 창');
    await pages[1].locator('#emote-heart').click();
    await waitUntil(() => received[0].some(message => message.type === 'emote' && message.userId === bob.id && message.id === 'heart'), '하트 감정 전달');
    pass('모바일 감정표현이 상대에게 전달');
    for (const [index, page] of pages.entries()) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false, '화면이 가로로 넘치면 안 됩니다.');
      const shot = `${index ? 'mobile' : 'desktop'}-plaza-chat.png`; await page.screenshot({ path: resolve(output, shot), fullPage: true }); report.screenshots.push(shot);
    }
    pass('390px·데스크톱 가로 넘침 없음·대화 화면 저장');
    // 키 입력 이동도 DOM 포커스와 실제 서버 변경분을 함께 확인합니다.
    const before = received[0].length; await pages[0].locator('#village-game').focus(); await pages[0].keyboard.down('ArrowDown'); await delay(550); await pages[0].keyboard.up('ArrowDown');
    await waitUntil(() => received[0].slice(before).some(message => message.type === 'snapshot' && message.players.some(player => player.id === alice.id)), '방향키 이동');
    pass('방향키 조작과 서버 위치 반영');
    const child = seedMember(db, alice.id, 'browser-child', { child: true });
    db.prepare('UPDATE user SET name=? WHERE id=?').run('고운별', child.id);
    const childContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
    const childCookie = child.cookie.split('=');
    await childContext.addCookies([{ name: childCookie.shift(), value: childCookie.join('='), url: app.origin, httpOnly: true, sameSite: 'Lax' }]);
    const childPage = await childContext.newPage(), childReceived = [];
    childPage.on('pageerror', error => report.errors.push(error.message));
    childPage.on('websocket', socket => socket.on('framereceived', frame => { try { childReceived.push(JSON.parse(frame.payload)); } catch {} }));
    await childPage.goto(`${app.origin}/village/`, { waitUntil: 'networkidle' }); await childPage.locator('#wardrobe-save').click();
    await childPage.waitForFunction(() => document.querySelector('#connection-status').textContent.includes('도착'));
    assert.equal(await childPage.locator('#chat-form').isVisible(), false);
    assert.equal(await childPage.locator('#child-chat-note').textContent(), '어린이 회원에게는 인사말과 감정표현만 보여요');
    await pages[0].locator('#chat-input').fill('어린이에게 보이지 않을 자유 대화'); await pages[0].locator('#chat-send').click();
    await pages[1].locator('#chat-log').getByText('어린이에게 보이지 않을 자유 대화', { exact: false }).waitFor();
    await pages[0].locator('#phrase-buttons button').first().click();
    await childPage.locator('#chat-log').getByText('안녕!', { exact: false }).waitFor();
    await pages[0].locator('#emote-heart').click();
    await waitUntil(() => childReceived.some(message => message.type === 'emote' && message.id === 'heart'), '어린이 감정 수신');
    assert.equal(await childPage.locator('#chat-log').getByText('어린이에게 보이지 않을 자유 대화', { exact: false }).count(), 0);
    assert.ok(!childReceived.some(message => message.kind === 'free'));
    await childPage.screenshot({ path: resolve(output, 'mobile-child-chat.png'), fullPage: true }); report.screenshots.push('mobile-child-chat.png');
    pass('어린이 자유 채팅 미수신·입력 숨김·안내·문구와 감정 수신');
    const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await guest.goto(`${app.origin}/village/`, { waitUntil: 'networkidle' }); await guest.locator('#login-panel').waitFor({ state: 'visible' });
    await guest.screenshot({ path: resolve(output, 'mobile-login.png'), fullPage: true }); report.screenshots.push('mobile-login.png');
    pass('비회원 로그인 안내');
    const gallery = {};
    for (const [id, year] of Object.entries({ elementary: 2017, middle: 2012, high: 2009, adult: 2000 })) {
      const member = seedMember(db, alice.id, `header-${id}`, { child: id === 'elementary', birthYear: year }); gallery[id] = member;
      db.prepare('UPDATE user SET name=? WHERE id=?').run('마을친구', member.id);
      for (const [label, width] of [['desktop', 1280], ['mobile', 390]]) {
        const { context, page } = await memberContext(browser, app, member, width);
        await page.goto(`${app.origin}/village/`, { waitUntil: 'networkidle' });
        if (await page.locator('#wardrobe-dialog').isVisible()) await page.locator('#wardrobe-save').click();
        await page.waitForFunction(() => document.querySelector('#connection-status').textContent.includes('도착'));
        assert.equal(await page.locator('#village-title').textContent(), VILLAGES[id].name);
        assert.equal(await page.locator('#tour-controls').isVisible(), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await capture(page, `${label}-village-${id}.png`); await context.close();
      }
      pass(`${VILLAGES[id].name} 전용 머리글·강조색·조작 화면 390px·데스크톱`);
    }
    const admin = seedMember(db, alice.id, 'browser-admin', { userId: 'village-browser-admin', birthYear: 2000 });
    db.prepare('UPDATE user SET name=? WHERE id=?').run('마을지기', admin.id);
    for (const [label, width] of [['desktop', 1280], ['mobile', 390]]) {
      const { context, page } = await memberContext(browser, app, admin, width);
      await page.goto(`${app.origin}/village/`, { waitUntil: 'networkidle' });
      if (await page.locator('#wardrobe-dialog').isVisible()) await page.locator('#wardrobe-save').click();
      await page.waitForFunction(() => document.querySelector('#connection-status').textContent.includes('도착'));
      await page.locator('#tour-controls').waitFor({ state: 'visible' });
      for (const id of Object.keys(VILLAGES)) {
        await page.locator('#tour-select').selectOption(id); await page.locator('#tour-start').click();
        await page.waitForFunction(name => document.querySelector('#village-title').textContent === name, VILLAGES[id].name);
        assert.equal(await page.locator('#operator-label').isVisible(), true);
        await capture(page, `${label}-operator-${id}.png`); await delay(2100);
      }
      pass(`${width}px 운영자 둘러보기로 네 마을 이동·운영자 표시`);
      if (width === 1280) {
        await request(app, '/api/village/reports', { method: 'POST', cookie: bob.cookie, body: { targetId: alice.id, reason: '운영 화면 마을 이름 확인' } });
        await request(app, '/api/admin/village/mutes', { method: 'POST', cookie: admin.cookie, body: { targetId: bob.id, durationMinutes: 1, reason: '운영 화면 검수' } });
        await page.goto(`${app.origin}/account/admin/`, { waitUntil: 'networkidle' });
        await page.locator('#admin-content').waitFor({ state: 'visible' });
        await page.locator('#admin-village-reports').getByText('중학생 마을', { exact: true }).waitFor();
        await page.locator('#admin-village-mutes').getByText('중학생 마을', { exact: false }).waitFor();
        await page.locator('#village-profile-target').fill(gallery.high.id);
        await page.getByRole('button', { name: '회원 정보 확인', exact: true }).click();
        await page.locator('#admin-village-profile').getByLabel('수정할 출생연도', { exact: true }).fill('2000');
        await page.locator('#admin-village-profile').getByLabel('수정 사유', { exact: true }).fill('시험 회원의 출생연도 정정 요청 확인');
        await page.getByRole('button', { name: '출생연도 수정', exact: true }).click();
        await page.locator('#admin-village-profile').getByRole('heading', { name: '출생연도 수정 감사', exact: true }).waitFor();
        assert.equal(db.prepare('SELECT birthYear FROM village_profiles WHERE userId=?').get(gallery.high.id).birthYear, 2000);
        await page.locator('#admin-village-profile').scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, 'admin-birthyear-correction.png') }); report.screenshots.push('admin-birthyear-correction.png');
        pass('운영자 화면의 마을별 신고·제한·출생연도 수정과 감사 기록');
      }
      await context.close();
    }
    for (const [name, path] of [['privacy', '/community/privacy/'], ['terms', '/community/terms/'], ['privacy-guide', '/privacy/']]) {
      for (const [label, width] of [['desktop', 1280], ['mobile', 390]]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'ko-KR' });
        page.on('pageerror', error => report.errors.push(error.message));
        await page.goto(`${app.origin}${path}`, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('h1').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${path} ${width}px 가로 넘침`);
        assert.ok((await page.locator('main').textContent()).includes('2026년 11월 27일'));
        const shot = `policy-${name}-${label}.png`; await page.screenshot({ path: resolve(output, shot) }); report.screenshots.push(shot);
        if (name === 'privacy' && label === 'mobile') {
          await page.locator('#village').scrollIntoViewIfNeeded();
          await page.screenshot({ path: resolve(output, 'policy-privacy-mobile-village.png') }); report.screenshots.push('policy-privacy-mobile-village.png');
        }
        await page.close();
      }
      pass(`${name} 개정 페이지 데스크톱·390px 구조와 가로 넘침 확인`);
    }
    const routed = await browser.newContext(), apiCalls = [];
    await routed.route('https://gracekingames.com/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) apiCalls.push(url.pathname);
      const response = await fetch(`${app.origin}${url.pathname}`);
      await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'text/plain' }, body: Buffer.from(await response.arrayBuffer()) });
    });
    await routed.route('https://community.gracekingames.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><title>이동 확인</title><p>정식 출처 이동 확인</p></html>' }));
    const routedPage = await routed.newPage(), sockets = [];
    routedPage.on('websocket', socket => sockets.push(socket.url()));
    await routedPage.goto('https://gracekingames.com/village/').catch(error => { if (!error.message.includes('ERR_ABORTED')) throw error; });
    await routedPage.waitForURL('https://community.gracekingames.com/village/');
    assert.deepEqual(apiCalls, []); assert.deepEqual(sockets, []);
    await routed.close(); pass('Pages에서 API·WebSocket 없이 정식 마을 출처로 전환');
    assert.deepEqual(report.errors, [], '브라우저 실행 오류가 없어야 합니다.');
  } finally { await browser?.close(); }
}, { adminUserIds: 'village-browser-admin' });
await scenario(async ({ app, signup }) => {
  const member = await signup('browser-opening');
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const [name, ...parts] = member.cookie.split('=');
    await context.addCookies([{ name, value: parts.join('='), url: app.origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(), sockets = [];
    page.on('websocket', socket => sockets.push(socket.url())); page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`${app.origin}/village/`, { waitUntil: 'networkidle' });
    await page.locator('#entry-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#entry-message').textContent(), '2026년 11월 27일에 문을 열어요');
    assert.equal(await page.locator('#village-play').isVisible(), false); assert.deepEqual(sockets, []);
    await page.screenshot({ path: resolve(output, 'mobile-before-opening.png'), fullPage: true }); report.screenshots.push('mobile-before-opening.png');
    pass('시행 전 일반 회원 안내와 WebSocket 미시작');
  } finally { await browser.close(); }
}, { initialTime: Date.parse(VILLAGE_OPENS_AT) - 1, villageOpensAt: VILLAGE_OPENS_AT });
assert.deepEqual(report.errors, []);
await writeFile(resolve(output, 'browser-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`브라우저 검증 통과: ${report.passed.length}개, 화면 ${report.screenshots.length}개`);
