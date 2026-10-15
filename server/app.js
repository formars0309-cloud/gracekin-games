import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, chmod, readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import { getMigrations } from 'better-auth/db/migration';
import { createCommunity } from './community.js';
import { CLIENT_IP_HEADER, FLY_COMMUNITY_APP, createLimiter, errorResponse, fail, json, loadSecret, readJson, safePath, text, trustedClientIP } from './security.js';

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const AUTH_PATHS = new Set(['/api/auth/sign-up/email', '/api/auth/sign-in/email', '/api/auth/sign-out', '/api/auth/change-password']);

function staticAllowed(path) {
  return path === '/index.html' || (/^\/(games|community|assets)\//.test(path) && Boolean(TYPES[extname(path)]));
}

async function serveStatic(request, path, root) {
  if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
  if (path === '/') path = '/index.html';
  if (path.endsWith('/') && /^\/(games|community)\//.test(path)) path += 'index.html';
  if (!staticAllowed(path)) fail(404, 'NOT_FOUND', '페이지를 찾을 수 없습니다.');
  let target;
  try {
    target = await realpath(resolve(root, `.${path}`));
    const rel = relative(root, target).split('\\').join('/');
    if (rel.startsWith('../') || rel.startsWith('/') || !staticAllowed(safePath(`/${rel}`))) fail(404, 'NOT_FOUND', '페이지를 찾을 수 없습니다.');
    if (!(await stat(target)).isFile()) fail(404, 'NOT_FOUND', '페이지를 찾을 수 없습니다.');
    const content = request.method === 'HEAD' ? null : await readFile(target);
    return new Response(content, { headers: { 'content-type': TYPES[extname(target)], 'cache-control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600' } });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code)) fail(404, 'NOT_FOUND', '페이지를 찾을 수 없습니다.');
    throw error;
  }
}

function hardened(response) {
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-frame-options', 'SAMEORIGIN');
  response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('cross-origin-resource-policy', 'same-origin');
  return response;
}

