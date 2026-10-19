import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile, stat, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { registerAndLogin } from './account-helpers.js';
const mailbox = [];
const mailer = async message => mailbox.push(message);

let app, directory, alice = '', bob = '', postId, commentId;
const password = '테스트전용-기억하기-1234';
const changedPassword = '테스트전용-바꾸기-5678';
const hostile = '<script>alert("문자 그대로")</script>';

function request(server, path, { method = 'GET', body, cookie, origin = true, headers = {} } = {}) {
  const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, path: path.replace(/[^\x00-\x7f]/gu, character => encodeURIComponent(character)), method, headers: {
      host: new URL(server.origin).host,
      ...(method !== 'GET' && method !== 'HEAD' ? { 'content-type': 'application/json', ...(origin ? { origin: typeof origin === 'string' ? origin : server.origin } : {}) } : {}),
      ...(data === undefined ? {} : { 'content-length': Buffer.byteLength(data) }),
      ...(cookie ? { cookie } : {}), ...headers,
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let value; try { value = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: value, text });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}
function cookieFrom(response) { return (response.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; '); }
function noSecrets(value) {
  assert.doesNotMatch(JSON.stringify(value), /"(?:password|hash|salt)"\s*:/i);
}
function publicResponse(value) {
  noSecrets(value);
  assert.doesNotMatch(JSON.stringify(value), /"email"\s*:/i);
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gracekin-community-'));
  app = await startServer({ port: 0, dataDir: directory, mailer, rateLimit: { authMax: 100, writeMax: 200 } });
});
after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true }); });

test('비회원 읽기와 쓰기 인증 제한', async () => {
  const session = await request(app, '/api/community/session');
  assert.equal(session.status, 200); assert.deepEqual(session.body, { user: null });
  const listing = await request(app, '/api/community/posts?game=slimeline&board=free');
  assert.deepEqual(listing.body, { posts: [], page: 1, pageSize: 20, total: 0 });
  const forbidden = await request(app, '/api/community/posts', { method: 'POST', body: { game: 'slimeline', board: 'free', title: '제목', body: '본문' } });
  assert.equal(forbidden.status, 401);
});

test('닉네임 우회·잘못된 입력을 서버에서 거부', async () => {
  for (const name of [' ', '가', '가'.repeat(25)]) {
    const res = await request(app, '/api/auth/sign-up/email', { method: 'POST', body: { ageBand: '14plus', name, email: 'invalid@example.test', password } });
    assert.equal(res.status, 422); assert.equal(typeof res.body.error.message, 'string');
  }
  const tooShort = await request(app, '/api/auth/sign-up/email', { method: 'POST', body: { ageBand: '14plus', name: '확인용', email: 'invalid@example.test', password: '짧음' } });
  assert.ok(tooShort.status >= 400); noSecrets(tooShort.body);
  const updateBypass = await request(app, '/api/auth/update-user', { method: 'POST', body: { name: '가' } });
  assert.equal(updateBypass.status, 404);
});

test('두 계정 이메일 확인 후 세션·쿠키·암호 비노출', async () => {
  const a = await registerAndLogin(app, mailbox, { ageBand: '14plus', name: '  달빛산책  ', email: 'alice@example.test', password });
  assert.equal(a.status, 200); noSecrets(a.body); alice = cookieFrom(a); assert.ok(alice);
  assert.equal(a.body.user.name, '달빛산책');
  for (const cookie of a.headers['set-cookie']) { assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); }
  const b = await registerAndLogin(app, mailbox, { ageBand: '14plus', name: '별빛독서', email: 'bob@example.test', password });
  assert.equal(b.status, 200); noSecrets(b.body); bob = cookieFrom(b);
  const session = await request(app, '/api/community/session', { cookie: alice });
  assert.equal(session.body.user.name, '달빛산책'); publicResponse(session.body);
  assert.equal((await stat(join(directory, 'auth-secret'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(directory, 'community.sqlite'))).mode & 0o777, 0o600);
  const secret = await readFile(join(directory, 'auth-secret'), 'utf8'); assert.ok(secret.length >= 32);
  const db = new DatabaseSync(join(directory, 'community.sqlite'));
  try { const stored = db.prepare('SELECT password FROM account LIMIT 1').get().password; assert.notEqual(stored, password); assert.ok(stored.length > 30); }
  finally { db.close(); }
});

