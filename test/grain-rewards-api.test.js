import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { request, cookieFrom, registerAndLogin } from './account-helpers.js';
import { GRAIN_REWARD_POLICY } from '../server/grain-policy.js';

let nextIP = 100;
async function scenario(callback, extra = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'grain-rewards-api-')), mailbox = [];
  let time = Date.parse('2026-10-17T14:59:59.999Z'), app, db;
  const headers = { 'fly-client-ip': `198.51.100.${nextIP++}` };
  const options = { port: 0, dataDir: folder, now: () => time, grainRewardsStartTimer: false,
    mailer: async mail => mailbox.push(mail), trustFlyProxy: true, flyAppName: 'gracekin-games-community',
    rateLimit: { authMax: 100, writeMax: 200, readMax: 500 }, ...extra };
  try {
    app = await startServer(options);
    db = new DatabaseSync(join(folder, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON');
    await callback({ get app() { return app; }, db,
      async login(suffix = '') {
        return registerAndLogin(app, mailbox, { name: '보상시험회원', email: `reward${suffix}@example.test`, password: '보상시험-비밀번호-1234', ageBand: '14plus' }, headers);
      },
      req: (path, options = {}) => request(app, path, { ...options, headers: { ...headers, ...options.headers } }),
      setTime(value) { time = value; }, time: () => time,
      async restart() { const port = app.port; await app.close(); app = await startServer({ ...options, port }); },
    });
  } finally { db?.close(); await app?.close(); await rm(folder, { recursive: true, force: true }); }
}
const attendance = (f, cookie, extra = {}) => f.req('/api/grain/attendance', { method: 'POST', cookie, body: {}, ...extra });
const post = (f, cookie, title = '활동 보상 글', body = '가'.repeat(30)) => f.req('/api/community/posts', { method: 'POST', cookie, body: { game: 'slimeline', board: 'free', title, body } });
const wallet = (f, cookie) => f.req('/api/account/grain', { cookie });

test('공개 설정은 비로그인·로그인 모두 같은 정책만 제공하고 세션·지갑·예정 보상을 바꾸지 않음', async () => scenario(async f => {
  const login = await f.login(), cookie = cookieFrom(login);
  await post(f, cookie);
  f.db.prepare('UPDATE session SET expiresAt=?,updatedAt=?').run(Date.now() + 5 * 86400000, Date.now() - 2 * 86400000);
  f.setTime(f.time() + GRAIN_REWARD_POLICY.activity.confirmationDelayMs);
  const snapshot = () => f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, f.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
  const before = snapshot();
  for (const viewer of [undefined, cookie, 'invalid-session=invalid']) {
    const config = await f.req('/api/account/config', { cookie: viewer });
    assert.equal(config.status, 200);
    assert.deepEqual(config.body.grainRewardPolicy, GRAIN_REWARD_POLICY);
    assert.equal(config.body.registrationAvailable, true);
    assert.equal(config.body.emailAvailable, true);
    assert.equal(config.headers['set-cookie'], undefined);
    assert.match(config.headers['cache-control'], /no-store/);
    assert.deepEqual(Object.keys(config.body).sort(), ['emailAvailable', 'grainRewardPolicy', 'guardianConsentAvailable', 'guardianConsentMethod', 'registrationAvailable', 'socialProviders', 'socialSignupAvailable']);
    assert.doesNotMatch(JSON.stringify(config.body), /@example\.test|"(?:user|email|balance|entries|pending|adminUserIds)"/);
  }
  assert.deepEqual(snapshot(), before);
  assert.equal((await f.req('/api/account/config', { method: 'POST', body: {} })).status, 405);
  assert.deepEqual(snapshot(), before);
}));

test('공개 정책의 출석·본문 길이·횟수·지급량·확정 지연은 실제 HTTP 적립과 일치', async () => scenario(async f => {
  const policy = (await f.req('/api/account/config')).body.grainRewardPolicy.activity;
  const alice = cookieFrom(await f.login('alice')), bob = cookieFrom(await f.login('bob'));
  assert.equal((await attendance(f, alice)).body.amount, policy.attendance.amount);
  assert.equal((await attendance(f, alice)).body.awarded, false);
  assert.equal((await post(f, alice, '최소 길이 직전', '가'.repeat(policy.post.minBodyLength - 1))).body.reward.pending, false);
  for (let i = 0; i <= policy.post.dailyLimit; i++) {
    const result = await post(f, alice, `정책 글 ${i}`, '가'.repeat(policy.post.minBodyLength));
    assert.deepEqual(result.body.reward, { pending: i < policy.post.dailyLimit, amount: i < policy.post.dailyLimit ? policy.post.amount : 0 });
  }
  // 댓글 길이 미달 첫 댓글은 재작성으로 보상받을 수 없으므로 별도 부모 글을 사용합니다.
  for (let i = -1; i <= policy.comment.dailyLimit; i++) {
    const parent = (await post(f, bob, `댓글 부모 ${i}`, '짧은 본문')).body.post.id;
    const result = await f.req(`/api/community/posts/${parent}/comments`, { method: 'POST', cookie: alice, body: { body: '나'.repeat(policy.comment.minBodyLength - (i === -1 ? 1 : 0)) } });
    const eligible = i >= 0 && i < policy.comment.dailyLimit;
    assert.deepEqual(result.body.reward, { pending: eligible, amount: eligible ? policy.comment.amount : 0 });
  }
  const pending = (await wallet(f, alice)).body;
  assert.equal(pending.pendingTotal, policy.post.amount * policy.post.dailyLimit + policy.comment.amount * policy.comment.dailyLimit);
  assert.equal(pending.balance, 30000 + policy.attendance.amount);
  assert.ok(pending.pending.every(row => Date.parse(row.confirmsAt) - Date.parse(row.createdAt) === policy.confirmationDelayMs));
  // 합계 한도는 활동 종류별 횟수와 별개로 출석도 차단해야 합니다.
  f.db.prepare("INSERT INTO grain_activity_rewards VALUES('정책한도',?,'post','없는글',NULL,NULL,?,'2026-10-17',0,0,'confirmed')").run(f.db.prepare('SELECT id FROM user WHERE email=?').get('rewardbob@example.test').id, policy.dailyTotalLimit - policy.attendance.amount + 1);
  assert.equal((await attendance(f, bob)).body.awarded, false);
  f.setTime(f.time() + policy.confirmationDelayMs); await f.restart();
  assert.equal((await wallet(f, alice)).body.balance, pending.balance + pending.pendingTotal);
}));

// 별도 운영 모듈과 app의 연결까지 검증하는 실제 HTTP 시험입니다.
test('출석 HTTP: 로그인·Origin·본문변조 방어와 동시 KST 출석, 계정 GET 무지급·무갱신', async () => scenario(async f => {
  assert.equal((await attendance(f)).status, 401);
  assert.equal((await f.req('/api/grain/attendance')).status, 405);
  const login = await f.login(), cookie = cookieFrom(login), id = login.body.user.id;
  assert.equal((await attendance(f, cookie, { origin: 'https://outside.example' })).status, 403);
  assert.equal((await attendance(f, cookie, { body: { amount: 9000 } })).status, 422);
  assert.equal((await f.req('/api/grain/attendance?date=2026-10-18', { method: 'POST', cookie, body: {} })).status, 422);
  const before = (await wallet(f, cookie)).body;
  assert.equal(before.balance, 30000); assert.equal(before.pendingTotal, 0); assert.equal(before.rewardEligibility, 'eligible');
  f.db.prepare('UPDATE session SET expiresAt=?,updatedAt=? WHERE userId=?').run(Date.now() + 5 * 86400000, Date.now() - 2 * 86400000, id);
  const sessionBefore = f.db.prepare('SELECT expiresAt,updatedAt FROM session WHERE userId=?').get(id);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual((await wallet(f, cookie)).body, before);
    assert.equal((await f.req('/api/community/session', { cookie })).body.user.id, id);
  }
  assert.deepEqual(f.db.prepare('SELECT expiresAt,updatedAt FROM session WHERE userId=?').get(id), sessionBefore);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grain_activity_rewards').get().n, 0);
  const results = await Promise.all(Array.from({ length: 5 }, () => attendance(f, cookie)));
  assert.ok(results.every(row => row.status === 200));
  assert.equal(results.filter(row => row.body.awarded).length, 1);
  assert.equal((await wallet(f, cookie)).body.balance, 30300);
  f.setTime(f.time() + 1); assert.equal((await attendance(f, cookie)).body.date, '2026-10-18');
  assert.equal((await wallet(f, cookie)).body.balance, 30600);
}));

