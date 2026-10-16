import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { parseOidcClients } from '../server/oidc.js';
import { approveGuardianRequest } from '../server/guardian-review.js';
import { request, cookieFrom, tokenFrom, registerAndLogin } from './account-helpers.js';

// 시험용 클라이언트 비밀값은 실행할 때마다 새로 만들고 저장소에 남기지 않는다.
const password = '오아이디씨-시험-비밀번호-1234';
const REDIRECT = 'http://127.0.0.1:5173/auth/gracekin/callback';
const devClient = { client_id: 'gyeongguk-dev', client_secret: randomBytes(32).toString('base64url'), redirect_uris: [REDIRECT], name: '경국지계(로컬)' };
const testClient = { client_id: 'gyeongguk-test', client_secret: randomBytes(32).toString('base64url'), redirect_uris: ['https://gyeongguk-test.fly.dev/auth/gracekin/callback'], name: '경국지계(스테이징)' };
const adult = email => ({ name: '연결회원', email, password, ageBand: '14plus' });
const post = (app, path, body, cookie) => request(app, path, { method: 'POST', body, cookie });
const b64 = value => Buffer.from(value).toString('base64url');

async function scenario(callback, extra = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-oidc-'));
  const mailbox = [];
  let app;
  const options = { port: 0, dataDir: folder, mailer: async message => mailbox.push(message), guardianReplyTo: 'support@example.test', rateLimit: { authMax: 200, readMax: 400 }, oidcClients: JSON.stringify([devClient, testClient]), env: {}, ...extra };
  try {
    app = await startServer(options);
    const db = new DatabaseSync(join(folder, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON;');
    try { await callback({ app, db, folder, mailbox, async restart(next = {}) { await app.close(); app = await startServer({ ...options, ...next }); return app; } }); } finally { db.close(); }
  } finally { await app?.close(); await rm(folder, { recursive: true, force: true }); }
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
function authorizePath({ client = devClient, redirect = REDIRECT, challenge, method = 'S256', state = randomBytes(12).toString('base64url'), nonce = randomBytes(12).toString('base64url'), scope = 'openid', extra = {} } = {}) {
  const params = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, scope, state, nonce, ...extra });
  if (challenge) { params.set('code_challenge', challenge); params.set('code_challenge_method', method); }
  return { path: `/api/auth/oauth2/authorize?${params}`, state, nonce };
}
// 브라우저 이동과 같은 머리글로 인가 요청을 보낸다.
const navigate = (app, path, cookie) => request(app, path, { cookie, headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site', accept: 'text/html' } });

function tokenRequest(app, form, { client = devClient, basic = true, headers = {} } = {}) {
  const body = new URLSearchParams(form);
  if (!basic) { body.set('client_id', client.client_id); body.set('client_secret', client.client_secret); }
  const data = body.toString();
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: app.port, path: '/api/auth/oauth2/token', method: 'POST', headers: {
      host: new URL(app.origin).host, 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data),
      ...(basic ? { authorization: `Basic ${Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`).toString('base64')}` } : {}), ...headers,
    } }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let parsed; try { parsed = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, body: parsed }); }); });
    req.on('error', reject); req.end(data);
  });
}

// 계약 1절의 경국지계 쪽 검증을 그대로 흉내 낸다: 발견 문서 → JWKS → 서명·iss·aud·exp·nonce.
async function verifyIdToken(app, token, { audience = devClient.client_id, nonce }) {
  const discovery = (await request(app, '/.well-known/openid-configuration')).body;
  const jwks = (await request(app, new URL(discovery.jwks_uri).pathname)).body;
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url'));
  const jwk = jwks.keys.find(key => key.kid === header.kid);
  assert.ok(jwk, 'JWKS에 서명 키가 있어야 함');
  assert.equal(header.alg, 'EdDSA'); assert.equal(jwk.kty, 'OKP'); assert.equal(jwk.crv, 'Ed25519');
  assert.equal(jwks.keys.some(key => 'd' in key), false, 'JWKS에 개인 키가 없어야 함');
  assert.ok(verify(null, Buffer.from(`${headerPart}.${payloadPart}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signaturePart, 'base64url')));
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url'));
  assert.equal(claims.iss, discovery.issuer); assert.equal(claims.aud, audience); assert.equal(claims.nonce, nonce);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(claims.exp > now && claims.exp <= now + 600 + 5); assert.ok(claims.iat <= now + 5);
  return claims;
}

