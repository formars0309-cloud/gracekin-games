import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { schoolCalendar, villageForBirthYear, VILLAGES } from '../server/village/age-group.js';
import { createVillageStore } from '../server/village/store.js';
import { scenario, seedMember, request, upgradeStatus, avatar, delay } from './village-helpers.js';

const welcome = peer => peer.wait(message => message.type === 'welcome');
const error = (peer, code) => peer.wait(message => message.type === 'error' && message.code === code);
const saveYear = (app, member, birthYear, extra = {}) => request(app, '/api/village/profile', { method: 'POST', cookie: member.cookie, body: { birthYear, confirmed: true, ...extra } });
const adminId = 'village-age-admin';
const correct = (app, admin, target, birthYear, expectedRevision, reason = '회원 문의와 출생연도 확인') => request(app, '/api/admin/village/profiles', { method: 'POST', cookie: admin.cookie, body: { targetId: target.id, birthYear, expectedRevision, reason } });

test('서울 3월 1일 경계와 2026·2027학년도의 네 마을·미취학을 서버에서 계산한다', () => {
  const last = Date.parse('2026-02-28T23:59:59.999+09:00'), first = last + 1;
  assert.equal(schoolCalendar(last).schoolYear, 2025); assert.equal(schoolCalendar(first).schoolYear, 2026);
  assert.equal(villageForBirthYear(2013, last).id, 'elementary'); assert.equal(villageForBirthYear(2013, first).id, 'middle');
  const years = [[2026, { elementary: [2014, 2019], middle: [2011, 2013], high: [2008, 2010], adult: [1926, 2007] }], [2027, { elementary: [2015, 2020], middle: [2012, 2014], high: [2009, 2011], adult: [1927, 2008] }]];
  for (const [year, groups] of years) {
    const time = Date.parse(`${year}-03-01T00:00:00+09:00`);
    for (const [group, [from, through]] of Object.entries(groups)) for (let birth = from; birth <= through; birth++) assert.equal(villageForBirthYear(birth, time).id, group);
    assert.throws(() => villageForBirthYear(year - 6, time), { code: 'VILLAGE_PRESCHOOL' });
    assert.deepEqual([schoolCalendar(time).minimumBirthYear, schoolCalendar(time).maximumBirthYear], [year - 100, year - 7]);
  }
  assert.equal(schoolCalendar(Date.parse('2027-02-28T15:00:00Z')).schoolYear, 2027);
  assert.ok(Object.values(VILLAGES).every(village => village.mapPath === '/assets/village/maps/plaza.json'));
});