test('회원 글 작성·공유·검색과 XSS 문자열 보존', async () => {
  const created = await request(app, '/api/community/posts', { method: 'POST', cookie: alice, body: { game: 'slimeline', board: 'free', title: '달빛 산책 이야기', body: hostile, authorId: '위조값' } });
  assert.equal(created.status, 201); publicResponse(created.body); postId = created.body.post.id;
  assert.equal(created.body.post.body, hostile); assert.equal(created.body.post.canEdit, true);
  const listed = await request(app, '/api/community/posts?game=slimeline&board=free&q=달빛&page=1', { cookie: bob });
  assert.equal(listed.body.total, 1); assert.equal(listed.body.posts[0].canEdit, false); publicResponse(listed.body);
  assert.ok(!Number.isNaN(Date.parse(listed.body.posts[0].createdAt)));
  const guest = await request(app, `/api/community/posts/${postId}?game=slimeline`);
  assert.equal(guest.status, 200); assert.equal(guest.body.post.body, hostile); assert.equal(guest.body.post.canEdit, false);
  const injection = await request(app, '/api/community/posts?game=slimeline&board=free&q=%27%20OR%201%3D1--');
  assert.equal(injection.body.total, 0);
});

test('두 계정 댓글 공유·소유권·수정/삭제 권한', async () => {
  const created = await request(app, `/api/community/posts/${postId}/comments?game=slimeline`, { method: 'POST', cookie: bob, body: { body: hostile, authorId: '위조값' } });
  assert.equal(created.status, 201); commentId = created.body.comment.id; publicResponse(created.body);
  const detail = await request(app, `/api/community/posts/${postId}?game=slimeline`, { cookie: alice });
  assert.equal(detail.body.post.commentCount, 1); assert.equal(detail.body.comments[0].body, hostile); assert.equal(detail.body.comments[0].canEdit, false); publicResponse(detail.body);
  for (const method of ['PATCH', 'DELETE']) {
    assert.equal((await request(app, `/api/community/posts/${postId}`, { method, cookie: bob, body: { title: '가로채기', body: '변경' } })).status, 403);
    assert.equal((await request(app, `/api/community/comments/${commentId}`, { method, cookie: alice, body: { body: '가로채기' } })).status, 403);
  }
  const edit = await request(app, `/api/community/posts/${postId}`, { method: 'PATCH', cookie: alice, body: { title: '산책 기록 수정', body: '수정한 본문' } });
  assert.equal(edit.status, 200); assert.equal(edit.body.post.title, '산책 기록 수정');
  const commentEdit = await request(app, `/api/community/comments/${commentId}`, { method: 'PATCH', cookie: bob, body: { body: '고친 댓글' } });
  assert.equal(commentEdit.status, 200); assert.equal(commentEdit.body.comment.body, '고친 댓글');
});

test('notice 위조·게임별 게시판·타게임 접근·페이지 한도 차단', async () => {
  for (const input of [{ game: 'slimeline', board: 'notice' }, { game: 'slimeline', board: 'deck' }, { game: 'gyeongguk', board: 'gallery' }, { game: 'other', board: 'free' }]) {
    assert.equal((await request(app, '/api/community/posts', { method: 'POST', cookie: alice, body: { ...input, title: '공지 위조', body: '본문' } })).status, input.board === 'notice' ? 403 : 422);
  }
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    assert.equal((await request(app, `/api/community/posts/${postId}?game=gyeongguk`, { method, cookie: alice, body: method === 'GET' ? undefined : { title: '수정 내용', body: '본문' } })).status, 404);
  }
  assert.equal((await request(app, `/api/community/comments/${commentId}?game=gyeongguk`, { method: 'DELETE', cookie: bob, body: {} })).status, 404);
  assert.equal((await request(app, '/api/community/posts?game=gyeongguk&board=free')).body.total, 0);
  for (const page of ['0', '-1', '1.5', '1000000', 'Infinity']) assert.equal((await request(app, `/api/community/posts?game=slimeline&board=free&page=${page}`)).status, 422);
  for (const body of [{ title: '가', body: '본문' }, { title: '제목', body: '' }, { title: '가'.repeat(101), body: '본문' }, { title: '제목', body: '가'.repeat(10001) }]) assert.equal((await request(app, '/api/community/posts', { method: 'POST', cookie: alice, body: { game: 'slimeline', board: 'free', ...body } })).status, 422);
  assert.equal((await request(app, `/api/community/posts/${postId}/comments`, { method: 'POST', cookie: bob, body: { body: '가'.repeat(1001) } })).status, 422);
});

