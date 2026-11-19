import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VILLAGES, villageForUser } from '../server/village/villages.js';
import { scenario, seedMember, request, upgradeStatus, delay } from './village-helpers.js';

const welcome = peer => peer.wait(message => message.type === 'welcome');
const error = (peer, code) => peer.wait(message => message.type === 'error' && message.code === code);
const adminId = 'village-group-admin';

test('마을 정의는 두 곳이며 기존 가입 구분과 입장 조건으로만 배정한다', () => {
  assert.deepEqual(Object.keys(VILLAGES), ['kids', 'general']);
  assert.equal(villageForUser({ ageBand: 'under14' }).id, 'kids');
  for (const ageBand of ['14plus', 'legacy', undefined]) assert.equal(villageForUser({ ageBand }).id, 'general');
  let guardianChecked = false;
  VILLAGES.kids.assertEntry({ ageBand: 'under14' }, { assertGuardian() { guardianChecked = true; } }); assert.equal(guardianChecked, true);
  assert.throws(() => VILLAGES.kids.assertEntry({ ageBand: '14plus' }, { assertGuardian() {} }), { code: 'INVALID_VILLAGE' });
  assert.throws(() => VILLAGES.general.assertEntry({ ageBand: 'under14' }), { code: 'INVALID_VILLAGE' });
  assert.ok(Object.values(VILLAGES).every(village => typeof village.assertEntry === 'function' && village.mapPath === '/assets/village/maps/plaza.json'));
});

test('v5 어린이는 어린이 마을, 14plus·legacy는 청소년·성인 마을에 들어간다', async () => scenario(async ({ app, db, signup, connect }) => {
  const member = await signup('assignment'), child = seedMember(db, member.id, 'child', { child: true }), legacy = seedMember(db, member.id, 'legacy');
  db.prepare("UPDATE user SET ageBand='legacy' WHERE id=?").run(legacy.id);
  for (const [person, group] of [[member, 'general'], [legacy, 'general'], [child, 'kids']]) {
    const session = await request(app, '/api/village/session', { cookie: person.cookie });
    assert.equal(session.body.village.id, group); assert.deepEqual(session.body.villages, []);
    const state = await welcome(await connect(person)); assert.equal(state.village.id, group);
    assert.doesNotMatch(JSON.stringify(state), /email|ageBand|session_token/);
  }
  const old = seedMember(db, member.id, 'old-consent', { child: true, consentVersion: '2026-10-16-v4' });
  assert.equal((await request(app, '/api/village/session', { cookie: old.cookie })).body.error.code, 'VILLAGE_GUARDIAN_CONSENT_REQUIRED');
  assert.equal(await upgradeStatus(app, old.cookie), 403);
}));

test('일반 회원은 상대 마을의 채널·둘러보기 요청으로 입장할 수 없다', async () => scenario(async ({ db, signup, connect }) => {
  const adult = await signup('entry-guard'), legacy = seedMember(db, adult.id, 'legacy-guard'), child = seedMember(db, adult.id, 'child-guard', { child: true });
  db.prepare("UPDATE user SET ageBand='legacy' WHERE id=?").run(legacy.id);
  for (const [member, own, other] of [[adult, 'general', 'kids'], [legacy, 'general', 'kids'], [child, 'kids', 'general']]) {
    const peer = await connect(member); await welcome(peer);
    peer.send({ type: 'channel', villageId: other, channelId: 1 }); await error(peer, 'INVALID_VILLAGE');
    peer.send({ type: 'tour', villageId: other }); await error(peer, 'ADMIN_REQUIRED');
    peer.send({ type: 'tour', villageId: other, isOperator: true }); await error(peer, 'INVALID_INPUT');
    assert.ok(peer.messages.filter(message => message.type === 'welcome').every(message => message.village.id === own));
  }
}));

