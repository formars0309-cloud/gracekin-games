import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createGrainService, GRAIN_ECONOMY } from '../server/grain.js';
import { createSlimeRace, ticketPayout, SLIME_ROSTER, raceProgress, ROUND_MS } from '../server/slime-race.js';

function setup(balance = 30000, initialTime = 0) {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('me'); INSERT INTO user VALUES('other');");
  let time = initialTime;
  createGrainService(db, { now: () => time });
  db.prepare('INSERT INTO grain_wallets VALUES(?,?)').run('me', balance);
  const options = { now: () => time, random: () => 0, startTimer: false };
  const race = createSlimeRace(db, options), user = { id: 'me' };
  let request = 0;
  const body = (amount, overrides = {}) => ({ roundId: race.state().round.id, slimeId: race.state().round.entrants[0].slimeId, amount, expectedRevision: race.me(user).revision, requestId: `request-${String(++request).padStart(16, '0')}`, ...overrides });
  return { db, race, user, options, body, setTime: value => { time = value; }, close: () => { race.close(); db.close(); } };
}
const code = expected => error => error.code === expected;

test('UTC 500/510/570/600초 경계, 마감 뒤 추첨, 결과 전 비공개와 무참가 자동 진행', () => {
  const s = setup();
  try {
    for (const [time, phase] of [[0, 'sales'], [499999, 'sales'], [500000, 'countdown'], [509999, 'countdown'], [510000, 'racing'], [569999, 'racing'], [570000, 'results'], [599999, 'results'], [600000, 'sales']]) {
      s.setTime(time);
      const state = s.race.state();
      assert.equal(state.round.phase, phase);
      assert.equal(Object.hasOwn(state.round, 'winnerId'), phase === 'results');
      assert.doesNotMatch(JSON.stringify(state), /animationSeed|probabilityUnits|weight|userId|totalBet|participants/);
      assert.equal(state.round.id, time < 600000 ? '0' : '1');
    }
    assert.equal(s.db.prepare('SELECT settledAt FROM slime_race_rounds WHERE id=?').get('0').settledAt, 570000);
    assert.equal(s.db.prepare('SELECT winnerId FROM slime_race_rounds WHERE id=?').get('1').winnerId, null);
    s.setTime(2400000); s.race.tick();
    assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM slime_race_rounds').get().count, 5);
    assert.equal(s.race.state().round.id, '4');
  } finally { s.close(); }
});

test('큰 시각의 첫 회차는 1회, 다음은 2회이며 중단·재시작과 기록도 시각 기준 번호를 유지', () => {
  const firstStartsAt = 2986989 * ROUND_MS, s = setup(30000, firstStartsAt + 12345);
  let restarted;
  try {
    const first = s.race.state().round;
    assert.equal(first.roundNo, 1);
    assert.equal(first.startsAt, firstStartsAt);
    assert.equal(first.id, '2986989');
    const ticket = s.body(100);
    s.race.purchase(s.user, ticket);
    assert.equal(ticket.roundId, first.id);

    s.setTime(firstStartsAt + ROUND_MS);
    const next = s.race.state().round;
    assert.equal(next.roundNo, 2);
    assert.equal(next.id, '2986990');
    s.race.purchase(s.user, s.body(100));
    const record = s.race.history(s.user).rounds[0];
    assert.equal(record.roundNo, 1);
    assert.equal(record.roundId, first.id);
    assert.equal(record.startsAt, firstStartsAt);
    assert.equal(s.db.prepare("SELECT eventId FROM grain_ledger WHERE eventId LIKE 'slime-race:payout:%'").get().eventId, 'slime-race:payout:'+first.id);

    s.race.close();
    s.setTime(firstStartsAt + 5 * ROUND_MS + 1000);
    restarted = createSlimeRace(s.db, s.options);
    const resumed = restarted.state().round;
    assert.equal(resumed.roundNo, 6);
    assert.equal(resumed.id, '2986994');
    assert.equal(s.db.prepare('SELECT MIN(startsAt) AS first FROM slime_race_rounds').get().first, firstStartsAt);
    assert.deepEqual(restarted.history(s.user).rounds.map(({ roundId, roundNo }) => [roundId, roundNo]), [['2986990', 2], ['2986989', 1]]);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS count FROM grain_ledger WHERE eventId LIKE 'slime-race:payout:%'").get().count, 2);
    // 빈 시간 구간의 회차 행이 없어도 행 개수로 번호를 당기지 않는다.
    s.db.prepare('DELETE FROM slime_race_rounds WHERE startsAt>? AND startsAt<?').run(firstStartsAt + ROUND_MS, resumed.startsAt);
    assert.equal(restarted.state().round.roundNo, 6);
    s.setTime(firstStartsAt + 8 * ROUND_MS);
    assert.equal(restarted.state().round.roundNo, 9);
  } finally { restarted?.close(); s.close(); }
});

