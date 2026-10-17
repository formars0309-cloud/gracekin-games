/* 격리 DB의 실제 API와 화면을 함께 검증한다. 운영 서버·운영 계정은 사용하지 않는다. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { request, cookieFrom, registerAndLogin } from '../test/account-helpers.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.env.GRAIN_SERVER_ROOT || root);
const { startServer } = await import(pathToFileURL(join(source, 'server/app.js')).href);
// 별도 설치된 Playwright를 쓰는 환경에서는 모듈의 절대 경로를 지정할 수 있다.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dataDir = await mkdtemp(join(tmpdir(), 'grain-screen-data-'));
const artifacts = await mkdtemp(join(tmpdir(), 'grain-screen-review-'));
const mailbox = [], results = [], pageErrors = [];
let app, browser, db;
const options = { port: 0, rootDir: root, dataDir, mailer: async mail => mailbox.push(mail), rateLimit: { authMax: 500, readMax: 5000, writeMax: 5000 } };
try {
  app = await startServer(options);
  const accounts = {};
  for (const [key, name] of [['admin', '운영검수'], ['member', '화면검수'], ['legacy', '미확인검수'], ['child', '어린이검수']]) {
    const response = await registerAndLogin(app, mailbox, { name, email: `${key}@example.test`, password: '격리화면시험-전용암호-1234', ageBand: '14plus' });
    assert.equal(response.status, 200); accounts[key] = { id: response.body.user.id, cookie: cookieFrom(response) };
  }
  db = new DatabaseSync(join(dataDir, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON;');
  db.prepare('UPDATE user SET emailVerified=0,ageBand=NULL WHERE id=?').run(accounts.legacy.id);
  db.prepare("UPDATE user SET ageBand='under14' WHERE id=?").run(accounts.child.id);
  db.prepare("INSERT INTO guardian_requests(id,capabilityHash,status,createdAt,expiresAt,consentVersion,consentText,childUserId) VALUES(?,?,'used',?,?,?, ?,?)").run('screen-guardian', 'screen-capability', Date.now(), Date.now() + 86400000, 'screen', '격리 검수용 동의', accounts.child.id);
  await app.close(); app = await startServer({ ...options, adminUserIds: accounts.admin.id });
  const policy = (await request(app, '/api/account/config')).body.grainRewardPolicy;
  const send = (path, body, who = 'member') => request(app, path, { method: 'POST', body, cookie: accounts[who].cookie });
  const own = await send('/api/community/posts', { game: 'slimeline', board: 'free', title: '검수용 본인 글', body: '충분한 길이로 글을 작성하여 24시간 적립 예정 보상과 본인 글 신고 버튼 제외를 검증합니다.' });
  const other = await send('/api/community/posts', { game: 'slimeline', board: 'free', title: '다른 회원의 공개 글', body: '운영자가 작성한 검수용 본문이며 다른 회원 화면에서 신고 버튼이 표시되는지 확인합니다.' }, 'admin');
  assert.equal(own.status, 201); assert.equal(other.status, 201);
  await send(`/api/community/posts/${other.body.post.id}/comments`, { body: '다른 회원이 쓴 충분한 길이의 댓글입니다.' }, 'admin');
  await send('/api/community/bug-reports', { game: 'site', title: '검수용 비공개 제보', body: '격리 환경의 화면 검수를 위해 접수하는 충분한 길이의 비공개 제보입니다.' });
  await send('/api/admin/known-issues', { title: '검수용 공개 문제', summary: '악용 방법과 개인정보를 포함하지 않는 검수용 공개 안내입니다.', status: '확인 중', reason: '격리 화면 검수' }, 'admin');
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const contexts = {};
  async function pageFor(who = 'member') {
    if (!contexts[who]) {
      const context = await browser.newContext(); contexts[who] = context;
      await context.route('**/*', route => new URL(route.request().url()).origin === app.origin ? route.continue() : route.fulfill({ status: 204, body: '' }));
      if (accounts[who]) await context.addCookies(accounts[who].cookie.split('; ').filter(Boolean).map(pair => { const split = pair.indexOf('='); return { name: pair.slice(0, split), value: pair.slice(split + 1), url: app.origin }; }));
    }
    const page = await contexts[who].newPage(); page.on('pageerror', error => pageErrors.push(error.message)); return page;
  }
  async function noOverflow(page, label, width) {
    const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(size.document <= size.viewport + 1, `${label} ${width}px 가로 넘침: ${size.document}`);
    await page.screenshot({ path: join(artifacts, `${label}-${width}.png`), fullPage: true }); results.push(`${label} ${width}px 가로 넘침 없음`);
  }
  async function publicPolicy(page, signedIn) {
    const table = page.locator('#grain-policy table');
    await page.locator('#grain-policy-content:not([hidden])').waitFor();
    assert.equal(await page.locator('#grain-policy').evaluate(node => node.closest('.panel') === null), true);
    assert.equal(await table.locator('caption').textContent(), '활동·운영자 확인·이벤트 보상');
    assert.equal(await table.locator('thead th[scope=col]').count(), 3);
    assert.equal(await table.locator('tbody th[scope=row]').count(), 6);
    const rows = await table.locator('tbody tr').allTextContents();
    const number = value => new Intl.NumberFormat('ko-KR').format(value);
    const activity = policy.activity;
    for (const [index, texts] of [
      [0, [number(activity.attendance.amount), `하루 ${activity.attendance.dailyLimit}회`]],
      [1, [number(activity.post.amount), `하루 ${activity.post.dailyLimit}회`, `본문 ${activity.post.minBodyLength}자 이상`, '직전 글과 다른 내용']],
      [2, [number(activity.comment.amount), `하루 ${activity.comment.dailyLimit}회`, `${activity.comment.minBodyLength}자 이상`, '본인 글 제외', '같은 글의 첫 댓글만']],
      [3, [`단순 ${number(policy.bugReport.simple.amount)}`, `일반 ${number(policy.bugReport.normal.amount)}`, `중대 ${number(policy.bugReport.critical.amount)}`, '최초 제보자만']],
      [4, [number(policy.bestPost.amount), '한 글에 한 번']], [5, ['이벤트 공지 지급량', '계정당 한 번']],
    ]) for (const text of texts) assert.ok(rows[index].includes(text), `${index}행 정책 안내 누락: ${text}`);
    const text = await page.locator('#grain-policy').textContent();
    for (const detail of [number(activity.dailyTotalLimit), `${activity.confirmationDelayMs / 3600000}시간`, '이메일 확인', '만 14세 미만', '보상 정지', 'KST', '확정 전 삭제·숨김', '소급 지급하지 않아요']) assert.ok(text.includes(detail), `공개 정책 조건 누락: ${detail}`);
    assert.equal(await page.locator('#grain-content').isVisible(), signedIn);
    const overflow = await table.evaluate(node => ({ width: node.clientWidth, content: node.scrollWidth, parent: node.parentElement.clientWidth }));
    assert.ok(overflow.content <= overflow.width + 1 && overflow.width <= overflow.parent + 1, '표 내부 가로 넘침');
    results.push(`공개 정책 ${signedIn ? '로그인' : '비로그인'} ${page.viewportSize().width}px 수치·조건·표 의미·회원 정보 구분 통과`);
  }
  for (const width of [1440, 390, 320]) {
    for (const [who, path, ready, label] of [
      ['member', '/account/', '#grain-content:not([hidden])', '계정'],
      ['guest', '/account/', '#signin-panel:not([hidden])', '계정비로그인'],
      ['member', '/community/bug-report/', '#bug-private:not([hidden])', '비공개제보'],
      ['admin', '/account/admin/', '#admin-events .tool-record, #events-result', '운영도구'],
      ['member', `/community/?game=slimeline&board=free&post=${other.body.post.id}`, '.post-report-button', '커뮤니티'],
      ['member', '/community/?game=gyeongguk&board=free', '#session-label', '경국지계'],
    ]) {
      const page = await pageFor(who); await page.setViewportSize({ width, height: 900 }); await page.goto(app.origin + path); await page.locator(ready).first().waitFor({ state: 'visible' }); await page.waitForLoadState('networkidle'); if (path === '/account/') await publicPolicy(page, who === 'member'); await noOverflow(page, label, width); await page.close();
    }
  }
  const legacy = await pageFor('legacy'); await legacy.setViewportSize({ width: 320, height: 844 }); await legacy.goto(app.origin + '/account/'); await legacy.getByText('이메일을 확인하면 활동 보상을 받을 수 있어요.', { exact: false }).waitFor(); await noOverflow(legacy, '미확인안내', 320);
  await legacy.locator('#grain-verify').click(); assert.equal(await legacy.locator('#verify-email').inputValue(), 'legacy@example.test'); await legacy.locator('#verify-submit').click(); await legacy.getByText('확인이 필요한 계정이라면 인증 메일을 보내 드려요.', { exact: false }).waitFor();
  const child = await pageFor('child'); await child.setViewportSize({ width: 320, height: 844 }); await child.goto(app.origin + '/account/'); await child.getByText('만 14세 미만 계정은 활동·이벤트 보상 대상이 아니에요.', { exact: false }).waitFor(); await noOverflow(child, '어린이안내', 320);
  const member = await pageFor(); await member.setViewportSize({ width: 390, height: 844 });
  await member.goto(`${app.origin}/community/?game=slimeline&board=free&post=${own.body.post.id}`); await member.locator('#comments-section:not([hidden])').waitFor(); assert.equal(await member.locator('.post-report-button').count(), 0);
  await member.goto(`${app.origin}/community/?game=slimeline&board=free&post=${other.body.post.id}`); await member.locator('.post-report-button').click(); await member.locator('#report-reason').selectOption('기타'); await member.locator('#report-description').fill('격리 환경의 실제 신고 접수 시험'); await member.locator('#report-dialog button[type=submit]').click(); await member.getByText('신고를 접수했어요. 운영자가 확인할게요.').waitFor(); await noOverflow(member, '신고양식', 390); await member.locator('#report-dialog .dialog-close').click();
  await member.locator('.comment-card > .report-button').first().click(); await member.locator('#report-reason').selectOption('도배·광고'); await member.locator('#report-dialog button[type=submit]').click(); await member.getByText('신고를 접수했어요. 운영자가 확인할게요.').waitFor(); await member.locator('#report-dialog .dialog-close').click();
  await member.locator('#comment-body').fill('충분한 길이로 실제 댓글을 작성하여 적립 예정 안내를 확인합니다.'); await member.locator('#comment-submit').click(); await member.getByText('댓글이 등록됐어요. 24시간 동안 유지하면 100 그레인이 적립될 예정이에요.').waitFor();
  await member.goto(app.origin + '/community/?game=slimeline&board=free'); await member.locator('#write-post').click(); await member.locator('#post-title').fill('화면에서 작성한 보상 대상 글'); await member.locator('#post-body').fill('실제 화면에서 새 글을 등록한 뒤 500 그레인 적립 예정 안내가 표시되는지 확인하는 본문입니다.'); await member.locator('#post-submit').click(); await member.getByText('글이 등록됐어요. 24시간 동안 유지하면 500 그레인이 적립될 예정이에요.').waitFor(); await member.waitForURL(url => url.searchParams.get('post') !== other.body.post.id);
  await member.goto(app.origin + '/community/bug-report/'); await member.locator('#bug-title').fill('화면에서 접수한 비공개 제보'); await member.locator('#bug-body').fill('개인정보 없이 실제 브라우저에서 작성해 접수한 비공개 제보 본문입니다.'); await member.locator('#bug-form button[type=submit]').click(); await member.getByText('비공개로 접수했어요. 아래 내 제보에서 처리 상태를 확인할 수 있어요.').waitFor();
  assert.equal(await member.getByRole('heading', { name: '화면에서 접수한 비공개 제보', exact: true }).count(), 0);
  const admin = await pageFor('admin'); await admin.setViewportSize({ width: 390, height: 844 }); await admin.goto(app.origin + '/account/admin/'); await admin.locator('#admin-reports .tool-record').first().waitFor(); assert.equal(await admin.locator('#issue-form-slot [name=summary]').getAttribute('minlength'), '10'); assert.equal(await admin.locator('#issue-form-slot [name=summary]').getAttribute('maxlength'), '2000');
  async function submitIn(selector, values, expected) {
    const form = admin.locator(selector).first();
    for (const [name, value] of Object.entries(values)) { const input = form.locator(`[name="${name}"]`); if (await input.evaluate(node => node.tagName === 'SELECT')) await input.selectOption(value); else await input.fill(value); }
    await form.locator('button[type=submit]').click(); await form.locator('.tool-result').filter({ hasText: expected }).waitFor();
    assert.equal(await form.locator('.tool-result.is-error').count(), 0);
  }
  await submitIn('#admin-reports form', { action: 'hide', reason: '격리 환경의 신고 숨김 시험' }, '신고를 처리했어요');
  await admin.locator('[data-refresh=hidden]').click(); await admin.locator('#admin-hidden form').first().waitFor(); await submitIn('#admin-hidden form', { reason: '격리 환경의 다시 공개 시험' }, '다시 공개했어요');
  await admin.locator('#user-query').fill('화면검수'); await admin.locator('#user-search button').click(); await admin.locator('#admin-users .tool-record').waitFor();
  await submitIn('#admin-users form', { suspended: 'true', reason: '격리 환경의 보상 정지 시험' }, '정지 상태를 저장했어요');
  await submitIn('#admin-users form', { suspended: 'false', reason: '격리 환경의 보상 정지 해제' }, '정지 상태를 저장했어요');
  await submitIn('#admin-users form:nth-of-type(2)', { amount: '100', reason: '격리 환경의 회수 시험' }, '실제 회수 100 그레인');
  await submitIn('#admin-bugs form', { status: '채택', grade: 'simple', reason: '격리 환경의 단순 버그 채택' }, '채택 보상을 지급했어요');
  await submitIn('#issue-form-slot form', { title: '화면 등록 문제', summary: '충분한 길이로 공개하는 비공개 원문 없는 안전한 요약입니다.', status: '확인 중', reason: '격리 환경의 문제 등록' }, '알려진 문제를 등록했어요');
  await submitIn('#admin-issues form', { title: '화면 등록 문제 수정', summary: '공개 안내의 변경 내용도 실제 서버에 저장되는지 검증합니다.', status: '수정 완료', reason: '격리 환경의 문제 수정' }, '공개 안내를 수정했어요');
  await submitIn('#best-form-slot form', { postId: own.body.post.id, reason: '격리 환경의 우수 글 선정' }, '3,000 그레인을 지급했어요');
  const start = new Date(Date.now() - 3600000), end = new Date(Date.now() + 3600000);
  const local = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await submitIn('#event-form-slot form', { slug: 'screen-review', title: '화면 검수 이벤트', amount: '777', startsAt: local(start), endsAt: local(end), reason: '격리 환경의 이벤트 등록' }, '이벤트를 등록했어요');
  let payload;
  admin.on('request', req => { if (req.url().endsWith('/api/admin/events/screen-review/awards')) payload = req.postDataJSON(); });
  await submitIn('#award-form-slot form', { slug: 'screen-review', recipients: 'member@example.test', reason: '격리 환경의 이벤트 지급' }, '지급 1명');
  assert.deepEqual(Object.keys(payload).sort(), ['reason', 'recipients']);
  const guest = await pageFor('guest'); await guest.goto(app.origin + '/account/admin/'); await guest.getByText('운영자만 이용할 수 있어요. 운영 계정으로 로그인했는지 확인해 주세요.').waitFor(); assert.equal(await guest.locator('#admin-content').isVisible(), false);
  await guest.goto(app.origin + '/community/bug-report/'); await guest.locator('#bug-login:not([hidden])').waitFor(); assert.equal(await guest.locator('#bug-private').isVisible(), false);
  // 실제 로그아웃 뒤에도 공개 표가 남고 본인 잔액·내역은 제거되는지 확인합니다.
  await member.goto(app.origin + '/account/'); await member.locator('#grain-content:not([hidden])').waitFor();
  await member.locator('#signout-button').click(); await member.locator('#signin-panel:not([hidden])').waitFor();
  await publicPolicy(member, false); assert.equal(await member.locator('#grain-balance').textContent(), '');
  assert.equal(await member.locator('#grain-entries li').count(), 0); await noOverflow(member, '계정로그아웃후', 390);
  assert.deepEqual(pageErrors, []); results.push('신고·댓글보상·비공개제보·숨김복원·정지해제·회수·채택·공개문제등록수정·우수글·이벤트 실제 API 동작 통과', '본인 글 신고 제외·비회원 비공개양식/운영 차단·이벤트 본문 허용필드·콘솔 예외 없음');
  await writeFile(join(artifacts, '결과.json'), JSON.stringify({ results, pageErrors }, null, 2));
  console.log(`검증 통과: ${results.length}개 확인\n검수 자료: ${artifacts}`);
} finally {
  await browser?.close(); await app?.close(); db?.close(); await rm(dataDir, { recursive: true, force: true });
}
