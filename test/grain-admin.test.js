import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { toNodeHandler } from 'better-auth/node';
import { createGrainService, GRAIN_ECONOMY } from '../server/grain.js';
import { createGrainAdmin } from '../server/grain-admin.js';
import { initializeGuardian } from '../server/guardian.js';
import { errorResponse, fail, json } from '../server/security.js';
import { request, cookieFrom } from './account-helpers.js';

// 병렬 구현 중에는 핵심 작업자의 읽기 전용 모듈을 지정할 수 있습니다. 통합 뒤에는 저장소 정본을 씁니다.
const coreRoot = process.env.GRAIN_CORE_TEST_ROOT ? pathToFileURL(`${process.env.GRAIN_CORE_TEST_ROOT}/`) : new URL('../', import.meta.url);
const { createGrainRewards } = await import(new URL('server/grain-rewards.js', coreRoot));
const { initializeCommunitySchema, createCommunity } = await import(new URL('server/community.js', coreRoot));
const { HttpError: CoreHttpError, errorResponse: coreErrorResponse } = await import(new URL('server/security.js', coreRoot));
const reason = '정책에 따른 운영자 검토';
const bugBody = { game: 'site', title: '비공개 보안 제보', body: '공개하면 안 되는 원본 재현 내용입니다.', steps: '비밀 재현 단계입니다.', url: 'https://example.test/problem' };
const ownFields = ['createdAt', 'grade', 'id', 'status', 'updatedAt'];