test('커뮤니티 HTTP: 생성 예정 안내·계정 예정 목록·재시작 시 24시간 확정·세션 응답 호환', async () => scenario(async f => {
  const login = await f.login(), cookie = cookieFrom(login), id = login.body.user.id;
  const response = await post(f, cookie);
  assert.equal(response.status, 201); assert.deepEqual(response.body.reward, { pending: true, amount: 500 });
  const pending = (await wallet(f, cookie)).body;
  assert.equal(pending.balance, 30000); assert.equal(pending.pendingTotal, 500);
  assert.deepEqual(Object.keys(pending.pending[0]).sort(), ['amount','confirmsAt','createdAt','eventId','targetId','targetType']);
  assert.equal(pending.pending[0].eventId, `community-post:${response.body.post.id}`);
  const session = (await f.req('/api/community/session', { cookie })).body.user;
  assert.deepEqual(Object.keys(session).sort(), ['canWriteCommunity','id','isOperator','name']); assert.equal(session.id, id);
  f.setTime(f.time() + 86400000); await f.restart();
  const confirmed = (await wallet(f, cookie)).body;
  assert.equal(confirmed.pendingTotal, 0); assert.equal(confirmed.balance, 30500);
  await f.restart(); assert.equal((await wallet(f, cookie)).body.balance, 30500);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM grain_ledger WHERE eventId LIKE 'community-post:%'").get().n, 1);
}));

