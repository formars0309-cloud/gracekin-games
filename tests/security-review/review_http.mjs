/** 격리된 로컬 DB와 임시 포트로 인증·소유권·공개 경계를 독립 검수한다. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const serverRoot = resolve(process.argv[2] || '.');
const { startServer } = await import(pathToFileURL(join(serverRoot, 'server/app.js')));
const directory = await mkdtemp(join(tmpdir(), 'gracekin-independent-review-'));
const password = randomBytes(24).toString('base64url');
const emailA = `${randomBytes(8).toString('hex')}@review.invalid`;
const emailB = `${randomBytes(8).toString('hex')}@review.invalid`;
let app, limited, isolated;
let checks = 0;
const status = (response, expected, label) => { assert.equal(response.status, expected, label); checks += 1; };
const publicBody = response => { assert.ok(!/"(?:email|token|password|hash|salt)"\s*:/i.test(JSON.stringify(response.body)), '공개 응답의 인증 개인정보 비노출'); checks += 1; };
const cookieFrom = response => (response.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
function call(server, path, { method = 'GET', body, cookie, origin = server.origin, headers = {}, chunked = false } = {}) {
  const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path, headers: {
      ...(method === 'GET' || method === 'HEAD' ? {} : { 'content-type': 'application/json', ...(origin ? { origin } : {}) }),
      ...(data === undefined || chunked ? {} : { 'content-length': Buffer.byteLength(data) }),
      ...(cookie ? { cookie } : {}), ...headers,
    } }, res => {
      const parts = [];
      res.on('data', part => parts.push(part));
      res.on('end', () => { const text = Buffer.concat(parts).toString('utf8'); let body; try { body = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, body, text }); });
    });
    req.on('error', reject);
    if (chunked && data) { req.write(data.slice(0, 32768)); req.end(data.slice(32768)); } else req.end(data);
  });
}
try {
  app = await startServer({ port: 0, dataDir: join(directory, 'db'), rateLimit: { authMax: 80, writeMax: 120 } });
  status(await call(app, '/api/community/session'), 200, '비회원 세션');
  const signA = await call(app, '/api/auth/sign-up/email', { method: 'POST', body: { name: '검수회원하나', email: emailA, password } });
  status(signA, 200, '실제 회원가입 A');
  const cookieA = cookieFrom(signA); assert.ok(cookieA, 'A 세션 쿠키 설정');
  assert.ok(signA.headers['set-cookie'].every(value => /HttpOnly/i.test(value) && /SameSite=Lax/i.test(value)), '쿠키 보호 속성'); checks += 1;
  const signB = await call(app, '/api/auth/sign-up/email', { method: 'POST', body: { name: '검수회원둘', email: emailB, password } });
  status(signB, 200, '실제 회원가입 B'); const cookieB = cookieFrom(signB); assert.ok(cookieB, 'B 세션 쿠키 설정');
  const session = await call(app, '/api/community/session', { cookie: cookieA }); status(session, 200, '가입 후 실제 세션'); publicBody(session); assert.equal(session.body.user.name, '검수회원하나');
  const input = { game: 'slimeline', board: 'free', title: '독립 검수 글', body: '<img src=x onerror=alert(1)><script>window.__review=1</script>', authorId: signB.body.user.id };
  status(await call(app, '/api/community/posts', { method: 'POST', body: input }), 401, '비회원 글쓰기 차단');
  const created = await call(app, '/api/community/posts', { method: 'POST', cookie: cookieA, body: input }); status(created, 201, '회원 글 작성'); publicBody(created);
  const postId = created.body.post.id; assert.match(postId, /^[a-f0-9-]{36}$/i); assert.equal(created.body.post.author.id, session.body.user.id, '클라이언트 작성자 위조 무시'); checks += 2;
  const comment = await call(app, `/api/community/posts/${postId}/comments?game=slimeline`, { method: 'POST', cookie: cookieB, body: { body: '독립 검수 댓글', authorId: session.body.user.id } }); status(comment, 201, '다른 계정 댓글 작성'); publicBody(comment); const commentId = comment.body.comment.id;
  for (const method of ['PATCH', 'DELETE']) {
    status(await call(app, `/api/community/posts/${postId}?game=slimeline`, { method, cookie: cookieB, body: { title: '권한 위조', body: '변경' } }), 403, '다른 회원의 글 변경 차단');
    status(await call(app, `/api/community/comments/${commentId}?game=slimeline`, { method, cookie: cookieA, body: { body: '권한 위조' } }), 403, '다른 회원의 댓글 변경 차단');
    status(await call(app, `/api/community/posts/${postId}?game=gyeongguk`, { method, cookie: cookieA, body: { title: '타게임 변경', body: '본문' } }), 404, '타게임 글 변경 차단');
  }
  status(await call(app, `/api/community/posts/${postId}?game=gyeongguk`), 404, '타게임 글 읽기 차단');
  status(await call(app, `/api/community/comments/${commentId}?game=gyeongguk`, { method: 'DELETE', cookie: cookieB, body: {} }), 404, '타게임 댓글 변경 차단');
  const wrongList = await call(app, '/api/community/posts?game=gyeongguk&board=free'); assert.equal(wrongList.body.total, 0, '타게임 목록 격리'); checks += 1;
  const detail = await call(app, `/api/community/posts/${postId}?game=slimeline`); status(detail, 200, '공개 글·댓글 조회'); publicBody(detail); assert.equal(detail.body.post.body, input.body, 'XSS는 JSON 원문으로 보존'); assert.equal(detail.body.comments.length, 1); checks += 2;
  const injection = await call(app, '/api/community/posts?game=slimeline&board=free&q=%27%20OR%201%3D1--'); status(injection, 200, 'SQL 검색 입력 바인딩'); assert.equal(injection.body.total, 0); checks += 1;
  for (const origin of [null, 'https://other.invalid']) status(await call(app, '/api/community/posts', { method: 'POST', cookie: cookieA, origin, body: input }), 403, 'CSRF Origin 차단');
  status(await call(app, '/api/auth/sign-out', { method: 'POST', cookie: cookieA, origin: 'https://other.invalid', body: {} }), 403, '인증 CSRF 차단');
  status(await call(app, '/api/community/posts', { method: 'POST', cookie: cookieA, headers: { 'sec-fetch-site': 'cross-site' }, body: input }), 403, '교차 사이트 표시 차단');
  status(await call(app, '/api/community/session', { headers: { host: 'other.invalid' } }), 403, 'Host 위조 차단');
  status(await call(app, '/api/community/posts', { method: 'POST', cookie: cookieA, headers: { 'content-type': 'text/plain' }, body: input }), 415, '본문 형식 제한');
  status(await call(app, '/api/community/posts', { method: 'POST', cookie: cookieA, body: JSON.stringify({ body: 'a'.repeat(70000) }), chunked: true }), 413, '길이 헤더 없는 대형 본문 차단');
  status(await call(app, '/api/auth/sign-up/email', { method: 'POST', body: { name: ' ', email: `${randomBytes(8).toString('hex')}@review.invalid`, password } }), 422, '서버 닉네임 검증');
  status(await call(app, '/api/community/posts', { method: 'POST', cookie: cookieA, body: { ...input, board: 'notice' } }), 422, '회원 공지 위조 차단');
  for (const path of ['/.env', '/.data/community.sqlite', '/server/app.js', '/test/community.test.js', '/node_modules/better-auth/package.json', '/package-lock.json', '/README.md', '/.handoff/private.md', '/assets/%2e%2e/server/app.js', '/assets/%252e%252e/server/app.js']) status(await call(app, path), 404, '정적 비공개 경로 차단');
  const db = new DatabaseSync(join(directory, 'db/community.sqlite'), { readOnly: true });
  try { assert.ok(db.prepare('SELECT password FROM account LIMIT 1').get().password !== password, '비밀번호는 평문 저장하지 않음'); checks += 1; } finally { db.close(); }
  for (const file of ['auth-secret', 'community.sqlite']) { assert.equal((await stat(join(directory, 'db', file))).mode & 0o777, 0o600, '인증 파일 권한'); checks += 1; }
  const oldPort = app.port; await app.close(); app = await startServer({ port: oldPort, dataDir: join(directory, 'db') });
  const restored = await call(app, '/api/community/session', { cookie: cookieA }); assert.equal(restored.body.user.name, '검수회원하나', '재시작 후 실제 세션 유지'); checks += 1;
  const restoredPost = await call(app, `/api/community/posts/${postId}?game=slimeline`); assert.equal(restoredPost.body.comments.length, 1, '재시작 후 글·댓글 유지'); checks += 1;
  const logout = await call(app, '/api/auth/sign-out', { method: 'POST', cookie: cookieA, body: {} }); status(logout, 200, '실제 로그아웃');
  assert.equal((await call(app, '/api/community/session', { cookie: cookieA })).body.user, null, '로그아웃 세션 무효화'); checks += 1;
  const login = await call(app, '/api/auth/sign-in/email', { method: 'POST', body: { email: emailA, password } }); status(login, 200, '실제 재로그인');
  const root = join(directory, 'static'); await mkdir(join(root, 'assets'), { recursive: true }); await mkdir(join(root, 'server')); await writeFile(join(root, 'index.html'), '<h1>격리 검수</h1>'); await writeFile(join(root, 'server/private.js'), '비공개'); await symlink(join(root, 'server/private.js'), join(root, 'assets/escape.js'));
  isolated = await startServer({ port: 0, rootDir: root, dataDir: join(directory, 'static-db') }); status(await call(isolated, '/assets/escape.js'), 404, '정적 symlink 우회 차단');
  limited = await startServer({ port: 0, dataDir: join(directory, 'limited-db'), rateLimit: { authMax: 1, readMax: 1 } });
  status(await call(limited, '/api/community/session'), 200, '읽기 속도 제한 첫 요청'); status(await call(limited, '/api/community/session'), 429, '읽기 속도 제한');
  await call(limited, '/api/auth/sign-in/email', { method: 'POST', body: {} }); status(await call(limited, '/api/auth/sign-in/email', { method: 'POST', body: {} }), 429, '인증 남용 속도 제한');
  console.log(`독립 HTTP 검수 통과: ${checks}개 확인 (임시 DB·포트, 실제 가입·세션·글·댓글·재시작)`);
} catch (error) {
  // 응답 본문·쿠키·임의 비밀번호를 AssertionError 전체와 함께 출력하지 않는다.
  console.error('독립 HTTP 검수 실패:', error.message?.split('\n')[0] || '확인 필요');
  process.exitCode = 1;
} finally {
  await limited?.close(); await isolated?.close(); await app?.close();
  await rm(directory, { recursive: true, force: true });
}
