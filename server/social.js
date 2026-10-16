import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { activeAccountUser, accountAge } from './account.js';
import { CLIENT_IP_HEADER, fail, json, readJson, text } from './security.js';

// 공급자 이름은 화면 문구와 서버 검사에서 같은 값을 쓴다.
export const SOCIAL_PROVIDERS = Object.freeze({ naver: '네이버', google: '구글' });
const SIGNUP_TTL_SECONDS = 10 * 60;
const SIGNUP_COOKIE_VERSION = 1;

function signupCookieName(production) { return production ? '__Host-gracekin-social-signup' : 'gracekin-social-signup'; }
function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

/**
 * 환경 변수에 공급자 키가 둘 다 있을 때만 그 공급자를 켠다.
 * 가입 중인 연령·닉네임은 서명 쿠키로 콜백까지 넘기고, 공급자 실명·사진은 회원 정보로 저장하지 않는다.
 */
export function socialSettings({ env = process.env, signupContext }) {
  const providers = [];
  const socialProviders = {};
  // 콜백 처리 중에만 서버가 검증한 가입 닉네임을 쓴다. 로그인·연결에서는 기존 회원 정보를 바꾸지 않는다.
  const nickname = () => signupContext.getStore()?.socialName || '소셜회원';
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push('google');
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
      disableImplicitSignUp: true, prompt: 'select_account',
      mapProfileToUser: () => ({ name: nickname(), image: undefined }),
    };
  }
  if (env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET) {
    providers.push('naver');
    socialProviders.naver = {
      clientId: env.NAVER_CLIENT_ID, clientSecret: env.NAVER_CLIENT_SECRET,
      disableImplicitSignUp: true,
      // 네이버는 이메일 제공에 동의한 계정에만 이메일을 준다. 제공된 이메일은 네이버가 확인한 주소로 본다(기획 34 결정 8).
      mapProfileToUser: profile => ({ name: nickname(), image: undefined, emailVerified: typeof profile?.response?.email === 'string' && profile.response.email.length > 0 }),
    };
  }
  return {
    providers,
    authOptions: {
      socialProviders,
      account: {
        encryptOAuthTokens: true,
        // 같은 이메일이라는 이유로 자동 연결하지 않는다. 로그인한 회원이 계정 화면에서 직접 연결할 때만 붙인다.
        accountLinking: { enabled: true, disableImplicitLinking: true, trustedProviders: providers, allowDifferentEmails: true, allowUnlinkingAll: false, updateUserInfoOnLink: false },
      },
    },
  };
}

