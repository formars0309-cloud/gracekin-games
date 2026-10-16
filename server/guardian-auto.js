import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleParser } from 'mailparser';
import { Webhook } from 'svix';
import { Tokenizer } from 'htmlparser2';
import { CONSENT_VERSION, automaticReplyText, auditGuardian, expireGuardianRequests } from './guardian.js';
import { evidenceDirectory } from './guardian-review.js';
import { fail, json, readBody } from './security.js';

export const GUARDIAN_WEBHOOK_PATH = '/api/webhooks/resend/guardian';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const UUIDS = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g;
const hash = value => createHash('sha256').update(value).digest('hex');
const API_LIMIT = 2 * 1024 * 1024;
const LEASE_MS = 60 * 1000;
const SAFE_HEADERS = ['auto-submitted', 'precedence', 'x-autoreply', 'x-autorespond', 'x-auto-response-suppress', 'list-id', 'resent-from', 'resent-to', 'resent-sender'];

function validWebhookSecret(value) {
  if (typeof value !== 'string' || !value.startsWith('whsec_')) return false;
  const encoded = value.slice(6);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  const decoded = Buffer.from(encoded, 'base64');
  // Resend가 발급하는 24바이트 키를 포함하며, 패딩·여분 비트가 다른 표기는 거부합니다.
  return decoded.length >= 24 && decoded.length <= 128 && decoded.toString('base64') === encoded;
}

// HTTP 입력이 아닌 서버 내부 설정으로만 활성화합니다. 불완전한 자동 설정은 수동 모드로 바꾸지 않습니다.
export function automaticGuardianSettings(options = {}) {
  const mode = options.guardianConsentMode ?? process.env.GUARDIAN_CONSENT_MODE ?? 'email-reply-review';
  const apiKey = options.resendReceivingApiKey ?? process.env.RESEND_RECEIVING_API_KEY;
  const webhookSecret = options.resendWebhookSecret ?? process.env.RESEND_WEBHOOK_SECRET;
  const ready = options.guardianAutoApprovalReady ?? (process.env.GUARDIAN_AUTO_APPROVAL_READY === 'true');
  const autoConfigured = mode === 'email-reply-auto' && typeof apiKey === 'string' && /^re_[A-Za-z0-9_-]+$/.test(apiKey)
    && validWebhookSecret(webhookSecret);
  return { mode, apiKey, webhookSecret, autoConfigured, autoReady: autoConfigured && ready === true };
}

