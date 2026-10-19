import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { access } from 'node:fs/promises';
import { createCommunity, initializeCommunitySchema, NOTICE_CATEGORIES, NOTICE_COVERS } from '../server/community.js';
import { createGrainRewards, REWARD_DAY_MS } from '../server/grain-rewards.js';
import { createGrainAdmin } from '../server/grain-admin.js';
import { createGrainService } from '../server/grain.js';
import { errorResponse } from '../server/security.js';

// 2단계 이전 main의 CHECK 제약과 열 구성을 그대로 재현합니다.
const oldSchema = `CREATE TABLE community_posts (
  id TEXT PRIMARY KEY, game TEXT NOT NULL CHECK(game IN ('slimeline','gyeongguk')),
  board TEXT NOT NULL CHECK(board IN ('free','guide','gallery','deck','strategy')),
  title TEXT NOT NULL, body TEXT NOT NULL, authorId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, hiddenAt INTEGER
);
CREATE INDEX community_posts_game_board ON community_posts(game,board,createdAt DESC,id DESC);
CREATE TABLE community_comments (
  id TEXT PRIMARY KEY, postId TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  body TEXT NOT NULL, authorId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, hiddenAt INTEGER
);
CREATE INDEX community_comments_post ON community_comments(postId,createdAt,id);
CREATE TABLE community_reports (
  id TEXT PRIMARY KEY, reporterId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  targetType TEXT NOT NULL CHECK(targetType IN ('post','comment')), targetId TEXT NOT NULL,
  reason TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','dismissed','resolved')),
  createdAt INTEGER NOT NULL, reviewedAt INTEGER, UNIQUE(reporterId,targetType,targetId)
);
CREATE INDEX community_reports_reporter_time ON community_reports(reporterId,createdAt);
CREATE INDEX community_reports_status ON community_reports(status,createdAt);`;
const initialTime = Date.parse('2026-10-20T01:00:00Z');
function fixture({ old = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT,email TEXT,emailVerified INTEGER,ageBand TEXT);
    CREATE TABLE guardian_requests(childUserId TEXT,status TEXT);`);
  for (const [id, verified] of [['operator-private-id', 1], ['other-operator-private-id', 1], ['member-private-id', 1], ['unverified', 0]]) {
    db.prepare('INSERT INTO user VALUES(?,?,?,?,?)').run(id, id.includes('operator') ? '운영자 별명' : '회원 별명', `${id}@example.test`, verified, '14plus');
  }
  if (old) db.exec(oldSchema); else initializeCommunitySchema(db);
  createGrainService(db);
  let time = initialTime;
  const rewards = createGrainRewards(db, { now: () => time, startTimer: false });
  const auth = { api: { getSession: async ({ headers }) => {
    const id = headers.get('x-test-user');
    return id ? { user: { id, emailVerified: true } } : null;
  } } };
  const admin = createGrainAdmin(db, auth, { rewards, now: () => time, adminUserIds: 'operator-private-id,other-operator-private-id,unverified' });
  let community;
  const initialize = () => { community = createCommunity(db, auth, { rewards, isAdmin: admin.isAdmin, now: () => time }); };
  if (!old) initialize();
  return { db, rewards, initialize, advance() { time += REWARD_DAY_MS; }, close() { rewards.close(); db.close(); },
    async api(path, body, actor = 'operator-private-id', method = body === undefined ? 'GET' : 'POST') {
      const url = new URL(path, 'http://localhost');
      const req = new Request(url, { method, headers: { 'content-type': 'application/json', ...(actor ? { 'x-test-user': actor } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let response;
      try { response = await admin.handle(req, url) ?? await community(req, url); }
      catch (error) { response = errorResponse(error); }
      return { status: response.status, body: await response.json() };
    },
  };
}
const notice = (game = 'gyeongguk', extra = {}) => ({ game, board: 'notice', title: '이번 주 바뀐 점', body: '새 소식을 자세히 안내하는 본문입니다. '.repeat(4), ...extra });
const create = (f, body = notice(), actor) => f.api('/api/community/posts', body, actor);
const rows = (db, table) => db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row }));
const objects = db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('index','trigger') ORDER BY type,name").all();
const foreignKeys = db => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({ name }) => [name, db.prepare(`PRAGMA foreign_key_list(${name})`).all()]);
function seedOld(f) {
  const { db } = f;
  db.exec(`INSERT INTO community_posts VALUES('old-post','gyeongguk','free','옛 제목','옛 본문','member-private-id','2026-10-19','2026-10-19',123);
    INSERT INTO community_posts(rowid,id,game,board,title,body,authorId,createdAt,updatedAt,hiddenAt) VALUES(17,'old-post-2','slimeline','gallery','둘째 옛 제목','둘째 옛 본문','operator-private-id','2026-10-19','2026-10-19',NULL);
    INSERT INTO community_comments VALUES('old-comment','old-post','옛 댓글','operator-private-id','2026-10-19','2026-10-19',456);
    INSERT INTO community_reports VALUES('old-report','operator-private-id','post','old-post','기타','옛 신고','pending',1,NULL);
    INSERT INTO grain_activity_rewards VALUES('old-reward','member-private-id','post','old-post',NULL,'옛 지문',500,'2026-10-19',1,2,'pending');
    INSERT INTO grain_wallets VALUES('member-private-id',500);
    INSERT INTO grain_ledger VALUES('old-ledger','member-private-id','old-event',500,'옛 지급',1);
    INSERT INTO grain_admin_audit(id,actorId,action,targetType,targetId,postId,commentId,reportId,reason,createdAt)
      VALUES('old-audit','operator-private-id','content-unhide','post','old-post','old-post','old-comment','old-report','옛 검토',1);
    CREATE INDEX community_posts_author_extra ON community_posts(authorId);`);
}

test('옛 스키마 이전은 글·댓글·신고·보상·원장·감사·외래키·인덱스·트리거와 rowid를 보존하고 두 번 실행해도 동일', () => {
  const f = fixture({ old: true });
  try {
    seedOld(f);
    const tables = ['community_posts', 'community_comments', 'community_reports', 'grain_activity_rewards', 'grain_ledger', 'grain_wallets', 'grain_admin_audit'];
    const before = tables.map(table => rows(f.db, table)), keys = foreignKeys(f.db), savedObjects = objects(f.db);
    f.initialize();
    tables.forEach((table, index) => {
      const after = rows(f.db, table).map(row => { if (table === 'community_posts') { assert.equal(row.category, null); assert.equal(row.cover, null); assert.equal(row.status, null); const { category, cover, status, ...original } = row; return original; } return row; });
      assert.deepEqual(after, before[index]);
    });
    assert.deepEqual(foreignKeys(f.db), keys);
    assert.deepEqual(objects(f.db), savedObjects);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    const after = tables.map(table => rows(f.db, table));
    f.initialize();
    assert.deepEqual(tables.map(table => rows(f.db, table)), after);
    assert.deepEqual(objects(f.db), savedObjects);
    assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    // 이전 후에도 숨김 보상 취소와 댓글·감사 연쇄 삭제가 실제 동작해야 합니다.
    f.db.exec("UPDATE community_posts SET hiddenAt=3 WHERE id='old-post'");
    assert.equal(f.db.prepare("SELECT status FROM grain_activity_rewards WHERE eventId='old-reward'").get().status, 'cancelled');
    f.db.exec("DELETE FROM community_posts WHERE id='old-post'");
    assert.equal(rows(f.db, 'community_comments').length, 0);
    assert.equal(rows(f.db, 'grain_admin_audit').length, 0);
    assert.equal(rows(f.db, 'grain_activity_rewards').length, 1);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('외래키 검사 실패는 옛 테이블·기록·인덱스·트리거 전체를 롤백하고 외래키 설정을 복원', () => {
  const f = fixture({ old: true });
  try {
    seedOld(f);
    f.db.exec("PRAGMA foreign_keys=OFF; UPDATE community_comments SET postId='missing'; PRAGMA foreign_keys=ON;");
    const schema = f.db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), saved = rows(f.db, 'community_posts');
    assert.throws(() => f.initialize(), /외래키 검사/);
    assert.deepEqual(f.db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
    assert.deepEqual(rows(f.db, 'community_posts'), saved);
    assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    f.db.exec("UPDATE community_comments SET postId='old-post'");
    f.initialize();
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('기존 트랜잭션 안의 이전은 즉시 거부하고 외래키 설정과 원본을 유지', () => {
  const f = fixture({ old: true });
  try {
    seedOld(f);
    f.db.exec('BEGIN IMMEDIATE');
    assert.throws(() => f.initialize(), /트랜잭션 밖/);
    assert.equal(f.db.isTransaction, true);
    assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    f.db.exec('ROLLBACK');
    f.initialize();
    assert.equal(rows(f.db, 'community_posts').length, 2);
  } finally { f.close(); }
});

test('두 게임 새 소식은 운영자만 생성·공동 수정·삭제하고 비로그인·일반회원·미인증은 거부', async () => {
  const f = fixture();
  try {
    for (const game of ['gyeongguk', 'slimeline']) {
      for (const [actor, expected] of [[null, 401], ['member-private-id', 403], ['unverified', 403]]) assert.equal((await create(f, notice(game), actor)).status, expected);
      const created = await create(f, notice(game));
      assert.equal(created.status, 201);
      const path = `/api/community/posts/${created.body.post.id}`;
      for (const method of ['PATCH', 'DELETE']) {
        for (const [actor, expected] of [[null, 401], ['member-private-id', 403], ['unverified', 403]]) assert.equal((await f.api(path, { title: '바꾼 제목', body: '바꾼 본문' }, actor, method)).status, expected);
      }
      const edit = await f.api(path, { title: '공동 운영 수정', body: '바꾼 본문' }, 'other-operator-private-id', 'PATCH');
      assert.equal(edit.status, 200); assert.equal(edit.body.post.canEdit, true);
      assert.equal((await f.api(path, {}, 'other-operator-private-id', 'DELETE')).status, 200);
    }
  } finally { f.close(); }
});

test('말머리와 게임별 대표 그림은 정해진 키·null만 허용하고 일반 게시판·임의 경로·다른 게임 키를 거부', async () => {
  const f = fixture();
  try {
    for (const game of ['gyeongguk', 'slimeline']) {
      for (const cover of [...NOTICE_COVERS[game], null]) {
        const created = await create(f, notice(game, { category: 'devnote', cover }));
        assert.equal(created.status, 201); assert.equal(created.body.post.cover, cover);
      }
    }
    const { id } = (await create(f)).body.post;
    for (const category of [...NOTICE_CATEGORIES, null]) {
      const edit = await f.api(`/api/community/posts/${id}`, { title: '말머리 수정', body: '본문', category }, undefined, 'PATCH');
      assert.equal(edit.status, 200); assert.equal(edit.body.post.category, category);
    }
    for (const extra of [{ category: 'unknown' }, { category: 1 }, { cover: '/assets/gyeongguk/hero.webp' }, { cover: 'hero' }, { cover: {} }, { status: 'solved' }]) {
      assert.equal((await create(f, notice('gyeongguk', extra))).status, 422);
      assert.equal((await f.api(`/api/community/posts/${id}`, { title: '잘못된 변경', body: '본문', ...extra }, undefined, 'PATCH')).status, 422);
    }
    for (const extra of [{ category: 'guide' }, { cover: 'tile-free' }]) assert.equal((await create(f, notice('gyeongguk', { board: 'free', ...extra }))).status, 422);
    const ordinary = (await create(f, notice('gyeongguk', { board: 'free' }), 'member-private-id')).body.post;
    assert.equal(ordinary.category, null); assert.equal(ordinary.cover, null); assert.equal(ordinary.status, null);
    assert.equal((await f.api(`/api/community/posts/${ordinary.id}`, { title: '일반 글 변경', body: '본문', category: 'event' }, 'member-private-id', 'PATCH')).status, 422);
    const kept = (await create(f, notice('gyeongguk', { category: 'changes', cover: 'card-lubu' }))).body.post;
    const edit = await f.api(`/api/community/posts/${kept.id}`, { title: '본문만 수정', body: '본문' }, undefined, 'PATCH');
    assert.equal(edit.body.post.category, 'changes'); assert.equal(edit.body.post.cover, 'card-lubu');
    assert.equal((await f.api(`/api/community/posts/${kept.id}`, { title: '값 지우기', body: '본문', category: null, cover: null }, undefined, 'PATCH')).body.post.cover, null);
    // API 밖 직접 SQL에도 같은 값 제한을 적용합니다.
    for (const sql of ["category='unknown'", "cover='hero'", "status='unknown'"]) assert.throws(() => f.db.exec(`UPDATE community_posts SET ${sql} WHERE id='${id}'`), /CHECK/);
    assert.throws(() => f.db.prepare("UPDATE community_posts SET category='event' WHERE id=?").run(ordinary.id), /CHECK/);
  } finally { f.close(); }
});

test('새 소식 목록·읽기·검색·댓글과 운영자 표시는 공개되며 작성자 ID·이메일·운영자 목록은 비공개', async () => {
  const f = fixture();
  try {
    const created = await create(f, notice('gyeongguk', { category: 'event', cover: 'tile-notice' }));
    const { id } = created.body.post;
    const memberComment = await f.api(`/api/community/posts/${id}/comments`, { body: '일반 회원도 댓글을 남깁니다.' }, 'member-private-id');
    const operatorComment = await f.api(`/api/community/posts/${id}/comments`, { body: '운영자 댓글입니다.' });
    assert.equal(memberComment.status, 201); assert.equal(memberComment.body.comment.author.isOperator, false);
    assert.equal(operatorComment.body.comment.author.isOperator, true);
    for (const actor of [null, 'member-private-id', 'operator-private-id']) {
      const list = await f.api('/api/community/posts?game=gyeongguk&board=notice&q=이번', undefined, actor);
      assert.equal(list.body.total, 1); assert.equal(list.body.posts[0].commentCount, 2);
      const detail = await f.api(`/api/community/posts/${id}?game=gyeongguk`, undefined, actor);
      assert.deepEqual(detail.body.post.author, { name: '운영자 별명', isOperator: true });
      assert.equal(detail.body.post.canEdit, actor === 'operator-private-id');
      assert.equal(detail.body.post.category, 'event'); assert.equal(detail.body.post.cover, 'tile-notice');
      for (const response of [created, list, detail, memberComment, operatorComment]) assert.doesNotMatch(JSON.stringify(response.body), /private-id|example\.test|authorId|ADMIN_USER_IDS|"email"/);
    }
    assert.equal((await f.api('/api/community/posts?game=gyeongguk&board=notice&q=없는검색', undefined, null)).body.total, 0);
    assert.equal((await f.api(`/api/community/posts/${id}?game=slimeline`, undefined, null)).status, 404);
    assert.deepEqual((await f.api('/api/community/session', undefined, null)).body, { user: null });
    for (const [actor, expected] of [['operator-private-id', true], ['member-private-id', false], ['unverified', false]]) {
      const session = (await f.api('/api/community/session', undefined, actor)).body;
      assert.equal(session.user.isOperator, expected);
      assert.deepEqual(Object.keys(session.user).sort(), ['canWriteCommunity', 'id', 'isOperator', 'name']);
    }
    f.db.exec("UPDATE user SET emailVerified=0 WHERE id='operator-private-id'");
    assert.equal((await f.api(`/api/community/posts/${id}?game=gyeongguk`, undefined, null)).body.post.author.isOperator, false);
  } finally { f.close(); }
});

test('처리 상태는 모든 게시판에서 운영자만 전용 PATCH로 설정·해제하고 잘못된 값·게임·혼합 변경은 거부', async () => {
  const f = fixture();
  try {
    for (const [game, boards] of [['gyeongguk', ['free', 'deck', 'strategy', 'notice']], ['slimeline', ['free', 'guide', 'gallery', 'notice']]]) {
      for (const board of boards) {
        const { id } = (await create(f, notice(game, { board }), board === 'notice' ? undefined : 'member-private-id')).body.post;
        const path = `/api/community/posts/${id}/status`;
        for (const status of ['checking', 'solved', 'applied', null]) {
          const response = await f.api(path, { status }, undefined, 'PATCH');
          assert.equal(response.status, 200); assert.equal(response.body.post.status, status);
          assert.equal((await f.api(`/api/community/posts?game=${game}&board=${board}`, undefined, null)).body.posts[0].status, status);
          assert.equal((await f.api(`/api/community/posts/${id}?game=${game}`, undefined, null)).body.post.status, status);
        }
        for (const [actor, expected] of [[null, 401], ['member-private-id', 403], ['unverified', 403]]) assert.equal((await f.api(path, { status: 'checking' }, actor, 'PATCH')).status, expected);
        for (const body of [{}, { status: 'unknown' }, { status: false }, { status: 1 }, { status: 'solved', title: '몰래 변경' }]) assert.equal((await f.api(path, body, undefined, 'PATCH')).status, 422);
        assert.equal((await f.api(`${path}?game=${game === 'slimeline' ? 'gyeongguk' : 'slimeline'}`, { status: 'solved' }, undefined, 'PATCH')).status, 404);
        assert.equal((await f.api(`/api/community/posts/${id}`, { title: '우회 상태 수정', body: '본문', status: 'solved' }, board === 'notice' ? undefined : 'member-private-id', 'PATCH')).status, 422);
      }
    }
    assert.equal((await f.api('/api/community/posts/missing/status', { status: 'solved' }, undefined, 'PATCH')).status, 404);
  } finally { f.close(); }
});

test('운영자 새 소식은 예약·확정·일일 한도·중복 판정에서 제외하고 일반 글·새 소식 댓글 보상은 유지', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 5; i++) {
      const result = await create(f);
      assert.deepEqual(result.body.reward, { pending: false, amount: 0 });
    }
    assert.equal(rows(f.db, 'grain_activity_rewards').length, 0);
    const result = await create(f, notice('gyeongguk', { board: 'free' }));
    assert.deepEqual(result.body.reward, { pending: true, amount: 500 });
    const news = await create(f);
    const reply = await f.api(`/api/community/posts/${news.body.post.id}/comments`, { body: '일반 회원의 첫 댓글도 보상 기준 그대로입니다.' }, 'member-private-id');
    assert.deepEqual(reply.body.reward, { pending: true, amount: 100 });
    f.advance(); f.rewards.tick();
    const entries = rows(f.db, 'grain_ledger');
    assert.equal(entries.length, 2);
    assert.equal(entries.filter(row => row.userId === 'operator-private-id').reduce((sum, row) => sum + row.amount, 0), 500);
  } finally { f.close(); }
});

test('새 소식 신고·운영 신고 목록·숨김·복구와 댓글 숨김은 기존 운영 경로에서 동작', async () => {
  const f = fixture();
  try {
    const { id } = (await create(f, notice('slimeline', { category: 'guide', cover: 'tiles' }))).body.post;
    const comment = (await f.api(`/api/community/posts/${id}/comments`, { body: '신고와 숨김을 확인할 댓글입니다.' }, 'member-private-id')).body.comment;
    const report = await f.api('/api/community/reports', { targetType: 'post', targetId: id, reason: '기타' }, 'member-private-id');
    assert.equal(report.status, 201);
    const listed = await f.api('/api/admin/reports');
    assert.equal(listed.body.reports[0].target.board, 'notice');
    assert.equal(listed.body.reports[0].target.category, 'guide');
    assert.equal(listed.body.reports[0].target.cover, 'tiles');
    assert.equal(listed.body.reports[0].target.author.isOperator, true);
    assert.equal((await f.api(`/api/admin/reports/${report.body.report.id}`, { action: 'hide', reason: '신고 검토 후 숨김' })).status, 200);
    assert.equal((await f.api(`/api/community/posts/${id}?game=slimeline`, undefined, null)).status, 404);
    assert.equal((await f.api('/api/community/posts?game=slimeline&board=notice', undefined, null)).body.total, 0);
    assert.equal((await f.api(`/api/community/posts/${id}/comments`, { body: '숨긴 글에 댓글' }, 'member-private-id')).status, 404);
    assert.equal((await f.api('/api/admin/hidden')).body.posts[0].id, id);
    assert.equal((await f.api(`/api/community/posts/${id}/status`, { status: 'checking' }, undefined, 'PATCH')).status, 200);
    assert.equal((await f.api('/api/admin/hidden')).body.posts[0].status, 'checking');
    assert.equal((await f.api('/api/admin/content', { targetType: 'post', targetId: id, hidden: false, reason: '검토 후 공개 복구' })).status, 200);
    assert.equal((await f.api(`/api/community/posts/${id}?game=slimeline`, undefined, null)).status, 200);
    assert.equal((await f.api('/api/community/reports', { targetType: 'comment', targetId: comment.id, reason: '기타' })).status, 201);
    assert.equal((await f.api('/api/admin/content', { targetType: 'comment', targetId: comment.id, hidden: true, reason: '댓글 검토 후 숨김' })).status, 200);
    const detail = await f.api(`/api/community/posts/${id}?game=slimeline`, undefined, null);
    assert.equal(detail.body.comments.length, 0); assert.equal(detail.body.post.commentCount, 0);
    assert.equal((await f.api('/api/admin/hidden')).body.comments[0].id, comment.id);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grain_admin_audit').get().n, 4);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('대표 그림 계약의 파일은 기존 게임 자산에 실제로 존재', async () => {
  for (const file of ['gyeongguk/tiles.webp', 'gyeongguk/card-lubu.webp', 'gyeongguk/card-diaochan.webp', 'gyeongguk/card-zhugeliang.webp', 'slimeline/tiles.webp', 'slimeline/hero.webp']) await access(new URL(`../assets/${file}`, import.meta.url));
});
