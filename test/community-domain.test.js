import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/app.js';

const ORIGIN = 'https://community.gracekingames.com';
const LEGACY_HOST = 'gracekin-games-community.fly.dev';

function request(app, path, { host = LEGACY_HOST, method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: app.port, path, method, headers: { host, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(options, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'gracekin-domain-'));
  let app;
  try {
    app = await startServer({ port: 0, dataDir: directory, nodeEnv: 'production', baseURL: ORIGIN, secret: randomBytes(48).toString('base64url'), legacyHosts: [LEGACY_HOST], ...options });
    await callback(app);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('옛 Host의 GET·HEAD는 경로·쿼리를 보존한 정식 절대 주소로 301 이동', async () => {
  await withServer({}, async app => {
    const path = '/community/?game=slimeline&board=free&q=%ED%95%9C%EA%B8%80&q=a%2Bb&page=2';
    for (const method of ['GET', 'HEAD']) {
      const response = await request(app, path, { method });
      assert.equal(response.status, 301);
      assert.equal(response.headers.location, `${ORIGIN}${path}`);
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.text, '');
    }
    assert.equal((await request(app, '/health')).headers.location, `${ORIGIN}/health`);
  });
});

test('옛 Host는 인증·세션 API와 모든 쓰기 메서드를 거부', async () => {
  await withServer({}, async app => {
    for (const path of ['/api', '/api/', '/api/community/session', '/api/auth/sign-in/email', '/%61pi/community/session', '/api%2fcommunity/session']) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const response = await request(app, path, { method, headers: { origin: ORIGIN, cookie: 'gracekin.session_token=old-session' } });
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.equal(response.headers.location, undefined);
        assert.equal(response.headers['set-cookie'], undefined);
      }
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']) {
      assert.equal((await request(app, '/community/?game=gyeongguk', { method, headers: { origin: ORIGIN } })).status, 403);
    }
    assert.equal((await request(app, '/apiary/')).status, 301);
  });
});

test('임의 Host·유사 Host·포트·사용자정보·전달 헤더로 이전 허용 범위를 넓힐 수 없음', async () => {
  await withServer({}, async app => {
    for (const host of ['untrusted.example', `${LEGACY_HOST}.evil.example`, `${LEGACY_HOST}.`, `${LEGACY_HOST}:443`, LEGACY_HOST.toUpperCase(), `evil@${LEGACY_HOST}`, `prefix-${LEGACY_HOST}`, 'community.gracekingames.com:443']) {
      const response = await request(app, '/community/', { host, headers: { 'x-forwarded-host': LEGACY_HOST, forwarded: `host=${LEGACY_HOST}` } });
      assert.equal(response.status, 403, host);
      assert.equal(response.headers.location, undefined);
    }
  });
});

test('이전 목적지는 전달 헤더·쿼리의 URL과 무관하게 설정 출처로 고정', async () => {
  await withServer({}, async app => {
    const path = '/community/?next=https%3A%2F%2Fevil.example%2F&redirect=//evil.example/';
    const response = await request(app, path, { headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http', forwarded: 'host=evil.example;proto=http' } });
    assert.equal(response.status, 301);
    assert.equal(response.headers.location, `${ORIGIN}${path}`);
    for (const invalidPath of ['//evil.example/', '/%2fevil.example/', '/%2e%2e/api/community/session', '/community/../api/community/session']) {
      const invalid = await request(app, invalidPath);
      assert.equal(invalid.status, 404);
      assert.equal(invalid.headers.location, undefined);
    }
  });
});

test('새 Host에서 화면·상태 확인·세션 읽기는 정상이며 옛 Origin 쓰기는 거부', async () => {
  await withServer({}, async app => {
    const host = new URL(ORIGIN).host;
    const page = await request(app, '/community/?game=slimeline', { host });
    assert.equal(page.status, 200);
    assert.match(page.text, /슬라임 라인/);
    assert.equal(page.headers.location, undefined);
    const health = await request(app, '/health', { host });
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.text), { ok: true });
    const session = await request(app, '/api/community/session', { host });
    assert.equal(session.status, 200);
    assert.deepEqual(JSON.parse(session.text), { user: null });
    assert.equal((await request(app, '/api/auth/sign-out', { host, method: 'POST', headers: { origin: `https://${LEGACY_HOST}`, 'content-type': 'application/json' } })).status, 403);
  });
});

test('이전 Host는 기본 비활성이며 LEGACY_HOSTS 환경 변수로만 명시 활성화 가능', async () => {
  const previous = process.env.LEGACY_HOSTS;
  try {
    delete process.env.LEGACY_HOSTS;
    await withServer({ legacyHosts: undefined }, async app => assert.equal((await request(app, '/community/')).status, 403));
    process.env.LEGACY_HOSTS = LEGACY_HOST;
    await withServer({ legacyHosts: undefined }, async app => assert.equal((await request(app, '/community/')).status, 301));
  } finally {
    if (previous === undefined) delete process.env.LEGACY_HOSTS;
    else process.env.LEGACY_HOSTS = previous;
  }
});

test('이전 Host 설정에 URL·포트·와일드카드를 지정하면 시작 거부', async () => {
  for (const value of [`https://${LEGACY_HOST}`, `${LEGACY_HOST}:443`, '*.fly.dev', `evil@${LEGACY_HOST}`, `${LEGACY_HOST}.`, 42]) {
    await assert.rejects(withServer({ legacyHosts: [value] }, async () => {}), /정확한 호스트/);
  }
});
