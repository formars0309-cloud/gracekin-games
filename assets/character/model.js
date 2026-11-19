// 브라우저와 서버가 같은 선택지·성장 계산을 사용합니다. 외부 모듈에 의존하지 않습니다.
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const STATS = freeze([
  ['str', '힘'], ['int', '지력'], ['vit', '체력'], ['wis', '지혜'], ['agi', '민첩'],
  ['wil', '정신력'], ['dex', '손재주'], ['cha', '매력'], ['per', '감각'], ['luk', '행운'],
].map(([id, label]) => ({ id, label })));
export const BASE_STAT = 5;
export const POINTS_PER_LEVEL = 3;
export const CHANGE_LOCK_LEVEL = 10;
export const TITLE_TIERS = freeze([30, 50, 80]);
export const EXP_RULES = freeze({ attendance: { amount: 30, dailyLimit: 1 }, post: { amount: 40, dailyLimit: 2 }, comment: { amount: 10, dailyLimit: 5 }, dailyTotalLimit: 300 });
export const FIXED_SKIN_RACES = freeze(['dragon', 'moon']);
export const APPEARANCE_OPTIONS = freeze(Object.fromEntries([
  ['hair', 'h', 8], ['hairColor', 'c', 10], ['eyeColor', 'e', 6], ['skin', 's', 6], ['outfitColor', 'a', 8],
].map(([field, prefix, count]) => [field, Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`)])));
export const RACES = freeze([
  ['human', '들판의 아이', Object.fromEntries(STATS.map(({ id }) => [id, id === 'luk' ? 3 : 1]))],
  ['elf', '숲 엘프', { int: 5, per: 4, wis: 3 }], ['dwarf', '산 드워프', { str: 5, vit: 4, dex: 3 }],
  ['cat', '고양이 수인', { agi: 5, per: 4, luk: 3 }], ['fox', '여우 수인', { int: 5, cha: 4, per: 3 }],
  ['rabbit', '토끼 수인', { agi: 5, luk: 4, cha: 3 }], ['bear', '곰 수인', { vit: 5, str: 4, wil: 3 }],
  ['dragon', '작은 용인', { str: 5, wil: 4, vit: 3 }], ['fairy', '별 요정', { wis: 5, cha: 4, luk: 3 }],
  ['moon', '달그림자족', { wil: 5, wis: 4, int: 3 }],
].map(([id, label, bonus]) => ({ id, label, bonus, fixedSkin: FIXED_SKIN_RACES.includes(id) })));
const branch = (id, label, requirements) => ({ id, label, requirements });
export const JOBS = freeze([
  ['guardian', '수호기사', ['str', 'vit'], [branch('paladin', '성기사', { str: 25, wil: 20, wis: 15 }), branch('bulwark', '방패장군', { vit: 25, str: 20, per: 15 })]],
  ['windblade', '바람검사', ['agi', 'str'], [branch('gale', '질풍검사', { agi: 25, str: 20, per: 15 }), branch('duelist', '결투가', { str: 25, agi: 20, wil: 15 })]],
  ['monk', '무도가', ['vit', 'wil'], [branch('ironfist', '철권사', { str: 25, vit: 20, agi: 15 }), branch('qi', '기공사', { wil: 25, vit: 20, wis: 15 })]],
  ['shadow', '그림자걸음', ['agi', 'per'], [branch('tracker', '그림자 추적자', { per: 25, agi: 20, dex: 15 }), branch('phantom', '괴도', { agi: 25, luk: 20, cha: 15 })]],
  ['ranger', '숲길잡이', ['dex', 'per'], [branch('marksman', '명사수', { dex: 25, per: 20, agi: 15 }), branch('tamer', '야수 조련사', { cha: 25, per: 20, vit: 15 })]],
  ['runesmith', '룬대장장이', ['dex', 'luk'], [branch('artificer', '마도 기공사', { dex: 25, int: 20, str: 15 }), branch('jeweler', '보석 세공사', { luk: 25, dex: 20, per: 15 })]],
  ['arcanist', '룬술사', ['int', 'wil'], [branch('archmage', '대마법사', { int: 25, wil: 20, wis: 15 }), branch('astrologer', '별점술사', { luk: 25, int: 20, per: 15 })]],
  ['alchemist', '연금술사', ['int', 'wis'], [branch('herbalist', '약초 연금술사', { wis: 25, dex: 20, int: 15 }), branch('golemancer', '골렘술사', { int: 25, vit: 20, dex: 15 })]],
  ['healer', '별빛치유사', ['wis', 'cha'], [branch('highpriest', '대사제', { wis: 25, wil: 20, cha: 15 }), branch('moonmonk', '달빛 수도자', { wil: 25, wis: 20, vit: 15 })]],
  ['bard', '음유시인', ['cha', 'luk'], [branch('saga', '서사 시인', { cha: 25, wis: 20, luk: 15 }), branch('dancer', '무희', { agi: 25, cha: 20, luk: 15 })]],
].map(([id, label, mainStats, branches]) => ({ id, label, mainStats, bonus: Object.fromEntries(mainStats.map(stat => [stat, 3])), branches })));
function invalid(field, message) { throw Object.assign(new Error(message), { code: 'INVALID_CHARACTER', field }); }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys, field) {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid(field, '캐릭터 항목을 확인해 주세요.');
}
export function validateCharacterData(data) {
  exactKeys(data, ['v', 'race', 'job', 'appearance'], 'data');
  if (data.v !== 1) invalid('v', '캐릭터 형식 버전을 확인해 주세요.');
  if (!RACES.some(row => row.id === data.race)) invalid('race', '종족을 선택해 주세요.');
  if (!JOBS.some(row => row.id === data.job)) invalid('job', '직업을 선택해 주세요.');
  exactKeys(data.appearance, Object.keys(APPEARANCE_OPTIONS), 'appearance');
  for (const [field, options] of Object.entries(APPEARANCE_OPTIONS)) {
    if (field === 'skin' && FIXED_SKIN_RACES.includes(data.race)) {
      if (data.appearance.skin !== null) invalid('appearance.skin', '이 종족의 피부색은 고정입니다.');
    } else if (!options.includes(data.appearance[field])) invalid(`appearance.${field}`, '외형 선택지를 확인해 주세요.');
  }
  return data;
}
export function createDefaultCharacter() {
  return { v: 1, race: 'human', job: 'guardian', appearance: { hair: 'h1', hairColor: 'c1', eyeColor: 'e1', skin: 's1', outfitColor: 'a1' } };
}
export function levelNeed(level) {
  if (!Number.isSafeInteger(level) || level < 1 || !Number.isSafeInteger(100 + 25 * (level - 1))) throw new RangeError('레벨을 확인해 주세요.');
  return 100 + 25 * (level - 1);
}
const spentToLevel = level => (level - 1) * (25 * (level - 1) + 175) / 2;
export function progressFromExp(totalExp) {
  if (!Number.isSafeInteger(totalExp) || totalExp < 0) throw new RangeError('경험치를 확인해 주세요.');
  // 누적식의 역함수로 큰 경험치도 반복 없이 계산하고 경계의 부동소수점 오차를 보정합니다.
  let level = Math.floor((-175 + Math.sqrt(30625 + 200 * totalExp)) / 50) + 1;
  while (spentToLevel(level + 1) <= totalExp) level++;
  while (spentToLevel(level) > totalExp) level--;
  return { level, exp: totalExp - spentToLevel(level), need: levelNeed(level) };
}
export function statsOf(data, alloc = {}) {
  validateCharacterData(data);
  if (!record(alloc) || Object.keys(alloc).some(id => !STATS.some(stat => stat.id === id))) invalid('alloc', '분배 항목을 확인해 주세요.');
  const race = RACES.find(row => row.id === data.race), job = JOBS.find(row => row.id === data.job);
  return Object.fromEntries(STATS.map(({ id }) => {
    const amount = alloc[id] ?? 0;
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(BASE_STAT + (race.bonus[id] ?? 0) + (job.bonus[id] ?? 0) + amount)) invalid(`alloc.${id}`, '분배 포인트를 확인해 주세요.');
    return [id, BASE_STAT + (race.bonus[id] ?? 0) + (job.bonus[id] ?? 0) + amount];
  }));
}
const titleNames = freeze({ str: ['장사', '천하장사', '전설의 장사'], int: ['학자', '대학자', '진리의 탐구자'], vit: ['튼튼한 모험가', '강철 체력', '불굴의 거인'], wis: ['지혜로운 이', '현자', '별의 현자'], agi: ['날쌘 발', '바람의 발', '빛의 걸음'], wil: ['굳은 의지', '흔들리지 않는 마음', '불멸의 의지'], dex: ['재주꾼', '장인', '전설의 장인'], cha: ['인기인', '마음의 친구', '모두의 별'], per: ['예리한 눈', '천리안', '세상을 읽는 눈'], luk: ['행운아', '네잎클로버', '행운의 별'] });
export function titlesOf(stats) {
  return STATS.flatMap(({ id }) => TITLE_TIERS.flatMap((threshold, i) => stats[id] >= threshold ? [{ stat: id, threshold, label: titleNames[id][i] }] : []));
}
export function branchStatus(job, stats, level) {
  const selected = JOBS.find(row => row.id === job);
  if (!selected) invalid('job', '직업을 선택해 주세요.');
  return selected.branches.map(row => ({ ...row, levelRequired: 15, levelMet: level >= 15, statsMet: Object.entries(row.requirements).every(([id, value]) => stats[id] >= value), exam: { games: 2, playsPerGame: 5, met: false }, available: false, message: '게임 기록 연결 뒤 열립니다' }));
}
