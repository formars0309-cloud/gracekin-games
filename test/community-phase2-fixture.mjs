/* 2단계 브라우저 시험용 격리 서버. 계정·메일·DB는 임시 폴더에서만 만든다. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startServer } from '../server/app.js';
import { request, cookieFrom, registerAndLogin } from './account-helpers.js';
const directory = await mkdtemp(join(tmpdir(), 'community-phase2-ui-'));
const mailbox = [];
let app;
const options = { port: 0, dataDir: directory, nodeEnv: 'test', env: {}, mailer: async message => mailbox.push(message), rateLimit: { authMax: 300, writeMax: 1000, readMax: 10000 } };
async function close() { await app?.close(); await rm(directory, { recursive: true, force: true }); }
process.once('SIGTERM', async () => { await close(); process.exit(0); });
try {
  app = await startServer(options);
  const sessions = {};
  let operatorId;
  for (const [role, name] of [['operator', '시험운영자'], ['member', '시험일반회원']]) {
    const result = await registerAndLogin(app, mailbox, { name, email: `${role}@example.test`, password: randomBytes(24).toString('base64url'), ageBand: '14plus' });
    if (result.status !== 200) throw new Error('시험 계정 준비 실패');
    sessions[role] = cookieFrom(result);
    if (role === 'operator') operatorId = (await request(app, '/api/community/session', { cookie: sessions[role] })).body.user.id;
  }
  const port = app.port;
  await app.close();
  process.env.ADMIN_USER_IDS = operatorId;
  app = await startServer({ ...options, port });
  process.send({ origin: app.origin, sessions });
} catch { await close(); process.exit(1); }
