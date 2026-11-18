import { randomUUID } from 'node:crypto';
import { characterError } from '../assets/avatar/model.js';
import { activeAccountUser } from './account.js';
import { fail, json, readJson } from './security.js';

function avatarResponse(row) {
  return json({ avatar: row ? { id: row.id, revision: row.revision, character: JSON.parse(row.character) } : null });
}

export function createAvatarRoutes(db, auth) {
  db.exec(`CREATE TABLE IF NOT EXISTS avatars (
    id TEXT PRIMARY KEY NOT NULL,
    userId TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    character TEXT NOT NULL
  )`);
  const current = db.prepare('SELECT id, revision, character FROM avatars WHERE userId=?');
  const create = db.prepare(`INSERT INTO avatars (id, userId, revision, character) VALUES (?, ?, 1, ?)
    ON CONFLICT (userId) DO NOTHING RETURNING id, revision, character`);
  const update = db.prepare(`UPDATE avatars SET character=?, revision=revision+1
    WHERE userId=? AND revision=? RETURNING id, revision, character`);

  return async function avatarMe(request, url) {
    if (request.method !== 'GET' && request.method !== 'PUT') fail(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청입니다.');
    if (url.search) fail(422, 'INVALID_INPUT', '내 아바타 요청에는 주소에 추가 항목을 넣을 수 없습니다.');
    const body = request.method === 'PUT' ? await readJson(request, 4096) : null;
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    const user = activeAccountUser(db, session?.user);
    if (!user) fail(401, 'AUTH_REQUIRED', '로그인 후 이용해 주세요.');
    if (request.method === 'GET') return avatarResponse(current.get(user.id));

    const { revision, character } = body;
    if (Object.keys(body).length !== 2 || !Number.isSafeInteger(revision) || revision < 0) {
      fail(422, 'INVALID_INPUT', '저장 버전과 캐릭터를 함께 보내 주세요.');
    }
    const error = characterError(character);
    if (error) fail(422, 'INVALID_INPUT', error);
    const data = JSON.stringify({ ...character, name: character.name.trim() });
    const row = revision === 0 ? create.get(randomUUID(), user.id, data) : update.get(data, user.id, revision);
    if (!row) fail(409, 'AVATAR_REVISION_CONFLICT', '저장 버전이 다릅니다. 최신 아바타를 불러와 확인해 주세요.');
    return avatarResponse(row);
  };
}