async function codeFrom(location, state) {
  const url = new URL(location);
  assert.equal(`${url.origin}${url.pathname}`, REDIRECT);
  assert.equal(url.searchParams.get('state'), state);
  assert.ok(url.searchParams.get('code'));
  return url.searchParams.get('code');
}

test('발견 문서는 루트 경로·계약 값만 광고하고 클라이언트 등록 형식을 엄격히 검사', async () => scenario(async ({ app }) => {
  const response = await request(app, '/.well-known/openid-configuration');
  assert.equal(response.status, 200);
  const doc = response.body;
  assert.equal(doc.issuer, app.origin);
  assert.equal(doc.authorization_endpoint, `${app.origin}/api/auth/oauth2/authorize`);
  assert.equal(doc.token_endpoint, `${app.origin}/api/auth/oauth2/token`);
  assert.equal(doc.jwks_uri, `${app.origin}/api/auth/jwks`);
  assert.deepEqual(doc.response_types_supported, ['code']);
  assert.deepEqual(doc.code_challenge_methods_supported, ['S256']);
  assert.ok(doc.token_endpoint_auth_methods_supported.includes('client_secret_basic'));
  assert.ok(doc.claims_supported.includes('age_band'));
  assert.deepEqual(doc.scopes_supported, ['openid', 'profile']);
  assert.ok(doc.claims_supported.includes('name'));
  assert.ok(doc.id_token_signing_alg_values_supported.includes('EdDSA'));
  assert.equal((await request(app, '/.well-known/openid-configuration', { method: 'POST', body: {} })).status, 405);
  assert.equal((await request(app, '/api/auth/token')).status, 404);
  assert.equal((await request(app, '/api/auth/oauth2/register', { method: 'POST', body: {} })).status, 404);

  assert.equal(parseOidcClients('', { production: true }).length, 0);
  assert.throws(() => parseOidcClients('{"client_id":"x"}', { production: false }), /JSON 배열/);
  assert.throws(() => parseOidcClients(JSON.stringify([{ ...devClient, client_secret: '짧음' }]), { production: false }), /32자/);
  assert.throws(() => parseOidcClients(JSON.stringify([{ ...devClient, extra: true }]), { production: false }), /만 사용할 수 있습니다/);
  assert.throws(() => parseOidcClients(JSON.stringify([devClient, devClient]), { production: false }), /client_id/);
  assert.throws(() => parseOidcClients(JSON.stringify([devClient]), { production: true }), /HTTPS/);
  assert.throws(() => parseOidcClients(JSON.stringify([{ ...testClient, redirect_uris: ['https://outside.example/cb#x'] }]), { production: true }), /redirect_uris/);
  assert.throws(() => parseOidcClients(JSON.stringify([{ ...testClient, redirect_uris: ['http://outside.example/cb'] }]), { production: false }), /redirect_uris/);
  const parsed = parseOidcClients(JSON.stringify([testClient]), { production: true });
  assert.equal(parsed[0].clientId, 'gyeongguk-test'); assert.equal(JSON.stringify(parsed).includes(testClient.client_secret), false);
}));

