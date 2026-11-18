import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAvatarPreset, createDefaultCharacter, characterError, JOBS } from '../assets/avatar/model.js';
import { startServer } from '../server/app.js';
import { approveGuardianRequest, deleteGuardianChild, withdrawGuardian } from '../server/guardian-review.js';
import { request, cookieFrom, registerAndLogin } from './account-helpers.js';

const api = '/api/avatar/me';
const put = (app, cookie, revision, character) => request(app, api, { method: 'PUT', cookie, body: { revision, character } });

async function fixture(t, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-avatar-'));
  const mailbox = [];
  const settings = {
    port: 0, dataDir: folder, mailer: async mail => mailbox.push(mail),
    guardianReplyTo: 'guardian@example.test', rateLimit: { authMax: 80 }, ...options,
  };
  let app, db;
  t.after(async () => {
    db?.close();
    await app?.close();
    await rm(folder, { recursive: true, force: true });
  });
  app = await startServer(settings);
  db = new DatabaseSync(join(folder, 'community.sqlite'));
  db.exec('PRAGMA foreign_keys=ON');
  return {
    app, db, folder,
    async login(email, ageBand = '14plus', headers = {}) {
      const body = { email, password: randomUUID(), name: '시험 회원', ageBand };
      const response = await registerAndLogin(app, mailbox, body, headers);
      assert.equal(response.status, 200);
      return { cookie: cookieFrom(response), userId: response.body.user.id };
    },
    async restart() {
      const port = app.port;
      await app.close();
      app = undefined;
      app = await startServer({ ...settings, port });
      return app;
    },
  };
}

test('미소년과 미소녀의 외형은 독립적이며 어느 프리셋에서도 네 직업을 선택할 수 있다', () => {
  const youth = createAvatarPreset('youth'), maiden = createAvatarPreset('maiden');
  assert.deepEqual(createDefaultCharacter(), youth);
  for (const key of ['jaw', 'eyes', 'nose', 'height', 'build', 'shoulders', 'hairStyle']) {
    assert.notEqual(youth.appearance[key], maiden.appearance[key], key);
  }
  for (const id of ['youth', 'maiden']) {
    const character = createAvatarPreset(id), fresh = createAvatarPreset(id);
    assert.notEqual(character, fresh);
    assert.notEqual(character.appearance, fresh.appearance);
    assert.equal(character.job, 'guardian');
    assert.equal(character.recommendedJob, null);
    for (const job of JOBS) assert.equal(characterError({ ...character, job: job.id }), null);
    character.appearance.jaw = 100;
    assert.deepEqual(createAvatarPreset(id), fresh);
  }
  assert.throws(() => createAvatarPreset('미등록'), RangeError);
});

test('공유 모델은 독립된 기본 외모와 네 직업을 제공하고 정해진 필드·타입·경계를 검사한다', () => {
  const first = createDefaultCharacter(), second = createDefaultCharacter();
  assert.deepEqual(first, second);
  first.appearance.jaw = 27;
  assert.notEqual(first.appearance.jaw, second.appearance.jaw);
  assert.equal(characterError(second), null);
  assert.deepEqual(JOBS.map(({ id, label }) => [id, label]), [
    ['guardian', '수호기사'], ['ranger', '숲길잡이'], ['arcanist', '룬술사'], ['healer', '별빛치유사'],
  ]);
  for (const { id } of JOBS) {
    assert.equal(characterError({ ...second, job: id, recommendedJob: id }), null);
  }
  for (const key of ['height', 'build', 'shoulders', 'jaw', 'eyes', 'nose', 'hairStyle']) {
    const max = key === 'hairStyle' ? 3 : 100;
    for (const value of [0, max]) assert.equal(characterError({ ...second, appearance: { ...second.appearance, [key]: value } }), null);
    for (const value of [-1, max + 1, 0.5, '0', null]) assert.ok(characterError({ ...second, appearance: { ...second.appearance, [key]: value } }));
  }
  for (const key of ['skinColor', 'hairColor', 'eyeColor', 'clothColor']) {
    for (const value of ['#ffffff', '#000000']) assert.equal(characterError({ ...second, appearance: { ...second.appearance, [key]: value } }), null);
    for (const value of ['#FFF123', '#abc', '#1234567', 'fff123', 123]) assert.ok(characterError({ ...second, appearance: { ...second.appearance, [key]: value } }));
  }
  for (const key of Object.keys(second.appearance)) {
    const appearance = { ...second.appearance };
    delete appearance[key];
    assert.ok(characterError({ ...second, appearance }));
  }
  for (const key of Object.keys(second)) {
    const partial = { ...second };
    delete partial[key];
    assert.ok(characterError(partial));
  }
  assert.equal(characterError({ ...second, name: '🌟'.repeat(24) }), null);
  for (const name of ['  ', '별'.repeat(25), '별\n빛', null]) assert.ok(characterError({ ...second, name }));
});

