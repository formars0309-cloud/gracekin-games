import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scenario, delay } from './village-helpers.js';

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
await scenario(async ({ app, db, signup }) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, locale: 'ko-KR' });
    const alice = await signup('browser-one'), bob = await signup('browser-two');
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
    const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await guest.goto(`${app.origin}/village/`, { waitUntil: 'networkidle' }); await guest.locator('#login-panel').waitFor({ state: 'visible' });
    await guest.screenshot({ path: resolve(output, 'mobile-login.png'), fullPage: true }); report.screenshots.push('mobile-login.png');
    pass('비회원 로그인 안내');
    assert.deepEqual(report.errors, [], '브라우저 실행 오류가 없어야 합니다.');
  } finally { await browser?.close(); }
});
await writeFile(resolve(output, 'browser-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`브라우저 검증 통과: ${report.passed.length}개, 화면 ${report.screenshots.length}개`);
