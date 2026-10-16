import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { approveGuardianRequest } from '../server/guardian-review.js';
import { request as rawRequest, cookieFrom, tokenFrom, registerAndLogin as rawRegisterAndLogin } from './account-helpers.js';

// 실제 공급자 키는 쓰지 않는다. 시험용 값은 실행마다 만들고, 공급자 응답은 아래 가짜 fetch가 돌려준다.
const env = {
  GOOGLE_CLIENT_ID: `google-test-${randomBytes(6).toString('hex')}`, GOOGLE_CLIENT_SECRET: randomBytes(24).toString('base64url'),
  NAVER_CLIENT_ID: `naver-test-${randomBytes(6).toString('hex')}`, NAVER_CLIENT_SECRET: randomBytes(24).toString('base64url'),
};
const password = '소셜시험-비밀번호-1234';
const adult = email => ({ name: '기존회원', email, password, ageBand: '14plus' });

// 공급자별로 '다음 로그인에서 돌려줄 프로필'을 정한다.
const profiles = { google: null, naver: null };
const realFetch = globalThis.fetch;
function fakeIdToken(claims) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256', typ: 'JWT', kid: 'fake' })}.${part({ iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...claims })}.c2ln`;
}
const jsonResponse = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(String(init?.body ?? ''));
    assert.equal(body.get('redirect_uri').endsWith('/api/auth/callback/google'), true);
    assert.ok(body.get('code_verifier'));
    return jsonResponse({ access_token: `google-access-${randomBytes(4).toString('hex')}`, id_token: fakeIdToken(profiles.google), expires_in: 3600, token_type: 'Bearer', scope: 'openid email profile' });
  }
  if (url.href === 'https://nid.naver.com/oauth2.0/token') return jsonResponse({ access_token: `naver-access-${randomBytes(4).toString('hex')}`, refresh_token: 'naver-refresh', token_type: 'bearer', expires_in: '3600' });
  if (url.href === 'https://openapi.naver.com/v1/nid/me') return jsonResponse({ resultcode: '00', message: 'success', response: profiles.naver });
  if (['oauth2.googleapis.com', 'www.googleapis.com', 'nid.naver.com', 'openapi.naver.com'].includes(url.hostname)) throw new Error(`시험에서 예상하지 않은 공급자 요청: ${url.href}`);
  return realFetch(input, init);
};
test.after(() => { globalThis.fetch = realFetch; });

// 쿠키 만료(Max-Age=0)까지 반영하는 최소 쿠키 보관함.
function jar(initial = '') {
  const cookies = new Map(initial.split('; ').filter(Boolean).map(pair => [pair.split('=')[0], pair.slice(pair.indexOf('=') + 1)]));
  return {
    take(response) {
      for (const line of response.headers['set-cookie'] || []) {
        const [pair, ...attributes] = line.split(';');
        const name = pair.split('=')[0], value = pair.slice(pair.indexOf('=') + 1);
        if (attributes.some(item => /^\s*max-age=0\s*$/i.test(item)) || value === '') cookies.delete(name); else cookies.set(name, value);
      }
      return response;
    },
    get header() { return [...cookies].map(([name, value]) => `${name}=${value}`).join('; '); },
    has: name => [...cookies.keys()].some(key => key.includes(name)),
  };
}

// Better Auth의 속도 제한은 같은 프로세스의 앱끼리 공유되므로, 시나리오마다 신뢰 프록시 IP를 따로 주어 격리한다.
let nextIP = 1;
const scenarioIP = new WeakMap();
const ipFor = app => { if (!scenarioIP.has(app)) scenarioIP.set(app, `198.51.100.${100 + nextIP++}`); return scenarioIP.get(app); };
const request = (app, path, options = {}) => rawRequest(app, path, { ...options, headers: { 'fly-client-ip': ipFor(app), ...options.headers } });
const registerAndLogin = (app, mailbox, body) => rawRegisterAndLogin(app, mailbox, body, { 'fly-client-ip': ipFor(app) });

