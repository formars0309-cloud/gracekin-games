import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server/app.js';
import { request, cookieFrom, registerAndLogin } from './account-helpers.js';
import http from 'node:http';
import { CONSENT_VERSION } from '../server/guardian.js';

// 운영 자격증명과 무관한 격리 시험용 서명 키입니다.
const fixtureKey = 'village-local-integration-fixture-only-2026-11-19';
let signupIP = 1;
export { request };
export const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export const avatar = { v: 1, kind: 'placeholder', colors: { skin: '#ffe0bd', hair: '#49352f', outfit: '#8db9d3' } };

export async function scenario(callback, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'gracekin-village-')), mailbox = [], sockets = [];
  let app, db, time = options.initialTime ?? Date.now();
  const startOptions = { port: 0, dataDir: folder, secret: fixtureKey, mailer: async mail => mailbox.push(mail), now: () => time, trustFlyProxy: true, flyAppName: 'gracekin-games-community',
    guardianReplyTo: 'guardian@example.test', villageOpensAt: '2000-01-01T00:00:00Z', rateLimit: { authMax: 500, readMax: 5000, writeMax: 5000 }, ...options };
  try {
    app = await startServer(startOptions);
    db = new DatabaseSync(join(folder, 'community.sqlite')); db.exec('PRAGMA foreign_keys=ON');
    const signup = async (suffix = 'member') => {
      const response = await registerAndLogin(app, mailbox, { name: `마을회원${suffix}`, email: `village-${suffix}@example.test`, password: '마을시험전용-1234-password', ageBand: '14plus' }, { 'fly-client-ip': `198.51.100.${signupIP++}` });
      assert.equal(response.status, 200);
      return { id: response.body.user.id, cookie: cookieFrom(response), response };
    };
    const connect = (member, headers) => openSocket(app, member?.cookie, headers, sockets);
    await callback({ app, db, mailbox, folder, signup, connect, sockets, now: () => time, advance: amount => { time += amount; }, async restart() { await app.close(); app = await startServer(startOptions); return app; }, async stop() { const running = app; app = null; await running.close(); } });
  } finally {
    await Promise.all(sockets.map(socket => socket.close()));
    db?.close(); await app?.close(); await rm(folder, { recursive: true, force: true });
  }
}

export function upgradeStatus(app, cookie, headers = {}) {
  // 내장 WebSocket이 Host를 URL로 고정하므로 옛 Host 경계는 실제 업그레이드 HTTP로 확인합니다.
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: app.port, path: '/api/village/ws', headers: { host: new URL(app.origin).host, origin: app.origin,
      connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': Buffer.alloc(16).toString('base64'), cookie, ...headers } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('upgrade', (_, socket) => { socket.destroy(); resolve(101); }); request.on('error', reject); request.end();
  });
}

export function seedMember(db, templateId, suffix, { child = false, userId, consentVersion = CONSENT_VERSION } = {}) {
  // 인원 경계 시험은 51번 비밀번호 해시 계산 대신 실제 인증 스키마에 세션을 준비합니다.
  // 서명된 쿠키는 프로덕션과 같은 better-auth getSession 경로에서 검증됩니다.
  const id = userId ?? randomUUID(), token = randomUUID(), user = { ...db.prepare('SELECT * FROM user WHERE id=?').get(templateId), id, name: `광장회원${suffix}`, email: `seed-${suffix}@example.test` };
  const userColumns = Object.keys(user);
  db.prepare(`INSERT INTO user(${userColumns.map(key => `"${key}"`).join(',')}) VALUES(${userColumns.map(() => '?').join(',')})`).run(...userColumns.map(key => user[key]));
  if (child) {
    db.prepare("UPDATE user SET ageBand='under14' WHERE id=?").run(id);
    db.prepare(`INSERT INTO guardian_requests(id,capabilityHash,status,createdAt,expiresAt,consentVersion,consentText,childUserId) VALUES(?,?,'used',?,?,?, ?,?)`).run(randomUUID(), randomUUID(), Date.now(), Date.now() + 86400000, consentVersion, '격리 시험의 유효한 보호자 동의', id);
  }
  const session = { ...db.prepare('SELECT * FROM session WHERE userId=? LIMIT 1').get(templateId), id: randomUUID(), token, userId: id, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86400000 };
  const columns = Object.keys(session);
  db.prepare(`INSERT INTO session(${columns.map(key => `"${key}"`).join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(key => session[key]));
  const signature = createHmac('sha256', fixtureKey).update(token).digest('base64');
  return { id, cookie: `gracekin.session_token=${encodeURIComponent(`${token}.${signature}`)}` };
}

export async function openSocket(app, cookie, overrides = {}, collection = []) {
  // Node 24 내장 WebSocket은 두 번째 인자의 headers를 지원합니다. ws 클라이언트를 사용하지 않습니다.
  const socket = new WebSocket(app.origin.replace(/^http/, 'ws') + '/api/village/ws', { headers: { origin: app.origin, ...(cookie ? { cookie } : {}), ...overrides } });
  const messages = [], waiting = [];
  const closeEvent = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data); messages.push(message);
    for (const item of [...waiting]) if (item.predicate(message)) { clearTimeout(item.timer); waiting.splice(waiting.indexOf(item), 1); item.resolve(message); }
  });
  const peer = {
    socket, messages, closeEvent,
    send: message => socket.send(JSON.stringify(message)),
    wait(predicate, timeout = 4000) {
      const found = messages.find(predicate); if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const item = { predicate, resolve, timer: setTimeout(() => { waiting.splice(waiting.indexOf(item), 1); reject(new Error(`마을 메시지 대기 만료: ${predicate.toString()} (수신 종류: ${messages.map(row => row.type).join(',')})`)); }, timeout) };
        waiting.push(item);
      });
    },
    async close() { if (socket.readyState === WebSocket.CLOSED) return; socket.close(); await Promise.race([closeEvent, delay(1500)]); },
  };
  collection.push(peer);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('마을 연결 대기 만료')); }, 4000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('마을 연결 거부')); }, { once: true });
  });
  return peer;
}