// 메일을 브라우저로 렌더링하지 않고 제한된 HTML 토큰의 표시 문장만 대조합니다.
// 일반 Gmail의 div/br 형태를 지원하되 모르는 태그·속성·손상된 구조는 모두 보류합니다.
function htmlMatchesReply(html, expected) {
  if (html === undefined || html === null || html === '') return true;
  if (typeof html !== 'string' || Buffer.byteLength(html) > 65536) return false;
  const allowed = new Set(['div', 'p', 'br', 'span']), stack = [];
  let valid = true, output = '', current = null, attribute = null, value = '', attributes = new Set(), count = 0, consumed = 0;
  const block = name => name === 'div' || name === 'p';
  const newline = () => { if (output && !output.endsWith('\n')) output += '\n'; };
  const append = text => { if (/[\u0000\u00ad\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(text)) valid = false; output += text.replace(/[\t\r\n\f \u00a0]+/g, ' '); };
  const open = selfClosing => {
    if (!current || !allowed.has(current) || ++count > 100 || stack.length > 20 || selfClosing && current !== 'br') valid = false;
    if (block(current)) {
      if (stack.includes('p') || stack.includes('span')) valid = false;
      newline();
    }
    if (current === 'br') output += '\n'; else stack.push(current);
    current = null;
  };
  try {
    const tokenizer = new Tokenizer({ decodeEntities: true, recognizeSelfClosing: true }, {
      onopentagname(start, end) { if (html.slice(consumed, start) !== '<') valid = false; current = html.slice(start, end).toLowerCase(); attributes = new Set(); if (!allowed.has(current)) valid = false; },
      onattribname(start, end) { attribute = html.slice(start, end).toLowerCase(); value = ''; if (attributes.has(attribute)) valid = false; attributes.add(attribute); },
      onattribdata(start, end) { value += html.slice(start, end); },
      onattribentity(codepoint) { value += String.fromCodePoint(codepoint); },
      onattribend() { if (!(attribute === 'dir' && value === 'ltr') && !(attribute === 'lang' && /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value))) valid = false; },
      onopentagend(end) { open(false); consumed = end + 1; }, onselfclosingtag(end) { open(true); consumed = end + 1; },
      onclosetag(start, end) {
        const name = html.slice(start, end).toLowerCase(), closingEnd = html.indexOf('>', end);
        if (html.slice(consumed, start) !== '</' || !allowed.has(name) || name === 'br' || stack.pop() !== name || closingEnd < 0 || !/^\s*$/.test(html.slice(end, closingEnd))) valid = false;
        consumed = closingEnd + 1;
        if (block(name)) newline();
      },
      ontext(start, end) { if (start !== consumed) valid = false; append(html.slice(start, end)); consumed = end; },
      ontextentity(codepoint, end) { if (!/^&(?:#[xX][a-fA-F0-9]+|#[0-9]+|[A-Za-z][A-Za-z0-9]+);?$/.test(html.slice(consumed, end))) valid = false; append(String.fromCodePoint(codepoint)); consumed = end; },
      oncomment() { valid = false; }, oncdata() { valid = false; }, ondeclaration() { valid = false; }, onprocessinginstruction() { valid = false; },
      onend() { if (current || stack.length || consumed !== html.length) valid = false; },
    });
    tokenizer.write(html); tokenizer.end();
  } catch { return false; }
  const visible = output.split('\n').map(line => line.replace(/ +/g, ' ').trim()).filter(Boolean).join('\n');
  return valid && visible === expected;
}

async function singleAddress(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\r\n\0]/.test(value)) return null;
  const parsed = await simpleParser(`From: ${value}\r\n\r\n`, { skipTextToHtml: true });
  const addresses = parsed.from?.value;
  if (addresses?.length !== 1 || addresses[0].group || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addresses[0].address || '')) return null;
  return addresses[0].address.toLowerCase();
}
function singleRecipient(values, expected) {
  return Array.isArray(values) && values.length === 1 && typeof values[0] === 'string' && values[0].toLowerCase() === expected;
}
function emptyList(value) { return Array.isArray(value) && value.length === 0; }
function normalizedHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value), result = Object.create(null);
  if (entries.length > 150) return null;
  for (const [name, content] of entries) {
    const key = name.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(key) || Object.hasOwn(result, key) || typeof content !== 'string' || content.length > 16000 || content.includes('\0')) return null;
    result[key] = content;
  }
  return result;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return NaN;
  return Date.parse(value);
}

