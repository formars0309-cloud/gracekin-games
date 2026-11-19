import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { accountAge, activeAccountUser } from '../account.js';
import { fail, json, readJson, safePath, text, HttpError, trustedClientIP } from '../security.js';
import { loadVillageMap } from './map.js';
import { createVillageStore, fields, PALETTE, DEFAULT_AVATAR, PHRASES, EMOTES } from './store.js';
import { containsBlockedWord } from './filter.js';
import { villageAdmission, startVillageCleanup } from './policy.js';

const CAPACITY = 50, MAX_SPEED = 4, RETAIN_MS = 10 * 60 * 1000;

export async function createVillage({ server, db, auth, root, origin, legacyHosts, production, isAdmin, now = Date.now, trustFlyProxy = false, opensAt }) {
  const { spawn, walkable } = await loadVillageMap(root);
  const store = createVillageStore(db, now), players = new Map(), channels = new Map(), pending = new Set(), handshakes = new Map(), rateBuckets = new Map();
  const admission = villageAdmission(db, { opensAt, now, isAdmin });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false, closeTimeout: 1000 });
  const cleanupTimer = startVillageCleanup(store.cleanup);
  let closing = false;
  const allowedHost = new URL(origin).host, localOrigins = new Set();
  if (!production) {
    const port = new URL(origin).port || '80';
    for (const name of ['localhost', '127.0.0.1', '[::1]']) for (const localPort of new Set([port, '8766'])) localOrigins.add(`http://${name}:${localPort}`);
  }
  function currentUser(userId) { return activeAccountUser(db, db.prepare('SELECT id,name,emailVerified,ageBand FROM user WHERE id=?').get(userId)); }
  async function authenticate(headers) {
    const session = await auth.api.getSession({ headers, query: { disableRefresh: true } });
    const user = session?.user && currentUser(session.user.id);
    if (!user) fail(401, 'AUTH_REQUIRED', '로그인 후 마을에 입장해 주세요.');
    return { user, sessionId: session.session.id };
  }
  function validPlayer(player) {
    if (players.get(player.user.id) !== player) return false;
    const row = db.prepare('SELECT expiresAt,userId FROM session WHERE id=?').get(player.sessionId);
    const user = row?.userId === player.user.id && Number(new Date(row.expiresAt)) > Date.now() && currentUser(player.user.id);
    if (!user) { send(player, { type: 'error', code: 'AUTH_REQUIRED', message: '로그인 또는 보호자 동의 상태를 확인해 주세요.' }); player.ws.close(4001, '인증 만료'); return false; }
    player.user = user;
    try { admission.assert(user); }
    catch (error) { send(player, { type: 'error', code: error.code, message: error.message }); player.ws.close(4003, '마을 입장 제한'); return false; }
    return true;
  }
  function channel(id) {
    if (!channels.has(id)) channels.set(id, { id, players: new Set(), dirty: new Set(), removed: new Set(), history: [] });
    return channels.get(id);
  }
  channel(1);
  const channelList = () => [...channels.values()].map(room => ({ id: room.id, count: room.players.size, capacity: CAPACITY }));
  function send(player, value) {
    if (player.ws.readyState !== WebSocket.OPEN) return;
    if (player.ws.bufferedAmount > 262144) { player.ws.terminate(); return; }
    player.ws.send(JSON.stringify(value));
  }
  function broadcast(room, value, senderId = null) {
    for (const id of room.players) {
      const recipient = players.get(id);
      // 수신 시점의 연령을 다시 읽어 접속 뒤 연령 정보가 바뀌어도 자유 대화를 보내지 않습니다.
      if (recipient && value.type === 'chat' && value.kind === 'free' && (!validPlayer(recipient) || accountAge(recipient.user) === 'under14')) continue;
      if (recipient && (!senderId || !store.blocked(id, senderId))) send(recipient, value);
    }
  }
  function announceChannels() { const value = { type: 'channels', channels: channelList() }; for (const player of players.values()) send(player, value); }
  function publicPlayer(player) { return { id: player.user.id, name: player.user.name, x: player.x, y: player.y, avatar: player.avatar, moving: player.path.length > 0 }; }
  function leaveRoom(player) {
    const room = channel(player.channelId);
    room.players.delete(player.user.id); room.dirty.delete(player.user.id); room.removed.add(player.user.id);
  }
  function enterRoom(player, room) {
    player.channelId = room.id; player.x = spawn.x; player.y = spawn.y; player.path = []; player.nextStepAt = performance.now() + 1000 / MAX_SPEED;
    room.players.add(player.user.id); room.removed.delete(player.user.id); room.dirty.add(player.user.id);
    send(player, { type: 'welcome', selfId: player.user.id, channelId: room.id, players: [...room.players].map(id => publicPlayer(players.get(id))), channels: channelList(), maxSpeed: MAX_SPEED });
    announceChannels();
  }
  function correction(player, message = '서버 위치로 돌아왔습니다. 다시 이동해 주세요.') {
    player.path = []; channel(player.channelId).dirty.add(player.user.id);
    send(player, { type: 'correction', x: player.x, y: player.y, code: 'INVALID_MOVE', message });
  }
  function movement(player, message) {
    if (Object.keys(message).some(key => !['type', 'path'].includes(key)) || !Array.isArray(message.path) || message.path.length > 120 || message.path.some(point => !point || Object.keys(point).some(key => !['x', 'y'].includes(key)) || !walkable(point.x, point.y))) return correction(player);
    let path = message.path;
    const currentIndex = path.findIndex(point => point.x === player.x && point.y === player.y);
    if (currentIndex >= 0) path = path.slice(currentIndex + 1);
    let previous = player;
    for (const point of path) { if (Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) !== 1) return correction(player); previous = point; }
    const wasMoving = player.path.length > 0;
    player.path = path.map(point => ({ x: point.x, y: point.y }));
    // 이동 명령을 반복해도 이전 스텝의 시간 제한은 초기화하지 않습니다.
    player.nextStepAt = Math.max(player.nextStepAt, performance.now() + (wasMoving ? 0 : 1000 / MAX_SPEED));
    channel(player.channelId).dirty.add(player.user.id);
  }
  function consume(player, group, capacity, refillMs) {
    const time = performance.now();
    let member = rateBuckets.get(player.user.id);
    if (!member) { member = { usedAt: time, groups: new Map() }; rateBuckets.set(player.user.id, member); }
    member.usedAt = time;
    const bucket = member.groups.get(group) ?? { tokens: capacity, time };
    bucket.tokens = Math.min(capacity, bucket.tokens + (time - bucket.time) / refillMs); bucket.time = time; member.groups.set(group, bucket);
    if (bucket.tokens < 1) fail(429, 'RATE_LIMITED', '조금 천천히 보내 주세요.');
    bucket.tokens--;
  }
  function receive(player, raw, binary) {
    if (closing || !validPlayer(player)) return;
    try {
      consume(player, 'all', 40, 50);
      if (binary) fail(422, 'INVALID_MESSAGE', '텍스트 요청만 보낼 수 있습니다.');
      let message;
      try { message = JSON.parse(raw.toString()); } catch { fail(422, 'INVALID_MESSAGE', '요청 내용을 확인해 주세요.'); }
      fields(message, ['type', 'path', 'text', 'id', 'channelId', 'x', 'y', 'speed']);
      if (message.type === 'move') return movement(player, message);
      if (message.type === 'channel') {
        fields(message, ['type', 'channelId']); consume(player, 'channel', 2, 2000);
        if (!Number.isSafeInteger(message.channelId) || message.channelId < 1 || message.channelId > channels.size + 1 || message.channelId > 100) fail(422, 'INVALID_CHANNEL', '입장할 채널을 확인해 주세요.');
        const next = channel(message.channelId);
        if (next.id === player.channelId) return;
        if (next.players.size >= CAPACITY) fail(409, 'CHANNEL_FULL', '채널이 가득 찼습니다. 다른 채널을 골라 주세요.');
        leaveRoom(player); enterRoom(player, next); return;
      }
      if (!['chat', 'phrase', 'emote'].includes(message.type)) fail(422, 'INVALID_MESSAGE', '지원하지 않는 요청입니다.');
      fields(message, message.type === 'chat' ? ['type', 'text'] : ['type', 'id']);
      if (store.muted(player.user.id)) fail(403, 'CHAT_MUTED', '현재 채팅과 감정표현을 사용할 수 없습니다.');
      consume(player, 'chat', 3, 1500);
      if (message.type === 'emote') {
        if (!EMOTES.some(item => item.id === message.id)) fail(422, 'INVALID_EMOTE', '감정표현을 선택해 주세요.');
        broadcast(channel(player.channelId), { type: 'emote', userId: player.user.id, id: message.id, at: now() }, player.user.id); return;
      }
      let content;
      if (message.type === 'phrase') {
        content = PHRASES.find(item => item.id === message.id)?.text;
        if (!content) fail(422, 'INVALID_PHRASE', '정해진 인사말을 골라 주세요.');
      } else {
        if (accountAge(player.user) === 'under14') fail(403, 'CHILD_FREE_CHAT', '어린이 회원은 인사말 버튼을 이용해 주세요.');
        content = text(message.text, 1, 80, '채팅');
        if (/[\u0000-\u001f\u007f]/.test(content)) fail(422, 'INVALID_INPUT', '줄바꿈 없이 채팅을 입력해 주세요.');
        if (containsBlockedWord(content)) fail(422, 'BLOCKED_WORD', '사용할 수 없는 말이 들어 있습니다. 다른 표현으로 보내 주세요.');
      }
      const room = channel(player.channelId), event = { type: 'chat', kind: message.type === 'phrase' ? 'phrase' : 'free', id: randomUUID(), userId: player.user.id, name: player.user.name, text: content, at: now() };
      room.history = room.history.filter(item => item.at > now() - RETAIN_MS); room.history.push(event); if (room.history.length > 50) room.history.shift();
      broadcast(room, event, player.user.id);
    } catch (error) { send(player, { type: 'error', code: error instanceof HttpError ? error.code : 'INTERNAL_ERROR', message: error instanceof HttpError ? error.message : '요청을 처리하지 못했습니다.' }); }
  }
  function refuse(socket, status) { if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 503 ? 'Service Unavailable' : 'Forbidden'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); }
  async function upgrade(request, socket, head) {
    const onError = () => {}; socket.on('error', onError);
    // 거부 응답을 쓰는 동안 TCP 연결이 끊겨도 처리되지 않은 오류를 내보내지 않습니다.
    const releaseError = () => socket.removeListener('error', onError);
    socket.once('close', releaseError);
    const timeout = setTimeout(() => socket.destroy(), 5000); timeout.unref(); pending.add(socket);
    try {
      if (closing || pending.size > 100) { refuse(socket, 503); return; }
      const path = safePath(request.url || '/');
      if (path !== '/api/village/ws' || request.url !== '/api/village/ws' || request.method !== 'GET' || request.headers.host !== allowedHost || legacyHosts.has(request.headers.host) || ![origin, ...localOrigins].includes(request.headers.origin)) { refuse(socket, 403); return; }
      const ip = trustedClientIP(socket.remoteAddress, request.headers, trustFlyProxy), time = Date.now();
      for (const [key, item] of handshakes) if (item.until <= time) handshakes.delete(key);
      if (handshakes.size > 10000) { refuse(socket, 503); return; }
      const bucket = handshakes.get(ip) ?? { count: 0, until: time + 60000 }; handshakes.set(ip, bucket);
      if (++bucket.count > 120) { refuse(socket, 403); return; }
      const headers = new Headers(); for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(key, value);
      const { user, sessionId } = await authenticate(headers);
      admission.assert(user);
      if (closing || socket.destroyed) return;
      // 비동기 인증 중 계정이 비활성화되거나 세션이 사라진 경우에도 입장하지 않습니다.
      if (!currentUser(user.id) || !db.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>?').get(sessionId, user.id, Date.now())) { refuse(socket, 401); return; }
      wss.handleUpgrade(request, socket, head, ws => {
        // 성공한 소켓에는 ws의 오류 처리기가 이미 연결되어 있습니다.
        releaseError(); socket.removeListener('close', releaseError);
        const old = players.get(user.id);
        if (old) { leaveRoom(old); old.ws.close(4002, '다른 창에서 입장'); }
        const player = { user, sessionId, ws, avatar: store.avatar(user.id)?.data ?? DEFAULT_AVATAR, path: [], alive: true };
        players.set(user.id, player);
        let room = [...channels.values()].find(item => item.players.size < CAPACITY);
        if (!room) room = channel(channels.size + 1);
        enterRoom(player, room);
        ws.on('message', (raw, binary) => receive(player, raw, binary));
        ws.on('pong', () => { player.alive = true; }); ws.on('error', () => {});
        ws.on('close', () => { if (players.get(user.id) !== player) return; leaveRoom(player); players.delete(user.id); if (!closing) announceChannels(); });
      });
    } catch (error) { refuse(socket, error instanceof HttpError ? error.status : 403); }
    finally { clearTimeout(timeout); pending.delete(socket); }
  }
  server.on('upgrade', upgrade);
  const tick = setInterval(() => {
    const time = performance.now();
    for (const player of players.values()) if (player.path.length && player.nextStepAt <= time) {
      if (!validPlayer(player)) { player.path = []; continue; }
      const point = player.path.shift();
      if (!walkable(point.x, point.y)) { correction(player); continue; }
      player.x = point.x; player.y = point.y; player.nextStepAt = time + 1000 / MAX_SPEED; channel(player.channelId).dirty.add(player.user.id);
    }
    for (const room of channels.values()) {
      if (room.dirty.size || room.removed.size) broadcast(room, { type: 'snapshot', players: [...room.dirty].map(id => players.get(id)).filter(player => player?.channelId === room.id).map(publicPlayer), removed: [...room.removed] });
      room.dirty.clear(); room.removed.clear(); room.history = room.history.filter(item => item.at > now() - RETAIN_MS);
    }
  }, 100); tick.unref();
  const heartbeat = setInterval(() => {
    // 재접속으로 도배 제한을 초기화하지 않으며 떠난 회원의 버킷은 10분 뒤 정리합니다.
    for (const [id, bucket] of rateBuckets) if (!players.has(id) && bucket.usedAt < performance.now() - RETAIN_MS) rateBuckets.delete(id);
    for (const player of players.values()) {
      if (!validPlayer(player)) continue;
      if (!player.alive) { player.ws.terminate(); continue; }
      player.alive = false; player.ws.ping();
    }
  }, 10000); heartbeat.unref();

  async function handle(request, url) {
    const path = url.pathname, admin = path.startsWith('/api/admin/village/');
    if (!path.startsWith('/api/village/') && !admin) return null;
    const { user } = await authenticate(request.headers);
    if (admin && !isAdmin(user)) fail(403, 'ADMIN_REQUIRED', '운영자 권한이 필요합니다.');
    // 기존 자료 조회·삭제는 열어 두되, 새 마을 자료를 만드는 차단 추가도 입장 조건을 따릅니다.
    if (['/api/village/session', '/api/village/avatar'].includes(path) || path === '/api/village/blocks' && request.method === 'POST') admission.assert(user);
    if (url.search) fail(422, 'INVALID_INPUT', '추가 조회 항목은 지원하지 않습니다.');
    if (path === '/api/village/session' && request.method === 'GET') return json({ user: { id: user.id, name: user.name, ageBand: accountAge(user), canFreeChat: accountAge(user) !== 'under14' }, opensAt: admission.opensAt, avatar: store.avatar(user.id), palette: PALETTE, phrases: PHRASES, emotes: EMOTES, channels: channelList() });
    if (path === '/api/village/avatar' && request.method === 'PUT') {
      const avatar = store.saveAvatar(user.id, await readJson(request));
      const player = players.get(user.id); if (player) { player.avatar = avatar.data; channel(player.channelId).dirty.add(user.id); }
      return json({ avatar });
    }
    if (path === '/api/village/blocks') {
      if (request.method === 'GET') return json({ blocks: db.prepare('SELECT b.targetId,u.name FROM village_blocks b JOIN user u ON u.id=b.targetId WHERE b.userId=? ORDER BY b.createdAt DESC').all(user.id) });
      if (['POST', 'DELETE'].includes(request.method)) {
        const body = fields(await readJson(request), ['targetId']), targetId = store.target(user.id, body.targetId);
        if (request.method === 'POST') db.prepare('INSERT OR IGNORE INTO village_blocks(userId,targetId,createdAt) VALUES(?,?,?)').run(user.id, targetId, now());
        else db.prepare('DELETE FROM village_blocks WHERE userId=? AND targetId=?').run(user.id, targetId);
        return json({ ok: true });
      }
    }
    if (path === '/api/village/reports' && request.method === 'POST') {
      const body = fields(await readJson(request), ['targetId', 'reason']), targetId = store.target(user.id, body.targetId), player = players.get(user.id), target = players.get(targetId);
      if (!player || !validPlayer(player)) fail(409, 'NOT_IN_VILLAGE', '마을에 입장한 뒤 신고해 주세요.');
      const room = channel(player.channelId), snapshot = room.history.filter(item => item.userId === targetId && item.at > now() - RETAIN_MS);
      if ((!target || target.channelId !== player.channelId) && !snapshot.length) fail(422, 'INVALID_TARGET', '같은 채널의 회원이나 최근 대화를 신고해 주세요.');
      return json({ report: store.report(user.id, targetId, player.channelId, body.reason, snapshot) }, 201);
    }
    if (path === '/api/admin/village/reports' && request.method === 'GET') return json({ reports: db.prepare(`SELECT r.*,a.name reporterName,b.name targetName FROM village_reports r JOIN user a ON a.id=r.reporterId JOIN user b ON b.id=r.targetId ORDER BY r.createdAt DESC LIMIT 100`).all().map(row => ({ ...row, snapshot: JSON.parse(row.snapshot) })) });
    if (path === '/api/admin/village/mutes' && request.method === 'POST') {
      const body = fields(await readJson(request), ['targetId', 'durationMinutes', 'reason']);
      const targetId = text(body.targetId, 1, 128, '대상 회원'), reason = text(body.reason, 2, 500, '처리 사유');
      if (!db.prepare('SELECT 1 FROM user WHERE id=?').get(targetId)) fail(404, 'NOT_FOUND', '회원을 찾을 수 없습니다.');
      if (!Number.isInteger(body.durationMinutes) || body.durationMinutes < 0 || body.durationMinutes > 10080) fail(422, 'INVALID_INPUT', '채팅 금지 시간은 0~10080분으로 입력해 주세요.');
      const until = now() + body.durationMinutes * 60000;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO village_mutes(userId,until,reason,actorId,createdAt) VALUES(?,?,?,?,?) ON CONFLICT(userId) DO UPDATE SET until=excluded.until,reason=excluded.reason,actorId=excluded.actorId,createdAt=excluded.createdAt').run(targetId, until, reason, user.id, now());
        db.prepare('INSERT INTO village_admin_audit(id,actorId,targetId,action,until,reason,createdAt) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), user.id, targetId, body.durationMinutes ? 'mute' : 'unmute', until, reason, now()); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      const player = players.get(targetId); if (player) send(player, { type: 'notice', message: body.durationMinutes ? `${body.durationMinutes}분 동안 채팅과 감정표현 사용이 제한됩니다.` : '채팅 제한이 해제되었습니다.' });
      return json({ mute: { userId: targetId, until } });
    }
    fail(404, 'NOT_FOUND', '마을 요청을 찾을 수 없습니다.');
  }
  async function close() {
    if (closing) return; closing = true; clearInterval(tick); clearInterval(heartbeat); clearInterval(cleanupTimer);
    for (const socket of pending) socket.destroy(); pending.clear();
    for (const player of players.values()) { send(player, { type: 'shutdown', message: '잠시 뒤 다시 연결해 주세요.' }); player.ws.close(1012, '잠시 뒤 다시 연결'); }
    await new Promise(resolve => wss.close(resolve)); players.clear(); channels.clear(); rateBuckets.clear();
    server.off('upgrade', upgrade);
  }
  return { handle, close };
}