test('로그인한 회원: 인가 → 코드 → client_secret_basic 토큰 → JWKS 검증, 코드 재사용·PKCE 위반 거부', async () => scenario(async ({ app, db, mailbox }) => {
  const login = await registerAndLogin(app, mailbox, adult('oidc-member@example.test'));
  const cookie = cookieFrom(login), userId = login.body.user.id;
  assert.equal(JSON.stringify(db.prepare('SELECT clientSecret FROM oauthClient').all()).includes(devClient.client_secret), false);
  const { verifier, challenge } = pkce();
  const auth = authorizePath({ challenge });
  const redirected = await navigate(app, auth.path, cookie);
  assert.equal(redirected.status, 302);
  const code = await codeFrom(redirected.headers.location, auth.state);
  assert.equal(new URL(redirected.headers.location).searchParams.get('iss'), app.origin);

  // client_secret_post는 등록 방식과 달라 거부한다.
  const post = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier }, { basic: false });
  assert.ok([400, 401].includes(post.status)); assert.equal(post.body.error, 'invalid_client');
  const wrongSecret = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier }, { client: { ...devClient, client_secret: randomBytes(32).toString('base64url') } });
  assert.equal(wrongSecret.status, 401);
  const wrongVerifier = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: pkce().verifier });
  assert.equal(wrongVerifier.status, 400);

  // 실패한 교환 뒤에도 아래처럼 새 코드로 정상 흐름을 확인한다(코드는 한 번 소비되면 다시 쓸 수 없다).
  const second = pkce();
  const auth2 = authorizePath({ challenge: second.challenge });
  const code2 = await codeFrom((await navigate(app, auth2.path, cookie)).headers.location, auth2.state);
  const token = await tokenRequest(app, { grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, code_verifier: second.verifier });
  assert.equal(token.status, 200, JSON.stringify(token.body));
  assert.equal(token.body.token_type, 'Bearer'); assert.equal(token.body.refresh_token, undefined);
  assert.equal(token.headers['cache-control'], 'no-store');
  const claims = await verifyIdToken(app, token.body.id_token, { nonce: auth2.nonce });
  assert.equal(claims.sub, userId); assert.equal(claims.age_band, '14plus');
  for (const name of ['email', 'name', 'email_verified', 'picture']) assert.equal(name in claims, false);
  const reused = await tokenRequest(app, { grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, code_verifier: second.verifier });
  assert.equal(reused.status, 400); assert.equal(reused.body.error, 'invalid_grant');
  // 다른 클라이언트는 남의 코드를 바꿔 갈 수 없다.
  const third = pkce();
  const auth3 = authorizePath({ challenge: third.challenge });
  const code3 = await codeFrom((await navigate(app, auth3.path, cookie)).headers.location, auth3.state);
  assert.equal((await tokenRequest(app, { grant_type: 'authorization_code', code: code3, redirect_uri: REDIRECT, code_verifier: third.verifier }, { client: testClient })).status, 400);
}));

test('인가 요청 검증: 미등록 주소·PKCE 누락·plain·다른 범위·미등록 클라이언트는 코드를 내주지 않음', async () => scenario(async ({ app, mailbox }) => {
  const cookie = cookieFrom(await registerAndLogin(app, mailbox, adult('oidc-guard@example.test')));
  const { challenge } = pkce();
  const cases = [
    authorizePath({ challenge, redirect: 'http://127.0.0.1:5174/auth/gracekin/callback' }).path,
    authorizePath({ challenge, redirect: `${REDIRECT}/../steal` }).path,
    authorizePath({ challenge, client: { client_id: 'unknown-client' } }).path,
  ];
  for (const path of cases) {
    const response = await navigate(app, path, cookie);
    assert.equal(response.status, 302);
    const location = new URL(response.headers.location, app.origin);
    assert.equal(location.origin, app.origin, '등록되지 않은 주소로 보내지 않음');
    assert.equal(location.searchParams.get('code'), null);
  }
  for (const path of [authorizePath({}).path, authorizePath({ challenge, method: 'plain' }).path, authorizePath({ challenge, scope: 'openid email' }).path, authorizePath({ challenge, scope: 'openid offline_access' }).path]) {
    const response = await navigate(app, path, cookie);
    const location = new URL(response.headers.location, app.origin);
    assert.equal(location.searchParams.get('code'), null, path);
    assert.ok(location.searchParams.get('error'), path);
  }
}));