test('Origin·JSON·대형 요청 보호는 인증 API에도 적용', async () => {
  for (const path of ['/api/community/posts', '/api/auth/sign-out']) {
    for (const origin of [false, 'https://other.example']) assert.equal((await request(app, path, { method: 'POST', cookie: alice, origin, body: {} })).status, 403);
    assert.equal((await request(app, path, { method: 'POST', cookie: alice, headers: { 'sec-fetch-site': 'cross-site' }, body: {} })).status, 403);
    assert.equal((await request(app, path, { method: 'POST', cookie: alice, headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await request(app, path, { method: 'POST', cookie: alice, body: JSON.stringify({ body: 'a'.repeat(70000) }) })).status, 413);
  }
  assert.equal((await request(app, '/api/auth/sign-in/email', { method: 'POST', body: '{' })).status, 400);
});

test('없는 글과 댓글은 404', async () => {
  assert.equal((await request(app, '/api/community/posts/missing?game=slimeline')).status, 404);
  assert.equal((await request(app, '/api/community/posts/missing', { method: 'DELETE', cookie: alice, body: {} })).status, 404);
  assert.equal((await request(app, '/api/community/comments/missing', { method: 'PATCH', cookie: bob, body: { body: '없음' } })).status, 404);
});

test('Content-Length 없는 chunked 대형 요청도 413 응답', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.request(app.origin + '/api/auth/sign-up/email', { method: 'POST', headers: { origin: app.origin, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.write('{"body":"'); req.write('a'.repeat(70000)); req.end('"}');
  });
  assert.equal(status, 413);
});

test('로그아웃·재로그인·비밀번호 변경', async () => {
  const logout = await request(app, '/api/auth/sign-out', { method: 'POST', cookie: alice, body: {} });
  assert.equal(logout.status, 200);
  assert.deepEqual((await request(app, '/api/community/session', { cookie: alice })).body, { user: null });
  const invalid = await request(app, '/api/auth/sign-in/email', { method: 'POST', body: { email: 'alice@example.test', password: '잘못된-비밀번호' } });
  assert.equal(invalid.status, 401); assert.ok(invalid.body.error.message); noSecrets(invalid.body);
  const login = await request(app, '/api/auth/sign-in/email', { method: 'POST', body: { email: 'alice@example.test', password } });
  assert.equal(login.status, 200); noSecrets(login.body); alice = cookieFrom(login);
  const changed = await request(app, '/api/auth/change-password', { method: 'POST', cookie: alice, body: { currentPassword: password, newPassword: changedPassword, revokeOtherSessions: true } });
  assert.equal(changed.status, 200); noSecrets(changed.body); alice = cookieFrom(changed) || alice;
});

test('서버 재시작 뒤 세션과 글/댓글 지속', async () => {
  const oldPort = app.port;
  await app.close();
  app = await startServer({ port: oldPort, dataDir: directory, mailer, rateLimit: { authMax: 100 } });
  assert.equal((await request(app, '/api/community/session', { cookie: alice })).body.user.name, '달빛산책');
  const detail = await request(app, `/api/community/posts/${postId}?game=slimeline`, { cookie: bob });
  assert.equal(detail.body.post.title, '산책 기록 수정'); assert.equal(detail.body.comments[0].body, '고친 댓글');
  const login = await request(app, '/api/auth/sign-in/email', { method: 'POST', body: { email: 'alice@example.test', password: changedPassword } });
  assert.equal(login.status, 200); alice = cookieFrom(login);
});

test('자기 댓글 삭제·글 삭제시 댓글 연쇄 삭제', async () => {
  const deleted = await request(app, `/api/community/comments/${commentId}`, { method: 'DELETE', cookie: bob, body: {} });
  assert.deepEqual(deleted.body, { ok: true });
  const added = await request(app, `/api/community/posts/${postId}/comments`, { method: 'POST', cookie: bob, body: { body: '연쇄 삭제 확인' } });
  assert.equal(added.status, 201);
  const removed = await request(app, `/api/community/posts/${postId}`, { method: 'DELETE', cookie: alice, body: {} });
  assert.deepEqual(removed.body, { ok: true });
  const db = new DatabaseSync(join(directory, 'community.sqlite'));
  try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_comments WHERE postId=?').get(postId).n, 0); } finally { db.close(); }
});

test('정적 파일 allowlist·일반/인코딩 경로 탈출·symlink 보호', async () => {
  const allowed = await request(app, '/'); assert.equal(allowed.status, 200); assert.match(allowed.headers['content-type'], /text\/html/);
  assert.equal((await request(app, '/assets/favicon.svg')).status, 200);
  for (const path of ['/.git/config', '/.handoff/인계.md', '/.env', '/.data/community.sqlite', '/node_modules/better-auth/package.json', '/server/app.js', '/test/community.test.js', '/README.md', '/AGENTS.md', '/package.json', '/games/../server/app.js', '/assets/%2e%2e/server/app.js', '/assets/%252e%252e/server/app.js', '/assets/%2E%2E%2Fserver/app.js', '/assets/%5c..%5cserver%5capp.js', '//server/app.js', '/assets/%00.png']) {
    const res = await request(app, encodeURI(path).replaceAll('%25','%'));
    assert.equal(res.status, 404, path);
  }
  const mockRoot = await mkdtemp(join(tmpdir(), 'gracekin-static-'));
  let isolated;
  try {
    await mkdir(join(mockRoot, 'assets')); await mkdir(join(mockRoot, 'server'));
    await writeFile(join(mockRoot, 'index.html'), '<h1>정적 검사</h1>'); await writeFile(join(mockRoot, 'server', 'private.js'), '기밀');
    await symlink(join(mockRoot, 'server', 'private.js'), join(mockRoot, 'assets', 'escape.js'));
    isolated = await startServer({ port: 0, rootDir: mockRoot, dataDir: join(mockRoot, '.data') });
    assert.equal((await request(isolated, '/assets/escape.js')).status, 404);
  } finally { await isolated?.close(); await rm(mockRoot, { recursive: true, force: true }); }
});

test('인증과 일반 API 속도 제한·운영 비밀키 필수·Secure 쿠키', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-limit-'));
  let limited;
  try {
    limited = await startServer({ port: 0, dataDir: folder, rateLimit: { authMax: 1, readMax: 1 } });
    assert.equal((await request(limited, '/api/community/session')).status, 200);
    assert.equal((await request(limited, '/api/community/session')).status, 429);
    await request(limited, '/api/auth/sign-in/email', { method: 'POST', body: {} });
    assert.equal((await request(limited, '/api/auth/sign-in/email', { method: 'POST', body: {} })).status, 429);
  } finally { await limited?.close(); await rm(folder, { recursive: true, force: true }); }
  const prodDir = await mkdtemp(join(tmpdir(), 'gracekin-production-'));
  let production;
  try {
    await assert.rejects(startServer({ port: 0, dataDir: prodDir, nodeEnv: 'production', baseURL: 'https://community.example.test' }), /BETTER_AUTH_SECRET/);
    production = await startServer({ port: 0, dataDir: prodDir, nodeEnv: 'production', baseURL: 'https://community.example.test', secret: randomBytes(48).toString('base64url'), mailer });
    const signup = await registerAndLogin(production, mailbox, { ageBand: '14plus', name: '운영확인', email: 'secure@example.test', password });
    assert.equal(signup.status, 200);
    assert.ok(signup.headers['set-cookie'].every(cookie => /; Secure/i.test(cookie)));
    noSecrets(signup.body);
  } finally { await production?.close(); await rm(prodDir, { recursive: true, force: true }); }
});