async function scenario(callback, extra = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-social-'));
  const mailbox = [];
  let app;
  try {
    app = await startServer({ port: 0, dataDir: folder, trustFlyProxy: true, flyAppName: 'gracekin-games-community', mailer: async message => mailbox.push(message), guardianReplyTo: 'support@example.test', rateLimit: { authMax: 300, readMax: 400 }, env, ...extra });
    const db = new DatabaseSync(join(folder, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON;');
    try { await callback({ app, db, folder, mailbox }); } finally { db.close(); }
  } finally { await app?.close(); await rm(folder, { recursive: true, force: true }); }
}

// 계정 화면이 하는 것과 같이 공급자로 보낼 주소를 받고, 공급자가 code·state를 붙여 콜백으로 돌려보낸 상황을 만든다.
async function socialRound(app, browser, provider, body, { path = '/api/auth/sign-in/social', expectStart = 200 } = {}) {
  const start = browser.take(await request(app, path, { method: 'POST', body: { provider, ...body }, cookie: browser.header }));
  assert.equal(start.status, expectStart, JSON.stringify(start.body));
  if (start.status !== 200) return { start };
  const authorize = new URL(start.body.url);
  assert.equal(authorize.origin, provider === 'google' ? 'https://accounts.google.com' : 'https://nid.naver.com');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${app.origin}/api/auth/callback/${provider}`);
  const state = authorize.searchParams.get('state');
  const back = browser.take(await request(app, `/api/auth/callback/${provider}?${new URLSearchParams({ code: `code-${randomBytes(4).toString('hex')}`, state })}`, { cookie: browser.header, headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', accept: 'text/html' } }));
  assert.equal(back.status, 302);
  return { start, back, location: new URL(back.headers.location, app.origin) };
}
const session = async (app, browser) => (await request(app, '/api/account/session', { cookie: browser.header })).body.user;
const wallet = async (app, browser) => (await request(app, '/api/account/grain', { cookie: browser.header })).body;
const googleProfile = (sub, email, extra = {}) => ({ sub, email, email_verified: true, name: '실명노출금지', picture: 'https://example.test/face.png', ...extra });

test('설정에 키가 있는 공급자만 켜지고, 키가 없으면 소셜 경로가 닫힘', async () => {
  await scenario(async ({ app }) => {
    const config = (await request(app, '/api/account/config')).body;
    assert.deepEqual(config.socialProviders, ['google', 'naver']); assert.equal(config.socialSignupAvailable, true);
  });
  await scenario(async ({ app }) => {
    const config = (await request(app, '/api/account/config')).body;
    assert.deepEqual(config.socialProviders, ['naver']);
    assert.equal((await request(app, '/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google' } })).status, 422);
    assert.equal((await request(app, '/api/auth/callback/google?code=x&state=y')).status, 404);
  }, { env: { NAVER_CLIENT_ID: env.NAVER_CLIENT_ID, NAVER_CLIENT_SECRET: env.NAVER_CLIENT_SECRET } });
  await scenario(async ({ app }) => {
    assert.deepEqual((await request(app, '/api/account/config')).body.socialProviders, []);
  }, { env: {} });
});

test('연령 선택 뒤 구글 가입: 서버가 정한 닉네임·14plus·확인 이메일로 가입 때 30,000 그레인 한 번', async () => scenario(async ({ app, db }) => {
  const browser = jar();
  profiles.google = googleProfile('google-sub-1', 'social-google@example.test');
  // 연령 없이 또는 14세 미만으로는 소셜 가입을 시작하지 않는다.
  assert.equal((await request(app, '/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', requestSignUp: true, name: '소셜가입자' } })).status, 422);
  assert.equal((await request(app, '/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', requestSignUp: true, ageBand: 'under14', name: '소셜가입자' } })).status, 403);
  assert.equal((await request(app, '/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', requestSignUp: true, ageBand: '14plus', name: '소셜가입자', callbackURL: 'https://outside.example/' } })).status, 422);
  assert.equal((await request(app, '/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', ageBand: '14plus' } })).status, 422);
  const { location } = await socialRound(app, browser, 'google', { requestSignUp: true, ageBand: '14plus', name: '소셜가입자' });
  assert.equal(location.pathname, '/account/'); assert.equal(location.searchParams.get('joined'), 'google');
  assert.equal(browser.has('social-signup'), false, '가입용 연령 쿠키는 콜백에서 지움');
  const user = db.prepare('SELECT * FROM user WHERE email=?').get('social-google@example.test');
  assert.equal(user.name, '소셜가입자'); assert.equal(user.ageBand, '14plus'); assert.equal(user.emailVerified, 1); assert.equal(user.image, null);
  const account = db.prepare("SELECT * FROM account WHERE userId=? AND providerId='google'").get(user.id);
  assert.equal(account.accountId, 'google-sub-1');
  assert.doesNotMatch(String(account.accessToken), /google-access-/, '공급자 토큰은 암호화해 저장');
  assert.equal((await session(app, browser)).id, user.id);
  const first = await wallet(app, browser);
  assert.equal(first.balance, 30000); assert.equal(first.entries.length, 1);
  // 같은 구글 계정으로 다시 로그인해도 추가 지급·추가 회원이 없다.
  const again = jar();
  const relogin = await socialRound(app, again, 'google', {});
  assert.equal(relogin.location.searchParams.get('error'), null);
  assert.equal((await session(app, again)).id, user.id);
  assert.equal((await wallet(app, again)).balance, 30000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 1);
}));

test('소셜로만 가입한 회원도 비밀번호 재설정으로 이메일 로그인을 추가하고, 그 뒤 소셜 해제 가능', async () => scenario(async ({ app, mailbox }) => {
  profiles.google = googleProfile('google-only', 'social-only@example.test');
  const browser = jar();
  await socialRound(app, browser, 'google', { requestSignUp: true, ageBand: '14plus', name: '소셜전용' });
  const only = (await request(app, '/api/account/login-methods', { cookie: browser.header })).body;
  assert.deepEqual(only.methods.map(item => item.provider), ['google']); assert.equal(only.canUnlink, false);
  assert.equal((await request(app, '/api/account/login-methods/unlink', { method: 'POST', body: { provider: 'google' }, cookie: browser.header })).status, 400);
  assert.equal((await request(app, '/api/auth/request-password-reset', { method: 'POST', body: { email: 'social-only@example.test' } })).status, 200);
  const reset = await request(app, '/api/auth/reset-password', { method: 'POST', body: { token: tokenFrom(mailbox.at(-1)), newPassword: password } });
  assert.equal(reset.status, 200);
  const login = jar(cookieFrom(await request(app, '/api/auth/sign-in/email', { method: 'POST', body: { email: 'social-only@example.test', password } })));
  const both = (await request(app, '/api/account/login-methods', { cookie: login.header })).body;
  assert.deepEqual(both.methods.map(item => item.provider).sort(), ['email', 'google']);
  assert.equal((await request(app, '/api/account/login-methods/unlink', { method: 'POST', body: { provider: 'google' }, cookie: login.header })).status, 200);
}));

test('처음 보는 소셜 계정의 로그인은 회원을 만들지 않고 가입 안내, 연령 쿠키 없는 가입도 거부', async () => scenario(async ({ app, db }) => {
  profiles.google = googleProfile('google-new', 'unknown-social@example.test');
  const login = await socialRound(app, jar(), 'google', {});
  assert.equal(login.location.searchParams.get('error'), 'signup_disabled');
  assert.equal(login.location.searchParams.get('view'), 'signin');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0);
  // 가입 요청이어도 서버가 서명한 연령 쿠키가 콜백에 오지 않으면 만들지 않는다.
  const browser = jar();
  const start = browser.take(await request(app, '/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', requestSignUp: true, ageBand: '14plus', name: '쿠키없음' } }));
  const state = new URL(start.body.url).searchParams.get('state');
  const withoutAge = browser.header.split('; ').filter(pair => !pair.includes('social-signup')).join('; ');
  const back = await request(app, `/api/auth/callback/google?code=c1&state=${state}`, { cookie: withoutAge });
  assert.equal(new URL(back.headers.location, app.origin).searchParams.get('error'), 'AGE_CONFIRMATION_REQUIRED');
  // 변조한 연령 쿠키도 거부한다.
  const forged = jar();
  const forgedStart = forged.take(await request(app, '/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', requestSignUp: true, ageBand: '14plus', name: '변조시험' } }));
  const tampered = forged.header.replace(/(social-signup=)([^.;]+)/, (_all, name) => `${name}${Buffer.from(JSON.stringify({ v: 1, a: '14plus', n: '변조닉네임', e: Math.floor(Date.now() / 1000) + 600, r: 'x' })).toString('base64url')}`);
  const forgedBack = await request(app, `/api/auth/callback/google?code=c2&state=${new URL(forgedStart.body.url).searchParams.get('state')}`, { cookie: tampered });
  assert.equal(new URL(forgedBack.headers.location, app.origin).searchParams.get('error'), 'AGE_CONFIRMATION_REQUIRED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_signup_reservations').get().n, 0);
}));

test('같은 이메일의 기존 회원에 자동 연결하지 않음', async () => scenario(async ({ app, db, mailbox }) => {
  await registerAndLogin(app, mailbox, adult('same@example.test'));
  profiles.google = googleProfile('google-same', 'same@example.test');
  const signup = await socialRound(app, jar(), 'google', { requestSignUp: true, ageBand: '14plus', name: '같은메일' });
  assert.equal(signup.location.searchParams.get('error'), 'account_not_linked');
  const login = await socialRound(app, jar(), 'google', {});
  assert.equal(login.location.searchParams.get('error'), 'account_not_linked');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM account WHERE providerId='google'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 1);
}));

test('네이버: 이메일 제공 시 가입 때 지급, 이메일이 없으면 가입하지 않음', async () => scenario(async ({ app, db }) => {
  profiles.naver = { id: 'naver-1', email: 'social-naver@example.test', name: '실명', nickname: '별명', profile_image: 'https://example.test/n.png' };
  const browser = jar();
  const joined = await socialRound(app, browser, 'naver', { requestSignUp: true, ageBand: '14plus', name: '네이버회원' });
  assert.equal(joined.location.searchParams.get('joined'), 'naver');
  const user = db.prepare('SELECT * FROM user WHERE email=?').get('social-naver@example.test');
  assert.equal(user.name, '네이버회원'); assert.equal(user.emailVerified, 1); assert.equal(user.image, null);
  assert.equal((await wallet(app, browser)).balance, 30000);
  profiles.naver = { id: 'naver-2', name: '실명' };
  const missing = await socialRound(app, jar(), 'naver', { requestSignUp: true, ageBand: '14plus', name: '메일없음' });
  assert.equal(missing.location.searchParams.get('error'), 'email_not_found');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 1);
}));

test('공급자가 확인하지 않은 이메일은 확인 메일 뒤에 로그인·지급', async () => scenario(async ({ app, db, mailbox }) => {
  profiles.google = googleProfile('google-unverified', 'unverified-social@example.test', { email_verified: false });
  const signup = await socialRound(app, jar(), 'google', { requestSignUp: true, ageBand: '14plus', name: '확인대기' });
  assert.equal(signup.location.searchParams.get('error'), 'EMAIL_NOT_VERIFIED');
  const user = db.prepare('SELECT * FROM user WHERE email=?').get('unverified-social@example.test');
  assert.equal(user.emailVerified, 0); assert.equal(user.ageBand, '14plus');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 0);
  const mail = mailbox.findLast(item => item.to === 'unverified-social@example.test');
  assert.ok(mail, '확인 메일 발송');
  assert.equal((await request(app, '/api/account/verify-email', { method: 'POST', body: { token: tokenFrom(mail) } })).status, 200);
  const browser = jar();
  const login = await socialRound(app, browser, 'google', {});
  assert.equal(login.location.searchParams.get('error'), null);
  assert.equal((await wallet(app, browser)).balance, 30000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 1);
}));

test('로그인한 회원만 계정 화면에서 수단 연결·해제, 마지막 하나는 해제 불가', async () => scenario(async ({ app, db, mailbox }) => {
  const browser = jar(cookieFrom(await registerAndLogin(app, mailbox, adult('linker@example.test'))));
  const userId = (await session(app, browser)).id;
  assert.equal((await request(app, '/api/account/login-methods/link', { method: 'POST', body: { provider: 'naver' } })).status, 401);
  const before = (await request(app, '/api/account/login-methods', { cookie: browser.header })).body;
  assert.deepEqual(before.methods.map(item => item.provider), ['email']); assert.equal(before.canUnlink, false);
  // 다른 이메일의 네이버 계정도 로그인한 본인이 직접 연결하면 붙는다.
  profiles.naver = { id: 'naver-link', email: 'other-mail@example.test', name: '실명' };
  const linked = await socialRound(app, browser, 'naver', {}, { path: '/api/account/login-methods/link' });
  assert.equal(linked.location.searchParams.get('linked'), 'naver');
  assert.equal(db.prepare("SELECT userId FROM account WHERE providerId='naver'").get().userId, userId);
  assert.equal(db.prepare('SELECT email FROM user WHERE id=?').get(userId).email, 'linker@example.test');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 1, '연결은 가입 보상을 다시 주지 않음');
  assert.equal((await request(app, '/api/account/login-methods/link', { method: 'POST', body: { provider: 'naver' }, cookie: browser.header })).status, 409);
  const after = (await request(app, '/api/account/login-methods', { cookie: browser.header })).body;
  assert.deepEqual(after.methods.map(item => item.provider), ['email', 'naver']); assert.equal(after.canUnlink, true);
  // 연결한 네이버로 새 기기에서 로그인된다.
  const other = jar();
  await socialRound(app, other, 'naver', {});
  assert.equal((await session(app, other)).id, userId);
  // 이미 다른 회원에게 붙은 공급자 계정은 연결하지 않는다.
  const second = jar(cookieFrom(await registerAndLogin(app, mailbox, adult('second-linker@example.test'))));
  const conflict = await socialRound(app, second, 'naver', {}, { path: '/api/account/login-methods/link' });
  assert.equal(conflict.location.searchParams.get('error'), 'account_already_linked_to_different_user');
  // 이메일 로그인을 해제하면 네이버만 남고, 마지막 하나는 해제할 수 없다.
  const unlinkEmail = await request(app, '/api/account/login-methods/unlink', { method: 'POST', body: { provider: 'email' }, cookie: browser.header });
  assert.equal(unlinkEmail.status, 200, JSON.stringify(unlinkEmail.body));
  assert.deepEqual(unlinkEmail.body.methods.map(item => item.provider), ['naver']);
  const last = await request(app, '/api/account/login-methods/unlink', { method: 'POST', body: { provider: 'naver' }, cookie: browser.header });
  assert.equal(last.status, 400); assert.equal(last.body.error.code, 'LAST_LOGIN_METHOD');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account WHERE userId=?').get(userId).n, 1);
  assert.equal((await request(app, '/api/account/login-methods/unlink', { method: 'POST', body: { provider: 'naver' }, origin: 'https://outside.example', cookie: browser.header })).status, 403);
}));

test('어린이 계정은 소셜 로그인 연결 불가', async () => scenario(async ({ app, db, folder, mailbox }) => {
  const requested = await request(app, '/api/account/guardian-requests', { method: 'POST', body: { guardianName: '보호자확인', guardianEmail: 'guardian@example.test' } });
  const guardianCookie = cookieFrom(requested);
  const id = (await request(app, '/api/account/guardian-request', { cookie: guardianCookie })).body.request.requestNumber;
  // 보호자 동의 진행 중인 브라우저는 성인 소셜 가입으로 우회하지 못한다.
  assert.equal((await request(app, '/api/auth/sign-in/social', { method: 'POST', body: { provider: 'google', requestSignUp: true, ageBand: '14plus', name: '우회시도' }, cookie: guardianCookie })).status, 403);
  const evidencePath = join(folder, 'reply.eml');
  await writeFile(evidencePath, `From: 보호자 <guardian@example.test>\r\nSubject: 동의 회신 ${id}\r\n\r\n본인은 법정대리인으로서 안내된 개인정보 처리와 가입에 동의합니다. 신청 번호 ${id}`, { mode: 0o600 });
  await approveGuardianRequest(db, { id, dataDir: folder, evidencePath, confirmReply: true, confirmGuardian: true, confirmScope: true });
  const child = { name: '어린이회원', email: 'social-child@example.test', password, ageBand: 'under14' };
  assert.equal((await request(app, '/api/auth/sign-up/email', { method: 'POST', body: child, cookie: guardianCookie })).status, 200);
  await request(app, '/api/account/verify-email', { method: 'POST', body: { token: tokenFrom(mailbox.findLast(item => item.to === child.email)) } });
  const cookie = cookieFrom(await request(app, '/api/auth/sign-in/email', { method: 'POST', body: { email: child.email, password } }));
  const response = await request(app, '/api/account/login-methods/link', { method: 'POST', body: { provider: 'google' }, cookie });
  assert.equal(response.status, 403); assert.equal(response.body.error.code, 'SOCIAL_LINK_UNAVAILABLE');
}));

test('경국지계 로그인 중 소셜 로그인도 같은 인가 요청으로 돌아가 코드 발급', async () => {
  const client = { client_id: 'gyeongguk-dev', client_secret: randomBytes(32).toString('base64url'), redirect_uris: ['http://127.0.0.1:5173/auth/gracekin/callback'], name: '경국지계(로컬)' };
  await scenario(async ({ app }) => {
    profiles.google = googleProfile('google-oidc', 'oidc-social@example.test');
    await socialRound(app, jar(), 'google', { requestSignUp: true, ageBand: '14plus', name: '게임회원' });
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: client.redirect_uris[0], scope: 'openid', state: 'game-state', nonce: 'game-nonce', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    const toLogin = await request(app, `/api/auth/oauth2/authorize?${params}`, { headers: { 'sec-fetch-mode': 'navigate', accept: 'text/html' } });
    const oauthQuery = new URL(toLogin.headers.location, app.origin).search.slice(1);
    const browser = jar();
    const round = await socialRound(app, browser, 'google', { oauth_query: oauthQuery });
    assert.equal(`${round.location.origin}${round.location.pathname}`, client.redirect_uris[0]);
    assert.equal(round.location.searchParams.get('state'), 'game-state');
    assert.ok(round.location.searchParams.get('code'));
  }, { oidcClients: JSON.stringify([client]) });
});
