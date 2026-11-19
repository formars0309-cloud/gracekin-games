// 공방부터 실제 계정 저장·게임 PNG까지 검수한다. 첫 인자는 검수할 운영 파일 복사본이다.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerAndLogin } from './account-helpers.js';

const root = resolve(process.argv[2] || '.');
const { startServer } = await import(pathToFileURL(join(root, 'server/app.js')));
const { createAvatarPreset } = await import(pathToFileURL(join(root, 'assets/avatar/model.js')));
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const temporary = await mkdtemp(join(tmpdir(), 'gracekin-avatar-integration-'));
const captures = process.env.AVATAR_CAPTURE_DIR;
if (captures) await mkdir(captures, { recursive: true });
const mailbox = [];
const members = [
  { device: '데스크톱', preset: '미소년', id: 'youth', name: '안개숲의 새벽', quiz: 'healer', recommendation: '별빛치유사', job: 'ranger', label: '숲길잡이', color: '#2d765c' },
  { device: '모바일', preset: '미소녀', id: 'maiden', name: '보랏빛 노을', quiz: 'guardian', recommendation: '수호기사', job: 'arcanist', label: '룬술사', color: '#864f99' },
];
const errors = [];
const ids = new Set();

async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
}

// 현재 장면과, 서버의 저장본으로 같은 자리에 새로 그린 장면의 픽셀을 비교한다.
async function compareRender(page, character, mode, actor = page.locator('#avatar-view')) {
  await actor.scrollIntoViewIfNeeded();
  await frames(page);
  const original = await actor.screenshot();
  await actor.evaluate(async (actor, { character, mode }) => {
    const { createAvatarView } = await import('/assets/avatar/renderer.js');
    const frame = document.createElement('div');
    const position = actor.style.position;
    if (getComputedStyle(actor).position === 'static') actor.style.position = 'relative';
    Object.assign(frame.style, { position: 'absolute', inset: '0' });
    actor.firstElementChild.style.visibility = 'hidden';
    actor.append(frame);
    const reference = createAvatarView(frame, character, { mode });
    window.removeReference = () => {
      reference.dispose();
      frame.remove();
      actor.style.position = position;
      actor.firstElementChild.style.visibility = '';
    };
  }, { character, mode });
  try {
    await frames(page);
    assert.ok(original.equals(await actor.screenshot()), mode + ' 장면은 서버에 저장된 외형·직업과 일치해야 합니다.');
  } finally { await page.evaluate(() => window.removeReference()); }
}

