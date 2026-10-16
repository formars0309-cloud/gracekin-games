import { createHash } from 'node:crypto';
import { APIError } from 'better-auth/api';
import { jwt } from 'better-auth/plugins';
import { oauthProvider, oauthProviderOpenIdConfigMetadata, verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { guardianIsActive } from './guardian.js';
import { activeAccountUser, accountAge } from './account.js';
import { CLIENT_IP_HEADER, createLimiter, fail, json, readJson } from './security.js';

export const OIDC_DISCOVERY_PATH = '/.well-known/openid-configuration';
const CLIENT_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

// 플러그인의 기본 'hashed' 저장 방식과 같은 SHA-256·base64url(패딩 없음) 값이다. 원문 비밀값은 DB에 넣지 않는다.
const hashSecret = value => createHash('sha256').update(value).digest('base64url');

/**
 * OIDC_CLIENTS(JSON 배열: client_id, client_secret, redirect_uris, name)를 검증한다.
 * 오류 메시지에는 비밀값을 넣지 않는다.
 */
export function parseOidcClients(value, { production }) {
  if (value === undefined || value === null || value === '') return [];
  let list = value;
  if (typeof value === 'string') {
    try { list = JSON.parse(value); } catch { throw new Error('OIDC_CLIENTS는 JSON 배열이어야 합니다.'); }
  }
  if (!Array.isArray(list) || list.length > 20) throw new Error('OIDC_CLIENTS는 20개 이하의 JSON 배열이어야 합니다.');
  const seen = new Set();
  return list.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['client_id', 'client_secret', 'redirect_uris', 'name'].includes(key))) throw new Error('OIDC_CLIENTS 항목은 client_id, client_secret, redirect_uris, name만 사용할 수 있습니다.');
    const { client_id: clientId, client_secret: clientSecret, redirect_uris: redirectUris, name } = item;
    if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId) || seen.has(clientId)) throw new Error('OIDC_CLIENTS의 client_id를 확인해 주세요.');
    seen.add(clientId);
    if (typeof clientSecret !== 'string' || clientSecret.length < 32 || clientSecret.length > 256 || /\s/.test(clientSecret)) throw new Error(`OIDC_CLIENTS ${clientId}의 client_secret은 공백 없는 32자 이상이어야 합니다.`);
    if (typeof name !== 'string' || !name.trim() || [...name].length > 60) throw new Error(`OIDC_CLIENTS ${clientId}의 name을 확인해 주세요.`);
    if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.length > 10) throw new Error(`OIDC_CLIENTS ${clientId}의 redirect_uris를 확인해 주세요.`);
    for (const uri of redirectUris) {
      let url;
      try { url = new URL(uri); } catch { throw new Error(`OIDC_CLIENTS ${clientId}의 redirect_uris를 확인해 주세요.`); }
      const loopback = url.protocol === 'http:' && LOOPBACK.has(url.hostname === '::1' ? '[::1]' : url.hostname);
      // 운영 공통 계정은 HTTPS 복귀 주소만 받는다. 로컬 개발 서버에서만 루프백 HTTP를 허용한다.
      if (typeof uri !== 'string' || url.href !== uri || url.username || url.password || uri.includes('#') || !(url.protocol === 'https:' || (!production && loopback))) throw new Error(`OIDC_CLIENTS ${clientId}의 redirect_uris는 ${production ? 'HTTPS' : 'HTTPS 또는 루프백 HTTP'} 절대 주소여야 합니다.`);
    }
    return { clientId, secretHash: hashSecret(clientSecret), redirectUris: [...redirectUris], name: name.trim() };
  });
}

function declaredAge(db, userId) {
  return db.prepare('SELECT ageBand FROM account_age_declarations WHERE userId=?').get(userId)?.ageBand ?? null;
}
// 계정의 연령 구분. 기존(legacy) 회원은 게임 연결 때 고른 값만 OIDC에 쓴다. 커뮤니티 권한 판정은 바꾸지 않는다.
export function oidcAgeBand(db, userId) {
  const row = db.prepare('SELECT ageBand FROM user WHERE id=?').get(userId);
  if (!row) return null;
  return ['14plus', 'under14'].includes(row.ageBand) ? row.ageBand : declaredAge(db, userId);
}