test('보상정지 HTTP: 예정 취소·출석 거절·레이스 eligibility 거절·무료 경제 불변', async () => scenario(async f => {
  const login = await f.login(), cookie = cookieFrom(login), userId = login.body.user.id;
  await post(f, cookie);
  f.db.prepare('INSERT INTO grain_reward_suspensions(userId,reason,createdAt) VALUES(?,?,?)').run(userId, '운영 확인', f.time());
  const grain = (await wallet(f, cookie)).body;
  assert.equal(grain.pendingTotal, 0); assert.equal(grain.rewardEligibility, 'suspended');
  assert.equal((await attendance(f, cookie)).status, 403);
  const me = (await f.req('/api/slime-race/me', { cookie })).body;
  assert.equal(me.eligibility.canBet, false); assert.equal(me.eligibility.code, 'GRAIN_REWARD_SUSPENDED');
  const state = (await f.req('/api/slime-race/state')).body;
  assert.ok(Object.entries(state.economy).filter(([key]) => key !== 'mode').every(([, value]) => value === false));
  assert.equal((await f.req('/api/slime-race/tickets', { method: 'POST', cookie, body: {} })).status, 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 1);
}, { slimeRaceAdultVerifier: () => true }));

test('신고 HTTP 접수·중복·본인금지·숨김 404와 댓글수 비노출', async () => scenario(async f => {
  const alice = cookieFrom(await f.login('alice')), bob = cookieFrom(await f.login('bob'));
  const id = (await post(f, alice)).body.post.id;
  const report = cookie => f.req('/api/community/reports', { method: 'POST', cookie, body: { targetType: 'post', targetId: id, reason: '계정·그레인 거래', description: '거래 제안 확인' } });
  assert.equal((await report(alice)).status, 403);
  assert.equal((await report(bob)).status, 201); assert.equal((await report(bob)).status, 409);
  const comment = await f.req(`/api/community/posts/${id}/comments`, { method: 'POST', cookie: bob, body: { body: '댓글 내용 열 글자 이상입니다.' } });
  f.db.prepare('UPDATE community_comments SET hiddenAt=? WHERE id=?').run(f.time(), comment.body.comment.id);
  const detail = (await f.req(`/api/community/posts/${id}?game=slimeline`)).body;
  assert.equal(detail.post.commentCount, 0); assert.equal(detail.comments.length, 0);
  f.db.prepare('UPDATE community_posts SET hiddenAt=? WHERE id=?').run(f.time(), id);
  assert.equal((await f.req(`/api/community/posts/${id}?game=slimeline`, { cookie: alice })).status, 404);
  assert.equal((await f.req('/api/community/posts?game=slimeline')).body.total, 0);
}));
