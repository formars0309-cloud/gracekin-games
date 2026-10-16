import { createHash, randomUUID } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { readFile, mkdir, chmod, writeFile, unlink, readdir, lstat, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { auditGuardian, expireGuardianRequests, withdrawGuardian } from './guardian.js';

export async function evidenceDirectory(dataDir, create = false) {
  const directory = join(dataDir, 'guardian-evidence');
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) return null;
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== resolve(await realpath(dataDir), 'guardian-evidence')) throw new Error('동의 자료 폴더 경로를 확인해 주세요.');
  if (create) await chmod(directory, 0o700);
  return directory;
}
function maskEmail(email) { if (!email) return null; const [name, domain] = email.split('@'); return `${name.slice(0, 1)}***@${domain}`; }
export function listGuardianRequests(db) {
  expireGuardianRequests(db);
  return db.prepare('SELECT id,status,guardianEmail,createdAt,expiresAt,consentMethod,reviewStatus,reviewReason FROM guardian_requests ORDER BY createdAt DESC LIMIT 100').all().map(row => ({ requestNumber: row.id, status: row.status, guardianEmail: maskEmail(row.guardianEmail), consentMethod: row.consentMethod, reviewStatus: row.reviewStatus, reviewReason: row.reviewReason, createdAt: new Date(row.createdAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString() }));
}
// 헤더 일치는 보조 검사입니다. 법정대리인 여부와 회신 의사는 운영자가 원문을 보고 확인합니다.
function replySender(parsed) {
  const fromHeaders = parsed.headerLines.filter(header => header.key === 'from');
  const addresses = parsed.from?.value;
  if (fromHeaders.length !== 1 || !addresses || addresses.length !== 1 || typeof addresses[0].address !== 'string') throw new Error('회신의 단일 발신자 정보를 확인해 주세요.');
  return addresses[0].address.toLowerCase();
}
export async function approveGuardianRequest(db, { id, evidencePath, dataDir, confirmReply, confirmGuardian, confirmScope, now = Date.now() }) {
  if (confirmReply !== true || confirmGuardian !== true || confirmScope !== true) throw new Error('회신의 동의 의사·법정대리인 여부·동의 범위를 모두 직접 검토해야 합니다.');
  expireGuardianRequests(db, now);
  const row = db.prepare('SELECT * FROM guardian_requests WHERE id=?').get(id);
  if (!row || row.status !== 'pending' || row.expiresAt <= now) throw new Error('승인할 수 있는 대기 신청이 아닙니다.');
  const evidence = await readFile(evidencePath);
  if (evidence.length < 20 || evidence.length > 2 * 1024 * 1024) throw new Error('회신 원문 파일 크기를 확인해 주세요.');
  // MIME 제목·주소·본문만 해석합니다. 첨부를 열거나 HTML을 표시·실행하지 않습니다.
  const parsed = await simpleParser(evidence, { skipTextToHtml: true, skipTextLinks: true, skipImageLinks: true, maxHtmlLengthToParse: 2 * 1024 * 1024 });
  if (replySender(parsed) !== row.guardianEmail) throw new Error('회신 발신자가 신청 보호자 이메일과 다릅니다.');
  if (!`${parsed.subject || ''}\n${parsed.text || ''}`.includes(id)) throw new Error('회신 원문에서 신청 번호를 확인해 주세요.');
  const digest = createHash('sha256').update(evidence).digest('hex');
  const directory = await evidenceDirectory(dataDir, true);
  const filename = `${randomUUID()}.eml`, target = join(directory, filename);
  await writeFile(target, evidence, { flag: 'wx', mode: 0o600 });
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare("UPDATE guardian_requests SET status='approved',reviewedAt=?,reviewStatus='approved',reviewReason=NULL WHERE id=? AND status='pending' AND expiresAt>?").run(now, id, now);
    if (result.changes !== 1) throw new Error('검토 중 신청 상태가 변경되었습니다.');
    auditGuardian(db, id, 'approved', now, digest, filename);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); await unlink(target); throw error; }
}
export function rejectGuardianRequest(db, id, now = Date.now()) {
  const result = db.prepare("UPDATE guardian_requests SET status='rejected',reviewedAt=? WHERE id=? AND status IN ('pending','approved')").run(now, id);
  if (result.changes !== 1) throw new Error('거절할 수 있는 신청이 아닙니다.');
  auditGuardian(db, id, 'rejected', now);
}
export async function cleanupGuardianEvidence(db, dataDir, now = Date.now()) {
  const directory = await evidenceDirectory(dataDir);
  expireGuardianRequests(db, now);
  db.prepare("UPDATE guardian_requests SET status='withdrawn' WHERE status='used' AND childUserId IS NULL").run();
  const rows = db.prepare("SELECT a.id,a.evidenceFile FROM guardian_audit a JOIN guardian_requests r ON r.id=a.requestId WHERE r.status IN ('expired','withdrawn') AND r.childUserId IS NULL AND a.evidenceFile IS NOT NULL").all();
  for (const row of rows) {
    // DB 값이 조작되어도 동의 자료 폴더 밖 파일은 지우지 않습니다.
    if (basename(row.evidenceFile) !== row.evidenceFile) throw new Error('동의 자료 파일 경로를 확인해 주세요.');
    if (directory) await unlink(join(directory, row.evidenceFile)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    db.prepare('UPDATE guardian_audit SET evidenceFile=NULL,evidenceHash=NULL WHERE id=?').run(row.id);
  }
  db.prepare("DELETE FROM guardian_mail_events WHERE requestId IN (SELECT id FROM guardian_requests WHERE status IN ('expired','withdrawn') AND childUserId IS NULL) OR (requestId IS NULL AND createdAt<=?)").run(now - 7 * 24 * 60 * 60 * 1000);
  db.prepare("UPDATE guardian_requests SET guardianName=NULL,guardianEmail=NULL,replyNonceHash=NULL,reviewStatus=NULL,reviewReason=NULL WHERE status IN ('expired','withdrawn') AND childUserId IS NULL").run();
  // 원문 저장과 DB 기록 사이 중단으로 남은 파일만 하루 유예 후 정리합니다.
  // 일반 UUID 이름의 .eml·.json만 관리하며 다른 이름·하위폴더·심볼릭 링크는 건드리지 않습니다.
  let orphans = 0;
  if (directory) {
    const referenced = new Set(db.prepare('SELECT evidenceFile FROM guardian_audit WHERE evidenceFile IS NOT NULL').all().map(row => row.evidenceFile));
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:eml|json)$/.test(entry.name) || referenced.has(entry.name)) continue;
      const file = join(directory, entry.name);
      const info = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info?.isFile() && now - info.mtimeMs >= 24 * 60 * 60 * 1000) { await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; }); orphans++; }
    }
  }
  return rows.length + orphans;
}
export { withdrawGuardian };

export async function deleteGuardianChild(db, { id, dataDir, confirmParentRequest, confirmDeletion, now = Date.now() }) {
  if (confirmParentRequest !== true || confirmDeletion !== true) throw new Error('보호자 삭제 요청과 삭제 대상을 직접 확인해야 합니다.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare("SELECT r.childUserId,u.ageBand FROM guardian_requests r JOIN user u ON u.id=r.childUserId WHERE r.id=? AND r.status IN ('used','withdrawn')").get(id);
    if (!row || row.ageBand !== 'under14') throw new Error('삭제할 어린이 계정을 찾을 수 없습니다.');
    db.prepare("UPDATE guardian_requests SET status='withdrawn',claim=NULL,reservedUserId=NULL WHERE id=?").run(id);
    db.prepare('DELETE FROM user WHERE id=?').run(row.childUserId);
    auditGuardian(db, id, 'child-deleted', now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  await cleanupGuardianEvidence(db, dataDir);
}