export function oidcSettings({ db, origin }) {
  return {
    authOptions: {
      // jwt 플러그인의 세션 JWT 발급 경로는 쓰지 않는다. 서명 키·JWKS만 OIDC ID 토큰에 쓴다.
      disabledPaths: ['/token'],
      onAPIError: { errorURL: `${origin}/account/?view=signin` },
      plugins: [
        jwt({ jwt: { issuer: origin } }),
        oauthProvider({
          loginPage: `${origin}/account/`, consentPage: `${origin}/account/`,
          // profile: 게임 첫 화면 '○○님으로 계속' 카드에 커뮤니티 닉네임(name)만 보여 준다(경국지계 기획 35 결정 7). 이메일 범위는 열지 않는다.
          scopes: ['openid', 'profile'], grantTypes: ['authorization_code'],
          codeExpiresIn: 600, idTokenExpiresIn: 600, accessTokenExpiresIn: 600,
          allowDynamicClientRegistration: false, allowUnauthenticatedClientRegistration: false,
          // 등록한 복귀 주소와 글자 그대로 같아야 한다(루프백 포트 완화도 쓰지 않는다).
          validateRedirectUri: (uri, registered) => registered.includes(uri),
          advertisedMetadata: { claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'acr', 'age_band', 'name'] },
          // 연령 기록이 없는 기존 회원은 코드를 발급하기 전에 계정 화면에서 연령을 고른다(기획 34 결정 13).
          postLogin: {
            page: `${origin}/account/`,
            shouldRedirect: ({ user }) => !oidcAgeBand(db, user.id),
            consentReferenceId: () => undefined,
          },
          customIdTokenClaims: ({ user, scopes }) => {
            const band = oidcAgeBand(db, user.id);
            if (!band) throw new APIError('BAD_REQUEST', { error: 'invalid_grant', error_description: 'age confirmation required' });
            if (band === 'under14' && !guardianIsActive(db, user.id)) throw new APIError('BAD_REQUEST', { error: 'invalid_grant', error_description: 'account unavailable' });
            // 플러그인은 profile 클레임을 사용자 정보 주소로만 보내는데, 게임 서버는 ID 토큰만 본다. profile을 요청했을 때만 닉네임을 싣는다.
            const name = Array.isArray(scopes) && scopes.includes('profile') && typeof user.name === 'string' && user.name.trim() ? user.name.trim().slice(0, 40) : undefined;
            return name ? { age_band: band, name } : { age_band: band };
          },
          rateLimit: { token: { window: 60, max: 120 }, authorize: { window: 60, max: 60 } },
        }),
      ],
    },
  };
}