test('로그인 전 인가 요청은 계정 화면으로 보내고 로그인 뒤 같은 요청으로 코드 발급, 취소는 access_denied', async () => scenario(async ({ app, mailbox }) => {
  const email = 'oidc-later@example.test';
  await registerAndLogin(app, mailbox, adult(email));
  const { verifier, challenge } = pkce();
  const auth = authorizePath({ challenge });
  const first = await navigate(app, auth.path);
  assert.equal(first.status, 302);
  const login = new URL(first.headers.location, app.origin);
  assert.equal(login.origin, app.origin); assert.equal(login.pathname, '/account/');
  const oauthQuery = login.search.slice(1);
  assert.ok(new URLSearchParams(oauthQuery).get('sig'));
  const context = await post(app, '/api/account/oidc/context', { oauth_query: oauthQuery });
  assert.deepEqual(context.body, { clientName: '경국지계(로컬)', signedIn: false, needsAgeConfirmation: false, loginRequired: false });
  const tampered = oauthQuery.replace('gyeongguk-dev', 'gyeongguk-test');
  assert.equal((await post(app, '/api/account/oidc/context', { oauth_query: tampered })).status, 400);
  assert.equal((await post(app, '/api/auth/sign-in/email', { email, password, oauth_query: tampered })).status, 400);

  const cancelled = await post(app, '/api/account/oidc/cancel', { oauth_query: oauthQuery });
  const denied = new URL(cancelled.body.url);
  assert.equal(`${denied.origin}${denied.pathname}`, REDIRECT);
  assert.equal(denied.searchParams.get('error'), 'access_denied'); assert.equal(denied.searchParams.get('state'), auth.state);
  assert.equal(denied.searchParams.get('code'), null);

  const signin = await post(app, '/api/auth/sign-in/email', { email, password, oauth_query: oauthQuery });
  assert.equal(signin.status, 200);
  assert.equal(signin.body.redirect, true);
  const code = await codeFrom(signin.body.url, auth.state);
  const token = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal(token.status, 200);
  assert.equal((await verifyIdToken(app, token.body.id_token, { nonce: auth.nonce })).age_band, '14plus');
}));

test('연령 기록 없는 기존 회원은 연령 선택 전 코드 미발급, 14세 이상 선택 뒤 발급하고 커뮤니티 구분은 유지', async () => scenario(async ({ app, db, mailbox }) => {
  const login = await registerAndLogin(app, mailbox, adult('oidc-legacy@example.test'));
  const userId = login.body.user.id;
  db.prepare('UPDATE user SET ageBand=NULL,emailVerified=0 WHERE id=?').run(userId);
  const cookie = cookieFrom(await post(app, '/api/auth/sign-in/email', { email: 'oidc-legacy@example.test', password }));
  const { verifier, challenge } = pkce();
  const auth = authorizePath({ challenge });
  const response = await navigate(app, auth.path, cookie);
  const page = new URL(response.headers.location, app.origin);
  assert.equal(page.pathname, '/account/'); assert.equal(page.searchParams.get('code'), null);
  const oauthQuery = page.search.slice(1);
  assert.equal((await post(app, '/api/account/oidc/context', { oauth_query: oauthQuery }, cookie)).body.needsAgeConfirmation, true);
  const early = await post(app, '/api/auth/oauth2/continue', { postLogin: true, oauth_query: oauthQuery }, cookie);
  assert.equal(early.status, 403); assert.equal(early.body.error.code, 'AGE_CONFIRMATION_REQUIRED');
  assert.equal((await post(app, '/api/account/oidc/age', { ageBand: 'under14' }, cookie)).status, 422);
  assert.equal((await post(app, '/api/account/oidc/age', { ageBand: '14plus' })).status, 401);
  assert.equal((await post(app, '/api/account/oidc/age', { ageBand: '14plus' }, cookie)).status, 200);
  assert.equal((await post(app, '/api/account/oidc/context', { oauth_query: oauthQuery }, cookie)).body.needsAgeConfirmation, false);
  const resumed = await post(app, '/api/auth/oauth2/continue', { postLogin: true, oauth_query: oauthQuery }, cookie);
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  const code = await codeFrom(resumed.body.url, auth.state);
  const token = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
  const claims = await verifyIdToken(app, token.body.id_token, { nonce: auth.nonce });
  assert.equal(claims.sub, userId); assert.equal(claims.age_band, '14plus');
  const session = (await request(app, '/api/account/session', { cookie })).body.user;
  assert.equal(session.ageBand, 'legacy'); assert.equal(session.canWriteCommunity, true);
  assert.equal(db.prepare('SELECT ageBand FROM user WHERE id=?').get(userId).ageBand, null);
  // 이미 연령이 기록된 회원은 다시 고를 수 없다.
  const other = cookieFrom(await registerAndLogin(app, mailbox, adult('oidc-has-age@example.test')));
  assert.equal((await post(app, '/api/account/oidc/age', { ageBand: '14plus' }, other)).status, 409);
}));

