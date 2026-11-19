import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scenario, seedMember, request, avatar, delay, upgradeStatus } from './village-helpers.js';
import { containsBlockedWord } from '../server/village/filter.js';

const welcome = peer => peer.wait(message => message.type === 'welcome');
const error = (peer, code) => peer.wait(message => message.type === 'error' && message.code === code);
const sendChat = (peer, text) => { peer.send({ type: 'chat', text }); return peer.wait(message => message.type === 'chat' && message.text === text); };
const api = (app, member, path, body, method = 'POST') => request(app, path, { method, cookie: member.cookie, body });

test('비회원·다른 출처·옛 Host·출처 없는 WebSocket 연결을 거부하고 회원 쿠키는 검증한다', async () => scenario(async ({ app, signup, connect }) => {
  const member = await signup('auth');
  assert.equal((await request(app, '/api/village/session')).status, 401);
  await assert.rejects(connect(), /연결 거부/);
  for (const origin of ['https://outside.example.test', 'null', '', `${app.origin}.outside.test`]) await assert.rejects(connect(member, { origin }), /연결 거부/);
  assert.equal(await upgradeStatus(app, member.cookie, { host: 'legacy.example.test' }), 403);
  await assert.rejects(connect({ cookie: member.cookie.replace(/session_token=([^;]+)/, 'session_token=invalid') }), /연결 거부/);
  const peer = await connect(member), state = await welcome(peer);
  assert.equal(state.selfId, member.id); assert.equal(state.channelId, 1);
  const session = await request(app, '/api/village/session', { cookie: member.cookie });
  assert.equal(session.body.user.id, member.id); assert.equal(session.headers['cache-control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(state), /email|session_token|password|ageBand/);
}, { legacyHosts: ['legacy.example.test'] }));

test('두 회원이 서버 이동 변경분·채팅·감정을 수신하고 빈 채널로 이동할 수 있다', async () => scenario(async ({ app, signup, connect }) => {
  const alice = await signup('alice'), bob = await signup('bob');
  const first = await connect(alice), second = await connect(bob);
  const state = await welcome(second); assert.equal(state.players.length, 2);
  first.send({ type: 'move', path: [{ x: 21, y: 20 }, { x: 22, y: 20 }] });
  const moved = await second.wait(message => message.type === 'snapshot' && message.players.some(player => player.id === alice.id && player.x === 22));
  assert.equal(moved.players.find(player => player.id === alice.id).y, 20);
  await sendChat(first, '분수 앞에서 만나자');
  assert.equal((await second.wait(message => message.type === 'chat' && message.text === '분수 앞에서 만나자')).userId, alice.id);
  first.send({ type: 'emote', id: 'heart' });
  assert.equal((await second.wait(message => message.type === 'emote' && message.userId === alice.id)).id, 'heart');
  second.send({ type: 'channel', channelId: 2 });
  const changed = await second.wait(message => message.type === 'welcome' && message.channelId === 2);
  assert.equal(changed.players.length, 1);
  await sendChat(first, '다른 채널에는 들리지 않아'); await delay(180);
  assert.ok(!second.messages.some(message => message.type === 'chat' && message.text === '다른 채널에는 들리지 않아'));
}));

test('51번째 회원은 새 채널에 자동 배정되며 정원인 채널 입장도 거부한다', async () => scenario(async ({ app, db, signup, connect }) => {
  const template = await signup('capacity');
  const peers = [await connect(template)];
  for (let index = 1; index <= 50; index++) peers.push(await connect(seedMember(db, template.id, `capacity-${index}`)));
  const states = await Promise.all(peers.map(welcome));
  assert.equal(states.filter(state => state.channelId === 1).length, 50);
  assert.equal(states[50].channelId, 2);
  const channels = (await request(app, '/api/village/session', { cookie: template.cookie })).body.channels;
  assert.equal(channels.find(room => room.id === 1).count, 50); assert.equal(channels.find(room => room.id === 2).count, 1);
  peers[50].send({ type: 'channel', channelId: 1 }); await error(peers[50], 'CHANNEL_FULL');
  // 같은 채널의 서로 다른 회원으로 도배 제한을 지키며 최근 50개 고리의 경계를 검증합니다.
  for (let index = 0; index < 3; index++) await sendChat(peers[0], `고리의 첫 대상 메시지${index}`);
  for (let index = 1; index < 50; index++) await sendChat(peers[index], `고리를 채우는 메시지${index}`);
  const report = await api(app, template, '/api/village/reports', { targetId: states[1].selfId, reason: '최근 대화 고리 경계 확인' });
  assert.equal(report.status, 201);
  const reporter = seedMember(db, template.id, 'ring-reporter');
  await peers[49].close(); const ringPeer = await connect(reporter); await welcome(ringPeer);
  const firstReport = await api(app, reporter, '/api/village/reports', { targetId: template.id, reason: '최대 50개 보관 경계 확인' });
  assert.equal(firstReport.status, 201);
  const snapshot = JSON.parse(db.prepare('SELECT snapshot FROM village_reports WHERE id=?').get(firstReport.body.report.id).snapshot);
  assert.deepEqual(snapshot.map(message => message.text), ['고리의 첫 대상 메시지2']);
}));

test('충돌·지도 밖·비인접·과속 필드 이동은 서버 위치로 되돌리고 정상 경로의 속도도 제한한다', async () => scenario(async ({ signup, connect }) => {
  const peer = await connect(await signup('movement')); await welcome(peer);
  const map = JSON.parse(await readFile(new URL('../assets/village/maps/plaza.json', import.meta.url), 'utf8'));
  const collision = map.layers.find(layer => layer.name === 'collision'), index = collision.data.findIndex(value => value !== 0);
  for (const payload of [
    { type: 'move', path: [{ x: index % map.width, y: Math.floor(index / map.width) }] },
    { type: 'move', path: [{ x: -1, y: 20 }] }, { type: 'move', path: [{ x: 25, y: 20 }] },
    { type: 'move', path: [{ x: 21, y: 20 }], speed: 100 }, { type: 'move', x: 39, y: 29 },
  ]) {
    const length = peer.messages.length; peer.send(payload);
    const rejected = await peer.wait(message => message.type === 'correction' && peer.messages.indexOf(message) >= length);
    assert.deepEqual({ x: rejected.x, y: rejected.y }, { x: 20, y: 20 });
  }
  const path = Array.from({ length: 8 }, (_, offset) => ({ x: 21 + offset, y: 20 }));
  const start = performance.now(); peer.send({ type: 'move', path });
  await delay(950);
  const own = peer.messages.filter(message => message.type === 'snapshot').flatMap(message => message.players).filter(player => player.id === peer.messages.find(message => message.type === 'welcome').selfId);
  assert.ok(own.length > 0); assert.ok(Math.max(...own.map(player => player.x)) <= 24, '1초 전에 4칸보다 멀리 이동하면 안 됩니다.');
  await peer.wait(message => message.type === 'snapshot' && message.players.some(player => player.x === 28));
  assert.ok(performance.now() - start >= 1750, '8칸 경로가 서버 최대속도를 넘어 순간 완료되면 안 됩니다.');
}));

test('유효한 보호자 동의 어린이는 자유 입력을 우회할 수 없고 정해진 말과 감정만 통과한다', async () => scenario(async ({ app, db, signup, connect }) => {
  const adult = await signup('adult', { birthYear: 2012 }), child = seedMember(db, adult.id, 'child', { child: true });
  const childState = await request(app, '/api/village/session', { cookie: child.cookie });
  assert.equal(childState.status, 200); assert.equal(childState.body.user.canFreeChat, false);
  const listener = await connect(adult), peer = await connect(child); await welcome(peer);
  peer.send({ type: 'chat', text: '버튼을 우회한 자유 입력' }); await error(peer, 'CHILD_FREE_CHAT');
  peer.send({ type: 'phrase', id: 'hello' });
  assert.equal((await listener.wait(message => message.type === 'chat' && message.userId === child.id)).text, '안녕!');
  peer.send({ type: 'emote', id: 'wave' }); await listener.wait(message => message.type === 'emote' && message.userId === child.id);
  assert.ok(!listener.messages.some(message => message.text === '버튼을 우회한 자유 입력'));
  db.prepare("UPDATE guardian_requests SET status='withdrawn' WHERE childUserId=?").run(child.id);
  peer.send({ type: 'phrase', id: 'bye' }); await error(peer, 'AUTH_REQUIRED');
  assert.equal((await peer.closeEvent).code, 4001);
}));

test('금칙어 정규화·확장 목록과 서버 메시지 길이 제한을 적용한다', async () => scenario(async ({ signup, connect }) => {
  assert.equal(containsBlockedWord('시 · 발'), true); assert.equal(containsBlockedWord('안녕'), false);
  assert.equal(containsBlockedWord('금지 예시', ['금지예시']), true);
  const peer = await connect(await signup('filter')); await welcome(peer);
  peer.send({ type: 'chat', text: '시 . 발' }); await error(peer, 'BLOCKED_WORD');
  peer.send({ type: 'chat', text: '가'.repeat(81) }); await error(peer, 'INVALID_INPUT');
  await sendChat(peer, '가'.repeat(80));
}));

test('순간 세 개 이후 도배를 거부하며 연결을 바꿔도 수신자 차단은 유지한다', async () => scenario(async ({ app, signup, connect }) => {
  const alice = await signup('rate'), bob = await signup('block');
  let sender = await connect(alice); const recipient = await connect(bob); await welcome(recipient);
  for (let i = 0; i < 3; i++) await sendChat(sender, `속도시험${i}`);
  sender.send({ type: 'chat', text: '도배 네 번째' }); await error(sender, 'RATE_LIMITED');
  await sender.close(); sender = await connect(alice); await welcome(sender);
  sender.send({ type: 'chat', text: '재접속 도배 우회' }); await error(sender, 'RATE_LIMITED');
  assert.equal((await api(app, bob, '/api/village/blocks', { targetId: alice.id })).status, 200);
  assert.equal((await request(app, '/api/village/blocks', { cookie: bob.cookie })).body.blocks[0].targetId, alice.id);
  await delay(1550); await sendChat(sender, '차단 뒤 대화'); await delay(180);
  assert.ok(!recipient.messages.some(message => message.type === 'chat' && message.text === '차단 뒤 대화'));
  await delay(1400); sender.send({ type: 'emote', id: 'dance' });
  await sender.wait(message => message.type === 'emote' && message.id === 'dance'); await delay(180);
  assert.ok(!recipient.messages.some(message => message.type === 'emote' && message.userId === alice.id));
  await recipient.close(); const reconnected = await connect(bob); await welcome(reconnected);
  await delay(1400); await sendChat(sender, '차단은 재접속 후에도 유지'); await delay(180);
  assert.ok(!reconnected.messages.some(message => message.text === '차단은 재접속 후에도 유지'));
  assert.equal((await api(app, bob, '/api/village/blocks', { targetId: alice.id }, 'DELETE')).status, 200);
  await delay(1400); await sendChat(sender, '차단 해제 뒤 대화');
  await reconnected.wait(message => message.text === '차단 해제 뒤 대화');
}));

test('신고만 DB 스냅숏에 남고 10분 지난 대화는 제외되며 일반 회원은 운영 API를 사용할 수 없다', async () => scenario(async ({ app, db, signup, connect, advance }) => {
  const alice = await signup('reported'), bob = await signup('reporter');
  const sender = await connect(alice), reporter = await connect(bob); await welcome(reporter);
  await sendChat(sender, '신고 증거가 될 최근 대화');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM village_reports').get().n, 0);
  const result = await api(app, bob, '/api/village/reports', { targetId: alice.id, reason: '부적절한 대화 신고 시험' });
  assert.equal(result.status, 201);
  const row = db.prepare('SELECT * FROM village_reports WHERE id=?').get(result.body.report.id), snapshot = JSON.parse(row.snapshot);
  assert.equal(snapshot.length, 1); assert.equal(snapshot[0].text, '신고 증거가 될 최근 대화'); assert.equal(snapshot[0].userId, alice.id);
  assert.equal((await request(app, '/api/admin/village/reports', { cookie: bob.cookie })).status, 403);
  assert.equal((await api(app, bob, '/api/admin/village/mutes', { targetId: alice.id, durationMinutes: 5, reason: '권한 우회 시험' })).status, 403);
  advance(600001);
  const expired = await api(app, bob, '/api/village/reports', { targetId: alice.id, reason: '보관 시간 경과 시험' });
  assert.equal(expired.status, 201);
  assert.deepEqual(JSON.parse(db.prepare('SELECT snapshot FROM village_reports WHERE id=?').get(expired.body.report.id).snapshot), []);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'village_%'").all().map(item => item.name);
  assert.ok(!tables.some(name => /chat|message|history/.test(name)), '평소 대화 전용 DB 테이블을 만들면 안 됩니다.');
}));

test('운영자는 신고를 조회·시간 지정 금지하고 만료 후에는 다시 대화할 수 있다', async () => scenario(async ({ app, db, signup, connect, advance }) => {
  const target = await signup('muted'), admin = seedMember(db, target.id, 'operator', { userId: 'village-operator-fixture' });
  const peer = await connect(target), actor = await connect(admin); await welcome(peer);
  await sendChat(peer, '운영자 검토용 대화');
  assert.equal((await api(app, admin, '/api/village/reports', { targetId: target.id, reason: '운영자 검토 시험' })).status, 201);
  const list = await request(app, '/api/admin/village/reports', { cookie: admin.cookie });
  assert.equal(list.status, 200); assert.equal(list.body.reports[0].snapshot[0].text, '운영자 검토용 대화');
  const muted = await api(app, admin, '/api/admin/village/mutes', { targetId: target.id, durationMinutes: 2, reason: '채팅 보호 시험' });
  assert.equal(muted.status, 200); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM village_mutes').get().n, 1);
  peer.send({ type: 'chat', text: '금지 중 자유 대화' }); await error(peer, 'CHAT_MUTED');
  peer.send({ type: 'phrase', id: 'hello' }); peer.send({ type: 'emote', id: 'dance' }); await delay(150);
  assert.ok(!actor.messages.some(message => message.type === 'emote' && message.userId === target.id));
  assert.ok(!actor.messages.some(message => message.text === '금지 중 자유 대화'));
  advance(120001); await sendChat(peer, '금지 만료 뒤 대화');
  await actor.wait(message => message.text === '금지 만료 뒤 대화');
  assert.equal(db.prepare('SELECT action FROM village_admin_audit').get().action, 'mute');
}, { adminUserIds: 'village-operator-fixture' }));

test('같은 회원의 새 접속은 이전 연결을 종료한다', async () => scenario(async ({ signup, connect }) => {
  const member = await signup('duplicate'), first = await connect(member); await welcome(first);
  const second = await connect(member); await welcome(second);
  const closed = await first.closeEvent; assert.equal(closed.code, 4002);
  await sendChat(second, '새 연결만 살아 있어');
}));

test('접속 중 실제 세션 만료는 다음 메시지에서 인증을 재검사하여 종료한다', async () => scenario(async ({ db, signup, connect }) => {
  const member = await signup('expired'), peer = await connect(member); await welcome(peer);
  db.prepare('UPDATE session SET expiresAt=? WHERE userId=?').run(Date.now() - 1, member.id);
  peer.send({ type: 'phrase', id: 'hello' }); await error(peer, 'AUTH_REQUIRED');
  assert.equal((await peer.closeEvent).code, 4001);
}));

test('정상 서버 종료는 재연결 안내와 1012 종료 코드를 전송한다', async () => scenario(async ({ signup, connect, stop }) => {
  const peer = await connect(await signup('shutdown')); await welcome(peer);
  const stopping = stop();
  assert.match((await peer.wait(message => message.type === 'shutdown')).message, /잠시 뒤/);
  assert.equal((await peer.closeEvent).code, 1012); await stopping;
}));

test('임시 아바타는 회원당 한 행·팔레트 값만 저장하며 동시 revision 충돌은 409다', async () => scenario(async ({ app, db, signup }) => {
  const member = await signup('avatar');
  const save = body => api(app, member, '/api/village/avatar', body, 'PUT');
  assert.equal((await request(app, '/api/village/session', { cookie: member.cookie })).body.avatar, null);
  const results = await Promise.all([save({ avatar, revision: 0 }), save({ avatar, revision: 0 })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM village_avatars WHERE userId=?').get(member.id).n, 1);
  const revision = results.find(result => result.status === 200).body.avatar.revision;
  assert.equal(revision, 1);
  assert.equal((await save({ avatar: { ...avatar, colors: { ...avatar.colors, skin: '#000000' } }, revision })).status, 422);
  assert.equal((await save({ avatar: { ...avatar, image: 'data:image/png;base64,fixture' }, revision })).status, 422);
  const updated = await save({ avatar: { ...avatar, colors: { ...avatar.colors, outfit: '#d99eaa' } }, revision });
  assert.equal(updated.status, 200); assert.equal(updated.body.avatar.revision, 2);
  assert.equal((await save({ avatar, revision: 1 })).status, 409);
}));
