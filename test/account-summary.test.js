import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { approveGuardianRequest, withdrawGuardian } from '../server/guardian-review.js';
import { request, cookieFrom, registerAndLogin, tokenFrom } from './account-helpers.js';

const password = '상단표시시험-비밀번호-1234';
const adult = email => ({ email, name: '상단표시회원', password, ageBand: '14plus' });
const post = (app, path, body, cookie, headers) => request(app, path, { method: 'POST', body, cookie, headers });
const summary = (app, cookie, origin, path = '/api/account/summary') => request(app, path, { cookie, headers: origin === undefined ? {} : { origin } });
async function scenario(callback, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-summary-')), mailbox = [];
  let app, db;
  try {
    app = await startServer({ port: 0, dataDir: folder, mailer: async mail => mailbox.push(mail), guardianReplyTo: 'support@example.test', rateLimit: { authMax: 100, readMax: 300 }, ...options });
    db = new DatabaseSync(join(folder, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON;');
    await callback({ app, db, mailbox, folder });
  } finally { db?.close(); await app?.close(); await rm(folder, { recursive: true, force: true }); }
}
const grainRows = db => JSON.stringify(['grain_wallets', 'grain_ledger', 'grain_event_eligibility', 'grain_signup_reservations'].map(table => db.prepare(`SELECT * FROM ${table}`).all()));

test('상단 요약은 익명 또는 본인 닉네임·잔액만 반환하며 지갑·원장·자격을 바꾸지 않음', async () => scenario(async ({ app, db, mailbox }) => {
  const anonymousBefore = grainRows(db);
  assert.deepEqual((await summary(app)).body, { user: null });
  assert.equal(grainRows(db), anonymousBefore);
  const login = await registerAndLogin(app, mailbox, adult('summary@example.test'));
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login), before = grainRows(db);
  const result = await summary(app, cookie);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { user: { name: '상단표시회원', grainBalance: 30000 } });
  assert.equal(grainRows(db), before);
  assert.doesNotMatch(result.text, /email|userId|eventId|token|entries|createdAt/);
  assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.headers.vary, 'Origin');
  assert.equal(result.headers['access-control-allow-origin'], undefined);
  // 기능 적용 전 계정 상태의 요약 조회도 지갑이나 이벤트 자격을 만들지 않습니다.
  for (const table of ['grain_wallets', 'grain_ledger', 'grain_event_eligibility']) db.prepare(`DELETE FROM ${table} WHERE userId=?`).run(login.body.user.id);
  db.prepare('UPDATE user SET ageBand=NULL WHERE id=?').run(login.body.user.id);
  const emptyBefore = grainRows(db);
  assert.deepEqual((await summary(app, cookie)).body, { user: { name: '상단표시회원', grainBalance: 0 } });
  assert.equal(grainRows(db), emptyBefore);
  assert.equal((await post(app, '/api/auth/sign-out', {}, cookie)).status, 200);
  assert.deepEqual((await summary(app, cookie)).body, { user: null });
}));

test('상단 표시 조회는 노후 유효 세션을 연장하지 않고 만료 세션은 익명으로 표시함', async () => scenario(async ({ app, db, mailbox }) => {
  const login = await registerAndLogin(app, mailbox, adult('summary-no-refresh@example.test'));
  const cookie = cookieFrom(login), userId = login.body.user.id;
  const day = 24 * 60 * 60 * 1000;
  db.prepare('UPDATE session SET expiresAt=?,updatedAt=? WHERE userId=?').run(Date.now() + 5 * day, Date.now() - 2 * day, userId);
  const previous = db.prepare('SELECT expiresAt,updatedAt FROM session WHERE userId=?').get(userId);
  const before = grainRows(db);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual((await summary(app, cookie, 'https://gracekingames.com')).body, { user: { name: '상단표시회원', grainBalance: 30000 } });
    assert.deepEqual(db.prepare('SELECT expiresAt,updatedAt FROM session WHERE userId=?').get(userId), previous);
  }
  assert.equal(grainRows(db), before);
  db.prepare('UPDATE session SET expiresAt=0 WHERE userId=?').run(userId);
  assert.deepEqual((await summary(app, cookie, 'https://gracekingames.com')).body, { user: null });
  assert.equal(grainRows(db), before);
}));

test('HTTPS 대문·www의 표시 GET만 자격증명 CORS 허용하고 민감 API는 노출하지 않음', async () => scenario(async ({ app, mailbox }) => {
  const login = await registerAndLogin(app, mailbox, adult('cors-summary@example.test'));
  const cookie = cookieFrom(login);
  for (const origin of ['https://gracekingames.com', 'https://www.gracekingames.com']) {
    for (const authCookie of [undefined, cookie]) {
      const result = await summary(app, authCookie, origin);
      assert.equal(result.status, 200); assert.equal(result.headers['access-control-allow-origin'], origin);
      assert.equal(result.headers['access-control-allow-credentials'], 'true'); assert.equal(result.headers.vary, 'Origin');
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.body.user?.grainBalance ?? null, authCookie ? 30000 : null);
    }
    const invalid = await summary(app, cookie, origin, '/api/account/summary?userId=other');
    assert.equal(invalid.status, 422); assert.equal(invalid.headers['access-control-allow-origin'], origin);
    for (const path of ['/api/account/session', '/api/account/grain', '/api/community/session']) {
      const response = await request(app, path, { cookie, headers: { origin } });
      assert.equal(response.headers['access-control-allow-origin'], undefined);
      assert.equal(response.headers['access-control-allow-credentials'], undefined);
    }
    assert.equal((await request(app, '/api/auth/sign-out', { method: 'POST', body: {}, cookie, origin })).status, 403);
  }
  const own = await summary(app, cookie, app.origin);
  assert.equal(own.status, 200); assert.equal(own.headers['access-control-allow-origin'], undefined);
}));