test('보호자 동의를 거친 어린이 계정은 under14로 코드 발급, 동의 철회 뒤에는 토큰 교환 거부', async () => scenario(async ({ app, db, folder, mailbox }) => {
  const requested = await post(app, '/api/account/guardian-requests', { guardianName: '보호자확인', guardianEmail: 'guardian@example.test' });
  const guardianCookie = cookieFrom(requested);
  const id = (await request(app, '/api/account/guardian-request', { cookie: guardianCookie })).body.request.requestNumber;
  const evidencePath = join(folder, 'reply.eml');
  await writeFile(evidencePath, `From: 보호자 <guardian@example.test>\r\nSubject: 동의 회신 ${id}\r\n\r\n본인은 법정대리인으로서 안내된 개인정보 처리와 가입에 동의합니다. 신청 번호 ${id}`, { mode: 0o600 });
  await approveGuardianRequest(db, { id, dataDir: folder, evidencePath, confirmReply: true, confirmGuardian: true, confirmScope: true });
  const child = { name: '어린이회원', email: 'oidc-child@example.test', password, ageBand: 'under14' };
  assert.equal((await post(app, '/api/auth/sign-up/email', child, guardianCookie)).status, 200);
  await post(app, '/api/account/verify-email', { token: tokenFrom(mailbox.findLast(item => item.to === child.email)) });
  const cookie = cookieFrom(await post(app, '/api/auth/sign-in/email', { email: child.email, password }));
  const { verifier, challenge } = pkce();
  const auth = authorizePath({ challenge });
  const code = await codeFrom((await navigate(app, auth.path, cookie)).headers.location, auth.state);
  const token = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal((await verifyIdToken(app, token.body.id_token, { nonce: auth.nonce })).age_band, 'under14');
  const next = pkce();
  const auth2 = authorizePath({ challenge: next.challenge });
  const code2 = await codeFrom((await navigate(app, auth2.path, cookie)).headers.location, auth2.state);
  db.prepare("UPDATE guardian_requests SET status='withdrawn'").run();
  const blocked = await tokenRequest(app, { grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, code_verifier: next.verifier });
  assert.equal(blocked.status >= 400, true);
  assert.equal(blocked.body.id_token, undefined);
}));