async function scenario(work) {
  const directory = await mkdtemp(join(tmpdir(), 'grain-admin-test-'));
  const db = new DatabaseSync(join(directory, 'isolated.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  let service, rewards, community, auth, handler;
  const server = createServer((req, res) => handler(req, res));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const app = { server, port: server.address().port, origin: `http://127.0.0.1:${server.address().port}` };
    auth = betterAuth({ database: db, baseURL: app.origin, secret: randomBytes(48).toString('base64url'),
      telemetry: { enabled: false }, logger: { disabled: true }, rateLimit: { enabled: false },
      emailAndPassword: { enabled: true }, user: { additionalFields: { ageBand: { type: 'string', input: true } } },
      session: { cookieCache: { enabled: false }, updateAge: 86400 },
    });
    await (await getMigrations(auth.options)).runMigrations();
    let clock = Date.parse('2026-10-17T14:59:00.000Z');
    const now = () => clock;
    handler = toNodeHandler(async req => {
      try {
        const url = new URL(req.url);
        if (['POST', 'PATCH', 'DELETE'].includes(req.method) && req.headers.get('origin') !== app.origin) fail(403, 'ORIGIN_FORBIDDEN', '같은 홈페이지에서 요청해 주세요.');
        if (url.pathname.startsWith('/api/auth/')) return await auth.handler(req);
        return await service?.handle(req, url) ?? await community?.(req, url) ?? json({ error: '없음' }, 404);
      } catch (error) { return error instanceof CoreHttpError ? coreErrorResponse(error) : errorResponse(error); }
    });
    const users = {};
    for (const [key, verified] of [['admin', true], ['alice', true], ['bob', true], ['unverified', false], ['child', true]]) {
      const email = `${key}@example.test`, name = `시험회원-${key}`;
      const signup = await request(app, '/api/auth/sign-up/email', { method: 'POST', body: { email, name, ageBand: '14plus', password: '운영자시험전용-1234' } });
      assert.equal(signup.status, 200, signup.text);
      const user = db.prepare('SELECT * FROM user WHERE email=?').get(email);
      db.prepare('UPDATE user SET emailVerified=? WHERE id=?').run(verified ? 1 : 0, user.id);
      users[key] = { ...user, emailVerified: verified, cookie: cookieFrom(signup) };
      assert.ok(users[key].cookie);
    }
    initializeGuardian(db);
    initializeCommunitySchema(db);
    createGrainService(db, { now });
    rewards = createGrainRewards(db, { now, startTimer: false });
    service = createGrainAdmin(db, auth, { rewards, now, adminUserIds: `  ${users.admin.id}, ` });
    community = createCommunity(db, auth, { rewards, now, isAdmin: service.isAdmin });
    db.prepare("UPDATE user SET ageBand='under14' WHERE id=?").run(users.child.id);
    db.prepare(`INSERT INTO guardian_requests(id,capabilityHash,status,createdAt,expiresAt,consentVersion,consentText,childUserId)
      VALUES(?,?,'used',?,?,?, ?,?)`).run(randomUUID(), randomUUID(), clock, clock + 86400000, '시험', '시험 동의', users.child.id);
    const api = (path, body, actor = 'admin', method = body === undefined ? 'GET' : 'POST') => request(app, path, { method, body, cookie: users[actor]?.cookie });
    const post = (author = 'alice', title = randomUUID()) => api('/api/community/posts', { game: 'slimeline', board: 'free', title, body: '커뮤니티 활동 보상 대상인 본문입니다. '.repeat(4) }, author);
    const submit = async (actor = 'alice', body = bugBody) => {
      const response = await api('/api/community/bug-reports', body, actor);
      assert.equal(response.status, 201, response.text);
      return response.body.report;
    };
    await work({ db, app, users, auth, rewards, api, post, submit, service, now, setTime(value) { clock = value; }, resetAdmins(value) { service = createGrainAdmin(db, auth, { rewards, now, adminUserIds: value }); } });
  } finally {
    rewards?.close();
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const count = (db, table, where = '', ...args) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...args).n;
const balance = (db, userId) => db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(userId)?.balance ?? 0;
const noEmail = body => assert.doesNotMatch(JSON.stringify(body), /"email"\s*:|@example\.test/);
const accept = (api, id, grade = 'normal') => api(`/api/admin/bug-reports/${id}`, { status: '채택', grade, reason });
const event = (api, now, values = {}) => api('/api/admin/events', { slug: 'test-event', title: '검증 이벤트', amount: 700, startsAt: now() - 1, endsAt: now() + 86400000, reason, ...values });

test('운영 경로 전체는 비회원·비운영자·미확인·비활성·빈 설정을 403 처리', async () => scenario(async ({ api, db, users, service, resetAdmins }) => {
  for (const actor of ['guest', 'alice']) {
    for (const [path, body] of [['session'], ['reports'], ['hidden'], ['events'], ['bug-reports'], ['users?q=회원'], ['unknown'], ['content', {}], [`users/${users.alice.id}/suspension`, {}]]) {
      const response = await api(`/api/admin/${encodeURI(path)}`, body, actor);
      assert.equal(response.status, 403, `${actor} ${path}`);
    }
  }
  assert.deepEqual((await api('/api/admin/session')).body, { admin: true });
  assert.equal(service.isAdmin({ ...users.alice, id: 'missing' }), false);
  db.prepare('UPDATE user SET emailVerified=0 WHERE id=?').run(users.admin.id);
  assert.equal((await api('/api/admin/session')).status, 403);
  assert.equal(service.isAdmin(users.admin), false);
  db.prepare("UPDATE user SET emailVerified=1,ageBand='under14' WHERE id=?").run(users.admin.id);
  assert.equal((await api('/api/admin/session')).status, 403);
  db.prepare("UPDATE user SET ageBand='14plus' WHERE id=?").run(users.admin.id);
  resetAdmins(' ,  ');
  assert.equal((await api('/api/admin/session')).status, 403);
}));

test('GET 조회는 감사·세션·원장·지갑을 포함한 DB를 바꾸지 않음', async () => scenario(async ({ api, db, users }) => {
  db.prepare('UPDATE session SET updatedAt=?').run(Date.now() - 3 * 86400000);
  const snapshot = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
  const before = snapshot();
  for (const path of ['/api/admin/session', '/api/admin/reports', '/api/admin/hidden', '/api/admin/events', '/api/admin/bug-reports', `/api/admin/users?q=${encodeURIComponent(users.alice.name)}`, '/api/community/known-issues', '/api/community/bug-reports']) assert.equal((await api(path)).status, 200, path);
  assert.deepEqual(snapshot(), before);
}));

test('버그 제보는 본인 상태만 조회하고 타인 상세·쿼리·위조 필드는 차단', async () => scenario(async ({ api, submit, users }) => {
  assert.equal((await api('/api/community/bug-reports', undefined, 'guest')).status, 401);
  const report = await submit();
  assert.deepEqual(Object.keys(report).sort(), ownFields);
  assert.deepEqual((await api('/api/community/bug-reports', undefined, 'bob')).body, { reports: [] });
  const own = await api('/api/community/bug-reports', undefined, 'alice');
  assert.equal(own.body.reports[0].id, report.id);
  assert.doesNotMatch(own.text, /원본|재현|title|userId/);
  assert.equal((await api(`/api/community/bug-reports?userId=${users.alice.id}`, undefined, 'bob')).status, 422);
  assert.equal((await api(`/api/community/bug-reports/${report.id}`, undefined, 'bob')).status, 404);
  const admin = await api('/api/admin/bug-reports');
  assert.equal(admin.body.reports[0].body, bugBody.body);
  assert.equal(admin.body.reports[0].user.id, users.alice.id); noEmail(admin.body);
  assert.equal((await api('/api/community/bug-reports', { ...bugBody, userId: users.bob.id }, 'alice')).status, 422);
}));

test('제보 입력 길이·게임·URL 검증과 KST 하루 5건 동시 제한', async () => scenario(async ({ api, now, setTime, submit, db, users }) => {
  for (const body of [{ ...bugBody, game: 'other' }, { ...bugBody, title: '가' }, { ...bugBody, title: '가'.repeat(101) }, { ...bugBody, body: '짧음' }, { ...bugBody, body: '가'.repeat(5001) }, { ...bugBody, steps: '가'.repeat(3001) }, { ...bugBody, url: 'javascript:alert(1)' }, { ...bugBody, url: 'https://user:pass@example.test/' }, { ...bugBody, url: '아무 주소' }]) assert.equal((await api('/api/community/bug-reports', body, 'alice')).status, 422);
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => api('/api/community/bug-reports', bugBody, 'alice')));
  assert.equal(concurrent.filter(row => row.status === 201).length, 5);
  assert.equal(concurrent.filter(row => row.status === 429).length, 3);
  assert.equal(count(db, 'grain_bug_reports'), 5);
  setTime(now() + 60000);
  await submit();
  assert.equal(count(db, 'grain_bug_reports'), 6);
  db.prepare("UPDATE guardian_requests SET status='withdrawn' WHERE childUserId=?").run(users.child.id);
  assert.equal((await api('/api/community/bug-reports', bugBody, 'child')).status, 401);
}));

