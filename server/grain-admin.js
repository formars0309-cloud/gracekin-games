import { randomUUID } from 'node:crypto';
import { activeAccountUser } from './account.js';
import { fail, json, readJson, text } from './security.js';
import { GRAIN_REWARD_POLICY } from './grain-policy.js';

const BUG_STATUSES = ['접수', '확인 중', '중복', '재현 불가', '채택', '수정 완료'];
const ISSUE_STATUSES = ['확인 중', '수정 중', '수정 완료'];
const BUG_GRADES = GRAIN_REWARD_POLICY.bugReport;
const DAY = GRAIN_REWARD_POLICY.dayMs;
const iso = value => value === null ? null : new Date(value).toISOString();

function fields(body, allowed) {
  if (Object.keys(body).some(key => !allowed.includes(key))) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
  return body;
}
function oneOf(value, values, label) {
  if (!values.includes(value)) fail(422, 'INVALID_INPUT', `${label}을 확인해 주세요.`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(422, 'INVALID_INPUT', `${label}을 확인해 주세요.`);
  return value;
}
function boolean(value) {
  if (typeof value !== 'boolean') fail(422, 'INVALID_INPUT', '설정값을 확인해 주세요.');
  return value;
}
function timestamp(value, label) {
  if (typeof value === 'string') {
    const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
    if (!parts) fail(422, 'INVALID_INPUT', `${label}은 밀리초 또는 시간대가 있는 ISO8601로 입력해 주세요.`);
    const [, y, m, d, h, min, sec, zone] = parts;
    const date = new Date(Date.UTC(+y, +m - 1, +d));
    if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d || +h > 23 || +min > 59 || +sec > 59 || zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) fail(422, 'INVALID_INPUT', `${label}을 확인해 주세요.`);
    value = Date.parse(value);
  }
  return integer(value, 0, 8640000000000000, label);
}
const reasonOf = body => text(body.reason, 2, 1000, '처리 사유');
const identifier = value => text(value, 1, 128, '식별자');

