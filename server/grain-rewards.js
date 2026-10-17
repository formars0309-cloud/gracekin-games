import { createHash, randomUUID } from 'node:crypto';
import { fail } from './security.js';

export const REWARD_DAY_MS = 86400000;
export const kstDate = time => new Date(time + 9 * 3600000).toISOString().slice(0, 10);
const fingerprint = (title, body) => createHash('sha256').update(JSON.stringify([title, body].map(value => value.trim().replace(/\s+/gu, ' ')))).digest('hex');
const transaction = (db, work) => {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
};

// 커뮤니티 INSERT와 같은 트랜잭션에서만 부릅니다. 탈락한 첫 댓글도 남겨 재작성으로 우회하지 못하게 합니다.
export function reserveCommunityReward(db, rewards, { user, type, row, time }) {
  if (!rewards) return { pending: false, amount: 0 };
  const eventId = `community-${type}:${row.id}`, date = kstDate(time), amount = type === 'post' ? 500 : 100;
  let matches = [...row.body.trim()].length >= (type === 'post' ? 30 : 10);
  let hash = null;
  if (type === 'post') {
    hash = fingerprint(row.title, row.body);
    const previous = db.prepare("SELECT targetId,fingerprint FROM grain_activity_rewards WHERE userId=? AND targetType='post' ORDER BY rowid DESC LIMIT 1").get(user.id);
    const source = previous
      ? db.prepare('SELECT title,body FROM community_posts WHERE id=?').get(previous.targetId)
      : db.prepare('SELECT title,body FROM community_posts WHERE authorId=? AND id<>? ORDER BY rowid DESC LIMIT 1').get(user.id, row.id);
    const priorHash = source ? fingerprint(source.title, source.body) : previous?.fingerprint;
    if (hash === priorHash) matches = false;
  } else {
    const parent = db.prepare('SELECT authorId,hiddenAt FROM community_posts WHERE id=?').get(row.postId);
    const prior = db.prepare("SELECT 1 FROM grain_activity_rewards WHERE userId=? AND targetType='comment' AND postId=? LIMIT 1").get(user.id, row.postId)
      || db.prepare('SELECT 1 FROM community_comments WHERE authorId=? AND postId=? AND id<>? LIMIT 1').get(user.id, row.postId, row.id);
    if (!parent || parent.hiddenAt !== null || parent.authorId === user.id || prior) matches = false;
  }
  const day = db.prepare("SELECT COALESCE(SUM(amount),0) AS total, SUM(CASE WHEN targetType=? THEN 1 ELSE 0 END) AS count FROM grain_activity_rewards WHERE userId=? AND rewardDate=? AND status IN ('pending','confirmed')").get(type, user.id, date);
  const pending = matches && rewards.rewardEligible(user) && day.count < (type === 'post' ? 3 : 10) && day.total + amount <= 3000;
  db.prepare('INSERT INTO grain_activity_rewards(eventId,userId,targetType,targetId,postId,fingerprint,amount,rewardDate,createdAt,confirmsAt,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId, user.id, type, row.id, row.postId ?? null, hash, amount, date, time, time + REWARD_DAY_MS, pending ? 'pending' : 'ineligible');
  return { pending, amount: pending ? amount : 0 };
}

export function createGrainRewards(db, { now = Date.now, startTimer = true, onTimerError = () => {} } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS grain_reward_suspensions (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, reason TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS grain_activity_rewards (
    eventId TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    targetType TEXT NOT NULL CHECK(targetType IN ('attendance','post','comment')), targetId TEXT NOT NULL,
    postId TEXT, fingerprint TEXT, amount INTEGER NOT NULL CHECK(amount>0), rewardDate TEXT NOT NULL,
    createdAt INTEGER NOT NULL, confirmsAt INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelled','ineligible'))
  );
  CREATE INDEX IF NOT EXISTS grain_activity_rewards_due ON grain_activity_rewards(status,confirmsAt);
  CREATE INDEX IF NOT EXISTS grain_activity_rewards_user_day ON grain_activity_rewards(userId,rewardDate,status);
  CREATE INDEX IF NOT EXISTS grain_activity_rewards_first_comment ON grain_activity_rewards(userId,postId,targetType);
  CREATE TRIGGER IF NOT EXISTS grain_rewards_suspend AFTER INSERT ON grain_reward_suspensions BEGIN
    UPDATE grain_activity_rewards SET status='cancelled' WHERE userId=NEW.userId AND status='pending';
  END;
  CREATE TRIGGER IF NOT EXISTS grain_rewards_post_delete BEFORE DELETE ON community_posts BEGIN
    UPDATE grain_activity_rewards SET status='cancelled' WHERE status='pending' AND ((targetType='post' AND targetId=OLD.id) OR (targetType='comment' AND postId=OLD.id));
  END;
  CREATE TRIGGER IF NOT EXISTS grain_rewards_post_hide AFTER UPDATE OF hiddenAt ON community_posts WHEN NEW.hiddenAt IS NOT NULL BEGIN
    UPDATE grain_activity_rewards SET status='cancelled' WHERE status='pending' AND ((targetType='post' AND targetId=NEW.id) OR (targetType='comment' AND postId=NEW.id));
  END;
  CREATE TRIGGER IF NOT EXISTS grain_rewards_comment_delete BEFORE DELETE ON community_comments BEGIN
    UPDATE grain_activity_rewards SET status='cancelled' WHERE status='pending' AND targetType='comment' AND targetId=OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS grain_rewards_comment_hide AFTER UPDATE OF hiddenAt ON community_comments WHEN NEW.hiddenAt IS NOT NULL BEGIN
    UPDATE grain_activity_rewards SET status='cancelled' WHERE status='pending' AND targetType='comment' AND targetId=NEW.id;
  END;`);
  const isSuspended = userId => Boolean(db.prepare('SELECT 1 FROM grain_reward_suspensions WHERE userId=?').get(userId));
  function rewardStatus(user) {
    const current = user?.id && db.prepare('SELECT id,emailVerified,ageBand FROM user WHERE id=?').get(user.id);
    if (!current) return 'unverified';
    if (isSuspended(current.id)) return 'suspended';
    if (current.ageBand === 'under14') return 'under14';
    if (!current.emailVerified) return 'unverified';
    return 'eligible';
  }
  const rewardEligible = user => rewardStatus(user) === 'eligible';
  // 운영 지급도 이 함수를 사용합니다. BEGIN/COMMIT은 호출자 소유입니다.
  function grant(userId, eventId, amount, reason) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || typeof eventId !== 'string' || !eventId || typeof reason !== 'string' || !reason.trim()) fail(422, 'INVALID_INPUT', '그레인 지급 항목을 확인해 주세요.');
    if (db.prepare('SELECT 1 FROM grain_ledger WHERE userId=? AND eventId=?').get(userId, eventId)) return false;
    const balance = db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(userId)?.balance ?? 0;
    if (BigInt(balance) + BigInt(amount) > BigInt(Number.MAX_SAFE_INTEGER)) fail(422, 'AMOUNT_OVERFLOW', '금액이 안전한 계산 범위를 넘었습니다.');
    db.prepare('INSERT INTO grain_ledger(id,userId,eventId,amount,reason,createdAt) VALUES(?,?,?,?,?,?)').run(randomUUID(), userId, eventId, amount, reason, now());
    db.prepare('INSERT INTO grain_wallets(userId,balance) VALUES(?,?) ON CONFLICT(userId) DO UPDATE SET balance=balance+excluded.balance').run(userId, amount);
    return true;
  }
  function cancelPending(userId) { db.prepare("UPDATE grain_activity_rewards SET status='cancelled' WHERE userId=? AND status='pending'").run(userId); }
  function cancelContent(targetType, targetId) {
    db.prepare("UPDATE grain_activity_rewards SET status='cancelled' WHERE status='pending' AND ((targetType=? AND targetId=?) OR (?='post' AND targetType='comment' AND postId=?))").run(targetType, targetId, targetType, targetId);
  }
  function summary(user) {
    const pending = user?.id ? db.prepare("SELECT eventId,targetType,targetId,amount,createdAt,confirmsAt FROM grain_activity_rewards WHERE userId=? AND status='pending' ORDER BY createdAt,eventId").all(user.id).map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), confirmsAt: new Date(row.confirmsAt).toISOString() })) : [];
    return { pending, pendingTotal: pending.reduce((sum, row) => sum + row.amount, 0), rewardEligibility: rewardStatus(user) };
  }
  function attendance(user) {
    return transaction(db, () => {
      const status = rewardStatus(user);
      if (status !== 'eligible') fail(403, 'REWARD_INELIGIBLE', '이메일 확인, 연령 구분과 보상 이용 상태를 확인해 주세요.');
      const time = now(), date = kstDate(time), eventId = `attendance:${date}`;
      const prior = db.prepare('SELECT 1 FROM grain_ledger WHERE userId=? AND eventId=?').get(user.id, eventId);
      const total = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM grain_activity_rewards WHERE userId=? AND rewardDate=? AND status IN ('pending','confirmed')").get(user.id, date).total;
      if (prior || total + 300 > 3000) return { awarded: false, amount: 0, date };
      const awarded = grant(user.id, eventId, 300, '출석');
      if (awarded) db.prepare("INSERT INTO grain_activity_rewards(eventId,userId,targetType,targetId,amount,rewardDate,createdAt,confirmsAt,status) VALUES(?,?,'attendance',?,?,?,?,?,'confirmed')")
        .run(`${user.id}:${eventId}`, user.id, date, 300, date, time, time);
      return { awarded, amount: awarded ? 300 : 0, date };
    });
  }
  function tick() {
    return transaction(db, () => {
      const time = now();
      for (const row of db.prepare("SELECT * FROM grain_activity_rewards WHERE status='pending' ORDER BY confirmsAt,eventId").all()) {
        const source = row.targetType === 'post'
          ? db.prepare('SELECT authorId,hiddenAt FROM community_posts WHERE id=?').get(row.targetId)
          : db.prepare('SELECT c.authorId,c.hiddenAt,p.hiddenAt AS parentHiddenAt FROM community_comments c JOIN community_posts p ON p.id=c.postId WHERE c.id=?').get(row.targetId);
        if (!source || source.authorId !== row.userId || source.hiddenAt !== null || source.parentHiddenAt != null || isSuspended(row.userId) || (row.confirmsAt <= time && !rewardEligible({ id: row.userId }))) {
          db.prepare("UPDATE grain_activity_rewards SET status='cancelled' WHERE eventId=? AND status='pending'").run(row.eventId);
        } else if (row.confirmsAt <= time) {
          grant(row.userId, row.eventId, row.amount, row.targetType === 'post' ? '커뮤니티 글 작성' : '커뮤니티 댓글 작성');
          db.prepare("UPDATE grain_activity_rewards SET status='confirmed' WHERE eventId=? AND status='pending'").run(row.eventId);
        }
      }
    });
  }
  tick();
  const timer = startTimer ? setInterval(() => { try { tick(); } catch (error) { onTimerError(error); } }, 60000) : null;
  timer?.unref();
  return { rewardStatus, rewardEligible, isSuspended, grant, cancelPending, cancelContent, summary, attendance, tick, close() { clearInterval(timer); } };
}
