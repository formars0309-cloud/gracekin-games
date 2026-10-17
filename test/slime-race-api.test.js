import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { request, cookieFrom, registerAndLogin } from './account-helpers.js';

async function scenario(callback, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-race-')), mailbox = [];
  let app, db, time = Math.floor(Date.now() / 600000) * 600000;
  try {
    app = await startServer({ port: 0, dataDir: folder, mailer: async mail => mailbox.push(mail), now: () => time, rateLimit: { authMax: 100, readMax: 1000, writeMax: 1000 }, ...options });
    db = new DatabaseSync(join(folder, 'community.sqlite'));
    await callback({ app, db, mailbox, folder, setTime: value => { time = value; }, getTime: () => time });
  } finally { db?.close(); await app?.close(); await rm(folder, { recursive: true, force: true }); }
}
const signup = (app, mailbox, suffix = '') => registerAndLogin(app, mailbox, { email: `race${suffix}@example.test`, name: '경주시험회원', password: '경주시험-비밀번호-1234', ageBand: '14plus' });
const state = async app => (await request(app, '/api/slime-race/state')).body;
const me = (app, cookie, headers) => request(app, '/api/slime-race/me', { cookie, headers });
const ticket = async (app, cookie, requestId, amount = 100, overrides = {}, origin) => {
  const current = await state(app), personal = (await me(app, cookie)).body;
  return request(app, '/api/slime-race/tickets', { method: 'POST', cookie, origin, body: { roundId: current.round.id, slimeId: current.round.entrants[0].slimeId, amount, expectedRevision: personal.revision, requestId, ...overrides } });
};

