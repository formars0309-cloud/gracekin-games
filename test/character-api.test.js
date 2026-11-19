import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { createCharacterService, getPublicCharacter } from '../server/character/index.js';
import { createGrainRewards } from '../server/grain-rewards.js';
import { createDefaultCharacter, levelNeed } from '../assets/character/model.js';
import { request as rawRequest, cookieFrom, registerAndLogin } from './account-helpers.js';
const DAY = 86400000;
let nextIP = 1;
async function scenario(work, extra = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-character-')), mailbox = [];
  let time = Date.parse('2026-11-18T14:59:00Z');
  const headers = { 'fly-client-ip': `198.51.100.${nextIP++}` };
  const options = { port: 0, dataDir: folder, now: () => time, mailer: async mail => mailbox.push(mail), grainRewardsStartTimer: false, trustFlyProxy: true, flyAppName: 'gracekin-games-community', rateLimit: { authMax: 150, writeMax: 300, readMax: 300 }, ...extra };
  let app = await startServer(options);
  const db = new DatabaseSync(join(folder, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON');
  const req = (path, options = {}) => rawRequest(app, path, { ...options, headers: { ...headers, ...options.headers } });
  const login = async (email = 'character@example.test') => {
    const response = await registerAndLogin(app, mailbox, { name: '캐릭터회원', email, password: '캐릭터-시험암호-1234', ageBand: '14plus' }, headers);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return { cookie: cookieFrom(response), user: response.body.user };
  };
  const characters = createCharacterService(db, { now: () => time });
  const rewards = createGrainRewards(db, { now: () => time, startTimer: false, characters });
  try { await work({ req, db, login, characters, rewards, setTime: value => { time = value; }, advance: value => { time += value; }, now: () => time, async restart() { await app.close(); app = await startServer(options); } }); }
  finally { rewards.close(); db.close(); await app.close(); await rm(folder, { recursive: true, force: true }); }
}
const me = '/api/character/me';
const mutate = (req, cookie, path, body, method = 'POST') => req(path, { method, cookie, body });
const save = (req, cookie, revision = 0, data = createDefaultCharacter()) => mutate(req, cookie, me, { revision, data }, 'PUT');
const inTransaction = (db, work) => { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };

test('실제 가입 후 빈 상태·생성·수정·저장 충돌·형식 검사·다른 회원 접근 차단', async () => scenario(async ({ req, db, login, restart }) => {
  assert.equal((await req(me)).status, 401);
  const alice = await login(), bob = await login('other@example.test');
  assert.deepEqual((await req(me, { cookie: alice.cookie })).body, { character: null });
  const created = await save(req, alice.cookie); assert.equal(created.status, 200);
  const first = created.body.character; assert.equal(first.revision, 1); assert.equal(first.progress.points, 0);
  assert.equal(Object.values(first.stats).reduce((a, b) => a + b), 68);
  assert.equal((await save(req, alice.cookie)).status, 409);
  const changed = createDefaultCharacter(); changed.race = 'cat'; changed.job = 'ranger'; changed.appearance.hair = 'h8';
  const updated = await save(req, alice.cookie, 1, changed); assert.equal(updated.body.character.revision, 2); assert.equal(updated.body.character.id, first.id);
  for (const data of [{ ...changed, race: 'fake' }, { ...changed, job: 'marksman' }, { ...changed, race: 'dragon' }, { ...changed, totalExp: 999 }, { ...changed, appearance: { ...changed.appearance, hairColor: 'c11' } }]) assert.equal((await save(req, alice.cookie, 2, data)).status, 422);
  const dragon = { ...changed, race: 'dragon', appearance: { ...changed.appearance, skin: null } }; assert.equal((await save(req, alice.cookie, 2, dragon)).status, 200);
  assert.deepEqual((await req(me, { cookie: bob.cookie, headers: { 'x-user-id': alice.user.id } })).body, { character: null });
  assert.equal((await req(`${me}?userId=${alice.user.id}`, { cookie: bob.cookie })).status, 422);
  assert.equal((await req(`/api/character/${first.id}`, { cookie: bob.cookie })).status, 404);
  assert.equal((await mutate(req, bob.cookie, me, { revision: 0, data: changed, userId: alice.user.id }, 'PUT')).status, 422);
  assert.equal((await mutate(req, alice.cookie, me, { revision: 3, data: changed }, 'DELETE')).status, 405);
  await restart(); assert.equal((await req(me, { cookie: alice.cookie })).body.character.revision, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM characters').get().n, 1);
}));

test('레벨 포인트 분배·초과·종족 직업 변경 보존·10레벨 잠금·무료 초기화 30일 경계', async () => scenario(async ({ req, db, login, advance }) => {
  const { cookie, user } = await login(); await save(req, cookie);
  db.prepare('UPDATE characters SET totalExp=225 WHERE userId=?').run(user.id);
  let current = (await req(me, { cookie })).body.character; assert.equal(current.progress.points, 6);
  let allocated = await mutate(req, cookie, `${me}/allocate`, { revision: current.revision, stat: 'str', amount: 4 }); assert.equal(allocated.status, 200);
  current = allocated.body.character; assert.equal(current.progress.points, 2); assert.equal(current.alloc.str, 4);
  for (const [stat, amount] of [['str', 3], ['str', 0], ['str', 1.2], ['str', -1], ['str', '1'], ['bad', 1]]) assert.equal((await mutate(req, cookie, `${me}/allocate`, { revision: current.revision, stat, amount })).status, 422);
  const changed = createDefaultCharacter(); changed.race = 'elf'; changed.job = 'arcanist';
  current = (await save(req, cookie, current.revision, changed)).body.character; assert.equal(current.alloc.str, 4); assert.equal(current.stats.str, 9);
  assert.equal((await mutate(req, cookie, `${me}/allocate`, { revision: 1, stat: 'str', amount: 1 })).status, 409);
  const total = Array.from({ length: 9 }, (_, i) => levelNeed(i + 1)).reduce((a, b) => a + b);
  db.prepare('UPDATE characters SET totalExp=? WHERE userId=?').run(total, user.id);
  assert.equal((await save(req, cookie, current.revision)).body.error.code, 'CHANGE_LOCKED');
  const appearance = { ...changed, appearance: { ...changed.appearance, hair: 'h7' } };
  current = (await save(req, cookie, current.revision, appearance)).body.character;
  assert.equal(current.progress.level, 10); assert.equal(current.alloc.str, 4);
  current = (await mutate(req, cookie, `${me}/reset`, { revision: current.revision })).body.character;
  assert.equal(current.progress.points, 27); assert.equal(current.alloc.str, 0); assert.equal(current.reset.available, false);
  assert.equal((await mutate(req, cookie, `${me}/reset`, { revision: current.revision })).body.error.code, 'RESET_NOT_READY');
  advance(30 * DAY - 1); assert.equal((await mutate(req, cookie, `${me}/reset`, { revision: current.revision })).status, 422);
  advance(1); assert.equal((await req(me, { cookie })).body.character.reset.available, true);
  assert.equal((await mutate(req, cookie, `${me}/reset`, { revision: current.revision })).status, 200);
}));

test('출석 한국시간 경계·하루 한 번·그레인 양방향 연동·정지 계정·캐릭터 없는 출석', async () => scenario(async ({ req, db, login, advance }) => {
  const { cookie, user } = await login();
  assert.equal((await mutate(req, cookie, `${me}/checkin`, {})).body.granted, false);
  await save(req, cookie);
  const simultaneous = await Promise.all(Array.from({ length: 4 }, () => mutate(req, cookie, `${me}/checkin`, {})));
  assert.equal(simultaneous.filter(row => row.body.granted).length, 1);
  let result = await mutate(req, cookie, '/api/grain/attendance', {}); assert.equal(result.body.awarded, true);
  assert.equal((await req(me, { cookie })).body.character.progress.totalExp, 30);
  advance(60000);
  assert.equal((await req(me, { cookie })).body.character.checkedInToday, false);
  result = await mutate(req, cookie, '/api/grain/attendance', {}); assert.equal(result.body.awarded, true);
  result = await mutate(req, cookie, `${me}/checkin`, {}); assert.equal(result.body.granted, false); assert.equal(result.body.character.progress.totalExp, 60);
  advance(DAY);
  db.prepare('INSERT INTO grain_reward_suspensions VALUES(?,?,?)').run(user.id, '시험 정지', 0);
  assert.equal((await mutate(req, cookie, `${me}/checkin`, {})).body.granted, false);
  assert.equal((await mutate(req, cookie, '/api/grain/attendance', {})).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_exp_events').get().n, 2);
}));

test('커뮤니티 확정만 경험치 지급·중복·취소·공개 캐릭터·회원 식별자 미노출', async () => scenario(async ({ req, db, login, rewards, advance }) => {
  const alice = await login(), bob = await login('writer@example.test'); await save(req, alice.cookie);
  const posts = [];
  for (let i = 0; i < 3; i++) {
    const result = await mutate(req, alice.cookie, '/api/community/posts', { game: 'slimeline', board: 'free', title: `성장 기록 ${i}`, body: `모험을 하며 발견한 기록 ${i} `.repeat(25) });
    assert.equal(result.status, 201); assert.equal(result.body.post.author.character.race, 'human'); posts.push(result.body.post.id);
  }
  const foreign = await mutate(req, bob.cookie, '/api/community/posts', { game: 'slimeline', board: 'free', title: '다른 회원 글', body: '다른 회원이 정성껏 작성한 기록입니다. '.repeat(25) });
  assert.equal(foreign.body.post.author.character, null);
  const reply = await mutate(req, alice.cookie, `/api/community/posts/${foreign.body.post.id}/comments`, { body: '함께 모험해 보니 즐거웠어요. '.repeat(5) }); assert.equal(reply.status, 201);
  const hidden = await mutate(req, bob.cookie, `/api/community/posts/${posts[0]}/comments`, { body: '숨김 처리할 댓글입니다. '.repeat(5) });
  db.prepare('UPDATE community_comments SET hiddenAt=1 WHERE id=?').run(hidden.body.comment.id);
  assert.equal((await req(me, { cookie: alice.cookie })).body.character.progress.totalExp, 0);
  advance(DAY - 1); rewards.tick(); assert.equal((await req(me, { cookie: alice.cookie })).body.character.progress.totalExp, 0);
  advance(1); rewards.tick(); rewards.tick();
  assert.equal((await req(me, { cookie: alice.cookie })).body.character.progress.totalExp, 90);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_exp_events WHERE userId=?').get(alice.user.id).n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_exp_events WHERE userId=?').get(bob.user.id).n, 0);
  const detail = await req(`/api/community/posts/${foreign.body.post.id}?game=slimeline`);
  assert.deepEqual(Object.keys(detail.body.comments[0].author.character).sort(), ['appearance', 'job', 'level', 'race']);
  const list = await req('/api/community/posts?game=slimeline&board=free');
  for (const value of [detail.body, list.body, reply.body]) { const text = JSON.stringify(value); assert.ok(!text.includes(alice.user.id)); assert.ok(!text.includes(bob.user.id)); assert.ok(!text.includes('authorId')); }
  assert.equal(getPublicCharacter(db, alice.user.id).level, 1);
}));

test('경험치 원장은 출처별 횟수·하루 300 상한·중복·없는 캐릭터·정지를 강제한다', async () => scenario(async ({ req, db, login, characters, advance }) => {
  const { cookie, user } = await login(); await save(req, cookie);
  const grant = (id, source) => inTransaction(db, () => characters.grantInTransaction(user.id, id, source));
  assert.equal(grant('same', 'post').granted, true); assert.equal(grant('same', 'comment').granted, false);
  assert.equal(grant('second', 'post').granted, true); assert.equal(grant('third', 'post').granted, false);
  for (let i = 0; i < 6; i++) assert.equal(grant(`reply-${i}`, 'comment').granted, i < 5);
  assert.equal(grant('checkin', 'attendance').granted, true); assert.equal(grant('checkin-two', 'attendance').granted, false);
  assert.equal(characters.snapshot(user.id).progress.totalExp, 160);
  advance(DAY);
  // 現行の三出처では160が最大。将来の別出処が加わった場合も合計上限を守るか、既存原帳で再現します。
  db.prepare('INSERT INTO character_exp_events VALUES(?,?,?,?,?,?)').run('cap-fixture', user.id, 'post', 295, '2026-11-19', 0);
  assert.equal(grant('cap-comment', 'comment').granted, false);
  assert.equal(grant('cap-attendance', 'attendance').granted, false);
  assert.equal(db.prepare("SELECT SUM(amount) AS n FROM character_exp_events WHERE expDate='2026-11-19'").get().n, 295);
  advance(DAY); db.prepare('INSERT INTO grain_reward_suspensions VALUES(?,?,?)').run(user.id, '시험 정지', 0);
  assert.equal(grant('suspended', 'post').granted, false);
  assert.throws(() => characters.grantInTransaction(user.id, 'outside', 'post'), /트랜잭션/);
}));

test('계정 삭제 시 캐릭터와 원장 연쇄 삭제', async () => scenario(async ({ req, db, login }) => {
  const { cookie, user } = await login(); await save(req, cookie); await mutate(req, cookie, `${me}/checkin`, {});
  // 기존 서버에는 성인 탈퇴 API가 없어 계정 삭제의 DB 경계를 직접 검증합니다.
  db.prepare('DELETE FROM user WHERE id=?').run(user.id);
  assert.equal((await req(me, { cookie })).status, 401);
  for (const table of ['characters', 'character_exp_events']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE userId=?`).get(user.id).n, 0);
}));

test('API 출처·JSON·요청 제한·보안 헤더를 기존 공통 경계에서 적용한다', async () => scenario(async ({ req, login }) => {
  const { cookie } = await login();
  assert.equal((await req(me, { cookie, method: 'PUT', origin: 'https://other.example.test', body: { revision: 0, data: createDefaultCharacter() } })).status, 403);
  assert.equal((await req(me, { cookie, method: 'PUT', body: {}, headers: { 'content-type': 'text/plain' } })).status, 415);
  const response = await req(me, { cookie });
  assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(response.headers['x-content-type-options'], 'nosniff'); assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
  await save(req, cookie); assert.equal((await mutate(req, cookie, `${me}/checkin`, { userId: 'other' })).status, 422);
  assert.equal((await mutate(req, cookie, `${me}/checkin`, {})).status, 429);
}, { rateLimit: { authMax: 150, readMax: 300, writeMax: 4 } }));

test('그레인 출석·경험치 저장 실패는 양쪽 기록을 함께 롤백하고 재시도한다', async () => scenario(async ({ req, db, login }) => {
  const { cookie, user } = await login(); await save(req, cookie);
  db.exec("CREATE TRIGGER fail_character_exp BEFORE INSERT ON character_exp_events BEGIN SELECT RAISE(ABORT,'시험용 경험치 실패'); END;");
  assert.equal((await mutate(req, cookie, '/api/grain/attendance', {})).status, 500);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM grain_activity_rewards WHERE targetType='attendance'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM grain_ledger WHERE eventId LIKE 'attendance:%'").get().n, 0);
  assert.equal(db.prepare('SELECT totalExp FROM characters WHERE userId=?').get(user.id).totalExp, 0);
  db.exec('DROP TRIGGER fail_character_exp');
  assert.equal((await mutate(req, cookie, '/api/grain/attendance', {})).body.awarded, true);
  assert.equal((await req(me, { cookie })).body.character.progress.totalExp, 30);
}));

test('확정 트랜잭션 실패 롤백·재시작 자동 확정·반복 재시작 멱등성을 보장한다', async () => scenario(async ({ req, db, login, rewards, advance, restart }) => {
  const { cookie, user } = await login(); await save(req, cookie);
  await mutate(req, cookie, '/api/community/posts', { game: 'slimeline', board: 'free', title: '재시작 성장 기록', body: '재시작 후 확정할 정성스러운 기록입니다. '.repeat(10) });
  advance(DAY);
  db.exec("CREATE TRIGGER fail_character_exp BEFORE INSERT ON character_exp_events BEGIN SELECT RAISE(ABORT,'시험용 경험치 실패'); END;");
  assert.throws(() => rewards.tick(), /경험치 실패/);
  assert.equal(db.prepare('SELECT status FROM grain_activity_rewards').get().status, 'pending');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM grain_ledger WHERE eventId LIKE 'community-post:%'").get().n, 0);
  assert.equal(db.prepare('SELECT totalExp FROM characters WHERE userId=?').get(user.id).totalExp, 0);
  db.exec('DROP TRIGGER fail_character_exp'); await restart(); await restart();
  assert.equal((await req(me, { cookie })).body.character.progress.totalExp, 40);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_exp_events').get().n, 1);
}));

test('확정 전 삭제·부모 숨김·보상 정지는 경험치를 주지 않는다', async () => scenario(async ({ req, db, login, rewards, advance }) => {
  const alice = await login(), bob = await login('cancelled@example.test');
  await save(req, alice.cookie); await save(req, bob.cookie);
  const post = async (title, actor) => (await mutate(req, actor.cookie, '/api/community/posts', { game: 'slimeline', board: 'free', title, body: `${title} 기록입니다. `.repeat(15) })).body.post;
  const deleted = await post('삭제할 글', alice);
  assert.equal((await mutate(req, alice.cookie, `/api/community/posts/${deleted.id}`, {}, 'DELETE')).status, 200);
  const hidden = await post('숨길 부모 글', alice);
  await mutate(req, bob.cookie, `/api/community/posts/${hidden.id}/comments`, { body: '부모가 숨겨지면 경험치를 받을 수 없어요. '.repeat(3) });
  db.prepare('UPDATE community_posts SET hiddenAt=1 WHERE id=?').run(hidden.id);
  await post('정지 전에 작성한 글', bob);
  db.prepare('INSERT INTO grain_reward_suspensions VALUES(?,?,?)').run(bob.user.id, '시험 정지', 0);
  advance(DAY); rewards.tick();
  for (const actor of [alice, bob]) assert.equal((await req(me, { cookie: actor.cookie })).body.character.progress.totalExp, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_exp_events').get().n, 0);
}));

test('경험치 하루 300 경계까지 허용하고 다음 지급을 차단한다', async () => scenario(async ({ req, db, login, characters }) => {
  const { cookie, user } = await login(); await save(req, cookie);
  db.prepare('INSERT INTO character_exp_events VALUES(?,?,?,?,?,?)').run('cap-boundary', user.id, 'post', 290, '2026-11-18', 0);
  assert.equal(inTransaction(db, () => characters.grantInTransaction(user.id, 'boundary-comment', 'comment')).granted, true);
  assert.equal(inTransaction(db, () => characters.grantInTransaction(user.id, 'boundary-attendance', 'attendance')).granted, false);
  assert.equal(db.prepare('SELECT SUM(amount) AS n FROM character_exp_events').get().n, 300);
}));