test('임의 출처·null·포트·유사 접미사·쓰기·preflight를 허용하지 않음', async () => scenario(async ({ app }) => {
  for (const origin of ['null', 'https://outside.example', 'http://gracekingames.com', 'https://gracekingames.com:444', 'https://www.gracekingames.com:444', 'https://gracekingames.com.evil.test', 'https://evilgracekingames.com', 'https://sub.gracekingames.com', 'https://community.gracekingames.com.evil.test', 'https://gracekingames.com/']) {
    for (const method of ['GET', 'OPTIONS', 'POST']) {
      const response = await request(app, '/api/account/summary', { method, headers: { origin, 'access-control-request-method': 'GET' } });
      assert.equal(response.status, 403); assert.equal(response.headers['access-control-allow-origin'], undefined);
      assert.equal(response.headers['access-control-allow-credentials'], undefined);
      assert.equal(response.headers.vary, 'Origin');
    }
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const response = await request(app, '/api/account/summary', { method, headers: { origin: 'https://gracekingames.com', 'access-control-request-method': 'POST' } });
    assert.equal(response.status, 405); assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal((await request(app, '/api/account/summary', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
}));

test('표시 GET의 저장 장애·속도 제한 오류도 허용 출처에만 안전한 CORS 응답', async () => {
  await scenario(async ({ app, db, mailbox }) => {
    const login = await registerAndLogin(app, mailbox, adult('summary-error@example.test'));
    db.exec('ALTER TABLE grain_wallets RENAME TO grain_wallets_unavailable');
    const error = await summary(app, cookieFrom(login), 'https://gracekingames.com');
    assert.equal(error.status, 500); assert.equal(error.headers['access-control-allow-origin'], 'https://gracekingames.com');
    assert.equal(error.headers['access-control-allow-credentials'], 'true'); assert.equal(error.headers['cache-control'], 'no-store');
    assert.doesNotMatch(error.text, /sqlite|grain_wallets|SELECT/);
  });
  await scenario(async ({ app }) => {
    assert.equal((await summary(app, undefined, 'https://www.gracekingames.com')).status, 200);
    const limited = await summary(app, undefined, 'https://www.gracekingames.com');
    assert.equal(limited.status, 429); assert.equal(limited.headers['access-control-allow-origin'], 'https://www.gracekingames.com');
    assert.equal(limited.headers['access-control-allow-credentials'], 'true'); assert.equal(limited.headers.vary, 'Origin');
  }, { rateLimit: { readMax: 1 } });
});

test('보호자 승인이 유효한 어린이도 잔액 표시·동의 철회는 남은 세션에서도 차단', async () => scenario(async ({ app, db, mailbox, folder }) => {
  const consent = await post(app, '/api/account/guardian-requests', { guardianName: '표시보호자', guardianEmail: 'guardian@example.test' });
  const guardianCookie = cookieFrom(consent);
  const id = (await request(app, '/api/account/guardian-request', { cookie: guardianCookie })).body.request.requestNumber;
  const evidencePath = join(folder, 'reply.eml');
  await writeFile(evidencePath, `From: guardian@example.test\r\nSubject: 동의\r\n\r\n법정대리인으로서 개인정보 처리와 가입에 동의합니다. 신청 번호 ${id}`, { mode: 0o600 });
  await approveGuardianRequest(db, { id, dataDir: folder, evidencePath, confirmReply: true, confirmGuardian: true, confirmScope: true });
  const email = 'summary-child@example.test';
  assert.equal((await post(app, '/api/auth/sign-up/email', { ...adult(email), ageBand: 'under14' }, guardianCookie)).status, 200);
  assert.equal((await post(app, '/api/account/verify-email', { token: tokenFrom(mailbox.at(-1)) })).status, 200);
  const cookie = cookieFrom(await post(app, '/api/auth/sign-in/email', { email, password }));
  assert.deepEqual((await summary(app, cookie, 'https://gracekingames.com')).body, { user: { name: '상단표시회원', grainBalance: 30000 } });
  db.prepare("UPDATE guardian_requests SET status='withdrawn' WHERE id=?").run(id);
  assert.deepEqual((await summary(app, cookie)).body, { user: null });
  db.prepare("UPDATE guardian_requests SET status='used' WHERE id=?").run(id);
  withdrawGuardian(db, id);
  assert.deepEqual((await summary(app, cookie)).body, { user: null });
}));
