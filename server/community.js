import { randomUUID } from 'node:crypto';
import { fail, json, readJson, text } from './security.js';

const BOARDS = { slimeline: ['free', 'guide', 'gallery'], gyeongguk: ['free', 'deck', 'strategy'] };
const POST_FIELDS = `p.*, u.name AS authorName, (SELECT COUNT(*) FROM community_comments c WHERE c.postId = p.id) AS commentCount`;

export function createCommunity(db, auth) {
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
  `);

  function game(value) { if (!Object.hasOwn(BOARDS, value)) fail(422, 'INVALID_GAME', '게임을 확인해 주세요.'); return value; }
  function board(g, value) { if (!BOARDS[g].includes(value)) fail(422, 'INVALID_BOARD', '이 게시판에는 글을 작성할 수 없습니다.'); return value; }
  function postData(row, user) { return { id: row.id, game: row.game, board: row.board, title: row.title, body: row.body, author: { id: row.authorId, name: row.authorName }, createdAt: row.createdAt, updatedAt: row.updatedAt, commentCount: row.commentCount, canEdit: row.authorId === user?.id }; }
  function commentData(row, user) { return { id: row.id, postId: row.postId, body: row.body, author: { id: row.authorId, name: row.authorName }, createdAt: row.createdAt, updatedAt: row.updatedAt, canEdit: row.authorId === user?.id }; }
  function post(id, expectedGame) {
    const row = db.prepare(`SELECT ${POST_FIELDS} FROM community_posts p JOIN user u ON u.id=p.authorId WHERE p.id=?`).get(id);
    if (!row || (expectedGame && row.game !== expectedGame)) fail(404, 'NOT_FOUND', '글을 찾을 수 없습니다.');
    return row;
  }
  function comment(id, expectedGame) {
    const row = db.prepare(`SELECT c.*, u.name AS authorName, p.game FROM community_comments c JOIN user u ON u.id=c.authorId JOIN community_posts p ON p.id=c.postId WHERE c.id=?`).get(id);
    if (!row || (expectedGame && row.game !== expectedGame)) fail(404, 'NOT_FOUND', '댓글을 찾을 수 없습니다.');
    return row;
  }
  function owner(row, user) { if (row.authorId !== user.id) fail(403, 'FORBIDDEN', '본인이 작성한 글과 댓글만 변경할 수 있습니다.'); }

  return async function handle(request, url) {
    const path = url.pathname;
    const session = await auth.api.getSession({ headers: request.headers });
    const user = session?.user || null;
    if (path === '/api/community/session' && request.method === 'GET') return json({ user: user ? { id: user.id, name: user.name } : null });
    const isWrite = ['POST', 'PATCH', 'DELETE'].includes(request.method);
    if (isWrite && !user) fail(401, 'AUTH_REQUIRED', '로그인 후 이용해 주세요.');
    const expectedGame = url.searchParams.has('game') ? game(url.searchParams.get('game')) : null;

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
        const where = `p.game=? AND p.board=? AND (p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')`;
        const args = [g, b, search, search];
        const total = db.prepare(`SELECT COUNT(*) AS total FROM community_posts p WHERE ${where}`).get(...args).total;
        const rows = db.prepare(`SELECT ${POST_FIELDS} FROM community_posts p JOIN user u ON u.id=p.authorId WHERE ${where} ORDER BY p.createdAt DESC,p.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
        return json({ posts: rows.map(row => postData(row, user)), page, pageSize, total });
      }
      if (request.method === 'POST') {
        const body = await readJson(request), g = game(body.game), b = board(g, body.board);
        const title = text(body.title, 2, 100, '제목'), content = text(body.body, 1, 10000, '본문');
        const id = randomUUID(), now = new Date().toISOString();
        db.prepare('INSERT INTO community_posts(id,game,board,title,body,authorId,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)').run(id, g, b, title, content, user.id, now, now);
        return json({ post: postData(post(id), user) }, 201);
      }
    }
    let match = path.match(/^\/api\/community\/posts\/([a-zA-Z0-9-]{1,80})$/);
    if (match) {
      if (request.method === 'GET') {
        const g = game(url.searchParams.get('game')), row = post(match[1], g);
        const comments = db.prepare('SELECT c.*,u.name AS authorName FROM community_comments c JOIN user u ON u.id=c.authorId WHERE c.postId=? ORDER BY c.createdAt,c.id').all(row.id);
        return json({ post: postData(row, user), comments: comments.map(row => commentData(row, user)) });
      }
      const row = post(match[1], expectedGame);
      if (request.method === 'PATCH') {
        owner(row, user);
        const body = await readJson(request), title = text(body.title, 2, 100, '제목'), content = text(body.body, 1, 10000, '본문');
        db.prepare('UPDATE community_posts SET title=?,body=?,updatedAt=? WHERE id=?').run(title, content, new Date().toISOString(), row.id);
        return json({ post: postData(post(row.id), user) });
      }
      if (request.method === 'DELETE') { owner(row, user); db.prepare('DELETE FROM community_posts WHERE id=?').run(row.id); return json({ ok: true }); }
    }
    match = path.match(/^\/api\/community\/posts\/([a-zA-Z0-9-]{1,80})\/comments$/);
    if (match && request.method === 'POST') {
      const row = post(match[1], expectedGame), body = await readJson(request), content = text(body.body, 1, 1000, '댓글');
      const id = randomUUID(), now = new Date().toISOString();
      db.prepare('INSERT INTO community_comments(id,postId,body,authorId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(id, row.id, content, user.id, now, now);
      return json({ comment: commentData(comment(id), user) }, 201);
    }
    match = path.match(/^\/api\/community\/comments\/([a-zA-Z0-9-]{1,80})$/);
    if (match && ['PATCH', 'DELETE'].includes(request.method)) {
      const row = comment(match[1], expectedGame); owner(row, user);
      if (request.method === 'DELETE') { db.prepare('DELETE FROM community_comments WHERE id=?').run(row.id); return json({ ok: true }); }
      const body = await readJson(request), content = text(body.body, 1, 1000, '댓글');
      db.prepare('UPDATE community_comments SET body=?,updatedAt=? WHERE id=?').run(content, new Date().toISOString(), row.id);
      return json({ comment: commentData(comment(row.id), user) });
    }
    fail(404, 'NOT_FOUND', '요청한 내용을 찾을 수 없습니다.');
  };
}