test('두 마을은 이동·채팅·감정·신고·채널 목록을 공유하지 않으며 같은 마을 안에서는 전달한다', async () => scenario(async ({ app, db, signup, connect }) => {
  const adult = await signup('partition'), adultFriend = seedMember(db, adult.id, 'general-friend');
  const child = seedMember(db, adult.id, 'kids-one', { child: true }), childFriend = seedMember(db, adult.id, 'kids-two', { child: true });
  const one = await connect(adult), two = await connect(adultFriend), small = await connect(child), friend = await connect(childFriend);
  for (const peer of [one, two, small, friend]) await welcome(peer);
  one.send({ type: 'move', path: [{ x: 21, y: 20 }] });
  await two.wait(message => message.type === 'snapshot' && message.players.some(player => player.id === adult.id && player.x === 21));
  one.send({ type: 'chat', text: '이 마을에서만 나누는 대화' }); await two.wait(message => message.text === '이 마을에서만 나누는 대화');
  one.send({ type: 'emote', id: 'heart' }); await two.wait(message => message.type === 'emote' && message.userId === adult.id);
  small.send({ type: 'chat', text: '자유 입력 우회' }); await error(small, 'CHILD_FREE_CHAT');
  small.send({ type: 'phrase', id: 'hello' }); await friend.wait(message => message.text === '안녕!');
  small.send({ type: 'emote', id: 'wave' }); await friend.wait(message => message.type === 'emote' && message.userId === child.id);
  await delay(150);
  assert.ok(!small.messages.some(message => message.userId === adult.id || message.type === 'snapshot' && message.players.some(player => player.id === adult.id)));
  assert.ok(!two.messages.some(message => message.userId === child.id));
  const report = (member, target) => request(app, '/api/village/reports', { method: 'POST', cookie: member.cookie, body: { targetId: target.id, reason: '신고 범위 확인' } });
  assert.equal((await report(adult, child)).status, 422); assert.equal((await report(child, adult)).status, 422);
  const ownReport = await report(childFriend, child); assert.equal(ownReport.status, 201);
  assert.equal(db.prepare('SELECT villageId FROM village_reports WHERE id=?').get(ownReport.body.report.id).villageId, 'kids');
  one.send({ type: 'channel', channelId: 2, villageId: 'general' }); await one.wait(message => message.type === 'welcome' && message.channelId === 2);
  assert.equal((await report(adult, adultFriend)).status, 422);
  assert.equal((await request(app, '/api/village/session', { cookie: child.cookie })).body.channels.length, 1);
}));

test('두 마을의 51번째 회원은 각각 자기 마을의 2번 채널로 배정된다', async () => scenario(async ({ db, signup, connect }) => {
  const template = await signup('separate-capacity');
  for (const group of ['general', 'kids']) for (let index = 0; index < 51; index++) {
    const member = group === 'general' && index === 0 ? template : seedMember(db, template.id, `${group}-${index}`, { child: group === 'kids' });
    const state = await welcome(await connect(member));
    assert.equal(state.village.id, group); assert.equal(state.channelId, index < 50 ? 1 : 2);
    if (index === 50) assert.deepEqual(state.channels.map(channel => channel.count), [50, 1]);
  }
}));

test('연령 구분이나 유효한 동의 정보가 바뀌면 종료하고 새 상태에 맞춰 재접속한다', async () => scenario(async ({ app, db, signup, connect }) => {
  const template = await signup('changed-state'), member = seedMember(db, template.id, 'changing-child', { child: true });
  let peer = await connect(member); await welcome(peer);
  db.prepare("UPDATE user SET ageBand='14plus' WHERE id=?").run(member.id);
  peer.send({ type: 'phrase', id: 'hello' }); assert.equal((await peer.closeEvent).code, 4004);
  peer = await connect(member); assert.equal((await welcome(peer)).village.id, 'general');
  db.prepare("UPDATE user SET ageBand='legacy' WHERE id=?").run(member.id);
  peer.send({ type: 'phrase', id: 'hello' }); assert.equal((await peer.closeEvent).code, 4004);
  peer = await connect(member); await welcome(peer);
  db.prepare("UPDATE user SET ageBand='under14' WHERE id=?").run(member.id);
  peer.send({ type: 'phrase', id: 'hello' }); assert.equal((await peer.closeEvent).code, 4004);
  peer = await connect(member); assert.equal((await welcome(peer)).village.id, 'kids');
  db.prepare("UPDATE guardian_requests SET consentVersion='2026-12-01-v6' WHERE childUserId=?").run(member.id);
  peer.send({ type: 'phrase', id: 'hello' }); assert.equal((await peer.closeEvent).code, 4004);
  peer = await connect(member); await welcome(peer);
  db.prepare("UPDATE guardian_requests SET consentVersion='2026-10-16-v4' WHERE childUserId=?").run(member.id);
  peer.send({ type: 'phrase', id: 'hello' }); await error(peer, 'VILLAGE_GUARDIAN_CONSENT_REQUIRED'); assert.equal((await peer.closeEvent).code, 4003);
  assert.equal(await upgradeStatus(app, member.cookie), 403);
}));

