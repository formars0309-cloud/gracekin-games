import { activeAccountUser } from './account.js';
import { CLIENT_IP_HEADER, errorResponse, fail, json, readJson } from './security.js';

const DISPLAY_ORIGINS = new Set(['https://gracekingames.com', 'https://www.gracekingames.com']);
const PATHS = new Map([['/api/slime-race/state', 'GET'], ['/api/slime-race/me', 'GET'], ['/api/slime-race/history', 'GET'], ['/api/slime-race/tickets', 'POST']]);

// 성인 확인은 신뢰하는 서버 어댑터만 제공합니다. 기존 ageBand=14plus는 성인 증빙이 아닙니다.
export function createSlimeRaceRoutes({ db, auth, race, origin, limit, adultVerifier }) {
  function eligibility(user) {
    if (!user) return { canBet: false, code: 'LOGIN_REQUIRED', message: '로그인 후 이용해 주세요.' };
    if (!user.emailVerified) return { canBet: false, code: 'EMAIL_NOT_VERIFIED', message: '이메일 확인을 마쳐 주세요.' };
    if (user.ageBand === 'under14') return { canBet: false, code: 'ADULT_VERIFICATION_REQUIRED', message: '성인 확인 회원만 티켓을 구매할 수 있습니다.' };
    if (typeof adultVerifier !== 'function') return { canBet: false, code: 'ADULT_VERIFICATION_UNAVAILABLE', message: '성인 확인 기능을 준비 중입니다. 지금은 경기를 관람할 수 있습니다.' };
    if (adultVerifier(user, db) !== true) return { canBet: false, code: 'ADULT_VERIFICATION_REQUIRED', message: '성인 확인을 마쳐 주세요.' };
    return { canBet: true, code: 'ELIGIBLE', message: '티켓을 구매할 수 있습니다.' };
  }
  async function account(request) {
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    const user = session?.user && db.prepare('SELECT id,name,emailVerified,ageBand FROM user WHERE id=?').get(session.user.id);
    return activeAccountUser(db, user) ?? null;
  }
  const envelope = (user, personal) => ({ user: user ? { id: user.id, name: user.name } : null, eligibility: eligibility(user), ...personal });
  return async function handle(request, url) {
    if (!url.pathname.startsWith('/api/slime-race/')) return null;
    const source = request.headers.get('origin'), allowed = source === origin || DISPLAY_ORIGINS.has(source);
    let response;
    try {
      if ((source && !allowed) || (!source && request.headers.get('sec-fetch-site') === 'cross-site')) fail(403, 'ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.');
      limit(request.headers.get(CLIENT_IP_HEADER), url.pathname, request.method);
      if (url.search) fail(422, 'INVALID_INPUT', '추가 조회 항목을 보낼 수 없습니다.');
      const method = PATHS.get(url.pathname);
      if (!method) fail(404, 'NOT_FOUND', '요청을 찾을 수 없습니다.');
      if (request.method === 'OPTIONS') {
        if (!allowed || request.headers.get('access-control-request-method') !== method) fail(403, 'ORIGIN_FORBIDDEN', '허용되지 않은 사전 요청입니다.');
        const headers = (request.headers.get('access-control-request-headers') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
        if (headers.some(header => header !== 'content-type')) fail(403, 'HEADERS_FORBIDDEN', '허용되지 않은 요청 헤더입니다.');
        response = new Response(null, { status: 204, headers: { 'access-control-allow-methods': method, 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' } });
      } else {
        if (request.method !== method) fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
        if (method === 'POST' && !allowed) fail(403, 'ORIGIN_FORBIDDEN', '같은 홈페이지에서 다시 요청해 주세요.');
        if (url.pathname.endsWith('/state')) response = json(race.state());
        else {
          const body = method === 'POST' ? await readJson(request, 4096) : null;
          const user = await account(request);
          if (url.pathname.endsWith('/me')) response = json(envelope(user, race.me(user)));
          else if (url.pathname.endsWith('/history')) {
            if (!user) fail(401, 'LOGIN_REQUIRED', '로그인 후 이용해 주세요.');
            response = json(race.history(user));
          } else {
            const status = eligibility(user);
            if (!status.canBet) fail(user ? 403 : 401, status.code, status.message);
            response = json(envelope(user, race.purchase(user, body)));
          }
        }
      }
    } catch (error) { response = errorResponse(error); }
    response.headers.set('vary', 'Origin');
    response.headers.set('cache-control', 'no-store');
    if (allowed && source !== origin) {
      response.headers.set('access-control-allow-origin', source);
      response.headers.set('access-control-allow-credentials', 'true');
    }
    return response;
  };
}