export async function startServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  const port = Number(options.port ?? process.env.PORT ?? 8766);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('서버 포트를 확인해 주세요.');
  const root = await realpath(options.rootDir ?? DEFAULT_ROOT);
  const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? resolve(DEFAULT_ROOT, '.data'));
  const production = (options.nodeEnv ?? process.env.NODE_ENV) === 'production';
  // 옵션은 프로세스 내부 설정이며 HTTP 헤더·쿼리로 활성화할 수 없습니다.
  const flyAppName = options.flyAppName ?? process.env.FLY_APP_NAME;
  const trustFlyProxy = (options.trustFlyProxy ?? (process.env.TRUST_FLY_PROXY === 'true')) === true && flyAppName === FLY_COMMUNITY_APP;
  const configuredURL = options.baseURL ?? process.env.BETTER_AUTH_URL;
  if (production && !configuredURL) throw new Error('운영 환경에는 BETTER_AUTH_URL 설정이 필요합니다.');
  if (configuredURL) {
    const url = new URL(configuredURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (production && url.protocol !== 'https:')) throw new Error('인증 서버 주소를 확인해 주세요. 운영 환경에는 HTTPS가 필요합니다.');
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700);
  const secret = await loadSecret(dataDir, production, options.secret ?? process.env.BETTER_AUTH_SECRET);
  let db, handler;
  const server = createServer((req, res) => {
    // URL 정규화 전에 원시 경로를 검사해 이중 인코딩과 경로 탈출을 막습니다.
    try {
      safePath(req.url || '/');
      if (!handler) { res.writeHead(503); res.end(); return; }
      const clientIP = trustedClientIP(req.socket.remoteAddress, req.headers, trustFlyProxy);
      // 외부에서 보낸 내부 헤더와 다른 IP 전달 헤더는 인증 라이브러리에 넘기지 않습니다.
      for (const name of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip', 'fly-client-ip', CLIENT_IP_HEADER]) delete req.headers[name];
      req.headers[CLIENT_IP_HEADER] = clientIP;
      void handler(req, res).catch(() => { if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '요청을 처리하지 못했습니다.' } })); } else res.end(); });
    } catch (error) {
      const response = errorResponse(error);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      void response.text().then(body => res.end(body));
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 80;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    const address = server.address();
    const localHost = host.includes(':') ? `[${host}]` : host;
    const origin = new URL(configuredURL || `http://${localHost}:${address.port}`).origin;
    const allowedHost = new URL(origin).host;
    db = new DatabaseSync(resolve(dataDir, 'community.sqlite'));
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    await chmod(resolve(dataDir, 'community.sqlite'), 0o600);
    const auth = betterAuth({
      appName: '그레이스킨게임즈', baseURL: origin, basePath: '/api/auth', secret, database: db,
      trustedOrigins: [origin], telemetry: { enabled: false }, logger: { disabled: true },
      emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true, requireEmailVerification: false },
      session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
      rateLimit: { enabled: true, window: 60, max: 30, customRules: {
        '/sign-up/email': { window: 60, max: 12 },
        '/sign-in/email': { window: 60, max: 12 },
      } },
      advanced: {
        cookiePrefix: 'gracekin', useSecureCookies: production,
        defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: production },
        ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER], ipv6Subnet: 128 },
      },
      databaseHooks: { user: {
        create: { before: async data => ({ data: { ...data, name: text(data.name, 2, 24, '닉네임') } }) },
        update: { before: async data => ({ data: { ...data, ...(Object.hasOwn(data, 'name') ? { name: text(data.name, 2, 24, '닉네임') } : {}) } }) },
      } },
    });
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();
    const community = createCommunity(db, auth);
    const limit = createLimiter(options.rateLimit);
    handler = toNodeHandler(async request => {
      try {
        const url = new URL(request.url), path = url.pathname;
        if (request.headers.get('host') !== allowedHost) fail(403, 'INVALID_HOST', '허용되지 않은 접속 주소입니다.');
        // 초기화 완료 여부만 확인하며 회원 DB 조회와 속도 제한 횟수를 소모하지 않습니다.
        if (path === '/health') {
          if (request.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
          return hardened(json({ ok: true }));
        }
        if (!path.startsWith('/api/')) return hardened(await serveStatic(request, safePath(path), root));
        limit(request.headers.get(CLIENT_IP_HEADER), path, request.method);
        if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method)) {
          if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'ORIGIN_FORBIDDEN', '같은 홈페이지에서 다시 요청해 주세요.');
          if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail(415, 'JSON_REQUIRED', 'JSON 형식으로 요청해 주세요.');
          const length = Number(request.headers.get('content-length') || 0);
          if (!Number.isFinite(length) || length > 65536) fail(413, 'PAYLOAD_TOO_LARGE', '요청 내용이 너무 큽니다.');
        }
        if (path.startsWith('/api/auth/')) {
          if (!AUTH_PATHS.has(path) || request.method !== 'POST') fail(404, 'NOT_FOUND', '인증 요청을 찾을 수 없습니다.');
          const body = await readJson(request);
          if (path === '/api/auth/sign-up/email') {
            if (body.ageConfirmed !== true) fail(422, 'AGE_CONFIRMATION_REQUIRED', '만 14세 이상인 경우에만 가입할 수 있습니다. 확인란을 선택해 주세요.');
            body.name = text(body.name, 2, 24, '닉네임');
            // 자기확인 응답은 가입 조건으로만 사용하며 나이·생년월일로 저장하지 않습니다.
            delete body.ageConfirmed;
          }
          // 본문 크기 검사를 마친 Request를 공식 Fetch 핸들러에 전달합니다.
          const response = await auth.handler(new Request(`${origin}${path}`, { method: 'POST', headers: request.headers, body: JSON.stringify(body) }));
          if (response.ok) return hardened(response);
          let code = 'AUTH_FAILED';
          try { const data = await response.json(); if (typeof data.code === 'string') code = data.code; } catch {}
          const messages = { INVALID_EMAIL_OR_PASSWORD: '이메일 또는 비밀번호를 확인해 주세요.', USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '사용할 수 없는 이메일입니다.', PASSWORD_TOO_SHORT: '비밀번호는 8자 이상 입력해 주세요.', PASSWORD_TOO_LONG: '비밀번호는 128자 이하로 입력해 주세요.', INVALID_PASSWORD: '현재 비밀번호를 확인해 주세요.' };
          return hardened(json({ error: { code, message: messages[code] || '인증 요청을 처리하지 못했습니다. 입력 내용을 확인해 주세요.' } }, response.status, response.status === 429 ? { 'retry-after': '60' } : {}));
        }
        if (path.startsWith('/api/community/')) return hardened(await community(request, url));
        fail(404, 'NOT_FOUND', '요청한 내용을 찾을 수 없습니다.');
      } catch (error) { return hardened(errorResponse(error)); }
    });
    return {
      server, origin, port: address.port,
      async close() {
        await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
        db.close();
      },
    };
  } catch (error) {
    await new Promise(resolve => server.close(() => resolve()));
    db?.close();
    throw error;
  }
}
