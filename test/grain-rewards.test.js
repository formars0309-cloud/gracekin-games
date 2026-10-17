import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommunity, initializeCommunitySchema } from '../server/community.js';
import { createGrainRewards, REWARD_DAY_MS } from '../server/grain-rewards.js';
import { createGrainService, GRAIN_ECONOMY } from '../server/grain.js';
import { errorResponse } from '../server/security.js';

const initialTime = Date.parse('2026-10-17T14:59:59.999Z');
function fixture({ path = ':memory:', startTimer = false } = {}) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS user(id TEXT PRIMARY KEY,name TEXT,emailVerified INTEGER,ageBand TEXT);
    CREATE TABLE IF NOT EXISTS guardian_requests(childUserId TEXT,status TEXT);`);
  for (const [id, emailVerified, ageBand] of [['alice',1,'14plus'],['bob',1,'14plus'],['admin',1,'14plus'],['child',1,'under14'],['unverified',0,'14plus'],['legacy',1,null]]) {
    db.prepare('INSERT OR IGNORE INTO user VALUES(?,?,?,?)').run(id, id, emailVerified, ageBand);
  }
  createGrainService(db);
  initializeCommunitySchema(db);
  let time = initialTime;
  const options = { now: () => time, startTimer };
  let rewards = createGrainRewards(db, options);
  const auth = { api: { getSession: async ({ headers }) => {
    const id = headers.get('x-test-user');
    // 저장된 세션 자격을 믿으면 안 되는 상황을 재현합니다.
    return id ? { user: { id, name: id, emailVerified: true, ageBand: '14plus' } } : null;
  } } };
  let community = createCommunity(db, auth, { rewards, now: () => time, isAdmin: user => user?.id === 'admin' });
  return { db, get rewards() { return rewards; }, setTime(value) { time = value; }, time: () => time,
    restart() { rewards.close(); rewards = createGrainRewards(db, options); community = createCommunity(db, auth, { rewards, now: () => time, isAdmin: user => user?.id === 'admin' }); },
    async request(path, { method = 'GET', user, body } = {}) {
      const url = new URL(path, 'http://localhost');
      const request = new Request(url, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let response;
      try { response = await community(request, url); } catch (error) { response = errorResponse(error); }
      return { status: response.status, body: await response.json() };
    }, close() { rewards.close(); db.close(); } };
}
const post = (f, title = '새 글 제목', content = '가'.repeat(30), user = 'alice') => f.request('/api/community/posts', { method: 'POST', user, body: { game: 'slimeline', board: 'free', title, body: content } });
const comment = (f, postId, content = '나'.repeat(10), user = 'bob') => f.request(`/api/community/posts/${postId}/comments`, { method: 'POST', user, body: { body: content } });
const status = (f, userId = 'alice') => f.rewards.summary({ id: userId });
const balance = (f, userId = 'alice') => f.db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(userId)?.balance ?? 0;
const mutate = (f, path, user, method, body = {}) => f.request(path, { user, method, body });
const report = (f, targetId, user = 'bob', extra = {}) => mutate(f, '/api/community/reports', user, 'POST', { targetType: 'post', targetId, reason: '도배·광고', ...extra });

// 공유 계약: GET에 해당하는 summary는 원장 확정이나 취소를 일으키지 않습니다.
test('출석은 KST 하루 한 번·동시 호출 멱등이며 다음날 300을 다시 지급', async () => {
  const f = fixture();
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => f.rewards.attendance({ id: 'alice' }))));
    assert.equal(results.filter(row => row.awarded).length, 1);
    assert.deepEqual(results[0], { awarded: true, amount: 300, date: '2026-10-17' });
    assert.equal(balance(f), 300);
    f.setTime(initialTime + 1);
    assert.deepEqual(f.rewards.attendance({ id: 'alice' }), { awarded: true, amount: 300, date: '2026-10-18' });
    assert.equal(balance(f), 600);
    assert.deepEqual(f.db.prepare('SELECT eventId,reason FROM grain_ledger ORDER BY createdAt').all().map(row => ({ ...row })), [
      { eventId: 'attendance:2026-10-17', reason: '출석' }, { eventId: 'attendance:2026-10-18', reason: '출석' },
    ]);
  } finally { f.close(); }
});

test('글은 trim 30자·유니코드 글자수·직전 제목과 본문 공백정규화·수정 재보상 방지', async () => {
  const f = fixture();
  try {
    assert.deepEqual((await post(f, '짧은 글', `  ${'가'.repeat(29)}  `)).body.reward, { pending: false, amount: 0 });
    const first = await post(f, '같은 제목', `  ${'가'.repeat(15)} ${'나'.repeat(15)}  `);
    assert.deepEqual(first.body.reward, { pending: true, amount: 500 });
    assert.deepEqual((await post(f, '같은\n 제목', `${'가'.repeat(15)}\n\t${'나'.repeat(15)}`)).body.reward, { pending: false, amount: 0 });
    const emoji = await post(f, '이모지 글', '😀'.repeat(29));
    assert.equal(emoji.body.reward.pending, false);
    await mutate(f, `/api/community/posts/${emoji.body.post.id}`, 'alice', 'PATCH', { title: '늘린 본문', body: '😀'.repeat(30) });
    assert.equal(status(f).pendingTotal, 500);
    const saved = status(f).pending[0];
    assert.equal(saved.eventId, `community-post:${first.body.post.id}`);
    assert.equal(Date.parse(saved.confirmsAt) - Date.parse(saved.createdAt), REWARD_DAY_MS);
  } finally { f.close(); }
});

test('댓글은 10자·본인 글 제외·같은 글 첫댓글만, 짧거나 삭제된 첫댓글도 재보상 불가', async () => {
  const f = fixture();
  try {
    const own = (await post(f)).body.post.id;
    assert.equal((await comment(f, own, '나'.repeat(10), 'alice')).body.reward.pending, false);
    const short = await comment(f, own, '나'.repeat(9));
    assert.equal(short.body.reward.pending, false);
    await mutate(f, `/api/community/comments/${short.body.comment.id}`, 'bob', 'DELETE');
    assert.equal((await comment(f, own)).body.reward.pending, false);
    const other = (await post(f, '다른 글')).body.post.id;
    assert.equal((await comment(f, other)).body.reward.pending, true);
    assert.equal((await comment(f, other)).body.reward.pending, false);
    assert.equal(status(f, 'bob').pendingTotal, 100);
  } finally { f.close(); }
});

test('글 3회·댓글 10회와 출석 합 2800, 예약·확정은 작성일에 합산하고 KST 경계에 새 한도', async () => {
  const f = fixture();
  try {
    f.rewards.attendance({ id: 'alice' });
    for (let i = 0; i < 4; i++) assert.equal((await post(f, `글 제목 ${i}`)).body.reward.pending, i < 3);
    for (let i = 0; i < 11; i++) {
      const parent = (await post(f, `상대 글 ${i}`, '본문', 'bob')).body.post.id;
      assert.equal((await comment(f, parent, '나'.repeat(10), 'alice')).body.reward.pending, i < 10);
    }
    assert.equal(status(f).pendingTotal, 2500);
    assert.equal(balance(f), 300);
    f.setTime(initialTime + REWARD_DAY_MS); f.rewards.tick();
    assert.equal(balance(f), 2800); assert.equal(status(f).pendingTotal, 0);
    assert.equal((await post(f, '다음 날 글')).body.reward.pending, true);
    assert.equal(f.rewards.attendance({ id: 'alice' }).awarded, true);
    // 향후 활동 종류가 늘어도 합계 3000 방어를 검증합니다.
    f.db.prepare("INSERT INTO grain_activity_rewards VALUES('cap-fill','alice','post','cap',NULL,NULL,2600,'2026-10-18',0,0,'confirmed')").run();
    assert.equal((await post(f, '합계 초과 글')).body.reward.pending, false);
  } finally { f.close(); }
});

test('24시간 직전 미확정·경계 확정 한 번·중복 tick/재시작·확정 뒤 삭제 회수 없음', async () => {
  const f = fixture();
  try {
    const id = (await post(f)).body.post.id;
    f.setTime(initialTime + REWARD_DAY_MS - 1); f.rewards.tick(); assert.equal(balance(f), 0);
    f.setTime(initialTime + REWARD_DAY_MS); f.rewards.tick(); f.rewards.tick(); f.restart();
    assert.equal(balance(f), 500);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 1);
    await mutate(f, `/api/community/posts/${id}`, 'alice', 'DELETE');
    f.rewards.tick(); assert.equal(balance(f), 500);
  } finally { f.close(); }
});

test('확정 전 삭제·숨김·부모 숨김·정지는 즉시 취소, 해제·재시작으로 부활하지 않음', async () => {
  const f = fixture();
  try {
    const deleted = (await post(f, '삭제 글')).body.post.id;
    await mutate(f, `/api/community/posts/${deleted}`, 'alice', 'DELETE');
    assert.equal(status(f).pendingTotal, 0);
    const hidden = (await post(f, '숨김 글')).body.post.id;
    const child = (await comment(f, hidden)).body.comment.id;
    f.db.prepare('UPDATE community_posts SET hiddenAt=? WHERE id=?').run(initialTime, hidden);
    assert.equal(status(f).pendingTotal, 0); assert.equal(status(f, 'bob').pendingTotal, 0);
    f.db.prepare('UPDATE community_posts SET hiddenAt=NULL WHERE id=?').run(hidden);
    const parent = (await post(f, '댓글 숨김')).body.post.id;
    const hiddenComment = (await comment(f, parent)).body.comment.id;
    f.db.prepare('UPDATE community_comments SET hiddenAt=? WHERE id=?').run(initialTime, hiddenComment);
    f.db.prepare('UPDATE community_comments SET hiddenAt=NULL WHERE id=?').run(hiddenComment);
    f.db.prepare("INSERT INTO grain_reward_suspensions VALUES('alice','운영 정지',?)").run(initialTime);
    assert.equal(status(f).pendingTotal, 0);
    f.db.prepare("DELETE FROM grain_reward_suspensions WHERE userId='alice'").run();
    f.setTime(initialTime + REWARD_DAY_MS); f.restart(); f.rewards.tick();
    assert.equal(balance(f), 0); assert.equal(balance(f, 'bob'), 0);
    assert.equal(f.db.prepare('SELECT status FROM grain_activity_rewards WHERE targetId=?').get(child).status, 'cancelled');
  } finally { f.close(); }
});

test('현재 DB 자격: 미확인·14세미만·정지 제외, 확인된 기존회원 허용·확정 시 재확인', async () => {
  const f = fixture();
  try {
    for (const [id, expected] of [['unverified','unverified'],['child','under14']]) {
      assert.equal(f.rewards.rewardStatus({ id, emailVerified: true, ageBand: '14plus' }), expected);
      assert.throws(() => f.rewards.attendance({ id }), /확인/);
      assert.equal(f.rewards.rewardEligible({ id }), false);
    }
    assert.equal(f.rewards.rewardStatus({ id: 'legacy' }), 'eligible');
    f.db.prepare("UPDATE user SET emailVerified=0 WHERE id='legacy'").run();
    const old = await post(f, '구회원 미확인 글', '가'.repeat(30), 'legacy');
    assert.equal(old.status, 201); assert.equal(old.body.reward.pending, false);
    f.db.prepare("UPDATE user SET emailVerified=1 WHERE id='legacy'").run();
    assert.equal((await post(f, '구회원 확인 뒤 글', '가'.repeat(30), 'legacy')).body.reward.pending, true);
    assert.equal(status(f, 'legacy').pending.length, 1);
    await post(f);
    f.db.prepare("UPDATE user SET emailVerified=0 WHERE id='alice'").run();
    const before = f.db.prepare('SELECT total_changes() AS n').get().n;
    assert.equal(status(f).rewardEligibility, 'unverified');
    assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n, before);
    f.setTime(initialTime + REWARD_DAY_MS); f.rewards.tick();
    assert.equal(status(f).pendingTotal, 0); assert.equal(balance(f), 0);
    f.db.prepare("INSERT INTO grain_reward_suspensions VALUES('bob','정지',?)").run(initialTime);
    assert.equal(f.rewards.rewardStatus({ id: 'bob' }), 'suspended');
    assert.equal((await post(f, '정지 회원 글', '가'.repeat(30), 'bob')).body.reward.pending, false);
  } finally { f.close(); }
});

test('grant는 호출자 트랜잭션을 유지하고 멱등·오버플로·실패 롤백을 보장', () => {
  const f = fixture();
  try {
    f.db.exec('BEGIN IMMEDIATE');
    assert.equal(f.rewards.grant('alice', 'event:one', 500, '무료 이벤트'), true);
    assert.equal(f.rewards.grant('alice', 'event:one', 500, '무료 이벤트'), false);
    f.db.exec('ROLLBACK'); assert.equal(balance(f), 0);
    f.db.exec('BEGIN IMMEDIATE'); f.rewards.grant('alice', 'max', Number.MAX_SAFE_INTEGER, '범위 시험'); f.db.exec('COMMIT');
    f.db.exec('BEGIN IMMEDIATE');
    assert.throws(() => f.rewards.grant('alice', 'overflow', 1, '범위 초과'), /범위/);
    f.db.exec('ROLLBACK');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM grain_ledger WHERE eventId='overflow'").get().n, 0);
  } finally { f.close(); }
});

test('원본 INSERT와 보상 예약 실패는 함께 롤백', async () => {
  const f = fixture();
  try {
    f.db.exec("CREATE TRIGGER test_reward_failure BEFORE INSERT ON grain_activity_rewards BEGIN SELECT RAISE(ABORT,'시험용 실패'); END;");
    assert.equal((await post(f)).status, 500);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM community_posts').get().n, 0);
  } finally { f.close(); }
});

test('신고 로그인·글쓰기 권한·사유·설명 500자·본인·대상별 중복·KST20회', async () => {
  const f = fixture();
  try {
    const id = (await post(f)).body.post.id;
    assert.equal((await report(f, id, null)).status, 401);
    assert.equal((await report(f, id, 'unverified')).status, 403);
    assert.equal((await report(f, id, 'alice')).status, 403);
    assert.equal((await report(f, id, 'bob', { reason: '임의 사유' })).status, 422);
    assert.equal((await report(f, id, 'bob', { description: '가'.repeat(501) })).status, 422);
    const results = await Promise.all([report(f, id), report(f, id)]);
    assert.deepEqual(results.map(row => row.status).sort(), [201,409]);
    for (let i = 1; i < 20; i++) {
      const next = (await post(f, `신고 글 ${i}`, '내용')).body.post.id;
      assert.equal((await report(f, next, 'bob', { description: '가'.repeat(500) })).status, 201);
    }
    const last = (await post(f, '한도 밖 글')).body.post.id;
    assert.equal((await report(f, last)).status, 429);
    f.setTime(initialTime + 1); assert.equal((await report(f, last)).status, 201);
    const c = (await comment(f, last)).body.comment.id;
    assert.equal((await report(f, c, 'alice', { targetType: 'comment', reason: '욕설·괴롭힘' })).status, 201);
  } finally { f.close(); }
});

test('숨긴 글·댓글은 일반·작성자 목록/상세/검색/댓글수에서 비노출, 운영자만 조회', async () => {
  const f = fixture();
  try {
    const id = (await post(f, '비밀검색어')).body.post.id;
    const c = (await comment(f, id)).body.comment.id;
    f.db.prepare('UPDATE community_comments SET hiddenAt=? WHERE id=?').run(initialTime, c);
    let detail = await f.request(`/api/community/posts/${id}?game=slimeline`, { user: 'alice' });
    assert.equal(detail.body.comments.length, 0); assert.equal(detail.body.post.commentCount, 0);
    detail = await f.request(`/api/community/posts/${id}?game=slimeline`, { user: 'admin' });
    assert.equal(detail.body.comments.length, 1); assert.equal(detail.body.post.commentCount, 1);
    assert.equal((await mutate(f, `/api/community/comments/${c}`, 'bob', 'PATCH', { body: '수정 불가' })).status, 404);
    f.db.prepare('UPDATE community_posts SET hiddenAt=? WHERE id=?').run(initialTime, id);
    for (const user of [null, 'alice', 'bob']) {
      assert.equal((await f.request(`/api/community/posts/${id}?game=slimeline`, { user })).status, 404);
      const list = await f.request('/api/community/posts?game=slimeline&q=비밀검색어', { user });
      assert.equal(list.body.total, 0); assert.equal(list.body.posts.length, 0);
    }
    assert.equal((await report(f, id)).status, 404);
    assert.equal((await f.request(`/api/community/posts/${id}?game=slimeline`, { user: 'admin' })).status, 200);
    assert.equal((await f.request('/api/community/posts?game=slimeline&q=비밀검색어', { user: 'admin' })).body.total, 1);
  } finally { f.close(); }
});

test('기존 글 소급 없음·summary 읽기 무변경·계정 삭제 CASCADE·무료 정책 불변', async () => {
  const f = fixture();
  try {
    const id = (await post(f)).body.post.id;
    await comment(f, id);
    await report(f, id);
    f.rewards.attendance({ id: 'bob' });
    f.db.prepare("INSERT INTO grain_reward_suspensions VALUES('bob','정지',?)").run(initialTime);
    f.db.prepare("DELETE FROM user WHERE id='bob'").run();
    for (const [table, column] of [['grain_activity_rewards','userId'],['grain_reward_suspensions','userId'],['community_reports','reporterId'],['grain_ledger','userId'],['grain_wallets','userId']]) {
      assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}='bob'`).get().n, 0, table);
    }
    const before = f.db.prepare('SELECT total_changes() AS n').get().n;
    status(f); status(f);
    assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n, before);
    f.db.exec('DELETE FROM grain_activity_rewards'); f.setTime(initialTime + REWARD_DAY_MS); f.restart();
    assert.equal(status(f).pendingTotal, 0); assert.equal(balance(f), 0);
    assert.equal(Object.isFrozen(GRAIN_ECONOMY), true);
    assert.ok(Object.entries(GRAIN_ECONOMY).filter(([key]) => key !== 'mode').every(([, value]) => value === false));
  } finally { f.close(); }
});