test('게스트·성인 미검증·이메일 미검증 회원은 관람만, 기존 14plus는 성인 아님', async () => scenario(async ({ app, mailbox, db }) => {
  const guest = await me(app);
  assert.equal(guest.status, 200); assert.equal(guest.body.user, null);
  assert.equal(guest.body.eligibility.code, 'LOGIN_REQUIRED');
  assert.equal((await request(app, '/api/slime-race/history')).status, 401);
  assert.equal((await ticket(app, undefined, 'guest-request-00000001')).status, 401);
  const login = await signup(app, mailbox), cookie = cookieFrom(login);
  const personal = await me(app, cookie);
  assert.equal(personal.body.wallet.balance, 30000);
  assert.equal(personal.body.eligibility.code, 'ADULT_VERIFICATION_UNAVAILABLE');
  assert.equal((await ticket(app, cookie, 'locked-request-0000001')).status, 403);
  db.prepare('UPDATE user SET emailVerified=0 WHERE id=?').run(login.body.user.id);
  assert.equal((await me(app, cookie)).body.eligibility.code, 'EMAIL_NOT_VERIFIED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 1);
}));

test('정확한 홈페이지 CORS·OPTIONS만 허용, 원본 인증과 Host 경계 유지', async () => scenario(async ({ app }) => {
  for (const origin of ['https://gracekingames.com', 'https://www.gracekingames.com']) {
    const visible = await request(app, '/api/slime-race/state', { headers: { origin } });
    assert.equal(visible.status, 200); assert.equal(visible.headers['access-control-allow-origin'], origin);
    assert.equal(visible.headers['access-control-allow-credentials'], 'true');
    assert.equal(visible.headers.vary, 'Origin'); assert.equal(visible.headers['cache-control'], 'no-store');
    const preflight = await request(app, '/api/slime-race/tickets', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers['access-control-allow-methods'], 'POST');
    assert.equal((await request(app, '/api/auth/sign-out', { method: 'POST', body: {}, origin })).status, 403);
    const badHeaders = await request(app, '/api/slime-race/tickets', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' } });
    assert.equal(badHeaders.status, 403);
  }
  for (const origin of ['null', 'https://outside.test', 'http://gracekingames.com', 'https://gracekingames.com:444', 'https://gracekingames.com.evil.test', 'https://gracekingames.com/']) {
    for (const method of ['GET', 'OPTIONS', 'POST']) {
      const result = await request(app, '/api/slime-race/state', { method, headers: { origin } });
      assert.equal(result.status, 403); assert.equal(result.headers['access-control-allow-origin'], undefined);
    }
  }
  assert.equal((await request(app, '/api/slime-race/state', { headers: { host: 'outside.test' } })).status, 403);
  assert.equal((await request(app, '/api/slime-race/state', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await request(app, '/api/slime-race/state?userId=other')).status, 422);
  assert.equal((await request(app, '/api/slime-race/state', { method: 'POST', body: {} })).status, 405);
  assert.equal((await request(app, '/api/slime-race/tickets', { method: 'POST', body: {}, headers: { origin: '' } })).status, 403);
}));

test('성인 어댑터 허용 계정의 동시 개정 충돌·동일 요청 멱등·개인정보·시간 경계', async () => scenario(async ({ app, mailbox, db, setTime, getTime }) => {
  const login = await signup(app, mailbox), cookie = cookieFrom(login), userId = login.body.user.id;
  const initial = await state(app), slimeId = initial.round.entrants[0].slimeId;
  const body = { roundId: initial.round.id, slimeId, amount: 1000, expectedRevision: 0, requestId: 'concurrent-000000000001' };
  const send = payload => request(app, '/api/slime-race/tickets', { method: 'POST', cookie, origin: 'https://gracekingames.com', body: payload });
  const concurrent = await Promise.all([send(body), send({ ...body, requestId: 'concurrent-000000000002' })]);
  assert.deepEqual(concurrent.map(row => row.status).sort(), [200, 409]);
  const saved = concurrent.find(row => row.status === 200).body;
  assert.equal(saved.wallet.balance, 29000);
  // 동시에 보낸 두 요청 중 먼저 처리된 요청을 재전송합니다. HTTP 도착 순서는 고정하지 않습니다.
  const accepted = concurrent[0].status === 200 ? body : { ...body, requestId: 'concurrent-000000000002' };
  const replay = await Promise.all([send(accepted), send(accepted)]);
  assert.ok(replay.every(row => row.status === 200));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM grain_ledger WHERE eventId LIKE 'slime-race:ticket:%'").get().n, 1);
  assert.equal((await send({ ...accepted, amount: 1100 })).body.error.code, 'IDEMPOTENCY_CONFLICT');
  const age = 86400000;
  db.prepare('UPDATE session SET expiresAt=?,updatedAt=? WHERE userId=?').run(Date.now() + 5 * age, Date.now() - 2 * age, userId);
  const before = db.prepare('SELECT expiresAt,updatedAt FROM session WHERE userId=?').get(userId);
  const personal = await me(app, cookie, { origin: 'https://gracekingames.com' });
  assert.equal(personal.body.user.id, userId); assert.equal(personal.headers['set-cookie'], undefined);
  assert.deepEqual(db.prepare('SELECT expiresAt,updatedAt FROM session WHERE userId=?').get(userId), before);
  db.prepare('UPDATE user SET ageBand=? WHERE id=?').run('under14', userId);
  assert.equal((await me(app, cookie)).body.user, null);
  assert.equal((await send({ ...body, amount: 0, expectedRevision: 1, requestId: 'blocked-child-0000001' })).status, 401);
  db.prepare('UPDATE user SET ageBand=? WHERE id=?').run('14plus', userId);
  const other = await signup(app, mailbox, '-other'), otherCookie = cookieFrom(other);
  assert.deepEqual((await me(app, otherCookie)).body.bets, []);
  assert.deepEqual((await request(app, '/api/slime-race/history', { cookie: otherCookie })).body.rounds, []);
  assert.doesNotMatch(JSON.stringify(await state(app)), /userId|email|totalBet|participants|winnerId|animationSeed/);
  const start = getTime(); setTime(start + 500000);
  const closed = await send({ ...body, amount: 0, expectedRevision: 1, requestId: 'closed-request-0000001' });
  assert.equal(closed.body.error.code, 'SALES_CLOSED');
  setTime(start + 570000);
  const result = await state(app); assert.ok(result.round.winnerId); assert.equal(result.round.finishOrder.length, 5);
  const history = await request(app, '/api/slime-race/history', { cookie });
  assert.equal(history.body.rounds.length, 1); assert.equal(typeof history.body.summary.profit, 'string');
  assert.equal((await request(app, '/api/slime-race/tickets', { method: 'POST', cookie, body, headers: { 'content-type': 'text/plain' } })).status, 415);
}, { slimeRaceAdultVerifier: () => true }));

test('실제 주기 타이머는 요청 없이도 다음 회차를 저장', async () => scenario(async ({ db, setTime, getTime }) => {
  const start = getTime(); setTime(start + 600000);
  await new Promise(resolve => setTimeout(resolve, 1150));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM slime_race_rounds').get().n, 2);
  assert.ok(db.prepare('SELECT settledAt FROM slime_race_rounds WHERE startsAt=?').get(start).settledAt);
}));

test('경주 요청 속도 제한은 CORS 오류에도 유지', async () => scenario(async ({ app }) => {
  const headers = { origin: 'https://gracekingames.com' };
  assert.equal((await request(app, '/api/slime-race/state', { headers })).status, 200);
  const limited = await request(app, '/api/slime-race/state', { headers });
  assert.equal(limited.status, 429); assert.equal(limited.headers['access-control-allow-origin'], headers.origin);
}, { rateLimit: { readMax: 1 } }));


const economySnapshot = db => JSON.stringify({
  wallets: db.prepare('SELECT * FROM grain_wallets ORDER BY userId').all(),
  ledger: db.prepare('SELECT * FROM grain_ledger ORDER BY id').all(),
  tickets: db.prepare('SELECT * FROM slime_race_tickets ORDER BY userId,roundId,slimeId').all(),
  revisions: db.prepare('SELECT * FROM slime_race_revisions ORDER BY userId,roundId').all(),
  requests: db.prepare('SELECT * FROM slime_race_requests ORDER BY userId,requestId').all(),
  users: db.prepare('SELECT id,emailVerified,ageBand FROM user ORDER BY id').all(),
});

test('무료 그레인 정책은 공개되며 현금·유료재화·상품 교환·양도 경로와 임의 티켓 필드를 받지 않음', async () => scenario(async ({ app, mailbox, db }) => {
  const login = await signup(app, mailbox), cookie = cookieFrom(login);
  const current = await state(app);
  assert.deepEqual(current.economy, { mode: 'free-only', purchasable: false, cashRedeemable: false, itemExchangeAllowed: false, transferable: false, paidCurrencyConvertible: false });
  const before = economySnapshot(db);
  for (const path of [
    '/api/account/grain/purchase', '/api/account/grain/charge', '/api/account/grain/redeem',
    '/api/account/grain/exchange', '/api/account/grain/transfer', '/api/grain/convert',
    '/api/slime-race/purchase', '/api/slime-race/redeem', '/api/slime-race/exchange', '/api/slime-race/transfer',
  ]) {
    const result = await request(app, path, { method: 'POST', cookie, body: { amount: 1000, userId: login.body.user.id, currency: 'KRW', recipientId: 'other', itemId: 'coupon' } });
    assert.equal(result.status, 404, path);
  }
  assert.equal((await request(app, '/api/account/grain', { method: 'POST', cookie, body: { amount: 1000, payment: 'cash' } })).status, 405);
  for (const [key, value] of Object.entries({
    userId: 'other', recipientId: 'other', price: 100, payment: 'cash', currency: 'KRW',
    exchangeTo: 'paid-currency', itemId: 'coupon', economy: { mode: 'paid' },
    cashRedeemable: true, balance: 1000000, oddsCents: 9500, payout: 95000,
    adultVerified: true, eligibility: { canBet: true },
  })) {
    const response = await ticket(app, cookie, `extra-field-${key.padEnd(16, '0')}`, 100, { [key]: value });
    assert.equal(response.status, 422, key);
    assert.equal(response.body.error.code, 'INVALID_INPUT', key);
  }
  for (const query of ['economy=paid', 'cashRedeemable=true', 'adultVerified=true']) {
    assert.equal((await request(app, `/api/slime-race/state?${query}`, { cookie })).status, 422);
    assert.equal((await request(app, `/api/account/grain?${query}`, { cookie })).status, 422);
  }
  assert.equal(economySnapshot(db), before);
}, { slimeRaceAdultVerifier: () => true }));

test('무료 그레인·요청 본문·헤더의 성인 자격 주장은 기본 구매 잠금을 해제하지 않음', async () => scenario(async ({ app, mailbox, db }) => {
  const login = await signup(app, mailbox), cookie = cookieFrom(login);
  const current = await state(app), before = economySnapshot(db);
  const result = await request(app, '/api/slime-race/tickets', {
    method: 'POST', cookie, headers: { 'x-adult-verified': 'true', 'x-grain-mode': 'free-only' },
    body: { roundId: current.round.id, slimeId: current.round.entrants[0].slimeId,
      amount: 100, expectedRevision: 0, requestId: 'forged-adult-00000001', adultVerified: true, canBet: true },
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'ADULT_VERIFICATION_UNAVAILABLE');
  assert.equal((await me(app, cookie)).body.eligibility.canBet, false);
  assert.equal(economySnapshot(db), before);
}));