export function createGrainAdmin(db, auth, { rewards, now = Date.now, adminUserIds = '' } = {}) {
  if (typeof adminUserIds !== 'string') throw new Error('ADMIN_USER_IDS는 쉼표로 구분한 문자열이어야 합니다.');
  const admins = new Set(adminUserIds.split(',').map(value => value.trim()).filter(Boolean));
  db.exec(`CREATE TABLE IF NOT EXISTS grain_bug_reports (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    game TEXT NOT NULL CHECK(game IN ('slimeline','gyeongguk','site','slime-race')),
    title TEXT NOT NULL, body TEXT NOT NULL, steps TEXT, url TEXT,
    status TEXT NOT NULL DEFAULT '접수' CHECK(status IN ('접수','확인 중','중복','재현 불가','채택','수정 완료')),
    grade TEXT CHECK(grade IN ('simple','normal','critical')), rewardDecidedAt INTEGER,
    rewardEligibility TEXT CHECK(rewardEligibility IN ('eligible','unverified','under14','suspended')), createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS grain_bug_reports_user_time ON grain_bug_reports(userId,createdAt DESC);
  CREATE TABLE IF NOT EXISTS grain_admin_events (
    slug TEXT PRIMARY KEY, title TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND 100000),
    startsAt INTEGER NOT NULL, endsAt INTEGER NOT NULL CHECK(endsAt>startsAt),
    createdBy TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS community_known_issues (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('확인 중','수정 중','수정 완료')),
    createdBy TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS grain_admin_audit (
    id TEXT PRIMARY KEY, actorId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    action TEXT NOT NULL, targetType TEXT NOT NULL, targetId TEXT NOT NULL,
    targetUserId TEXT REFERENCES user(id) ON DELETE CASCADE,
    postId TEXT REFERENCES community_posts(id) ON DELETE CASCADE,
    commentId TEXT REFERENCES community_comments(id) ON DELETE CASCADE,
    reportId TEXT REFERENCES community_reports(id) ON DELETE CASCADE,
    bugReportId TEXT REFERENCES grain_bug_reports(id) ON DELETE CASCADE,
    eventSlug TEXT REFERENCES grain_admin_events(slug) ON DELETE CASCADE,
    knownIssueId TEXT REFERENCES community_known_issues(id) ON DELETE CASCADE,
    reason TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS grain_admin_audit_actor_time ON grain_admin_audit(actorId,createdAt DESC);`);

  // 세션에 남은 과거 속성 대신 DB의 현재 계정·동의 상태를 판정합니다.
  function currentUser(user) {
    return user?.id ? activeAccountUser(db, db.prepare('SELECT id,name,email,emailVerified,ageBand FROM user WHERE id=?').get(user.id)) : null;
  }
  function isAdmin(user) {
    if (!admins.has(user?.id)) return false;
    const current = currentUser(user);
    return Boolean(current?.emailVerified);
  }
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function audit(actor, action, targetType, targetId, reason, links = {}) {
    db.prepare(`INSERT INTO grain_admin_audit(id,actorId,action,targetType,targetId,targetUserId,postId,commentId,reportId,bugReportId,eventSlug,knownIssueId,reason,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), actor.id, action, targetType, targetId, links.targetUserId ?? null, links.postId ?? null, links.commentId ?? null, links.reportId ?? null, links.bugReportId ?? null, links.eventSlug ?? null, links.knownIssueId ?? null, reason, now());
  }
  function findUser(id) {
    const user = db.prepare('SELECT id,name,email,emailVerified,ageBand FROM user WHERE id=?').get(id);
    if (!user) fail(404, 'NOT_FOUND', '회원을 찾을 수 없습니다.');
    return user;
  }
  function content(targetType, targetId) {
    oneOf(targetType, ['post', 'comment'], '대상 종류');
    const table = targetType === 'post' ? 'community_posts' : 'community_comments';
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(targetId);
    if (!row) fail(404, 'NOT_FOUND', '대상을 찾을 수 없습니다.');
    return { table, row };
  }
  function contentData(type, row) {
    return { id: row.id, ...(type === 'post' ? { game: row.game, board: row.board, category: row.category, cover: row.cover, status: row.status, title: row.title } : { postId: row.postId }), body: row.body,
      author: { name: db.prepare('SELECT name FROM user WHERE id=?').get(row.authorId)?.name, isOperator: isAdmin({ id: row.authorId }) }, hiddenAt: iso(row.hiddenAt), createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
  function setHidden(actor, type, id, hidden, reason, reportId = null) {
    const { table, row } = content(type, id);
    db.prepare(`UPDATE ${table} SET hiddenAt=? WHERE id=?`).run(hidden ? now() : null, id);
    // 복구는 취소한 보상을 되살리지 않습니다. 회원의 다른 원본 보상은 보존합니다.
    if (hidden) rewards.cancelContent(type, id);
    audit(actor, hidden ? 'content-hide' : 'content-unhide', type, id, reason, { targetUserId: row.authorId, [type === 'post' ? 'postId' : 'commentId']: id, reportId });
  }
  function award(user, eventId, amount, reason) {
    const duplicate = Boolean(db.prepare('SELECT 1 FROM grain_ledger WHERE userId=? AND eventId=?').get(user.id, eventId));
    const rewardEligibility = rewards.rewardStatus(currentUser(user));
    if (duplicate || rewardEligibility !== 'eligible') return { awarded: false, duplicate, rewardEligibility };
    const awarded = rewards.grant(user.id, eventId, amount, reason);
    return { awarded, duplicate: !awarded, rewardEligibility };
  }
  function bugData(row, privateContent = false) {
    return { id: row.id, status: row.status, grade: row.grade, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
      ...(privateContent ? { user: { id: row.userId, name: db.prepare('SELECT name FROM user WHERE id=?').get(row.userId)?.name }, game: row.game, title: row.title, body: row.body, steps: row.steps, url: row.url, rewardDecidedAt: iso(row.rewardDecidedAt), rewardEligibility: row.rewardEligibility } : {}) };
  }
  function issueData(row) { return { id: row.id, title: row.title, summary: row.summary, status: row.status, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }; }
  function eventData(row) { return { slug: row.slug, title: row.title, amount: row.amount, startsAt: iso(row.startsAt), endsAt: iso(row.endsAt), createdAt: iso(row.createdAt) }; }

  async function handle(request, url) {
    const path = url.pathname, method = request.method;
    const adminPath = path === '/api/admin' || path.startsWith('/api/admin/');
    const bugPath = path === '/api/community/bug-reports';
    if (!adminPath && !bugPath && path !== '/api/community/known-issues') return null;
    // 알 수 없는 운영 경로·메서드도 권한 확인을 먼저 거칩니다.
    let user;
    if (adminPath || bugPath) {
      if (adminPath && admins.size === 0) fail(403, 'ADMIN_REQUIRED', '운영자 권한이 필요합니다.');
      const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
      if (adminPath && !isAdmin(session?.user)) fail(403, 'ADMIN_REQUIRED', '운영자 권한이 필요합니다.');
      user = currentUser(session?.user);
      if (!user) fail(401, 'AUTH_REQUIRED', '로그인 후 이용해 주세요.');
    }
    if (adminPath && path !== '/api/admin/users' && url.search) fail(422, 'INVALID_INPUT', '추가 요청 항목은 지원하지 않습니다.');
    const mutate = work => transaction(() => {
      if (adminPath && !isAdmin(user)) fail(403, 'ADMIN_REQUIRED', '운영자 권한이 필요합니다.');
      if (!currentUser(user)) fail(401, 'AUTH_REQUIRED', '로그인 후 이용해 주세요.');
      return work();
    });
    if (path === '/api/community/known-issues' && method === 'GET') {
      if (url.search) fail(422, 'INVALID_INPUT', '추가 조회 항목은 지원하지 않습니다.');
      return json({ issues: db.prepare('SELECT id,title,summary,status,createdAt,updatedAt FROM community_known_issues ORDER BY createdAt DESC,id DESC').all().map(issueData) });
    }
    if (bugPath) {
      if (method === 'GET') {
        if (url.search) fail(422, 'INVALID_INPUT', '본인 제보 상태만 조회할 수 있습니다.');
        return json({ reports: db.prepare('SELECT id,status,grade,createdAt,updatedAt FROM grain_bug_reports WHERE userId=? ORDER BY createdAt DESC,id DESC').all(user.id).map(row => bugData(row)) });
      }
      if (method === 'POST') {
        const body = fields(await readJson(request), ['game', 'title', 'body', 'steps', 'url']);
        const game = oneOf(body.game, ['slimeline', 'gyeongguk', 'site', 'slime-race'], '게임');
        const title = text(body.title, 2, 100, '제목'), description = text(body.body, 10, 5000, '본문');
        const steps = body.steps === undefined ? null : text(body.steps, 0, 3000, '재현 절차');
        let link = body.url === undefined || body.url === '' ? null : text(body.url, 1, 2000, '주소');
        if (link) {
          let parsed;
          try { parsed = new URL(link); } catch { fail(422, 'INVALID_URL', '주소를 확인해 주세요.'); }
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail(422, 'INVALID_URL', 'HTTP 또는 HTTPS 주소를 입력해 주세요.');
          link = parsed.href;
        }
        const report = mutate(() => {
          const time = now(), start = Math.floor((time + GRAIN_REWARD_POLICY.kstOffsetMs) / DAY) * DAY - GRAIN_REWARD_POLICY.kstOffsetMs;
          if (db.prepare('SELECT COUNT(*) AS n FROM grain_bug_reports WHERE userId=? AND createdAt>=? AND createdAt<?').get(user.id, start, start + DAY).n >= 5) fail(429, 'BUG_REPORT_LIMIT', '버그 제보는 하루 5건까지 접수할 수 있습니다.');
          const id = randomUUID();
          db.prepare('INSERT INTO grain_bug_reports(id,userId,game,title,body,steps,url,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)').run(id, user.id, game, title, description, steps, link, time, time);
          return bugData(db.prepare('SELECT * FROM grain_bug_reports WHERE id=?').get(id));
        });
        return json({ report }, 201);
      }
      fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
    }
    if (path === '/api/admin/session' && method === 'GET') return json({ admin: true });
    if (path === '/api/admin/reports' && method === 'GET') {
      const reports = db.prepare('SELECT id,reporterId,targetType,targetId,reason,description,status,createdAt,reviewedAt FROM community_reports ORDER BY createdAt DESC,id DESC').all().map(row => {
        const table = row.targetType === 'post' ? 'community_posts' : 'community_comments';
        const target = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(row.targetId);
        return { id: row.id, reporter: { id: row.reporterId, name: db.prepare('SELECT name FROM user WHERE id=?').get(row.reporterId)?.name }, targetType: row.targetType, targetId: row.targetId,
          reason: row.reason, description: row.description, status: row.status, createdAt: iso(row.createdAt), reviewedAt: iso(row.reviewedAt), target: target ? contentData(row.targetType, target) : null };
      });
      return json({ reports });
    }
    let match = path.match(/^\/api\/admin\/reports\/([A-Za-z0-9_-]{1,128})$/);
    if (match && method === 'POST') {
      const body = fields(await readJson(request), ['action', 'reason']);
      const action = oneOf(body.action, ['dismiss', 'hide', 'unhide'], '처리'), reason = reasonOf(body);
      mutate(() => {
        const report = db.prepare('SELECT * FROM community_reports WHERE id=?').get(match[1]);
        if (!report) fail(404, 'NOT_FOUND', '신고를 찾을 수 없습니다.');
        if (action !== 'dismiss') setHidden(user, report.targetType, report.targetId, action === 'hide', reason, report.id);
        db.prepare('UPDATE community_reports SET status=?,reviewedAt=? WHERE id=?').run(action === 'dismiss' ? 'dismissed' : 'resolved', now(), report.id);
        audit(user, `report-${action}`, 'report', report.id, reason, { reportId: report.id, targetUserId: report.reporterId });
      });
      return json({ ok: true });
    }
    if (path === '/api/admin/content' && method === 'POST') {
      const body = fields(await readJson(request), ['targetType', 'targetId', 'hidden', 'reason']);
      const type = oneOf(body.targetType, ['post', 'comment'], '대상 종류'), id = identifier(body.targetId), hidden = boolean(body.hidden), reason = reasonOf(body);
      mutate(() => setHidden(user, type, id, hidden, reason));
      return json({ ok: true });
    }
    if (path === '/api/admin/hidden' && method === 'GET') {
      return json({ posts: db.prepare('SELECT * FROM community_posts WHERE hiddenAt IS NOT NULL ORDER BY hiddenAt DESC,id DESC').all().map(row => contentData('post', row)),
        comments: db.prepare('SELECT * FROM community_comments WHERE hiddenAt IS NOT NULL ORDER BY hiddenAt DESC,id DESC').all().map(row => contentData('comment', row)) });
    }
    if (path === '/api/admin/users' && method === 'GET') {
      if ([...url.searchParams.keys()].some(key => key !== 'q') || url.searchParams.getAll('q').length !== 1) fail(422, 'INVALID_INPUT', '정확한 이메일 또는 닉네임을 입력해 주세요.');
      const query = text(url.searchParams.get('q'), 1, 254, '조회값');
      const users = db.prepare('SELECT id,name,emailVerified,ageBand FROM user WHERE lower(email)=lower(?) OR name=? ORDER BY id').all(query, query);
      return json({ users: users.map(row => ({ id: row.id, name: row.name, rewardEligibility: rewards.rewardStatus(currentUser(row)), balance: db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(row.id)?.balance ?? 0 })) });
    }
    match = path.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]{1,128})\/(suspension|reclaim)$/);
    if (match && method === 'POST') {
      const body = fields(await readJson(request), match[2] === 'suspension' ? ['suspended', 'reason'] : ['amount', 'reason']);
      const reason = reasonOf(body);
      if (match[2] === 'suspension') {
        const suspended = boolean(body.suspended);
        mutate(() => {
          findUser(match[1]);
          if (suspended) {
            db.prepare('INSERT INTO grain_reward_suspensions(userId,reason,createdAt) VALUES(?,?,?) ON CONFLICT(userId) DO UPDATE SET reason=excluded.reason,createdAt=excluded.createdAt').run(match[1], reason, now());
            rewards.cancelPending(match[1]);
          } else db.prepare('DELETE FROM grain_reward_suspensions WHERE userId=?').run(match[1]);
          audit(user, suspended ? 'reward-suspend' : 'reward-resume', 'user', match[1], reason, { targetUserId: match[1] });
        });
        return json({ ok: true, suspended });
      }
      const amount = integer(body.amount, 1, Number.MAX_SAFE_INTEGER, '회수량');
      const balance = mutate(() => {
        findUser(match[1]);
        const wallet = db.prepare('SELECT balance FROM grain_wallets WHERE userId=?').get(match[1]);
        if (!wallet || wallet.balance < amount) fail(422, 'INSUFFICIENT_BALANCE', '잔액 범위에서만 회수할 수 있습니다.');
        const eventId = `admin-reclaim:${randomUUID()}`;
        db.prepare('INSERT INTO grain_ledger(id,userId,eventId,amount,reason,createdAt) VALUES(?,?,?,?,?,?)').run(randomUUID(), match[1], eventId, -amount, `운영자 회수 · ${reason}`, now());
        db.prepare('UPDATE grain_wallets SET balance=balance-? WHERE userId=? AND balance>=?').run(amount, match[1], amount);
        audit(user, 'grain-reclaim', 'user', match[1], reason, { targetUserId: match[1] });
        return wallet.balance - amount;
      });
      return json({ ok: true, reclaimed: amount, balance });
    }
    if (path === '/api/admin/best-post' && method === 'POST') {
      const body = fields(await readJson(request), ['postId', 'reason']), postId = identifier(body.postId), reason = reasonOf(body);
      const result = mutate(() => {
        const { row } = content('post', postId);
        if (row.hiddenAt !== null) fail(422, 'CONTENT_HIDDEN', '숨긴 글은 우수 글로 선정할 수 없습니다.');
        const result = award(findUser(row.authorId), `best-post:${row.id}`, GRAIN_REWARD_POLICY.bestPost.amount, '우수 글 선정');
        audit(user, 'best-post', 'post', row.id, reason, { postId: row.id, targetUserId: row.authorId });
        return result;
      });
      return json(result);
    }
    if (path === '/api/admin/events') {
      if (method === 'GET') return json({ events: db.prepare('SELECT slug,title,amount,startsAt,endsAt,createdAt FROM grain_admin_events ORDER BY createdAt DESC,slug').all().map(eventData) });
      if (method === 'POST') {
        const body = fields(await readJson(request), ['slug', 'title', 'amount', 'startsAt', 'endsAt', 'reason']);
        const slug = text(body.slug, 1, 80, '이벤트 식별자');
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(422, 'INVALID_INPUT', '이벤트 식별자는 영문 소문자·숫자·붙임표로 입력해 주세요.');
        const title = text(body.title, 2, 100, '이벤트 제목'), amount = integer(body.amount, 1, 100000, '이벤트 지급량');
        const startsAt = timestamp(body.startsAt, '시작 시각'), endsAt = timestamp(body.endsAt, '종료 시각'), reason = reasonOf(body);
        if (endsAt <= startsAt) fail(422, 'INVALID_INPUT', '종료 시각은 시작 시각 뒤여야 합니다.');
        const event = mutate(() => {
          if (db.prepare('SELECT 1 FROM grain_admin_events WHERE slug=?').get(slug)) fail(409, 'EVENT_EXISTS', '이미 등록한 이벤트 식별자입니다.');
          db.prepare('INSERT INTO grain_admin_events(slug,title,amount,startsAt,endsAt,createdBy,createdAt) VALUES(?,?,?,?,?,?,?)').run(slug, title, amount, startsAt, endsAt, user.id, now());
          audit(user, 'event-create', 'event', slug, reason, { eventSlug: slug });
          return eventData(db.prepare('SELECT * FROM grain_admin_events WHERE slug=?').get(slug));
        });
        return json({ event }, 201);
      }
    }
    match = path.match(/^\/api\/admin\/events\/([a-z0-9-]{1,80})\/awards$/);
    if (match && method === 'POST') {
      const body = fields(await readJson(request), ['recipients', 'reason']), reason = reasonOf(body);
      if (!Array.isArray(body.recipients) || !body.recipients.length || body.recipients.length > 500) fail(422, 'INVALID_INPUT', '지급 대상은 1~500명으로 입력해 주세요.');
      const recipients = body.recipients.map(value => text(value, 1, 254, '지급 대상'));
      const result = mutate(() => {
        const event = db.prepare('SELECT * FROM grain_admin_events WHERE slug=?').get(match[1]);
        if (!event) fail(404, 'NOT_FOUND', '이벤트를 찾을 수 없습니다.');
        const time = now();
        if (time < event.startsAt || time >= event.endsAt) fail(422, 'EVENT_INACTIVE', '이벤트 기간에만 지급할 수 있습니다.');
        const result = { awarded: 0, skipped: 0, duplicates: 0, notFound: 0 }, seen = new Set();
        for (const recipient of recipients) {
          const target = db.prepare('SELECT id,name,emailVerified,ageBand FROM user WHERE id=?').get(recipient) ?? db.prepare('SELECT id,name,emailVerified,ageBand FROM user WHERE lower(email)=lower(?)').get(recipient);
          if (!target) { result.notFound++; continue; }
          if (seen.has(target.id)) { result.duplicates++; continue; }
          seen.add(target.id);
          const outcome = award(target, `event:${event.slug}`, event.amount, `이벤트 · ${event.title}`);
          if (outcome.duplicate) result.duplicates++;
          else if (outcome.awarded) result.awarded++;
          else result.skipped++;
          audit(user, outcome.awarded ? 'event-award' : 'event-skip', 'user', target.id, reason, { targetUserId: target.id, eventSlug: event.slug });
        }
        audit(user, 'event-awards', 'event', event.slug, reason, { eventSlug: event.slug });
        return result;
      });
      return json(result);
    }
    if (path === '/api/admin/bug-reports' && method === 'GET') return json({ reports: db.prepare('SELECT * FROM grain_bug_reports ORDER BY createdAt DESC,id DESC').all().map(row => bugData(row, true)) });
    match = path.match(/^\/api\/admin\/bug-reports\/([A-Za-z0-9_-]{1,128})$/);
    if (match && method === 'POST') {
      const body = fields(await readJson(request), ['status', 'grade', 'reason']);
      const status = oneOf(body.status, BUG_STATUSES, '제보 상태'), reason = reasonOf(body);
      const grade = body.grade === undefined ? undefined : oneOf(body.grade, Object.keys(BUG_GRADES), '제보 등급');
      const result = mutate(() => {
        const report = db.prepare('SELECT * FROM grain_bug_reports WHERE id=?').get(match[1]);
        if (!report) fail(404, 'NOT_FOUND', '제보를 찾을 수 없습니다.');
        const paid = db.prepare('SELECT 1 FROM grain_ledger WHERE userId=? AND eventId=?').get(report.userId, `bug-report:${report.id}`);
        if (report.rewardDecidedAt !== null && grade && grade !== report.grade) fail(409, 'GRADE_ALREADY_AWARDED', '지급 판정을 마친 제보의 등급은 바꿀 수 없습니다.');
        const nextGrade = grade ?? report.grade;
        let outcome = { awarded: false, duplicate: Boolean(paid), rewardEligibility: report.rewardEligibility ?? rewards.rewardStatus(currentUser(findUser(report.userId))) };
        if (status === '채택' && nextGrade && report.rewardDecidedAt === null) {
          const info = BUG_GRADES[nextGrade];
          outcome = award(findUser(report.userId), `bug-report:${report.id}`, info.amount, `버그 제보 보상(${info.label})`);
          // 미자격 채택도 최종 판정입니다. 인증·정지 해제 후 재채택으로 소급하지 않습니다.
          db.prepare('UPDATE grain_bug_reports SET rewardDecidedAt=?,rewardEligibility=? WHERE id=?').run(now(), outcome.rewardEligibility, report.id);
        }
        db.prepare('UPDATE grain_bug_reports SET status=?,grade=?,updatedAt=? WHERE id=?').run(status, nextGrade, now(), report.id);
        audit(user, 'bug-report-review', 'bug-report', report.id, reason, { bugReportId: report.id, targetUserId: report.userId });
        return { report: bugData(db.prepare('SELECT * FROM grain_bug_reports WHERE id=?').get(report.id)), ...outcome };
      });
      return json(result);
    }
    if ((path === '/api/admin/known-issues' || /^\/api\/admin\/known-issues\/[A-Za-z0-9_-]{1,128}$/.test(path)) && method === 'POST') {
      const body = fields(await readJson(request), ['title', 'summary', 'status', 'reason']);
      const title = text(body.title, 2, 100, '공개 제목'), summary = text(body.summary, 10, 2000, '공개 요약'), status = oneOf(body.status, ISSUE_STATUSES, '공개 상태'), reason = reasonOf(body);
      const existingId = path === '/api/admin/known-issues' ? null : path.split('/').at(-1);
      const issue = mutate(() => {
        const id = existingId ?? randomUUID(), time = now();
        if (existingId) {
          if (!db.prepare('SELECT 1 FROM community_known_issues WHERE id=?').get(id)) fail(404, 'NOT_FOUND', '알려진 문제를 찾을 수 없습니다.');
          db.prepare('UPDATE community_known_issues SET title=?,summary=?,status=?,updatedAt=? WHERE id=?').run(title, summary, status, time, id);
        } else db.prepare('INSERT INTO community_known_issues(id,title,summary,status,createdBy,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').run(id, title, summary, status, user.id, time, time);
        audit(user, existingId ? 'known-issue-update' : 'known-issue-create', 'known-issue', id, reason, { knownIssueId: id });
        return issueData(db.prepare('SELECT * FROM community_known_issues WHERE id=?').get(id));
      });
      return json({ issue }, existingId ? 200 : 201);
    }
    fail(404, 'NOT_FOUND', '요청한 내용을 찾을 수 없습니다.');
  }
  return { handle, isAdmin };
}