export function createSocialRoutes({ auth, db, origin, production, secret, grain, guardian, signupContext, limit, providers, signupAvailable }) {
  const enabled = new Set(providers);
  const cookieName = signupCookieName(production);
  const key = createHmac('sha256', secret).update('gracekin-social-signup-v1').digest();
  const sign = value => createHmac('sha256', key).update(value).digest('base64url');
  const cookieAttributes = `Path=/; HttpOnly; SameSite=Lax${production ? '; Secure' : ''}`;
  const clearCookie = `${cookieName}=; Max-Age=0; ${cookieAttributes}`;

  function issueSignupCookie(name) {
    const payload = Buffer.from(JSON.stringify({ v: SIGNUP_COOKIE_VERSION, a: '14plus', n: name, e: Math.floor(Date.now() / 1000) + SIGNUP_TTL_SECONDS, r: randomBytes(12).toString('base64url') })).toString('base64url');
    return `${cookieName}=${payload}.${sign(payload)}; Max-Age=${SIGNUP_TTL_SECONDS}; ${cookieAttributes}`;
  }
  function readSignupCookie(request) {
    const raw = readCookie(request, cookieName);
    const [payload, signature, extra] = raw.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(sign(payload)), given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (data?.v !== SIGNUP_COOKIE_VERSION || data.a !== '14plus' || !Number.isInteger(data.e) || data.e < Math.floor(Date.now() / 1000)) return null;
      return { ageBand: '14plus', name: text(data.n, 2, 24, '닉네임') };
    } catch { return null; }
  }
  function sameOriginJson(request) {
    if (request.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
    if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'ORIGIN_FORBIDDEN', '같은 홈페이지에서 다시 요청해 주세요.');
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail(415, 'JSON_REQUIRED', 'JSON 형식으로 요청해 주세요.');
  }
  function provider(value) {
    if (typeof value !== 'string' || !Object.hasOwn(SOCIAL_PROVIDERS, value) || !enabled.has(value)) fail(422, 'PROVIDER_UNAVAILABLE', '지금 사용할 수 없는 로그인 수단입니다.');
    return value;
  }
  async function currentUser(request) {
    const session = await auth.api.getSession({ headers: request.headers });
    const user = activeAccountUser(db, session?.user);
    if (!user) fail(401, 'UNAUTHORIZED', '로그인 후 이용해 주세요.');
    return user;
  }
  // 인증 라이브러리 응답의 상태 쿠키는 유지하고 본문은 공급자 이동 주소만 돌려준다.
  async function redirectPayload(response, extraCookies = []) {
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok || typeof data.url !== 'string' || !/^https:\/\//.test(data.url) && production) {
      const code = typeof data.code === 'string' ? data.code : 'AUTH_FAILED';
      const messages = { SESSION_NOT_FRESH: '보안을 위해 다시 로그인한 뒤 진행해 주세요.', PROVIDER_NOT_FOUND: '지금 사용할 수 없는 로그인 수단입니다.' };
      return json({ error: { code, message: messages[code] || '로그인 수단 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, response.ok ? 502 : response.status);
    }
    const result = json({ url: data.url });
    for (const cookie of response.headers.getSetCookie()) result.headers.append('set-cookie', cookie);
    for (const cookie of extraCookies) result.headers.append('set-cookie', cookie);
    return result;
  }
  function forward(path, request, body) {
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    return auth.handler(new Request(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
  }

  async function startSocial(request) {
    sameOriginJson(request);
    const body = await readJson(request, 16384);
    if (Object.keys(body).some(name => !['provider', 'requestSignUp', 'ageBand', 'name', 'oauth_query'].includes(name))) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
    const id = provider(body.provider);
    if (body.oauth_query !== undefined && (typeof body.oauth_query !== 'string' || body.oauth_query.length > 8192)) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
    const signup = body.requestSignUp === true;
    const cookies = [];
    if (signup) {
      // 소셜 가입은 만 14세 이상을 고른 뒤에만 시작한다. 만 14세 미만은 기존 보호자 동의 가입만 쓴다(기획 34 결정 6).
      if (body.ageBand === 'under14') fail(403, 'SOCIAL_SIGNUP_ADULT_ONLY', '만 14세 미만은 보호자 동의를 거친 이메일 가입만 할 수 있어요.');
      if (body.ageBand !== '14plus') fail(422, 'AGE_CONFIRMATION_REQUIRED', '가입 연령 구분을 선택해 주세요.');
      if (!signupAvailable) fail(503, 'REGISTRATION_UNAVAILABLE', '새 회원가입을 준비하고 있어요. 기존 계정은 로그인할 수 있어요.');
      if (guardian.hasCurrent(request)) fail(403, 'GUARDIAN_APPROVAL_REQUIRED', '보호자 동의 신청을 진행 중입니다. 어린이 가입 절차를 이어서 진행해 주세요.');
      cookies.push(issueSignupCookie(text(body.name, 2, 24, '닉네임')));
    } else {
      if (body.requestSignUp !== undefined && body.requestSignUp !== false || body.ageBand !== undefined || body.name !== undefined) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
      cookies.push(clearCookie);
    }
    // 복귀 주소는 서버가 고정한다. 처음 보는 소셜 계정의 '로그인'은 계정을 만들지 않고 오류 코드로 가입 안내를 받는다.
    const response = await forward('/api/auth/sign-in/social', request, {
      provider: id, disableRedirect: true,
      callbackURL: `${origin}/account/`, newUserCallbackURL: `${origin}/account/?joined=${id}`,
      errorCallbackURL: `${origin}/account/?view=signin&social=${id}`,
      ...(signup ? { requestSignUp: true } : {}), ...(body.oauth_query ? { oauth_query: body.oauth_query } : {}),
    });
    return redirectPayload(response, cookies);
  }

  function awardVerifiedSignup(userId) {
    // 이메일 인증 경로와 같은 규칙: 활성 회원·확인된 이메일·가입 자격이 모두 있을 때만 하나의 트랜잭션에서 지급한다.
    db.exec('BEGIN IMMEDIATE');
    try {
      const user = activeAccountUser(db, db.prepare('SELECT id,ageBand,emailVerified FROM user WHERE id=?').get(userId));
      if (user?.emailVerified) grain.awardSignup(user.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  async function callback(request, id) {
    if (request.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
    const signup = readSignupCookie(request);
    const context = signup ? { ageBand: signup.ageBand, socialName: signup.name, claim: null } : {};
    let response;
    try {
      response = await signupContext.run(context, () => auth.handler(request));
    } finally { grain.releaseSignup(context.grainSignupUserId); }
    const cookies = response.headers.getSetCookie();
    const session = cookies.map(value => value.split(';')[0]).filter(value => /session_token=/.test(value)).join('; ');
    if (session) {
      const current = await auth.api.getSession({ headers: new Headers({ cookie: session }) });
      // 지급은 원장 고유 제약으로 한 번만 일어난다. 이번에 실패해도 로그인은 막지 않고 다음 소셜 로그인 때 다시 시도한다.
      if (current?.user?.id) try { awardVerifiedSignup(current.user.id); } catch {}
    }
    const result = new Response(null, { status: response.status, headers: response.headers });
    result.headers.append('set-cookie', clearCookie);
    return result;
  }

  function methods(userId) {
    const rows = db.prepare('SELECT providerId,createdAt FROM account WHERE userId=? ORDER BY createdAt').all(userId);
    return {
      methods: rows.filter(row => row.providerId === 'credential' || Object.hasOwn(SOCIAL_PROVIDERS, row.providerId)).map(row => ({ provider: row.providerId === 'credential' ? 'email' : row.providerId, linkedAt: new Date(row.createdAt).toISOString() })),
      available: providers,
      canUnlink: rows.length > 1,
    };
  }

  async function handle(request, url) {
    const path = url.pathname;
    const callbackMatch = path.match(/^\/api\/auth\/callback\/([a-z]+)$/);
    const known = callbackMatch || ['/api/auth/sign-in/social', '/api/account/login-methods', '/api/account/login-methods/link', '/api/account/login-methods/unlink'].includes(path);
    if (!known) return null;
    limit(request.headers.get(CLIENT_IP_HEADER), path, request.method);
    if (url.search && !callbackMatch) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
    if (callbackMatch) {
      if (!Object.hasOwn(SOCIAL_PROVIDERS, callbackMatch[1]) || !enabled.has(callbackMatch[1])) fail(404, 'NOT_FOUND', '인증 요청을 찾을 수 없습니다.');
      return callback(request, callbackMatch[1]);
    }
    if (path === '/api/auth/sign-in/social') return startSocial(request);
    if (path === '/api/account/login-methods') {
      if (request.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
      return json(methods((await currentUser(request)).id));
    }
    sameOriginJson(request);
    const body = await readJson(request, 4096);
    if (Object.keys(body).some(name => name !== 'provider')) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
    const user = await currentUser(request);
    if (path === '/api/account/login-methods/link') {
      const id = provider(body.provider);
      // 어린이 계정은 보호자 동의를 거친 이메일 로그인만 쓴다.
      if (accountAge(user) === 'under14') fail(403, 'SOCIAL_LINK_UNAVAILABLE', '어린이 계정에는 네이버·구글 로그인을 연결할 수 없어요.');
      if (db.prepare('SELECT 1 FROM account WHERE userId=? AND providerId=?').get(user.id, id)) fail(409, 'ALREADY_LINKED', '이미 연결된 로그인 수단이에요.');
      const response = await forward('/api/auth/link-social', request, { provider: id, disableRedirect: true, callbackURL: `${origin}/account/?linked=${id}`, errorCallbackURL: `${origin}/account/?view=signin&social=${id}` });
      return redirectPayload(response);
    }
    const target = body.provider === 'email' ? 'credential' : (Object.hasOwn(SOCIAL_PROVIDERS, body.provider) ? body.provider : null);
    if (!target) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
    const row = db.prepare('SELECT id FROM account WHERE userId=? AND providerId=?').get(user.id, target);
    if (!row) fail(404, 'NOT_FOUND', '연결된 로그인 수단을 찾을 수 없어요.');
    // 마지막 하나의 로그인 수단은 서버와 인증 라이브러리가 모두 거부한다.
    if (db.prepare('SELECT COUNT(*) AS n FROM account WHERE userId=?').get(user.id).n < 2) fail(400, 'LAST_LOGIN_METHOD', '마지막 로그인 수단은 해제할 수 없어요. 다른 수단을 먼저 연결해 주세요.');
    const response = await forward('/api/auth/unlink-account', request, { accountId: row.id });
    if (!response.ok) {
      let code = 'AUTH_FAILED';
      try { const data = await response.json(); if (typeof data.code === 'string') code = data.code; } catch {}
      const messages = { SESSION_NOT_FRESH: '보안을 위해 다시 로그인한 뒤 해제해 주세요.', FAILED_TO_UNLINK_LAST_ACCOUNT: '마지막 로그인 수단은 해제할 수 없어요. 다른 수단을 먼저 연결해 주세요.' };
      fail(response.status === 403 ? 403 : 400, code === 'FAILED_TO_UNLINK_LAST_ACCOUNT' ? 'LAST_LOGIN_METHOD' : code, messages[code] || '로그인 수단을 해제하지 못했어요.');
    }
    return json({ status: true, ...methods(user.id) });
  }

  return { handle };
}
