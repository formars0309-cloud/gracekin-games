import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { scenario, seedMember, request, upgradeStatus, avatar, delay } from './village-helpers.js';
import { CONSENT_VERSION, CONSENT_TEXT } from '../server/guardian.js';
import { VILLAGE_OPENS_AT, VILLAGE_CLEANUP_INTERVAL, oneYearAgo, startVillageCleanup } from '../server/village/policy.js';
import { createVillageStore } from '../server/village/store.js';

test('운영자로 둘러보는 어린이 수신자에게도 자유 대화는 보내지 않고 문구·감정만 보낸다', async () => scenario(async ({ app, db, signup, connect }) => {
  const author = await signup('receive'), observerMember = seedMember(db, author.id, 'observer');
  const child = seedMember(db, author.id, 'child-operator', { child: true, userId: 'village-child-operator' });
  const sender = await connect(author), observer = await connect(observerMember), protectedPeer = await connect(child);
  await protectedPeer.wait(message => message.type === 'welcome');
  protectedPeer.send({ type: 'tour', villageId: 'general' });
  await protectedPeer.wait(message => message.type === 'welcome' && message.village.id === 'general');
  sender.send({ type: 'chat', text: '자유 대화 허용 회원에게만' });
  assert.equal((await observer.wait(message => message.text === '자유 대화 허용 회원에게만')).kind, 'free');
  sender.send({ type: 'phrase', id: 'hello' });
  assert.equal((await protectedPeer.wait(message => message.text === '안녕!')).kind, 'phrase');
  sender.send({ type: 'emote', id: 'wave' }); await protectedPeer.wait(message => message.type === 'emote');
  assert.ok(!protectedPeer.messages.some(message => message.kind === 'free'));
  const report = await request(app, '/api/village/reports', { method: 'POST', cookie: child.cookie, body: { targetId: author.id, reason: '서버 대화 확인 요청' } });
  assert.equal(report.status, 201);
  const snapshot = JSON.parse(db.prepare('SELECT snapshot FROM village_reports WHERE id=?').get(report.body.report.id).snapshot);
  assert.equal(snapshot.find(message => message.kind === 'free').text, '자유 대화 허용 회원에게만');
}, { adminUserIds: 'village-child-operator' }));

test('접속 중 연령 구분이 바뀌면 연결을 종료하고 맞는 마을에 다시 입장한다', async () => scenario(async ({ db, signup, connect }) => {
  const template = await signup('age-refresh'), member = seedMember(db, template.id, 'changed-member', { child: true });
  db.prepare("UPDATE user SET ageBand='14plus' WHERE id=?").run(member.id);
  const peer = await connect(member); assert.equal((await peer.wait(message => message.type === 'welcome')).village.id, 'general');
  db.prepare("UPDATE user SET ageBand='under14' WHERE id=?").run(member.id);
  peer.send({ type: 'phrase', id: 'thanks' });
  assert.equal((await peer.closeEvent).code, 4004);
  const rejoined = await connect(member); assert.equal((await rejoined.wait(message => message.type === 'welcome')).village.id, 'kids');
}));

