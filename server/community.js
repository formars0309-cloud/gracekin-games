import { randomUUID } from 'node:crypto';
import { canWriteCommunity, activeAccountUser } from './account.js';
import { fail, json, readJson, text } from './security.js';
import { kstDate, reserveCommunityReward } from './grain-rewards.js';

export const NOTICE_CATEGORIES = ['devnote', 'changes', 'event', 'guide'];
// 실제 경로와 타일 자르기 좌표는 화면에서 관리합니다.
export const NOTICE_COVERS = {
  gyeongguk: ['tile-free', 'tile-deck', 'tile-strategy', 'tile-notice', 'card-lubu', 'card-diaochan', 'card-zhugeliang'],
  slimeline: ['tiles', 'hero'],
};
export const POST_STATUSES = ['checking', 'solved', 'applied'];
const sqlValues = values => values.map(value => `'${value}'`).join(',');
const postsTable = name => `CREATE TABLE ${name} (
  id TEXT PRIMARY KEY, game TEXT NOT NULL CHECK(game IN ('slimeline','gyeongguk')),
  board TEXT NOT NULL CHECK(board IN ('free','guide','gallery','deck','strategy','notice')),
  title TEXT NOT NULL, body TEXT NOT NULL, authorId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, hiddenAt INTEGER,
  category TEXT CHECK(category IN (${sqlValues(NOTICE_CATEGORIES)})),
  cover TEXT CHECK((game='gyeongguk' AND cover IN (${sqlValues(NOTICE_COVERS.gyeongguk)})) OR (game='slimeline' AND cover IN (${sqlValues(NOTICE_COVERS.slimeline)}))),
  status TEXT CHECK(status IN (${sqlValues(POST_STATUSES)})),
  CHECK(board='notice' OR (category IS NULL AND cover IS NULL))
)`;