test('보호자 동의 철회는 다음 검사에서 연결을 종료한다', async () => scenario(async ({ app, db, signup, connect }) => {
  const template = await signup('withdrawal'), member = seedMember(db, template.id, 'withdrawn-child', { child: true });
  const peer = await connect(member); await welcome(peer);
  db.prepare("UPDATE guardian_requests SET status='withdrawn' WHERE childUserId=?").run(member.id);
  peer.send({ type: 'phrase', id: 'bye' }); await error(peer, 'AUTH_REQUIRED'); assert.equal((await peer.closeEvent).code, 4001);
  assert.equal(await upgradeStatus(app, member.cookie), 401);
}));

test('운영자는 두 마을을 둘러보되 어린이 마을에서 자유 대화를 보내지 못한다', async () => scenario(async ({ app, db, signup, connect }) => {
  const general = await signup('operator-tour'), child = seedMember(db, general.id, 'tour-child', { child: true }), admin = seedMember(db, general.id, 'operator', { userId: adminId });
  const generalPeer = await connect(general), childPeer = await connect(child), operator = await connect(admin); await welcome(operator);
  operator.send({ type: 'tour', villageId: 'kids' });
  const tour = await operator.wait(message => message.type === 'welcome' && message.village.id === 'kids');
  assert.equal(tour.isOperator, true); assert.ok(tour.players.find(player => player.id === admin.id).isOperator);
  operator.send({ type: 'chat', text: '운영자 자유 대화 우회' }); await error(operator, 'CHILD_FREE_CHAT');
  operator.send({ type: 'phrase', id: 'thanks' }); await childPeer.wait(message => message.text === '고마워');
  await request(app, '/api/village/reports', { method: 'POST', cookie: child.cookie, body: { targetId: admin.id, reason: '운영 마을 이름 확인' } });
  assert.equal((await request(app, '/api/admin/village/reports', { cookie: admin.cookie })).body.reports[0].villageName, '어린이 마을');
  const mute = await request(app, '/api/admin/village/mutes', { method: 'POST', cookie: admin.cookie, body: { targetId: child.id, durationMinutes: 1, reason: '마을 표시 확인' } });
  assert.equal(mute.body.mute.villageName, '어린이 마을');
  operator.send({ type: 'tour', villageId: 'general' }); await operator.wait(message => message.type === 'welcome' && message.village.id === 'general');
  operator.send({ type: 'chat', text: '함께 이용하는 마을 안내' }); await generalPeer.wait(message => message.text === '함께 이용하는 마을 안내');
}, { adminUserIds: adminId }));

test('제거한 설정 경로는 404이며 새 DB에는 관련 테이블을 만들지 않고 남은 로컬 테이블도 무시한다', async () => scenario(async ({ app, db, signup, connect, restart }) => {
  const member = await signup('removed-api'), admin = seedMember(db, member.id, 'removed-admin', { userId: adminId });
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'village_%' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(names, ['village_admin_audit', 'village_avatars', 'village_blocks', 'village_mutes', 'village_reports']);
  for (const path of ['/api/village/profile', '/api/admin/village/profiles', `/api/admin/village/profiles/${member.id}`]) for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) for (const cookie of [undefined, member.cookie, admin.cookie]) {
    assert.equal((await request(app, path, { method, cookie, ...(method === 'GET' ? {} : { body: {} }) })).status, 404);
  }
  db.exec("CREATE TABLE village_profiles(userId TEXT PRIMARY KEY,birthYear INTEGER); INSERT INTO village_profiles VALUES('unused',1900); ALTER TABLE village_admin_audit ADD COLUMN details TEXT NOT NULL DEFAULT '{}';");
  const next = await restart();
  assert.equal((await request(next, '/api/village/session', { cookie: member.cookie })).body.village.id, 'general');
  assert.equal((await welcome(await connect(member))).village.id, 'general');
  assert.equal(db.prepare('SELECT birthYear FROM village_profiles').get().birthYear, 1900);
}, { adminUserIds: adminId }));
