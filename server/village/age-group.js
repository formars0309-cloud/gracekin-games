import { accountAge } from '../account.js';
import { fail } from '../security.js';

// 지도·문 정의를 바꿀 때는 해당 마을의 파일 경로를 교체합니다.
export const VILLAGES = Object.freeze({
  elementary: Object.freeze({ id: 'elementary', name: '초등학생 마을', accent: '#658757', mapPath: '/assets/village/maps/plaza.json' }),
  middle: Object.freeze({ id: 'middle', name: '중학생 마을', accent: '#547f9b', mapPath: '/assets/village/maps/plaza.json' }),
  high: Object.freeze({ id: 'high', name: '고등학생 마을', accent: '#8b6a9b', mapPath: '/assets/village/maps/plaza.json' }),
  adult: Object.freeze({ id: 'adult', name: '성인 마을', accent: '#947044', mapPath: '/assets/village/maps/plaza.json' }),
});
const seoul = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric' });

export function schoolCalendar(time) {
  const parts = Object.fromEntries(seoul.formatToParts(time).map(part => [part.type, part.value]));
  const year = Number(parts.year), schoolYear = Number(parts.month) >= 3 ? year : year - 1;
  return { year, schoolYear, minimumBirthYear: schoolYear - 100, maximumBirthYear: schoolYear - 7 };
}

export function villageForBirthYear(birthYear, time) {
  if (!Number.isSafeInteger(birthYear) || birthYear < 1 || birthYear > schoolCalendar(time).year) fail(422, 'INVALID_BIRTH_YEAR', '출생연도를 확인해 주세요.');
  const grade = schoolCalendar(time).schoolYear - birthYear - 6;
  if (grade < 1) fail(403, 'VILLAGE_PRESCHOOL', '미취학 어린이는 아직 마을에 들어갈 수 없어요.');
  const id = grade <= 6 ? 'elementary' : grade <= 9 ? 'middle' : grade <= 12 ? 'high' : 'adult';
  return VILLAGES[id];
}

export function validateBirthYear(user, birthYear, time) {
  const calendar = schoolCalendar(time);
  if (!Number.isSafeInteger(birthYear) || birthYear < calendar.minimumBirthYear || birthYear > calendar.year) fail(422, 'INVALID_BIRTH_YEAR', '선택할 수 있는 출생연도를 확인해 주세요.');
  const village = villageForBirthYear(birthYear, time);
  if (accountAge(user) === 'under14') {
    if (birthYear < calendar.year - 14) fail(422, 'AGE_ACCOUNT_MISMATCH', '가입할 때 선택한 어린이 연령과 출생연도가 맞지 않아요. 보호자와 함께 문의해 주세요.');
  } else if (birthYear > calendar.year - 14) fail(403, 'VILLAGE_CHILD_SIGNUP_REQUIRED', '어린이 회원은 보호자 동의 가입이 필요해요');
  if (village.id === 'elementary' && accountAge(user) !== 'under14') fail(403, 'VILLAGE_ELEMENTARY_GUARDIAN_REQUIRED', '초등학생 마을은 보호자 동의가 확인된 어린이 회원만 들어갈 수 있어요.');
  return village;
}

export function villageName(id) { return VILLAGES[id]?.name || (id === 'legacy' ? '이전 통합 광장' : '마을 미배정'); }