test('새 회원이 저장하고 수정하면 재시작 후에도 같은 아바타와 버전을 조회한다', async t => {
  const f = await fixture(t);
  const { cookie, userId } = await f.login('atelier@example.test');
  assert.deepEqual((await request(f.app, api, { cookie })).body, { avatar: null });
  const character = createDefaultCharacter();
  const result = await put(f.app, cookie, 0, character);
  assert.equal(result.status, 200);
  const id = result.body.avatar.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.notEqual(id, userId);
  assert.deepEqual(result.body, { avatar: { id, revision: 1, character } });
  assert.equal(result.headers['cache-control'], 'no-store');
  character.name = '밤길의 별';
  character.job = 'ranger';
  character.recommendedJob = 'arcanist';
  Object.assign(character.appearance, {
    height: 25, build: 75, shoulders: 0, jaw: 100, eyes: 34, nose: 39, hairStyle: 3,
    skinColor: '#916447', hairColor: '#201514', eyeColor: '#428d68', clothColor: '#f2c23b',
  });
  const expected = { avatar: { id, revision: 2, character } };
  const updated = await put(f.app, cookie, 1, { ...character, name: '  밤길의 별  ' });
  assert.deepEqual(updated.body, expected);
  const app = await f.restart();
  const fetched = await request(app, api, { cookie });
  assert.deepEqual(fetched.body, expected);
  assert.equal(fetched.headers['cache-control'], 'no-store');
  assert.equal((await request(app, '/assets/avatar/model.js')).status, 200);
  assert.equal((await request(app, '/api/auth/sign-out', { method: 'POST', cookie, body: {} })).status, 200);
  assert.equal((await request(app, api, { cookie })).status, 401);
});

test('동시 첫 저장과 수정은 하나만 반영하고 중복·예전 버전·미래 버전은 충돌을 알린다', async t => {
  const { app, login } = await fixture(t);
  const { cookie } = await login('compete@example.test');
  const characters = ['동쪽 별', '서쪽 별'].map(name => ({ ...createDefaultCharacter(), name }));
  assert.equal((await put(app, cookie, 1, characters[0])).status, 409);
  let id;
  for (const revision of [0, 1]) {
    const results = await Promise.all(characters.map(character => put(app, cookie, revision, character)));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.findIndex(result => result.status === 200);
    const saved = results[winner].body.avatar;
    if (revision === 0) id = saved.id;
    const expected = { avatar: { id, revision: revision + 1, character: characters[winner] } };
    assert.deepEqual({ avatar: saved }, expected);
    assert.equal((await put(app, cookie, revision, characters[winner])).status, 409);
    assert.equal((await put(app, cookie, revision + 2, characters[1 - winner])).status, 409);
    assert.deepEqual((await request(app, api, { cookie })).body, expected);
  }
});

test('회원별 기록을 분리하고 계정 삭제 시 해당 아바타와 접근 권한만 제거한다', async t => {
  const { app, db, login } = await fixture(t);
  const a = await login('owner-a@example.test'), b = await login('owner-b@example.test');
  const character = createDefaultCharacter();
  const first = (await put(app, a.cookie, 0, character)).body.avatar;
  assert.deepEqual((await request(app, api, { cookie: b.cookie })).body, { avatar: null });
  assert.equal((await put(app, b.cookie, first.revision, character)).status, 409);
  assert.equal((await request(app, api + '?userId=' + a.userId, { cookie: b.cookie })).status, 422);
  for (const extra of [{ userId: a.userId }, { id: first.id }]) {
    const result = await request(app, api, { cookie: b.cookie, method: 'PUT', body: { revision: 0, character, ...extra } });
    assert.equal(result.status, 422);
  }
  const other = (await put(app, b.cookie, 0, character)).body.avatar;
  assert.notEqual(other.id, first.id);
  db.prepare('DELETE FROM user WHERE id=?').run(a.userId);
  assert.equal(db.prepare('SELECT count(*) AS n FROM avatars WHERE id=?').get(first.id).n, 0);
  assert.equal((await request(app, api, { cookie: a.cookie })).status, 401);
  assert.equal((await put(app, a.cookie, 0, character)).status, 401);
  assert.deepEqual((await request(app, api, { cookie: b.cookie })).body, { avatar: other });
});

