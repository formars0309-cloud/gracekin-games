import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { approveGuardianRequest, cleanupGuardianEvidence, deleteGuardianChild, listGuardianRequests, rejectGuardianRequest, withdrawGuardian } from '../server/guardian-review.js';

// 로컬 운영 권한으로만 실행합니다. 이 명령을 공개 웹 API로 노출하지 않습니다.
const [command, id, ...args] = process.argv.slice(2);
const dataDir = resolve(process.env.DATA_DIR || '.data');
let db;
try {
  const target = join(dataDir, 'community.sqlite');
  await stat(target);
  db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (command === 'list') console.log(JSON.stringify(listGuardianRequests(db), null, 2));
  else if (command === 'approve') {
    const position = args.indexOf('--evidence');
    if (position < 0 || !args[position + 1]) throw new Error('회신 원문 .eml 파일이 필요합니다.');
    await approveGuardianRequest(db, { id, dataDir, evidencePath: resolve(args[position + 1]), confirmReply: args.includes('--confirm-reply'), confirmGuardian: args.includes('--confirm-guardian'), confirmScope: args.includes('--confirm-scope') });
    console.log('보호자 회신 검토와 승인을 기록했습니다.');
  } else if (command === 'reject') { rejectGuardianRequest(db, id); console.log('동의 신청을 거절했습니다.'); }
  else if (command === 'withdraw') { withdrawGuardian(db, id); await cleanupGuardianEvidence(db, dataDir); console.log('동의를 철회하고 연결된 어린이 계정의 세션을 해제했습니다.'); }
  else if (command === 'delete-child') { await deleteGuardianChild(db, { id, dataDir, confirmParentRequest: args.includes('--confirm-parent-request'), confirmDeletion: args.includes('--confirm-deletion') }); console.log('요청받은 어린이 계정과 관련 동의 자료를 삭제했습니다.'); }
  else if (command === 'cleanup') { const count = await cleanupGuardianEvidence(db, dataDir); console.log(`만료 신청과 동의 자료 ${count}건을 정리했습니다.`); }
  else throw new Error('사용법: guardian-review.mjs list | approve 신청번호 --evidence 회신.eml --confirm-reply --confirm-guardian --confirm-scope | reject 신청번호 | withdraw 신청번호 | delete-child 신청번호 --confirm-parent-request --confirm-deletion | cleanup');
} catch {
  // 오류 객체에 원문 경로나 개인정보가 들어 있을 수 있어 그대로 출력하지 않습니다.
  console.error('동의 관리 작업을 완료하지 못했습니다. 명령 인자·신청 상태·회신 검토·데이터 경로를 확인해 주세요.');
  process.exitCode = 1;
} finally { db?.close(); }
