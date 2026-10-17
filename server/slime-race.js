import { randomInt, randomBytes, randomUUID } from 'node:crypto';
import { fail } from './security.js';
import { GRAIN_ECONOMY } from './grain.js';

export const ROUND_MS = 600000;
const PROBABILITY_UNITS = 1000000;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const CONDITIONS = ['매우나쁨', '나쁨', '보통', '좋음', '매우좋음'];
const names = ['말랑', '딸기', '귤빛', '반짝', '클로', '물방울', '밤별', '보송', '구름', '초코'];
const grades = ['B', 'B', 'C', 'A', 'A', 'B', 'A', 'B', 'S', 'C'];
const styles = ['꾸준형', '초반 질주형', '초반 질주형', '순간 가속형', '꾸준형', '후반 추격형', '변칙형', '초반 질주형', '꾸준형', '후반 추격형'];
export const SLIME_ROSTER = names.map((name, i) => Object.freeze({ slimeId: String(i), name, grade: grades[i], style: styles[i] }));
const safe = value => { if (value < 0n || value > MAX) fail(422, 'AMOUNT_OVERFLOW', '금액이 안전한 계산 범위를 넘었습니다.'); return Number(value); };
export const ticketPayout = (amount, oddsCents) => safe(BigInt(amount) * BigInt(oddsCents) / 100n);
export function phaseAt(startsAt, time) {
  const elapsed = time - startsAt;
  return elapsed < 500000 ? 'sales' : elapsed < 510000 ? 'countdown' : elapsed < 570000 ? 'racing' : 'results';
}

// 모든 구간의 속도가 양수인 적분 곡선입니다. 성향은 승률을 바꾸지 않습니다.
export function raceProgress(style, seed, rank, x) {
  const phase = seed / 256 * 2 * Math.PI;
  const wave = (strength, frequency) => strength * (Math.cos(phase) - Math.cos(frequency * Math.PI * x + phase)) / (frequency * Math.PI);
  const shape = { '초반 질주형': () => .4 * Math.sin(Math.PI * x) / Math.PI,
    '꾸준형': () => 0, '후반 추격형': () => -.4 * Math.sin(Math.PI * x) / Math.PI,
    '순간 가속형': () => .35 * (1 - Math.cos(4 * Math.PI * x)) / (4 * Math.PI),
    '변칙형': () => wave(.35, 6) }[style]?.() ?? 0;
  return Math.max(0, Math.min(1, (x + shape + wave(.1, 8)) * (1 - rank * .025)));
}