// 서버가 요청·보상 타이머를 받기 전, 전용 연결에서만 실행합니다.
export function initializeCommunityPosts(db) {
  const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='community_posts'").get();
  if (!schema) {
    db.exec(postsTable('community_posts'));
    return;
  }
  const columns = db.prepare('PRAGMA table_info(community_posts)').all().map(column => column.name);
  if (['category', 'cover', 'status'].every(name => columns.includes(name)) && /'notice'/.test(schema.sql)) return;
  if (db.isTransaction) throw new Error('커뮤니티 DB 이전은 기존 트랜잭션 밖에서 실행해야 합니다.');
  const foreignKeys = db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  // 부모 테이블 삭제가 댓글·감사 기록을 연쇄 삭제하지 않게 잠시 끕니다.
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const objects = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='community_posts' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all();
      db.exec(postsTable('community_posts_phase2'));
      const names = columns.map(name => `"${name.replaceAll('"', '""')}"`).join(',');
      // 보상 중복 판정에 쓰이는 기존 rowid 순서도 보존합니다.
      db.exec(`INSERT INTO community_posts_phase2(rowid,${names}) SELECT rowid,${names} FROM community_posts;
        DROP TABLE community_posts;
        ALTER TABLE community_posts_phase2 RENAME TO community_posts;`);
      for (const { sql } of objects) db.exec(sql);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('커뮤니티 DB 이전의 외래키 검사에 실패했습니다.');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.exec(`PRAGMA foreign_keys=${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

const BOARDS = { slimeline: ['free', 'guide', 'gallery', 'notice'], gyeongguk: ['free', 'deck', 'strategy', 'notice'] };
const postFields = includeHidden => `p.*, u.name AS authorName, (SELECT COUNT(*) FROM community_comments c WHERE c.postId=p.id ${includeHidden ? '' : 'AND c.hiddenAt IS NULL'}) AS commentCount`;
const REPORT_REASONS = new Set(['도배·광고','욕설·괴롭힘','개인정보 노출','계정·그레인 거래','버그·보안 제보 공개','기타']);

export function initializeCommunitySchema(db) {
  initializeCommunityPosts(db);
  db.exec(`
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
  function postData(row, user) { return { id: row.id, game: row.game, board: row.board, category: row.category, cover: row.cover, status: row.status, title: row.title, body: row.body, author: { name: row.authorName, isOperator: Boolean(isAdmin({ id: row.authorId })) }, createdAt: row.createdAt, updatedAt: row.updatedAt, commentCount: row.commentCount, ...(isAdmin(user) ? { hiddenAt: row.hiddenAt } : {}), canEdit: row.board === 'notice' ? Boolean(isAdmin(user)) : row.authorId === user?.id }; }
  function commentData(row, user) { return { id: row.id, postId: row.postId, body: row.body, author: { name: row.authorName, isOperator: Boolean(isAdmin({ id: row.authorId })) }, createdAt: row.createdAt, updatedAt: row.updatedAt, ...(isAdmin(user) ? { hiddenAt: row.hiddenAt } : {}), canEdit: row.authorId === user?.id }; }
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
  function noticePermission(b, user) {
    if (b === 'notice' && !isAdmin(user)) fail(403, 'ADMIN_REQUIRED', '새 소식은 운영자만 변경할 수 있습니다.');
  }
  function editPost(row, user) {
    noticePermission(row.board, user);
    if (row.board !== 'notice') owner(row, user);
  }
  function valueOf(value, allowed, label) {
    if (value !== null && !allowed.includes(value)) fail(422, 'INVALID_INPUT', `${label}을 확인해 주세요.`);
    return value;
  }
  function metadata(body, g, b, previous = {}) {
    const category = valueOf(body.category === undefined ? previous.category ?? null : body.category, NOTICE_CATEGORIES, '말머리');
    const cover = valueOf(body.cover === undefined ? previous.cover ?? null : body.cover, NOTICE_COVERS[g], '대표 그림');
    if (b !== 'notice' && (category !== null || cover !== null)) fail(422, 'INVALID_INPUT', '말머리와 대표 그림은 새 소식에서만 사용할 수 있습니다.');
    return { category, cover };
  }
  function rejectStatus(body) {
    if (Object.hasOwn(body, 'status')) fail(422, 'INVALID_INPUT', '처리 상태는 전용 경로에서 변경해 주세요.');
  }
  function owner(row, user) { if (row.authorId !== user.id) fail(403, 'FORBIDDEN', '본인이 작성한 글과 댓글만 변경할 수 있습니다.'); }

  return async function handle(request, url) {
    const path = url.pathname;
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    const user = activeAccountUser(db, session?.user && db.prepare('SELECT id,name,emailVerified,ageBand FROM user WHERE id=?').get(session.user.id));
    if (path === '/api/community/session' && request.method === 'GET') return json({ user: user ? { id: user.id, name: user.name, canWriteCommunity: canWriteCommunity(user), isOperator: Boolean(isAdmin(user)) } : null });
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
        noticePermission(b, user);
        rejectStatus(body);
        const { category, cover } = metadata(body, g, b);
        const title = text(body.title, 2, 100, '제목'), content = text(body.body, 1, 10000, '본문');
        const id = randomUUID(), time = now(), stamp = new Date(time).toISOString();
        const reward = transaction(() => {
          db.prepare('INSERT INTO community_posts(id,game,board,title,body,authorId,createdAt,updatedAt,category,cover) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, g, b, title, content, user.id, stamp, stamp, category, cover);
          return reserveCommunityReward(db, rewards, { user, type: 'post', row: { id, title, body: content }, time });
        });
        return json({ post: postData(post(id, null, user), user), reward }, 201);
      }
    }
    const statusMatch = path.match(/^\/api\/community\/posts\/([a-zA-Z0-9-]{1,80})\/status$/);
    if (statusMatch && request.method === 'PATCH') {
      if (!isAdmin(user)) fail(403, 'ADMIN_REQUIRED', '운영자만 처리 상태를 변경할 수 있습니다.');
      const row = post(statusMatch[1], expectedGame, user), body = await readJson(request);
      if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'status')) fail(422, 'INVALID_INPUT', '처리 상태만 입력해 주세요.');
      const status = valueOf(body.status, POST_STATUSES, '처리 상태');
      db.prepare('UPDATE community_posts SET status=?,updatedAt=? WHERE id=?').run(status, new Date(now()).toISOString(), row.id);
      return json({ post: postData(post(row.id, null, user), user) });
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
        editPost(row, user);
        const body = await readJson(request);
        rejectStatus(body);
        const { category, cover } = metadata(body, row.game, row.board, row);
        const title = text(body.title, 2, 100, '제목'), content = text(body.body, 1, 10000, '본문');
        db.prepare('UPDATE community_posts SET title=?,body=?,category=?,cover=?,updatedAt=? WHERE id=?').run(title, content, category, cover, new Date(now()).toISOString(), row.id);
        return json({ post: postData(post(row.id, null, user), user) });
      }
      if (request.method === 'DELETE') { editPost(row, user); db.prepare('DELETE FROM community_posts WHERE id=?').run(row.id); return json({ ok: true }); }
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