test('다른 탭에서 계정이 바뀌면 버전이 같아도 이전 공방의 조건부 저장과 조회를 중단한다', async t => {
  const { app, login } = await fixture(t);
  const a = await login('tab-one@example.test'), b = await login('tab-two@example.test');
  const headers = { 'X-Avatar-Owner': a.userId };
  const body = { revision: 0, character: createAvatarPreset('youth') };
  const staleSave = () => request(app, api, { method: 'PUT', cookie: b.cookie, headers, body });
  assert.equal((await staleSave()).status, 412);
  assert.equal((await request(app, api, { cookie: b.cookie })).body.avatar, null);
  assert.equal((await request(app, api, { method: 'PUT', cookie: a.cookie, headers, body })).status, 200);
  const second = (await put(app, b.cookie, 0, createAvatarPreset('maiden'))).body;
  body.revision = 1;
  assert.equal((await staleSave()).status, 412);
  assert.equal((await request(app, api, { cookie: b.cookie, headers })).status, 412);
  assert.deepEqual((await request(app, api, { cookie: b.cookie })).body, second);
});

test('유효 세션·같은 출처·올바른 본문이 있어야 저장하며 거절된 입력은 기록을 보존한다', async t => {
  const { app, login } = await fixture(t);
  const character = createDefaultCharacter();
  assert.equal((await request(app, api)).status, 401);
  assert.equal((await put(app, undefined, 0, character)).status, 401);
  const { cookie } = await login('input@example.test');
  const original = (await put(app, cookie, 0, character)).body;
  const body = { revision: 1, character };
  const save = (body, options = {}) => request(app, api, { method: 'PUT', cookie, body, ...options });
  for (const revision of [-1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await save({ ...body, revision })).status, 422);
  for (const invalid of [
    {}, { ...character, job: null }, { ...character, recommendedJob: '미등록' },
    { ...character, appearance: { ...character.appearance, eyes: 101 } },
    { ...character, appearance: { ...character.appearance, other: 1 } },
    { ...character, name: ' ' }, { ...character, email: 'extra@example.test' },
  ]) assert.equal((await save({ ...body, character: invalid })).status, 422);
  assert.equal((await save({ revision: 1 })).status, 422);
  assert.equal((await save(body, { origin: 'https://other.example' })).status, 403);
  assert.equal((await save(body, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await save({ ...body, note: 'a'.repeat(4096) })).status, 413);
  assert.equal((await save(body, { method: 'POST' })).status, 405);
  assert.deepEqual((await request(app, api, { cookie })).body, original);
});

test('어린이 계정의 보호자 동의 철회와 기존 계정 삭제 절차가 아바타에도 적용된다', async t => {
  const { app, db, folder, login } = await fixture(t);
  const guardianEmail = 'parent@example.test';
  const consent = await request(app, '/api/account/guardian-requests', { method: 'POST', body: { guardianName: '시험보호자', guardianEmail } });
  const guardianCookie = cookieFrom(consent);
  const id = (await request(app, '/api/account/guardian-request', { cookie: guardianCookie })).body.request.requestNumber;
  const evidencePath = join(folder, 'reply.eml');
  await writeFile(evidencePath, `From: ${guardianEmail}\r\nSubject: 동의\r\n\r\n가입에 동의합니다. 신청 번호 ${id}`, { mode: 0o600 });
  await approveGuardianRequest(db, { id, dataDir: folder, evidencePath, confirmReply: true, confirmGuardian: true, confirmScope: true });
  const child = await login('child@example.test', 'under14', { cookie: guardianCookie });
  const character = createDefaultCharacter();
  assert.equal((await put(app, child.cookie, 0, character)).status, 200);
  db.prepare("UPDATE guardian_requests SET status='withdrawn' WHERE id=?").run(id);
  assert.equal((await request(app, api, { cookie: child.cookie })).status, 401);
  assert.equal((await put(app, child.cookie, 1, character)).status, 401);
  db.prepare("UPDATE guardian_requests SET status='used' WHERE id=?").run(id);
  withdrawGuardian(db, id);
  await deleteGuardianChild(db, { id, dataDir: folder, confirmParentRequest: true, confirmDeletion: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM avatars WHERE userId=?').get(child.userId).n, 0);
});

test('게임 진입 문서와 아바타 엔진·모델에 맞는 MIME을 제공한다', async t => {
  const rootDir = await mkdtemp(join(tmpdir(), 'avatar-static-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(join(rootDir, 'assets/avatar/vendor'), { recursive: true });
  await mkdir(join(rootDir, 'games/avatar'), { recursive: true });
  await writeFile(join(rootDir, 'games/avatar/index.html'), '<h1>아바타</h1>');
  const types = { mjs: 'text/javascript', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', wasm: 'application/wasm' };
  const { app } = await fixture(t, { rootDir });
  assert.match((await request(app, '/games/avatar/')).text, /아바타/);
  for (const [extension, mime] of Object.entries(types)) {
    const path = '/assets/avatar/vendor/sample.' + extension;
    await writeFile(join(rootDir, path), '시험');
    const result = await request(app, path);
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-type'].split(';')[0], mime);
  }
  await writeFile(join(rootDir, 'assets/private.bin'), '시험');
  assert.equal((await request(app, '/assets/private.bin')).status, 404);
});
