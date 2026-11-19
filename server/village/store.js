import { randomUUID } from 'node:crypto';
import { fail, text } from '../security.js';
import { oneYearAgo } from './policy.js';

export const PALETTE = Object.freeze({ skin: ['#ffe0bd', '#edb98a', '#c68642', '#8d5524'], hair: ['#49352f', '#8b5e3c', '#e6bc76', '#434b68'], outfit: ['#8db9d3', '#d99eaa', '#a8bc98', '#c5afe0'] });
export const DEFAULT_AVATAR = { v: 1, kind: 'placeholder', colors: Object.fromEntries(Object.entries(PALETTE).map(([key, colors]) => [key, colors[0]])) };
export const PHRASES = Object.freeze([{ id: 'hello', text: '안녕!' }, { id: 'play', text: '같이 놀자' }, { id: 'thanks', text: '고마워' }, { id: 'bye', text: '잘 가' }]);
export const EMOTES = Object.freeze([{ id: 'wave', label: '인사' }, { id: 'heart', label: '하트' }, { id: 'laugh', label: '웃음' }, { id: 'surprise', label: '놀람' }, { id: 'clap', label: '박수' }, { id: 'dance', label: '춤' }]);

export function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fail(422, 'INVALID_INPUT', '요청 항목을 확인해 주세요.');
  return body;
}

export function createVillageStore(db, now) {
  db.exec(`CREATE TABLE IF NOT EXISTS village_avatars (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, data TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>0), updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS village_blocks (
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    targetId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, createdAt INTEGER NOT NULL,
    PRIMARY KEY(userId,targetId), CHECK(userId<>targetId)
  );
  CREATE TABLE IF NOT EXISTS village_reports (
    id TEXT PRIMARY KEY, reporterId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    targetId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, channelId INTEGER NOT NULL,
    reason TEXT NOT NULL, snapshot TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS village_reports_time ON village_reports(createdAt DESC);
  CREATE INDEX IF NOT EXISTS village_reports_reporter ON village_reports(reporterId,createdAt);
  CREATE TABLE IF NOT EXISTS village_mutes (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, until INTEGER NOT NULL,
    reason TEXT NOT NULL, actorId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS village_admin_audit (
    id TEXT PRIMARY KEY, actorId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    targetId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    action TEXT NOT NULL, until INTEGER NOT NULL, reason TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS village_mutes_created ON village_mutes(createdAt);
  CREATE INDEX IF NOT EXISTS village_admin_audit_created ON village_admin_audit(createdAt);`);
  function cleanup() {
    const cutoff = oneYearAgo(now());
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of ['village_reports', 'village_mutes', 'village_admin_audit']) db.prepare(`DELETE FROM ${table} WHERE createdAt<=?`).run(cutoff);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function avatar(userId) {
    const row = db.prepare('SELECT data,revision FROM village_avatars WHERE userId=?').get(userId);
    return row ? { data: JSON.parse(row.data), revision: row.revision } : null;
  }
  function saveAvatar(userId, body) {
    fields(body, ['avatar', 'revision']);
    const value = fields(body.avatar, ['v', 'kind', 'colors']);
    fields(value.colors, ['skin', 'hair', 'outfit']);
    if (value.v !== 1 || value.kind !== 'placeholder' || Object.entries(PALETTE).some(([key, colors]) => !colors.includes(value.colors[key])) || !Number.isSafeInteger(body.revision) || body.revision < 0) fail(422, 'INVALID_AVATAR', '임시 옷장의 색상과 저장 번호를 확인해 주세요.');
    const clean = { v: 1, kind: 'placeholder', colors: { skin: value.colors.skin, hair: value.colors.hair, outfit: value.colors.outfit } };
    const result = body.revision === 0
      ? db.prepare('INSERT OR IGNORE INTO village_avatars(userId,data,revision,updatedAt) VALUES(?,?,1,?)').run(userId, JSON.stringify(clean), now())
      : db.prepare('UPDATE village_avatars SET data=?,revision=revision+1,updatedAt=? WHERE userId=? AND revision=?').run(JSON.stringify(clean), now(), userId, body.revision);
    if (!result.changes) fail(409, 'REVISION_CONFLICT', '다른 창에서 옷장을 바꿨습니다. 새로 불러온 뒤 저장해 주세요.');
    return avatar(userId);
  }
  const blocked = (userId, targetId) => Boolean(db.prepare('SELECT 1 FROM village_blocks WHERE userId=? AND targetId=?').get(userId, targetId));
  const muted = userId => db.prepare('SELECT until FROM village_mutes WHERE userId=? AND until>?').get(userId, now())?.until ?? null;
  function target(userId, targetId) {
    const id = text(targetId, 1, 128, '대상 회원');
    if (id === userId) fail(422, 'INVALID_TARGET', '다른 회원을 선택해 주세요.');
    if (!db.prepare('SELECT 1 FROM user WHERE id=?').get(id)) fail(404, 'NOT_FOUND', '회원을 찾을 수 없습니다.');
    return id;
  }
  function report(userId, targetId, channelId, reason, snapshot) {
    if (db.prepare('SELECT COUNT(*) n FROM village_reports WHERE reporterId=? AND createdAt>?').get(userId, now() - 86400000).n >= 10) fail(429, 'REPORT_LIMIT', '신고는 하루 10건까지 접수할 수 있습니다.');
    const id = randomUUID();
    db.prepare('INSERT INTO village_reports(id,reporterId,targetId,channelId,reason,snapshot,createdAt) VALUES(?,?,?,?,?,?,?)').run(id, userId, targetId, channelId, text(reason, 2, 500, '신고 사유'), JSON.stringify(snapshot), now());
    return { id };
  }
  return { avatar, saveAvatar, blocked, muted, target, report, cleanup };
}