export function createSlimeRace(db, { now = Date.now, random = randomInt, startTimer = true, onTimerError = () => {} } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS slime_race_rounds (
    id TEXT PRIMARY KEY, startsAt INTEGER NOT NULL UNIQUE, entrants TEXT NOT NULL,
    winnerId TEXT, finishOrder TEXT, animationSeed TEXT,
    settledAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS slime_race_revisions (
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    roundId TEXT NOT NULL REFERENCES slime_race_rounds(id), revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(userId,roundId)
  );
  CREATE TABLE IF NOT EXISTS slime_race_tickets (
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    roundId TEXT NOT NULL REFERENCES slime_race_rounds(id), slimeId TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>=100 AND amount<=9007199254740991),
    oddsCents INTEGER NOT NULL CHECK(oddsCents BETWEEN 1 AND 9500),
    payout INTEGER, PRIMARY KEY(userId,roundId,slimeId)
  );
  CREATE TABLE IF NOT EXISTS slime_race_requests (
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, requestId TEXT NOT NULL,
    payload TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(userId,requestId)
  );
  CREATE INDEX IF NOT EXISTS slime_race_tickets_round ON slime_race_tickets(roundId);
  CREATE INDEX IF NOT EXISTS slime_race_tickets_user ON slime_race_tickets(userId,roundId);
  `);
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const unpack = row => row && ({ ...row, entrants: JSON.parse(row.entrants), finishOrder: row.finishOrder && JSON.parse(row.finishOrder) });
  const getRound = id => unpack(db.prepare('SELECT * FROM slime_race_rounds WHERE id=?').get(id));
  const firstRoundStartsAt = () => db.prepare('SELECT MIN(startsAt) AS startsAt FROM slime_race_rounds').get().startsAt;
  const roundNumber = (startsAt, firstStartsAt) => (startsAt - firstStartsAt) / ROUND_MS + 1;
  function createRound(startsAt) {
    const counts = new Map(SLIME_ROSTER.map(slime => [slime.slimeId, 0]));
    for (const row of db.prepare('SELECT entrants FROM slime_race_rounds WHERE startsAt<? ORDER BY startsAt DESC LIMIT 20').all(startsAt)) {
      for (const entrant of JSON.parse(row.entrants)) counts.set(entrant.slimeId, counts.get(entrant.slimeId) + 1);
    }
    const pool = [...SLIME_ROSTER], picked = [];
    while (picked.length < 5) {
      const weights = pool.map(slime => 21 - counts.get(slime.slimeId));
      let draw = random(weights.reduce((a, b) => a + b, 0)), index = 0;
      while (draw >= weights[index]) draw -= weights[index++];
      const slime = pool.splice(index, 1)[0], conditionIndex = random(5);
      picked.push({ ...slime, condition: CONDITIONS[conditionIndex], weight: ({ S: 115, A: 105, B: 100, C: 90 })[slime.grade] * [80, 90, 100, 110, 120][conditionIndex] });
    }
    // 각 선수의 1%를 먼저 배분하고 나머지 95%를 정규화합니다. 반올림 잔여도 정수 단위입니다.
    const total = picked.reduce((sum, row) => sum + row.weight, 0);
    let assigned = 0;
    const entrants = picked.map(({ weight, ...row }) => {
      const probabilityUnits = 10000 + Math.floor(950000 * weight / total);
      assigned += probabilityUnits;
      return { ...row, probabilityUnits, oddsCents: Math.floor(95000000 / probabilityUnits) };
    });
    entrants[entrants.length - 1].probabilityUnits += PROBABILITY_UNITS - assigned;
    for (const entrant of entrants) entrant.oddsCents = Math.floor(95000000 / entrant.probabilityUnits);
    const id = String(startsAt / ROUND_MS);
    db.prepare('INSERT INTO slime_race_rounds(id,startsAt,entrants) VALUES(?,?,?)').run(id, startsAt, JSON.stringify(entrants));
    return getRound(id);
  }
  function drawRound(round) {
    let draw = random(PROBABILITY_UNITS), index = 0;
    while (draw >= round.entrants[index].probabilityUnits) draw -= round.entrants[index++].probabilityUnits;
    const winnerId = round.entrants[index].slimeId;
    const rest = round.entrants.filter(row => row.slimeId !== winnerId).map(row => row.slimeId);
    for (let i = rest.length - 1; i > 0; i--) { const j = random(i + 1); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    db.prepare('UPDATE slime_race_rounds SET winnerId=?,finishOrder=?,animationSeed=? WHERE id=? AND winnerId IS NULL').run(winnerId, JSON.stringify([winnerId, ...rest]), randomBytes(16).toString('hex'), round.id);
    return getRound(round.id);
  }
  function settleRound(round, time) {
    const tickets = db.prepare('SELECT * FROM slime_race_tickets WHERE roundId=?').all(round.id);
    for (const ticket of tickets) {
      const payout = ticket.slimeId === round.winnerId ? ticketPayout(ticket.amount, ticket.oddsCents) : 0;
      if (payout > 0) {
        const balance = db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(ticket.userId)?.balance ?? 0;
        safe(BigInt(balance) + BigInt(payout));
        db.prepare('INSERT INTO grain_ledger(id,userId,eventId,amount,reason,createdAt) VALUES(?,?,?,?,?,?)').run(randomUUID(), ticket.userId, `slime-race:payout:${round.id}`, payout, '슬라임 경주 당첨금 · 원금 포함', time);
        db.prepare('UPDATE grain_wallets SET balance=balance+? WHERE userId=?').run(payout, ticket.userId);
      }
      db.prepare('UPDATE slime_race_tickets SET payout=? WHERE userId=? AND roundId=? AND slimeId=?').run(payout, ticket.userId, round.id, ticket.slimeId);
    }
    db.prepare('UPDATE slime_race_rounds SET settledAt=? WHERE id=? AND settledAt IS NULL').run(time, round.id);
  }
  function advance(time) {
    const startsAt = Math.floor(time / ROUND_MS) * ROUND_MS;
    // 오래된 미정산을 먼저 회복합니다. 신규 DB에는 현재 회차부터 생성합니다.
    for (let round of db.prepare('SELECT * FROM slime_race_rounds WHERE settledAt IS NULL AND startsAt<=? ORDER BY startsAt').all(time).map(unpack)) {
      if (time >= round.startsAt + 500000 && round.winnerId === null) round = drawRound(round);
      if (time >= round.startsAt + 570000) settleRound(round, time);
    }
    const latest = db.prepare('SELECT MAX(startsAt) AS latest FROM slime_race_rounds').get().latest;
    for (let slot = latest === null ? startsAt : latest + ROUND_MS; slot <= startsAt; slot += ROUND_MS) {
      let round = createRound(slot);
      if (time >= slot + 500000) round = drawRound(round);
      if (time >= slot + 570000) settleRound(round, time);
    }
    return getRound(String(startsAt / ROUND_MS));
  }
  function tick() { return transaction(() => advance(now())); }
  function recentRanks(slimeId) {
    return db.prepare('SELECT finishOrder FROM slime_race_rounds WHERE settledAt IS NOT NULL ORDER BY startsAt DESC LIMIT 30').all().map(row => JSON.parse(row.finishOrder).indexOf(slimeId) + 1).filter(Boolean).slice(0, 5);
  }
  function animation(round, time) {
    const elapsedMs = Math.max(0, Math.min(60000, time - round.startsAt - 510000));
    const x = elapsedMs / 60000;
    return { elapsedMs, positions: round.entrants.map((slime, index) => {
      if (!round.finishOrder || x === 0) return { slimeId: slime.slimeId, progress: 0 };
      const rank = round.finishOrder.indexOf(slime.slimeId), seed = parseInt(round.animationSeed.slice(index * 2, index * 2 + 2), 16);
      return { slimeId: slime.slimeId, progress: raceProgress(slime.style, seed, rank, x) };
    }) };
  }
  function state() {
    return transaction(() => {
      const serverNow = now(), round = advance(serverNow), phase = phaseAt(round.startsAt, serverNow);
      return { serverNow, economy: GRAIN_ECONOMY, round: {
        id: round.id, roundNo: roundNumber(round.startsAt, firstRoundStartsAt()), startsAt: round.startsAt, salesCloseAt: round.startsAt + 500000, raceStartsAt: round.startsAt + 510000,
        resultsAt: round.startsAt + 570000, endsAt: round.startsAt + ROUND_MS, phase,
        entrants: round.entrants.map(({ probabilityUnits, ...row }) => ({ ...row, probability: probabilityUnits / PROBABILITY_UNITS, recentRanks: recentRanks(row.slimeId) })),
        animation: animation(round, serverNow), ...(phase === 'results' ? { winnerId: round.winnerId, finishOrder: round.finishOrder } : {}),
      }, roster: SLIME_ROSTER };
    });
  }
  function me(user) {
    const round = tick();
    return personal(user, round.id);
  }
  function personal(user, roundId) {
    return { roundId, wallet: { balance: user ? db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(user.id)?.balance ?? 0 : 0 },
      bets: user ? db.prepare('SELECT slimeId,amount,oddsCents FROM slime_race_tickets WHERE userId=? AND roundId=? ORDER BY slimeId').all(user.id, roundId).map(row => ({ ...row })) : [],
      revision: user ? db.prepare('SELECT revision FROM slime_race_revisions WHERE userId=? AND roundId=?').get(user.id, roundId)?.revision ?? 0 : 0 };
  }
  function purchase(user, body) {
    if (Object.keys(body).sort().join(',') !== 'amount,expectedRevision,requestId,roundId,slimeId' || typeof body.roundId !== 'string' || !/^\d{1,15}$/.test(body.roundId) || !SLIME_ROSTER.some(slime => slime.slimeId === body.slimeId) || typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(body.requestId) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || !Number.isSafeInteger(body.amount) || body.amount < 0 || (body.amount > 0 && body.amount < 100)) fail(422, 'INVALID_INPUT', '티켓 요청 항목을 확인해 주세요.');
    const payload = JSON.stringify([body.roundId, body.slimeId, body.amount, body.expectedRevision]);
    return transaction(() => {
      const time = now(), round = advance(time);
      const prior = db.prepare('SELECT payload,response FROM slime_race_requests WHERE userId=? AND requestId=?').get(user.id, body.requestId);
      if (prior) {
        if (prior.payload !== payload) fail(409, 'IDEMPOTENCY_CONFLICT', '같은 요청 번호의 내용이 다릅니다.');
        return JSON.parse(prior.response);
      }
      if (body.roundId !== round.id) fail(409, 'ROUND_CHANGED', '새 경기가 시작되었습니다. 새로 확인해 주세요.');
      if (phaseAt(round.startsAt, time) !== 'sales') fail(409, 'SALES_CLOSED', '티켓 판매가 마감되었습니다.');
      const entrant = round.entrants.find(row => row.slimeId === body.slimeId);
      if (!entrant) fail(422, 'NOT_ENTERED', '이번 경기 출전 선수를 선택해 주세요.');
      const current = personal(user, round.id);
      if (current.revision !== body.expectedRevision) fail(409, 'REVISION_CONFLICT', '티켓이 변경되었습니다. 새로 확인해 주세요.');
      if (current.revision === Number.MAX_SAFE_INTEGER) fail(422, 'REVISION_OVERFLOW', '티켓 변경 횟수를 확인해 주세요.');
      const previousAmount = current.bets.find(row => row.slimeId === body.slimeId)?.amount ?? 0;
      const delta = BigInt(body.amount) - BigInt(previousAmount);
      if (delta > BigInt(current.wallet.balance)) fail(409, 'INSUFFICIENT_GRAIN', '보유 그레인이 부족합니다.');
      const nextBalance = safe(BigInt(current.wallet.balance) - delta);
      // 모든 선수에 나누어 담더라도 어느 한 선수가 이길 때의 지갑 합계를 안전 정수로 보장합니다.
      for (const row of round.entrants) {
        const amount = row.slimeId === body.slimeId ? body.amount : current.bets.find(bet => bet.slimeId === row.slimeId)?.amount ?? 0;
        safe(BigInt(nextBalance) + BigInt(ticketPayout(amount, row.oddsCents)));
      }
      if (delta !== 0n) {
        db.prepare('INSERT INTO grain_wallets(userId,balance) VALUES(?,?) ON CONFLICT(userId) DO UPDATE SET balance=excluded.balance').run(user.id, nextBalance);
        db.prepare('INSERT INTO grain_ledger(id,userId,eventId,amount,reason,createdAt) VALUES(?,?,?,?,?,?)').run(randomUUID(), user.id, `slime-race:ticket:${body.requestId}`, Number(-delta), delta > 0n ? '슬라임 경주 티켓 구매·증액' : '슬라임 경주 티켓 취소·감액', time);
      }
      if (body.amount === 0) db.prepare('DELETE FROM slime_race_tickets WHERE userId=? AND roundId=? AND slimeId=?').run(user.id, round.id, body.slimeId);
      else db.prepare('INSERT INTO slime_race_tickets(userId,roundId,slimeId,amount,oddsCents) VALUES(?,?,?,?,?) ON CONFLICT(userId,roundId,slimeId) DO UPDATE SET amount=excluded.amount').run(user.id, round.id, body.slimeId, body.amount, entrant.oddsCents);
      db.prepare('INSERT INTO slime_race_revisions(userId,roundId,revision) VALUES(?,?,1) ON CONFLICT(userId,roundId) DO UPDATE SET revision=revision+1').run(user.id, round.id);
      const response = personal(user, round.id);
      db.prepare('INSERT INTO slime_race_requests(userId,requestId,payload,response) VALUES(?,?,?,?)').run(user.id, body.requestId, payload, JSON.stringify(response));
      return response;
    });
  }
  function history(user) {
    tick();
    const rows = db.prepare('SELECT t.*,r.winnerId,r.startsAt FROM slime_race_tickets t JOIN slime_race_rounds r ON r.id=t.roundId WHERE t.userId=? AND r.settledAt IS NOT NULL ORDER BY r.startsAt DESC,t.slimeId').all(user.id);
    const grouped = new Map(), firstStartsAt = firstRoundStartsAt();
    for (const row of rows) {
      if (!grouped.has(row.roundId)) grouped.set(row.roundId, { roundId: row.roundId, roundNo: roundNumber(row.startsAt, firstStartsAt), startsAt: row.startsAt, winnerId: row.winnerId, bets: [], totalBet: 0, payout: 0, profit: 0, hit: false });
      const group = grouped.get(row.roundId);
      group.bets.push({ slimeId: row.slimeId, amount: row.amount, oddsCents: row.oddsCents, payout: row.payout });
      group.totalBet += row.amount; group.payout += row.payout; group.profit = group.payout - group.totalBet; group.hit ||= row.payout > 0;
    }
    // 장기 누적은 안전 정수를 넘을 수 있으므로 합계는 10진 문자열로 전달합니다.
    const rounds = [...grouped.values()], sum = key => rounds.reduce((total, row) => total + BigInt(row[key]), 0n).toString();
    return { rounds: rounds.slice(0, 100), summary: { totalBet: sum('totalBet'), payout: sum('payout'), profit: sum('profit'), hitRate: rounds.length ? rounds.filter(row => row.hit).length / rounds.length : 0, roundsPlayed: rounds.length } };
  }
  tick();
  const timer = startTimer ? setInterval(() => { try { tick(); } catch (error) { onTimerError(error); } }, 1000) : null;
  timer?.unref();
  return { state, me, purchase, history, tick, close() { clearInterval(timer); } };
}