test('5명 중복 없음, 5성향, 정수 확률 합계와 하한·95% 목표 배당', () => {
  const s = setup();
  try {
    assert.equal(new Set(SLIME_ROSTER.map(row => row.style)).size, 5);
    for (let i = 0; i < 25; i++) {
      s.setTime(i * 600000);
      const entrants = s.race.state().round.entrants;
      assert.equal(new Set(entrants.map(row => row.slimeId)).size, 5);
      assert.ok(Math.abs(entrants.reduce((a, row) => a + row.probability, 0) - 1) < 1e-12);
      for (const entrant of entrants) {
        assert.ok(entrant.probability >= .01 && entrant.oddsCents <= 9500);
        assert.ok(entrant.probability * entrant.oddsCents / 100 <= .95 + 1e-12);
      }
    }
  } finally { s.close(); }
});

test('지갑·티켓·원장 원자성, 증액/분산/감액/0취소, 멱등·개정 충돌', () => {
  const s = setup();
  try {
    const initial = s.body(1000), once = s.race.purchase(s.user, initial);
    assert.equal(once.wallet.balance, 29000); assert.equal(once.revision, 1);
    assert.deepEqual(s.race.purchase(s.user, initial), once);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM grain_ledger').get().n, 1);
    assert.throws(() => s.race.purchase(s.user, { ...initial, amount: 2000 }), code('IDEMPOTENCY_CONFLICT'));
    assert.throws(() => s.race.purchase(s.user, s.body(2000, { expectedRevision: 0 })), code('REVISION_CONFLICT'));
    assert.equal(s.race.purchase(s.user, s.body(2000)).wallet.balance, 28000);
    const second = s.race.state().round.entrants[1].slimeId;
    assert.equal(s.race.purchase(s.user, s.body(500, { slimeId: second })).wallet.balance, 27500);
    assert.equal(s.race.purchase(s.user, s.body(100)).wallet.balance, 29400);
    assert.equal(s.race.purchase(s.user, s.body(0)).wallet.balance, 29500);
    assert.equal(s.race.me(s.user).bets.length, 1);
    assert.equal(s.db.prepare('SELECT SUM(amount) AS n FROM grain_ledger').get().n, -500);
    assert.deepEqual(s.race.me({ id: 'other' }).bets, []);
    assert.deepEqual(s.race.history({ id: 'other' }).rounds, []);
  } finally { s.close(); }
});

