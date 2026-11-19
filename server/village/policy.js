import { accountAge } from '../account.js';
import { fail } from '../security.js';

// 입장 화면의 날짜도 이 기본값 또는 VILLAGE_OPENS_AT 설정에서 계산합니다.
export const VILLAGE_OPENS_AT = '2026-11-27T00:00:00+09:00';
export const VILLAGE_REQUIRED_CONSENT_VERSION = '2026-11-20-v5';
export const VILLAGE_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;

export function villageAdmission(db, { opensAt = VILLAGE_OPENS_AT, now, isAdmin }) {
  if (typeof opensAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(opensAt) || !Number.isFinite(Date.parse(opensAt))) throw new Error('VILLAGE_OPENS_AT에는 시간대를 포함한 시행 시각을 설정해 주세요.');
  const opening = Date.parse(opensAt);
  const day = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' }).format(opening);
  function assert(user) {
    if (now() < opening && !isAdmin(user)) fail(403, 'VILLAGE_NOT_OPEN', `${day}에 문을 열어요`);
    if (accountAge(user) === 'under14') {
      const version = db.prepare("SELECT consentVersion FROM guardian_requests WHERE childUserId=? AND status='used'").get(user.id)?.consentVersion;
      const parsed = /^(\d{4}-\d{2}-\d{2})-v(\d+)$/.exec(version || '');
      const [, requiredDay, requiredRevision] = /^(.*)-v(\d+)$/.exec(VILLAGE_REQUIRED_CONSENT_VERSION);
      if (!parsed || parsed[1] < requiredDay || parsed[1] === requiredDay && Number(parsed[2]) < Number(requiredRevision)) fail(403, 'VILLAGE_GUARDIAN_CONSENT_REQUIRED', '보호자의 추가 동의가 필요해요');
    }
  }
  return { assert, opensAt: new Date(opening).toISOString() };
}

export function oneYearAgo(time) {
  const date = new Date(time), month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  // 윤년의 2월 29일에서 한 해를 뺄 때 3월 자료를 미리 지우지 않습니다.
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.getTime();
}

export function startVillageCleanup(cleanup, schedule = setInterval) {
  cleanup();
  const timer = schedule(() => {
    try { cleanup(); }
    catch { console.error('마을 보존 기간 정리 실패: 저장소 상태를 확인해 주세요.'); }
  }, VILLAGE_CLEANUP_INTERVAL);
  timer.unref();
  return timer;
}
