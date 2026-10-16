import { activeAccountUser } from './account.js';
import { errorResponse, fail, json } from './security.js';

const DISPLAY_ORIGINS = new Set(['https://gracekingames.com', 'https://www.gracekingames.com']);

export function createAccountSummary(db, auth, { origin }) {
  return async function summary(request, url, checkLimit = () => {}) {
    const source = request.headers.get('origin');
    const allowedDisplay = DISPLAY_ORIGINS.has(source);
    // 이 읽기 경로의 GET만 공개 사이트의 인증된 요청을 허용합니다.
    const cors = request.method === 'GET' && allowedDisplay;
    let response;
    try {
      if ((source && source !== origin && !allowedDisplay) || (!source && request.headers.get('sec-fetch-site') === 'cross-site')) fail(403, 'ORIGIN_FORBIDDEN', '허용되지 않은 접속 주소입니다.');
      if (request.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
      checkLimit();
      if (url.search) fail(422, 'INVALID_INPUT', '계정 요약 조회에는 추가 항목을 보낼 수 없습니다.');
      const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
      const user = activeAccountUser(db, session?.user);
      response = json({ user: user ? { name: user.name, grainBalance: db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(user.id)?.balance ?? 0 } : null });
    } catch (error) { response = errorResponse(error); }
    response.headers.set('vary', 'Origin');
    if (cors) {
      response.headers.set('access-control-allow-origin', source);
      response.headers.set('access-control-allow-credentials', 'true');
    }
    return response;
  };
}
