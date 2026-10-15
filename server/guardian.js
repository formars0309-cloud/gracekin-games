import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fail, json, readJson, text } from './security.js';

export const CONSENT_VERSION = '2026-10-16-v1';
export const CONSENT_TEXT = `그레이스킨게임즈 어린이 회원가입 개인정보 처리 동의\n\n처리 목적: 공통 회원 가입, 이메일 확인, 로그인·비밀번호 복구, 보호자 동의 확인 및 철회 처리.\n어린이 정보: 닉네임, 이메일, 해시 처리한 비밀번호, 만 14세 미만 여부, 로그인 세션·접속 IP. 생년월일·실명·주민등록번호는 받지 않습니다. 어린이 정보는 보호자 동의 승인 뒤 입력받습니다.\n보호자 정보: 이름, 이메일, 동의 회신, 운영자 확인 기록.\n보유 기간: 가입하지 않은 신청은 7일 뒤 이름·이메일과 동의 자료를 정리합니다. 가입한 경우 회원 탈퇴 또는 동의 철회에 따른 처리 종료까지 동의 확인에 필요한 자료를 보관합니다. 회원 탈퇴·동의 철회 요청은 이 메일의 회신 주소로 보낼 수 있습니다.\n국외 보관: 회원·보호자 동의 정보는 Fly.io의 일본 도쿄 서버에 저장됩니다. 메일은 운영자가 설정한 메일 서비스로 전송됩니다. 실제 발신 서비스와 개인정보 처리방침을 확인한 뒤 동의해 주세요.\n동의를 거부할 수 있으며, 거부하면 어린이 회원가입은 할 수 없습니다. 가입 없이 가능한 게임 체험과 공개 게시판 읽기는 이용할 수 있습니다. 어린이 회원의 커뮤니티 글·댓글 쓰기는 현재 허용하지 않습니다. 결제·대회 참가에 대한 동의는 포함하지 않습니다.\n\n회신 문구: 본인은 이 신청으로 가입할 어린이의 법정대리인이며, 위 개인정보 처리 내용을 읽고 어린이 회원가입과 해당 정보 처리에 동의합니다.\n\n메일 링크를 열거나 메일이 도착한 사실만으로 승인하지 않습니다. 운영자가 회신 내용과 법정대리인 확인을 검토한 뒤 승인합니다.`;
const hash = value => createHash('sha256').update(value).digest('hex');
const COOKIE = 'gracekin.guardian-request';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function guardianEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !EMAIL.test(value) || /[\r\n]/.test(value)) fail(422, 'INVALID_EMAIL', '보호자 이메일을 확인해 주세요.');
  return value.trim().toLowerCase();
}
export function initializeGuardian(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS guardian_requests (
    id TEXT PRIMARY KEY, capabilityHash TEXT NOT NULL UNIQUE,
    guardianName TEXT, guardianEmail TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','creating','used','rejected','expired','withdrawn')),
    createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, reviewedAt INTEGER,
    consentVersion TEXT NOT NULL, consentText TEXT NOT NULL,
    childUserId TEXT UNIQUE REFERENCES user(id) ON DELETE SET NULL,
    claim TEXT, reservedUserId TEXT UNIQUE
  );
  CREATE TABLE IF NOT EXISTS guardian_audit (
    id TEXT PRIMARY KEY, requestId TEXT NOT NULL REFERENCES guardian_requests(id),
    action TEXT NOT NULL, createdAt INTEGER NOT NULL, evidenceHash TEXT, evidenceFile TEXT
  );
  CREATE TRIGGER IF NOT EXISTS guardian_child_before_insert BEFORE INSERT ON user
  WHEN NEW.ageBand='under14'
  BEGIN
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM guardian_requests WHERE reservedUserId=NEW.id AND status='creating' AND expiresAt>CAST(unixepoch('subsec')*1000 AS INTEGER)
    ) THEN RAISE(ABORT,'보호자 동의 승인이 필요합니다') END;
  END;
  CREATE TRIGGER IF NOT EXISTS guardian_child_after_insert AFTER INSERT ON user
  WHEN NEW.ageBand='under14'
  BEGIN
    UPDATE guardian_requests SET status='used',childUserId=NEW.id,claim=NULL WHERE reservedUserId=NEW.id AND status='creating';
    INSERT INTO guardian_audit(id,requestId,action,createdAt)
      SELECT lower(hex(randomblob(16))),id,'used',CAST(unixepoch('subsec')*1000 AS INTEGER) FROM guardian_requests WHERE childUserId=NEW.id;
  END;
  CREATE TRIGGER IF NOT EXISTS guardian_child_session_before_insert BEFORE INSERT ON session
  WHEN EXISTS (SELECT 1 FROM user WHERE id=NEW.userId AND ageBand='under14')
  BEGIN
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM guardian_requests WHERE childUserId=NEW.userId AND status='used'
    ) THEN RAISE(ABORT,'보호자 동의가 철회되었습니다') END;
  END;`);
}
export function expireGuardianRequests(db, now = Date.now()) {
  db.prepare("UPDATE guardian_requests SET status='expired',guardianName=NULL,guardianEmail=NULL,claim=NULL WHERE status IN ('pending','approved','rejected') AND expiresAt<=?").run(now);
}
export function guardianIsActive(db, userId) { return Boolean(db.prepare("SELECT 1 FROM guardian_requests WHERE childUserId=? AND status='used'").get(userId)); }
export function auditGuardian(db, requestId, action, now, evidenceHash = null, evidenceFile = null) {
  db.prepare('INSERT INTO guardian_audit(id,requestId,action,createdAt,evidenceHash,evidenceFile) VALUES(?,?,?,?,?,?)').run(randomUUID(), requestId, action, now, evidenceHash, evidenceFile);
}
export function withdrawGuardian(db, id, now = Date.now()) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT * FROM guardian_requests WHERE id=?').get(id);
    if (!row) fail(404, 'NOT_FOUND', '신청을 찾을 수 없습니다.');
    db.prepare("UPDATE guardian_requests SET status='withdrawn',claim=NULL WHERE id=?").run(id);
    if (row.childUserId) db.prepare('DELETE FROM session WHERE userId=?').run(row.childUserId);
    auditGuardian(db, id, 'withdrawn', now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function createGuardianService(db, { origin, production, mailer, replyTo, now = Date.now }) {
  initializeGuardian(db);
  // 이전 실행이 회원 생성 전에 종료된 경우에만 다시 신청할 수 있게 합니다.
  db.prepare("UPDATE guardian_requests SET status='approved',claim=NULL WHERE status='creating' AND childUserId IS NULL").run();
  if (replyTo) replyTo = guardianEmail(replyTo);
  const enabled = Boolean(mailer && replyTo);
  function current(request) {
    expireGuardianRequests(db, now());
    const cookie = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
    const token = cookie?.slice(COOKIE.length + 1);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return db.prepare('SELECT * FROM guardian_requests WHERE capabilityHash=?').get(hash(token)) || null;
  }
  function claim(request) {
    const row = current(request);
    if (!row || row.status !== 'approved') fail(403, 'GUARDIAN_APPROVAL_REQUIRED', '보호자 동의가 승인된 브라우저에서 가입을 진행해 주세요.');
    const value = randomUUID(), userId = randomUUID();
    const result = db.prepare("UPDATE guardian_requests SET status='creating',claim=?,reservedUserId=? WHERE id=? AND status='approved' AND expiresAt>?").run(value, userId, row.id, now());
    if (result.changes !== 1) fail(409, 'GUARDIAN_REQUEST_IN_USE', '이미 진행 중인 신청입니다.');
    return { id: row.id, value, userId };
  }
  function release(claim) { if (claim) db.prepare("UPDATE guardian_requests SET status='approved',claim=NULL WHERE id=? AND claim=? AND status='creating'").run(claim.id, claim.value); }
  async function handle(request, url) {
    if (url.pathname === '/api/account/guardian-requests' && request.method === 'POST') {
      if (!enabled) fail(503, 'GUARDIAN_UNAVAILABLE', '보호자 동의 메일 절차를 준비하고 있습니다.');
      const body = await readJson(request);
      // 동의 전 어린이 정보를 요청 본문으로 보내도 보관하지 않습니다.
      if (Object.keys(body).some(key => !['guardianName', 'guardianEmail'].includes(key))) fail(422, 'GUARDIAN_FIELDS_ONLY', '이 단계에서는 보호자 이름과 이메일만 입력해 주세요.');
      const name = text(body.guardianName, 2, 50, '보호자 이름'), email = guardianEmail(body.guardianEmail);
      expireGuardianRequests(db, now());
      const recent = db.prepare('SELECT COUNT(*) AS n FROM guardian_requests WHERE guardianEmail=? AND createdAt>?').get(email, now() - 24 * 60 * 60 * 1000);
      if (recent.n >= 3) fail(429, 'RATE_LIMITED', '신청이 많습니다. 받은 메일을 확인하거나 나중에 다시 시도해 주세요.');
      const id = randomUUID(), token = randomBytes(32).toString('base64url');
      db.prepare("INSERT INTO guardian_requests(id,capabilityHash,guardianName,guardianEmail,status,createdAt,expiresAt,consentVersion,consentText) VALUES(?,?,?,?,'pending',?,?,?,?)").run(id, hash(token), name, email, now(), now() + WEEK, CONSENT_VERSION, CONSENT_TEXT);
      try { await mailer({ to: email, replyTo, subject: `[그레이스킨게임즈] 보호자 동의 신청 ${id}`, text: `${CONSENT_TEXT}\n\n동의문 버전: ${CONSENT_VERSION}\n신청 번호: ${id}\n신청 기한: ${new Date(now() + WEEK).toISOString()}\n\n동의하시면 위 회신 문구와 신청 번호를 포함해 이 메일에 회신해 주세요. 다른 사람이 신청했다면 동의하지 말고 무시해 주세요. 승인 후 신청한 브라우저에서 이어서 가입할 수 있습니다.\n\n가입 화면: ${origin}/account/?view=guardian` }); }
      catch {
        db.prepare('DELETE FROM guardian_requests WHERE id=?').run(id);
        fail(503, 'EMAIL_DELIVERY_FAILED', '메일을 보내지 못했습니다. 잠시 후 다시 신청해 주세요.');
      }
      auditGuardian(db, id, 'requested', now());
      return json({ status: true }, 200, { 'set-cookie': `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${WEEK / 1000}${production ? '; Secure' : ''}` });
    }
    if (url.pathname === '/api/account/guardian-request' && request.method === 'GET') {
      const row = current(request);
      return json({ request: row ? { status: row.status === 'creating' ? 'approved' : row.status, expiresAt: new Date(row.expiresAt).toISOString(), requestNumber: row.id } : null });
    }
    if (url.pathname === '/api/account/guardian-request/cancel' && request.method === 'POST') {
      await readJson(request);
      const row = current(request);
      if (row) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = db.prepare("UPDATE guardian_requests SET status='withdrawn',claim=NULL WHERE id=? AND status IN ('pending','approved')").run(row.id);
          if (result.changes !== 1) fail(409, 'GUARDIAN_CANNOT_CANCEL', '가입이 진행되었거나 완료된 신청은 보호자가 운영자에게 문의해 주세요.');
          auditGuardian(db, row.id, 'cancelled', now());
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      return json({ status: true });
    }
    return null;
  }
  return { enabled, claim, release, handle, hasCurrent: request => { const row = current(request); return Boolean(row && ['pending','approved','creating'].includes(row.status)); } };
}
