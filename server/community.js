import { randomUUID } from 'node:crypto';
import { canWriteCommunity, activeAccountUser } from './account.js';
import { fail, json, readJson, text } from './security.js';
import { kstDate, reserveCommunityReward } from './grain-rewards.js';

const BOARDS = { slimeline: ['free', 'guide', 'gallery'], gyeongguk: ['free', 'deck', 'strategy'] };
const postFields = includeHidden => `p.*, u.name AS authorName, (SELECT COUNT(*) FROM community_comments c WHERE c.postId=p.id ${includeHidden ? '' : 'AND c.hiddenAt IS NULL'}) AS commentCount`;
const REPORT_REASONS = new Set(['도배·광고','욕설·괴롭힘','개인정보 노출','계정·그레인 거래','버그·보안 제보 공개','기타']);

export function initializeCommunitySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS community_posts (
      id TEXT PRIMARY KEY, game TEXT NOT NULL CHECK(game IN ('slimeline','gyeongguk')),
      board TEXT NOT NULL CHECK(board IN ('free','guide','gallery','deck','strategy')),
      title TEXT NOT NULL, body TEXT NOT NULL, authorId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS community_posts_game_board ON community_posts(game, board, createdAt DESC, id DESC);
    CREATE TABLE IF NOT EXISTS community_comments (
      id TEXT PRIMARY KEY, postId TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      body TEXT NOT NULL, authorId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS community_comments_post ON community_comments(postId, createdAt, id);
    CREATE TABLE IF NOT EXISTS community_reports (
      id TEXT PRIMARY KEY, reporterId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      targetType TEXT NOT NULL CHECK(targetType IN ('post','comment')), targetId TEXT NOT NULL,
      reason TEXT NOT NULL, description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','dismissed','resolved')),
      createdAt INTEGER NOT NULL, reviewedAt INTEGER,
      UNIQUE(reporterId,targetType,targetId)
    );
    CREATE INDEX IF NOT EXISTS community_reports_reporter_time ON community_reports(reporterId,createdAt);
    CREATE INDEX IF NOT EXISTS community_reports_status ON community_reports(status,createdAt);

  `);
  for (const table of ['community_posts', 'community_comments']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'hiddenAt')) db.exec(`ALTER TABLE ${table} ADD COLUMN hiddenAt INTEGER`);
  }
}

export function createCommunity(db, auth, { rewards, isAdmin = () => false, now = Date.now } = {}) {
  initializeCommunitySchema(db);
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function game(value) { if (!Object.hasOwn(BOARDS, value)) fail(422, 'INVALID_GAME', '게임을 확인해 주세요.'); return value; }
  function board(g, value) { if (!BOARDS[g].includes(value)) fail(422, 'INVALID_BOARD', '이 게시판에는 글을 작성할 수 없습니다.'); return value; }
  function postData(row, user) { return { id: row.id, game: row.game, board: row.board, title: row.title, body: row.body, author: { id: row.authorId, name: row.authorName }, createdAt: row.createdAt, updatedAt: row.updatedAt, commentCount: row.commentCount, ...(isAdmin(user) ? { hiddenAt: row.hiddenAt } : {}), canEdit: row.authorId === user?.id }; }
  function commentData(row, user) { return { id: row.id, postId: row.postId, body: row.body, author: { id: row.authorId, name: row.authorName }, createdAt: row.createdAt, updatedAt: row.updatedAt, ...(isAdmin(user) ? { hiddenAt: row.hiddenAt } : {}), canEdit: row.authorId === user?.id }; }
  function post(id, expectedGame, user) {
    const row = db.prepare(`SELECT ${postFields(isAdmin(user))} FROM community_posts p JOIN user u ON u.id=p.authorId WHERE p.id=?`).get(id);
    if (!row || (row.hiddenAt !== null && !isAdmin(user)) || (expectedGame && row.game !== expectedGame)) fail(404, 'NOT_FOUND', '글을 찾을 수 없습니다.');
    return row;
  }
  function comment(id, expectedGame, user) {
    const row = db.prepare(`SELECT c.*, u.name AS authorName, p.game, p.hiddenAt AS parentHiddenAt FROM community_comments c JOIN user u ON u.id=c.authorId JOIN community_posts p ON p.id=c.postId WHERE c.id=?`).get(id);
    if (!row || ((row.hiddenAt !== null || row.parentHiddenAt !== null) && !isAdmin(user)) || (expectedGame && row.game !== expectedGame)) fail(404, 'NOT_FOUND', '댓글을 찾을 수 없습니다.');
    return row;
  }
  function owner(row, user) { if (row.authorId !== user.id) fail(403, 'FORBIDDEN', '본인이 작성한 글과 댓글만 변경할 수 있습니다.'); }

  return async function handle(request, url) {
    const path = url.pathname;
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    const user = activeAccountUser(db, session?.user && db.prepare('SELECT id,name,emailVerified,ageBand FROM user WHERE id=?').get(session.user.id));
    if (path === '/api/community/session' && request.method === 'GET') return json({ user: user ? { id: user.id, name: user.name, canWriteCommunity: canWriteCommunity(user) } : null });
    const isWrite = ['POST', 'PATCH', 'DELETE'].includes(request.method);
    if (isWrite && !user) fail(401, 'AUTH_REQUIRED', '로그인 후 이용해 주세요.');
    if (isWrite && !canWriteCommunity(user)) fail(403, 'COMMUNITY_WRITE_RESTRICTED', '현재 이 계정은 게시판 읽기만 이용할 수 있습니다.');
    const expectedGame = url.searchParams.has('game') ? game(url.searchParams.get('game')) : null;

    if (path === '/api/community/reports' && request.method === 'POST') {
      if (url.search) fail(422, 'INVALID_INPUT', '신고 항목을 확인해 주세요.');
      const body = await readJson(request);
      if (Object.keys(body).some(key => !['targetType','targetId','reason','description'].includes(key)) || !['post','comment'].includes(body.targetType) || typeof body.targetId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.targetId) || !REPORT_REASONS.has(body.reason)) fail(422, 'INVALID_INPUT', '신고 대상과 사유를 확인해 주세요.');
      const description = body.description === undefined ? '' : text(body.description, 0, 500, '설명');
      const result = transaction(() => {
        const row = body.targetType === 'post' ? post(body.targetId, null, user) : comment(body.targetId, null, user);
        if (row.authorId === user.id) fail(403, 'SELF_REPORT_FORBIDDEN', '본인이 작성한 내용은 신고할 수 없습니다.');
        if (db.prepare('SELECT 1 FROM community_reports WHERE reporterId=? AND targetType=? AND targetId=?').get(user.id, body.targetType, body.targetId)) fail(409, 'ALREADY_REPORTED', '이미 신고한 내용입니다.');
        const time = now(), start = Date.parse(`${kstDate(time)}T00:00:00+09:00`);
        if (db.prepare('SELECT COUNT(*) AS count FROM community_reports WHERE reporterId=? AND createdAt>=? AND createdAt<?').get(user.id, start, start + 86400000).count >= 20) fail(429, 'REPORT_LIMIT_REACHED', '신고는 하루 20회까지 접수할 수 있습니다.');
        const id = randomUUID();
        db.prepare("INSERT INTO community_reports(id,reporterId,targetType,targetId,reason,description,status,createdAt) VALUES(?,?,?,?,?,?,'pending',?)").run(id, user.id, body.targetType, body.targetId, body.reason, description, time);
        return { id, status: 'pending' };
      });
      return json({ report: result }, 201);
    }

    if (path === '/api/community/posts') {
      if (request.method === 'GET') {
        const g = game(url.searchParams.get('game'));
        const b = board(g, url.searchParams.get('board') || 'free');
        const q = (url.searchParams.get('q') || '').trim();
        if ([...q].length > 100) fail(422, 'INVALID_SEARCH', '검색어는 100자 이하로 입력해 주세요.');
        const pageString = url.searchParams.get('page') || '1';
        if (!/^[1-9]\d{0,5}$/.test(pageString)) fail(422, 'INVALID_PAGE', '페이지 번호를 확인해 주세요.');
        const page = Number(pageString), pageSize = 20;
        const search = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
        const where = `p.game=? AND p.board=? ${isAdmin(user) ? '' : 'AND p.hiddenAt IS NULL'} AND (p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')`;
        const args = [g, b, search, search];
        const total = db.prepare(`SELECT COUNT(*) AS total FROM community_posts p WHERE ${where}`).get(...args).total;
        const rows = db.prepare(`SELECT ${postFields(isAdmin(user))} FROM community_posts p JOIN user u ON u.id=p.authorId WHERE ${where} ORDER BY p.createdAt DESC,p.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
        return json({ posts: rows.map(row => postData(row, user)), page, pageSize, total });
      }
      if (request.method === 'POST') {
        const body = await readJson(request), g = game(body.game), b = board(g, body.board);
        const title = text(body.title, 2, 100, '제목'), content = text(body.body, 1, 10000, '본문');
        const id = randomUUID(), time = now(), stamp = new Date(time).toISOString();
        const reward = transaction(() => {
          db.prepare('INSERT INTO community_posts(id,game,board,title,body,authorId,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)').run(id, g, b, title, content, user.id, stamp, stamp);
          return reserveCommunityReward(db, rewards, { user, type: 'post', row: { id, title, body: content }, time });
        });
        return json({ post: postData(post(id, null, user), user), reward }, 201);
      }
    }
    let match = path.match(/^\/api\/community\/posts\/([a-zA-Z0-9-]{1,80})$/);
    if (match) {
      if (request.method === 'GET') {
        const g = game(url.searchParams.get('game')), row = post(match[1], g, user);
        const comments = db.prepare(`SELECT c.*,u.name AS authorName FROM community_comments c JOIN user u ON u.id=c.authorId WHERE c.postId=? ${isAdmin(user) ? '' : 'AND c.hiddenAt IS NULL'} ORDER BY c.createdAt,c.id`).all(row.id);
        return json({ post: postData(row, user), comments: comments.map(row => commentData(row, user)) });
      }
      const row = post(match[1], expectedGame, user);
      if (request.method === 'PATCH') {
        owner(row, user);
        const body = await readJson(request), title = text(body.title, 2, 100, '제목'), content = text(body.body, 1, 10000, '본문');
        db.prepare('UPDATE community_posts SET title=?,body=?,updatedAt=? WHERE id=?').run(title, content, new Date(now()).toISOString(), row.id);
        return json({ post: postData(post(row.id, null, user), user) });
      }
      if (request.method === 'DELETE') { owner(row, user); db.prepare('DELETE FROM community_posts WHERE id=?').run(row.id); return json({ ok: true }); }
    }
    match = path.match(/^\/api\/community\/posts\/([a-zA-Z0-9-]{1,80})\/comments$/);
    if (match && request.method === 'POST') {
      const row = post(match[1], expectedGame, user), body = await readJson(request), content = text(body.body, 1, 1000, '댓글');
      const id = randomUUID(), time = now(), stamp = new Date(time).toISOString();
      const reward = transaction(() => {
        db.prepare('INSERT INTO community_comments(id,postId,body,authorId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(id, row.id, content, user.id, stamp, stamp);
        return reserveCommunityReward(db, rewards, { user, type: 'comment', row: { id, postId: row.id, body: content }, time });
      });
      return json({ comment: commentData(comment(id, null, user), user), reward }, 201);
    }
    match = path.match(/^\/api\/community\/comments\/([a-zA-Z0-9-]{1,80})$/);
    if (match && ['PATCH', 'DELETE'].includes(request.method)) {
      const row = comment(match[1], expectedGame, user); owner(row, user);
      if (request.method === 'DELETE') { db.prepare('DELETE FROM community_comments WHERE id=?').run(row.id); return json({ ok: true }); }
      const body = await readJson(request), content = text(body.body, 1, 1000, '댓글');
      db.prepare('UPDATE community_comments SET body=?,updatedAt=? WHERE id=?').run(content, new Date(now()).toISOString(), row.id);
      return json({ comment: commentData(comment(row.id, null, user), user) });
    }
    fail(404, 'NOT_FOUND', '요청한 내용을 찾을 수 없습니다.');
  };
}
