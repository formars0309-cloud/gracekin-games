import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat, utimes, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { tokenHash } from '../server/account.js';
import { approveGuardianRequest, rejectGuardianRequest, withdrawGuardian, cleanupGuardianEvidence, listGuardianRequests, deleteGuardianChild } from '../server/guardian-review.js';
import { request, cookieFrom, tokenFrom, registerAndLogin } from './account-helpers.js';

const password = '테스트전용-공통회원-1234';
async function scenario(callback, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-account-'));
  const mailbox = [];
  let app;
  try {
    app = await startServer({ port: 0, dataDir: folder, mailer: async message => mailbox.push(message), guardianReplyTo: 'support@example.test', rateLimit: { authMax: 150 }, ...options });
    const db = new DatabaseSync(join(folder, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON;');
    try { await callback({ app, db, folder, mailbox }); } finally { db.close(); }
  } finally { await app?.close(); await rm(folder, { recursive: true, force: true }); }
}
const post = (app, path, body, cookie) => request(app, path, { method: 'POST', body, cookie });
const adult = email => ({ name: '확인회원', email, password, ageBand: '14plus' });
async function guardianRequest(app, email = 'guardian@example.test') {
  const response = await post(app, '/api/account/guardian-requests', { guardianName: '보호자확인', guardianEmail: email });
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  const state = (await request(app, '/api/account/guardian-request', { cookie })).body.request;
  return { cookie, id: state.requestNumber };
}
async function approve(db, folder, id, email = 'guardian@example.test') {
  const evidencePath = join(folder, 'reply.eml');
  await writeFile(evidencePath, `From: 보호자 <${email}>\r\nSubject: 동의 회신 ${id}\r\n\r\n본인은 법정대리인으로서 안내된 개인정보 처리와 가입에 동의합니다. 신청 번호 ${id}`, { mode: 0o600 });
  await approveGuardianRequest(db, { id, dataDir: folder, evidencePath, confirmReply: true, confirmGuardian: true, confirmScope: true });
}

test('새 성인 계정은 메일 확인 전 로그인 불가·임의 권한 필드 차단', async () => scenario(async ({ app, db, mailbox }) => {
  const config = (await request(app, '/api/account/config')).body;
  assert.equal(config.registrationAvailable, true); assert.equal(config.guardianConsentMethod, 'email-reply-review');
  for (const extra of [{ ageConfirmed: true }, { emailVerified: true }, { guardianConsentId: '위조' }, { ageBand: 'legacy' }, { birthday: '2020-01-01' }]) {
    const rejected = await post(app, '/api/auth/sign-up/email', { ...adult('injection@example.test'), ...extra });
    assert.ok(rejected.status >= 400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0);
  const signup = await post(app, '/api/auth/sign-up/email', adult('new@example.test'));
  assert.deepEqual(signup.body, { status: true }); assert.equal(signup.headers['set-cookie'], undefined);
  assert.equal((await post(app, '/api/auth/sign-in/email', { email: 'new@example.test', password: '잘못된 비밀번호' })).status, 401);
  const blocked = await post(app, '/api/auth/sign-in/email', { email: 'new@example.test', password });
  assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'EMAIL_NOT_VERIFIED');
  const token = tokenFrom(mailbox[0]);
  assert.equal(db.prepare('SELECT tokenHash FROM account_email_tokens').get().tokenHash, tokenHash(token));
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM account_email_tokens').all()), new RegExp(token));
  assert.equal((await request(app, `/api/auth/verify-email?token=${token}`)).status, 404);
  assert.equal((await post(app, '/api/account/verify-email', { token })).status, 200);
  assert.equal((await post(app, '/api/account/verify-email', { token })).status, 400);
  const login = await post(app, '/api/auth/sign-in/email', { email: 'new@example.test', password });
  const own = await request(app, '/api/account/session', { cookie: cookieFrom(login) });
  assert.equal(own.body.user.emailVerified, true); assert.equal(own.body.user.ageBand, '14plus'); assert.equal(own.body.user.canWriteCommunity, true);
  assert.deepEqual((await request(app, '/api/account/session')).body, { user: null });
  assert.equal(own.headers['cache-control'], 'no-store'); assert.equal(own.headers['referrer-policy'], 'no-referrer');
}));

test('인증메일 재발송은 이전 링크 폐기·만료 거부·외부 callback 차단', async () => scenario(async ({ app, db, mailbox }) => {
  await post(app, '/api/auth/sign-up/email', { ...adult('resend@example.test'), callbackURL: 'https://outside.example/steal' });
  const old = tokenFrom(mailbox.at(-1));
  const resend = await post(app, '/api/auth/send-verification-email', { email: 'resend@example.test', callbackURL: 'https://outside.example/steal' });
  assert.equal(resend.status, 200);
  const current = tokenFrom(mailbox.at(-1)); assert.notEqual(old, current);
  assert.doesNotMatch(mailbox.at(-1).text, /outside\.example/);
  assert.equal((await post(app, '/api/account/verify-email', { token: old })).status, 400);
  db.prepare('UPDATE account_email_tokens SET expiresAt=0').run();
  assert.equal((await post(app, '/api/account/verify-email', { token: current })).status, 400);
  const unknown = await post(app, '/api/auth/send-verification-email', { email: 'absent@example.test' });
  assert.deepEqual(unknown.body, resend.body);
}));

test('비밀번호 복구 토큰 해시·일회성·만료·모든 기존 세션 철회', async () => scenario(async ({ app, db, mailbox }) => {
  const login = await registerAndLogin(app, mailbox, adult('reset@example.test'));
  const cookie = cookieFrom(login);
  const reset = await post(app, '/api/auth/request-password-reset', { email: 'reset@example.test', redirectTo: 'https://outside.example/steal' });
  const unknown = await post(app, '/api/auth/request-password-reset', { email: 'absent@example.test' });
  assert.deepEqual(reset.body, unknown.body);
  const token = tokenFrom(mailbox.at(-1));
  assert.doesNotMatch(mailbox.at(-1).text, /outside\.example/);
  assert.ok(db.prepare('SELECT identifier FROM verification').all().every(row => !row.identifier.includes(token)));
  assert.equal((await post(app, '/api/auth/reset-password', { token, newPassword: '짧음' })).status, 400);
  const changed = '테스트전용-변경비밀번호-5678';
  assert.equal((await post(app, '/api/auth/reset-password', { token, newPassword: changed })).status, 200);
  assert.equal((await post(app, '/api/auth/reset-password', { token, newPassword: password })).status, 400);
  assert.deepEqual((await request(app, '/api/account/session', { cookie })).body, { user: null });
  assert.equal((await post(app, '/api/auth/sign-in/email', { email: 'reset@example.test', password })).status, 401);
  assert.equal((await post(app, '/api/auth/sign-in/email', { email: 'reset@example.test', password: changed })).status, 200);
  await post(app, '/api/auth/request-password-reset', { email: 'reset@example.test' });
  const expired = tokenFrom(mailbox.at(-1)); db.prepare('UPDATE verification SET expiresAt=0').run();
  assert.equal((await post(app, '/api/auth/reset-password', { token: expired, newPassword: password })).status, 400);
}));

test('기존 미확인 회원의 ID·게시글·로그인 유지, 메일 없으면 신규가입은 차단', async () => scenario(async ({ app, db, mailbox }) => {
  const login = await registerAndLogin(app, mailbox, adult('legacy@example.test'));
  const cookie = cookieFrom(login), id = login.body.user.id;
  const created = await post(app, '/api/community/posts', { game: 'slimeline', board: 'free', title: '기존 회원 글', body: '유지 확인' }, cookie);
  db.prepare('UPDATE user SET ageBand=NULL,emailVerified=0 WHERE id=?').run(id);
  const relogin = await post(app, '/api/auth/sign-in/email', { email: 'legacy@example.test', password });
  assert.equal(relogin.status, 200); assert.equal(relogin.body.user.id, id);
  const session = await request(app, '/api/account/session', { cookie: cookieFrom(relogin) });
  assert.equal(session.body.user.ageBand, 'legacy'); assert.equal(session.body.user.emailVerified, false);
  assert.equal((await request(app, `/api/community/posts/${created.body.post.id}?game=slimeline`, { cookie })).status, 200);
}));

test('발신 설정 없거나 전송 실패 때 신규가입·보호자신청을 성공으로 표시하지 않음', async () => {
  await scenario(async ({ app, db }) => {
    assert.equal((await request(app, '/api/account/config')).body.registrationAvailable, false);
    for (const path of ['/api/auth/sign-up/email', '/api/auth/request-password-reset', '/api/auth/send-verification-email']) assert.equal((await post(app, path, adult('nomail@example.test'))).status, 503);
    assert.equal((await post(app, '/api/account/guardian-requests', { guardianName: '확인보호자', guardianEmail: 'guardian@example.test' })).status, 503);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0);
  }, { mailer: null });
  await scenario(async ({ app, db }) => {
    assert.equal((await post(app, '/api/auth/sign-up/email', adult('failure@example.test'))).status, 503);
    assert.equal((await post(app, '/api/account/guardian-requests', { guardianName: '확인보호자', guardianEmail: 'guardian@example.test' })).status, 503);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guardian_requests').get().n, 0);
  }, { mailer: async () => { throw new Error('시험용 전송 실패'); } });
});

test('보호자 승인 전 어린이 정보 미보관·직접가입과 성인 우회·다른 브라우저 차단', async () => scenario(async ({ app, db, mailbox }) => {
  const child = { ...adult('child@example.test'), ageBand: 'under14' };
  assert.equal((await post(app, '/api/auth/sign-up/email', child)).status, 403);
  assert.equal((await post(app, '/api/account/guardian-requests', { guardianName: '보호자확인', guardianEmail: 'guardian@example.test', childEmail: child.email })).status, 422);
  const { cookie, id } = await guardianRequest(app);
  const headers = (await post(app, '/api/account/guardian-requests', { guardianName: '보호자확인', guardianEmail: 'another@example.test' })).headers;
  assert.match(headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0);
  assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(id).status, 'pending');
  assert.match(mailbox[0].text, /법정대리인/); assert.match(mailbox[0].text, /회신/); assert.equal(mailbox[0].replyTo, 'support@example.test');
  assert.equal((await post(app, '/api/auth/sign-up/email', child, cookie)).status, 403);
  assert.equal((await post(app, '/api/auth/sign-up/email', adult('bypass@example.test'), cookie)).status, 403);
  assert.equal((await post(app, '/api/auth/sign-up/email', { ...child, ageConfirmed: true }, cookie)).status, 422);
  assert.deepEqual((await request(app, '/api/account/guardian-request')).body, { request: null });
  const state = await request(app, '/api/account/guardian-request', { cookie });
  assert.doesNotMatch(JSON.stringify(state.body), /guardianEmail|guardianName|capability|token/i);
}));