test('시행 전 일반 회원의 입장·옷장 저장은 거부하고 운영자는 허용하며 시행 시각부터 일반 회원을 허용한다', async () => scenario(async ({ app, db, signup, connect, advance }) => {
  const member = await signup('opening'), admin = seedMember(db, member.id, '운영시험', { userId: 'village-opening-admin' });
  const state = await request(app, '/api/village/session', { cookie: member.cookie });
  assert.equal(state.status, 403); assert.equal(state.body.error.code, 'VILLAGE_NOT_OPEN');
  assert.equal(state.body.error.message, '2026년 11월 27일에 문을 열어요');
  assert.equal((await request(app, '/api/village/avatar', { method: 'PUT', cookie: member.cookie, body: { avatar, revision: 0 } })).status, 403);
  assert.equal((await upgradeStatus(app, member.cookie)), 403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM village_avatars').get().n, 0);
  assert.equal((await request(app, '/api/village/blocks', { method: 'POST', cookie: member.cookie, body: { targetId: admin.id } })).status, 403);
  db.prepare('INSERT INTO village_blocks VALUES(?,?,?)').run(member.id, admin.id, Date.now());
  assert.equal((await request(app, '/api/village/blocks', { method: 'DELETE', cookie: member.cookie, body: { targetId: admin.id } })).status, 200);
  assert.equal((await request(app, '/api/village/avatar', { method: 'PUT', cookie: admin.cookie, body: { avatar, revision: 0 } })).status, 200);
  const operator = await connect(admin); await operator.wait(message => message.type === 'welcome');
  advance(1);
  assert.equal((await request(app, '/api/village/session', { cookie: member.cookie })).status, 200);
  const opened = await connect(member); await opened.wait(message => message.type === 'welcome');
}, { initialTime: Date.parse(VILLAGE_OPENS_AT) - 1, villageOpensAt: VILLAGE_OPENS_AT, adminUserIds: 'village-opening-admin' }));

test('시행 시각 설정은 서버 안내에도 반영되고 시간대가 없는 설정은 거부한다', async () => {
  await scenario(async ({ app, signup }) => {
    const member = await signup('opening-config');
    assert.equal((await request(app, '/api/village/session', { cookie: member.cookie })).body.error.message, '2026년 12월 1일에 문을 열어요');
  }, { initialTime: Date.parse(VILLAGE_OPENS_AT), villageOpensAt: '2026-12-01T00:00:00+09:00' });
  await assert.rejects(scenario(async () => {}, { villageOpensAt: '2026-11-27' }), /VILLAGE_OPENS_AT/);
});

test('v4 동의 어린이는 마을 입장·옷장 저장을 거부하고 기존 동의 본문과 계정 로그인은 보존한다', async () => scenario(async ({ app, db, signup, connect }) => {
  const template = await signup('consent'), child = seedMember(db, template.id, '이전동의', { child: true, consentVersion: '2026-10-16-v4' });
  const before = db.prepare('SELECT consentVersion,consentText FROM guardian_requests WHERE childUserId=?').get(child.id);
  const state = await request(app, '/api/village/session', { cookie: child.cookie });
  assert.equal(state.status, 403); assert.equal(state.body.error.code, 'VILLAGE_GUARDIAN_CONSENT_REQUIRED');
  assert.equal(state.body.error.message, '보호자의 추가 동의가 필요해요');
  assert.equal(await upgradeStatus(app, child.cookie), 403);
  assert.equal((await request(app, '/api/village/avatar', { method: 'PUT', cookie: child.cookie, body: { avatar, revision: 0 } })).status, 403);
  assert.equal((await request(app, '/api/village/blocks', { method: 'POST', cookie: child.cookie, body: { targetId: template.id } })).status, 403);
  assert.equal((await request(app, '/api/account/session', { cookie: child.cookie })).body.user.id, child.id);
  assert.deepEqual(db.prepare('SELECT consentVersion,consentText FROM guardian_requests WHERE childUserId=?').get(child.id), before);
  const current = seedMember(db, template.id, '새동의', { child: true });
  const peer = await connect(current); await peer.wait(message => message.type === 'welcome');
  assert.equal(CONSENT_VERSION, '2026-11-20-v5');
  for (const phrase of ['피부·머리·옷', '자유 채팅은 받지 않습니다', '생성 후 1년', '최근 50개·최대 10분']) assert.ok(CONSENT_TEXT.includes(phrase));
}));

test('신고·제한·감사 자료는 서버 시작과 하루 정리에서 생성 후 1년 경계까지만 삭제한다', async () => scenario(async ({ db, signup, now, advance, restart }) => {
  const actor = await signup('retention'), target = seedMember(db, actor.id, '신고대상'), cutoff = oneYearAgo(now());
  const insert = (id, time) => {
    db.prepare('INSERT INTO village_reports(id,reporterId,targetId,channelId,reason,snapshot,createdAt) VALUES(?,?,?,?,?,?,?)').run(id, actor.id, target.id, 1, '보존 시험', '[]', time);
    db.prepare('INSERT INTO village_admin_audit(id,actorId,targetId,action,until,reason,createdAt) VALUES(?,?,?,?,?,?,?)').run(id, actor.id, target.id, 'mute', time + 60000, '보존 시험', time);
  };
  for (const [id, at] of [['지난자료', cutoff - 1], ['경계자료', cutoff], ['남길자료', cutoff + 1]]) insert(id, at);
  db.prepare('INSERT INTO village_mutes(userId,until,reason,actorId,createdAt) VALUES(?,?,?,?,?)').run(target.id, cutoff + 60000, '보존 시험', actor.id, cutoff);
  await restart();
  for (const table of ['village_reports', 'village_admin_audit']) assert.deepEqual(db.prepare(`SELECT id FROM ${table}`).all().map(row => row.id), ['남길자료']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM village_mutes').get().n, 0);
  const store = createVillageStore(db, now); let task, interval, unref = false;
  startVillageCleanup(store.cleanup, (callback, ms) => { task = callback; interval = ms; return { unref() { unref = true; } }; });
  assert.equal(interval, VILLAGE_CLEANUP_INTERVAL); assert.equal(interval, 86400000); assert.equal(unref, true);
  advance(86400000); task();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM village_reports').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM village_admin_audit').get().n, 0);
  assert.equal(new Date(oneYearAgo(Date.parse('2028-02-29T00:00:00Z'))).toISOString(), '2027-02-28T00:00:00.000Z');
}));

