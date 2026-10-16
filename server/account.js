import { createHash, randomBytes } from 'node:crypto';
import { guardianIsActive } from './guardian.js';
import { APIError } from 'better-auth/api';
import { fail, json, readJson } from './security.js';

export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function accountAge(user) { return ['under14', '14plus'].includes(user.ageBand) ? user.ageBand : 'legacy'; }
export function canWriteCommunity(user) { return accountAge(user) !== 'under14' && (accountAge(user) === 'legacy' || Boolean(user.emailVerified)); }
export function activeAccountUser(db, user) { return user && (accountAge(user) !== 'under14' || guardianIsActive(db, user.id)) ? user : null; }
export function accountUser(user) { return { id: user.id, name: user.name, email: user.email, emailVerified: Boolean(user.emailVerified), ageBand: accountAge(user), canWriteCommunity: canWriteCommunity(user) }; }

export function createAccountService(db, auth, { origin, mailer, guardian, grain, socialProviders = [], now = Date.now, onDeliveryError = () => {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_email_tokens (
    tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
    expiresAt INTEGER NOT NULL
  );`);

  async function deliver(message) {
    try { await mailer(message); return true; }
    catch { onDeliveryError(); throw new APIError('SERVICE_UNAVAILABLE', { code: 'EMAIL_DELIVERY_FAILED', message: '메일을 보내지 못했습니다.' }); }
  }
  async function sendVerification(user) {
    if (!mailer) return;
    const token = randomBytes(32).toString('base64url');
    const hash = tokenHash(token);
    db.prepare('DELETE FROM account_email_tokens WHERE expiresAt <= ?').run(now());
    db.prepare('INSERT INTO account_email_tokens(tokenHash,userId,expiresAt) VALUES(?,?,?) ON CONFLICT(userId) DO UPDATE SET tokenHash=excluded.tokenHash,expiresAt=excluded.expiresAt').run(hash, user.id, now() + 60 * 60 * 1000);
    const url = `${origin}/account/?view=verify#token=${encodeURIComponent(token)}`;
    try { await deliver({ to: user.email, subject: '그레이스킨게임즈 이메일 확인', text: `이메일 주소를 확인하려면 아래 링크를 열고 확인 버튼을 눌러 주세요. 링크는 1시간 동안 한 번만 사용할 수 있습니다.\n\n${url}\n\n가입을 요청하지 않았다면 이 메일을 무시해 주세요.` }); }
    catch (error) { db.prepare('DELETE FROM account_email_tokens WHERE tokenHash=?').run(hash); throw error; }
  }
  async function sendReset({ user, token }) {
    const url = `${origin}/account/?view=reset#token=${encodeURIComponent(token)}`;
    await deliver({ to: user.email, subject: '그레이스킨게임즈 비밀번호 재설정', text: `새 비밀번호를 정하려면 아래 링크를 열어 주세요. 링크는 1시간 동안 한 번만 사용할 수 있습니다. 변경하면 모든 기기의 로그인이 해제됩니다.\n\n${url}\n\n요청하지 않았다면 이 메일을 무시해 주세요.` });
  }
  function verifyEmail(token) {
    let valid = false;
    if (typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('DELETE FROM account_email_tokens WHERE tokenHash=? AND expiresAt>? RETURNING userId').get(tokenHash(token), now());
        if (row) {
          const user = activeAccountUser(db, db.prepare('SELECT id,ageBand FROM user WHERE id=?').get(row.userId));
          if (!user) fail(403, 'FORBIDDEN', '계정과 보호자 동의 상태를 확인해 주세요.');
          db.prepare('UPDATE user SET emailVerified=1,updatedAt=? WHERE id=?').run(now(), row.userId);
          grain.awardSignup(user.id);
          valid = true;
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    if (!valid) fail(400, 'INVALID_TOKEN', '링크가 만료되었거나 이미 사용되었습니다.');
    return json({ status: true });
  }
  function requireEmail() { if (!mailer) fail(503, 'EMAIL_UNAVAILABLE', '이메일 인증을 준비하고 있습니다. 기존 회원은 로그인할 수 있습니다.'); }
  async function handle(request, url) {
    const guardianResponse = await guardian.handle(request, url);
    if (guardianResponse) return guardianResponse;
    if (url.pathname === '/api/account/verify-email' && request.method === 'POST') { const body = await readJson(request); return verifyEmail(body.token); }
    if (!['/api/account/config','/api/account/session','/api/account/grain'].includes(url.pathname)) fail(404, 'NOT_FOUND', '요청한 내용을 찾을 수 없습니다.');
    if (request.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
    if (url.pathname === '/api/account/config') return json({ emailAvailable: Boolean(mailer), registrationAvailable: Boolean(mailer), guardianConsentAvailable: guardian.enabled, guardianConsentMethod: guardian.method, socialProviders, socialSignupAvailable: Boolean(mailer) && socialProviders.length > 0 });
    if (url.pathname === '/api/account/grain') {
      if (url.search) fail(422, 'INVALID_INPUT', '그레인 조회에는 추가 항목을 보낼 수 없습니다.');
      const session = await auth.api.getSession({ headers: request.headers });
      const user = activeAccountUser(db, session?.user);
      if (!user) fail(401, 'UNAUTHORIZED', '로그인 후 이용해 주세요.');
      return json(grain.wallet(user.id));
    }
    if (url.pathname === '/api/account/session') {
      const session = await auth.api.getSession({ headers: request.headers });
      const user = activeAccountUser(db, session?.user);
      return json({ user: user ? accountUser(user) : null });
    }
    fail(404, 'NOT_FOUND', '요청한 내용을 찾을 수 없습니다.');
  }
  return { sendVerification, sendReset, verifyEmail, requireEmail, handle };
}
