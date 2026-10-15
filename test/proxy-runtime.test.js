import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { registerAndLogin } from './account-helpers.js';
import { FLY_COMMUNITY_APP, normalizeClientIP } from '../server/security.js';

function request(app, path, { method = 'GET', body, headers = {} } = {}) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: app.port, path, method, headers: {
      host: new URL(app.origin).host,
      ...(data === undefined ? {} : { origin: app.origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }),
      ...headers,
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let body; try { body = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, body }); });
    });
    req.on('error', reject); req.end(data);
  });
}

async function withServer(options, callback) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-runtime-'));
  let app;
  try { const mailbox = []; app = await startServer({ port: 0, dataDir: folder, mailer: async message => mailbox.push(message), ...options }); await callback(app, folder, mailbox); }
  finally { await app?.close(); await rm(folder, { recursive: true, force: true }); }
}

test('IP 표기 정규화와 포트·여러 값·구역 식별자 거부', () => {
  assert.equal(normalizeClientIP('198.51.100.1'), '198.51.100.1');
  assert.equal(normalizeClientIP('::ffff:198.51.100.1'), '198.51.100.1');
  assert.equal(normalizeClientIP('0:0:0:0:0:ffff:c633:6401'), '198.51.100.1');
  assert.equal(normalizeClientIP('2001:0DB8:0000:0::0001'), '2001:db8::1');
  for (const input of [undefined, ['198.51.100.1'], 'not-an-ip', '198.51.100.1, 198.51.100.2', '198.51.100.1:8080', '[2001:db8::1]', 'fe80::1%eth0', '0198.51.100.1']) assert.equal(normalizeClientIP(input), null);
});

test('명시된 Fly 전용 앱에서 IP별 독립 제한과 외부 내부헤더 덮어쓰기', async () => {
  await withServer({ trustFlyProxy: true, flyAppName: FLY_COMMUNITY_APP, rateLimit: { readMax: 1 } }, async app => {
    assert.equal((await request(app, '/api/community/session', { headers: { 'fly-client-ip': '198.51.100.10', 'x-forwarded-for': '198.51.100.200', 'x-community-client-ip': '198.51.100.201' } })).status, 200);
    assert.equal((await request(app, '/api/community/session', { headers: { 'fly-client-ip': '198.51.100.10', 'x-forwarded-for': '198.51.100.202', 'x-community-client-ip': '198.51.100.203' } })).status, 429);
    assert.equal((await request(app, '/api/community/session', { headers: { 'fly-client-ip': '198.51.100.11' } })).status, 200);
    assert.equal((await request(app, '/api/community/session', { headers: { 'fly-client-ip': '2001:db8::1' } })).status, 200);
    assert.equal((await request(app, '/api/community/session', { headers: { 'fly-client-ip': '2001:0DB8:0:0::0001' } })).status, 429);
  });
});

test('잘못된 Fly IP 헤더와 누락은 같은 소켓 IP 제한으로 돌아감', async () => {
  await withServer({ trustFlyProxy: true, flyAppName: FLY_COMMUNITY_APP, rateLimit: { readMax: 1 } }, async app => {
    assert.equal((await request(app, '/api/community/session', { headers: { 'fly-client-ip': 'invalid', 'x-forwarded-for': '198.51.100.40' } })).status, 200);
    assert.equal((await request(app, '/api/community/session', { headers: { 'fly-client-ip': '198.51.100.41,198.51.100.42', 'x-community-client-ip': '198.51.100.43' } })).status, 429);
    assert.equal((await request(app, '/api/community/session')).status, 429);
    assert.equal((await request(app, '/api/community/session', { headers: { 'fly-client-ip': '198.51.100.44' } })).status, 200);
  });
});

test('로컬 기본값·다른 앱·명시 해제에서는 Fly 헤더 위조로 제한을 피할 수 없음', async () => {
  for (const options of [{ flyAppName: FLY_COMMUNITY_APP }, { trustFlyProxy: true, flyAppName: 'another-app' }, { trustFlyProxy: false, flyAppName: FLY_COMMUNITY_APP }]) {
    await withServer({ ...options, rateLimit: { readMax: 1 } }, async app => {
      assert.equal((await request(app, '/api/community/session?trustFlyProxy=true', { headers: { 'fly-client-ip': '198.51.100.50', 'x-forwarded-for': '198.51.100.51', 'x-community-client-ip': '198.51.100.52', 'trust-fly-proxy': 'true', 'fly-app-name': FLY_COMMUNITY_APP } })).status, 200);
      assert.equal((await request(app, '/api/community/session', { headers: { 'fly-client-ip': '198.51.100.53', 'x-forwarded-for': '198.51.100.54', 'x-community-client-ip': '198.51.100.55' } })).status, 429);
    });
  }
});