test('버그 등급별 2000·5000·20000 지급과 동시·상태 재처리 멱등성', async () => scenario(async ({ api, submit, db, users }) => {
  for (const [grade, amount, label] of [['simple', 2000, '단순'], ['normal', 5000, '일반'], ['critical', 20000, '중대']]) {
    const report = await submit();
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => accept(api, report.id, grade)));
    assert.equal(outcomes.filter(row => row.body.awarded).length, 1);
    assert.ok(outcomes.every(row => row.status === 200));
    const entry = db.prepare('SELECT * FROM grain_ledger WHERE eventId=?').get(`bug-report:${report.id}`);
    assert.equal(entry.userId, users.alice.id); assert.equal(entry.amount, amount); assert.equal(entry.reason, `버그 제보 보상(${label})`);
    assert.equal((await api(`/api/admin/bug-reports/${report.id}`, { status: '수정 완료', reason })).status, 200);
    assert.equal((await accept(api, report.id, grade)).body.awarded, false);
    const otherGrade = grade === 'critical' ? 'normal' : 'critical';
    assert.equal((await accept(api, report.id, otherGrade)).status, 409);
  }
  assert.equal(balance(db, users.alice.id), 27000);
  assert.equal(count(db, 'grain_ledger'), 3);
}));

test('미확인·어린이·보상정지 제보는 제외하고 자격 회복 뒤에도 채택 소급 없음', async () => scenario(async ({ api, submit, db, users }) => {
  await api(`/api/admin/users/${users.bob.id}/suspension`, { suspended: true, reason });
  for (const [actor, eligibility] of [['unverified', 'unverified'], ['child', 'under14'], ['bob', 'suspended']]) {
    const report = await submit(actor);
    const response = await accept(api, report.id);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.awarded, false); assert.equal(response.body.rewardEligibility, eligibility);
    assert.equal(balance(db, users[actor].id), 0);
    db.prepare("UPDATE user SET emailVerified=1,ageBand='14plus' WHERE id=?").run(users[actor].id);
    await api(`/api/admin/users/${users[actor].id}/suspension`, { suspended: false, reason });
    assert.equal((await accept(api, report.id)).body.awarded, false);
    assert.equal((await accept(api, report.id, 'critical')).status, 409);
    assert.equal(balance(db, users[actor].id), 0);
  }
}));