class OversizedEmail extends Error {}
async function retrieveEmail(emailId, apiKey, fetchImpl) {
  // 수신 메일의 URL이나 첨부 URL은 절대 호출하지 않고 고정 API만 사용합니다.
  const response = await fetchImpl(`https://api.resend.com/emails/receiving/${emailId}?html_format=cid`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('메일 조회를 다시 시도해야 합니다.'); }
  const length = Number(response.headers.get('content-length') || 0);
  if (!Number.isFinite(length) || length > API_LIMIT) { await response.body?.cancel(); throw new OversizedEmail(); }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new Error('메일 조회 응답을 확인할 수 없습니다.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('메일 조회 응답이 없습니다.');
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > API_LIMIT) { await reader.cancel(); throw new OversizedEmail(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function requestCandidate(db, email) {
  const source = `${typeof email?.subject === 'string' ? email.subject.slice(0, 1000) : ''}\n${typeof email?.text === 'string' ? email.text.slice(0, 65536) : ''}`;
  const ids = new Set(source.match(UUIDS) || []);
  if (ids.size !== 1) return null;
  return db.prepare('SELECT * FROM guardian_requests WHERE id=?').get([...ids][0]) || null;
}

async function inspectEnvelope(email, event, replyTo, now, earliest = 0) {
  const headers = normalizedHeaders(email?.headers);
  const receivedAt = timestamp(email?.created_at), eventReceivedAt = timestamp(event.data?.created_at), eventAt = timestamp(event.created_at);
  // 상위 이벤트 시각과 API 수신 시각의 선후 관계는 공급자가 보장하지 않습니다.
  // 신청 이후 수신 여부는 API와 data.created_at의 일치값으로 확인하고, 재전송 신선도는 Svix 서명 시각으로 검사합니다.
  if (email?.id !== event.data.email_id || !headers || !Number.isFinite(receivedAt) || !Number.isFinite(eventReceivedAt) || !Number.isFinite(eventAt)
      || receivedAt < earliest || receivedAt > now || eventReceivedAt !== receivedAt || eventAt > now
      || typeof email.message_id !== 'string' || !email.message_id || email.message_id.length > 1000 || email.message_id !== event.data.message_id
      || typeof email.subject !== 'string' || email.subject.length > 1000 || email.subject !== event.data.subject
      || /^(?:\s*(?:re|답장)\s*:)*\s*(?:fw|fwd|전달)\s*:/i.test(email.subject)) return { reason: 'message_metadata' };
  const sender = await singleAddress(email.from), eventSender = await singleAddress(event.data.from), headerSender = await singleAddress(headers.from);
  if (!sender || eventSender !== sender || headerSender !== sender
      || !singleRecipient(email.to, replyTo) || !singleRecipient(event.data.to, replyTo)
      || !emptyList(email.cc) || !emptyList(email.bcc) || !emptyList(event.data.cc) || !emptyList(event.data.bcc)) return { reason: 'sender_or_recipient' };
  // 받은편지함 헤더의 Authentication-Results나 received_for를 인증 근거로 사용하지 않습니다.
  const authentication = email.authentication;
  if (!authentication || authentication.dkim !== 'pass' || !['pass', 'gray'].includes(authentication.dmarc)
      || !['pass', 'gray'].includes(authentication.spf)) return { reason: 'email_authentication' };
  if (SAFE_HEADERS.some(name => headers[name] && (name !== 'auto-submitted' || headers[name].trim().toLowerCase() !== 'no'))
      || !emptyList(email.attachments) || !emptyList(event.data.attachments)
      || typeof email.text !== 'string' || Buffer.byteLength(email.text) > 65536) return { reason: 'message_metadata' };
  return { reason: null, sender, headers, authentication };
}
async function inspectReply(email, event, row, replyTo, now) {
  if (!row || row.consentMethod !== 'email-reply-auto' || row.consentVersion !== CONSENT_VERSION || !row.replyNonceHash) return { reason: 'request_mismatch' };
  const envelope = await inspectEnvelope(email, event, replyTo, now, row.createdAt);
  if (envelope.reason) return envelope;
  const { sender, headers, authentication } = envelope;
  if (sender !== row.guardianEmail) return { reason: 'sender_or_recipient' };
  const text = email.text.replace(/\r\n/g, '\n').trim();
  const nonce = text.match(/^회신 확인 코드: ([A-Za-z0-9_-]{43})$/m)?.[1];
  if (!nonce || !/^[a-f0-9]{64}$/.test(row.replyNonceHash) || !timingSafeEqual(Buffer.from(hash(nonce), 'hex'), Buffer.from(row.replyNonceHash, 'hex'))) return { reason: 'request_mismatch' };
  // 새 본문 전체를 비교합니다. 인용문이나 자유문에서 동의 문구를 찾아 승인하지 않습니다.
  if (text !== automaticReplyText(row.id, nonce)) return { reason: 'reply_format' };
  if (!htmlMatchesReply(email.html, text)) return { reason: 'reply_format' };
  return { reason: null, evidence: {
    schemaVersion: 1, reviewMethod: 'email-reply-auto', requestId: row.id, consentVersion: row.consentVersion,
    receivedEmailId: email.id, receivedAt: email.created_at, messageIdHash: hash(email.message_id),
    from: sender, to: [replyTo], authentication: { spf: authentication.spf, dkim: authentication.dkim, dmarc: authentication.dmarc },
    // 원시 회신 코드·원문 다운로드 URL·HTML·첨부·자유 입력 헤더는 보관하지 않습니다.
    replyTextHash: hash(email.text), replyText: text.replace(nonce, `[SHA256:${row.replyNonceHash}]`),
    checkedHeaders: { autoSubmitted: headers['auto-submitted']?.trim().toLowerCase() || null, automaticOrForwarded: false },
    checks: { exactReply: true, htmlConsistentOrAbsent: true, sameGuardianEmail: true, signedEvent: true, providerAuthentication: true, verifiedGuardianIdentity: false },
  } };
}

export function createAutomaticGuardianReview(db, { enabled, approvalReady = enabled, apiKey, webhookSecret, replyTo, dataDir, fetchImpl = fetch, now = Date.now }) {
  const verifier = enabled ? new Webhook(webhookSecret) : null;
  return async function handle(request) {
    if (request.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
    if (!enabled) fail(503, 'GUARDIAN_AUTO_UNAVAILABLE', '보호자 자동 확인을 준비하고 있습니다.');
    const raw = await readBody(request);
    const eventId = request.headers.get('svix-id'), signedAt = request.headers.get('svix-timestamp'), signature = request.headers.get('svix-signature');
    let event;
    try {
      if (!eventId || !/^[A-Za-z0-9_-]{1,150}$/.test(eventId) || !/^\d{10}$/.test(signedAt || '') || !signature || signature.length > 1000) throw new Error();
      verifier.verify(raw, { 'svix-id': eventId, 'svix-timestamp': signedAt, 'svix-signature': signature });
      // svix 2.8은 검증 성공 시 undefined를 반환하므로 검증 후에만 같은 원문을 JSON으로 읽습니다.
      event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error();
    } catch { fail(400, 'INVALID_WEBHOOK', '수신 알림을 확인하지 못했습니다.'); }
    if (event.type !== 'email.received') return json({ received: true });
    if (typeof event.data?.email_id !== 'string' || !UUID.test(event.data.email_id)) fail(400, 'INVALID_WEBHOOK', '수신 알림을 확인하지 못했습니다.');
    // 계정의 다른 수신 주소로 온 메일은 본문을 조회하거나 보관하지 않습니다.
    if (!singleRecipient(event.data.to, replyTo)) return json({ received: true });
    const emailIdHash = hash(event.data.email_id), eventIdHash = hash(eventId), leaseToken = randomUUID();
    const instant = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT * FROM guardian_mail_events WHERE emailIdHash=? OR eventIdHash=?').get(emailIdHash, eventIdHash);
      if (previous) {
        if (previous.emailIdHash !== emailIdHash) fail(400, 'INVALID_WEBHOOK', '수신 알림을 확인하지 못했습니다.');
        const readinessReplay = approvalReady && previous.status === 'ignored' && previous.reason === 'readiness_verified';
        if (previous.status !== 'processing' && !readinessReplay) { db.exec('COMMIT'); return json({ received: true }); }
        if (previous.leaseUntil > instant) fail(503, 'WEBHOOK_RETRY', '수신 알림을 잠시 후 다시 보내 주세요.');
        db.prepare("UPDATE guardian_mail_events SET status='processing',eventIdHash=?,leaseToken=?,leaseUntil=? WHERE emailIdHash=?").run(eventIdHash, leaseToken, instant + LEASE_MS, emailIdHash);
      } else db.prepare("INSERT INTO guardian_mail_events(emailIdHash,eventIdHash,status,createdAt,leaseToken,leaseUntil) VALUES(?,?,'processing',?,?,?)").run(emailIdHash, eventIdHash, instant, leaseToken, instant + LEASE_MS);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    let evidencePath;
    try {
      let email, oversized = false;
      try { email = await retrieveEmail(event.data.email_id, apiKey, fetchImpl); }
      catch (error) { if (error instanceof OversizedEmail) oversized = true; else throw error; }
      if (approvalReady) expireGuardianRequests(db, now());
      const row = approvalReady ? requestCandidate(db, email) : null;
      // 신청 안내 메일 발송을 마치기 전에는 승인하지 않고 공급자의 재시도를 기다립니다.
      if (row?.status === 'pending' && !db.prepare("SELECT 1 FROM guardian_audit WHERE requestId=? AND action='requested'").get(row.id)) throw new Error('신청 발송 중입니다.');
      const result = oversized ? { reason: 'message_metadata' } : approvalReady ? await inspectReply(email, event, row, replyTo, now()) : await inspectEnvelope(email, event, replyTo, now());
      let filename = null, digest = null;
      if (row?.status === 'pending' && row.expiresAt > now() && result.evidence) {
        const directory = await evidenceDirectory(dataDir, true);
        filename = `${randomUUID()}.json`; evidencePath = join(directory, filename);
        const evidence = JSON.stringify({ ...result.evidence, webhookEventId: eventId, reviewedAt: new Date(now()).toISOString() });
        digest = hash(evidence);
        await writeFile(evidencePath, evidence, { flag: 'wx', mode: 0o600 });
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        const owned = db.prepare("SELECT 1 FROM guardian_mail_events WHERE emailIdHash=? AND leaseToken=? AND status='processing'").get(emailIdHash, leaseToken);
        if (!owned) throw new Error('수신 알림 처리 상태가 변경되었습니다.');
        const active = row && db.prepare("SELECT * FROM guardian_requests WHERE id=? AND status='pending' AND expiresAt>?").get(row.id, now());
        let status = 'ignored', reason = !approvalReady && !result.reason ? 'readiness_verified' : result.reason;
        if (active && active.consentMethod === 'email-reply-auto' && active.consentVersion === CONSENT_VERSION && active.replyNonceHash === row.replyNonceHash && active.guardianEmail === row.guardianEmail) {
          if (result.evidence && filename) {
            db.prepare("UPDATE guardian_requests SET status='approved',reviewedAt=?,reviewStatus='approved',reviewReason=NULL WHERE id=? AND status='pending'").run(now(), row.id);
            auditGuardian(db, row.id, 'auto-approved', now(), digest, filename);
            status = 'approved';
          } else {
            db.prepare("UPDATE guardian_requests SET reviewStatus='held',reviewReason=? WHERE id=? AND status='pending'").run(reason || 'message_metadata', row.id);
            auditGuardian(db, row.id, 'auto-held', now());
            status = 'held';
          }
        }
        db.prepare('UPDATE guardian_mail_events SET requestId=?,status=?,reason=?,leaseToken=NULL,leaseUntil=NULL WHERE emailIdHash=? AND leaseToken=?').run(row?.id || null, status, reason, emailIdHash, leaseToken);
        db.exec('COMMIT');
        if (status === 'approved') evidencePath = null;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      if (evidencePath) { await unlink(evidencePath); evidencePath = null; }
      return json({ received: true });
    } catch {
      if (evidencePath) await unlink(evidencePath).catch(() => {});
      db.prepare("DELETE FROM guardian_mail_events WHERE emailIdHash=? AND leaseToken=? AND status='processing'").run(emailIdHash, leaseToken);
      fail(503, 'WEBHOOK_RETRY', '수신 알림을 잠시 후 다시 보내 주세요.');
    }
  };
}