test('회신 원문·운영자 확인 후 한 번 가입, 실패시 재시도, 어린이 쓰기 차단, 동의 철회', async () => scenario(async ({ app, db, folder, mailbox }) => {
  const { cookie, id } = await guardianRequest(app);
  await assert.rejects(approveGuardianRequest(db, { id, dataDir: folder, evidencePath: '/없는파일' }), /직접 검토/);
  const wrong = join(folder, 'wrong.eml'); await writeFile(wrong, `From: wrong@example.test\n\n동의 ${id}`);
  await assert.rejects(approveGuardianRequest(db, { id, dataDir: folder, evidencePath: wrong, confirmReply: true, confirmGuardian: true, confirmScope: true }), /다릅니다/);
  await approve(db, folder, id);
  const audit = db.prepare("SELECT * FROM guardian_audit WHERE action='approved'").get();
  assert.equal(audit.evidenceHash.length, 64); assert.equal((await stat(join(folder, 'guardian-evidence', audit.evidenceFile))).mode & 0o777, 0o600);
  assert.equal((await stat(join(folder, 'guardian-evidence'))).mode & 0o777, 0o700);
  assert.match(listGuardianRequests(db)[0].guardianEmail, /\*\*\*/);
  const child = { ...adult('child@example.test'), ageBand: 'under14' };
  assert.equal((await post(app, '/api/auth/sign-up/email', child)).status, 403);
  assert.equal((await post(app, '/api/auth/sign-up/email', { ...child, password: '짧음' }, cookie)).status, 400);
  assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(id).status, 'approved');
  const results = await Promise.all([post(app, '/api/auth/sign-up/email', child, cookie), post(app, '/api/auth/sign-up/email', { ...child, email: 'second-child@example.test' }, cookie)]);
  assert.equal(results.filter(row => row.status === 200).length, 1);
  const user = db.prepare("SELECT * FROM user WHERE ageBand='under14'").get(); assert.ok(user);
  assert.equal((await post(app, '/api/auth/sign-up/email', adult('parent-after-child@example.test'), cookie)).status, 200);
  assert.equal(db.prepare('SELECT ageBand FROM user WHERE id=?').get(user.id).ageBand, 'under14');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user WHERE ageBand='under14'").get().n, 1);
  assert.equal(db.prepare('SELECT childUserId FROM guardian_requests WHERE id=?').get(id).childUserId, user.id);
  assert.equal((await post(app, '/api/auth/sign-up/email', { ...child, email: 'third@example.test' }, cookie)).status, 403);
  await post(app, '/api/account/verify-email', { token: tokenFrom(mailbox.findLast(item => item.to === user.email)) });
  const login = await post(app, '/api/auth/sign-in/email', { email: user.email, password }); assert.equal(login.status, 200);
  const childCookie = cookieFrom(login);
  const state = await request(app, '/api/account/session', { cookie: childCookie }); assert.equal(state.body.user.canWriteCommunity, false);
  assert.equal((await request(app, '/api/community/session', { cookie: childCookie })).body.user.canWriteCommunity, false);
  assert.equal((await post(app, '/api/community/posts', { game: 'slimeline', board: 'free', title: '글쓰기 우회', body: '차단' }, childCookie)).status, 403);
  assert.equal((await post(app, '/api/account/guardian-request/cancel', {}, cookie)).status, 409);
  assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(id).status, 'used');
  const savedSession = db.prepare('SELECT * FROM session WHERE userId=?').get(user.id);
  // 세션 행이 남는 비정상 상태에서도 계정·커뮤니티 조회는 철회 상태를 직접 확인합니다.
  db.prepare("UPDATE guardian_requests SET status='withdrawn' WHERE id=?").run(id);
  assert.deepEqual((await request(app, '/api/account/session', { cookie: childCookie })).body, { user: null });
  assert.deepEqual((await request(app, '/api/community/session', { cookie: childCookie })).body, { user: null });
  db.prepare("UPDATE guardian_requests SET status='used' WHERE id=?").run(id);
  withdrawGuardian(db, id);
  const columns = Object.keys(savedSession);
  assert.throws(() => db.prepare(`INSERT INTO session(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(column => savedSession[column])), /보호자/);
  assert.deepEqual((await request(app, '/api/account/session', { cookie: childCookie })).body, { user: null });
  assert.equal((await post(app, '/api/auth/sign-in/email', { email: user.email, password })).status, 403);
  assert.equal((await post(app, '/api/auth/sign-up/email', { ...child, email: 'withdrawn@example.test' }, cookie)).status, 403);
}));

test('거절·취소·만료 상태, 만료 동의 원문 정리와 어린이 회원 삭제 후 정리', async () => scenario(async ({ app, db, folder }) => {
  const rejected = await guardianRequest(app, 'reject@example.test'); rejectGuardianRequest(db, rejected.id);
  assert.equal((await request(app, '/api/account/guardian-request', { cookie: rejected.cookie })).body.request.status, 'rejected');
  const cancelled = await guardianRequest(app, 'cancel@example.test');
  assert.equal((await post(app, '/api/account/guardian-request/cancel', {}, cancelled.cookie)).status, 200);
  await cleanupGuardianEvidence(db, folder);
  assert.equal(db.prepare('SELECT guardianEmail FROM guardian_requests WHERE id=?').get(cancelled.id).guardianEmail, null);
  const expired = await guardianRequest(app, 'expire@example.test'); await approve(db, folder, expired.id, 'expire@example.test');
  const evidence = db.prepare("SELECT evidenceFile FROM guardian_audit WHERE requestId=? AND action='approved'").get(expired.id).evidenceFile;
  db.prepare('UPDATE guardian_requests SET expiresAt=0 WHERE id=?').run(expired.id);
  assert.equal((await request(app, '/api/account/guardian-request', { cookie: expired.cookie })).body.request.status, 'expired');
  assert.equal((await post(app, '/api/auth/sign-up/email', { ...adult('expired-child@example.test'), ageBand: 'under14' }, expired.cookie)).status, 403);
  await cleanupGuardianEvidence(db, folder);
  await assert.rejects(readFile(join(folder, 'guardian-evidence', evidence)), { code: 'ENOENT' });
  assert.equal(db.prepare('SELECT guardianName,guardianEmail FROM guardian_requests WHERE id=?').get(expired.id).guardianName, null);
  const used = await guardianRequest(app, 'delete@example.test'); await approve(db, folder, used.id, 'delete@example.test');
  assert.equal((await post(app, '/api/auth/sign-up/email', { ...adult('delete-child@example.test'), ageBand: 'under14' }, used.cookie)).status, 200);
  await assert.rejects(deleteGuardianChild(db, { id: used.id, dataDir: folder }), /직접 확인/);
  await deleteGuardianChild(db, { id: used.id, dataDir: folder, confirmParentRequest: true, confirmDeletion: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user WHERE email='delete-child@example.test'").get().n, 0);
  assert.equal(db.prepare('SELECT guardianEmail FROM guardian_requests WHERE id=?').get(used.id).guardianEmail, null);
}));

test('보호자·인증 API도 Origin·Host·JSON·속도 제한과 내부 경로 차단 적용', async () => scenario(async ({ app }) => {
  for (const path of ['/api/account/guardian-requests', '/api/account/guardian-request/cancel', '/api/account/verify-email']) {
    assert.equal((await request(app, path, { method: 'POST', body: {}, origin: 'https://outside.example' })).status, 403);
    assert.equal((await request(app, path, { method: 'POST', body: {}, headers: { 'content-type': 'text/plain' } })).status, 415);
  }
  assert.equal((await request(app, '/api/account/config', { headers: { host: 'outside.example' } })).status, 403);
  for (const path of ['/api/account/guardian-requests/approve', '/api/auth/update-user', '/api/auth/get-session', '/api/auth/reset-password/arbitrary']) assert.equal((await post(app, path, {})).status, 404);
}));

test('회원 생성과 동의 소모는 원자적이며 중단된 예약만 재시작 때 복구', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-recovery-'));
  let app;
  const mailbox = [];
  try {
    const options = { port: 0, dataDir: folder, mailer: async message => mailbox.push(message), guardianReplyTo: 'support@example.test', rateLimit: { authMax: 100 } };
    app = await startServer(options);
    const { cookie, id } = await guardianRequest(app);
    let db = new DatabaseSync(join(folder, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON;');
    await approve(db, folder, id);
    // 비밀번호 해시 도중 종료되어 사용자 INSERT가 전혀 실행되지 않은 상태입니다.
    db.prepare("UPDATE guardian_requests SET status='creating',claim='중단예약',reservedUserId='reserved-child' WHERE id=?").run(id);
    db.close(); await app.close(); app = await startServer(options);
    db = new DatabaseSync(join(folder, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON;');
    assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(id).status, 'approved');
    // 승인 철회와 만료가 INSERT보다 앞서면 트리거가 사용자 행 자체를 거부합니다.
    const insert = db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,ageBand) VALUES(?,?,?,0,?,?,?)');
    db.prepare("UPDATE guardian_requests SET status='creating',claim='예약',reservedUserId='reserved-child',expiresAt=0 WHERE id=?").run(id);
    assert.throws(() => insert.run('reserved-child', '어린이확인', 'atomic@example.test', Date.now(), Date.now(), 'under14'), /보호자/);
    db.prepare("UPDATE guardian_requests SET status='withdrawn',expiresAt=? WHERE id=?").run(Date.now() + 60000, id);
    assert.throws(() => insert.run('reserved-child', '어린이확인', 'atomic@example.test', Date.now(), Date.now(), 'under14'), /보호자/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user WHERE id='reserved-child'").get().n, 0);
    // INSERT가 커밋된 경우에는 재시작해도 동의가 다시 approved로 열리지 않습니다.
    db.prepare("UPDATE guardian_requests SET status='creating',claim='예약' WHERE id=?").run(id);
    insert.run('reserved-child', '어린이확인', 'atomic@example.test', Date.now(), Date.now(), 'under14');
    assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(id).status, 'used');
    db.close(); await app.close(); app = await startServer(options);
    const state = await request(app, '/api/account/guardian-request', { cookie });
    assert.equal(state.body.request.status, 'used');
    assert.equal((await post(app, '/api/auth/sign-up/email', { ...adult('reused@example.test'), ageBand: 'under14' }, cookie)).status, 403);
  } finally { await app?.close(); await rm(folder, { recursive: true, force: true }); }
});


test('미참조 동의 원문만 유예 후 정리하고 정상 증거·최근 파일·다른 파일·링크는 보존', async () => scenario(async ({ app, db, folder }) => {
  const { id } = await guardianRequest(app); await approve(db, folder, id);
  const evidence = db.prepare("SELECT evidenceFile FROM guardian_audit WHERE action='approved'").get().evidenceFile;
  const directory = join(folder, 'guardian-evidence');
  const orphan = join(directory, '11111111-1111-1111-1111-111111111111.eml');
  const recent = join(directory, '22222222-2222-2222-2222-222222222222.eml');
  const other = join(directory, '다른파일.eml');
  const linked = join(directory, '33333333-3333-3333-3333-333333333333.eml');
  for (const file of [orphan, recent, other]) await writeFile(file, '비공개 시험 자료', { mode: 0o600 });
  await symlink(other, linked);
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  for (const file of [orphan, other, join(directory, evidence)]) await utimes(file, old, old);
  assert.equal(await cleanupGuardianEvidence(db, folder), 1);
  await assert.rejects(readFile(orphan), { code: 'ENOENT' });
  for (const file of [recent, other, join(directory, evidence)]) assert.ok((await stat(file)).isFile());
  assert.ok((await lstat(linked)).isSymbolicLink());
}));


test('한글 MIME 제목·base64와 multipart quoted-printable 회신을 해석하고 원문은 보존', async () => scenario(async ({ app, db, folder }) => {
  for (const format of ['base64', 'multipart']) {
    const email = `${format}@example.test`, { id } = await guardianRequest(app, email);
    const subject = `=?UTF-8?B?${Buffer.from('보호자 동의 회신').toString('base64')}?=`;
    const sender = `=?UTF-8?B?${Buffer.from('보호자 확인').toString('base64')}?= <${email}>`;
    const body = `법정대리인으로서 동의합니다. 신청 번호 ${id}`;
    const encoded = Buffer.from(body).toString('base64');
    const quoted = [...Buffer.from(body)].map(byte => '=' + byte.toString(16).toUpperCase().padStart(2, '0')).join('');
    const content = format === 'base64'
      ? `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encoded}`
      : `Content-Type: multipart/alternative; boundary="reply-boundary"\r\n\r\n--reply-boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${quoted}\r\n--reply-boundary\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>원문 확인</p>\r\n--reply-boundary--`;
    const source = `From: ${sender}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\n${content}`;
    assert.equal(source.includes(id), false);
    const evidencePath = join(folder, `${format}.eml`); await writeFile(evidencePath, source, { mode: 0o600 });
    await approveGuardianRequest(db, { id, dataDir: folder, evidencePath, confirmReply: true, confirmGuardian: true, confirmScope: true });
    const saved = db.prepare("SELECT evidenceFile FROM guardian_audit WHERE requestId=? AND action='approved'").get(id).evidenceFile;
    assert.equal(await readFile(join(folder, 'guardian-evidence', saved), 'utf8'), source);
    assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(id).status, 'approved');
  }
}));