test('파일 DB 재접속 후 시작 tick이 밀린 보상을 한 번만 확정', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'grain-reward-restart-'));
  const path = join(directory, 'test.sqlite');
  let f;
  try {
    f = fixture({ path }); await post(f); f.close(); f = null;
    const db = new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON');
    try {
      const options = { now: () => initialTime + REWARD_DAY_MS, startTimer: false };
      const first = createGrainRewards(db, options); first.close();
      const second = createGrainRewards(db, options); second.tick(); second.close();
      assert.equal(db.prepare("SELECT balance FROM grain_wallets WHERE userId='alice'").get().balance, 500);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 1);
    } finally { db.close(); }
  } finally { f?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('실제 60초 주기 타이머가 요청 없이 보상을 확정하고 close로 해제', { timeout: 65000 }, async () => {
  const f = fixture({ startTimer: true });
  try {
    await post(f); f.setTime(initialTime + REWARD_DAY_MS);
    await new Promise(resolve => setTimeout(resolve, 60100));
    assert.equal(balance(f), 500); assert.equal(status(f).pendingTotal, 0);
  } finally { f.close(); }
});

test('cancelContent는 지정한 원본과 부모글 댓글만 취소하며 다른 예정은 유지', async () => {
  const f = fixture();
  try {
    const parent = (await post(f, '지정 원본')).body.post.id;
    const other = (await post(f, '다른 원본')).body.post.id;
    const first = (await comment(f, parent)).body.comment.id;
    const second = (await comment(f, other)).body.comment.id;
    f.db.exec('BEGIN IMMEDIATE'); f.rewards.cancelContent('post', parent); f.db.exec('COMMIT');
    assert.equal(status(f).pendingTotal, 500); assert.equal(status(f, 'bob').pendingTotal, 100);
    assert.equal(f.db.prepare('SELECT status FROM grain_activity_rewards WHERE targetId=?').get(first).status, 'cancelled');
    await mutate(f, `/api/community/comments/${second}`, 'bob', 'DELETE');
    assert.equal(status(f, 'bob').pendingTotal, 0);
    f.rewards.cancelPending('alice'); assert.equal(status(f).pendingTotal, 0);
    f.setTime(initialTime + REWARD_DAY_MS); f.rewards.tick();
    assert.equal(balance(f), 0); assert.equal(balance(f, 'bob'), 0);
  } finally { f.close(); }
});

test('확정 시 현재 자격을 검사하며 24시간 전 재인증은 기존 예약을 유지', async () => {
  const f = fixture();
  try {
    await post(f);
    f.db.prepare("UPDATE user SET emailVerified=0 WHERE id='alice'").run();
    f.setTime(initialTime + 60000); f.rewards.tick();
    assert.equal(status(f).pendingTotal, 500);
    f.db.prepare("UPDATE user SET emailVerified=1 WHERE id='alice'").run();
    f.setTime(initialTime + REWARD_DAY_MS); f.rewards.tick();
    assert.equal(balance(f), 500);
  } finally { f.close(); }
});