test('중복·재현 불가·등급 없는 채택은 미지급, 첫 유효 등급 판정만 지급', async () => scenario(async ({ api, submit, db }) => {
  const report = await submit();
  for (const status of ['접수', '확인 중', '중복', '재현 불가', '채택', '수정 완료']) {
    assert.equal((await api(`/api/admin/bug-reports/${report.id}`, { status, reason })).status, 200);
    assert.equal(count(db, 'grain_ledger'), 0);
  }
  assert.equal((await accept(api, report.id, 'simple')).body.awarded, true);
  assert.equal(count(db, 'grain_ledger'), 1);
}));

test('알려진 문제는 별도 공개 요약만 생성·수정하고 제보 원문 연결은 거부', async () => scenario(async ({ api, submit, users }) => {
  const report = await submit();
  const publicBody = { title: '화면 표시 문제', summary: '특정 화면의 표시 문제를 확인하고 있습니다.', status: '확인 중', reason: '공개 가능한 요약만 게시' };
  assert.equal((await api('/api/admin/known-issues', { ...publicBody, bugReportId: report.id })).status, 422);
  const created = await api('/api/admin/known-issues', publicBody);
  assert.equal(created.status, 201);
  const listed = await api('/api/community/known-issues', undefined, 'guest');
  assert.equal(listed.status, 200);
  assert.deepEqual(Object.keys(listed.body.issues[0]).sort(), ['createdAt', 'id', 'status', 'summary', 'title', 'updatedAt']);
  for (const secret of [bugBody.body, bugBody.steps, users.alice.id, users.alice.email, report.id, reason]) assert.equal(listed.text.includes(secret), false);
  const updated = await api(`/api/admin/known-issues/${created.body.issue.id}`, { ...publicBody, status: '수정 완료' });
  assert.equal(updated.status, 200);
  assert.equal((await api('/api/community/known-issues', undefined, 'guest')).body.issues[0].status, '수정 완료');
}));