test('회원 삭제와 본인 차단 해제는 캐릭터·차단 관계를 즉시 삭제한다', async () => scenario(async ({ app, db, signup }) => {
  const member = await signup('deletion'), target = seedMember(db, member.id, '차단대상');
  const block = method => request(app, '/api/village/blocks', { method, cookie: member.cookie, body: { targetId: target.id } });
  assert.equal((await request(app, '/api/village/avatar', { method: 'PUT', cookie: member.cookie, body: { avatar, revision: 0 } })).status, 200);
  await block('POST'); await block('DELETE'); assert.equal(db.prepare('SELECT COUNT(*) n FROM village_blocks').get().n, 0);
  await block('POST');
  db.prepare('INSERT INTO village_blocks VALUES(?,?,?)').run(target.id, member.id, Date.now());
  // 실제 회원 삭제와 같은 user 삭제가 외래키를 통해 관련 자료를 지웁니다.
  db.prepare('DELETE FROM user WHERE id=?').run(member.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM village_avatars').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM village_blocks').get().n, 0);
}));

test('Pages·다른 마을 출처는 API 시작 전 고정 출처로 이동하고 로컬·정식 출처는 유지한다', async () => {
  const source = await readFile(new URL('../assets/community/host.js', import.meta.url), 'utf8');
  for (const origin of ['https://gracekingames.com', 'https://www.gracekingames.com', 'https://preview.example.test', 'https://community.gracekingames.com', 'http://localhost:8766', 'http://127.0.0.1:8766', 'http://[::1]:8766']) {
    const url = new URL(`${origin}/village/?channel=2#test`), redirects = [], window = {};
    runInNewContext(source, { window, URL, URLSearchParams, location: { hostname: url.hostname, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash, replace: value => redirects.push(value) } });
    const expected = !['https://community.gracekingames.com', 'http://localhost:8766', 'http://127.0.0.1:8766', 'http://[::1]:8766'].includes(origin);
    assert.equal(window.gracekinCommunityRedirecting, expected);
    assert.deepEqual(redirects, expected ? ['https://community.gracekingames.com/village/?channel=2#test'] : []);
  }
  const html = await readFile(new URL('../village/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('/assets/community/host.js') < html.indexOf('/assets/village/village.js'));
  const client = await readFile(new URL('../assets/village/village.js', import.meta.url), 'utf8');
  assert.match(client, /async function initialize\(\)\{\s*if\(window\.gracekinCommunityRedirecting\)return;/);
});