test('OIDC_CLIENTS에서 빠진 클라이언트는 재시작 때 사용 중지되고 비밀값 교체가 반영됨', async () => scenario(async ({ app, db, mailbox, restart }) => {
  const cookie = cookieFrom(await registerAndLogin(app, mailbox, adult('oidc-rotate@example.test')));
  const rotated = { ...devClient, client_secret: randomBytes(32).toString('base64url') };
  const next = await restart({ oidcClients: JSON.stringify([rotated]) });
  assert.equal(db.prepare("SELECT disabled FROM oauthClient WHERE clientId='gyeongguk-test'").get().disabled, 1);
  const { verifier, challenge } = pkce();
  const disabled = await navigate(next, authorizePath({ challenge, client: testClient, redirect: testClient.redirect_uris[0] }).path, cookie);
  assert.equal(new URL(disabled.headers.location, next.origin).searchParams.get('code'), null);
  const auth = authorizePath({ challenge });
  const code = await codeFrom((await navigate(next, auth.path, cookie)).headers.location, auth.state);
  assert.equal((await tokenRequest(next, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier })).status, 401);
  const again = pkce();
  const auth2 = authorizePath({ challenge: again.challenge });
  const code2 = await codeFrom((await navigate(next, auth2.path, cookie)).headers.location, auth2.state);
  assert.equal((await tokenRequest(next, { grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, code_verifier: again.verifier }, { client: rotated })).status, 200);
}));

test('profile 범위를 요청하면 ID 토큰에 커뮤니티 닉네임만 싣고, openid만이면 싣지 않음(기획 35 결정 7)', async () => scenario(async ({ app, mailbox }) => {
  const cookie = cookieFrom(await registerAndLogin(app, mailbox, adult('oidc-profile@example.test')));
  const { verifier, challenge } = pkce();
  const auth = authorizePath({ challenge, scope: 'openid profile' });
  const code = await codeFrom((await navigate(app, auth.path, cookie)).headers.location, auth.state);
  const token = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal(token.status, 200, JSON.stringify(token.body));
  const claims = await verifyIdToken(app, token.body.id_token, { nonce: auth.nonce });
  assert.equal(claims.name, '연결회원'); assert.equal(claims.age_band, '14plus');
  for (const name of ['email', 'email_verified', 'picture']) assert.equal(name in claims, false);
  const plain = pkce();
  const auth2 = authorizePath({ challenge: plain.challenge });
  const code2 = await codeFrom((await navigate(app, auth2.path, cookie)).headers.location, auth2.state);
  const token2 = await tokenRequest(app, { grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, code_verifier: plain.verifier });
  assert.equal('name' in (await verifyIdToken(app, token2.body.id_token, { nonce: auth2.nonce })), false);
}));

test('prompt=none: 로그인 안 됨은 login_required, 연령 확인 남음은 interaction_required로 게임에 바로 돌려보내고, 로그인됨은 화면 없이 코드', async () => scenario(async ({ app, db, mailbox }) => {
  const errorOf = async (cookie, expected) => {
    const { challenge } = pkce();
    const auth = authorizePath({ challenge, scope: 'openid profile', extra: { prompt: 'none' } });
    const response = await navigate(app, auth.path, cookie);
    assert.equal(response.status, 302);
    const url = new URL(response.headers.location);
    assert.equal(`${url.origin}${url.pathname}`, REDIRECT, '계정 화면이 아니라 게임 복귀 주소로');
    assert.equal(url.searchParams.get('error'), expected); assert.equal(url.searchParams.get('state'), auth.state);
    assert.equal(url.searchParams.get('code'), null);
  };
  await errorOf(undefined, 'login_required');
  const login = await registerAndLogin(app, mailbox, adult('oidc-silent@example.test'));
  const cookie = cookieFrom(login);
  const { verifier, challenge } = pkce();
  const auth = authorizePath({ challenge, scope: 'openid profile', extra: { prompt: 'none' } });
  const code = await codeFrom((await navigate(app, auth.path, cookie)).headers.location, auth.state);
  const token = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal((await verifyIdToken(app, token.body.id_token, { nonce: auth.nonce })).name, '연결회원');
  db.prepare('UPDATE user SET ageBand=NULL WHERE id=?').run(login.body.user.id);
  await errorOf(cookie, 'interaction_required');
}));
