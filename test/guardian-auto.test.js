import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, stat, writeFile, utimes, readdir, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Webhook } from 'svix';
import { startServer } from '../server/app.js';
import { CONSENT_VERSION, automaticReplyText } from '../server/guardian.js';
import { createAutomaticGuardianReview, GUARDIAN_WEBHOOK_PATH } from '../server/guardian-auto.js';
import { cleanupGuardianEvidence, withdrawGuardian, deleteGuardianChild } from '../server/guardian-review.js';
import { request, cookieFrom, tokenFrom } from './account-helpers.js';

const replyTo = 'guardian@inbound.example.test';
const password = '어린이회귀검증-1234';
const hash = value => createHash('sha256').update(value).digest('hex');
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const post = (app, path, body, cookie) => request(app, path, { method: 'POST', body, cookie });

async function scenario(callback, overrides = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-auto-'));
  const secret = `whsec_${randomBytes(32).toString('base64')}`, verifier = new Webhook(secret), mailbox = [], inbox = new Map(), calls = [];
  const options = { port: 0, dataDir: folder, guardianReplyTo: replyTo, guardianConsentMode: 'email-reply-auto', guardianAutoApprovalReady: true,
    resendReceivingApiKey: 're_test_internal_only', resendWebhookSecret: secret, mailer: async mail => mailbox.push(mail),
    rateLimit: { authMax: 1000, writeMax: 1000 },
    guardianReceivingFetch: async (url, init) => { calls.push({ url, redirect: init.redirect, signal: init.signal }); return response(inbox.get(url.match(/receiving\/([^?]+)/)[1])); }, ...overrides };
  let app, db;
  try {
    app = await startServer(options);
    db = new DatabaseSync(join(folder, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    async function apply(email = `guardian-${randomUUID()}@example.test`) {
      const created = await post(app, '/api/account/guardian-requests', { guardianName: '보호자시험', guardianEmail: email });
      assert.equal(created.status, 200);
      const cookie = cookieFrom(created), state = (await request(app, '/api/account/guardian-request', { cookie })).body.request;
      const nonce = mailbox.at(-1).text.match(/^회신 확인 코드: ([A-Za-z0-9_-]{43})$/m)?.[1];
      assert.ok(nonce);
      return { id: state.requestNumber, cookie, email, nonce };
    }
    function received(application, changes = {}) {
      const id = randomUUID(), time = new Date().toISOString();
      const email = { id, from: application.email, to: [replyTo], cc: [], bcc: [], subject: `Re: 보호자 동의 신청 ${application.id}`, text: automaticReplyText(application.id, application.nonce),
        created_at: time, message_id: `<${id}@example.test>`, headers: { from: `보호자 <${application.email}>`, 'authentication-results': '이 헤더는 검증 근거가 아님' },
        authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' }, attachments: [], ...changes };
      inbox.set(id, email);
      return { type: 'email.received', created_at: email.created_at, data: { email_id: id, from: email.from, to: email.to, cc: email.cc, bcc: email.bcc, subject: email.subject, created_at: email.created_at, message_id: email.message_id, attachments: email.attachments } };
    }
    async function webhook(event, { eventId = `msg_${randomUUID()}`, time = new Date(), headers = {}, path = GUARDIAN_WEBHOOK_PATH, body = event, targetApp = app } = {}) {
      const payload = JSON.stringify(event);
      return request(targetApp, path, { method: 'POST', body, headers: { origin: '', 'svix-id': eventId, 'svix-timestamp': String(Math.floor(time.getTime() / 1000)), 'svix-signature': verifier.sign(eventId, time, payload), ...headers } });
    }
    await callback({ app, db, folder, mailbox, inbox, calls, apply, received, webhook, options });
  } finally { db?.close(); await app?.close(); await rm(folder, { recursive: true, force: true }); }
}

test('서명·공급자 인증·정확한 회신으로 자동 승인하고 한 어린이만 읽기 전용 가입', async () => scenario(async ({ app, db, folder, mailbox, calls, apply, received, webhook }) => {
  assert.equal((await request(app, '/api/account/config')).body.guardianConsentMethod, 'email-reply-auto');
  const application = await apply(), original = mailbox.at(-1).text;
  const initial = (await request(app, '/api/account/guardian-request', { cookie: application.cookie })).body.request;
  assert.equal(initial.reviewStatus, 'awaiting-reply'); assert.doesNotMatch(JSON.stringify(initial), /nonce|guardianEmail|guardianName/i);
  assert.equal(db.prepare('SELECT replyNonceHash FROM guardian_requests WHERE id=?').get(application.id).replyNonceHash, hash(application.nonce));
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM guardian_requests').all()), new RegExp(application.nonce));
  assert.notEqual(original.trim(), automaticReplyText(application.id, application.nonce));
  const event = received(application);
  const accepted = await webhook(event); assert.equal(accepted.status, 200); assert.deepEqual(accepted.body, { received: true });
  assert.deepEqual(calls.map(call => [call.url, call.redirect, call.signal instanceof AbortSignal]), [[`https://api.resend.com/emails/receiving/${event.data.email_id}?html_format=cid`, 'error', true]]);
  assert.equal(db.prepare('SELECT status,reviewStatus FROM guardian_requests').get().status, 'approved');
  const audit = db.prepare("SELECT * FROM guardian_audit WHERE action='auto-approved'").get(); assert.ok(audit);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guardian_audit WHERE action='approved'").get().n, 0);
  const saved = await readFile(join(folder, 'guardian-evidence', audit.evidenceFile), 'utf8');
  assert.equal(hash(saved), audit.evidenceHash); assert.doesNotMatch(saved, new RegExp(application.nonce));
  assert.equal(JSON.parse(saved).checks.verifiedGuardianIdentity, false);
  assert.equal((await stat(join(folder, 'guardian-evidence'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(folder, 'guardian-evidence', audit.evidenceFile))).mode & 0o777, 0o600);
  const child = { name: '어린이시험', email: 'child@example.test', password, ageBand: 'under14' };
  assert.equal((await post(app, '/api/auth/sign-up/email', child)).status, 403);
  assert.equal((await post(app, '/api/auth/sign-up/email', child, application.cookie)).status, 200);
  assert.equal((await post(app, '/api/auth/sign-up/email', { ...child, email: 'second@example.test' }, application.cookie)).status, 403);
  assert.equal((await post(app, '/api/account/verify-email', { token: tokenFrom(mailbox.at(-1)) })).status, 200);
  const login = await post(app, '/api/auth/sign-in/email', { email: child.email, password }); assert.equal(login.status, 200);
  const cookie = cookieFrom(login), state = (await request(app, '/api/account/session', { cookie })).body.user;
  assert.equal(state.canWriteCommunity, false);
  assert.equal((await post(app, '/api/community/posts', { game: 'slimeline', board: 'free', title: '차단 확인', body: '어린이 글' }, cookie)).status, 403);
}));

test('자동 설정이 빠지거나 준비 플래그가 없으면 수동 모드로 조용히 열리지 않음', async () => {
  for (const override of [{ guardianAutoApprovalReady: false }, { resendReceivingApiKey: '' }, { resendWebhookSecret: '' }, { guardianReplyTo: '' }, { guardianConsentMode: '알수없음' }]) {
    await scenario(async ({ app, db, webhook }) => {
      const config = (await request(app, '/api/account/config')).body;
      assert.equal(config.registrationAvailable, true); assert.equal(config.guardianConsentAvailable, false); assert.equal(config.guardianConsentMethod, null);
      assert.equal((await post(app, '/api/account/guardian-requests', { guardianName: '보호자시험', guardianEmail: 'parent@example.test' })).status, 503);
      assert.equal((await webhook({ type: 'email.received', data: { email_id: randomUUID() } })).status, override.guardianAutoApprovalReady === false ? 200 : 503);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guardian_requests').get().n, 0);
    }, override);
  }
});

test('잘못된 서명·과거/미래 시간·변조 JSON은 조회 전 차단하며 Origin 예외는 정확한 경로뿐', async () => scenario(async ({ app, db, calls, apply, received, webhook }) => {
  const application = await apply(), event = received(application);
  for (const options of [
    { headers: { 'svix-signature': 'v1,invalidsignature' } }, { time: new Date(Date.now() - 6 * 60 * 1000) }, { time: new Date(Date.now() + 6 * 60 * 1000) },
    { body: { ...event, created_at: '변조' } }, { headers: { 'svix-timestamp': `${Math.floor(Date.now() / 1000)}junk` } },
  ]) assert.equal((await webhook(event, options)).status, 400);
  assert.equal((await webhook(event, { headers: { host: 'wrong.example.test' } })).status, 403);
  assert.equal((await webhook(event, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await webhook(event, { body: { ...event, padding: 'x'.repeat(65536) } })).status, 413);
  for (const path of [`${GUARDIAN_WEBHOOK_PATH}/`, `${GUARDIAN_WEBHOOK_PATH}?test=1`, '/api/account/guardian-requests']) assert.equal((await webhook(event, { path })).status, 403);
  assert.equal((await request(app, GUARDIAN_WEBHOOK_PATH)).status, 405);
  assert.equal(calls.length, 0); assert.equal(db.prepare('SELECT status FROM guardian_requests').get().status, 'pending');
  assert.equal((await webhook(event)).status, 200);
}));

test('인증 헤더를 위조해도 공급자 인증 null·실패·불명은 보류하고 재회신은 가능', async () => scenario(async ({ app, db, apply, received, webhook }) => {
  for (const authentication of [null, { spf: 'pass', dkim: 'fail', dmarc: 'pass' }, { spf: 'pass', dkim: 'pass', dmarc: 'fail' }, { spf: 'pass', dkim: 'pass', dmarc: 'unknown' }, { spf: 'fail', dkim: 'pass', dmarc: 'pass' }]) {
    const application = await apply(), event = received(application, { authentication, headers: { from: application.email, 'authentication-results': 'resend.com; spf=pass; dkim=pass; dmarc=pass' } });
    assert.equal((await webhook(event)).status, 200);
    const state = (await request(app, '/api/account/guardian-request', { cookie: application.cookie })).body.request;
    assert.equal(state.status, 'pending'); assert.equal(state.reviewStatus, 'held'); assert.equal(state.reviewReason, 'email_authentication');
    assert.ok(state.reviewMessage); assert.doesNotMatch(JSON.stringify(state), new RegExp(application.nonce));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guardian_audit WHERE requestId=? AND evidenceFile IS NOT NULL").get(application.id).n, 0);
  }
  const retry = await apply();
  await webhook(received(retry, { authentication: null }));
  assert.equal((await webhook(received(retry, { authentication: { spf: 'gray', dkim: 'pass', dmarc: 'gray' } }))).status, 200);
  assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(retry.id).status, 'approved');
}));

test('인용·거절·원문 통째 반송·HTML만·자동메일·첨부·전달은 승인하지 않고 자유본문 미보관', async () => scenario(async ({ db, folder, mailbox, apply, received, webhook }) => {
  const cases = [
    a => ({ text: automaticReplyText(a.id, a.nonce).split('\n').map(line => `> ${line}`).join('\n') }),
    a => ({ text: `${automaticReplyText(a.id, a.nonce)}\n동의하지 않습니다. 비공개자유본문` }),
    () => ({ text: mailbox.at(-1).text }),
    a => ({ text: null, html: `<p>${automaticReplyText(a.id, a.nonce)}</p>` }),
    a => ({ headers: { from: a.email, 'auto-submitted': 'auto-replied' } }),
    a => ({ headers: { from: a.email, precedence: 'bulk' } }),
    a => ({ headers: { from: a.email, 'resent-from': 'third@example.test' } }),
    () => ({ attachments: [{ id: randomUUID(), filename: '동의.eml', download_url: 'https://외부.example/가져오지않음' }] }),
    a => ({ subject: `Fwd: 보호자 동의 신청 ${a.id}` }),
    a => ({ text: `${automaticReplyText(a.id, a.nonce)}\n\nOn yesterday, someone wrote:\n> 이전 원문` }),
  ];
  for (const mutate of cases) {
    const application = await apply();
    assert.equal((await webhook(received(application, mutate(application)))).status, 200);
    assert.equal(db.prepare('SELECT status,reviewStatus FROM guardian_requests WHERE id=?').get(application.id).status, 'pending');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guardian_audit WHERE evidenceFile IS NOT NULL').get().n, 0);
  assert.equal((await readdir(join(folder, 'guardian-evidence')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))).length, 0);
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM guardian_mail_events').all()), /비공개자유본문|download_url|@example/);
}));

test('보호자·단일 From·수신주소·공급자 ID·시각·코드·버전·메타데이터 불일치 차단', async () => scenario(async ({ db, inbox, apply, received, webhook }) => {
  const cases = [
    a => ({ from: 'other@example.test', headers: { from: 'other@example.test' } }),
    a => ({ from: `${a.email},other@example.test`, headers: { from: `${a.email},other@example.test` } }),
    a => ({ headers: { from: a.email, From: 'other@example.test' } }),
    () => ({ to: ['other@example.test'], received_for: [replyTo] }),
    () => ({ to: [replyTo, 'other@example.test'] }),
    () => ({ cc: ['other@example.test'] }),
    () => ({ created_at: new Date(Date.now() - 60000).toISOString() }),
    () => ({ created_at: new Date(Date.now() + 60000).toISOString() }),
    a => ({ text: automaticReplyText(a.id, randomBytes(32).toString('base64url')) }),
    a => ({ text: automaticReplyText(a.id, a.nonce).replace(CONSENT_VERSION, '2026-10-16-v2') }),
    () => ({ message_id: null }), () => ({ headers: null }),
  ];
  for (const mutate of cases) {
    const application = await apply(); await webhook(received(application, mutate(application)));
    assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(application.id).status, 'pending');
  }
  for (const mutate of [email => { email.id = randomUUID(); }, email => { email.to = ['other@example.test']; }, email => { email.from = 'different@example.test'; }, email => { email.message_id = '<different@example.test>'; }]) {
    const application = await apply(), event = received(application); mutate(inbox.get(event.data.email_id));
    assert.equal((await webhook(event)).status, 200); assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(application.id).status, 'pending');
  }
}));

test('신청별 nonce 혼용·구버전·만료·철회·생성 중·이미 가입한 신청은 소급 자동승인하지 않음', async () => scenario(async ({ app, db, apply, received, webhook }) => {
  const first = await apply(), second = await apply();
  await webhook(received(first, { text: automaticReplyText(first.id, second.nonce) }));
  assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(first.id).status, 'pending');
  for (const [change, expected] of [
    ["consentVersion='2026-10-16-v2'", 'pending'], ["consentMethod='email-reply-review'", 'pending'], ["expiresAt=0", 'expired'],
    ["status='withdrawn'", 'withdrawn'], ["status='creating'", 'creating'], ["status='used'", 'used'],
  ]) {
    const application = await apply(); db.prepare(`UPDATE guardian_requests SET ${change} WHERE id=?`).run(application.id);
    await webhook(received(application)); assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(application.id).status, expected);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guardian_audit WHERE requestId=? AND action='auto-approved'").get(application.id).n, 0);
  }
  assert.equal((await post(app, '/api/account/guardian-request/cancel', {}, second.cookie)).status, 200);
  await webhook(received(second)); assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(second.id).status, 'withdrawn');
}));