test('신고 대상내용·기각·숨김·복구와 원본별 예정 보상 취소', async () => scenario(async ({ api, post, users, db }) => {
  const created = await post(), postId = created.body.post.id;
  const another = await post();
  const comment = await api(`/api/community/posts/${postId}/comments`, { body: '보상 예정이 생기는 다른 회원 댓글입니다.' }, 'bob');
  const commentId = comment.body.comment.id;
  const reported = await api('/api/community/reports', { targetType: 'post', targetId: postId, reason: '버그·보안 제보 공개', description: '공개되면 안 되는 내용' }, 'bob');
  assert.equal(reported.status, 201, reported.text);
  const reports = await api('/api/admin/reports');
  assert.equal(reports.body.reports[0].target.body, created.body.post.body); noEmail(reports.body);
  assert.equal((await api(`/api/admin/reports/${reported.body.report.id}`, { action: 'dismiss', reason })).status, 200);
  assert.equal(db.prepare('SELECT status FROM community_reports WHERE id=?').get(reported.body.report.id).status, 'dismissed');
  assert.equal((await api(`/api/admin/reports/${reported.body.report.id}`, { action: 'hide', reason })).status, 200);
  assert.equal((await api(`/api/community/posts/${postId}?game=slimeline`, undefined, 'alice')).status, 404);
  assert.equal(db.prepare('SELECT status FROM grain_activity_rewards WHERE eventId=?').get(`community-post:${postId}`).status, 'cancelled');
  assert.equal(db.prepare('SELECT status FROM grain_activity_rewards WHERE eventId=?').get(`community-comment:${commentId}`).status, 'cancelled');
  assert.equal(db.prepare('SELECT status FROM grain_activity_rewards WHERE eventId=?').get(`community-post:${another.body.post.id}`).status, 'pending');
  assert.equal((await api('/api/admin/hidden')).body.posts[0].id, postId);
  assert.equal((await api(`/api/admin/reports/${reported.body.report.id}`, { action: 'unhide', reason })).status, 200);
  assert.equal((await api(`/api/community/posts/${postId}?game=slimeline`, undefined, 'alice')).status, 200);
  assert.equal((await api('/api/admin/content', { targetType: 'comment', targetId: commentId, hidden: true, reason })).status, 200);
  assert.equal((await api('/api/admin/hidden')).body.comments[0].id, commentId);
  await api('/api/admin/content', { targetType: 'comment', targetId: commentId, hidden: false, reason });
  assert.equal(db.prepare('SELECT status FROM grain_activity_rewards WHERE eventId=?').get(`community-comment:${commentId}`).status, 'cancelled');
  assert.ok(count(db, 'grain_admin_audit') >= 6);
}));

test('정확 이메일·닉네임 조회만 허용하고 정지·해제 때 예정 취소와 자격 반영', async () => scenario(async ({ api, post, db, users }) => {
  await post();
  for (const q of [users.alice.email.toUpperCase(), users.alice.name]) {
    const res = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
    assert.equal(res.body.users.length, 1); assert.equal(res.body.users[0].rewardEligibility, 'eligible'); noEmail(res.body);
  }
  assert.deepEqual((await api('/api/admin/users?q=alice')).body, { users: [] });
  assert.deepEqual((await api('/api/admin/users?q=%25')).body, { users: [] });
  assert.equal((await api('/api/admin/users')).status, 422);
  assert.equal((await api(`/api/admin/users/${users.alice.id}/suspension`, { suspended: true, reason })).status, 200);
  assert.equal(db.prepare('SELECT status FROM grain_activity_rewards WHERE userId=?').get(users.alice.id).status, 'cancelled');
  const query = `/api/admin/users?q=${encodeURIComponent(users.alice.name)}`;
  assert.equal((await api(query)).body.users[0].rewardEligibility, 'suspended');
  await api(`/api/admin/users/${users.alice.id}/suspension`, { suspended: false, reason });
  assert.equal((await api(query)).body.users[0].rewardEligibility, 'eligible');
  assert.equal(db.prepare('SELECT status FROM grain_activity_rewards WHERE userId=?').get(users.alice.id).status, 'cancelled');
}));