test('Better Auth 세션에도 서버가 정한 동일 IP만 저장', async () => {
  for (const onFly of [false, true]) {
    await withServer({ trustFlyProxy: onFly, flyAppName: FLY_COMMUNITY_APP }, async (app, folder, mailbox) => {
      const signup = await registerAndLogin(app, mailbox, { ageBand: '14plus', name: '접속확인', email: `proxy-${onFly}@example.test`, password: '테스트전용-공유하지않는값-1234' }, { 'fly-client-ip': '198.51.100.60', 'x-forwarded-for': '198.51.100.61', 'x-real-ip': '198.51.100.62', 'x-community-client-ip': '198.51.100.63' });
      assert.equal(signup.status, 200);
      const db = new DatabaseSync(join(folder, 'community.sqlite'));
      try { assert.equal(db.prepare('SELECT ipAddress FROM session LIMIT 1').get().ipAddress, onFly ? '198.51.100.60' : '127.0.0.1'); }
      finally { db.close(); }
      assert.doesNotMatch(JSON.stringify(signup.body), /"(?:ipAddress|password|hash)"\s*:/);
    });
  }
});

test('Better Auth 자체 속도 제한도 위조 XFF 대신 확정 IP로 독립 동작', async () => {
  await withServer({ trustFlyProxy: true, flyAppName: FLY_COMMUNITY_APP, rateLimit: { authMax: 100 } }, async app => {
    for (let index = 0; index < 30; index++) {
      const result = await request(app, '/api/auth/sign-out', { method: 'POST', headers: { 'fly-client-ip': '198.51.100.70', 'x-forwarded-for': `198.51.100.${100 + index}`, 'x-community-client-ip': `198.51.100.${150 + index}` }, body: {} });
      assert.notEqual(result.status, 429);
    }
    assert.equal((await request(app, '/api/auth/sign-out', { method: 'POST', headers: { 'fly-client-ip': '198.51.100.70', 'x-forwarded-for': '198.51.100.240' }, body: {} })).status, 429);
    assert.notEqual((await request(app, '/api/auth/sign-out', { method: 'POST', headers: { 'fly-client-ip': '198.51.100.71' }, body: {} })).status, 429);
  });
});

test('/health는 Host를 검사하고 DB·인증·API 제한과 분리된 최소 no-store 응답', async () => {
  await withServer({ rateLimit: { readMax: 1, authMax: 1 } }, async app => {
    for (let index = 0; index < 8; index++) {
      const result = await request(app, '/health');
      assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true });
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.headers['set-cookie'], undefined);
      assert.doesNotMatch(JSON.stringify(result.body), /user|email|secret|token|database|sqlite/i);
    }
    assert.equal((await request(app, '/api/community/session')).status, 200);
    assert.equal((await request(app, '/api/community/session')).status, 429);
    assert.equal((await request(app, '/health')).status, 200);
    assert.equal((await request(app, '/health', { headers: { host: 'untrusted.example' } })).status, 403);
    assert.equal((await request(app, '/health', { method: 'POST', body: {} })).status, 405);
    assert.equal((await request(app, '/health/')).status, 404);
  });
});

test('가입은 연령 구분을 필수로 받고 기존 자기확인 우회·생년월일 수집을 거부', async () => {
  await withServer({}, async (app, folder) => {
    const signup = { name: '가입확인', email: 'age-confirm@example.test', password: '테스트전용-자기확인-1234' };
    for (const value of [undefined, false, 'true', 1]) {
      const response = await request(app, '/api/auth/sign-up/email', { method: 'POST', body: { ...signup, ...(value === undefined ? {} : { ageConfirmed: value }) } });
      assert.equal(response.status, 422);
      assert.equal(response.body.error.code, 'AGE_CONFIRMATION_REQUIRED');
    }
    const db = new DatabaseSync(join(folder, 'community.sqlite'));
    try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0); }
    finally { db.close(); }
    const accepted = await request(app, '/api/auth/sign-up/email', { method: 'POST', body: { ...signup, ageBand: '14plus' } });
    assert.equal(accepted.status, 200);
    assert.doesNotMatch(JSON.stringify(accepted.body), /ageConfirmed|birthDate|birthday/);
    const verified = new DatabaseSync(join(folder, 'community.sqlite'));
    try { assert.ok(verified.prepare('PRAGMA table_info(user)').all().every(column => !['ageConfirmed', 'birthDate', 'birthday'].includes(column.name))); }
    finally { verified.close(); }
  });
});
