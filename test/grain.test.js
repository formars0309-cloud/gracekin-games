import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { tokenHash } from '../server/account.js';
import { SIGNUP_GRAIN_AMOUNT, SIGNUP_GRAIN_EVENT } from '../server/grain.js';
import { approveGuardianRequest, withdrawGuardian, deleteGuardianChild } from '../server/guardian-review.js';
import { request as rawRequest, cookieFrom, tokenFrom, registerAndLogin as rawRegisterAndLogin } from './account-helpers.js';

// Better Auth의 프로세스 내 메일 제한은 앱 인스턴스 사이에서도 공유됩니다.
// 시험 시나리오마다 신뢰하는 프록시 IP를 따로 주어 실제 제한은 유지한 채 격리합니다.
const clientIPs = new WeakMap();
let nextIP = 1;
function clientHeaders(app) {
  if (!clientIPs.has(app)) clientIPs.set(app, `198.51.100.${nextIP++}`);
  return { 'fly-client-ip': clientIPs.get(app) };
}
const request = (app, path, options = {}) => rawRequest(app, path, { ...options, headers: { ...clientHeaders(app), ...options.headers } });
const registerAndLogin = (app, mailbox, body) => rawRegisterAndLogin(app, mailbox, body, clientHeaders(app));
const password = '그레인시험-비밀번호-1234';
const adult = email => ({ name: '그레인회원', email, password, ageBand: '14plus' });
const post = (app, path, body, cookie) => request(app, path, { method: 'POST', body, cookie });
async function scenario(callback, extra = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-grain-'));
  const mailbox = [];
  const options = { port: 0, dataDir: folder, trustFlyProxy: true, flyAppName: 'gracekin-games-community', mailer: async mail => mailbox.push(mail), guardianReplyTo: 'support@example.test', rateLimit: { authMax: 150, readMax: 300 }, ...extra };
  let app;
  const db = () => { const connection = new DatabaseSync(join(folder, 'community.sqlite')); connection.exec('PRAGMA foreign_keys=ON;'); return connection; };
  try {
    app = await startServer(options);
    const connection = db();
    try {
      await callback({ app, db: connection, folder, mailbox, async restart() { await app.close(); app = await startServer(options); return app; } });
    } finally { connection.close(); }
  } finally { await app?.close(); await rm(folder, { recursive: true, force: true }); }
}
const wallet = (app, cookie) => request(app, '/api/account/grain', { cookie });
const login = (app, email) => post(app, '/api/auth/sign-in/email', { email, password });

test('신규 가입 이메일 확인에만 30,000 지급·동시 확인과 재발송으로 중복 지급 불가', async () => scenario(async ({ app, db, mailbox }) => {
  const email = 'new-grain@example.test';
  assert.equal((await post(app, '/api/auth/sign-up/email', adult(email))).status, 200);
  const user = db.prepare('SELECT id FROM user WHERE email=?').get(email);
  assert.equal(db.prepare('SELECT eventId FROM grain_event_eligibility WHERE userId=?').get(user.id).eventId, SIGNUP_GRAIN_EVENT);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_signup_reservations').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_wallets').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 0);
  assert.equal((await login(app, email)).status, 403);
  assert.equal((await wallet(app)).status, 401);
  const old = tokenFrom(mailbox.at(-1));
  assert.equal((await post(app, '/api/auth/send-verification-email', { email })).status, 200);
  const token = tokenFrom(mailbox.at(-1));
  assert.equal((await post(app, '/api/account/verify-email', { token: old })).status, 400);
  db.prepare('UPDATE account_email_tokens SET expiresAt=0 WHERE userId=?').run(user.id);
  assert.equal((await post(app, '/api/account/verify-email', { token })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 0);
  await post(app, '/api/auth/send-verification-email', { email });
  const current = tokenFrom(mailbox.at(-1));
  const results = await Promise.all(Array.from({ length: 4 }, () => post(app, '/api/account/verify-email', { token: current })));
  assert.equal(results.filter(item => item.status === 200).length, 1);
  assert.ok(results.every(item => [200, 400].includes(item.status)));
  const cookie = cookieFrom(await login(app, email));
  const response = await wallet(app, cookie);
  assert.equal(response.status, 200); assert.equal(response.body.balance, SIGNUP_GRAIN_AMOUNT);
  assert.equal(response.body.entries.length, 1); assert.equal(response.body.entries[0].amount, 30000);
  assert.equal(response.body.entries[0].reason, '신규 가입 이벤트');
  assert.ok(Number.isFinite(Date.parse(response.body.entries[0].createdAt)));
  assert.equal(response.headers['cache-control'], 'no-store');
  // 재확인 가능한 정상 토큰을 강제로 준비해도 이벤트 UNIQUE가 지급을 한 번으로 제한합니다.
  db.prepare('INSERT INTO account_email_tokens(tokenHash,userId,expiresAt) VALUES(?,?,?)').run(tokenHash(current), user.id, Date.now() + 60000);
  assert.equal((await post(app, '/api/account/verify-email', { token: current })).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await wallet(app, cookie)).body.balance, 30000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 1);
  assert.equal((await login(app, email)).status, 200);
  assert.equal(db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(user.id).balance, 30000);
}));