test('회수는 잔액 안에서만 음수 원장을 남기고 동시 요청도 음수 잔액 불가', async () => scenario(async ({ api, db, users }) => {
  db.prepare('INSERT INTO grain_wallets(userId,balance) VALUES(?,1000)').run(users.alice.id);
  const path = `/api/admin/users/${users.alice.id}/reclaim`;
  for (const amount of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, 1001]) assert.equal((await api(path, { amount, reason })).status, 422);
  const outcomes = await Promise.all(Array.from({ length: 3 }, () => api(path, { amount: 600, reason })));
  assert.equal(outcomes.filter(row => row.status === 200).length, 1);
  assert.equal(balance(db, users.alice.id), 400);
  const entry = db.prepare('SELECT * FROM grain_ledger WHERE userId=?').get(users.alice.id);
  assert.equal(entry.amount, -600); assert.match(entry.eventId, /^admin-reclaim:[0-9a-f-]+$/);
  assert.equal((await api(path, { amount: 400, reason })).body.balance, 0);
  assert.equal((await api(path, { amount: 1, reason })).status, 422);
}));

test('우수 글은 글당 한 번 3000 지급하고 숨김·미자격은 제외', async () => scenario(async ({ api, post, db, users }) => {
  const postId = (await post()).body.post.id;
  const outcomes = await Promise.all(Array.from({ length: 5 }, () => api('/api/admin/best-post', { postId, reason })));
  assert.equal(outcomes.filter(row => row.body.awarded).length, 1);
  assert.equal(balance(db, users.alice.id), 3000);
  assert.equal(db.prepare('SELECT eventId FROM grain_ledger').get().eventId, `best-post:${postId}`);
  const hiddenId = (await post()).body.post.id;
  await api('/api/admin/content', { targetType: 'post', targetId: hiddenId, hidden: true, reason });
  assert.equal((await api('/api/admin/best-post', { postId: hiddenId, reason })).status, 422);
  db.prepare('UPDATE user SET emailVerified=0 WHERE id=?').run(users.alice.id);
  assert.equal((await api('/api/admin/best-post', { postId: (await post('bob')).body.post.id, reason })).body.awarded, true);
  const unhidden = (await api('/api/admin/content', { targetType: 'post', targetId: hiddenId, hidden: false, reason })).status;
  assert.equal(unhidden, 200);
  assert.equal((await api('/api/admin/best-post', { postId: hiddenId, reason })).body.awarded, false);
}));

test('이벤트는 기간·안전정수·500명 한도·중복 및 미자격 건너뛰기를 검증', async () => scenario(async ({ api, db, users, now, setTime }) => {
  for (const amount of [0, 100001, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]) assert.equal((await event(api, now, { amount })).status, 422);
  for (const values of [{ slug: '../x' }, { startsAt: '2026-02-30T00:00:00Z' }, { startsAt: '2026-10-17' }, { endsAt: now() - 100 }, { startsAt: Number.MAX_SAFE_INTEGER }]) assert.equal((await event(api, now, values)).status, 422);
  const startsAt = now() + 1000, endsAt = now() + 10000;
  assert.equal((await event(api, now, { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() })).status, 201);
  assert.equal((await event(api, now)).status, 409);
  const awardsPath = '/api/admin/events/test-event/awards';
  assert.equal((await api(awardsPath, { recipients: [users.alice.id], reason })).status, 422);
  setTime(startsAt);
  const recipients = [users.alice.id, users.alice.email.toUpperCase(), users.bob.email, users.unverified.id, users.child.id, 'missing@example.test'];
  const response = await api(awardsPath, { recipients, reason });
  assert.deepEqual(response.body, { awarded: 2, skipped: 2, duplicates: 1, notFound: 1 }); noEmail(response.body);
  const duplicate = await api(awardsPath, { recipients: [users.alice.id, users.bob.id], reason });
  assert.deepEqual(duplicate.body, { awarded: 0, skipped: 0, duplicates: 2, notFound: 0 });
  assert.equal(balance(db, users.alice.id), 700);
  assert.equal((await api(awardsPath, { recipients: [], reason })).status, 422);
  assert.equal((await api(awardsPath, { recipients: Array(501).fill(users.alice.id), reason })).status, 422);
  assert.equal((await api(awardsPath, { recipients: Array(500).fill(users.alice.id), reason })).body.duplicates, 500);
  setTime(endsAt);
  assert.equal((await api(awardsPath, { recipients: [users.admin.id], reason })).status, 422);
  const listed = await api('/api/admin/events');
  assert.equal(listed.body.events[0].startsAt, new Date(startsAt).toISOString()); noEmail(listed.body);
}));

