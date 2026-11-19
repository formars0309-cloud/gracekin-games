import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS, RACES, JOBS, BASE_STAT, POINTS_PER_LEVEL, CHANGE_LOCK_LEVEL, TITLE_TIERS, EXP_RULES, APPEARANCE_OPTIONS, FIXED_SKIN_RACES, levelNeed, progressFromExp, statsOf, titlesOf, branchStatus, validateCharacterData, createDefaultCharacter } from '../assets/character/model.js';

test('10종 종족과 직업 모든 조합의 처음 스탯 합은 68이고 보정은 +12와 +6', () => {
  assert.equal(STATS.length, 10); assert.equal(BASE_STAT, 5); assert.equal(POINTS_PER_LEVEL, 3); assert.equal(CHANGE_LOCK_LEVEL, 10);
  assert.equal(RACES.length, 10); assert.equal(JOBS.length, 10);
  for (const race of RACES) for (const job of JOBS) {
    const data = createDefaultCharacter(); data.race = race.id; data.job = job.id;
    if (race.fixedSkin) data.appearance.skin = null;
    assert.equal(Object.values(race.bonus).reduce((a, b) => a + b), 12);
    assert.equal(Object.values(job.bonus).reduce((a, b) => a + b), 6);
    assert.equal(Object.values(statsOf(data)).reduce((a, b) => a + b), 68);
    assert.equal(statsOf(data, { str: 3 }).str, statsOf(data).str + 3);
  }
  for (const stat of STATS) assert.equal(JOBS.filter(job => job.mainStats.includes(stat.id)).length, 2);
});
test('누적 경험치의 모든 레벨 경계와 포인트를 계산한다', () => {
  assert.deepEqual(progressFromExp(0), { level: 1, exp: 0, need: 100 });
  let total = 0;
  for (let level = 1; level < 1000; level++) {
    assert.deepEqual(progressFromExp(total), { level, exp: 0, need: levelNeed(level) });
    total += levelNeed(level);
    assert.equal(progressFromExp(total - 1).level, level);
    assert.equal((progressFromExp(total).level - 1) * POINTS_PER_LEVEL, level * 3);
  }
  for (const invalid of [-1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => progressFromExp(invalid));
  assert.throws(() => levelNeed(0));
});
test('칭호 30·50·80 경계와 모든 2차 갈래의 조건·시험 잠금을 계산한다', () => {
  assert.deepEqual(TITLE_TIERS, [30, 50, 80]);
  assert.equal(titlesOf({ str: 29 }).length, 0);
  assert.deepEqual(titlesOf({ str: 80 }).map(title => title.label), ['장사', '천하장사', '전설의 장사']);
  assert.equal(titlesOf({ str: 50 }).length, 2);
  for (const job of JOBS) for (const branch of job.branches) {
    const low = branchStatus(job.id, {}, 14).find(row => row.id === branch.id);
    assert.equal(low.levelMet, false); assert.equal(low.statsMet, false);
    const high = branchStatus(job.id, branch.requirements, 15).find(row => row.id === branch.id);
    assert.equal(high.levelMet, true); assert.equal(high.statsMet, true); assert.equal(high.exam.met, false); assert.equal(high.available, false);
    assert.deepEqual(high.exam, { games: 2, playsPerGame: 5, met: false });
  }
});
test('정확한 저장 형식·외형 ID·고정 피부를 검사하고 기본값과 상수를 보호한다', () => {
  assert.deepEqual(FIXED_SKIN_RACES, ['dragon', 'moon']);
  assert.deepEqual(Object.values(APPEARANCE_OPTIONS).map(row => row.length), [8, 10, 6, 6, 8]);
  assert.equal(EXP_RULES.dailyTotalLimit, 300);
  const invalid = [null, [], {}, { ...createDefaultCharacter(), v: 2 }, { ...createDefaultCharacter(), race: '__proto__' }, { ...createDefaultCharacter(), job: 'paladin' }, { ...createDefaultCharacter(), name: '추가 이름' }];
  for (const data of invalid) assert.throws(() => validateCharacterData(data), error => error.code === 'INVALID_CHARACTER' && typeof error.field === 'string' && Boolean(error.message));
  for (const [field, options] of Object.entries(APPEARANCE_OPTIONS)) {
    for (const value of options) { const data = createDefaultCharacter(); data.appearance[field] = value; validateCharacterData(data); }
    const data = createDefaultCharacter(); data.appearance[field] = null; assert.throws(() => validateCharacterData(data));
  }
  for (const race of FIXED_SKIN_RACES) { const data = createDefaultCharacter(); data.race = race; assert.throws(() => validateCharacterData(data)); data.appearance.skin = null; validateCharacterData(data); }
  const first = createDefaultCharacter(); first.appearance.hair = 'h8'; assert.equal(createDefaultCharacter().appearance.hair, 'h1');
  assert.throws(() => { RACES[0].bonus.str = 999; });
  assert.throws(() => statsOf(createDefaultCharacter(), { str: -1 }));
  assert.throws(() => statsOf(createDefaultCharacter(), { unknown: 2 }));
});
