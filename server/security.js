import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isIP } from 'node:net';

export const CLIENT_IP_HEADER = 'x-community-client-ip';
export const FLY_COMMUNITY_APP = 'gracekin-games-community';

export function normalizeClientIP(value) {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6 || ip.includes('%')) return null;
  try {
    // 같은 IPv6 주소의 축약·대소문자·IPv4 매핑 표기를 한 가지로 맞춥니다.
    const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const mapped = normalized.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
    if (!mapped) return normalized;
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  } catch { return null; }
}

export function trustedClientIP(socketIP, headers, trustFlyProxy) {
  // Fly HTTP 서비스가 추가하는 단일 IP만 사용하며 X-Forwarded-For는 파싱하지 않습니다.
  // 이 신뢰는 Fly Proxy를 통하는 전용 앱에서만 켭니다. 다른 CDN을 앞에 추가하면 재검토해야 합니다.
  const forwarded = trustFlyProxy ? normalizeClientIP(headers['fly-client-ip']) : null;
  return forwarded || normalizeClientIP(socketIP) || 'unknown';
}

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function fail(status, code, message) { throw new HttpError(status, code, message); }
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers,
  } });
}

export function errorResponse(error) {
  const known = error instanceof HttpError;
  return json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, known ? error.status : 500, known && error.status === 429 ? { 'retry-after': '60' } : {});
}

export function text(value, min, max, label) {
  if (typeof value !== 'string') fail(422, 'INVALID_INPUT', `${label}을 확인해 주세요.`);
  const normalized = value.trim();
  const length = [...normalized].length;
  if (length < min || length > max || normalized.includes('\0')) fail(422, 'INVALID_INPUT', `${label}은 ${min}~${max}자로 입력해 주세요.`);
  return normalized;
}

export async function readJson(request, limit = 65536) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail(415, 'JSON_REQUIRED', 'JSON 형식으로 요청해 주세요.');
  const declared = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(declared) || declared > limit) fail(413, 'PAYLOAD_TOO_LARGE', '요청 내용이 너무 큽니다.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'INVALID_JSON', '요청 내용을 확인해 주세요.');
  let size = 0;
  const parts = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        // 스트림 취소는 Node 연결까지 닫아 413 응답을 잃을 수 있으므로 잠금만 해제합니다.
        fail(413, 'PAYLOAD_TOO_LARGE', '요청 내용이 너무 큽니다.');
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail(400, 'INVALID_JSON', 'JSON 요청 내용을 확인해 주세요.'); }
}

// 서버가 신뢰 경계를 확인하고 덮어쓴 접속 IP별로 제한합니다.
export function createLimiter({ windowMs = 60000, authMax = 12, writeMax = 60, readMax = 240, maxKeys = 10000 } = {}) {
  const buckets = new Map();
  return (ip, path, method) => {
    const group = (path.startsWith('/api/auth/') || path.startsWith('/api/account/') && method !== 'GET') ? 'auth' : (method === 'GET' ? 'read' : 'write');
    const max = group === 'auth' ? authMax : group === 'read' ? readMax : writeMax;
    const now = Date.now();
    if (buckets.size >= maxKeys) {
      for (const [key, item] of buckets) if (item.until <= now) buckets.delete(key);
      if (buckets.size >= maxKeys) fail(429, 'RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    }
    const key = `${ip}:${group}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) { bucket = { count: 0, until: now + windowMs }; buckets.set(key, bucket); }
    if (++bucket.count > max) fail(429, 'RATE_LIMITED', '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  };
}

export function safePath(rawUrl) {
  const raw = rawUrl.split('?')[0];
  let path;
  try { path = decodeURIComponent(raw); } catch { fail(400, 'INVALID_PATH', '주소를 확인해 주세요.'); }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('%') || /[\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => part.startsWith('.'))) {
    fail(404, 'NOT_FOUND', '페이지를 찾을 수 없습니다.');
  }
  return path;
}

export async function loadSecret(dataDir, production, provided) {
  if (provided) {
    if (provided.length < 32) throw new Error('BETTER_AUTH_SECRET은 32자 이상이어야 합니다.');
    return provided;
  }
  if (production) throw new Error('운영 환경에는 BETTER_AUTH_SECRET 설정이 필요합니다.');
  const target = resolve(dataDir, 'auth-secret');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  try {
    const secret = (await readFile(target, 'utf8')).trim();
    if (secret.length < 32) throw new Error('개발용 비밀키 파일을 확인해 주세요.');
    await chmod(target, 0o600);
    return secret;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const secret = randomBytes(48).toString('base64url');
    try { await writeFile(target, secret, { mode: 0o600, flag: 'wx' }); }
    catch (race) { if (race.code !== 'EEXIST') throw race; return loadSecret(dataDir, false); }
    return secret;
  }
}