test('지갑·감사 저장 실패는 운영 조치 전체를 롤백하고 재시도 가능', async () => scenario(async ({ api, submit, db, users, post }) => {
  const report = await submit();
  db.exec("CREATE TRIGGER reject_wallet BEFORE INSERT ON grain_wallets BEGIN SELECT RAISE(ABORT,'시험용 실패'); END;");
  assert.equal((await accept(api, report.id)).status, 500);
  assert.equal(count(db, 'grain_ledger'), 0); assert.equal(count(db, 'grain_admin_audit'), 0);
  assert.equal(db.prepare('SELECT rewardDecidedAt FROM grain_bug_reports').get().rewardDecidedAt, null);
  db.exec('DROP TRIGGER reject_wallet');
  assert.equal((await accept(api, report.id)).body.awarded, true);
  const postId = (await post()).body.post.id;
  db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON grain_admin_audit BEGIN SELECT RAISE(ABORT,'시험용 감사 실패'); END;");
  assert.equal((await api('/api/admin/content', { targetType: 'post', targetId: postId, hidden: true, reason })).status, 500);
  assert.equal(db.prepare('SELECT hiddenAt FROM community_posts WHERE id=?').get(postId).hiddenAt, null);
  assert.equal(db.prepare('SELECT status FROM grain_activity_rewards WHERE eventId=?').get(`community-post:${postId}`).status, 'pending');
  assert.equal((await api(`/api/admin/users/${users.alice.id}/suspension`, { suspended: true, reason })).status, 500);
  assert.equal(count(db, 'grain_reward_suspensions'), 0);
  assert.equal((await api(`/api/admin/users/${users.alice.id}/reclaim`, { amount: 1, reason })).status, 500);
  assert.equal(balance(db, users.alice.id), 5000);
}));

