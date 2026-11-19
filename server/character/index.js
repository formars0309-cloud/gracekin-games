import { randomUUID } from 'node:crypto';
import { activeAccountUser } from '../account.js';
import { fail, json, readJson } from '../security.js';
import { STATS, POINTS_PER_LEVEL, CHANGE_LOCK_LEVEL, EXP_RULES, progressFromExp, statsOf, titlesOf, branchStatus, validateCharacterData } from '../../assets/character/model.js';

const DAY_MS = 86400000;
const kstDate = time => new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const zeroAlloc = () => Object.fromEntries(STATS.map(({ id }) => [id, 0]));
export function initializeCharacterSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS characters (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    id TEXT NOT NULL UNIQUE, data TEXT NOT NULL, alloc TEXT NOT NULL,
    totalExp INTEGER NOT NULL DEFAULT 0 CHECK(totalExp>=0),
    resetFreeUsed INTEGER NOT NULL DEFAULT 0, lastResetAt INTEGER,
    revision INTEGER NOT NULL CHECK(revision>0), createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS character_exp_events (
    eventId TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK(source IN ('attendance','post','comment')),
    amount INTEGER NOT NULL CHECK(amount>0), expDate TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS character_exp_events_user_day ON character_exp_events(userId,expDate,source);`);
}
export function getPublicCharacter(db, userId) {
  // 캐릭터를 쓰지 않는 독립 서버 모듈의 기존 DB도 읽을 수 있습니다.
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='characters'").get()) return null;
  const row = db.prepare('SELECT data,totalExp FROM characters WHERE userId=?').get(userId);
  if (!row) return null;
  const { race, job, appearance } = JSON.parse(row.data);
  return { race, job, level: progressFromExp(row.totalExp).level, appearance };
}
export function createCharacterService(db, { now = Date.now } = {}) {
  initializeCharacterSchema(db);
  const find = userId => db.prepare('SELECT * FROM characters WHERE userId=?').get(userId);
  const suspended = userId => Boolean(db.prepare('SELECT 1 FROM grain_reward_suspensions WHERE userId=?').get(userId));
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function snapshot(userId) {
    const row = find(userId);
    if (!row) return null;
    const data = JSON.parse(row.data), alloc = JSON.parse(row.alloc), progress = progressFromExp(row.totalExp), stats = statsOf(data, alloc);
    const nextFreeAt = row.resetFreeUsed ? row.lastResetAt + 30 * DAY_MS : null;
    return {
      id: row.id, revision: row.revision, data,
      progress: { ...progress, totalExp: row.totalExp, points: (progress.level - 1) * POINTS_PER_LEVEL - Object.values(alloc).reduce((a, b) => a + b, 0) },
      alloc, stats, titles: titlesOf(stats), branches: branchStatus(data.job, stats, progress.level),
      reset: { available: nextFreeAt === null || now() >= nextFreeAt, nextFreeAt: nextFreeAt === null ? null : new Date(nextFreeAt).toISOString() },
      checkedInToday: Boolean(db.prepare("SELECT 1 FROM character_exp_events WHERE userId=? AND source='attendance' AND expDate=?").get(userId, kstDate(now()))),
    };
  }
  // 그레인 출석·확정과 같은 트랜잭션에서만 호출합니다. 양과 날짜는 HTTP 입력으로 받지 않습니다.
  function grantInTransaction(userId, eventId, source) {
    if (!db.isTransaction) throw new Error('경험치 지급에는 트랜잭션이 필요합니다.');
    if (!Object.hasOwn(EXP_RULES, source) || source === 'dailyTotalLimit' || typeof eventId !== 'string' || !eventId) fail(422, 'INVALID_INPUT', '경험치 출처를 확인해 주세요.');
    const row = find(userId), time = now(), date = kstDate(time), policy = EXP_RULES[source];
    if (!row || suspended(userId) || db.prepare('SELECT 1 FROM character_exp_events WHERE eventId=?').get(eventId)) return { granted: false, amount: 0 };
    const day = db.prepare('SELECT COALESCE(SUM(amount),0) AS total, COUNT(CASE WHEN source=? THEN 1 END) AS count FROM character_exp_events WHERE userId=? AND expDate=?').get(source, userId, date);
    if (day.count >= policy.dailyLimit || day.total + policy.amount > EXP_RULES.dailyTotalLimit) return { granted: false, amount: 0 };
    if (!Number.isSafeInteger(row.totalExp + policy.amount)) fail(422, 'EXP_OVERFLOW', '경험치가 안전한 계산 범위를 넘었습니다.');
    db.prepare('INSERT INTO character_exp_events(eventId,userId,source,amount,expDate,createdAt) VALUES(?,?,?,?,?,?)').run(eventId, userId, source, policy.amount, date, time);
    db.prepare('UPDATE characters SET totalExp=totalExp+?, revision=revision+1, updatedAt=? WHERE userId=?').run(policy.amount, time, userId);
    return { granted: true, amount: policy.amount };
  }
  const checkinInTransaction = userId => grantInTransaction(userId, `attendance:${userId}:${kstDate(now())}`, 'attendance');
  function revision(row, value) {
    if (!Number.isSafeInteger(value) || value < 0) fail(422, 'INVALID_INPUT', '저장 버전을 확인해 주세요.');
    if ((row?.revision ?? 0) !== value) fail(409, 'REVISION_CONFLICT', '캐릭터가 바뀌었습니다. 다시 불러온 뒤 저장해 주세요.');
  }
  const fields = (body, keys) => {
    if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key))) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
  };
  async function handle(request, url, auth) {
    const path = url.pathname;
    const methods = { '/api/character/me': ['GET', 'PUT'], '/api/character/me/allocate': ['POST'], '/api/character/me/reset': ['POST'], '/api/character/me/checkin': ['POST'] };
    if (!Object.hasOwn(methods, path)) fail(404, 'NOT_FOUND', '캐릭터 요청을 찾을 수 없습니다.');
    if (!methods[path].includes(request.method)) fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
    if (url.search) fail(422, 'INVALID_INPUT', '캐릭터 요청에는 추가 항목을 보낼 수 없습니다.');
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    const user = activeAccountUser(db, session?.user && db.prepare('SELECT id,ageBand FROM user WHERE id=?').get(session.user.id));
    if (!user) fail(401, 'AUTH_REQUIRED', '로그인 후 이용해 주세요.');
    if (request.method === 'GET') return json({ character: snapshot(user.id) });
    const body = await readJson(request);
    return json(transaction(() => {
      const row = find(user.id), time = now();
      if (path.endsWith('/checkin')) {
        fields(body, []);
        return { ...checkinInTransaction(user.id), character: snapshot(user.id) };
      }
      fields(body, path.endsWith('/allocate') ? ['revision', 'stat', 'amount'] : path.endsWith('/reset') ? ['revision'] : ['revision', 'data']);
      revision(row, body.revision);
      if (request.method === 'PUT') {
        try { validateCharacterData(body.data); }
        catch (error) { if (error.code === 'INVALID_CHARACTER') fail(422, error.code, `${error.message} (${error.field})`); throw error; }
        const prior = row && JSON.parse(row.data);
        if (row && progressFromExp(row.totalExp).level >= CHANGE_LOCK_LEVEL && (prior.race !== body.data.race || prior.job !== body.data.job)) fail(422, 'CHANGE_LOCKED', '레벨 10부터 종족과 직업을 바꿀 수 없습니다.');
        if (!row) db.prepare('INSERT INTO characters(userId,id,data,alloc,totalExp,resetFreeUsed,lastResetAt,revision,createdAt,updatedAt) VALUES(?,?,?,?,0,0,NULL,1,?,?)').run(user.id, randomUUID(), JSON.stringify(body.data), JSON.stringify(zeroAlloc()), time, time);
        else db.prepare('UPDATE characters SET data=?,revision=revision+1,updatedAt=? WHERE userId=?').run(JSON.stringify(body.data), time, user.id);
      } else {
        if (!row) fail(422, 'CHARACTER_REQUIRED', '캐릭터를 먼저 만들어 주세요.');
        if (path.endsWith('/allocate')) {
          if (!STATS.some(({ id }) => id === body.stat) || !Number.isSafeInteger(body.amount) || body.amount < 1) fail(422, 'INVALID_INPUT', '분배할 스탯과 포인트를 확인해 주세요.');
          const current = snapshot(user.id);
          if (body.amount > current.progress.points) fail(422, 'NOT_ENOUGH_POINTS', '남은 포인트보다 많이 분배할 수 없습니다.');
          current.alloc[body.stat] += body.amount;
          db.prepare('UPDATE characters SET alloc=?,revision=revision+1,updatedAt=? WHERE userId=?').run(JSON.stringify(current.alloc), time, user.id);
        } else {
          if (row.resetFreeUsed && time < row.lastResetAt + 30 * DAY_MS) fail(422, 'RESET_NOT_READY', '마지막 초기화에서 30일이 지나야 합니다.');
          db.prepare('UPDATE characters SET alloc=?,resetFreeUsed=1,lastResetAt=?,revision=revision+1,updatedAt=? WHERE userId=?').run(JSON.stringify(zeroAlloc()), time, time, user.id);
        }
      }
      return { character: snapshot(user.id) };
    }));
  }
  return { handle, snapshot, grantInTransaction, checkinInTransaction };
}