test('같은 메일·웹훅 중복과 동시 처리는 한 번만 승인하며 다른 메일 ID 재사용은 차단', async () => scenario(async ({ db, calls, apply, received, webhook }) => {
  const application = await apply(), event = received(application), eventId = `msg_${randomUUID()}`;
  const results = await Promise.all([webhook(event, { eventId }), webhook(event, { eventId })]);
  assert.ok(results.every(result => [200, 503].includes(result.status))); assert.ok(results.some(result => result.status === 200));
  assert.equal((await webhook(event)).status, 200); assert.equal((await webhook(event, { eventId })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guardian_audit WHERE action='auto-approved'").get().n, 1);
  assert.equal((await webhook(received(application), { eventId })).status, 400);
  assert.equal(calls.length, 1);
}));

test('동일 신청의 서로 다른 유효 회신이 경쟁해도 승인 증빙은 하나만 남음', async () => scenario(async ({ db, folder, apply, received, webhook }) => {
  const application = await apply();
  const results = await Promise.all([webhook(received(application)), webhook(received(application))]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guardian_audit WHERE action='auto-approved'").get().n, 1);
  assert.equal((await readdir(join(folder, 'guardian-evidence'))).length, 1);
}));

test('조회 API 일시 장애·JSON 장애는 503 뒤 같은 이벤트 재시도로 복구', async () => {
  for (const failure of [() => new Response('', { status: 503 }), () => { throw new Error('조회 오류 비공개'); }, () => new Response('{잘못된응답', { headers: { 'content-type': 'application/json' } })]) {
    let fixture, attempts = 0;
    await scenario(async ({ db, inbox, apply, received, webhook }) => {
      const application = await apply(), event = received(application), eventId = `msg_${randomUUID()}`; fixture = inbox.get(event.data.email_id);
      const first = await webhook(event, { eventId }); assert.equal(first.status, 503); assert.doesNotMatch(first.text, /비공개|guardian@example|nonce/);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guardian_mail_events').get().n, 0);
      assert.equal((await webhook(event, { eventId })).status, 200); assert.equal(db.prepare('SELECT status FROM guardian_requests').get().status, 'approved');
    }, { guardianReceivingFetch: async () => ++attempts === 1 ? failure() : response(fixture) });
  }
});

test('과대 API 응답은 선언 크기와 스트림 양쪽에서 차단하며 외부 URL은 호출하지 않음', async () => {
  for (const declared of [true, false]) {
    let cancelled = false, count = 0;
    await scenario(async ({ db, apply, received, webhook }) => {
      const application = await apply(); assert.equal((await webhook(received(application))).status, 200);
      assert.equal(db.prepare('SELECT status FROM guardian_requests').get().status, 'pending'); assert.equal(count, 1); assert.equal(cancelled, true);
    }, { guardianReceivingFetch: async () => {
      count++;
      return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json', 'content-length': declared ? String(3 * 1024 * 1024) : '1' } });
    } });
  }
});

test('조회 도중 신청 철회가 먼저 완료되면 승인·증빙 보관으로 되살리지 않음', async () => {
  let finishFetch, announceFetch;
  const fetching = new Promise(resolve => { announceFetch = resolve; });
  await scenario(async ({ app, db, folder, inbox, apply, received, webhook }) => {
    const application = await apply(), event = received(application), incoming = webhook(event);
    await fetching;
    assert.equal((await post(app, '/api/account/guardian-request/cancel', {}, application.cookie)).status, 200);
    finishFetch(response(inbox.get(event.data.email_id)));
    assert.equal((await incoming).status, 200); assert.equal(db.prepare('SELECT status FROM guardian_requests').get().status, 'withdrawn');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guardian_audit WHERE action='auto-approved'").get().n, 0);
    assert.equal((await readdir(join(folder, 'guardian-evidence')).catch(() => [])).length, 0);
  }, { guardianReceivingFetch: async () => { announceFetch(); return new Promise(resolve => { finishFetch = resolve; }); } });
});

test('정상 증거만 최소 보관하고 만료·취소·회원삭제와 고아 JSON을 정리', async () => scenario(async ({ app, db, folder, inbox, apply, received, webhook }) => {
  const application = await apply(), event = received(application);
  Object.assign(inbox.get(event.data.email_id), { raw: { download_url: 'https://secret.example/signed-url?token=원문비밀' }, html: `<div dir="ltr">${automaticReplyText(application.id, application.nonce).replaceAll('\n', '<br>')}</div>`, unnecessary: '불필요본문' });
  await webhook(event);
  const audit = db.prepare("SELECT * FROM guardian_audit WHERE action='auto-approved'").get(), directory = join(folder, 'guardian-evidence');
  const saved = await readFile(join(directory, audit.evidenceFile), 'utf8'); assert.doesNotMatch(saved, /download_url|원문비밀|불필요본문|원시|confirmGuardian/);
  const orphan = join(directory, `${randomUUID()}.json`), recent = join(directory, `${randomUUID()}.json`), other = join(directory, '보존.json'), linked = join(directory, `${randomUUID()}.json`);
  for (const file of [orphan, recent, other]) await writeFile(file, '시험증거', { mode: 0o600 });
  await symlink(other, linked); const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); await utimes(orphan, old, old); await utimes(other, old, old);
  assert.equal(await cleanupGuardianEvidence(db, folder), 1); await assert.rejects(readFile(orphan), { code: 'ENOENT' }); assert.ok((await lstat(linked)).isSymbolicLink());
  assert.ok((await stat(recent)).isFile()); assert.ok((await stat(other)).isFile());
  db.prepare('UPDATE guardian_requests SET expiresAt=0 WHERE id=?').run(application.id);
  await cleanupGuardianEvidence(db, folder); await assert.rejects(readFile(join(directory, audit.evidenceFile)), { code: 'ENOENT' });
  assert.equal(db.prepare('SELECT replyNonceHash FROM guardian_requests WHERE id=?').get(application.id).replyNonceHash, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guardian_mail_events WHERE requestId=?').get(application.id).n, 0);
  const used = await apply(); await webhook(received(used));
  assert.equal((await post(app, '/api/auth/sign-up/email', { name: '정리시험', email: 'delete-child@example.test', password, ageBand: 'under14' }, used.cookie)).status, 200);
  withdrawGuardian(db, used.id); await deleteGuardianChild(db, { id: used.id, dataDir: folder, confirmParentRequest: true, confirmDeletion: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guardian_mail_events WHERE requestId=?').get(used.id).n, 0);
  assert.equal(db.prepare('SELECT guardianEmail,replyNonceHash FROM guardian_requests WHERE id=?').get(used.id).guardianEmail, null);
}));

test('웹훅 요청도 독립된 쓰기 속도 제한을 적용', async () => scenario(async ({ apply, received, webhook }) => {
  const event = received(await apply()); assert.equal((await webhook(event)).status, 200); assert.equal((await webhook(event)).status, 429);
}, { rateLimit: { authMax: 100, writeMax: 1 } }));

test('단순 Gmail·모바일 HTML은 표시문장 일치만 허용하며 상충·숨김·손상된 HTML은 보류', async () => scenario(async ({ db, apply, received, webhook }) => {
  const htmlCases = [
    [true, text => `<div dir="ltr">${text.replaceAll('\n', '<br>')}</div>`],
    [true, text => text.split('\n').map(line => `<div><span lang="ko">${line}</span></div>`).join('')],
    [true, text => text.split('\n').map(line => `<p>${line}</p>`).join('')],
    [true, text => `<div>${text.replaceAll(' ', '&nbsp;').replaceAll('\n', '<br/>')}</div>`],
    [false, () => '<p>어린이 회원가입에 동의하지 않습니다.</p>'],
    [false, text => `<div>${text.replaceAll('\n', '<br>')}</div><p>동의하지 않습니다.</p>`],
    [false, text => `<blockquote>${text.replaceAll('\n', '<br>')}</blockquote>`],
    [false, text => `<div style="display:none">${text.replaceAll('\n', '<br>')}</div>`],
    [false, text => `<div hidden>${text.replaceAll('\n', '<br>')}</div>`],
    [false, text => `<div aria-hidden="true">${text.replaceAll('\n', '<br>')}</div>`],
    [false, text => `<div class="gmail_quote">${text.replaceAll('\n', '<br>')}</div>`],
    [false, text => `<div id="reply">${text.replaceAll('\n', '<br>')}</div>`],
    [false, text => `<div onclick="ignore()">${text.replaceAll('\n', '<br>')}</div>`],
    [false, text => `<div dir="rtl">${text.replaceAll('\n', '<br>')}</div>`],
    [false, text => `<div dir="ltr" dir="rtl">${text.replaceAll('\n', '<br>')}</div>`],
    [false, text => `<!--동의하지 않습니다.--><div>${text.replaceAll('\n', '<br>')}</div>`],
    [false, text => `<div>${text.replaceAll('\n', '<br>')}&#x202e;</div>`],
    [false, text => `<div>${text.replaceAll('\n', '<br>')}&#x200b;</div>`],
    [false, text => `<div>${text.replaceAll('\n', '<br>')}`],
    [false, text => `<div><span>${text.replaceAll('\n', '<br>')}</div></span>`],
    [false, text => `<span><div>${text.replaceAll('\n', '<br>')}</div></span>`],
    [false, text => `<div>${text.replaceAll('\n', '<br>')}</div></script>`],
    [false, text => `<div>${text.replaceAll('\n', '<br>')}</div><span`],
    [false, text => `<div>${text.replaceAll('\n', '<br>')}</div></`],
    [false, text => `<div>${text.replaceAll('\n', '<br>')}</div></><span></span>`],
    ...['script', 'style', 'template', 'noscript', 'svg', 'math', 'iframe', 'a', 'img'].map(tag => [false, text => `<${tag}>${text.replaceAll('\n', '<br>')}</${tag}>`]),
  ];
  for (const [accepted, html] of htmlCases) {
    const application = await apply();
    const event = received(application, { html: html(automaticReplyText(application.id, application.nonce)) });
    assert.equal((await webhook(event)).status, 200);
    assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(application.id).status, accepted ? 'approved' : 'pending');
  }
}));

test('다른 수신주소의 서명 이벤트는 본문 조회·이벤트 보관 없이 무시', async () => scenario(async ({ db, calls, apply, received, webhook }) => {
  const application = await apply();
  for (const to of [['other@example.test'], [replyTo, 'other@example.test'], null, []]) {
    assert.equal((await webhook(received(application, { to }))).status, 200);
  }
  assert.equal(calls.length, 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guardian_mail_events').get().n, 0);
}));

test('준비 플래그를 끈 연결 검증은 기존 신청도 바꾸지 않으며 개방 후 같은 메일 재처리 가능', async () => scenario(async ({ app, db, folder, options, apply, received, webhook }) => {
  const application = await apply(), event = received(application), eventId = `msg_${randomUUID()}`;
  const before = db.prepare('SELECT * FROM guardian_requests WHERE id=?').get(application.id);
  const closed = await startServer({ ...options, guardianAutoApprovalReady: false });
  try {
    const config = (await request(closed, '/api/account/config')).body; assert.equal(config.guardianConsentAvailable, false);
    assert.equal((await post(closed, '/api/account/guardian-requests', { guardianName: '신청차단', guardianEmail: 'blocked@example.test' })).status, 503);
    assert.equal((await webhook(event, { eventId, targetApp: closed })).status, 200);
    assert.deepEqual(db.prepare('SELECT * FROM guardian_requests WHERE id=?').get(application.id), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guardian_audit WHERE action IN ('auto-held','auto-approved')").get().n, 0);
    const recorded = db.prepare('SELECT * FROM guardian_mail_events').get(); assert.equal(recorded.reason, 'readiness_verified'); assert.equal(recorded.requestId, null);
    assert.doesNotMatch(JSON.stringify(recorded), new RegExp(application.email)); assert.doesNotMatch(JSON.stringify(recorded), new RegExp(application.nonce));
    assert.equal((await readdir(join(folder, 'guardian-evidence')).catch(() => [])).length, 0);
  } finally { await closed.close(); }
  assert.equal((await webhook(event, { eventId, targetApp: app })).status, 200);
  assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(application.id).status, 'approved');
  assert.equal(db.prepare('SELECT status FROM guardian_mail_events').get().status, 'approved');
}));

test('기존 수동 신청·동의문·감사기록을 보존하며 자동 검증 열과 이벤트 테이블만 이관', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-guardian-migration-'));
  let app, db;
  try {
    const options = { port: 0, dataDir: folder, mailer: async () => {}, guardianReplyTo: 'support@example.test' };
    app = await startServer(options);
    assert.equal((await post(app, '/api/account/guardian-requests', { guardianName: '기존보호자', guardianEmail: 'legacy-parent@example.test' })).status, 200);
    await app.close(); app = null;
    db = new DatabaseSync(join(folder, 'community.sqlite'));
    db.prepare("UPDATE guardian_requests SET consentVersion='2026-10-16-v2',consentText='이전 동의문 그대로 보존'").run();
    db.exec('DROP TABLE guardian_mail_events');
    for (const name of ['replyNonceHash', 'consentMethod', 'reviewStatus', 'reviewReason']) db.exec(`ALTER TABLE guardian_requests DROP COLUMN ${name}`);
    const before = db.prepare('SELECT * FROM guardian_requests').get(), auditBefore = db.prepare('SELECT * FROM guardian_audit').all();
    db.close(); db = null; app = await startServer(options);
    db = new DatabaseSync(join(folder, 'community.sqlite'));
    const after = db.prepare('SELECT * FROM guardian_requests').get();
    for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key]);
    assert.deepEqual(db.prepare('SELECT * FROM guardian_audit').all(), auditBefore);
    assert.equal(after.consentMethod, 'email-reply-review'); assert.equal(after.replyNonceHash, null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guardian_mail_events').get().n, 0);
  } finally { db?.close(); await app?.close(); await rm(folder, { recursive: true, force: true }); }
});

test('증거 파일 저장 직후 철회가 먼저 이뤄져도 승인과 고아 증거를 남기지 않음', async () => scenario(async ({ app, db, folder, options, inbox, apply, received }) => {
  const application = await apply(), event = received(application);
  let begins = 0;
  const boundary = { prepare: sql => db.prepare(sql), exec(sql) {
    if (sql === 'BEGIN IMMEDIATE' && ++begins === 2) withdrawGuardian(db, application.id);
    return db.exec(sql);
  } };
  const handler = createAutomaticGuardianReview(boundary, { enabled: true, apiKey: options.resendReceivingApiKey, webhookSecret: options.resendWebhookSecret, replyTo, dataDir: folder, fetchImpl: async () => response(inbox.get(event.data.email_id)) });
  const eventId = `msg_${randomUUID()}`, time = new Date(), payload = JSON.stringify(event);
  const result = await handler(new Request(`${app.origin}${GUARDIAN_WEBHOOK_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': eventId, 'svix-timestamp': String(Math.floor(time.getTime() / 1000)), 'svix-signature': new Webhook(options.resendWebhookSecret).sign(eventId, time, payload) }, body: payload }));
  assert.equal(result.status, 200); assert.equal(begins, 2);
  assert.equal(db.prepare('SELECT status FROM guardian_requests WHERE id=?').get(application.id).status, 'withdrawn');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guardian_audit WHERE action='auto-approved'").get().n, 0);
  assert.equal((await readdir(join(folder, 'guardian-evidence'))).length, 0);
}));
