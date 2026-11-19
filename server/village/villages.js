import { accountAge } from '../account.js';
import { fail } from '../security.js';

// 향후 확인 수단이 마련되면 정의와 입장 조건을 추가할 수 있습니다.
export const VILLAGES = Object.freeze({
  kids: Object.freeze({
    id: 'kids', name: '어린이 마을', accent: '#658757', mapPath: '/assets/village/maps/plaza.json',
    assertEntry(user, { assertGuardian }) {
      if (accountAge(user) !== 'under14') fail(403, 'INVALID_VILLAGE', '어린이 마을은 보호자 동의가 확인된 어린이 회원만 들어갈 수 있어요.');
      assertGuardian(user);
    },
  }),
  general: Object.freeze({
    id: 'general', name: '청소년·성인 마을', accent: '#547f9b', mapPath: '/assets/village/maps/plaza.json',
    assertEntry(user) {
      if (accountAge(user) === 'under14') fail(403, 'INVALID_VILLAGE', '어린이 회원은 어린이 마을을 이용해 주세요.');
    },
  }),
});

export function villageForUser(user) { return VILLAGES[accountAge(user) === 'under14' ? 'kids' : 'general']; }
export function villageName(id) { return Object.hasOwn(VILLAGES, id) ? VILLAGES[id].name : '이전 시험 광장'; }