test('지급 실패시 인증 상태·토큰·원장까지 롤백되어 같은 링크로 재시도 가능', async () => scenario(async ({ app, db, mailbox }) => {
  const email = 'rollback@example.test';
  await post(app, '/api/auth/sign-up/email', adult(email));
  const token = tokenFrom(mailbox.at(-1));
  const user = db.prepare('SELECT id FROM user WHERE email=?').get(email);
  db.exec("CREATE TRIGGER grain_test_failure BEFORE INSERT ON grain_wallets BEGIN SELECT RAISE(ABORT,'시험용 저장 실패'); END;");
  assert.equal((await post(app, '/api/account/verify-email', { token })).status, 500);
  assert.equal(db.prepare('SELECT emailVerified FROM user WHERE id=?').get(user.id).emailVerified, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account_email_tokens WHERE userId=?').get(user.id).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_wallets').get().n, 0);
  db.exec('DROP TRIGGER grain_test_failure;');
  assert.equal((await post(app, '/api/account/verify-email', { token })).status, 200);
  assert.equal(db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(user.id).balance, 30000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 1);
}));

test('기존 미확인·확인 회원은 재시작·메일 확인·조회 후에도 소급 지급하지 않음', async () => scenario(async ({ app, db, mailbox, restart }) => {
  // 신규 가입 경로를 거치지 않은 기존 DB의 회원 행을 재현합니다. 날짜는 미래여도 자격이 생기지 않습니다.
  const insert = db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,ageBand) VALUES(?,?,?, ?,?,?,?)');
  for (const [id, verified, ageBand] of [['legacy-unverified', 0, null], ['legacy-verified', 1, null], ['prior-unverified-adult', 0, '14plus']]) {
    insert.run(id, '기존회원', `${id}@example.test`, verified, Date.now() + 86400000, Date.now(), ageBand);
  }
  app = await restart();
  for (const id of ['legacy-unverified', 'prior-unverified-adult']) {
    assert.equal((await post(app, '/api/auth/send-verification-email', { email: `${id}@example.test` })).status, 200);
    assert.equal((await post(app, '/api/account/verify-email', { token: tokenFrom(mailbox.at(-1)) })).status, 200);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_event_eligibility').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_wallets').get().n, 0);
}));