export function createOidcRoutes({ auth, db, origin, secret, clients, limit, tokenLimit = createLimiter({ authMax: 120 }) }) {
  // 인증 테이블 이전 뒤에 만든다. 회원 삭제 때 함께 지운다.
  db.exec(`CREATE TABLE IF NOT EXISTS account_age_declarations (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    ageBand TEXT NOT NULL CHECK(ageBand='14plus'), createdAt INTEGER NOT NULL
  );`);
  const byId = new Map(clients.map(client => [client.clientId, client]));
  const discovery = oauthProviderOpenIdConfigMetadata(auth);

  // 서버 시작 때 OIDC_CLIENTS를 DB에 맞춘다. 목록에서 빠진 클라이언트는 지우지 않고 사용 중지한다.
  async function seedClients() {
    const { adapter } = await auth.$context;
    const now = new Date();
    for (const client of clients) {
      const data = {
        clientSecret: client.secretHash, disabled: false, skipConsent: true, requirePKCE: true,
        scopes: ['openid', 'profile'], grantTypes: ['authorization_code'], responseTypes: ['code'],
        tokenEndpointAuthMethod: 'client_secret_basic', applicationType: 'web', subjectType: 'public',
        redirectUris: client.redirectUris, name: client.name, updatedAt: now,
      };
      const existing = await adapter.findOne({ model: 'oauthClient', where: [{ field: 'clientId', value: client.clientId }] });
      if (existing) await adapter.update({ model: 'oauthClient', where: [{ field: 'clientId', value: client.clientId }], update: data });
      else await adapter.create({ model: 'oauthClient', data: { ...data, clientId: client.clientId, createdAt: now } });
    }
    for (const row of db.prepare('SELECT clientId FROM oauthClient WHERE disabled IS NOT 1').all()) {
      if (!byId.has(row.clientId)) await adapter.update({ model: 'oauthClient', where: [{ field: 'clientId', value: row.clientId }], update: { disabled: true, updatedAt: now } });
    }
  }

  function sameOriginJson(request) {
    if (request.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
    if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'ORIGIN_FORBIDDEN', '같은 홈페이지에서 다시 요청해 주세요.');
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail(415, 'JSON_REQUIRED', 'JSON 형식으로 요청해 주세요.');
  }
  async function signedQuery(value) {
    if (typeof value !== 'string' || value.length > 8192 || !(await verifyOAuthQueryParams(value, secret))) fail(400, 'OIDC_REQUEST_EXPIRED', '게임 로그인 요청이 만료되었어요. 게임으로 돌아가 다시 시도해 주세요.');
    const params = new URLSearchParams(value);
    const client = byId.get(params.get('client_id'));
    if (!client) fail(400, 'OIDC_REQUEST_EXPIRED', '게임 로그인 요청이 만료되었어요. 게임으로 돌아가 다시 시도해 주세요.');
    return { params, client };
  }
  async function sessionUser(request) {
    const session = await auth.api.getSession({ headers: request.headers });
    return activeAccountUser(db, session?.user);
  }
  function forward(path, request, body) {
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json');
    headers.delete('content-length');
    return auth.handler(new Request(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
  }

  async function handle(request, url) {
    const path = url.pathname;
    const ip = request.headers.get(CLIENT_IP_HEADER);
    if (path === OIDC_DISCOVERY_PATH) {
      limit(ip, path, 'GET');
      if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
      const response = await discovery(request);
      return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (path === '/api/auth/jwks' || path === '/api/auth/oauth2/authorize') {
      limit(ip, path, 'GET');
      if (request.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
      if (path === '/api/auth/jwks' && url.search) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
      return auth.handler(request);
    }
    if (path === '/api/auth/oauth2/token') {
      // 게임 서버끼리의 요청이라 브라우저 출처 검사 대신 client_secret_basic 인증을 플러그인이 검사한다.
      tokenLimit(ip, path, 'POST');
      if (request.method !== 'POST' || url.search) fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
      if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail(415, 'FORM_REQUIRED', '양식 형식으로 요청해 주세요.');
      const length = Number(request.headers.get('content-length') || 0);
      if (!Number.isFinite(length) || length > 16384) fail(413, 'PAYLOAD_TOO_LARGE', '요청 내용이 너무 큽니다.');
      return auth.handler(request);
    }
    if (path === '/api/auth/oauth2/continue') {
      limit(ip, path, request.method);
      sameOriginJson(request);
      const body = await readJson(request, 16384);
      if (Object.keys(body).some(name => !['postLogin', 'oauth_query'].includes(name)) || body.postLogin !== true) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
      await signedQuery(body.oauth_query);
      const user = await sessionUser(request);
      if (!user) fail(401, 'UNAUTHORIZED', '로그인 후 이용해 주세요.');
      if (!oidcAgeBand(db, user.id)) fail(403, 'AGE_CONFIRMATION_REQUIRED', '게임을 이용하기 전에 나이를 먼저 확인해 주세요.');
      return forward(path, request, body);
    }
    if (!path.startsWith('/api/account/oidc/')) return null;
    limit(ip, path, request.method);
    sameOriginJson(request);
    const body = await readJson(request, 16384);
    if (path === '/api/account/oidc/context') {
      if (Object.keys(body).some(name => name !== 'oauth_query')) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
      const { params, client } = await signedQuery(body.oauth_query);
      const user = await sessionUser(request);
      const prompts = (params.get('prompt') || '').split(/\s+/);
      return json({ clientName: client.name, signedIn: Boolean(user), needsAgeConfirmation: Boolean(user && !oidcAgeBand(db, user.id)), loginRequired: prompts.includes('login') || prompts.includes('create') });
    }
    if (path === '/api/account/oidc/age') {
      if (Object.keys(body).some(name => name !== 'ageBand') || body.ageBand !== '14plus') fail(422, 'INVALID_INPUT', '연령 구분을 확인해 주세요.');
      const user = await sessionUser(request);
      if (!user) fail(401, 'UNAUTHORIZED', '로그인 후 이용해 주세요.');
      // 연령 기록이 있는 회원은 바꾸지 않는다. 기존 회원의 커뮤니티 권한·이메일 확인 상태도 그대로 둔다.
      if (accountAge(user) !== 'legacy') fail(409, 'AGE_ALREADY_SET', '이미 연령 구분이 기록된 계정이에요.');
      db.prepare('INSERT INTO account_age_declarations(userId,ageBand,createdAt) VALUES(?,?,?) ON CONFLICT(userId) DO NOTHING').run(user.id, '14plus', Date.now());
      return json({ status: true });
    }
    if (path === '/api/account/oidc/cancel') {
      if (Object.keys(body).some(name => name !== 'oauth_query')) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
      const { params, client } = await signedQuery(body.oauth_query);
      const redirect = params.get('redirect_uri');
      if (!client.redirectUris.includes(redirect)) fail(400, 'OIDC_REQUEST_EXPIRED', '게임 로그인 요청이 만료되었어요. 게임으로 돌아가 다시 시도해 주세요.');
      const target = new URL(redirect);
      target.searchParams.set('error', 'access_denied');
      if (params.get('state')) target.searchParams.set('state', params.get('state'));
      target.searchParams.set('iss', origin);
      return json({ url: target.href });
    }
    fail(404, 'NOT_FOUND', '요청한 내용을 찾을 수 없습니다.');
  }
  return { handle, seedClients };
}
