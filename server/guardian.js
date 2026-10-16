import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fail, json, readJson, text } from './security.js';

export const CONSENT_VERSION = '2026-10-16-v4';
export const GUARDIAN_STATEMENT = '본인은 이 신청으로 가입할 어린이의 법정대리인입니다.';
export const CONSENT_STATEMENT = '위 개인정보 처리와 국외 보관·메일 처리 내용을 읽고 어린이 회원가입과 해당 정보 처리에 동의합니다.';
export const AUTO_REPLY_TITLE = '어린이 회원가입 동의 회신';
export const AUTO_REPLY_END = '동의 회신 끝';
export function automaticReplyText(id, nonce) {
  return `${AUTO_REPLY_TITLE}\n신청 번호: ${id}\n회신 확인 코드: ${nonce}\n동의문 버전: ${CONSENT_VERSION}\n${GUARDIAN_STATEMENT}\n${CONSENT_STATEMENT}\n${AUTO_REPLY_END}`;
}
export const CONSENT_TEXT = `그레이스킨게임즈 어린이 회원가입 개인정보 처리 동의

처리 목적: 공통 회원 가입, 이메일 확인, 로그인·비밀번호 복구, 보호자 동의 확인 및 철회 처리, 그레인 가입 보상 지급·중복 지급 방지와 본인 잔액·지급 내역 제공.
어린이 정보: 닉네임, 이메일, 해시 처리한 비밀번호, 만 14세 미만 여부, 로그인 세션·접속 IP, 계정별 그레인 잔액·이벤트 자격·기록 시각·지급 금액·사유·시각. 생년월일·실명·주민등록번호는 받지 않습니다. 어린이 정보는 보호자 동의 승인 뒤 입력받습니다.
보호자 정보: 이름, 이메일, 동의 회신, 메일 인증 결과, 자동 검증 또는 운영자 확인 기록.
보유 기간: 가입하지 않은 신청은 7일 뒤 이름·이메일과 동의 자료를 정리합니다. 가입한 경우 회원 탈퇴 또는 동의 철회에 따른 처리 종료까지 동의 확인에 필요한 자료를 보관합니다. 계정 삭제 시 연결된 그레인 잔액·이벤트 자격·지급 내역도 함께 삭제합니다. 회원 탈퇴·동의 철회 요청은 support@gracekingames.com으로 보낼 수 있습니다. 서버 정리와 메일 업체의 사본 보관 기간은 구분합니다.

국외 보관·메일 처리:
1. Fly.io, Inc.(compliance@fly.io)의 일본 도쿄 서버에 회원·보호자 동의 정보를 HTTPS로 보내고 보관합니다. 보유 기간은 위와 같습니다.
2. Resend 운영사 Plus Five Five, Inc.(support@resend.com)에 이메일 발송 시 수신 주소, 메일 제목·본문, 인증·복구 링크 또는 동의 신청 번호·동의문을 암호화된 SMTP로 보냅니다. 자동 동의 안내 메일의 회신 주소로 보내는 메일도 Resend가 수신하고 발신·수신 주소, 제목·본문·첨부 및 메일 인증 결과를 처리합니다. 서버는 서명된 수신 알림과 HTTPS API로 받은 메일을 대조하여 자동 검증하며 첨부파일을 내려받거나 실행하지 않습니다. 자동 검증에 필요한 동의문과 확인 결과만 별도 증빙으로 보관하고 회신 확인 코드는 해시로 가립니다. 발송은 일본 도쿄 리전을 이용하며 메일 본문·발송·수신 기록의 저장·주요 처리는 미국에서 이뤄집니다. 메일·로그는 30일, 백업은 7일 보관하며 서비스 계약 종료 후 잔여 고객 자료는 90일 이내 삭제합니다.
3. support@gracekingames.com으로 보내는 수동 확인 회신·문의는 ImprovMX Incorporation(https://improvmx.com/contact/)이 운영자 수신함으로 전달합니다. 발신·수신 주소, 제목·본문·첨부파일과 전달에 필요한 기술 정보를 처리합니다. 수신 원문은 프랑스에서 일시 보관하고 프랑스·미국의 전달 설비를 이용하며, 전달 완료 또는 영구 실패 시 원문을 삭제합니다. 전달 로그는 7일 보관합니다. 운영자가 보관하는 회신·동의 증빙에는 위 보유 기간을 적용합니다.
4. 전달된 회신·문의는 Google LLC의 Gmail(googlekrsupport@google.com)에 보관하여 운영자가 확인합니다. Google은 미국을 포함한 전세계 서버에서 정보를 처리하며 이 수신함의 보관 국가를 하나로 고정하지 않습니다. 운영자는 증빙 보관 후 중복 사본과 처리 종료 자료를 직접 정리합니다. Gmail 휴지통은 최대 30일 후 삭제되며, Google 시스템 삭제는 일반적으로 약 2개월, 암호화 백업은 최대 6개월 걸릴 수 있습니다. 법적·보안상 사유에 따른 추가 보관은 Google 방침을 따릅니다.
업체별 처리 항목·목적·보관과 삭제 요청은 https://gracekingames.com/community/privacy/ 에서 확인할 수 있습니다. 수신인이 이용하는 메일 서비스도 전달받은 메일을 자체 방침에 따라 처리합니다.

동의를 거부할 수 있으며, 위 계정·메일 처리를 거부하면 어린이 회원가입은 할 수 없습니다. 가입 없이 가능한 게임 체험과 공개 게시판 읽기는 이용할 수 있습니다. 어린이 회원의 커뮤니티 글·댓글 쓰기는 현재 허용하지 않습니다. 결제·대회 참가에 대한 동의는 포함하지 않습니다.

회신 문구: 본인은 이 신청으로 가입할 어린이의 법정대리인이며, 위 개인정보 처리와 국외 보관·메일 처리 내용을 읽고 어린이 회원가입과 해당 정보 처리에 동의합니다.

메일 링크를 열거나 메일이 도착한 사실만으로 승인하지 않습니다. 자동 처리 모드에서는 신청 이메일과 회신 코드, 메일 인증 결과, 동의문 버전, 법정대리인 진술과 명시적 동의 양식을 모두 확인한 회신만 승인합니다. 자동 확인은 실제 가족관계나 법정대리인 신원을 인증하는 절차가 아닙니다. 인용문·거절·불명확한 회신은 승인하지 않고 보류합니다. 수동 처리와 예외 검토에서는 운영자가 회신 내용과 법정대리인 여부·동의 범위를 별도로 확인합니다.`;
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
  // 기존 신청과 증빙은 유지하고 자동 처리에 필요한 열만 추가합니다.
  const columns = new Set(db.prepare('PRAGMA table_info(guardian_requests)').all().map(row => row.name));
  for (const [name, definition] of Object.entries({ replyNonceHash: 'TEXT', consentMethod: "TEXT NOT NULL DEFAULT 'email-reply-review'", reviewStatus: 'TEXT', reviewReason: 'TEXT' })) {
    if (!columns.has(name)) db.exec(`ALTER TABLE guardian_requests ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS guardian_mail_events (
    emailIdHash TEXT PRIMARY KEY, eventIdHash TEXT NOT NULL UNIQUE,
    requestId TEXT REFERENCES guardian_requests(id),
    status TEXT NOT NULL CHECK(status IN ('processing','approved','held','ignored')),
    reason TEXT, createdAt INTEGER NOT NULL,
    leaseToken TEXT, leaseUntil INTEGER
  );`);
}
export function expireGuardianRequests(db, now = Date.now()) {
  db.prepare("UPDATE guardian_requests SET status='expired',guardianName=NULL,guardianEmail=NULL,claim=NULL,replyNonceHash=NULL,reviewStatus=NULL,reviewReason=NULL WHERE status IN ('pending','approved','rejected') AND expiresAt<=?").run(now);
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
    db.prepare("UPDATE guardian_requests SET status='withdrawn',claim=NULL,replyNonceHash=NULL,reviewStatus=NULL,reviewReason=NULL WHERE id=?").run(id);
    if (row.childUserId) db.prepare('DELETE FROM session WHERE userId=?').run(row.childUserId);
    auditGuardian(db, id, 'withdrawn', now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function createGuardianService(db, { origin, production, mailer, replyTo, mode = 'email-reply-review', autoReady = false, now = Date.now }) {
  initializeGuardian(db);
  // 이전 실행이 회원 생성 전에 종료된 경우에만 다시 신청할 수 있게 합니다.
  db.prepare("UPDATE guardian_requests SET status='approved',claim=NULL WHERE status='creating' AND childUserId IS NULL").run();
  if (replyTo) replyTo = guardianEmail(replyTo);
  const automatic = mode === 'email-reply-auto';
  const enabled = Boolean(mailer && replyTo && (automatic ? autoReady : mode === 'email-reply-review'));
  const reviewMessages = {
    reply_format: '회신을 자동 확인하지 못했습니다. 안내 메일의 7줄 양식만 새 본문에 남기고 인용문·서명·첨부를 지운 뒤 같은 보호자 이메일로 다시 회신해 주세요.',
    email_authentication: '회신 메일의 발신 인증을 확인하지 못했습니다. 같은 보호자 이메일에서 다시 보내거나 support@gracekingames.com으로 문의해 주세요.',
    sender_or_recipient: '회신 주소를 확인하지 못했습니다. 신청한 보호자 이메일에서 안내 메일의 회신 주소로 다시 보내 주세요.',
    request_mismatch: '회신의 신청 번호·확인 코드·동의문 버전을 확인하지 못했습니다. 이 신청의 안내 메일을 확인해 주세요.',
    message_metadata: '전달·자동 회신이거나 수신 정보를 확인할 수 없는 메일입니다. 보호자가 직접 안내 양식으로 회신해 주세요.',
  };
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
      const id = randomUUID(), token = randomBytes(32).toString('base64url'), nonce = automatic ? randomBytes(32).toString('base64url') : null;
      db.prepare("INSERT INTO guardian_requests(id,capabilityHash,guardianName,guardianEmail,status,createdAt,expiresAt,consentVersion,consentText,replyNonceHash,consentMethod,reviewStatus) VALUES(?,?,?,?,'pending',?,?,?,?,?,?,?)").run(id, hash(token), name, email, now(), now() + WEEK, CONSENT_VERSION, CONSENT_TEXT, nonce ? hash(nonce) : null, mode, automatic ? 'awaiting-reply' : null);
      const instruction = automatic
        ? `동의하시는 법정대리인은 아래 7줄 양식만 복사하여 새 회신 본문에 남겨 주세요. 자동으로 붙는 이전 메일 인용문·서명·첨부는 모두 지워 주세요. 안내 메일 전체를 돌려보내거나 링크만 여는 것으로는 동의가 처리되지 않습니다. 회신 확인 코드는 다른 사람에게 공유하지 마세요.\n\n${automaticReplyText(id, nonce)}\n\n검증이 끝나면 신청한 브라우저의 동의 상태가 승인으로 바뀝니다. 양식이나 메일 인증을 확인하지 못하면 보류되며 다시 회신하거나 support@gracekingames.com으로 문의할 수 있습니다.`
        : '동의하시면 위 회신 문구와 신청 번호를 포함해 이 메일에 회신해 주세요. 운영자가 회신을 확인한 뒤 승인합니다.';
      try { await mailer({ to: email, replyTo, subject: `[그레이스킨게임즈] 보호자 동의 신청 ${id}`, text: `${CONSENT_TEXT}\n\n동의문 버전: ${CONSENT_VERSION}\n신청 번호: ${id}\n신청 기한: ${new Date(now() + WEEK).toISOString()}\n\n${instruction}\n\n다른 사람이 신청했다면 동의하지 말고 무시해 주세요. 승인 후 신청한 브라우저에서 이어서 가입할 수 있습니다.\n\n가입 화면: ${origin}/account/?view=guardian` }); }
      catch {
        db.prepare('DELETE FROM guardian_requests WHERE id=?').run(id);
        fail(503, 'EMAIL_DELIVERY_FAILED', '메일을 보내지 못했습니다. 잠시 후 다시 신청해 주세요.');
      }
      auditGuardian(db, id, 'requested', now());
      return json({ status: true }, 200, { 'set-cookie': `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${WEEK / 1000}${production ? '; Secure' : ''}` });
    }
    if (url.pathname === '/api/account/guardian-request' && request.method === 'GET') {
      const row = current(request);
      return json({ request: row ? { status: row.status === 'creating' ? 'approved' : row.status, expiresAt: new Date(row.expiresAt).toISOString(), requestNumber: row.id, reviewStatus: ['approved','creating','used'].includes(row.status) ? 'approved' : row.status === 'pending' ? row.reviewStatus : null, reviewReason: row.status === 'pending' ? row.reviewReason : null, reviewMessage: row.status === 'pending' ? reviewMessages[row.reviewReason] || null : null } : null });
    }
    if (url.pathname === '/api/account/guardian-request/cancel' && request.method === 'POST') {
      await readJson(request);
      const row = current(request);
      if (row) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = db.prepare("UPDATE guardian_requests SET status='withdrawn',claim=NULL,replyNonceHash=NULL,reviewStatus=NULL,reviewReason=NULL WHERE id=? AND status IN ('pending','approved')").run(row.id);
          if (result.changes !== 1) fail(409, 'GUARDIAN_CANNOT_CANCEL', '가입이 진행되었거나 완료된 신청은 보호자가 운영자에게 문의해 주세요.');
          auditGuardian(db, row.id, 'cancelled', now());
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      return json({ status: true });
    }
    return null;
  }
  return { enabled, method: enabled ? mode : null, claim, release, handle, hasCurrent: request => { const row = current(request); return Boolean(row && ['pending','approved','creating'].includes(row.status)); } };
}