test('입력·부족·기술 상한·경기 불일치·마감과 재시도 제한', () => {
  const s = setup();
  try {
    for (const amount of [-1, 1, 99, NaN, Infinity, '100', 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => s.race.purchase(s.user, s.body(amount)), code('INVALID_INPUT'));
    assert.throws(() => s.race.purchase(s.user, s.body(30001)), code('INSUFFICIENT_GRAIN'));
    assert.throws(() => s.race.purchase(s.user, s.body(100, { roundId: '9' })), code('ROUND_CHANGED'));
    assert.throws(() => s.race.purchase(s.user, s.body(100, { slimeId: '9' })), code('NOT_ENTERED'));
    assert.equal(s.race.me(s.user).wallet.balance, 30000);
    const saved = s.body(100); s.race.purchase(s.user, saved);
    s.setTime(500000);
    assert.throws(() => s.race.purchase(s.user, s.body(0)), code('SALES_CLOSED'));
    assert.equal(s.race.purchase(s.user, saved).revision, 1);
    s.setTime(600000); s.race.tick();
    s.db.prepare('UPDATE grain_wallets SET balance=? WHERE userId=?').run(Number.MAX_SAFE_INTEGER, s.user.id);
    assert.throws(() => s.race.purchase(s.user, s.body(Number.MAX_SAFE_INTEGER)), code('AMOUNT_OVERFLOW'));
    assert.equal(s.race.me(s.user).bets.length, 0);
  } finally { s.close(); }
});

test('원장 실패 시 차감·티켓·개정 모두 롤백', () => {
  const s = setup();
  try {
    s.db.exec("CREATE TRIGGER fail_ledger BEFORE INSERT ON grain_ledger BEGIN SELECT RAISE(ABORT,'시험 실패'); END");
    assert.throws(() => s.race.purchase(s.user, s.body(1000)));
    assert.equal(s.race.me(s.user).wallet.balance, 30000);
    assert.equal(s.race.me(s.user).revision, 0);
    assert.deepEqual(s.race.me(s.user).bets, []);
  } finally { s.close(); }
});

test('재시작 후 동일 추첨·티켓·연출, 중단 중 미정산 회복과 지급 중복 방지', () => {
  const s = setup();
  try {
    const winnerTicket = s.body(1001), odds = s.race.state().round.entrants[0].oddsCents;
    s.race.purchase(s.user, winnerTicket);
    s.setTime(530000); const first = s.race.state();
    s.race.close();
    const restarted = createSlimeRace(s.db, { ...s.options, random: () => { throw new Error('재추첨 금지'); } });
    assert.deepEqual(restarted.state(), first);
    assert.equal(restarted.me(s.user).bets[0].amount, 1001);
    s.setTime(580000); restarted.tick(); restarted.tick();
    const payout = ticketPayout(1001, odds);
    assert.equal(restarted.me(s.user).wallet.balance, 30000 - 1001 + payout);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM grain_ledger WHERE eventId LIKE 'slime-race:payout:%'").get().n, 1);
    assert.equal(restarted.history(s.user).rounds[0].payout, payout);
    assert.equal(restarted.history(s.user).summary.profit, String(payout - 1001));
    restarted.close();
    const second = createSlimeRace(s.db, s.options);
    assert.equal(second.me(s.user).wallet.balance, 30000 - 1001 + payout);
    second.close();
  } finally { s.close(); }
});

test('500초 이전 중단된 라운드도 재시작 시 정산하고 원장을 보존', () => {
  const s = setup();
  try {
    s.race.purchase(s.user, s.body(100)); s.race.close(); s.setTime(1800000);
    const restarted = createSlimeRace(s.db, s.options);
    assert.equal(restarted.state().round.id, '3');
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM grain_ledger WHERE eventId LIKE 'slime-race:payout:%'").get().n, 1);
    assert.equal(restarted.history(s.user).rounds.length, 1);
    restarted.close();
  } finally { s.close(); }
});


test('모든 성향·256개 시드·순위의 1분 위치는 단조 증가하고 우승자만 결승점에 도착', () => {
  for (const style of new Set(SLIME_ROSTER.map(row => row.style))) for (let seed = 0; seed < 256; seed++) for (let rank = 0; rank < 5; rank++) {
    let previous = -1;
    for (let elapsed = 0; elapsed <= 60000; elapsed += 100) {
      const position = raceProgress(style, seed, rank, elapsed / 60000);
      assert.ok(position >= previous && position >= 0 && position <= 1, `${style}/${seed}/${rank}/${elapsed}`);
      previous = position;
    }
    assert.equal(raceProgress(style, seed, rank, 0), 0);
    assert.ok(Math.abs(previous - (1 - rank * .025)) < 1e-12);
  }
});


test('공용 그레인의 무료 전용 정책은 불변이며 공개 상태에서도 동일 계약을 제공', () => {
  const s = setup();
  try {
    assert.deepEqual(GRAIN_ECONOMY, {
      mode: 'free-only', purchasable: false, cashRedeemable: false,
      itemExchangeAllowed: false, transferable: false, paidCurrencyConvertible: false,
    });
    assert.ok(Object.isFrozen(GRAIN_ECONOMY));
    assert.throws(() => { GRAIN_ECONOMY.purchasable = true; }, TypeError);
    assert.equal(s.race.state().economy, GRAIN_ECONOMY);
    assert.equal(s.race.me(s.user).wallet.balance, 30000);
  } finally { s.close(); }
});