test('출생연도는 명시적 확인 뒤 한 번만 저장하고 옷장·입장보다 먼저 요구한다', async () => scenario(async ({ app, signup, connect, db }) => {
  const member = await signup('year-once', { birthYear: null });
  const session = await request(app, '/api/village/session', { cookie: member.cookie });
  assert.equal(session.body.profile, null); assert.deepEqual(session.body.channels, []);
  assert.deepEqual([session.body.birthYearOptions.minimumBirthYear, session.body.birthYearOptions.maximumBirthYear], [1926, 2019]);
  await assert.rejects(connect(member), /연결 거부/);
  assert.equal((await request(app, '/api/village/avatar', { method: 'PUT', cookie: member.cookie, body: { avatar, revision: 0 } })).status, 409);
  assert.equal((await saveYear(app, member, 2000, { confirmed: false })).status, 422);
  for (const value of ['2000', 2000.5, 1925, 2027]) assert.equal((await saveYear(app, member, value)).status, 422);
  assert.equal((await saveYear(app, member, 2020)).body.error.code, 'VILLAGE_PRESCHOOL');
  const saved = await saveYear(app, member, 2000);
  assert.equal(saved.status, 201); assert.equal(saved.body.profile.village.id, 'adult'); assert.equal(saved.body.profile.revision, 1);
  assert.equal((await saveYear(app, member, 1999)).body.error.code, 'BIRTH_YEAR_LOCKED');
  assert.equal((await request(app, '/api/village/profile', { method: 'PATCH', cookie: member.cookie, body: { birthYear: 1999 } })).status, 404);
  assert.equal((await request(app, '/api/village/profile', { method: 'DELETE', cookie: member.cookie, body: {} })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM village_profiles WHERE userId=?').get(member.id).n, 1);
  const peer = await connect(member), state = await welcome(peer);
  assert.equal(state.village.id, 'adult'); assert.doesNotMatch(JSON.stringify(state), /birthYear|ageBand|session_token|email/);
}));

test('가입 연령과 출생연도 일관성을 확인하며 v5 어린이만 초등학생 마을에 입장한다', async () => scenario(async ({ app, db, signup, connect }) => {
  const adult = await signup('age-consistency', { birthYear: null });
  const child = seedMember(db, adult.id, 'current-child', { child: true, birthYear: null });
  assert.equal((await saveYear(app, child, 2011)).body.error.code, 'AGE_ACCOUNT_MISMATCH');
  assert.equal((await saveYear(app, child, 2017)).status, 201);
  const small = await connect(child); assert.equal((await welcome(small)).village.id, 'elementary');
  assert.equal((await saveYear(app, adult, 2015)).body.error.message, '어린이 회원은 보호자 동의 가입이 필요해요');
  const legacy = seedMember(db, adult.id, 'legacy-age', { birthYear: null }); db.prepare("UPDATE user SET ageBand='legacy' WHERE id=?").run(legacy.id);
  assert.equal((await saveYear(app, legacy, 2015)).status, 403);
  assert.equal((await saveYear(app, adult, 2012)).body.profile.village.id, 'middle');
  assert.equal((await saveYear(app, legacy, 2000)).body.profile.village.id, 'adult');
  const old = seedMember(db, adult.id, 'v4-child', { child: true, birthYear: 2017, consentVersion: '2026-10-16-v4' });
  assert.equal((await request(app, '/api/village/session', { cookie: old.cookie })).body.error.code, 'VILLAGE_GUARDIAN_CONSENT_REQUIRED');
  assert.equal(await upgradeStatus(app, old.cookie), 403);
  db.prepare('DELETE FROM guardian_requests WHERE childUserId=?').run(old.id);
  assert.equal(await upgradeStatus(app, old.cookie), 401);
  // 저장소에 잘못된 배정 값이 있어도 출입 경계에서 다시 막습니다.
  db.prepare('UPDATE village_profiles SET birthYear=2017 WHERE userId=?').run(adult.id);
  assert.equal((await request(app, '/api/village/session', { cookie: adult.cookie })).body.error.code, 'VILLAGE_ELEMENTARY_GUARDIAN_REQUIRED');
  assert.equal(await upgradeStatus(app, adult.cookie), 403);
}));

test('2월에는 계정 연령 검사를 통과하는 연도라도 보호자 동의 없는 초등학생 입장을 따로 막는다', async () => scenario(async ({ app, db, signup }) => {
  const adult = await signup('feb-elementary', { birthYear: null });
  assert.equal((await saveYear(app, adult, 2013)).body.error.code, 'VILLAGE_ELEMENTARY_GUARDIAN_REQUIRED');
  db.prepare("UPDATE user SET ageBand='legacy' WHERE id=?").run(adult.id);
  assert.equal((await saveYear(app, adult, 2013)).status, 403);
}, { initialTime: Date.parse('2026-02-28T23:59:59+09:00') }));

test('네 마을은 같은 채널 번호라도 입장·이동·채팅·감정·신고와 채널 목록을 공유하지 않는다', async () => scenario(async ({ app, db, signup, connect }) => {
  const adult = await signup('partition');
  const members = { adult, elementary: seedMember(db, adult.id, 'elementary', { child: true, birthYear: 2017 }), middle: seedMember(db, adult.id, 'middle', { birthYear: 2012 }), high: seedMember(db, adult.id, 'high', { birthYear: 2009 }) };
  const peers = {};
  for (const [villageId, member] of Object.entries(members)) {
    peers[villageId] = await connect(member); const state = await welcome(peers[villageId]);
    assert.equal(state.village.id, villageId); assert.equal(state.channelId, 1); assert.equal(state.players.length, 1); assert.equal(state.channels[0].count, 1);
  }
  const other = seedMember(db, adult.id, 'same-adult'), observer = await connect(other); await welcome(observer);
  peers.adult.send({ type: 'move', path: [{ x: 21, y: 20 }] });
  await observer.wait(message => message.type === 'snapshot' && message.players.some(player => player.id === adult.id && player.x === 21));
  peers.adult.send({ type: 'chat', text: '성인 마을 안에서만' }); await observer.wait(message => message.text === '성인 마을 안에서만');
  peers.adult.send({ type: 'emote', id: 'heart' }); await observer.wait(message => message.type === 'emote' && message.userId === adult.id);
  peers.elementary.send({ type: 'phrase', id: 'hello' }); await peers.elementary.wait(message => message.type === 'chat');
  await delay(150);
  for (const id of ['elementary', 'middle', 'high']) {
    assert.ok(!peers[id].messages.some(message => message.userId === adult.id));
    assert.ok(!peers[id].messages.some(message => message.type === 'snapshot' && message.players.some(player => player.id === adult.id)));
  }
  assert.ok(!observer.messages.some(message => message.userId === members.elementary.id));
  peers.adult.send({ type: 'channel', villageId: 'middle', channelId: 1 }); await error(peers.adult, 'INVALID_VILLAGE');
  peers.adult.send({ type: 'tour', villageId: 'middle' }); await error(peers.adult, 'ADMIN_REQUIRED');
  assert.equal((await request(app, '/api/village/reports', { method: 'POST', cookie: adult.cookie, body: { targetId: members.high.id, reason: '다른 마을 신고 우회' } })).status, 422);
  const report = await request(app, '/api/village/reports', { method: 'POST', cookie: other.cookie, body: { targetId: adult.id, reason: '같은 마을 신고 시험' } });
  assert.equal(report.status, 201); const row = db.prepare('SELECT villageId,snapshot FROM village_reports WHERE id=?').get(report.body.report.id);
  assert.equal(row.villageId, 'adult'); assert.ok(JSON.parse(row.snapshot).every(message => message.villageId === 'adult'));
  peers.adult.send({ type: 'channel', villageId: 'adult', channelId: 2 }); await peers.adult.wait(message => message.type === 'welcome' && message.channelId === 2);
  assert.equal((await request(app, '/api/village/reports', { method: 'POST', cookie: adult.cookie, body: { targetId: other.id, reason: '다른 채널 신고 우회' } })).status, 422);
  assert.equal((await request(app, '/api/village/session', { cookie: members.middle.cookie })).body.channels.length, 1);
}));

test('두 마을을 동시에 채워도 각각 50명 다음 회원만 자기 마을 2번 채널로 배정한다', async () => scenario(async ({ db, signup, connect }) => {
  const adult = await signup('separate-capacity');
  const last = {};
  for (let index = 0; index < 51; index++) {
    const member = index === 0 ? adult : seedMember(db, adult.id, `adult-cap-${index}`, { birthYear: 2000 });
    const peer = await connect(member), state = await welcome(peer);
    assert.equal(state.village.id, 'adult'); assert.equal(state.channelId, index < 50 ? 1 : 2); last.adult = state;
  }
  for (let index = 0; index < 51; index++) {
    const member = seedMember(db, adult.id, `child-cap-${index}`, { child: true, birthYear: 2017 });
    const peer = await connect(member), state = await welcome(peer);
    assert.equal(state.village.id, 'elementary'); assert.equal(state.channelId, index < 50 ? 1 : 2); last.elementary = state;
  }
  for (const state of Object.values(last)) assert.deepEqual(state.channels.map(channel => channel.count), [50, 1]);
}));

test('운영자 출생연도 수정은 권한·사유·동시 수정을 검사하고 감사 기록과 재배정을 원자적으로 남긴다', async () => scenario(async ({ app, db, signup, connect }) => {
  const target = await signup('correct-year', { birthYear: 2009 }), admin = seedMember(db, target.id, 'age-admin', { userId: adminId, birthYear: 2000 });
  const peer = await connect(target); assert.equal((await welcome(peer)).village.id, 'high');
  const lookupPath = `/api/admin/village/profiles/${target.id}`;
  assert.equal((await request(app, lookupPath, { cookie: target.cookie })).status, 403);
  assert.equal((await correct(app, target, target, 2000, 1)).status, 403);
  const loaded = await request(app, lookupPath, { cookie: admin.cookie }); assert.equal(loaded.body.profile.birthYear, 2009); assert.equal(loaded.body.villageName, '고등학생 마을');
  assert.equal((await correct(app, admin, target, 2000, 1, '')).status, 422);
  assert.equal((await correct(app, admin, target, 2017, 1)).status, 403);
  const changed = await correct(app, admin, target, 2000, 1); assert.equal(changed.status, 200); assert.equal(changed.body.profile.village.id, 'adult');
  await error(peer, 'VILLAGE_CHANGED'); assert.equal((await peer.closeEvent).code, 4004);
  const joined = await connect(target); assert.equal((await welcome(joined)).village.id, 'adult');
  const audit = db.prepare("SELECT * FROM village_admin_audit WHERE action='birth_year_correction'").get();
  assert.equal(audit.actorId, admin.id); assert.equal(audit.reason, '회원 문의와 출생연도 확인'); assert.deepEqual(JSON.parse(audit.details), { beforeBirthYear: 2009, afterBirthYear: 2000, revision: 2 });
  const concurrent = await Promise.all([correct(app, admin, target, 2001, 2), correct(app, admin, target, 2002, 2)]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
  const before = db.prepare('SELECT * FROM village_profiles WHERE userId=?').get(target.id);
  db.exec("CREATE TRIGGER reject_year_audit BEFORE INSERT ON village_admin_audit WHEN NEW.action='birth_year_correction' BEGIN SELECT RAISE(ABORT,'시험 감사 실패'); END;");
  assert.equal((await correct(app, admin, target, 1999, 3)).status, 500);
  assert.deepEqual(db.prepare('SELECT * FROM village_profiles WHERE userId=?').get(target.id), before);
  db.exec('DROP TRIGGER reject_year_audit');
  const history = await request(app, lookupPath, { cookie: admin.cookie }); assert.equal(history.body.audit.length, 2);
}, { adminUserIds: adminId }));

test('서울 새 학년도 검사 때 연결을 종료하고 초등→중학·고등→성인으로 다시 입장시킨다', async () => scenario(async ({ app, db, signup, connect, advance }) => {
  const high = await signup('school-rollover', { birthYear: 2008 }), elementary = seedMember(db, high.id, 'school-child', { child: true, birthYear: 2014 });
  const one = await connect(high), two = await connect(elementary);
  assert.equal((await welcome(one)).village.id, 'high'); assert.equal((await welcome(two)).village.id, 'elementary');
  advance(1);
  one.send({ type: 'phrase', id: 'hello' }); two.send({ type: 'phrase', id: 'hello' });
  assert.equal((await one.closeEvent).code, 4004); assert.equal((await two.closeEvent).code, 4004);
  assert.equal((await welcome(await connect(high))).village.id, 'adult'); assert.equal((await welcome(await connect(elementary))).village.id, 'middle');
  assert.equal((await request(app, '/api/village/session', { cookie: elementary.cookie })).body.birthYearOptions.schoolYear, 2027);
}, { initialTime: Date.parse('2027-02-28T23:59:59.999+09:00') }));

test('운영자는 네 마을을 둘러보며 운영자 표시·마을별 신고와 제한 이름을 확인한다', async () => scenario(async ({ app, db, signup, connect }) => {
  const member = await signup('tour-target'), admin = seedMember(db, member.id, 'tour-admin', { userId: adminId, birthYear: 2000 });
  const observer = await connect(member), operator = await connect(admin); await welcome(operator);
  for (const id of ['elementary', 'middle', 'high', 'adult']) {
    const start = operator.messages.length;
    operator.send({ type: 'tour', villageId: id });
    const state = await operator.wait(message => operator.messages.indexOf(message) >= start && message.type === 'welcome' && message.village.id === id);
    assert.equal(state.isOperator, true); assert.ok(state.players.find(player => player.id === admin.id).isOperator);
    await delay(2100);
  }
  operator.send({ type: 'chat', text: '운영자 신고 검토 대화' }); await observer.wait(message => message.text === '운영자 신고 검토 대화');
  await request(app, '/api/village/reports', { method: 'POST', cookie: member.cookie, body: { targetId: admin.id, reason: '운영 마을 이름 시험' } });
  assert.equal((await request(app, '/api/admin/village/reports', { cookie: admin.cookie })).body.reports[0].villageName, '성인 마을');
  const mute = await request(app, '/api/admin/village/mutes', { method: 'POST', cookie: admin.cookie, body: { targetId: member.id, durationMinutes: 1, reason: '마을 구분 확인' } });
  assert.equal(mute.body.mute.villageName, '성인 마을');
  assert.equal((await request(app, '/api/admin/village/mutes', { cookie: admin.cookie })).body.mutes[0].villageName, '성인 마을');
}, { adminUserIds: adminId }));

test('이전 통합 광장 DB는 출생연도를 추정하지 않고 마을 미구분 이력을 보존하여 이관한다', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('하나'),('둘');
      CREATE TABLE village_reports(id TEXT PRIMARY KEY,reporterId TEXT,targetId TEXT,channelId INTEGER,reason TEXT,snapshot TEXT,createdAt INTEGER);
      CREATE TABLE village_mutes(userId TEXT PRIMARY KEY,until INTEGER,reason TEXT,actorId TEXT,createdAt INTEGER);
      CREATE TABLE village_admin_audit(id TEXT PRIMARY KEY,actorId TEXT,targetId TEXT,action TEXT,until INTEGER,reason TEXT,createdAt INTEGER);
      INSERT INTO village_reports VALUES('예전','하나','둘',1,'예전 신고','[]',1);`);
    const store = createVillageStore(db, Date.now);
    assert.equal(db.prepare('SELECT villageId FROM village_reports').get().villageId, 'legacy');
    assert.equal(store.profile('하나'), null); assert.equal(db.prepare('SELECT COUNT(*) n FROM village_profiles').get().n, 0);
  } finally { db.close(); }
});