test('회원 삭제는 제보·원장·정지·감사 actor와 대상 연결 흔적을 CASCADE 삭제', async () => scenario(async ({ api, submit, post, db, users, now }) => {
  const report = await submit(), postId = (await post()).body.post.id;
  await accept(api, report.id);
  await api('/api/admin/best-post', { postId, reason });
  await api(`/api/admin/users/${users.alice.id}/suspension`, { suspended: true, reason });
  await api(`/api/admin/users/${users.alice.id}/reclaim`, { amount: 1, reason });
  await event(api, now);
  await api('/api/admin/events/test-event/awards', { recipients: [users.bob.id], reason });
  assert.ok(count(db, 'grain_admin_audit', 'WHERE targetUserId=?', users.alice.id) > 0);
  db.prepare('DELETE FROM user WHERE id=?').run(users.alice.id);
  for (const table of ['grain_bug_reports', 'grain_reward_suspensions', 'grain_ledger', 'grain_activity_rewards']) assert.equal(count(db, table, 'WHERE userId=?', users.alice.id), 0);
  assert.equal(count(db, 'grain_admin_audit', 'WHERE targetUserId=? OR targetId=? OR bugReportId=? OR postId=?', users.alice.id, users.alice.id, report.id, postId), 0);
  for (const table of ['grain_bug_reports', 'grain_admin_events', 'community_known_issues', 'grain_admin_audit']) {
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${table})`).all().filter(row => row.table === 'user')) assert.equal(fk.on_delete, 'CASCADE');
  }
  db.prepare('DELETE FROM user WHERE id=?').run(users.admin.id);
  assert.equal(count(db, 'grain_admin_audit'), 0); assert.equal(count(db, 'grain_admin_events'), 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(Object.values(GRAIN_ECONOMY).includes('free-only'));
  assert.equal(GRAIN_ECONOMY.transferable, false); assert.equal(GRAIN_ECONOMY.purchasable, false);
}));

test('지급·이벤트를 재초기화해도 판정·원장을 보존하고 오버플로는 전체 취소', async () => scenario(async ({ api, submit, db, users, resetAdmins, now }) => {
  const report = await submit('unverified');
  assert.equal((await accept(api, report.id)).body.rewardEligibility, 'unverified');
  db.prepare('UPDATE user SET emailVerified=1 WHERE id=?').run(users.unverified.id);
  resetAdmins(users.admin.id);
  assert.equal((await accept(api, report.id)).body.awarded, false);
  await event(api, now, { slug: 'overflow-event', amount: 1000 });
  db.prepare('INSERT INTO grain_wallets(userId,balance) VALUES(?,?)').run(users.bob.id, Number.MAX_SAFE_INTEGER);
  const failed = await api('/api/admin/events/overflow-event/awards', { recipients: [users.alice.id, users.bob.id], reason });
  assert.equal(failed.status, 422);
  assert.equal(balance(db, users.alice.id), 0);
  assert.equal(balance(db, users.bob.id), Number.MAX_SAFE_INTEGER);
  assert.equal(count(db, 'grain_ledger', "WHERE eventId='event:overflow-event'"), 0);
  assert.equal(count(db, 'grain_admin_audit', "WHERE action IN ('event-award','event-awards')"), 0);
  db.prepare('UPDATE grain_wallets SET balance=0 WHERE userId=?').run(users.bob.id);
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => api('/api/admin/events/overflow-event/awards', { recipients: [users.alice.id, users.bob.id], reason })));
  assert.equal(outcomes.reduce((sum, row) => sum + row.body.awarded, 0), 2);
  assert.equal(count(db, 'grain_ledger', "WHERE eventId='event:overflow-event'"), 2);
  resetAdmins(users.admin.id);
  assert.deepEqual((await api('/api/admin/events/overflow-event/awards', { recipients: [users.alice.id, users.bob.id], reason })).body, { awarded: 0, skipped: 0, duplicates: 2, notFound: 0 });
}));

test('운영 mutation 필드·형식·사유를 검증하고 거부한 요청은 기록을 만들지 않음', async () => scenario(async ({ api, db, users, submit }) => {
  const report = await submit();
  const inputs = [
    ['/api/admin/content', { targetType: 'user', targetId: 'x', hidden: true, reason }],
    ['/api/admin/content', { targetType: 'post', targetId: 'x', hidden: 'true', reason }],
    ['/api/admin/content', { targetType: 'post', targetId: 'x', hidden: true, reason, email: 'test@example.test' }],
    [`/api/admin/users/${users.alice.id}/suspension`, { suspended: 1, reason }],
    [`/api/admin/users/${users.alice.id}/reclaim`, { amount: 1 }],
    [`/api/admin/bug-reports/${report.id}`, { status: 'accepted', grade: 'normal', reason }],
    [`/api/admin/bug-reports/${report.id}`, { status: '채택', grade: 'other', reason }],
    [`/api/admin/bug-reports/${report.id}`, { status: '채택', grade: 'normal', reason: '가' }],
    ['/api/admin/best-post', { postId: 'x', reason: '가'.repeat(1001) }],
    ['/api/admin/content?hidden=true', { targetType: 'post', targetId: 'x', hidden: true, reason }],
  ];
  for (const [path, body] of inputs) assert.equal((await api(path, body)).status, 422, path);
  assert.equal(count(db, 'grain_admin_audit'), 0);
  assert.equal(count(db, 'grain_ledger'), 0);
  assert.equal(count(db, 'grain_reward_suspensions'), 0);
}));