test('기존 회원의 잔액 조회는 빈 지갑 응답만 반환하고 지급 상태를 만들지 않음', async () => scenario(async ({ app, db, mailbox, restart }) => {
  const email = 'old-wallet@example.test';
  const first = await registerAndLogin(app, mailbox, adult(email));
  const userId = first.body.user.id;
  // 가입·로그인 정보는 둔 채 기능 도입 전의 회원 DB 상태를 재현합니다.
  for (const table of ['grain_ledger', 'grain_wallets', 'grain_event_eligibility']) db.prepare(`DELETE FROM ${table} WHERE userId=?`).run(userId);
  db.prepare('UPDATE user SET ageBand=NULL,emailVerified=0 WHERE id=?').run(userId);
  app = await restart();
  const cookie = cookieFrom(await login(app, email));
  for (let i = 0; i < 2; i++) assert.deepEqual((await wallet(app, cookie)).body, { balance: 0, entries: [] });
  for (const table of ['grain_ledger', 'grain_wallets', 'grain_event_eligibility']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE userId=?`).get(userId).n, 0);
}));

test('본인만 지갑 조회·대상 및 금액 변조 거부·로그아웃 후 차단·재시작 영속', async () => scenario(async ({ app, db, mailbox, restart }) => {
  const first = await registerAndLogin(app, mailbox, adult('first@example.test'));
  const second = await registerAndLogin(app, mailbox, adult('second@example.test'));
  const firstCookie = cookieFrom(first), secondCookie = cookieFrom(second);
  const firstWallet = (await wallet(app, firstCookie)).body;
  const secondWallet = (await wallet(app, secondCookie)).body;
  assert.notEqual(firstWallet.entries[0].id, secondWallet.entries[0].id);
  assert.deepEqual((await request(app, '/api/account/grain', { cookie: firstCookie, headers: { 'x-user-id': second.body.user.id } })).body, firstWallet);
  for (const query of [`userId=${second.body.user.id}`, 'amount=9000000']) assert.equal((await request(app, `/api/account/grain?${query}`, { cookie: firstCookie })).status, 422);
  assert.equal((await post(app, '/api/account/grain', { userId: second.body.user.id, amount: 9000000 }, firstCookie)).status, 405);
  assert.equal((await post(app, '/api/auth/sign-up/email', { ...adult('injected@example.test'), grain: 9000000 })).status, 422);
  app = await restart();
  assert.deepEqual((await wallet(app, firstCookie)).body, firstWallet);
  assert.deepEqual((await wallet(app, secondCookie)).body, secondWallet);
  assert.equal((await post(app, '/api/auth/sign-out', {}, firstCookie)).status, 200);
  assert.equal((await wallet(app, firstCookie)).status, 401);
  assert.equal((await wallet(app)).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 2);
}));

async function approvedChild({ app, db, folder }, email) {
  const response = await post(app, '/api/account/guardian-requests', { guardianName: '그레인보호자', guardianEmail: 'guardian@example.test' });
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  const id = (await request(app, '/api/account/guardian-request', { cookie })).body.request.requestNumber;
  const evidencePath = join(folder, `${id}.eml`);
  await writeFile(evidencePath, `From: guardian@example.test\r\nSubject: 동의\r\n\r\n법정대리인으로서 개인정보 처리와 가입에 동의합니다. 신청 번호 ${id}`, { mode: 0o600 });
  await approveGuardianRequest(db, { id, dataDir: folder, evidencePath, confirmReply: true, confirmGuardian: true, confirmScope: true });
  assert.equal((await post(app, '/api/auth/sign-up/email', { ...adult(email), ageBand: 'under14' }, cookie)).status, 200);
  return { id, userId: db.prepare('SELECT id FROM user WHERE email=?').get(email).id };
}

test('승인된 어린이에게 같은 가입 보상·철회 후 조회·추가 확인 차단·삭제시 관련 기록 정리', async () => scenario(async context => {
  const { app, db, mailbox, folder } = context;
  const email = 'grain-child@example.test';
  const { id, userId } = await approvedChild(context, email);
  const token = tokenFrom(mailbox.findLast(mail => mail.to === email));
  assert.equal((await post(app, '/api/account/verify-email', { token })).status, 200);
  const cookie = cookieFrom(await login(app, email));
  assert.equal((await wallet(app, cookie)).body.balance, 30000);
  // 철회 시 세션 삭제가 누락되어도 활성 동의 확인이 조회를 차단합니다.
  db.prepare("UPDATE guardian_requests SET status='withdrawn' WHERE id=?").run(id);
  assert.equal((await wallet(app, cookie)).status, 401);
  db.prepare("UPDATE guardian_requests SET status='used' WHERE id=?").run(id);
  withdrawGuardian(db, id);
  db.prepare('INSERT INTO account_email_tokens(tokenHash,userId,expiresAt) VALUES(?,?,?)').run(tokenHash(token), userId, Date.now() + 60000);
  assert.equal((await post(app, '/api/account/verify-email', { token })).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger WHERE userId=?').get(userId).n, 1);
  await deleteGuardianChild(db, { id, dataDir: folder, confirmParentRequest: true, confirmDeletion: true });
  for (const table of ['grain_ledger', 'grain_wallets', 'grain_event_eligibility']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE userId=?`).get(userId).n, 0);
}));

test('이메일 확인 전 동의가 철회된 어린이에게는 보상 지급하지 않음', async () => scenario(async context => {
  const { app, db, mailbox } = context;
  const email = 'withdraw-before-verify@example.test';
  const { id, userId } = await approvedChild(context, email);
  const token = tokenFrom(mailbox.findLast(mail => mail.to === email));
  withdrawGuardian(db, id);
  assert.equal((await post(app, '/api/account/verify-email', { token })).status, 403);
  assert.equal(db.prepare('SELECT emailVerified FROM user WHERE id=?').get(userId).emailVerified, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_wallets').get().n, 0);
}));

test('가입 메일 전송 실패 뒤 재발송해도 신규 보상 자격을 잃지 않음', async () => {
  let rejectMail = true;
  const delivered = [];
  await scenario(async ({ app, db }) => {
    const email = 'retry-delivery@example.test';
    assert.equal((await post(app, '/api/auth/sign-up/email', adult(email))).status, 503);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_event_eligibility').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_signup_reservations').get().n, 0);
    rejectMail = false;
    assert.equal((await post(app, '/api/auth/send-verification-email', { email })).status, 200);
    assert.equal((await post(app, '/api/account/verify-email', { token: tokenFrom(delivered.at(-1)) })).status, 200);
    assert.equal((await wallet(app, cookieFrom(await login(app, email)))).body.balance, 30000);
  }, { mailer: async message => { if (rejectMail) throw new Error('시험용 발송 실패'); delivered.push(message); } });
});
