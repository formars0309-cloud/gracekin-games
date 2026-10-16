import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/app.js';
import { request as accountRequest } from './account-helpers.js';

const ORIGIN = 'https://community.gracekingames.com';
// 실제 운영 호환 설정을 검증 대상으로 삼으며, 누락·복수 Host는 조용히 건너뛰지 않습니다.
const flyConfig = await readFile(new URL('../fly.toml', import.meta.url), 'utf8');
const configuredLegacyHosts = [...flyConfig.matchAll(/^\s*LEGACY_HOSTS\s*=\s*"([^"]+)"\s*$/gm)];
assert.equal(configuredLegacyHosts.length, 1, 'Fly 설정의 이전 Host는 한 번 명시해야 합니다.');
const LEGACY_HOST = configuredLegacyHosts[0][1];
assert.match(LEGACY_HOST, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.fly\.dev$/, '이전 Host는 단일 Fly 기본 호스트여야 합니다.');

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

test('옛 계정 화면·메일 링크 경로도 GET·HEAD 301이며 서버는 해시를 조합하지 않음', async () => {
  await withServer({}, async app => {
    // #token은 브라우저에만 있으므로 요청에 보내지 않으며 Location에도 추가하지 않습니다.
    for (const path of ['/account/', '/account/?view=signin&game=slimeline', '/account/?view=verify', '/account/?view=reset', '/account/?view=guardian']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await request(app, path, { method });
        assert.equal(response.status, 301, `${method} ${path}`);
        assert.equal(response.headers.location, `${ORIGIN}${path}`);
        assert.equal(new URL(response.headers.location).hash, '');
        assert.equal(response.headers['set-cookie'], undefined);
        assert.equal(response.headers['referrer-policy'], 'no-referrer');
        assert.equal(response.text, '');
      }
      assert.equal((await request(app, path, { method: 'POST', headers: { origin: ORIGIN } })).status, 403);
    }
  });
});

test('옛 Host는 인증·세션 API와 모든 쓰기 메서드를 거부', async () => {
  await withServer({}, async app => {
    for (const path of ['/api', '/api/', '/api/community/session', '/api/account/session', '/api/account/config', '/api/account/verify-email', '/api/account/guardian-requests', '/api/auth/sign-in/email', '/api/auth/send-verification-email', '/api/auth/request-password-reset', '/%61pi/account/session', '/api%2faccount/session', '/%61pi/community/session', '/api%2fcommunity/session']) {
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
    for (const method of ['GET', 'HEAD']) {
      const account = await request(app, '/account/?view=verify', { host, method });
      assert.equal(account.status, 200);
      assert.equal(account.headers['cache-control'], 'no-store');
      assert.equal(account.headers['referrer-policy'], 'no-referrer');
      assert.equal(account.headers.location, undefined);
    }
    const accountSession = await request(app, '/api/account/session', { host });
    assert.equal(accountSession.status, 200);
    assert.deepEqual(JSON.parse(accountSession.text), { user: null });
    assert.equal(accountSession.headers['cache-control'], 'no-store');
    assert.equal((await request(app, '/api/auth/sign-out', { host, method: 'POST', headers: { origin: `https://${LEGACY_HOST}`, 'content-type': 'application/json' } })).status, 403);
  });
});

test('BETTER_AUTH_URL의 새 출처가 가입·인증 재발송·복구·보호자 메일에 적용됨', async () => {
  const previous = process.env.BETTER_AUTH_URL;
  const mailbox = [];
  try {
    process.env.BETTER_AUTH_URL = ORIGIN;
    await withServer({ baseURL: undefined, mailer: async message => mailbox.push(message), guardianReplyTo: 'support@example.test' }, async app => {
      assert.equal(app.origin, ORIGIN);
      const email = 'domain-account@example.test';
      const post = (path, body) => accountRequest(app, path, { method: 'POST', body });
      assert.equal((await post('/api/auth/sign-up/email', { name: '도메인확인', email, password: '테스트전용-도메인-1234', ageBand: '14plus', callbackURL: 'https://outside.example/steal' })).status, 200);
      assert.equal((await post('/api/auth/send-verification-email', { email, callbackURL: 'https://outside.example/steal' })).status, 200);
      assert.equal((await post('/api/auth/request-password-reset', { email, redirectTo: 'https://outside.example/steal' })).status, 200);
      assert.equal((await post('/api/account/guardian-requests', { guardianName: '보호자확인', guardianEmail: 'domain-guardian@example.test' })).status, 200);
      assert.equal(mailbox.length, 4);
      for (const [index, message] of mailbox.entries()) {
        // 동의문에는 업체 문의·공개 방침 링크도 포함하므로 계정 절차 링크를 구분합니다.
        const links = [...message.text.matchAll(/https?:\/\/[^\s)]+/g)].map(match => new URL(match[0]));
        const accountLinks = links.filter(link => link.pathname === '/account/');
        assert.equal(accountLinks.length, 1);
        const [link] = accountLinks;
        assert.equal(link.origin, ORIGIN);
        assert.equal(link.pathname, '/account/');
        assert.equal(link.searchParams.get('view'), ['verify', 'verify', 'reset', 'guardian'][index]);
        assert.equal(link.searchParams.has('token'), false);
        assert.equal(link.hash.startsWith('#token='), index < 3);
        for (const other of links.filter(candidate => candidate !== link)) {
          assert.equal(other.hash.includes('token='), false);
          assert.equal(other.searchParams.has('token'), false);
        }
        assert.doesNotMatch(message.text, /outside\.example/);
      }
    });
  } finally {
    if (previous === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previous;
  }
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