let app, browser;
try {
  app = await startServer({ dataDir: temporary, port: 0, mailer: async mail => mailbox.push(mail), rateLimit: { authMax: 80 } });
  const engine = process.env.AVATAR_BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  for (const [index, member] of members.entries()) {
    const mobile = index === 1;
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1320, height: 890 },
      isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce',
    });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route(/^https:\/\//, route => route.abort());
    const page = await context.newPage();
    const $ = selector => page.locator(selector);
    const press = control => mobile ? control.tap() : control.click();
    const shot = async (label, control = page) => {
      if (captures) await control.screenshot({ path: join(captures, member.device + '-' + label + '.jpg'), quality: 90 });
    };
    await page.goto(app.origin);
    await press(page.getByRole('link', { name: /캐릭터 만들기/ }));
    await page.waitForURL(app.origin + '/games/avatar/');
    assert.match(await page.title(), /캐릭터 만들기/);
    await page.getByRole('heading', { level: 1, name: /캐릭터 만들기/ }).waitFor();
    await $('#login').waitFor();
    await frames(page);
    await shot('공방');
    for (const preset of members.map(item => item.preset)) {
      await press(page.getByRole('button', { name: preset, exact: true }));
      await press($('button[data-mode=portrait]'));
      await $('.showcase').scrollIntoViewIfNeeded();
      await frames(page);
      await shot(preset + '-기본얼굴', $('.showcase'));
    }
    await press(page.getByRole('button', { name: member.preset, exact: true }));
    await $('#hero-name').fill(member.name);
    await press($('[data-section=color]'));
    await $('#clothColor').fill(member.color);
    await press($('#open-quiz'));
    for (let n = 1; n <= 10; n++) {
      await $('.avq-progress[value="' + n + '"]').waitFor();
      await press($('#quiz-root label').filter({ has: page.locator('input[value=' + member.quiz + ']') }));
      await press($('#quiz-root button[type=submit]'));
    }
    assert.equal(await $('.avq-job').textContent(), member.recommendation);
    await shot('직업추천', $('#quiz-dialog'));
    await press(page.getByRole('button', { name: member.recommendation + ' 적용' }));
    await press($('[data-section=profile]'));
    await press($('[data-job=' + member.job + ']'));

    const credentials = { name: '공방 시험회원', email: randomUUID() + '@example.test', password: randomUUID(), ageBand: '14plus' };
    assert.equal((await registerAndLogin(app, mailbox, credentials)).status, 200);
    const popup = context.waitForEvent('page');
    await press($('#login'));
    const signin = await popup;
    await signin.locator('#signin-email').fill(credentials.email);
    await signin.locator('#signin-password').fill(credentials.password);
    await press(signin.locator('#signin-form button[type=submit]'));
    await signin.locator('#account-avatar-link').waitFor();
    await signin.close();
    await page.bringToFront();
    if (!await $('#use-guest').isVisible()) await press($('#load'));
    await press($('#use-guest'));
    await press($('#save'));
    await page.waitForFunction(() => document.querySelector('#sync-status').textContent.includes('계정에 저장했어요'));
    const saved = (await (await context.request.get(app.origin + '/api/avatar/me')).json()).avatar;
    const expected = createAvatarPreset(member.id);
    Object.assign(expected, { name: member.name, job: member.job, recommendedJob: member.quiz });
    expected.appearance.clothColor = member.color;
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.character, expected);
    ids.add(saved.id);
    await page.reload();
    await page.waitForFunction(name => document.querySelector('#hero-name').value === name, member.name);
    await page.goto(app.origin + '/account/?game=avatar');
    await $('#account-avatar-portrait canvas').waitFor();
    assert.equal(await $('#account-avatar-name').innerText(), member.name);
    assert.equal(await $('#account-avatar-job').innerText(), member.label);
    assert.ok((await $('#account-avatar-portrait [role=img]').getAttribute('aria-label')).includes(member.name + ' · ' + member.label + ' 얼굴'));
    await compareRender(page, saved.character, 'portrait', $('#account-avatar-portrait'));
    await shot('계정초상', $('.account-avatar'));
    await press($('#account-avatar-link'));
    await page.waitForURL(app.origin + '/games/avatar/');
    await page.waitForFunction(name => document.querySelector('#hero-name').value === name, member.name);
    assert.equal(await $('#clothColor').inputValue(), member.color);
    assert.equal(await $('#recommendation').isVisible(), true);
    for (const mode of ['board', 'rpg']) {
      await press($('button[data-mode=' + mode + ']'));
      assert.match(await $('#avatar-view [role=img]').getAttribute('aria-label'), new RegExp(member.label));
      await compareRender(page, saved.character, mode);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const actor = $('#avatar-view');
      const x = await actor.evaluate(node => node.style.left);
      if (mobile) {
        await press($('[data-direction=right]'));
      } else {
        await $('#scene').focus();
        await page.keyboard.down('ArrowRight');
      }
      await page.waitForFunction(previous => document.querySelector('#avatar-view').style.left !== previous, x);
      if (!mobile) await page.keyboard.up('ArrowRight');
      await frames(page);
      await shot(mode === 'board' ? '보드이동' : '탐험이동', $('.showcase'));
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    await press(page.getByRole('button', { name: '게임 파일 만들기' }));
    const link = page.getByRole('link', { name: /게임 파일 받기/ });
    await link.waitFor({ timeout: 60000 });
    const download = page.waitForEvent('download');
    await press(link);
    const archive = await download;
    assert.equal(archive.suggestedFilename(), 'avatar-gamekit.zip');
    const zip = await archive.path();
    const snapshot = JSON.parse(execFileSync('unzip', ['-p', zip, 'avatar.json']));
    assert.deepEqual(snapshot, { version: 2, id: saved.id, revision: 1, character: { appearance: expected.appearance, job: member.job } });
    if (captures) {
      for (const [entry, label] of [['pawn.png', '게임말'], ['sprites.png', '동작시트']]) {
        await writeFile(join(captures, member.device + '-' + label + '.png'), execFileSync('unzip', ['-p', zip, entry]));
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await context.close();
    console.log(member.device + ' · ' + member.preset + ' · 직업 10문답·로그인·계정 저장·새로고침·초상·보드와 RPG의 픽셀 및 이동·ZIP 일치');
  }
  assert.equal(ids.size, 2);
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await app?.close();
  await rm(temporary, { recursive: true, force: true });
}
