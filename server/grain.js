import { randomUUID } from 'node:crypto';

// 그레인은 사이트 공용 무료 게임 화폐입니다. 티켓 사용·정산은 현금 구매나 환전이 아닙니다.
// 정책은 서버가 고정하며 요청 본문·쿼리·회원 속성으로 바꿀 수 없습니다.
export const GRAIN_ECONOMY = Object.freeze({
  mode: 'free-only',
  purchasable: false,
  cashRedeemable: false,
  itemExchangeAllowed: false,
  transferable: false,
  paidCurrencyConvertible: false,
});

export const SIGNUP_GRAIN_EVENT = 'signup-email-verified-v1';
export const SIGNUP_GRAIN_AMOUNT = 30000;

export function createGrainService(db, { now = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS grain_signup_reservations (
    userId TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS grain_event_eligibility (
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    eventId TEXT NOT NULL, createdAt INTEGER NOT NULL,
    PRIMARY KEY(userId,eventId)
  );
  CREATE TABLE IF NOT EXISTS grain_wallets (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance)='integer' AND balance>=0 AND balance<=9007199254740991)
  );
  CREATE TABLE IF NOT EXISTS grain_ledger (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    eventId TEXT NOT NULL, amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount<>0),
    reason TEXT NOT NULL, createdAt INTEGER NOT NULL,
    UNIQUE(userId,eventId)
  );
  CREATE INDEX IF NOT EXISTS grain_ledger_user_time ON grain_ledger(userId,createdAt DESC);
  CREATE TRIGGER IF NOT EXISTS grain_signup_after_insert AFTER INSERT ON user
  WHEN EXISTS (SELECT 1 FROM grain_signup_reservations WHERE userId=NEW.id)
  BEGIN
    INSERT INTO grain_event_eligibility(userId,eventId,createdAt)
      VALUES(NEW.id,'${SIGNUP_GRAIN_EVENT}',CAST(unixepoch('subsec')*1000 AS INTEGER));
    DELETE FROM grain_signup_reservations WHERE userId=NEW.id;
  END;`);
  // 회원 INSERT 이전에 실행이 중단된 예약만 버립니다. 자격과 지급 기록은 유지합니다.
  db.prepare('DELETE FROM grain_signup_reservations').run();

  function reserveSignup(userId) {
    db.prepare('INSERT INTO grain_signup_reservations(userId) VALUES(?)').run(userId);
  }
  function releaseSignup(userId) {
    if (userId) db.prepare('DELETE FROM grain_signup_reservations WHERE userId=?').run(userId);
  }
  // 호출자는 이메일 확인과 같은 트랜잭션에서 실행하고 활성 계정인지 먼저 확인합니다.
  function awardSignup(userId) {
    if (!db.prepare('SELECT 1 FROM grain_event_eligibility WHERE userId=? AND eventId=?').get(userId, SIGNUP_GRAIN_EVENT)) return;
    const result = db.prepare('INSERT INTO grain_ledger(id,userId,eventId,amount,reason,createdAt) VALUES(?,?,?,?,?,?) ON CONFLICT(userId,eventId) DO NOTHING').run(randomUUID(), userId, SIGNUP_GRAIN_EVENT, SIGNUP_GRAIN_AMOUNT, '신규 가입 이벤트', now());
    if (result.changes === 1) db.prepare('INSERT INTO grain_wallets(userId,balance) VALUES(?,?) ON CONFLICT(userId) DO UPDATE SET balance=balance+excluded.balance').run(userId, SIGNUP_GRAIN_AMOUNT);
  }
  function wallet(userId) {
    // 조회는 기존 회원의 지갑이나 가입 이벤트 자격을 생성하지 않습니다.
    return {
      balance: db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(userId)?.balance ?? 0,
      entries: db.prepare('SELECT id,amount,reason,createdAt FROM grain_ledger WHERE userId=? ORDER BY createdAt DESC,id DESC').all(userId).map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
    };
  }
  return { reserveSignup, releaseSignup, awardSignup, wallet };
}
